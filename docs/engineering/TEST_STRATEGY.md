# Тестовая стратегия

Baseline 12.10.2026: existing 65 Node tests и 18 deploy unittest прошли вне filesystem/socket sandbox; подробный итог изолированного harness см. [отчёт](../reports/QUB-001.md). npm test пока не агрегирует suites. Новые tests — catalog + grading characterization; полный tournament HTTP/E2E пока не готов.

## Пирамида и release gates

| Уровень | Scope | Команда/цель |
|---|---|---|
| Docs/tasks harness | schema/states/dependency cycles/approved ready/done evidence | python3 scripts/engineering/check.py; unittest tests/engineering |
| Legacy unit/domain | security/task-runtime/catalog/schema, grants/usage/keys | verify.py --suite node |
| Service contract/integration | auth/native enrollment/revoke, Search fetch/auth/ledger, Brief outbox/AI mocks, Kwork hooks, managers | verify.py --suite all --python <test-venv-python> |
| Новое Core integration | actual API + disposable Postgres migrations + concurrent locks + fake provider | отдельные test commands появятся после реализации core; два процесса для budget race |
| UI/E2E | owner/nonowner/denied direct URL, capture/offline/two-device/restore, legacy tournaments | Playwright fixtures + isolated HTTP, screenshot/viewports; команды создаются QUB-TEST-002/QUB-UI-001 |
| Hardware/performance | Android pen, crash/autosave/PDF/frame pacing; Pi simultaneous load | реальные устройство/нагрузка; fake device не закрывает acceptance |
| Ops | backup/restore/schema rollout/canary/rollback | disposable restore + read-only checks, production отдельно |

Critical legacy scenarios: register/login/logout/revoke/email/password reset/OAuth state and PKCE, blocked user; end catalog + hidden roster/code; individual/team join + deadline + late join; submission/grading/drafts/penalty + authoritative totals; rating history/no duplicate bonus/decay; services owner protection/revoke/budgets/key scopes; native API bindings; one bot; unknown sends paused.

Paid security: все access policy 10 cases, owner no budget, forged role/header, cross workspace/team/private graph/search/cache, public guests, MCP/plugin/WS/background bypass, 100 requests/two workers, period rollover/double settle/unknown delivery/revoke while job. Provider mock counter 0 при отказе. No real AI/TG/HA/Kwork endpoints в CI.

CI на push/PR только tests, без deployment credentials. Python dependency lock сохраняет воспроизводимость; Node npm ci использует существующий lock. Если required suite failed/missing dependencies/timeout — gate красный, не skip green. UI/typecheck/lint появятся с соответствующим кодом и будут required для его задач; сейчас не выдумывать команды для несуществующего React.

Тесты отдельных модулей проверяют helpers/router fixtures; passing suite не доказывает full server.js integration. Coverage измерять по risk/requirements, не строкам. Нет нового теста ради mirror implementation; нужны regression boundaries и failure cases. Формат evidence: command/runtime/date/fixture scope/counts/result/limitations. При ошибке среды отдельный bounded retry с той же изоляцией, не менять dependencies из-за необъяснённого hang.

Bot/analytics migration требует отдельного feature-parity review: mock Telegram updates/send transport, binding/revoke/scoped callbacks/exact reply/TTL/unknown delivery/single consumer. Infrastructure metrics тестируют load vs CPU%, host/cgroup/process units, counter reset, missing/stale values, UTC duration и multi-source dedup. Каждая legacy функция имеет target/test либо explicit retirement decision. [Матрица и обнаруженные нюансы](../architecture/TELEGRAM_AND_OBSERVABILITY.md).

Подтверждённый capture scope: text/voice без меню, durable raw→STT/classify/route→undo/link. Проверки: linked vs guest Support, exact force-reply priorities, duplicate update/content fingerprint, crash до/после ACK, voice partial download/STT failure, cost deny/raw Inbox, model injection/unknown target, undo после новых edits. Daily digest/critical event links — UTC/DST/restart/dedup/revoke/sensitive delivery и auth deep-link tests. Новые shared functions FastAPI сравниваются с synthetic legacy contract fixtures, не читают live SQLite.

## HTTP baseline Auth — QUB-TEST-001

Настоящий server.js в source-copy/temp SQLite; 25 сценариев register/login/session/reset/email-2FA/OAuth/CSRF/expiry/blocked/PKCE/Telegram signature. Только внешний transport mock, no real env/providers. Node suite теперь 94 pass; полный runner+harness 357 pass. [Отчёт и три воспроизводимых legacy дефекта](../reports/QUB-TEST-001.md). Characterization ожидания `legacy defect` нельзя переносить в новый Auth: это migration negative requirements, а не accepted behavior. Browser/provider/production acceptance остаются открытыми.

## PostgreSQL core foundation — QUB-CORE-001

29 real core cases: contracts/no-network startup/config denial/read-only readiness, actual native PG DDL+rollback/concurrency/drift/CLI, readonly runtime role и дочерний uvicorn HTTP smoke. `verify.py --suite core --python <venv-python> [--postgres-bin <native-bin>]` и required all. Missing binaries/dependencies fail без skip; fresh private cluster/database, no Docker/live storage. Локальный all+harness теперь386 pass. [Scope/evidence](../reports/QUB-CORE-001.md); migration history не полный semantic schema diff и не production acceptance.
