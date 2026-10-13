# Отчёт QUB-AUTH-006 — управляемая регистрация

Дата13.10.2026. Один bounded cycle. Перед реализацией вопросы заданы, владелец ответил: registration switch, оба вида приглашений, вход после email verification. Общие switches и ChatGPT он разрешил сохранить в плане. **Done: implementation2035e1e, exact-SHA CI38390796988 success. Final evidence ниже.**

Старт main/origin6293a5907d14fc78905b16a4662c59a3ce979662, clean. Remote tournaments/qubite-v1.0 оба96f0457a523b6b79f21c4092056d8fa8fa69a680 до изменений; immutable archive. Root master/access не изменены, source trace сохраняется. V2 kickoff отсутствует, актуальный kickoff без V2. No skills/subagents/quota reset/личная память writes.

## Результат

- Core0.6.0/schema0007_registration,25 domain/security tables; только новая forward SQL0007,0001..0006 неизменны. API startup без DDL/owner/password/send. Real tests — disposable PG, не production migration.
- Minimal strict register email/password/consent_version/consent_accepted; optional name/invite_token. Нет login alias/ФИО/школы/класса/account codes. Pending UUID → verify → explicit login; no owner/module/model grants.
- Owner API mode invite/default, public, disabled; If-Match/revision/live gates. Email-bound и transferable одноразовые invite, TTL/revoke, hash-only256bits, token only once. Idempotency command UUID предотвращает повторный выпуск; after lost response revoke/reissue, no replay token.
- Canonical collision202 без overwrites/resend/invite consume; subject/credential/consent/redemption/audit atomic. Rates/preauth commit перед hashing, state/revoke проверка после hashing, no locks во время Argon2/mock delivery.
- AUTH-011 internal dispatcher переиспользован после успешного account commit; mock-only. Disabled/no transport503 до создания; отказ mock transport оставляет recoverable pending, verify/request retry. Reset и explicit OAuth linking сохраняют UUID.
- [Регистрация/ограничения](../architecture/REGISTRATION.md), [ADR-0020](../architecture/decisions/0020-owner-controlled-registration.md), [machine contract](../../contracts/registration-v1.json), обновлённый OpenAPI/identity-v2 partial implementation.
- Legacy backend/UI/Search/Writing/VPN/Tournaments/.env/deploy/demo/ShadeAI не изменены. Исторические дефекты legacy не выдаём за исправленные. Push не deployment.

## Пожелания и границы

Добавлены backlog AUTH-015 global login/maintenance/provider controls и anti-lockout; AUTH-016 официальный ChatGPT identity/client eligibility; AI-003 личный план vs owner API. [Аудит переключателей](../architecture/PLATFORM_CONTROLS.md), [проверенные официальные источники и ограничения ChatGPT](../architecture/CHATGPT_INTEGRATION.md). AUTH-004 Console UX теперь включает registration mode/invites и связанные controls, после их backend contracts. Новые карточки не blanket approval: перед каждой сначала вопросы.

React signup/login/Owner Console toggle ещё отсутствуют; реальная email delivery/SMTP/outbox и legal text publication не сделаны. qubite-account-v1 — только technical consent version. Нет нового OAuth provider/реальных ChatGPT calls/личных токенов/постоянных owner credentials. Разделение HTTP responses не timing guarantee. Перед production нужно UI/effective terms/mail/staging/backup checks.

## Проверки и Git evidence

Первый targeted disposable PG/HTTP64 pass18.90s; после усиления owner invite idempotency итоговые71 случаев входят в финальную full suite ниже. Проверяются positive verify/login/reset/OAuth linking, оба invitation типа, strict DTO/consents, guards, owner/reauth/session, current mode/revoke/consent races, same invite/public canonical concurrency, atomic SQL failure, migration rollback/preserve и storage drift. Full source-copy no .env/external network harness и exact-SHA GitHub tests-only CI выполнены, evidence ниже.

Постоянные accounts/data/servers не создавались; реальные provider/device/production acceptance остаются открыты. Rollback disabled mode/consumer off, сохранить forward0007/UUID/credentials/consents/invites/audit, tested forward recovery. No down/drop/old SQLite restoration.

### Локальный итог перед commit

**All963+harness6=969 pass**, no failed/skipped в финальном прогоне. Node97/deploy18/Search95/Brief112/Kwork29/SiYuan5/identity32/core575. Core группы208/165/202,26.72/48.79/75.31s, каждая<180s без изменения timeout. Registration71 (202=policy86+account-login45+registration71). Python3.13.13/PostgreSQL18.6/Node22.22.2. check.py59tasks/67docs, unittest6, diff pass. Starlette/httpx deprecation advisory присутствует, не failure/skip.

Одна bounded correction batch после первого full: явно указать400 нового endpoint в OpenAPI и обновить obsolete no-public-registration404 oracle на503 при unconfigured Auth. Отдельная финальная contract correction: уникальное имя RegistrationAccepted вместо коллизии с email Accepted, прежние paths/DTO OpenAPI побайтно как JSON objects unchanged. Это не изменение HTTP поведения; дополнительно3 contract checks pass1.45s. Полный CI на финальном коде обязателен.

На момент implementation report commit/CI ожидались; теперь подтверждены в следующей финальной записи.

### Финальный GitHub evidence

Implementation **2035e1e5298ad94fd9c9aa33586e6c3ad5acda04** committed/pushed в main; remote SHA verified. [CI38390796988](https://github.com/kirillkuz1122/qubite/actions/runs/38390796988) exact SHA **completed/success13.10.2026 11:36:36UTC**, job11:36:35UTC. All963+harness6=**969pass**, те же suites/counts, core575=208+165+202. CI Python3.14.8/PostgreSQL16.15/Node22.23.3; core48.75/78.23/116.02s, every<180s. Runtime/test dependencies/таймауты не менялись. Есть advisory о Node actions runtime и Starlette/httpx deprecation; tests не failed/skipped.

После полного local+CI pass сделаны только docs/registry evidence updates: status done,59cards=12done/4ready/43backlog, [handoff](../project/LAST_HANDOFF.md)/AGENTS/CLAUDE/project context/roadmap. Final docs-only commit немедленно push, application/test/SQL/contracts соответствуют implementation CI. Immutable tournaments/qubite-v1.0 оба96f0457a523b6b79f21c4092056d8fa8fa69a680 проверены после implementation push; перед завершением проверяются снова.

Next discussion: UI-001 ordinary Today/shell → AUTH-007 registration/login/reset UI. Owner Console требует AI-001/002 и собственный UI slice. AUTH-015/016/AI-003 остаются backlog/question gates; никакой следующий runtime task не начат. Форма публичной регистрации/реальная почта/ChatGPT integration/production release этим done не объявляются готовыми.
