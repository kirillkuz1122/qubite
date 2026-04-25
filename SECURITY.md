# Безопасность Qubite

Этот файл описывает не “идеальную модель безопасности”, а то, что реально подтверждается кодом и инфраструктурными файлами текущего репозитория.

## Что уже реализовано в коде

- роли `admin` и `owner` разделены, `owner` защищён отдельно;
- назначение `admin` и `owner` вынесено в CLI-скрипты:
  - `back/scripts/promote-admin.js`
  - `back/scripts/set-owner.js`
- пароли хешируются через `scrypt`;
- токены сессий и одноразовые токены дополнительно хешируются;
- есть session-based auth и управление сессиями;
- есть email verification flow;
- есть email-based challenge flows для password reset и 2FA-подобных сценариев;
- есть route-specific rate limiting и duplicate request guards;
- есть same-origin защита для state-changing cookie-based запросов;
- есть request/body/timeout hardening;
- есть более аккуратная работа с proxy headers через `trust proxy`;
- есть audit log для чувствительных действий;
- текущий anti-bot слой — `Cloudflare Turnstile`;
- есть role checks для organizer/moderation/admin операций;
- есть скрытие чувствительных полей и owner-protection в web/API потоке;
- рейтинговая система с таблицей `rating_changes` — история изменений рейтинга не содержит чувствительных данных (email, пароли), только числовые значения и ссылки на турниры.

## Что поддерживается инфраструктурой

- reverse proxy через `Nginx`
- firewall rules в `deploy/firewall/*`
- sysctl hardening в `deploy/sysctl/*`
- Cloudflare как edge/proxy/TLS/abuse layer

Эти меры нельзя считать “частью кода”, но для production они критичны.

## Обязательные production-условия

1. Node должен слушать только локальный адрес, например `127.0.0.1:3000`.
2. Перед Node должен стоять Nginx.
3. Наружу должны быть открыты только `22`, `80`, `443`.
4. `TRUST_PROXY=1` включается только при реальном reverse proxy.
5. Production должен работать по HTTPS.
6. SQLite-файл, `.env` и Node-порт не должны быть публично доступны.
7. Для privileged users используйте только CLI-операции назначения ролей.

## Текущее состояние CAPTCHA / anti-bot

Сейчас код использует `Cloudflare Turnstile` на register/login/forgot-password flows.

Это нужно понимать честно:

- текущая интеграция существует и работает в коде;
- но для российского пользовательского контура она не идеальна;
- планируемое направление — миграция на `Яндекс SmartCaptcha`, потому что Cloudflare может быть нестабильным или блокируемым в РФ.

Этот переход пока не реализован и должен отражаться как roadmap, а не как текущий факт.

## Что уже уязвимо или требует усиления

- регистрация и verify-flow нуждаются в усилении и более жёсткой антибот-логике;
- email verification встроен в систему, но не формирует ещё максимально строгий onboarding gate;
- часть abuse controls помогает против простого спама, но не является полноценной защитой от серьёзного целевого злоупотребления;
- organizer/admin/moderation UX пока сырой, а это увеличивает риск ошибок в операциях;
- монолитность `back/src/db.js` и `front/js/app.js` усложняет безопасные изменения.

## Отдельный важный риск

В репозитории есть файл [`deploy/.env`](deploy/.env), похожий на production-конфиг с секретами. Это плохая практика.

Рекомендуемая позиция для проекта:

- не хранить реальные production secrets в Git;
- считать такие секреты подлежащими ротации и переносу в нормальное secret storage;
- не использовать `deploy/.env` как “безопасный source of truth”.

## Telegram Bot — модель безопасности

Встроенный Telegram-бот позволяет owner'у и модераторам управлять платформой через мессенджер.

**Контроль доступа:**
- Owner определяется **только** по `TELEGRAM_OWNER_ID` из `.env`. Выдать owner-доступ через бота невозможно.
- Модераторы определяются двумя источниками: `TELEGRAM_MODERATOR_IDS` из `.env` (жёсткий whitelist) и таблицей `telegram_access` в БД (динамические выдачи через `/grant`).
- Все остальные Telegram-пользователи получают отказ без деталей.

**Риски и компромиссы:**
- Действия через TG обходят web-based rate limiter'ы и email-2FA. Компенсация: жёсткий whitelist, audit log на каждое действие, двухшаговое подтверждение деструктивных операций.
- `TELEGRAM_BOT_TOKEN` — секрет, дающий доступ к привилегированным операциям. Должен быть только в `.env`, никогда в Git.
- Telegram Login Widget использует тот же токен только для HMAC-проверки callback-параметров; polling-конфликт Telegram-бота не должен ломать web-login.
- Все действия бота записываются в `audit_log` с пометкой `[TG:<id>]` и видны в web-админке.
- Push-уведомления owner'у отправляются при критичных audit-событиях: `system.setting.update`, `user.role.change`, `user.block`, `user.delete.hard`, `moderation.task.reject`.

## Оставшиеся ограничения

- application hardening не спасает от крупной L3/L4 DDoS-нагрузки;
- free-tier edge protections и rate limits уменьшают шум, но не гарантируют защиту от целевого злоупотребления;
- локальный CLI-доступ к серверу остаётся сверхпривилегированным;
- SQLite удобен и практичен, но его нужно сопровождать аккуратно: бэкапы, права доступа, single-process assumptions.

## Практические команды для привилегированных ролей

```bash
node back/scripts/promote-admin.js --email you@example.com
node back/scripts/set-owner.js --email you@example.com
node back/scripts/set-owner.js --email new-owner@example.com --replace
```

## Куда смотреть дальше

- [`docs/deploy-and-production.md`](docs/deploy-and-production.md)
- [`deploy/PROD_STEPS_RU.md`](deploy/PROD_STEPS_RU.md)
- [`deploy/firewall/UFW.md`](deploy/firewall/UFW.md)
- [`deploy/cloudflare/CLOUDFLARE_FREE_CHECKLIST.md`](deploy/cloudflare/CLOUDFLARE_FREE_CHECKLIST.md)
