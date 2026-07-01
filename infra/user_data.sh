#!/usr/bin/env bash
# Templated by Terraform (templatefile): ${origin_domain} ${secret_id}
# ${aws_region} ${backup_bucket} ${media_bucket} ${acme_email}
set -euo pipefail
exec > >(tee /var/log/hhf-bootstrap.log) 2>&1

APP_DIR=/opt/happyhourfriends
PG_BIN=/usr/bin
PG_DATA=/var/lib/pgsql/data
ENV_FILE=/etc/happyhour/.env

# --- 1. mount the Postgres EBS volume; format ONLY if blank -----------------
data_dev="$(lsblk -dpbno NAME,SIZE | awk '$2==53687091200 {print $1; exit}')"
: "$${data_dev:?could not find 50GiB data volume}"
if ! blkid "$data_dev" >/dev/null 2>&1; then
  mkfs.xfs "$data_dev"
fi
mkdir -p /var/lib/pgsql
grep -q "$data_dev" /etc/fstab || echo "$data_dev /var/lib/pgsql xfs defaults,nofail 0 2" >> /etc/fstab
mount -a

# --- 2. packages ------------------------------------------------------------
dnf -y install postgresql17-server postgresql17-contrib postgis34_17 \
  nodejs20 git tar xz jq unzip
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
sudo -u hhf --preserve-env=HOME env HOME=/home/hhf pnpm install --frozen-lockfile
# The app renders via playwright chromium.launch() (NOT a system chromium package).
# install-deps (root) adds the shared libraries; the browser build itself installs into
# the hhf user's ~/.cache/ms-playwright so the hhf-web service can launch it.
pnpm exec playwright install-deps chromium
sudo -u hhf --preserve-env=HOME env HOME=/home/hhf pnpm exec playwright install chromium
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
