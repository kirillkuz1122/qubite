# Передача следующей сессии —13.10.2026 / AUTH-008

**AUTH-008: контракт/план единого входа подготовлены,418 локальных checks passed; Git/CI evidence продолжаются.** Владелец разрешил создать новый единый API/вход Search/остальных сервисов: аккаунтов для переноса нет, прежнего owner можно создать заново, проект нигде не запущен/деплоя нет по его сообщению. Не искать старую owner DB и не строить legacy bridge. Это пользовательское условие, не remote server verification.

[ADR-0013](../architecture/decisions/0013-fresh-identity-and-unified-login.md), [identity spec/consumers](../migration/IDENTITY_CUTOVER.md), [контракт](../../contracts/identity-v2.json), [отчёт](../reports/QUB-AUTH-008.md), [tasks](../plan/tasks.json). Core сейчас health/readiness/technical schema0001, **рабочего Auth ещё нет**. Никаких Search/Writing/VPN endpoints, данных или deploy не меняли.

## Решение и следующий шаг

Fresh Postgres UUID/accounts и explicit local singleton owner bootstrap. Same-origin web cookie, native external-browser authorization code/PKCE/device rotation, scoped keys расширений/агентов и private core introspection; один account lifecycle для собственных сервисов. Нет password/session import, integer mapping, login alias, старого owner paid bypass. Vault master-password, bot/node/upstream service credentials отдельны. Identity не заменяет resource ACL/grants/AI budget.

**Следующая primary AUTH-002** — SQL subjects/owner и local bootstrap: idempotent migration, email collision, FK/singleton constraints, transaction/repeat/race tests на реальном disposable PG. Без usable password/login, его реализует AUTH-009. AUTH-003 policy теперь зависит от настоящего Auth; AUTH-012/013/014 добавлены отдельными bounded задачами, service adapters ждут private introspection, desktop native flow. AUTH-002 станет ready после done AUTH-008; DEPLOY-001/TG-001 дополнительные specification tracks. Не начинать второй slice автоматически.

## Проверки и фиксация

32 protocol tests локально passed: synthetic SHA256/PKCE Python+Node, wrong kind/ambiguous credentials, UUID/status/expiry/audience/version/scopes, extra roles/secrets, owner no scope escalation. Тестовый oracle не runtime verifier. Full isolated all414 +harness4 =418 passed без failed/skipped, native PG18.6, check.py/git diff pass. CI/Git результаты после push в report/tasks; не подменять будущие реальные PG auth/rotation/provider/device acceptance этим результатом.

Runner source-copy без .env/real HOME/DB, внешняя сеть blocked; identity добавлена в required all/CI. Native PG foundation29 и существующие service/legacy regressions обязательны. Для команды использовать pinned test Python + native initdb/postgres (core/README), missing dependency fail/no skip. SECRET values в модель/Git/test fixtures не читать.

## Принятый дизайн и остальная основа

- DESIGN-001 **done**: Поток/Игрушечная/Лента/Unbounded/Manrope,100/503, версия4 просмотрена и принята владельцем. [Демо](https://qubite-material-lab-kirill.kuzmichevkonstantin9.chatgpt.site/#/flux/appearance), [Color Plastic](../design/COLOR_PLASTIC.md), [Flux](../design/FLUX_DESIGN_SYSTEM.md), [отчёт](../reports/QUB-DESIGN-001.md). 133 browser +386 existing checks =519 в предыдущем cycle; UI не меняли, browser повторно не запускали. UI-002/PET-* backlog; scripted companions/gaze/8 events/3 speech modes; hidden/edge appearance placement при реализации экранов. Final layout отдельно.
- Static demo owner-private, hosting.json exact project_id reuse; source8e8aba31/version4/deploymentappgdep_6acd9fa05db08191b83a91968a2a70e6 succeeded13.10.2026 03:04:14UTC; CI no autopublish. Владелец сам прошёл browser gate, agent sign-in не повторять; this task без публикации.
- TEST-0016952277/CI38207835631: legacy L01cookie500/L02Googlecallbackswitch/L03unverifiedemaillink остаются НЕ исправлены. CORE-001a85f047/CI38211426535, native18.6 local/16.15 CI,29 cases; startup без DB/DDL. Audit QUB-001ae3f71e/CI38197926998. Исторические CI не подтверждают новый Auth runtime.
- Web/Android/Linux desktop и deploy/installer обязательны; own UI React/TS, optional Tournaments Node/SQLite/Vanilla; local development не блокировать Pi. Перед первым серверным release host/storage/ingress/staging и backup новых данных/найденных нужных sources/explicit deploy approval. Не удалять local legacy files по fresh условию.
- Owner normal home, separate Console, tournament-only scoped roles, manual module/model grants/budgets для всех включая owner. TG text/voice automatic capture, guest support/staff grants, allowlisted controls, critical/daily deep links, analytics/load; tournament management module settings. Бот/реальные AI ещё future.
- main canonical; origin/tournaments + tagqubite-v1.0 immutable **96f0457a523b6b79f21c4092056d8fa8fa69a680**, проверены при старте AUTH-008; не force-push/change/delete. Russian commit→сразу push; push не deploy, новые данные при rollback сохранять.
- ShadeAI /home/kirill/programing/ShadeAI read-only future connector. Root V2 filename отсутствует. deploy/.env filled/untracked известен, values не читались; не хранить secrets/private DB/browser/session/message content. Skills/reset/subagents не использовать по прямому запросу. Source master/access не изменялись, все48 идей сохранены.
