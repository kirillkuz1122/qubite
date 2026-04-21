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
- OAuth через Google/Yandex

## Что ещё нельзя выдавать за реализованное

- code runner для программирования
- AI-проверка как готовая user-facing функция
- апелляции
- drag-and-drop / visual task types
- VK / Telegram login

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
