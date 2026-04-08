# Qubite: что сделать сейчас на вашем сервере

Ниже шаги под ваш текущий сервер:

- Ubuntu 24.04
- Nginx уже стоит
- Certbot уже выдал сертификаты в `/etc/letsencrypt/live/qubiteapp.ru/`
- backend слушает через PM2
- домены:
  - основной: `qubiteapp.ru`
  - алиасы: `www.qubiteapp.ru`, `qubiteapp.online`, `www.qubiteapp.online`

## 1. Обновить проект

```bash
cd ~/qubite
git pull
cd back
npm install
```

## 2. Настроить production `.env`

Создайте или обновите `~/qubite/.env` примерно так:

```env
HOST=127.0.0.1
PORT=3000
NODE_ENV=production
APP_BASE_URL=https://qubiteapp.ru
DATABASE_PATH=/root/qubite/back/data/qubite.sqlite

TRUST_PROXY=1
ALLOWED_ORIGINS=https://qubiteapp.ru,https://www.qubiteapp.ru
ALLOWED_HOSTS=qubiteapp.ru,www.qubiteapp.ru

SESSION_COOKIE_NAME=qb_session

JSON_BODY_LIMIT=32kb
HEAVY_JSON_BODY_LIMIT=256kb
IMPORT_JSON_BODY_LIMIT=2mb
REQUEST_TIMEOUT_MS=15000
HEADERS_TIMEOUT_MS=12000
KEEP_ALIVE_TIMEOUT_MS=5000
MAX_REQUESTS_PER_SOCKET=100

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
- `TRUST_PROXY=1`, потому что перед Node стоит Nginx
- `APP_BASE_URL` должен быть ровно `https://qubiteapp.ru`
- если Turnstile еще не включили, сайт будет требовать его на register/login/forgot в production, так что ключи лучше добавить сразу

## 3. Назначить admin и owner

Если нужный пользователь уже зарегистрирован:

```bash
cd ~/qubite
node back/scripts/promote-admin.js --email YOUR_EMAIL
node back/scripts/set-owner.js --email YOUR_EMAIL
```

Если потом захотите передать owner:

```bash
node back/scripts/set-owner.js --email NEW_OWNER_EMAIL --replace
```

Через сайт owner теперь не снимается и не блокируется.

## 4. Поставить новый Nginx-конфиг

Сначала создайте proxy snippet:

```bash
mkdir -p /etc/nginx/snippets
cp ~/qubite/deploy/nginx/snippets/qubite-proxy-headers.conf /etc/nginx/snippets/qubite-proxy-headers.conf
```

Потом замените дефолтный сайт:

```bash
cp ~/qubite/deploy/nginx/qubite.conf /etc/nginx/sites-available/default
nginx -t
systemctl reload nginx
```

Что даст этот конфиг:

- `qubiteapp.ru` станет основным доменом
- `www.qubiteapp.ru` будет редиректиться на основной
- `qubiteapp.online` и `www.qubiteapp.online` будут редиректиться на основной
- появятся лимиты на `/api/auth/` и `/api/`
- появятся timeout/body-limit/connection-limit настройки перед Node

Важно:

- блок для `qubiteapp.online` на `443` работает только если ваш текущий сертификат реально покрывает `qubiteapp.online`
- если `nginx -t` скажет, что сертификат не подходит для `.online`, временно закомментируйте именно `server_name qubiteapp.online www.qubiteapp.online;` блок на `443`

## 5. Перезапустить backend через PM2

Если у вас приложение уже в PM2:

```bash
cd ~/qubite/back
pm2 restart 0 --update-env
pm2 save
```

Если хотите проверить, что env применился:

```bash
pm2 show 0
```

Смотрите, чтобы Node слушал только `127.0.0.1:3000`.

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

Не открывайте наружу `3000`.

## 7. Включить Turnstile

В Cloudflare:

1. Создайте Turnstile widget
2. Разрешите hostname `qubiteapp.ru`
3. Вставьте `TURNSTILE_SITE_KEY` и `TURNSTILE_SECRET_KEY` в `.env`
4. Перезапустите PM2:

```bash
cd ~/qubite/back
pm2 restart 0 --update-env
```

## 8. Что проверить после раскатки

Проверьте руками:

1. `https://qubiteapp.ru` открывается
2. `https://www.qubiteapp.ru` редиректит на `https://qubiteapp.ru`
3. `https://qubiteapp.online` редиректит на `https://qubiteapp.ru`
4. регистрация работает
5. логин работает
6. owner виден в админке, но кнопки изменения/блока для него отключены
7. обычный пользователь с логином `admin` не становится админом

## 9. Команды, которые вам, скорее всего, нужны прямо сейчас

Если делать по-быстрому и в правильном порядке:

```bash
cd ~/qubite
git pull

cp ~/qubite/deploy/nginx/snippets/qubite-proxy-headers.conf /etc/nginx/snippets/qubite-proxy-headers.conf
cp ~/qubite/deploy/nginx/qubite.conf /etc/nginx/sites-available/default

nvim ~/qubite/.env

cd ~/qubite/back
npm install

nginx -t
systemctl reload nginx

pm2 restart 0 --update-env
pm2 save
```

А потом:

```bash
cd ~/qubite
node back/scripts/promote-admin.js --email YOUR_EMAIL
node back/scripts/set-owner.js --email YOUR_EMAIL
```
