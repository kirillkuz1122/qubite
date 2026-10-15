# Карточки задач Qubite 2.0

69 карточек. Актуальный machine registry — [tasks.json](tasks.json). Перед каждым следующим task вопросы и ответы владельца. Runtime/tests/live acceptance разделены; standalone Tournaments по ADR-0021.

## QUB-001 — Аудит и архитектурный baseline

Статус: done; модуль: core; приоритет: P0; approval: true. Зависимости: нет.

Зафиксировать фактический legacy, целевые требования и границы согласования до изменения runtime

Файлы: `docs/architecture`, `docs/product`, `scripts/engineering`.

Acceptance:

- Архивные refs проверены; инвентари, требования/ADR/план и безопасный harness подготовлены
- Пользователь выбирает архитектуру, отчёт различает code/docs/server/proposal

Проверки: python3 scripts/engineering/check.py.

Риски: Новый процесс не открывает legacy writable DB; изолированная schema миграция; capacity перед деплоем. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change

Commit: ae3f71e0ae29ef10a6f772027b48addba9d508fc. Evidence: ["origin archive refs verified 12.10.2026", "QUB-001 report contains local test results", "12.10.2026 ответы владельца 1–6; ADR-0001/0005/0006 фиксируют стек и scope", "332 baseline checks; GitHub Actions run 38197926998 passed"].

## QUB-OPS-001 — Read-only production inventory и drift

Статус: backlog; модуль: ops; приоритет: P0; approval: false. Зависимости: нет.

Репозиторий не доказывает текущую версию/ресурсы production; исключить overwrite drift и скрытый autodeploy

Файлы: `docs/reports/PRODUCTION_INVENTORY.md`.

Acceptance:

- SHA/dirty paths/units/routes/data sizes и RAM/swap/disk собраны без секретов
- Autodeploy и один polling проверены; никаких restart/write

Проверки: Проверка redacted manifest; сравнение с INVENTORY.json.

Риски: Не раскрыть private configs; restore не посылает outbox и не перезаписывает production. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change

Commit: None. Evidence: [].

## QUB-OPS-002 — Backup manifest и disposable restore

Статус: backlog; модуль: ops; приоритет: P0; approval: false. Зависимости: QUB-OPS-001.

Git не хранит рабочие БД/attachments/keys; восстановление должно быть доказано до миграций

Файлы: `docs/engineering/DEPLOYMENT_AND_BACKUPS.md`, `scripts/engineering/restore-drill.py (будущий)`.

Acceptance:

- Согласованный SQLite+attachments+keys backup off-host
- Восстановление isolated; counts/FK/hash/grants/ledger совпали

Проверки: Будущий restore drill с synthetic fixtures + integrity_check.

Риски: Не раскрыть private configs; restore не посылает outbox и не перезаписывает production. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change

Commit: None. Evidence: [].

## QUB-TEST-001 — Auth HTTP characterization

Статус: done; модуль: identity; приоритет: P0; approval: true. Зависимости: QUB-001.

Текущие auth suites проверяют helper/router fixtures, но не весь register/login server.js

Файлы: `back/tests/auth-legacy-baseline.test.js`, `back/tests/fixtures/auth-server.cjs`, `docs/reports/QUB-TEST-001.md`, `docs/architecture/ENV_AND_TESTS.md`, `docs/engineering/TEST_STRATEGY.md`, `docs/plan/tasks.json`, `docs/plan/TASKS.md`, `docs/project/PROJECT_CONTEXT.md`, `docs/project/LAST_HANDOFF.md`, `README.md`, `SECURITY.md`, `AGENTS.md`, `CLAUDE.md`, `docs/README.md`, `docs/architecture/AUTH_AND_PERMISSIONS.md`, `docs/plan/ROADMAP.md`, `docs/reports/STATUS-2026-10-12.md`.

Acceptance:

- Реальный server isolated register/login/logout/revoke/reset + OAuth transport mock
- Blocked user/CSRF/state/PKCE/cookie malformed negative cases

Проверки: python3 scripts/engineering/verify.py --suite node.

Риски: Не читать пароли в модель; blocked/revoked/OAuth subject не превращается в owner; sessions не теряются. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change

Commit: 695227792e6ab7a09cdad67b56d8acbad4cc0ad9. Evidence: ["12.10.2026: verify.py --suite all --python /tmp/qubite-audit-venv/bin/python: Node94/deploy18/Search95/Brief112/Kwork29/SiYuan5 =353 pass; harness unittest4 =357. No skipped/failed.", "25 real-server Auth HTTP cases; runtime unchanged; synthetic external transport only. AUTH-L01..03 retained legacy defects, P0 account linking cutover gate in report/SECURITY.", "check.py и git diff --check passed; implementation commit 695227792e6ab7a09cdad67b56d8acbad4cc0ad9 pushed/remote main verified; GitHub Actions run 38207835631 success."].

## QUB-TEST-002 — Tournament runtime и rating regression

Статус: backlog; модуль: tournaments; приоритет: P0; approval: false. Зависимости: QUB-TEST-001.

Сохранить сложный join/submission/rating flow до выделения турниров в модуль

Файлы: `legacy/qubite-v1/back/tests/tournament-http.test.js (будущий)`, `legacy/qubite-v1/back/tests/rating-baseline.test.js (будущий)`.

Acceptance:

- Join individual/team/roster/code, submit/draft/deadline/penalty покрыты
- Rating/history/bonus/decay повтор не дублирует; baseline UI screenshot

Проверки: verify.py --suite node; будущий Playwright fixture.

Риски: Сохранить roster/codes/team/results/rating; не допустить глобальной эскалации. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change

Commit: None. Evidence: [].

## QUB-CORE-001 — Изолированный core health и contract skeleton

Статус: done; модуль: core; приоритет: P0; approval: true. Зависимости: QUB-001.

Проверить выбранный runtime/storage контракт без write доступа к legacy данным

Файлы: `core/`, `contracts/core-v1.json`, `scripts/engineering/verify.py`, `scripts/engineering/test-requirements.lock`, `tests/engineering/`, `.github/workflows/engineering.yml`, `.gitignore`, `README.md`, `SECURITY.md`, `AGENTS.md`, `CLAUDE.md`, `docs/architecture/CORE_FOUNDATION.md`, `docs/architecture/TARGET_ARCHITECTURE.md`, `docs/architecture/DATA_MODEL.md`, `docs/architecture/decisions/0009-core-foundation.md`, `docs/architecture/decisions/README.md`, `docs/engineering/TEST_STRATEGY.md`, `docs/engineering/AGENT_HARNESS.md`, `docs/architecture/ENV_AND_TESTS.md`, `docs/reports/QUB-CORE-001.md`, `docs/reports/STATUS-2026-10-12.md`, `docs/project/PROJECT_CONTEXT.md`, `docs/project/LAST_HANDOFF.md`, `docs/plan/tasks.json`, `docs/plan/TASKS.md`, `docs/plan/ROADMAP.md`, `docs/README.md`.

Acceptance:

- FastAPI health и Postgres versioned migration на disposable DB; no legacy DB writes
- Contract validation и no-network startup tests

Проверки: python3 scripts/engineering/verify.py --suite core --python <venv-python> --postgres-bin <bin>; python3 scripts/engineering/verify.py --suite all --python <venv-python> --postgres-bin <bin>; python3 -m unittest discover -s tests/engineering; check.py; git diff --check.

Риски: Новый процесс не открывает legacy writable DB; изолированная schema миграция; capacity перед деплоем. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change

Commit: a85f047e7e54c07a6f780a127988b14d9c623a74. Evidence: ["12.10.2026: all isolated runner Node94/deploy18/Search95/Brief112/Kwork29/SiYuan5/core29=382 pass; harness4=386; no failed/skipped.", "Real native PostgreSQL18.6 + Uvicorn HTTP, checksum/drift/rollback/concurrent/read-only role/no-env/no-network startup; only temp DB, no legacy/runtime/deploy changes.", "check.py/git diff --check/harness4 passed; commit a85f047e7e54c07a6f780a127988b14d9c623a74 pushed/remote SHA verified; CI run 38211426535 success incl PostgreSQL16.15/core29/all suites, local PostgreSQL18.6."].

## QUB-AUTH-002 — Новые PostgreSQL аккаунты и локальный owner bootstrap

Статус: done; модуль: identity; приоритет: P0; approval: true. Зависимости: QUB-AUTH-008, QUB-CORE-001, QUB-TEST-001.

Создать fresh identity нового core без импорта/bridge старых аккаунтов

Файлы: `core/qubite/identity/`, `core/qubite/sql/0002_identity.sql`, `core/qubite/migrations.py`, `core/tests/test_identity.py`, `core/tests/test_foundation.py`, `core/requirements.in`, `core/README.md`, `docs/architecture/`, `docs/project/`, `docs/plan/`, `docs/engineering/TEST_STRATEGY.md`, `docs/engineering/AGENT_HARNESS.md`, `docs/migration/IDENTITY_CUTOVER.md`, `docs/reports/QUB-AUTH-002.md`, `README.md`, `docs/README.md`, `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `TODO.md`.

Acceptance:

- Explicit subjects UUID/email/status/auth_version + singleton platform_owner schema, checksum/transactional migrations
- Локальный явный bootstrap owner: no public endpoint/first-register privilege, atomic repeat/concurrency rejection, preserve same UUID
- Нет old password/session/role/grant import, integer-ID mapping и обязательного alias; password setup/login следующая AUTH-009
- Readiness/migration/invariants и existing foundation negative tests; secrets/passwords не записываются в argv/logs

Проверки: python3 scripts/engineering/verify.py --suite core --python <test-python> --postgres-bin <native-bin>; python3 scripts/engineering/verify.py --suite all --python <test-python> --postgres-bin <native-bin>; python3 -m unittest discover -s tests/engineering; python3 scripts/engineering/check.py; git diff --check.

Риски: Owner takeover через public bootstrap/first signup; local bootstrap не означает готовый password login. Откат: Снять новый route/artifact, сохранить PostgreSQL accounts/credentials/new writes. Не restore старые SQLite пароли/сессии поверх новой identity; deploy отдельно.

Commit: 0dff63e9bb3cbabf6c2b10628db12c228ee54413. Evidence: ["ADR-0013/13.10.2026: владелец разрешил единый новый API/Auth и fresh owner; архитектура предметных schema/explicit bootstrap одобрена в этом scope. Ready после done AUTH-008, без начала второго slice.", "13.10.2026: прямое указание владельца «Делай след задачу», принят один bounded cycle AUTH-002. Проверенные dependencies done, runtime/login/сервисы/deploy вне этого slice.", "13.10.2026: финальный isolated all473 (Node94/deploy18/Search95/Brief112/Kwork29/SiYuan5/identity32/core88) +harness4 =477 pass; no failed/skipped, native PostgreSQL18.6/Python3.13. Core29 foundation+59 identity cases.", "13.10.2026: implementation 0dff63e9bb3cbabf6c2b10628db12c228ee54413 pushed, origin/main/archive refs verified; GitHub Actions38348273457 completed/success 04:50:13UTC, Python3.14.8/Postgres16.15, all473+harness4=477 pass; no failed/skipped. Public Auth/UI/real owner/deploy вне scope."].

## QUB-AUTH-003 — Module entitlements и scoped policy gate

Статус: done; модуль: policy; приоритет: P0; approval: true. Зависимости: QUB-AUTH-002, QUB-AUTH-009.

Старые глобальные роли и owner bypass не подходят новой default-deny модели

Файлы: `core/qubite/policy/`, `core/qubite/sql/0006_policy.sql`, `core/qubite/app.py`, `core/qubite/identity/auth/http.py`, `core/qubite/migrations.py`, `core/tests/`, `contracts/policy-v1.json`, `contracts/core-v1.json`, `scripts/engineering/verify.py`, `docs/`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `SECURITY.md`, `TODO.md`.

Acceptance:

- Default deny и intersection REST/job/tool/WS реализованы
- Owner/tournament/cross-resource/revoke/API bypass negative matrix

Проверки: Изолированный core pytest: PostgreSQL/HTTP/WS/job/tool, grant/revoke/expiry/version/owner/cross-resource negative matrix; external/provider calls 0; verify.py all + tests/engineering + exact-SHA tests-only CI.

Риски: Cross-scope/guest/plugin/job могут обходить UI; owner не bypass бюджета. Откат: Отключить policy consumers/module enabled, сохранить schema0006/UUID/grants/audit/new data и backup, применить tested forward fix. Не down/drop и не запускать old core против ahead schema; production migration/deploy отдельно.

Commit: d4c813eb7aa02fd2b07a72ec90192efbc6209c9f. Evidence: ["13.10.2026: direct AUTH-003 authorization and answers account-only/manual independent read-write-manage; questions before every future task.", "13.10.2026: final isolated all844+harness6=850 pass (core459=208+165+86); local Python3.13.13/PostgreSQL18.6/Node22.22.2. Core groups25.24s/45.62s/43.33s; no failed/skipped, external/provider calls0. Implementation/CI success подтверждены отдельной записью ниже.", "13.10.2026: implementation d4c813eb7aa02fd2b07a72ec90192efbc6209c9f pushed, origin/main exact and archive refs96f0457a verified; CI38381905595 completed/success10:17:52UTC. All844+harness6=850 pass, core459=208+165+86; CI Python3.14.8/PG16.15/Node22.23.3, core43.26s/72.64s/65.00s. No failed/skipped, tests-only/no deploy."].

## QUB-AI-001 — Atomic mock budget reservation

Статус: done; модуль: ai; приоритет: P0; approval: true. Зависимости: QUB-AUTH-003.

Раздельные float ledgers не защищают общий cap при параллельном расходе

Файлы: `core/qubite/ai/`, `core/qubite/sql/0009_budgets.sql`, `core/qubite/policy/store.py`, `core/tests/test_budgets.py`, `scripts/engineering/verify.py`, `docs/architecture/AI_BUDGETS.md`.

Acceptance:

- Integer USD money/request/token buckets for global/user/module/project/model and day/month/all; configurable timezone initially Asia/Yekaterinburg, no reset on changes
- Atomic reserve/invocation/outbox; idempotency, exactly-once settle/release, unknown retained across periods; actual over bound records full usage and freezes route
- 2 independent process users/models with100 concurrent requests under global cap; repeated key and double settle pass; owner no bypass; public paid gate stays closed

Проверки: Source-copy disposable PostgreSQL budgets suite, two spawned processes, migration/rollback/schema drift/strict DTO/price/permissions/calendar/DST/caps/unknown/settle tests; Full isolated regression+harness; exact implementation SHA engineering.yml and web.yml.

Риски: Неизвестная цена/доставка fail closed; no real paid requests; actual accounting не обрезается. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change

Commit: 4c243a7a87b145ba01dd10595c0bcbdc23112633. Evidence: ["14.10.2026: вопросы заданы, владелец подтвердил USD, полный набор независимых лимитов, настраиваемый timezone первоначально Asia/Yekaterinburg; mock accounting only.", "Local targeted budgets61 passed48.79s; full source-copy regression all1058+harness11=1069pass; final CI/browser passed below. Two spawned processes100 calls users/models cap1USD estimate0.6USD→1 reserved/99 denied; key/settle20 repeated operations exactly once. No real provider/paid requests/permanent migration.", "Local browser86pass1.2m, format/build/build:demo passed; combined1155 local. CI exact SHA completed-success below; no UI changes/private preview deployment.", "14.10.2026 final local+CI1155pass: engineering38565394275 completed/success12:46:37UTC1069pass; web38565393551 completed/success12:41:15UTC86pass; оба exact-SHA4c243a7a87b145ba01dd10595c0bcbdc23112633. No failed/skipped final. Core CI208/175/202/22/61 in58.29/102.09/144.28/15.65/73.49s, timeout180 unchanged. Paid generic gate closed, no permanent DB/provider/Console UI/deploy. Next AI-002 requires owner questions/answers."].

## QUB-AI-002 — Mock dispatcher crash/revoke/fallback checks

Статус: review/testing; модуль: ai; приоритет: P0; approval: true. Зависимости: QUB-AI-001.

Crash/timeout/revoke не должны давать двойной платный вызов или бесплатное освобождение unknown reserve

Файлы: `core/qubite/ai/dispatcher.py`, `core/qubite/ai/mock.py`, `core/qubite/ai/budgets.py`, `core/qubite/ai/models.py`, `core/qubite/sql/0010_dispatcher.sql`, `core/tests/test_dispatcher.py`, `scripts/engineering/verify.py`, `docs/architecture/AI_DISPATCHER.md`.

Acceptance:

- Live origin session/grants/resource/price/caps/freeze checks before each attempt; owner no bypass; revoked/zero/missing/expired →0 mock deliveries before committed intent
- Durable outbox/jobs/fencing/attempts; two processes100 claims one delivery; crash after intent/timeout/cancel/DB failure retains unknown reserve without retry
- Explicit durable NotSent only: at most3 total attempts, backoff1s/2s, configurable timeout60s, manual fallback with new scoped reservation; exactly-once full actual settlement, no real network/paid requests/startup worker/public spend route

Проверки: Source-copy disposable PostgreSQL dispatcher fault injection/process death/100 claims/old outbox forward migration/live gates/retry/unknown/fencing tests; Full isolated core+legacy regression+harness and web real-core fixture; engineering.yml/web.yml exact implementation SHA.

Риски: Неизвестная цена/доставка fail closed; no real paid requests; actual accounting не обрезается. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change

Commit: pending. Evidence: ["15.10.2026: до реализации заданы вопросы и получены ответы: максимум3 попытки с задержкой только при доказанной неотправке; timeout60s настраиваемый; выбор резервной модели только вручную. Mock-only, без реальных провайдеров/paid requests/Console/deploy.", "Local full snapshot all1102+harness11=1113pass (dispatcher44); final updated dispatcher45pass55.23s separately, unchanged remaining runtime; browser86pass1.5m, format/build/build:demo pass. Full core groups208/175/202/22/61/44 in40.44/97.76/108.48/10.78/52.31/41.86s. No failed/skipped final; exact-SHA CI pending. Native PG18.6 / Python3.14.8 isolated/checksummed /tmp only, no system installation."].

## QUB-UI-001 — Today shell и owner/nonowner navigation

Статус: done; модуль: ui; приоритет: P0; approval: true. Зависимости: QUB-AUTH-003, QUB-AUTH-009, QUB-DESIGN-001, QUB-REPO-001.

Отделить обычный user outcome от legacy role dashboard и показать denied/unavailable состояния

Файлы: `apps/web/`, `.github/workflows/web.yml`, `docs/design/`, `docs/project/`, `docs/architecture/`, `docs/engineering/AGENT_HARNESS.md`, `docs/plan/`, `docs/reports/QUB-UI-001.md`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/migration/CODE_ORIGIN.json`, `docs/README.md`.

Acceptance:

- Owner ordinary home; console hidden entry; module denied/degraded states
- Viewport keyboard/focus checks и Playwright direct URL tests
- Compile-time separated live/demo; live identity from me+me/access; no simulated production writes
- Demo visibility controls explicitly preview only; trusted server catalog separate UI-003 before full Console

Проверки: npm ci / format:check / build / build:demo; Playwright desktop/phone/live + axe; python3 scripts/engineering/check.py; unittest engineering; verify.py --suite all (real disposable PostgreSQL).

Риски: Скрытие UI не authorization; optimistic sync статус обязан быть честным. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change

Commit: 23b61190de2795060c08fa8b7f5e9a29bffafae4. Evidence: ["13.10.2026 owner answers before implementation: agreed navigation, fixed-bottom Qubite Command/Lite, per-module owner hidden/locked setting.", "Local final: format/typecheck/live+demo builds; Playwright36 (11desktop+11phone+14live HTTP fixtures), axe light/dark/modal/direct URL/expiry/revoke/async race/keyboard signal; all965 + engineering11 real disposable PG18.6; total1012 checks.", "Origin main implementation23b61190de2795060c08fa8b7f5e9a29bffafae4 verified; immutable tournaments/qubite-v1.0 remain96f0457a523b6b79f21c4092056d8fa8fa69a680.", "Exact SHA GitHub web38424077786 completed/success 2026-10-13T15:41:42Z: npm ci/builds/format/Playwright36; engineering38424077501 completed/success15:45:58Z: all965+engineering11.", "Private demo v1 deployment appgdep_6ace5ec036b08191a22eafc8daf7399a succeeded; https://qubite-app-shell-kirill.kuzmichevkonstantin9.chatgpt.site; publishing sourcef28554425ee5bd4278a6827d632ddb2899bb9bc6 copied from implementation apps/web; synthetic data only.", "No full-stack browser/core/native keyboard/physical-device acceptance; no auth forms, persistent server catalog/inbox/AI/providers/mic/production Qubite install. UI-003 backend visibility before AUTH-004; next AUTH-007 questions first."].

## QUB-AUTH-004 — Owner Console users/grants/budgets UI

Статус: backlog; модуль: owner; приоритет: P0; approval: false. Зависимости: QUB-UI-001, QUB-AI-002, QUB-UI-003.

Дать владельцу ручные независимые grants/budgets без предоставления всем доступа

Файлы: `apps/web/owner (будущий)`, `core/qubite/owner (будущий)`.

Acceptance:

- Manual account grants/revoke/budget with audit+If-Match
- Nonowner owner API denied, no self-service paid grant
- Переключатель регистрации/режимы и оба типа invite через AUTH-006 API; global login/maintenance/provider toggles только после AUTH-015. ChatGPT personal plan vs owner API отдельные карточки/права.

Проверки: Будущий core integration + Playwright console tests.

Риски: Обычный user не вызывает management API; manual grants audit; owner singleton защищён. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change

Commit: None. Evidence: [].

## QUB-AUTH-001 — Приёмка Owner Console/Docs-only/mock AI

Статус: backlog; модуль: owner; приоритет: P0; approval: false. Зависимости: QUB-AUTH-004.

Проверить целостный owner→Docs-only→mock cap→revoke сценарий до полезных платных функций

Файлы: `docs/reports/QUB-AUTH-001.md (будущий)`, `tests/e2e/owner-flow (будущий)`.

Acceptance:

- Все 10 access policy случаев включая exhausted mock cap
- Реальный UI принят owner; paid endpoint provider calls не выполнялись

Проверки: Будущий owner E2E+negative integration matrix.

Риски: Обычный user не вызывает management API; manual grants audit; owner singleton защищён. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change

Commit: None. Evidence: [].

## QUB-DOC-001 — Typed note/revision API и local durable draft

Статус: backlog; модуль: docs; приоритет: P1; approval: false. Зависимости: QUB-AUTH-001.

Первый ручной полезный документ требует typed ownership и durable local draft

Файлы: `core/qubite/docs (будущий)`, `apps/web/docs/local (будущий)`.

Acceptance:

- Создать/открыть note с AST/revision; server ACL и local atomic persist
- Reload/kill не теряет draft; чужой doc denied

Проверки: Будущие docs API integration + local-store unit tests.

Риски: Durable draft/private attachment не теряются и не доступны чужому subject. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change

Commit: None. Evidence: [].

## QUB-SYNC-001 — Idempotent push/pull и конфликт двух устройств

Статус: backlog; модуль: sync; приоритет: P1; approval: false. Зависимости: QUB-DOC-001.

Offline edits не должны теряться/дублироваться на повторе и двух устройствах

Файлы: `core/qubite/sync (будущий)`, `apps/web/sync (будущий)`.

Acceptance:

- Retry не дублирует, 409 сохраняет варианты, tombstones
- Offline/reconnect/revoke/expired cursor scenarios

Проверки: Будущий two-device offline Playwright + sync pytest.

Риски: Revoke/expired cursor/конфликт не удаляет собственный draft; tombstones не GC преждевременно. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change

Commit: None. Evidence: [].

## QUB-SEARCH-001 — Связь note/project и ACL keyword search

Статус: backlog; модуль: knowledge; приоритет: P1; approval: false. Зависимости: QUB-SYNC-001.

Связанный граф и поиск нужны первому срезу, но могут раскрыть private titles/edges

Файлы: `core/qubite/objects/relations (будущий)`, `core/qubite/knowledge (будущий)`.

Acceptance:

- Note linked to project found via Command
- Cross-scope title/snippet/count/edges не раскрываются

Проверки: Будущий ACL search/graph pytest + Command E2E.

Риски: Title/snippet/count/edge/derived index leaks и stale authorization. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change

Commit: None. Evidence: [].

## QUB-HISTORY-001 — Diff и restore в новую revision

Статус: backlog; модуль: history; приоритет: P1; approval: false. Зависимости: QUB-SEARCH-001.

Пользователь должен сравнить и восстановить заметку без потери последующих edits

Файлы: `core/qubite/history (будущий)`, `apps/web/history (будущий)`.

Acceptance:

- Две revision compare/restore; новый edit не перетёрт
- Roundtrip export/restore и author audit

Проверки: Будущий history API+restore concurrency+Playwright vertical slice.

Риски: Restore не перезаписывает новые edits; external action нельзя отменить DB rollback. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change

Commit: None. Evidence: [].

## QUB-INK-001 — Hardware input probe и benchmark plan

Статус: backlog; модуль: ink; приоритет: P0; approval: false. Зависимости: нет.

Аппаратный input/latency риск нельзя решить документацией или web-only прототипом; устройство владельца Lenovo Xiaoxin Pad 2025, точный model ID/перо не проверены

Файлы: `clients/android-ink/probe (будущий)`, `docs/reports/INK-HARDWARE.md (будущий)`.

Acceptance:

- Модель устройства/pressure/tilt/sample/frame/latency реальные
- APK и safe kill/autosave, no cloud calls; ощущения подтверждает owner

Проверки: Будущий Gradle test/lint/assembleDebug + реальный планшет.

Риски: Не обещать pressure/tilt без измерения; pen crash/recovery/latency и sensitive образцы. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change

Commit: None. Evidence: [].

## QUB-TOUR-001 — Самостоятельная optional установка Qubite Tournaments

Статус: backlog; модуль: tournaments; приоритет: P1; approval: false. Зависимости: QUB-REPO-001, QUB-TEST-002, QUB-DEPLOY-001.

Последнее решение владельца: отдельная старая платформа без связи аккаунтов/SSO с Qubite 2.0

Файлы: `modules/tournaments/`, `legacy/qubite-v1/`, `deploy/ (новый installer после DEPLOY-001)`.

Acceptance:

- Optional install/uninstall/disabled без влияния на core, отдельные service/env/data/backup и tournament subdomain
- Node/SQLite/Vanilla UI со своим Auth; никакого общего UUID/cookie/core grants/SSO
- Tournament scoring/results/roster/team/rating и статические пути проверены; explicit release approval и backup before live

Проверки: harness all; standalone install plan; tournament runtime regression; no core identity/DB integration checks.

Риски: Legacy defects и installer assumptions; не выдавать систему за новый core module. Откат: Отключить отдельный tournament unit/ingress; сохранить его DB/env/uploads; core не затронут

Commit: None. Evidence: [].

## QUB-INT-001 — Service/Shade connector contract POC

Статус: backlog; модуль: integrations; приоритет: P2; approval: false. Зависимости: QUB-AUTH-001.

Контракт внешних сервисов и локального Shade должен ограничивать действия/credentials до подключения

Файлы: `contracts/connectors-v1.json (будущий)`, `docs/architecture/SHADEAI_INTEGRATION.md`.

Acceptance:

- Source contracts Search/Writer/Shade mocks status+allowlist
- Revoke/unknown outcome, no Shade writes/real HA/network calls

Проверки: Будущий connector fixture pytest; verify.py --suite all.

Риски: Не вызвать HA/TG/paid API, не читать домашние сессии; unknown sends не повторять. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change

Commit: None. Evidence: [].

## QUB-DESIGN-001 — Поток: компонентная дизайн-система и мобильный material UX

Статус: done; модуль: design; приоритет: P0; approval: true. Зависимости: QUB-001.

Владелец выбрал Milo → Flux, попросил плавность на телефоне, selectable palettes/fonts/logo families и refined companions; final IA отдельно.

Файлы: `assets/design-lab/`, `docs/design/DESIGN_SYSTEM_PLAN.md`, `docs/design/AUTH_UX.md`, `docs/design/MATERIAL_DIRECTIONS.md`, `docs/reports/QUB-DESIGN-001.md`, `docs/project/`, `docs/plan/`, `README.md`, `docs/README.md`, `AGENTS.md`, `CLAUDE.md`, `.github/workflows/design-lab.yml`, `docs/architecture/decisions/0010-material-lab.md`, `docs/architecture/decisions/README.md`, `docs/design/MILO_MATERIAL_AND_COMPANIONS.md`, `docs/architecture/decisions/0011-milo-live-controls.md`, `docs/design/FLUX_DESIGN_SYSTEM.md`, `docs/architecture/decisions/0012-flux-design-system.md`, `docs/design/COLOR_PLASTIC.md`.

Acceptance:

- Новые tokens/layout и reviewable макет login/register/reset, не копировать старую тему
- Email/password/согласия; display name optional; нет code-entry/турнирных полей
- Responsive/keyboard/error/OAuth/loading/denied states, owner review перед UI реализацией
- Пять самостоятельных React/TS концепций с разными материалами, анимациями, landing/workspace/auth и responsive preview; прямой запрос владельца 12.10.2026
- Опубликованное отдельное демо для просмотра с телефона; финальный стиль остаётся на owner review
- Итерация 2 по feedback: Milo выбран как stylistic base; пять механик живых controls, регулируемая податливость, непрерывные переходы, drag bounds/cancel; питомцы отдельно с индивидуальными характерами
- 13.10.2026: Flux selected; пять palette, 5 heading/5 body choices, 5 logo families ×12 назначения; mobile motion/overlap review. Final owner selections/physical acceptance before done.
- 13.10.2026 iteration04: owner selected Ribbon/Unbounded/Manrope; five bright plastic kits with semantic action/select/idea/success hierarchy and whole-specimen examples. Palette/physical acceptance pending.
- 13.10.2026 после просмотра опубликованной версии4 владелец выбрал Игрушечную; Поток/Лента/Unbounded/Manrope/ритм100/503 закреплены. DESIGN-001 accepted; production layout/device checks отдельно UI-001/002.

Проверки: Проверка docs/links; просмотр макета владельцем; TypeScript/build; браузерные сценарии пяти концепций, мобильный/планшет/desktop, reduced motion/keyboard/действия/отсутствие внешних API; 98 browser tests: old47 + Milo51; drag/cancel/keyboard/slider/switch/tabs/dialog/reduced motion/touch/axe/no storage/RAF settle; Flux browser: actual intermediate click geometry/duration, 2D mobile pill, 25 font combinations, 60 glyphs, 10 palette-theme WCAG matrices, gaze/touch/4× CPU slowdown/quiet.; Plastic: ten kit/theme matrices ×six screens at360px; actual role fills/results/errors and no data loss, chosen defaults, five kits at320/844px; old neutral palettes preserved..

Риски: Дизайн-макет не выдавать за реализованный auth. Откат: Отключить новый flow/route/artifact; сохранить старые данные и writer. Live перенос только по отдельному runbook.

Commit: 9262e3c0c89db7b6343b6ce90c0e62213e515ffa. Evidence: ["47/47 Playwright Chromium pass, 20 scenes /5 sizes, 2-theme axe/keyboard/reduced motion; format/build pass", "386/386 existing isolated suites + harness pass, temporary native PG18.6; no live APIs/services", "Private static Sites deploy succeeded, source f5fa089bc899db5747b4ebfac40abd7d7afc2073 remote verified; report QUB-DESIGN-001", "Initial main 0173d74 pushed; CI Material Lab38289913101 and verification38289913120 success", "Владелец подтвердил доступность опубликованного демо, отверг исходное понимание материала; выбрал Milo base, новая mechanics iteration in_progress", "Milo 02: 98/98 local Chromium pass (2.2m); final mechanics owner acceptance pending, not done", "Итерация2 existing386 regression+harness pass; check53 tasks/46 docs; archive refs SHA96f0457 unchanged verified origin", "Milo02 private Sites version2/deployment appgdep_6acd3047a53c8191bcde1e643dfe55be succeeded19:09:35UTC; source5c6fd389cf432cab56fd8fa7f57c698704cab707 pushed/verified; archive transfer403, remote build fallback", "Milo02 main 2b10ba365f6035bdfb92cdbd34e56a6829095c5c pushed; remote main exact SHA verified; CI38295994465/38295994336 completed/success for exact implementation SHA", "13.10.2026: владелец выбрал Поток/Flux; разрешена итерация 3: mobile motion, пять палитр, независимые heading/body fonts, пять семейств знаков всех существующих сервисов и refined companions; только assets/design-lab и docs, acceptance после выбора владельца.", "13.10.2026 Flux03:120/120 browser pass187.9s; final optical Flux22/22 pass57.4s; existing386/harness pass; default fonts4, no APIs/storage; owner palette/type/marks/physical acceptance pending.", "13.10.2026 private Sites version3 published/source c12223d37f0fa3135b742243b8e64def43dc485a remote/version verified; deployment appgdep_6acd40ebec8881918310f4218d8ed1b9 succeeded; local archive uploaded; root-source0 mismatch.", "Flux03 main 74ad2efcae25b52e04b59cab148e8317b0a735aa pushed; git ls-remote exact SHA verified; CI Material Lab38303757824/verification38303758010 completed/success for exact implementation SHA; origin archive refs96f0457 unchanged.", "Iteration04 authorized by owner screenshots: Ribbon/Unbounded/Manrope confirmed, rhythm100/503; previous palette rejected, five semantic plastic kits requested. Final133/133 browser pass238.6s/no retries/skips/flaky; existing386/harness pass, combined519. Palette/physical acceptance pending.", "Plastic04 private Sites version4/source8e8aba31a64452344ed82764ca76a92f7ca0d075 pushed/remote/version verified; root-source0 mismatch; deployment appgdep_6acd9fa05db08191b83a91968a2a70e6 succeeded13.10.2026 03:04:14UTC; exact source archive uploaded, private audience preserved.", "Plastic04 main9262e3c0c89db7b6343b6ce90c0e62213e515ffa pushed; remote exact SHA verified. Owner viewed version4 and explicitly selected Игрушечная: DESIGN-001 done. Toy was already published default; acceptance changes documentation only.", "GitHub Actions Material Lab38340403176 and Qubite verification38340403192 completed/success for exact implementation SHA9262e3c0c89db7b6343b6ce90c0e62213e515ffa; origin archive branch/tag96f0457 unchanged, verified together with main."].

## QUB-AUTH-005 — Account login без code-entry в новом API

Статус: done; модуль: identity; приоритет: P0; approval: true. Зависимости: QUB-AUTH-009, QUB-TEST-001.

Новый login не принимает старые account access codes; tournament join и email verification отдельные

Файлы: `contracts/auth-v1.json`, `core/tests/test_account_login.py`, `back/tests/auth-legacy-baseline.test.js`, `back/tests/fixtures/auth-server.cjs`, `docs/architecture/ACCOUNT_LOGIN.md`, `docs/architecture/decisions/0019-account-login-boundary.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `core/README.md`, `SECURITY.md`, `TODO.md`, `docs/project`, `docs/engineering/AGENT_HARNESS.md`, `docs/engineering/TEST_STRATEGY.md`, `docs/architecture/AUTH_AND_PERMISSIONS.md`, `docs/architecture/WEB_AUTH.md`, `docs/migration/IDENTITY_CUTOVER.md`, `docs/README.md`, `docs/plan`.

Acceptance:

- В новой Auth surface отсутствуют code-entry/account session grant routes; known legacy routes rejected
- Tournament join codes/invites/email/reset/2FA challenges не удалены или смешаны с password login

Проверки: Isolated harness all: actual HTTP/PG login boundary matrix + existing Web Auth/OAuth/email/policy, SQLite tournament shared/personal join via real server.js, all service regressions; harness unittest/check.py/diff; exact-SHA GitHub tests-only CI.

Риски: Не смешать authentication code-entry с турнирным join/verification. Откат: Снять contract/tests/docs последующим commit. Runtime/schema в AUTH-005 не менялись; сохранить PostgreSQL UUID/credentials/sessions/grants/audit. Не возвращать account code-entry и не restore старые SQLite пароли/сессии поверх новой identity; ingress/deploy отдельно.

Commit: cf302d9e05579f417886a8ee87136352a3f53fa0. Evidence: ["13.10.2026: владелец ответил «Да, закрываем AUTH-005 по этим границам»: контракт/негативные и позитивные проверки существующего нового API; registration/UI/Search/Writing/VPN отдельно. Вход AUTH-009 уже реализован, нового дублирующего Auth runtime не создаём.", "Baseline main/origin d6c15e16b8f6505715f17914c966dc528485fff5, чистый checkout; remote tournaments и qubite-v1.0 immutable96f0457a523b6b79f21c4092056d8fa8fa69a680 проверены перед изменениями.", "Финальный isolated all892pass + engineering6pass =898local checks; Node97,deploy18,Search95,Brief112,Kwork29,SiYuan5,identity32,core504 (208+165+131). New account-login45 + tournament3=48. No failures/skips. Python3.13.13/PG18.6/Node22.22.2.", "Две bounded repair batches только test configuration/assertions: auth-only workspace503, manual OAuth query absent in OpenAPI parameters, mixed cookie/bearer400. Runtime guards/schema без изменений; final all exit0.", "check.py56tasks/63docs и diff pass; core/qubite/OpenAPI/identity-v2/SQL/root master-access unchanged. Implementation/push/exact-SHA CI pending; no deploy.", "Implementation cf302d9e05579f417886a8ee87136352a3f53fa0 commit/push и remote main exact подтверждены; tournaments/qubite-v1.0 immutable96f0457a523b6b79f21c4092056d8fa8fa69a680.", "GitHub Actions38385240872 exact implementation SHA cf302d9e05579f417886a8ee87136352a3f53fa0 completed/success13.10.2026 10:47:23UTC (job10:47:22UTC). CI all892+harness6=898pass; Python3.14.8/PG16.15/Node22.23.3, core208/44.33s+165/77.02s+131/84.32s; sum205.67s, each subprocess<180s. Tests-only, no deploy; final docs-only evidence commit/push closes cycle."].

## QUB-AUTH-006 — Минимальная FastAPI регистрация без legacy alias

Статус: done; модуль: identity; приоритет: P0; approval: true. Зависимости: QUB-AUTH-009, QUB-AUTH-011, QUB-AUTH-003, QUB-DESIGN-001.

Снять обязательные турнирные/лишние данные с платформенной регистрации

Файлы: `core/qubite/identity/registration/`, `core/qubite/sql/0007_registration.sql`, `core/qubite/app.py`, `core/qubite/migrations.py`, `core/qubite/identity/auth/http.py`, `core/qubite/identity/challenges/store.py`, `core/tests/`, `contracts/registration-v1.json`, `contracts/core-v1.json`, `contracts/identity-v2.json`, `docs/`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `TODO.md`, `core/README.md`, `core/qubite/__init__.py`, `tests/identity/test_contract.py`.

Acceptance:

- Email/password/согласия, display name optional; без обязательного login alias/ФИО/школы/класса
- Invite/manual default, public отдельно; no module/model grant из регистрации
- PG uniqueness/validation/consent version/verification; fresh identity без импорта старых DTO

Проверки: Real disposable PG/HTTP: invite/public/disabled, verified login/reset, canonical collision, consent, strict legacy DTO rejection; OAuth linking regression; concurrency/revoke/version/CSRF/rates/atomic failure; full harness.

Риски: Register/login/reset/OAuth linking roundtrip; canonical email collision, invite misuse и default-deny; legacy alias не создаётся. Откат: Снять новый route/artifact, сохранить PostgreSQL accounts/credentials/new writes. Не restore старые SQLite пароли/сессии поверх новой identity; deploy отдельно.

Commit: 2035e1e5298ad94fd9c9aa33586e6c3ad5acda04. Evidence: ["13.10.2026: перед задачей вопросы заданы, ответы получены. Owner-controlled registration switch; оба типа приглашений; вход после подтверждения email. Bounded API/PG slice, React переключатели/общий login kill-switch/maintenance/ChatGPT отдельные задачи; mock-only delivery, no deploy.", "13.10.2026: local full source-copy all963+harness6=969 pass; core575=208+165+202 including registration71. Python3.13.13/PG18.6/Node22.22.2; groups26.72/48.79/75.31s (<180 each). First full failed2 due OpenAPI400/obsolete register404 oracle; corrected bounded batch. After full pass DTO renamed to RegistrationAccepted to preserve all earlier OpenAPI operations/schema names; final3 targeted contract tests pass1.45s, no HTTP behavior change. CI exact SHA pending. No real mail/providers/deploy/owner credentials.", "13.10.2026: implementation2035e1e5298ad94fd9c9aa33586e6c3ad5acda04 pushed, remote main exact+archive96f0457 verified; CI38390796988 completed/success11:36:36UTC https://github.com/kirillkuz1122/qubite/actions/runs/38390796988. Local+CI all963+harness6=969 pass, core575=208+165+202 including71 registration. CI Python3.14.8/PG16.15/Node22.23.3, core48.75/78.23/116.02s (<180 each), no failed/skipped. Final code preserved all previous OpenAPI operations/schema objects; no real delivery/providers/permanent accounts/deploy. Final docs-only receipt commit separately."].

## QUB-AUTH-007 — Новые React auth экраны поверх FastAPI Auth

Статус: done; модуль: ui; приоритет: P0; approval: true. Зависимости: QUB-UI-001, QUB-AUTH-005, QUB-AUTH-006, QUB-AUTH-010, QUB-AUTH-011.

Новый Python identity backend и React дизайн, legacy обслуживает только неперенесённые consumers

Файлы: `apps/web/`, `core/qubite/identity/oauth/routes.py`, `core/tests/test_oauth.py`, `contracts/core-v1.json`, `scripts/engineering/ (browser fixture)`, `docs/legal/`, `docs/design/AUTH_UX.md`, `docs/architecture/decisions/`, `docs/project/`, `docs/reports/QUB-AUTH-007.md`, `.github/workflows/web.yml`.

Acceptance:

- Анонимный сайт: лендинг → отдельный Qubite Auth → обычная главная после server identity; выбранные material assets, adaptive/keyboard/reduced motion
- Email/password, registration public/invite/disabled, invite ссылка и ручная вставка, verification/reset explicit POST, fresh CSRF, HttpOnly session/revoke/logout-all; без legacy code-entry
- OAuth availability/start/link/unlink через core, browser callback fixed route; неизвестный provider identity не создаёт account/не связывается по email
- Новые terms/privacy/cookies/data consent и отдельные unchecked UI choices; заполнение оператора/юрисдикции и publication acceptance — QUB-LEGAL-001
- Playwright fixtures и настоящий browser/FastAPI/disposable PostgreSQL, обе themes/phone/landscape/desktop; physical/native/SMTP/provider production приёмка отдельно

Проверки: npm ci/format:check/build/build:demo и Playwright71; includes11 real browser/core checks; check.py; unittest tests/engineering11; verify.py all975; OAuth browser callback10 signed mock cases; exact-SHA web/engineering CI.

Риски: Open redirect/token storage/две расходящиеся реализации. Откат: Снять новый route/artifact, сохранить PostgreSQL accounts/credentials/new writes. Не restore старые SQLite пароли/сессии поверх новой identity; deploy отдельно.

Commit: ac2c8ef4e895ed690e5f545e0b5f8b82cb6b0950. Evidence: ["13–14.10.2026: ответы владельца и ADR-0024; apps/web0.3.0 approved Flux material/landing/Auth/legal/session UI, existing core0.6.0/schema0007, browser OAuth fixed303, JSON unchanged.", "Final local71browser (18desktop+19phone+23live fixtures+11real Chromium/FastAPI/disposable PG),975 core/legacy+harness11=986, failed/skipped0. Format/live+demo builds and final light/dark phone/desktop screenshots inspected.", "Implementation ac2c8ef4e895ed690e5f545e0b5f8b82cb6b0950 pushed; remote main/archive refs verified. GitHub web38451493363 completed/success2026-10-13T19:03:38Z,71pass; engineering38451493360 completed/success19:06:53Z,986pass; both exact implementation SHA.", "Existing owner-private shell demo version3/source9c0707a40dc3c504747d4543eab4a3c55e19fb76/deploymentappgdep_6ace8192efb08191ae7bb0ca82a71245 succeeded2026-10-13T19:08:19.269750+00:00; owner/custom/one owner/zero groups; no Auth POST/secret storage/fake success. Material-lab unchanged.", "Full legal texts with explicit missing operator/jurisdiction/contact, publication_ready=false; QUB-LEGAL-001 before public launch. Native/browser return/real SMTP/providers/TLS/physical device/legal acceptance separate. Next UI-003 requires new owner questions/answers."].

## QUB-AUTH-008 — Единый вход Qubite: fresh-install контракт FastAPI/Postgres

Статус: done; модуль: identity; приоритет: P0; approval: true. Зависимости: QUB-CORE-001, QUB-TEST-001.

После уточнения владельца13.10.2026 нет аккаунтов для переноса и текущего деплоя; спроектировать один вход для всех новых сервисов

Файлы: `docs/migration/IDENTITY_CUTOVER.md`, `contracts/identity-v2.json`, `contracts/identity-vectors.json`, `tests/identity/`, `scripts/engineering/verify.py`, `docs/architecture/`, `docs/project/`, `docs/plan/`, `docs/engineering/TEST_STRATEGY.md`, `docs/reports/QUB-AUTH-008.md`, `README.md`, `docs/README.md`, `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `TODO.md`, `scripts/engineering/check.py`, `docs/engineering/DEPLOYMENT_AND_BACKUPS.md`, `docs/engineering/AGENT_HARNESS.md`, `docs/design/AUTH_UX.md`.

Acceptance:

- Полная карта legacy потребителей и целевого единого Auth: Web/Search/Writing/VPN/native/API/Tournaments/TG/upstream connectors
- Fresh Postgres UUID subject/owner bootstrap, единые session/revoke/API boundaries; без legacy password/session/import/bridge
- Машинный контракт новых endpoint/принципала/scopes и synthetic межъязыковые token/PKCE vectors/negative cases
- AUTH-L01..03 остаются negative requirements: malformed credentials/OAuth kill switch/no email-only linking
- Только контракт/план/проверки; runtime Auth и новые UI не выдавать за реализованные; пользователь разрешил менять потребителей в следующих срезах

Проверки: pytest tests/identity: synthetic SHA256/PKCE Python+Node, contract/session/security negative matrix; isolated --suite identity/all; check.py.

Риски: SSO/refresh breakage; legacy owner bypass не наследовать. Откат: Сохранить архив96f0457 и локальные старые артефакты; fresh core изолирован. При будущих изменениях включать новый сервис после tests, при откате не восстанавливать старый snapshot поверх новых записей.

Commit: a48685c5a68cf8ca8973d6561f44b491157a9f1a. Evidence: ["12.10.2026: ранее согласованный specification scope, dependencies CORE-001/TEST-001 done; ready без начала реализации/live writes.", "13.10.2026 владелец прямо подтвердил: существующих аккаунтов нет, прежнего owner можно создать заново, проект нигде не запущен/деплоя нет. Разрешил единый новый вход/API и изменения Search/остальных сервисов. Старые сведения о live migration заменяются ADR-0013; данные/секреты не удаляются по одному этому сообщению.", "13.10.2026: targeted identity32 pass; isolated verify.py all414 pass (Node94/deploy18/Search95/Brief112/Kwork29/SiYuan5/identity32/core29) + harness4 =418; no failed/skipped; PG18.6 disposable. check.py/link/source trace/diff checks pass. Protocol oracle specification only; runtime Auth not implemented. CI/implementation SHA recording follows push.", "Implementation a48685c5a68cf8ca8973d6561f44b491157a9f1a pushed/remote verified; Qubite verification38344387215 completed/success13.10.2026 04:01:52UTC, exact headSha confirmed. CI Python3.14.8/PostgreSQL16.15: all414+harness4 =418 pass; no failed/skipped. Archive refs96f0457 unchanged. Final docs/evidence/source links checked separately; no runtime Auth or deploy."].

## QUB-DEPLOY-001 — Specification нового deploy/qubite2 и installer modes

Статус: ready; модуль: ops; приоритет: P0; approval: true. Зависимости: QUB-001.

Владелец потребовал deploy папку и скрипт установки нового Qubite

Файлы: `deploy/ (новая спецификация)`, `docs/engineering/DEPLOYMENT_AND_BACKUPS.md`, `legacy/qubite-v1/deploy/ (reference)`.

Acceptance:

- Выбрать/обосновать server OS и packaging POC, manifest services/ports/data/env
- Отдельные fresh/upgrade/dry-run/rollback/backup/restore, explicit secrets input
- Legacy deploy/install.sh сохраняется; нет autodeploy; VPS hostname отложен
- Все module hosts — поддомены общего домена, fixed ingress/session/callback design; standalone турниры opt-in без shared Auth
- Interactive singleton owner setup через существующие local CLI; module installation из Console отдельный operator task; deploy/.env сохранять

Проверки: Manifest validation; synthetic install/upgrade acceptance matrix.

Риски: Не подменять рабочий installer или секреты; не делать production deployment. Откат: Отключить новый flow/route/artifact; сохранить старые данные и writer. Live перенос только по отдельному runbook.

Commit: None. Evidence: [].

## QUB-DEPLOY-002 — Installer fresh-install dry-run в disposable окружении

Статус: backlog; модуль: ops; приоритет: P0; approval: false. Зависимости: QUB-DEPLOY-001, QUB-CORE-001.

Подготовить работающий installer постепенно без live доступа

Файлы: `deploy/qubite2/install.sh (будущий)`, `deploy/qubite2/env.example (будущий)`, `deploy/qubite2/tests (будущий)`.

Acceptance:

- Idempotent fresh install, dry-run/preflight/dependency checks; refuse existing dirty/data paths
- Pin versions/SHA, secret permissions, health и redacted report
- Upgrade/rollback не выдавать за готовые пока нет отдельного tested slice; legacy unit/env не меняются
- Optional standalone Tournaments install flag, independent data/auth/unit; все модули selective install/subdomains
- Explicit core PG migrations + interactive owner bootstrap/set-password; никаких owner secrets в argv/env
- Публичная регистрация/публикация legal после QUB-LEGAL-001; локальный disposable dry-run не требует опубликованных правовых текстов

Проверки: Disposable container/VM install twice, interrupted install, existing-data refusal, no real credentials.

Риски: Не считать контейнерные mocks доказательством production совместимости. Откат: Отключить новый flow/route/artifact; сохранить старые данные и writer. Live перенос только по отдельному runbook.

Commit: None. Evidence: [].

## QUB-DESKTOP-001 — Tauri Linux POC и portable OS adapter boundary

Статус: backlog; модуль: desktop; приоритет: P1; approval: false. Зависимости: QUB-UI-001, QUB-AUTH-007, QUB-AUTH-012.

Desktop Linux обязателен, последующие OS без переписывания продукта

Файлы: `clients/desktop (будущий)`, `contracts/client-capabilities-v1.json (будущий)`.

Acceptance:

- Общий React UI и Linux artifact; restricted native commands, secure session and local drafts
- Offline/restart/logout/auth deep-link tests; platform paths/dialog adapters
- Windows/macOS build+sign roadmap, не заявлять их проверенными

Проверки: Linux build+smoke; webview/keyboard/offline checks; desktop capability negative tests.

Риски: WebView differences/native privileges; Windows/macOS потребуют своих runners. Откат: Отключить новый flow/route/artifact; сохранить старые данные и writer. Live перенос только по отдельному runbook.

Commit: None. Evidence: [].

## QUB-TG-001 — Bot parity/command specification и mock characterization

Статус: ready; модуль: telegram; приоритет: P0; approval: true. Зависимости: QUB-001.

Подготовить полный новый bot flow без потери функций и смешения ролей

Файлы: `docs/architecture/TELEGRAM_AND_OBSERVABILITY.md`, `contracts/telegram-commands-v1.json (будущий)`, `legacy/qubite-v1/back/tests/telegram-parity.test.js (будущий)`.

Acceptance:

- TG-1..6 ответы записаны; каждую legacy функцию map keep/module/retire с обоснованием
- Owner/platform/support/tournament capabilities и callbacks/TTL/action matrix
- Synthetic handlers tests без сети/токена; period and scope mismatches зафиксированы

Проверки: Mock update/send transport tests; check.py.

Риски: Не потерять legacy capabilities/history; не наследовать global moderator; без real bot credentials/send/production writes. Откат: Отключить новый adapter/route/worker, сохранить источник и mappings; один consumer, не стирать новые записи.

Commit: None. Evidence: ["TG-1..6 ответы 12.10.2026, ADR-0007"].

## QUB-TG-002 — Новый control worker read-only status/menu POC

Статус: backlog; модуль: telegram; приоритет: P0; approval: false. Зависимости: QUB-TG-001, QUB-AUTH-003.

Первый bounded новый бот slice до management mutations

Файлы: `core/qubite/telegram (будущий)`, `contracts/telegram-commands-v1.json (будущий)`.

Acceptance:

- Python worker с общими policy API, platform subject linking и owner private menu
- Статусы/сводки/deep links; no mutations/real sends в POC
- Tampered/unlinked/revoked/module moderator → deny; single consumer startup contract
- Существующий bot identity сохраняется; automatic capture реализуется отдельным slice

Проверки: Fixture bot update integration; transport mock; revoke/expiry negative tests.

Риски: Не потерять legacy capabilities/history; не наследовать global moderator; без real bot credentials/send/production writes. Откат: Отключить новый adapter/route/worker, сохранить источник и mappings; один consumer, не стирать новые записи.

Commit: None. Evidence: [].

## QUB-TG-003 — Mutating bot commands и delivery/cutover runbook

Статус: backlog; модуль: telegram; приоритет: P0; approval: false. Зависимости: QUB-TG-002, QUB-AUTH-004, QUB-OBS-001.

Заменить старый bot management после read-only POC и общего API

Файлы: `core/qubite/telegram/commands (будущий)`, `docs/migration/TELEGRAM_CUTOVER.md (будущий)`.

Acceptance:

- Согласованные grants/budgets/module/settings commands, common domain API, confirmation/idempotency
- Exact reply/TTL, unknown delivery/no retry, restart/outbox tests
- План single-consumer cutover + сохранение username/history где применимо; live switch отдельно

Проверки: Mock transport fault injection; command scope parity; no arbitrary shell.

Риски: Не потерять legacy capabilities/history; не наследовать global moderator; без real bot credentials/send/production writes. Откат: Отключить новый adapter/route/worker, сохранить источник и mappings; один consumer, не стирать новые записи.

Commit: None. Evidence: [].

## QUB-OBS-001 — Metrics contract и isolated Infrastructure collector

Статус: backlog; модуль: observability; приоритет: P0; approval: false. Зависимости: QUB-CORE-001.

Сохранить текущий мониторинг и устранить неверные трактовки показателей

Файлы: `core/qubite/observability (будущий)`, `contracts/metrics-v1.json (будущий)`.

Acceptance:

- Отдельные host/cgroup/process/node, loadavg и CPU%, relevant DB/blob volume
- Timestamp/source/reset/stale/missing/retention, requests/traffic scoped process counters
- Согласовать retained history и alerts policy до scheduled notifications

Проверки: Synthetic metric fixtures; counter reset/two-source dedup/units/UTC tests.

Риски: Не потерять legacy capabilities/history; не наследовать global moderator; без real bot credentials/send/production writes. Откат: Отключить новый adapter/route/worker, сохранить источник и mappings; один consumer, не стирать новые записи.

Commit: None. Evidence: [].

## QUB-ANALYTICS-001 — Owner analytics/Infrastructure UI и Tournaments split

Статус: backlog; модуль: analytics; приоритет: P0; approval: true. Зависимости: QUB-OBS-001, QUB-UI-001.

Перенести все реальные analytics capabilities в правильные scopes

Файлы: `apps/web/owner/analytics (будущий)`, `core/qubite/analytics (будущий)`.

Acceptance:

- Global activity/AI costs/server graphs в Console; submissions/teams/rating внутри Tournaments
- Legacy report period contract corrected; missing/stale не ноль; protected texts не aggregates payload
- Owner vs tournament moderator/direct URL/API negative checks, retention и source/history mapping

Проверки: Disposable legacy adapters + Playwright graphs/policy tests; UTC duration regression.

Риски: Не потерять legacy capabilities/history; не наследовать global moderator; без real bot credentials/send/production writes. Откат: Отключить новый adapter/route/worker, сохранить источник и mappings; один consumer, не стирать новые записи.

Commit: None. Evidence: [].

## QUB-SUPPORT-001 — Support scope и Telegram/web conversation adapter POC

Статус: backlog; модуль: support; приоритет: P0; approval: true. Зависимости: QUB-TG-001, QUB-AUTH-003.

Не потерять поддержку и не отправить ответ неверному собеседнику

Файлы: `core/qubite/support (будущий)`, `apps/web/support (будущий)`.

Acceptance:

- FastAPI guest Support, owner и owner-granted support.read/reply/manage отдельно от tournament role
- Chat/source/IDs/history migration map; read/reply/close/reopen common API
- Exact reply/TTL/cross-chat/revoke/outcome tests без реальных сообщений

Проверки: Synthetic conversation API + bot transport tests; history map roundtrip.

Риски: Не потерять legacy capabilities/history; не наследовать global moderator; без real bot credentials/send/production writes. Откат: Отключить новый adapter/route/worker, сохранить источник и mappings; один consumer, не стирать новые записи.

Commit: None. Evidence: [].

## QUB-AUTH-009 — FastAPI password login/logout/session core

Статус: done; модуль: identity; приоритет: P0; approval: true. Зависимости: QUB-AUTH-008, QUB-AUTH-002.

Нужный новой платформе Auth реализовать на Python, не permanent JS adapter

Файлы: `core/qubite/identity/`, `core/qubite/sql/0003_auth.sql`, `core/qubite/app.py`, `core/qubite/config.py`, `core/qubite/migrations.py`, `core/qubite/__init__.py`, `core/tests/`, `core/requirements.in`, `core/requirements.lock`, `core/README.md`, `contracts/core-v1.json`, `contracts/identity-v2.json`, `tests/identity/test_contract.py`, `scripts/engineering/check.py`, `scripts/engineering/test-requirements.lock`, `tests/engineering/`, `docs/architecture/`, `docs/migration/IDENTITY_CUTOVER.md`, `docs/project/`, `docs/plan/`, `docs/engineering/`, `docs/reports/QUB-AUTH-009.md`, `README.md`, `docs/README.md`, `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `TODO.md`.

Acceptance:

- Postgres sessions/Argon2id credentials, typed opaque token/hash-only storage, owner password setup и revoke/status/auth_version
- Login/logout/logout-all/revoke/blocked/expiry/CSRF/secure cookie negative cases
- No code-entry, no owner/global-role bypass; реальные пароли не читать в модель
- AUTH-L01: malformed percent cookie не вызывает 500; безопасный credential отказ и server survives

Проверки: python3 scripts/engineering/verify.py --suite core --python <test-python> --postgres-bin <native-bin>; python3 scripts/engineering/verify.py --suite all --python <test-python> --postgres-bin <native-bin>; python3 -m unittest discover -s tests/engineering; python3 scripts/engineering/check.py; git diff --check; Argon2id benchmark на synthetic пароль, HTTPS secure-cookie HTTP integration и actual concurrent PostgreSQL connections.

Риски: Session fixation/Argon2 DOS/CSRF/account enumeration; bootstrap credentials только локально/без plaintext logging. Откат: Снять новый route/artifact, сохранить PostgreSQL accounts/credentials/new writes. Не restore старые SQLite пароли/сессии поверх новой identity; deploy отдельно.

Commit: 1dc57cb4c980b111acbf5ccadb28f25871149c98. Evidence: ["13.10.2026: AUTH-008 и AUTH-002 done, новая fresh password/session API одобрена ADR-0013 и владельцем; ready следующий bounded cycle. В AUTH-002 пароль/runtime login не реализовывались.", "13.10.2026: прямое указание владельца «Делай след задачу»; выбран AUTH-009. Границы: web password/session API/local owner password setup, без React/OAuth/reset/native/service cutover/production DB; только fixtures. Источник паролей owner — getpass локальной CLI, реальные значения агенту не передаются.", "13.10.2026: финальный all593+harness4=597 passed, core208 (29foundation+59identity+120Auth), без failed/skipped; native PG18.6/Python3.13.13/Node22.22.2. Проверены очистка expired/revoked cookies с повторным входом и отказ getpass echo fallback, restricted runtime SQL role, actual Uvicorn/HTTPS-cookie fixtures и PG races; synthetic Argon2 benchmark. Exact-SHA CI/push ещё ожидаются.", "13.10.2026: implementation 1dc57cb4c980b111acbf5ccadb28f25871149c98 pushed; origin/main exact SHA и tournaments/tag qubite-v1.0 на96f0457a523b6b79f21c4092056d8fa8fa69a680 проверены. CI38354136689 completed/success 2026-10-13T05:59:47Z,597 checks (all593+harness4/core208), Python3.14.8/PostgreSQL16.15, no failed/skipped; https://github.com/kirillkuz1122/qubite/actions/runs/38354136689. Финальный docs-only evidence commit отдельно, runtime/deploy не меняется."].

## QUB-AUTH-010 — FastAPI OAuth provider adapter и account linking

Статус: done; модуль: identity; приоритет: P0; approval: true. Зависимости: QUB-AUTH-009.

Сохранить необходимые способы входа в новом Auth

Файлы: `core/qubite/identity/`, `core/qubite/sql/0004_oauth.sql`, `core/qubite/app.py`, `core/qubite/config.py`, `core/qubite/migrations.py`, `core/qubite/__init__.py`, `core/tests/`, `core/requirements.in`, `core/requirements.lock`, `core/README.md`, `contracts/core-v1.json`, `contracts/identity-v2.json`, `tests/identity/test_contract.py`, `scripts/engineering/test-requirements.lock`, `docs/architecture/`, `docs/design/AUTH_UX.md`, `docs/migration/IDENTITY_CUTOVER.md`, `docs/project/`, `docs/plan/`, `docs/engineering/`, `docs/reports/QUB-AUTH-010.md`, `README.md`, `docs/README.md`, `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `TODO.md`.

Acceptance:

- Configured Google/Yandex/VK/Telegram contract с state/PKCE/audience/expiry/unique subject
- No linking чужого account по непроверенной email; provider kill switches
- Только mock transport/local secrets reference, native redirect allowlist
- AUTH-L02: current provider permission recheck в callback до exchange/session для всех providers
- AUTH-L03: email_verified=false/отсутствующий trusted claim не привязывает чужой существующий аккаунт; safe explicit linking + stable provider subject

Проверки: verify.py --suite core/all --python <test-python> --postgres-bin <native-bin>; check.py; unittest tests/engineering; git diff --check; MockTransport + real RSA signatures/JWKS, real PostgreSQL state/replay/link/revoke/disable/config race; no real providers.

Риски: OAuth takeover/open redirect; не реальный провайдерский acceptance. Откат: Снять новый route/artifact, сохранить PostgreSQL accounts/credentials/new writes. Не restore старые SQLite пароли/сессии поверх новой identity; deploy отдельно.

Commit: d93affac786033668dd4ac74f69218d0928ca388. Evidence: ["13.10.2026: dependency AUTH-009 done, implementation1dc57cb/CI38354136689 success/597 checks. Fresh Auth scope approved; ready отдельный bounded cycle, actual providers/email/production ещё не acceptance. Следующей рекомендована AUTH-010; AUTH-011 выполняется отдельным циклом.", "13.10.2026: прямое поручение следующей задачи; выбран approved ready AUTH-010 после verified AUTH-009. Только local core/fixtures, без чтения реальных ключей/деплоя/UI/native tokens. Provider docs проверяются; неизвестная provider identity не создаёт/не связывает аккаунт автоматически. Реальная сеть выключена по умолчанию, тесты только MockTransport.", "13.10.2026: финальный verify.py all693+harness4=697 passed, core308 (foundation29/identity59/Auth120/OAuth100), no failed/skipped. Local Python3.13.13/PG18.6/Node22.22.2, signed RSA/JWKS/MockTransport и real disposable PG. После промежуточных fixtures/readiness corrections повторный full run green; check.py/diff check passed. Implementation push/exact-SHA CI ещё ожидаются; real providers не acceptance.", "13.10.2026: implementation d93affac786033668dd4ac74f69218d0928ca388 pushed/remote exact SHA verified; archive tournaments/qubite-v1.0 unchanged96f0457a523b6b79f21c4092056d8fa8fa69a680. GitHub CI38364255314 completed/success 2026-10-13T07:43:22Z,697 checks (all693+harness4/core308/OAuth100) no failed/skipped; https://github.com/kirillkuz1122/qubite/actions/runs/38364255314. CI Python3.14.8/PG16.15, local Python3.13.13/PG18.6. Real providers/keys/deploy не acceptance. Финальный docs-only evidence commit отдельно."].

## QUB-AUTH-011 — FastAPI verification/password reset/email-2FA contract

Статус: done; модуль: identity; приоритет: P0; approval: true. Зависимости: QUB-AUTH-009.

Не потерять security flows при переносе auth

Файлы: `core/qubite/identity/challenges/`, `core/qubite/sql/0005_challenges.sql`, `core/qubite/config.py`, `core/qubite/app.py`, `core/qubite/migrations.py`, `core/qubite/identity/auth/http.py`, `core/tests/`, `contracts/identity-v2.json`, `docs/architecture/EMAIL_CHALLENGES.md`, `docs/architecture/decisions/0017-email-challenges-and-recovery.md`, `docs/reports/QUB-AUTH-011.md`, `docs/project/`, `docs/plan/`, `README.md`, `core/README.md`, `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `TODO.md`, `docs/README.md`, `docs/engineering/`, `contracts/core-v1.json`, `core/qubite/__init__.py`, `docs/architecture/IDENTITY_SCHEMA.md`, `docs/architecture/WEB_AUTH.md`, `docs/architecture/OAUTH_IDENTITY.md`, `docs/architecture/CURRENT_STATE.md`, `docs/architecture/DATA_MODEL.md`, `docs/README.md`, `tests/identity/test_contract.py`.

Acceptance:

- Одноразовые hashed challenges, TTL/replay/rate caps; reset/revoke/verify flows
- Email transport mock, configured feature behavior, security code не account code-entry
- Новая register/verify policy, proof не назначает owner; owner только явным local bootstrap, existing UUID не меняется

Проверки: Core real PG/HTTP email65 tests: expiry/replay/exhaustion/resend/purpose/config/rates/races/DB rollback/cleanup/session revoke/UUID/owner/default deny; metadata readonly readiness через existing foundation suite; python3 scripts/engineering/verify.py --suite all --python <test-venv-python> --postgres-bin <native-bin>; python3 -m unittest discover -s tests/engineering; python3 scripts/engineering/check.py; git diff --check; GitHub exact-SHA Qubite verification CI success before done.

Риски: Mail leak/race/reset takeover. Откат: Снять новый route/artifact, сохранить PostgreSQL accounts/credentials/new writes. Не restore старые SQLite пароли/сессии поверх новой identity; deploy отдельно.

Commit: f3d4b6c01a20536ce31017e309119d1fe2a792e7. Evidence: "13.10.2026: implementation f3d4b6c01a20536ce31017e309119d1fe2a792e7 pushed/remote exact verified; CI38373075395 completed/success 2026-10-13T09:03:14Z https://github.com/kirillkuz1122/qubite/actions/runs/38373075395. 762 local+CI checks =all758+harness4; core373 (foundation29/identity59/Auth120/OAuth100/email65), no failures/skips. Local Python3.13.13/PG18.6/Node22.22.2/core64.02s; CI Python3.14.8/PG16.15/Node22.23.3/core156.06s, suite timeout180 unchanged. Native disposable PG+mock mail/source-copy/no external APIs. UUID/owner/session revoke/TTL/replay/attempt/rates/resend/concurrency/live version/hash/transport races/atomic failure/skip-lock cleanup/guards pass. Three bounded repair batches corrected test fixtures/OpenAPI/oracle. Archive tournaments/qubite-v1.0 unchanged96f0457. Email-2FA contract-only; real mail/SMTP queue/timing/enrollment/registration/UI/native/provider/production not acceptance. Final docs-only evidence commit separately; push not deploy.".

## QUB-CORE-002 — FastAPI platform settings и module command controls

Статус: ready; модуль: core; приоритет: P1; approval: true. Зависимости: QUB-AUTH-003.

Общие настройки старого Qubite перенести в target core

Файлы: `core/qubite/settings (будущий)`, `contracts/settings-v1.json (будущий)`.

Acceptance:

- Platform/Auth controls отдельно от tournament/VPN/module settings
- Typed allowlist settings, version+idempotency+owner policy/audit
- Legacy config source/mapping, no arbitrary key write or bearer bypass URL

Проверки: Settings invalid key/revoke/concurrency/command ACL tests.

Риски: Изменения scopes/kill switches, no implicit service restart. Откат: Отключить новый API/worker/route; сохранить оригинальные данные и новые записи, не допускать dual writer. Live миграция отдельно.

Commit: None. Evidence: ["13.10.2026: dependencies done после AUTH-003; ready означает готовые зависимости, перед выполнением требуются вопросы/ответы владельца по новому процессу."].

## QUB-CAPTURE-001 — Telegram text durable Inbox ingress

Статус: backlog; модуль: capture; приоритет: P1; approval: true. Зависимости: QUB-TG-002, QUB-AUTH-003.

Быстро сохранить мысль без предварительной категории

Файлы: `core/qubite/capture (будущий)`, `contracts/capture-v1.json (будущий)`.

Acceptance:

- Linked user text без меню → durable private CaptureItem, dedup/update fingerprint
- Guest → Support, exact admin/support replies не capture; raw source/provenance сохранён
- ACK только после commit; restart/duplicate/cross-account/deny cases

Проверки: Mock updates + disposable Postgres persist/restart/duplicate tests.

Риски: Потеря исходника/неверный recipient/intercept admin input. Откат: Отключить новый API/worker/route; сохранить оригинальные данные и новые записи, не допускать dual writer. Live миграция отдельно.

Commit: None. Evidence: [].

## QUB-CAPTURE-002 — AI auto classify/format и safe note/task routing

Статус: backlog; модуль: capture; приоритет: P1; approval: true. Зависимости: QUB-CAPTURE-001, QUB-AI-002, QUB-DOC-001.

AI сам определяет назначение и оформление входящего

Файлы: `core/qubite/capture/router (будущий)`.

Acceptance:

- Validated typed output, только available grants/ACL/budgets и текущий scoped context
- Automatic new personal note/task без выбора/лишних confirmations; source + undo/correction/link
- Low confidence/нет бюджета/AI fail → raw Inbox retained, no silent paid retries; ambiguous reminder remains draft

Проверки: Mock provider parse/injection/deny/undo-concurrent/idempotency tests.

Риски: Content injection/cross-scope/duplicate payment/overwriting existing docs. Откат: Отключить новый API/worker/route; сохранить оригинальные данные и новые записи, не допускать dual writer. Live миграция отдельно.

Commit: None. Evidence: [].

## QUB-CAPTURE-003 — Voice durable attachment и существующий STT adapter

Статус: backlog; модуль: capture; приоритет: P1; approval: true. Зависимости: QUB-CAPTURE-001, QUB-AI-002.

Голосовое так же сохраняется без меню и не теряется при ASR ошибке

Файлы: `core/qubite/capture/voice (будущий)`, `contracts/stt-v1.json (будущий)`.

Acceptance:

- Private audio persist + original metadata до saved ACK, media/type/size bounds
- Existing voice/Hermes service adapter, no second Telethon session/polling/own model download
- ASR failure original retained; successful transcript routes via capture pipeline; cancellation/retry bounded

Проверки: Mock Telegram download+STT failure/restart/partial file/ACL/budget tests.

Риски: Untrusted file/SSRF/private voice/billing unknown. Откат: Отключить новый API/worker/route; сохранить оригинальные данные и новые записи, не допускать dual writer. Live миграция отдельно.

Commit: None. Evidence: [].

## QUB-NOTIFY-001 — Unified event/outbox и безопасные app deep links

Статус: backlog; модуль: notifications; приоритет: P1; approval: true. Зависимости: QUB-AUTH-003, QUB-TG-002.

Уведомления связаны с Qubite событиями и ведут в нужный раздел

Файлы: `core/qubite/notifications (будущий)`, `contracts/notification-v1.json (будущий)`.

Acceptance:

- Общие event/resource IDs для Qubite и Telegram; per-channel status и preference
- Owner alerts/scoped recipient, revoke recheck, authenticated web fallback link без secret
- Crash/duplicate/unknown-send/replayed link; no automatic paid retry or false delivered

Проверки: Mock send/outbox restart/idempotency/scope/deep-link tests.

Риски: Private content leak/unknown sends/native deep-link unsafe commands. Откат: Отключить новый API/worker/route; сохранить оригинальные данные и новые записи, не допускать dual writer. Live миграция отдельно.

Commit: None. Evidence: [].

## QUB-NOTIFY-002 — Daily digest schedule и critical alert policies

Статус: backlog; модуль: notifications; приоритет: P1; approval: true. Зависимости: QUB-NOTIFY-001, QUB-ANALYTICS-001.

Ежедневная сводка и важные уведомления подтверждены владельцем

Файлы: `core/qubite/notifications/digest (будущий)`, `apps/web/settings/notifications (будущий)`.

Acceptance:

- Critical deterministic alerts и daily aggregated digest, без обязательного LLM
- Настраиваемые channels/timezone/time/quiet hours; unique recipient+period digest, no restart duplicates
- Preview/test fixtures; реальное расписание и sends не включать в local tests

Проверки: Clock/DST/UTC/missed/revoke/dedup/unknown-delivery fixtures.

Риски: Spam/quiet-hours/неверный scope или повтор уведомления. Откат: Отключить новый API/worker/route; сохранить оригинальные данные и новые записи, не допускать dual writer. Live миграция отдельно.

Commit: None. Evidence: [].

## QUB-SVC-SEARCH-001 — Search parity и FastAPI service API contract

Статус: backlog; модуль: search; приоритет: P1; approval: true. Зависимости: QUB-SVC-SEARCH-000, QUB-AUTH-001, QUB-AUTH-014.

Реализация нового service API только после отдельного interview/design; старый код — reference, не обязательный UX

Файлы: `core/qubite/services/search (будущий)`, `contracts/search-service-v1.json (будущий)`.

Acceptance:

- Одобренная новая спецификация/scenarios/linking/core API по discovery task; old endpoints не новый authority
- Матрица search/fetch/history/free-paid/media/keys/log protection/grounding/usage по source
- FastAPI platform adapter к рабочему Search engine, scoped keys и ACL, deny before paid calls
- History/old ciphertext/ledger mapping и no-data-loss routing plan; не internal objects SEARCH-001
- Единый core login/UUID и module-scoped policy; нет нового автономного local login/user store или owner auto-paid; ADR-0013

Проверки: Search adapter fixtures, owner/free/paid/revoked/history/privacy negative tests.

Риски: SSRF/private history/cost double accounting. Откат: Отключить новый client/API route flag, сохранить legacy engines/данные/URL и новые записи; migration/routing switch отдельно после acceptance.

Commit: None. Evidence: [].

## QUB-SVC-SEARCH-002 — React Search интерфейс в новой дизайн-системе

Статус: backlog; модуль: search; приоритет: P1; approval: true. Зависимости: QUB-SVC-SEARCH-001, QUB-UI-001.

Полностью обновить собственный Search UI

Файлы: `apps/web/services/search (будущий)`.

Acceptance:

- Search input/results/history/answer/media/status/permissions новое React UI
- Нет unsafe iframe/HTML; cancellation/new query ordering; mobile/keyboard
- Parity+UX acceptance со старым Search, старый route сохраняется до switch

Проверки: React unit/typecheck/build; Playwright search/media/history/deny/revoke/cancel.

Риски: Stale answer race/private history leakage/media unsafe sources. Откат: Отключить новый client/API route flag, сохранить legacy engines/данные/URL и новые записи; migration/routing switch отдельно после acceptance.

Commit: None. Evidence: [].

## QUB-SVC-WRITING-001 — Writing parity и FastAPI grammar/AI API contract

Статус: backlog; модуль: writing; приоритет: P1; approval: true. Зависимости: QUB-SVC-WRITING-000, QUB-AUTH-001, QUB-AUTH-014.

Реализация нового service API только после отдельного interview/design; старый код — reference, не обязательный UX

Файлы: `core/qubite/services/writing (будущий)`, `contracts/writing-service-v1.json (будущий)`.

Acceptance:

- Одобренная новая спецификация/scenarios/linking/core API по discovery task; old endpoints не новый authority
- Separate local check и paid AI actions/grants/keys/budgets
- LanguageTool adapter + shared cost guard, cancel/version/UTF16-compatible offsets
- Firefox addon DTO/key/endpoint compatibility; texts не logs; native highlights bridge сохранён
- Единый core login/UUID и module-scoped policy; нет нового автономного local login/user store или owner auto-paid; ADR-0013

Проверки: Grammar/AI/budget/revoke/UTF16/cancel and addon fixtures.

Риски: Addon breakage/text leaks/UTF16 edits overwrite. Откат: Отключить новый client/API route flag, сохранить legacy engines/данные/URL и новые записи; migration/routing switch отдельно после acceptance.

Commit: None. Evidence: [].

## QUB-SVC-WRITING-002 — React Writing editor с новым UI и highlights

Статус: backlog; модуль: writing; приоритет: P1; approval: true. Зависимости: QUB-SVC-WRITING-001, QUB-UI-001.

Сервисный editor привести к общему Qubite UX

Файлы: `apps/web/services/writing (будущий)`.

Acceptance:

- Новый editor/check/AI-diff/accept/undo interface на React
- Async result не перезаписывает последующие edits; offsets и safe highlight handling
- Draft autosave/keyboard/mobile и parity со старым /writing; addon redesign отдельным slice

Проверки: React build/typecheck; Playwright text edits/cancel/check/AI diff/undo.

Риски: Потеря текста/несовпадение offsets/stale update. Откат: Отключить новый client/API route flag, сохранить legacy engines/данные/URL и новые записи; migration/routing switch отдельно после acceptance.

Commit: None. Evidence: [].

## QUB-SVC-VPN-001 — VPN parity и FastAPI node/subscription API contract

Статус: backlog; модуль: vpn; приоритет: P1; approval: true. Зависимости: QUB-SVC-VPN-000, QUB-AUTH-001, QUB-AUTH-014, QUB-AUTH-012.

Реализация нового service API только после отдельного interview/design; старый код — reference, не обязательный UX

Файлы: `core/qubite/services/vpn (будущий)`, `contracts/vpn-service-v1.json (будущий)`.

Acceptance:

- Одобренная новая спецификация/scenarios/linking/core API по discovery task; old endpoints не новый authority
- Node heartbeat/status/profile/NaiveProxy toggle/subscription/device lifecycle mapping
- Grants отдельно node management, protected credentials и Auth/app compatibility
- Не меняются работающие VPN engines/firewall/SSH/туннель автоматически; stale nodes явные
- Единый core login/UUID и module-scoped policy; нет нового автономного local login/user store или owner auto-paid; ADR-0013

Проверки: Synthetic node/credential/revoke/device/stale/kill-switch fixture tests.

Риски: Потеря connectivity/credential exposure/node authority confusion. Откат: Отключить новый client/API route flag, сохранить legacy engines/данные/URL и новые записи; migration/routing switch отдельно после acceptance.

Commit: None. Evidence: [].

## QUB-SVC-VPN-002 — React VPN workspace и owner node/settings UI

Статус: backlog; модуль: vpn; приоритет: P1; approval: true. Зависимости: QUB-SVC-VPN-001, QUB-UI-001.

VPN включён в новый React Qubite, не legacy services страница

Файлы: `apps/web/services/vpn (будущий)`.

Acceptance:

- Новый React server/device/subscription/settings UI и общий design tokens
- User vs owner node controls, heartbeat/disabled/missing states корректны
- Пароли/tokens не URLs/logs; copy/QR только своих scoped credentials; existing native app работает

Проверки: React build/typecheck; Playwright owner/user/deny/stale/profile flows.

Риски: Leak scoped credentials/UI privilege bypass. Откат: Отключить новый client/API route flag, сохранить legacy engines/данные/URL и новые записи; migration/routing switch отдельно после acceptance.

Commit: None. Evidence: [].

## QUB-UI-002 — Production материал Поток и сохранённые настройки

Статус: done; approval: true. Зависимости: QUB-DESIGN-001, QUB-UI-001.

Утверждены Поток/Игрушечная/Лента/Unbounded/Manrope; физика controls отдельно от UI-001 shell

13.10.2026: владелец потребовал перенести выбранные живые элементы и анимации из готовых assets, исправить UI-001 и затем выполнить AUTH-007 после вопросов.

Acceptance:

- Согласованный profile перенесён в controls shell; exact values/native semantic и stable gestures
- Saved strength/quiet preference, OS reduced motion, cancellation/keyboard/focus; unreadable glass отсутствует

Проверки: Playwright pointer/touch/keyboard/cancel/dialog; axe/mobile/reduced motion; legacy regression

Evidence: Local format/live+demo build passed; Playwright49 passed (17desktop+18phone+14live fixtures), no skipped; touch Input.dispatchTouchEvent/cancel/native value/flow retarget/idle RAF/reduced motion/axe/viewport. Full isolated source-copy all965+engineering11=976pass; real disposable PG18.6, core groups208/165/202 passed27.37/50.90/88.85s; no env/provider/runtime modifications. Origin implementation2d0a8e02728cf281d0ec8d66108396b7ea88aec8 verified; archive refs unchanged96f0457a523b6b79f21c4092056d8fa8fa69a680. Exact-SHA web38441106776 success17:46:06UTC/49checks and engineering38441107010 success17:50:00UTC/976checks,13.10.2026. Private demo version2 deploymentappgdep_6ace6eb65328819192aedadeeca763ed succeeded; publish source3f29bb8ffb80e31fd2c55e46611b158c17d76ba6 from apps/web implementation. Physical device/user acceptance open; AUTH007 questions pending.

Commit: 2d0a8e02728cf281d0ec8d66108396b7ea88aec8.

## QUB-PET-001 — Контракт событий, характеров и инициативы четырёх помощников

Статус: backlog; модуль: ai; приоритет: P1; approval: false. Зависимости: QUB-DESIGN-001.

Уточнение владельца 12.10.2026: живой интерфейс Milo и самостоятельные помощники с разными характерами

Файлы: `contracts/companions-v1.json (будущий)`, `docs/design/COMPANION_EVENTS.md (будущий)`.

Acceptance:

- Луми/Кип/Пип/Сэйдж persona table; own error vs user/service error; bounded allowed context
- Owner review initiative/cooldown/dismiss/voice; no focus steal or rights widening
- 13.10.2026 owner: scenarios hidden/edge peek/contextual appearance/dialogue/retreat; placement, safe-area/keyboard, cooldown/event arbitration by screen/persona, manual summon, privacy/accessibility; final conditions discussed during implementation.

Проверки: Contract validation; scenario table owner review; zero provider calls.

Риски: Характер не расширяет права; no paid calls до guard/приёмки; не терять пользовательские правки. Откат: Выключить feature/companion layer; сохранить записи и drafts; отключить event subscription без изменения legacy.

Commit: . Evidence: [].

## QUB-PET-002 — Scoped помощники в product UI на mock событиях

Статус: backlog; модуль: design; приоритет: P1; approval: false. Зависимости: QUB-PET-001, QUB-UI-002, QUB-DOC-001.

Уточнение владельца 12.10.2026: живой интерфейс Milo и самостоятельные помощники с разными характерами

Файлы: `web/src/companions (будущий)`, `web/tests/companions (будущий)`.

Acceptance:

- Different speech/gestures/context, global hints off/quiet, no interrupt/overlay critical action
- Revision/revoke/dedup/stale response, errors factual, no provider calls or sensitive telemetry
- Edge appearance/retreat from PET-001 contract; no occlusion of controls/keyboard, touch alternative to hover, bounded gestures/cancel, quiet/reduced motion and stale busy completion.

Проверки: Mock event browser tests; cross-scope/privacy/revoke/rapid switch/undo/cancel/accessibility.

Риски: Характер не расширяет права; no paid calls до guard/приёмки; не терять пользовательские правки. Откат: Выключить feature/companion layer; сохранить записи и drafts; отключить event subscription без изменения legacy.

Commit: . Evidence: [].

## QUB-PET-003 — Dispatcher помощников с budget/policy и mock tools

Статус: backlog; модуль: ai; приоритет: P1; approval: false. Зависимости: QUB-PET-002, QUB-AI-002, QUB-CAPTURE-002.

Уточнение владельца 12.10.2026: живой интерфейс Milo и самостоятельные помощники с разными характерами

Файлы: `core/qubite/companions (будущий)`, `contracts/companions-tools-v1.json (будущий)`.

Acceptance:

- Typed event to scoped dispatcher, grants/models/budget checked; no owner bypass/idle paid polling
- Tool proposal accept/undo, own errors, revoke/stale revision safe; real provider acceptance separately

Проверки: Core disposable DB/mock provider counter, concurrent cap/idempotency/revoke/stale/tool permission matrix.

Риски: Характер не расширяет права; no paid calls до guard/приёмки; не терять пользовательские правки. Откат: Выключить feature/companion layer; сохранить записи и drafts; отключить event subscription без изменения legacy.

Commit: . Evidence: [].

## QUB-AUTH-012 — Native authorization code/PKCE и rotating device tokens

Статус: backlog; модуль: identity; приоритет: P0; approval: true. Зависимости: QUB-AUTH-009, QUB-AUTH-007.

Единый новый вход всех клиентов и сервисов по ADR-0013

Файлы: `core/qubite/identity/native (будущий)`, `core/tests/test_native_auth.py (будущий)`.

Acceptance:

- Registered first-party clients/exact callback, external browser, state/PKCE S256, code60s single-use; no password grant/static app secret
- Access10min/refresh idle7d absolute30d, hash-only storage, scope intersection/current grants; DB atomic consume+rotation
- Replay/concurrent refresh revokes family/access, client serialized refresh; no bearer in URL; OS secure storage boundary

Проверки: Real disposable PG code/refresh concurrency, client/redirect/PKCE mismatch, replay/scope/revoke/expiry negative tests.

Риски: Credential leakage/privilege escalation; synthetic contract не runtime acceptance. Откат: Отключить новый boundary/route, сохранить новые core данные; no legacy fallback/dual writer. Deploy отдельно.

Commit: None. Evidence: [].

## QUB-AUTH-013 — Scoped API keys расширений и агентов

Статус: ready; модуль: identity; приоритет: P0; approval: true. Зависимости: QUB-AUTH-009, QUB-AUTH-003.

Единый новый вход всех клиентов и сервисов по ADR-0013

Файлы: `core/qubite/identity/api_keys (будущий)`, `core/tests/test_api_keys.py (будущий)`.

Acceptance:

- Own reauthenticated key creation, one module audience/scopes subset/current grants, explicit expiry<=90d and request cap
- Hash-only at rest, plaintext return once, metadata list/revoke; no wildcard owner/admin bypass
- Search history/read/write и AI отдельно, Writing check/AI отдельно; provider counter0 на deny

Проверки: PG expiry/revoke/own-vs-other keys/role/scope/quota concurrency tests.

Риски: Credential leakage/privilege escalation; synthetic contract не runtime acceptance. Откат: Отключить новый boundary/route, сохранить новые core данные; no legacy fallback/dual writer. Deploy отдельно.

Commit: None. Evidence: ["13.10.2026: dependencies done после AUTH-003; ready означает готовые зависимости, перед выполнением требуются вопросы/ответы владельца по новому процессу."].

## QUB-AUTH-014 — Private core introspection для отдельных service engines

Статус: backlog; модуль: identity; приоритет: P0; approval: true. Зависимости: QUB-AUTH-009, QUB-AUTH-003, QUB-AUTH-013.

Единый новый вход всех клиентов и сервисов по ADR-0013

Файлы: `core/qubite/identity/introspection (будущий)`, `core/tests/test_introspection.py (будущий)`.

Acceptance:

- Private per-service auth bound audience, POST opaque credentials, strict identity-v2 reply, no forwarded user/owner trust
- Active/current auth_version/policy_version/status/scopes, no positive stale cache, timeout/unavailable fail-closed
- Private route/engine ports excluded from public ingress, module/object/budget gates separate from principal

Проверки: Local HTTP strict schema/service audience/blocked/revoke/timeout/forged headers plus ingress contract checks.

Риски: Credential leakage/privilege escalation; synthetic contract не runtime acceptance. Откат: Отключить новый boundary/route, сохранить новые core данные; no legacy fallback/dual writer. Deploy отдельно.

Commit: None. Evidence: [].

## QUB-AUTH-015 — Глобальные переключатели входа, регистрации, техработ и провайдеров

Статус: backlog; модуль: owner; приоритет: P1; approval: false. Зависимости: QUB-AUTH-006, QUB-AUTH-010, QUB-AUTH-003.

Уточнение владельца 13.10.2026; сохранить в плане без реализации несогласованных будущих slices

Файлы: `core/qubite/platform_controls (будущий)`, `docs/architecture/PLATFORM_CONTROLS.md`.

Acceptance:

- Owner-managed login/registration/maintenance/OAuth/email controls; server enforcement, audit/versions and anti-lockout recovery
- Режим регистрации AUTH-006 уже реализован; login/maintenance/OAuth Console API и UI не считать готовыми
- Турнирные creation/participation switches только в Tournaments; bot invokes same scoped commands

Проверки: Concurrent switch/callback/session issuance/job gates; owner recovery and user503 UI tests; no external providers.

Риски: Не перенести legacy bypass_token в URL; продумать trusted recovery при отключённом входе. Откат: Отключить новый adapter/control, сохранить identity/UUID/consents/grants/budgets/audit; forward recovery, no legacy authority fallback; deploy отдельно

Commit: None. Evidence: ["13.10.2026: пожелание владельца записано; детальная реализация требует вопросов перед своей задачей."].

## QUB-AUTH-016 — Sign in with ChatGPT: eligibility и контракт Web/Android/Desktop

Статус: backlog; модуль: identity; приоритет: P1; approval: false. Зависимости: QUB-AUTH-006, QUB-AUTH-010.

Уточнение владельца 13.10.2026; сохранить в плане без реализации несогласованных будущих slices

Файлы: `docs/architecture/CHATGPT_INTEGRATION.md`, `contracts/chatgpt-identity (будущий)`.

Acceptance:

- Проверить официальный SIWC trial/client registration для сайта и OSS/local eligibility для native; не считать приложение допущенным
- Согласовать stable issuer/client/sub, PKCE/nonce/state, explicit enrollment/linking, verified email policy и separate plan-use consent
- Матрица клиентов/хранение/refresh/revoke/provider toggle, никаких tokens чужого Codex/ChatGPT

Проверки: Документированный официальный flow и ограничения, signed fixtures после одобрения; real acceptance отдельно.

Риски: Website limited trial; нельзя использовать dynamic OSS registration как обход допуска общего hosted сервера. Откат: Отключить новый adapter/control, сохранить identity/UUID/consents/grants/budgets/audit; forward recovery, no legacy authority fallback; deploy отдельно

Commit: None. Evidence: ["13.10.2026: пожелание владельца записано; детальная реализация требует вопросов перед своей задачей."].

## QUB-AI-003 — Личный ChatGPT план и owner API: независимые источники AI

Статус: backlog; модуль: ai; приоритет: P1; approval: false. Зависимости: QUB-AUTH-016, QUB-AI-002, QUB-AUTH-003.

Уточнение владельца 13.10.2026; сохранить в плане без реализации несогласованных будущих slices

Файлы: `core/qubite/ai/funding (будущий)`, `docs/architecture/CHATGPT_INTEGRATION.md`.

Acceptance:

- Личный AI доступен после eligible ChatGPT profile и отдельного plan-use consent в пределах личных квот; basic chat vs AI inside owner-granted modules согласуется перед задачей. Signin не выдаёт owner-funded API grant.
- Owner-funded API только manual provider/model/action grants+atomic budget; два источника доступны независимо
- В UI источник и квота; expiry/revoke/exhaustion/unknown fail closed, no silent owner API fallback; поддерживаемые Responses features проверяются

Проверки: Mock profile/scope/quota exhaustion/account switch/revoke/cross-user/source isolation/concurrent reserve; native/device/live provider отдельно.

Риски: Plan-use preview имеет неподдерживаемые ASR/tools; нельзя обещать все AI-функции за личную подписку. Откат: Отключить новый adapter/control, сохранить identity/UUID/consents/grants/budgets/audit; forward recovery, no legacy authority fallback; deploy отдельно

Commit: None. Evidence: ["13.10.2026: пожелание владельца записано; детальная реализация требует вопросов перед своей задачей."].

## QUB-REPO-001 — Отделение legacy и навигация универсального Qubite

Статус: done; модуль: repository; приоритет: P0; approval: true. Зависимости: QUB-001, QUB-TEST-001.

Подтверждённый владельцем перенос старого сайта, VPN, deploy и документации; самостоятельные опциональные турниры и поддомены модулей

Файлы: `legacy/`, `modules/tournaments/`, `deploy/README.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `TODO.md`, `docs/`, `scripts/engineering/`, `tests/engineering/`, `.github/workflows/engineering.yml`, `.gitignore`, `.env.example`, `.env (private local only)`, `services/*/README.md`, `integrations/*/README.md`.

Acceptance:

- Старые исходники, HTML/legal, материалы и deployment сохранены в legacy с картой old→new и хешами; private deploy/.env сохранён по прежнему пути
- Legacy site/static/auth/writing и installer paths проверены после переноса; core/contracts/design sources не меняются
- Tournaments самостоятельная optional платформа без shared identity/SSO/data/платных обходов нового core; install selection будущего deploy отдельно
- Root docs и агентный старт описывают Qubite 2.0; старые сервисы явно reference с отдельными discovery tasks и вопросами до реализации
- Поддомены согласованы; DNS/TLS/new installer/native/UI/rewrite modules не выполняются

Проверки: check.py; relocation coverage and integrity; bash syntax + installer dry plan; verify.py all; tests/engineering; exact SHA CI.

Риски: Сломанные относительные пути после переноса; Случайный коммит приватных .env/DB/build files; Старые разрешения и API ошибочно приняты за новый core. Откат: Обратный перенос по RELOCATION_MANIFEST до deploy; сохранять private .env/DB и immutable archive; дальнейший git revert только без потери данных

Commit: 66c7b46c4e573255b509024e7b4ceb4ed9a2239a. Evidence: ["13.10.2026 local: all965 + engineering11 =976 passed, no failed/skipped; Node99/deploy18/Search95/Brief112/Kwork29/SiYuan5/identity32/core575; real disposable PostgreSQL18.6.", "368 tracked relocations preserved in committed tree, allowed path/docs changes recorded; core/contracts/design sources unchanged. Private deploy env and archived root env SHA256 match; new root env blank/ignored; no private values committed.", "check.py67tasks/82docs;19 bash syntax; nonmutating installer plan/explicit fixture configure-check; diff checks passed. Legacy HTTP/static/Writing paths covered.", "Implementation 66c7b46c4e573255b509024e7b4ceb4ed9a2239a pushed and origin verified. Exact SHA GitHub CI38401965245 completed/success 2026-10-13T13:08:52Z; engineering11 + all965 =976 passed. https://github.com/kirillkuz1122/qubite/actions/runs/38401965245", "Remote tournaments/qubite-v1.0 remain96f0457a523b6b79f21c4092056d8fa8fa69a680. New UI/installer/provider/native/deploy/data migration are separate tasks; no skills/subagents/quota reset/personal memory writes."].

## QUB-SVC-SEARCH-000 — Search: вопросы владельцу и новое проектирование модуля

Статус: backlog; модуль: search; приоритет: P1; approval: false. Зависимости: QUB-REPO-001.

Старый сервис существует как reference; проектировать сценарии/UI/API заново и связывать с другими модулями Qubite

Файлы: `services/search/`, `integrations/qubite-search/`, `docs/architecture/ (новая спецификация сервиса после ответов)`, `docs/plan/tasks.json`.

Acceptance:

- Перед проектированием получены отдельные ответы владельца: что оставить/убрать/добавить и основные сценарии
- Карта reference feature→новая функция; сценарии Docs/Projects/Inbox/Command/Finance где нужны
- Typed новый core API, UUID/permissions/budget/events/source links/data authority, upstream native capabilities отдельно
- Маленькие implementation tasks с deps/tests/rollback; никакой автоматической активации legacy API/платных calls

Проверки: check.py; source parity inventory; spec/API/permission review; owner acceptance.

Риски: Старые интерфейсы/глобальные роли/credentials приняты за новые; outbound sends без authorization. Откат: Только specification; legacy references/данные сохранить, новый adapter ещё не включён

Commit: None. Evidence: [].

## QUB-SVC-WRITING-000 — Writing: вопросы владельцу и новое проектирование модуля

Статус: backlog; модуль: writing; приоритет: P1; approval: false. Зависимости: QUB-REPO-001.

Старый сервис существует как reference; проектировать сценарии/UI/API заново и связывать с другими модулями Qubite

Файлы: `legacy/qubite-v1/back/src/writing.js`, `integrations/qubite-writing/`, `docs/architecture/ (новая спецификация сервиса после ответов)`, `docs/plan/tasks.json`.

Acceptance:

- Перед проектированием получены отдельные ответы владельца: что оставить/убрать/добавить и основные сценарии
- Карта reference feature→новая функция; сценарии Docs/Projects/Inbox/Command/Finance где нужны
- Typed новый core API, UUID/permissions/budget/events/source links/data authority, upstream native capabilities отдельно
- Маленькие implementation tasks с deps/tests/rollback; никакой автоматической активации legacy API/платных calls

Проверки: check.py; source parity inventory; spec/API/permission review; owner acceptance.

Риски: Старые интерфейсы/глобальные роли/credentials приняты за новые; outbound sends без authorization. Откат: Только specification; legacy references/данные сохранить, новый adapter ещё не включён

Commit: None. Evidence: [].

## QUB-SVC-VPN-000 — VPN: вопросы владельцу и новое проектирование модуля

Статус: backlog; модуль: vpn; приоритет: P1; approval: false. Зависимости: QUB-REPO-001.

Старый сервис существует как reference; проектировать сценарии/UI/API заново и связывать с другими модулями Qubite

Файлы: `legacy/qubite-v1/back/src/proxy/`, `legacy/qubite-v1/deploy/proxy/`, `legacy/qubite-vpn/`, `docs/architecture/ (новая спецификация сервиса после ответов)`, `docs/plan/tasks.json`.

Acceptance:

- Перед проектированием получены отдельные ответы владельца: что оставить/убрать/добавить и основные сценарии
- Карта reference feature→новая функция; сценарии Docs/Projects/Inbox/Command/Finance где нужны
- Typed новый core API, UUID/permissions/budget/events/source links/data authority, upstream native capabilities отдельно
- Маленькие implementation tasks с deps/tests/rollback; никакой автоматической активации legacy API/платных calls

Проверки: check.py; source parity inventory; spec/API/permission review; owner acceptance.

Риски: Старые интерфейсы/глобальные роли/credentials приняты за новые; outbound sends без authorization. Откат: Только specification; legacy references/данные сохранить, новый adapter ещё не включён

Commit: None. Evidence: [].

## QUB-SVC-BRIEF-000 — Brief/specbot: вопросы владельцу и новое проектирование модуля

Статус: backlog; модуль: brief; приоритет: P1; approval: false. Зависимости: QUB-REPO-001.

Старый сервис существует как reference; проектировать сценарии/UI/API заново и связывать с другими модулями Qubite

Файлы: `services/specbot/`, `docs/architecture/ (новая спецификация сервиса после ответов)`, `docs/plan/tasks.json`.

Acceptance:

- Перед проектированием получены отдельные ответы владельца: что оставить/убрать/добавить и основные сценарии
- Карта reference feature→новая функция; сценарии Docs/Projects/Inbox/Command/Finance где нужны
- Typed новый core API, UUID/permissions/budget/events/source links/data authority, upstream native capabilities отдельно
- Маленькие implementation tasks с deps/tests/rollback; никакой автоматической активации legacy API/платных calls

Проверки: check.py; source parity inventory; spec/API/permission review; owner acceptance.

Риски: Старые интерфейсы/глобальные роли/credentials приняты за новые; outbound sends без authorization. Откат: Только specification; legacy references/данные сохранить, новый adapter ещё не включён

Commit: None. Evidence: [].

## QUB-SVC-KWORK-000 — Kwork: вопросы владельцу и новое проектирование модуля

Статус: backlog; модуль: kwork; приоритет: P1; approval: false. Зависимости: QUB-REPO-001.

Старый сервис существует как reference; проектировать сценарии/UI/API заново и связывать с другими модулями Qubite

Файлы: `integrations/kwork/`, `docs/architecture/ (новая спецификация сервиса после ответов)`, `docs/plan/tasks.json`.

Acceptance:

- Перед проектированием получены отдельные ответы владельца: что оставить/убрать/добавить и основные сценарии
- Карта reference feature→новая функция; сценарии Docs/Projects/Inbox/Command/Finance где нужны
- Typed новый core API, UUID/permissions/budget/events/source links/data authority, upstream native capabilities отдельно
- Маленькие implementation tasks с deps/tests/rollback; никакой автоматической активации legacy API/платных calls

Проверки: check.py; source parity inventory; spec/API/permission review; owner acceptance.

Риски: Старые интерфейсы/глобальные роли/credentials приняты за новые; outbound sends без authorization. Откат: Только specification; legacy references/данные сохранить, новый adapter ещё не включён

Commit: None. Evidence: [].

## QUB-SVC-KNOWLEDGE-000 — Knowledge/native bridge: вопросы владельцу и новое проектирование модуля

Статус: backlog; модуль: knowledge; приоритет: P1; approval: false. Зависимости: QUB-REPO-001.

Старый сервис существует как reference; проектировать сценарии/UI/API заново и связывать с другими модулями Qubite

Файлы: `integrations/qubite-knowledge/`, `docs/architecture/ (новая спецификация сервиса после ответов)`, `docs/plan/tasks.json`.

Acceptance:

- Перед проектированием получены отдельные ответы владельца: что оставить/убрать/добавить и основные сценарии
- Карта reference feature→новая функция; сценарии Docs/Projects/Inbox/Command/Finance где нужны
- Typed новый core API, UUID/permissions/budget/events/source links/data authority, upstream native capabilities отдельно
- Маленькие implementation tasks с deps/tests/rollback; никакой автоматической активации legacy API/платных calls

Проверки: check.py; source parity inventory; spec/API/permission review; owner acceptance.

Риски: Старые интерфейсы/глобальные роли/credentials приняты за новые; outbound sends без authorization. Откат: Только specification; legacy references/данные сохранить, новый adapter ещё не включён

Commit: None. Evidence: [].

## QUB-DEPLOY-003 — Owner Console: безопасная установка/обновление модулей

Статус: backlog; модуль: deployment; приоритет: P2; approval: false. Зависимости: QUB-DEPLOY-002, QUB-AUTH-004.

Владелец хочет выбирать/устанавливать модули из Console; privileged installer нужен отдельно от public API

Файлы: `core/qubite/ (future module installation commands)`, `deploy/ (future restricted operator worker)`, `apps/web/ (future Console UI)`, `docs/engineering/DEPLOYMENT_AND_BACKUPS.md`.

Acceptance:

- До реализации вопросы: доступные packages/hosts/approval/backup/recovery/update policy
- Signed/pinned allowlist packages, reauth/owner/If-Match/idempotency/audit и отдельный operator worker; no arbitrary shell/URL/file paths
- Plan→backup→install→checks→status/rollback; не включать paid grants по факту установки
- Standalone Tournaments остаётся независимым; Console only installation/status metadata, no shared accounts

Проверки: mock/disposable operator integration; negative command/privilege cases; rollback/restore; owner UI acceptance.

Риски: Privilege escalation и data loss при установке/обновлении. Откат: Прекратить bounded operator job, восстановить проверенный backup, сохранить новые пользовательские данные

Commit: None. Evidence: [].

## QUB-UI-003 — Серверный каталог и owner hidden/locked visibility

Статус: done; модуль: owner; приоритет: P0; approval: true. Зависимости: QUB-UI-001, QUB-AUTH-003.

Ответ владельца13.10.2026: выбирать для каждого модуля скрытие или замок до выдачи доступа; UI-001 только preview

Файлы: `core/qubite/policy/`, `core/qubite/sql/0008_catalog.sql`, `core/qubite/migrations.py`, `core/tests/`, `apps/web/src/`, `apps/web/tests/`, `scripts/engineering/web_auth_fixture.py`, `contracts/core-v1.json`, `docs/architecture/MODULE_CATALOG.md`, `docs/project/`, `docs/plan/`.

Acceptance:

- Перед реализацией обсудить default policy, unavailable/installed/public metadata и режимы отображения
- Trusted server persistence hidden/locked с owner gate, CSRF, reauth, audit, If-Match/idempotency; исключить выдачу grants через visibility
- Filtered user catalog/direct URLs: hidden generic missing, locked denied, read grant отдельный server gate; owner no paid bypass

Проверки: Disposable PostgreSQL HTTP negative/race/revoke + live React Playwright catalog tests.

Риски: Скрытие не авторизация; не выдавать metadata скрытых модулей; catalog refresh при revoke. Откат: Отключить catalog feature; grants/data сохранить; explicit migration rollback plan до schema switch

Commit: 9771158ce3600ff0c396ea72baedfbb67cc1d908. Evidence: ["14.10.2026 owner answers before coding/ADR-0025: default locked/shared visibility, read-granted preparing/unavailable shown. Core0.7.0/schema0008 additive; apps/web0.4.0.", "Local all997+harness11=1008pass; core4groups208/175/202/22. Final86browser18desktop/19phone/33live fixtures/16real browser-core passed1.2m, including two independent drafts retained across per-row save. Format/typecheck/live+demo builds/screenshots light/dark phone/desktop and clean npmci in isolated publication copy passed. No failed/skipped acceptance suites.", "Implementation346909ca15dbf8330b61771f0fc45ec885983f9b and final correction9771158ce3600ff0c396ea72baedfbb67cc1d908 pushed/origin verified; final exact-SHA web38505000027 completed/success2026-10-14T03:13:58Z86pass, engineering38505000011 success03:17:10Z1008pass. Both workflows match final codeSHA.", "Existing owner-private shell demo version5/source56a26e87909a282edba46c4cc66265c39d4dc692/deploymentappgdep_6acef5267ce08191bd9a61531c01b63c succeeded2026-10-14T03:21:25.034187+00:00, owner/custom/one owner/zero groups;15files696320bytes static only, no env/core/fixture. Initialv4 superseded. Material-lab unchanged.", "Visibility does not grant/install/change paid authority. Hidden generic404/direct lookup, revoked/expired cleared, owner gate/CSRF/reauth/If-Match/idempotency/atomic audit/races tested. Real SMTP/providers/native/devices/installer/production and legal publication separate; no permanent DB migration. Next AI-001 requires new owner questions/answers."].

## QUB-LEGAL-001 — Публичный запуск: реквизиты, правовые основания и раздельное evidence

Статус: backlog; модуль: legal; приоритет: P0; approval: false. Зависимости: QUB-AUTH-007.

Новые тексты AUTH-007 подготовлены; неизвестны оператор/страны/получатели/сроки, API пока фиксирует технический пакет

Файлы: `docs/legal/`, `apps/web/src/legal/`, `core/qubite/identity/registration/ (после своего согласования)`, `contracts/ (отдельный consent контракт)`.

Acceptance:

- До задачи вопросы владельцу: оператор/контакт/страны/хостинг/дети/подрядчики/сроки, затем актуальная проверка права выбранных стран
- Заполненные и утверждённые тексты соответствуют реальным способам обработки; publication_ready=true только после проверки
- Если нужны отдельные согласия: version/purpose/document hash/evidence и withdraw; technical старый bool не преобразуется задним числом
- Cookie inventory, optional off until choice, отдельные AI/distribution/marketing основания; запросы/удаление/backup проверены до public launch

Проверки: legal/UI/API evidence review; consent/offline/stale version/withdraw tests; cookie inventory; owner publication acceptance.

Риски: Выдуманные реквизиты/правовые основания; blanket consent вместо отдельных целей; удаление без учёта backup. Откат: Остановить публичную регистрацию, сохранить аккаунты/существующие consent records, восстановить проверенные документы с forward fix

Commit: None. Evidence: ["AUTH-007: full text package available but operator question pending; no production approval."].
