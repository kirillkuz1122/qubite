# ADR-0017 — Email possession и восстановление fresh identity

13.10.2026. Engineering decision внутри ready/approved AUTH-011; пользователь разрешил следующую bounded задачу. Product fresh identity/local singleton owner сохраняет ADR-0013/0014. [Контракт и API](../EMAIL_CHALLENGES.md).

Выбраны существующие UUID,256-bit purpose-specific proofs в SHA-256, ограниченный TTL/attempt/rates, PG subject-first locks и live auth/credential/email snapshots. Verify активирует pending существующий account без grants/owner; reset только previously verified email и existing credential, atomic password/auth versions+all own session revoke, без автоматического входа. Нет account-code alias/legacy migration, GET consumption или короткого шестизначного bearer reset code. Сторонний provider email не используется как verification/reset proof.

Delivery — injected memory-only test transport с explicit off default, без SMTP/real keys. Failure generic202 и proof invalidation. Production queue/timing/redaction/deliverability/notifications остаются rollout gates. Email-2FA в AUTH-011 именно protocol contract: включение/login enforcement/enrollment/recovery требуют новой approved задачи; реализованный AUTH-009/010 не получает фиктивную 2FA защиту. Email не выдавать за NIST OOB/phishing-resistant factor.

Альтернативы: автоматический signup при proof отложен AUTH-006; reset без verification отвергнут как смена credential по непроверенной recovery address; reset с сохранением sessions отвергнут; delivery под row locks отвергнут; raw token в БД/HTTP/query/log отвергнут. Durable encrypted mail outbox может понадобиться при production transport, но требует отдельного key/retry model, сейчас не имитируется. Атомарный resend инвалидирует предыдущую ссылку; pending activation отзывает старые sessions/proofs, следующий вход явный.

Explicit0005 additive migration, checksum history/current table gates. Rollback выключает feature в совместимом binary и сохраняет новые UUID/credentials/schema. Ни down/drop, ни восстановление legacy authority. Verified fixtures/CI отдельно от реальной email/device/production acceptance; результат в [отчёте](../../reports/QUB-AUTH-011.md).
