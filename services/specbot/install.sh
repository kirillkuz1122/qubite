#!/usr/bin/env bash
set -euo pipefail
# Run under the bot owner on a Debian Raspberry Pi; sudo only installs systemd unit.
service_root="${SPECBOT_ROOT:-$HOME/services/qubite-specbot}"
mkdir -p "$service_root/app" "$service_root/data"
chmod 700 "$service_root" "$service_root/data"
if [[ ! -s "$service_root/private.env" ]]; then
  install -m 600 "$(dirname "$0")/.env.example" "$service_root/private.env"
  echo "Заполни $service_root/private.env и повтори установку."
  exit 1
fi
for f in bot.py ai.py config.py document.py store.py bridge.py negotiation.py negotiation_cli.py negotiation_personal.py leads.py leads_cli.py leads_personal.py requirements.txt; do
  install -m 600 "$(dirname "$0")/$f" "$service_root/app/$f"
done
uv_bin="$(command -v uv || true)"
[[ -n "$uv_bin" ]] || uv_bin="$HOME/.local/bin/uv"
"$uv_bin" venv --python /usr/bin/python3 "$service_root/.venv"
"$uv_bin" pip install --python "$service_root/.venv/bin/python" -r "$service_root/app/requirements.txt"
unit_path="$(mktemp)"
trap 'rm -f "$unit_path"' EXIT
cat > "$unit_path" <<EOF
[Unit]
Description=Qubite Brief - personal requirements interview bot
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=$(id -un)
Group=$(id -gn)
WorkingDirectory=$service_root/app
Environment=SPECBOT_ENV=$service_root/private.env
Environment=PYTHONUNBUFFERED=1
Environment=OMP_NUM_THREADS=1
Environment=OPENBLAS_NUM_THREADS=1
Environment=MKL_NUM_THREADS=1
ExecStart=$service_root/.venv/bin/python $service_root/app/bot.py
Restart=on-failure
RestartSec=10
TimeoutStopSec=15
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$service_root/data
MemoryHigh=450M
MemoryMax=750M
MemorySwapMax=128M
CPUQuota=100%
TasksMax=80

[Install]
WantedBy=multi-user.target
EOF
sudo install -m 644 "$unit_path" /etc/systemd/system/qubite-specbot.service
sudo systemctl daemon-reload
sudo systemctl enable --now qubite-specbot.service
echo 'Сервис qubite-specbot включён. Статус: systemctl status qubite-specbot'
