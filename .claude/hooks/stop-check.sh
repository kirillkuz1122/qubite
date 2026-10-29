#!/usr/bin/env bash
# Хук Stop (HAR-001, D-626): в конце хода быстрая проверка того, что задето.
# Красное — возвращаем Claude (код 2), но только один раз подряд, чтобы не зациклиться.
input=$(cat)
if grep -q '"stop_hook_active": *true' <<<"$input"; then exit 0; fi
cd "$CLAUDE_PROJECT_DIR" || exit 0
out=$(scripts/check.sh --quick 2>&1) && exit 0
echo "$out" >&2
exit 2
