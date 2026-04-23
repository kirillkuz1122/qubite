# Архитектура Qubite

## Контекст системы

Qubite — монолитное web-приложение для учебных соревнований. В текущем репозитории нет разделения на SPA-фронтенд, отдельный API-gateway и набор микросервисов: проект живёт как один Node/Express backend, который отдаёт HTML-страницы, статические фронтенд-ассеты и API.

Система ориентирована на несколько контуров:

- participant/user-contour — основной пользовательский путь;
- organizer-contour — сборка турниров, задач и списков допуска;
- moderation/admin-contour — служебные проверки и управление платформой;
- deploy/security-contour — reverse proxy, firewall, Cloudflare и server hardening.

## Структура решения

### Фронтенд

- `index.html` — главная HTML-точка входа и landing/workspace shell
- `front/css/styles.css` — вся дизайн-система, layout, responsive и component styling
- `front/js/app.js` — основная клиентская логика, модалки, view state, role workspaces, tournament runtime UI
- `front/js/api.js` — API-слой, bootstrap client state и клиентские request caches

### Бэкенд

- `back/server.js` — HTTP-сервер, middleware, route handlers, auth, organizer/admin/moderation/public endpoints, SSE-подключения (Живая лента аудита)
- `back/src/db.js` — схема SQLite, инициализация БД, прикладные операции и значительная часть бизнес-логики, включая фоновую очистку (Cron) удаленных данных
- `back/src/task-runtime.js` — типы задач, нормализация конфигурации и автоматическая проверка
- `back/src/security.js` — пароли, токены, uid, вспомогательные security utilities
- `back/src/request-guard.js` — rate limiting, duplicate request guard, same-origin checks
- `back/src/turnstile.js` — текущий CAPTCHA-слой
- `back/src/oauth.js` — OAuth providers и login flow
- `back/src/imports.js` — XLSX-импорт задач и списков допуска

### Данные

Основное хранилище — SQLite. В коде подтверждаются как минимум такие группы сущностей:

- пользователи и их статусы/роли (поддержка Soft Delete на 7 дней);
- сессии, auth challenges, email verification, password reset;
- команды и членство в командах;
- банк задач и модерационный статус задач;
- турниры, task links, roster entries, helper codes;
- системные настройки (`system_settings`) для управления фичами платформы;
- отправки ответов, результаты, детальная серверная аналитика (агрегируемая по часам) и рейтинг;
- audit log.

### Инфраструктура

- Node backend слушает локальный адрес
- Nginx стоит перед Node и принимает внешний трафик
- PM2 используется как process manager
- Cloudflare используется для proxy/TLS/abuse controls
- firewall/sysctl вынесены в `deploy/`

## Как течёт данные

## 1. Базовый пользовательский flow

1. Пользователь открывает `/`.
2. Сервер отдаёт `index.html`, а статика подгружается из `/front`.
3. `front/js/app.js` и `front/js/api.js` инициализируют клиентское состояние.
4. Клиент запрашивает bootstrap/public endpoints.
5. После логина или code-entry пользователь работает уже через API и локальный client state.

## 2. Organizer flow

1. Organizer создаёт или редактирует турнир через organizer workspace.
2. UI пишет в organizer endpoints в `back/server.js`.
3. Сервер валидирует ввод, доступность задач и статус турнира.
4. `back/src/db.js` сохраняет турнир, task links, roster и связанные сущности.
5. UI получает сериализованную структуру турнира обратно и обновляет локальное состояние.

## 3. Tournament runtime flow

1. Пользователь присоединяется к турниру.
2. Сервер проверяет текущий lifecycle турнира, политику допуска, roster/code rules и late join.
3. Runtime выдаёт только нужные участнику данные по задачам.
4. Ответы сохраняются и проверяются сервером через `task-runtime`.
5. Leaderboard/analytics/results выдаются в зависимости от текущего состояния турнира и visibility flags.

## Ключевые runtime-сценарии

### Participant

- регистрация/логин/восстановление доступа;
- вход по коду или запись в турнир;
- решение задач;
- просмотр рейтинга, результатов и части аналитики;
- работа с личной командой, если турнир командный.

### Organizer

- сборка турнира;
- работа с личным и общим task bank;
- импорт задач и roster из Excel;
- публикация, перенос, завершение и дублирование турниров;
- просмотр результатов.

### Moderator/Admin/Owner

- модерация задач и organizer applications;
- управление пользователями, ролями и статусами;
- административные обзоры, аудит и platform-level операции;
- защищённые owner/admin операции через web и CLI.

## Что здесь монолитно и проблемно

Самые заметные архитектурные узкие места:

- `back/src/db.js` держит и схему БД, и прикладные операции, и значимую часть бизнес-логики;
- `front/js/app.js` стал крупным монолитом UI/state/runtime-поведения;
- часть продуктовой логики размазана между сериализацией, route handlers и UI expectations;
- deploy/security assumptions описаны в нескольких местах и требуют синхронизации.

Это не делает проект нерабочим, но повышает стоимость изменений и риск регрессий.

## Технический долг

- разделить `db.js` по доменам: auth, users, tournaments, tasks, analytics, admin;
- выделить front-end модули по зонам ответственности, а не держать почти всё в одном `app.js`;
- формализовать рейтинг и аналитические правила;
- сделать docs обновляемой частью проекта, а не побочным артефактом.
