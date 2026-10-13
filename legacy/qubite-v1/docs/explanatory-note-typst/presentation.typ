#import "config/metadata.typ": (
  project_name, school_name, student_class, student_name, supervisor_name,
  topic, year,
)

#set document(
  title: "Презентация к защите проекта Qubite",
  author: student_name,
)

#set page(width: 160mm, height: 90mm, margin: 0pt, numbering: none)
#set text(font: "Manrope", lang: "ru", size: 8pt, fill: rgb("#e2e8f0"))
#set par(leading: 0.55em, spacing: 0.4em)
#set list(indent: 1.0em, body-indent: 0.5em)

// ── Colour tokens (Qubite brand, dark theme) ───────────────────
#let bg-1 = rgb("#0b1220")
#let bg-2 = rgb("#020617")
#let bg-card = rgb("#131b2e")
#let fg = rgb("#e2e8f0")
#let fg-strong = rgb("#f8fafc")
#let fg-muted = rgb("#94a3b8")
#let card-brd = rgb("#1e293b")
#let rose = rgb("#f43f5e")
#let amber = rgb("#f59e0b")
#let green = rgb("#22c55e")
#let violet = rgb("#8b5cf6")
#let sky = rgb("#38bdf8")
#let total-slides = 16

// ── Progress bar ───────────────────────────────────────────────
#let progress-bar(n) = grid(
  columns: (n / total-slides * 100%, 1fr),
  rows: 2pt,
  rect(width: 100%, height: 100%, fill: gradient.linear(rose, amber)),
  rect(width: 100%, height: 100%, fill: card-brd),
)

// ── Slide wrapper ──────────────────────────────────────────────
#let deck-slide(title, n: 1, subtitle: none, body) = rect(
  width: 100%,
  height: 100%,
  fill: bg-1,
)[
  #progress-bar(n)
  #pad(left: 8mm, right: 8mm, top: 4.5mm, bottom: 5mm)[
    #grid(
      columns: (1fr, auto),
      align: (left + horizon, right + top),
      [
        #text(font: "Jura", size: 15pt, weight: "bold", fill: fg-strong)[#title]
        #if subtitle != none [
          #v(0.8mm)
          #text(size: 7pt, fill: fg-muted)[#subtitle]
        ]
      ],
      box[
        #grid(
          columns: (5mm, auto),
          gutter: 1.5pt,
          align: horizon,
          image("assets/slides/qubite-icon.svg", width: 5mm),
          text(
            font: "Space Grotesk",
            size: 5.5pt,
            weight: "light",
            fill: white,
          )[Qubite],
        )
      ],
    )
    #v(3mm)
    #body
  ]
]

// ── Building blocks ────────────────────────────────────────────

#let card(body) = rect(
  width: 100%,
  fill: bg-card,
  stroke: 0.45pt + card-brd,
  radius: 5pt,
  inset: 6pt,
)[#body]

#let qubite-logo(size: 27pt, color: fg-strong) = box[
  #grid(
    columns: (size, auto),
    gutter: 4pt,
    align: horizon,
    image("assets/slides/qubite-icon.svg", width: size, height: size),
    text(
      font: "Space Grotesk",
      size: size * 0.72,
      weight: "light",
      fill: color,
    )[Qubite],
  )
]

#let accent-bar(body, accent: rose) = rect(
  width: 100%,
  fill: bg-card,
  radius: 5pt,
  stroke: (
    left: 2.5pt + accent,
    top: 0.4pt + card-brd,
    right: 0.4pt + card-brd,
    bottom: 0.4pt + card-brd,
  ),
  inset: (left: 7pt, top: 5pt, bottom: 5pt, right: 5pt),
)[#body]

#let tag(label, fill: rose) = box(
  fill: fill,
  radius: 3pt,
  inset: (x: 5pt, y: 2.5pt),
)[#text(size: 5.5pt, weight: "bold", fill: white)[#label]]

#let panel(title, body, accent: rose) = rect(
  width: 100%,
  fill: bg-card,
  stroke: 0.45pt + card-brd,
  radius: 5pt,
  inset: 0pt,
)[
  #rect(
    width: 100%,
    fill: accent,
    radius: (top-left: 5pt, top-right: 5pt),
    inset: 5pt,
  )[
    #align(center)[#text(
      font: "Jura",
      size: 8.5pt,
      weight: "bold",
      fill: white,
    )[#title]]
  ]
  #pad(x: 6pt, y: 5pt)[#body]
]

#let screenshot(path) = rect(
  fill: bg-2,
  radius: 5pt,
  stroke: 0.4pt + card-brd,
  inset: 1.5pt,
)[#image(path, width: 100%)]

// ── Title slide ────────────────────────────────────────────────
#let title-slide(n: 1) = rect(width: 100%, height: 100%, fill: bg-2)[
  #progress-bar(n)
  #pad(left: 8mm, right: 8mm, top: 5mm, bottom: 5mm)[
    #text(
      font: "Jura",
      size: 14.5pt,
      weight: "bold",
      fill: fg-strong,
    )[Проектная работа]
    #v(0.8mm)
    #text(size: 7pt, fill: fg-muted)[#topic]
    #v(3mm)
    #grid(
      columns: (1.0fr, 0.95fr),
      gutter: 7mm,
      [
        #v(3mm)
        #qubite-logo(size: 31pt)
        #v(1mm)
        #text(
          font: "Jura",
          size: 11pt,
          fill: fg,
        )[Веб-платформа для автоматизации проверки знаний]
        #v(12mm)
        #rect(
          fill: bg-card,
          radius: 5pt,
          inset: 6pt,
          stroke: 0.4pt + card-brd,
          width: 100%,
        )[
          #text(size: 7.3pt, fill: fg-muted)[
            #text(weight: "bold", fill: fg)[Автор:] #student_name, #student_class \
            #text(weight: "bold", fill: fg)[Руководитель:] #supervisor_name \
            #text(weight: "bold", fill: fg)[Учебный год:] 2025--2026
          ]
        ]
      ],
      [
        #screenshot("assets/screenshots/01-landing.png")
      ],
    )
  ]
]

// ════════════════════════════════════════════════════════════════
//  1 ─ Титульный
// ════════════════════════════════════════════════════════════════
#title-slide(n: 1)

#pagebreak()

// ════════════════════════════════════════════════════════════════
//  2 ─ Актуальность и проблема
// ════════════════════════════════════════════════════════════════
#deck-slide(
  [Актуальность и проблема],
  n: 2,
  subtitle: [Формы, таблицы и переписки решают отдельные задачи, но плохо работают как единая турнирная система.],
)[
  #image("assets/screenshots/problem-to-platform.png", width: 100%)
]

#pagebreak()

// ════════════════════════════════════════════════════════════════
//  3 ─ Идея проекта
// ════════════════════════════════════════════════════════════════
#deck-slide(
  [Идея проекта],
  n: 3,
  subtitle: [Турнир как центральный объект, вокруг которого строится весь сценарий.],
)[
  #grid(
    columns: (1.1fr, 0.9fr),
    gutter: 5mm,
    image("assets/screenshots/idea-tournament.png", width: 100%),
    [
      #v(2mm)
      #accent-bar(accent: rose)[
        #text(
          font: "Jura",
          size: 8pt,
          weight: "bold",
          fill: rose,
        )[Объект исследования] \
        #v(1mm)
        Цифровые средства организации и проверки учебных заданий.
      ]
      #v(3.5mm)
      #accent-bar(accent: violet)[
        #text(
          font: "Jura",
          size: 8pt,
          weight: "bold",
          fill: violet,
        )[Предмет исследования] \
        #v(1mm)
        Архитектура и практическая реализация веб-платформы для автоматизации проверки знаний.
      ]
    ],
  )
]

#pagebreak()

// ════════════════════════════════════════════════════════════════
//  4 ─ Цель, гипотеза и задачи
// ════════════════════════════════════════════════════════════════
#deck-slide(
  [Цель, гипотеза и задачи],
  n: 4,
)[
  #grid(
    columns: (1fr, 1.2fr),
    gutter: 5mm,
    [
      #accent-bar(accent: rose)[
        #text(font: "Jura", size: 8.5pt, weight: "bold", fill: rose)[Цель] \
        #v(1.5mm)
        Создать рабочий MVP платформы для учебных турниров и автоматической проверки типовых ответов.
      ]
      #v(4mm)
      #accent-bar(accent: violet)[
        #text(
          font: "Jura",
          size: 8.5pt,
          weight: "bold",
          fill: violet,
        )[Гипотеза] \
        #v(1.5mm)
        Единая система с ролями, задачами и рейтингом делает проверку быстрее и прозрачнее.
      ]
    ],
    [
      #card[
        #text(font: "Jura", size: 8.5pt, weight: "bold", fill: amber)[Задачи] \
        #v(2.5mm)
        #grid(
          columns: (6mm, 1fr),
          gutter: 2pt,
          row-gutter: 4.5mm,
          text(font: "Jura", size: 9pt, weight: "bold", fill: rose)[1.],
          [Изучить предметную область и аналоги],

          text(font: "Jura", size: 9pt, weight: "bold", fill: rose)[2.],
          [Определить требования к платформе],

          text(font: "Jura", size: 9pt, weight: "bold", fill: rose)[3.],
          [Спроектировать клиент, сервер и БД],

          text(font: "Jura", size: 9pt, weight: "bold", fill: rose)[4.],
          [Реализовать турниры, задачи, рейтинг],

          text(font: "Jura", size: 9pt, weight: "bold", fill: rose)[5.],
          [Описать безопасность и развитие],
        )
      ]
    ],
  )
]

#pagebreak()

// ════════════════════════════════════════════════════════════════
//  5 ─ Методы работы
// ════════════════════════════════════════════════════════════════
#deck-slide(
  [Методы работы],
  n: 5,
)[
  #grid(
    columns: (1fr, 1fr),
    gutter: 5mm,
    [
      #accent-bar(accent: sky)[
        #text(font: "Jura", size: 8pt, weight: "bold", fill: sky)[Тип проекта] \
        #v(1mm)
        Прикладной, практико-ориентированный с элементами конструкторской разработки.
      ]
      #v(3mm)
      #card[
        #text(
          font: "Jura",
          size: 8pt,
          weight: "bold",
          fill: amber,
        )[Методы исследования] \
        #v(2mm)
        #list(
          [Анализ литературы и аналогов],
          [Декомпозиция системы на модули],
          [Проектирование структуры данных],
          [Прототипирование и тестирование],
        )
      ]
      #v(3mm)
      #accent-bar(accent: violet)[
        #text(
          font: "Jura",
          size: 8pt,
          weight: "bold",
          fill: violet,
        )[Продукт проекта] \
        #v(1mm)
        Программный MVP-прототип веб-платформы Qubite.
      ]
    ],
    [
      #image("assets/screenshots/methods-workflow.png", width: 100%)
    ],
  )
]

#pagebreak()

// ════════════════════════════════════════════════════════════════
//  6 ─ Анализ аналогов
// ════════════════════════════════════════════════════════════════
#deck-slide(
  [Анализ аналогов],
  n: 6,
  subtitle: [Гибридный подход: простота школьного инструмента + элементы настоящей web-платформы.],
)[
  #table(
    columns: (22%, 35%, 43%),
    inset: 5.5pt,
    stroke: 0.45pt + card-brd,
    align: horizon,
    fill: (_, y) => if y == 0 { bg-card } else { bg-2 },
    table.header(
      [#text(font: "Jura", weight: "bold", fill: fg-strong)[Тип инструмента]],
      [#text(font: "Jura", weight: "bold", fill: fg-strong)[Сильная сторона]],
      [#text(
        font: "Jura",
        weight: "bold",
        fill: fg-strong,
      )[Ограничение для проекта]],
    ),
    [Онлайн-формы], [Просты в использовании], [Нет турниров, ролей и рейтингов],
    [Сервисы викторин], [Хорошо вовлекают], [Ограничены форматами и правилами],
    [Олимпиадные системы],
    [Мощные для соревнований],
    [Сложны для школьного применения],
  )
  #v(1fr)
  #accent-bar(accent: rose)[
    #text(
      font: "Jura",
      size: 8pt,
      weight: "bold",
      fill: rose,
    )[Подход Qubite] #h(3pt)
    #text(
      fill: fg,
    )[— простота школьного инструмента, но с ролями, сервером, БД, рейтингом и защитой.]
  ]
]

#pagebreak()

// ════════════════════════════════════════════════════════════════
//  7 ─ Архитектура
// ════════════════════════════════════════════════════════════════
#deck-slide(
  [Архитектура],
  n: 7,
  subtitle: [Монолитное клиент-серверное web-приложение.],
)[
  #align(center)[#image(
    "assets/screenshots/architecture.png",
    width: 100%,
    height: 70mm,
    fit: "contain",
  )]
]

#pagebreak()

// ════════════════════════════════════════════════════════════════
//  8 ─ Используемые технологии
// ════════════════════════════════════════════════════════════════
#rect(width: 100%, height: 100%, fill: bg-2)[
  #progress-bar(8)
  #pad(left: 8mm, right: 8mm, top: 4.5mm, bottom: 5mm)[
    #text(
      font: "Jura",
      size: 15pt,
      weight: "bold",
      fill: fg-strong,
    )[Используемые технологии]
    #v(0.8mm)
    #text(
      size: 7pt,
      fill: fg-muted,
    )[Стек выбран как практичный для школьного проекта и понятный для локального запуска.]
    #v(3.5mm)
    #grid(
      columns: (1fr, 1fr, 1fr),
      gutter: 3.5mm,
      rect(
        width: 100%,
        fill: bg-card,
        radius: 5pt,
        inset: 8pt,
        stroke: 0.4pt + card-brd,
      )[
        #text(font: "Jura", size: 10pt, weight: "bold", fill: rose)[Клиент]
        #v(3mm)
        #text(size: 8.5pt, fill: fg-strong)[HTML5, CSS3, JavaScript]
        #v(2.5mm)
        #text(
          fill: fg-muted,
          size: 7.5pt,
        )[Весь UI на vanilla JS — без фреймворков. Адаптивная вёрстка, модалки, SPA-навигация.]
      ],
      rect(
        width: 100%,
        fill: bg-card,
        radius: 5pt,
        inset: 8pt,
        stroke: 0.4pt + card-brd,
      )[
        #text(font: "Jura", size: 10pt, weight: "bold", fill: amber)[Сервер]
        #v(3mm)
        #text(size: 8.5pt, fill: fg-strong)[Node.js, Express, REST API]
        #v(2.5mm)
        #text(
          fill: fg-muted,
          size: 7.5pt,
        )[SQLite для хранения данных, xlsx-импорт задач и участников.]
      ],
      rect(
        width: 100%,
        fill: bg-card,
        radius: 5pt,
        inset: 8pt,
        stroke: 0.4pt + card-brd,
      )[
        #text(
          font: "Jura",
          size: 10pt,
          weight: "bold",
          fill: violet,
        )[Инфраструктура]
        #v(3mm)
        #text(size: 8.5pt, fill: fg-strong)[Nginx, PM2, Cloudflare]
        #v(2.5mm)
        #text(
          fill: fg-muted,
          size: 7.5pt,
        )[Turnstile CAPTCHA, OAuth 2.0, Telegram Bot для управления.]
      ],
    )
    #v(4mm)
    #rect(
      fill: bg-card,
      radius: 5pt,
      inset: 7pt,
      width: 100%,
      stroke: 0.4pt + card-brd,
    )[
      #text(size: 7.5pt, fill: fg-muted)[
        #text(weight: "bold", fill: amber)[Также:] scrypt-хеширование · cookie-сессии · CSRF-защита · rate limiting · audit log · Elo-рейтинг
      ]
    ]
    #v(1fr)
    #align(center)[
      #text(
        size: 7pt,
        fill: fg-muted,
      )[OAuth-провайдеры: Google · Yandex · VK ID · Telegram]
    ]
  ]
]

#pagebreak()

// ════════════════════════════════════════════════════════════════
//  9 ─ Реализованный функционал
// ════════════════════════════════════════════════════════════════
#deck-slide(
  [Реализованный функционал],
  n: 9,
)[
  #grid(
    columns: (1fr, 1fr, 1fr),
    gutter: 3mm,
    [
      #screenshot("assets/screenshots/05-tournament-overview.png")
      #v(2mm)
      #text(
        font: "Jura",
        size: 7.5pt,
        weight: "bold",
        fill: rose,
      )[Турниры и задачи]
      #v(1mm)
      #text(
        size: 7pt,
      )[4 режима допуска, банк задач, 4 типа заданий, автопроверка]
    ],
    [
      #screenshot("assets/screenshots/06-tournament-rating.png")
      #v(2mm)
      #text(
        font: "Jura",
        size: 7.5pt,
        weight: "bold",
        fill: amber,
      )[Рейтинг и команды]
      #v(1mm)
      #text(
        size: 7pt,
      )[Elo-рейтинг, лидерборд, командное участие, ежедневные задания]
    ],
    [
      #screenshot("assets/screenshots/profile-analytics.png")
      #v(2mm)
      #text(
        font: "Jura",
        size: 7.5pt,
        weight: "bold",
        fill: violet,
      )[Профиль и аналитика]
      #v(1mm)
      #text(
        size: 7pt,
      )[Личный кабинет, графики прогресса, история участия, достижения]
    ],
  )
  #v(3mm)
  #align(center)[
    #text(size: 7pt, fill: fg-muted)[
      OAuth-вход · Email-подтверждение · Восстановление пароля · Excel-импорт · Telegram-бот · Профиль и статистика
    ]
  ]
]

#pagebreak()

// ════════════════════════════════════════════════════════════════
//  10 ─ Роли пользователей
// ════════════════════════════════════════════════════════════════
#deck-slide(
  [Роли пользователей],
  n: 10,
  subtitle: [Каждая роль видит только свой контур работы.],
)[
  #grid(
    columns: (1.2fr, 0.8fr),
    gutter: 4mm,
    align: horizon,
    [
      #v(4mm)
      #table(
        columns: (18%, 82%),
        inset: 5pt,
        stroke: 0.45pt + card-brd,
        align: horizon,
        fill: (_, y) => if y == 0 { bg-card } else { bg-2 },
        table.header(
          [#text(font: "Jura", weight: "bold", fill: fg-strong)[Роль]],
          [#text(
            font: "Jura",
            weight: "bold",
            fill: fg-strong,
          )[Основные возможности]],
        ),
        [#tag([user], fill: rose)],
        [Участие в турнирах, задачи, рейтинг, аналитика],

        [#tag([organizer], fill: amber)],
        [Создание турниров, импорт, просмотр результатов],

        [#tag([moderator], fill: violet)], [Проверка задач и заявок, контроль],
        [#tag([admin], fill: sky)], [Управление пользователями, аудит],
        [#tag([owner], fill: green)], [Системные настройки, hard delete],
      )
    ],
    [
      #v(-3mm)
      #image("assets/screenshots/roles-hierarchy.png", width: 100%)
    ],
  )
]

#pagebreak()

// ════════════════════════════════════════════════════════════════
//  11 ─ Безопасность
// ════════════════════════════════════════════════════════════════
#deck-slide(
  [Безопасность],
  n: 11,
  subtitle: [Защита встроена в ключевые точки работы сервиса.],
)[
  #grid(
    columns: (1fr, 0.75fr),
    gutter: 5mm,
    [
      #grid(
        columns: (1fr, 1fr),
        gutter: 3.5mm,
        row-gutter: 3.5mm,
        card[
          #text(font: "Jura", size: 7.5pt, weight: "bold", fill: rose)[Пароли]
          #v(1mm)
          #text(size: 7pt)[scrypt, безопасное хранение]
        ],
        card[
          #text(font: "Jura", size: 7.5pt, weight: "bold", fill: amber)[Сессии]
          #v(1mm)
          #text(size: 7pt)[Cookie, CSRF-защита, logout]
        ],

        card[
          #text(font: "Jura", size: 7.5pt, weight: "bold", fill: violet)[Email]
          #v(1mm)
          #text(size: 7pt)[Challenge-flow, подтверждение]
        ],
        card[
          #text(font: "Jura", size: 7.5pt, weight: "bold", fill: sky)[CAPTCHA]
          #v(1mm)
          #text(size: 7pt)[Turnstile для критичных форм]
        ],

        card[
          #text(
            font: "Jura",
            size: 7.5pt,
            weight: "bold",
            fill: green,
          )[Rate limiting]
          #v(1mm)
          #text(size: 7pt)[Ограничение запросов]
        ],
        card[
          #text(font: "Jura", size: 7.5pt, weight: "bold", fill: amber)[Аудит]
          #v(1mm)
          #text(size: 7pt)[Журнал важных действий]
        ],
      )
    ],
    [
      #image("assets/screenshots/security-shield.png", width: 100%)
    ],
  )
]

#pagebreak()

// ════════════════════════════════════════════════════════════════
//  12 ─ Демонстрация продукта
// ════════════════════════════════════════════════════════════════
#deck-slide(
  [Демонстрация продукта],
  n: 12,
  subtitle: [Ключевые экраны текущего интерфейса.],
)[
  #grid(
    columns: (1fr, 1fr, 1fr),
    gutter: 2.5mm,
    screenshot("assets/screenshots/02-landing-features.png"),
    screenshot("assets/screenshots/02-login-modal.png"),
    screenshot("assets/screenshots/04-tournaments-list.png"),

    screenshot("assets/screenshots/05-tournament-overview.png"),
    screenshot("assets/screenshots/06-tournament-rating.png"),
    // QR-код с фирменной рамкой
    [
      #align(center)[
        #rect(
          radius: 4pt,
          inset: 0.8pt,
          stroke: 1.4pt + gradient.linear(rose, amber),
          fill: white,
        )[
          #box[
            #image("assets/slides/qubite-qr.svg", width: 25mm)
            #place(center + horizon)[
              #rect(fill: white, radius: 3pt, inset: 0.6pt)[
                #image("../../front/img/icon.svg", width: 5.2mm)
              ]
            ]
          ]
        ]
      ]
      #v(1.5mm)
      #align(center)[
        #text(font: "Jura", size: 7pt, weight: "bold", fill: rose)[qubiteapp.ru]
      ]
    ],
  )
]

#pagebreak()

// ════════════════════════════════════════════════════════════════
//  13 ─ Границы MVP и развитие
// ════════════════════════════════════════════════════════════════
#deck-slide(
  [Границы MVP и развитие],
  n: 13,
)[
  #set list(spacing: 1.8em)
  #grid(
    columns: (1fr, 1fr),
    gutter: 4mm,
    rect(
      width: 100%,
      fill: bg-card,
      stroke: 0.45pt + card-brd,
      radius: 5pt,
      inset: 0pt,
    )[
      #rect(
        width: 100%,
        fill: rose,
        radius: (top-left: 5pt, top-right: 5pt),
        inset: 5pt,
      )[
        #align(center)[#text(
          font: "Jura",
          size: 8.5pt,
          weight: "bold",
          fill: white,
        )[Реализовано]]
      ]
      #pad(x: 8pt, y: 8pt)[
        #set text(size: 8pt, fill: fg)
        #list(
          [Турниры с режимами допуска],
          [Роли и разделение прав],
          [Банк задач и автопроверка],
          [Рейтинг, лидерборд и история],
          [Импорт из Excel],
          [Telegram-бот для управления],
          [Подготовка к production],
        )
      ]
    ],
    rect(
      width: 100%,
      fill: bg-card,
      stroke: 0.45pt + card-brd,
      radius: 5pt,
      inset: 0pt,
    )[
      #rect(
        width: 100%,
        fill: violet,
        radius: (top-left: 5pt, top-right: 5pt),
        inset: 5pt,
      )[
        #align(center)[#text(
          font: "Jura",
          size: 8.5pt,
          weight: "bold",
          fill: white,
        )[В планах развития]]
      ]
      #pad(x: 8pt, y: 8pt)[
        #set text(size: 8pt, fill: fg)
        #list(
          [Code runner для программирования],
          [AI-проверка ответов],
          [Апелляции],
          [Визуальные типы задач],
          [Улучшение интерфейсов организатора и модератора],
        )
      ]
    ],
  )
]

#pagebreak()

// ════════════════════════════════════════════════════════════════
//  14 ─ Заключение
// ════════════════════════════════════════════════════════════════
#deck-slide(
  [Заключение],
  n: 14,
  subtitle: [Основные результаты проектной работы.],
)[
  #grid(
    columns: (1fr, 1fr, 1fr),
    gutter: 3.5mm,
    card[
      #text(
        font: "Jura",
        size: 10pt,
        weight: "bold",
        fill: rose,
      )[Цель достигнута]
      #v(2mm)
      Разработан рабочий MVP-прототип платформы для автоматизации проверки знаний.
    ],
    card[
      #text(
        font: "Jura",
        size: 10pt,
        weight: "bold",
        fill: violet,
      )[Гипотеза подтверждается]
      #v(2mm)
      Единая web-платформа объединяет задания, участников, результаты и администрирование.
    ],
    card[
      #text(
        font: "Jura",
        size: 10pt,
        weight: "bold",
        fill: amber,
      )[Практическая значимость]
      #v(2mm)
      Проект может использоваться как основа цифрового инструмента для тренировочных заданий, школьных турниров и олимпиад.
    ],
  )
  #v(3mm)
  #grid(
    columns: (1fr, 1fr, 1fr, 1fr),
    gutter: 2mm,
    screenshot("assets/screenshots/01-landing.png"),
    screenshot("assets/screenshots/04-tournaments-list.png"),
    screenshot("assets/screenshots/05-tournament-overview.png"),
    screenshot("assets/screenshots/09-profile-analytics-summary.png"),
  )
  #v(1fr)
  #align(center)[
    #text(
      size: 7pt,
      fill: fg-muted,
    )[Все пять задач решены · Проект имеет статус MVP и готов к развитию]
  ]
]

#pagebreak()

// ════════════════════════════════════════════════════════════════
//  15 ─ Спасибо за внимание
// ════════════════════════════════════════════════════════════════
#rect(width: 100%, height: 100%, fill: bg-2)[
  #progress-bar(15)
  #align(center + horizon)[
    #qubite-logo(size: 30pt)
    #v(5mm)
    #text(
      font: "Jura",
      size: 22pt,
      weight: "bold",
      fill: fg-strong,
    )[Спасибо за внимание]
    #v(3mm)
    #text(size: 9pt, fill: fg-muted)[Готов ответить на ваши вопросы.]
  ]
]

#pagebreak()

// ════════════════════════════════════════════════════════════════
//  16 ─ Дубль титульного
// ════════════════════════════════════════════════════════════════
#title-slide(n: 16)
