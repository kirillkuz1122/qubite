# Qubite Core0.7.0 — FastAPI

**AUTH-005, 13.10.2026 — done:** согласованная проверка существующего входа email/password без account code-entry. [Границы API](../docs/architecture/ACCOUNT_LOGIN.md), [отчёт](../docs/reports/QUB-AUTH-005.md), [ADR-0019](../docs/architecture/decisions/0019-account-login-boundary.md). Core0.6.0/schema0006_policy и runtime без изменений; old routes404/strict DTO, email proofs отдельно, shared/personal tournament join сохранён. Local+CI all892+harness6=898pass; implementationcf302d9 / CI38385240872 completed-success10:47:23UTC. Далее AUTH-006 минимальная регистрация; сначала вопросы и ответы владельца. Предыдущие milestones ниже исторические, актуальный статус в tasks.json/LAST_HANDOFF.

OAuth network false, provider rows disabled по умолчанию. Новые QUBITE_CORE_OAUTH_<PROVIDER>_CLIENT_ID/CLIENT_SECRET и explicit network flag, локальные enable/disable команды, schema/HTTP/границы — [OAuth runtime](../docs/architecture/OAUTH_IDENTITY.md), [отчёт AUTH-010](../docs/reports/QUB-AUTH-010.md). Неизвестная identity не создаёт аккаунт; привязка/отвязка по собственному паролю, email не объединяет accounts. Реальные ключи/providers в этой задаче не использованы.

Независимое ядро новой платформы. Реализованы health/readiness/OpenAPI, explicit migrations0001..0008, fresh accounts/local owner bootstrap, Web Auth (AUTH-009) OAuth adapters/explicit account linking (AUTH-010) verification/reset (AUTH-011) и scoped policy gate (AUTH-003), owner-controlled регистрация/invites/consents (AUTH-006). React Auth и server catalog/owner visibility подключены; полная Owner Console, native/keys/introspection отдельно. Legacy Node/SQLite остаётся отдельно, импорт старых паролей/сессий отсутствует.

Email: explicit `QUBITE_CORE_EMAIL_CHALLENGES_ENABLED=false` по умолчанию; true без injected mock transport всё равно503. Четыре POST verify/reset request/confirm, TTL/attempt/revoke — [email contract](../docs/architecture/EMAIL_CHALLENGES.md). Настоящая доставка/enrollment email-2FA/native отдельно; React Auth подключён. Core0.3 binary на ahead0005 fail closed; forward recovery сохраняет UUID/hashes/sessions.

UI-003: [module catalog](../docs/architecture/MODULE_CATALOG.md), core0.7.0/current0008_catalog, shared visibility default locked и guarded owner commands. Existing identity/grants сохраняются. Read catalog не capability; paid/domain/installer guards unchanged. Explicit forward migration, никакой startup DDL. Runtime против pending/ahead schema отказывает; только отдельный согласованный deploy может применить миграцию в постоянной среде.

## Установка и конфигурация

Из корня checkout, отдельное окружение:

```sh
python3 -m venv core/.venv
core/.venv/bin/python -m pip install -r core/requirements.lock
```

Если venv создан через uv без pip, использовать `uv pip install --python core/.venv/bin/python -r core/requirements.lock`. Pinned runtime включает Argon2id/Psycopg/httpx/PyJWT/cryptography; тестовый lock отдельный в scripts/engineering. Системный PostgreSQL не устанавливается этими командами.

QUBITE_CORE_DATABASE_URL хранить приватно, без реального пароля в argv/истории/Git. Требуется dedicated PostgreSQL qubite_core или qubite_core_<suffix>, явные user/loopback IP/port. Существующие DATABASE_PATH/PG service files/.env не загружаются. Remote DB/TLS/pooling прорабатываются при deploy. Без DB config liveness200, storage readiness503.

QUBITE_CORE_AUTH_ORIGIN — точный HTTPS origin без пути/credentials/query/fragment/wildcard, например synthetic https://qubite.example.test. Без него Auth503 identity_unavailable, health/OpenAPI работают. Для локального HTTP указать explicit http://127.0.0.1:9210 (либо localhost/::1) и QUBITE_CORE_AUTH_LOCAL_HTTP=true; отдельные cookie имена qubite_local_*, публичный hostname/insecure production запрещены.

## Миграция и локальный owner

На подготовленной dedicated базе, перед запуском API:

```sh
PYTHONPATH=core core/.venv/bin/python -m qubite.migrations check
PYTHONPATH=core core/.venv/bin/python -m qubite.migrations apply
PYTHONPATH=core core/.venv/bin/python -m qubite.identity bootstrap-owner
PYTHONPATH=core core/.venv/bin/python -m qubite.identity set-owner-password
```

Bootstrap спрашивает email и CREATE OWNER; initial password только interactive TTY/getpass дважды и SET OWNER PASSWORD. Никаких password/email options. Повтор owner/password setup не перезаписывает данные; existing pending account не повышается. Пароль12..256 codepoints/<=1024 UTF8 bytes, exact без trim/нормализации; Argon2id PHC. Email пока unverified, никакие grants/budgets не выдаются. Постоянный owner в engineering задачах ещё не создавался: только fixtures.

Apply транзакционный под migration advisory lock; current0008_catalog, двадцать шесть domain/security table. Check readonly, pending/drift/ahead/missing namespace/table даёт код1; никаких startup migrations, implicit repair, down/drop/delete. Operator/runtime privileges отдельно; [фактические ограничения и privilege fixture](../docs/architecture/WEB_AUTH.md). Старый binary/schema0003 не станет ready на ahead0004, данные сохранять и использовать совместимый forward recovery.

## Запуск и HTTP

```sh
PYTHONPATH=core core/.venv/bin/python -m uvicorn qubite.app:create_app --factory --host 127.0.0.1 --port 9210 --no-access-log --no-proxy-headers
```

Health: GET /api/v1/health/live, /health/ready; OpenAPI /api/v1/openapi.json. Storage readiness проверяет ledger/namespaces/table existence/type, не complete semantic fingerprint/owner setup/TLS ingress.

Web сценарий: GET /api/v1/auth/csrf → POST /auth/session (JSON email/password + exact Origin/X-CSRF-Token + preauth cookie) → GET /api/v1/me. Browser cookie __Host-qubite_session Secure/HttpOnly/Lax/Path=/, Domain отсутствует; raw token не в JSON/localStorage/URL. GET /auth/sessions только собственная metadata; DELETE /auth/sessions/{UUID}, POST /auth/logout требуют session-bound proof. Logout-all требует recent reauth<=300s; POST /auth/reauth проверяет собственный password. Каждый запрос перепроверяет actual status/version/revoke/idle7d/absolute30d. Validation400 не печатает body/password, responses no-store. Bearer/native/API keys в этом slice не поддерживаются.

Нет CORS/forwarded trust; runtime API loopback. Ingress TLS/firewall/proxy/log redaction/trusted client-IP/workers/backup проверяются отдельно перед deploy. Не объявлять localhost smoke проверкой публичного сервера.

## Проверки и документация

```sh
python3 scripts/engineering/verify.py --suite core --python <test-python> --postgres-bin <native-bin>
python3 scripts/engineering/verify.py --suite all --python <test-python> --postgres-bin <native-bin>
python3 -m unittest discover -s tests/engineering
python3 scripts/engineering/check.py
```

Missing prerequisites fail/no skip. Real fresh private PG cluster/DB и isolated HOME/source-copy, no external network/.env. HTTPS TestClient/cookie checks и actual local Uvicorn HTTP smoke; signed RSA/MockTransport OAuth и restricted runtime DB role; физические браузеры/native/live providers/production отдельно.

[Web Auth/схема/API/лимиты](../docs/architecture/WEB_AUTH.md), [accounts/owner](../docs/architecture/IDENTITY_SCHEMA.md), [отчёт AUTH-009](../docs/reports/QUB-AUTH-009.md), [foundation](../docs/architecture/CORE_FOUNDATION.md). Prototype design-lab и legacy product UI не менялись.

## Scoped policy

[Policy API/SQL/adapters](../docs/architecture/POLICY_GATE.md), [машинный контракт](../contracts/policy-v1.json). GET /api/v1/me/access — свои module grants; GET /api/v1/owner/policy — owner catalog/revision; POST /policy/check — exact resource target; POST /owner/policy/commands — owner own-password reauth/CSRF/If-Match/idempotency/audit. Read/write/manage независимы. Owner/tournament/workspace owner не обходят resource ACL/paid AI. Catalog installed/enabled false; metadata enable не устанавливает модуль. Hooks для DB effects/jobs/tools и read-only WS probe — primitives; real domain/jobs/feed/AI отдельно.

Targeted: `python3 scripts/engineering/verify.py --suite policy --python <test-python> --postgres-bin <native-bin>`. All/core включает все files в четырёх exhaustive groups с прежним180s timeout каждой: foundation/identity/auth; OAuth/challenges; policy/registration и future/nested; module catalog отдельно. Target catalog: --suite catalog. Recovery forward, сохранять новые UUID/grants/audit, old core не ready против0008.

## Регистрация AUTH-006

[API/modes/приглашения](../docs/architecture/REGISTRATION.md), [machine contract](../contracts/registration-v1.json). Public off: invite default; disabled закрывает оба enrollment пути. Owner PUT versioned/reauthed; выпуск invite требует UUID Idempotency-Key (token once). Только pending→verify→login, не auto grants. Mock transport injected/off default, реальные SMTP/legal publication отдельно; React Auth подключён. Registration schema0007 сохранена, current0008 включает catalog, previous SQL unchanged; global login/maintenance/ChatGPT adapter не реализованы.
