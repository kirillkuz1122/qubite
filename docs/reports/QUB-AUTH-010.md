# QUB-AUTH-010 — OAuth и явная привязка аккаунтов

13.10.2026. Задача **done**: implementation `d93affac786033668dd4ac74f69218d0928ca388` pushed/remote verified; [CI38364255314](https://github.com/kirillkuz1122/qubite/actions/runs/38364255314) completed/success 2026-10-13T07:43:22Z, **697 checks** локально и CI. Финальная фиксация evidence отдельным docs-only commit. Разрешена ready AUTH-010 после AUTH-0091dc57cb/CI38354136689 success/597checks; прямое указание владельца следующей задачи. Main в начале6c803cb2cbe004145bdff1e6e0fb1f88b1a63e7d, archive tournaments/qubite-v1.0 проверен на96f0457a523b6b79f21c4092056d8fa8fa69a680. Другие ready задачи не запускались.

## Что реализовано

- Core0.3.0/current0004 OAuth, четыре adapters и пять HTTP operations: provider metadata/start/callback/own bindings/unlink. Opaque web cookies прежнего Auth, same-origin CSRF/own password link/unlink, external navigation callback. Stable unique provider+issuer+subject, no matching email/implicit signup/promotion/module/AI grants. [Фактический контракт/схема/лимиты](../architecture/OAUTH_IDENTITY.md), [ADR-0016](../architecture/decisions/0016-explicit-oauth-identities.md).
- Signed RS256 Google/Telegram ID tokens с fixed JWKS/issuer/audience/nonce/time/JWK bounds; Yandex/VK server code exchange+bound userinfo. Minimal scopes, no persisted access/refresh tokens. Telegram — актуальный OIDC, не legacy widget/Bot token.
- TTL300 browser-bound one-use state, derived PKCE/nonce/hash-only store; reserve commit до обмена. Provider enabled/version/config digest rechecks до/после exchange; disable→enable/rotation обрывают прежний flow. Own subject/session/auth/credential/recent password rechecks после exchange; race-safe unique links и own-only unlink/revoke.
- Additive0004 сохраняет0001..0003/checksums, subjects/owner/passwords/старые web sessions. Четыре disabled provider rows, oauth identities/states/security audit и sessions.password_proven. Default external transport выключен. CLI enable/disable требует confirmation, runtime DB role не меняет enabled/owner/status/password_hash.
- OpenAPI/identity-v2 теперь partial runtime AUTH-009/010; register/reset/native/keys/introspection/policy ещё planned. Locks добавляют httpx/PyJWT/cryptography; остальной stack не заменён. Проектные docs/context/handoff/task registry обновляются в этом cycle.

## Проверки и границы evidence

До финального прогона: core1 —294pass/4fail (старые assertions, readonly schema namespace lookup, fixture clock); core2 —307pass/1fail (новый synthetic test ошибочно использовал status pending_verification вместо actual pending). Все причины исправлены; финальный полный прогон green. Промежуточные failures не выданы за successful acceptance.

**Финально локально:** verify.py all693 + unittest harness4 = **697 passed**, no failed/skipped. Node94/deploy18/Search95/Brief112/Kwork29/SiYuan5/identity32/core308; core29foundation+59identity+120Auth+100OAuth,47.00s. check.py:56задач/57docs, dependencies/source trace/48ideas/links pass; git diff --check pass. Identity targeted32 также pass. Commands: `python3 scripts/engineering/verify.py --suite all --python /tmp/qubite-design-tests/bin/python --postgres-bin /tmp/qubite-design-postgres/usr/bin`, `python3 -m unittest discover -s tests/engineering`, `python3 scripts/engineering/check.py`, `git diff --check`.

Targeted/full runner: source-copy/.env excluded/isolated HOME/no external network, real native disposable PostgreSQL18.6, Python3.13.13/Node22.22.2. HTTP TestClient HTTPS, synthetic own passwords/RSA2048/JWKS/MockTransport; old actual Uvicorn checks сохранены. Тесты проверяют all4 link→login, even verified matching email no takeover/no registration, disabled/config/rate/replay/expiry/provider error, bad signature/claims/userinfo, cross-site navigation-only, SQL races/status/password change/revoke, restricted runtime role, migration old password session. CI core308 занимает67.99s (local47.00s). Exact-SHA CI38364255314 подтвердил все697 checks на Python3.14.8/PostgreSQL16.15/Node22. Принадлежность run к implementation SHA проверена; green не выводится из старых runs.

Primary official provider contracts сверены13.10.2026, ссылки в runtime doc. Это adapter contract acceptance, **не actual Google/Yandex/VK/Telegram registration/keys/live browser roundtrip**. Known FastAPI/httpx TestClient warning retained; dependency change to httpx2 не нужен в этой задаче. Material Lab/browser133 не перезапускался и не входит в новые числа.

Legacy AUTH-L02 kill callback и AUTH-L03 email-only takeover воспроизводятся в прежних Node sources. Новый core их запрещает regression tests; legacy не переписан и service cutover не объявлен. AUTH-L01 malformed cookie уже safe в AUTH-009. No real provider key/.env/account/bootstrap/network/paid call, server deployment/production DB/restart, Android/Desktop/browser state, bot/React/service migration. ShadeAI/архив/старые файлы не менялись.

## Следующая задача и откат

Final tests/implementation push/CI подтверждены; далее AUTH-011 email verify/reset, отдельным bounded cycle. Policy AUTH-003 требует approval, React Auth/services/native/Owner Console после своих dependencies. Реальный provider enable/deployment отдельной подготовкой credentials/redirect/HTTPS/IP/log redaction/backup/restore/capacity; push не deploy.

Rollback сохраняет0004 и новые записи/UUID/credentials/bindings/audit. Old0.2 binary не ready на ahead0004; не drop/down и не SQLite password/session restore поверх core. Forward migration и restricted privileges тестовые, реальное provisioning позже.

## Git и итог

13.10.2026: implementation d93affac786033668dd4ac74f69218d0928ca388 pushed/remote exact SHA verified; archive tournaments/qubite-v1.0 unchanged96f0457a523b6b79f21c4092056d8fa8fa69a680. GitHub CI38364255314 completed/success 2026-10-13T07:43:22Z,697 checks (all693+harness4/core308/OAuth100) no failed/skipped; https://github.com/kirillkuz1122/qubite/actions/runs/38364255314. CI Python3.14.8/PG16.15, local Python3.13.13/PG18.6. Real providers/keys/deploy не acceptance. Финальный docs-only evidence commit отдельно.

Registry56:8done/3ready/45backlog; ready AUTH-011/DEPLOY-001/TG-001. ARCH/policy approvals не менялись, следующая задача не начата. Final docs-only handoff не меняет tested runtime.
