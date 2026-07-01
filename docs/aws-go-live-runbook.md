# AWS Go-Live Runbook (Phase 1)

Operator-run. Nothing here is executed by Claude. Prereqs: AWS account with a billing
budget/alert, an Ubuntu 24.04 LTS **arm64** AMI id, and a GitHub read-only deploy key.

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

## 3. DNS migration Cloudflare -> Route53 (before cutover)
1. In Route53, create/confirm the hosted zone for `happyhourfriends.com`; note its zone id
   -> `route53_zone_id` in `terraform.tfvars`.
2. **Copy every Cloudflare record into Route53** — especially email: Resend's
   `friend.happyhourfriends.com` records (CNAME/DKIM), plus MX / SPF / DMARC / verification
   TXT. Missing these breaks email.
3. Lower Cloudflare record TTLs (e.g. 300s) a day ahead.
4. Do NOT change nameservers yet — the apex still serves the droplet until cutover (section 6).

## 4. Apply the stack
```
terraform plan -out tf.plan     # review: EC2, EBS, EIP, CloudFront+WAF, ACM, Route53
terraform apply tf.plan
```
ACM DNS validation and the CloudFront distribution can take 15-40 min. The box boots and
runs `user_data.sh`; watch `/var/log/hhf-bootstrap.log` via SSM Session Manager.

IMPORTANT (secret ordering): `terraform apply` creates the `budget/secrets` container
with placeholder values, so the instance's first bootstrap will FAIL to clone/start
(expected). After apply completes: (1) populate `budget/secrets` in Secrets Manager with
the real flat-JSON values (all `.env.example` keys + `PGPASSWORD` + `DEPLOY_KEY`), then
(2) re-run bootstrap on the box via SSM: `sudo cloud-init clean --logs && sudo reboot`.
The box comes back up with real secrets and starts hhf-web + caddy. Terraform will not
overwrite the secret on future applies (`ignore_changes`).

## 5. Verify the new stack (before touching prod DNS)
- SSM into the box: `systemctl status hhf-web caddy postgresql hhf-backup.timer`.
- Caddy obtained a cert: `journalctl -u caddy | grep -i certificate`.
- Direct origin check: `curl -I https://origin.happyhourfriends.com` -> `200`.
- CloudFront check: `curl -I https://<distribution>.cloudfront.net` -> `200`, app HTML.
- WAF: confirm sampled requests in the `budget-cf-waf` CloudWatch metrics.

## 6. Data cutover (maintenance window, ~15-30 min)
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
- Submit a test change -> confirm a pg-boss job runs (`journalctl -u hhf-web`).
- Send a test email path -> confirm Resend still delivers (DNS records carried over).

## 8. Rollback
DNS-based and fast: revert the registrar nameservers back to Cloudflare (or, if still on
Cloudflare NS, you never cut over — just don't flip). The droplet is untouched and still
holds the pre-cutover data. Investigate, then retry.

## 9. Decommission (only after several stable days)
Stop the droplet; keep its final backup. Cancel Cloudflare once Route53 is confirmed
authoritative and email is verified working.
