# Документация Qubite

Карта документов. Если не знаешь, с чего начать, — начни с **жирных**.

## Продукт — что и зачем

| Документ | О чём |
|---|---|
| **[product/VISION.md](product/VISION.md)** | Что такое Qubite, принципы, модули, MVP |
| **[product/DECISIONS.md](product/DECISIONS.md)** | Все решения владельца — главный источник истины |
| [product/MODULES.md](product/MODULES.md) | Каталог модулей: статус, поддомены, что из legacy |
| [product/REQUIREMENTS.md](product/REQUIREMENTS.md) | Реестр требований с ID и критериями готовности |
| [product/OWNER_CONSOLE.md](product/OWNER_CONSOLE.md) | Панель владельца |
| [product/QUBITE_HOME.md](product/QUBITE_HOME.md) | Будущий умный дом: Home Assistant + Shade AI |
| [product/IDEAS.md](product/IDEAS.md) | Банк идей владельца (не одобрены) |

## Архитектура — как устроено

| Документ | О чём |
|---|---|
| **[architecture/OVERVIEW.md](architecture/OVERVIEW.md)** | Стек, схема, структура репозитория, варианты |
| [architecture/CURRENT_STATE.md](architecture/CURRENT_STATE.md) | Аудит: что есть в репозитории сейчас |
| [architecture/AUTH_AND_PERMISSIONS.md](architecture/AUTH_AND_PERMISSIONS.md) | Аккаунты, вход, права, негативные тесты |
| [architecture/AI_COST_GUARD.md](architecture/AI_COST_GUARD.md) | AI-шлюз и бюджеты |
| [architecture/DATA_MODEL.md](architecture/DATA_MODEL.md) | Объекты, связи, таблицы |
| [architecture/SYNC_AND_HISTORY.md](architecture/SYNC_AND_HISTORY.md) | Офлайн, синхронизация, версии |
| [architecture/CLIENTS.md](architecture/CLIENTS.md) | Web, Tauri, Android, Ink |
| [architecture/AI_AGENTS_MEMORY_SKILLS.md](architecture/AI_AGENTS_MEMORY_SKILLS.md) | Агенты, память, навыки, помощники |
| [architecture/PLUGINS_AND_MCP.md](architecture/PLUGINS_AND_MCP.md) | MCP, Context Capsules, плагины |
| [architecture/decisions/](architecture/decisions/) | ADR — почему выбрано именно так |

## Дизайн

| Документ | О чём |
|---|---|
| **[design/DESIGN_SYSTEM.md](design/DESIGN_SYSTEM.md)** | «Поток» + «Игрушечная»: цвета, шрифты, движение, производительность |
| [design/COMPANIONS.md](design/COMPANIONS.md) | Помощники-питомцы и разбор видео-эталона |
| [design/REFERENCES.md](design/REFERENCES.md) | Референсы по ощущению и выбор владельца |
| [design/CLAUDE_DESIGN_PROMPT.md](design/CLAUDE_DESIGN_PROMPT.md) | Промпт для Claude Design: поиск визуального языка |

## Разработка и эксплуатация

| Документ | О чём |
|---|---|
| **[engineering/AGENT_WORKFLOW.md](engineering/AGENT_WORKFLOW.md)** | Как агент выполняет задачи, Definition of Done |
| [engineering/TEST_STRATEGY.md](engineering/TEST_STRATEGY.md) | Тесты и CI |
| [engineering/DEVELOPMENT.md](engineering/DEVELOPMENT.md) | Окружение и команды |
| [engineering/DEPLOYMENT.md](engineering/DEPLOYMENT.md) | Raspberry Pi, домены, установщик, бэкапы |

## План и состояние

| Документ | О чём |
|---|---|
| **[project/STATUS.md](project/STATUS.md)** | Где остановились, открытые вопросы |
| **[plan/ROADMAP.md](plan/ROADMAP.md)** | Этапы MVP и эпики после него |
| [plan/TASKS.md](plan/TASKS.md) | Карточки задач |

## Исходный контекст (не редактируется)

| Документ | О чём |
|---|---|
| [context/QUBITE_MASTER_CONTEXT.md](context/QUBITE_MASTER_CONTEXT.md) | Полное видение v1.1: 48 идей, все модули |
| [context/QUBITE_ACCESS_AND_OWNER_CONSOLE.md](context/QUBITE_ACCESS_AND_OWNER_CONSOLE.md) | Политика доступа и бюджетов |
| [context/QUBITE_AGENT_KICKOFF_PROMPT.md](context/QUBITE_AGENT_KICKOFF_PROMPT.md) | Стартовый промпт для агента |
| [context/codex-session-2026-10-12.md](context/codex-session-2026-10-12.md) | Переписка с Codex 12–15.10.2026 |
| [context/ideas-2026-10-17/RAW.md](context/ideas-2026-10-17/RAW.md) | Все идеи владельца 17.10.2026 дословно |
| [context/ideas-2026-10-17/SCREENSHOTS.md](context/ideas-2026-10-17/SCREENSHOTS.md) | Текстовая расшифровка скриншотов с пометками |

Старая документация — в [`legacy/qubite-v1/docs/`](../legacy/qubite-v1/docs/).

**Правило:** если документ расходится с кодом — верим коду и исправляем документ. Если расходится с [DECISIONS](product/DECISIONS.md) — верим DECISIONS.
