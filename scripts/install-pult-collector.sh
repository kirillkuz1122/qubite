#!/usr/bin/env bash
# Без аргументов показывает план. --apply устанавливает, --remove отключает таймер.
set -euo pipefail

case "$#" in
    0) mode=plan ;;
    1)
        case "$1" in
            --apply) mode=apply ;;
            --remove) mode=remove ;;
            --help|-h)
                echo "Использование: $0 [--apply | --remove]"
                exit 0
                ;;
            *) echo "Неизвестный аргумент: $1" >&2; exit 2 ;;
        esac
        ;;
    *) echo "Использование: $0 [--apply | --remove]" >&2; exit 2 ;;
esac

timer=qubite-pult-collect.timer
if [[ $mode == remove ]]; then
    systemctl --user disable --now "$timer"
    exit 0
fi

run() {
    if [[ $mode == apply ]]; then
        "$@"
    else
        printf '%q ' "$@"
        printf '\n'
    fi
}

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unit_dir="$HOME/.config/systemd/user"
run install -D -m 755 "$root/scripts/pult_collect.py" "$HOME/.local/share/qubite/pult_collect.py"
run install -d "$unit_dir"
run install -m 644 "$root/deploy/pult/qubite-pult-collect.service" "$root/deploy/pult/$timer" "$unit_dir/"
run systemctl --user daemon-reload
run systemctl --user enable --now "$timer"
