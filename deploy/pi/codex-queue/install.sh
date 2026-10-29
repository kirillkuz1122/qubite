#!/usr/bin/env bash
# Поставить очередь Codex на Pi (D-623): sudo deploy/pi/codex-queue/install.sh
# Нужно заранее от kirill: `codex login --device-auth` и `gh auth login` (repo: issues, PR, contents).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
[[ $EUID -eq 0 ]] || { echo "запускать через sudo"; exit 1; }
install -D -m 755 "$here/codex-queue.sh" /opt/qubite/bin/qubite-codex
install -m 755 "$here/codex-daemon-run.py" /opt/qubite/bin/qubite-codex-daemon-run
install -m 644 "$here/qubite-codex.service" "$here/qubite-codex.timer" /etc/systemd/system/
install -d -o kirill -g kirill /home/kirill/codex-queue
systemctl daemon-reload
systemctl enable --now qubite-codex.timer
systemctl list-timers qubite-codex.timer --no-pager
