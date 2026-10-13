# QUB-AUTH-009 — вход по паролю и управление web-сессиями

13.10.2026. **Задача done.** Реализация `1dc57cb4c980b111acbf5ccadb28f25871149c98` отправлена в origin/main; [CI38354136689](https://github.com/kirillkuz1122/qubite/actions/runs/38354136689) completed/success13.10.2026 05:59:47UTC. Все597 проверок прошли локально и CI. Статусы задач, архитектура и handoff обновлены.

## Что реализовано

FastAPI core 0.2.0 предоставляет восемь операций: получение CSRF proof, вход по email/паролю, собственный профиль, список своих сессий, отзыв отдельной сессии, выход, выход из всех browser sessions и повторное подтверждение пароля. Фактический API описан в [OpenAPI](../../contracts/core-v1.json), настройки и ограничения — в [Web Auth](../architecture/WEB_AUTH.md), решения — в [ADR-0015](../architecture/decisions/0015-web-password-sessions.md).

Пароли хранятся как Argon2id PHC с индивидуальной солью; проверки ограничены по стоимости и параллельности. Browser tokens случайные, 256 бит; в PostgreSQL сохраняются только SHA256 digests. Cookie Secure/HttpOnly/SameSite=Lax/Path=/ без Domain; отдельные имена для явно включённого локального HTTP. Login использует одноразовый anonymous challenge; изменяющие запросы требуют точный настроенный Origin и связанную с сессией CSRF proof.

Каждый запрос проверяет status/auth_version/expiry/revoke в PostgreSQL. Logout-all отзывает все browser sessions и повышает auth_version; требуется недавнее подтверждение пароля. Сессия не даёт module/model grants, а owner не получает доступ к чужим сессиям или платному AI автоматически. Общие PG counters ограничивают login и reauth; Argon semaphore ограничивает работу каждого процесса.

Истёкшая, отозванная или недействительная сессия получает401 unauthenticated с удалением cookie, чтобы следующий anonymous challenge позволял войти снова. Ошибка пароля reauth, CSRF и временная ошибка БД не удаляют действующую cookie. Повреждённые percent cookies/неоднозначные credentials/ошибочный JSON не вызывают500 и не возвращают исходный password/input.

Локальная команда set-owner-password принимает первоначальный пароль только через скрытый getpass в TTY, требует повтор и подтверждение, запрещает echo fallback и повторную перезапись hash. Постоянный аккаунт или реальный пароль владельца не создавались; использованы только синтетические fixtures.

Миграции0001/0002 и UUID сохранены. Новая additive0003_auth добавляет password_credentials, sessions, auth_preauth и auth_rate_limits. Startup не выполняет DDL/seed/загрузку.env/внешние запросы. Identity-v2 теперь partial_implementation: только AUTH-009 routes implemented, остальные planned; протокольный introspection oracle не объявлен действующим verifier.

## Проверки

Required команды:

```sh
python3 scripts/engineering/verify.py --suite all --python /tmp/qubite-design-tests/bin/python --postgres-bin /tmp/qubite-design-postgres/usr/bin
python3 -m unittest discover -s tests/engineering
python3 scripts/engineering/check.py
git diff --check
```

Финальный all: **593 passed**, harness: **4 passed**, всего **597**. Core: **208** (29 foundation,59 identity,120 Auth) за19.68s; остальные suites Node94/deploy18/Search95/Brief112/Kwork29/SiYuan5/identity32. Нет failed/skipped. check.py проверил56 задач и55 документов; diff check чистый. Exact-SHA CI38354136689 подтвердил те же597 checks; core208 за33.40s, Python3.14.8/PG16.15. Финальный коммит отчёта содержит только документацию; этот результат CI относится к implementation `1dc57cb4c980b111acbf5ccadb28f25871149c98`.

Проверки используют source-copy без.env/real HOME/private DB, запрещённую внешнюю сеть, временный native PostgreSQL18.6, Python3.13.13, Node22.22.2. Испытаны реальные PG transactions/concurrent connections, HTTPS TestClient cookie semantics, actual Uvicorn child на локальном HTTP, restricted SQL role, nonce replay, CSRF/Origin, account isolation, expiry/version/status, shared throttling, ограничение hash cost, повторный вход после expiry/revoke, отказ видимого ввода пароля и rollback при ошибках миграции/записи. Runtime role не может менять owner/status/password_hash; реальная роль сервера не устанавливалась.

Первоначальные сбои тестового monkeypatch read-only PasswordHasher и старого specification-only assertion исправлены в fixtures/assertions; runtime hashing и границы будущих routes не ослаблялись. Две прежние FastAPI/httpx deprecation warnings остаются. Browser UI, физические устройства и реальные OAuth/email/Telegram/HA/VPN/AI провайдеры не проверялись.

Dependency locks дополнены argon2-cffi25.1.0/bindings26.1.0/cffi2.1.1/pycparser3.11. Остальные версии сохранены. Установка выполнена uv только в temporary venv/cache; system Python/Postgres/services не устанавливались или перезапускались. Первичная попытка python -m pip завершилась отсутствием pip и ничего не установила.

Synthetic benchmark10hash+10verify: Argon2id m19456/t2/p1, median15.76/15.93ms, max18.49/16.88ms. Это результат данной машины; semaphore2/process не является измеренным RSS или защитой всего будущего сервера от OOM. Capacity/worker count/ingress отдельно до deploy.

## Git, данные и границы

Начальный main6ea77494494cea5bbb4ffa5f9e8e80b614337483 был clean/synced. Implementation `1dc57cb4c980b111acbf5ccadb28f25871149c98` закоммичен по-русски и сразу pushed, точный origin/main SHA проверен; финальное evidence сохранено отдельным docs-only commit/push. origin/tournaments и qubite-v1.0 подтверждены на96f0457a523b6b79f21c4092056d8fa8fa69a680. Изменены только core/contracts/tests/harness/docs/task registry. Legacy back/front/index/services/deploy/дизайн/env/ShadeAI не менялись. Отчёт о deployment не составляется: deployment, live migration и подключение сервисов не выполнялись.

Readiness проверяет ledger и наличие шести core tables, не полный semantic schema fingerprint или готовность публичного TLS. Неподтверждённый DB commit не объявляется success и не повторяется автоматически. При rollback сохранять новые accounts/credentials/sessions и ledger0003; не удалять данные и не восстанавливать старую SQLite поверх нового Auth. Runtime/operator role provisioning, ingress/log redaction/backup/restore нужны перед постоянной установкой.

## Следующая задача

Реестр56:7done/4ready/45backlog. AUTH-010 и AUTH-011 переведены в ready после выполнения dependency, AUTH-003 остаётся backlog/approval=false.

Следующая AUTH-010: OAuth provider adapter, mock exchanges, configured providers/kill switches и безопасное явное linking. Далее AUTH-011: одноразовые verification/reset/email-2FA challenges. AUTH-003 policy требует отдельного approval; React UI/Console/native/keys/introspection/service switch выполняются по своим dependencies. Следующий цикл не начат.
