#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

ask() {
  local name="$1" prompt="$2" default="${3:-}" secret="${4:-}"
  [[ -n "${!name:-}" ]] && return
  local suffix=""
  [[ -n "$default" ]] && suffix=" [$default]"
  if [[ "$secret" == "secret" ]]; then
    read -r -s -p "$prompt$suffix: " "$name"
    echo
  else
    read -r -p "$prompt$suffix: " "$name"
  fi
  if [[ -z "${!name}" && -n "$default" ]]; then
    printf -v "$name" "%s" "$default"
  fi
}

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ask MAIN_SITE_DOMAIN "Main site domain" "qubiteapp.ru"
ask EXTRA_SITE_DOMAINS "Extra site domains, comma separated" "www.qubiteapp.ru,ru.qubiteapp.online,www.ru.qubiteapp.online"
ask PROXY_DOMAIN "Proxy domain on master server" "proxy.qubiteapp.online"
ask PROXY_EXTRA_DOMAINS "Extra proxy domains, comma separated" "proxy4.qubiteapp.online,proxy6.qubiteapp.online"
ask APP_PORT "Node app port" "3000"
ask PROXY_CREDENTIAL_ENCRYPTION_KEY "Proxy credential encryption key" "$(openssl rand -base64 32)" secret
ask PROXY_SYNC_TOKEN "Master-local proxy sync token" "$(openssl rand -hex 32)" secret

ensure_nginx_stream_module() {
  mkdir -p /etc/nginx/modules-enabled

  if [[ -f /usr/share/nginx/modules-available/mod-stream.conf ]]; then
    ln -sfn /usr/share/nginx/modules-available/mod-stream.conf /etc/nginx/modules-enabled/50-mod-stream.conf
  elif [[ -f /usr/lib/nginx/modules/ngx_stream_module.so ]]; then
    cat >/etc/nginx/modules-enabled/50-mod-stream.conf <<'EOF_NGINX_STREAM_MODULE'
load_module modules/ngx_stream_module.so;
EOF_NGINX_STREAM_MODULE
  fi

  if ! grep -Eq 'include[[:space:]]+/etc/nginx/modules-enabled/\*\.conf;' /etc/nginx/nginx.conf; then
    sed -i '1i include /etc/nginx/modules-enabled/*.conf;' /etc/nginx/nginx.conf
  fi

  if [[ ! -f /usr/lib/nginx/modules/ngx_stream_module.so ]]; then
    echo "ERROR: nginx stream module is not installed." >&2
    echo "Install package libnginx-mod-stream and rerun this script." >&2
    exit 1
  fi
}

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  nodejs npm nginx libnginx-mod-stream git curl golang-go libcap2-bin ufw fail2ban unzip zip

# --- Create dedicated service user for Caddy and sing-box ---

if ! id caddy >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin caddy
fi

if [[ -f /etc/default/ufw ]]; then
  sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
fi

if [[ -f "$REPO_DIR/back/package-lock.json" ]]; then
  npm --prefix "$REPO_DIR/back" ci
else
  npm --prefix "$REPO_DIR/back" install
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

ENV_FILE="$REPO_DIR/.env"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf "%s=%s\n" "$key" "$value" >>"$ENV_FILE"
  fi
}

set_env HOST "127.0.0.1"
set_env PORT "$APP_PORT"
set_env NODE_ENV "production"
set_env APP_BASE_URL "https://${MAIN_SITE_DOMAIN}"
set_env TRUST_PROXY "1"
set_env PROXY_PUBLIC_DOMAIN "$PROXY_DOMAIN"
set_env PROXY_CREDENTIAL_ENCRYPTION_KEY "$PROXY_CREDENTIAL_ENCRYPTION_KEY"
set_env PROXY_SYNC_TOKEN "$PROXY_SYNC_TOKEN"

# --- Build Caddy with NaiveProxy (klzgrad fork) ---

if [[ ! -x /usr/local/bin/xcaddy ]]; then
  GOBIN=/usr/local/bin go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
fi

/usr/local/bin/xcaddy build \
  --output /usr/local/bin/caddy-naive \
  --with 'github.com/caddyserver/forwardproxy=github.com/klzgrad/forwardproxy@naive'
setcap cap_net_bind_service=+ep /usr/local/bin/caddy-naive || true

# --- Install sing-box for VLESS+Reality ---

if ! command -v sing-box >/dev/null 2>&1; then
  SINGBOX_VERSION="1.13.5"
  SINGBOX_ARCH="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
  SINGBOX_URL="https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}/sing-box-${SINGBOX_VERSION}-linux-${SINGBOX_ARCH}.tar.gz"
  curl -fsSL "$SINGBOX_URL" -o /tmp/sing-box.tar.gz
  tar -xzf /tmp/sing-box.tar.gz -C /tmp
  cp "/tmp/sing-box-${SINGBOX_VERSION}-linux-${SINGBOX_ARCH}/sing-box" /usr/local/bin/sing-box
  chmod +x /usr/local/bin/sing-box
  rm -rf /tmp/sing-box* || true
fi

# Generate Reality keypair if not provided
REALITY_PRIVATE_KEY="${REALITY_PRIVATE_KEY:-}"
REALITY_PUBLIC_KEY="${REALITY_PUBLIC_KEY:-}"
REALITY_SHORT_ID="${REALITY_SHORT_ID:-$(openssl rand -hex 4)}"
REALITY_TARGET_SNI="${REALITY_TARGET_SNI:-www.microsoft.com}"

if [[ -z "$REALITY_PRIVATE_KEY" ]]; then
  echo "Generating Reality keypair..."
  KEYPAIR="$(sing-box generate reality-keypair)"
  REALITY_PRIVATE_KEY="$(echo "$KEYPAIR" | grep -oP 'PrivateKey: \K.*')"
  REALITY_PUBLIC_KEY="$(echo "$KEYPAIR" | grep -oP 'PublicKey: \K.*')"
  echo "Reality public key: ${REALITY_PUBLIC_KEY}"
  echo "Reality short ID:   ${REALITY_SHORT_ID}"
  echo ""
  echo "SAVE THESE! You need the public key and short ID for the admin panel."
  echo ""
fi

# --- Nginx: backup and configure ---

TS="$(date +%F-%H%M%S)"
[[ -d /etc/nginx ]] && cp -a /etc/nginx "/root/nginx-backup-${TS}"
cp "$REPO_DIR/deploy/proxy/nginx-internal-qubite.conf" /etc/nginx/sites-available/qubiteapp.ru
ln -sfn /etc/nginx/sites-available/qubiteapp.ru /etc/nginx/sites-enabled/qubiteapp.ru
rm -f /etc/nginx/sites-enabled/default

# --- nginx SNI router on port 443 ---

ensure_nginx_stream_module
mkdir -p /etc/nginx/stream.d

if ! grep -q "stream.d" /etc/nginx/nginx.conf; then
  sed -i '/^http {/i\
include /etc/nginx/stream.d/*.conf;' /etc/nginx/nginx.conf
fi

cp "$REPO_DIR/deploy/proxy/nginx-sni-router.conf" /etc/nginx/stream.d/sni-router.conf

# --- Caddy config (listens on 18443, behind nginx SNI router) ---

mkdir -p /etc/caddy /var/lib/caddy /var/log/caddy
cat >/etc/caddy/forwardproxy-credentials.caddy <<'EOF_CREDS'
# No credentials yet. All proxy connections are blocked until first sync.
# The sync timer will populate this file with real credentials.
basic_auth __blocked__ __no-credentials-synced-yet__
EOF_CREDS
cat >/etc/caddy/qubite-sni-routes.caddy <<'EOF_SNI'
# Generated by Qubite proxy sync. Do not edit manually.
EOF_SNI
chmod 600 /etc/caddy/forwardproxy-credentials.caddy
chmod 600 /etc/caddy/qubite-sni-routes.caddy
chown -R caddy:caddy /etc/caddy /var/lib/caddy /var/log/caddy

SITE_NAMES="$MAIN_SITE_DOMAIN"
IFS=',' read -ra EXTRA <<<"$EXTRA_SITE_DOMAINS"
for domain in "${EXTRA[@]}"; do
  domain="$(echo "$domain" | xargs)"
  [[ -n "$domain" ]] && SITE_NAMES="${SITE_NAMES}, https://${domain}"
done

PROXY_SITE_NAMES="$PROXY_DOMAIN"
IFS=',' read -ra PROXY_EXTRA <<<"$PROXY_EXTRA_DOMAINS"
for domain in "${PROXY_EXTRA[@]}"; do
  domain="$(echo "$domain" | xargs)"
  [[ -n "$domain" ]] && PROXY_SITE_NAMES="${PROXY_SITE_NAMES}, https://${domain}"
done

cat >/etc/caddy/Caddyfile <<EOF_CADDY
{
    order forward_proxy before file_server
    admin 127.0.0.1:2019
    https_port 18443
}

:18443, ${PROXY_SITE_NAMES} {
    tls {
        on_demand
    }
    route {
        forward_proxy {
            import /etc/caddy/forwardproxy-credentials.caddy
            hide_ip
            hide_via
            probe_resistance
        }

        redir https://${MAIN_SITE_DOMAIN}{uri} 302
    }

    log {
        output file /var/log/caddy/proxy-access.log {
            roll_size 50mb
            roll_keep 5
        }
        format json
    }
}

import /etc/caddy/qubite-sni-routes.caddy

https://${SITE_NAMES} {
    reverse_proxy localhost:8080
}
EOF_CADDY

# --- sing-box Reality config ---

mkdir -p /etc/singbox /var/log/singbox
chown -R caddy:caddy /etc/singbox /var/log/singbox
cat >/etc/singbox/config.json <<EOF_SINGBOX
{
  "log": {
    "level": "info",
    "output": "/var/log/singbox/reality.log",
    "timestamp": true
  },
  "inbounds": [
    {
      "type": "vless",
      "tag": "vless-reality-in",
      "listen": "127.0.0.1",
      "listen_port": 18444,
      "users": [],
      "tls": {
        "enabled": true,
        "server_name": "${REALITY_TARGET_SNI}",
        "reality": {
          "enabled": true,
          "handshake": {
            "server": "${REALITY_TARGET_SNI}",
            "server_port": 443
          },
          "private_key": "${REALITY_PRIVATE_KEY}",
          "short_id": ["${REALITY_SHORT_ID}"]
        }
      }
    }
  ],
  "outbounds": [
    { "type": "direct", "tag": "direct" }
  ]
}
EOF_SINGBOX
chmod 600 /etc/singbox/config.json

# --- Systemd services ---

SYNC_URL="http://127.0.0.1:${APP_PORT}/api/proxy/sync/credentials?domain=${PROXY_DOMAIN}"
TRAFFIC_URL="http://127.0.0.1:${APP_PORT}/api/proxy/node/traffic"

cat >/etc/systemd/system/caddy-naive.service <<'EOF_SERVICE'
[Unit]
Description=Caddy NaiveProxy frontend
After=network-online.target
Wants=network-online.target

[Service]
User=caddy
Group=caddy
Environment=HOME=/var/lib/caddy
Environment=XDG_DATA_HOME=/var/lib/caddy
Environment=XDG_CONFIG_HOME=/var/lib/caddy/.config
AmbientCapabilities=CAP_NET_BIND_SERVICE
ExecStart=/usr/local/bin/caddy-naive run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy-naive reload --config /etc/caddy/Caddyfile --force
Restart=on-failure
RestartSec=5s
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF_SERVICE

cat >/etc/systemd/system/singbox-reality.service <<'EOF_SERVICE'
[Unit]
Description=sing-box VLESS+Reality proxy
After=network-online.target
Wants=network-online.target

[Service]
User=caddy
Group=caddy
ExecStart=/usr/local/bin/sing-box run --config /etc/singbox/config.json
Restart=on-failure
RestartSec=5s
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF_SERVICE

# --- Secrets environment file (not inline in unit files) ---

mkdir -p /etc/qubite
cat >/etc/qubite/proxy-master.env <<EOF_ENV
PROXY_SYNC_TOKEN=${PROXY_SYNC_TOKEN}
REALITY_PRIVATE_KEY=${REALITY_PRIVATE_KEY}
REALITY_PUBLIC_KEY=${REALITY_PUBLIC_KEY}
REALITY_SHORT_ID=${REALITY_SHORT_ID}
EOF_ENV
chmod 600 /etc/qubite/proxy-master.env
chown root:root /etc/qubite/proxy-master.env

cat >/etc/systemd/system/qubite-proxy-sync.service <<EOF_SERVICE
[Unit]
Description=Sync local Qubite proxy credentials into Caddy and sing-box
After=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/qubite/proxy-master.env
Environment=QUBITE_PROXY_SYNC_URL=${SYNC_URL}
Environment=CADDY_FORWARDPROXY_CREDENTIALS=/etc/caddy/forwardproxy-credentials.caddy
Environment=SINGBOX_REALITY_CONFIG=/etc/singbox/config.json
Environment=NGINX_STREAM_CONF=/etc/nginx/stream.d/sni-router.conf
ExecStart=/usr/bin/node ${REPO_DIR}/deploy/proxy/sync-caddy-credentials.mjs
ExecStartPost=/usr/bin/systemctl reload caddy-naive.service
ExecStartPost=/usr/bin/systemctl restart singbox-reality.service
ExecStartPost=/usr/bin/systemctl reload nginx
EOF_SERVICE

cat >/etc/systemd/system/qubite-proxy-sync.timer <<'EOF_TIMER'
[Unit]
Description=Refresh local Qubite proxy credentials for Caddy and sing-box

[Timer]
OnBootSec=30s
OnUnitActiveSec=30s
AccuracySec=5s
Unit=qubite-proxy-sync.service

[Install]
WantedBy=timers.target
EOF_TIMER

cat >/etc/systemd/system/qubite-proxy-log-reporter.service <<EOF_SERVICE
[Unit]
Description=Report Caddy proxy access logs to Qubite
After=network-online.target caddy-naive.service

[Service]
EnvironmentFile=/etc/qubite/proxy-master.env
Environment=QUBITE_TRAFFIC_URL=${TRAFFIC_URL}
Environment=CADDY_ACCESS_LOG=/var/log/caddy/proxy-access.log
ExecStart=/usr/bin/node ${REPO_DIR}/deploy/proxy/proxy-log-reporter.mjs
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
EOF_SERVICE

# --- TC fair-share bandwidth (optional, enable with: systemctl enable --now qubite-tc-fair-share) ---

DEFAULT_IFACE="$(ip route show default | awk '/default/ {print $5; exit}')"
TC_BANDWIDTH="${TC_BANDWIDTH:-1gbit}"

cat >/etc/systemd/system/qubite-tc-fair-share.service <<EOF_SERVICE
[Unit]
Description=TC CAKE fair-share bandwidth for NaiveProxy
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/bash ${REPO_DIR}/deploy/proxy/tc-fair-share.sh enable ${DEFAULT_IFACE} ${TC_BANDWIDTH}
ExecStop=/bin/bash ${REPO_DIR}/deploy/proxy/tc-fair-share.sh disable ${DEFAULT_IFACE}

[Install]
WantedBy=multi-user.target
EOF_SERVICE

# --- Validate and start ---

nginx -t
/usr/local/bin/caddy-naive validate --config /etc/caddy/Caddyfile

pm2 start "$REPO_DIR/back/server.js" --name qubiteapp --cwd "$REPO_DIR/back" --update-env || \
  pm2 restart qubiteapp --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null || true

ufw allow 22/tcp >/dev/null || true
ufw allow 80/tcp >/dev/null || true
ufw allow 443/tcp >/dev/null || true

systemctl daemon-reload
systemctl enable nginx caddy-naive.service singbox-reality.service \
  qubite-proxy-sync.timer qubite-proxy-log-reporter.service fail2ban >/dev/null
systemctl restart nginx
systemctl restart caddy-naive.service
systemctl restart singbox-reality.service
systemctl restart qubite-proxy-sync.service || true
systemctl start qubite-proxy-sync.timer
systemctl restart qubite-proxy-log-reporter.service

echo ""
echo "Master Qubite server installed."
echo "Site: https://${MAIN_SITE_DOMAIN}"
echo "Master proxy: https://${PROXY_DOMAIN}"
echo "Repo: ${REPO_DIR}"
echo "Nginx backup: /root/nginx-backup-${TS}"
echo ""
echo "Architecture:"
echo "  Port 443 -> nginx SNI router"
echo "    -> Caddy NaiveProxy on :18443 (Qubite domains)"
echo "    -> sing-box Reality on :18444 (other SNI)"
echo "  Port 8080 -> nginx http -> Node.js:${APP_PORT}"
echo ""
echo "Reality public key: ${REALITY_PUBLIC_KEY}"
echo "Reality short ID:   ${REALITY_SHORT_ID}"
echo "Reality target SNI: ${REALITY_TARGET_SNI}"
echo ""
echo "Add the public key and short ID to the proxy server metadata in the admin panel."
