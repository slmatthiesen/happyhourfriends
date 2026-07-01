# AWS Go-Live — Design (Phase 1)

**Date:** 2026-06-30
**Branch:** `infra/aws-budget-trimmed`
**Status:** Approved-pending-review

## Goal

Move Happy Hour Friends off the self-hosted DigitalOcean droplet onto AWS, using the
trimmed budget-tier Terraform (`infra/budget.tf`) as the base. Get the live site serving
from AWS through CloudFront + WAF with a short, reversible maintenance-window cutover.

This is **phase 1**: a single EC2 box that does everything the droplet does today, plus a
CDN/WAF edge. Render-Lambda split and managed RDS are explicit **phase-2** upgrades, out of
scope here.

## Decisions (locked with operator)

| Question | Decision |
|---|---|
| Database | **Self-managed Postgres 17 + PostGIS on the EC2 box** (data on the dedicated 50 GB EBS volume). RDS is a future upgrade. |
| Data cutover | **Short maintenance window** (~15–30 min): freeze writes → `pg_dump` → restore → flip DNS. |
| Renderer | **Stays in-process on the box** for go-live (`lib/verification/renderUrl`). Split into the scale-to-zero render Lambda in phase 2. |
| Origin TLS | **Caddy + Let's Encrypt via Route53 DNS-01** challenge. ~$0/mo, no inbound needed for issuance, SG stays locked to the CloudFront prefix list. |
| Backups | **On-box `pg_dump` → S3 via a systemd timer** (mirrors the droplet's nightly 14-day cron). Replaces the backup Lambda. |
| Who applies | Operator runs `terraform apply` and the cutover. Claude produces all artifacts + runbook and never touches the prod AWS account (per the non-negotiable prod-deploy rule). |

## Architecture (phase 1)

```
            apex A/AAAA alias
Viewer ──▶ CloudFront (PriceClass_100, http2and3)
            │  + WAFv2 (AWS Common + KnownBadInputs + 2000/IP rate limit)
            │  viewer cert: ACM (us-east-1) for happyhourfriends.com
            ▼  origin: https-only → origin.happyhourfriends.com
          Elastic IP ─▶ EC2 t4g.medium (AL2023, arm64), SG ingress = CloudFront prefix list only
            ├─ Caddy        : terminates TLS (LE cert for origin.<domain>, DNS-01), reverse-proxy → :3000
            ├─ Next.js      : `next start` (web + ISR), :3000
            ├─ pg-boss      : AI pipeline jobs (in-process / sibling process)
            ├─ PostgreSQL17 : + PostGIS, data dir on /dev/sdf EBS volume (mounted)
            ├─ Chromium     : in-process rendering deps
            └─ backup timer : nightly pg_dump → S3 (14-day lifecycle)
          SSM Session Manager for shell access (no SSH, IMDSv2 required)
          CloudTrail (single-region) · CloudWatch logs + EC2 CPU alarm → SNS email
```

## Corrections to the current `infra/budget.tf`

These are bugs/mismatches in the generated file that must be fixed before it can build a
working site:

1. **Origin TLS path is incomplete.** The CloudFront origin is `https-only` but the file
   creates no stable address, DNS name, or origin cert. **Add:** `aws_eip` + association,
   `aws_route53_record` for `origin.<domain>` → EIP, and a scoped Route53 IAM grant on the
   EC2 instance role so Caddy can solve the DNS-01 challenge for the hosted zone.

2. **`/static/*` → S3 assets behavior is wrong for Next.js.** Next serves hashed assets
   from `/_next/static/*`, and nothing populates the S3 assets bucket, so that ordered
   behavior would 404. **Fix:** serve assets from the origin through CloudFront (add a
   cache behavior for `/_next/static/*` with long TTL + immutable; the default behavior
   already covers the rest), and **remove** the S3-assets origin, its OAC, and the
   `/static/*` behavior. A private S3 media bucket for user uploads is retained but not
   fronted by CloudFront (low priority).

## Phase-1 simplification (remove dead infra)

Because rendering, jobs, backups, and Postgres all run on the box, the following are unused
at go-live and are **removed from phase-1** (re-added in phase 2 with the render split):

- `aws_lambda_function.render_lambda` + its IAM role/policy + `s3_renders` bucket + render
  error alarm + the `Invoke_render_lambda` grant on the EC2 role.
- `aws_lambda_function.cron_lambda` (reconciliation) + IAM — reconciliation runs on-box via
  pg-boss/cron.
- `aws_lambda_function.backup_lambda` + IAM — replaced by the on-box backup timer.
- `aws_scheduler_*` (EventBridge) + the two scheduler IAM/permissions + the two Lambda error
  alarms.

**Phase-1 stack after trim:** VPC/subnet/IGW/route table; EC2 + EBS + EIP; SG; instance role
(S3 media + Secrets + Route53-for-ACME + CloudWatch logs); CloudFront + WAF + ACM viewer cert
+ Route53 (apex alias, cert validation, origin record); S3 buckets (backups, media, cf_logs,
cloudtrail); Secrets Manager; SNS + EC2 CPU alarm; CloudTrail; CloudWatch log group.

## Operational gaps → resolution (dependency order)

1. **Terraform remote state backend** — create an S3 state bucket + DynamoDB lock table
   (tiny separate bootstrap, applied once with local state, then `backend "s3"` configured).
   Deliverable: `infra/backend.tf` + a one-time bootstrap note in the runbook.

2. **EC2 `user_data` bootstrap** (`infra/user_data.sh`, cloud-init) — idempotent:
   - Mount the Postgres EBS volume at the PG data dir; **format only if blank** (guard against
     wiping data on reboot/replace).
   - Install PG17 + PostGIS, Node 20, Caddy, Chromium + fonts, the AWS CLI / CloudWatch agent.
   - Pull secrets from Secrets Manager → write `.env` (or app reads SM directly).
   - Deploy the app (git clone + `pnpm build`, or a prebuilt artifact), run `pnpm db:migrate`.
   - Install systemd units: `next`, `caddy`, (pg-boss if separate), and the `pg_dump` backup
     timer. Caddy config provisions the LE cert for `origin.<domain>` via DNS-01.

3. **Secrets inventory** — populate `budget/secrets` from `.env.example`: `DATABASE_URL`,
   `ANTHROPIC_API_KEY`, Firebase admin creds, `NEXT_PUBLIC_*` (PostHog, Turnstile),
   `RESEND_*`, `JINA_API_KEY`, etc. Injected out-of-band; never committed.

4. **Data cutover runbook** (`docs/aws-go-live-runbook.md`) — the maintenance window:
   freeze droplet writes → `pg_dump -Fc` (with PostGIS) → restore to EC2 PG → verify row
   counts/spot-checks against the droplet → flip apex DNS to CloudFront → smoke-test.

5. **Rollback** — DNS revert: apex back to the droplet (droplet stays running and untouched
   until go-live is confirmed stable). Because the cutover is dump→restore (not destructive
   to the droplet) and DNS-based, rollback is fast and low-risk.

## Prerequisites to confirm (operator)

- **DNS migration Cloudflare → Route53 (confirmed).** The apex is currently fronted by
  **Cloudflare** (DNS + proxy + Universal SSL). Operator confirmed migrating is fine (low
  traffic). This design **replaces** Cloudflare with **CloudFront + WAF** as the edge; the
  anti-scrape role moves to the WAF rate-limit + managed rules. Migration steps (in the
  runbook), done **before** the app cutover:
  1. Create the Route53 hosted zone for `happyhourfriends.com`.
  2. **Copy every existing Cloudflare record into Route53** — especially email:
     Resend's `friend.happyhourfriends.com` records (CNAME/DKIM), plus any MX / SPF /
     DMARC / verification TXT. Missing these silently breaks email.
  3. Lower TTLs at Cloudflare ahead of time; change nameservers at the registrar to the
     Route53 NS set; wait for propagation before the apex is served by CloudFront.
  4. Turn off the Cloudflare proxy (grey-cloud) / retire the zone once Route53 is
     authoritative. Note: this exposes the origin EIP — the SG (CloudFront-prefix-list-only
     ingress) is what keeps the box locked down post-migration.
- AWS account ready with a billing budget/alert set (the `.tf` header warns about this).
- An Amazon Linux 2023 **arm64** AMI id for `var.ami_id`.

## Deliverables (what Claude produces on the branch)

1. `infra/budget.tf` — corrected + trimmed per above.
2. `infra/backend.tf` — remote state (S3 + DynamoDB).
3. `infra/user_data.sh` — bootstrap.
4. `infra/Caddyfile` + systemd unit files (or inlined in user_data).
5. `infra/terraform.tfvars.example` — all required vars documented.
6. `docs/aws-go-live-runbook.md` — apply order, cutover, smoke tests, rollback.

The operator runs `terraform init/plan/apply` and the cutover; Claude does not run them
against the prod AWS account.

## Success criteria (verifiable)

- `terraform validate` passes; `terraform plan` is clean and creates only the intended
  phase-1 resources.
- On a first apply, the box boots, Caddy obtains a valid `origin.<domain>` cert, and
  CloudFront serves the app over HTTPS with a valid viewer cert.
- Restored DB row counts (venues, happy_hours, offerings, cities, neighborhoods, submissions)
  match the droplet within the freeze window.
- WAF rate-limit + managed rules are active (sampled requests visible in CloudWatch).
- Rollback rehearsed: flipping apex DNS back to the droplet restores the old site.

## Non-goals (phase 2+)

- Splitting the renderer into the Lambda (scale-to-zero, S3-by-reference output).
- Migrating to RDS PostgreSQL + PostGIS (managed backups/PITR/patching).
- Moving CloudTrail to a separate account-level stack.
- Multi-AZ / HA, autoscaling, or zero-downtime cutover.
- Image/media pipeline work (back-burner).
