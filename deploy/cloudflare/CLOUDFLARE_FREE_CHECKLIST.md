# Cloudflare Free: базовый checklist для Qubite

## DNS и proxy

- Включите orange-cloud proxy для публичного домена приложения.
- Держите origin Node server закрытым за Nginx.
- Если origin раньше был открыт напрямую, проверьте firewall ещё раз.

## SSL/TLS

- Режим `Full (strict)`.
- Включён `Always Use HTTPS`.
- HSTS включайте только после уверенной проверки HTTPS end-to-end.

Официальная документация:

- [Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)

## Защита от abuse

- Включите `Bot Fight Mode`.
- Добавьте rate limiting rule для `/api/auth/*`.
- При всплесках на `/api/*` используйте challenge/rate rules на уровне Cloudflare.

Официальная документация:

- [Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/)
- [Free bot protections overview](https://developers.cloudflare.com/bots/plans/free/)
- [Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)

## Real visitor IPs

- В приложении держите `TRUST_PROXY=1`, если перед Node реально стоит Nginx.
- Пробрасывайте `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`.
- Если важны реальные IP в логах Nginx, настройте там восстановление Cloudflare visitor IP.

## Важное ограничение

Для RU-пользовательского контура Cloudflare полезен как edge/proxy слой, но текущий Turnstile-поток не обязательно оптимален в долгую. Планируемая миграция на Яндекс SmartCaptcha не отменяет полезность Cloudflare как DNS/TLS/edge-инфраструктуры.
