# Каталог модулей Qubite

Модуль — это отдельная область продукта со своим идентификатором, правами, настройками, бюджетом AI и (если нужно) поддоменом. Все модули используют одно ядро: аккаунты, права, объекты, связи, историю, синхронизацию и AI-шлюз.

**Статусы реализации:** `planned` — только в плане; `in_progress` — в работе; `beta` — можно пользоваться; `stable` — готово. **Сейчас (17.10.2026) все модули нового Qubite в статусе `planned`.** Работает только старый код в `legacy/qubite-v1/`.

**Поддомены** задаются в установщике ([D-009](DECISIONS.md), [D-035](DECISIONS.md)). Ниже `<domain>` — основной домен, например `qubiteapp.ru` или `qubiteapp.online`.

## Ядро и оболочка

| ID | Название | Что делает | Адрес | Этап | Статус |
|---|---|---|---|---|---|
| `core` | Ядро | Аккаунты, сессии, права, бюджеты AI, объекты, связи, история, синхронизация, события, файлы | `api.<domain>` | MVP | planned |
| `auth` | Qubite Auth | Вход, регистрация, приглашения, подтверждение почты, восстановление, OAuth, вход приложений | `auth.<domain>` | MVP | planned |
| `shell` | Оболочка | Лендинг, главная, навигация, профиль, настройки, каталог модулей | `<domain>` | MVP | planned |
| `owner` | Owner Console | Пользователи, гранты, бюджеты, тумблеры платформы, модули, интеграции, журнал. Только владелец | `<domain>/settings/owner` | MVP | planned |
| `command` | Qubite Command | Нижнее поле: поиск, команды, создание, захват мыслей, AI-запросы. `Ctrl+K` на ПК | везде | **MVP, первый** | planned |
| `inbox` | Входящие | Всё новое: мысли, ссылки, файлы, голос, сообщения из Telegram; AI предлагает разбор | `<domain>/inbox` | **MVP, первый** | planned |
| `today` | Главная / Today | Сводка дня из проверенных виджетов | `<domain>` | MVP (простая) → P2 | planned |
| `notify` | Уведомления | Сигналы, дедупликация, сводки, push, Telegram | — | MVP (базово) | planned |
| `ai` | AI-шлюз | Провайдеры, модели, маршрутизация, бюджеты, журнал расходов (AI Cost Center) | — | MVP | planned |

## Рабочие модули

| ID | Название | Что делает | Адрес | Этап | Статус |
|---|---|---|---|---|---|
| `planner` | Planner | Проекты, задачи, сроки, зависимости, список/Kanban/календарь/Гант, повторения, напоминания | `plan.<domain>` | MVP | planned |
| `docs` | Docs | Блочный редактор, заметки, шаблоны, связи, версии, Markdown, формулы | `docs.<domain>` | MVP | planned |
| `ink` | Ink | Рукописные конспекты, перо, страницы и бесконечный холст, PDF, реплей, почерк | приложение Android; просмотр в web | MVP (базово) → P3 | planned |
| `atlas` | Atlas | Граф знаний, глобальный поиск по смыслу | `atlas.<domain>` | P2 | planned |
| `learn` | Learn / School | Предметы, уроки, ДЗ, карточки (FSRS), квизы, записи уроков, школьный дневник | `learn.<domain>` | P2 | planned |
| `agents` | Агенты и помощники | Личные/проектные агенты, память, навыки, четыре помощника-питомца + Shade AI («тень», без маскота) | — | P2 (питомцы в UI — раньше) | planned |
| `pulse` | Pulse | Автоматизации, расписания, события, dry-run | — | P2 | planned |
| `teams` | Teams | Команды, совместное редактирование, ссылки, гости, голосования | — | P3 | planned |
| `life` | Life | Приватный дневник, временная шкала, письма в будущее | `life.<domain>` | P3 | planned |
| `finance` | Finance | Счета, операции (двойная запись), бюджеты, Kwork-доходы, налоги | `finance.<domain>` | P3 | planned |
| `focus` | Focus / Guardian | Таймер, режим одной задачи, добровольные ограничения, доверенный контролёр | — | P3 | planned |
| `studio` | Studio | Рисование, слои, анимация | — | P3 | planned |
| `reader` | Reader | Библиотека книг, статей, PDF, видео; выделения → карточки повторения; эталон — Readwise Reader ([D-129](DECISIONS.md)) | `read.<domain>` | P2 | planned |
| `home` | Qubite Home | Умный дом на базе Home Assistant + Shade AI как мозг автоматизаций; Qubite — интерфейс и источник данных ([QUBITE_HOME.md](QUBITE_HOME.md)) | `home.<domain>` | P3 | planned |
| `extensions` | Extensions / MCP | Plugin SDK, собственный MCP-сервер, Context Capsules, Developer Bridge | `mcp.<domain>` | P2–P3 | planned |

## Сервисы, переписываемые из legacy

Все они сейчас работают только в старом коде. План ([D-005](DECISIONS.md), [D-101](DECISIONS.md)): перед каждой задачей заново спрашиваем владельца, что нужно, проектируем как модуль нового Qubite на Rust и связываем с другими модулями.

| ID | Название | Старый код | Что сохранить по смыслу | Этап |
|---|---|---|---|---|
| `search` | Qubite Search | `legacy/qubite-v1/services/search/` (FastAPI + SearXNG), MCP `integrations/qubite-search/` | Веб-поиск с источниками, AI-ответы с проверкой, история, API-ключи для агентов | P2 |
| `writer` | Qubite Writer | `legacy/qubite-v1/back/src/writing.js`, `integrations/qubite-writing/` (расширение Firefox), LanguageTool | Проверка грамматики RU/EN, подчёркивания, AI-правки по кнопке, расширение браузера | P2 |
| `vpn` | Qubite VPN | `legacy/qubite-v1/back/src/proxy/`, `deploy/proxy/`, Flutter `app/qubite_vpn/` | Личные ссылки, ноды, подписки, клиент | P2 |
| `kwork` | Kwork / Brief / Leads | `legacy/qubite-v1/integrations/kwork/`, `services/specbot/` | Парсер заказов, интервью-бриф, поиск заявок в Telegram, переговоры — с подтверждением владельца | P2 |
| `vault` | Vault (AliasVault) | `legacy/qubite-v1/back/src/vault-integration.js`, `deploy/vault-manager.py` | Менеджер паролей с отдельным мастер-паролем; не доступен AI | P3 |
| `telegram` | Telegram-бот платформы | `legacy/qubite-v1/back/src/telegram/`, `back/telegram-worker.js` | Уведомления владельцу, управление, захват во «Входящие» | MVP (захват) → P2 |
| `tournaments` | Tournaments + учебные квизы | `legacy/qubite-v1/back/`, `front/`, `index.html` | Турниры, задачи 4 типов, команды, рейтинг Elo, + квизы в духе Quizlet. Роли organizer/moderator — внутри модуля | P3, низкий приоритет ([D-006](DECISIONS.md)) |
| `knowledge` | — | `legacy/qubite-v1/back/src/knowledge-*.js`, `integrations/qubite-knowledge/` | Не переносится: Memos/Vikunja заменяются своими Docs/Planner ([D-100](DECISIONS.md)) | — |
| `siyuan` | — | `legacy/qubite-v1/back/src/siyuan.js`, `integrations/qubite-siyuan/` | Не переносится ([D-102](DECISIONS.md)) | — |

## Внешние интеграции

| ID | Что | Как подключаем | Этап |
|---|---|---|---|
| `openrouter` | Основной AI-провайдер | Серверный ключ, allowlist моделей, бюджеты | MVP |
| `chatgpt` | Вход через ChatGPT и его лимиты | Проверить условия OpenAI ([D-061](DECISIONS.md)) | P2 |
| `hermes` | Внешний агент-исполнитель | Адаптер, ограниченные токены, импорт навыков после проверки | P2 |
| `shadeai` | Shade AI (отдельный проект `~/programing/ShadeAI`, Python) | Входит в Qubite Home: читает данные Qubite по ограниченному ключу, управляет домом через Home Assistant | P3 |
| `school` | «Госуслуги Моя школа» | Сначала исследование: есть ли разрешённый доступ; иначе ручной ввод/импорт | P2 |
| `google` | Gmail, Календарь, Drive | OAuth с минимальными scope | P3 |
| `youtube` | История и материалы | Google Takeout, Share → Qubite, расширение браузера | P3 |

## Модель доступа к модулю

У каждого модуля в каталоге:

- **установка**: `not_installed / installed`;
- **глобальное состояние**: `enabled / disabled / maintenance`;
- **готовность**: `planned / beta / stable`;
- **видимость без доступа**: `locked` (по умолчанию) или `hidden`;
- **грант пользователя**: `none / granted / revoked`, раздельно `read`, `write`, `manage`, `ai`;
- **бюджет AI** модуля и пользователя в модуле.

В коде (ACC-001): каталог — таблица `modules`, гранты — `module_grants`, решение — crate `qubite-policy` ([D-175](DECISIONS.md)). Сейчас все модули «не установлены»: их включает owner, когда модуль написан.

Подробно — в [architecture/AUTH_AND_PERMISSIONS.md](../architecture/AUTH_AND_PERMISSIONS.md) и [OWNER_CONSOLE.md](OWNER_CONSOLE.md).

## Эталоны

На какие готовые продукты опираемся при проектировании модулей ([D-128](DECISIONS.md)): Command — Raycast и TextExpander; Planner — Sunsama и Akiflow; Finance — YNAB и Quicken; Writer — Grammarly; турниры и учёба — Quizlet; Reader — Readwise Reader. Функциональные референсы из видения: Docs — Notion, Anytype, Obsidian; Ink — Notewise, GoodNotes, Procreate; холст — Miro; учёба — NotebookLM. Внешний стиль не копируем — только идеи функций и удобства.
