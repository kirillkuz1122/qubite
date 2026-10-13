# Email verification и восстановление пароля — AUTH-011

13.10.2026. Engineering implementation в одобренной AUTH-011; core0.4.0, explicit migration `0005_challenges`. Это API/domain для существующих UUID и mock delivery. Регистрация AUTH-006, интерфейс, доставка настоящих писем и включение email-2FA ещё отдельные работы. [ADR-0017](decisions/0017-email-challenges-and-recovery.md), [Web Auth](WEB_AUTH.md), [OAuth](OAUTH_IDENTITY.md), [отчёт](../reports/QUB-AUTH-011.md).

## API и сценарий

Все четыре маршрута — POST JSON под exact configured `QUBITE_CORE_AUTH_ORIGIN`, strict Host/Origin/CSRF, без CORS, proxy-header trust и query string. Cookies/лимиты тела/ошибки наследуют Web Auth: Secure/HttpOnly/Lax/path=/, 8KiB, no-store/no-referrer/nosniff, чужие/legacy/bearer/mixed credentials отклоняются. Без origin Auth недоступен, health/live работает. Ошибки Pydantic и транспорта не содержат исходного тела, почты или токена.

| Маршрут `/api/v1/auth/email/…` | Тело | Успех |
|---|---|---|
| `verify/request` | `email` | 202 `{"code":"request_accepted"}` |
| `verify/confirm` | `challenge_id`, `token` | 204, cookies удаляются, без входа |
| `reset/request` | `email` | такой же 202 |
| `reset/confirm` | `challenge_id`, `token`, `password` | 204, cookies удаляются, без входа |

Перед каждым анонимным POST получать `GET /api/v1/auth/csrf`: cookie preauth живёт300s и используется один раз. После неуспешного POST тоже брать новый CSRF. Авторизованный клиент использует session-bound CSRF. Доказательство можно завершить в другом браузере со свежим preauth: оно привязано к mailbox/account/purpose, а не к исходному браузеру. UUID challenge приходит **только в письме**, API request не возвращает его и не раскрывает наличие аккаунта. Подтверждение без подходящей одноразовой пары всегда400 `invalid_challenge`; disabled/unconfigured transport503 `email_unavailable`; rates429 `rate_limited`; ошибка БД503 `identity_unavailable`.

Доставка передаёт injected callable объект `Delivery(recipient,purpose,challenge_id,token,expires_at)`. Успех только при точном `True`; `False`/`None`/исключение инвалидируют proof и дают тот же202. Repr скрывает private fields; **письмо и его token никогда не включать в log/tracing/audit/URL query/HTTP response**. Будущий frontend открывает фиксированный route с fragment либо предлагает ручное вставление security proof, затем отправляет POST. GET, preview ссылки и сканер почты не расходуют proof. Это security code, не старый account code-entry, login alias или аккаунтный идентификатор.

## Состояния и PostgreSQL

`email_challenges`: UUID, subject FK RESTRICT, purpose `verify|reset`, unique SHA-25632byte digest типизированного 256-bit random token `qbt_ev_`/`qbt_er_`, canonical email, auth_version, optional credential_version, created/expires/delivered/finished, attempts0..5. TTL verify1800s/reset900s; DB ограничивает общий TTL<=30min. Raw proof существует только в памяти транспорта. Это не шифрование почты/анонимизация: metadata содержит canonical email и UUID. В пределах успешного request предыдущие незавершённые proofs того же purpose инвалидируются. Cleanup SKIP LOCKED <=100 записей старше суток после expiry, только disposable proof metadata; accounts/credentials/ledger не удаляются.

Request резервирует shared counters и anonymous CSRF в отдельной транзакции, затем под subject lock создаёт snapshot/proof. Transport вызывается **после commit без row lock**. Callback транспорта может застать новую версию аккаунта, блокировку, замену почты, новый request: post-delivery проверка не активирует старый proof. Разрешён только delivered, not finished, nonexpired proof с текущими email/auth/credential версиями. Failed/resend delivery не делает вход и не меняет аккаунт.

Confirm сначала фиксирует число попыток (wrong proof тоже commit), потом Argon2id вне locks, затем вновь проверяет актуальную authority/TTL/attempts/token под locks. Порядок locks совпадает с login/OAuth: subject → proof → credential/session. Два правильных confirm дают один204 и один400. Изменение credential/auth/email/status и истечение TTL во время hashing дают отказ. Изменение credentials, subject и session revocation — одна транзакция; driver failure откатывает их вместе, сохраняя UUID/hash/sessions/proof. Попытка уже зарезервирована и не откатывается.

Shared fixed-window300s rates: request30/IP и3/purpose+canonical email; confirm30/IP и8/purpose+challenge UUID; proof5 попыток. Ключи counters hashed; unknown/invalid accounts используют такие же IP/identifier limits. Rate отказ commit, Retry-After300. Это дополнение к preauth60/IP/300s и Argon2id2 slots/process. Failed proof **не блокирует subject**. Identifier exhaustion не сбрасывается новым браузером/процессом. Граница expires_at включительно — отказ.

Verify работает только с существующим pending/active subject без verified email: устанавливает email_verified_at, pending→active, auth_version++, отзывает его web sessions и незавершённые proofs. UUID, пароль, owner assignment и OAuth bindings сохраняются. Новый аккаунт, credentials, owner, module/model/budget grants не создаются. Singleton owner назначается только existing explicit local bootstrap. Active owner тоже сначала подтверждает почту, чтобы использовать email recovery.

Reset — только active account с **заранее подтверждённой** почтой и existing password credential. Новый Argon2id соответствует AUTH-009: точный UTF-8,12..256codepoints<=1024bytes,m19456/t2/p1. Reset увеличивает credential_version/auth_version, отзывает все собственные sessions и pending proofs. Чужие sessions и UUID/owner/OAuth binding не меняются; новый login обязателен. Pending OAuthlink/login states со старым auth_version провалят текущие gates. Владение скомпрометированным mailbox даёт recovery; existing OAuth identity остаётся отдельным входом и требует отдельного unlink/recovery review, reset не обещает полностью устранить компрометацию.

## Конфигурация и реальные ограничения

`QUBITE_CORE_EMAIL_CHALLENGES_ENABLED=false` по умолчанию. Только строковыеtrue/false; Settings принимает bool. `create_app(...,mail_transport=mock)` — обязательная инъекция для включения. **SMTP/HTTP mail adapter не реализован**, env=true без transport даёт503 до DB, и это не настройка production доставки. `.env`, legacy mail credentials, real mailbox не читаются. Feature gate проверяется и на request, и на confirm. Disable отказывает в confirm; при последующем enable старые proofs остаются ограничены их TTL/live versions, отдельного runtime operator/version gate сейчас нет.

202 одинаков по телу для unknown/ineligible/failed delivery; timing indistinguishability и deliverability **не проверены**. Синхронный test adapter не является production queue: до настоящего включения нужны secret-safe asynchronous delivery/notification after reset, uniform timing, bounded timeout/retry/idempotency, trusted fixed link origin/referrer policy, ingress body/access-log redaction и mail acceptance. Нельзя заменять его произвольным SMTP callback и объявлять rollout готовым. Public signup/invites/activation policy/grants реализуются AUTH-006/003 отдельно.

## Email-2FA: контракт, не runtime

`contracts/identity-v2.json.email_2fa` — planned protocol с default off, pending_login/code TTL300s,5attempts. Вход: actual password active verified subject → browser-bound pending_login/CSRF → независимое одноразовое email possession → session только после **обоих** proofs и проверки versions/status/TTL. Verify/reset proof не подходит для login; OAuth не обходит включённую политику. Reset не отключает 2FA. Enrollment/disable требуют actual password+recent proof и подтверждения почты; отдельный recovery сценарий/коды/блокировки согласуются до реализации. Login integration и пользовательское включение сейчас отсутствуют; существующий Web/OAuth runtime **не обеспечивает 2FA**. Подробная follow-up задача создаётся после согласования политики MFA/recovery, не снимая текущие approval gates.

Email possession — дополнительная проверка, а не phishing-resistant MFA/AAL2. NIST исключает email из допустимых out-of-band authenticators; email validation и recovery отличаются от authentication. Это ограничение явно учитывается в названии/UX будущей функции. [NIST SP800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html), [OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html): случайность/одноразовость/TTL, consistent response, scoped rates, invalidate sessions, не autologin. Источники прочитаны13.10.2026; code/tests не означают соответствие полному стандарту.

## Migration/rollback и проверки

Apply0005 только explicit local command, startup/readiness не делает DDL; старый0004 ledger до apply даётnot_ready. Аддитивная таблица и расширение scope CHECK;0001..0004 checksums неизменны. Transactional failed DDL сохраняет прежний constraint/ledger/accounts. Readiness требует таблицу через pg_catalog, read-only metadata role допускается; это не полный schema fingerprint. Core0.3 binary на ahead0005 fails closed. Rollback сохраняет forward schema/UUID/hashes/newwrites: отключить email feature и использовать совместимый core0.4; down/drop/старые SQLite passwords запрещены. Перед реальной migration отдельно backup/restore/staging/явное разрешение.

Проверки `core/tests/test_challenges.py`: real disposable PG+HTTP, memory-only transport, owner/pending/blocked/unknown, reset own-vs-other sessions, expiry/replay/resend/type/attempt/rates, concurrent confirmation, transport/version/hash races, failed DB write/DDL, schema drift/strict env/header/body/CSRF/redaction. Core suite: `python3 scripts/engineering/verify.py --suite core --python <test-python> --postgres-bin <native-bin>`; полный all+harness — по [Harness](../engineering/AGENT_HARNESS.md). Real email/production/UI/device acceptance открыты.
