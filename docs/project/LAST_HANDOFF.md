# Handoff — AUTH-00613.10.2026

Review/testing. Перед задачей вопросы заданы; ответы: owner-managed registration switch, оба invite вида, вход после email verification. Core0.6.0/current0007_registration, backend API/forward SQL, pending/no grants, оба invite с TTL/revoke/hash-only/idempotency; [контракт](../architecture/REGISTRATION.md), [отчёт](../reports/QUB-AUTH-006.md), [ADR-0020](../architecture/decisions/0020-owner-controlled-registration.md). Current evidence в tasks.json, done только после full tests/exact-SHA CI.

Регистрация default invite; public/disabled owner runtime API, React UI отдельно. AUTH-011 injected mock only; legal version technical, SMTP/legal publication/deploy ещё открыты. Existing account verify/reset/login/explicit OAuth linking на одном UUID. Runtime legacy/.env/services/demo/ShadeAI не изменены, archive remote96f0457 immutable, main старт6293a59 clean. Permanent owner/password не создавались.

59 tasks. AUTH-015 глобальные login/maintenance/provider switches, AUTH-016 официальный ChatGPT client eligibility/identity, AI-003 personal plan vs owner API записаны в backlog. Детальные будущие tasks не одобрены автоматически. Следующая последовательность для обсуждения: UI-001 Today/shell → AUTH-007 signup/login/reset UI; AI-001/002 и Owner Console отдельные dependencies. Перед каждым task сначала вопросы/ответы. No skills/subagents/quota resets, V2 kickoff отсутствует, sources сохранены. Push не deploy.

Local all963+harness6=969pass, core575=208+165+202 (registration71),26.72/48.79/75.31s, every<180. Последующая только OpenAPI DTO name collision устранена с сохранением всех прежних схем/операций,3 targeted contracts pass. Implementation/CI pending до commit/push.
