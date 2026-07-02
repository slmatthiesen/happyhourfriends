# AWS Post-Go-Live — Cleanup & Data-Sync Plan

## Context

`happyhourfriends.com` went live on AWS on **2026-07-02** (EC2 box `budget-ec2-box`,
self-managed PG17/PostGIS, CloudFront + WAF, Route53 DNS, Caddy prod LE cert). Data was
migrated from the DigitalOcean droplet (3935 venues / 3661 happy_hours / 10407 offerings).

The go-live required a scramble of on-the-fly fixes; this plan closes the loose ends. Do them
in order — **email first** (highest risk of silent breakage), then re-establish data sync (so
the site stays operable), then cleanup, then decommission the droplet last (it's the rollback).

Key facts:
- Route53 zone: `Z08777672RX5TKLQOU59Q`. Box instance: look up by tag, don't hardcode (a
  terraform rebuild changes the id): `aws ec2 describe-instances --filters
  "Name=tag:Name,Values=budget-ec2-box" "Name=instance-state-name,Values=running"
  --query "Reservations[].Instances[].InstanceId" --output text`.
- Box Postgres is **localhost-only** (`hhf`@`localhost:5432`, db `hhf`). No public PG, no SSH
  (SSM only). PGPASSWORD lives in Secrets Manager `budget/secrets`.
- All AWS CLI uses profile `hhfriends-deployer` (us-east-1).

---

## 1. Email (PRIORITY) — verify/restore Resend outbound

**Problem:** The Cloudflare zone we migrated had **no `friend.happyhourfriends.com` / Resend
records at all** — only Cloudflare Email Routing (inbound: MX→`*.mx.cloudflare.net`, the
`cf2024-1._domainkey` DKIM, SPF `include:_spf.mx.cloudflare.net`). So Resend **outbound**
sending (the app sends via `friend.happyhourfriends.com`, per project memory) is either
unverified/broken already, or was configured somewhere that didn't survive. This must be
confirmed — transactional email (contribution acks, etc.) may be silently failing.

Steps:
1. Resend dashboard → **Domains** → check `friend.happyhourfriends.com` status. If it's not
   "Verified", it needs DNS records.
2. Copy Resend's required records (typically: a `resend._domainkey` / `send._domainkey` **TXT**
   or **CNAME** for DKIM, an SPF **TXT** on the sending subdomain `include:amazonses.com` or
   Resend's, and a **MX** for the sending subdomain) into Route53 zone `Z08777672RX5TKLQOU59Q`.
   (Same pattern as the go-live DNS copy — UPSERT change-batch via
   `aws route53 change-resource-record-sets`.)
3. Click **Verify** in Resend; wait for green.
4. **Test:** trigger a real send (submit a contribution / whatever path emails the user) and
   confirm delivery + that Resend shows the message as delivered, not bounced.
5. Confirm **inbound** still works too — the Cloudflare Email Routing MX we copied into Route53
   only keeps working while the Cloudflare Email Routing service stays active on that account.
   If you want to leave Cloudflare entirely, inbound forwarding must move to another provider.

Verify (done when): Resend domain shows Verified; a test email lands; no SPF/DKIM/DMARC
failures in the message headers.

---

## 2. Data sync: local ↔ AWS (rework `with-prod-tunnel.sh` for SSM)

**Problem:** `scripts/sync/with-prod-tunnel.sh` opens an **SSH** tunnel to the droplet
(`ssh -L … root@$PROD_IP`) and reads prod's `.env` over SSH. The AWS box has **no SSH** and PG
is localhost-only, so `pull:data` / `push:data` are broken against AWS.

**Approach:** replace the SSH tunnel with an **SSM port-forwarding** session to the box's
`localhost:5432`. Everything downstream (`db-sync.ts`) is unchanged — it just needs a
`PROD_DATABASE_URL` pointing at the forwarded local port. Prod creds never touch local disk
(pulled live from Secrets Manager, mirroring the old script's principle).

New helper `scripts/sync/with-aws-tunnel.sh` (mirrors the old one):
```bash
IID=$(aws ssm ... describe-instances by tag budget-ec2-box ...)          # resolve box
PGPASSWORD=$(aws secretsmanager get-secret-value --secret-id budget/secrets \
  --query SecretString --output text | jq -r .PGPASSWORD)                # never stored
LOCAL_PORT=6543
# open the SSM port-forward in the background, wait for it to bind:
aws ssm start-session --target "$IID" \
  --document-name AWS-StartPortForwardingSession \
  --parameters "portNumber=5432,localPortNumber=$LOCAL_PORT" &            # + trap to kill on EXIT
PROD_DATABASE_URL="postgres://hhf:${PGPASSWORD}@127.0.0.1:${LOCAL_PORT}/hhf"
DATABASE_URL="$DATABASE_URL" PROD_DATABASE_URL="$PROD_DATABASE_URL" \
  ./node_modules/.bin/tsx scripts/sync/db-sync.ts "$direction" "$@"
```
- Requires the `session-manager-plugin` (already installed).
- Add `pull:data` / `push:data` variants (or a `SYNC_TARGET=aws|droplet` switch) in
  `package.json`; keep the droplet path until the droplet is decommissioned.
- **Cache revalidation:** the old `refresh_prod_cache()` SSHes the droplet to hit its internal
  `/api/internal/revalidate`. Rework to either (a) `curl` the box's endpoint through the same
  SSM forward (forward port 3000 too), or (b) POST to the public
  `https://happyhourfriends.com/api/internal/revalidate` with `x-revalidate-secret`
  (`REVALIDATE_SECRET` from the secret). Option (b) is simpler.
- **Data posture (unchanged, per project rules):** prod is source of truth for **USER** data
  (additive/bridge pushes only, never a full overwrite); LOCAL is source for **seed/curation**.

- **After any restore of a prod/droplet dump onto the box, immediately re-run
  `npm run db:migrate`** — a dump carries the *source's* schema; if the source is behind
  `main`, pages that query newer columns 500. This bit us at go-live: venue pages 500'd on
  missing `offerings.discount_cents` / `discount_percent` / `location_restriction` until the
  migration was re-applied (city pages were fine — they don't touch those columns).

Verify (done when): `pnpm pull:data` and an additive `pnpm push:data --apply` both complete
against the AWS box, row counts reconcile, and a pushed change shows on the live site after
revalidation.

---

## 3. Cleanup

1. **Commit the go-live infra fixes as a PR** (currently uncommitted in the working tree).
   Branch off `origin/main`. Files + fixes in `infra/`:
   - `budget.tf`: IAM `Sid`s → alphanumeric; data EBS volume 50→20GB; added
     `route53:ListHostedZones`/`ListHostedZonesByName`; `default_root_object` → `""`.
   - `user_data.sh`: robust non-root-disk volume detector + attach wait-loop; `pnpm`→`npm`
     (pnpm-lock is gitignored, package-lock is canonical); split playwright
     `install-deps` (root) vs `install` (hhf); pipefail-safe detector.
   - `Caddyfile`: `resolvers 8.8.8.8 1.1.1.1` for the ACME DNS-01 propagation check.
   - Also worth adding in the same PR: terraform `output`s for `cloudfront_domain` +
     `instance_id`; pin the secret's `kms_key_id` so KMS drift can't recur.
2. **Delete stray junk** (untracked duplicates that broke root-level terraform):
   `rm "budget (1).tf" "budget (2).tf" docs/budget.tf`.
3. **Delete the migration dump** (full copy of prod data):
   `aws s3 rm s3://budget-s3-assets-20260701231702706400000003/migrate/hhf.dump`,
   `rm ~/hhf.dump`, and `/tmp/hhf.dump` on the box.
4. **Reconcile box drift:** several bootstrap fixes were applied to the running box by hand
   (re-run bootstrap script; Caddyfile edited in place). Once the PR (#1) is merged, run a
   **full `terraform apply`** to rebuild the instance from the corrected `user_data` so the box
   matches source. NOTE: this **replaces the instance** and re-runs bootstrap (data volume
   persists; app rebuilds; brief downtime) — do it in a deliberate window and verify it comes
   up (services active, cert, site 200), not casually.
5. **`/admin`:** add `FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY`
   (+ `ADMIN_EMAIL`) to `budget/secrets` and reboot the box if you want prod `/admin` login
   (runtime vars, no rebuild). Otherwise keep moderating via the local bridge.

Verify (done when): PR merged + green; junk gone; dump removed; box rebuilt from clean
`user_data` and verified live.

---

## 4. Decommission the droplet (LAST — only after several stable days on AWS)

Keep the droplet running untouched as the rollback (revert registrar NS to Cloudflare) for
~3–5 days. Then: take a final droplet backup, stop it, and cancel Cloudflare once Route53 is
confirmed authoritative and email is verified working.

---

## Suggested order
Email (§1) → data-sync helper (§2) → PR + junk + dump (§3.1–3.3) → box rebuild (§3.4) →
droplet decommission (§4). §3.5 (Firebase) whenever you want prod admin.
