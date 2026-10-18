# Единые команды разработки Qubite. Список: `just` или `just --list`.

set shell := ["bash", "-euo", "pipefail", "-c"]

db_url := "postgres://qubite:qubite@127.0.0.1:55432/postgres"

# Показать все команды
default:
    @just --list

# Первый запуск: зависимости JS, браузеры для тестов, локальная база
setup:
    pnpm install
    pnpm --filter @qubite/web exec playwright install firefox chromium
    scripts/dev-db.sh up
    @echo "Готово. Дальше: just dev"

# Запустить базу, Rust-сервер (:8080) и сайт (:5173) вместе; Ctrl+C останавливает всё
dev: db-up
    #!/usr/bin/env bash
    set -euo pipefail
    DATABASE_URL={{db_url}} cargo run --bin qubite -- serve &
    server=$!
    trap 'kill $server 2>/dev/null || true' EXIT
    pnpm dev

# Все проверки, как в CI: формат, линтеры, типы, тесты сервера и сайта, секреты
check: db-up check-server check-web secrets

# Проверки Rust-сервера
check-server: db-up
    cargo fmt --all --check
    cargo clippy --workspace --all-targets -- -D warnings
    TEST_DATABASE_URL={{db_url}} cargo test --workspace

# Проверки сайта и TS-пакетов (без браузеров)
check-web:
    pnpm format:check
    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm build

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

# Локальная база: запустить / остановить / состояние
db-up:
    @scripts/dev-db.sh up
db-down:
    @scripts/dev-db.sh down
db-status:
    @scripts/dev-db.sh status

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
