# Передача следующей сессии — 12.10.2026

Последняя задача **QUB-CORE-001 done** по прямому запросу владельца «след задачу делай». Independent FastAPI/Postgres foundation создан, commit `a85f047e7e54c07a6f780a127988b14d9c623a74` опубликован в main, remote SHA verified. [CI38211426535](https://github.com/kirillkuz1122/qubite/actions/runs/38211426535) success на точном implementation SHA, native PostgreSQL16.15. Registry/handoff completion отдельным последующим docs-коммитом; актуальный SHA из git log/remote.

## Реально создано и проверено

`core/qubite`: factory app, typed health/live (200)/ready (200/503)/OpenAPI v1; config только core env без autoload .env/legacy fallback; explicit transactional SQL migrations+ledger/advisory lock/checksums; initial technical core namespace, **без user/domain таблиц**. API startup не открывает БД и не выполняет DDL; readiness read-only, runtime role может только читать metadata. DB foundation loopback-only; remote/TLS/pool/installer отдельно. `contracts/core-v1.json`, pinned requirements, required harness core suite и CI Ubuntu24.04/native16. [Запуск](../../core/README.md), [foundation/ADR](../architecture/CORE_FOUNDATION.md), [отчёт](../reports/QUB-CORE-001.md).

29 core tests: no-network/no-env startup/legacy sentinel unchanged, contract/config negatives, actual private PG pending→apply→ready, repeat/concurrent independent connection migration, drift/ahead/missing schema fail, initial/subsequent DDL rollback+existing data preserved, readonly runtime role, CLI, **real uvicorn HTTP child smoke**. Local PG18.6 (пакеты только extracted/checksum verified в /tmp), CI16.15; no system install/service/Docker/live DB. Native cluster fresh/ephemeral/SCRAM/temp DB per test, cleanup. Missing prerequisites fail без skip.

Full all runner: Node94/deploy18/Search95/Brief112/Kwork29/SiYuan5/core29 =382; harness4 = **386 pass**, fail/skipped/cancelled0, docs/check/diff clean. Команда `python3 scripts/engineering/verify.py --suite all --python <test-venv-python> [--postgres-bin <native-initdb-postgres-dir>]`; локальный test venv `/tmp/qubite-audit-venv/bin/python`, PG bin `/tmp/qubite-postgres-18.6/usr/bin`, могут исчезнуть. Dependencies `scripts/engineering/test-requirements.lock` и native binaries обязательны; автоматических downloads/start existing service нет.

Legacy back/src/front/deploy runtime, DB/files/keys, ShadeAI, live services не менялись. Deploy/paid API/TG/HA/browser/device acceptance не выполнялись. Code push не deploy; нет autodeploy. Public health/OpenAPI не создаёт auth/policy доступа к user данным, user endpoints ещё отсутствуют. AUTH-L01 cookie500/ L02 pending Google callback после disable/ L03 unverified email linking из [TEST-001](../reports/QUB-TEST-001.md) остаются **НЕ исправленными**; L03 P0 cutover gate. Не переносить legacy дефекты как accepted compatibility.

## Следующая задача

**QUB-DESIGN-001 ready** — новый reviewable стиль, auth/navigation UX/макет, затем owner review до React implementation. CORE-001 завершён, в этом цикле ничего из нового UI/identity/модулей не начиналось. Approved AUTH-008 теперь ready по done CORE-001/TEST-001 dependencies: только identity transition specification, без live writes. 49 карточек: **3 done /4 ready /42 backlog**. Остальные ready DEPLOY-001/TG-001; по одной primary задаче, не все одновременно.

Начать git status/log→AGENTS/CLAUDE→PROJECT_CONTEXT/this handoff→tasks.json/ADR и [harness](../engineering/AGENT_HARNESS.md). Новый shared backend FastAPI/Postgres; included Search/Writing/VPN собственный UI React/TS новый стиль; Tournaments optional Node/SQLite/Vanilla старый UI. Node/Auth временно для немигрированных consumers до tested cutover. Owner Console/identity/domain/budgets/capture/clients пока specifications, а не реализованные функции.

## Сохранённые решения и границы

- Owner normal home + отдельная Owner Console; default deny/manual module/model grants и budgets включая owner; tournament роли не global platform admin. Без тарифов. Identity/role migration отдельно и с backup/restore.
- Telegram bot сохранить, control flow переделать; турниры в module settings, общие controls/analytics/load в Console. TG-1..6 закрыты: linked text/voice auto capture без категорий, durable raw→STT/classify/scoped save→undo/link; guest Support и owner-managed отдельные staff grants; allowlist controls с confirmation; critical+daily linked app/TG notifications; aggregates. ADR-0007/0008, TELEGRAM_AND_OBSERVABILITY и TELEGRAM_CAPTURE_AND_NOTIFICATIONS — актуальные specs.
- Сайт/Android/Linux desktop обязательны; React/Tauri desktop POC с future Windows/macOS portability, native Kotlin Ink/hybrid POC. Lenovo Xiaoxin Pad 2025 — название владельца; точный model ID/стилус ещё проверить реальным probe.
- Hosting/Raspberry Pi отложены, возможен VPS; не блокировать local core. Новый deploy/installer обязательны, autodeploy отсутствует. OPS inventory/capacity/backup destination/restore/staging и explicit deploy approval перед live этапом; GitHub сохраняет код, не runtime данные.
- Архив origin/tournaments и qubite-v1.0 повторно проверен на `96f0457a523b6b79f21c4092056d8fa8fa69a680`, immutable. Не удалять/не изменять/не force-push. Разработка main, временные task branches с tested merge разрешены.
- ShadeAI `/home/kirill/programing/ShadeAI` только read-only, audited SHA3b34be7; без merge/import/secrets/HA/cloud runtime изменений. Корневой kickoff с V2 суффиксом отсутствует, прочитан доступный QUBITE_AGENT_KICKOFF_PROMPT.md; master/access прочитаны полностью, 48 идей сохранены source trace.
- Filled deploy/.env проверен только existence/mode600/untracked, values не читались. Владелец разрешил локальное использование при необходимости; текущие tests используют только fixtures. Не выводить/коммитить env/DB/private messages/browser state.

Решения/память только docs/project/ADR и registry/report. История: QUB-001 audit done ae3f71e/CI38197926998 baseline332; TEST-001 done6952277/CI38207835631 baseline357; CORE-001 donea85f047/CI38211426535 теперь386. Production inventory/backup/restore ещё отдельные задачи, Git только code archive.
