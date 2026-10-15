# ADR-0027 — mock dispatcher, доказанная неотправка и ручной fallback

15.10.2026. CONFIRMED: перед AI-002 заданы вопросы, владелец подтвердил максимум **3 попытки всего** с задержками и повторной проверкой прав/лимитов, только при достоверной неотправке; timeout **60 секунд с настройкой**; другую модель пользователь выбирает **вручную**. Это разрешает AI-002, не AUTH-004/real providers/deploy.

## Решение

1. Два PostgreSQL metadata tables в additive0010, existing budget state получает timeout1..300s/default60. Постоянная БД не мигрируется этим заданием; прежние SQL0001..0009 не меняются. Jobs создаются вместе с резервом/outbox. Old reserved/pending допускает проверку, old dispatched/unknown не переотправляется.
2. Claim только назначает работу. Перед каждой отправкой live subject/session/auth_version, module/action/resource/ACL/model grant, неизменная approved mock price/expiry/bound, caps/freeze и policy/budget revision проверяются снова. Любая смена ревизии консервативно отменяет ещё не отправленную работу; новый запрос — через новый reserve. Worker не хранит raw cookies/CSRF/password/prompt.
3. До вызова адаптера commit sending intent + attempt + ledger dispatched. После этого crash/timeout/неизвестная ошибка **не** доказывают неотправку. Lease expiry переводит в unknown, резерв остаётся, автоматического повторного вызова нет. Нет DB lock во время await.
4. Только sealed in-process MockProvider может вернуть явный NotSent. Для transient NotSent повтор после1s/2s; не более3 попыток всего. Повтор использует тот же логический запрос/резерв, заново проверяет всё. Исчерпание или недоступная модель → release лишь при durable proof всех attempts=not_sent, manual_choice_required. Generic released после dispatched по-прежнему запрещён.
5. Неизвестный исход не переключает модель. Ручной выбор другой модели требует нового exact target/price/grant/budget reservation и idempotency fingerprint; этот slice не создаёт UI выбора или реальный provider adapter.
6. Lease fencing UUID не позволяет старому worker отправить после переназначения. Lease timeout=request timeout+15s; очередь ограничена5min до начала отправки. Это инженерные границы mock slice, не гарантии сетевого exactly-once. Late verified usage закрывает unknown ровно один раз даже после revoke/expiry. Потеря БД при settlement не даёт повторять provider call.

## Границы

Core0.9.0/schema0010_dispatcher, internal library hooks, без public spend/webhook API, без startup worker/real network. Generic REST/job/tool/WS paid gate остаётся закрытым. Существующие delegation APIs не получают AI capability; интеграция конкретных domain/jobs/tools/native требует отдельного scoped admission contract. Нет нового user data/response store: после await сохраняется только usage/метаданные, не текст.

Owner timeout hook использует существующий configure/session/CSRF/own-password reauth/revision/idempotency/audit. Console HTTP/интерфейс — AUTH-004. Crash до arm позволяет повторное назначение; crash после committed intent считается unknown даже если физическая отправка ещё не успела произойти. Нельзя одновременно обещать доказанное «ровно один сетевой вызов» и автоматически повторять неизвестные отправки без provider idempotency/receipts.

Recovery forward, preserve budgets/attempts/UUID/grants, не down/drop/reset. Старый core после0010 отказывает. [Контракт](../AI_DISPATCHER.md), [отчёт](../../reports/QUB-AI-002.md).
