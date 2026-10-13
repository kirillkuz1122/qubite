> Актуально13.10.2026: [ADR-0021](decisions/0021-repository-layout-and-standalone-tournaments.md) / [карта исходников](REPOSITORY_LAYOUT.md). Tournaments — самостоятельная опциональная legacy-платформа без shared identity/SSO/grants нового core. Старые back/front/deploy теперь в legacy/qubite-v1; остальные старые сервисы reference и требуют нового interview/design/core API. Все новые модули планируются на поддоменах, ingress ещё не реализован. Исторические положения ниже о tournament adapter/общем управлении больше не текущая цель.

# Telegram, аналитика и инфраструктура: перенос существующих возможностей

CONFIRMED уточнением владельца 12.10.2026: управляющий Telegram-бот должен работать в Qubite 2.0 и быть полностью переработан; турнирное управление переносится в настройки модуля Qubite Tournaments; существующая аналитика и мониторинг сервера сохраняются/реализуются в новой платформе. Это дополнение к продолжающемуся проектированию, не требование немедленно переписать bot runtime.

## Аудит реализации

Источники: back/telegram-worker.js; back/src/telegram-bot.js; telegram/{access,menus,notifier}.js и все handlers {settings,analytics,moderation,admin,access,services,proxy,support,runtime}; back/src/service-runtime.js; HTTP handlers/collector back/server.js; stats schema/functions back/src/db.js; front/js/app.js infrastructure charts. Проверены локальные исходники, без сообщений Telegram/live вызовов/production данных.

| Реальная legacy функция | Место в Qubite 2.0 | Что сохранять / изменить |
|---|---|---|
| /start, /help, owner/moderator menus | новый control bot, role-aware menu | новый UX, account linking/scoped policy; старые global moderator права не наследовать |
| /grant, /revoke, /list Telegram staff | Owner Console → Telegram integration | stable platform subject binding и отдельные capability grants; не выдавать global admin турнирному модератору |
| регистрация, maintenance, email и OAuth switches | Owner Console → Platform/Auth | отдельный scope, audit/reauth; не переносить maintenance bearer bypass URL как target security design |
| создание/участие в турнирах switches | Tournaments → Настройки/Управление | scoped module controls, не общие platform toggles |
| tasks review approve/reject; organizer application approve/reject | Tournaments → Модерация | заявки/история/состояния, API negative tests, ограниченные права |
| список/карточка tournaments; teams/tasks list/delete | Tournaments → Управление | legacy handler карточки турниров read-only; не утверждать, что бот уже умеет создавать все сущности |
| изменение user role, block/unblock, soft delete/restore/hard delete | разделить global account management и tournament restrictions | platform block/delete только owner capability; module ban/role отдельно; sensitive operations с конкретным diff/confirmation |
| admin audit последние 20 и critical push | Owner Console → Audit, scoped module audit | owner/global и module projections раздельно; без private content/secret |
| services invites/enrollment, Search/Vault/Memos/Vikunja grants | Owner Console → Modules/Integrations | сохранить независимые grants, новый общий permission engine; не терять старые account/service bindings |
| search paid/history flags, per-user daily/hourly requests и daily/month/lifetime USD, global daily Search cap | Owner Console → AI/Costs | legacy cap не общий для всех сервисов; новый atomic cost guard, owner тоже needs explicit budget |
| AI Search reports today/30 days/model/user/reserved | Owner Console → AI analytics, bot summary | старые unknown model суммы сохраняются; Writer/Brief/Kwork reporting добавляется через adapters, без double billing |
| VPN list, renew/VIP/speed/enable/devices, NaiveProxy switch | VPN → Настройки + Owner service controls | сохранить proxy profile/node/device/API compatibility; не делать это tournament настройкой |
| /power allowlist start/stop сервисов с подтверждением | Owner Console → Infrastructure + owner bot command | independent process, fixed allowlist/root-owned manager, неизвестный outcome → refresh/status; без arbitrary shell |
| web/Telegram support chats, staff reply, close/reopen, notify new chat | общий Support/Inbox, bot adapter | сохранить conversation/source/IDs/history, поддержка не привязана к tournament moderator |
| users/sessions/registrations/visits/email aggregates | Owner Console → Platform analytics | не смешивать с турнирными submissions, privacy/retention отдельно |
| participants/live/submissions/hot tournaments, user/team results/rating analytics | Qubite Tournaments → Аналитика | scoped participant/team/organizer views, результаты/rating history сохраняются |
| uptime/load/RAM/disk/Node RSS, requests and traffic, historical charts | Owner Console → Infrastructure/Health | перенос collector/API/UI на target stack, process/node identity, корректные единицы и gaps |
| proxy node heartbeat/RAM/disk/traffic/users/devices | VPN node observability | не считать метриками master API или всего сервера, stale/offline явно |

Runtime allowlist сейчас: Qubite, Hermes, AliasVault, LanguageTool, OmniRoute, SearXNG, Hermes dashboard, Search, Brief, Memos, SiYuan, Vikunja, Kwork polling/worker, voice listener/bot. Это inventory существующих команд, не требование всем сервисам жить на одном новом сервере. Новый installer принимает фактический deployment manifest. Auth/control bot/network/SSH нельзя выключить как обычный пользовательский модуль.

## Нюансы, которые нельзя переносить механически

1. CPU chart использует cpu_load * 100, но collector пишет os.loadavg()[0] — это load average, не CPU utilization %. Новые charts обязаны различать utilization%, normalized load и 1/5/15m load.
2. Collector пишет snapshot каждые 5 минут. HTTP/traffic totals — process-local cumulative counters, после restart сбрасываются, не полный network traffic хоста. В двух процессах не суммировать повторно без collector identity/time window.
3. RAM used = total - free; это не Linux available RAM, cache не выделен. Node memoryUsage отдельно; новый collector должен определять host/cgroup/process scope и unsupported fields.
4. Disk проверяет только df /; attachments/database могут быть на другом mount. Нужны relevant volume metrics, bounded host collector, не произвольный путь из Telegram.
5. Telegram getDetailedStats("-7 days") вызывает функцию getDetailedStats(hours), которая строит -{hours} hours. Format mismatch — подтверждённое расхождение исходников, не проверенная production ошибка. Исправлять через numeric duration/UTC contract tests.
6. Support pendingReplies in-memory и не привязан к точному reply message/TTL как services prompts. Новая реализация требует exact reply + expiry, чтобы текст не ушёл не в тот чат.
7. Audit/support между процессами передаётся Unix IPC без durable очереди. Новый notification outbox рекомендован для восстановления после restart, idempotency и статуса доставки; неизвестную доставку нельзя автоматически повторять.
8. Legacy bot global moderator видит platform overview и support; новые scopes должны быть явными. Telegram identity whitelist не заменяет проверенный platform owner mapping.
9. settings handler принимает key из callback; новый command DTO использует allowlist settings и capability gate, а не свободную запись arbitrary setting key.

## Предложение новой структуры (механика пока RECOMMENDED)

Отдельный Python control-bot worker, один polling/webhook consumer на bot token. Bot — adapter общих domain API/command envelopes, не своя реализация grants/budget/SQL. Старый consumer выключается лишь при tested cutover, два consumer одновременно запрещены. Сохранение текущего bot/username согласовано владельцем; actual token используется только локально при integration acceptance; секрет в config reference, не в коде/документах.

Owner меню: Users/Grants, Modules, AI budgets/report, Infrastructure/status, Audit/Alerts, Support, Modules → Tournaments/VPN/... . Турнирные настройки/roles/moderation/stats внутри Tournaments. Обычный linked account получает только собственные команды и grants. Ответы TG получены: guest Support, linked-user text/voice automatic capture, critical alerts + daily digest и event deep links. Support staff grants отдельны; analytics агрегированная. Hermes/Brief/Kwork/личный listener остаются отдельными процессами, не объединяются автоматически с control bot.

Global analytics и Infrastructure принадлежат Owner Console. В бот идут summaries/status/deep links, графики в web/desktop Console. Configurable aggregation/retention, timezone/UTC contract, disabled/stale/missing источники не рисуются нулями. Server capacity выбор отложен до actual deployment; feature specification не зависит от Raspberry Pi.

## Проверки переноса

Feature parity checklist каждая строка матрицы → test/отдельное решение retirement. Synthetic bot update fixtures без токена и sendMessage, owner/nonowner/module moderator negative cases, tampered/expired/replayed callback, stolen linking token, exact reply/TTL, restart/unknown send/outbox, one consumer. Stats: unit correctness, process reset, two-source dedup, stale/missing/unsupported scope, periods/UTC/retention and scoped ACL. Service power: fixed IDs/diff/confirmation/unknown outcome, no arbitrary shell, Auth/bot immune. Support: scoped staff/cross-chat, old history mapping, no mistaken reply.

План миграции каждой capabilities использует source IDs и mappings; private support/query contents и env values не копировать в audit artifacts. Открытые вопросы по scope/уведомлениям/аналитике см. [вопросы](../project/OPEN_QUESTIONS.md).

Нужные общие функции реализуются на FastAPI (ADR-0007); Node хранит специфический tournament engine и временно обслуживает ещё не migrated consumers. TG-1..6 закрыты; [quick capture и уведомления](TELEGRAM_CAPTURE_AND_NOTIFICATIONS.md) дополняют parity matrix.
