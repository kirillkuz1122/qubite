# QUB-AUTH-003 — Module entitlements и scoped policy gate

13.10.2026. **Review/testing: local850 passed; implementation/push/exact-SHA CI pending.** Начало clean main a32b60a61e1c10b5791162ae8a685c5a5554d868; origin main exact, archive tournaments/qubite-v1.0 verified96f0457a523b6b79f21c4092056d8fa8fa69a680. Пользователь поручил AUTH-003 и ответил на два вопроса; defaults/account-only/manual grants и independent read/write/manage утверждены. Перед следующими задачами обязательно вопросы/ответы, правило записано в AGENTS/CLAUDE/Harness/PROJECT_CONTEXT.

## Реализуемый slice

Core0.5.0/schema0006_policy, десять additive policy metadata tables (всего21), strict policy DTO/HTTP contract, owner versioned/idempotent metadata commands, default deny/per-module/action/workspace/object ACL/expiry. Originating session и singleton owner читаются из PG, JSON actor/role/budget отвергаются. Турнирные роли ограничены module=tournaments. Own-access только собственные module grants, без private titles/content. [POLICY_GATE](../architecture/POLICY_GATE.md), [ADR-0018](../architecture/decisions/0018-scoped-policy-gate.md).

REST DB effect hook, exact short internal job/tool delegation и read-only WS probe используют общий gate. Revoke/admin concurrency/expired permissions/session/version повторно проверяются; audit failure rollback сохраняет grants/revision. Owner не имеет implicit resource/AI bypass; provider counter на отрицательных путях0. Платный AI полностью закрыт до AI-001/002; настоящий reserve/dispatch не реализован.

## Проверки и evidence

Первый targeted policy run:72pass/7fail (39.76s), не acceptance. Исправлены fixture ошибки: expires_at=created_at нарушал SQL constraint; reauth endpoint204, не200; HTTPS secure cookies требуют wss URL в TestClient; old-schema fixtures нельзя создавать новым bootstrap; CSRF следует получить до повреждения schema. Runtime readiness сохранил readonly pg_catalog contract; empty policy_state контролируемо503 в gate, без silent repair. Это первый bounded repair batch.

Второй bounded repair: historical synthetic DROP sessions стал CASCADE для новой FK; после этого core459 (208+251) pass. Policy86 включает дополнительные contract/expiry/retention/foreign member/rollback tests. Итоговые all suites, exact-SHA CI, implementation/push и refs будут записаны после успешного прогона. Core разбит на три exhaustive file groups с прежним180s subprocess timeout: последний CI core373 занял156.06s, новые policy tests добавляют нагрузку. Ни один тест не пропущен; recursive file discovery сохраняется, targeted --suite policy дополнен. Existing Auth/MFA/email contract ограничения сохраняются.

## Ограничения и rollback

Legacy/services/production/.env/ShadeAI/design-lab не изменяются; постоянный owner/grants/пароль не создаются, все изменения DB только disposable fixtures. Installed catalog по умолчанию false; настоящие modules и trusted registrar/installer отдельно. Owner Console UI/React/navigation/registration/native/keys/introspection/durable jobs/content/sharing/notifications/provider delivery/deploy остаются future cards. Новый UI не показан: эта task серверная policy.

Forward recovery: сохранить schema0006/UUID/grants/audit и отключить consumers, применить tested forward fix. Не down/drop, не старый core против новой schema, не восстановление legacy authority. Production backup/restore/staging/rollout отдельно. Skills/subagents/quota reset/real providers не использованы. Source master/access/48ideas сохранены. После этой задачи следующая основная по обсуждённому порядку AUTH-005 (убрать code-entry/зафиксировать единый сценарий), затем AUTH-006 (минимальная регистрация), однако сначала вопросы владельцу; автоматического старта нет.


## Финальная локальная проверка

13.10.2026 isolated `verify.py --suite all --python /tmp/qubite-design-tests/bin/python --postgres-bin /tmp/qubite-design-postgres/usr/bin`: **844pass**, Node94/deploy18/Search95/Brief112/Kwork29/SiYuan5/identity32/core459. Core три группы208/25.24s +165/45.62s +86/43.33s (сумма114.19s); policy86. Harness `python3 -m unittest discover -s tests/engineering`:6pass, всего850. Check.py56tasks/61docs и git diff --check pass. No failed/skipped, real tempPG18.6/Python3.13.13/Node22.22.2, no external/provider delivery. Historical two-group core run459 также pass, final runner three groups проверен всем all.

0001..0005 SQL и root master/access unchanged проверены git diff --exit-code. Изменены только новый policy/core integration/contracts/tests/harness/docs; бизнес-сервисы, секреты, demo и live deployment не менялись. Exact implementation SHA/CI и remote refs будут добавлены после push, до этого task review/testing.
