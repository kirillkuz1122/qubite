#!/usr/bin/env bash
# Единая проверка Qubite (HAR-001, D-626): её запускают Claude (хук), Codex и CI.
# Вывод короткий: строка на шаг; при падении — до 15 строк ошибки этого шага.
#
#   scripts/check.sh          — только то, что задето изменениями (против origin/main)
#   scripts/check.sh --quick  — то же без тестов и сборки (для хука в конце хода)
#   scripts/check.sh --all    — всё, как `just check`
set -uo pipefail
cd "$(dirname "$0")/.."

mode=changed
case "${1:-}" in
  --quick) mode=quick ;;
  --all) mode=all ;;
  "") ;;
  *) echo "Использование: scripts/check.sh [--quick|--all]" >&2; exit 2 ;;
esac

log=$(mktemp -d)
trap 'rm -rf "$log"' EXIT
failed=0

# Шаг: имя, команда. Полный вывод — во временный файл, на экран — итог.
step() {
  local name=$1; shift
  local start=$SECONDS out="$log/$(echo "$name" | tr ' /' '__').log"
  if "$@" >"$out" 2>&1; then
    printf '✓ %s — %sс\n' "$name" $((SECONDS - start))
  else
    printf '✗ %s — %sс\n' "$name" $((SECONDS - start))
    # Сначала строки с ошибками, иначе — хвост вывода
    { grep -E -i -m 15 'error|fail|✗|warn|panicked|не |устар' "$out" || tail -n 15 "$out"; } | cut -c1-200 | sed 's/^/    /'
    failed=1
  fi
}

# Что изменилось: коммиты против origin/main + незакоммиченное + новые файлы
if [ "$mode" = all ]; then
  changed=ALL
else
  base=$(git merge-base HEAD origin/main 2>/dev/null || echo HEAD)
  changed=$( { git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u)
fi
touched() { [ "$changed" = ALL ] || grep -qE "$1" <<<"$changed"; }

# Харнес: короткие файлы остаются короткими (D-624)
harness() {
  local ok=0
  check_len() { local n; n=$(wc -l <"$1"); [ "$n" -le "$2" ] || { echo "$1: $n строк, можно не больше $2"; ok=1; }; }
  check_len AGENTS.md 60
  check_len CLAUDE.md 15
  check_len docs/project/STATUS.md 80
  check_len docs/plan/TASKS.md 40
  return $ok
}
step "харнес" harness

rust='^(crates/|Cargo\.(toml|lock)|rust-toolchain)'
web='^(apps/|packages/|package\.json|pnpm-|tsconfig|eslint)'

if touched "$rust"; then
  step "rust: формат" cargo fmt --all --check
  step "rust: clippy" cargo clippy --workspace --all-targets --quiet -- -D warnings
  if [ "$mode" != quick ]; then
    if scripts/dev-db.sh up >"$log/db.log" 2>&1; then
      step "rust: тесты" env TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://qubite:qubite@127.0.0.1:55433/postgres}" cargo test --workspace --quiet
    else
      echo "✗ rust: тесты — нет базы (scripts/dev-db.sh up)"; failed=1
    fi
    step "клиент API" bash -c 'pnpm -s gen:api && git diff --exit-code --stat -- packages/api-client'
  fi
fi

if touched "$web"; then
  step "web: формат" pnpm -s format:check
  step "web: линтер" pnpm -s lint
  step "web: типы" pnpm -s typecheck
  if [ "$mode" != quick ]; then
    step "web: тесты" pnpm -s test
    step "web: сборка" pnpm -s build
  fi
fi

if touched '^(content/english/|scripts/check-english)'; then
  step "английский" node scripts/check-english.mjs
fi

if touched '^\.github/'; then
  step "формат CI" pnpm -s exec prettier --check .github
fi

[ "$failed" = 0 ] && echo "Всё зелёное." || echo "Есть ошибки. Полный вывод — запусти команду шага руками."
exit $failed
