# Исполнимые задачи

Источник статусов — [tasks.json](tasks.json). Названия future paths/commands обозначены явно: их сейчас нет. Статусы backlog → ready → in_progress → review/testing → done, также blocked. QUB-001 review/testing до архитектурного обсуждения; product implementation ready отсутствуют. QUB-AUTH-001 — acceptance umbrella, реальные небольшие реализации AUTH-002/003/004, AI-001/002.

## QUB-001 — Аудит и архитектурный baseline

Модуль: core; P0; статус review/testing. Зависимости: нет.

Причина: Зафиксировать фактический legacy, целевые требования и границы согласования до изменения runtime.

Файлы/контракты: `docs/architecture`, `docs/product`, `scripts/engineering`.

Acceptance:

- Архивные refs проверены; инвентари, требования/ADR/план и безопасный harness подготовлены
- Пользователь выбирает архитектуру, отчёт различает code/docs/server/proposal

Проверка: python3 scripts/engineering/check.py.

Риск: Новый процесс не открывает legacy writable DB; изолированная schema миграция; capacity перед деплоем. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-OPS-001 — Read-only production inventory и drift

Модуль: ops; P0; статус backlog. Зависимости: нет.

Причина: Репозиторий не доказывает текущую версию/ресурсы production; исключить overwrite drift и скрытый autodeploy.

Файлы/контракты: `docs/reports/PRODUCTION_INVENTORY.md`.

Acceptance:

- SHA/dirty paths/units/routes/data sizes и RAM/swap/disk собраны без секретов
- Autodeploy и один polling проверены; никаких restart/write

Проверка: Проверка redacted manifest; сравнение с INVENTORY.json.

Риск: Не раскрыть private configs; restore не посылает outbox и не перезаписывает production. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-OPS-002 — Backup manifest и disposable restore

Модуль: ops; P0; статус backlog. Зависимости: QUB-OPS-001.

Причина: Git не хранит рабочие БД/attachments/keys; восстановление должно быть доказано до миграций.

Файлы/контракты: `docs/engineering/DEPLOYMENT_AND_BACKUPS.md`, `scripts/engineering/restore-drill.py (будущий)`.

Acceptance:

- Согласованный SQLite+attachments+keys backup off-host
- Восстановление isolated; counts/FK/hash/grants/ledger совпали

Проверка: Будущий restore drill с synthetic fixtures + integrity_check.

Риск: Не раскрыть private configs; restore не посылает outbox и не перезаписывает production. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-TEST-001 — Auth HTTP characterization

Модуль: identity; P0; статус backlog. Зависимости: QUB-001.

Причина: Текущие auth suites проверяют helper/router fixtures, но не весь register/login server.js.

Файлы/контракты: `back/tests/auth-legacy-baseline.test.js (будущий)`.

Acceptance:

- Реальный server isolated register/login/logout/revoke/reset + OAuth transport mock
- Blocked user/CSRF/state/PKCE/cookie malformed negative cases

Проверка: python3 scripts/engineering/verify.py --suite node.

Риск: Не читать пароли в модель; blocked/revoked/OAuth subject не превращается в owner; sessions не теряются. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-TEST-002 — Tournament runtime и rating regression

Модуль: tournaments; P0; статус backlog. Зависимости: QUB-TEST-001.

Причина: Сохранить сложный join/submission/rating flow до выделения турниров в модуль.

Файлы/контракты: `back/tests/tournament-http.test.js (будущий)`, `back/tests/rating-baseline.test.js (будущий)`.

Acceptance:

- Join individual/team/roster/code, submit/draft/deadline/penalty покрыты
- Rating/history/bonus/decay повтор не дублирует; baseline UI screenshot

Проверка: verify.py --suite node; будущий Playwright fixture.

Риск: Сохранить roster/codes/team/results/rating; не допустить глобальной эскалации. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-CORE-001 — Изолированный core health и contract skeleton

Модуль: core; P0; статус backlog. Зависимости: QUB-001. OPS-001 нужен перед серверной миграцией/деплоем, не перед локальным core.

Причина: Проверить выбранный runtime/storage контракт без write доступа к legacy данным.

Файлы/контракты: `core/qubite (будущий)`, `contracts/core-v1.json (будущий)`.

Acceptance:

- Только выбранный стек, health и migration version, no legacy DB writes
- Contract validation и no-network startup tests

Проверка: Будущий core pytest + verify.py --suite all.

Риск: Новый процесс не открывает legacy writable DB; изолированная schema миграция; capacity перед деплоем. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-AUTH-002 — Legacy identity bridge и stable subject mapping

Модуль: identity; P0; статус backlog. Зависимости: QUB-CORE-001, QUB-TEST-001.

Причина: Сохранить авторизацию существующих сервисов и однозначное соответствие субъектов.

Файлы/контракты: `core/qubite/identity (будущий)`, `contracts/identity-v1.json (будущий)`.

Acceptance:

- Session introspection audience/status/revoke fail-closed
- Mapping stable, roles не platform privileges, owner verified

Проверка: Будущий core pytest identity + auth compatibility suite.

Риск: Не читать пароли в модель; blocked/revoked/OAuth subject не превращается в owner; sessions не теряются. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-AUTH-003 — Module entitlements и scoped policy gate

Модуль: policy; P0; статус backlog. Зависимости: QUB-AUTH-002.

Причина: Старые глобальные роли и owner bypass не подходят новой default-deny модели.

Файлы/контракты: `core/qubite/policy (будущий)`, `contracts/policy-v1.json (будущий)`.

Acceptance:

- Default deny и intersection REST/job/tool/WS реализованы
- Owner/tournament/cross-resource/revoke/API bypass negative matrix

Проверка: Будущий core pytest policy; provider counter 0.

Риск: Cross-scope/guest/plugin/job могут обходить UI; owner не bypass бюджета. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-AI-001 — Atomic mock budget reservation

Модуль: ai; P0; статус backlog. Зависимости: QUB-AUTH-003.

Причина: Раздельные float ledgers не защищают общий cap при параллельном расходе.

Файлы/контракты: `core/qubite/ai/budgets (будущий)`.

Acceptance:

- Integer buckets/idempotency/reserve/settle/unknown states
- 2 workers concurrent cap и double settle pass

Проверка: Будущий core pytest budgets с disposable DB, two processes.

Риск: Неизвестная цена/доставка fail closed; no real paid requests; actual accounting не обрезается. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-AI-002 — Mock dispatcher crash/revoke/fallback checks

Модуль: ai; P0; статус backlog. Зависимости: QUB-AI-001.

Причина: Crash/timeout/revoke не должны давать двойной платный вызов или бесплатное освобождение unknown reserve.

Файлы/контракты: `core/qubite/ai/dispatcher (будущий)`.

Acceptance:

- No grant/price/budget/revoked → 0 provider calls
- Unknown delivery reserve retained, no automatic paid retry

Проверка: Будущий core pytest dispatcher fault injection.

Риск: Неизвестная цена/доставка fail closed; no real paid requests; actual accounting не обрезается. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-UI-001 — Today shell и owner/nonowner navigation

Модуль: ui; P0; статус backlog. Зависимости: QUB-AUTH-003.

Причина: Отделить обычный user outcome от legacy role dashboard и показать denied/unavailable состояния.

Файлы/контракты: `apps/web (будущий)`, `docs/design/DESIGN_SYSTEM_PLAN.md`.

Acceptance:

- Owner ordinary home; console hidden entry; module denied/degraded states
- Viewport keyboard/focus checks и Playwright direct URL tests

Проверка: Будущий npm typecheck/build + Playwright shell tests.

Риск: Скрытие UI не authorization; optimistic sync статус обязан быть честным. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-AUTH-004 — Owner Console users/grants/budgets UI

Модуль: owner; P0; статус backlog. Зависимости: QUB-UI-001, QUB-AI-002.

Причина: Дать владельцу ручные независимые grants/budgets без предоставления всем доступа.

Файлы/контракты: `apps/web/owner (будущий)`, `core/qubite/owner (будущий)`.

Acceptance:

- Manual account grants/revoke/budget with audit+If-Match
- Nonowner owner API denied, no self-service paid grant

Проверка: Будущий core integration + Playwright console tests.

Риск: Обычный user не вызывает management API; manual grants audit; owner singleton защищён. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-AUTH-001 — Приёмка Owner Console/Docs-only/mock AI

Модуль: owner; P0; статус backlog. Зависимости: QUB-AUTH-004.

Причина: Проверить целостный owner→Docs-only→mock cap→revoke сценарий до полезных платных функций.

Файлы/контракты: `docs/reports/QUB-AUTH-001.md (будущий)`, `tests/e2e/owner-flow (будущий)`.

Acceptance:

- Все 10 access policy случаев включая exhausted mock cap
- Реальный UI принят owner; paid endpoint provider calls не выполнялись

Проверка: Будущий owner E2E+negative integration matrix.

Риск: Обычный user не вызывает management API; manual grants audit; owner singleton защищён. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-DOC-001 — Typed note/revision API и local durable draft

Модуль: docs; P1; статус backlog. Зависимости: QUB-AUTH-001.

Причина: Первый ручной полезный документ требует typed ownership и durable local draft.

Файлы/контракты: `core/qubite/docs (будущий)`, `apps/web/docs/local (будущий)`.

Acceptance:

- Создать/открыть note с AST/revision; server ACL и local atomic persist
- Reload/kill не теряет draft; чужой doc denied

Проверка: Будущие docs API integration + local-store unit tests.

Риск: Durable draft/private attachment не теряются и не доступны чужому subject. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-SYNC-001 — Idempotent push/pull и конфликт двух устройств

Модуль: sync; P1; статус backlog. Зависимости: QUB-DOC-001.

Причина: Offline edits не должны теряться/дублироваться на повторе и двух устройствах.

Файлы/контракты: `core/qubite/sync (будущий)`, `apps/web/sync (будущий)`.

Acceptance:

- Retry не дублирует, 409 сохраняет варианты, tombstones
- Offline/reconnect/revoke/expired cursor scenarios

Проверка: Будущий two-device offline Playwright + sync pytest.

Риск: Revoke/expired cursor/конфликт не удаляет собственный draft; tombstones не GC преждевременно. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-SEARCH-001 — Связь note/project и ACL keyword search

Модуль: knowledge; P1; статус backlog. Зависимости: QUB-SYNC-001.

Причина: Связанный граф и поиск нужны первому срезу, но могут раскрыть private titles/edges.

Файлы/контракты: `core/qubite/objects/relations (будущий)`, `core/qubite/knowledge (будущий)`.

Acceptance:

- Note linked to project found via Command
- Cross-scope title/snippet/count/edges не раскрываются

Проверка: Будущий ACL search/graph pytest + Command E2E.

Риск: Title/snippet/count/edge/derived index leaks и stale authorization. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-HISTORY-001 — Diff и restore в новую revision

Модуль: history; P1; статус backlog. Зависимости: QUB-SEARCH-001.

Причина: Пользователь должен сравнить и восстановить заметку без потери последующих edits.

Файлы/контракты: `core/qubite/history (будущий)`, `apps/web/history (будущий)`.

Acceptance:

- Две revision compare/restore; новый edit не перетёрт
- Roundtrip export/restore и author audit

Проверка: Будущий history API+restore concurrency+Playwright vertical slice.

Риск: Restore не перезаписывает новые edits; external action нельзя отменить DB rollback. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-INK-001 — Hardware input probe и benchmark plan

Модуль: ink; P0; статус backlog. Зависимости: нет.

Причина: Аппаратный input/latency риск нельзя решить документацией или web-only прототипом.

Файлы/контракты: `clients/android-ink/probe (будущий)`, `docs/reports/INK-HARDWARE.md (будущий)`.

Acceptance:

- Модель устройства/pressure/tilt/sample/frame/latency реальные
- APK и safe kill/autosave, no cloud calls; ощущения подтверждает owner

Проверка: Будущий Gradle test/lint/assembleDebug + реальный планшет.

Риск: Не обещать pressure/tilt без измерения; pen crash/recovery/latency и sensitive образцы. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-TOUR-001 — Scoped role compatibility adapter

Модуль: tournaments; P1; статус backlog. Зависимости: QUB-AUTH-001, QUB-TEST-002, QUB-OPS-002.

Причина: Изолировать роли/навигацию турниров при полном сохранении результатов и старых URL.

Файлы/контракты: `core/qubite/integrations/tournaments (будущий)`, `back/server.js (точечно после approval)`.

Acceptance:

- Старые URLs/results/team roles сохранены, API alias tested
- Tournaments отдельная navigation, no global admin elevation

Проверка: verify.py --suite all + tournament E2E + policy diff.

Риск: Сохранить roster/codes/team/results/rating; не допустить глобальной эскалации. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.

## QUB-INT-001 — Service/Shade connector contract POC

Модуль: integrations; P2; статус backlog. Зависимости: QUB-AUTH-001.

Причина: Контракт внешних сервисов и локального Shade должен ограничивать действия/credentials до подключения.

Файлы/контракты: `contracts/connectors-v1.json (будущий)`, `docs/architecture/SHADEAI_INTEGRATION.md`.

Acceptance:

- Source contracts Search/Writer/Shade mocks status+allowlist
- Revoke/unknown outcome, no Shade writes/real HA/network calls

Проверка: Будущий connector fixture pytest; verify.py --suite all.

Риск: Не вызвать HA/TG/paid API, не читать домашние сессии; unknown sends не повторять. Откат: До switch сохранить authority/source; отключить task feature/routing, preserve новые записи; применить migration runbook если есть schema change. Commit/PR: после выполнения, сейчас нет.
