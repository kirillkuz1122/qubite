# Handoff — AUTH-005, 13.10.2026

AUTH-005 review/testing. Вопрос задан и ответ владельца получен: «Да, закрываем AUTH-005 по этим границам». Один bounded cycle: контракт + реальные negative/positive HTTP/PG tests существующего Web Auth; tournament code join regression. Registration/UI/Search/Writing/VPN отдельно.

Core0.5.0/schema0006_policy и production handlers/SQL не изменены. Новый auth-v1 — проверяемое подмножество identity-v2, actual OpenAPI прежний. [Границы](../architecture/ACCOUNT_LOGIN.md), [ADR-0019](../architecture/decisions/0019-account-login-boundary.md), [отчёт](../reports/QUB-AUTH-005.md). Old code-entry/login/v1 aliases404, strict email/password DTO, pending/blocked не активируются, email proof не password/session/bearer. Турниры сохраняют shared/personal invitation после module login; core adapter ещё planned. Legacy code-entry в standalone Node source ещё есть; будущий ingress не должен fallback-ить account namespace на Node.

Baseline чистый main/origin d6c15e16b8f6505715f17914c966dc528485fff5; архивные remote refs96f0457a523b6b79f21c4092056d8fa8fa69a680 проверены. Только disposable PostgreSQL/SQLite, mock-only provider/mail; постоянных owner/password/secrets/.env/deploy нет. Test-only legacy fixture после auth-only startup разрешает workspace, сохраняя реальные handlers/middleware и отсутствие proxy/bot/daily workers. Две test-only repair batches, финальный all892pass+harness6=898localpass; Node97/core504=208+165+131/account-login45. Python3.13.13/PG18.6/Node22.22.2, groups24.97/46.59/52.79s, no skips. check.py56tasks/63docs и diff pass. Implementation SHA/remote/exact-SHA CI ещё ожидаются.

После завершения AUTH-005 следующая AUTH-006 (минимальная регистрация); перед каждой задачей сначала вопросы владельцу и дождаться ответов. Согласование AUTH-005 не разрешает следующую реализацию. Другие ready tracks не запускаются в этом cycle. No skills/subagents/quota reset; exact V2 kickoff отсутствует, source master/access сохранены. Push не deploy.

Registry56:10done/4ready/1review-testing/41backlog; AUTH-006 backlog/approvalfalse. Архив не менялся, runtime/schema/OpenAPI/identity-v2/root sources unchanged.
