# Банк идей

Сюда попадают идеи, которые **ещё не одобрены** для разработки. Это не план и не обещание. Владелец: «больше половины — кал, потом буду выбирать». Когда идею выбирают, она переходит в [REQUIREMENTS](REQUIREMENTS.md) или эпик в [ROADMAP](../plan/ROADMAP.md) с решением в [DECISIONS](DECISIONS.md), а здесь получает пометку.

**Статусы:** `new` — записана; `marked` — владелец отметил на скриншотах (сигнал интереса, ещё не решение); `covered` — уже есть в требованиях/плане; `accepted` — взята в план; `rejected` — отказались (с причиной).

**Исходный текст всех идей дословно** (около 250 пунктов: заметка «Кубит 2.0», Desktop for Android, Browser, 100 + 100 идей ChatGPT, Liquid Compute, системные инструменты, скриншоты): [context/ideas-2026-10-17/RAW.md](../context/ideas-2026-10-17/RAW.md).

## 1. Идеи из разговора

| ID | Идея | Статус |
|---|---|---|
| IDEA-001 | Свои серверы и устройства в Qubite, распределение нагрузки между ними (развитие — Liquid Compute, IDEA-030) | new |
| IDEA-002 | Агент выполняет работу на другом устройстве (например, открывает Photoshop на ПК через MCP, если тот онлайн) | new |
| IDEA-003 | Агенты общаются друг с другом и с Shade AI: передают замеченное и задачи | new |
| IDEA-004 | Ярлыки модулей как у VK | accepted → [D-125](DECISIONS.md) |

## 2. Новые продуктовые направления (заметка «Кубит 2.0» + подборки)

Каждое — потенциально отдельный модуль или продукт экосистемы. Обоснование названия по [D-117](DECISIONS.md) — при принятии.

| ID | Направление | Суть | Связь с планом | Статус |
|---|---|---|---|---|
| IDEA-010 | Здоровье | Модуль здоровья | — | new |
| IDEA-011 | Отслеживание олимпиад | Календарь и трекинг олимпиад, подготовка | EPIC-LEARN, турниры | new |
| IDEA-012 | Редактор кода | Свой редактор кода; Olympiad Judge, Code Visualizer, Algorithm Playground | — | new |
| IDEA-013 | **Qubite Desktop** (Linux) | Аналог GNOME/KDE, тайлинг, сервисы Qubite встроены | Расширяет Tauri-клиент | new |
| IDEA-014 | **Qubite OS** | Дистрибутив на базе CachyOS + Qubite Desktop: умный курсор, магазин приложений, AI-функции, лёгкий переход с Windows, свобода интерфейса и выбора стиля, лёгкий установщик и live-система | — | new |
| IDEA-015 | Qubite CAD | Аналог Fusion 360/Blender, web и desktop | — | new |
| IDEA-016 | Qubite Art | На основе идей ArtCraft, но связан с экосистемой: свой минималистичный интерфейс, есть web-версия | EPIC-STUDIO | new |
| IDEA-017 | Qubite Password | Свой менеджер паролей (passkeys, TOTP, автозаполнение; AI не видит хранилище) | EPIC-VAULT | new |
| IDEA-018 | **Qubite Browser** | Браузер с 20 функциями: Site Remix, Feature Injection, Teach by Doing, Agent Tabs, Knowledge Capture, Project Sessions и др. (RAW §4) | Расширение Writer/Search | new |
| IDEA-019 | AI-детектор и «очеловечивание» | Проверка текста на AI и оригинальность + переписывание | EPIC-WRITER | new |
| IDEA-020 | **Qubite Cloud + Airdrop / Nearby** | Своё облако + обмен между устройствами рядом без центрального сервера, автопоиск устройств, временные общие пространства | Файлы ядра, Device Bridge | marked |
| IDEA-021 | Qubite Music | Музыка | — | new |
| IDEA-022 | Qubite Films | Фильмы | — | new |
| IDEA-023 | Qubite Помощник (как Алиса / Джарвис) | Голосовой ассистент | EPIC-AGENTS, Dragon (IDEA-047) | new |
| IDEA-024 | Qubite VirusTotal / Sandbox | Проверка файлов, изоляция подозрительных программ | — | new |
| IDEA-025 | Qubite Home | Home Assistant + Shade AI | accepted → [QUBITE_HOME](QUBITE_HOME.md) |
| IDEA-026 | **Qubite Desktop for Android** | Лаунчер: AI Desktop Remix, Adaptive Workspace, Smart Launcher (= Command), Live Widgets Studio, рабочие пространства, Stylus Desktop, Continuity Android↔Linux, расширения (RAW §3) | CLI, HOME-04, SYNC-06 | new |
| IDEA-027 | **Qubite Trace** | Расследование происхождения информации: первоисточники, даты, противоречия, цепочка распространения | EPIC-SEARCH, KNOW | marked |
| IDEA-028 | Qubite Manufacture | От 3D-модели к изделию: пригодность, материал, способ производства, документация, 3D-принтеры/CNC | IDEA-015 | marked (пометка неразборчива) |
| IDEA-029 | **Qubite Access** | Адаптация устройства под человека: голос, взгляд, крупные элементы; общие настройки доступности между приложениями | UX-06 | marked |
| IDEA-030 | Liquid Compute | Все устройства как один компьютер, распределённые задачи с контрольными точками; первый эксперимент — очередь задач на 2–3 устройства | IDEA-001 | new |
| IDEA-031 | Системные инструменты Linux | Doctor, Bridge (планшет как монитор/графпланшет), Devices, Energy, Port, Firewall, Input, Display, Driver Hub, Thermal, Containers, NetScope, Universal Clipboard, Permissions, Matter, Twin, Format (RAW §7) | IDEA-013/014 | new |
| IDEA-032 | **Удалённый доступ** (как TeamViewer/AnyDesk) | Открыл, получил код, подключился, без регистрации и настройки серверов | — | marked |
| IDEA-033 | **AppBridge** | Android-приложения на ПК отдельными окнами, общий буфер и файлы (scrcpy + Waydroid в простом продукте); связка устройств «как у Apple» | IDEA-020 | marked |
| IDEA-034 | **FileMorph** | Универсальный конвертер (FFmpeg, Pandoc, LibreOffice под красивой оболочкой), пакетно, с предпросмотром и проверкой потерь (Qubite Format) | — | marked |

## 3. Что владелец отметил на скриншотах (сигналы интереса)

| Отметка | Что | Куда ложится |
|---|---|---|
| Sunsama / Akiflow | Сверхудобный дневной планировщик: задачи + календарь + таймблокинг + фокус | **Planner** (PLAN-03, PLAN-07, PLAN-09) и Focus — эталон UX |
| **Readwise Reader «!!!»** | Единая библиотека статей, книг, PDF, видео; выделения → карточки повторения | Новый модуль чтения: Read Later, Source Library, Knowledge Capture, Media Highlights + LEARN-03 |
| YNAB, Quicken | Красивый личный бюджет, удобный мобильный ввод, импорт выписок; прогноз платежей и долгов | **Finance** (LIFE-03) — эталон UX |
| Quizlet («переработать турнирс») | Карточки, тесты, интервальное повторение | **Турниры + учёба** ([D-006](DECISIONS.md)), LEARN-03 |
| Grammarly | Проверка грамматики, расширение, свои LLM, RU/EN | **Writer** (EPIC-WRITER) |
| Dragon Professional | Офлайн-диктовка и голосовые команды в любой программе | CMD-05 (голос) → голосовое управление ПК |
| Raycast, TextExpander | Быстрые команды, шаблоны, автоматизация | **Qubite Command** на desktop (Action Bar, Smart Snippets) |
| Subscription Exit Assistant | Что за подписки, где отменить, контролируемая отмена | Finance + Mail Assistant |
| Trace, Nearby/Airdrop, Access, FileMorph, TeamViewer, AppBridge | См. таблицу §2 | — |

## 4. Уже покрыто требованиями или планом

Многие идеи совпадают с тем, что уже записано. При выборе они не создают новых модулей, а уточняют существующие:

| Идеи (RAW) | Уже есть |
|---|---|
| Qubite Cards, Exam Simulator, Oral Examiner, Mistake Atlas, Adaptive Practice, Socratic Tutor, Exam Forecast, Skill DNA, Explain-Back | LEARN-03…LEARN-06 (Skill Tree, Mistake Library, AI Oral Exam…) |
| Ink Studio, Smart Math Ink, Diagram Ink, Ink Search, Lecture Replay, Print Composer, Infinite Canvas | INK-*, LEARN-04/05, I-25, I-32 |
| Smart Tasks, Smart Calendar, Time Blocking, Next Action, Decision Journal, Deadline Simulator | PLAN-01…PLAN-10 |
| Focus Mode, Resume Engine, Interruptions Inbox | LIFE-04, SYNC-06, Inbox (CMD) |
| Multi-Model Chat, Model Router, AI Budget Manager, Agent Permissions, Agent Timeline | AI-*, AGT-*, ACC-05 |
| Context Passport, Work Capsules | EXT-04 (Context Capsules) |
| Flow Builder, Context Triggers, Automation Sandbox, Notification Router | EXT-01/02 (Pulse), HOME-05 |
| Android Share Actions, Universal Capture | CMD-08, CMD-02 |
| Time Machine, Encrypted Sync, Migration Center | SYNC-05, LIFE-01, PLT-11 |
| Semantic Explorer, Source Chat, Answer Verifier | KNOW-02/03, Search |
| Backup Fire Drill | OPS-02 (тестовое восстановление) |
| Agent Contract, Proof of Work, Autonomous QA, Agent Pre-Mortem | Частично — правила работы агента ([AGENT_WORKFLOW](../engineering/AGENT_WORKFLOW.md)) |

## 5. Остальное

Все прочие идеи (данные без хаоса, инструменты программиста, домашний сервер, фриланс, физический мир, эксперименты) — в [RAW.md](../context/ideas-2026-10-17/RAW.md) по разделам. Статус всех — `new`. Разбирать их будем по запросу владельца, по одному разделу за раз.
