# Решения владельца и оставшиеся вопросы

Ответы получены12–13.10.2026. Основной стек согласован; не спрашивать эти вопросы повторно. Детальные engine/UX/recovery выборы не считать автоматически принятыми.

| Вопрос | Решение / состояние |
|---|---|
| Q-ARCH | CONFIRMED Python/FastAPI modular core, React/TypeScript UI |
| Q-DB | CONFIRMED PostgreSQL нового core; SQLite турниров сохраняется |
| Q-IDENTITY | CONFIRMED13.10.2026: аккаунтов/деплоя нет по сообщению владельца, owner создать заново; единый fresh FastAPI/Postgres вход/API для своих сервисов без bridge/import. [ADR-0013](../architecture/decisions/0013-fresh-identity-and-unified-login.md) |
| Q-ROLLOUT | Автодеплоя нет. Текущего деплоя нет по сообщению владельца; следующий server release fresh install отдельно. /next не обязательный адрес, production hostname ещё не выбран. Согласовано deploy/ и installer |
| Q-CLIENTS | CONFIRMED сайт + Android + Linux desktop; предусмотреть Windows/macOS. Tauri desktop и Kotlin Ink — инженерный выбор для POC |
| Q-DATA | Backup storage сейчас нет; GitHub сохраняет код, не является runtime backup. Destination/RPO/RTO новых накопленных данных/найденных источников выбрать перед серверным release; старые local artifacts не удалять, live account import не нужен |
| Q-INK | Пользователь назвал Lenovo Xiaoxin Pad 2025. Точные model ID/Android/стилус уточняются при hardware probe, возможности не подтверждены |

Отложено: сервер/VPS, production hostname/routes, backup destination/retention/RPO/RTO, физическая проверка пера. Life key recovery/offline revoke retention, Docs engine требует POC; материал/палитра/шрифты уже приняты, final layout/target device tests остаются перед соответствующей реализацией. Не блокируют изолированный core и characterization tests.

**Q-DESIGN, ответы 12.10.2026:** владелец подтвердил доступность демо, выбрал Milo (пятый стиль) и отверг прежнюю трактовку живости как декора. [Milo 02](../design/MILO_MATERIAL_AND_COMPANIONS.md) исследует пять механик самих controls и переходов. Податливость — настройка 0–100. Четыре помощника олицетворяют scoped AI-агентов личной жизни/проектов/заметок/дневника, разные характеры и инициативные реакции, четвёртый с очками/блокнотом. Итог13.10: Поток/Игрушечная/Лента/Unbounded/Manrope,100/503 принят. OPEN: конкретные места появления/настройки инициативы/cooldown/voice, имена/детали персонажей, physical device acceptance новой версии. Повторно не спрашивать базовый стиль или фиксированную силу; сначала показать рабочие варианты. Legacy Tournaments сохраняет прежний UI.

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

Последнее уточнение: нужные новой платформе общие функции старого Qubite реализовать на FastAPI. Node/Auth bridge больше не требуется по ADR-0013; специфический tournament engine Node/SQLite не переписываем полностью сейчас. [ADR-0007](../architecture/decisions/0007-platform-extraction-and-capture.md). Bot/capture/job mechanics и event deep links: [контракт](../architecture/TELEGRAM_CAPTURE_AND_NOTIFICATIONS.md). Реальное время ежедневной сводки/каналы настраиваются перед отправками, не блокируют проектирование.
