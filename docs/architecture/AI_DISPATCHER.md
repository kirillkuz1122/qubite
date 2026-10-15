# AI-002 — внутренний контракт mock dispatcher

Core0.9.0/current0010_dispatcher, [решение владельца](decisions/0027-mock-dispatcher-and-safe-retries.md). Это управляемый вызов in-process MockProvider с durable accounting, не включение платных провайдеров. Полная Owner Console/HTTP controls — следующая AUTH-004 после вопросов; ключи/SMTP/native/deploy отдельно.

## API библиотеки и данные

`BudgetStore.reserve` по-прежнему требует текущую session/CSRF и live exact module/action/resource/provider/model rights. В одном commit создаёт invocation, allocations, outbox и ai_dispatch_jobs. Prompt не сохраняется. Dispatcher получает payload bytes≤65536 только при выполнении и проверяет его SHA256 против исходного fingerprint (target+price+bound+payload_hash); сам payload после этого не попадает в БД/logs/outbox.

`Dispatcher.claim(invocation_id=None)` — trusted scheduling hook, `FOR UPDATE SKIP LOCKED` на invocation, затем job lock. Возвращает invocation UUID/fencing token, но не разрешение на расход. `arm` проверяет исходную session по UUID, не продлевая её; subject→session locks до invocation, как существующий Auth. Заблокированный/удалённый/expired/revoked/auth-version-mismatched principal не отправляет. Scope — исходная точная операция, не расширение прав worker.

`run(claim,payload,provider)` допускает **ровно тип MockProvider**, без subclass/callback/URL/key injection. `arm` коммитит sending intent до `await provider.send`; timeout через asyncio, default60s. Worker не держит DB/permission locks во время вызова. Отдельные `arm/finish` — trusted hooks для fault injection/reconciliation, не публичные capabilities. Вызов адаптера напрямую не является разрешённым пользовательским маршрутом.

`finish` принимает только Success(verified Usage), NotSent(proven no delivery) или unknown. Settlement сохраняет полный actual и existing over-bound freeze. Finish не требует действующей исходной session: уже произошедший расход учитывается после revoke. `recover(limit≤100)` обрабатывает по одному invocation на транзакцию, чтобы не копить locks разных users/routes/periods. Status hook — только internal metadata; будущий HTTP adapter обязан добавить owner/own-resource access checks.

Линеаризация разрешения — commit sending intent. Revoke до него даёт0 calls; revoke после него не отменяет уже принятую in-flight попытку и не обнуляет usage. Gap между commit и физическим send остаётся консервативно in-flight/unknown; без удержания DB locks во время сети нельзя обещать отзыв задним числом. Новые attempts/reservations после revoke запрещаются. Противоречивый duplicate usage даёт conflict, а не скрытое успешное списание.

Два новых tables (итого40):

| Таблица | Поля/смысл |
|---|---|
| ai_dispatch_jobs | queued/leased/sending/retry_wait/unknown/released/settled, fencing token+lease_until, attempts0..3, next_attempt_at, queue expiry, snapshot timeout, structured reason |
| ai_dispatch_attempts | invocation+number unique, lease token unique, per-attempt trace UUID, sending/not_sent/succeeded/unknown, started/deadline/finished; без raw payload/response |

Budget state получает timeout_seconds1..300/default60, owner configure command `DispatchSettings`. Команда использует existing reauth/CSRF/expected revision/idempotency/before-after audit и меняет policy revision. Уже queued jobs с прежней ревизией отменяются; новые reserve используют новую timeout snapshot. Per-attempt trace UUID отличается от стабильного logical provider_request_id invocation: только logical ID передаётся mock adapter для одного запроса.

## Проверки перед каждой попыткой

- Текущий active subject, исходная unrevoked/unexpired session и auth_version; module installed+enabled, независимый entitlement ai, membership, exact resource/ACL, exact provider/model grant. Owner без bypass.
- Provider только mock; immutable approved price ID/model/currency/expiry и quote upper bound неизменны. Unknown price →0calls. Route freeze блокирует отправку.
- Policy/budget revision исходного reserve совпадает. Изменения settings/grants отменяют stale pending authority, даже когда unrelated; это консервативно и явно. Прямые текущие caps также проверяются, обязательные global/user all money caps должны существовать; spent+reserved+old-period carry≤cap. Собственный резерв не прибавляется второй раз.
- Fencing token/lease/status и исходный payload fingerprint. Mismatch не отправляет и не разрушает корректный резерв; после expiry старый claim бесполезен. Queue TTL5min относится только к ожиданию начала; уже sending работа не освобождается по TTL.

## Retry и неопределённость

| Событие | Действие |
|---|---|
| Crash после claim, до committed arm | Lease истекает, новый fencing token; проверки повторно, attempts не увеличены |
| Durable explicit transient NotSent | Резерв сохраняется, retry_wait1s затем2s, не более3 total attempts |
| Права/цена/бюджет изменились до первой отправки или между proven NotSent |0 новых вызовов; release лишь reserved либо durable all-attempts-not_sent proof |
| Недоступная модель/исчерпаны3 safe attempts | Release proven no-delivery, manual_choice_required; другой model не вызывается |
| Crash после committed sending intent, включая gap до фактического send | Unknown после lease, резерв не снимается; не повторять |
| Timeout/исключение/отмена coroutine/невалидный результат | Unknown, reserve удержан, no fallback/retry |
| Сбой settlement write | TX rollback, sending/unknown+reserve сохраняются, provider не повторяется |
| Late trusted actual usage | Exactly-once settlement исходных buckets, даже после revoke; полный actual/freeze по AI-001 |

Generic `BudgetStore.record(...,'released')` после dispatched запрещён. Исключение — **private transactional helper** диспетчера с проверкой durable attempts>0 и bool_and(state=not_sent); не user/admin checkbox. Late definitive NotSent после unknown может закрыть доказанную неотправку, но не возобновляет автоматические попытки. Same attempt NotSent/Success duplicate не увеличивает attempts/ledger; stale token не запускает повтор.

Ни таймаут, ни отмена UI, ни смена дня/месяца не являются подтверждением бесплатности. Новая ручная операция — новый явный запрос; исходный unknown расход сохраняется. Автоматического выбора другой модели в этом slice нет, включая ранее разрешённую более дешёвую модель.

## Проверки и эксплуатация

`python3 scripts/engineering/verify.py --suite dispatcher --python <test-python> --postgres-bin <native-bin>`: source-copy, isolated HOME и disposable PostgreSQL, без env/external network. Fault injection закрывает process death до/после arm/send, two process100 claims, revoke/caps/price/unknown/timeout/settle DB failures; browser/old service regressions отдельно. Fresh0010 строит jobs для старого outbox: только old reserved+pending queued; old dispatched/unknown никогда автоматически не выполняются. Старые SQL0001..0009 не меняются; всё accounting сохраняется.

Инженерная опора: [PostgreSQL SELECT locking](https://www.postgresql.org/docs/current/sql-select.html) описывает SKIP LOCKED для конкурирующих consumers; [Python asyncio timeout](https://docs.python.org/3/library/asyncio-task.html) — отмену ожидания. Из этих механизмов не следует доказанная отмена/бесплатность внешней операции; поэтому unknown остаётся зарезервированным.

Startup/readiness не применяют0010 и не запускают worker. Real network/provider receipts/webhook authentication, provider idempotency и per-domain agent/tool delegation admission — будущие согласованные задачи, без заявления live acceptance. Permanent migration только после отдельного inventory/backup/restore/staging/approval; forward recovery, preserve new attempts/ledger и fail closed на старом binary.
