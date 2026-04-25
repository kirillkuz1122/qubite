# Локальная разработка

## Что важно понимать сразу

Текущий репозиторий не использует отдельный React/Vite dev server. Приложение живёт как Node backend, который:

- отдаёт API;
- отдаёт `index.html`;
- раздаёт статику из `/front`.

Поэтому базовый локальный запуск — это запуск backend.

## Базовый сценарий

```bash
cp .env.example .env
cd back
npm install
npm run dev
```

Дальше открывайте адрес из `APP_BASE_URL`, по умолчанию:

```text
http://127.0.0.1:3000
```

## Альтернативный сценарий

Если в локальной среде уже настроен `Nginx`, можно работать через него, как в production-like режиме. Но для большинства задач достаточно прямого `npm run dev`.

## Реальная структура проекта

### Самые важные файлы

- `back/server.js` — маршруты, middleware, auth, organizer/admin/moderation/public API
- `back/src/db.js` — основная бизнес-логика и работа с SQLite
- `back/src/task-runtime.js` — типы задач и их проверка
- `back/src/security.js` — security utilities
- `front/js/app.js` — UI, модалки, role workspaces, runtime
- `front/js/api.js` — API-клиент и bootstrap state
- `front/css/styles.css` — визуальная система
- `index.html` — основная HTML-оболочка

## Env-переменные, которые важны чаще всего

### База и сервер

- `HOST`
- `PORT`
- `APP_BASE_URL`
- `NODE_ENV`
- `DATABASE_PATH`
- `TRUST_PROXY`

### Сессии и network hardening

- `SESSION_COOKIE_NAME`
- `SESSION_TOUCH_INTERVAL_MS`
- `JSON_BODY_LIMIT`
- `HEAVY_JSON_BODY_LIMIT`
- `IMPORT_JSON_BODY_LIMIT`
- `REQUEST_TIMEOUT_MS`
- `HEADERS_TIMEOUT_MS`
- `KEEP_ALIVE_TIMEOUT_MS`
- `MAX_REQUESTS_PER_SOCKET`
- `SQLITE_BUSY_TIMEOUT_MS`

### Email / verification

- `EMAIL_DELIVERY_MODE`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO`
- `RESEND_API_KEY`

### OAuth

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`
- `YANDEX_CLIENT_ID`
- `YANDEX_CLIENT_SECRET`
- `YANDEX_CALLBACK_URL`
- `VK_APP_ID` — ID приложения VK ID SDK, secret для текущей VK-интеграции не нужен
- `TELEGRAM_BOT_TOKEN` — нужен и для Telegram Bot, и для Telegram Login Widget
- `TELEGRAM_ENABLED` — включает только Telegram-бота; Login Widget использует токен независимо от polling-режима

### CAPTCHA

- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `TURNSTILE_VERIFY_URL`
- `TURNSTILE_DEV_BYPASS`

Важно: текущий код использует Cloudflare Turnstile. План перехода на Яндекс SmartCaptcha отражён в [`../SMARTCAPTCHA_THEME.md`](../SMARTCAPTCHA_THEME.md) и [`../TODO.md`](../TODO.md), но это не текущая реализация.

## Что есть в `back/package.json`

```bash
npm start
npm run dev
```

Тестового контура как полноценной автоматической системы в этом репозитории пока нет.

## Полезные CLI-скрипты

- `node back/scripts/promote-admin.js --email you@example.com`
- `node back/scripts/set-owner.js --email you@example.com`

Они нужны не только для ops, но и для локального разворачивания привилегированных ролей.

## Где смотреть логи

### Локально

- stdout/stderr `npm run dev`
- ошибки API в консоли сервера
- ошибки UI в браузерной консоли

### В production-like окружении

- `pm2 logs`
- логи Nginx

## На что смотреть в коде при разных задачах

### Если проблема в регистрации, логине, сессиях, verify

- `back/server.js`
- `back/src/security.js`
- `back/src/request-guard.js`
- `back/src/turnstile.js`
- `back/src/oauth.js`
- `front/js/app.js`
- `front/js/api.js`

### Если проблема в турнирах и runtime

- `back/server.js`
- `back/src/db.js`
- `back/src/task-runtime.js`
- `front/js/app.js`
- `front/js/api.js`

### Если проблема в organizer/admin/moderation UI

- `front/js/app.js`
- `front/js/api.js`
- `back/server.js`
- `back/src/db.js`

### Если проблема в deploy / cookies / proxy / domains

- `back/src/config.js`
- `deploy/nginx/*`
- `deploy/cloudflare/*`
- `deploy/firewall/*`
- `deploy/sysctl/*`

## Ограничения текущей dev-модели

- `back/src/db.js` и `front/js/app.js` уже крупные и монолитные;
- часть поведения нужно проверять end-to-end, а не по одному модулю;
- часть UX и rating-логики требует ручной верификации на живом стенде;
- docs нужно обновлять вместе с изменениями кода, иначе они быстро начинают врать.
