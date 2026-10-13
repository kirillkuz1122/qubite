# ADR-0020 — Регистрация под управлением владельца

Статус: **CONFIRMED product answers13.10.2026; инженерные механизмы внутри approved AUTH-006.** До реализации заданы вопросы, владелец выбрал управляемое включение/выключение, оба типа invite, вход после подтверждения email. Он также попросил записать глобальные switches/ChatGPT в отдельные задачи.

Решение: FastAPI/Postgres fresh enrollment, mode invite default/public/disabled, owner-only API с recent own-password/CSRF/If-Match. Приглашения на canonical email либо transferable, hash-only/one-use/TTL/revoke, command UUID против повторного выпуска. Strict minimal email/password/consent/name DTO, без турнирных/legacy полей. Pending account → AUTH-011 email verify → explicit login. Регистрация не выдаёт owner/module/AI и не восстанавливает старые SQLite identities.

Forward0007, атомарные subject/credential/consent/redemption/audit. Argon2/delivery вне DB lock; config/invite проверяются после hashing. Короткий state-row lock выбран вместо отдельного широкого platform settings engine. Existing verify/reset/OAuth используют тот же UUID.

Цена решения: backend API не React админка, email mock-only, доставка не durable, версия согласий техническая до actual legal publication. Uniform202 не timing/privacy гарантия. Потерянный invitation response не replay-secret: owner revoke по command UUID и новый выпуск. Регистрация disabled не выключает вход — это отдельный AUTH-015 с anti-lockout discussion.

AUTH-016/AI-003 сохраняют официальный SIWC/личный план и owner API отдельно, с eligibility gate для website/native. Они не реализуются в текущей AUTH-006 и не получают blanket approval. [Регистрация](../REGISTRATION.md), [переключатели](../PLATFORM_CONTROLS.md), [ChatGPT](../CHATGPT_INTEGRATION.md).
