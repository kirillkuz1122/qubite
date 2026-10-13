# Scoped policy gate — AUTH-003

Core0.5.0/schema0006_policy: действующий PostgreSQL gate и четыре HTTP маршрута плюс read-only WebSocket probe. [Машинный контракт](../../contracts/policy-v1.json), [ADR-0018](decisions/0018-scoped-policy-gate.md), [отчёт](../reports/QUB-AUTH-003.md). Это primitives для новых модулей: прежние Search/Writing/VPN/Tournaments ещё используют свои runtime и подключаются отдельными задачами. Реальные агенты, content API, Owner Console UI и бюджетный dispatcher отсутствуют.

## Подтверждённые правила

13.10.2026 владелец ответил: новому пользователю только аккаунт/профиль/настройки; модули вручную; read/write/manage раздельны. Выдача manage **не выдаёт автоматически read/write**. Membership viewer/editor/manager ограничивает разрешённые действия, но не заменяет ни module grant, ни ACL. Турнирные organizer/moderator/admin учитываются только при module=tournaments. Идентичность singleton owner даёт управление policy metadata, но не доступ к чужому содержимому или платному AI. Ключи приватных записей/vault этот слой не получает.

Цепочка для каждого объекта: active subject + current web session → известный installed/enabled module → точный allow(subject,module,action) с действующим сроком → enabled workspace membership/role → точное совпадение resource/workspace/module → точный allow(resource,subject,action). Отсутствие, deny или истечение срока на любом шаге запрещает операцию. Неизвестные IDs и чужие объекты возвращают одинаковый forbidden, без title/snippet/count/content. Membership/ACL не дают доступа без модуля; владелец workspace тоже проходит оба ограничения. Guest/shared-link authority пока не реализована и не принимается как web session.

Для ai дополнительно нужны точные provider/model и отдельный ai grant. После всех положительных разрешений runtime всё равно возвращает budget_gate_unavailable: AI-001/002 ещё не реализованы. Boolean budget/role/owner из тела запроса не принимается. Никакой provider callback на таком пути не вызывается; владелец не является исключением. Action ai не предполагает конкретный prompt/tool: dispatcher позже свяжет server-owned operation с permissions и атомарным reserve. Этот slice нельзя выдавать за готовый paid cost guard.

Принципы default deny, проверки каждого обращения и тестирования границ сверены с [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html). Конкретная модель Qubite определяется ответами владельца и кодом.

## HTTP

| Метод/путь | Поведение |
|---|---|
| GET /api/v1/me/access | Только собственные действующие module/action allow для installed/enabled модулей; это не object permission |
| GET /api/v1/owner/policy | Только singleton owner: global revision, список известного catalog с installed/enabled |
| POST /api/v1/policy/check | Точный Target; возвращает allowed/revision либо generic отказ; не возвращает capability для последующих команд |
| POST /api/v1/owner/policy/commands | Owner + доказанный собственный пароль и reauth≤300s; точный If-Match и Idempotency-Key UUID |

Target содержит module, action(read/write/manage/ai), workspace_id, resource_id; ai требует provider/model. Extra fields запрещены. Публичные grants actor из JSON не используют: действующий actor определяется через core session. Typed команды: module enabled, entitlement, workspace create, membership, resource metadata create, ACL, ai_grant. Политика объектов пока owner-managed; self-service sharing/workspace lifecycle будет обсуждаться в Docs/Teams. Это не редактор документов и не полноценный экран консоли.

Все четыре маршрута входят в strict AuthGuard: точные Host/Origin, no query, JSON≤8192bytes, duplicate credential/header rejection, same-origin CSRF для POST, typed core cookies, no-store/no-referrer. Ни legacy cookie, ни Bearer/refresh/API-key/delegation token не являются web session. GET catalog/access возвращают ETag вида `"policy-7"`; command требует этот точный If-Match (нет428, stale409) и Idempotency-Key. Повтор того же actor/key/body/expected revision возвращает прежний receipt без второго write/audit; иное содержимое с тем же key409. После повторного ответа нужно перечитать current catalog перед следующей командой.

Reason — только grant/revoke/configure/create/manual; произвольный текст не принимается. Срок grant в будущем, максимум365дней, либо бессрочный explicit grant. Отзыв — effect=deny или membership enabled=false или module enabled=false. Записи аккаунта, credential, содержимого и связей не удаляются.

## Jobs / tools / WebSocket

PolicyStore.execute_session выполняет trusted synchronous DB effect в одной транзакции с gate; `check_session` — только проверка, положительный receipt нельзя кешировать как разрешение. Domain adapter обязан использовать execute_* непосредственно перед DB effect/выдачей payload; callback не должен commit/rollback сам или выполнять необратимую внешнюю операцию. При списках/графе **каждый объект/конец связи** требует проверки: module grant или предварительный check не разрешает весь SQL-result. В этом slice бизнес-списков/графа/поискового индекса нет.

issue_delegation — внутренний adapter API, не публичный mint endpoint. После собственной session/CSRF и exact Target gate выдаётся random256-bit qbt_d_, в БД только SHA256. Capability bound к одному originating session UUID/auth_version, одной global policy revision, одному channel(job/tool/ws) и одному неизменному Target; TTL≤300s и не длиннее originating session. run_job/run_tool/execute_delegated повторно читают policy и session перед каждым effect. Нельзя расширить resource/action/channel, подставить web token, оживить старую capability новым grant. Любое изменение policy revision инвалидирует все такие capabilities; это консервативная invalidation, targeted generations возможны позднее. Detached durable jobs/native/scoped public keys потребуют AUTH-012/013 и будущего job runtime.

Delegations не продлевают browser session, одновременно≤32 на originating session; issue удаляет≤100 истёкших disposable metadata. Audit и domain data не очищаются. Не передавать token в URL/логи/browser storage. Issuance не создаёт реального agent/plugin/worker.

WS `/api/v1/policy/stream` — probe без приватного content/events. Нужны exact Host/Origin, current cookie, без query/subprotocol credentials. Первое сообщение≤4096bytes в15s: csrf_token + read-only Target. После allowed receipt клиент может отправлять только `{"type":"check"}`. Каждый ответ повторно проверяет права; idle connection проверяется раз в1s и закрывается1008 после revoke/expiry,1013 при unavailable. Максимальная жизнь300s, затем новое согласованное подключение. Payload send тоже проходит повторный gate. Для реального notification feed потребуется NOTIFY-001 с outbox, filtering и reconnect/cursor; ingress/server frame/connection/rate limits — release/DEPLOY задачи. Приложение проверяет размер принятого frame; сервер должен ограничивать размер до буферизации.

## SQL / конкурентность / recovery

0001..0005 неизменны. 0006 добавляет десять таблиц metadata: policy_state/modules/entitlements/workspaces/memberships/resources/acl/ai_grants/audit/delegations, всего21 domain/security tables core. Subject/session/owner UUID/FK сохраняются, миграция не выдаёт grants. Каталог19 будущих модулей seeded **installed=false/enabled=false**; включение enabled или выдача grant не устанавливает модуль. Наличие runnable domain engine и запись installed должен обеспечить trusted installer/module registrar в следующих slices; public owner command не меняет installed. Fixtures installed — synthetic metadata, не настоящая установка Docs.

Общий migration shared lock → policy shared/exclusive advisory lock → subject → session — фиксированный порядок. Все runtime policy mutations используют exclusive lock и increment глобальной revision вместе с structured before/after audit; gate/effect используют shared lock. Уже начатый DB effect завершается до commit revoke; **после успешного ответа revoke новые operations запрещены**. Это не отменяет уже завершённый effect/offline копии. Два одновременных admin If-Match имеют одного winner, остальные409. Audit failure откатывает grant и revision целиком. Raw operational SQL обходил бы protocol: runtime не использовать для выдачи прав SQL в обход command API.

Readiness проверяет migration checksums/table namespaces через pg_catalog; read-only role по-прежнему не читает domain data. Полностью пустой policy_state — операционная порча metadata, runtime возвращает503 policy_unavailable, schema-only readiness200; никаких silent repair. Runtime DB role/grants/connection pool и granular fingerprint уточняются в deploy/CORE-002, не объявлены завершёнными.

Recovery: остановить policy consumers/включение модулей, сохранить current core schema/UUID/grants/audit и backup новых данных, применить forward fix. Не запускать core0.4.0 против schema0006 (unknown history → refuse), не DROP/down/restore legacy authority. Полный backup/restore/staging перед реальной миграцией/деплоем отдельный approval. В этой задаче только ephemeral test databases.
