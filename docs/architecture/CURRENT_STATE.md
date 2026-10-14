**UI-00314.10.2026:** ответы получены: default locked/shared hidden, при read upcoming/unavailable показать. Core0.7.0/schema0008_catalog и apps/web0.4.0; server filtered metadata/detail и guarded owner visibility, no grants/installer/paid bypass. [Контракт](MODULE_CATALOG.md), [отчёт](../reports/QUB-UI-003.md). Current CI/final totals в LAST_HANDOFF/registry; старые snapshots ниже исторические. Next AI-001→AI-002→AUTH-004, сначала новые вопросы.

**AUTH-00713.10.2026:** apps/web0.3.0 — публичный landing/Auth forms, registration/invite link+manual, verification/reset, own session/link UI поверх существующего core. Browser OAuth fixed303 completion, JSON API сохранён. Core0.6.0/schema0007 unchanged; legal packet not publication-ready. [ADR-0024](decisions/0024-public-landing-and-qubite-auth.md), [Auth UX](../design/AUTH_UX.md), [legal](../legal/README.md). Full browser/core synthetic acceptance отдельно от физического телефона/providers/SMTP/ingress. Следующая UI-003 требует своих вопросов. Старые snapshots ниже исторические.

**UI-001, 13.10.2026:** создана новая React/TS оболочка `apps/web/`0.1.0: Главная/Модули/Входящие/Профиль/Настройки, desktop left/mobile bottom, Qubite Command/Lite fixed bottom, owner entry в настройках. [ADR-0022](decisions/0022-web-shell-and-command.md), [отчёт](../reports/QUB-UI-001.md). Live читает existing me/access, не симулирует writes; demo roles/capture/visibility временные. Backend catalog+owner hidden/locked — новая UI-003 перед AUTH-004; auth screens следующая AUTH-007. Core0.6.0/0007, legacy и design-lab unchanged. Новые задачи только после вопросов/ответов. Старые milestones ниже исторические.

> Актуально13.10.2026: [ADR-0021](decisions/0021-repository-layout-and-standalone-tournaments.md) / [карта исходников](REPOSITORY_LAYOUT.md). Tournaments — самостоятельная опциональная legacy-платформа без shared identity/SSO/grants нового core. Старые back/front/deploy теперь в legacy/qubite-v1; остальные старые сервисы reference и требуют нового interview/design/core API. Все новые модули планируются на поддоменах, ingress ещё не реализован. Исторические положения ниже о tournament adapter/общем управлении больше не текущая цель.

# Qubite: аудит исходного состояния

**AUTH-00613.10.2026 — done:** core0.6.0/current0007_registration; owner-controlled invite/default/public/disabled API, оба одноразовых invite, strict minimal enrollment/consents, pending→email verify→login, no module/AI grants. [Контракт](REGISTRATION.md), [отчёт](../reports/QUB-AUTH-006.md), [ADR-0020](decisions/0020-owner-controlled-registration.md). Вопросы заданы и ответы получены до реализации. React controls/mail/legal/deploy отдельно. AUTH-015 глобальные switches, AUTH-016 ChatGPT eligibility/identity, AI-003 personal plan vs owner API сохранены в backlog. Далее обсудить UI-001 shell, затем AUTH-007 auth UI; перед каждым task снова вопросы. Implementation2035e1e / CI38390796988 exact SHA success11:36:36UTC;969 local+CI checks. Current evidence в tasks.json/LAST_HANDOFF, milestones ниже исторические.

**AUTH-00313.10.2026 — done:** core0.5.0/schema0006_policy; раздельные ручные module/action grants, workspace/resource intersection, owner-only metadata commands с If-Match/idempotency/reauth/audit. Общий REST/job/tool/WS gate, live revoke/session/expiry/version; paid AI закрыт до AI-001/002. [Контракт](POLICY_GATE.md), [отчёт](../reports/QUB-AUTH-003.md). Только аккаунт до grants подтверждено владельцем; перед каждой будущей задачей сначала вопросы и ответы. UI/registration/real modules/installer/native/provider/deploy отдельно. Final local+CI all844+harness6=850pass; implementationd4c813e/CI38381905595 completed-success10:17:52UTC. Registry56:10done/4ready/42backlog, evidence в tasks.json/LAST_HANDOFF. Прежние snapshots ниже исторические.

**Актуальный AUTH-011 runtime:** core0.4.0/current0005_challenges,11 domain/security tables; verification/reset existing UUID и mock-only email transport. [API/SQL/ограничения](EMAIL_CHALLENGES.md), [evidence](../reports/QUB-AUTH-011.md). Identity-v2 partial AUTH-009/010/011; email-2FA contract-only, registration/policy/native/UI/provider/deploy отдельно. Снимки прошлых задач ниже исторические.

**Актуальное AUTH-01013.10.2026:** core0.3.0/current0004_oauth, [OAuth adapters/explicit link/unlink](OAUTH_IDENTITY.md), [report](../reports/QUB-AUTH-010.md). Identity-v2 partial runtime AUTH-009/010, текущих core tables10, metadata readonly readiness/old password sessions проверяются. Реальные provider keys/network/deploy/UI не использованы; снимки AUTH-002/009 и legacy audit ниже исторические. Policy/native/registration/reset/keys/services ещё отдельные задачи.

**Актуальное условие13.10.2026:** владелец сообщил, что проект нигде не запущен, аккаунтов для переноса нет, прежний owner можно создать заново. Это не remote/server verification. Кодовые факты legacy аудита ниже сохраняются; текущий план [ADR-0013](decisions/0013-fresh-identity-and-unified-login.md)/[fresh identity](../migration/IDENTITY_CUTOVER.md) не требует live Auth bridge/import.

Дата: 12.10.2026. База аудита: `96f0457a523b6b79f21c4092056d8fa8fa69a680`. Архивные refs `origin/tournaments` и `qubite-v1.0` проверены через git ls-remote и совпадают с этой базой. Рабочая ветка main. В начале были только три untracked документа QUBITE*.md; исходники без локальных изменений. Архив намеренно не содержит новый контекст. Root CLAUDE.md и точный kickoff V2 отсутствовали; игнорируемый qubite-product-intro/CLAUDE.md относится к другому артефакту.

## Границы доказательств

ПРОВЕРЕНО КОДОМ означает прочитанную реализацию, а не production-приёмку. УКАЗАНО В DOCS — эксплуатационный снимок. ТРЕБУЕТ ПРОВЕРКИ НА СЕРВЕРЕ — версии, данные, загрузка, backup и реальный ingress. ПРЕДЛОЖЕНИЕ — будущая архитектура. Ни серверные секреты, ни рабочие БД не читались; сервер не изменялся. Это системный аудит границ и контрактов, не доказательство отсутствия всех дефектов в каждой строке.

## Стек и поток

ПРОВЕРЕНО КОДОМ: back/package.json — CommonJS, Express ^5.2.1, sqlite3 ^6.0.1, xlsx ^0.18.5, node-telegram-bot-api ^0.67.0. npm start/dev запускают server.js; npm test намеренно падает. Корневого package.json нет. Front — index.html, app.js, api.js, styles.css, HTML legal pages. Есть отдельный Flutter/Dart VPN-клиент app/qubite_vpn; его сборка/платформенные VPN-права здесь не проверялись.

Размеры исходного состояния: server.js 9940 строк, db.js 9196, app.js 17551, api.js 1894. Извлечение модулей требует characterization tests, а не массового форматирования.

HTTP → body parser/origin/rate guard → attachAuth (hash cookie → sessions + users) → route/domain checks → SQLite → serializer → client state. Схема создаётся при старте, затем выполняются additive ALTER/backfill; отдельного версионированного migration runner нет. В db.js есть BEGIN IMMEDIATE/WAL, но transactions не образуют единый межмодульный coordinator. Отдельные соединения открывают services/writing/knowledge модули.

## Матрица функциональности

| Область | Подтверждение кода | Что ограничивает вывод |
|---|---|---|
| Identity | server.js attachAuth/requireAuth; security.js scrypt, SHA256 opaque token; oauth.js, challenges, sessions, revoke | Нет полной HTTP-регрессии реального server.js для register/login/OAuth/reset; провайдеры не вызывались |
| Tournaments | db.js getTournaments/createTournament; runtime join, drafts/submissions; task-runtime.js четыре типа проверки; roster/helper codes; teams; rating_changes | Новый baseline проверяет каталог и grading; end-to-end runtime/rating пока отдельная задача |
| Роли/админка | server.js requireRoles/requireAdmin, role workspace bootstrap; front/js/app.js | Старые глобальные роли несовместимы с целевой моделью |
| Search | FastAPI app.py, retrieval.py (публичный fetch/SSRF), agent_api.py, store.py SQLite/history/ledger, grounding.py, engines/media | История и журналы имеют разные политики; глобальный cost guard отсутствует |
| Writing | writing.js local LanguageTool + четыре AI-команды; Firefox addon/UTF-16 highlights, ключи и usage | Owner auto-ai; подпись Firefox и live checker требуют проверки |
| VPN | proxy/routes.js, personal.js, availability.js: ноды/heartbeat/devices/credentials/subscriptions | Сеть/REALITY/Naive/SNI/TUN и сборки клиентов требуют серверной проверки |
| Vault | vault-integration.js + Unix socket vault-manager.py | Отдельный master password, не общий аккаунт секретного содержимого |
| Native knowledge | knowledge-services/enrollment/api.js, managers + ограниченные MCP | Memos/Vikunja/SiYuan сохраняются; не становятся движком будущих Docs/Planner |
| Telegram control | telegram-worker.js; access/handlers; отдельные owner/private actions, runtime allowlist | Не запускать второй polling того же токена |
| Kwork | parser/bot/runner/brief/negotiation hooks, SQLite State | Git не гарантирует идентичность Pi; персональный listener внешний, unknown send нельзя повторять |
| Brief / leads | specbot Store/Bot/AI/bridge/leads/negotiation, durable outbox, revision checks, отдельный lead_bot | Реальные sends/STT/платные модели не запускались; это не обучение весов |
| Support/events | support routes/SSE, process-events.js private Unix sockets | IPC без durable очереди, потеря событий при downtime возможна |

## Доступ и деньги: несоответствия цели

server.js:2578 owner наследует admin в requireRoles; requireAdmin даёт широкие legacy-права. Workspace bootstrap выбирается по роли. services.js:35–39 и writing.js:37–39 расширяют owner grants/paid/лимиты автоматически. Search app.py can_paid аналогично. Новый owner должен иметь management capability, но отдельные собственные entitlement/model/budget. Старые запреты нельзя объявлять новым default-deny.

Search Store.reserve использует BEGIN IMMEDIATE и удерживает unknown cost; Writing резервирует с serial queue и BEGIN IMMEDIATE. Это полезные локальные механизмы, но они не дают общего лимита между Search, Writing, Brief, Kwork, Hermes и SiYuan. REAL/float amounts и разные валюты требуют новой точной модели учёта.

## Инфраструктура

ПРОВЕРЕНО КОДОМ: deploy/install.sh, deploy/services/runtime.py создают Auth/control-bot/manager units; QUBITE_PROCESS_ROLE разделяет запуск. service-runtime/registerGate и services routes сохраняют auth/services при остановке workspace. Старые Nginx/PM2 инструкции остаются для VPS, новые Caddy/Cloudflare ingress merge — для Pi. Менеджеры root-owned после установки, узкий allowlist команд, private sockets; общий UID остаётся доверенной границей, не sandbox между всеми приложениями.

УКАЗАНО В DOCS runtime-and-knowledge.md: Pi 5/4GB, отдельные Docker Memos/Vikunja/SiYuan, memory cgroup отсутствует, локальные пути данных и нативные credentials вне Git. ТРЕБУЕТ ПРОВЕРКИ НА СЕРВЕРЕ: deployed SHA каждого checkout, drift Kwork/hooks, active units/containers/ports, реальные routes/TLS, memory cgroup, RAM/swap/disk, backup schedule/restore, число аккаунтов, объём attachments/ledger. Автоматический pull/restart на push локально не подтверждён; до следующего push кодинга проверить отсутствие внешнего автодеплоя.

## Docs drift

AGENTS утверждал отсутствие тестов; уже есть targeted suites. README одновременно перечислял Telegram OAuth и отрицал login; server.js реализует redirect/widget callback. README писал embedded polling вместе с сервером, runtime.py выделяет control-bot. SECURITY ссылался на deploy/.env как tracked секрет: текущий git ls-files не содержит этот файл; историческую утечку/ротацию это не опровергает. Размеры файлов устарели. Старые ops инструкции относятся к разным окружениям, нельзя слепо выполнить pm2 restart 0 на Pi.

## Дополнительные инвентари

[API](API_INVENTORY.md), [таблицы](DATABASE_INVENTORY.md), [env и тесты](ENV_AND_TESTS.md), [машинный inventory](INVENTORY.json), [риски безопасности](SECURITY_AUDIT.md), [ShadeAI](SHADEAI_INTEGRATION.md). Регистрации dynamic paths/static middleware и schema ALTER требуют повторного просмотра в конкретной задаче; inventory не является OpenAPI.
