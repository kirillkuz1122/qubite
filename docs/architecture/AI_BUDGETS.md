# AI-001 — внутренний контракт mock budget accounting

Core0.8.0/schema0009_budgets. Согласованные решения в [ADR-0026](decisions/0026-atomic-mock-budgets.md). Реализация `core/qubite/ai/`; новый публичный AI API отсутствует. Доступ к реальным провайдерам остаётся закрытым существующим Policy Gate.

## Область действия

`BudgetStore.reserve` — доверенный server hook с действующей web session/CSRF, exact Target(action=ai/provider=mock), approved price UUID, серверной верхней границей usage, UUID idempotency key и 32-byte hash payload. Client actor/cost/budget booleans не принимаются; prompt/секреты не сохраняются. Generic policy/check и execute_session не становятся разрешением paid effects. Delegated job/tool/WS остаются в прежней закрытой paid границе, их budget dispatcher — AI-002.

`configuration/configure` — внутренние owner hooks для будущего Console adapter: session/CSRF/own-password reauth≤5min, expected budget revision, UUID command id, atomic metadata-only before/after audit. Commands: limit, timezone, immutable mock price, bind_project. Budget changes увеличивают также policy revision и консервативно инвалидируют старые delegations. Нет reset/delete/infinite-budget/unfreeze command. AUTH-004 добавляет HTTP guard/UX, а не обход этих hooks.

Глобальный и пользовательский `all` денежные caps обязательны. Daily/monthly/money/request/token limits модулей/проектов/моделей независимы; все заданные пересекаются. Null отдельной размерности — предел не установлен; 0 — отказ. Это не выдаёт model/module grants. Owner тратит только со своими resource/grant/budget, без bypass. Hourly quota extensions, ruble presentation и provider prices не входят в текущий day/month/all контракт.

## Схема

0009 добавляет 12 таблиц (итого38), без positive grants/caps/price seeds:

| Таблица | Назначение |
|---|---|
| ai_budget_state | ревизия и IANA timezone, Asia/Yekaterinburg по умолчанию |
| ai_budget_accounts | unique scope/key, стабильный accounting identity |
| ai_budget_limits | явные money/request/token caps по account/period |
| ai_budget_buckets | spent/reserved integers, неизменные start/end/timezone периода |
| ai_budget_prices | утверждённые неизменяемые mock price snapshots |
| ai_budget_project_bindings | owner связь policy resource→projects resource, один workspace |
| ai_budget_invocations | session/subject, unique subject/key, fingerprint, exact target/bound/price/revisions/state/usage |
| ai_budget_allocations | исходные buckets каждого invocation |
| ai_budget_outbox | pending/marked/closed bookkeeping, пока без отправляющего worker |
| ai_budget_events | UUID события и повторные подтверждения; semantic duplicate не списывает повторно |
| ai_budget_freezes | exact provider/model freeze при нарушении bound, durable alert evidence |
| ai_budget_audit | versioned owner configuration commands, без содержимого запросов |

Вызов пишет day/month/all для global/user/module/model и для привязанного project. Caps не дублируются как новые записи после каждого изменения. У каждой денежной операции одна логическая стоимость; несколько bucket allocations — пересекающиеся ограничения, их **нельзя суммировать** как общий расход. Для платформенного total использовать global/all; для user — user/all. Finance personal ledger — другой домен.

## Периоды и смена настроек

Boundaries вычисляются по IANA зоне; DST даёт естественные23/25 часов. Границы и timezone уже созданного bucket не переписываются. Изменённая зона применяется после его конца; очередной start=max(calendar start, previous end), без повторного allowance. Новый дополнительный лимит использует уже существующий текущий ledger. All-time суммы и old unknown reserve сохраняются. Old-period reserved money/requests/tokens уменьшают свободное место нового периода; settled usage остаётся в исходных buckets. Сдвиг clock до начала уже созданного периода блокирует новый reserve.

Снижение cap ниже spent/reserved сохраняет все суммы и запрещает новые резервы. Повышение не сбрасывает прошлый расход. Unknown не освобождается по истечению времени/при смене месяца; подтверждённый usage закрывает его даже после revoke/expiry исходной session. Bookkeeping settlement не требует действующего пользовательского разрешения, поскольку расход уже произошёл; обращаться к hook может только trusted mock adapter, публичного webhook нет.

## Транзакции и состояния

1. Migration shared gate → policy lock → live Auth/permissions → budget config shared lock → idempotency/route locks → stable account order → sorted buckets. Owner configure использует policy+budget exclusive. Row lock защищает cap при разных users/models/processes. Не держим DB locks во время сети: сетевого кода в этом slice нет. [Официальная семантика PostgreSQL locks](https://www.postgresql.org/docs/current/explicit-locking.html).
2. Quote: ceil каждого input/output token charge плюс upper fixed charge, точные целые micro-USD. Проверка model/version/expiry/bound перед reserve; all caps проверяются вместе с request=1 и max tokens. В одном commit invocation, allocations, counters, pending outbox. Ошибка любого write откатывает всё.
3. Same subject/key+fingerprint возвращает current status; другой payload/target/price/bound →409. Live grant revoke запрещает даже read-through повтор reserve. Receipt не reusable capability; dispatch повторно проверит права в AI-002.
4. reserved→dispatched→settled; reserved→released; dispatched→unknown→settled. После dispatched release запрещён. Один semantic settle при многократных callbacks/event IDs; reused event/provider request ID не относится к другому invocation.
5. Settlement заменяет reserve полным actual money/usage и освобождает остаток. Actual выше любой input/output bound или money estimate создаёт freeze для всех price versions данного mock route. Accounting не обрезается до cap; величина finite per-call fields bounded, SQL bigint overflow вызывает rollback, сохраняет reserve и требует recovery, а не truncated amount.

Неизвестная/неверная/expired цена, неизвестный timezone, missing/zero/exhausted cap, malformed strict integers, unauthorized target/session/CSRF дают отказ до записи резерва. DB errors санитизируются existing Auth database wrapper. Automatic DB/provider retry, lease/recovery workers, real webhook authentication, external prices и реальные alerts — следующие отдельные slices.

Hard cap предотвращает допуск по корректной верхней оценке; невозможность предотвратить неверное биллингом превышение **не скрывается**. Mock tests проверяют запись всей actual стоимости и freeze. Никакой заявленной production/provider acceptance.

## Проверки и эксплуатация

`python3 scripts/engineering/verify.py --suite budgets --python <test-python> --postgres-bin <native-bin>`: source-copy без env, disposable PostgreSQL, два spawn процесса, 100 запросов разных пользователей/моделей. Unit календарь/округление плюс транзакционные/cap/идемпотентность/unknown/forward recovery cases. [Python IANA ZoneInfo](https://docs.python.org/3/library/zoneinfo.html) использует установленную базу зон; неизвестная зона fail closed. PostgreSQL должен быть disposable test fixture; startup/readiness не выполняют0009.

Постоянная migration отдельно: inventory/backup/restore/staging/явное разрешение. Не удалять новые buckets/events при recovery, не изменять прежние migrations; отклонить старый core, выполнить forward fix. Legacy, заполненный deploy/.env, private env/DB и сервер этим slice не трогаются.
