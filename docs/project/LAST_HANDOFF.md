# Handoff — AUTH-003, 13.10.2026

Один порученный cycle AUTH-003 — review/testing. Ответы владельца: только аккаунт до manual module grants, read/write/manage независимы. Новое правило: **перед каждой следующей задачей сначала вопросы владельцу, дождаться ответов, затем реализация**, записано в AGENTS/CLAUDE/Harness/PROJECT_CONTEXT. Blanket approval будущих задач отсутствует.

Core0.5.0/schema0006_policy,21 domain/security tables; independent entitlements/workspace membership/resource ACL, owner metadata API If-Match/idempotency/recent own-password/audit; общий REST/job/tool/WS gate и short session/version-bound exact delegation. Paid AI закрыт до AI-001/002; owner не bypass. [Контракт](../architecture/POLICY_GATE.md), [ADR-0018](../architecture/decisions/0018-scoped-policy-gate.md), [отчёт](../reports/QUB-AUTH-003.md). Final local all844+harness6=850pass (core459=208+165+86), implementation/push/CI ещё проверяются; task не done.

Модули seeded installed=false/enabled=false, actual domain engine/registrar/installer отдельно. Probe WS без content/events; job/tool callbacks — только trusted internal adapter hooks. Durable queues/plugins/native/API keys/services integration/Console UI/registration/real providers/budget dispatcher/production rollout вне slice. Legacy/services/.env/ShadeAI/demo не меняются, постоянных owner/паролей/данных нет. PG fixtures temporary, provider/external calls0.

Start clean main a32b60a61e1c10b5791162ae8a685c5a5554d868; origin exact и archive96f0457a523b6b79f21c4092056d8fa8fa69a680 проверены до изменений. 0001..0005 unchanged, forward recovery/preserve UUID/new grants/audit, no down/drop/force push. Русский implementation commit→immediate push→exact-SHA tests-only CI→evidence docs commit/push. Core runner три exhaustive groups с180s timeout без skips: foundation/identity/auth, OAuth/challenges, policy+future/nested.

AUTH-011 done implementationf3d4b6c01a20536ce31017e309119d1fe2a792e7/CI38373075395 success/762 checks — исторический slice, не evidence нового policy. DESIGN-001 accepted Поток/Игрушечная/Лента/Unbounded/Manrope100/503,133browser historical. No skills/subagents/quota reset. Master/access/48ideas preserved; exact V2 kickoff отсутствует.

После AUTH-003 по обсуждённому порядку AUTH-005 (единый account login без code-entry), затем AUTH-006 минимальная регистрация; **до каждого slice сначала вопросы/ответы**, без автоматического старта. Альтернативные tracks в registry, deploy не ближайший rollout и требует отдельных host/staging/backup проверок/разрешения.
