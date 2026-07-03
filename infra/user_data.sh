#!/usr/bin/env bash
# Templated by Terraform (templatefile): ${origin_domain} ${secret_id}
# ${aws_region} ${backup_bucket} ${media_bucket} ${acme_email}
# Target image: Ubuntu 24.04 LTS (noble), arm64. Runs once via cloud-init as root.
set -euo pipefail
exec > >(tee /var/log/hhf-bootstrap.log) 2>&1
export DEBIAN_FRONTEND=noninteractive

APP_DIR=/opt/happyhourfriends
PG_DATA_ROOT=/var/lib/postgresql
ENV_FILE=/etc/happyhour/.env

# --- 1. mount the Postgres EBS volume BEFORE installing Postgres ------------
# Format ONLY if the volume is blank (never reformat a volume that holds data).
# Mounting the empty volume here means the postgresql package creates its cluster
# directly on the durable EBS volume.
# Identify the dedicated data volume as the non-root physical disk (NOT by size —
# the OS root disk is also 20GiB, so size can't disambiguate). Wait for it to attach
# (the EBS attachment can race cloud-init on a fresh/replaced instance).
# Relax pipefail/errexit here: the detection pipeline uses `head`, which closes the
# pipe early and makes upstream commands exit non-zero — under `set -eo pipefail`
# that would abort the whole script even on success.
set +e +o pipefail
root_src="$(findmnt -no SOURCE /)"
root_disk="/dev/$(lsblk -no PKNAME "$root_src" | head -1)"
data_dev=""
for _ in $(seq 1 30); do
  data_dev="$(lsblk -dpno NAME,TYPE | awk '$2=="disk"{print $1}' | grep -vx "$root_disk" | grep -v loop | head -1)"
  [ -n "$data_dev" ] && break
  sleep 5
done
set -e -o pipefail
: "$${data_dev:?no dedicated data volume found after waiting 150s}"
if ! blkid "$data_dev" >/dev/null 2>&1; then
  mkfs.ext4 -L pgdata "$data_dev"
fi
mkdir -p "$PG_DATA_ROOT"
grep -q "$data_dev" /etc/fstab || echo "$data_dev $PG_DATA_ROOT ext4 defaults,nofail 0 2" >> /etc/fstab
mount -a
# NOTE: re-provisioning onto a volume that ALREADY holds a cluster needs manual
# cluster registration — the fresh-volume first-boot path is what this handles.

# --- 2. packages ------------------------------------------------------------
apt-get update
apt-get install -y curl ca-certificates gnupg lsb-release git jq unzip

# PostgreSQL 17 + PostGIS from the official PGDG apt repo (first-class noble/arm64 builds).
install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list

# Node.js 20 from NodeSource.
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -

apt-get update
apt-get install -y postgresql-17 postgresql-17-postgis-3 nodejs
# The app is installed/built with npm against the committed package-lock.json
# (pnpm-lock.yaml is gitignored; npm is the prod/CI toolchain). npm ships with Node.

# AWS CLI v2 (needed for Secrets Manager + S3).
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o /tmp/awscliv2.zip
unzip -q -o /tmp/awscliv2.zip -d /tmp
/tmp/aws/install --update

id hhf >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin hhf

# --- 3. postgres role/db/extension (the package already created + started the
#        cluster on the mounted volume) -------------------------------------
systemctl enable --now postgresql
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
jq -r 'del(.DEPLOY_KEY) | to_entries[] | "\(.key)=\(.value)"' /etc/happyhour/secrets.json > "$ENV_FILE"
{
  echo "BACKUP_BUCKET=${backup_bucket}"
  echo "MEDIA_BUCKET=${media_bucket}"
  echo "ACME_EMAIL=${acme_email}"
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
sudo -u hhf --preserve-env=HOME env HOME=/home/hhf npm ci
# The app renders via playwright chromium.launch() (NOT a system chromium package).
# install-deps (root) adds the shared libraries; the browser build itself installs into
# the hhf user's ~/.cache/ms-playwright so the hhf-web service can launch it.
npx --yes playwright install-deps chromium
sudo -u hhf --preserve-env=HOME env HOME=/home/hhf npx --yes playwright install chromium
sudo -u hhf --preserve-env=HOME env HOME=/home/hhf bash -c 'set -a; . /etc/happyhour/.env; set +a; npm run build && npm run db:migrate'

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
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE
[Install]
WantedBy=multi-user.target
UNIT
chown -R hhf:hhf "$APP_DIR"
systemctl daemon-reload
systemctl enable --now hhf-web.service caddy.service hhf-backup.timer
echo "bootstrap complete"
