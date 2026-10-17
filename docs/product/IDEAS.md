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
| IDEA-020 | **Qubite Cloud + Airdrop (Nearby)** | Своё облако + обмен файлами между устройствами рядом, как AirDrop: автопоиск устройств, без центрального сервера, временные общие пространства | Файлы ядра, Device Bridge | marked |
| IDEA-021 | Qubite Music | Музыка | — | new |
| IDEA-022 | Qubite Films | Фильмы | — | new |
| IDEA-023 | Qubite Помощник (как Алиса / Джарвис) | Голосовой ассистент | EPIC-AGENTS, Dragon (IDEA-047) | new |
| IDEA-024 | Qubite VirusTotal / Sandbox | Проверка файлов, изоляция подозрительных программ | — | new |
| IDEA-025 | Qubite Home | Home Assistant + Shade AI | accepted → [QUBITE_HOME](QUBITE_HOME.md) |
| IDEA-026 | **Qubite Desktop for Android** | Лаунчер: AI Desktop Remix, Adaptive Workspace, Smart Launcher (= Command), Live Widgets Studio, рабочие пространства, Stylus Desktop, Continuity Android↔Linux, расширения (RAW §3) | CLI, HOME-04, SYNC-06 | new |
| IDEA-027 | **Qubite Trace (факт-чекинг)** | Проверка фактов и происхождения информации: первоисточники, даты, противоречия, цепочка распространения. Владелец видит это как функцию, а не отдельный продукт | EPIC-SEARCH, KNOW | marked |
| IDEA-028 | Qubite Manufacture | От 3D-модели к изделию: пригодность, материал, способ производства, документация, 3D-принтеры/CNC | IDEA-015 | new |
| IDEA-029 | **Qubite Access** | Адаптация устройства под человека: голос, взгляд, крупные элементы; общие настройки доступности между приложениями | UX-06 | marked |
| IDEA-030 | Liquid Compute | Все устройства как один компьютер, распределённые задачи с контрольными точками; первый эксперимент — очередь задач на 2–3 устройства | IDEA-001 | new |
| IDEA-031 | Системные инструменты Linux | Doctor, Bridge (планшет как монитор/графпланшет), Devices, Energy, Port, Firewall, Input, Display, Driver Hub, Thermal, Containers, NetScope, Universal Clipboard, Permissions, Matter, Twin, Format (RAW §7) | IDEA-013/014 | new |
| IDEA-032 | **Удалённый доступ** (как TeamViewer/AnyDesk) | Открыл, получил код, подключился, без регистрации и настройки серверов | — | marked |
| IDEA-033 | **AppBridge (как iPhone Mirroring)** | Не эмулятор: телефон лежит рядом, а с ПК управляешь его приложениями в отдельных окнах; уведомления, буфер обмена и файлы — на ПК. Как iPhone Mirroring у Apple. Связано с Qubite OS (IDEA-014) | IDEA-020, IDEA-014 | marked |
| IDEA-034 | **FileMorph** | Универсальный конвертер (FFmpeg, Pandoc, LibreOffice под красивой оболочкой), пакетно, с предпросмотром и проверкой потерь (Qubite Format) | — | marked |

## 3. Эталоны: на какие продукты опираемся

Часть отметок владельца — не новые идеи, а **эталоны**: готовые продукты, по которым мы равняемся при доработке своих модулей ([D-128](DECISIONS.md)). При проектировании модуля агент изучает эталон и предлагает, что взять.

| Модуль Qubite | Эталон | Что берём |
|---|---|---|
| **Qubite Command** | Raycast, TextExpander | Быстрые команды, расширения, шаблоны текста с переменными, автоматизация |
| **Planner** | Sunsama, Akiflow | Дневное планирование: задачи + календарь + таймблокинг + фокус в одном экране |
| **Finance** | YNAB, Quicken | Красивый личный бюджет, удобный мобильный ввод, импорт выписок, прогноз платежей и долгов |
| **Writer** | Grammarly | Улучшить существующую проверку текста (LanguageTool): стиль, объяснения, расширение, свои LLM |
| **Турниры / Learn** | Quizlet | Переработать турниры: карточки, тесты, интервальное повторение |
| **Reader** (новый модуль) | Readwise Reader | **Владелец хочет реализовать**: библиотека книг, статей, PDF, видео; выделения → карточки повторения |

Отмечены как **идеи** (без пояснений — разобрать позже): FileMorph (IDEA-034), удалённый доступ как TeamViewer/AnyDesk (IDEA-032), Dragon Professional — диктовка и голосовое управление ПК, Subscription Exit Assistant.

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
