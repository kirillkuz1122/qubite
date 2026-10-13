# OAuth нового core — AUTH-010

**Актуальный AUTH-011 runtime:** core0.4.0/current0005_challenges,11 domain/security tables; verification/reset existing UUID и mock-only email transport. [API/SQL/ограничения](EMAIL_CHALLENGES.md), [evidence](../reports/QUB-AUTH-011.md). Identity-v2 partial AUTH-009/010/011; email-2FA contract-only, registration/policy/native/UI/provider/deploy отдельно. Снимки прошлых задач ниже исторические.

13.10.2026. FastAPI core0.3.0, explicit migration0004_oauth. Реализованы Google/Yandex/VK/Telegram adapters, web login по заранее привязанной identity, explicit link/unlink и локальные provider switches. [OpenAPI](../../contracts/core-v1.json), [identity-v2](../../contracts/identity-v2.json), [ADR-0016](decisions/0016-explicit-oauth-identities.md), [отчёт](../reports/QUB-AUTH-010.md). Внешний transport проверен только через MockTransport и подписанные RSA fixtures; реальные приложения/ключи/провайдеры/браузеры не проверялись. React/Auth UX и native exchange ещё отдельные задачи.

## Идентичность и сценарий

Authority — UUID subject в core. Пара provider+issuer+provider_subject уникальна глобально; один provider допускает одну привязку к subject. Email, verified email, имя, Telegram username/phone и upstream roles игнорируются. Они не создают пользователя, не назначают owner, не активируют pending account, не выдают module/model grants/budgets. Email_verified_at core не меняется. Неизвестная identity даёт409 oauth_identity_unlinked: сначала собственный аккаунт Qubite, затем привязка в его настройках. Public registration/verification UI ещё не реализован; текущий owner использует первоначальный локальный пароль.

1. **Link:** действующая web session → GET /api/v1/auth/csrf → POST /api/v1/auth/oauth/{provider}/start с JSON intent=link/password, exact Origin/X-CSRF-Token. Собственный пароль проверяется каждый раз, даже после недавнего reauth. Сервер возвращает authorization_url; UI выполняет переход внешним браузером. Callback сохраняет исходную session, отвечает204. Пара другого аккаунта или вторая identity того же provider даёт409 без переназначения.
2. **Login:** anonymous preauth/CSRF → POST start с intent=login без password → navigation по authorization_url → GET callback. Только существующая привязка и active subject дают новую случайную web session/public own metadata. Подтверждение провайдера само по себе не считается password proof: sensitive logout-all требует настоящего POST reauth.
3. **List:** GET /api/v1/me/oauth только для собственной session, provider/linked_at без upstream identifiers/email/tokens.
4. **Unlink:** DELETE /api/v1/me/oauth/{provider} с JSON собственным password + Origin/CSRF. Удаляется только собственная привязка, auth_version повышается, все собственные web sessions отзываются. Пароль/UUID/owner сохраняются, чужие sessions/identities не изменяются. Провайдеру не отправляется token-revocation request: access/refresh tokens не сохраняются. Повторный вход своим паролем доступен.
5. **Providers:** GET /api/v1/auth/oauth/providers возвращает только provider/available для четырёх фиксированных names. available требует локального enabled, полной конфигурации и разрешённого transport; секретов/причин конфигурации ответ не раскрывает.

## Конфигурация и локальное управление

Новые env читаются явно, без .env loader/legacy aliases:

| Переменная | Назначение |
|---|---|
| QUBITE_CORE_OAUTH_NETWORK_ENABLED | false по умолчанию; только строка true/false. Реальный HTTPS transport разрешается явно при отдельной настройке среды |
| QUBITE_CORE_OAUTH_GOOGLE_CLIENT_ID / CLIENT_SECRET | confidential Google application |
| QUBITE_CORE_OAUTH_YANDEX_CLIENT_ID / CLIENT_SECRET | Yandex application; server Basic auth |
| QUBITE_CORE_OAUTH_VK_CLIENT_ID / CLIENT_SECRET | VK ID application; client ID обязателен, secret здесь не используется |
| QUBITE_CORE_OAUTH_TELEGRAM_CLIENT_ID / CLIENT_SECRET | новый Telegram OIDC client, не TELEGRAM_BOT_TOKEN; client ID — положительный numeric Bot ID |

Во всех строках CLIENT_SECRET имеет тот же полный provider prefix, например QUBITE_CORE_OAUTH_GOOGLE_CLIENT_SECRET. Client values ограничены printable ASCII1..512; они исключены из repr/ответов/логов, не принимаются в HTTP/argv. Secret configuration digest в flow нужен для invalidation, это не секретное хранилище/не обещание защиты слабых секретов. Значения хранить в приватной конфигурации оператора, не в Git/чатах/URL/командной истории. Настройка существующего deploy/.env не читалась.

Миграция создаёт четыре **disabled** provider rows. Никакого auto-enable при наличии ключа. После отдельной настройки конфигурации доверенный local operator:

```sh
PYTHONPATH=core core/.venv/bin/python -m qubite.identity.oauth enable google
PYTHONPATH=core core/.venv/bin/python -m qubite.identity.oauth disable google
```

CLI требует точное SET OAUTH PROVIDER. Enable без конфигурации отказывает; disable доступен без секрета. Каждое изменение, включая повтор/no-op, повышает version и пишет минимальный audit. Owner Console для этих настроек ещё не создана. API runtime role не получает UPDATE(enabled); CLI использует отдельные operator права. Один enabled без network flag не открывает внешнюю сеть.

## Обмен и доказательство провайдера

Все upstream endpoints фиксированы в providers.py, HTTPS, без caller-selected URLs/discovery/jku/x5u, env proxy, cookies, redirect following или retry. Ответ200/application-json, максимум64KiB decoded body, strict duplicate JSON members, bounded connect/read timeouts и проверка времени чтения тела. Четыре параллельных exchanges на process, отказ429 без очереди. Это не измеренный RSS или точная wall-clock гарантия полного запроса; workers/capacity/ingress до deploy отдельно. Code/access token/client secret передаются только серверному endpoint провайдера и не сохраняются/не возвращаются клиенту. Refresh token не используется; upstream scopes минимальны.

| Provider | Actual adapter proof |
|---|---|
| Google | authorization code+S256+nonce; server token exchange; RS256 ID token через фиксированный JWKS. issuer accounts.google.com нормализуется к https://accounts.google.com; aud/azp/exp/iat/nbf/nonce/sub проверяются |
| Telegram | новый OIDC authorization code+S256+nonce, Basic client credentials; RS256/JWKS, issuer https://oauth.telegram.org, aud=client ID; без legacy widget/Bot token/phone/write scope |
| Yandex | authorization code+S256, Basic application credentials, затем Authorization: OAuth к фиксированному /info; точный client_id и stable id. Нет email-based linking или собственного JWT из userinfo |
| VK | VK ID code+device_id+state+PKCE (SDK convention s256); token state точно совпадает, user_info user_id совпадает с token user_id; фиксированные client_id/redirect_uri endpoints |

RS256 allowlist, RSA2048..4096/JWK bounds, один matching kid из не более8 ключей; remote key URLs/private JWK/другие algorithms отклоняются. JWT signature и claims проверяются PyJWT2.15.1/cryptography50.0.2; TTL claims numeric/finite, optional multi-audience требует matching azp. Неконфигурированный/disabled provider не обменивает code. Подмена audience/nonce/issuer/subject/signature/token shape даёт generic отказ без upstream body.

Первичные контракты проверены13.10.2026: [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect), [Telegram OIDC](https://core.telegram.org/bots/telegram-login), [Yandex authorization/PKCE](https://yandex.ru/dev/id/doc/ru/codes/code-url), [Yandex user info](https://yandex.ru/dev/id/doc/ru/user-information), [VK ID SDK auth/exchange/userInfo](https://github.com/VKCOM/vkid-web-sdk/blob/master/src/auth/auth.ts), [PyJWT](https://pyjwt.readthedocs.io/en/stable/usage.html). Official contract review и signed mock tests не доказывают actual configured provider acceptance: регистрации redirect URLs/keys/scopes и happy/error roundtrips проверяются отдельно перед enable в реальной среде.

## State, cookie, callback и гонки

State qbt_o_ и browser proof qbt_f_: по32 CSPRNG bytes, TTL300s. В DB только SHA256 state/browser; PKCE verifier и OIDC nonce детерминированно получаются HMAC-SHA256(browser-cookie, purpose+NUL+state), base64url43 chars. Ни raw code/state/verifier/nonce/cookie, ни upstream tokens в DB/audit нет. Flow cookie __Host-qubite_oauth: Secure/HttpOnly/Lax/Path=/ без Domain; explicit loopback HTTP использует qubite_local_oauth. Одна текущая flow cookie на browser: второй start заменяет её, предыдущая вкладка не завершается; не обещаем parallel login tabs.

Callback только GET на точном QUBITE_CORE_AUTH_ORIGIN/api/v1/auth/oauth/{provider}/callback. Caller redirect_uri/return_to/native client IDs не принимаются; extra/duplicate query fields запрещены, query<=4096 и bounded ASCII values. Upstream callback code — единственное предусмотренное исключение из запрета auth query. Cross-site разрешён только top-level navigation; POST start/DELETE unlink требуют exact same-origin + CSRF. No CORS/forwarded host trust. Native schemes/Android/Desktop code exchange не реализованы: AUTH-012 настроит external browser и собственный client redirect allowlist/PKCE; новые native redirects здесь не регистрируются.

Callback проверяет enabled/version/config digest **перед** exchange и перед финальным INSERT/session. Disable→enable не возвращает старому flow силу; rotation client secret/callback также инвалидирует pending state. State резервируется под row lock и commit **до** network. Provider denial/timeout/unknown exchange outcome остаются consumed: повтор не вызывает upstream. Общий PG login_ip бюджет30/300s учитывает и invalid/replayed callback; login/reauth/start используют тот же бюджет. Link additionally проверяет canonical password budget8/300s. No automatic retry.

Link snapshot содержит subject/session hash/auth_version/credential_version; финальный шаг повторно проверяет active/revoke/expiry/recent own password<=300s/те же versions под locks. Никаких DB locks во время upstream exchange. Login ищет и повторно проверяет stable pair под subject/identity locks, требует active account; unlink не может оставить позднему login уже удалённую пару. Logout-all отзывает выданные sessions/pending link context, но не запрещает новый самостоятельный OAuth login по остающейся привязке. Provider disable не отзывает существующие web sessions и не удаляет bindings: для них отдельные revoke/unlink/status действия.

## SQL, права и откат

0001..0003/checksums неизменны;0004 additive:

| Таблица/поле | Инвариант |
|---|---|
| oauth_providers | четыре fixed provider PK; enabled/default false; version>=1 |
| oauth_identities | PK(provider,issuer,provider_subject); UNIQUE(subject_id,provider); core/provider FK RESTRICT; linked_at |
| oauth_states | digest PK32/browser digest32/config digest32, provider/version, intent, nullable link snapshot, created/expiry/used; mutually exclusive login/link context CHECK |
| oauth_audit | provider/core subject/action/source/time; без provider_subject/email/raw response/credentials |
| sessions.password_proven | NOT NULL boolean; old0003 password sessions default true; new OAuth false, real reauth sets true |

Current gate проверяет ledger/10 tables/boolean NOT NULL field через pg_catalog и работает с readonly metadata role без core USAGE. Это не полный schema fingerprint. Startup ничего не мигрирует/не bootstrap/hash/network. Cleanup только до100 expired state старше24h, account/credentials/bindings/audit/sessions не удаляет.

Restricted runtime fixture получает SELECT core/meta, прежние auth grants, INSERT/UPDATE/DELETE oauth_states, INSERT/DELETE identities и UPDATE(linked_at) для FOR UPDATE, UPDATE(version) provider для FOR SHARE, INSERT audit + sequence USAGE. Нельзя менять enabled/owner/status/password_hash. Это проверка разделения DB roles, не RLS/защита от arbitrary malicious runtime SQL: минимальные UPDATE locking columns тоже позволяют DoS; реальные роли/provisioning отдельно installer/deploy. FK/unique ограничивают привязки независимо от HTTP.

Rollback сохраняет UUID/passwords/sessions/bindings/audit/ledger0004. Старый0.2 binary/schema0003 откажет ahead readiness; down/drop или восстановление старых SQLite credentials не выполнять. Forward0003→0004 с сохранением owner/hash/действующей password session проверен на disposable PostgreSQL. Ни production миграция, ни owner bootstrap, ни real provider enable не выполнялись. Ingress/access logs необходимо отключить/редактировать для callback code/state до deploy, TLS/IP allowlist/capacity/backup/restore ещё отдельные gates.
