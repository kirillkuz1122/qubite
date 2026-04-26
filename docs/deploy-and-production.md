# Deploy и production

## Текущая production-модель

Текущий рабочий production-сценарий для Qubite выглядит так:

- домен RU-версии: `qubiteapp.ru`
- Node backend слушает локальный адрес
- перед Node стоит `Nginx`
- процесс держит `PM2`
- основная база — `SQLite`
- внешний edge/proxy и часть abuse controls — `Cloudflare`

Это не “обобщённый абстрактный deploy”, а практический VPS-сценарий, который уже используется для живого сайта.

## Типовой контур

1. Пользователь приходит на публичный домен.
2. Трафик проходит через Cloudflare.
3. Nginx принимает запросы на VPS.
4. Nginx проксирует запросы в Node на `127.0.0.1:3000`.
5. Node обслуживает HTML/API и работает с SQLite.

## Важные production assumptions

- Node не должен быть открыт напрямую наружу.
- SQLite лучше держать с одним основным Node-процессом, без cluster mode.
- `TRUST_PROXY=1` включается только когда перед Node реально стоит reverse proxy.
- `ALLOWED_ORIGINS` и `ALLOWED_HOSTS` должны совпадать с реальными доменами.
- Production secrets нельзя хранить в репозитории.

## Текущий операторский update-flow

Текущая рабочая команда обновления сервера выглядит так:

```bash
cd /var/www/qubiteapp/ && git pull && cd back/ && npm install && pm2 restart 0 --update-env
```

Это стоит считать фактическим операторским сценарием, даже если часть deploy-доков ещё требует дополнительной чистки.

## Production env

Минимальный набор, который нужно проверить перед запуском:

- `HOST=127.0.0.1`
- `PORT=3000`
- `NODE_ENV=production`
- `APP_BASE_URL=https://qubiteapp.ru`
- `DATABASE_PATH=.../qubite.sqlite`
- `TRUST_PROXY=1`
- `ALLOWED_ORIGINS=...`
- `ALLOWED_HOSTS=...`

Дополнительно:

- email delivery через `Resend` или другой рабочий канал;
- OAuth/VK ID/Telegram Login keys для включённых провайдеров; отдельные методы входа можно аварийно скрыть через env `OAUTH_GOOGLE_ENABLED=false`, `OAUTH_YANDEX_ENABLED=false`, `OAUTH_VK_ENABLED=false`, `OAUTH_TELEGRAM_ENABLED=false`, а штатно owner управляет ими без рестарта через админку/Telegram-тумблеры;
- CAPTCHA keys для текущей anti-bot конфигурации.

## Nginx

Основной конфиг лежит в:

- [`../deploy/nginx/qubite.conf`](../deploy/nginx/qubite.conf)
- [`../deploy/nginx/snippets/qubite-proxy-headers.conf`](../deploy/nginx/snippets/qubite-proxy-headers.conf)

Он отвечает за:

- TLS termination;
- редиректы доменов;
- proxy headers;
- rate limiting на уровне Nginx;
- базовые timeout/body-limit ограничения.

## PM2

PM2 используется как process manager.

Практические правила:

- держать один основной процесс для SQLite-инстанса;
- обновлять env через `pm2 restart ... --update-env`;
- периодически проверять `pm2 show` и `pm2 logs`.

## Cloudflare

Сейчас Cloudflare нужен как минимум для:

- proxy / edge layer;
- TLS и HTTPS policy;
- части anti-bot и rate limiting controls;
- текущего Turnstile-flow.

Но есть важный roadmap point: для российского пользовательского контура планируется переход с Cloudflare Turnstile на Яндекс SmartCaptcha, потому что Cloudflare может быть нестабильным или блокируемым в РФ. Это нужно считать roadmap, а не текущим состоянием кода.

## Firewall и hardening

Сопутствующие файлы:

- [`../deploy/firewall/UFW.md`](../deploy/firewall/UFW.md)
- [`../deploy/firewall/nftables-qubite.nft`](../deploy/firewall/nftables-qubite.nft)
- [`../deploy/sysctl/99-qubite-security.conf`](../deploy/sysctl/99-qubite-security.conf)

Базовая идея:

- наружу открыты только `22`, `80`, `443`;
- Node-порт не публикуется;
- хост дополнительно ужимается через sysctl/firewall правила.

## Что обязательно проверять после раскатки

- открывается `https://qubiteapp.ru`
- backend не торчит наружу напрямую
- регистрация и логин работают
- owner/admin операции не ломают role protections
- OAuth/VK ID/Telegram Login работает только для реально настроенных провайдеров
- CAPTCHA/anti-bot flow работает на реальном домене
- SQLite-файл и `.env` не попадают в публичную раздачу

## Known risks

- Cloudflare/Turnstile не идеален для российского пользовательского контура;
- часть deploy-знания всё ещё живёт в operator memory, а не только в docs;
- SQLite остаётся простым и практичным решением, но ограничивает масштабирование;
- `deploy/.env` в репозитории — плохой паттерн и требует ручной проверки, очистки и, при необходимости, ротации секретов.

## Связанные документы

- [`../deploy/PROD_STEPS_RU.md`](../deploy/PROD_STEPS_RU.md) — практический серверный чеклист
- [`../SECURITY.md`](../SECURITY.md) — безопасность и ограничения
- [`development.md`](development.md) — локальная разработка и dev-режим
