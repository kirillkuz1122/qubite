# Передача следующей сессии —13.10.2026 / AUTH-009

**AUTH-009 реализована, review/testing:597 local checks прошли, Git/CI ожидаются.** Реальные Web Auth/core0.2.0/schema0003, password/profile/sessions/CSRF/reauth/revoke и local owner initial password CLI. [Runtime/команды/ограничения](../architecture/WEB_AUTH.md), [report](../reports/QUB-AUTH-009.md), [ADR-0015](../architecture/decisions/0015-web-password-sessions.md), [tasks](../plan/tasks.json). Постоянный owner/password не создавались, только disposable fixtures.

## Реализация и проверки

- 0001/0002 unchanged;0003 additive credentials/web sessions/preauth/counters. Current table/history gate, no startup DDL/network/hash, explicit origin/local cookie mode. New OpenAPI snapshot0.2.0/health unchanged, identity-v2 partial only implemented AUTH-009 routes; future OAuth/native/keys/introspection/register/reset planned.
- Argon2id m19456/t2/p1, bounded PHC/semaphore2, exact Unicode password; opaque256-bit cookies/hash-only DB. Local setup getpass TTY/confirm/no overwrite/secret argv; real password агенту не передавать.
- Exact configured Origin/Host/session-bound CSRF, one-use anonymous challenge, strict duplicate/legacy/bearer/percent/body/query/validation guards. Subject→session/credential row locks, shared migration gate, hashing вне transaction и final snapshot check. PostgreSQL counters (login+reauth canonical8/IP30/bootstrapIP60 per300s), idle7d/absolute30d/recent300s, own-only revoke/logout-all version bump; no module/AI owner bypass. Unauthenticated401 очищает cookie для повторного входа; wrong reauth password сохраняет её. Getpass echo fallback запрещён до чтения.
- 208 core (29foundation+59identity+120Auth), all593+harness4=597 passed; native PG18.6/Python3.13.13/Node22.22.2. HTTPS TestClient/cookies +actual local Uvicorn/PG races/limited role. Argon synthetic10+10 median15.76/15.93ms, max18.49/16.88ms, не benchmark future VPS/RSS. Known FastAPI/httpx warning retained. Runtime/test locks добавляют Argon packages, другие версии unchanged; venv без pip, uv install только /tmp.
- Cookie/session/credentials не печатать/логировать; access/proxy logs выключить/редактировать при deploy. Runtime privileges проверены synthetic role, real provisioning/ingress/TLS/backup/worker capacity отдельно. Rollback сохраняет UUID/credentials/sessions/ledger, old binary0002 ahead fail closed. Actual account import/production/deploy/providers/UI/native не выполнялись, ShadeAI read-only unchanged.

## Следующая задача

AUTH-010 OAuth provider adapters/configured kill switches/explicit account linking, только mock transport; AUTH-011 verification/reset после неё. AUTH-003 policy пока требует approval; React UI/Console/native/keys/service switch отдельно по dependencies. Один bounded cycle, не auto-start новой задачи. Registry56:6done/2ready/47backlog/1review-testing до Git/CI evidence.

## Сохранённые решения и evidence

- AUTH-002 done0dff63e/CI38348273457 success13.10 04:50:13UTC,477 local+CI tests; final docs-only main6ea7749 перед этим cycle. Новые проверки AUTH-009 отдельно, не пересчитывать прежний report.


- AUTH-008 done a48685c5a68cf8ca8973d6561f44b491157a9f1a /CI38344387215 success13.10 04:01:52UTC,418 checks local+CI Python3.14.8/PG16.15. Это historical specification milestone; текущий identity-v2 partial Web Auth, full introspection ещё planned. [Report](../reports/QUB-AUTH-008.md).
- DESIGN-001 **done**: Поток/Игрушечная/Лента/Unbounded/Manrope,100/503, версия4 принята владельцем. [Демо](https://qubite-material-lab-kirill.kuzmichevkonstantin9.chatgpt.site/#/flux/appearance), [Color Plastic](../design/COLOR_PLASTIC.md)/[Flux](../design/FLUX_DESIGN_SYSTEM.md),133 browser/519 total в прежнем cycle. Final layout/device/PET-* отдельно; hidden/edge peek/contextual entry/retreat сохранены; помощники scripted, real agents нет.
- Demo owner-private, exact hosting.json project_id reuse, source8e8aba31/version4/deploymentappgdep_6acd9fa05db08191b83a91968a2a70e6 succeeded03:04:14UTC. No autopublish/нового login gate для агента; владелец сам посмотрел.
- Owner normal home, separate Console, manual module/model grants/budgets, tournament scoped roles. Shared APIs FastAPI/own React UI; optional Tournaments Node/SQLite/Vanilla. TG automatic text/voice capture/support/staff/events/deep links/metrics, tournament settings module-local. Web/Android/Linux desktop/installer обязательны; hosting/Pi/VPS отложены.
- Main до identity циклов93bca8edca89a0f694c1644790494c2884194de4; начало AUTH-0096ea77494494cea5bbb4ffa5f9e8e80b614337483; origin/tournaments +tagqubite-v1.0 immutable96f0457a523b6b79f21c4092056d8fa8fa69a680, refs проверены перед задачей. Russian commit→immediate push, push не deploy. Existing local files/data не удалять, rollback сохраняет new UUID/data; schema0001 binary не ready с0002ledger.
- TEST-0016952277/CI38207835631 фиксирует L01cookie500/L02Googlekill/L03unverifiedlink — legacy defects остаются, no accepted new behavior. CORE-001a85f047/CI38211426535 и audit ae3f71e/CI38197926998 historical; новые результаты этой задачи отдельно.
- Legacy back/front/index/services/deploy/env/ShadeAI не менялись; ShadeAI read-only future connector; root V2 filename отсутствует. Skills/reset/subagents не использовать. Master/access source неизменны/all48 ideas preserved; no secrets/private DB/message/browser/session artifacts в Git. Production install/migration/actual owner bootstrap и paid/provider/device acceptance не выполнялись.
