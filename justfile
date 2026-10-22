# Единые команды разработки Qubite. Список: `just` или `just --list`.

set shell := ["bash", "-euo", "pipefail", "-c"]
# .env читает сам `qubite` (D-282), не just: just искал бы его и в папках выше (у копии
# агента — .env основной копии), а тестам .env не нужен вовсе.

# База `just dev` (постоянная) и база тестов (своя, D-281) — scripts/dev-db.sh
dev_db_url := "postgres://qubite:qubite@127.0.0.1:55432/postgres"
test_db_url := "postgres://qubite:qubite@127.0.0.1:55433/postgres"
# Нет DATABASE_URL ни в окружении, ни в .env этой копии — локальная база разработки
use_dev_db := 'if [ -z "${DATABASE_URL:-}" ] && ! grep -qs "^DATABASE_URL=" .env; then export DATABASE_URL=' + dev_db_url + '; fi'

# Показать все команды
default:
    @just --list

# Первый запуск: зависимости JS, браузеры для тестов, локальная база
setup:
    pnpm install
    pnpm --filter @qubite/web exec playwright install firefox chromium
    scripts/dev-db.sh up
    git config core.hooksPath .githooks
    scripts/env-sync.sh
    @echo "Готово. Дальше: just dev"

# Запустить базу, Rust-сервер (:8080) и сайт (:5173) вместе; Ctrl+C останавливает всё
dev: db-up
    #!/usr/bin/env bash
    set -euo pipefail
    {{use_dev_db}}
    cargo run --bin qubite -- serve &
    server=$!
    trap 'kill $server 2>/dev/null || true' EXIT
    pnpm dev

# Все проверки, как в CI: формат, линтеры, типы, тесты сервера и сайта, клиент API, программа английского, секреты
check: db-up check-server check-web check-api check-english secrets

# Проверки Rust-сервера
check-server: db-up
    cargo fmt --all --check
    cargo clippy --workspace --all-targets -- -D warnings
    TEST_DATABASE_URL="${TEST_DATABASE_URL:-{{test_db_url}}}" cargo test --workspace

# Проверки сайта и TS-пакетов (без браузеров)
check-web:
    pnpm format:check
    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm build

# Программа английского (content/english) — по схемам и без битых связей (ENG-000)
check-english:
    node scripts/check-english.mjs

# Клиент API совпадает с описанием сервера (как в CI): перегенерировать и сравнить
check-api:
    #!/usr/bin/env bash
    set -euo pipefail
    pnpm gen:api
    git diff --exit-code -- packages/api-client || {
        echo "Клиент API устарел: закоммить изменения в packages/api-client (их только что сделал pnpm gen:api)" >&2
        exit 1
    }

# Браузерные тесты: Firefox, Chromium, Firefox на ширине телефона
e2e:
    pnpm e2e

# Привести код к общему стилю
fmt:
    cargo fmt --all
    pnpm format

# Перегенерировать клиент API после изменения сервера
gen-api:
    pnpm gen:api

# Архив релиза в dist/release (цель по умолчанию — эта машина, например `just release aarch64-unknown-linux-gnu`)
release target="":
    scripts/release.sh {{target}}

# Поиск паролей и ключей в коммитах, ещё не отправленных на GitHub, и в подготовленных изменениях
secrets:
    #!/usr/bin/env bash
    set -euo pipefail
    range="$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo origin/main)..HEAD"
    docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.30.1 git --no-banner --redact --log-opts="$range" .
    docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.30.1 git --no-banner --redact --staged .

# Локальные базы (разработка и тесты): запустить / остановить (данные остаются) / состояние / стереть данные разработки
db-up:
    @scripts/dev-db.sh up
db-down:
    @scripts/dev-db.sh down
db-status:
    @scripts/dev-db.sh status
db-reset:
    @scripts/dev-db.sh reset

# Дописать в .env новые переменные из .env.example (заполненное не трогает; после git pull — само)
env-sync:
    @scripts/env-sync.sh

# Команда сервера с настройками из .env, например `just qubite ai chatgpt login`
qubite *args: db-up
    #!/usr/bin/env bash
    set -euo pipefail
    {{use_dev_db}}
    cargo run -q --bin qubite -- {{args}}

# Ключи push в браузере (PLAN-004): напечатать строку QUBITE_PUSH_VAPID_KEY для .env
push-keys:
    cargo run -q --bin qubite -- push keys

# Тесты старого Qubite (legacy/qubite-v1), 321 тест
test-legacy:
    #!/usr/bin/env bash
    set -euo pipefail
    cd legacy/qubite-v1
    (cd back && npm ci --no-audit --no-fund >/dev/null) && node --test back/tests/*.test.js
    python3 -m unittest discover -s deploy/services/tests
    (cd services/search && uv run --no-project --with pytest --with-requirements requirements.txt python -m pytest -q -p no:cacheprovider)
    (cd services/specbot && PYTHONPATH=../../integrations/kwork uv run --no-project --with pytest --with requests --with telethon --with pypdf --with-requirements requirements.txt python -m pytest -q -p no:cacheprovider)
    (cd integrations/kwork && uv run --no-project --with pytest --with httpx --with requests --with telethon --with pypdf python -m pytest -q -p no:cacheprovider)
    (cd integrations/qubite-siyuan && uv run --no-project --with pytest --with httpx python -m pytest -q -p no:cacheprovider)
