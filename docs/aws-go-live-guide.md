# AWS Go-Live Guide — start here (beginner-friendly, self-contained)

This is the single walkthrough to move Happy Hour Friends off the DigitalOcean droplet
onto AWS. It assumes **no prior AWS experience**. Follow it top to bottom. If anything
errors, stop and paste the error into the session — don't push past it.

The concise operator version of the deploy commands lives in `aws-go-live-runbook.md`; this
guide is the fuller, explain-everything version and is the one to follow for your first time.

---

## The safety model (read this first)

**Your live site is never at risk until the very last step.** Everything is built and tested
on a temporary AWS URL first. Your real domain (`happyhourfriends.com`) keeps pointing at
Cloudflare + the droplet the entire time. Only the final DNS step moves traffic to AWS, and
undoing it is just "change DNS back." **Keep the droplet running and untouched until you've
been live on AWS and happy for several days.**

**What you're building:** one small Ubuntu server (EC2 `t4g.medium`) that runs the Next.js
app, the pg-boss job workers, and PostgreSQL 17 + PostGIS — the same pieces as your droplet,
now behind AWS's CDN (CloudFront) and firewall (WAF). Rough cost: ~$35–55/month.

**Before you start, know:** the server installs whatever is on the `main` branch and runs
`pnpm build`. Make sure `main` builds green before you begin (`pnpm build` locally).

---

## Stage 1 — AWS account + tools (one-time, ~30 min)

You need: (a) an AWS account, (b) a credential your computer can use, (c) two CLI tools.

### 1.1 Create an AWS account
1. Go to https://aws.amazon.com → **Create an AWS Account**. You'll need an email, a credit
   card, and a phone number. Choose the **Basic (free)** support plan.
2. Once in, **set a billing alert** so costs can't surprise you: search **Billing and Cost
   Management** → **Budgets** → **Create budget** → template **Monthly cost budget** → set
   e.g. **$75** with an email alert at 80%. Do this now; it takes 2 minutes.

### 1.2 Create a login credential for your computer (IAM user + access keys)
The simplest path for a solo deploy (AWS also offers Identity Center/SSO; you don't need it):
1. Search **IAM** → **Users** → **Create user**. Name it `deployer`. Do **not** give console
   access (this is for the CLI only).
2. **Permissions** → **Attach policies directly** → check **AdministratorAccess** → create.
   (Broad, but fine for a solo owner running Terraform. You can tighten later.)
3. Open the new `deployer` user → **Security credentials** → **Create access key** → choose
   **Command Line Interface (CLI)** → create. You'll get an **Access key ID** and a **Secret
   access key**. Copy both now — the secret is shown only once. Treat them like a password.

### 1.3 Install the tools (on your Mac)
```
brew install terraform awscli
terraform -version    # expect >= 1.6
aws --version         # expect aws-cli/2.x
```

### 1.4 Connect the CLI to your account
```
aws configure
# AWS Access Key ID:      <paste the Access key ID>
# AWS Secret Access Key:  <paste the Secret access key>
# Default region name:    us-east-1
# Default output format:  json

aws sts get-caller-identity   # should print your account id + the deployer user ARN
```
If `get-caller-identity` prints your account, Stage 1 is done. ✅

---

## Stage 2 — prep the inputs (~20 min)

### 2.1 GitHub deploy key (so the server can pull the private repo)
On your Mac:
```
ssh-keygen -t ed25519 -C "hhf-ec2-deploy" -f ~/hhf_deploy_key -N ""
cat ~/hhf_deploy_key.pub
```
- Copy the printed **public** key → GitHub repo **Settings → Deploy keys → Add deploy key**
  → paste, leave **Allow write access UNchecked** (read-only) → add.
- Keep the **private** key (`~/hhf_deploy_key`) — its contents go into the secret below as
  `DEPLOY_KEY`.

### 2.2 Find an Ubuntu 24.04 arm64 AMI id (for your region)
```
aws ec2 describe-images --owners 099720109477 --region us-east-1 \
  --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*" \
  --query "reverse(sort_by(Images,&CreationDate))[0].ImageId" --output text
```
That prints an `ami-...` id. Save it — it goes in `terraform.tfvars` as `ami_id`.

### 2.3 Route53 hosted zone
1. AWS console → **Route 53** → **Hosted zones** → **Create hosted zone** for
   `happyhourfriends.com` (type **Public**).
2. Note the **Hosted zone ID** (looks like `Z0123...`) → it goes in `terraform.tfvars` as
   `route53_zone_id`.
3. **Do NOT change your domain's nameservers yet.** Creating the zone changes nothing live;
   we only switch nameservers at the very end (Stage 4).

### 2.4 The application secret (values only — you store it in Stage 3)
You'll create one secret in AWS holding a flat JSON object. It must contain **every key from
`.env.example`**, plus these three:
- `PGPASSWORD` — invent a strong password for the database user.
- `DATABASE_URL` = `postgres://hhf:<PGPASSWORD>@localhost:5432/hhf` (same password as above).
- `DEPLOY_KEY` — the **entire** contents of `~/hhf_deploy_key` (the private key, multi-line).

Keep this JSON ready in a text editor; you'll paste it in Stage 3.4.

---

## Stage 3 — build it on AWS (test URL only; nothing live changes)

All commands run from the repo root on your Mac.

### 3.1 Create the Terraform state storage (one-time)
```
cd infra/bootstrap
terraform init
terraform apply -var state_bucket_name=hhf-tfstate-<pick-something-unique>
# type "yes" when prompted; note the state_bucket / lock_table it prints
```

### 3.2 Point the main stack at that storage
```
cd ..            # now in infra/
terraform init \
  -backend-config="bucket=hhf-tfstate-<the same unique name>" \
  -backend-config="dynamodb_table=hhf-tf-locks"
```

### 3.3 Fill in your values
```
cp terraform.tfvars.example terraform.tfvars
```
Edit `terraform.tfvars`: set `ami_id` (Stage 2.2), `route53_zone_id` (Stage 2.3). The other
values (region, domain, origin, ops_email) are already sensible defaults — confirm them.

### 3.4 Store the secret
Search **Secrets Manager** → **Store a new secret** → **Other type of secret** → **Plaintext**
tab → paste your JSON object from Stage 2.4 → **Next** → name it exactly `budget/secrets` →
finish. (Terraform also creates this name; if it complains the secret exists, that's fine —
it will not overwrite your values.)

### 3.5 Build
```
terraform plan -out tf.plan     # review what it will create (EC2, EBS, CloudFront, etc.)
terraform apply tf.plan         # type "yes"
```
This takes **15–40 minutes** (CloudFront + the TLS certificate are slow). When it finishes,
the server boots and installs everything. **The first boot needs the real secret** — you
already stored it in 3.4, so it should come up clean.

### 3.6 Watch the server come up
In the AWS console → **EC2** → **Instances** → select `budget-ec2-box` → **Connect** →
**Session Manager** → **Connect**. Then:
```
sudo tail -f /var/log/hhf-bootstrap.log     # watch it finish; look for "bootstrap complete"
systemctl status hhf-web caddy postgresql hhf-backup.timer   # all should be active/running
```
If bootstrap failed, paste the tail of that log into the session and we'll fix it.

### 3.7 Verify on the AWS test URL (still nothing live)
- In the console → **CloudFront** → your distribution → copy its **Distribution domain name**
  (`d xxxx.cloudfront.net`).
- `curl -I https://dxxxx.cloudfront.net` → expect `HTTP/2 200`. Open it in a browser: the
  site should load and a city page should render. `/admin` should show the login gate.

If the test URL serves the app, the hard part is done. ✅ **Your real domain still points at
Cloudflare — nothing user-facing has changed.**

---

## Stage 4 — go live (the only step that touches your real domain)

### 4.1 Copy DNS records Cloudflare → Route53 (do this carefully — email depends on it)
In Route53's hosted zone, recreate **every** record that exists in your Cloudflare DNS,
especially the **email** ones or email breaks:
- Resend's records for `friend.happyhourfriends.com` (the DKIM/CNAME/verification records).
- Any `MX`, `SPF` (TXT), `DMARC` (TXT), and other TXT verification records.
- Any subdomains you use.
The apex `happyhourfriends.com` A/AAAA records are already created by Terraform (pointing at
CloudFront) — you don't recreate those.

### 4.2 Move the data (short maintenance window, ~15–30 min)
1. On the **droplet**, stop writes (stop the app / pause the workers) so no new data lands.
2. On the droplet: `pg_dump -Fc <your-droplet-db> > hhf.dump`.
3. Copy `hhf.dump` to the AWS box (via Session Manager file transfer or an S3 bucket) and
   restore: `pg_restore --no-owner --role=hhf -d hhf hhf.dump`.
4. Verify counts match (run on both, compare):
   `psql -d hhf -c "SELECT 'venues',count(*) FROM venues UNION ALL SELECT 'happy_hours',count(*) FROM happy_hours UNION ALL SELECT 'offerings',count(*) FROM offerings;"`
5. Restart the AWS app: `sudo systemctl restart hhf-web`. Re-check the CloudFront test URL.

### 4.3 Flip the domain to AWS
At your **domain registrar** (where you bought the domain), change the nameservers to the
four Route53 nameservers shown in your hosted zone (the `NS` record). Save. Propagation
usually takes minutes but can take longer.

### 4.4 Smoke-test the live domain
- `https://happyhourfriends.com` loads; a city page renders; `/admin` gates.
- Submit a test change and confirm it processes (`journalctl -u hhf-web` on the box).
- Check email still works, and that Resend shows the domain **verified** in its dashboard.

---

## If something goes wrong — rollback
- **Before Stage 4.3:** nothing to undo — the live domain never moved. Just fix the AWS box.
- **After Stage 4.3:** change the nameservers at your registrar **back to Cloudflare's**.
  Traffic returns to the droplet (which is untouched and still holds the pre-cutover data).
  DNS changes aren't instant, so keep the droplet running for several days as your safety net.

## Where to look when debugging (via EC2 → Session Manager)
- Bootstrap: `sudo cat /var/log/hhf-bootstrap.log`
- Services: `systemctl status hhf-web` / `caddy` / `postgresql`
- App logs: `journalctl -u hhf-web -n 100 --no-pager`
- TLS cert: `journalctl -u caddy | grep -i certificate`
- To re-run bootstrap after fixing the secret: `sudo cloud-init clean --logs && sudo reboot`

## Decommission the droplet (only after several stable days on AWS)
Take one final droplet backup, then stop it. Cancel Cloudflare once Route53 is confirmed
authoritative and email is verified working.

---

### Reference
- Design + decisions: `docs/superpowers/specs/2026-06-30-aws-go-live-design.md`
- Task-by-task build log: `docs/superpowers/plans/2026-06-30-aws-go-live.md`
- Terraform + scripts: `infra/`
