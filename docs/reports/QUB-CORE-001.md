# QUB-CORE-001 — отдельный FastAPI/PostgreSQL foundation

12.10.2026. Следующая задача по прямому запросу владельца после QUB-TEST-001. Создан отдельный `core/qubite`, legacy runtime не менялся. Пока review/testing до commit/remote/CI evidence.

## Сделано

- FastAPI factory с typed `GET /api/v1/health/live`, `/api/v1/health/ready`, `/api/v1/openapi.json`; без auth/domain endpoints. Liveness/startup независимы от БД, readiness строго read-only и только 200 при current schema history.
- Настройки только QUBITE_CORE_*; .env/legacy DATABASE_PATH не загружаются, SQLite/default/template/implicit/remote адреса запрещены. DB name отдельный qubite_core[_suffix], loopback only пока foundation. URL/errors/repr не раскрывают пароль/SQL; .pgpass/service configuration не используются.
- Explicit `python -m qubite.migrations check|apply`: 0001 namespace и technical migration ledger с SHA256/timestamps/PK, transactional SQL+metadata, advisory lock, idempotent repeat и отказ при changed/ahead/missing schema. No startup DDL/destructive down. Доменных/пользовательских таблиц ещё нет.
- OpenAPI v1 snapshot и exact pinned runtime requirements; runner включает новый core/contract/SQL в source-copy и новую required core suite. CI Ubuntu24.04 с native Postgres binaries, без включения системного PG сервиса/deploy.
- [Реализация/запуск](../../core/README.md), [архитектура](../architecture/CORE_FOUNDATION.md), [ADR-0009](../architecture/decisions/0009-core-foundation.md), обновлённые memory/handoff/tasks/security/docs.

## Реальные проверки

```sh
python3 scripts/engineering/verify.py --suite all --python /tmp/qubite-audit-venv/bin/python --postgres-bin /tmp/qubite-postgres-18.6/usr/bin
python3 -m unittest discover -s tests/engineering
python3 scripts/engineering/check.py
git diff --check
```

Локально Node22.22.2, Python3.14.7, PostgreSQL18.6, Psycopg3.3.6. **29 core pass**, все старые suites: Node94/deploy18/Search95/Brief112/Kwork29/SiYuan5 =353; core29 =382, harness4 = **386 pass**, fail/skipped/cancelled0. Existing Starlette/httpx deprecation и deploy ResourceWarnings остаются, зависимости ради них не менялись. Verification stdout временно `/tmp/qubite-core-full-verification.txt`, durable итог/условия здесь.

Core tests используют настоящий private PostgreSQL cluster: новый initdb в /tmp, loopback ephemeral port, SCRAM с random fixture password, отдельная database для каждого сценария, stop/drop/cleanup в finally. Локальные PG пакеты только извлечены в /tmp (SHA256 проверен по pacman extra metadata), без системной установки, Docker/daemon или обращения к существующему DB. Python зависимости добавлены только в временный test venv; production environments не трогали.

Проверено: no-network startup/legacy sentinel unchanged, no .env autoload, exact runtime OpenAPI, 404 чужие endpoints, unsafe config, timeout/PG service deny, read-only pending→ready без auto-create, missing/unreachable/drift/unknown version 503, sanitized errors, повторная migration, две concurrent independent connection calls apply exactly once, failed initial transaction rollback включая metadata, failed subsequent DDL rollback с сохранением прежней таблицы/ledger, read-only runtime role, explicit CLI и **настоящий дочерний uvicorn HTTP startup/readiness**.

Первый integration обнаружил некорректный libpq параметр service='': он вызывает lookup пустого service, а не отключает конфиг. Исправлено: PGSERVICE отклоняется явно, остальные адресные параметры заданы явно. Следующий targeted 27/27 passed; после добавления read-only role/real HTTP smoke полный all runner core29 passed. No skips и no PostgreSQL mock вместо database.

## Ограничения и продолжение

Это foundation, не реализованный Auth/permissions/budgets/Owner Console/React/бот или migration старых аккаунтов. DB currently loopback-only; final production PG version/TLS/roles/secrets/pool/installer ещё отдельные gates. Domain DATA_MODEL target, initial qubite_core пустой. Migration checksums проверяют shipped history, не любой semantic drift будущих tables; destructive rollback для user data не добавлялся. AUTH-L01..03 в legacy по-прежнему не исправлены, linking gate остаётся P0.

Рабочие DB/files/credentials/services, archived tournaments/tag, ShadeAI и production не изменены. Нет live API/paid calls/TG/HA/device tests/deploy; push только код. Backup/restore/cutover всё ещё отдельный этап. Skill db-schema-change прочитан, но специфичен Drizzle/SQLite и его pnpm/schema файлы неприменимы; Postgres metadata/transaction tests/ERD оформлены в core docs.

Следующая primary **QUB-DESIGN-001**: reviewable новый стиль и auth/navigation макет до React implementation/owner acceptance. После done CORE-001 также доступны dependencies уже согласованной AUTH-008 — identity cutover specification, без live writes. Этот цикл выполняет только CORE-001. Commit и GitHub evidence дополняются после сохранения отдельным docs follow-up, без self-hash цикла.
