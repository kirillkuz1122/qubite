# Qubite Agent Notes

Этот файл предназначен для ИИ-ассистентов и новых разработчиков, которые впервые читают репозиторий.

## Что это за репозиторий

`qubite` — русскоязычный рабочий MVP-прототип платформы для учебных соревнований.

Главный продуктовый фокус сейчас:

- участник (`user`)
- турнир как главный объект системы
- честное описание текущего состояния, а не “как хотелось бы”

## Не делайте ложных предположений

- Это не React/Vite/Next-проект.
- Фронтенд здесь в основном живёт в:
  - `index.html`
  - `front/css/styles.css`
  - `front/js/app.js`
  - `front/js/api.js`
- Бэкенд здесь в основном живёт в:
  - `back/server.js`
  - `back/src/db.js`
  - `back/src/task-runtime.js`
  - `back/src/security.js`
  - `back/src/config.js`
- Основная база данных — `SQLite`.
- Текущий CAPTCHA-слой — `Cloudflare Turnstile`, но в roadmap есть переход на `Yandex SmartCaptcha`.

## Ключевые файлы

### Фронтенд

- `index.html` — landing/workspace shell
- `front/css/styles.css` — вся тема и визуальная система
- `front/js/app.js` — UI, модалки, role workspaces, runtime-поведение
- `front/js/api.js` — API-клиент и client state

### Бэкенд

- `back/server.js` — route handlers и middleware
- `back/src/db.js` — схема SQLite и почти вся прикладная логика
- `back/src/task-runtime.js` — типы задач и автоматическая проверка
- `back/src/security.js` — пароли, токены, helper security functions
- `back/src/request-guard.js` — abuse/rate/origin guards
- `back/src/oauth.js` — OAuth providers
- `back/src/turnstile.js` — текущая CAPTCHA-интеграция

### Telegram Bot

- `back/src/telegram-bot.js` — точка входа, запуск polling, /start, /help, роутинг
- `back/src/telegram/access.js` — проверка прав (owner из env, moderator из env + БД)
- `back/src/telegram/menus.js` — inline-клавиатуры и шаблоны меню
- `back/src/telegram/notifier.js` — push-уведомления owner'у о критичных audit-событиях
- `back/src/telegram/handlers/settings.js` — 5 тумблеров system_settings (owner)
- `back/src/telegram/handlers/analytics.js` — overview, метрики, детальная статистика
- `back/src/telegram/handlers/moderation.js` — задачи, заявки организаторов, блокировка юзеров
- `back/src/telegram/handlers/admin.js` — пользователи, турниры, команды, задачи, аудит (owner)
- `back/src/telegram/handlers/access.js` — /grant, /revoke, /list для управления доступами (owner)

### Deploy / Ops

- `deploy/nginx/*`
- `deploy/firewall/*`
- `deploy/cloudflare/*`
- `deploy/sysctl/*`
- `deploy/PROD_STEPS_RU.md`

### Документация

- `README.md` — быстрый вход
- `docs/README.md` — карта docs
- `docs/architecture.md`
- `docs/product-and-roles.md`
- `docs/development.md`
- `docs/deploy-and-production.md`
- `SECURITY.md`
- `TODO.md`
- `SMARTCAPTCHA_THEME.md`

## Что уже есть в коде

- роли: `user`, `organizer`, `moderator`, `admin`, `owner`
- типы задач: `single_choice`, `multiple_choice`, `short_text`, `number`
- турниры, команды, рейтинг, аналитика
- organizer/moderation/admin/owner contours
- Excel import для задач и roster
- OAuth через Google/Yandex/VK (серверный PKCE)/Telegram (direct redirect)
- Telegram-бот для управления платформой (owner + модераторы)
- Elo-подобная рейтинговая система с таблицей `rating_changes`, историей и UI
- cookie/localStorage notice в `front/js/app.js` + legal-текст в `privacy.html`

## Что ещё нельзя выдавать за реализованное

- code runner для программирования
- AI-проверка как готовая user-facing функция
- апелляции
- drag-and-drop / visual task types

## Обязательное правило сопровождения

Если вы меняете:

- роли и доступы
- tournament/runtime flow
- env или deploy behavior
- auth / verification / CAPTCHA
- legal pages
- карту ключевых файлов

нужно обновлять одновременно:

- соответствующий код
- `README.md`
- релевантные файлы в `docs/`
- `SECURITY.md` / `TODO.md`, если это касается security или roadmap
- этот `AGENTS.md`

## Если docs расходятся с кодом

Верить нужно коду, а docs надо исправлять.

## Операционная шпаргалка (факты из кода)

Эта секция — быстрый справочник, чтобы не перечитывать весь репозиторий заново.

### Стек и запуск

- Node.js + Express 5 + `sqlite3` + `xlsx`. CommonJS (`"type": "commonjs"`).
- `package.json` только один — в `back/`. В корне проекта его нет.
- Запуск локально: `cd back && npm install && node server.js`.
- Production-запуск: `npm start` (`node server.js`), обычно под PM2 + Nginx.
- По умолчанию слушает `127.0.0.1:3000` (см. `.env` → `HOST`, `PORT`, `APP_BASE_URL`).
- SQLite-файл по умолчанию: `back/data/qubite.sqlite` (`DATABASE_PATH`).

### Тесты и верификация

- Автоматических тестов в проекте нет: `npm test` в `back/` намеренно возвращает ошибку.
- Верификация изменений = ручной прогон сценариев через UI (`index.html`) или через API-клиент `front/js/api.js`.
- Для e2e/UI-проверок подходит skill `webapp-testing` / `playwright`.

### Витрина турниров для участника

- `/api/tournaments` должен отдавать не только опубликованные/текущие, но и `ended`-турниры: вкладка «Прошедшие» в пользовательском UI зависит от этой выдачи.
- `draft` и `archived` не попадают в пользовательскую витрину; organizer/admin-контуры показывают их отдельно.
- Для `access_scope = 'code'` и `access_scope = 'closed'` действует `catalog_visible`: по умолчанию такие турниры скрыты из общей витрины; скрытый roster-турнир виден только пользователям из `tournament_roster_entries`.

### Git workflow

- Коммиты и push по умолчанию делать только в ветку `codex`.
- **После каждого коммита сразу делать `git push origin codex`.**
- `main` не трогать: не checkout, не merge, не push, если пользователь явно не попросил именно это.
- Перед коммитом проверять `git status --short --branch`; случайные удаления вроде `.env.example` не включать в коммит без отдельного подтверждения.
- **Коммиты писать на русском языке.** Без conventional-commit префиксов (`feat`, `fix` и т.д.) — просто описание на русском.
- **Не добавлять в коммиты строки `Generated with [Devin]` и `Co-Authored-By: Devin`.** Если после коммита они всё же попали в сообщение (например, из-за встроенного скрипта), сразу исправить: `git commit --amend` с чистым текстом без этих строк.

### Размеры ключевых файлов (важно для стратегии правок)

- `back/server.js` — ~9.3K строк (почти все HTTP-роуты в одном файле).
- `back/src/db.js` — ~7.5K строк (схема + большая часть прикладной логики + рейтинговая система).
- `front/js/app.js` — ~16.4K строк (вся UI-логика, модалки, role workspaces).
- `front/js/api.js` — ~1.7K строк (API-клиент + client state).
- `index.html` — ~1.4K строк (shell приложения, не SPA-роутер).

### Рейтинговая система

- Стартовый рейтинг: `RATING_START = 1200` (определено в `back/src/db.js`).
- Минимальный рейтинг: `RATING_MIN = 800`.
- Формула: Elo-подобная, `newRating = oldRating + K * (actualScore - expectedScore)`.
- K = `max(16, round(48 - rating/100))` — уменьшается с ростом рейтинга.
- `expectedScore` учитывает средний рейтинг соперников турнира.
- `actualScore` = нормализованное место (1.0 за 1-е, 0.0 за последнее).
- Декей: -2 RP/день после 30 дней неактивности (но не ниже `RATING_START`).
- Ежедневный бонус: +2 RP за решённую задачу (макс. +10 за день).
- Таблица `rating_changes`: полная история каждого изменения с `details_json`.
- Типы изменений: `tournament_result`, `daily_bonus`, `decay`, `migration`, `correction`.
- API: `/api/rating/me/history`, `/api/rating/me/explain`, `/api/rating/history/:userId` (admin).
- UI: модалки «Как считается рейтинг» и «История рейтинга».
- Звания: Новичок (<1300), Исследователь (1300+), Практик (1450+), Стратег (1600+), Эксперт (1750+), Кандидат в мастера (1900+), Мастер (2100+), Грандмастер (2350+), Легенда (2600+).
- Миграция: при первом запросе `refreshUserCompetitionStats` старый рейтинг сохраняется как `change_type = 'migration'`.

Из-за этих монолитов: для точечных правок используйте `grep`/`edit` по сигнатурам, **не** перечитывайте файлы целиком. Монолитность `db.js` и `app.js` уже зафиксирована как tech debt в `TODO.md`.

### Важные dev-флаги из `.env`

- `TURNSTILE_DEV_BYPASS=true` — в dev капча пропускается, в prod должно быть `false`.
- `SEED_DEMO_DATA=false` — на включении создаются демо-данные в БД.
- `NODE_ENV=dev` — влияет на режимы логирования и guard'ов.
- `TRUST_PROXY=0` — в проде за Nginx должно быть `1`.
- Лимиты body: `JSON_BODY_LIMIT=32kb`, `HEAVY_JSON_BODY_LIMIT=256kb`, `IMPORT_JSON_BODY_LIMIT=2mb` (используются в `server.js` на разных группах роутов).
- `VK_APP_ID` — ID приложения VK ID. `VK_CLIENT_SECRET` — «Защищённый ключ» из VK Developer Console. VK OAuth использует серверный PKCE-flow (code_verifier хранится в `oauth_states`).
- `OAUTH_GOOGLE_ENABLED`, `OAUTH_YANDEX_ENABLED`, `OAUTH_VK_ENABLED`, `OAUTH_TELEGRAM_ENABLED` — аварийные env kill-switch'и для отдельных способов входа; при `false` провайдер скрывается из UI и web-start endpoint не работает. Оперативное включение/выключение owner делает без рестарта через `system_settings`: `oauth_google_enabled`, `oauth_yandex_enabled`, `oauth_vk_enabled`, `oauth_telegram_enabled`.
- `TELEGRAM_BOT_TOKEN` — токен бота; если пуст, бот не запускается и Telegram Login Widget не включается.
- `TELEGRAM_OWNER_ID` — Telegram user ID владельца (единственный source of truth для owner-доступа в боте).
- `TELEGRAM_MODERATOR_IDS` — CSV доп. модераторов (жёсткий whitelist, требует рестарта); динамические выдачи — через БД (`telegram_access`).
- `TELEGRAM_ENABLED=true` — kill-switch только для Telegram-бота без удаления токена; Login Widget зависит от `TELEGRAM_BOT_TOKEN`.

### Прочее

- Статические HTML-страницы в корне (`about.html`, `privacy.html`, `terms.html`, `security.html`, `acceptable-use.html`, `404.html`, `4041.html`, `maintenance.html`) отдаются бэкендом; при правке legal-страниц надо держать в синхроне ссылки из `index.html`.
- `back/src/imports.js` и `back/src/email.js` существуют, но в карте ключевых файлов выше не перечислены как «самые важные» — заглядывать туда, только если задача касается Excel-импорта или писем соответственно.
- `front/js/icons.js` — справочник SVG-иконок для UI.
- Рабочая ветка разработки часто `codex`, мейнлайн — `main`.
