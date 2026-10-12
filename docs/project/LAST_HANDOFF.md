# Передача следующей сессии — 12.10.2026

Последняя задача **QUB-TEST-001 done**. По запросу владельца выполнена только первая coding задача: 25 новых HTTP characterization tests настоящего legacy `server.js`. Коммит реализации `695227792e6ab7a09cdad67b56d8acbad4cc0ad9` отправлен в origin/main; remote SHA подтверждён. [GitHub CI run 38207835631](https://github.com/kirillkuz1122/qubite/actions/runs/38207835631) success. Этот handoff/registry completion сохраняется отдельным docs-коммитом; актуальный main SHA брать из git log и origin.

## Проверки и ограничения

Полный isolated runner: Node94, deploy18, Search95, Brief112, Kwork29, SiYuan5 =353; harness unittest4 = **357 pass**, fail/skipped/cancelled0. Node v22.22.2/Python3.14.7 локально; Node22/Python3.14 в CI. `python3 scripts/engineering/check.py` и `git diff --check` passed. [Отчёт первой задачи](../reports/QUB-TEST-001.md), [audit baseline](../reports/QUB-001.md), [актуальный полный отчёт](../reports/STATUS-2026-10-12.md).

Tests запускают source-copy без .env с temp SQLite/HOME/loopback; настоящие guards/routes/hash/DB/state/PKCE/Telegram signature, только внешний mail/CAPTCHA/OAuth transport mock. Реальные API/TG/paid AI/HA/browser/device/production acceptance не выполнялись. Runtime back/src/front/deploy и live DB/credentials не менялись, services не restart; push не deploy. GitHub Actions только проверяет tests.

Три подтверждённых synthetic legacy дефекта **НЕ исправлены**: AUTH-L01 percent cookie500; AUTH-L02 Google pending callback после runtime disable; AUTH-L03 account linking по email при `email_verified=false`. Последнее P0 identity cutover/linking gate; реальный Google exploit не проверялся. Report/SECURITY/identity docs и QUB-AUTH-008/009/010 содержат negative requirements. Не переносить `legacy defect` expectations в новый FastAPI как accepted compatibility.

## Следующая задача

**QUB-CORE-001 ready**: отдельное FastAPI/Postgres foundation с health/typed contracts/versioned migration в disposable storage, без записи в legacy SQLite. В этом цикле core не начинался. Всего 49 карточек: 2 done, 4 ready (CORE-001/DESIGN-001/DEPLOY-001/TG-001), 43 backlog. Один bounded cycle по [harness](../engineering/AGENT_HARNESS.md): read→task→tests→review/docs→русский commit→сразу push→remote/evidence. Не снимать task gates у backlog автоматически.

Начать с git status/log, AGENTS/CLAUDE, PROJECT_CONTEXT и tasks.json/ADR. Стек согласован: FastAPI/Python/Postgres новых shared Auth/users/settings/support/analytics/metrics/control APIs, все собственные included Search/Writing/VPN UI React/TS с новым стилем. Tournaments остаётся optional legacy Node/SQLite/Vanilla со старым UI, полный rewrite не требуется. Node/Auth только временно для ещё не migrated consumers до verified cutover. Новый core/React/Postgres runtime пока отсутствует.

## Сохранённые решения и границы

- Owner normal home + отдельная Owner Console; default deny/manual module/model grants и budgets включая owner; tournament роли не global platform admin. Без тарифов. Identity/role migration отдельно и с backup/restore.
- Telegram bot сохранить, control flow переделать; турниры в module settings, общие controls/analytics/load в Console. TG-1..6 закрыты: linked text/voice auto capture без категорий, durable raw→STT/classify/scoped save→undo/link; guest Support и owner-managed отдельные staff grants; allowlist controls с confirmation; critical+daily linked app/TG notifications; aggregates. ADR-0007/0008, TELEGRAM_AND_OBSERVABILITY и TELEGRAM_CAPTURE_AND_NOTIFICATIONS — актуальные specs.
- Сайт/Android/Linux desktop обязательны; React/Tauri desktop POC с future Windows/macOS portability, native Kotlin Ink/hybrid POC. Lenovo Xiaoxin Pad 2025 — название владельца; точный model ID/стилус ещё проверить реальным probe.
- Hosting/Raspberry Pi отложены, возможен VPS; не блокировать local core. Новый deploy/installer обязательны, autodeploy отсутствует. OPS inventory/capacity/backup destination/restore/staging и explicit deploy approval перед live этапом; GitHub сохраняет код, не runtime данные.
- Архив origin/tournaments и qubite-v1.0 повторно проверен на `96f0457a523b6b79f21c4092056d8fa8fa69a680`, immutable. Не удалять/не изменять/не force-push. Разработка main, временные task branches с tested merge разрешены.
- ShadeAI `/home/kirill/programing/ShadeAI` только read-only, audited SHA3b34be7; без merge/import/secrets/HA/cloud runtime изменений. Корневой kickoff с V2 суффиксом отсутствует, прочитан доступный QUBITE_AGENT_KICKOFF_PROMPT.md; master/access прочитаны полностью, 48 идей сохранены source trace.
- Filled deploy/.env проверен только existence/mode600/untracked, values не читались. Владелец разрешил локальное использование при необходимости; текущие tests используют только fixtures. Не выводить/коммитить env/DB/private messages/browser state.

Решения/память только в docs/project и ADR; личная память агента не заменяет registry/report. Предыдущая audit task QUB-001 done (ae3f71e, CI38197926998), baseline332; итог первой coding task теперь357, как указано выше.

## Новый текущий цикл — CORE-001

Реализован independent core foundation + explicit SQL metadata migration + API v1 contract; native PG29 tests и full runner386 checks прошли локально. Commit/remote/CI evidence заполняется после push, registry пока review/testing. [CORE-001 отчёт](../reports/QUB-CORE-001.md). Следующая primary DESIGN-001, AUTH-008 только specification после done dependencies. Legacy/Auth дефекты/live backups/device/React gates прежние; никакого deploy/data migration.
