# Handoff — QUB-AI-001, 14.10.2026, review/testing

Ответы владельца получены до реализации: USD, полный набор ограничений, configurable timezone сначала Екатеринбург. [ADR-0026](../architecture/decisions/0026-atomic-mock-budgets.md), [контракт](../architecture/AI_BUDGETS.md), [отчёт](../reports/QUB-AI-001.md). Один bounded task; AI-002/AUTH-004 не разрешены автоматически.

## Текущий runtime и границы

Core0.8.0/schema0009_budgets: additive12tables, всего38; прежние SQL0001..0008/identity/grants/session сохранены. Internal BudgetStore reserve живые permissions+CSRF, exact mock price+bound; integer micro-USD, request/token limits по global/user/module/project/exact model и day/month/all. Global/user all money caps обязательны, default deny и owner no bypass. Все scopes/periods ведут ledger до включения доп. caps; configure cap/timezone не сбрасывает сумму/текущий период, old unknown reserve занимает new-period headroom. Explicit owner command hooks с own-password reauth/revision/idempotency/atomic before-after audit. Project binding только к projects policy resource в том же workspace, не создание Projects engine.

Reservation+allocations+outbox атомарны. Internal mock events reserved/dispatched/unknown/released/settled: exactly once, no TTL release после отправки; полный actual cost/token accounting и durable route freeze при over bound. Новый price snapshot не обходит freeze. No public AI/owner budget endpoints/provider/worker/lease; marked-dispatched не paid permit. Generic REST/job/tool/WS paid gate остаётся закрыт. AI-002 добавит guarded mock dispatcher; AUTH-004 отдельный Console UI/HTTP controls. Hourly/FX/реальные prices/ChatGPT финансирование отдельно.

apps/web0.4.0 без изменений: Поток/Игрушечная/Лента/Unbounded/Manrope100/503, Auth и guarded server module catalog. Private preview v5 прежний, https://qubite-app-shell-kirill.kuzmichevkonstantin9.chatgpt.site; бюджетных экранов пока нет. Static preview backend не deploy. Legacy/reference/Tournaments не интегрировались.

## Evidence

Target budgets61passed48.79s, включая два spawn процесса100 запросов двух пользователей/моделей при cap1USD/estimate0.6USD→1reserve,99denied; repeated key и double settle20 операций ровно один результат. Full isolated all1058+harness11=1069pass, core208/175/202/22/61 в29.78/57.44/82.65/8.88/46.11s. Final no failed/skipped. Logs /tmp/qubite-budget-target.log и /tmp/qubite-budget-regression.log. Format/build/build:demo passed; local browser86pass1.2m (18desktop+19phone+33HTTP fixtures+16real core); exact-SHA CI pending. Primary PG approval review403 был service failure, retry принят. Initial2 helper failures исправлены; final passes записаны, browser path typo corrected. Source-copy/disposable/synthetic evidence не real provider/physical/native/production acceptance.

Harness теперь5 core groups + --suite budgets; future/nested file exactly once, timeout180 unchanged. OpenAPI version0.8.0, публичных budget routes нет. Миграционные regression expected0009/9rows/38tables; старые migrations не менялись. Permanent migration отдельно с backup/restore/staging/approval; old core после0009 refuses writable history, recovery forward без down/drop/reset.

Base main1aaddb2deb6c032be7b5dfa87264a4a8c205ccc2/origin verified. Immutable origin/tournaments+qubite-v1.0=96f0457a523b6b79f21c4092056d8fa8fa69a680. Чужое удаление .antigravitycli/07eac59c-6b3f-4705-b06f-3fd77ff36ace.json не stage/revert. Filled deploy/.env/root secret env/DB/uploads/legacy/ShadeAI/личная память/skills/subagents/quota reset untouched. Git push не deploy.

## Дальше

После final verification/commit/push/exact-SHA CI закрыть AI-001. Затем сначала вопросы и ответы по **AI-002** mock dispatcher crash/revoke/fallback; затем AUTH-004 users/grants/budgets Console. Legal operator/jurisdiction/contact pending/publication_ready=false, реальные SMTP/native/providers/installer/deploy отдельные. Registry69tasks17done/4ready/1review-testing/47backlog до completion; актуальный tasks.json authority.
