# Qubite Security Guide

## Included in code

- `owner` role above `admin`, immutable from web/API.
- Local CLI ownership transfer with `back/scripts/set-owner.js`.
- Local CLI admin promotion with `back/scripts/promote-admin.js`.
- Route-specific rate limiting for auth, password reset, 2FA, team join, tournament join, draft save, answer submit, moderation/admin actions, and expensive public endpoints.
- Same-origin protection for cookie-based state-changing requests.
- Safer proxy/IP handling through Express `trust proxy` instead of blind `x-forwarded-for` trust.
- Smaller default JSON body limits, larger limits only for organizer import routes.
- Node request/header/keep-alive timeout hardening.
- Safer cookies and extra HTTP security headers.
- Cloudflare Turnstile on register, login, and forgot-password with server-side validation.
- Hidden tournament `accessCode` outside organizer/admin views.
- Owner-protected moderation/admin UI controls.

## Required production steps

1. Configure `.env` from `.env.example`.
2. Put Nginx in front of Node with [`deploy/nginx/qubite.conf`](/home/kirill/programing/qubite/deploy/nginx/qubite.conf).
3. Open only `22`, `80`, and `443` on the VPS. Use either [`deploy/firewall/nftables-qubite.nft`](/home/kirill/programing/qubite/deploy/firewall/nftables-qubite.nft) or [`deploy/firewall/UFW.md`](/home/kirill/programing/qubite/deploy/firewall/UFW.md).
4. Apply sysctl hardening from [`deploy/sysctl/99-qubite-security.conf`](/home/kirill/programing/qubite/deploy/sysctl/99-qubite-security.conf).
5. Enable Cloudflare proxy and basic free-plan protections from [`deploy/cloudflare/CLOUDFLARE_FREE_CHECKLIST.md`](/home/kirill/programing/qubite/deploy/cloudflare/CLOUDFLARE_FREE_CHECKLIST.md).
6. Assign privileged users only from the server terminal:
   - `node back/scripts/promote-admin.js --email you@example.com`
   - `node back/scripts/set-owner.js --email you@example.com`

## Turnstile setup

1. Create a Turnstile widget in Cloudflare and allow your production hostname.
2. Put `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` into `.env`.
3. Keep `TURNSTILE_DEV_BYPASS=false` in production.
4. In local development you may set `TURNSTILE_DEV_BYPASS=true` only on loopback.

Official docs:
- [Turnstile get started](https://developers.cloudflare.com/turnstile/get-started/)
- [Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

## Owner and admin operations

- Promote admin:
  - `node back/scripts/promote-admin.js --uid U-XXXX`
  - `node back/scripts/promote-admin.js --login your_login`
  - `node back/scripts/promote-admin.js --email you@example.com`
- Assign owner:
  - `node back/scripts/set-owner.js --uid U-XXXX`
  - `node back/scripts/set-owner.js --login your_login`
  - `node back/scripts/set-owner.js --email you@example.com`
- Transfer ownership:
  - `node back/scripts/set-owner.js --email new-owner@example.com --replace`

Owner cannot be changed, blocked, or demoted from the web UI or API.

## Deployment checklist

- Run Node only on localhost, for example `HOST=127.0.0.1`.
- Keep `TRUST_PROXY=1` only when a real reverse proxy is in front of Node.
- Set `ALLOWED_ORIGINS` and `ALLOWED_HOSTS` to real production domains.
- Use HTTPS only. If Cloudflare is enabled, use `Full (strict)`.
- Keep SQLite database file outside public directories and back it up.
- Do not expose the SQLite file, `.env`, or Node port directly to the internet.

## Remaining risks

- Application hardening does not stop volumetric L3/L4 DDoS. Use Cloudflare proxy and VPS network controls.
- Free Cloudflare plan and app-level rate limits reduce abuse, but a large sustained flood can still exhaust a small VPS.
- CAPTCHA slows bots, but does not fully stop targeted manual abuse or compromised residential IP traffic.
- Local CLI access to the server remains highly privileged. Protect SSH, sudo, and backups.
