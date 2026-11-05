#!/usr/bin/env bash
# Будильник управляющей сессии (D-649): комментарий в чёрновом PR #89 будит её.
# Старые свои будильники (старше 12 часов) удаляются, чтобы PR не зарастал.
# Сеть до GitHub рвётся (VPN): каждый запрос повторяем, пока не выйдет, но не дольше
# 35 минут — дальше уже следующий запуск таймера (каждые 40 минут).
set -euo pipefail
repo=kirillkuz1122/qubite
pr=89
text="⏰ Будильник с Pi: проверь сессии задач (D-646)"
# Лимиты Codex — из кэша очереди (обновляет qubite-codex, не реже раза в 30 мин); сам Codex не спрашиваем.
limits=$(timeout 10 /opt/qubite/bin/qubite-codex-limits --line 2>/dev/null) || limits="Codex: лимиты неизвестны"
text+=$'\n'"${limits:-Codex: лимиты неизвестны}"

# Окно 01:00–01:50 UTC занято утренней сводкой владельца — не будим.
hm=$(date -u +%H%M)
if (( 10#$hm >= 100 && 10#$hm < 150 )); then
  echo "окно сводки (01:00–01:50 UTC) — пропуск"; exit 0
fi

start=$(date -u +%s)
deadline=$((start + 35 * 60))
started_at=$(date -u -d "@$start" +%Y-%m-%dT%H:%M:%SZ)

# retry КОМАНДА... — повторять с паузой 10, 20, 40, 60, 60… секунд до дедлайна.
retry() {
  local pause=10
  until "$@"; do
    if (( $(date -u +%s) + pause > deadline )); then
      echo "не вышло до дедлайна: $*" >&2; return 1
    fi
    echo "сбой, повтор через ${pause} с: $*" >&2
    sleep "$pause"
    pause=$(( pause * 2 > 60 ? 60 : pause * 2 ))
  done
}

state=$(retry gh pr view "$pr" -R "$repo" --json state --jq .state)
if [[ "$state" != OPEN ]]; then
  echo "PR #$pr: $state — ничего не делаю"; exit 0
fi

# Выключатель (D-848): метка «будильник:выкл» на PR #89 — не будим. Ставит и снимает
# сама управляющая сессия через GitHub, без захода на Pi.
if retry gh pr view "$pr" -R "$repo" --json labels --jq '.labels[].name' | grep -qx 'будильник:выкл'; then
  echo "метка будильник:выкл — пропуск"; exit 0
fi

me=$(retry gh api user --jq .login)
cutoff=$(date -u -d '12 hours ago' +%Y-%m-%dT%H:%M:%SZ)
# Уборка старых — не главное: если сеть не дала, пропускаем.
{ gh api --paginate "repos/$repo/issues/$pr/comments?per_page=100" \
  --jq ".[] | select(.user.login==\"$me\" and (.body|startswith(\"⏰ Будильник с Pi\")) and .created_at < \"$cutoff\") | .id" || true; } |
while read -r id; do
  gh api -X DELETE "repos/$repo/issues/comments/$id" >/dev/null && echo "удалён комментарий $id" || true
done

# Уже дошёл ли этот будильник (запрос мог пройти, а ответ потеряться)? Тогда не дублируем.
posted() {
  local n
  n=$(gh api "repos/$repo/issues/$pr/comments?since=$started_at&per_page=100" \
    --jq "[.[] | select(.user.login==\"$me\" and (.body|startswith(\"⏰ Будильник с Pi\")))] | length") || return 1
  [[ "$n" -gt 0 ]]
}
send() { posted || gh pr comment "$pr" -R "$repo" --body "$text"; }
retry send
