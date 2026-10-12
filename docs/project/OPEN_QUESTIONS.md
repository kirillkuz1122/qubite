# Решения владельца и оставшиеся вопросы

Ответы получены 12.10.2026. Основной стек согласован; не спрашивать эти вопросы повторно. Детальные engine/UX/recovery выборы не считать автоматически принятыми.

| Вопрос | Решение / состояние |
|---|---|
| Q-ARCH | CONFIRMED Python/FastAPI modular core, React/TypeScript UI |
| Q-DB | CONFIRMED PostgreSQL нового core; SQLite турниров сохраняется |
| Q-IDENTITY | Владелец делегировал выбор. Переиспользовать серверный Auth в переходе, новый UI, убрать account code-entry/лишние поля; целевой перенос identity в Python/Postgres отдельно. [ADR-0005](../architecture/decisions/0005-identity-transition.md) |
| Q-ROLLOUT | Автодеплоя нет. Новый UI разрабатывается отдельно от рабочего сайта; /next — предложенный временный адрес для проверки, не выбранный production URL. Согласовано deploy/ и installer |
| Q-CLIENTS | CONFIRMED сайт + Android + Linux desktop; предусмотреть Windows/macOS. Tauri desktop и Kotlin Ink — инженерный выбор для POC |
| Q-DATA | Backup storage сейчас нет; GitHub сохраняет код, не является runtime backup. Destination/RPO/RTO выбрать перед миграцией/деплоем, не блокирует локальные synthetic тесты |
| Q-INK | Пользователь назвал Lenovo Xiaoxin Pad 2025. Точные model ID/Android/стилус уточняются при hardware probe, возможности не подтверждены |

Отложено: сервер/VPS, production hostname/routes, backup destination/retention/RPO/RTO, физическая проверка пера. Life key recovery/offline revoke retention, Docs engine и визуальный дизайн требуют отдельных POC/решений перед соответствующей реализацией. Не блокируют изолированный core и characterization tests.

Уже определено: ordinary owner home, manual grants/no tariffs, scoped tournament roles, собственные Docs/Planner, Shade только connector, paid test/deploy отдельно. Root kickoff V2 отсутствует; доступный kickoff задаёт цели. Если появится другой V2, сравнить требования перед исполнением.

## Дополнение: бот и аналитика — pending ответы

- TG-1: сохраняем существующий control bot/username и делаем отдельные owner/user меню, или новый bot? Рекомендация прежний bot + scoped menus. Никаких токенов в ответах не нужно.
- TG-2: everyday capture (заметки/задачи/напоминания/voice) и AI/Hermes commands в этом боте нужны, или только management/support/status? Рекомендация сначала management/support/status; capture отдельным bounded slice, Hermes не дублировать.
- TG-3: start/stop/restart по fixed allowlist разрешать из Telegram с подтверждением? Hard account/data deletion и live deploy оставить web Console/отдельному release runbook? Рекомендация да start/stop после review; destructive/deploy не включать в basic bot flow.
- TG-4: Support доступен незарегистрированным посетителям? Отвечает только owner или отдельный support staff grant? Не наследовать support от tournament role.
- TG-5: критичные alerts сразу (отказы/backup/budget/security), плюс дневная сводка или только вручную? Период/timezone/quiet hours согласовать до scheduled sends.
- TG-6: аналитика агрегатов пользователей/модулей/AI и серверов достаточна, или нужны подробные события посещений отдельных аккаунтов? Retention и protected/private content не угадывать; рекомендация агрегаты, минимальные отдельные security logs.

Эти ответы уточняют bot/analytics задачи, не останавливают уже согласованный локальный foundation/design/deploy specification.
