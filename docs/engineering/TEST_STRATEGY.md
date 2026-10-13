# Тестовая стратегия

**AUTH-00313.10.2026 — review/testing:** core0.5.0/schema0006_policy; раздельные ручные module/action grants, workspace/resource intersection, owner-only metadata commands с If-Match/idempotency/reauth/audit. Общий REST/job/tool/WS gate, live revoke/session/expiry/version; paid AI закрыт до AI-001/002. [Контракт](../architecture/POLICY_GATE.md), [отчёт](../reports/QUB-AUTH-003.md). Только аккаунт до grants подтверждено владельцем; перед каждой будущей задачей сначала вопросы и ответы. UI/registration/real modules/installer/native/provider/deploy отдельно. Final local all844+harness6=850pass, implementation/push/CI ещё проверяются; точные evidence в tasks.json/LAST_HANDOFF. Прежние snapshots ниже исторические.

**AUTH-01113.10.2026 done:** core0.4.0/schema0005 verify/reset и mock-only delivery; email-2FA contract-only, registration/policy/UI/native/deploy отдельные. [EMAIL_CHALLENGES](../architecture/EMAIL_CHALLENGES.md), [AUTH-011 report](../reports/QUB-AUTH-011.md), [ADR-0017](../architecture/decisions/0017-email-challenges-and-recovery.md). Final local+CI762 passed; implementationf3d4b6c/CI38373075395 success; прежние snapshots ниже исторические. После этого ready DEPLOY-001/TG-001, не начинать новый task в том же cycle.

**AUTH-01013.10.2026:** real PG OAuth state/link/login/unlink/disable/config/rate/role/migration tests + signed RS256 Google/Telegram и bound Yandex/VK MockTransport. [Actual evidence](../reports/QUB-AUTH-010.md), [контракт](../architecture/OAUTH_IDENTITY.md). Identity32 различает implemented AUTH-009/010 и planned будущие routes. No external network; historical totals ниже не текущий итог. Финально all693+harness4=697pass, core308/OAuth100; [Exact-SHA CI38364255314](https://github.com/kirillkuz1122/qubite/actions/runs/38364255314) completed/success 2026-10-13T07:43:22Z,697 checks, Python3.14.8/PG16.15. Real providers/browser/native/production acceptance отдельно.

**AUTH-00913.10.2026:** core208 (29foundation+59identity+120new Auth), финальный all593+harness4=597 pass локально и exact-SHA CI38354136689 (1dc57cb), Python3.14.8/PG16.15. HTTPS cookie semantics/TestClient, actual local Uvicorn, real PG races/limited SQL role и negative CSRF/status/expiry/throttle/malformed/body cases. Protocol32 различает implemented AUTH-009 и planned будущие routes; introspection oracle остаётся synthetic. [Evidence](../reports/QUB-AUTH-009.md), [scope](../architecture/WEB_AUTH.md). Исторические числа ниже относятся к прежним milestones; physical browser/OAuth/native/production отдельно.

Baseline 12.10.2026: existing 65 Node tests и 18 deploy unittest прошли вне filesystem/socket sandbox; подробный итог изолированного harness см. [отчёт](../reports/QUB-001.md). npm test пока не агрегирует suites. Новые tests — catalog + grading characterization; полный tournament HTTP/E2E пока не готов.

## Пирамида и release gates

| Уровень | Scope | Команда/цель |
|---|---|---|
| Docs/tasks harness | schema/states/dependency cycles/approved ready/done evidence | python3 scripts/engineering/check.py; unittest tests/engineering |
| Legacy unit/domain | security/task-runtime/catalog/schema, grants/usage/keys | verify.py --suite node |
| Service contract/integration | auth/native enrollment/revoke, Search fetch/auth/ledger, Brief outbox/AI mocks, Kwork hooks, managers | verify.py --suite all --python <test-venv-python> |
| Новое Core integration | actual API + disposable Postgres migrations + concurrent locks + fake provider | verify.py --suite core --python <test-python> --postgres-bin <native-bin>; настоящие Auth/migrations/PG race fixtures, будущие budget races отдельно |
| UI/E2E | owner/nonowner/denied direct URL, capture/offline/two-device/restore, legacy tournaments | Playwright fixtures + isolated HTTP, screenshot/viewports; команды создаются QUB-TEST-002/QUB-UI-001 |
| Hardware/performance | Android pen, crash/autosave/PDF/frame pacing; Pi simultaneous load | реальные устройство/нагрузка; fake device не закрывает acceptance |
| Ops | backup/restore/schema rollout/canary/rollback | disposable restore + read-only checks, production отдельно |

Critical legacy scenarios: register/login/logout/revoke/email/password reset/OAuth state and PKCE, blocked user; end catalog + hidden roster/code; individual/team join + deadline + late join; submission/grading/drafts/penalty + authoritative totals; rating history/no duplicate bonus/decay; services owner protection/revoke/budgets/key scopes; native API bindings; one bot; unknown sends paused.

Paid security: все access policy 10 cases, owner no budget, forged role/header, cross workspace/team/private graph/search/cache, public guests, MCP/plugin/WS/background bypass, 100 requests/two workers, period rollover/double settle/unknown delivery/revoke while job. Provider mock counter 0 при отказе. No real AI/TG/HA/Kwork endpoints в CI.

CI на push/PR только tests, без deployment credentials. Python dependency lock сохраняет воспроизводимость; Node npm ci использует существующий lock. Если required suite failed/missing dependencies/timeout — gate красный, не skip green. UI/typecheck/lint появятся с соответствующим кодом и будут required для его задач; сейчас не выдумывать команды для несуществующего React.

Тесты отдельных модулей проверяют helpers/router fixtures; passing suite не доказывает full server.js integration. Coverage измерять по risk/requirements, не строкам. Нет нового теста ради mirror implementation; нужны regression boundaries и failure cases. Формат evidence: command/runtime/date/fixture scope/counts/result/limitations. При ошибке среды отдельный bounded retry с той же изоляцией, не менять dependencies из-за необъяснённого hang.

Bot/analytics migration требует отдельного feature-parity review: mock Telegram updates/send transport, binding/revoke/scoped callbacks/exact reply/TTL/unknown delivery/single consumer. Infrastructure metrics тестируют load vs CPU%, host/cgroup/process units, counter reset, missing/stale values, UTC duration и multi-source dedup. Каждая legacy функция имеет target/test либо explicit retirement decision. [Матрица и обнаруженные нюансы](../architecture/TELEGRAM_AND_OBSERVABILITY.md).

Подтверждённый capture scope: text/voice без меню, durable raw→STT/classify/route→undo/link. Проверки: linked vs guest Support, exact force-reply priorities, duplicate update/content fingerprint, crash до/после ACK, voice partial download/STT failure, cost deny/raw Inbox, model injection/unknown target, undo после новых edits. Daily digest/critical event links — UTC/DST/restart/dedup/revoke/sensitive delivery и auth deep-link tests. Новые shared functions FastAPI сравниваются с synthetic legacy contract fixtures, не читают live SQLite.

## HTTP baseline Auth — QUB-TEST-001

Настоящий server.js в source-copy/temp SQLite; 25 сценариев register/login/session/reset/email-2FA/OAuth/CSRF/expiry/blocked/PKCE/Telegram signature. Только внешний transport mock, no real env/providers. Node suite теперь 94 pass; полный runner+harness 357 pass. [Отчёт и три воспроизводимых legacy дефекта](../reports/QUB-TEST-001.md). Characterization ожидания `legacy defect` нельзя переносить в новый Auth: это migration negative requirements, а не accepted behavior. Browser/provider/production acceptance остаются открытыми.

## PostgreSQL core foundation — QUB-CORE-001

29 real core cases: contracts/no-network startup/config denial/read-only readiness, actual native PG DDL+rollback/concurrency/drift/CLI, readonly runtime role и дочерний uvicorn HTTP smoke. `verify.py --suite core --python <venv-python> [--postgres-bin <native-bin>]` и required all. Missing binaries/dependencies fail без skip; fresh private cluster/database, no Docker/live storage. Локальный all+harness теперь386 pass. [Scope/evidence](../reports/QUB-CORE-001.md); migration history не полный semantic schema diff и не production acceptance.

## Единый identity contract — QUB-AUTH-008

32 synthetic protocol cases в tests/identity: свежий authority/no import, SHA256/PKCE fixtures в Python+Node, strict credential types/ambiguity, UUID/status/audience/expiry/version/scopes, secret/role field rejection, owner без расширения scopes, native/cookie/private route boundaries. Тестовый oracle **не runtime verifier**; real password/session/CSRF/rotation/concurrency/provider/device tests появятся AUTH-002/009/010/012/013/014. check.py проверяет route→task references по реестру.

`python3 scripts/engineering/verify.py --suite identity --python <test-python>`; эта suite входит в обязательную all и CI. Source-copy без .env/real HOME/DB, внешняя сеть запрещена, vectors синтетические. Целевые protocol requirements не исправляют три старых legacy Auth дефекта; Search/Writing/VPN runtime пока остаётся прежним. [Отчёт](../reports/QUB-AUTH-008.md), [контракт](../migration/IDENTITY_CUTOVER.md).

13.10.2026 AUTH-008: full all414 +harness4 =418 passed (Node94/deploy18/Search95/Brief112/Kwork29/SiYuan5/identity32/core29), без failed/skipped; native PG18.6. Две прежние deprecation warnings не errors; будущая Auth runtime acceptance не выполнена.

## Реальная identity schema/bootstrap — AUTH-002

Core suite теперь88 cases:29 foundation +59 identity tests. Temporary PostgreSQL18.6, semantic CHECK/UNIQUE/composite FK/RESTRICT, canonical collisions, UUID/default-deny metadata, owner/account races, failed partial insert transaction, limited account writer role, local CLI process/EOF cancel/приватность ошибочных argv, history/table gates и отсутствие public bootstrap/login routes. Current0002 migration меняет foundation expectations, OpenAPI unchanged. Password/session/provider/device enforcement ещё будущие, не pass этой задачи. Финальный all473 +harness4 =477 passed локально и CI38348273457 на implementation0dff63e (Python3.14.8/PG16.15), без failed/skipped. Exact-SHA CI/Git evidence в [report](../reports/QUB-AUTH-002.md).

## AUTH-003 policy и bounded core runner

core/tests/test_policy.py: disposable nativePG/real HTTP-session/WS,86проверок — manual independent grants/default deny, installed/enabled, workspace/resource/role/ACL/expiry, owner/JSON actor/paid bypass, version/idempotency/audit rollback/concurrent mutation/revoke vs effect, exact job/tool session/version/target/channel/TTL, idle WSS revoke и guards, identity-preserving migrations/drift. Callback provider counter0 на отрицательных путях, paid runtime закрыт; domain content/graph/search/device/deploy acceptance отдельно.

После AUTH-011 CI core373=156.06s при180s лимите новые86кейсов требуют partition: foundation/identity/auth; OAuth/challenges; policy и все future/nested. Recursive test_*.py/*_test.py discovery, каждый file один раз и прежний180s timeout каждой группы; два unit tests проверяют отсутствие потерь. Три temporary PG clusters, no skips/env/data/HOME/external network. Targeted --suite policy дополнен, mandatory --suite all включает весь core.
