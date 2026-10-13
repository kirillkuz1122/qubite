# Карточки небольших задач

Источник состояния — [tasks.json](tasks.json). 56 карточек; список ниже отражает machine registry. Shared APIs FastAPI/Postgres; included UI React/new design; optional Tournaments Node/SQLite/Vanilla. Fresh identity без импорта/bridge по [ADR-0013](../architecture/decisions/0013-fresh-identity-and-unified-login.md). Одна ready approved задача за цикл, deploy отдельно.

## QUB-001 — Аудит и архитектурный baseline

Модуль: core; P0; статус done; architecture approved: true. Зависимости: нет.

Причина: Зафиксировать фактический legacy, целевые требования и границы согласования до изменения runtime.

Файлы/контракты: `docs/architecture`, `docs/product`, `scripts/engineering`.

Acceptance:

- Архивные refs проверены; инвентари, требования/ADR/план и безопасный harness подготовлены
- Пользователь выбирает архитектуру, отчёт различает code/docs/server/proposal

Проверка: python3 scripts/engineering/check.py.

Риск: Новый процесс не открывает legacy writable DB; изолированная schema миграция; capacity перед деплоем. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: ae3f71e0ae29ef10a6f772027b48addba9d508fc. Evidence: origin archive refs verified 12.10.2026; QUB-001 report contains local test results; 12.10.2026 ответы владельца 1–6; ADR-0001/0005/0006 фиксируют стек и scope; 332 baseline checks; GitHub Actions run 38197926998 passed.

## QUB-OPS-001 — Read-only production inventory и drift

Модуль: ops; P0; статус backlog; architecture approved: false. Зависимости: нет.

Причина: Репозиторий не доказывает текущую версию/ресурсы production; исключить overwrite drift и скрытый autodeploy.

Файлы/контракты: `docs/reports/PRODUCTION_INVENTORY.md`.

Acceptance:

- SHA/dirty paths/units/routes/data sizes и RAM/swap/disk собраны без секретов
- Autodeploy и один polling проверены; никаких restart/write

Проверка: Проверка redacted manifest; сравнение с INVENTORY.json.

Риск: Не раскрыть private configs; restore не посылает outbox и не перезаписывает production. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: после выполнения. Evidence: .

## QUB-OPS-002 — Backup manifest и disposable restore

Модуль: ops; P0; статус backlog; architecture approved: false. Зависимости: QUB-OPS-001.

Причина: Git не хранит рабочие БД/attachments/keys; восстановление должно быть доказано до миграций.

Файлы/контракты: `docs/engineering/DEPLOYMENT_AND_BACKUPS.md`, `scripts/engineering/restore-drill.py (будущий)`.

Acceptance:

- Согласованный SQLite+attachments+keys backup off-host
- Восстановление isolated; counts/FK/hash/grants/ledger совпали

Проверка: Будущий restore drill с synthetic fixtures + integrity_check.

Риск: Не раскрыть private configs; restore не посылает outbox и не перезаписывает production. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: после выполнения. Evidence: .

## QUB-TEST-001 — Auth HTTP characterization

Модуль: identity; P0; статус done; architecture approved: true. Зависимости: QUB-001.

Причина: Текущие auth suites проверяют helper/router fixtures, но не весь register/login server.js.

Файлы/контракты: `back/tests/auth-legacy-baseline.test.js`, `back/tests/fixtures/auth-server.cjs`, `docs/reports/QUB-TEST-001.md`, `docs/architecture/ENV_AND_TESTS.md`, `docs/engineering/TEST_STRATEGY.md`, `docs/plan/tasks.json`, `docs/plan/TASKS.md`, `docs/project/PROJECT_CONTEXT.md`, `docs/project/LAST_HANDOFF.md`, `README.md`, `SECURITY.md`, `AGENTS.md`, `CLAUDE.md`, `docs/README.md`, `docs/architecture/AUTH_AND_PERMISSIONS.md`, `docs/plan/ROADMAP.md`, `docs/reports/STATUS-2026-10-12.md`.

Acceptance:

- Реальный server isolated register/login/logout/revoke/reset + OAuth transport mock
- Blocked user/CSRF/state/PKCE/cookie malformed negative cases

Проверка: python3 scripts/engineering/verify.py --suite node.

Риск: Не читать пароли в модель; blocked/revoked/OAuth subject не превращается в owner; sessions не теряются. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: 695227792e6ab7a09cdad67b56d8acbad4cc0ad9. Evidence: 12.10.2026: verify.py --suite all --python /tmp/qubite-audit-venv/bin/python: Node94/deploy18/Search95/Brief112/Kwork29/SiYuan5 =353 pass; harness unittest4 =357. No skipped/failed.; 25 real-server Auth HTTP cases; runtime unchanged; synthetic external transport only. AUTH-L01..03 retained legacy defects, P0 account linking cutover gate in report/SECURITY.; check.py и git diff --check passed; implementation commit 695227792e6ab7a09cdad67b56d8acbad4cc0ad9 pushed/remote main verified; GitHub Actions run 38207835631 success..

## QUB-TEST-002 — Tournament runtime и rating regression

Модуль: tournaments; P0; статус backlog; architecture approved: false. Зависимости: QUB-TEST-001.

Причина: Сохранить сложный join/submission/rating flow до выделения турниров в модуль.

Файлы/контракты: `back/tests/tournament-http.test.js (будущий)`, `back/tests/rating-baseline.test.js (будущий)`.

Acceptance:

- Join individual/team/roster/code, submit/draft/deadline/penalty покрыты
- Rating/history/bonus/decay повтор не дублирует; baseline UI screenshot

Проверка: verify.py --suite node; будущий Playwright fixture.

Риск: Сохранить roster/codes/team/results/rating; не допустить глобальной эскалации. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: после выполнения. Evidence: .

## QUB-CORE-001 — Изолированный core health и contract skeleton

Модуль: core; P0; статус done; architecture approved: true. Зависимости: QUB-001.

Причина: Проверить выбранный runtime/storage контракт без write доступа к legacy данным.

Файлы/контракты: `core/`, `contracts/core-v1.json`, `scripts/engineering/verify.py`, `scripts/engineering/test-requirements.lock`, `tests/engineering/`, `.github/workflows/engineering.yml`, `.gitignore`, `README.md`, `SECURITY.md`, `AGENTS.md`, `CLAUDE.md`, `docs/architecture/CORE_FOUNDATION.md`, `docs/architecture/TARGET_ARCHITECTURE.md`, `docs/architecture/DATA_MODEL.md`, `docs/architecture/decisions/0009-core-foundation.md`, `docs/architecture/decisions/README.md`, `docs/engineering/TEST_STRATEGY.md`, `docs/engineering/AGENT_HARNESS.md`, `docs/architecture/ENV_AND_TESTS.md`, `docs/reports/QUB-CORE-001.md`, `docs/reports/STATUS-2026-10-12.md`, `docs/project/PROJECT_CONTEXT.md`, `docs/project/LAST_HANDOFF.md`, `docs/plan/tasks.json`, `docs/plan/TASKS.md`, `docs/plan/ROADMAP.md`, `docs/README.md`.

Acceptance:

- FastAPI health и Postgres versioned migration на disposable DB; no legacy DB writes
- Contract validation и no-network startup tests

Проверка: python3 scripts/engineering/verify.py --suite core --python <venv-python> --postgres-bin <bin>; python3 scripts/engineering/verify.py --suite all --python <venv-python> --postgres-bin <bin>; python3 -m unittest discover -s tests/engineering; check.py; git diff --check.

Риск: Новый процесс не открывает legacy writable DB; изолированная schema миграция; capacity перед деплоем. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: a85f047e7e54c07a6f780a127988b14d9c623a74. Evidence: 12.10.2026: all isolated runner Node94/deploy18/Search95/Brief112/Kwork29/SiYuan5/core29=382 pass; harness4=386; no failed/skipped.; Real native PostgreSQL18.6 + Uvicorn HTTP, checksum/drift/rollback/concurrent/read-only role/no-env/no-network startup; only temp DB, no legacy/runtime/deploy changes.; check.py/git diff --check/harness4 passed; commit a85f047e7e54c07a6f780a127988b14d9c623a74 pushed/remote SHA verified; CI run 38211426535 success incl PostgreSQL16.15/core29/all suites, local PostgreSQL18.6..

## QUB-AUTH-002 — Новые PostgreSQL аккаунты и локальный owner bootstrap

Модуль: identity; P0; статус ready; architecture approved: true. Зависимости: QUB-AUTH-008, QUB-CORE-001, QUB-TEST-001.

Причина: Создать fresh identity нового core без импорта/bridge старых аккаунтов.

Файлы/контракты: `core/qubite/identity/ (будущий)`, `core/qubite/sql/0002_identity.sql (будущий)`, `core/tests/test_identity.py (будущий)`, `docs/reports/QUB-AUTH-002.md (будущий)`.

Acceptance:

- Explicit subjects UUID/email/status/auth_version + singleton platform_owner schema, checksum/transactional migrations
- Локальный явный bootstrap owner: no public endpoint/first-register privilege, atomic repeat/concurrency rejection, preserve same UUID
- Нет old password/session/role/grant import, integer-ID mapping и обязательного alias; password setup/login следующая AUTH-009
- Readiness/migration/invariants и existing foundation negative tests; secrets/passwords не записываются в argv/logs

Проверка: Disposable PostgreSQL: migration twice/drift/rollback, canonical email collision, bootstrap race/repeat, singleton FK/constraints; isolated all suites.

Риск: Owner takeover через public bootstrap/first signup; local bootstrap не означает готовый password login. Откат: Снять новый route/artifact, сохранить PostgreSQL accounts/credentials/new writes. Не restore старые SQLite пароли/сессии поверх новой identity; deploy отдельно..

Commit: после выполнения. Evidence: ADR-0013/13.10.2026: владелец разрешил единый новый API/Auth и fresh owner; архитектура предметных schema/explicit bootstrap одобрена в этом scope. Ready после done AUTH-008, без начала второго slice..

## QUB-AUTH-003 — Module entitlements и scoped policy gate

Модуль: policy; P0; статус backlog; architecture approved: false. Зависимости: QUB-AUTH-002, QUB-AUTH-009.

Причина: Старые глобальные роли и owner bypass не подходят новой default-deny модели.

Файлы/контракты: `core/qubite/policy (будущий)`, `contracts/policy-v1.json (будущий)`.

Acceptance:

- Default deny и intersection REST/job/tool/WS реализованы
- Owner/tournament/cross-resource/revoke/API bypass negative matrix

Проверка: Будущий core pytest policy; provider counter 0.

Риск: Cross-scope/guest/plugin/job могут обходить UI; owner не bypass бюджета. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: после выполнения. Evidence: .

## QUB-AI-001 — Atomic mock budget reservation

Модуль: ai; P0; статус backlog; architecture approved: false. Зависимости: QUB-AUTH-003.

Причина: Раздельные float ledgers не защищают общий cap при параллельном расходе.

Файлы/контракты: `core/qubite/ai/budgets (будущий)`.

Acceptance:

- Integer buckets/idempotency/reserve/settle/unknown states
- 2 workers concurrent cap и double settle pass

Проверка: Будущий core pytest budgets с disposable DB, two processes.

Риск: Неизвестная цена/доставка fail closed; no real paid requests; actual accounting не обрезается. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: после выполнения. Evidence: .

## QUB-AI-002 — Mock dispatcher crash/revoke/fallback checks

Модуль: ai; P0; статус backlog; architecture approved: false. Зависимости: QUB-AI-001.

Причина: Crash/timeout/revoke не должны давать двойной платный вызов или бесплатное освобождение unknown reserve.

Файлы/контракты: `core/qubite/ai/dispatcher (будущий)`.

Acceptance:

- No grant/price/budget/revoked → 0 provider calls
- Unknown delivery reserve retained, no automatic paid retry

Проверка: Будущий core pytest dispatcher fault injection.

Риск: Неизвестная цена/доставка fail closed; no real paid requests; actual accounting не обрезается. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: после выполнения. Evidence: .

## QUB-UI-001 — Today shell и owner/nonowner navigation

Модуль: ui; P0; статус backlog; architecture approved: false. Зависимости: QUB-AUTH-003, QUB-AUTH-009, QUB-DESIGN-001.

Причина: Отделить обычный user outcome от legacy role dashboard и показать denied/unavailable состояния.

Файлы/контракты: `apps/web (будущий)`, `docs/design/DESIGN_SYSTEM_PLAN.md`.

Acceptance:

- Owner ordinary home; console hidden entry; module denied/degraded states
- Viewport keyboard/focus checks и Playwright direct URL tests

Проверка: Будущий npm typecheck/build + Playwright shell tests.

Риск: Скрытие UI не authorization; optimistic sync статус обязан быть честным. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: после выполнения. Evidence: .

## QUB-AUTH-004 — Owner Console users/grants/budgets UI

Модуль: owner; P0; статус backlog; architecture approved: false. Зависимости: QUB-UI-001, QUB-AI-002.

Причина: Дать владельцу ручные независимые grants/budgets без предоставления всем доступа.

Файлы/контракты: `apps/web/owner (будущий)`, `core/qubite/owner (будущий)`.

Acceptance:

- Manual account grants/revoke/budget with audit+If-Match
- Nonowner owner API denied, no self-service paid grant

Проверка: Будущий core integration + Playwright console tests.

Риск: Обычный user не вызывает management API; manual grants audit; owner singleton защищён. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: после выполнения. Evidence: .

## QUB-AUTH-001 — Приёмка Owner Console/Docs-only/mock AI

Модуль: owner; P0; статус backlog; architecture approved: false. Зависимости: QUB-AUTH-004.

Причина: Проверить целостный owner→Docs-only→mock cap→revoke сценарий до полезных платных функций.

Файлы/контракты: `docs/reports/QUB-AUTH-001.md (будущий)`, `tests/e2e/owner-flow (будущий)`.

Acceptance:

- Все 10 access policy случаев включая exhausted mock cap
- Реальный UI принят owner; paid endpoint provider calls не выполнялись

Проверка: Будущий owner E2E+negative integration matrix.

Риск: Обычный user не вызывает management API; manual grants audit; owner singleton защищён. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: после выполнения. Evidence: .

## QUB-DOC-001 — Typed note/revision API и local durable draft

Модуль: docs; P1; статус backlog; architecture approved: false. Зависимости: QUB-AUTH-001.

Причина: Первый ручной полезный документ требует typed ownership и durable local draft.

Файлы/контракты: `core/qubite/docs (будущий)`, `apps/web/docs/local (будущий)`.

Acceptance:

- Создать/открыть note с AST/revision; server ACL и local atomic persist
- Reload/kill не теряет draft; чужой doc denied

Проверка: Будущие docs API integration + local-store unit tests.

Риск: Durable draft/private attachment не теряются и не доступны чужому subject. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: после выполнения. Evidence: .

## QUB-SYNC-001 — Idempotent push/pull и конфликт двух устройств

Модуль: sync; P1; статус backlog; architecture approved: false. Зависимости: QUB-DOC-001.

Причина: Offline edits не должны теряться/дублироваться на повторе и двух устройствах.

Файлы/контракты: `core/qubite/sync (будущий)`, `apps/web/sync (будущий)`.

Acceptance:

- Retry не дублирует, 409 сохраняет варианты, tombstones
- Offline/reconnect/revoke/expired cursor scenarios

Проверка: Будущий two-device offline Playwright + sync pytest.

Риск: Revoke/expired cursor/конфликт не удаляет собственный draft; tombstones не GC преждевременно. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: после выполнения. Evidence: .

## QUB-SEARCH-001 — Связь note/project и ACL keyword search

Модуль: knowledge; P1; статус backlog; architecture approved: false. Зависимости: QUB-SYNC-001.

Причина: Связанный граф и поиск нужны первому срезу, но могут раскрыть private titles/edges.

Файлы/контракты: `core/qubite/objects/relations (будущий)`, `core/qubite/knowledge (будущий)`.

Acceptance:

- Note linked to project found via Command
- Cross-scope title/snippet/count/edges не раскрываются

Проверка: Будущий ACL search/graph pytest + Command E2E.

Риск: Title/snippet/count/edge/derived index leaks и stale authorization. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: после выполнения. Evidence: .

## QUB-HISTORY-001 — Diff и restore в новую revision

Модуль: history; P1; статус backlog; architecture approved: false. Зависимости: QUB-SEARCH-001.

Причина: Пользователь должен сравнить и восстановить заметку без потери последующих edits.

Файлы/контракты: `core/qubite/history (будущий)`, `apps/web/history (будущий)`.

Acceptance:

- Две revision compare/restore; новый edit не перетёрт
- Roundtrip export/restore и author audit

Проверка: Будущий history API+restore concurrency+Playwright vertical slice.

Риск: Restore не перезаписывает новые edits; external action нельзя отменить DB rollback. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: после выполнения. Evidence: .

## QUB-INK-001 — Hardware input probe и benchmark plan

Модуль: ink; P0; статус backlog; architecture approved: false. Зависимости: нет.

Причина: Аппаратный input/latency риск нельзя решить документацией или web-only прототипом; устройство владельца Lenovo Xiaoxin Pad 2025, точный model ID/перо не проверены.

Файлы/контракты: `clients/android-ink/probe (будущий)`, `docs/reports/INK-HARDWARE.md (будущий)`.

Acceptance:

- Модель устройства/pressure/tilt/sample/frame/latency реальные
- APK и safe kill/autosave, no cloud calls; ощущения подтверждает owner

Проверка: Будущий Gradle test/lint/assembleDebug + реальный планшет.

Риск: Не обещать pressure/tilt без измерения; pen crash/recovery/latency и sensitive образцы. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: после выполнения. Evidence: .

## QUB-TOUR-001 — Scoped role compatibility adapter

Модуль: tournaments; P1; статус backlog; architecture approved: false. Зависимости: QUB-AUTH-001, QUB-TEST-002, QUB-OPS-002.

Причина: Изолировать роли/навигацию турниров при полном сохранении результатов и старых URL.

Файлы/контракты: `core/qubite/integrations/tournaments (будущий)`, `back/server.js (точечно после approval)`.

Acceptance:

- Старые URLs/results/team roles сохранены, API alias tested
- Tournaments отдельная navigation, no global admin elevation
- Сохранить Node/SQLite и старый Vanilla UI; React только outer module entry/status, не перепись tournament UI

Проверка: verify.py --suite all + tournament E2E + policy diff.

Риск: Сохранить roster/codes/team/results/rating; не допустить глобальной эскалации. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: после выполнения. Evidence: .

## QUB-INT-001 — Service/Shade connector contract POC

Модуль: integrations; P2; статус backlog; architecture approved: false. Зависимости: QUB-AUTH-001.

Причина: Контракт внешних сервисов и локального Shade должен ограничивать действия/credentials до подключения.

Файлы/контракты: `contracts/connectors-v1.json (будущий)`, `docs/architecture/SHADEAI_INTEGRATION.md`.

Acceptance:

- Source contracts Search/Writer/Shade mocks status+allowlist
- Revoke/unknown outcome, no Shade writes/real HA/network calls

Проверка: Будущий connector fixture pytest; verify.py --suite all.

Риск: Не вызвать HA/TG/paid API, не читать домашние сессии; unknown sends не повторять. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: после выполнения. Evidence: .

## QUB-DESIGN-001 — Поток: компонентная дизайн-система и мобильный material UX

Модуль: design; P0; статус done; architecture approved: true. Зависимости: QUB-001.

Причина: Владелец выбрал Milo → Flux, попросил плавность на телефоне, selectable palettes/fonts/logo families и refined companions; final IA отдельно..

Файлы/контракты: `assets/design-lab/`, `docs/design/DESIGN_SYSTEM_PLAN.md`, `docs/design/AUTH_UX.md`, `docs/design/MATERIAL_DIRECTIONS.md`, `docs/reports/QUB-DESIGN-001.md`, `docs/project/`, `docs/plan/`, `README.md`, `docs/README.md`, `AGENTS.md`, `CLAUDE.md`, `.github/workflows/design-lab.yml`, `docs/architecture/decisions/0010-material-lab.md`, `docs/architecture/decisions/README.md`, `docs/design/MILO_MATERIAL_AND_COMPANIONS.md`, `docs/architecture/decisions/0011-milo-live-controls.md`, `docs/design/FLUX_DESIGN_SYSTEM.md`, `docs/architecture/decisions/0012-flux-design-system.md`, `docs/design/COLOR_PLASTIC.md`.

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

Проверка: Проверка docs/links; просмотр макета владельцем; TypeScript/build; браузерные сценарии пяти концепций, мобильный/планшет/desktop, reduced motion/keyboard/действия/отсутствие внешних API; 98 browser tests: old47 + Milo51; drag/cancel/keyboard/slider/switch/tabs/dialog/reduced motion/touch/axe/no storage/RAF settle; Flux browser: actual intermediate click geometry/duration, 2D mobile pill, 25 font combinations, 60 glyphs, 10 palette-theme WCAG matrices, gaze/touch/4× CPU slowdown/quiet.; Plastic: ten kit/theme matrices ×six screens at360px; actual role fills/results/errors and no data loss, chosen defaults, five kits at320/844px; old neutral palettes preserved..

Риск: Дизайн-макет не выдавать за реализованный auth. Откат: Отключить новый flow/route/artifact; сохранить старые данные и writer. Live перенос только по отдельному runbook..

Commit: 9262e3c0c89db7b6343b6ce90c0e62213e515ffa. Evidence: 47/47 Playwright Chromium pass, 20 scenes /5 sizes, 2-theme axe/keyboard/reduced motion; format/build pass; 386/386 existing isolated suites + harness pass, temporary native PG18.6; no live APIs/services; Private static Sites deploy succeeded, source f5fa089bc899db5747b4ebfac40abd7d7afc2073 remote verified; report QUB-DESIGN-001; Initial main 0173d74 pushed; CI Material Lab38289913101 and verification38289913120 success; Владелец подтвердил доступность опубликованного демо, отверг исходное понимание материала; выбрал Milo base, новая mechanics iteration in_progress; Milo 02: 98/98 local Chromium pass (2.2m); final mechanics owner acceptance pending, not done; Итерация2 existing386 regression+harness pass; check53 tasks/46 docs; archive refs SHA96f0457 unchanged verified origin; Milo02 private Sites version2/deployment appgdep_6acd3047a53c8191bcde1e643dfe55be succeeded19:09:35UTC; source5c6fd389cf432cab56fd8fa7f57c698704cab707 pushed/verified; archive transfer403, remote build fallback; Milo02 main 2b10ba365f6035bdfb92cdbd34e56a6829095c5c pushed; remote main exact SHA verified; CI38295994465/38295994336 completed/success for exact implementation SHA; 13.10.2026: владелец выбрал Поток/Flux; разрешена итерация 3: mobile motion, пять палитр, независимые heading/body fonts, пять семейств знаков всех существующих сервисов и refined companions; только assets/design-lab и docs, acceptance после выбора владельца.; 13.10.2026 Flux03:120/120 browser pass187.9s; final optical Flux22/22 pass57.4s; existing386/harness pass; default fonts4, no APIs/storage; owner palette/type/marks/physical acceptance pending.; 13.10.2026 private Sites version3 published/source c12223d37f0fa3135b742243b8e64def43dc485a remote/version verified; deployment appgdep_6acd40ebec8881918310f4218d8ed1b9 succeeded; local archive uploaded; root-source0 mismatch.; Flux03 main 74ad2efcae25b52e04b59cab148e8317b0a735aa pushed; git ls-remote exact SHA verified; CI Material Lab38303757824/verification38303758010 completed/success for exact implementation SHA; origin archive refs96f0457 unchanged.; Iteration04 authorized by owner screenshots: Ribbon/Unbounded/Manrope confirmed, rhythm100/503; previous palette rejected, five semantic plastic kits requested. Final133/133 browser pass238.6s/no retries/skips/flaky; existing386/harness pass, combined519. Palette/physical acceptance pending.; Plastic04 private Sites version4/source8e8aba31a64452344ed82764ca76a92f7ca0d075 pushed/remote/version verified; root-source0 mismatch; deployment appgdep_6acd9fa05db08191b83a91968a2a70e6 succeeded13.10.2026 03:04:14UTC; exact source archive uploaded, private audience preserved.; Plastic04 main9262e3c0c89db7b6343b6ce90c0e62213e515ffa pushed; remote exact SHA verified. Owner viewed version4 and explicitly selected Игрушечная: DESIGN-001 done. Toy was already published default; acceptance changes documentation only.; GitHub Actions Material Lab38340403176 and Qubite verification38340403192 completed/success for exact implementation SHA9262e3c0c89db7b6343b6ce90c0e62213e515ffa; origin archive branch/tag96f0457 unchanged, verified together with main..

## QUB-AUTH-005 — Account login без code-entry в новом API

Модуль: identity; P0; статус backlog; architecture approved: false. Зависимости: QUB-AUTH-009, QUB-TEST-001.

Причина: Новый login не принимает старые account access codes; tournament join и email verification отдельные.

Файлы/контракты: `core/qubite/identity (будущий)`, `contracts/auth-v1.json (будущий)`, `docs/architecture/AUTH_AND_PERMISSIONS.md`.

Acceptance:

- В новой Auth surface отсутствуют code-entry/account session grant routes; known legacy routes rejected
- Tournament join codes/invites/email/reset/2FA challenges не удалены или смешаны с password login

Проверка: Isolated auth HTTP negative+positive matrix; tournament code join regression.

Риск: Не смешать authentication code-entry с турнирным join/verification. Откат: Снять новый route/artifact, сохранить PostgreSQL accounts/credentials/new writes. Не restore старые SQLite пароли/сессии поверх новой identity; deploy отдельно..

Commit: после выполнения. Evidence: .

## QUB-AUTH-006 — Минимальная FastAPI регистрация без legacy alias

Модуль: identity; P0; статус backlog; architecture approved: false. Зависимости: QUB-AUTH-009, QUB-DESIGN-001.

Причина: Снять обязательные турнирные/лишние данные с платформенной регистрации.

Файлы/контракты: `core/qubite/identity/registration (будущий)`, `contracts/registration-v1.json (будущий)`.

Acceptance:

- Email/password/согласия, display name optional; без обязательного login alias/ФИО/школы/класса
- Invite/manual default, public отдельно; no module/model grant из регистрации
- PG uniqueness/validation/consent version/verification; fresh identity без импорта старых DTO

Проверка: Register/login/reset/OAuth linking roundtrip; alias collision and old native clients tests.

Риск: Register/login/reset/OAuth linking roundtrip; canonical email collision, invite misuse и default-deny; legacy alias не создаётся. Откат: Снять новый route/artifact, сохранить PostgreSQL accounts/credentials/new writes. Не restore старые SQLite пароли/сессии поверх новой identity; deploy отдельно..

Commit: после выполнения. Evidence: .

## QUB-AUTH-007 — Новые React auth экраны поверх FastAPI Auth

Модуль: ui; P0; статус backlog; architecture approved: false. Зависимости: QUB-UI-001, QUB-AUTH-005, QUB-AUTH-006, QUB-AUTH-010, QUB-AUTH-011.

Причина: Новый Python identity backend и React дизайн, legacy обслуживает только неперенесённые consumers.

Файлы/контракты: `apps/web/auth (будущий)`, `docs/design/AUTH_UX.md (будущий)`.

Acceptance:

- Новая тема/формы email/password/OAuth/reset без account code-entry
- FastAPI Auth, безопасные cookies/CSRF/return target, fresh core session/status/revoke; единый вход сервиса, без legacy verifier
- Web+desktop navigation/keyboard/mobile и реальная UX приёмка

Проверка: Playwright login/register/reset/revoke; no secret logging; screenshots.

Риск: Open redirect/token storage/две расходящиеся реализации. Откат: Снять новый route/artifact, сохранить PostgreSQL accounts/credentials/new writes. Не restore старые SQLite пароли/сессии поверх новой identity; deploy отдельно..

Commit: после выполнения. Evidence: .

## QUB-AUTH-008 — Единый вход Qubite: fresh-install контракт FastAPI/Postgres

Модуль: identity; P0; статус done; architecture approved: true. Зависимости: QUB-CORE-001, QUB-TEST-001.

Причина: После уточнения владельца13.10.2026 нет аккаунтов для переноса и текущего деплоя; спроектировать один вход для всех новых сервисов.

Файлы/контракты: `docs/migration/IDENTITY_CUTOVER.md`, `contracts/identity-v2.json`, `contracts/identity-vectors.json`, `tests/identity/`, `scripts/engineering/verify.py`, `docs/architecture/`, `docs/project/`, `docs/plan/`, `docs/engineering/TEST_STRATEGY.md`, `docs/reports/QUB-AUTH-008.md`, `README.md`, `docs/README.md`, `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `TODO.md`, `scripts/engineering/check.py`, `docs/engineering/DEPLOYMENT_AND_BACKUPS.md`, `docs/engineering/AGENT_HARNESS.md`, `docs/design/AUTH_UX.md`.

Acceptance:

- Полная карта legacy потребителей и целевого единого Auth: Web/Search/Writing/VPN/native/API/Tournaments/TG/upstream connectors
- Fresh Postgres UUID subject/owner bootstrap, единые session/revoke/API boundaries; без legacy password/session/import/bridge
- Машинный контракт новых endpoint/принципала/scopes и synthetic межъязыковые token/PKCE vectors/negative cases
- AUTH-L01..03 остаются negative requirements: malformed credentials/OAuth kill switch/no email-only linking
- Только контракт/план/проверки; runtime Auth и новые UI не выдавать за реализованные; пользователь разрешил менять потребителей в следующих срезах

Проверка: pytest tests/identity: synthetic SHA256/PKCE Python+Node, contract/session/security negative matrix; isolated --suite identity/all; check.py.

Риск: SSO/refresh breakage; legacy owner bypass не наследовать. Откат: Сохранить архив96f0457 и локальные старые артефакты; fresh core изолирован. При будущих изменениях включать новый сервис после tests, при откате не восстанавливать старый snapshot поверх новых записей..

Commit: a48685c5a68cf8ca8973d6561f44b491157a9f1a. Evidence: 12.10.2026: ранее согласованный specification scope, dependencies CORE-001/TEST-001 done; ready без начала реализации/live writes.; 13.10.2026 владелец прямо подтвердил: существующих аккаунтов нет, прежнего owner можно создать заново, проект нигде не запущен/деплоя нет. Разрешил единый новый вход/API и изменения Search/остальных сервисов. Старые сведения о live migration заменяются ADR-0013; данные/секреты не удаляются по одному этому сообщению.; 13.10.2026: targeted identity32 pass; isolated verify.py all414 pass (Node94/deploy18/Search95/Brief112/Kwork29/SiYuan5/identity32/core29) + harness4 =418; no failed/skipped; PG18.6 disposable. check.py/link/source trace/diff checks pass. Protocol oracle specification only; runtime Auth not implemented. CI/implementation SHA recording follows push.; Implementation a48685c5a68cf8ca8973d6561f44b491157a9f1a pushed/remote verified; Qubite verification38344387215 completed/success13.10.2026 04:01:52UTC, exact headSha confirmed. CI Python3.14.8/PostgreSQL16.15: all414+harness4 =418 pass; no failed/skipped. Archive refs96f0457 unchanged. Final docs/evidence/source links checked separately; no runtime Auth or deploy..

## QUB-DEPLOY-001 — Specification нового deploy/qubite2 и installer modes

Модуль: ops; P0; статус ready; architecture approved: true. Зависимости: QUB-001.

Причина: Владелец потребовал deploy папку и скрипт установки нового Qubite.

Файлы/контракты: `deploy/qubite2/README.md (будущий)`, `docs/engineering/DEPLOYMENT_AND_BACKUPS.md`.

Acceptance:

- Выбрать/обосновать server OS и packaging POC, manifest services/ports/data/env
- Отдельные fresh/upgrade/dry-run/rollback/backup/restore, explicit secrets input
- Legacy deploy/install.sh сохраняется; нет autodeploy; VPS hostname отложен

Проверка: Manifest validation; synthetic install/upgrade acceptance matrix.

Риск: Не подменять рабочий installer или секреты; не делать production deployment. Откат: Отключить новый flow/route/artifact; сохранить старые данные и writer. Live перенос только по отдельному runbook..

Commit: после выполнения. Evidence: .

## QUB-DEPLOY-002 — Installer fresh-install dry-run в disposable окружении

Модуль: ops; P0; статус backlog; architecture approved: false. Зависимости: QUB-DEPLOY-001, QUB-CORE-001.

Причина: Подготовить работающий installer постепенно без live доступа.

Файлы/контракты: `deploy/qubite2/install.sh (будущий)`, `deploy/qubite2/env.example (будущий)`, `deploy/qubite2/tests (будущий)`.

Acceptance:

- Idempotent fresh install, dry-run/preflight/dependency checks; refuse existing dirty/data paths
- Pin versions/SHA, secret permissions, health и redacted report
- Upgrade/rollback не выдавать за готовые пока нет отдельного tested slice; legacy unit/env не меняются

Проверка: Disposable container/VM install twice, interrupted install, existing-data refusal, no real credentials.

Риск: Не считать контейнерные mocks доказательством production совместимости. Откат: Отключить новый flow/route/artifact; сохранить старые данные и writer. Live перенос только по отдельному runbook..

Commit: после выполнения. Evidence: .

## QUB-DESKTOP-001 — Tauri Linux POC и portable OS adapter boundary

Модуль: desktop; P1; статус backlog; architecture approved: false. Зависимости: QUB-UI-001, QUB-AUTH-007, QUB-AUTH-012.

Причина: Desktop Linux обязателен, последующие OS без переписывания продукта.

Файлы/контракты: `clients/desktop (будущий)`, `contracts/client-capabilities-v1.json (будущий)`.

Acceptance:

- Общий React UI и Linux artifact; restricted native commands, secure session and local drafts
- Offline/restart/logout/auth deep-link tests; platform paths/dialog adapters
- Windows/macOS build+sign roadmap, не заявлять их проверенными

Проверка: Linux build+smoke; webview/keyboard/offline checks; desktop capability negative tests.

Риск: WebView differences/native privileges; Windows/macOS потребуют своих runners. Откат: Отключить новый flow/route/artifact; сохранить старые данные и writer. Live перенос только по отдельному runbook..

Commit: после выполнения. Evidence: .

## QUB-TG-001 — Bot parity/command specification и mock characterization

Модуль: telegram; P0; статус ready; architecture approved: true. Зависимости: QUB-001.

Причина: Подготовить полный новый bot flow без потери функций и смешения ролей.

Файлы/контракты: `docs/architecture/TELEGRAM_AND_OBSERVABILITY.md`, `contracts/telegram-commands-v1.json (будущий)`, `back/tests/telegram-parity.test.js (будущий)`.

Acceptance:

- TG-1..6 ответы записаны; каждую legacy функцию map keep/module/retire с обоснованием
- Owner/platform/support/tournament capabilities и callbacks/TTL/action matrix
- Synthetic handlers tests без сети/токена; period and scope mismatches зафиксированы

Проверка: Mock update/send transport tests; check.py.

Риск: Не потерять legacy capabilities/history; не наследовать global moderator; без real bot credentials/send/production writes. Откат: Отключить новый adapter/route/worker, сохранить источник и mappings; один consumer, не стирать новые записи..

Commit: после выполнения. Evidence: TG-1..6 ответы 12.10.2026, ADR-0007.

## QUB-TG-002 — Новый control worker read-only status/menu POC

Модуль: telegram; P0; статус backlog; architecture approved: false. Зависимости: QUB-TG-001, QUB-AUTH-003.

Причина: Первый bounded новый бот slice до management mutations.

Файлы/контракты: `core/qubite/telegram (будущий)`, `contracts/telegram-commands-v1.json (будущий)`.

Acceptance:

- Python worker с общими policy API, platform subject linking и owner private menu
- Статусы/сводки/deep links; no mutations/real sends в POC
- Tampered/unlinked/revoked/module moderator → deny; single consumer startup contract
- Существующий bot identity сохраняется; automatic capture реализуется отдельным slice

Проверка: Fixture bot update integration; transport mock; revoke/expiry negative tests.

Риск: Не потерять legacy capabilities/history; не наследовать global moderator; без real bot credentials/send/production writes. Откат: Отключить новый adapter/route/worker, сохранить источник и mappings; один consumer, не стирать новые записи..

Commit: после выполнения. Evidence: .

## QUB-TG-003 — Mutating bot commands и delivery/cutover runbook

Модуль: telegram; P0; статус backlog; architecture approved: false. Зависимости: QUB-TG-002, QUB-AUTH-004, QUB-OBS-001.

Причина: Заменить старый bot management после read-only POC и общего API.

Файлы/контракты: `core/qubite/telegram/commands (будущий)`, `docs/migration/TELEGRAM_CUTOVER.md (будущий)`.

Acceptance:

- Согласованные grants/budgets/module/settings commands, common domain API, confirmation/idempotency
- Exact reply/TTL, unknown delivery/no retry, restart/outbox tests
- План single-consumer cutover + сохранение username/history где применимо; live switch отдельно

Проверка: Mock transport fault injection; command scope parity; no arbitrary shell.

Риск: Не потерять legacy capabilities/history; не наследовать global moderator; без real bot credentials/send/production writes. Откат: Отключить новый adapter/route/worker, сохранить источник и mappings; один consumer, не стирать новые записи..

Commit: после выполнения. Evidence: .

## QUB-OBS-001 — Metrics contract и isolated Infrastructure collector

Модуль: observability; P0; статус backlog; architecture approved: false. Зависимости: QUB-CORE-001.

Причина: Сохранить текущий мониторинг и устранить неверные трактовки показателей.

Файлы/контракты: `core/qubite/observability (будущий)`, `contracts/metrics-v1.json (будущий)`.

Acceptance:

- Отдельные host/cgroup/process/node, loadavg и CPU%, relevant DB/blob volume
- Timestamp/source/reset/stale/missing/retention, requests/traffic scoped process counters
- Согласовать retained history и alerts policy до scheduled notifications

Проверка: Synthetic metric fixtures; counter reset/two-source dedup/units/UTC tests.

Риск: Не потерять legacy capabilities/history; не наследовать global moderator; без real bot credentials/send/production writes. Откат: Отключить новый adapter/route/worker, сохранить источник и mappings; один consumer, не стирать новые записи..

Commit: после выполнения. Evidence: .

## QUB-ANALYTICS-001 — Owner analytics/Infrastructure UI и Tournaments split

Модуль: analytics; P0; статус backlog; architecture approved: true. Зависимости: QUB-OBS-001, QUB-UI-001.

Причина: Перенести все реальные analytics capabilities в правильные scopes.

Файлы/контракты: `apps/web/owner/analytics (будущий)`, `core/qubite/analytics (будущий)`.

Acceptance:

- Global activity/AI costs/server graphs в Console; submissions/teams/rating внутри Tournaments
- Legacy report period contract corrected; missing/stale не ноль; protected texts не aggregates payload
- Owner vs tournament moderator/direct URL/API negative checks, retention и source/history mapping

Проверка: Disposable legacy adapters + Playwright graphs/policy tests; UTC duration regression.

Риск: Не потерять legacy capabilities/history; не наследовать global moderator; без real bot credentials/send/production writes. Откат: Отключить новый adapter/route/worker, сохранить источник и mappings; один consumer, не стирать новые записи..

Commit: после выполнения. Evidence: .

## QUB-SUPPORT-001 — Support scope и Telegram/web conversation adapter POC

Модуль: support; P0; статус backlog; architecture approved: true. Зависимости: QUB-TG-001, QUB-AUTH-003.

Причина: Не потерять поддержку и не отправить ответ неверному собеседнику.

Файлы/контракты: `core/qubite/support (будущий)`, `apps/web/support (будущий)`.

Acceptance:

- FastAPI guest Support, owner и owner-granted support.read/reply/manage отдельно от tournament role
- Chat/source/IDs/history migration map; read/reply/close/reopen common API
- Exact reply/TTL/cross-chat/revoke/outcome tests без реальных сообщений

Проверка: Synthetic conversation API + bot transport tests; history map roundtrip.

Риск: Не потерять legacy capabilities/history; не наследовать global moderator; без real bot credentials/send/production writes. Откат: Отключить новый adapter/route/worker, сохранить источник и mappings; один consumer, не стирать новые записи..

Commit: после выполнения. Evidence: .

## QUB-AUTH-009 — FastAPI password login/logout/session core

Модуль: identity; P0; статус backlog; architecture approved: true. Зависимости: QUB-AUTH-008, QUB-AUTH-002.

Причина: Нужный новой платформе Auth реализовать на Python, не permanent JS adapter.

Файлы/контракты: `core/qubite/identity/auth (будущий)`.

Acceptance:

- Postgres sessions/Argon2id credentials, typed opaque token/hash-only storage, owner password setup и revoke/status/auth_version
- Login/logout/logout-all/revoke/blocked/expiry/CSRF/secure cookie negative cases
- No code-entry, no owner/global-role bypass; реальные пароли не читать в модель
- AUTH-L01: malformed percent cookie не вызывает 500; безопасный credential отказ и server survives

Проверка: Disposable Postgres password/session/CSRF/expiry/concurrency/reauth/blocked/revoke integration; identity-v2 protocol vectors, no old-password compatibility.

Риск: Session fixation/Argon2 DOS/CSRF/account enumeration; bootstrap credentials только локально/без plaintext logging. Откат: Снять новый route/artifact, сохранить PostgreSQL accounts/credentials/new writes. Не restore старые SQLite пароли/сессии поверх новой identity; deploy отдельно..

Commit: после выполнения. Evidence: .

## QUB-AUTH-010 — FastAPI OAuth provider adapter и account linking

Модуль: identity; P0; статус backlog; architecture approved: true. Зависимости: QUB-AUTH-009.

Причина: Сохранить необходимые способы входа в новом Auth.

Файлы/контракты: `core/qubite/identity/oauth (будущий)`.

Acceptance:

- Configured Google/Yandex/VK/Telegram contract с state/PKCE/audience/expiry/unique subject
- No linking чужого account по непроверенной email; provider kill switches
- Только mock transport/local secrets reference, native redirect allowlist
- AUTH-L02: current provider permission recheck в callback до exchange/session для всех providers
- AUTH-L03: email_verified=false/отсутствующий trusted claim не привязывает чужой существующий аккаунт; safe explicit linking + stable provider subject

Проверка: Provider fixture state/PKCE/replay/link collision/unconfigured tests.

Риск: OAuth takeover/open redirect; не реальный провайдерский acceptance. Откат: Снять новый route/artifact, сохранить PostgreSQL accounts/credentials/new writes. Не restore старые SQLite пароли/сессии поверх новой identity; deploy отдельно..

Commit: после выполнения. Evidence: .

## QUB-AUTH-011 — FastAPI verification/password reset/email-2FA contract

Модуль: identity; P0; статус backlog; architecture approved: true. Зависимости: QUB-AUTH-009.

Причина: Не потерять security flows при переносе auth.

Файлы/контракты: `core/qubite/identity/challenges (будущий)`.

Acceptance:

- Одноразовые hashed challenges, TTL/replay/rate caps; reset/revoke/verify flows
- Email transport mock, configured feature behavior, security code не account code-entry
- Новая register/verify policy, proof не назначает owner; owner только явным local bootstrap, existing UUID не меняется

Проверка: Challenge expiry/replay/exhaustion/reset/session revoke tests.

Риск: Mail leak/race/reset takeover. Откат: Снять новый route/artifact, сохранить PostgreSQL accounts/credentials/new writes. Не restore старые SQLite пароли/сессии поверх новой identity; deploy отдельно..

Commit: после выполнения. Evidence: .

## QUB-CORE-002 — FastAPI platform settings и module command controls

Модуль: core; P1; статус backlog; architecture approved: true. Зависимости: QUB-AUTH-003.

Причина: Общие настройки старого Qubite перенести в target core.

Файлы/контракты: `core/qubite/settings (будущий)`, `contracts/settings-v1.json (будущий)`.

Acceptance:

- Platform/Auth controls отдельно от tournament/VPN/module settings
- Typed allowlist settings, version+idempotency+owner policy/audit
- Legacy config source/mapping, no arbitrary key write or bearer bypass URL

Проверка: Settings invalid key/revoke/concurrency/command ACL tests.

Риск: Изменения scopes/kill switches, no implicit service restart. Откат: Отключить новый API/worker/route; сохранить оригинальные данные и новые записи, не допускать dual writer. Live миграция отдельно..

Commit: после выполнения. Evidence: .

## QUB-CAPTURE-001 — Telegram text durable Inbox ingress

Модуль: capture; P1; статус backlog; architecture approved: true. Зависимости: QUB-TG-002, QUB-AUTH-003.

Причина: Быстро сохранить мысль без предварительной категории.

Файлы/контракты: `core/qubite/capture (будущий)`, `contracts/capture-v1.json (будущий)`.

Acceptance:

- Linked user text без меню → durable private CaptureItem, dedup/update fingerprint
- Guest → Support, exact admin/support replies не capture; raw source/provenance сохранён
- ACK только после commit; restart/duplicate/cross-account/deny cases

Проверка: Mock updates + disposable Postgres persist/restart/duplicate tests.

Риск: Потеря исходника/неверный recipient/intercept admin input. Откат: Отключить новый API/worker/route; сохранить оригинальные данные и новые записи, не допускать dual writer. Live миграция отдельно..

Commit: после выполнения. Evidence: .

## QUB-CAPTURE-002 — AI auto classify/format и safe note/task routing

Модуль: capture; P1; статус backlog; architecture approved: true. Зависимости: QUB-CAPTURE-001, QUB-AI-002, QUB-DOC-001.

Причина: AI сам определяет назначение и оформление входящего.

Файлы/контракты: `core/qubite/capture/router (будущий)`.

Acceptance:

- Validated typed output, только available grants/ACL/budgets и текущий scoped context
- Automatic new personal note/task без выбора/лишних confirmations; source + undo/correction/link
- Low confidence/нет бюджета/AI fail → raw Inbox retained, no silent paid retries; ambiguous reminder remains draft

Проверка: Mock provider parse/injection/deny/undo-concurrent/idempotency tests.

Риск: Content injection/cross-scope/duplicate payment/overwriting existing docs. Откат: Отключить новый API/worker/route; сохранить оригинальные данные и новые записи, не допускать dual writer. Live миграция отдельно..

Commit: после выполнения. Evidence: .

## QUB-CAPTURE-003 — Voice durable attachment и существующий STT adapter

Модуль: capture; P1; статус backlog; architecture approved: true. Зависимости: QUB-CAPTURE-001, QUB-AI-002.

Причина: Голосовое так же сохраняется без меню и не теряется при ASR ошибке.

Файлы/контракты: `core/qubite/capture/voice (будущий)`, `contracts/stt-v1.json (будущий)`.

Acceptance:

- Private audio persist + original metadata до saved ACK, media/type/size bounds
- Existing voice/Hermes service adapter, no second Telethon session/polling/own model download
- ASR failure original retained; successful transcript routes via capture pipeline; cancellation/retry bounded

Проверка: Mock Telegram download+STT failure/restart/partial file/ACL/budget tests.

Риск: Untrusted file/SSRF/private voice/billing unknown. Откат: Отключить новый API/worker/route; сохранить оригинальные данные и новые записи, не допускать dual writer. Live миграция отдельно..

Commit: после выполнения. Evidence: .

## QUB-NOTIFY-001 — Unified event/outbox и безопасные app deep links

Модуль: notifications; P1; статус backlog; architecture approved: true. Зависимости: QUB-AUTH-003, QUB-TG-002.

Причина: Уведомления связаны с Qubite событиями и ведут в нужный раздел.

Файлы/контракты: `core/qubite/notifications (будущий)`, `contracts/notification-v1.json (будущий)`.

Acceptance:

- Общие event/resource IDs для Qubite и Telegram; per-channel status и preference
- Owner alerts/scoped recipient, revoke recheck, authenticated web fallback link без secret
- Crash/duplicate/unknown-send/replayed link; no automatic paid retry or false delivered

Проверка: Mock send/outbox restart/idempotency/scope/deep-link tests.

Риск: Private content leak/unknown sends/native deep-link unsafe commands. Откат: Отключить новый API/worker/route; сохранить оригинальные данные и новые записи, не допускать dual writer. Live миграция отдельно..

Commit: после выполнения. Evidence: .

## QUB-NOTIFY-002 — Daily digest schedule и critical alert policies

Модуль: notifications; P1; статус backlog; architecture approved: true. Зависимости: QUB-NOTIFY-001, QUB-ANALYTICS-001.

Причина: Ежедневная сводка и важные уведомления подтверждены владельцем.

Файлы/контракты: `core/qubite/notifications/digest (будущий)`, `apps/web/settings/notifications (будущий)`.

Acceptance:

- Critical deterministic alerts и daily aggregated digest, без обязательного LLM
- Настраиваемые channels/timezone/time/quiet hours; unique recipient+period digest, no restart duplicates
- Preview/test fixtures; реальное расписание и sends не включать в local tests

Проверка: Clock/DST/UTC/missed/revoke/dedup/unknown-delivery fixtures.

Риск: Spam/quiet-hours/неверный scope или повтор уведомления. Откат: Отключить новый API/worker/route; сохранить оригинальные данные и новые записи, не допускать dual writer. Live миграция отдельно..

Commit: после выполнения. Evidence: .

## QUB-SVC-SEARCH-001 — Search parity и FastAPI service API contract

Модуль: search; P1; статус backlog; architecture approved: true. Зависимости: QUB-AUTH-001, QUB-AUTH-014.

Причина: Search собственный сервис новой платформы, не ссылка на старый HTML.

Файлы/контракты: `core/qubite/services/search (будущий)`, `contracts/search-service-v1.json (будущий)`.

Acceptance:

- Матрица search/fetch/history/free-paid/media/keys/log protection/grounding/usage по source
- FastAPI platform adapter к рабочему Search engine, scoped keys и ACL, deny before paid calls
- History/old ciphertext/ledger mapping и no-data-loss routing plan; не internal objects SEARCH-001
- Единый core login/UUID и module-scoped policy; нет нового автономного local login/user store или owner auto-paid; ADR-0013

Проверка: Search adapter fixtures, owner/free/paid/revoked/history/privacy negative tests.

Риск: SSRF/private history/cost double accounting. Откат: Отключить новый client/API route flag, сохранить legacy engines/данные/URL и новые записи; migration/routing switch отдельно после acceptance..

Commit: после выполнения. Evidence: .

## QUB-SVC-SEARCH-002 — React Search интерфейс в новой дизайн-системе

Модуль: search; P1; статус backlog; architecture approved: true. Зависимости: QUB-SVC-SEARCH-001, QUB-UI-001.

Причина: Полностью обновить собственный Search UI.

Файлы/контракты: `apps/web/services/search (будущий)`.

Acceptance:

- Search input/results/history/answer/media/status/permissions новое React UI
- Нет unsafe iframe/HTML; cancellation/new query ordering; mobile/keyboard
- Parity+UX acceptance со старым Search, старый route сохраняется до switch

Проверка: React unit/typecheck/build; Playwright search/media/history/deny/revoke/cancel.

Риск: Stale answer race/private history leakage/media unsafe sources. Откат: Отключить новый client/API route flag, сохранить legacy engines/данные/URL и новые записи; migration/routing switch отдельно после acceptance..

Commit: после выполнения. Evidence: .

## QUB-SVC-WRITING-001 — Writing parity и FastAPI grammar/AI API contract

Модуль: writing; P1; статус backlog; architecture approved: true. Зависимости: QUB-AUTH-001, QUB-AUTH-014.

Причина: Writing engine использовать через целевой API без потери существующих функций.

Файлы/контракты: `core/qubite/services/writing (будущий)`, `contracts/writing-service-v1.json (будущий)`.

Acceptance:

- Separate local check и paid AI actions/grants/keys/budgets
- LanguageTool adapter + shared cost guard, cancel/version/UTF16-compatible offsets
- Firefox addon DTO/key/endpoint compatibility; texts не logs; native highlights bridge сохранён
- Единый core login/UUID и module-scoped policy; нет нового автономного local login/user store или owner auto-paid; ADR-0013

Проверка: Grammar/AI/budget/revoke/UTF16/cancel and addon fixtures.

Риск: Addon breakage/text leaks/UTF16 edits overwrite. Откат: Отключить новый client/API route flag, сохранить legacy engines/данные/URL и новые записи; migration/routing switch отдельно после acceptance..

Commit: после выполнения. Evidence: .

## QUB-SVC-WRITING-002 — React Writing editor с новым UI и highlights

Модуль: writing; P1; статус backlog; architecture approved: true. Зависимости: QUB-SVC-WRITING-001, QUB-UI-001.

Причина: Сервисный editor привести к общему Qubite UX.

Файлы/контракты: `apps/web/services/writing (будущий)`.

Acceptance:

- Новый editor/check/AI-diff/accept/undo interface на React
- Async result не перезаписывает последующие edits; offsets и safe highlight handling
- Draft autosave/keyboard/mobile и parity со старым /writing; addon redesign отдельным slice

Проверка: React build/typecheck; Playwright text edits/cancel/check/AI diff/undo.

Риск: Потеря текста/несовпадение offsets/stale update. Откат: Отключить новый client/API route flag, сохранить legacy engines/данные/URL и новые записи; migration/routing switch отдельно после acceptance..

Commit: после выполнения. Evidence: .

## QUB-SVC-VPN-001 — VPN parity и FastAPI node/subscription API contract

Модуль: vpn; P1; статус backlog; architecture approved: true. Зависимости: QUB-AUTH-001, QUB-AUTH-014, QUB-AUTH-012.

Причина: VPN platform domain на FastAPI с сохранением network engines.

Файлы/контракты: `core/qubite/services/vpn (будущий)`, `contracts/vpn-service-v1.json (будущий)`.

Acceptance:

- Node heartbeat/status/profile/NaiveProxy toggle/subscription/device lifecycle mapping
- Grants отдельно node management, protected credentials и Auth/app compatibility
- Не меняются работающие VPN engines/firewall/SSH/туннель автоматически; stale nodes явные
- Единый core login/UUID и module-scoped policy; нет нового автономного local login/user store или owner auto-paid; ADR-0013

Проверка: Synthetic node/credential/revoke/device/stale/kill-switch fixture tests.

Риск: Потеря connectivity/credential exposure/node authority confusion. Откат: Отключить новый client/API route flag, сохранить legacy engines/данные/URL и новые записи; migration/routing switch отдельно после acceptance..

Commit: после выполнения. Evidence: .

## QUB-SVC-VPN-002 — React VPN workspace и owner node/settings UI

Модуль: vpn; P1; статус backlog; architecture approved: true. Зависимости: QUB-SVC-VPN-001, QUB-UI-001.

Причина: VPN включён в новый React Qubite, не legacy services страница.

Файлы/контракты: `apps/web/services/vpn (будущий)`.

Acceptance:

- Новый React server/device/subscription/settings UI и общий design tokens
- User vs owner node controls, heartbeat/disabled/missing states корректны
- Пароли/tokens не URLs/logs; copy/QR только своих scoped credentials; existing native app работает

Проверка: React build/typecheck; Playwright owner/user/deny/stale/profile flows.

Риск: Leak scoped credentials/UI privilege bypass. Откат: Отключить новый client/API route flag, сохранить legacy engines/данные/URL и новые записи; migration/routing switch отдельно после acceptance..

Commit: после выполнения. Evidence: .

## QUB-UI-002 — Production material слой Milo и сохранённые настройки

Модуль: design; P1; статус backlog; architecture approved: false. Зависимости: QUB-DESIGN-001, QUB-UI-001.

Причина: Уточнение владельца 12.10.2026: живой интерфейс Milo и самостоятельные помощники с разными характерами.

Файлы/контракты: `web/src/ui/material (будущий)`, `docs/design/MILO_MATERIAL_AND_COMPANIONS.md`.

Acceptance:

- Согласованный profile перенесён в controls shell; exact values/native semantic и stable gestures
- Saved strength/quiet preference, OS reduced motion, cancellation/keyboard/focus; unreadable glass отсутствует

Проверка: Playwright pointer/touch/keyboard/cancel/dialog; axe/mobile/reduced motion; legacy regression.

Риск: Характер не расширяет права; no paid calls до guard/приёмки; не терять пользовательские правки. Откат: Выключить feature/companion layer; сохранить записи и drafts; отключить event subscription без изменения legacy..

Commit: после выполнения. Evidence: .

## QUB-PET-001 — Контракт событий, характеров и инициативы четырёх помощников

Модуль: ai; P1; статус backlog; architecture approved: false. Зависимости: QUB-DESIGN-001.

Причина: Уточнение владельца 12.10.2026: живой интерфейс Milo и самостоятельные помощники с разными характерами.

Файлы/контракты: `contracts/companions-v1.json (будущий)`, `docs/design/COMPANION_EVENTS.md (будущий)`.

Acceptance:

- Луми/Кип/Пип/Сэйдж persona table; own error vs user/service error; bounded allowed context
- Owner review initiative/cooldown/dismiss/voice; no focus steal or rights widening
- 13.10.2026 owner: scenarios hidden/edge peek/contextual appearance/dialogue/retreat; placement, safe-area/keyboard, cooldown/event arbitration by screen/persona, manual summon, privacy/accessibility; final conditions discussed during implementation.

Проверка: Contract validation; scenario table owner review; zero provider calls.

Риск: Характер не расширяет права; no paid calls до guard/приёмки; не терять пользовательские правки. Откат: Выключить feature/companion layer; сохранить записи и drafts; отключить event subscription без изменения legacy..

Commit: после выполнения. Evidence: .

## QUB-PET-002 — Scoped помощники в product UI на mock событиях

Модуль: design; P1; статус backlog; architecture approved: false. Зависимости: QUB-PET-001, QUB-UI-002, QUB-DOC-001.

Причина: Уточнение владельца 12.10.2026: живой интерфейс Milo и самостоятельные помощники с разными характерами.

Файлы/контракты: `web/src/companions (будущий)`, `web/tests/companions (будущий)`.

Acceptance:

- Different speech/gestures/context, global hints off/quiet, no interrupt/overlay critical action
- Revision/revoke/dedup/stale response, errors factual, no provider calls or sensitive telemetry
- Edge appearance/retreat from PET-001 contract; no occlusion of controls/keyboard, touch alternative to hover, bounded gestures/cancel, quiet/reduced motion and stale busy completion.

Проверка: Mock event browser tests; cross-scope/privacy/revoke/rapid switch/undo/cancel/accessibility.

Риск: Характер не расширяет права; no paid calls до guard/приёмки; не терять пользовательские правки. Откат: Выключить feature/companion layer; сохранить записи и drafts; отключить event subscription без изменения legacy..

Commit: после выполнения. Evidence: .

## QUB-PET-003 — Dispatcher помощников с budget/policy и mock tools

Модуль: ai; P1; статус backlog; architecture approved: false. Зависимости: QUB-PET-002, QUB-AI-002, QUB-CAPTURE-002.

Причина: Уточнение владельца 12.10.2026: живой интерфейс Milo и самостоятельные помощники с разными характерами.

Файлы/контракты: `core/qubite/companions (будущий)`, `contracts/companions-tools-v1.json (будущий)`.

Acceptance:

- Typed event to scoped dispatcher, grants/models/budget checked; no owner bypass/idle paid polling
- Tool proposal accept/undo, own errors, revoke/stale revision safe; real provider acceptance separately

Проверка: Core disposable DB/mock provider counter, concurrent cap/idempotency/revoke/stale/tool permission matrix.

Риск: Характер не расширяет права; no paid calls до guard/приёмки; не терять пользовательские правки. Откат: Выключить feature/companion layer; сохранить записи и drafts; отключить event subscription без изменения legacy..

Commit: после выполнения. Evidence: .

## QUB-AUTH-012 — Native authorization code/PKCE и rotating device tokens

Модуль: identity; P0; статус backlog; architecture approved: true. Зависимости: QUB-AUTH-009, QUB-AUTH-007.

Причина: Единый новый вход всех клиентов и сервисов по ADR-0013.

Файлы/контракты: `core/qubite/identity/native (будущий)`, `core/tests/test_native_auth.py (будущий)`.

Acceptance:

- Registered first-party clients/exact callback, external browser, state/PKCE S256, code60s single-use; no password grant/static app secret
- Access10min/refresh idle7d absolute30d, hash-only storage, scope intersection/current grants; DB atomic consume+rotation
- Replay/concurrent refresh revokes family/access, client serialized refresh; no bearer in URL; OS secure storage boundary

Проверка: Real disposable PG code/refresh concurrency, client/redirect/PKCE mismatch, replay/scope/revoke/expiry negative tests.

Риск: Credential leakage/privilege escalation; synthetic contract не runtime acceptance. Откат: Отключить новый boundary/route, сохранить новые core данные; no legacy fallback/dual writer. Deploy отдельно..

Commit: после выполнения. Evidence: .

## QUB-AUTH-013 — Scoped API keys расширений и агентов

Модуль: identity; P0; статус backlog; architecture approved: true. Зависимости: QUB-AUTH-009, QUB-AUTH-003.

Причина: Единый новый вход всех клиентов и сервисов по ADR-0013.

Файлы/контракты: `core/qubite/identity/api_keys (будущий)`, `core/tests/test_api_keys.py (будущий)`.

Acceptance:

- Own reauthenticated key creation, one module audience/scopes subset/current grants, explicit expiry<=90d and request cap
- Hash-only at rest, plaintext return once, metadata list/revoke; no wildcard owner/admin bypass
- Search history/read/write и AI отдельно, Writing check/AI отдельно; provider counter0 на deny

Проверка: PG expiry/revoke/own-vs-other keys/role/scope/quota concurrency tests.

Риск: Credential leakage/privilege escalation; synthetic contract не runtime acceptance. Откат: Отключить новый boundary/route, сохранить новые core данные; no legacy fallback/dual writer. Deploy отдельно..

Commit: после выполнения. Evidence: .

## QUB-AUTH-014 — Private core introspection для отдельных service engines

Модуль: identity; P0; статус backlog; architecture approved: true. Зависимости: QUB-AUTH-009, QUB-AUTH-003, QUB-AUTH-013.

Причина: Единый новый вход всех клиентов и сервисов по ADR-0013.

Файлы/контракты: `core/qubite/identity/introspection (будущий)`, `core/tests/test_introspection.py (будущий)`.

Acceptance:

- Private per-service auth bound audience, POST opaque credentials, strict identity-v2 reply, no forwarded user/owner trust
- Active/current auth_version/policy_version/status/scopes, no positive stale cache, timeout/unavailable fail-closed
- Private route/engine ports excluded from public ingress, module/object/budget gates separate from principal

Проверка: Local HTTP strict schema/service audience/blocked/revoke/timeout/forged headers plus ingress contract checks.

Риск: Credential leakage/privilege escalation; synthetic contract не runtime acceptance. Откат: Отключить новый boundary/route, сохранить новые core данные; no legacy fallback/dual writer. Deploy отдельно..

Commit: после выполнения. Evidence: .

## Принятые UI решения и текущий шаг

DESIGN-001 done: Поток/Игрушечная/Лента/Unbounded/Manrope, ритм100/503. PET-001/002 сохраняют hidden/edge peek/contextual appearance/dialogue/retreat; placement выбирается при реализации screens. Prototype scripted, реальные agents отсутствуют. [Flux](../design/FLUX_DESIGN_SYSTEM.md), [Color Plastic](../design/COLOR_PLASTIC.md).

AUTH-008 done: контракт/план/protocol fixtures/418 checks/CI success; затем AUTH-002 PG accounts/local owner bootstrap и AUTH-009 usable password/login. No old passwords/sessions/legacy alias. Native AUTH-012, scoped keys AUTH-013 и private introspection AUTH-014 отделены от login slice и обязательны своим consumers. UI-001 ждёт policy/Auth/design; services ждут соответствующих API gates.
