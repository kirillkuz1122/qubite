# Карточки небольших задач

Источник состояния — [tasks.json](tasks.json). Shared APIs FastAPI/Postgres; собственные included service UI React/new design; Tournaments legacy Node/SQLite/Vanilla. Только ready задачи для bounded cycle; live migration/deploy отдельно. Первая реализация QUB-TEST-001.

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

## QUB-AUTH-002 — Stable subject mapping и временный legacy compatibility protocol

Модуль: identity; P0; статус backlog; architecture approved: false. Зависимости: QUB-CORE-001, QUB-TEST-001.

Причина: Сохранить авторизацию существующих сервисов и однозначное соответствие субъектов.

Файлы/контракты: `core/qubite/identity (будущий)`, `contracts/identity-v1.json (будущий)`.

Acceptance:

- Session introspection audience/status/revoke fail-closed
- Mapping stable, roles не platform privileges, owner verified
- Новый identity target FastAPI/Postgres; legacy bridge только до consumer cutover, не permanent authority

Проверка: Будущий core pytest identity + auth compatibility suite.

Риск: Не читать пароли в модель; blocked/revoked/OAuth subject не превращается в owner; sessions не теряются. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change.

Commit: после выполнения. Evidence: .

## QUB-AUTH-003 — Module entitlements и scoped policy gate

Модуль: policy; P0; статус backlog; architecture approved: false. Зависимости: QUB-AUTH-002.

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

Модуль: ui; P0; статус backlog; architecture approved: false. Зависимости: QUB-AUTH-003, QUB-DESIGN-001.

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

## QUB-DESIGN-001 — Новый visual direction и auth UX specification

Модуль: design; P0; статус review/testing; architecture approved для scope: true. Финальный стиль ещё не выбран. Зависимости: QUB-001.

Причина: прямой запрос владельца 12.10.2026 — пять оригинальных живых React-концепций и ссылка для телефона.

Файлы/контракты: `assets/design-lab/`, `docs/design/DESIGN_SYSTEM_PLAN.md`, `docs/design/AUTH_UX.md`, `docs/design/MATERIAL_DIRECTIONS.md`, `docs/reports/QUB-DESIGN-001.md`, `docs/project/`, `docs/plan/`, `README.md`, `docs/README.md`, `AGENTS.md`, `CLAUDE.md`, `.github/workflows/design-lab.yml`, `docs/architecture/decisions/0010-material-lab.md`, `docs/architecture/decisions/README.md`.

Acceptance:

- Новые tokens/layout и reviewable макет login/register/reset, не копировать старую тему
- Email/password/согласия; display name optional; нет code-entry/турнирных полей
- Responsive/keyboard/error/OAuth/loading/denied states, owner review перед UI реализацией
- Пять самостоятельных React/TS концепций с разными материалами, анимациями, landing/workspace/auth и responsive preview; прямой запрос владельца 12.10.2026
- Опубликованное отдельное демо для просмотра с телефона; финальный стиль остаётся на owner review

Проверка: 47/47 browser tests + 386/386 existing regression; TypeScript/build/format/docs/links. Owner choice и реальный телефон pending.

Риск: прототип не реализует Auth/API/VPN/AI; роль и гранты синтетические. Откат: не использовать отдельный prototype/site, legacy остаётся самостоятельным.

Commit: implementation evidence в [отчёте](../reports/QUB-DESIGN-001.md), registry/handoff обновляются после push. [Демо](https://qubite-material-lab-kirill.kuzmichevkonstantin9.chatgpt.site) private.

## QUB-AUTH-005 — Отключение account code-entry после compatibility audit

Модуль: identity; P0; статус backlog; architecture approved: false. Зависимости: QUB-AUTH-009, QUB-TEST-001.

Причина: Убрать старый вход по коду по прямому указанию владельца.

Файлы/контракты: `core/qubite/identity (будущий)`, `contracts/auth-v1.json (будущий)`, `docs/architecture/AUTH_AND_PERMISSIONS.md`.

Acceptance:

- Карта потребителей inspect/code-entry и прежних аккаунтов
- Новый FastAPI Auth не реализует account code-entry; сохранены tournament join codes/email verify/2FA/reset
- Данные аккаунтов/результатов не удалены, OAuth/password/старые сервисы работают

Проверка: Isolated auth HTTP negative+positive matrix; tournament code join regression.

Риск: Не смешать authentication code-entry с турнирным join/verification. Откат: Отключить новый flow/route/artifact; сохранить старые данные и writer. Live перенос только по отдельному runbook..

Commit: после выполнения. Evidence: .

## QUB-AUTH-006 — Минимальная FastAPI регистрация и legacy alias compatibility

Модуль: identity; P0; статус backlog; architecture approved: false. Зависимости: QUB-AUTH-009, QUB-DESIGN-001.

Причина: Снять обязательные турнирные/лишние данные с платформенной регистрации.

Файлы/контракты: `core/qubite/identity/registration (будущий)`, `contracts/registration-v1.json (будущий)`.

Acceptance:

- Email/password+согласия, старые аккаунты сохраняются
- Внутренний alias стабилен/уникален и не обязателен в форме; optional display name после входа
- Не требуются school/class/ФИО; invite policy/verification/reset/duplicate guards работают

Проверка: Register/login/reset/OAuth linking roundtrip; alias collision and old native clients tests.

Риск: Старые native clients/username collisions; не удалять профильные данные. Откат: Отключить новый flow/route/artifact; сохранить старые данные и writer. Live перенос только по отдельному runbook..

Commit: после выполнения. Evidence: .

## QUB-AUTH-007 — Новые React auth экраны поверх FastAPI Auth

Модуль: ui; P0; статус backlog; architecture approved: false. Зависимости: QUB-UI-001, QUB-AUTH-005, QUB-AUTH-006, QUB-AUTH-010, QUB-AUTH-011.

Причина: Новый Python identity backend и React дизайн, legacy обслуживает только неперенесённые consumers.

Файлы/контракты: `apps/web/auth (будущий)`, `docs/design/AUTH_UX.md (будущий)`.

Acceptance:

- Новая тема/формы email/password/OAuth/reset без account code-entry
- FastAPI Auth, безопасные cookies/CSRF/return target, verifier/session compatibility; live cutover отдельно
- Web+desktop navigation/keyboard/mobile и реальная UX приёмка

Проверка: Playwright login/register/reset/revoke; no secret logging; screenshots.

Риск: Open redirect/token storage/две расходящиеся реализации. Откат: Отключить новый flow/route/artifact; сохранить старые данные и writer. Live перенос только по отдельному runbook..

Commit: после выполнения. Evidence: .

## QUB-AUTH-008 — Identity cutover specification в Python/Postgres

Модуль: identity; P0; статус ready; architecture approved: true. Зависимости: QUB-CORE-001, QUB-TEST-001.

Причина: Перенести identity в целевой стек без одновременного удаления старого Auth.

Файлы/контракты: `docs/migration/IDENTITY_CUTOVER.md (будущий)`, `contracts/identity-v2.json (будущий)`.

Acceptance:

- Полная карта потребителей cookie/OAuth/password/native clients с source/target authority
- Verifier test vectors, UUID/owner mapping, staged session/revoke plan и reconciliation
- Live cutover отдельной задачей после OPS-002 и approval; в этой задаче нет live writes
- AUTH-L01..03 из QUB-TEST-001: дефекты не считать compatibility; unverified email linking P0 gate до identity cutover

Проверка: Synthetic cross-runtime vectors; contract/migration rehearsal план.

Риск: SSO/refresh breakage; legacy owner bypass не наследовать. Откат: Отключить новый flow/route/artifact; сохранить старые данные и writer. Live перенос только по отдельному runbook..

Commit: после выполнения. Evidence: 12.10.2026: ранее согласованный specification scope, dependencies CORE-001/TEST-001 done; ready без начала реализации/live writes..

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

Модуль: desktop; P1; статус backlog; architecture approved: false. Зависимости: QUB-UI-001, QUB-AUTH-007.

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

- Postgres sessions/credentials, hash-only tokens, isolated verifier compatibility vectors
- Login/logout/logout-all/revoke/blocked/expiry/CSRF/secure cookie negative cases
- No code-entry, no owner/global-role bypass; реальные пароли не читать в модель
- AUTH-L01: malformed percent cookie не вызывает 500; безопасный credential отказ и server survives

Проверка: Disposable Postgres auth integration; old verifier synthetic cross-runtime vectors.

Риск: Session fixation/пароли/legacy consumer breakage. Откат: Отключить новый API/worker/route; сохранить оригинальные данные и новые записи, не допускать dual writer. Live миграция отдельно..

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

Риск: OAuth takeover/open redirect; не реальный провайдерский acceptance. Откат: Отключить новый API/worker/route; сохранить оригинальные данные и новые записи, не допускать dual writer. Live миграция отдельно..

Commit: после выполнения. Evidence: .

## QUB-AUTH-011 — FastAPI verification/password reset/email-2FA contract

Модуль: identity; P0; статус backlog; architecture approved: true. Зависимости: QUB-AUTH-009.

Причина: Не потерять security flows при переносе auth.

Файлы/контракты: `core/qubite/identity/challenges (будущий)`.

Acceptance:

- Одноразовые hashed challenges, TTL/replay/rate caps; reset/revoke/verify flows
- Email transport mock, configured feature behavior, security code не account code-entry
- Согласованный register/verify owner bootstrap mapping, no arbitrary owner promotion

Проверка: Challenge expiry/replay/exhaustion/reset/session revoke tests.

Риск: Mail leak/race/reset takeover. Откат: Отключить новый API/worker/route; сохранить оригинальные данные и новые записи, не допускать dual writer. Live миграция отдельно..

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

Модуль: search; P1; статус backlog; architecture approved: true. Зависимости: QUB-AUTH-001.

Причина: Search собственный сервис новой платформы, не ссылка на старый HTML.

Файлы/контракты: `core/qubite/services/search (будущий)`, `contracts/search-service-v1.json (будущий)`.

Acceptance:

- Матрица search/fetch/history/free-paid/media/keys/log protection/grounding/usage по source
- FastAPI platform adapter к рабочему Search engine, scoped keys и ACL, deny before paid calls
- History/old ciphertext/ledger mapping и no-data-loss routing plan; не internal objects SEARCH-001

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

Модуль: writing; P1; статус backlog; architecture approved: true. Зависимости: QUB-AUTH-001.

Причина: Writing engine использовать через целевой API без потери существующих функций.

Файлы/контракты: `core/qubite/services/writing (будущий)`, `contracts/writing-service-v1.json (будущий)`.

Acceptance:

- Separate local check и paid AI actions/grants/keys/budgets
- LanguageTool adapter + shared cost guard, cancel/version/UTF16-compatible offsets
- Firefox addon DTO/key/endpoint compatibility; texts не logs; native highlights bridge сохранён

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

Модуль: vpn; P1; статус backlog; architecture approved: true. Зависимости: QUB-AUTH-001.

Причина: VPN platform domain на FastAPI с сохранением network engines.

Файлы/контракты: `core/qubite/services/vpn (будущий)`, `contracts/vpn-service-v1.json (будущий)`.

Acceptance:

- Node heartbeat/status/profile/NaiveProxy toggle/subscription/device lifecycle mapping
- Grants отдельно node management, protected credentials и Auth/app compatibility
- Не меняются работающие VPN engines/firewall/SSH/туннель автоматически; stale nodes явные

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
