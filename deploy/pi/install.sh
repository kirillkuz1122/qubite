#!/usr/bin/env bash
# Первая установка Qubite на Raspberry Pi (OPS-005). Повторный запуск безопасен.
#
#   sudo deploy/pi/install.sh [--domain qubiteapp.online] [--port 9300]
#
# Что делает:
#   1. пользователь `qubite`, папки /opt/qubite, /var/lib/qubite, /etc/qubite;
#   2. база и роль `qubite` в уже установленном PostgreSQL (пароль — случайный, только в pi.env);
#   3. /etc/qubite/pi.env — адреса и база этого сервера (права 640, root:qubite);
#      файл владельца /etc/qubite/qubite.env (секреты) получает те же права и ссылку .env;
#   4. службы qubite-serve, qubite-bot, таймер qubite-update (низкий приоритет, D-567);
#   5. первое обновление — скачать сборку edge из CI и запустить.
#
# Не трогает: Caddy, Cloudflare Tunnel, другие службы. Маршруты — docs/engineering/DEPLOYMENT.md.
set -euo pipefail

DOMAIN=qubiteapp.online
PORT=9300
while [[ $# -gt 0 ]]; do
    case "$1" in
        --domain) DOMAIN="$2"; shift 2 ;;
        --port) PORT="$2"; shift 2 ;;
        *) echo "непонятный ключ: $1" >&2; exit 1 ;;
    esac
done

[[ $EUID -eq 0 ]] || { echo "запускать от root (sudo)" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
for cmd in psql pg_dump pg_restore jq curl flock; do
    command -v "$cmd" >/dev/null || { echo "нет команды $cmd" >&2; exit 1; }
done
step() { echo "==> $*"; }

step "пользователь и папки"
id qubite >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/qubite --shell /usr/sbin/nologin qubite
install -d -m 755 /opt/qubite /opt/qubite/releases /opt/qubite/bin
install -d -m 750 -o qubite -g qubite /var/lib/qubite
install -d -m 750 -o root -g qubite /etc/qubite
install -d -m 700 /var/backups/qubite

step "PostgreSQL: роль и база qubite"
pg() { runuser -u postgres -- psql -v ON_ERROR_STOP=1 -Atq "$@"; }
password=""
if [[ -f /etc/qubite/pi.env ]]; then
    password="$(sed -n 's#^DATABASE_URL=postgres://qubite:\([^@]*\)@.*#\1#p' /etc/qubite/pi.env)"
fi
[[ -n $password ]] || password="$(head -c 24 /dev/urandom | base64 | tr -d '/+=')"
if [[ -z $(pg -c "SELECT 1 FROM pg_roles WHERE rolname = 'qubite'") ]]; then
    pg -c "CREATE ROLE qubite LOGIN PASSWORD '${password}'"
else
    pg -c "ALTER ROLE qubite LOGIN PASSWORD '${password}'"
fi
# Мало памяти и соединений: Pi общая с сервисами владельца.
pg -c "ALTER ROLE qubite CONNECTION LIMIT 12"
pg -c "ALTER ROLE qubite SET work_mem = '4MB'"
pg -c "ALTER ROLE qubite SET maintenance_work_mem = '32MB'"
pg -c "ALTER ROLE qubite SET statement_timeout = '60s'"
if [[ -z $(pg -c "SELECT 1 FROM pg_database WHERE datname = 'qubite'") ]]; then
    runuser -u postgres -- createdb -O qubite qubite
fi
pg -d qubite -c "REVOKE ALL ON DATABASE qubite FROM PUBLIC"

step "/etc/qubite/pi.env"
umask 027
cat >/etc/qubite/pi.env <<ENV
# Пишет deploy/pi/install.sh — правки сюда перезапишутся. Секреты владельца — в qubite.env.
QUBITE_ENV=prod
QUBITE_BIND=127.0.0.1:${PORT}
QUBITE_DATA_DIR=/var/lib/qubite
QUBITE_LOG=info
QUBITE_LOG_FORMAT=json
QUBITE_DOMAIN=${DOMAIN}
QUBITE_PUBLIC_URL=https://${DOMAIN}
QUBITE_AUTH_URL=https://auth.${DOMAIN}
QUBITE_TRUST_PROXY=true
QUBITE_COOKIE_SECURE=true
QUBITE_SESSION_COOKIE_DOMAIN=.${DOMAIN}
DATABASE_URL=postgres://qubite:${password}@127.0.0.1:5432/qubite
DATABASE_MAX_CONNECTIONS=5
QUBITE_BOT_SERVER_URL=http://127.0.0.1:${PORT}
ENV
chown root:qubite /etc/qubite/pi.env
chmod 640 /etc/qubite/pi.env
if [[ -f /etc/qubite/qubite.env ]]; then
    chown root:qubite /etc/qubite/qubite.env
    chmod 640 /etc/qubite/qubite.env
    ln -sfn qubite.env /etc/qubite/.env
else
    echo "    нет /etc/qubite/qubite.env — сервер запустится без секретов владельца (без писем, бота, AI)"
fi

step "службы systemd"
install -m 644 "$HERE/qubite.slice" "$HERE/qubite-serve.service" "$HERE/qubite-bot.service" \
    "$HERE/qubite-update.service" "$HERE/qubite-update.timer" /etc/systemd/system/
install -m 755 "$HERE/update.sh" /opt/qubite/bin/qubite-update
systemctl daemon-reload
systemctl enable qubite-serve.service qubite-bot.service qubite-update.timer >/dev/null

step "первая сборка из CI"
/opt/qubite/bin/qubite-update --force
systemctl start qubite-update.timer
/opt/qubite/bin/qubite-update --status

cat <<TXT

Готово. Дальше:
  owner:   sudo -u qubite env QUBITE_DOTENV=0 \$(grep ^DATABASE_URL /etc/qubite/pi.env) \\
             /opt/qubite/current/bin/qubite owner create --email <почта>
  Caddy:   ${DOMAIN} и auth.${DOMAIN} → сайт /opt/qubite/current/web, /api/* → 127.0.0.1:${PORT}
  логи:    journalctl -u qubite-serve -u qubite-bot -u qubite-update -f
TXT
