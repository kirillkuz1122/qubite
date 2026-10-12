# ADR-0009: локальный core foundation и явная SQL migration

Принято инженером 12.10.2026 внутри одобренной QUB-CORE-001 по запросу владельца «след задачу делай». Это bounded implementation detail стека ADR-0001, не дополнительное разрешение на live migration или final ORM всех модулей.

Решение: independent FastAPI factory + Pydantic responses, Psycopg3/Postgres, API v1/OpenAPI snapshot, liveness отдельно от read-only storage readiness. Никаких imports/reads/writes legacy DB; scoped env без autoload. Первый slice допускает только explicit loopback DB/dedicated name. Remote/TLS/secret provisioning и runtime pool — future deployment/task decisions.

Первая явная SQL migration создаёт core namespace, отдельный technical ledger версий/checksum/timestamps. Transaction/advisory lock, exact history prefix, fail closed при drift/ahead/missing schema, no startup DDL/no automated down. Схема user/domain ещё не создаётся. Для initial metadata SQL короче ORM/bootstrap Alembic; когда появится доменная schema, отдельно оценить ORM/tooling и совместимость уже применённого ledger, без переписывания applied history.

Альтернатива: auto create_all/startup migration не выбрана — может менять storage до проверки. SQLite вместо настоящего PostgreSQL integration не выбрана — не проверит locks/transactions/DDL. Docker/system database не нужны тестам: native initdb создаёт новый private cluster в /tmp; отсутствие binaries — fail, no skip.

Следствия: 29 integration/negative/real HTTP cases + source-copy harness; API runtime может работать без DDL permissions, migration — отдельная команда/operator role. Действующие services/DB не трогаем, deploy/cutover только после inventory/backups/restore и разрешения. [Реализованный контракт/границы](../CORE_FOUNDATION.md), [evidence](../../reports/QUB-CORE-001.md).
