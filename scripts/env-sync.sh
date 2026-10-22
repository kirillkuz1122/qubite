#!/usr/bin/env bash
# Дописать в .env переменные, которые появились в .env.example.
# Существующие строки .env не меняются никогда — только добавляются новые в конец
# (вместе с комментарием над ними). Переменная считается «уже есть», если в .env
# есть строка `ИМЯ=` или закомментированная `# ИМЯ=` (выключил сам — не возвращаем).
#
#   scripts/env-sync.sh              — нет .env: создать из примера (права 600)
#   scripts/env-sync.sh --if-exists  — нет .env: ничего не делать (так зовут git-хуки)
#
# Запускается сам после `git pull` (.githooks, включает `just setup`) и вручную: `just env-sync`.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
example="$root/.env.example"
env="$root/.env"

[ -f "$example" ] || exit 0

if [ ! -f "$env" ]; then
    [ "${1:-}" = "--if-exists" ] && exit 0
    cp "$example" "$env"
    chmod 600 "$env"
    echo ".env создан из .env.example — заполни ключи." >&2
    exit 0
fi

added="$(awk '
    function key(line) {
        if (match(line, /^#?[ \t]*[A-Z][A-Z0-9_]*=/)) {
            k = substr(line, 1, RLENGTH - 1); sub(/^#?[ \t]*/, "", k); return k
        }
        return ""
    }
    # Первый файл — .env; FNR == NR не годится: у пустого .env так выглядит и пример.
    FILENAME == ARGV[1] { k = key($0); if (k != "") have[k] = 1; next }
    /^[ \t]*$/ { block = ""; next }
    {
        k = key($0)
        if (k == "") { block = block $0 "\n"; next }
        if (!(k in have)) { printf "%s%s\n", block, $0; have[k] = 1 }
        block = ""
    }
' "$env" "$example")"

[ -n "$added" ] || exit 0

printf '\n# --- Добавлено из .env.example %s ---\n%s\n' "$(date +%F)" "$added" >> "$env"
echo "В .env добавлены новые переменные из .env.example:" >&2
printf '%s\n' "$added" | grep -oE '^#?[ \t]*[A-Z][A-Z0-9_]*=' | sed -E 's/^#?[ \t]*/  /; s/=$//' >&2
