# Qubite: production-шаги для текущего VPS-сценария

Этот файл описывает практический серверный сценарий, который уже ближе всего к реальной эксплуатации Qubite.

Подробнее общий контекст описан в [`../docs/deploy-and-production.md`](../docs/deploy-and-production.md). Здесь — именно пошаговый operator checklist.

## Исходные предпосылки

- Ubuntu/VPS
- Nginx стоит перед Node
- backend работает через PM2
- основная RU-версия живёт на `qubiteapp.ru`
- Node должен слушать только локальный адрес

## 1. Обновить код и зависимости

Текущий рабочий update-flow:

```bash
cd /var/www/qubiteapp/ && git pull && cd back/ && npm install && pm2 restart 0 --update-env
```

Если хотите выполнять шаги по отдельности:

```bash
cd /var/www/qubiteapp
git pull
cd back
npm install
pm2 restart 0 --update-env
```

## 2. Проверить production `.env`

Минимально важные поля:

```env
HOST=127.0.0.1
PORT=3000
NODE_ENV=production
APP_BASE_URL=https://qubiteapp.ru
DATABASE_PATH=/var/www/qubiteapp/back/data/qubite.sqlite

TRUST_PROXY=1
ALLOWED_ORIGINS=https://qubiteapp.ru,https://www.qubiteapp.ru
ALLOWED_HOSTS=qubiteapp.ru,www.qubiteapp.ru

SESSION_COOKIE_NAME=qb_session
SESSION_TOUCH_INTERVAL_MS=300000

JSON_BODY_LIMIT=32kb
HEAVY_JSON_BODY_LIMIT=256kb
IMPORT_JSON_BODY_LIMIT=2mb
REQUEST_TIMEOUT_MS=15000
HEADERS_TIMEOUT_MS=12000
KEEP_ALIVE_TIMEOUT_MS=5000
MAX_REQUESTS_PER_SOCKET=100
SQLITE_BUSY_TIMEOUT_MS=5000

EMAIL_DELIVERY_MODE=log
EMAIL_FROM=Qubite <no-reply@qubiteapp.ru>
EMAIL_REPLY_TO=support@qubiteapp.ru
RESEND_API_KEY=

TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
TURNSTILE_DEV_BYPASS=false

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=https://qubiteapp.ru/api/auth/oauth/google/callback

YANDEX_CLIENT_ID=
YANDEX_CLIENT_SECRET=
YANDEX_CALLBACK_URL=https://qubiteapp.ru/api/auth/oauth/yandex/callback
```

Важно:

- `HOST=127.0.0.1`, а не `0.0.0.0`
- `TRUST_PROXY=1`, только если перед Node реально стоит Nginx
- `APP_BASE_URL` должен совпадать с реальным доменом
- не храните production secrets в Git

## 3. Назначить admin и owner

Если пользователь уже зарегистрирован:

```bash
cd /var/www/qubiteapp
node back/scripts/promote-admin.js --email YOUR_EMAIL
node back/scripts/set-owner.js --email YOUR_EMAIL
```

Если owner нужно передать:

```bash
node back/scripts/set-owner.js --email NEW_OWNER_EMAIL --replace
```

## 4. Проверить Nginx

Основные файлы:

- `deploy/nginx/qubite.conf`
- `deploy/nginx/snippets/qubite-proxy-headers.conf`

Типовой порядок:

```bash
mkdir -p /etc/nginx/snippets
cp /var/www/qubiteapp/deploy/nginx/snippets/qubite-proxy-headers.conf /etc/nginx/snippets/qubite-proxy-headers.conf
cp /var/www/qubiteapp/deploy/nginx/qubite.conf /etc/nginx/sites-available/default
nginx -t
systemctl reload nginx
```

## 5. Проверить PM2

- не используйте cluster mode для этого SQLite-инстанса;
- после изменения env или кода обновляйте процесс через `--update-env`;
- проверьте, что Node реально слушает только loopback.

Полезно:

```bash
pm2 show 0
pm2 logs
```

## 6. Базово закрыть VPS

Если используете UFW:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw limit 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status verbose
```

Никогда не открывайте наружу Node-порт.

См. также:

- [`firewall/UFW.md`](firewall/UFW.md)
- [`firewall/nftables-qubite.nft`](firewall/nftables-qubite.nft)

## 7. Cloudflare и CAPTCHA

Сейчас в коде используется `Cloudflare Turnstile`.

Практически это означает:

1. у Cloudflare должен быть настроен proxy/edge для публичного домена;
2. в `.env` должны быть реальные `TURNSTILE_*` ключи;
3. `TURNSTILE_DEV_BYPASS=false` в production;
4. после изменения ключей нужно перезапустить PM2.

Важно: для RU-контура это временное решение. В roadmap уже есть переход на Яндекс SmartCaptcha.

## 8. Проверка после раскатки

Проверьте руками:

1. открывается `https://qubiteapp.ru`
2. Node-порт не торчит наружу
3. регистрация работает
4. логин работает
5. owner виден в админском контуре, но не доступен для обычного demote/block flow
6. OAuth-провайдеры показываются только когда реально настроены
7. CAPTCHA/anti-bot flow работает на боевом домене

## 9. Что ещё требует ручной проверки

- насколько текущие deploy-файлы полностью совпадают с реальным сервером;
- не закоммичены ли действующие production secrets;
- насколько аккуратно разведены RU и EN окружения;
- не расходится ли operator memory с Markdown-инструкциями.
