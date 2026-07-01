# AWS Go-Live (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the artifacts to move Happy Hour Friends off the DigitalOcean droplet onto a single AWS EC2 box behind CloudFront + WAF, with a short reversible cutover.

**Architecture:** One `t4g.medium` (AL2023 arm64) runs Caddy → `next start` (web + in-process pg-boss workers) → localhost Postgres 17 + PostGIS on a dedicated EBS volume. CloudFront (+WAFv2) is the edge; origin TLS is a Let's Encrypt cert Caddy obtains via a Route53 DNS-01 challenge. DNS moves off Cloudflare to Route53. Nightly `pg_dump` → S3 via a systemd timer. The operator runs every `terraform`/cutover command; this plan only produces files.

**Tech Stack:** Terraform (AWS provider ~>5.0), Amazon Linux 2023 (arm64), PostgreSQL 17 + PostGIS, Node 20 + pnpm, Next.js 15, Caddy (+caddy-dns/route53), systemd, S3/CloudFront/WAFv2/Route53/ACM/Secrets Manager.

**Method note (IaC, not app TDD):** Terraform is declarative — there is no unit-test harness and this session cannot run `terraform apply` against the prod account. Each task's verification step is the correct static analog: `terraform fmt`, `terraform validate` (after a one-time local `terraform init`), and `shellcheck` for bash. End-to-end acceptance lives in the runbook (Task 10) and is executed by the operator.

**Base state:** Work continues on branch `infra/aws-budget-trimmed`. `infra/budget.tf` already exists (WAF added, X-Ray/KMS removed). This plan corrects and trims it and adds the surrounding artifacts.

---

## File Structure

- `infra/budget.tf` (modify) — trim dead infra; fix origin-TLS + `/_next/static`; add EIP/origin record/Route53-ACM IAM/user_data/backup lifecycle.
- `infra/user_data.sh` (create) — cloud-init bootstrap, templated by Terraform.
- `infra/Caddyfile` (create) — reverse proxy + DNS-01 TLS for `origin.<domain>`.
- `infra/systemd/hhf-web.service` (create) — runs `pnpm start` (web + workers).
- `infra/systemd/hhf-backup.service` (create) — oneshot backup unit.
- `infra/systemd/hhf-backup.timer` (create) — nightly trigger.
- `infra/scripts/pg-backup.sh` (create) — `pg_dump -Fc` → S3.
- `infra/bootstrap/state.tf` (create) — one-time S3 state bucket + DynamoDB lock table (local state).
- `infra/backend.tf` (create) — partial `backend "s3"` block for the main stack.
- `infra/terraform.tfvars.example` (create) — documents every required variable.
- `docs/aws-go-live-runbook.md` (create) — apply order, DNS migration, cutover, rollback.

---

## Task 1: Trim dead infra from `infra/budget.tf`

Removes the three Lambdas, the EventBridge scheduler, the renders bucket, and the Lambda alarms — none are used at go-live (rendering/jobs/backups run on the box).

**Files:**
- Modify: `infra/budget.tf`

- [ ] **Step 1: Delete these resource + data blocks entirely** (search each by name and remove the whole block):
  - `aws_iam_role.render_lambda`, `aws_iam_role_policy_attachment.render_lambda_managed`, `aws_iam_role_policy.render_lambda_inline`
  - `aws_iam_role.cron_lambda`, `aws_iam_role_policy_attachment.cron_lambda_managed`, `aws_iam_role_policy.cron_lambda_inline`
  - `aws_iam_role.backup_lambda`, `aws_iam_role_policy_attachment.backup_lambda_managed`, `aws_iam_role_policy.backup_lambda_inline`
  - `aws_lambda_function.render_lambda`, `aws_lambda_function.cron_lambda`, `aws_lambda_function.backup_lambda`
  - `aws_cloudwatch_log_group.render_lambda`, `aws_cloudwatch_log_group.cron_lambda`, `aws_cloudwatch_log_group.backup_lambda`
  - `aws_cloudwatch_metric_alarm.render_lambda_errors`, `aws_cloudwatch_metric_alarm.backup_lambda_errors`, `aws_cloudwatch_metric_alarm.cron_lambda_errors`
  - `data.aws_iam_policy_document.scheduler_assume`, `aws_iam_role.scheduler`, `aws_iam_role_policy.scheduler_invoke`
  - `aws_scheduler_schedule.scheduler_backup_lambda`, `aws_scheduler_schedule.scheduler_cron_lambda`
  - `aws_lambda_permission.scheduler_backup_lambda`, `aws_lambda_permission.scheduler_cron_lambda`
  - `aws_s3_bucket.s3_renders` and its `aws_s3_bucket_server_side_encryption_configuration.s3_renders`, `aws_s3_bucket_public_access_block.s3_renders`, `aws_s3_bucket_policy.s3_renders`

- [ ] **Step 2: Remove the `Invoke_render_lambda` statement** from `aws_iam_role_policy.ec2_box_inline` (the `Sid = "Invoke_render_lambda"` object in its `Statement` array). Leave the surrounding statements intact.

- [ ] **Step 3: Verify**

Run: `cd infra && terraform fmt && grep -c 'lambda\|scheduler\|s3_renders' budget.tf`
Expected: `fmt` prints `budget.tf` (or nothing); grep prints `0`.

- [ ] **Step 4: Commit**

```bash
git add infra/budget.tf
git commit -m "infra: drop phase-1-unused Lambdas, scheduler, renders bucket"
```

---

## Task 2: Fix the `/static/*` → S3 asset mismatch in `infra/budget.tf`

Next serves hashed assets from `/_next/static/*`; the drafted `/static/*`→S3 behavior would 404. Serve assets from the origin through CloudFront and drop the S3 asset origin.

**Files:**
- Modify: `infra/budget.tf`

- [ ] **Step 1: Delete the S3-assets CloudFront wiring:**
  - `aws_cloudfront_origin_access_control.s3_assets` (whole resource)
  - In `aws_cloudfront_distribution.cf`: delete the `origin { ... origin_id = "s3-s3_assets" ... }` block, and delete the entire `ordered_cache_behavior { path_pattern = "/static/*" ... }` block.
  - In `aws_s3_bucket_policy.s3_assets`: delete the `Sid = "AllowCloudFrontOAC"` statement (keep the `DenyNonTLS` statement). The `s3_assets` bucket stays as a private media bucket the EC2 role already can read/write.

- [ ] **Step 2: Add a long-TTL cache behavior for Next's hashed assets** inside `aws_cloudfront_distribution.cf`, immediately after the `default_cache_behavior { ... }` block:

```hcl
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = "origin-ec2_box"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
    min_ttl     = 86400
    default_ttl = 604800
    max_ttl     = 31536000
  }
```

- [ ] **Step 3: Verify**

Run: `cd infra && terraform fmt && grep -c 's3-s3_assets\|/static/\*\|AllowCloudFrontOAC' budget.tf`
Expected: `0`.

- [ ] **Step 4: Commit**

```bash
git add infra/budget.tf
git commit -m "infra: serve Next assets via origin CDN, drop broken /static S3 path"
```

---

## Task 3: Add origin TLS wiring (EIP + origin record + Route53 IAM for DNS-01) to `infra/budget.tf`

Gives the box a stable address + `origin.<domain>` DNS name, and lets Caddy solve the Route53 DNS-01 challenge.

**Files:**
- Modify: `infra/budget.tf`

- [ ] **Step 1: Add the EIP + origin DNS record** (place after the `aws_instance.ec2_box` resource):

```hcl
# =============================================================================
# ORIGIN ADDRESS + DNS (CloudFront https-only origin)
# =============================================================================

resource "aws_eip" "ec2_box" {
  domain   = "vpc"
  instance = aws_instance.ec2_box.id
  tags     = { Name = "budget-ec2-box-eip" }
}

# origin.<domain> → the box; CloudFront's origin_domain points here and Caddy
# terminates TLS with a Let's Encrypt cert for this exact hostname.
resource "aws_route53_record" "origin" {
  zone_id = var.route53_zone_id
  name    = var.origin_domain
  type    = "A"
  ttl     = 60
  records = [aws_eip.ec2_box.public_ip]
}
```

- [ ] **Step 2: Grant the EC2 role scoped Route53 access for ACME DNS-01.** Add these two statements to the `Statement` array of `aws_iam_role_policy.ec2_box_inline`:

```hcl
      {
        Sid      = "Route53ACMEChange"
        Effect   = "Allow"
        Action   = "route53:ChangeResourceRecordSets"
        Resource = "arn:${local.partition}:route53:::hostedzone/${var.route53_zone_id}"
      },
      {
        Sid    = "Route53ACMERead"
        Effect = "Allow"
        Action = [
          "route53:ListResourceRecordSets",
          "route53:GetChange"
        ]
        Resource = "*"
      }
```

- [ ] **Step 3: Verify**

Run: `cd infra && terraform fmt && grep -c 'aws_eip.ec2_box\|Route53ACMEChange\|aws_route53_record. .origin' budget.tf`
Expected: non-zero (resources present); `terraform fmt` clean.

- [ ] **Step 4: Commit**

```bash
git add infra/budget.tf
git commit -m "infra: add EIP + origin DNS record + Route53 DNS-01 IAM for Caddy TLS"
```

---

## Task 4: Wire `user_data` + backup lifecycle into `infra/budget.tf`

**Files:**
- Modify: `infra/budget.tf`

- [ ] **Step 1: Attach the templated bootstrap** to `aws_instance.ec2_box`. Add these attributes inside the resource (after `iam_instance_profile`):

```hcl
  user_data_replace_on_change = true
  user_data = base64encode(templatefile("${path.module}/user_data.sh", {
    origin_domain = var.origin_domain
    secret_id     = aws_secretsmanager_secret.secrets.id
    aws_region    = var.aws_region
    backup_bucket = aws_s3_bucket.s3_backups.id
    media_bucket  = aws_s3_bucket.s3_assets.id
  }))
```

- [ ] **Step 2: Add a 14-day lifecycle rule** to the backups bucket (place after `aws_s3_bucket_versioning.s3_backups`):

```hcl
resource "aws_s3_bucket_lifecycle_configuration" "s3_backups" {
  bucket = aws_s3_bucket.s3_backups.id
  rule {
    id     = "expire-pgdumps-14d"
    status = "Enabled"
    filter { prefix = "pgdump/" }
    expiration { days = 14 }
    noncurrent_version_expiration { noncurrent_days = 14 }
  }
}
```

- [ ] **Step 3: Verify**

Run: `cd infra && terraform fmt && grep -c 'templatefile\|expire-pgdumps-14d' budget.tf`
Expected: non-zero; `fmt` clean. (Full `validate` runs in Task 9 once `user_data.sh` exists.)

- [ ] **Step 4: Commit**

```bash
git add infra/budget.tf
git commit -m "infra: template user_data into EC2 box + 14-day backup lifecycle"
```

---

## Task 5: Create `infra/scripts/pg-backup.sh` + systemd units

**Files:**
- Create: `infra/scripts/pg-backup.sh`
- Create: `infra/systemd/hhf-web.service`
- Create: `infra/systemd/hhf-backup.service`
- Create: `infra/systemd/hhf-backup.timer`

- [ ] **Step 1: Write `infra/scripts/pg-backup.sh`**

```bash
#!/usr/bin/env bash
# Nightly Postgres backup → S3. BACKUP_BUCKET is provided via /etc/happyhour/.env.
set -euo pipefail
set -a; . /etc/happyhour/.env; set +a
ts="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="$(mktemp /tmp/hhf-XXXX.dump)"
trap 'rm -f "$tmp"' EXIT
pg_dump -Fc -h localhost -U hhf hhf > "$tmp"
aws s3 cp "$tmp" "s3://${BACKUP_BUCKET}/pgdump/hhf-${ts}.dump"
echo "backup uploaded: s3://${BACKUP_BUCKET}/pgdump/hhf-${ts}.dump"
```

- [ ] **Step 2: Write `infra/systemd/hhf-web.service`**

```ini
[Unit]
Description=Happy Hour Friends web + pg-boss workers
After=network-online.target postgresql-17.service
Wants=network-online.target
Requires=postgresql-17.service

[Service]
Type=simple
User=hhf
WorkingDirectory=/opt/happyhourfriends
EnvironmentFile=/etc/happyhour/.env
ExecStart=/usr/bin/pnpm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Write `infra/systemd/hhf-backup.service`**

```ini
[Unit]
Description=Happy Hour Friends nightly pg_dump → S3
After=network-online.target postgresql-17.service

[Service]
Type=oneshot
User=hhf
ExecStart=/usr/local/bin/pg-backup.sh
```

- [ ] **Step 4: Write `infra/systemd/hhf-backup.timer`**

```ini
[Unit]
Description=Run hhf-backup nightly at 07:00 UTC

[Timer]
OnCalendar=*-*-* 07:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 5: Verify**

Run: `shellcheck infra/scripts/pg-backup.sh && echo OK`
Expected: `OK` (no findings).

- [ ] **Step 6: Commit**

```bash
git add infra/scripts/pg-backup.sh infra/systemd/
git commit -m "infra: on-box backup script + web/backup systemd units"
```

---

## Task 6: Create `infra/Caddyfile`

**Files:**
- Create: `infra/Caddyfile`

- [ ] **Step 1: Write `infra/Caddyfile`** (the `{$ORIGIN_DOMAIN}` and `{$ACME_EMAIL}` env vars are set by `hhf` at Caddy start via the systemd env; DNS-01 uses the instance-role AWS creds automatically):

```caddyfile
{
	email {$ACME_EMAIL}
}

{$ORIGIN_DOMAIN} {
	tls {
		dns route53 {
			max_retries 10
		}
	}
	encode zstd gzip
	reverse_proxy localhost:3000
}
```

- [ ] **Step 2: Verify** (syntax check only; requires a route53-enabled caddy binary, so this is a lint-level check the operator repeats on the box)

Run: `test -s infra/Caddyfile && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add infra/Caddyfile
git commit -m "infra: Caddy reverse-proxy config with Route53 DNS-01 TLS"
```

---

## Task 7: Create `infra/user_data.sh` (cloud-init bootstrap)

Idempotent bootstrap. Templated by Terraform (Task 4). Package names target AL2023's repos; the operator confirms they resolve during the first apply (runbook Task 10).

**Files:**
- Create: `infra/user_data.sh`

- [ ] **Step 1: Write `infra/user_data.sh`**

```bash
#!/usr/bin/env bash
# Templated by Terraform (templatefile): ${origin_domain} ${secret_id}
# ${aws_region} ${backup_bucket} ${media_bucket}
set -euo pipefail
exec > >(tee /var/log/hhf-bootstrap.log) 2>&1

APP_DIR=/opt/happyhourfriends
PG_BIN=/usr/bin
PG_DATA=/var/lib/pgsql/data
ENV_FILE=/etc/happyhour/.env

# --- 1. mount the Postgres EBS volume; format ONLY if blank -----------------
data_dev="$(lsblk -dpbno NAME,SIZE | awk '$2==53687091200 {print $1; exit}')"
: "${data_dev:?could not find 50GiB data volume}"
if ! blkid "$data_dev" >/dev/null 2>&1; then
  mkfs.xfs "$data_dev"
fi
mkdir -p /var/lib/pgsql
grep -q "$data_dev" /etc/fstab || echo "$data_dev /var/lib/pgsql xfs defaults,nofail 0 2" >> /etc/fstab
mount -a

# --- 2. packages ------------------------------------------------------------
dnf -y install postgresql17-server postgresql17-contrib postgis34_17 \
  nodejs20 git tar xz jq chromium unzip
corepack enable
corepack prepare pnpm@latest --activate
id hhf >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin hhf
chown -R postgres:postgres /var/lib/pgsql

# --- 3. postgres init (only on a fresh volume) ------------------------------
if [ ! -f "$PG_DATA/PG_VERSION" ]; then
  sudo -u postgres "$PG_BIN/initdb" -D "$PG_DATA"
fi
systemctl enable --now postgresql-17
until sudo -u postgres psql -c '\q' 2>/dev/null; do sleep 2; done
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='hhf'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE hhf LOGIN PASSWORD 'PLACEHOLDER_REPLACED_BELOW'"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='hhf'" | grep -q 1 || \
  sudo -u postgres createdb -O hhf hhf
sudo -u postgres psql -d hhf -c "CREATE EXTENSION IF NOT EXISTS postgis;"

# --- 4. secrets → /etc/happyhour/.env ---------------------------------------
mkdir -p /etc/happyhour
aws secretsmanager get-secret-value --secret-id "${secret_id}" \
  --region "${aws_region}" --query SecretString --output text > /etc/happyhour/secrets.json
# secrets.json is a flat JSON object of KEY: value pairs mirroring .env.example.
# Render it to a systemd EnvironmentFile, and append box-derived values.
jq -r 'to_entries[] | "\(.key)=\(.value)"' /etc/happyhour/secrets.json > "$ENV_FILE"
{
  echo "BACKUP_BUCKET=${backup_bucket}"
  echo "MEDIA_BUCKET=${media_bucket}"
  echo "ACME_EMAIL=ops@${origin_domain#origin.}"
  echo "ORIGIN_DOMAIN=${origin_domain}"
  echo "NODE_ENV=production"
} >> "$ENV_FILE"
# Sync the Postgres role password to the DATABASE_URL secret's password.
db_pw="$(jq -r '.PGPASSWORD // empty' /etc/happyhour/secrets.json)"
if [ -n "$db_pw" ]; then
  sudo -u postgres psql -c "ALTER ROLE hhf PASSWORD '$db_pw'"
fi
chown root:hhf /etc/happyhour/.env && chmod 640 /etc/happyhour/.env
rm -f /etc/happyhour/secrets.json

# --- 5. app deploy ----------------------------------------------------------
# DEPLOY_KEY is an ed25519 private key stored in the secret; used read-only.
install -d -o hhf -g hhf "$APP_DIR" /home/hhf/.ssh
jq -r '.DEPLOY_KEY' <(aws secretsmanager get-secret-value --secret-id "${secret_id}" \
  --region "${aws_region}" --query SecretString --output text) > /home/hhf/.ssh/id_ed25519
chown hhf:hhf /home/hhf/.ssh/id_ed25519 && chmod 600 /home/hhf/.ssh/id_ed25519
ssh-keyscan github.com >> /home/hhf/.ssh/known_hosts 2>/dev/null
sudo -u hhf git clone git@github.com:slmatthiesen/happyhourfriends.git "$APP_DIR" || \
  (cd "$APP_DIR" && sudo -u hhf git pull --ff-only)
cd "$APP_DIR"
sudo -u hhf --preserve-env=HOME env HOME=/home/hhf pnpm install --frozen-lockfile
sudo -u hhf --preserve-env=HOME env HOME=/home/hhf bash -c 'set -a; . /etc/happyhour/.env; set +a; pnpm build && pnpm db:migrate'

# --- 6. caddy (route53 DNS-01 build) ---------------------------------------
curl -fsSL -o /usr/bin/caddy \
  "https://caddyserver.com/api/download?os=linux&arch=arm64&p=github.com%2Fcaddy-dns%2Froute53"
chmod +x /usr/bin/caddy
install -d /etc/caddy
cp "$APP_DIR/infra/Caddyfile" /etc/caddy/Caddyfile

# --- 7. systemd units -------------------------------------------------------
cp "$APP_DIR/infra/systemd/hhf-web.service" /etc/systemd/system/
cp "$APP_DIR/infra/systemd/hhf-backup.service" /etc/systemd/system/
cp "$APP_DIR/infra/systemd/hhf-backup.timer" /etc/systemd/system/
install -m 0755 "$APP_DIR/infra/scripts/pg-backup.sh" /usr/local/bin/pg-backup.sh
# Caddy runs as hhf with the app env (ACME_EMAIL / ORIGIN_DOMAIN + AWS role creds).
cat >/etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
After=network-online.target
Wants=network-online.target
[Service]
User=hhf
EnvironmentFile=/etc/happyhour/.env
ExecStart=/usr/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
Restart=always
AmbientCapabilities=CAP_NET_BIND_SERVICE
[Install]
WantedBy=multi-user.target
UNIT
chown -R hhf:hhf "$APP_DIR"
systemctl daemon-reload
systemctl enable --now hhf-web.service caddy.service hhf-backup.timer
echo "bootstrap complete"
```

- [ ] **Step 2: Verify**

Run: `shellcheck -e SC2154 infra/user_data.sh && echo OK`
(`SC2154` is expected — `${origin_domain}` etc. are Terraform template vars, not shell vars.)
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add infra/user_data.sh
git commit -m "infra: EC2 cloud-init bootstrap (PG+PostGIS, app, Caddy, systemd)"
```

---

## Task 8: Create remote-state bootstrap + backend config

**Files:**
- Create: `infra/bootstrap/state.tf`
- Create: `infra/backend.tf`

- [ ] **Step 1: Write `infra/bootstrap/state.tf`** (its own root module, local state, applied once):

```hcl
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}
provider "aws" { region = var.region }

variable "region" { type = string, default = "us-east-1" }
variable "state_bucket_name" {
  type        = string
  description = "Globally-unique S3 bucket for Terraform state."
}
variable "lock_table_name" {
  type    = string
  default = "hhf-tf-locks"
}

resource "aws_s3_bucket" "state" {
  bucket = var.state_bucket_name
}
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_dynamodb_table" "locks" {
  name         = var.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"
  attribute {
    name = "LockID"
    type = "S"
  }
}

output "state_bucket" { value = aws_s3_bucket.state.id }
output "lock_table" { value = aws_dynamodb_table.locks.name }
```

- [ ] **Step 2: Write `infra/backend.tf`** (partial config; concrete values passed via `-backend-config` in the runbook so the bucket name stays out of git):

```hcl
terraform {
  backend "s3" {
    key     = "budget/terraform.tfstate"
    region  = "us-east-1"
    encrypt = true
    # bucket and dynamodb_table supplied via -backend-config at init time.
  }
}
```

- [ ] **Step 3: Verify**

Run: `cd infra/bootstrap && terraform init -backend=false && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 4: Commit**

```bash
git add infra/bootstrap/state.tf infra/backend.tf
git commit -m "infra: remote-state bootstrap (S3+DynamoDB) and backend config"
```

---

## Task 9: Create `infra/terraform.tfvars.example` + validate the full stack

**Files:**
- Create: `infra/terraform.tfvars.example`

- [ ] **Step 1: Write `infra/terraform.tfvars.example`**

```hcl
# Copy to terraform.tfvars and fill in. Do NOT commit terraform.tfvars.
aws_region      = "us-east-1"
ami_id          = "ami-REPLACE"                     # Amazon Linux 2023, arm64
domain_name     = "happyhourfriends.com"            # CloudFront viewer host
origin_domain   = "origin.happyhourfriends.com"     # EC2 origin host (Caddy cert)
route53_zone_id = "ZREPLACE"                         # Route53 hosted zone id
ops_email       = "steven.matthiesen@gmail.com"     # SNS ops alerts
```

- [ ] **Step 2: Validate the whole main stack** (downloads the AWS provider; no credentials or apply):

Run: `cd infra && terraform init -backend=false && terraform validate`
Expected: `Success! The configuration is valid.`
If validation reports an undefined reference or a removed resource still referenced, fix it in `budget.tf` and re-run.

- [ ] **Step 3: Commit**

```bash
git add infra/terraform.tfvars.example
git commit -m "infra: document required tfvars; validate full stack"
```

---

## Task 10: Write `docs/aws-go-live-runbook.md`

The operator-executed sequence. This is the end-to-end acceptance for the whole plan.

**Files:**
- Create: `docs/aws-go-live-runbook.md`

- [ ] **Step 1: Write `docs/aws-go-live-runbook.md`**

````markdown
# AWS Go-Live Runbook (Phase 1)

Operator-run. Nothing here is executed by Claude. Prereqs: AWS account with a billing
budget/alert, an Amazon Linux 2023 **arm64** AMI id, and a GitHub read-only deploy key.

## 0. Secrets (AWS Secrets Manager: `budget/secrets`)
Store a flat JSON object mirroring `.env.example`, plus: `PGPASSWORD` (the `hhf` DB
password, also embedded in `DATABASE_URL=postgres://hhf:<PGPASSWORD>@localhost:5432/hhf`)
and `DEPLOY_KEY` (ed25519 private key, read-only GitHub deploy key). Never commit these.

## 1. Remote state (once)
```
cd infra/bootstrap
terraform init
terraform apply -var state_bucket_name=hhf-tfstate-<uniqueid>
# note the state_bucket / lock_table outputs
```

## 2. Init main stack against the backend
```
cd infra
terraform init \
  -backend-config="bucket=hhf-tfstate-<uniqueid>" \
  -backend-config="dynamodb_table=hhf-tf-locks"
cp terraform.tfvars.example terraform.tfvars   # then edit
```

## 3. DNS migration Cloudflare → Route53 (before cutover)
1. In Route53, create/confirm the hosted zone for `happyhourfriends.com`; note its zone id
   → `route53_zone_id` in `terraform.tfvars`.
2. **Copy every Cloudflare record into Route53** — especially email: Resend's
   `friend.happyhourfriends.com` records (CNAME/DKIM), plus MX / SPF / DMARC / verification
   TXT. Missing these breaks email.
3. Lower Cloudflare record TTLs (e.g. 300s) a day ahead.
4. Do NOT change nameservers yet — the apex still serves the droplet until cutover (§6).

## 4. Apply the stack
```
terraform plan -out tf.plan     # review: EC2, EBS, EIP, CloudFront+WAF, ACM, Route53
terraform apply tf.plan
```
ACM DNS validation and the CloudFront distribution can take 15–40 min. The box boots and
runs `user_data.sh`; watch `/var/log/hhf-bootstrap.log` via SSM Session Manager.

## 5. Verify the new stack (before touching prod DNS)
- SSM into the box: `systemctl status hhf-web caddy postgresql-17 hhf-backup.timer`.
- Caddy obtained a cert: `journalctl -u caddy | grep -i certificate`.
- Direct origin check: `curl -I https://origin.happyhourfriends.com` → `200`.
- CloudFront check: `curl -I https://<distribution>.cloudfront.net` → `200`, app HTML.
- WAF: confirm sampled requests in the `budget-cf-waf` CloudWatch metrics.

## 6. Data cutover (maintenance window, ~15–30 min)
1. Put the droplet app in read-only / stop writes (pause pg-boss / stop the web unit).
2. On the droplet: `pg_dump -Fc <droplet-db> > hhf.dump`.
3. Copy to the box (S3 or scp-via-SSM); restore:
   `pg_restore --no-owner --role=hhf -d hhf hhf.dump`.
4. Verify row counts match the droplet:
   `psql -d hhf -c "SELECT 'venues',count(*) FROM venues UNION ALL SELECT 'happy_hours',count(*) FROM happy_hours UNION ALL SELECT 'offerings',count(*) FROM offerings UNION ALL SELECT 'cities',count(*) FROM cities UNION ALL SELECT 'submissions',count(*) FROM edit_submissions;"`
5. Restart `hhf-web` on the box; smoke-test through CloudFront.
6. **Flip DNS:** change the registrar nameservers to the Route53 NS set (the `terraform`
   apex A/AAAA alias already points at CloudFront). Watch propagation.

## 7. Smoke test (through the live domain)
- `https://happyhourfriends.com` loads; a city page renders; `/admin` gates.
- Submit a test change → confirm a pg-boss job runs (`journalctl -u hhf-web`).
- Send a test email path → confirm Resend still delivers (DNS records carried over).

## 8. Rollback
DNS-based and fast: revert the registrar nameservers back to Cloudflare (or, if still on
Cloudflare NS, you never cut over — just don't flip). The droplet is untouched and still
holds the pre-cutover data. Investigate, then retry.

## 9. Decommission (only after several stable days)
Stop the droplet; keep its final backup. Cancel Cloudflare once Route53 is confirmed
authoritative and email is verified working.
````

- [ ] **Step 2: Verify**

Run: `test -s docs/aws-go-live-runbook.md && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add docs/aws-go-live-runbook.md
git commit -m "docs: AWS go-live runbook (state, DNS migration, cutover, rollback)"
```

---

## Task 11: Final validation + open PR

- [ ] **Step 1: Full static validation**

Run:
```
cd infra && terraform fmt -check -recursive && terraform init -backend=false && terraform validate
shellcheck -e SC2154 user_data.sh scripts/pg-backup.sh
```
Expected: `fmt` clean, `validate` success, `shellcheck` no findings.

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin infra/aws-budget-trimmed
gh pr create --title "AWS go-live phase 1 (trimmed budget infra + bootstrap + runbook)" \
  --body "Implements docs/superpowers/specs/2026-06-30-aws-go-live-design.md. Reference infra only — operator runs terraform + cutover per docs/aws-go-live-runbook.md."
```

- [ ] **Step 3: Report** the PR URL and remind the operator that apply + cutover are theirs to run.

---

## Self-Review coverage

- Spec "corrections" → Tasks 2 (`/static`) and 3 (origin TLS). ✅
- Spec "phase-1 simplification" (drop 3 Lambdas + scheduler, on-box backup) → Tasks 1, 4, 5. ✅
- Spec gaps: state backend → Task 8; user_data bootstrap → Task 7; secrets inventory → runbook §0; cutover/rollback → Task 10; DNS migration → Task 10 §3. ✅
- Spec deliverables list → Tasks 1–10 produce every file. ✅
- Non-goals (render Lambda, RDS) → correctly absent. ✅
