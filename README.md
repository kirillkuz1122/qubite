# Qubite

Qubite — рабочий MVP-прототип платформы для учебных соревнований. Текущий репозиторий описывает русскоязычную версию проекта, где главный фокус сделан на участнике: вход, попадание в турнир, решение задач, рейтинг и базовую аналитику.

Важно: это не React/Vite/Next-проект. Фронтенд здесь реализован на обычных `HTML + CSS + JavaScript`, а бэкенд — на `Node.js + Express + SQLite`.

## Что это за проект

Qubite нужен как единая форма для проведения соревнований, тренировок и олимпиадных активностей. В одной системе уже собраны:

- лендинг и пользовательский кабинет;
- регистрация, логин, сессии, восстановление пароля и email-подтверждение;
- турниры с разными режимами допуска;
- личное и командное участие;
- банк задач и organizer-контур;
- moderator/admin/owner-контуры;
- рейтинг, базовая аналитика и ежедневное задание;
- Excel-импорт задач и списков допуска;
- deploy/security-инфраструктура под VPS-сценарий.

## Текущее состояние

Проект честнее всего описывать как рабочий прототип:

- участник и общая пользовательская витрина выглядят заметно зрелее остальных контуров;
- organizer/moderator/admin-зоны уже существуют, но UX там ещё сырой;
- турнирный runtime работает, но тоже требует доработки;
- часть продуктовых идей остаётся в roadmap, а не в текущей реализации.

Что подтверждается кодом прямо сейчас:

- типы задач: `single_choice`, `multiple_choice`, `short_text`, `number`;
- роли: `user`, `organizer`, `moderator`, `admin`, `owner`;
- OAuth-провайдеры в текущем коде: `Google`, `Yandex`;
- CAPTCHA/anti-bot в текущем коде: `Cloudflare Turnstile`;
- deploy-модель: `Nginx + PM2 + SQLite + Cloudflare`;
- Telegram-бот для управления платформой (owner + модераторы): тумблеры, аналитика, модерация, админка, push-уведомления.

Что пока не нужно выдавать за реализованное:

- задачи по программированию с code runner / sandbox;
- AI-проверка ответов как готовая продуктовая функция;
- апелляции;
- визуальные drag-and-drop типы задач;
- VK / Telegram login (бот управления есть, login через TG — нет).

## Для кого проект

С точки зрения продукта роли сейчас устроены так:

- `user` — основной пользователь платформы и главный сценарий для docs;
- `organizer` — собирает турниры, работает со своими задачами, импортом и результатами;
- `moderator` — внутренний служебный контур контроля;
- `admin` — операционное управление платформой, пользователями и сущностями;
- `owner` — защищённая над-роль с максимальным доверием, недоступная для обычных web-операций.

## Где находится фронтенд и бэкенд

- фронтенд:
  - `index.html`
  - `front/css/styles.css`
  - `front/js/app.js`
  - `front/js/api.js`
- бэкенд:
  - `back/server.js`
  - `back/src/db.js`
  - `back/src/task-runtime.js`
  - `back/src/security.js`
  - `back/src/config.js`
- Telegram-бот:
  - `back/src/telegram-bot.js` — точка входа
  - `back/src/telegram/` — access, menus, notifier, handlers
- deploy и infra:
  - `deploy/nginx/*`
  - `deploy/firewall/*`
  - `deploy/cloudflare/*`
  - `deploy/sysctl/*`

## Быстрый локальный старт

Минимальный сценарий, который соответствует текущему коду:

```bash
cp .env.example .env
cd back
npm install
npm run dev
```

После этого приложение открывается через адрес backend из `APP_BASE_URL`, по умолчанию `http://127.0.0.1:3000`.

В реальной эксплуатации проект часто живёт за локальным или production `Nginx`, который проксирует запросы на Node. Это описано отдельно в:

- [`docs/development.md`](docs/development.md)
- [`docs/deploy-and-production.md`](docs/deploy-and-production.md)
- [`deploy/PROD_STEPS_RU.md`](deploy/PROD_STEPS_RU.md)

## Telegram-бот

Бот позволяет owner'у и модераторам управлять платформой через Telegram: переключать системные настройки, смотреть аналитику, модерировать задачи и заявки, управлять пользователями.

Для включения — задайте в `.env`:

```env
TELEGRAM_BOT_TOKEN=<токен от @BotFather>
TELEGRAM_OWNER_ID=<ваш Telegram user ID>
```

Бот запускается автоматически вместе с сервером (long-polling). Без токена сервер работает штатно, бот просто не стартует.

Подробности: `back/src/telegram-bot.js`, [`SECURITY.md`](SECURITY.md#telegram-bot--модель-безопасности).

## Карта документации

- [`docs/README.md`](docs/README.md) — навигация по комплекту документации
- [`docs/architecture.md`](docs/architecture.md) — архитектура, модули, data flow, runtime-сценарии
- [`docs/product-and-roles.md`](docs/product-and-roles.md) — продуктовая модель и роли
- [`docs/development.md`](docs/development.md) — локальная разработка и ключевые точки входа
- [`docs/deploy-and-production.md`](docs/deploy-and-production.md) — production/deploy-контур
- [`SECURITY.md`](SECURITY.md) — безопасность, ограничения и риски
- [`TODO.md`](TODO.md) — roadmap, known issues и technical debt
- [`SMARTCAPTCHA_THEME.md`](SMARTCAPTCHA_THEME.md) — заметка по планируемой миграции на Яндекс SmartCaptcha
- [`docs/explanatory-note-typst/README.md`](docs/explanatory-note-typst/README.md) — отдельный академический артефакт, не source of truth для ops/docs

## Домены и версии

- основной RU-домен текущего проекта: `qubiteapp.ru`
- англоязычная отдельная версия существует отдельно и не является source of truth для этого репозитория

## Source of Truth

Если Markdown расходится с кодом, верить нужно коду. При изменениях ролей, runtime-потока, env, deploy-сценария или legal pages документацию нужно обновлять вместе с реализацией.
