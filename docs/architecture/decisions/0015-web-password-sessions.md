# ADR-0015 — реальный Web Auth и первоначальный пароль owner

13.10.2026. Engineering decision в разрешённой AUTH-009 после done AUTH-002/008. Прямое поручение владельца следующей задачи, existing approved fresh Auth scope. [ADR-0013](0013-fresh-identity-and-unified-login.md), [runtime спецификация](../WEB_AUTH.md).

Выбран argon2-cffi с явным минимальным cost из согласованного контракта: Argon2id m19456/t2/p1,16-byte salt/32-byte hash. Проверка PHC cost до verify и semaphore2/process; реальный synthetic benchmark около16ms. Более тяжёлый profile/worker count выбирается после capacity измерений сервера. SHA256 применяется только к случайным opaque cookies, не к паролям. Подписанные JWT/positive cache отвергнуты для этого slice ради простого немедленного revoke.

Четыре additive таблицы0003: credentials/web sessions/one-use anonymous CSRF/shared PG counters; предыдущие checksum и UUID сохраняются. Shared migration lock, row locks одного subject, Argon2 вне transaction и повторная проверка snapshot. Безопасность исходного входа требует anonymous one-use challenge; GET возвращает HMAC-derived bound proof без cookie secret. Login и reauth имеют единый identifier/IP rate budget. Reauth endpoint добавлен к AUTH-009, чтобы recent proof для logout-all можно было обновлять без выхода/повторного входа; это не password reset.

Local owner password setup только getpass/TTY/явное подтверждение, initial insert без overwrite; public signup/первый login не назначает owner. HTTPS exact configured origin, __Host cookies; отдельный explicit loopback HTTP режим с другими именами. Host/Origin/IP не извлекаются из forwarded headers до отдельного ingress acceptance. Никаких module/model grants или AI bypass из owner metadata.

Identity-v2 теперь partial_implementation, implemented только AUTH-009 routes; остальные planned. OpenAPI snapshot core-v1 соответствует реальному API0.2.0, validation400 не раскрывает исходный пароль. Storage readiness остаётся history/table existence gate, не гарантией bootstrap/внешнего TLS/семантического schema fingerprint.

Реальный owner/password постоянной среды не создавались; все тестовые значения synthetic, UI/providers/services/deploy не переключались. SQL privileges проверены на ограниченной disposable runtime role; installer provisioning позже. Rollback не удаляет новые credentials/sessions/ledger. Старый binary не ready на ahead0003; нужен совместимый forward recovery. Scope реальных OAuth/verify/reset/native/keys/policy остаётся отдельным.
