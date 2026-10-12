# Границы безопасности: baseline

Статус: ПРОВЕРЕНО КОДОМ на 96f0457; dynamic testing только изолированными suites. Список — risks/findings, не результаты penetration test рабочего сервера.

| ID/приоритет | Наблюдение и основание | Следствие | Проверка/задача |
|---|---|---|---|
| SEC-01 P0 | services.js owner auto paid, writing.js owner auto ai | Нельзя использовать как целевое owner authorization | QUB-AUTH-003, owner без бюджета → 0 provider calls |
| SEC-02 P0 | server.js role bootstrap/requireRoles | organizer/moderator/admin сейчас глобальные | QUB-AUTH-001, отрицательная матрица scoped ролей |
| SEC-03 P0 | Search/Writing/Brief отдельные ledgers | Общий финансовый cap не обеспечен | QUB-AI-001/002, межпроцессная гонка |
| SEC-04 P0 | db.js initializeDatabase: CREATE/ALTER/backfill на старте | Запуск нового SHA может изменить БД до acceptance | migration plan, disposable restore и запрет запуска на live data |
| SEC-05 P1 | request-guard.js counters Maps, исключения app/node/sync; Writing Bearer bypass | На каждый process свой limiter, альтернативная auth должна проверяться отдельно | HTTP negative tests для исключений; не утверждать найденный exploit |
| SEC-06 P1 | process-events.js недолговечный IPC | Потеря уведомлений при downtime | durable outbox для нового core, без переписывания legacy сейчас |
| SEC-07 P0 | config.js автоматически читает root/back .env; Search app.py own .env | Тест может зависеть от секретов developer machine | Harness запускает копию source без env с отдельным HOME |
| SEC-08 P1 | общий UID и private Unix managers | NoNewPrivileges не изолирует БД/секреты одного UID | staging threat model; plugins отдельный UID/process |
| SEC-09 P1 | parseCookies decodeURIComponent без локального catch | malformed cookie может дать exception до attachAuth try | отдельный malformed-cookie HTTP test; severity подтвердить |
| SEC-10 P1 | users поля fake-like initial stats/default streak/rank | Нельзя автоматически принять метрики за реальные при переносе | считать результаты по submissions/rating_changes, reconcile |

Положительные механизмы: scrypt + timingSafeEqual; hashed random session/opaque tokens; server guards и Origin check; PKCE/state; service keys scoped/revocable; audit; protected search logs SQL enforcement; SSRF fetch checks; exact native account/grant проверки; outbox/revision/idempotency в Brief/leads.

Открытые проверки: OAuth linking/collision/redirect state, CSRF для всех исключённых cookie путей, blocked/revoked session, soft/hard delete retention, CSP/HTML sanitization, proxy header trust, публичные node token endpoints, malformed JSON/cookies, grants revoke/cache invalidation. Содержимое .env и исторических секретов не выводить; проверку истории проводить scanner с redacted результатом. Не делать ротацию/удаление истории без отдельного операционного решения.
