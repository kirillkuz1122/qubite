#!/usr/bin/env bash
# Будильник управляющей сессии (D-649): комментарий в чёрновом PR #89 будит её.
# Старые свои будильники (старше 12 часов) удаляются, чтобы PR не зарастал.
set -euo pipefail
repo=kirillkuz1122/qubite
pr=89
text="⏰ Будильник с Pi: проверь сессии задач (D-646)"

# Окно 01:00–01:50 UTC занято утренней сводкой владельца — не будим.
hm=$(date -u +%H%M)
if [[ "$hm" -ge 0100 && "$hm" -lt 0150 ]]; then
  echo "окно сводки (01:00–01:50 UTC) — пропуск"; exit 0
fi

state=$(gh pr view "$pr" -R "$repo" --json state --jq .state)
if [[ "$state" != OPEN ]]; then
  echo "PR #$pr: $state — ничего не делаю"; exit 0
fi

me=$(gh api user --jq .login)
cutoff=$(date -u -d '12 hours ago' +%Y-%m-%dT%H:%M:%SZ)
gh api --paginate "repos/$repo/issues/$pr/comments?per_page=100" \
  --jq ".[] | select(.user.login==\"$me\" and (.body|startswith(\"⏰ Будильник с Pi\")) and .created_at < \"$cutoff\") | .id" |
while read -r id; do
  gh api -X DELETE "repos/$repo/issues/comments/$id" >/dev/null && echo "удалён комментарий $id"
done

gh pr comment "$pr" -R "$repo" --body "$text"
