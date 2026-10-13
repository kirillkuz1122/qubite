# Реальный Web Auth — AUTH-009

13.10.2026. FastAPI core0.2.0, explicit schema0003_auth. Реализованы email/password login, профиль, browser sessions, CSRF, reauth и revoke. [OpenAPI](../../contracts/core-v1.json) — фактический HTTP API. [Identity-v2](../../contracts/identity-v2.json) — частично реализованный протокол: implemented только AUTH-009; OAuth/регистрация/reset/native/keys/introspection остаются planned. React формы и Owner Console ещё не созданы; identity не разрешает модули или платный AI.

## Настройка и локальный owner

Dedicated PostgreSQL, явные user/IP/port/database; ограничения connection config из foundation сохраняются. Никаких автоматических .env loaders, startup DDL, seed owner или подключения к legacy SQLite. На постоянной базе эти действия выполняет оператор после отдельной подготовки среды; в engineering задаче используются только disposable DB.

```sh
# QUBITE_CORE_DATABASE_URL задан приватно, без пароля в командной истории.
PYTHONPATH=core core/.venv/bin/python -m qubite.migrations apply
PYTHONPATH=core core/.venv/bin/python -m qubite.identity bootstrap-owner
PYTHONPATH=core core/.venv/bin/python -m qubite.identity set-owner-password
```

Последняя команда требует интерактивный TTY, getpass дважды и SET OWNER PASSWORD. Нет password/email options; getpass warning превращается в отказ до чтения пароля с включённым echo, даже если stdin — TTY. Существует owner → записывается первоначальный PHC hash; существующий hash никогда не перезаписывается. Две конкурирующие настройки оставляют один hash и тот же UUID. Recovery/reset — AUTH-011, не повторный initial setup. Почта owner не становится подтверждённой автоматически; локальный owner active, обычные accounts pending до отдельно реализованной активации.

- `QUBITE_CORE_AUTH_ORIGIN`: точный origin без пути, credentials/query/fragment; HTTPS по умолчанию, без wildcard. Host/Origin не вычисляются из forwarded headers.
- `QUBITE_CORE_AUTH_LOCAL_HTTP=true`: только явный HTTP origin127.0.0.1/::1/localhost. Имена cookie qubite_local_session/qubite_local_preauth. Production cookie нельзя ослабить этой настройкой на публичном hostname.
- Origin отсутствует → Auth routes503 identity_unavailable, без DB call. Storage readiness отдельно проверяет схему, а не наличие owner/password/доменного TLS. Liveness/OpenAPI доступны без БД.
- API запускается на loopback; пример `uvicorn qubite.app:create_app --factory --host 127.0.0.1 --port 9210 --no-access-log --no-proxy-headers`. Reverse-proxy TLS/firewall/log redaction/trusted proxy allowlist проверяются при deploy; здесь не выполнялись. Без trusted proxy все клиенты proxy могут разделять один IP counter — не обещаем готовый public ingress.

## Таблицы и транзакции

Миграции0001/0002 и их checksums сохранены.0003 добавляет четыре таблицы:

| Таблица | Поля и инварианты |
|---|---|
| password_credentials | subject_id UUID PK/FK RESTRICT; Argon2id PHC text; credential_version>=1; updated_at. Нет plaintext/encrypted passwords |
| sessions | UUID PK; subject FK; kind=web; token_hash UNIQUE32-byte/CSRF digest32-byte; auth_version; created/last_seen/idle expiry/absolute expiry/reauth/revoked timestamps. Deadline CHECK, index active subject sessions |
| auth_preauth | token digest PK/CSRF digest, created/TTL/used; одноразовый anonymous login challenge, не principal/session |
| auth_rate_limits | scope+bucket digest PK, hits, fixed-window expiry. Атомарный UPSERT, общий счётчик между API processes |

Cookie qbt_s_ +32 CSPRNG bytes, base64url без padding. В PostgreSQL только SHA256 exact ASCII token с prefix. Anonymous qbt_p_ cookie отдельная. CSRF qbt_c_ — HMAC-SHA256 с cookie как высокоэнтропийным ключом и domain-separated constant qubite-csrf-v1; сервер хранит только digest. GET csrf после проверки действующей session/challenge возвращает связанную proof, не cookie/token hash.

Auth транзакции используют shared migration advisory lock и текущий ledger/table gate. Операции одного subject сериализуются row lock: subject → session/credential; Argon2 работает вне DB transaction. Login сохраняет credential/auth_version snapshot и перепроверяет active status/version/hash под lock перед выдачей новой session. Reauth также перепроверяет session/revoke/CSRF и credential после hashing. Logout-all не позволяет старому snapshot создать новую session. При DB/commit error503 без SQL/DSN/driver body; никаких автоматических retries или success при неподтверждённом commit.

Runtime role fixture: SELECT metadata/accounts/owner/credentials; UPDATE только auth_version/updated_at subjects и credential_version (для row locking); INSERT/UPDATE sessions/preauth/counters; DELETE только ephemeral challenges/counters. Она не меняет platform_owner/status/password_hash. Это проверенный privilege пример, не установленная роль постоянной среды. Migration/operator privileges выдаются отдельно. PUBLIC HTTP initial credential writer отсутствует.

## Сценарий и HTTP границы

1. GET /api/v1/auth/csrf создаёт/reuses anonymous challenge TTL300s и отдаёт nonce, либо proof текущей web session.
2. POST /api/v1/auth/session: JSON email/password, exact Origin + X-CSRF-Token + preauth cookie. Challenge резервируется одноразово до hashing, включая неверный пароль. Нужны active subject и credential; unknown/wrong/pending/blocked дают generic401 invalid_credentials.
3. После успешной проверки — новый случайный session token в cookie, удаление preauth, public own profile + session metadata. Ранее предъявленный session token не переиспользуется для входа.
4. GET /api/v1/me и /auth/sessions проверяют PostgreSQL active/version/revoke/expiry на каждом запросе; session list только своего аккаунта, metadata без hashes/tokens/IP/UA. platform_owner вычисляется из DB, не из JSON/header/legacy role.
5. DELETE /auth/sessions/{UUID}, POST /auth/logout: текущая web cookie + exact Origin + bound proof; чужой UUID404, self revoke очищает cookie. Нет глобального owner bypass на чужие сессии.
6. POST /auth/logout-all требует password proof за последние300s, отзывает все текущие browser sessions и повышает subject.auth_version. Native sessions пока отсутствуют; будущий native resolver использует тот же version gate. API keys остаются отдельными credentials/list/revoke в AUTH-013.
7. POST /auth/reauth с собственным password + Origin/CSRF продлевает proof на300s; не создаёт новую session и не принимает другого email. Reset/change-password — отдельная задача.

Production cookie __Host-qubite_session: Secure/HttpOnly/SameSite=Lax/Path=/, без Domain; Max-Age30d. Серверный idle7d скользит, absolute30d не продлевается. Ответ401 unauthenticated очищает текущую session cookie с теми же атрибутами; после этого клиент может получить новый anonymous challenge и войти снова. Неверный пароль reauth возвращает invalid_credentials и не удаляет действующую cookie. Ошибка БД503 и CSRF403 также не очищают сессию; клиент не должен зацикливать повторные запросы. Anonymous __Host-qubite_preauth TTL5min. GET csrf same-origin без CORS, foreign Origin/Host/Sec-Fetch-Site cross-site отказывает. GET не меняет grants; touch/anonymous security metadata могут записываться.

Authorization Bearer пока не поддерживается; cookie+Authorization, duplicate credentials/headers и две identity cookie одновременно отвергаются. Legacy qb_session/__Host-qubite_search, local cookie в production, refresh/key как session и malformed percent tokens не декодируются и не дают identity. Повреждённый cookie — контролируемый401/400, процесс продолжает отвечать.

Все Auth responses no-store/no-referrer/nosniff. JSON extra fields запрещены, validation ошибки возвращают только code и никогда input/password. Mutation body<=8192 bytes, Content-Length bounded ASCII и actual chunks проверяются; только JSON, query arguments не принимаются. Application не логирует body/cookie/CSRF/password; ingress/access logs должны быть отключены/редактированы отдельно. OpenAPI отражает400, не стандартный422 с исходным input.

## Пароли, лимиты, retention

Exact UTF8,12..256 codepoints,<=1024 bytes; без trim/casefold/normalization/truncation. argon2-cffi25.1.0 с pinned bindings26.1.0/cffi2.1.1/pycparser3.11; Argon2id v19 m19456KiB,t2,p1,salt16/hash32. PHC параметры проверяются перед verify; произвольный дорогостоящий hash не управляет памятью. Unknown/unsupported credentials проверяются с public dummy того же cost, без startup hash. Не заявляем доказанную одинаковость времени всех ответов.

| Защита | Текущий предел |
|---|---|
| Login+reauth по canonical identifier |8 попыток/300s, неудачные тоже учитываются; один бюджет |
| Login+reauth по socket IP |30/300s; forwarded IP не доверяется |
| Новый anonymous challenge по IP |60/300s |
| Argon2 concurrency |2 на процесс, отказ429 без очереди; рабочие buffers примерно38MiB плюс runtime, это не измеренный RSS/OOM limit |
| Активные browser sessions одного subject |20, дальнейший login429 |

Counters shared PostgreSQL; rate deny до hashing, reset окна через300s, Retry-After300. Counter digest не шифрование/анонимизация: email/IP могут угадываться, access к DB приватный. На выдаче нового challenge удаляется не более100 старых записей каждой ephemeral таблицы с expiry старше24h. Account/credentials/session records не удаляются; длительное retention/pruning новых данных отдельным ops решением.

Synthetic local benchmark10hash+10verify: median15.76/15.93ms, max18.49/16.88ms. Только текущая машина; future VPS/device capacity/workers/RSS до production измеряются отдельно. [Evidence/тесты](../reports/QUB-AUTH-009.md).

## Проверки, откат и следующий шаг

Real disposable PostgreSQL/HTTP: cookies, CSRF/Origin/replay, malformed credentials, status/expiry/version, cross-account revoke, Argon limits, shared counters, concurrent setup/login/logout-all/block/credential change, rollback/schema drift и ограниченная SQL role. TestClient HTTPS проверяет cookie semantics; actual Uvicorn loopback HTTP проверяет весь сетевой сценарий в explicit local mode. Это не physical browser/native/OAuth/TLS ingress acceptance.

Readiness проверяет history и шесть actual tables, не полный semantic fingerprint. Не выполнять автоматический down/drop/restore старых SQLite passwords. При rollback сохранить accounts/credentials/sessions/ledger0003; старый binary/schema0002 откажет ready, нужен compatible forward recovery. Старые back/front/services/deploy и архив не заменены, новые HTTP не подключены к live ingress.

Дальше AUTH-010 OAuth и AUTH-011 verify/reset (разрешённые bounded slices), затем policy/React по approval/dependencies. [Первичные источники Argon2](https://argon2-cffi.readthedocs.io/en/stable/parameters.html), [API/PHC](https://argon2-cffi.readthedocs.io/en/stable/api.html), [OWASP session](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) проверены13.10.2026; runtime evidence отдельно от рекомендаций.
