#import "../config/metadata.typ": project_name
#import "../styles/template.typ": figure_image, simple_table

= ПРИЛОЖЕНИЯ

== Приложение А. Визуальные материалы проекта

В приложении приведены скриншоты основных экранов проекта. По ним можно увидеть общий стиль платформы, процесс входа, рабочее пространство участника, раздел турниров, карточку турнира, таблицу результатов, профиль, настройки безопасности и аналитику участника.

#figure_image("../assets/screenshots/01-landing.png", [Главная страница платформы #project_name], width: 90%)

#figure_image("../assets/screenshots/02-login-modal.png", [Модалка входа и регистрации], width: 90%)

#figure_image("../assets/screenshots/03-user-dashboard.png", [Дашборд участника после входа], width: 90%)

#figure_image("../assets/screenshots/04-tournaments-list.png", [Раздел турниров: список соревнований], width: 90%)

#figure_image("../assets/screenshots/05-tournament-overview.png", [Карточка турнира с задачами и данными участника], width: 90%)

#figure_image("../assets/screenshots/06-tournament-rating.png", [Таблица результатов турнира], width: 90%)

#figure_image("../assets/screenshots/07-profile-personal.png", [Профиль участника: личные данные], width: 90%)

#figure_image("../assets/screenshots/08-profile-security.png", [Профиль участника: безопасность и активные сессии], width: 90%)

#figure_image("../assets/screenshots/09-profile-analytics-summary.png", [Профиль участника: сводная аналитика], width: 90%)

#figure_image("../assets/screenshots/10-profile-analytics-history.png", [Профиль участника: история результатов и динамика], width: 90%)

#pagebreak()

== Приложение Б. Схема архитектуры проекта

Схема отражает основные уровни и связи в архитектуре платформы #project_name.

#block(breakable: false)[
  #set par(first-line-indent: 0pt)
  #set text(size: 11pt)
  #let bx(body, width: 100%) = box(
    width: width,
    inset: 10pt,
    radius: 3pt,
    stroke: 0.5pt + luma(140),
    fill: luma(248),
    align(center, body),
  )

  #align(center)[
    #bx(width: 70%)[
      *Пользователь (браузер)*\
      HTML / CSS / JavaScript\
      #text(size: 9pt, fill: luma(100))[index.html, front/js/app.js, front/js/api.js]
    ]

    #v(4pt)
    #text(size: 18pt)[#sym.arrow.b]
    #v(4pt)

    #bx(width: 70%)[
      *Cloudflare + Nginx*\
      TLS, CDN, rate limiting, reverse proxy
    ]

    #v(4pt)
    #text(size: 18pt)[#sym.arrow.b]
    #v(4pt)

    #bx(width: 70%)[
      *Express-сервер (Node.js)*\
      REST API, авторизация, бизнес-логика\
      #text(size: 9pt, fill: luma(100))[back/server.js, back/src/db.js, back/src/security.js]
    ]

    #v(4pt)

    #grid(
      columns: (1fr, 1fr),
      gutter: 12pt,
      [
        #align(center)[
          #text(size: 18pt)[#sym.arrow.b]
          #v(4pt)
          #bx[
            *SQLite*\
            Пользователи, турниры, задачи, рейтинг, аудит\
            #text(size: 9pt, fill: luma(100))[back/data/qubite.sqlite]
          ]
        ]
      ],
      [
        #align(center)[
          #text(size: 18pt)[#sym.arrow.b]
          #v(4pt)
          #bx[
            *Внешние сервисы*\
            OAuth (Google, Yandex, VK, Telegram),
            CAPTCHA (Turnstile),
            Email, Telegram Bot API
          ]
        ]
      ],
    )
  ]
]

#pagebreak()

== Приложение В. Структура базы данных

В таблице перечислены все таблицы базы данных проекта, сгруппированные по назначению.

#simple_table(
  caption: [Таблицы базы данных проекта #project_name],
  columns: (25%, 30%, 45%),
  (
    [*Группа*], [*Таблица*], [*Назначение*],
    [Пользователи и доступ],
    [users], [Аккаунты, роли, email, статус подтверждения],
    [], [sessions], [Активные сессии пользователей],
    [], [auth\_challenges], [Challenge-коды для подтверждения email],
    [], [password\_reset\_tickets], [Токены восстановления пароля],
    [], [oauth\_states], [Состояния OAuth-потоков (PKCE)],
    [], [blocked\_emails], [Заблокированные email-адреса],
    [], [ip\_blocklist], [Заблокированные IP-адреса],
    [Турниры и задания],
    [tournaments], [Турниры: настройки, сроки, режимы допуска],
    [], [task\_bank], [Банк задач с типами и вариантами ответов],
    [], [tournament\_tasks], [Привязка задач к турнирам],
    [], [tournament\_entries], [Записи участников в турнирах],
    [], [tournament\_submissions], [Ответы участников на задачи],
    [], [tournament\_task\_progress], [Прогресс решения задач],
    [], [tournament\_task\_drafts], [Черновики ответов],
    [], [tournament\_roster\_entries], [Списки допуска к турнирам],
    [], [tournament\_helper\_codes], [Коды-помощники для экранов турнира],
    [Команды],
    [teams], [Команды участников],
    [], [team\_members], [Состав команд],
    [Рейтинг и аналитика],
    [rating\_changes], [История всех изменений рейтинга],
    [], [system\_stats\_history], [Снимки системной статистики],
    [], [site\_visits], [Посещаемость платформы],
    [], [email\_logs], [Журнал отправленных email],
    [Управление],
    [audit\_log], [Аудит чувствительных действий],
    [], [system\_settings], [Системные настройки (тумблеры owner)],
    [], [organizer\_applications], [Заявки на роль организатора],
    [], [telegram\_access], [Динамические права доступа в Telegram-боте],
    [Поддержка],
    [support\_chats], [Чаты поддержки пользователей],
    [], [support\_messages], [Сообщения в чатах поддержки],
  ),
)
