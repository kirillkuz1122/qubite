# Разработка: окружение и команды

**Состояние на 17.10.2026:** есть Rust-сервер (FND-001). Web-приложение и единые команды `just` появятся в FND-002 и FND-003.

## 1. Что нужно установить

| Инструмент | Зачем |
|---|---|
| Rust через rustup (версия закреплена в `rust-toolchain.toml`) | Сервер и общее ядро |
| Docker | Локальная PostgreSQL 18 + pgvector для разработки и тестов |
| Node.js 22+ и pnpm | Web, пакеты UI (с FND-002) |
| `just` | Единые команды проекта (с FND-003) |
| Tauri CLI и системные зависимости (WebKitGTK на Linux) | Desktop |
| Android SDK + JDK 17+ | Android и Ink |

## 2. Команды

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

### Целевые (появятся в FND-002/FND-003)

```bash
just setup   just dev   just check   just e2e   just desktop   just test-legacy
```

## 3. Локальная конфигурация

Скопировать [`.env.example`](../../.env.example) в `.env` и заполнить. Настоящие ключи провайдеров для разработки не нужны: AI, почта и OAuth работают через mock.

## 4. Старый Qubite

Запуск и тесты старой версии — в [`legacy/README.md`](../../legacy/README.md) и [CURRENT_STATE §4](../architecture/CURRENT_STATE.md).
