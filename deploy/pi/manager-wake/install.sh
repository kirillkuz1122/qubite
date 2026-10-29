#!/usr/bin/env bash
# Поставить будильник управляющей сессии (D-649): sudo deploy/pi/manager-wake/install.sh
# Нужен `gh auth login` у kirill. Выключить: systemctl disable --now qubite-manager-wake.timer
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
[[ $EUID -eq 0 ]] || { echo "запускать через sudo"; exit 1; }
install -D -m 755 "$here/manager-wake.sh" /opt/qubite/bin/qubite-manager-wake
install -m 644 "$here/qubite-manager-wake.service" "$here/qubite-manager-wake.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now qubite-manager-wake.timer
systemctl list-timers qubite-manager-wake.timer --no-pager
