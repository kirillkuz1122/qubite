#!/usr/bin/env bash
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Запусти через sudo'; exit 1; }
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
[[ -f "$REPO_DIR/.env" ]] || { echo 'Скопируй .env.example в .env и заполни параметры.'; exit 1; }
python3 "$REPO_DIR/deploy/services/configure.py" "$REPO_DIR" --check
apt-get update
apt-get install -y ca-certificates curl python3 python3-venv python3-yaml nodejs npm
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)'; then
 echo 'Нужен Node.js >=22. Установи актуальный Node.js и повтори установку.'; exit 1
fi
if ! command -v docker >/dev/null; then apt-get install -y docker.io; systemctl enable --now docker; fi
npm --prefix "$REPO_DIR/back" ci --omit=dev
# Generator reads .env as data, never sources arbitrary shell commands.
python3 "$REPO_DIR/deploy/services/configure.py" "$REPO_DIR"
