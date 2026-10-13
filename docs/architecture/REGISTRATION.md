# Регистрация: AUTH-006

13.10.2026 владелец ответил на вопросы до реализации: регистрация переключается из админки, нужны оба вида приглашений, вход после подтверждения почты. Реализован FastAPI/Postgres API, **React формы/переключатель и реальная доставка писем отдельно**. [Контракт](../../contracts/registration-v1.json), [ADR-0020](decisions/0020-owner-controlled-registration.md), [отчёт](../reports/QUB-AUTH-006.md).

## Режимы и формы

`invite` по умолчанию: нужен одноразовый invite; `public`: регистрация без приглашения; `disabled`: запрещены и публичная регистрация, и приглашения. Режим меняется владельцем без рестарта. Выключение регистрации не блокирует вход уже существующих аккаунтов и подтверждение ранее выданных email proofs. Общий login/maintenance переключатель — [AUTH-015](PLATFORM_CONTROLS.md).

POST `/api/v1/auth/register`: email, password, consent_version, consent_accepted=true; optional display_name/invite_token. Strict DTO отвергает неизвестные поля, legacy login/ФИО/школу/класс/code/accessCode/роль/grants. Пароль 12..256 codepoints, ≤1024 UTF-8 bytes, exact/no normalization, Argon2id AUTH-009. Email canonical AUTH-002: casefold + IDNA, без dot/plus folding. Invite не является способом входа или подтверждением владения почтой.

`qubite-account-v1` — техническая версия согласия, не утверждение о готовности правовых текстов. Поле strict bool и точная версия обязательны; согласие сохраняется отдельно с timestamp/source/invite UUID. Actual terms/privacy тексты, пользовательская форма, их утверждение и публикация обязательны до production; менять consent_version только вместе с соответствующими текстами и новым UI. Версия из PostgreSQL возвращается клиенту.

202 `registration_accepted` одинаков для нового и уже существующего canonical email. Ответ не содержит UUID/токен/почту/сессию. Коллизия не меняет старый пароль, статус, имя, owner/UUID и не расходует приглашение/не рассылает письмо существующему пользователю. Это унификация HTTP ответа, **не обещание постоянного времени или сокрытия факта доставки от владельца почты**; production anti-abuse/timing отдельно.

Новый subject всегда pending/unverified, credential и consent появляются атомарно. Нет module/model/AI/owner grants. После email verify из AUTH-011 subject активируется; verify не выдаёт сессию, нужен явный login. Reset и own-password OAuth link применяются к тому же UUID. Нет импортов/legacy bridge.

## API

| Метод/путь | Доступ и результат |
|---|---|
| GET `/api/v1/auth/registration` | публичный режим/consent_version/revision, ETag, без секретов |
| POST `/api/v1/auth/register` | same-origin + одноразовый preauth/CSRF; 202 без сессии |
| GET `/api/v1/owner/registration` | текущий active platform_owner Web session; ETag |
| PUT `/api/v1/owner/registration` | `{mode}` + CSRF + recent own-password ≤300s + If-Match `"registration-N"`; stale412/missing428 |
| GET `/api/v1/owner/registration/invites` | owner; до100 последних metadata, без токенов; pagination/export отдельно |
| POST `/api/v1/owner/registration/invites` | owner+reauth+CSRF; email/null, ttl_seconds 60..604800 (7d default), UUID Idempotency-Key; 201 token once |
| DELETE `/api/v1/owner/registration/invites/{id}` | owner+reauth+CSRF; отзыв, 204; неизвестный404 |

Email-bound invite сравнивает canonical email, transferable подходит любой почте. Оба одноразовые, отзываемые, с TTL. Хранится SHA-256 256-bit `qbt_ri_`, plaintext существует только в ответе выпуска владельцу. Повтор command UUID не создаёт вторую ссылку: 409 invite_already_issued, другой body — idempotency_conflict; токен повторно не возвращается. После потери ответа владелец может найти/отозвать invite по command UUID и выпустить новый. UI должен явно предложить это восстановление, не повторять issuance автоматически. Ссылка в будущем — fragment в клиенте, затем POST; не помещать token в query/логи/referrer.

## Атомарность и ограничения

Forward `0007_registration`: registration_state/invites/consents/audit + новые scopes общих rate counters. Current core0.6.0,25 domain/security tables. Startup не применяет миграции/не создаёт пользователя/пароль и не отправляет письма. Проверяется точная история, required tables; это не полный semantic fingerprint SQL.

1. Коммитятся shared IP20/email3/invite5 за5min counters и одноразовый preauth. Неправильные режим/ссылка/согласие не создают аккаунт. Auth origin/body/cookie guards AUTH-009 сохраняются.
2. Mode/revision/consent/invite snapshot проверяется до Argon2. Hash вне DB locks, bounded Argon semaphore.
3. Короткий state-row lock сериализует config/revoke/redemption/canonical writes; после хеша всё проверяется заново. Даже disable→enable не оживляет старый request. Subject+credential+consent+invite redemption+audit в одной транзакции. Ошибка SQL откатывает весь набор, sanitized503.
4. После commit trusted внутренний AUTH-011 dispatch создаёт verify challenge и вызывает только injected mock transport. Disabled mail или отсутствующий callable дают503 **до** создания аккаунта. Ошибка доставки/последующего dispatch не удаляет аккаунт: pending сохраняется, `/email/verify/request` позволяет повторить позже. Нет durable SMTP queue/реальных писем/фонового polling. Нельзя включать public регистрацию в deployment, не подготовив deliverability/retry.

Owner metadata audit содержит actor/action/UUID/revision/mode/time, без email/password/plaintext invites/private текста. Account insert audit anonymous actor, target UUID. Owner выдача ограничена30/5min. При публичном duplicate обе параллельные попытки202, одна запись; при одном invite одна202, другая400. Сохранённые accounts/consents не удаляются cleanup.

Откат: disabled mode/снять новый consumer, сохранить0007/UUID/новые пароли/consents/invites/audit; tested forward fix. Старый binary не ready против ahead schema. Не down/drop/SQLite restore поверх новых записей. Production migration/deploy отдельные.
