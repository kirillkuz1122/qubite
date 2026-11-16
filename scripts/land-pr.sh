#!/usr/bin/env bash
# Довести PR до main без траты токенов на ожидание (D-900).
#
#   scripts/land-pr.sh <номер PR> [--no-codex] [--no-merge]
#
# Запускай в ФОНЕ (Bash run_in_background): сессия проснётся один раз, когда скрипт
# закончит. Не подписывайся на события PR и не ставь будильники ради CI.
#
# Ждёт: все проверки CI на последнем коммите и итог ревью Codex-бота по этому коммиту.
# Если ревью Codex относится к старому коммиту — один раз пишет «@codex review».
# Код выхода: 0 — влит (или готов при --no-merge); 1 — CI красный; 2 — у Codex
# есть замечания; 3 — конфликт с main; 4 — вышло время (55 мин).
# В выводе — короткая выжимка: упавшие тесты и тексты замечаний. Лог больше
# ~80 строк отдавай агенту scout (Haiku), а не читай сам.
set -uo pipefail

pr="${1:?номер PR}"
shift
codex=1
merge=1
for arg in "$@"; do
  case "$arg" in
    --no-codex) codex=0 ;;
    --no-merge) merge=0 ;;
    *) echo "неизвестный ключ: $arg" >&2; exit 64 ;;
  esac
done

deadline=$(( $(date +%s) + 55 * 60 ))
left() { [ "$(date +%s)" -lt "$deadline" ]; }

# Только REST: GraphQL (gh pr view/checks/comment/merge) из облачных сессий закрыт.
api() { gh api "repos/{owner}/{repo}/$1" "${@:2}"; }
head_sha() { api "pulls/$pr" -q .head.sha; }

# Проверки на коммите: "идут" / "зелёные" / "красные".
checks_state() {
  api "commits/$1/check-runs?per_page=100" -q '.check_runs[] | "\(.status) \(.conclusion)"' |
    awk '$1!="completed"{p=1} $1=="completed" && $2!="success" && $2!="skipped" && $2!="neutral"{f=1}
         END{print (p?"идут":(f?"красные":(NR?"зелёные":"идут")))}'
}

# Состояние ревью Codex: "<commit_sha> <status> <has_unresolved_findings>" или пусто.
codex_state() {
  gh api "repos/{owner}/{repo}/issues/$pr/comments" --paginate -q \
    '.[] | select(.user.login=="chatgpt-codex-connector[bot]") | .body' 2>/dev/null |
    python3 -I -c '
import json, re, sys, html
text = html.unescape(sys.stdin.read())
found = re.findall(r"codex-review-state:v1 (\{.*?\}\}) -->", text)
if found:
    cr = json.loads(found[-1]).get("code_review") or {}
    print(cr.get("commit_sha") or "", cr.get("status") or "", str(cr.get("has_unresolved_findings")).lower())
'
}

sha=$(head_sha)
echo "PR #$pr, коммит ${sha:0:8}"

if [ "$codex" = 1 ]; then
  read -r c_sha _ _ <<<"$(codex_state)"
  if [ -n "${c_sha:-}" ] && [ "$c_sha" != "$sha" ]; then
    api "issues/$pr/comments" -f body="@codex review" >/dev/null && echo "попросил Codex проверить новый коммит"
  fi
fi

# 1. CI. Проверки могут появиться не сразу.
sleep 20
state=идут
while left; do
  state=$(checks_state "$sha")
  [ "$state" != "идут" ] && break
  sleep 30
done
if ! left; then echo "ВРЕМЯ: CI не закончился за 55 минут"; exit 4; fi
if [ "$(head_sha)" != "$sha" ]; then echo "в PR новый коммит — запусти скрипт заново"; exit 4; fi

if [ "$state" = "красные" ]; then
  echo "CI КРАСНЫЙ:"
  api "commits/$sha/check-runs?per_page=100" -q \
    '.check_runs[] | select(.conclusion!="success" and .conclusion!="skipped" and .conclusion!="neutral") | "  \(.name): \(.conclusion)"'
  for run in $(api "actions/runs?head_sha=$sha" -q '.workflow_runs[] | select(.conclusion=="failure") | .id'); do
    echo "--- запуск $run"
    gh run view "$run" --log-failed 2>/dev/null |
      grep -E 'FAILED|panicked|error(\[|:)|✘|Error:|AssertionError|expected|failures:|Diff in|::error::' |
      sed -E 's/^[^\t]*\t[^\t]*\t[0-9TZ:.-]+ //' | head -40
  done
  exit 1
fi
echo "CI зелёный"

# 2. Ревью Codex по этому коммиту.
if [ "$codex" = 1 ]; then
  while left; do
    read -r c_sha c_status c_open <<<"$(codex_state)"
    if [ "${c_sha:-}" = "$sha" ] && [ "${c_status:-}" = "completed" ]; then break; fi
    sleep 60
  done
  if ! left; then echo "ВРЕМЯ: Codex не дал итог за 55 минут (можно --no-codex)"; exit 4; fi
  if [ "${c_open:-}" = "true" ]; then
    echo "У CODEX ЗАМЕЧАНИЯ (не закрытые):"
    gh api "repos/{owner}/{repo}/pulls/$pr/comments" -q \
      ".[] | select(.user.login==\"chatgpt-codex-connector[bot]\" and .original_commit_id==\"$sha\") | \"\(.path):\(.line // .original_line) — \(.body | gsub(\"<[^>]+>|!\\\\[[^]]*\\\\]\\\\([^)]*\\\\)\"; \"\") | split(\"\\n\") | map(select(length>0)) | .[0:3] | join(\" \"))\"" |
      head -20
    exit 2
  fi
  echo "Codex: замечаний нет"
fi

# 3. Слияние.
if [ "$(api "pulls/$pr" -q .mergeable_state)" = "dirty" ]; then
  echo "КОНФЛИКТ с main: влей main в ветку, проверь и запусти снова"
  exit 3
fi
if [ "$merge" = 0 ]; then echo "готово к слиянию"; exit 0; fi
api "pulls/$pr/merge" -X PUT -f merge_method=squash >/dev/null && echo "ВЛИТ в main" || { echo "слить не вышло"; exit 3; }
