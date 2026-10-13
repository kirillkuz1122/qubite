# QUB-AUTH-011 — Email verification/password reset и email-2FA contract

13.10.2026. Задача в review/testing, implementation commit и CI ещё не получены. Начало clean main `689cf4fa5a8b333033ac2a8520ca60aefb83fd9d`, origin main совпадал; archive refs `tournaments`/`qubite-v1.0` проверены на `96f0457a523b6b79f21c4092056d8fa8fa69a680` и не изменялись.

## Результат в коде

Core0.4.0/schema0005: четыре POST verify/reset request/confirm, typed random one-use SHA-256 proofs,TTL1800/900s,5attempts, shared PG request/confirm caps, strict Origin/Host/body/CSRF/cookie/redacted errors. Verify pending→active existing UUID и email_verified_at, без account/owner/grants creation. Reset только previously verified active account/existing credential, Argon2id update +auth/credential version +all own session revoke одной транзакцией, no autologin. Current subject/email/status/password gates до/после hash/transport; subject-first locking, one concurrent winner. Transport injected mock-only/off default, errors generic202/unusable proof; no SMTP/real sends. [Контракт/ограничения](../architecture/EMAIL_CHALLENGES.md), [ADR-0017](../architecture/decisions/0017-email-challenges-and-recovery.md).

Email-2FA — **protocol contract only**, runtime_implemented=false; pending password+mail+browser proofs/TTL/attempts/no pre-session/no verify-reset reuse/no OAuth bypass/no reset-disable зафиксированы, но enforcement/enrollment/recovery/UI отдельная approved follow-up задача. Нельзя считать текущий Web/OAuth runtime двухфакторным. Публичная регистрация остаётся AUTH-006 backlog/approval=false.

## Проверки и ограничения evidence

Первые targeted core прогоны:4failed/357pass (ошибка fixture.email, missing schema test bootstrap и старый OpenAPI snapshot); после первого исправления1failed/371pass (опечатка email_original_original). Эти test defects исправлены до контрольного полного прохода. Контрольный core прошёл372/64.00s. Первый full all дошёл до identity suite:31pass/1fail из-за прежнего exact списка implemented_tasks009/010; oracle обновлён на009/010/011 без ослабления проверки. Финальный full all после bounded третьего batch исправления запущен; cleanup skip-locked также проверяется. **Final local all:758 passed**, core373/64.02s (foundation29+identity59+Auth120+OAuth100+email65), Node94/deploy18/Search95/specbot112/Kwork29/SiYuan5/identity32. Harness4 отдельно, итого**762 local checks**, без failures/skips. Python3.13.13/PostgreSQL18.6/Node22.22.2; no external network, fresh native PG cluster/source-copy/no .env/private HOME. Check/diff pass. CI exact-SHA ещё ожидается, задачу не считать done до него.

`core/tests/test_challenges.py` использует реальную disposable PG/HTTP и memory-only delivery: owner/pending/unknown/blocked, own-vs-other session revoke, reset password/UUID/replay/expiry/attempts/rates, resend/purpose/type, concurrency, DB atomic failure, transport and hash/version/TTL races, disabled/config/CSRF/body/header failures, migration failure/schema drift. Existing core/legacy targeted suites сохраняются; OpenAPI snapshot обновлён,0001..0004 SQL не изменялись.

Real emails/SMTP timing/queue/deliverability/notification after reset, production ingress/redaction, UI/native/real provider/device/owner/deploy не проверены и не включены. Mail injection synchronous test-only,202 body одинаковый, timing indistinguishability не заявляется. Paid/API/email/provider calls отсутствуют; .env/секреты/legacy runtime/service/DB/deploy/ShadeAI не изменялись. Design133 historical/browser rerun не требуется. Push не deploy.

## Rollback и следующий шаг

Forward0005 сохраняет UUID/password/session/OAuth data; отключить email flag в совместимом core0.4, не down/drop и не возвращать legacy auth. Production migration требует отдельного backup/restore/staging/разрешения. После green local/CI — final evidence commit/push и handoff. Следующие ready DEPLOY-001 (deploy/installer specification) и TG-001 (bot domain/parity specification); policy/registration/UI approval gates не снимать автоматически.
