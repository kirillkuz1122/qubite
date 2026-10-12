# Qubite Core — foundation 0.1.0

Отдельное FastAPI-приложение Qubite 2.0. Пока есть только health/readiness/OpenAPI и явная PostgreSQL миграция технических namespaces. Auth/Owner Console/доменные таблицы/React/Telegram здесь ещё не реализованы. Legacy Node/SQLite работает отдельно, импортов или подключения к нему нет.

## Локальный запуск

Из корня checkout, в отдельном виртуальном окружении:

```sh
python3 -m venv core/.venv
core/.venv/bin/python -m pip install -r core/requirements.lock
PYTHONPATH=core core/.venv/bin/python -m uvicorn qubite.app:create_app --factory --host 127.0.0.1 --port 9210
```

Без `QUBITE_CORE_DATABASE_URL` liveness возвращает 200, readiness — 503 `storage_not_configured`. Приложение не загружает .env, не открывает БД при import/startup и не выполняет миграции автоматически. Нужны только core-specific переменные. Если у отдельного локального PostgreSQL уже создана пустая dedicated база, URL хранить приватно, не публиковать и не вставлять пароль в командную историю. Формат: `postgresql://<user>:<password>@127.0.0.1:<port>/qubite_core` (или `qubite_core_<suffix>`), с явными user/IP/port/database. Foundation допускает только loopback IP; remote DB/TLS/секреты/пулы прорабатываются перед deploy отдельно. SQLite URL и существующий legacy DATABASE_PATH не используются.

## Явная миграция

После задания core URL в приватном окружении:

```sh
PYTHONPATH=core core/.venv/bin/python -m qubite.migrations check
PYTHONPATH=core core/.venv/bin/python -m qubite.migrations apply
PYTHONPATH=core core/.venv/bin/python -m qubite.migrations check
```

`check` только читает, при pending/drift/unavailable возвращает код 1. `apply` выполняет транзакцию SQL+ledger под advisory lock. Повторный apply возвращает already current; неизвестная/изменённая история и потерянный core schema требуют явного recovery, автоматически не ремонтируются. API account может быть read-only, migration account отдельно. Никакой автоматической down/delete команды нет; restore/cutover требуют отдельного runbook/backup. Не запускать миграции на live данных по факту появления нового кода.

## API v1

- `GET /api/v1/health/live` — процесс способен отвечать, без БД.
- `GET /api/v1/health/ready` — только 200 ready при доступной PostgreSQL и актуальной migration history/core namespace; иначе 503 с общим кодом. Нет DSN/SQL/user/private error в ответе.
- `GET /api/v1/openapi.json` — OpenAPI; версионированный контракт `contracts/core-v1.json` должен совпадать с runtime.

## Проверка

```sh
python3 scripts/engineering/verify.py --suite core --python <test-venv-python> --postgres-bin <path-to-initdb-and-postgres>
```

Harness требует pytest/runtime зависимости из `scripts/engineering/test-requirements.lock`. Native PostgreSQL может быть установлен заранее или извлечён в отдельный /tmp; тесты сами создают/завершают private cluster с ephemeral loopback port и отдельной БД для каждого сценария. Ничего не скачивают автоматически, не требуют Docker/system service/реальных credentials. В Ubuntu CI native binaries обнаруживаются в `/usr/lib/postgresql/*/bin`; при отсутствии prerequisite тесты fail, не skip. Детали: [foundation](../docs/architecture/CORE_FOUNDATION.md), [отчёт](../docs/reports/QUB-CORE-001.md).
