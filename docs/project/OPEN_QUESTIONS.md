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

## Дополнение: бот и аналитика — ответы получены 12.10.2026

| Вопрос | Ответ |
|---|---|
| TG-1 | Сохранить прежнего control bot/имя |
| TG-2 | Текст/голос в обычный чат без выбора раздела; AI auto capture/format/route в доступные личные объекты, raw persist до AI |
| TG-3 | Allowlisted service controls с подтверждением; destructive/deploy отдельным flow |
| TG-4 | Гостевая поддержка, сейчас owner; позже owner выдаёт отдельные support grants выбранным пользователям |
| TG-5 | Critical alerts и daily digest; события/ссылки ведут в Qubite, каналы/время настраиваемы |
| TG-6 | Агрегированная аналитика, без подробных private content logs по умолчанию |

Последнее уточнение: нужные новой платформе общие функции старого Qubite реализовать на FastAPI. Node/Auth только временно для непрерывности; специфический tournament engine Node/SQLite не переписываем полностью сейчас. [ADR-0007](../architecture/decisions/0007-platform-extraction-and-capture.md). Bot/capture/job mechanics и event deep links: [контракт](../architecture/TELEGRAM_CAPTURE_AND_NOTIFICATIONS.md). Реальное время ежедневной сводки/каналы настраиваются перед отправками, не блокируют проектирование.
