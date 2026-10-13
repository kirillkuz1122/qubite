# Отчёт QUB-AUTH-006 — управляемая регистрация

Дата13.10.2026. Один bounded cycle. Перед реализацией вопросы заданы, владелец ответил: registration switch, оба вида приглашений, вход после email verification. Общие switches и ChatGPT он разрешил сохранить в плане. **Текущий статус review/testing; commit/CI evidence добавляется после проверок.**

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

Первый targeted disposable PG/HTTP71 cases (final result ниже); предыдущий64 pass18.90s до усиления owner invite idempotency. Проверяются positive verify/login/reset/OAuth linking, оба invitation типа, strict DTO/consents, guards, owner/reauth/session, current mode/revoke/consent races, same invite/public canonical concurrency, atomic SQL failure, migration rollback/preserve и storage drift. Full source-copy no .env/external network harness и exact-SHA GitHub tests-only CI обязательны до done.

Постоянные accounts/data/servers не создавались; реальные provider/device/production acceptance остаются открыты. Rollback disabled mode/consumer off, сохранить forward0007/UUID/credentials/consents/invites/audit, tested forward recovery. No down/drop/old SQLite restoration.

### Локальный итог перед commit

**All963+harness6=969 pass**, no failed/skipped в финальном прогоне. Node97/deploy18/Search95/Brief112/Kwork29/SiYuan5/identity32/core575. Core группы208/165/202,26.72/48.79/75.31s, каждая<180s без изменения timeout. Registration71 (202=policy86+account-login45+registration71). Python3.13.13/PostgreSQL18.6/Node22.22.2. check.py59tasks/67docs, unittest6, diff pass. Starlette/httpx deprecation advisory присутствует, не failure/skip.

Одна bounded correction batch после первого full: явно указать400 нового endpoint в OpenAPI и обновить obsolete no-public-registration404 oracle на503 при unconfigured Auth. Отдельная финальная contract correction: уникальное имя RegistrationAccepted вместо коллизии с email Accepted, прежние paths/DTO OpenAPI побайтно как JSON objects unchanged. Это не изменение HTTP поведения; дополнительно3 contract checks pass1.45s. Полный CI на финальном коде обязателен.

Commit/push и exact-SHA CI ещё не подтверждены на момент implementation report; финальный evidence добавляется отдельной docs-only записью.
