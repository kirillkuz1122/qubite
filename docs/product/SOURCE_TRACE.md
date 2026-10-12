# Полная трассировка источников

Каждая непустая строка master v1.1 и access policy имеет source:line, requirement family и краткий фрагмент. Полный исходный текст хранится только в корневых документах; его не дублируем здесь. SHA256 каждой исходной строки в source-trace.json позволяет check.py обнаружить потерю деталей/устаревший mapping. Примеры source API не становятся новым stable контрактом. Приоритет/статус берутся из source и ADR.

| Source:line | Раздел | Requirement family | Начало исходной формулировки |
|---|---|---|---|
| QUBITE_MASTER_CONTEXT.md:1 | preamble | REQ-CORE-01 | # QUBITE — MASTER PRODUCT & ENGINEERING CONTEXT |
| QUBITE_MASTER_CONTEXT.md:3 | preamble | REQ-CORE-01 | **Версия:** 1.1 — 11 октября 2026 года (уточнена модель владельца, модульных прав и затрат AI)   |
| QUBITE_MASTER_CONTEXT.md:4 | preamble | REQ-CORE-01 | **Язык документа:** русский. Язык исходного кода / API — английский.   |
| QUBITE_MASTER_CONTEXT.md:5 | preamble | REQ-CORE-01 | **Статус:** видение продукта, подробные требования, границы архитектуры и стартовая карта разработки. **Это не утвержден |
| QUBITE_MASTER_CONTEXT.md:6 | preamble | REQ-CORE-01 | **Для кого:** Codex, Claude Code, любые AI-агенты, архитекторы и будущие участники проекта.   |
| QUBITE_MASTER_CONTEXT.md:7 | preamble | REQ-CORE-01 | **Главное:** НЕ начинать писать всю платформу из одного промпта. Сначала изучить реальный репозиторий и этот документ, п |
| QUBITE_MASTER_CONTEXT.md:9 | preamble | REQ-CORE-01 | > Qubite — единая персональная, а в будущем командная цифровая среда для учёбы, конспектов, работы, задач, проектов, пла |
| QUBITE_MASTER_CONTEXT.md:11 | 0 | REQ-CORE-01 / REQ-OWNER-01 / REQ-AI-01 | ## 0. Как читать этот документ и что считать решённым |
| QUBITE_MASTER_CONTEXT.md:13 | 0 | REQ-CORE-01 / REQ-OWNER-01 / REQ-AI-01 | - **[CONFIRMED]** — пользователь явно одобрил функциональную идею или принцип. Это **обязательное долгосрочное требовани |
| QUBITE_MASTER_CONTEXT.md:14 | 0 | REQ-CORE-01 / REQ-OWNER-01 / REQ-AI-01 | - **[PREFERRED]** — рекомендованное техническое решение, подлежащее проверке прототипом или исследованием; пользователь  |
| QUBITE_MASTER_CONTEXT.md:15 | 0 | REQ-CORE-01 / REQ-OWNER-01 / REQ-AI-01 | - **[EXPLORATORY]** — перспективная, но ещё не детализированная возможность; надо сохранить в бэклоге и не блокировать с |
| QUBITE_MASTER_CONTEXT.md:16 | 0 | REQ-CORE-01 / REQ-OWNER-01 / REQ-AI-01 | - **[UNVERIFIED]** — сведения о внешнем API, лицензии, железе или сервисе требуют проверки на момент реализации. |
| QUBITE_MASTER_CONTEXT.md:17 | 0 | REQ-CORE-01 / REQ-OWNER-01 / REQ-AI-01 | - **[P0/P1/P2/P3]** — очередность, не абсолютная важность: P0 — инфраструктурный фундамент и проверка рисков; P1 — ежедн |
| QUBITE_MASTER_CONTEXT.md:19 | 0 | REQ-CORE-01 / REQ-OWNER-01 / REQ-AI-01 | В разговоре пользователь подтвердил **все 48 предложений из каталога идей Qubite v0.8**. Они собраны в §20 и должны быть |
| QUBITE_MASTER_CONTEXT.md:21 | 0 | REQ-CORE-01 / REQ-OWNER-01 / REQ-AI-01 | **Не утверждать без проверки:** что конкретный школьный сервис предоставляет публичный API; что планшет поддерживает дав |
| QUBITE_MASTER_CONTEXT.md:23 | 0 | REQ-CORE-01 / REQ-OWNER-01 / REQ-AI-01 | ## 0.1. [CONFIRMED] Критическое уточнение: общий Qubite ≠ турнирная админка |
| QUBITE_MASTER_CONTEXT.md:25 | 0 | REQ-CORE-01 / REQ-OWNER-01 / REQ-AI-01 | - **Владелец использует такой же обычный пользовательский интерфейс, как и остальные**, но имеет дополнительные привилег |
| QUBITE_MASTER_CONTEXT.md:26 | 0 | REQ-CORE-01 / REQ-OWNER-01 / REQ-AI-01 | - **Никаких глобальных `organizer/moderator/tournament-admin`.** Эти исторические роли существуют исключительно в модуле |
| QUBITE_MASTER_CONTEXT.md:27 | 0 | REQ-CORE-01 / REQ-OWNER-01 / REQ-AI-01 | - Новому зарегистрированному пользователю даётся только базовый безопасный доступ, **модули и платный AI не открываются  |
| QUBITE_MASTER_CONTEXT.md:28 | 0 | REQ-CORE-01 / REQ-OWNER-01 / REQ-AI-01 | - Отдельные настройки каждого модуля и интеграции, включая Search, Tournaments, Docs, Ink, Learn, Writer, Hermes; отдель |
| QUBITE_MASTER_CONTEXT.md:29 | 0 | REQ-CORE-01 / REQ-OWNER-01 / REQ-AI-01 | - **Все проверки выполняются сервером до расходования ресурсов** и распространяются на API, AI-tools, плагины, MCP, фоно |
| QUBITE_MASTER_CONTEXT.md:30 | 0 | REQ-CORE-01 / REQ-OWNER-01 / REQ-AI-01 | - Полная модель, тестовые кейсы и сценарий миграции определены в отдельном `QUBITE_ACCESS_AND_OWNER_CONSOLE.md`; этот до |
| QUBITE_MASTER_CONTEXT.md:32 | 1 | REQ-INK-01 | ## 1. Предыстория и мотивация |
| QUBITE_MASTER_CONTEXT.md:34 | 1 | REQ-INK-01 | Изначально пользователь искал бесплатный аналог Notewise / Apple Notes / GoodNotes и хотел на недорогом Android-планшете |
| QUBITE_MASTER_CONTEXT.md:36 | 1 | REQ-INK-01 | Проверенные пользователем аналоги: |
| QUBITE_MASTER_CONTEXT.md:37 | 1 | REQ-INK-01 | - **Saber:** из опробованных понравился относительно больше, но очень не хватает функциональности, хорошей настраиваемой |
| QUBITE_MASTER_CONTEXT.md:38 | 1 | REQ-INK-01 | - **xnotes:** неудовлетворительно по торможению и качеству пера; не использовать как готовое решение без доказательств о |
| QUBITE_MASTER_CONTEXT.md:39 | 1 | REQ-INK-01 | - **Linwood Butterfly:** опробован, не понравились интерфейс и ощущения рисования. |
| QUBITE_MASTER_CONTEXT.md:40 | 1 | REQ-INK-01 | - **Notewise:** один из сильнейших ориентиров по функциональности, жестам и удобству, но закрытое платное приложение; эт |
| QUBITE_MASTER_CONTEXT.md:41 | 1 | REQ-INK-01 | - **Procreate / Apple Notes:** очень высокий стандарт по перу, плавности, продуманности и математике. **Krita:** функцио |
| QUBITE_MASTER_CONTEXT.md:42 | 1 | REQ-INK-01 | - **Notion, Anytype, Obsidian:** функциональные референсы для блоков, структурированных объектов, связей и плагинов; **и |
| QUBITE_MASTER_CONTEXT.md:43 | 1 | REQ-INK-01 | - **Miro:** референс для совместного холста, присутствия пользователей, перемещения объектов. |
| QUBITE_MASTER_CONTEXT.md:44 | 1 | REQ-INK-01 | - **NotebookLM:** разные способы освоения источников: квизы, карточки, аудио/видео, слайды, инфографики, карты знаний. |
| QUBITE_MASTER_CONTEXT.md:45 | 1 | REQ-INK-01 | - **Fusion 360 / игровые реплеи:** идеи временной шкалы действий, событийного воспроизведения, ветвления и восстановлени |
| QUBITE_MASTER_CONTEXT.md:46 | 1 | REQ-INK-01 | - **Vikunja / Memos:** пользователь **отказался** брать их как основную БД/бэкенд/UX. Их возможности могут служить функц |
| QUBITE_MASTER_CONTEXT.md:48 | 1 | REQ-INK-01 | Среда пользователя: умеет работать с Python, React, HTML/CSS, Linux, бэкендом и self-hosting; основная реализация будет  |
| QUBITE_MASTER_CONTEXT.md:50 | 2 | REQ-CORE-01 | ## 2. Название, позиционирование, продуктовая структура |
| QUBITE_MASTER_CONTEXT.md:52 | 2 | REQ-CORE-01 | **[CONFIRMED]** Временное название единой платформы: **Qubite** («Кубит»; окончательное латинское написание/домен перепр |
| QUBITE_MASTER_CONTEXT.md:54 | 2 | REQ-CORE-01 | Внутри одного аккаунта и общей оболочки: |
| QUBITE_MASTER_CONTEXT.md:55 | 2 | REQ-CORE-01 | - **Core:** идентификация, permissions, объекты, отношения, файлы, API, история, синхронизация. |
| QUBITE_MASTER_CONTEXT.md:56 | 2 | REQ-CORE-01 | - **Today / Command:** персональная домашняя сводка, универсальный мультимодальный Spotlight-подобный ввод, уведомления. |
| QUBITE_MASTER_CONTEXT.md:57 | 2 | REQ-CORE-01 | - **Docs / Notes:** собственный блочный редактор, быстрые заметки и знания. |
| QUBITE_MASTER_CONTEXT.md:58 | 2 | REQ-CORE-01 | - **Ink:** конспекты, стилус, PDF, персональный почерк, реплей. |
| QUBITE_MASTER_CONTEXT.md:59 | 2 | REQ-CORE-01 | - **Planner / Projects:** календарь, задачи, проекты, Kanban, Gantt, зависимости, расписание. |
| QUBITE_MASTER_CONTEXT.md:60 | 2 | REQ-CORE-01 | - **Learn / School:** учебные предметы, записи уроков, школьный дневник, домашние задания, обучение, тесты и карточки. |
| QUBITE_MASTER_CONTEXT.md:61 | 2 | REQ-CORE-01 | - **Knowledge / Atlas:** граф знаний, источники, видео, глобальный поиск, индекс знаний и навыков. |
| QUBITE_MASTER_CONTEXT.md:62 | 2 | REQ-CORE-01 | - **Intelligence / Memory / Actions:** личные/проектные/командные AI-агенты, память, навыки, инструменты, Hermes, автома |
| QUBITE_MASTER_CONTEXT.md:63 | 2 | REQ-CORE-01 | - **Teams:** совместное редактирование, общие проекты, голосования, роли, ссылки и гостевые доступы. |
| QUBITE_MASTER_CONTEXT.md:64 | 2 | REQ-CORE-01 | - **Focus:** интервалы работы/отдыха, режим одной задачи, добровольные ограничения устройств, Guardian. |
| QUBITE_MASTER_CONTEXT.md:65 | 2 | REQ-CORE-01 | - **Finance:** финансы проектов, заработок Kwork, расходы, бюджеты, цели, вклады/инвестиции. |
| QUBITE_MASTER_CONTEXT.md:66 | 2 | REQ-CORE-01 | - **Life:** личный дневник, приватный собеседник, временная шкала жизни, воспоминания, личное развитие. |
| QUBITE_MASTER_CONTEXT.md:67 | 2 | REQ-CORE-01 | - **Writer / Search / Studio:** языковая проверка, внешний поиск, художественное рисование и анимация. |
| QUBITE_MASTER_CONTEXT.md:68 | 2 | REQ-CORE-01 | - **Extensions / MCP / Developer Bridge:** плагины, API, SDK, экспорт контекста, Codex/Claude, Shade AI, внешние сервисы |
| QUBITE_MASTER_CONTEXT.md:69 | 2 | REQ-CORE-01 | - **Legacy management:** действующие турниры, VPN, администрирование и иные существующие Qubite-сервисы можно включить в |
| QUBITE_MASTER_CONTEXT.md:71 | 2 | REQ-CORE-01 | Названия модулей рабочие; термин «Light» обсуждался как «свет», Spotlight — «прожектор». Для глобального поля допустимо  |
| QUBITE_MASTER_CONTEXT.md:73 | 3 | NFR-SEC-01 / REQ-SYNC-01 | ## 3. Неподлежащие упрощению принципы продукта [CONFIRMED] |
| QUBITE_MASTER_CONTEXT.md:75 | 3 | NFR-SEC-01 / REQ-SYNC-01 | 1. **AI-first, not AI-only:** любое ключевое действие доступно без AI, при этом единое поле понимает человеческую речь,  |
| QUBITE_MASTER_CONTEXT.md:76 | 3 | NFR-SEC-01 / REQ-SYNC-01 | 2. **Local-first:** обычные действия, заметки, письмо и редактирование должны работать офлайн; сервер не является обязат |
| QUBITE_MASTER_CONTEXT.md:77 | 3 | NFR-SEC-01 / REQ-SYNC-01 | 3. **Одна информация — много представлений:** задача может отображаться списком, Kanban, календарём, Гантом; школьный ма |
| QUBITE_MASTER_CONTEXT.md:78 | 3 | NFR-SEC-01 / REQ-SYNC-01 | 4. **Всё связано:** типизированные связи между знаниями, людьми, проектами, задачами, учёбой, временем, источниками и ре |
| QUBITE_MASTER_CONTEXT.md:79 | 3 | NFR-SEC-01 / REQ-SYNC-01 | 5. **Качество UX важнее «100 кнопок»:** собственная дизайн-система, плавные аккуратные анимации, контекстное появление и |
| QUBITE_MASTER_CONTEXT.md:80 | 3 | NFR-SEC-01 / REQ-SYNC-01 | 6. **Каждый сервис — модуль**, а не самостоятельный закрытый остров; единые аутентификация, права, поиск, события, истор |
| QUBITE_MASTER_CONTEXT.md:81 | 3 | NFR-SEC-01 / REQ-SYNC-01 | 7. **Контроль над данными:** экспорт, бэкапы, восстановление, журнал AI, приватные области, явные разрешения, возможност |
| QUBITE_MASTER_CONTEXT.md:82 | 3 | NFR-SEC-01 / REQ-SYNC-01 | 8. **Персонализация и выбор:** темы, отступы, панели, шаблоны, кисти, бумага, шорткаты, доступные виджеты, AI-модели и у |
| QUBITE_MASTER_CONTEXT.md:83 | 3 | NFR-SEC-01 / REQ-SYNC-01 | 9. **Разделение личного и общего:** ничто из личной памяти, дневника, API-ключей или приватных сообщений не должно попас |
| QUBITE_MASTER_CONTEXT.md:84 | 3 | NFR-SEC-01 / REQ-SYNC-01 | 10. **Проверяемость:** крупные операции AI — предпросмотр diff, защита от дубликатов, права, аудит, откат. Никаких скрыт |
| QUBITE_MASTER_CONTEXT.md:85 | 3 | NFR-SEC-01 / REQ-SYNC-01 | 11. **Плавный рост:** продукт изначально проектируется для модулей и будущих пользователей, но стартует как разумный мод |
| QUBITE_MASTER_CONTEXT.md:86 | 3 | NFR-SEC-01 / REQ-SYNC-01 | 12. **Работа на телефоне, планшете, ПК и в браузере:** с передачей состояния сессии, веб-ссылками на документы и реальны |
| QUBITE_MASTER_CONTEXT.md:88 | 4 | REQ-UX-01 | ## 4. Навигация, дизайн-система и адаптивная главная [CONFIRMED] |
| QUBITE_MASTER_CONTEXT.md:90 | 4 | REQ-UX-01 | - Главный экран «Сегодня»: AI-дайджест, активные задачи, школьное расписание, дедлайны, обучение, проекты, финансы, увед |
| QUBITE_MASTER_CONTEXT.md:91 | 4 | REQ-UX-01 | - Режимы / spaces: «Учёба», «Проекты/работа», «Личное», «Творчество», «Фокус»; быстрые переключения, индивидуальные закр |
| QUBITE_MASTER_CONTEXT.md:92 | 4 | REQ-UX-01 | - Глобальное поле: искать по смыслу и точным словам, отправлять голос, текст, изображения, PDF, видео/аудио и файлы; соз |
| QUBITE_MASTER_CONTEXT.md:93 | 4 | REQ-UX-01 | - Quick capture / Universal Inbox: одно нажатие, диктовка или Share Sheet; AI предлагает заголовок, тип объекта, проект, |
| QUBITE_MASTER_CONTEXT.md:94 | 4 | REQ-UX-01 | - На планшете редактор Ink показывает прежде всего бумагу и перо; на телефоне — быстрые заметки, задачи, разговор с AI;  |
| QUBITE_MASTER_CONTEXT.md:95 | 4 | REQ-UX-01 | - На всех устройствах единые компоненты, анимационные токены, цвета, адаптивная типографика, светлая/тёмная темы, настро |
| QUBITE_MASTER_CONTEXT.md:96 | 4 | REQ-UX-01 | - UX составляется из действий, не из случайных кнопок: `+`, выделение, долгое нажатие, drag/drop, `slash`-команды, конте |
| QUBITE_MASTER_CONTEXT.md:97 | 4 | REQ-UX-01 | - Настраиваемая главная, закрепление виджетов, пользовательский порядок и разрешение AI менять только конкретные области |
| QUBITE_MASTER_CONTEXT.md:98 | 4 | REQ-UX-01 | - Командная панель проектов, обзор дедлайнов, личные и командные фильтры, уведомления, глобальная история. |
| QUBITE_MASTER_CONTEXT.md:100 | 5 | REQ-DOC-01 / REQ-DOC-02 | ## 5. Блочный редактор Docs, заметки, Markdown [CONFIRMED] |
| QUBITE_MASTER_CONTEXT.md:102 | 5 | REQ-DOC-01 / REQ-DOC-02 | **Функциональный референс:** Notion, Anytype, Obsidian, современные документы — **не копировать их внешний стиль**. Реал |
| QUBITE_MASTER_CONTEXT.md:104 | 5 | REQ-DOC-01 / REQ-DOC-02 | - Богатый редактор с блоками: обычный/форматированный текст, заголовки, списки, чекбоксы, цитаты, callout, вложенные раз |
| QUBITE_MASTER_CONTEXT.md:105 | 5 | REQ-DOC-01 / REQ-DOC-02 | - Визуальные изменения текста: выделить/передвинуть/раскрасить/масштабировать или превратить выделенное в другой тип бло |
| QUBITE_MASTER_CONTEXT.md:106 | 5 | REQ-DOC-01 / REQ-DOC-02 | - Drag/drop объектов и изображений, вставка буфера, системное «Поделиться», скриншоты, ссылки; fallback, если Android-пр |
| QUBITE_MASTER_CONTEXT.md:107 | 5 | REQ-DOC-01 / REQ-DOC-02 | - Чистая страница по умолчанию; `/`-меню, всплывающая панель при выделении, контекстные команды и AI-помощник, продолжен |
| QUBITE_MASTER_CONTEXT.md:108 | 5 | REQ-DOC-01 / REQ-DOC-02 | - AI переформулирует надиктованную мысль в грамотный красивый структурированный документ, исправляет орфографию и объясн |
| QUBITE_MASTER_CONTEXT.md:109 | 5 | REQ-DOC-01 / REQ-DOC-02 | - Пользователь может создавать свои шаблоны, базы данных/представления/коллекции объектов, заметки и страницы; вложенные |
| QUBITE_MASTER_CONTEXT.md:110 | 5 | REQ-DOC-01 / REQ-DOC-02 | - Возможные движки **[PREFERRED]**: React/TypeScript + Tiptap/ProseMirror или Lexical; выбор по сравнительному POC, не р |
| QUBITE_MASTER_CONTEXT.md:111 | 5 | REQ-DOC-01 / REQ-DOC-02 | - Поиск и навигация по заголовкам, блокам, рукописной OCR-индексации; цитирование источников и история версий. |
| QUBITE_MASTER_CONTEXT.md:113 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | ## 6. Рукописный редактор Ink: определяющий модуль [CONFIRMED] |
| QUBITE_MASTER_CONTEXT.md:115 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | ### 6.1. Ощущения и инпут |
| QUBITE_MASTER_CONTEXT.md:117 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Приятное письмо уровня лучших Android/iPad редакторов — **цель качества**, не гарантированный факт. |
| QUBITE_MASTER_CONTEXT.md:118 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Адаптивная стабилизация: учитывать скорость, ускорение, кривизну/углы, масштаб, доступные данные давления/наклона и ха |
| QUBITE_MASTER_CONTEXT.md:119 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Исследовать One Euro Filter и альтернативные фильтры; предложить предварительный низколатентный трейс и последующую мя |
| QUBITE_MASTER_CONTEXT.md:120 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Режимы «естественное», «адаптивное», «каллиграфия», профили кистей, ручные настройки степени сглаживания, толщины, дав |
| QUBITE_MASTER_CONTEXT.md:121 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Palm rejection, различение пальца и стилуса, pinch-zoom/панорамирование, аппаратные кнопки стилуса — только если устро |
| QUBITE_MASTER_CONTEXT.md:122 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Жесты: hold-to-shape (круг, прямая, прямоугольник, кривая), circle-to-lasso, scribble-to-erase, двойной/тройной тап па |
| QUBITE_MASTER_CONTEXT.md:123 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Линейка, транспортир, угольник, шаблоны фигур, snap-to-align, группировка, lock, слои, лассо, копирование/вставка, пип |
| QUBITE_MASTER_CONTEXT.md:124 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Умный контур/заливка, перетаскивание цвета с заливкой области, геометрическое выравнивание, выделение объектов без сло |
| QUBITE_MASTER_CONTEXT.md:126 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | ### 6.2. Холсты, бумага и файлы |
| QUBITE_MASTER_CONTEXT.md:128 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Тетради с страницами A4/A5, произвольными форматами, вертикальной и горизонтальной ориентацией, клетка/линия/точки/чис |
| QUBITE_MASTER_CONTEXT.md:129 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Отдельный бесконечный холст; удобно использовать как черновик, диаграмму, доску или проектную карту; экспорт выбранной |
| QUBITE_MASTER_CONTEXT.md:130 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Импорт PDF с аннотациями, высококачественный PDF-экспорт, SVG/изображения, текст, таблицы, формулы, картинки, рукописн |
| QUBITE_MASTER_CONTEXT.md:131 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Медиа можно трансформировать, обрезать, менять прозрачность, сдвигать, поворачивать; последовательность отмен и восста |
| QUBITE_MASTER_CONTEXT.md:132 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Векторные исходники и семантическое текстовое содержимое сохранять отдельно от preview/PNG/PDF. |
| QUBITE_MASTER_CONTEXT.md:133 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - На Android **[PREFERRED]** Kotlin + Jetpack Compose + Jetpack Ink; Google `android/cahier` — reference/sample, не гара |
| QUBITE_MASTER_CONTEXT.md:135 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | ### 6.3. Персональный почерк и генерация контента |
| QUBITE_MASTER_CONTEXT.md:137 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Первый профиль почерка из примеров кириллицы, латиницы, цифр, математических символов; накопление образцов по мере пис |
| QUBITE_MASTER_CONTEXT.md:138 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Разделить: (1) захват штрихов, (2) OCR/привязку к символам, (3) библиотеку векторных глифов/соединений, (4) локальное  |
| QUBITE_MASTER_CONTEXT.md:139 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Прогрессивное обучение: подтверждение малоуверенных распознаваний, исправление ошибок, ручное удаление образцов, резер |
| QUBITE_MASTER_CONTEXT.md:140 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Генератор рукописного текста **работает непосредственно на планшете**; OpenRouter/сервер готовит содержание, а не рису |
| QUBITE_MASTER_CONTEXT.md:141 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - AI может генерировать законченные конспекты твоим почерком, формулы, красиво располагать схемы, изображения, графики,  |
| QUBITE_MASTER_CONTEXT.md:142 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Генерация документов **через безопасный JSON/AST команд и layout-engine**, не через произвольное исполнение JS/SVG, пр |
| QUBITE_MASTER_CONTEXT.md:144 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | ### 6.4. Математика и физика |
| QUBITE_MASTER_CONTEXT.md:146 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Рукописное выделение задачи/рисунка/условия → «Решить», «Объяснить», «Проверить», «Построить график», «Дать подсказку» |
| QUBITE_MASTER_CONTEXT.md:147 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - OCR штрихов/формул (исследовать Mathpix, ML Kit Digital Ink, локальные математические OCR, vision API), ручное подтвер |
| QUBITE_MASTER_CONTEXT.md:148 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Проверяемые символьные и численные вычисления через SymPy или сопоставимый движок, единицы измерения, построение графи |
| QUBITE_MASTER_CONTEXT.md:149 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Пошаговые решения с валидируемыми преобразованиями; персональный рукописный рендеринг результата и осей графиков. |
| QUBITE_MASTER_CONTEXT.md:150 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - **Visual Math Lab:** интерактивное изменение параметров, точек, траекторий, визуальная физика/математика. |
| QUBITE_MASTER_CONTEXT.md:151 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Photomath — закрытый UX-референс, **не исходный встроенный движок**. |
| QUBITE_MASTER_CONTEXT.md:153 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | ### 6.5. Воспроизведение Ink Replay |
| QUBITE_MASTER_CONTEXT.md:155 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Штрих как точечная серия координат, относительных временных меток, давления/наклона (если есть), времени начала; опера |
| QUBITE_MASTER_CONTEXT.md:156 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Запись **событий**, а не видеопотока: детерминированная сериализация, компактные бинарные блоки, квантование/дельты, с |
| QUBITE_MASTER_CONTEXT.md:157 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Replay всей сессии, отдельных фрагментов, слоёв или автора; синхронизация с аудио урока, скорость воспроизведения, boo |
| QUBITE_MASTER_CONTEXT.md:158 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - История рисунка, смысловая история версий документа и история общих действий — **разные слои**. Поздние изменения не у |
| QUBITE_MASTER_CONTEXT.md:159 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Аудио, фото, видео сохраняются отдельными медиа — история событий не сокращает размер аудиозаписи до размера реплея. |
| QUBITE_MASTER_CONTEXT.md:161 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | ### 6.6. Studio — большой будущий релиз |
| QUBITE_MASTER_CONTEXT.md:163 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Procreate-like рисование и слои, сложные кисти, заливка, selection tools, пользовательские палитры, покадровая анимаци |
| QUBITE_MASTER_CONTEXT.md:164 | 6 | REQ-INK-01 / REQ-INK-02 / REQ-INK-03 / REQ-MATH-01 / REQ-REPLAY-01 / REQ-STUDIO-01 | - Storyboard и reusable elements; создание красивых рисунков с высокой производительностью. **Не является частью первого |
| QUBITE_MASTER_CONTEXT.md:166 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | ## 7. Умная учёба: Learn / School / Homework [CONFIRMED] |
| QUBITE_MASTER_CONTEXT.md:168 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | ### 7.1. Предметы, уроки и домашнее задание |
| QUBITE_MASTER_CONTEXT.md:170 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - Предметы, классы, темы, курсы, расписание, уроки, домашние задания, оценки, конспекты, учебники, записи, прикреплённые |
| QUBITE_MASTER_CONTEXT.md:171 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - Источник — российское приложение **«Госуслуги Моя школа»**. Это **не обязательно МЭШ** и не прежний «Сетевой город». О |
| QUBITE_MASTER_CONTEXT.md:172 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - Локальный статус ДЗ (`не начато → выполняется → решено → проверено`) отдельно от состояния в официальном дневнике. Мож |
| QUBITE_MASTER_CONTEXT.md:173 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - Новое ДЗ → предложение создать задачу, связать с конспектом/курсом и выбрать свободный слот; автоматизация при разреше |
| QUBITE_MASTER_CONTEXT.md:174 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - Выполнение внутри Qubite: печатный или рукописный ответ, фото бумажного решения, математическая проверка, «подскажи»,  |
| QUBITE_MASTER_CONTEXT.md:176 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | ### 7.2. Audio Lesson + Replay |
| QUBITE_MASTER_CONTEXT.md:178 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - Явное включение записи урока с учётом правил школы и согласий участников; микрофон и разрешения Android; временные мет |
| QUBITE_MASTER_CONTEXT.md:179 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - Расшифровка (проверить whisper.cpp, faster-whisper, внешние ASR API), определения разных говорящих (*speaker diarizati |
| QUBITE_MASTER_CONTEXT.md:180 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - Аудио ↔ написанные штрихи ↔ конспект ↔ выделенная область ↔ цитата транскрипта. Нажал на схему — слушаешь фрагмент объ |
| QUBITE_MASTER_CONTEXT.md:181 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - Во время урока быстрая «закладка» на важный момент. После: расшифровка, AI-резюме, источники с таймкодами, предложения |
| QUBITE_MASTER_CONTEXT.md:182 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - ASR on Raspberry **не считать гарантированно более точным**, чем внешнее API; сравнить качество русского, diarization, |
| QUBITE_MASTER_CONTEXT.md:183 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - Общий публичный конспект по умолчанию **не включает аудио чужих голосов/транскрипты**, пока владелец не включит явное  |
| QUBITE_MASTER_CONTEXT.md:185 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | ### 7.3. AI Study / NotebookLM-like |
| QUBITE_MASTER_CONTEXT.md:187 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - Источники: собственные рукописные и печатные конспекты, аудио уроков, PDF учебников, тексты, изображения, ссылки, разр |
| QUBITE_MASTER_CONTEXT.md:188 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - Выходы из одних и тех же источников: **карточки**, адаптивные **квизы**, контрольные, устные экзамены, опросы, подробн |
| QUBITE_MASTER_CONTEXT.md:189 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - **Два типа шпаргалок:** (1) красивый PDF с объяснениями, (2) компактная монохромная, узкая, адаптированная для **чеков |
| QUBITE_MASTER_CONTEXT.md:190 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - Режимы наставника: «объясни простыми словами», «покажи графически», «дай наводящий вопрос», «проверь шаг», «реши полно |
| QUBITE_MASTER_CONTEXT.md:191 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - Личный профиль освоения на основании проверенных задач, ошибок и повторений, а не самоуверенных догадок LLM. Время пов |
| QUBITE_MASTER_CONTEXT.md:192 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - AI Study генерирует новые персональные задания по слабым местам, помогает готовиться к олимпиадам по информатике, мате |
| QUBITE_MASTER_CONTEXT.md:193 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - Learning Journal: не только факт обучения, но **как именно** оно произошло, с какими ошибками, какой тип объяснения по |
| QUBITE_MASTER_CONTEXT.md:194 | 7 | REQ-SCHOOL-01 / REQ-AUDIO-01 / REQ-LEARN-01 / REQ-PRINT-01 | - Каждый AI-вывод, опирающийся на документ, должен ссылаться на **источник и координату** (страница / блок / таймкод / ф |
| QUBITE_MASTER_CONTEXT.md:196 | 8 | REQ-PLAN-01 / REQ-CAL-01 / REQ-TEAM-01 | ## 8. Проекты, планировщик, календарь и команды [CONFIRMED] |
| QUBITE_MASTER_CONTEXT.md:198 | 8 | REQ-PLAN-01 / REQ-CAL-01 / REQ-TEAM-01 | **Не строить продукт поверх Memos/Vikunja.** Функции этих инструментов описывают желаемый UX, но модели и реализация Qub |
| QUBITE_MASTER_CONTEXT.md:200 | 8 | REQ-PLAN-01 / REQ-CAL-01 / REQ-TEAM-01 | - Проекты, подпроекты, цели, инициативы, этапы, milestones, зависимости, выполненные/отложенные/заблокированные задачи,  |
| QUBITE_MASTER_CONTEXT.md:201 | 8 | REQ-PLAN-01 / REQ-CAL-01 / REQ-TEAM-01 | - Представления **список, таблица, Kanban, Gantt, календарь, dashboard, timeline** должны использовать одну доменную мод |
| QUBITE_MASTER_CONTEXT.md:202 | 8 | REQ-PLAN-01 / REQ-CAL-01 / REQ-TEAM-01 | - Собственный календарь: школьное расписание, личные события, проекты, дедлайны, Focus, регулярные активности (в т.ч. фи |
| QUBITE_MASTER_CONTEXT.md:203 | 8 | REQ-PLAN-01 / REQ-CAL-01 / REQ-TEAM-01 | - Подробный объект «Проект»: описание, ТЗ, дизайн, roadmap, текущая работа, задачи, решения, файлы, встречи, финансовая  |
| QUBITE_MASTER_CONTEXT.md:204 | 8 | REQ-PLAN-01 / REQ-CAL-01 / REQ-TEAM-01 | - Проекты Kwork: оффер/ТЗ/этапы/сроки/заказы/выручка/комиссии/налоги/временные затраты, парсеры, Telegram-уведомления и  |
| QUBITE_MASTER_CONTEXT.md:205 | 8 | REQ-PLAN-01 / REQ-CAL-01 / REQ-TEAM-01 | - Smart Scheduling, Project Autopilot, Time Estimation Learning, Task Starter (одна кнопка открывает всё нужное и включа |
| QUBITE_MASTER_CONTEXT.md:206 | 8 | REQ-PLAN-01 / REQ-CAL-01 / REQ-TEAM-01 | - Приглашение коллег, выбор видимости, общие документы/холсты, указатели присутствия и выделений в реальном времени, ком |
| QUBITE_MASTER_CONTEXT.md:207 | 8 | REQ-PLAN-01 / REQ-CAL-01 / REQ-TEAM-01 | - История команды с авторством правок; общий project knowledge, но личный контекст каждого участника отдельно. |
| QUBITE_MASTER_CONTEXT.md:209 | 9 | REQ-SEARCH-01 / REQ-INBOX-01 | ## 9. Qubite Command, глобальный поиск, Inbox, уведомления [CONFIRMED] |
| QUBITE_MASTER_CONTEXT.md:211 | 9 | REQ-SEARCH-01 / REQ-INBOX-01 | ### Qubite Command (ранее Light) |
| QUBITE_MASTER_CONTEXT.md:213 | 9 | REQ-SEARCH-01 / REQ-INBOX-01 | Одно поле и один смысловой протокол для: глобального поиска, прямой навигации, быстрых команд, создания новых объектов,  |
| QUBITE_MASTER_CONTEXT.md:215 | 9 | REQ-SEARCH-01 / REQ-INBOX-01 | ### Поиск |
| QUBITE_MASTER_CONTEXT.md:217 | 9 | REQ-SEARCH-01 / REQ-INBOX-01 | - **PostgreSQL + pgvector** [PREFERRED] на сервере, полнотекстовый индекс, мультимодальные эмбеддинги, семантический rer |
| QUBITE_MASTER_CONTEXT.md:218 | 9 | REQ-SEARCH-01 / REQ-INBOX-01 | - Модели эмбеддингов **сменяемые**. Кандидаты: локальные multilingual-текстовые модели (например EmbeddingGemma после пр |
| QUBITE_MASTER_CONTEXT.md:219 | 9 | REQ-SEARCH-01 / REQ-INBOX-01 | - Запрос по смыслу «тот алгоритм про кратчайшие пути» должен находить Дейкстру, даже если слов буквально нет. Показать п |
| QUBITE_MASTER_CONTEXT.md:220 | 9 | REQ-SEARCH-01 / REQ-INBOX-01 | - OCR рукописей и транскрипция аудио — фоновые job-ы; пользовательский ввод и автосохранение не должны ждать индексации. |
| QUBITE_MASTER_CONTEXT.md:221 | 9 | REQ-SEARCH-01 / REQ-INBOX-01 | - Graph View / Qubite Atlas: узлы — документы, проекты, задачи, навыки, темы, люди, события и т.д.; цвет/форма по типу,  |
| QUBITE_MASTER_CONTEXT.md:223 | 9 | REQ-SEARCH-01 / REQ-INBOX-01 | ### Inbox и уведомления |
| QUBITE_MASTER_CONTEXT.md:225 | 9 | REQ-SEARCH-01 / REQ-INBOX-01 | - Universal Inbox для всего нового: скинутый скриншот, ссылка, голос, PDF, сообщение, идея; AI предлагает заголовок, кат |
| QUBITE_MASTER_CONTEXT.md:226 | 9 | REQ-SEARCH-01 / REQ-INBOX-01 | - Агрегация **Госуслуги Моя школа, Gmail, Telegram, Hermes, парсеров, расписания, задач, финансов, обучения, Focus, GitH |
| QUBITE_MASTER_CONTEXT.md:227 | 9 | REQ-SEARCH-01 / REQ-INBOX-01 | - Inbox ≠ Notifications: первое для материалов/разбора, второе для сигналов. Нотификации дедуплицировать, агрегировать,  |
| QUBITE_MASTER_CONTEXT.md:228 | 9 | REQ-SEARCH-01 / REQ-INBOX-01 | - Адаптивная главная Today в духе Apple Watch Smart Stack: срочные события, карточки важных дел, уроки, ближайший приори |
| QUBITE_MASTER_CONTEXT.md:230 | 10 | REQ-AGENT-01 / REQ-MEM-01 | ## 10. AI-first архитектура: агенты, область памяти, контексты [CONFIRMED] |
| QUBITE_MASTER_CONTEXT.md:232 | 10 | REQ-AGENT-01 / REQ-MEM-01 | ### 10.1. Области видимости и иерархия |
| QUBITE_MASTER_CONTEXT.md:234 | 10 | REQ-AGENT-01 / REQ-MEM-01 | - **Personal Agent**: личный контекст владельца, доступный согласно его настройкам; глобальная точка входа. |
| QUBITE_MASTER_CONTEXT.md:235 | 10 | REQ-AGENT-01 / REQ-MEM-01 | - **Workspace/Space Agent**: контекст «Учёба», «Работа», «Личное» и т.д. |
| QUBITE_MASTER_CONTEXT.md:236 | 10 | REQ-AGENT-01 / REQ-MEM-01 | - **Project Agent**: конкретный проект, ТЗ, задачи, файлы, решения, общие обсуждения. |
| QUBITE_MASTER_CONTEXT.md:237 | 10 | REQ-AGENT-01 / REQ-MEM-01 | - **Task Agent**: минимальный контекст задачи, при необходимости может читать **разрешённые** связанные документы проект |
| QUBITE_MASTER_CONTEXT.md:238 | 10 | REQ-AGENT-01 / REQ-MEM-01 | - **Lesson/Study Agent**: учебный предмет, урок, задачи, личный прогресс. |
| QUBITE_MASTER_CONTEXT.md:239 | 10 | REQ-AGENT-01 / REQ-MEM-01 | - **Team Agent**: только общие источники команды + разрешённые разрешённые публикации участников. Каждый участник может  |
| QUBITE_MASTER_CONTEXT.md:240 | 10 | REQ-AGENT-01 / REQ-MEM-01 | - **Specialist Agents**: Math, Writer, Search, Finance, Focus Coach, Developer Bridge, Hermes и т.д.; собственные инстру |
| QUBITE_MASTER_CONTEXT.md:242 | 10 | REQ-AGENT-01 / REQ-MEM-01 | **Передача между агентами:** RPC/delegation с явной схемой, scope, ссылками на доступные объекты, минимальной выборкой д |
| QUBITE_MASTER_CONTEXT.md:244 | 10 | REQ-AGENT-01 / REQ-MEM-01 | **Важно:** «один агент на объект» — логические области/сессии, а **не** обязательный отдельный постоянно запущенный проц |
| QUBITE_MASTER_CONTEXT.md:246 | 10 | REQ-AGENT-01 / REQ-MEM-01 | ### 10.2. Что значит «агент знает всё обо мне» |
| QUBITE_MASTER_CONTEXT.md:248 | 10 | REQ-AGENT-01 / REQ-MEM-01 | Это означает **обеспеченную разрешениями систему извлечения релевантного контекста**, а не безлимитную автопередачу всей |
| QUBITE_MASTER_CONTEXT.md:250 | 10 | REQ-AGENT-01 / REQ-MEM-01 | ### 10.3. Memory + Skills по примеру Hermes — НОВОЕ ЯВНО СОГЛАСОВАННОЕ ТРЕБОВАНИЕ |
| QUBITE_MASTER_CONTEXT.md:252 | 10 | REQ-AGENT-01 / REQ-MEM-01 | **[CONFIRMED] Внедрить собственную управляемую систему памяти, уроков и навыков агентов, похожую по идее на то, как Herm |
| QUBITE_MASTER_CONTEXT.md:254 | 10 | REQ-AGENT-01 / REQ-MEM-01 | Разделить сущности: |
| QUBITE_MASTER_CONTEXT.md:255 | 10 | REQ-AGENT-01 / REQ-MEM-01 | 1. **Working Memory:** контекст текущей сессии, краткосрочные итоги, выделенные объекты; TTL. |
| QUBITE_MASTER_CONTEXT.md:256 | 10 | REQ-AGENT-01 / REQ-MEM-01 | 2. **Episodic Memory:** что произошло, какое действие выполнил агент, что предложил, что было подтверждено/отменено, рез |
| QUBITE_MASTER_CONTEXT.md:257 | 10 | REQ-AGENT-01 / REQ-MEM-01 | 3. **Semantic Memory:** устойчивые факты, цели, долгосрочные предпочтения, проектные решения; provenance + confidence +  |
| QUBITE_MASTER_CONTEXT.md:258 | 10 | REQ-AGENT-01 / REQ-MEM-01 | 4. **Procedural Memory:** проверенные последовательности действий, рецепты и инструкции «как выполнять операцию»; привяз |
| QUBITE_MASTER_CONTEXT.md:259 | 10 | REQ-AGENT-01 / REQ-MEM-01 | 5. **Skills Registry:** повторно используемые tool-enabled skills (например `solve_physics_homework_with_sources`, `plan |
| QUBITE_MASTER_CONTEXT.md:260 | 10 | REQ-AGENT-01 / REQ-MEM-01 | 6. **Project Memory:** решения и результаты проекта, общие либо персональные в зависимости от ACL; автоматическая кратка |
| QUBITE_MASTER_CONTEXT.md:261 | 10 | REQ-AGENT-01 / REQ-MEM-01 | 7. **Private Vault Memory:** отдельно шифрованные записи Life; не общая memory-папка, по умолчанию **никогда** не читает |
| QUBITE_MASTER_CONTEXT.md:262 | 10 | REQ-AGENT-01 / REQ-MEM-01 | 8. **Memory Proposals:** новые выводы агента — предложения, а не автоматически достоверные факты. Поддержать ручное подт |
| QUBITE_MASTER_CONTEXT.md:264 | 10 | REQ-AGENT-01 / REQ-MEM-01 | **Автоматическое самоулучшение агента:** по завершении повторяемой работы агент предлагает новый skill или обновление су |
| QUBITE_MASTER_CONTEXT.md:266 | 10 | REQ-AGENT-01 / REQ-MEM-01 | **«Самообучение»** в первом релизе = запись воспоминаний, контекста, навыков и успехов, не тренировка весов большой моде |
| QUBITE_MASTER_CONTEXT.md:268 | 10 | REQ-AGENT-01 / REQ-MEM-01 | ### 10.4. Agent Runtime, tools и модель маршрутизации |
| QUBITE_MASTER_CONTEXT.md:270 | 10 | REQ-AGENT-01 / REQ-MEM-01 | - `Context Resolver` строит разрешённый контекст по уровню (глобальный / space / проект / задача / урок), приоритету, бю |
| QUBITE_MASTER_CONTEXT.md:271 | 10 | REQ-AGENT-01 / REQ-MEM-01 | - `Model Router` выбирает модель: простая локальная/дешёвая классификация, vision для рисунка, мощная для анализа, локал |
| QUBITE_MASTER_CONTEXT.md:272 | 10 | REQ-AGENT-01 / REQ-MEM-01 | - `Tool Registry` версионированные интерфейсы и JSON Schema: document read/write, graph search, schedule tasks, school i |
| QUBITE_MASTER_CONTEXT.md:273 | 10 | REQ-AGENT-01 / REQ-MEM-01 | - `Actions Engine` проводит разрешения, preflight, schema validation, dry run, diff/preview, idempotency key, dedupe, au |
| QUBITE_MASTER_CONTEXT.md:274 | 10 | REQ-AGENT-01 / REQ-MEM-01 | - **Agent-to-agent** возможно, но без скрытого выхода за границы project/private scope. |
| QUBITE_MASTER_CONTEXT.md:275 | 10 | REQ-AGENT-01 / REQ-MEM-01 | - **AI Review / Auto Review:** второй агент может проверить формат, безопасность, консистентность и качество предложенно |
| QUBITE_MASTER_CONTEXT.md:276 | 10 | REQ-AGENT-01 / REQ-MEM-01 | - Секретные параметры провайдеров в защищённом серверном хранилище; каждый запрос журналируется с выбранным провайдером, |
| QUBITE_MASTER_CONTEXT.md:277 | 10 | REQ-AGENT-01 / REQ-MEM-01 | - **Hermes:** подключаемый агент/исполнитель для многошаговых автоматизаций и интеграций. Его AI-память и skills могут и |
| QUBITE_MASTER_CONTEXT.md:279 | 10 | REQ-AGENT-01 / REQ-MEM-01 | ### 10.5. Контроль видимости в командном чате |
| QUBITE_MASTER_CONTEXT.md:281 | 10 | REQ-AGENT-01 / REQ-MEM-01 | - Пользователь может скрывать личную часть контекста в общем чате; ***не*** достаточно «замазать» её постфактум. Общая м |
| QUBITE_MASTER_CONTEXT.md:282 | 10 | REQ-AGENT-01 / REQ-MEM-01 | - При командной выдаче данных отделить shared assistant response от private augmentation. В UI личное дополнение видно т |
| QUBITE_MASTER_CONTEXT.md:283 | 10 | REQ-AGENT-01 / REQ-MEM-01 | - Все предложения «опубликовать личную информацию» требуют явного просмотра конкретных полей; AI Context Inspector показ |
| QUBITE_MASTER_CONTEXT.md:285 | 11 | REQ-PULSE-01 | ## 11. Pulse, автоматизации, проактивность [CONFIRMED] |
| QUBITE_MASTER_CONTEXT.md:287 | 11 | REQ-PULSE-01 | - `Event Bus + Scheduler + Automation Runtime`: события изменения объектов, вебхуки, задачи по расписанию, периодический |
| QUBITE_MASTER_CONTEXT.md:288 | 11 | REQ-PULSE-01 | - Пользователь **не должен знать заранее все автоматизации**: AI наблюдает повторяемые действия, предлагает сценарий/пра |
| QUBITE_MASTER_CONTEXT.md:289 | 11 | REQ-PULSE-01 | - Сценарии: новое ДЗ → задача + связанный конспект; новые заказы Kwork → Inbox + проект; почта → требующие ответа задачи |
| QUBITE_MASTER_CONTEXT.md:290 | 11 | REQ-PULSE-01 | - Pulse = не обязательно постоянный вызов LLM раз в минуту; приоритет **event-driven + дешёвые правила**, AI только при  |
| QUBITE_MASTER_CONTEXT.md:291 | 11 | REQ-PULSE-01 | - Автоматические действия классифицируются по риску: наблюдение/предложение → подтверждение → auto-safe → auto-review →  |
| QUBITE_MASTER_CONTEXT.md:292 | 11 | REQ-PULSE-01 | - Магазин сценариев и визуальный конструктор в будущем; правила версионируются и тестируются на тестовых событиях. |
| QUBITE_MASTER_CONTEXT.md:293 | 11 | REQ-PULSE-01 | - Исполнение зависит от связи и разрешений. Если внешний сервис недоступен, очередь и статус показывают честное состояни |
| QUBITE_MASTER_CONTEXT.md:295 | 12 | REQ-LIFE-01 | ## 12. Life / приватный дневник / прогресс личности [CONFIRMED] |
| QUBITE_MASTER_CONTEXT.md:297 | 12 | REQ-LIFE-01 | - `Life Journal`: личный текстовый и голосовой дневник с фотографиями, прикреплёнными файлами, датами, настроением (если |
| QUBITE_MASTER_CONTEXT.md:298 | 12 | REQ-LIFE-01 | - Дополнительный пароль/биометрия/отдельный ключ, защищённое локальное хранение, осторожная синхронизация, восстановлени |
| QUBITE_MASTER_CONTEXT.md:299 | 12 | REQ-LIFE-01 | - `Reflection Companion` — поддерживающий и уважительный AI-собеседник, который помогает осмыслить переживания, вспомнит |
| QUBITE_MASTER_CONTEXT.md:300 | 12 | REQ-LIFE-01 | - Профиль личного развития: Life Evolution, Time Machine, Memory Map, Letters to Future Me, Life Chapters, Thought Evolu |
| QUBITE_MASTER_CONTEXT.md:301 | 12 | REQ-LIFE-01 | - Детальный импорт и экспорт дневника; уведомления-«письмо себе в будущее», тематические альбомы, фотографии разных пери |
| QUBITE_MASTER_CONTEXT.md:302 | 12 | REQ-LIFE-01 | - Для чувствительного дневника **локальная LLM по умолчанию** или явно проверенные внешние провайдеры с политикой no-tra |
| QUBITE_MASTER_CONTEXT.md:303 | 12 | REQ-LIFE-01 | - Private Vault **запретить для командных поисков, сторонних плагинов, глобальных агентных skills и гостевых ссылок по у |
| QUBITE_MASTER_CONTEXT.md:305 | 13 | REQ-FOCUS-01 | ## 13. Focus, Pomodoro, строгая концентрация, Guardian [CONFIRMED] |
| QUBITE_MASTER_CONTEXT.md:307 | 13 | REQ-FOCUS-01 | - Режим одной конкретной задачи/проекта/конспекта: минималистичный экран без лишних панелей, разрешённые материалы и инс |
| QUBITE_MASTER_CONTEXT.md:308 | 13 | REQ-FOCUS-01 | - Таймер работы и отдыха (например 30/10 мин, все значения регулируются), история сессий, перерывы, цели, напоминания, с |
| QUBITE_MASTER_CONTEXT.md:309 | 13 | REQ-FOCUS-01 | - Календарно обусловленные разрешённые перерывы (уроки, питание/ужин, встречи, важные дела), синхронизация состояний Foc |
| QUBITE_MASTER_CONTEXT.md:310 | 13 | REQ-FOCUS-01 | - `AI Focus Coach`: замечает явную активность в Qubite, уточняет прогресс, предлагает разбить задачу, помогает найти мат |
| QUBITE_MASTER_CONTEXT.md:311 | 13 | REQ-FOCUS-01 | - **Строгий режим** с разрешённым набором приложений: Android Lock Task/Kiosk на правильно управляемых устройствах; на о |
| QUBITE_MASTER_CONTEXT.md:312 | 13 | REQ-FOCUS-01 | - **Guardian:** пользователь приглашает доверенного контролёра по одноразовой/ограниченной ссылке, задаёт роль, видимые  |
| QUBITE_MASTER_CONTEXT.md:313 | 13 | REQ-FOCUS-01 | - Если запрошен принудительный режим, обеспечить emergency exit, доступ к экстренным функциям, отзываемость согласия, по |
| QUBITE_MASTER_CONTEXT.md:314 | 13 | REQ-FOCUS-01 | - `Focus` не равно parental controls: задача — помочь пользователю добровольно выполнять собственные цели, не строить си |
| QUBITE_MASTER_CONTEXT.md:316 | 14 | REQ-FIN-01 | ## 14. Qubite Finance [CONFIRMED] |
| QUBITE_MASTER_CONTEXT.md:318 | 14 | REQ-FIN-01 | - Личные счета и кошельки, доходы/расходы, бюджетирование, категории и правила, цели накопления, повторяющиеся платежи/п |
| QUBITE_MASTER_CONTEXT.md:319 | 14 | REQ-FIN-01 | - Kwork: стоимость заказа, комиссии платформы и вывода, налоги с корректной базой, дата платежа, прямые расходы, затраче |
| QUBITE_MASTER_CONTEXT.md:320 | 14 | REQ-FIN-01 | - Источники: вручную, голосом, фото/распознаванием чека, CSV банковских выписок, доступным банковским API с разрешения ( |
| QUBITE_MASTER_CONTEXT.md:321 | 14 | REQ-FIN-01 | - Двойная запись / баланс учётных записей или аккуратная модель ledger, неизменяемая история событий, отмена через компе |
| QUBITE_MASTER_CONTEXT.md:322 | 14 | REQ-FIN-01 | - Инвестиционный портфель — позиции, сделки, доходность, доходы и переоценка с явным источником рыночной цены; никаких с |
| QUBITE_MASTER_CONTEXT.md:323 | 14 | REQ-FIN-01 | - Связь с `Qubite Projects`, `Pulse`, `Today`, финансовыми целями и стоимостью OpenRouter/AI. Секреты финансовых подключ |
| QUBITE_MASTER_CONTEXT.md:325 | 15 | REQ-PLUGIN-01 / REQ-MCP-01 | ## 15. Расширения, единый код и собственный MCP [CONFIRMED] |
| QUBITE_MASTER_CONTEXT.md:327 | 15 | REQ-PLUGIN-01 / REQ-MCP-01 | ### 15.1. Основная идея |
| QUBITE_MASTER_CONTEXT.md:329 | 15 | REQ-PLUGIN-01 / REQ-MCP-01 | - Возможности платформы должны расширяться **без переписывания ядра**; аналог идеи плагинов Obsidian, но с единым доступ |
| QUBITE_MASTER_CONTEXT.md:330 | 15 | REQ-PLUGIN-01 / REQ-MCP-01 | - Не разрабатывать собственный язык плагинов. **[PREFERRED]** TypeScript/JavaScript как удобный SDK и WebAssembly для пе |
| QUBITE_MASTER_CONTEXT.md:331 | 15 | REQ-PLUGIN-01 / REQ-MCP-01 | - Единый plugin manifest: `id`, версия, minHostVersion, возможности `ui` / `server` / `mobile` / `workflow` / `mcp`, пер |
| QUBITE_MASTER_CONTEXT.md:332 | 15 | REQ-PLUGIN-01 / REQ-MCP-01 | - Типы плагинов: web/client, Android-native capability adapter, server worker, переносимый Wasm compute, внешнее connect |
| QUBITE_MASTER_CONTEXT.md:333 | 15 | REQ-PLUGIN-01 / REQ-MCP-01 | - Установка/обновление синхронизируется на уровне аккаунта и desired state. Каждый девайс активирует только совместимые  |
| QUBITE_MASTER_CONTEXT.md:334 | 15 | REQ-PLUGIN-01 / REQ-MCP-01 | - Capability-based API, разрешения показываются до установки, пользователь может их отзывать, без слепого `universal_adm |
| QUBITE_MASTER_CONTEXT.md:335 | 15 | REQ-PLUGIN-01 / REQ-MCP-01 | - **В будущем:** собственный marketplace, проверка пакетов и лицензий, локальный Developer Mode, hot reload для разработ |
| QUBITE_MASTER_CONTEXT.md:336 | 15 | REQ-PLUGIN-01 / REQ-MCP-01 | - Бэкенд предоставляет `Plugin API`, `Event API`, `Commands API`, `Objects API`, `Search API`, `UI Slots API`, `Notifica |
| QUBITE_MASTER_CONTEXT.md:338 | 15 | REQ-PLUGIN-01 / REQ-MCP-01 | ### 15.2. Qubite Developer Bridge / собственный MCP |
| QUBITE_MASTER_CONTEXT.md:340 | 15 | REQ-PLUGIN-01 / REQ-MCP-01 | - Встроенный собственный **MCP server** для Codex, Claude Code, Hermes и других клиентов: resources (контексты проектов, |
| QUBITE_MASTER_CONTEXT.md:341 | 15 | REQ-PLUGIN-01 / REQ-MCP-01 | - OAuth/короткоживущие scoped токены для удалённого доступа, отдельные учётные данные для локального stdio там, где это  |
| QUBITE_MASTER_CONTEXT.md:342 | 15 | REQ-PLUGIN-01 / REQ-MCP-01 | - Внешний CodeX получает **только назначенный проект**; личный дневник, другие проекты, финансы, незапрошенные team-данн |
| QUBITE_MASTER_CONTEXT.md:343 | 15 | REQ-PLUGIN-01 / REQ-MCP-01 | - После завершения задачи CodeX может сохранить тесты, коммит, ссылку на diff, изменения, решения и статус; агент Qubite |
| QUBITE_MASTER_CONTEXT.md:344 | 15 | REQ-PLUGIN-01 / REQ-MCP-01 | - `Context Capsules`: переносимый пакет минимально необходимого контекста (цель проекта, ТЗ, решения, ограничения, задач |
| QUBITE_MASTER_CONTEXT.md:345 | 15 | REQ-PLUGIN-01 / REQ-MCP-01 | - MCP — стандарт интерфейса к данным/инструментам, **не новая LLM и не замена авторизации или Plugin SDK**. |
| QUBITE_MASTER_CONTEXT.md:347 | 16 | REQ-SYNC-01 / REQ-HIST-01 / NFR-DATA-01 | ## 16. Handoff, Timeline, event sourcing, история «как Git» [CONFIRMED] |
| QUBITE_MASTER_CONTEXT.md:349 | 16 | REQ-SYNC-01 / REQ-HIST-01 / NFR-DATA-01 | ### 16.1. Handoff |
| QUBITE_MASTER_CONTEXT.md:351 | 16 | REQ-SYNC-01 / REQ-HIST-01 / NFR-DATA-01 | - Из любого устройства можно продолжить состояние на другом и обратно: открытый документ, курсор, выделение, активная ст |
| QUBITE_MASTER_CONTEXT.md:352 | 16 | REQ-SYNC-01 / REQ-HIST-01 / NFR-DATA-01 | - На втором устройстве предложение «Продолжить работу» с источником, контекстом и временем; нежелательные автопереходы о |
| QUBITE_MASTER_CONTEXT.md:354 | 16 | REQ-SYNC-01 / REQ-HIST-01 / NFR-DATA-01 | ### 16.2. Global Timeline |
| QUBITE_MASTER_CONTEXT.md:356 | 16 | REQ-SYNC-01 / REQ-HIST-01 / NFR-DATA-01 | - **Состояние / Events / Snapshots**: текущая проекция для быстрой загрузки, append-only журнал значимых действий и пери |
| QUBITE_MASTER_CONTEXT.md:357 | 16 | REQ-SYNC-01 / REQ-HIST-01 / NFR-DATA-01 | - Просмотр истории объекта (документы, блоки, задачи, проект, финансы, календарь, изменения AI). Сравнение «до/после», б |
| QUBITE_MASTER_CONTEXT.md:358 | 16 | REQ-SYNC-01 / REQ-HIST-01 / NFR-DATA-01 | - Коммит-схожая UX-семантика, но **не просто Git как движок для всей базы**. Интеграция с реальными Git-коммитами полезн |
| QUBITE_MASTER_CONTEXT.md:359 | 16 | REQ-SYNC-01 / REQ-HIST-01 / NFR-DATA-01 | - Undo/Redo — быстрые команды внутри редактора; version history — история значимых версий; audit — неизменяемая политика |
| QUBITE_MASTER_CONTEXT.md:360 | 16 | REQ-SYNC-01 / REQ-HIST-01 / NFR-DATA-01 | - Для внешних действий (Telegram, письмо, денежный перевод) «откат» означает возможное компенсирующее действие, **не гар |
| QUBITE_MASTER_CONTEXT.md:361 | 16 | REQ-SYNC-01 / REQ-HIST-01 / NFR-DATA-01 | - Backups: регулярные, шифрованные по необходимости, с тестом восстановления; отказоустойчивое хранилище (Raspberry как  |
| QUBITE_MASTER_CONTEXT.md:363 | 17 | REQ-TEAM-01 | ## 17. Sharing, Team, приватность, роли [CONFIRMED] |
| QUBITE_MASTER_CONTEXT.md:365 | 17 | REQ-TEAM-01 | - Ссылки на документ, холст, конспект, реплей, PDF или проект: публичные и по приглашению, срок действия, пароль, разреш |
| QUBITE_MASTER_CONTEXT.md:366 | 17 | REQ-TEAM-01 | - Публичный просмотр — полноценный веб-интерфейс с масштабированием, навигацией по страницам, необязательным проигрывани |
| QUBITE_MASTER_CONTEXT.md:367 | 17 | REQ-TEAM-01 | - Workspace roles: owner/admin/editor/commenter/viewer/guest, гранулярные ACL, permission inheritance, explicit denies д |
| QUBITE_MASTER_CONTEXT.md:368 | 17 | REQ-TEAM-01 | - Совместный холст и документы в реальном времени: курсоры, выделения, совместное перемещение фигур, конфликтоустойчивая |
| QUBITE_MASTER_CONTEXT.md:369 | 17 | REQ-TEAM-01 | - Personal agent участника может использовать его приватный контекст для *личного* дополнения, но общий AI-проект не дол |
| QUBITE_MASTER_CONTEXT.md:370 | 17 | REQ-TEAM-01 | - Для разных клиентов нужно предусмотреть UI состояния «кто редактирует», права на блоки, оптимистичные обновления и off |
| QUBITE_MASTER_CONTEXT.md:372 | 18 | REQ-INT-01 / REQ-SHADE-01 / REQ-IMPORT-01 | ## 18. Дополнительные интеграции и миграция старых проектов [CONFIRMED] |
| QUBITE_MASTER_CONTEXT.md:374 | 18 | REQ-INT-01 / REQ-SHADE-01 / REQ-IMPORT-01 | - **Qubite Writer / LanguageTool:** грамматика русского/английского, объяснение правил, выявление повторяющихся ошибок,  |
| QUBITE_MASTER_CONTEXT.md:375 | 18 | REQ-INT-01 / REQ-SHADE-01 / REQ-IMPORT-01 | - **Qubite Search:** интегрировать существующий поиск в Command/Docs как web research tool, с источниками, режимом Focus |
| QUBITE_MASTER_CONTEXT.md:376 | 18 | REQ-INT-01 / REQ-SHADE-01 / REQ-IMPORT-01 | - **Hermes:** подключать как внешний специализированный исполнитель, импорт skills и инструментов после тестирования, ог |
| QUBITE_MASTER_CONTEXT.md:377 | 18 | REQ-INT-01 / REQ-SHADE-01 / REQ-IMPORT-01 | - **Shade AI:** будущий home automation bridge, авторизованные сценарии умного дома, локальные подтверждения для опасных |
| QUBITE_MASTER_CONTEXT.md:378 | 18 | REQ-INT-01 / REQ-SHADE-01 / REQ-IMPORT-01 | - **Telegram:** входящий capture, уведомления, парсеры и боты, сообщения/публикации только с разрешениями. Учитывать лим |
| QUBITE_MASTER_CONTEXT.md:379 | 18 | REQ-INT-01 / REQ-SHADE-01 / REQ-IMPORT-01 | - **Kwork:** сделки, доходность, отклики, уведомления парсера, заказы, проектные расходы, дедлайны. Не обещать недокумен |
| QUBITE_MASTER_CONTEXT.md:380 | 18 | REQ-INT-01 / REQ-SHADE-01 / REQ-IMPORT-01 | - **Qubite Tournaments, VPN, Vault/AliasVault и старое управление:** сохранить действующие сервисы; постепенно перенести |
| QUBITE_MASTER_CONTEXT.md:381 | 18 | REQ-INT-01 / REQ-SHADE-01 / REQ-IMPORT-01 | - **Gmail / календарь / Google Drive** и другие подключаемые источники: email и сроки, вложения, уведомления, файлы и им |
| QUBITE_MASTER_CONTEXT.md:382 | 18 | REQ-INT-01 / REQ-SHADE-01 / REQ-IMPORT-01 | - **YouTube:** у официального YouTube Data API нет доступного endpoint для полной истории просмотров (`watchHistoryNotAc |
| QUBITE_MASTER_CONTEXT.md:383 | 18 | REQ-INT-01 / REQ-SHADE-01 / REQ-IMPORT-01 | - **Paper Capture:** камера → кадрирование, выравнивание, OCR текста/формул, источник, ссылка на учебный материал и возм |
| QUBITE_MASTER_CONTEXT.md:384 | 18 | REQ-INT-01 / REQ-SHADE-01 / REQ-IMPORT-01 | - **Импорт старых данных:** Memos/Vikunja/заметки/документы/CSV/планировщики, с сохранением source_id и связей, ручным в |
| QUBITE_MASTER_CONTEXT.md:386 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | ## 19. Архитектура системы: рекомендованная, но не окончательная [PREFERRED] |
| QUBITE_MASTER_CONTEXT.md:388 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | ### 19.1. Архитектурный стиль |
| QUBITE_MASTER_CONTEXT.md:390 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | **Modular monolith + plugin boundary + local-first clients.** Не запускать сразу десятки независимых микросервисов. При  |
| QUBITE_MASTER_CONTEXT.md:392 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | **Клиенты:** |
| QUBITE_MASTER_CONTEXT.md:393 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Web/PWA/desktop-capable: React + TypeScript, дизайн-система, Docs/Planner/Command/Knowledge, share viewer; desktop wra |
| QUBITE_MASTER_CONTEXT.md:394 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Android: Kotlin/Compose + Jetpack Ink для нативного рукописного ввода, локальная Room/SQLite и зашифрованные файловые  |
| QUBITE_MASTER_CONTEXT.md:395 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Mobile phone: легковесный быстрый ввод, задачи/Today/Focus/Handoff; возможности рисования адаптированы под отсутствие  |
| QUBITE_MASTER_CONTEXT.md:396 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Backend: Python/FastAPI, типизированные API, разделение на пакеты `identity`, `objects`, `docs`, `planner`, `ink`, `sc |
| QUBITE_MASTER_CONTEXT.md:397 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Storage: PostgreSQL, pgvector, медиафайлы на локальном диске/S3-совместимом storage, ключи/секреты вне исходного кода, |
| QUBITE_MASTER_CONTEXT.md:398 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Background jobs: надежная очередь и workers, для медиа/эмбеддингов/ASR; выбор между PostgreSQL-based jobs и отдельной  |
| QUBITE_MASTER_CONTEXT.md:399 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Websocket/SSE: presence, уведомления, job progress, совместная работа; синхронизация состояния должна переносить време |
| QUBITE_MASTER_CONTEXT.md:400 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - AI: model/provider router + tools + memory + permissions + approvals + audit + scheduler. |
| QUBITE_MASTER_CONTEXT.md:401 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - MCP gateway: отдельное ограниченное представление Core API для внешних агентов, с scoped tokens. |
| QUBITE_MASTER_CONTEXT.md:403 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | ### 19.2. Канонические сущности |
| QUBITE_MASTER_CONTEXT.md:405 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | Не делать одну таблицу `objects` с бесконтрольным JSON и не пытаться сделать все данные одинаковыми. Использовать **общи |
| QUBITE_MASTER_CONTEXT.md:407 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | Доменный список (минимум): |
| QUBITE_MASTER_CONTEXT.md:409 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | &#124; Класс &#124; Сущности &#124; Особенности &#124; |
| QUBITE_MASTER_CONTEXT.md:410 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | &#124;---&#124;---&#124;---&#124; |
| QUBITE_MASTER_CONTEXT.md:411 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | &#124; Identity &#124; User, Device, Session, Workspace, Membership, Role, Grant, Token &#124; grants/deny, revocation, audit &#124; |
| QUBITE_MASTER_CONTEXT.md:412 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | &#124; Documents &#124; Document, Block, Revision, Attachment, Template, Folder/View &#124; JSON/AST, версии, экспорт &#124; |
| QUBITE_MASTER_CONTEXT.md:413 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | &#124; Ink &#124; Notebook, Page, Canvas, Layer, Stroke, PointSeries, Shape, ToolPreset, HandwritingProfile &#124; low-latency, binary  |
| QUBITE_MASTER_CONTEXT.md:414 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | &#124; Planning &#124; Project, Task, TaskDependency, Milestone, CalendarEvent, Reminder, ScheduleRule &#124; много представлений &#124; |
| QUBITE_MASTER_CONTEXT.md:415 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | &#124; Learning &#124; Course/Subject, Lesson, Homework, LearningSource, Question, Attempt, Skill, Review &#124; проверенный прогресс &#124; |
| QUBITE_MASTER_CONTEXT.md:416 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | &#124; Media &#124; MediaAsset, Transcript, TranscriptSegment, Speaker, AudioSession, ReplayTrack &#124; отдельно от событий &#124; |
| QUBITE_MASTER_CONTEXT.md:417 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | &#124; Knowledge &#124; Node, Edge, Citation/Provenance, Embedding, SearchIndexVersion, Bookmark &#124; типизированные связи &#124; |
| QUBITE_MASTER_CONTEXT.md:418 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | &#124; Personal &#124; JournalEntry, MemoryMoment, Goal, MilestonePersonal, Reflection, PrivateCollection &#124; protected vault &#124; |
| QUBITE_MASTER_CONTEXT.md:419 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | &#124; Finance &#124; Account, Transaction, LedgerEntry, Category, Budget, InvestmentPosition, PriceQuote &#124; двойная запись, аудит  |
| QUBITE_MASTER_CONTEXT.md:420 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | &#124; Agent &#124; AgentProfile, ContextScope, Conversation, MemoryItem, Skill, SkillVersion, ToolInvocation, Approval &#124; ACL на к |
| QUBITE_MASTER_CONTEXT.md:421 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | &#124; Automation &#124; Trigger, Workflow, WorkflowRun, Schedule, Job, RuleApproval &#124; safe retry/limits &#124; |
| QUBITE_MASTER_CONTEXT.md:422 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | &#124; Integration &#124; Connector, ExternalAccount, ImportJob, ExternalMapping, Notification &#124; token refresh, provenance &#124; |
| QUBITE_MASTER_CONTEXT.md:423 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | &#124; Collaboration &#124; SharedLink, Invitation, Poll, Vote, Comment, Presence, TeamSpace &#124; отдельные права &#124; |
| QUBITE_MASTER_CONTEXT.md:424 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | &#124; Infrastructure &#124; Event, Snapshot, ChangeSet, Backup, ExportJob, Plugin, PluginGrant &#124; versions/retention &#124; |
| QUBITE_MASTER_CONTEXT.md:426 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | Связь графа (`Relation`): `from_object_id`, `to_object_id`, `relation_type`, `created_by`, `source`, `confidence`, `visi |
| QUBITE_MASTER_CONTEXT.md:428 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | ### 19.3. Версионированный документ и ревизии |
| QUBITE_MASTER_CONTEXT.md:430 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | Пример **псевдосхемы**, не готовая БД и не API-контракт: |
| QUBITE_MASTER_CONTEXT.md:432 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | ```json |
| QUBITE_MASTER_CONTEXT.md:433 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | { |
| QUBITE_MASTER_CONTEXT.md:434 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 |   "schemaVersion": 1, |
| QUBITE_MASTER_CONTEXT.md:435 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 |   "documentId": "doc_uuid", |
| QUBITE_MASTER_CONTEXT.md:436 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 |   "ownerId": "user_uuid", |
| QUBITE_MASTER_CONTEXT.md:437 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 |   "workspaceId": "space_uuid", |
| QUBITE_MASTER_CONTEXT.md:438 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 |   "revision": 42, |
| QUBITE_MASTER_CONTEXT.md:439 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 |   "blocks": [ |
| QUBITE_MASTER_CONTEXT.md:440 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 |     {"id": "b1", "type": "heading", "text": "Второй закон Ньютона"}, |
| QUBITE_MASTER_CONTEXT.md:441 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 |     {"id": "b2", "type": "ink-embed", "inkCanvasId": "canvas_uuid"}, |
| QUBITE_MASTER_CONTEXT.md:442 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 |     {"id": "b3", "type": "task-reference", "taskId": "task_uuid"} |
| QUBITE_MASTER_CONTEXT.md:443 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 |   ], |
| QUBITE_MASTER_CONTEXT.md:444 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 |   "relations": [{"type": "related_to", "targetId": "lesson_uuid"}] |
| QUBITE_MASTER_CONTEXT.md:445 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | } |
| QUBITE_MASTER_CONTEXT.md:446 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | ``` |
| QUBITE_MASTER_CONTEXT.md:448 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | Данные рукописных точек — не в giant JSON поля документа; binary chunk storage с `strokeId`, индексами и временем. Не по |
| QUBITE_MASTER_CONTEXT.md:450 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | ### 19.4. Синхронизация и конфликтность |
| QUBITE_MASTER_CONTEXT.md:452 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - На всех клиентах локальные изменения записываются атомарно до отправки; очередь исходящих изменений и идемпотентный se |
| QUBITE_MASTER_CONTEXT.md:453 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Для простых объектов — optimistic concurrency с revision/ETag и понятный UI конфликта/merge. Для text collaboration —  |
| QUBITE_MASTER_CONTEXT.md:454 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Удаление/права/финансы — серверная проверка, транзакционность; офлайн создание черновиков разрешено, чувствительные вн |
| QUBITE_MASTER_CONTEXT.md:455 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Наблюдаемость offline/sync: «локально сохранено», «синхронизировано», «конфликт», «ошибка», «ждёт загрузки аудио»; не  |
| QUBITE_MASTER_CONTEXT.md:456 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Handoff восстанавливает UI-state отдельно от контента и не передает приватный scope на устройство, которое не авторизо |
| QUBITE_MASTER_CONTEXT.md:458 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | ### 19.5. Права, безопасность, приватность |
| QUBITE_MASTER_CONTEXT.md:460 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Permission engine — **серверное enforcement** для каждого объекта, поля и действия; deny-by-default, scopes/tenants/te |
| QUBITE_MASTER_CONTEXT.md:461 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Личные сведения, пароли, API-ключи, закрытые дневники и защищённые team-данные **не индексируются в общий поисковый ин |
| QUBITE_MASTER_CONTEXT.md:462 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Login: единый Qubite аккаунт, варианты инвайтов/регистрации после отдельной работы, MFA позже; существующая платформа  |
| QUBITE_MASTER_CONTEXT.md:463 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Шифрование при передаче; локальные ключи через доступные защищённые API; private vault — клиентское шифрование/E2EE гд |
| QUBITE_MASTER_CONTEXT.md:464 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Плагины, MCP-интеграции, AI-инструменты и публичные ссылки проходят **один и тот же permission engine**, запреты не об |
| QUBITE_MASTER_CONTEXT.md:465 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Prompt injection: удалённые документы, письма, веб-страницы и транскрипты не становятся инструкциями высокого доверия; |
| QUBITE_MASTER_CONTEXT.md:466 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Участник/подросток и школьные записи: consent, правила школы, приватность учеников/преподавателей, отсутствие автомати |
| QUBITE_MASTER_CONTEXT.md:467 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Финансовые действия и публикации — с подтверждением; пароли/секреты не передавать в LLM контексты или произвольные ext |
| QUBITE_MASTER_CONTEXT.md:468 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Экспорт и удаление собственных данных, конфиденциальность внешних AI-провайдеров, отчёт о том, что отправлялось модели |
| QUBITE_MASTER_CONTEXT.md:470 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | ### 19.6. Нефункциональные требования и измерения |
| QUBITE_MASTER_CONTEXT.md:472 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Действия письма не должны делать синхронный сетевой roundtrip; цель — субъективно низкая задержка, **замерить реальное |
| QUBITE_MASTER_CONTEXT.md:473 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Нельзя терять штрихи при принудительном закрытии, быстрой смене приложения, сетевом обрыве, ограниченной памяти; recov |
| QUBITE_MASTER_CONTEXT.md:474 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Тысячи/десятки тысяч векторных объектов: виртуализация и частичный рендеринг, профилирование памяти, без чрезмерного р |
| QUBITE_MASTER_CONTEXT.md:475 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Данные шифрованного дневника не должны попадать в server logs, team graph или неразрешённый search; тестировать на поп |
| QUBITE_MASTER_CONTEXT.md:476 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Очереди импорта/транскрипции не тормозят API; интерфейс честно показывает прогресс и ошибки. |
| QUBITE_MASTER_CONTEXT.md:477 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - A11y: размеры тап-целей, контраст, уменьшение анимации, аппаратная клавиатура, поддержка масштабирования, достаточные  |
| QUBITE_MASTER_CONTEXT.md:478 | 19 | REQ-CORE-01 / NFR-SEC-01 / NFR-PERF-01 | - Quality bar: UI snapshots, Android device tests, unit/integration/e2e, миграции схем, backup/restore drills, permissio |
| QUBITE_MASTER_CONTEXT.md:480 | 20 | IDEA-01–48 | ## 20. Полный каталог 48 предложенных и одобренных идей [CONFIRMED — BACKLOG] |
| QUBITE_MASTER_CONTEXT.md:482 | 20 | IDEA-01–48 | Все идеи ниже получили прямое одобрение («мне всё нравится»). **Не пытаться реализовать их одновременно.** Часть уже опи |
| QUBITE_MASTER_CONTEXT.md:484 | 20 | IDEA-01–48 | ### Life / личное развитие |
| QUBITE_MASTER_CONTEXT.md:485 | 20 | IDEA-01–48 | 1. **Life Evolution** — интерактивная карта личного развития с доказательствами изменений. |
| QUBITE_MASTER_CONTEXT.md:486 | 20 | IDEA-01–48 | 2. **Time Machine** — переход в выбранную дату/период, заметки, фото, проекты, мысли тогда и сейчас. |
| QUBITE_MASTER_CONTEXT.md:487 | 20 | IDEA-01–48 | 3. **Memory Map** — карта воспоминаний по фотографиям, местам, событиям и людям с разрешением. |
| QUBITE_MASTER_CONTEXT.md:488 | 20 | IDEA-01–48 | 4. **Letters to Future Me** — письма будущему себе и отложенное открытие. |
| QUBITE_MASTER_CONTEXT.md:489 | 20 | IDEA-01–48 | 5. **Life Chapters** — «главы жизни», тематические альбомы. |
| QUBITE_MASTER_CONTEXT.md:490 | 20 | IDEA-01–48 | 6. **Thought Evolution** — история изменения взглядов, аргументы и причинные связи. |
| QUBITE_MASTER_CONTEXT.md:491 | 20 | IDEA-01–48 | 7. **Personal Milestones** — реальные достижения, без надуманной геймификации. |
| QUBITE_MASTER_CONTEXT.md:492 | 20 | IDEA-01–48 | 8. **Reflection Companion** — личный поддерживающий дневник/собеседник, приватно. |
| QUBITE_MASTER_CONTEXT.md:494 | 20 | IDEA-01–48 | ### Learn / самообразование |
| QUBITE_MASTER_CONTEXT.md:495 | 20 | IDEA-01–48 | 9. **Skill Tree** — дерево подтверждённых навыков, зависимости тем. |
| QUBITE_MASTER_CONTEXT.md:496 | 20 | IDEA-01–48 | 10. **Mistake Library** — библиотека ошибок и персональные упражнения. |
| QUBITE_MASTER_CONTEXT.md:497 | 20 | IDEA-01–48 | 11. **Exam Simulator** — симулятор тестов, контрольных, олимпиад с таймером. |
| QUBITE_MASTER_CONTEXT.md:498 | 20 | IDEA-01–48 | 12. **AI Oral Exam** — голосовой устный экзамен с уточнениями. |
| QUBITE_MASTER_CONTEXT.md:499 | 20 | IDEA-01–48 | 13. **Learning Radar** — активные, забываемые и требующие повторения темы. |
| QUBITE_MASTER_CONTEXT.md:500 | 20 | IDEA-01–48 | 14. **Explain It Differently** — одно содержание разными способами объяснения. |
| QUBITE_MASTER_CONTEXT.md:501 | 20 | IDEA-01–48 | 15. **Knowledge Gaps** — поиск недостающих предварительных знаний. |
| QUBITE_MASTER_CONTEXT.md:502 | 20 | IDEA-01–48 | 16. **Source Reliability** — достоверность и источники AI-утверждений. |
| QUBITE_MASTER_CONTEXT.md:504 | 20 | IDEA-01–48 | ### Planner / проекты |
| QUBITE_MASTER_CONTEXT.md:505 | 20 | IDEA-01–48 | 17. **Project Autopilot** — план проекта из короткого описания. |
| QUBITE_MASTER_CONTEXT.md:506 | 20 | IDEA-01–48 | 18. **Smart Scheduling** — расписание на основе сроков и свободного времени. |
| QUBITE_MASTER_CONTEXT.md:507 | 20 | IDEA-01–48 | 19. **Time Estimation Learning** — улучшение оценок длительности задач. |
| QUBITE_MASTER_CONTEXT.md:508 | 20 | IDEA-01–48 | 20. **Task Starter** — открыть весь контекст и Focus одной кнопкой. |
| QUBITE_MASTER_CONTEXT.md:509 | 20 | IDEA-01–48 | 21. **Decision Journal** — почему приняты решения и их последующие результаты. |
| QUBITE_MASTER_CONTEXT.md:510 | 20 | IDEA-01–48 | 22. **Project Dependencies** — зависимости задач и планирование влияния сдвига сроков. |
| QUBITE_MASTER_CONTEXT.md:511 | 20 | IDEA-01–48 | 23. **Progress Digest** — дневной/недельный отчёт о результатах. |
| QUBITE_MASTER_CONTEXT.md:512 | 20 | IDEA-01–48 | 24. **Smart Priorities** — объяснимые рекомендации текущей задачи. |
| QUBITE_MASTER_CONTEXT.md:514 | 20 | IDEA-01–48 | ### Ink / Docs / Studio |
| QUBITE_MASTER_CONTEXT.md:515 | 20 | IDEA-01–48 | 25. **Universal Canvas** — смешанный холст текста, рукописи, медиа, задач, схем. |
| QUBITE_MASTER_CONTEXT.md:516 | 20 | IDEA-01–48 | 26. **Smart Sketch** — набросок интерфейса превращается в редактируемые компоненты/React (после подтверждения). |
| QUBITE_MASTER_CONTEXT.md:517 | 20 | IDEA-01–48 | 27. **Handwriting Styles** — несколько личных стилей почерка и обучение исправлениями. |
| QUBITE_MASTER_CONTEXT.md:518 | 20 | IDEA-01–48 | 28. **Document Transform** — документ → презентация, карточки, инфографика, шпаргалка, аудио и др. |
| QUBITE_MASTER_CONTEXT.md:519 | 20 | IDEA-01–48 | 29. **Storyboard** — раскадровка и анимационные идеи. |
| QUBITE_MASTER_CONTEXT.md:520 | 20 | IDEA-01–48 | 30. **Visual Math Lab** — интерактивные формулы и графики. |
| QUBITE_MASTER_CONTEXT.md:521 | 20 | IDEA-01–48 | 31. **Reusable Elements** — библиотека рукописных/графических элементов. |
| QUBITE_MASTER_CONTEXT.md:522 | 20 | IDEA-01–48 | 32. **Print Studio** — A4, миникарточки, длинные полосы для термопринтера. |
| QUBITE_MASTER_CONTEXT.md:524 | 20 | IDEA-01–48 | ### Teams / Collaboration |
| QUBITE_MASTER_CONTEXT.md:525 | 20 | IDEA-01–48 | 33. **Spatial Comments** — комментарий к точной области, блоку, объекту. |
| QUBITE_MASTER_CONTEXT.md:526 | 20 | IDEA-01–48 | 34. **Team Decisions** — голосования и опросы, AI-обобщение мнений. |
| QUBITE_MASTER_CONTEXT.md:527 | 20 | IDEA-01–48 | 35. **Shared AI Sessions** — общий AI + персональные невидимые дополнения. |
| QUBITE_MASTER_CONTEXT.md:528 | 20 | IDEA-01–48 | 36. **Review Rooms** — пространство проверки конспектов, дизайна, документа. |
| QUBITE_MASTER_CONTEXT.md:529 | 20 | IDEA-01–48 | 37. **Team Replay** — история изменений разных участников. |
| QUBITE_MASTER_CONTEXT.md:530 | 20 | IDEA-01–48 | 38. **Guest Workspaces** — гостевые роли со сроком и scope. |
| QUBITE_MASTER_CONTEXT.md:532 | 20 | IDEA-01–48 | ### Intelligence / Automation / Ecosystem |
| QUBITE_MASTER_CONTEXT.md:533 | 20 | IDEA-01–48 | 39. **Automation Discovery** — предложения AI автоматизировать повторяемые сценарии. |
| QUBITE_MASTER_CONTEXT.md:534 | 20 | IDEA-01–48 | 40. **Workflow Simulator** — dry-run автоматизаций на тестовых событиях. |
| QUBITE_MASTER_CONTEXT.md:535 | 20 | IDEA-01–48 | 41. **AI Model Router** — выбор модели по стоимости, качеству, приватности. |
| QUBITE_MASTER_CONTEXT.md:536 | 20 | IDEA-01–48 | 42. **Plugin Studio** — AI создаёт и тестирует расширения перед одобрением. |
| QUBITE_MASTER_CONTEXT.md:537 | 20 | IDEA-01–48 | 43. **Personal API** — API/MCP для внешних скриптов и агентов. |
| QUBITE_MASTER_CONTEXT.md:538 | 20 | IDEA-01–48 | 44. **Smart Home Bridge** — будущая интеграция Shade AI. |
| QUBITE_MASTER_CONTEXT.md:539 | 20 | IDEA-01–48 | 45. **Integration Monitor** — статус синхронизации внешних интеграций. |
| QUBITE_MASTER_CONTEXT.md:540 | 20 | IDEA-01–48 | 46. **AI Cost Center** — стоимость по моделям, сценариям, проектам, лимиты. |
| QUBITE_MASTER_CONTEXT.md:541 | 20 | IDEA-01–48 | 47. **Notification Intelligence** — сводка и приоритизация входящих сигналов. |
| QUBITE_MASTER_CONTEXT.md:542 | 20 | IDEA-01–48 | 48. **Context Exporter** — перенос контекста между Codex/Claude/Hermes/другими агентами. |
| QUBITE_MASTER_CONTEXT.md:544 | 20 | IDEA-01–48 | **Дополнительно сверх 48:** AI Memory & Skills по примеру Hermes, сегрегированная память команды/личности, школьная инте |
| QUBITE_MASTER_CONTEXT.md:546 | 21 | NFR-ENG-01 | ## 21. Дорожная карта реализации — маленькие вертикальные срезы |
| QUBITE_MASTER_CONTEXT.md:548 | 21 | NFR-ENG-01 | ### 21.1. Правило выполнения |
| QUBITE_MASTER_CONTEXT.md:550 | 21 | NFR-ENG-01 | **Фича в backlog ≠ задача для кодинга.** Каждая задача должна быть достаточно мала, чтобы агент смог за одну итерацию: и |
| QUBITE_MASTER_CONTEXT.md:552 | 21 | NFR-ENG-01 | ### Track A: фундамент платформы (основной трек) |
| QUBITE_MASTER_CONTEXT.md:554 | 21 | NFR-ENG-01 | **A0. Repository discovery**   |
| QUBITE_MASTER_CONTEXT.md:555 | 21 | NFR-ENG-01 | Проверить реальную структуру существующего репозитория Qubite, код, лицензии, базу, релизы, CI/CD, инфраструктуру, источ |
| QUBITE_MASTER_CONTEXT.md:557 | 21 | NFR-ENG-01 | **A1. Design foundation**   |
| QUBITE_MASTER_CONTEXT.md:558 | 21 | NFR-ENG-01 | Компоненты кнопок, полей, меню, modal/drawer, навигации, карточек, мобильных табов, панелей, тем, motion tokens; пустой  |
| QUBITE_MASTER_CONTEXT.md:560 | 21 | NFR-ENG-01 | **A2. Core Object + Identity**   |
| QUBITE_MASTER_CONTEXT.md:561 | 21 | NFR-ENG-01 | PostgreSQL, миграции, owner account, workspaces и scoped permissions, `Object` metadata + типизированные доменные сущнос |
| QUBITE_MASTER_CONTEXT.md:563 | 21 | NFR-ENG-01 | **A3. Быстрая заметка (вертикальный срез)**   |
| QUBITE_MASTER_CONTEXT.md:564 | 21 | NFR-ENG-01 | На телефоне/ПК: создать короткую заметку, сохранить локально, отправить на сервер, перезагрузить, открыть на втором устр |
| QUBITE_MASTER_CONTEXT.md:566 | 21 | NFR-ENG-01 | **A4. Typed relations + search**   |
| QUBITE_MASTER_CONTEXT.md:567 | 21 | NFR-ENG-01 | Привязать заметку к проекту и создать простую задачу, найти обе через Command. Сначала keyword+filters, потом embeddings |
| QUBITE_MASTER_CONTEXT.md:569 | 21 | NFR-ENG-01 | **A5. Simple agent tools**   |
| QUBITE_MASTER_CONTEXT.md:570 | 21 | NFR-ENG-01 | Один безопасный tool `task.create_draft` + `objects.search`, с предварительным просмотром, аудитом и явным подтверждение |
| QUBITE_MASTER_CONTEXT.md:572 | 21 | NFR-ENG-01 | **A6. Basic Timeline**   |
| QUBITE_MASTER_CONTEXT.md:573 | 21 | NFR-ENG-01 | Две ревизии заметки, undo, просмотр diff и восстановление; синхронизация между устройствами. Глобальная история со време |
| QUBITE_MASTER_CONTEXT.md:575 | 21 | NFR-ENG-01 | **A7. Docs beta**   |
| QUBITE_MASTER_CONTEXT.md:576 | 21 | NFR-ENG-01 | Tiptap/Lexical POC, текст + чекбоксы + ссылки + изображение + базовая формула/вставка Ink, сохранение структурированных  |
| QUBITE_MASTER_CONTEXT.md:578 | 21 | NFR-ENG-01 | **A8. Planner beta**   |
| QUBITE_MASTER_CONTEXT.md:579 | 21 | NFR-ENG-01 | Проект, задачи, сроки, список, Kanban, недельный календарь, простые зависимости, напоминания; позже Gantt и повторяющиес |
| QUBITE_MASTER_CONTEXT.md:581 | 21 | NFR-ENG-01 | **A9. AI Context + Memory**   |
| QUBITE_MASTER_CONTEXT.md:582 | 21 | NFR-ENG-01 | Personal/Project scopes, event and semantic memory с provenance, Memory Inspector; только затем автоматические навыки. О |
| QUBITE_MASTER_CONTEXT.md:584 | 21 | NFR-ENG-01 | **A10. Today/Inbox/Notifications**   |
| QUBITE_MASTER_CONTEXT.md:585 | 21 | NFR-ENG-01 | Первый реальный дневной обзор из собственных задач/календаря и нескольких событий; пользователь закрепляет виджеты. AI-в |
| QUBITE_MASTER_CONTEXT.md:587 | 21 | NFR-ENG-01 | ### Track B: Ink и учебный ввод — технический риск исследовать параллельно с A0–A3 |
| QUBITE_MASTER_CONTEXT.md:589 | 21 | NFR-ENG-01 | **B0. Hardware diagnosis:** маленький Android APK для вывода coordinates, pressure, tilt, input type, latency; проверить |
| QUBITE_MASTER_CONTEXT.md:590 | 21 | NFR-ENG-01 | **B1. Ink benchmark:** сравнить Jetpack Ink/Cahier с простым Canvas/альтернативой на одинаковых заданиях, latency/frame  |
| QUBITE_MASTER_CONTEXT.md:591 | 21 | NFR-ENG-01 | **B2. Adaptive Ink:** 1 Euro Filter + corner preservation + presets + UI настройки; профилирование больших документов.   |
| QUBITE_MASTER_CONTEXT.md:592 | 21 | NFR-ENG-01 | **B3. Notebook:** страницы A4, бесконечный холст, undo/redo, hold-to-shape, circle-to-lasso, локальное сохранение, PDF.  |
| QUBITE_MASTER_CONTEXT.md:593 | 21 | NFR-ENG-01 | **B4. Ink sync:** версия структурированных штрихов, экспорт и импорт, совместимый viewer на Web.   |
| QUBITE_MASTER_CONTEXT.md:594 | 21 | NFR-ENG-01 | **B5. Ink Replay:** точки + относительные timestamp, deterministic playback, checkpoints; связать с отдельным аудио. |
| QUBITE_MASTER_CONTEXT.md:596 | 21 | NFR-ENG-01 | ### Track C: учеба / AI / живой сценарий |
| QUBITE_MASTER_CONTEXT.md:598 | 21 | NFR-ENG-01 | **C0. School adapter research:** точная версия «Госуслуги Моя школа», договорённости входа, разрешённый пользовательский |
| QUBITE_MASTER_CONTEXT.md:599 | 21 | NFR-ENG-01 | **C1. Homework:** предмет → задание → привязанный конспект → собственный прогресс/планирование.   |
| QUBITE_MASTER_CONTEXT.md:600 | 21 | NFR-ENG-01 | **C2. Audio:** явное разрешение записи, таймкоды и хранение; потом ASR benchmark на русском; diarization отдельно.   |
| QUBITE_MASTER_CONTEXT.md:601 | 21 | NFR-ENG-01 | **C3. Audio + Ink:** событие пера связано с записанным фрагментом; клик на рисунок перематывает аудио.   |
| QUBITE_MASTER_CONTEXT.md:602 | 21 | NFR-ENG-01 | **C4. Study assistant:** транскрипт и выделенная область → предложенные, но не самовольно вставленные определения; источ |
| QUBITE_MASTER_CONTEXT.md:603 | 21 | NFR-ENG-01 | **C5. FSRS+Quiz:** карточки, реальные ответы, интервальные повторения, профиль освоения.   |
| QUBITE_MASTER_CONTEXT.md:604 | 21 | NFR-ENG-01 | **C6. Math:** OCR выражения → подтверждение → проверяемое решение / график → инсерция.   |
| QUBITE_MASTER_CONTEXT.md:605 | 21 | NFR-ENG-01 | **C7. Thermal Print:** отдельный режим шпаргалки, испытание печати на реальном устройстве. |
| QUBITE_MASTER_CONTEXT.md:607 | 21 | NFR-ENG-01 | ### Track D: крупные отдельные релизы |
| QUBITE_MASTER_CONTEXT.md:609 | 21 | NFR-ENG-01 | **D1. Teams & collaboration:** роли, приглашения, ссылки, comments, Yjs для Docs, realtime canvas.   |
| QUBITE_MASTER_CONTEXT.md:610 | 21 | NFR-ENG-01 | **D2. Agent Skills/Memory:** долговременные scoped воспоминания, skill library, безопасные предложения обновления, интег |
| QUBITE_MASTER_CONTEXT.md:611 | 21 | NFR-ENG-01 | **D3. Pulse:** workflow engine, dry-run, approval policy, автоматическое обнаружение повторов.   |
| QUBITE_MASTER_CONTEXT.md:612 | 21 | NFR-ENG-01 | **D4. Plugins/MCP:** published Plugin SDK, плагин TypeScript «Hello Qubite» на всех поддерживаемых устройствах, MCP Code |
| QUBITE_MASTER_CONTEXT.md:613 | 21 | NFR-ENG-01 | **D5. Finance/Life/Focus:** отдельные независимые vertical slices: локальный финансовый ledger, защищённый дневник, Focu |
| QUBITE_MASTER_CONTEXT.md:614 | 21 | NFR-ENG-01 | **D6. Personal Handwriting:** профиль, локальная векторная генерация, обучение с проверкой, AI конспекты собственным поч |
| QUBITE_MASTER_CONTEXT.md:615 | 21 | NFR-ENG-01 | **D7. Studio:** кисти, слои, заливка, animation, onion skin, видео export.   |
| QUBITE_MASTER_CONTEXT.md:616 | 21 | NFR-ENG-01 | **D8. Open source release:** dependency/legal audit, публичный репозиторий, документация self-hosting, установщик, migra |
| QUBITE_MASTER_CONTEXT.md:618 | 21 | NFR-ENG-01 | ### 21.2. Рекомендуемый самый первый issue для Codex / Claude |
| QUBITE_MASTER_CONTEXT.md:620 | 21 | NFR-ENG-01 | **Цель:** `QUB-001 — Repository Recon & Architecture Baseline`.   |
| QUBITE_MASTER_CONTEXT.md:621 | 21 | NFR-ENG-01 | Входы: реальный репозиторий/файлы (если доступны), этот master context, история существующего Qubite.   |
| QUBITE_MASTER_CONTEXT.md:622 | 21 | NFR-ENG-01 | Выходы: inventory сервиса, карта зависимостей, список неопределённостей и 5–10 небольших issues для первого вертикальног |
| QUBITE_MASTER_CONTEXT.md:623 | 21 | NFR-ENG-01 | **НЕ в scope:** переписать весь старый Qubite, перестраивать прод, внедрять весь AI, запускать новый Vault, стирать данн |
| QUBITE_MASTER_CONTEXT.md:625 | 21 | NFR-ENG-01 | Вторая задача — `QUB-002 — Static UI Design System` или `QUB-002B — Jetpack Ink Input Probe`. Эти два трека могут идти п |
| QUBITE_MASTER_CONTEXT.md:627 | 22 | NFR-ENG-01 | ## 22. Definition of Done / Acceptance criteria |
| QUBITE_MASTER_CONTEXT.md:629 | 22 | NFR-ENG-01 | Функция считается реализованной только если: |
| QUBITE_MASTER_CONTEXT.md:631 | 22 | NFR-ENG-01 | 1. Запуск на чистой среде воспроизводим, зависимости и миграции документированы. |
| QUBITE_MASTER_CONTEXT.md:632 | 22 | NFR-ENG-01 | 2. Успешные и ошибочные сценарии тестируются, API и валидация типизированы. |
| QUBITE_MASTER_CONTEXT.md:633 | 22 | NFR-ENG-01 | 3. Автосохранение и восстановление данных проверены на закрытии приложения / обрыве сети / конфликте. |
| QUBITE_MASTER_CONTEXT.md:634 | 22 | NFR-ENG-01 | 4. UI реально проверен на целевых viewport, нет сломанной навигации или очевидных неудобств. |
| QUBITE_MASTER_CONTEXT.md:635 | 22 | NFR-ENG-01 | 5. Все права доступа и границы AI-memory проверены отрицательными кейсами (соседний workspace, team vs private, гости, п |
| QUBITE_MASTER_CONTEXT.md:636 | 22 | NFR-ENG-01 | 6. Нет секретов в логах, репозитории, скриншотах или AI-контексте. |
| QUBITE_MASTER_CONTEXT.md:637 | 22 | NFR-ENG-01 | 7. Тяжёлые фоновые задачи не блокируют быстрый пользовательский путь. |
| QUBITE_MASTER_CONTEXT.md:638 | 22 | NFR-ENG-01 | 8. Допускается откат, имеется аудит, пользователь видит статус асинхронных операций. |
| QUBITE_MASTER_CONTEXT.md:639 | 22 | NFR-ENG-01 | 9. Если функция заявлена как работающая офлайн — есть тест офлайн и повторного подключения. |
| QUBITE_MASTER_CONTEXT.md:640 | 22 | NFR-ENG-01 | 10. Для AI: видно, какие источники/инструменты использованы, сколько стоил запрос, не выдаются неподтверждённые результа |
| QUBITE_MASTER_CONTEXT.md:641 | 22 | NFR-ENG-01 | 11. Для Ink: проверка на реальном стилусе, ощущения, latency, обрезка по краям, быстрые штрихи, нажим, жесты, большие ст |
| QUBITE_MASTER_CONTEXT.md:642 | 22 | NFR-ENG-01 | 12. Нет утечки личных записей в shared search, embeddings, team agent, public links или сторонний plugin. |
| QUBITE_MASTER_CONTEXT.md:643 | 22 | NFR-ENG-01 | 13. Готово ревью, тесты, коммит с описанием, решение о релизе принял владелец. |
| QUBITE_MASTER_CONTEXT.md:645 | 23 | NFR-ENG-01 | ## 23. Открытые вопросы (не спрашивать повторно без необходимости) |
| QUBITE_MASTER_CONTEXT.md:647 | 23 | NFR-ENG-01 | - Название/домен Qubite: латинское написание в разных проектах и рабочие URL необходимо проверить в коде и у владельца п |
| QUBITE_MASTER_CONTEXT.md:648 | 23 | NFR-ENG-01 | - Реальная точная модель Lenovo и стилуса: аппаратные возможности нельзя вывести по разговорной транскрипции. |
| QUBITE_MASTER_CONTEXT.md:649 | 23 | NFR-ENG-01 | - Что уже есть в репозитории/инфраструктуре и где задействованы Cloudflare Tunnel, Caddy/Nginx, VPN, Postgres/SQLite, CI |
| QUBITE_MASTER_CONTEXT.md:650 | 23 | NFR-ENG-01 | - Выбор Tiptap vs Lexical, Kotlin/Compose vs гибрид, native ink format, локальный OCR, стабильность PDF; решать сравните |
| QUBITE_MASTER_CONTEXT.md:651 | 23 | NFR-ENG-01 | - Public API «Госуслуги Моя школа» — не подтверждён. Не осуществлять неавторизованный обход авторизации или хранение лог |
| QUBITE_MASTER_CONTEXT.md:652 | 23 | NFR-ENG-01 | - Реальный бюджет OpenRouter/ASR/эмбеддингов, лицензии библиотек, оценка вычислительных возможностей Raspberry, скорость |
| QUBITE_MASTER_CONTEXT.md:653 | 23 | NFR-ENG-01 | - Какую конкретно implementation memory/skills использует установленный Hermes — исследовать адаптер без предположения,  |
| QUBITE_MASTER_CONTEXT.md:654 | 23 | NFR-ENG-01 | - Модель end-to-end encryption и recovery для Private Vault, совместимость с серверными функциями AI. |
| QUBITE_MASTER_CONTEXT.md:655 | 23 | NFR-ENG-01 | - Степень автоматического разрешения действий агента и правила Guardian — проектировать на принципах безопасности и дове |
| QUBITE_MASTER_CONTEXT.md:656 | 23 | NFR-ENG-01 | - Мультипользовательские команды/публичная публикация — последующий релиз; с первого дня объекты и права должны допускат |
| QUBITE_MASTER_CONTEXT.md:658 | 24 | NFR-LEGAL-01 | ## 24. Open-source стратегия и лицензирование |
| QUBITE_MASTER_CONTEXT.md:660 | 24 | NFR-LEGAL-01 | - Пользователь хочет в перспективе открыть исходники и разрешить форки/использование, в том числе self-hosting; сохранит |
| QUBITE_MASTER_CONTEXT.md:661 | 24 | NFR-LEGAL-01 | - Рассмотреть MIT/Apache-2.0 для библиотек/SDK, AGPL-3.0 для серверного продукта **как варианты**, после юридического и  |
| QUBITE_MASTER_CONTEXT.md:662 | 24 | NFR-LEGAL-01 | - Notewise, Photomath, Procreate и часть Anytype/tldraw имеют закрытые/ограниченные лицензии; использовать как UX/featur |
| QUBITE_MASTER_CONTEXT.md:663 | 24 | NFR-LEGAL-01 | - Для будущих контрибьюторов продумать DCO/CLA, Code of Conduct, SECURITY.md, CONTRIBUTING.md, независимые dev/test окру |
| QUBITE_MASTER_CONTEXT.md:664 | 24 | NFR-LEGAL-01 | - AI-generated code и бинарные артефакты проверять на права, зависимости и наличие секретов. |
| QUBITE_MASTER_CONTEXT.md:666 | 25 | NFR-SEC-01 | ## 25. Запреты для AI-код-агента |
| QUBITE_MASTER_CONTEXT.md:668 | 25 | NFR-SEC-01 | - **НЕ** менять работающие старые Qubite-сервисы без отдельного утверждённого шага миграции. |
| QUBITE_MASTER_CONTEXT.md:669 | 25 | NFR-SEC-01 | - **НЕ** загружать пароль, API-токен, личную запись, школьную информацию или ключ от vault в публичный issue/commit/лог/ |
| QUBITE_MASTER_CONTEXT.md:670 | 25 | NFR-SEC-01 | - **НЕ** придумывать endpoints школьного дневника, банков, Kwork или Hermes; искать официальные интерфейсы и тестировать |
| QUBITE_MASTER_CONTEXT.md:671 | 25 | NFR-SEC-01 | - **НЕ** давать team agent прочитать personal memory или скрытый дневник; никогда не полагаться только на скрытие UI. |
| QUBITE_MASTER_CONTEXT.md:672 | 25 | NFR-SEC-01 | - **НЕ** генерировать сразу всю платформу, большие заглушки «функций», поддельные данные в production или скриншоты, выд |
| QUBITE_MASTER_CONTEXT.md:673 | 25 | NFR-SEC-01 | - **НЕ** приравнивать отсутствие интернета к потере контента. Никакие write-operation на конспекте не должны требовать у |
| QUBITE_MASTER_CONTEXT.md:674 | 25 | NFR-SEC-01 | - **НЕ** строить плагины с универсальным безусловным доступом к файловой системе/сети/ключам. |
| QUBITE_MASTER_CONTEXT.md:675 | 25 | NFR-SEC-01 | - **НЕ** выполнять разрушительные миграции/удаление/перезапись, массовую публикацию, финансовые переводы или блокировани |
| QUBITE_MASTER_CONTEXT.md:676 | 25 | NFR-SEC-01 | - **НЕ** раздувать UI, даже если feature backlog огромен. Предлагать прогрессивное раскрытие возможностей. |
| QUBITE_MASTER_CONTEXT.md:677 | 25 | NFR-SEC-01 | - **НЕ** писать «работает» до теста на реальном Android и подтверждения результата. |
| QUBITE_MASTER_CONTEXT.md:679 | 26 | NFR-LEGAL-01 | ## 26. Набор официальных первоисточников для будущего технического исследования |
| QUBITE_MASTER_CONTEXT.md:681 | 26 | NFR-LEGAL-01 | Страницы/лицензии/API **проверять снова в момент реализации**, ниже ссылки — отправные точки, а не обязательные зависимо |
| QUBITE_MASTER_CONTEXT.md:683 | 26 | NFR-LEGAL-01 | - Android Jetpack Ink: https://developer.android.com/jetpack/androidx/releases/ink |
| QUBITE_MASTER_CONTEXT.md:684 | 26 | NFR-LEGAL-01 | - Google Cahier sample: https://github.com/android/cahier |
| QUBITE_MASTER_CONTEXT.md:685 | 26 | NFR-LEGAL-01 | - Tiptap: https://tiptap.dev/docs — https://github.com/ueberdosis/tiptap |
| QUBITE_MASTER_CONTEXT.md:686 | 26 | NFR-LEGAL-01 | - Lexical: https://lexical.dev/ — https://github.com/facebook/lexical |
| QUBITE_MASTER_CONTEXT.md:687 | 26 | NFR-LEGAL-01 | - ProseMirror: https://prosemirror.net/ |
| QUBITE_MASTER_CONTEXT.md:688 | 26 | NFR-LEGAL-01 | - Yjs: https://github.com/yjs/yjs |
| QUBITE_MASTER_CONTEXT.md:689 | 26 | NFR-LEGAL-01 | - Hocuspocus: https://tiptap.dev/docs/hocuspocus |
| QUBITE_MASTER_CONTEXT.md:690 | 26 | NFR-LEGAL-01 | - Excalidraw: https://github.com/excalidraw/excalidraw |
| QUBITE_MASTER_CONTEXT.md:691 | 26 | NFR-LEGAL-01 | - Extism (portable Wasm plugin system): https://extism.org/docs/ |
| QUBITE_MASTER_CONTEXT.md:692 | 26 | NFR-LEGAL-01 | - MCP 2026 specification: https://modelcontextprotocol.io/specification/2026-07-28 |
| QUBITE_MASTER_CONTEXT.md:693 | 26 | NFR-LEGAL-01 | - OpenRouter routing/privacy: https://openrouter.ai/docs/guides/get-started/sovereign-ai |
| QUBITE_MASTER_CONTEXT.md:694 | 26 | NFR-LEGAL-01 | - Android dedicated device Lock Task: https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode |
| QUBITE_MASTER_CONTEXT.md:695 | 26 | NFR-LEGAL-01 | - YouTube History API limitation: https://developers.google.com/youtube/v3/docs/playlistItems/list |
| QUBITE_MASTER_CONTEXT.md:696 | 26 | NFR-LEGAL-01 | - SymPy: https://www.sympy.org/ |
| QUBITE_MASTER_CONTEXT.md:697 | 26 | NFR-LEGAL-01 | - ML Kit Digital Ink: https://developers.google.com/ml-kit/vision/digital-ink-recognition |
| QUBITE_MASTER_CONTEXT.md:698 | 26 | NFR-LEGAL-01 | - Whisper.cpp: https://github.com/ggml-org/whisper.cpp |
| QUBITE_MASTER_CONTEXT.md:699 | 26 | NFR-LEGAL-01 | - faster-whisper: https://github.com/SYSTRAN/faster-whisper |
| QUBITE_MASTER_CONTEXT.md:700 | 26 | NFR-LEGAL-01 | - pyannote: https://github.com/pyannote/pyannote-audio |
| QUBITE_MASTER_CONTEXT.md:701 | 26 | NFR-LEGAL-01 | - FSRS: https://github.com/open-spaced-repetition/ts-fsrs |
| QUBITE_MASTER_CONTEXT.md:702 | 26 | NFR-LEGAL-01 | - PostgreSQL / pgvector: https://www.postgresql.org/ — https://github.com/pgvector/pgvector |
| QUBITE_MASTER_CONTEXT.md:703 | 26 | NFR-LEGAL-01 | - Google Takeout: https://takeout.google.com/ |
| QUBITE_MASTER_CONTEXT.md:704 | 26 | NFR-LEGAL-01 | - LanguageTool: https://languagetool.org/ |
| QUBITE_MASTER_CONTEXT.md:705 | 26 | NFR-LEGAL-01 | - Google «Моя школа»: проверять актуальные официальные источники/условия доступа; не считать неофициальные reverse-engin |
| QUBITE_MASTER_CONTEXT.md:707 | 27 | NFR-ENG-01 | ## 27. Стандартный протокол работы Codex/Claude |
| QUBITE_MASTER_CONTEXT.md:709 | 27 | NFR-ENG-01 | 1. Открыть `QUBITE_MASTER_CONTEXT.md` и `AGENTS.md`/`CLAUDE.md`, затем просканировать **реальный код** и доступные окруж |
| QUBITE_MASTER_CONTEXT.md:710 | 27 | NFR-ENG-01 | 2. Сформулировать задачу в терминах user outcome, что доступно сейчас, что нужно сделать, out of scope, acceptance crite |
| QUBITE_MASTER_CONTEXT.md:711 | 27 | NFR-ENG-01 | 3. Отметить `confirmed / preferred / unknown` и при архитектурном конфликте записать ADR: альтернативы, tradeoffs, приня |
| QUBITE_MASTER_CONTEXT.md:712 | 27 | NFR-ENG-01 | 4. Составить маленький конкретный план; **не рефакторить не относящиеся части** и не расширять scope по собственной иниц |
| QUBITE_MASTER_CONTEXT.md:713 | 27 | NFR-ENG-01 | 5. Сделать реализацию, тесты, реальный запуск/сборку/линтеры. Для UI показать реальный screenshot/описать как проверить, |
| QUBITE_MASTER_CONTEXT.md:714 | 27 | NFR-ENG-01 | 6. Обновить документацию API, миграций и changelog. При необходимости создать Follow-up issues вместо полупустых «готово |
| QUBITE_MASTER_CONTEXT.md:715 | 27 | NFR-ENG-01 | 7. Отчитаться: что изменено, какие файлы, что протестировано, риски и остаток, коммит/ссылка, один следующий рекомендуем |
| QUBITE_MASTER_CONTEXT.md:716 | 27 | NFR-ENG-01 | 8. Сохранять все успешные повторяемые паттерны как **предложения агентных skills** с тестами и разрешениями, но не переп |
| QUBITE_MASTER_CONTEXT.md:718 | 27 | NFR-ENG-01 | ### Шаблон ответа агента после одной выполненной задачи |
| QUBITE_MASTER_CONTEXT.md:720 | 27 | NFR-ENG-01 | ```text |
| QUBITE_MASTER_CONTEXT.md:721 | 27 | NFR-ENG-01 | TASK: QUB-xxx |
| QUBITE_MASTER_CONTEXT.md:722 | 27 | NFR-ENG-01 | Что сделано: |
| QUBITE_MASTER_CONTEXT.md:723 | 27 | NFR-ENG-01 | Затронутые файлы: |
| QUBITE_MASTER_CONTEXT.md:724 | 27 | NFR-ENG-01 | Реальные проверки / результаты: |
| QUBITE_MASTER_CONTEXT.md:725 | 27 | NFR-ENG-01 | Устройства / среды, на которых проверено: |
| QUBITE_MASTER_CONTEXT.md:726 | 27 | NFR-ENG-01 | Миграции / влияние на данные: |
| QUBITE_MASTER_CONTEXT.md:727 | 27 | NFR-ENG-01 | Какие scopes/permissions затронуты: |
| QUBITE_MASTER_CONTEXT.md:728 | 27 | NFR-ENG-01 | Что НЕ сделано и почему: |
| QUBITE_MASTER_CONTEXT.md:729 | 27 | NFR-ENG-01 | Риски / ограничения: |
| QUBITE_MASTER_CONTEXT.md:730 | 27 | NFR-ENG-01 | Коммит: |
| QUBITE_MASTER_CONTEXT.md:731 | 27 | NFR-ENG-01 | Следующий маленький шаг: |
| QUBITE_MASTER_CONTEXT.md:732 | 27 | NFR-ENG-01 | ``` |
| QUBITE_MASTER_CONTEXT.md:734 | 27 | NFR-ENG-01 | --- |
| QUBITE_MASTER_CONTEXT.md:736 | 27 | NFR-ENG-01 | ### Финальное утверждение о продукте |
| QUBITE_MASTER_CONTEXT.md:738 | 27 | NFR-ENG-01 | **Qubite — персональная цифровая среда, которая хранит знания, действия и историю, помогает учиться, работать и создават |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:1 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | # Qubite — Identity, Owner Console, Module Access & AI Budget Policy |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:3 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | **Статус:** уточнение владельца к Qubite v1.0; обязательная часть целевого ТЗ. **Сейчас речь о проектировании; наличие р |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:5 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | ## Ключевое продуктовое решение |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:7 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | Qubite — пользовательское рабочее пространство, а не турнирная админка. Весь стандартный интерфейс одинаков по структуре |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:9 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | **Qubite Tournaments** — отдельный необязательный legacy-модуль, размещённый в каталоге модулей или разделе «Сервисы», а |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:11 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | На первом этапе **единственный глобальный владелец — текущий владелец платформы**. Не следует создавать ненужную иерархи |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:13 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | ## Три независимых уровня прав |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:15 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | 1. **Platform identity & privileges** — аккаунт, подтверждение учётной записи, `platform_owner`, доступ в `Owner Console |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:16 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | 2. **Module entitlements** — отдельное право `module.<id>.access` и **внутренние** разрешения модуля. Например, `docs.ac |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:17 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | 3. **Resource permissions & AI budgets** — доступ к конкретному workspace/проекту/документу/операции (ACL), отдельные ра |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:19 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | **По умолчанию `deny`:** новый зарегистрированный пользователь может авторизоваться, видеть собственный профиль и минима |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:21 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | При чтении списка модулей учитывать статусы `not_installed / installed / disabled / enabled`, доступ пользователя `not_g |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:23 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | ## Owner Console — доступна только владельцу |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:25 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | - **Пользователи:** список, поиск, создание аккаунта вручную/инвайты, активация, блокировка, сброс/отзыв сессий, удалени |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:26 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | - **Модули:** глобально включить/выключить, установить/обновить и настроить модуль; отдельно — гранты конкретным пользов |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:27 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | - **AI / модели / бюджеты:** настройка OpenRouter и других провайдеров; server-side ключи; allowlist моделей и методов;  |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:28 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | - **Интеграции:** настройка Search, Writer, Hermes, Telegram, Kwork, VPN, AliasVault, школьного дневника и других адапте |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:29 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | - **Безопасность и аудит:** кто выдал и отозвал грант, изменил настройки, вызвал дорогую модель, сколько реально потраче |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:31 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | В обычном профиле пользователя могут отображаться его **собственные** доступные модули, текущие лимиты и возможность зап |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:33 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | ## Контроль стоимости — enforce на сервере |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:35 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | - **Никаких доверенных проверок только во фронтенде.** Все HTTP, websocket, backend jobs, automation/Pulse, agent tool c |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:36 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | - Отдельно проверять: субъект и workspace → право на модуль → право на действие/источник → разрешённый провайдер и модел |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:37 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | - Квота платного вызова должна резервироваться транзакционно перед отправкой запроса; по итоговому usage списывается фак |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:38 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | - При нулевом/исчерпанном/неизвестном бюджете: **отказать до платного вызова**, объяснить причину и предложить бесплатну |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:39 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | - Стоимость вести отдельно по пользователю/проекту/модулю/агенту/провайдеру; сделать owner-дашборд расхода и журнал с ме |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:40 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | - Открытая регистрация, публичная ссылка, владение документом и членство в команде **не дают** автоматического AI-доступ |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:42 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | ## Permissions MVP: тестовые случаи |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:44 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | 1. Новый пользователь вошёл, но **не может** открыть закрытый модуль и вызвать его API. |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:45 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | 2. Существующий модуль разрешён, но **платный AI запрещён** → AI endpoint, agent, MCP, background automation возвращают  |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:46 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | 3. Модель разрешена, но бюджет = 0 или исчерпан → вызов не уходит к провайдеру. |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:47 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | 4. Два параллельных запроса не обходят лимит. |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:48 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | 5. Участник/организатор турнира не получает глобальные owner-права и доступ к чужим проектам. |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:49 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | 6. Отозванный грант/сессия прекращает новый доступ; поиск и кэш не раскрывают чужие данные. |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:50 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | 7. Публичная ссылка и гостевая сессия не имеют платных возможностей по умолчанию. |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:51 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | 8. Плагин, Hermes, MCP и AI-агент не могут повысить права по сравнению с инициатором. |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:52 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | 9. Owner видит **обычный интерфейс** плюс отдельную панель управления; другие пользователи не видят owner-раздел и не по |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:53 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | 10. Владелец вручную выдал конкретному пользователю доступ к Docs, но не к Search/AI/Tournaments — пользователь видит и  |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:55 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | ## Миграция существующего репозитория |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:57 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | В ходе аудита найти **реальные** таблицы аккаунтов, роли, маршруты auth, admin UI, service grants и ограничения Qubite S |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:59 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | ## Первый вертикальный срез на разработку |
| QUBITE_ACCESS_AND_OWNER_CONSOLE.md:61 | access policy | REQ-OWNER-01 / REQ-CORE-01 / REQ-AI-01 | `QUB-AUTH-001`: войти как owner → открыть обычную главную → войти в Owner Console → создать тестовый пользовательский ак |
