# ADR-0007: необходимые legacy возможности на FastAPI и Telegram capture

**Уточнение 13.10.2026:** [ADR-0013](0013-fresh-identity-and-unified-login.md) отменяет обязательный legacy Auth bridge/password/session import/login alias. Владелец сообщил об отсутствии аккаунтов и текущего деплоя; новый identity создаётся с нуля, owner bootstrap локальный. Ниже сохранено историческое решение12.10; стек/границы модулей и продуктовая access policy сохраняются.

CONFIRMED 12.10.2026 последним уточнением владельца: нужные новой платформе функции старого Qubite реализуются на FastAPI. Предложение сделать legacy JS adapter постоянной основой этих функций отменено. Новое ядро — Python/PostgreSQL, frontend React/TS. Старый Node/Auth служит только непрерывности существующих сервисов до verified cutover.

## Граница Tournaments

Общие identity/users/sessions/OAuth, настройки, permissions, support, analytics/observability и command API новой платформы создаются на FastAPI с тестами совместимости старого поведения. Control bot — отдельный Python worker с общими domain API. Не копировать монолит целиком и не переносить старые глобальные role/paid bypass.

Специфический tournament engine: tournament/task/team/roster/join/submission/scoring/rating — сохраняется Node.js/SQLite с одним legacy writer. Полный перенос этого engine на FastAPI не включён в текущий scope. Приоритет — новая платформа. Турниры остаются отдельным опциональным модулем; можно отключить routing/навигацию, не удаляя архив/данные. Конкретное включение на production решается отдельно, текущие работающие сервисы не выключать по этому ADR. Если модуль снова понадобится, сначала characterization и scoped adapter; полная Python перепись только отдельным roadmap.

Нужные service adapters не означают переписать AliasVault/Memos/Vikunja/Search/Hermes или создавать новый личный Telegram listener. Их native процессы/данные сохраняются, target platform grants/commands/reporting реализуются в core. При cutover — один authority/write owner на сущность, stable mappings, backup/restore и проверка cookie/native clients; no dual writes.

## Ответы TG-1..6

Существующий control bot/имя сохраняется. Linked пользователь отправляет текст/голос в обычный чат, без выбора модуля: agent сохраняет, структурирует и раскладывает по доступным личным Notes/Tasks/Inbox. Владелец явно разрешил эту bounded автоматизацию, поэтому выбор категории/подтверждение каждого простого нового capture не требуется. Guest без привязки попадает в Support, не в чей-либо Docs. Ошибочный routing можно исправить/отменить, исходник сохраняется.

Management start/stop по allowlist с подтверждением сохраняется; restart как отдельное allowlisted действие после проверки. Destructive account/data deletion и deployment не входят в basic bot commands. Support доступен гостям, сейчас отвечает owner; позже owner выдаёт отдельные support.read/reply/manage grants выбранным пользователям («модераторам поддержки»). Tournament moderator не получает их автоматически.

Критичные alerts + ежедневная сводка, уведомления в Qubite и Telegram связаны общим event/resource ID. Ссылка открывает соответствующий доступный раздел сайта/desktop/Android; нельзя помещать session/secret в URL, права проверяются при переходе. Delivery/channel preferences/quiet hours и время сводки настраиваемые; пока реальное расписание и sends не включены. Analytics агрегированная; подробные тексты/история личных действий по умолчанию не нужны.

Это архитектурные решения, не реализованные capabilities. Конкретные capture/identity/bot/notifications slices выполняются по task dependencies, без live deploy.
