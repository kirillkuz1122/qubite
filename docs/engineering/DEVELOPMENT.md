# Разработка: окружение и команды

**Состояние на 17.10.2026:** есть Rust-сервер (FND-001), web-приложение (FND-002) и единые команды `just` (FND-003).

## 1. Что нужно установить

| Инструмент | Зачем |
|---|---|
| Rust через rustup (версия закреплена в `rust-toolchain.toml`) | Сервер и общее ядро |
| Docker | Локальная PostgreSQL 18 + pgvector для разработки и тестов |
| Node.js 22+ и pnpm | Web и TS-пакеты |
| `just` (`cargo install just` или пакет системы) | Единые команды проекта |
| Tauri CLI и системные зависимости (WebKitGTK на Linux) | Desktop |
| Android SDK + JDK 17+ | Android и Ink |

## 2. Команды

### Коротко: `just`

```bash
just            # список всех команд
just setup      # первый запуск: зависимости, браузеры для тестов, локальная база
just dev        # база + Rust-сервер (:8080) + сайт (:5173); Ctrl+C останавливает всё
just check      # всё, что проверяет CI: формат, линтеры, типы, тесты сервера и сайта, секреты
just e2e        # браузерные тесты (Firefox, Chromium, телефон)
just fmt        # привести код к общему стилю
just gen-api    # обновить клиент API после изменения сервера
just secrets    # поиск паролей и ключей в неотправленных коммитах
just test-legacy  # 321 тест старого Qubite
just db-up | db-down | db-status
```

Ниже — то же самое по шагам, без `just`.

### Сервер (работает сейчас)

```bash
# 1. Поднять локальную PostgreSQL 18 + pgvector в Docker (порт 55432)
scripts/dev-db.sh up

# 2. Проверки: форматирование, линтер, все тесты
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
eval "$(scripts/dev-db.sh env)"      # задаёт TEST_DATABASE_URL
cargo test --workspace

# 3. Запустить сервер
DATABASE_URL=postgres://qubite:qubite@127.0.0.1:55432/postgres cargo run --bin qubite -- serve
curl http://127.0.0.1:8080/api/health        # жив ли процесс
curl http://127.0.0.1:8080/api/ready         # отвечает ли база, применены ли миграции
curl http://127.0.0.1:8080/api/openapi.json  # описание API

# Остальные команды бинарника
cargo run --bin qubite -- migrate        # только применить миграции
cargo run --bin qubite -- version
cargo run --bin qubite -- serve --help   # все настройки (у каждой есть переменная окружения)

scripts/dev-db.sh down                   # остановить базу (данные в памяти — пропадут)
```

Версия Rust закреплена в `rust-toolchain.toml` (1.99.0), rustup сам поставит нужную.

### Web (работает сейчас)

```bash
pnpm install                 # зависимости JS (pnpm 12, Node 22+)
pnpm dev                     # сайт на http://localhost:5173, /api проксируется на Rust-сервер :8080
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm gen:api                 # перегенерировать клиент API после изменения сервера
pnpm --filter @qubite/web exec playwright install firefox chromium   # один раз
pnpm e2e                     # браузерные тесты: Firefox, Chromium, Firefox на ширине телефона
```

Адрес сервера для прокси можно поменять переменной `QUBITE_API` (по умолчанию `http://127.0.0.1:8080`).

## 3. Локальная конфигурация

Скопировать [`.env.example`](../../.env.example) в `.env` и заполнить. Настоящие ключи провайдеров для разработки не нужны: AI, почта и OAuth работают через mock.

## 4. Старый Qubite

Запуск и тесты старой версии — в [`legacy/README.md`](../../legacy/README.md) и [CURRENT_STATE §4](../architecture/CURRENT_STATE.md).
