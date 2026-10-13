# Память проекта Qubite2.0

**Текущий cycle AUTH-01013.10.2026:** core0.3.0/0004 и OAuth adapters/explicit identities; [runtime](../architecture/OAUTH_IDENTITY.md), [report](../reports/QUB-AUTH-010.md), [ADR-0016](../architecture/decisions/0016-explicit-oauth-identities.md). Default disabled/network-off, stable issuer/sub и own-password linking без auto email signup, UUID/owner/passwords сохраняются. Real provider configs не читались; следующий cycle AUTH-011. Code/local checks/push/CI состояния фиксируются отдельно в handoff/report.

Обновлено13.10.2026. Версионируется в Git; не зависит от чата или личной памяти агента. Код, пользовательские условия, тесты и production verification различать.

## Начало сессии

AGENTS/CLAUDE → доступный QUBITE_AGENT_KICKOFF_PROMPT.md (имя V2 отсутствует) → полный master/access → CURRENT_STATE → ADR → tasks.json → LAST_HANDOFF → Git status/log. Исходные master/access не переписывать; source trace сохраняет все требования/48 идей. Пользовательские поздние уточнения имеют приоритет.

## Актуальные решения

- FastAPI/Python, React/TS, Postgres нового core. Собственные Search/Writing/VPN и остальные included UI получают новый React дизайн; optional Tournaments сохраняет Node/SQLite/Vanilla/старый UI. Нужные shared функции реализуем на FastAPI, не постоянным JS adapter.
- **13.10.2026 пользователь сообщил:** существующих аккаунтов нет, owner можно создать заново, текущего деплоя нет/проект нигде не запущен. Это не server verification. Разрешены единый новый API/вход и изменения Search/остальных сервисов. [ADR-0013](../architecture/decisions/0013-fresh-identity-and-unified-login.md) отменяет обязательный Auth bridge/legacy password/session import/integer mapping/login alias. Новый core — authority с первой fresh установки, owner назначается явным local bootstrap.
- [Identity contract](../migration/IDENTITY_CUTOVER.md) и contracts/identity-v2.json — partial_implementation/runtime_implemented=true для implemented AUTH-009/010 web/OAuth routes; future routes planned. Web same-origin cookie, native external-browser PKCE/device rotation, scoped keys расширений/агентов и private engine introspection — отдельные slices. Upstream master-password, bot/node/provider secrets не пользовательская сессия.
- Обычная home владельца и separate Console из Settings; один owner; tournament-only organizer/moderator/admin. Default deny/manual module/model grants, budgets для всех включая owner, no tariffs. Нет owner auto-paid/plaintext private-vault bypass. Identity principal не resource ACL/cost reservation.
- Web/Android/Linux desktop обязательны; Windows/macOS portability, Tauri/Kotlin Ink пока POC. Планшет Lenovo Xiaoxin Pad2025, точный model ID/перо не проверены.
- Hosting/Pi/VPS отложены, не блокируют локальные задачи. Deploy/installer обязательны; no autodeploy. Перед первым deploy нужны конкретный host/routes/artifact, staging/smoke и backup/restore новых данных/найденных нужных источников; не требовать backup несуществующей live базы ради local identity.
- Telegram сохранить и полностью переработать: automatic text/voice capture без меню, durable raw→STT/classify/scoped save→undo/link; guest Support и owner-managed staff grants; allowlist controls/confirmations; linked critical/daily events. Турнирные controls в module settings; общие analytics/load/AI costs в Console. TG1–6 отвечены, расписание/каналы настраиваются позже. Credentials не нужны synthetic tests.
- Дизайн **Поток/Игрушечная/Лента/Unbounded/Manrope, ритм100/503** принят после версии4; не переспрашивать. [Color Plastic](../design/COLOR_PLASTIC.md), [Flux](../design/FLUX_DESIGN_SYSTEM.md). Это компонентная витрина, не final product layout. Четыре scoped персонажа с характерами, сейчас scripted; hidden/edge peek/contextual appearance/dialogue/retreat фиксированы в PET-001/002, placement/инициатива обсуждаются при реализации экранов.

## Что существует в коде

Legacy back/front/index/services/deploy сохраняются. QUB-001 audit/harness done; TEST-001 реальные server.js HTTP fixtures; CORE-001 independent FastAPI health/readiness/explicit technical migration/OpenAPI. PG schema0001 technical namespace неизменна; AUTH-002 explicit0002_identity содержит subjects/platform_owner, internal pending writer/local CLI bootstrap. AUTH-009 Web Auth/password/session/reauth/revoke и0003 реализованы; AUTH-010 OAuth/link/unlink и0004 реализованы; grants ещё не реализованы, настоящий owner/password постоянной среды не создавались. DESIGN-001 separate React/TS/Vite assets/design-lab и private static demo, product React UI/AI agents ещё не реализованы; Web Auth API уже существует. AUTH-008 добавляет контракт, synthetic protocol tests и план потребителей, без runtime Auth/изменений services.

AUTH-L01 malformed cookie500, L02 pending Google callback after disable, L03 unverified email linking остаются **НЕ исправлены в legacy коде**. Characterization tests фиксируют дефекты, новый Auth должен безопасно отказывать; даже verified email не auto-links чужой account. Родительские роли/owner paid bypass не переносятся.

## Задачи и проверки

AUTH-008 **done**, implementation a48685c5a68cf8ca8973d6561f44b491157a9f1a pushed/remote verified, exact-SHA CI38344387215 completed/success13.10.2026 04:01:52UTC;418 checks (all414+harness4) passed локально и CI. AUTH-002 **done**, implementation0dff63e9bb3cbabf6c2b10628db12c228ee54413 pushed/remote verified; subjects/singleton owner/local CLI,477 checks (core88) local+CI38348273457 completed/success13.10 04:50:13UTC, CI Python3.14.8/PG16.15. AUTH-009 **done**: core0.2.0/current0003, implementation1dc57cb4c980b111acbf5ccadb28f25871149c98 pushed/remote verified, CI38354136689 completed/success13.10.2026 05:59:47UTC;597 local+CI checks (core208), CI Python3.14.8/PG16.15. AUTH-010 текущий cycle review/testing: all693+harness4=697 local pass/core308; push/exact-SHA CI ожидаются. После completion следующая AUTH-011 verify/reset. AUTH-003 зависит от настоящего Auth, UI после policy/design. AUTH-012/013/014 отдельно native/keys/introspection, сервисные adapters после них и owner acceptance. DEPLOY-001/TG-001 — альтернативные specification tracks, не параллельный старт всей платформы. Одна ready approved задача за цикл, docs→tests→review→русский commit→сразу push.

Всего56 карточек: AUTH-010 текущая bounded задача, ready AUTH-011/DEPLOY-001/TG-001, 45backlog; итог done/CI — tasks.json/[handoff](LAST_HANDOFF.md)/[AUTH-010 report](../reports/QUB-AUTH-010.md). Required check.py, verify.py all с pinned Python/native PG, unittest tests/engineering. Source-copy без .env/real HOME/data/browser state, внешняя сеть блокируется. Signed mocks не real provider/device/production acceptance. Browser133 исторически design, эта задача их не меняет.

## Git и сохранённые доказательства

main canonical; archive origin/tournaments + qubite-v1.0 **96f0457a523b6b79f21c4092056d8fa8fa69a680** immutable, проверено повторно при AUTH-009,13.10.2026; refs сохранены после implementation push. Не overwrite/delete/force-push. Git code archive не backup реальных данных; локальные старые БД/файлы/env не удаляются по fresh-install сообщению. Новые записи при rollback сохранять.

Baseline ae3f71e/CI38197926998; TEST-0016952277/CI38207835631,357 checks; CORE-001a85f047/CI38211426535,386 incl harness4/core29, native PG18.6 local/16.15 CI. Design implementation9262e3/CI38340403176+38340403192 success,133 browser+386 existing=519; acceptance9385020 pushed. Точные evidence в соответствующих reports. Эти исторические CI не verification следующего Auth runtime.

## Демо, секреты, независимые проекты

[Демо](https://qubite-material-lab-kirill.kuzmichevkonstantin9.chatgpt.site/#/flux/appearance): private ChatGPT owner audience, версия4/source8e8aba31/deploymentappgdep_6acd9fa05db08191b83a91968a2a70e6 succeeded13.10.2026 03:04:14UTC. Reuse exact project_id в assets/design-lab/.openai/hosting.json, tokens не сохранять; CI tests-only, no auto publish. Владелец сам прошёл вход/посмотрел, повторный browser sign-in не нужен. В AUTH-008/002 demo не меняется.

По прямому указанию не использовать skills/quota reset/subagents. ShadeAI /home/kirill/programing/ShadeAI только read-only future connector, без merge/import/secret/HA/cloud changes. Filled deploy/.env existence/untracked/mode600 известны; пользователь разрешил локальное использование при необходимости, values не читать в модель/Git/tests. Приватные DB, messages, browser state, Telegram sessions и provider secrets не коммитить. Paid/provider/TG/HA действия в synthetic tasks не выполнять.
