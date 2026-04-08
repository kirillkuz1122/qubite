# Cloudflare Free checklist for Qubite

## DNS and proxy

- Turn on the orange-cloud proxy for the public app hostname.
- Keep the origin Node server private behind Nginx.
- If the origin was previously exposed, rotate firewall rules so only `80/443` stay public.

## SSL/TLS

- Set SSL/TLS mode to `Full (strict)`.
- Enable `Always Use HTTPS`.
- Prefer HSTS only after HTTPS is stable end-to-end.

Official docs:
- [Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)

## Bot and abuse controls

- Enable `Bot Fight Mode`.
- Add a free rate-limiting rule for `/api/auth/*`.
- Add a managed challenge or JS challenge rule for suspicious spikes on `/api/*` if needed.

Official docs:
- [Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/)
- [Free bot protections overview](https://developers.cloudflare.com/bots/plans/free/)
- [Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)

## Real visitor IPs

- Keep `TRUST_PROXY=1` in the app when Nginx is in front of Node.
- Forward `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto` from Nginx.
- If you want Nginx logs to show the real Cloudflare visitor IP, configure Cloudflare real IP restoration there too.

Official docs:
- [Restore original visitor IPs](https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/index/)
