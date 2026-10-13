# Handoff — QUB-AUTH-007, 13.10.2026, review/testing

Владелец ответил на три вопроса до реализации: анонимный сайт — лендинг → отдельный Qubite Auth → обычная главная; Android открывает системный браузер, native возврат отдельно; новые legal/cookies/data consent; приглашения по ссылке и вручную. AUTH-007 разрешена, повторное подтверждение не требуется. [Отчёт](../reports/QUB-AUTH-007.md), [ADR-0024](../architecture/decisions/0024-public-landing-and-qubite-auth.md).

## Реализовано

apps/web0.3.0: существующие Поток/Игрушечная/Лента/Unbounded/Manrope100/503 из src/material. Landing/auth/legal отдельно от authenticated Command shell. Email/password/register/verify/reset, server-controlled registration mode/version, две независимые unchecked consent choices, fresh CSRF/no-store/timeout/Abort. Invite/proof из fragment очищаются до render/API; GET не подтверждает email/пароль. После входа fresh me/access, server authority/default deny. Профиль: own sessions/revoke/logout-all с own-password reauth, provider metadata/link/unlink. Password/possession proofs не сохраняются в browser storage/transition snapshots/logs.

Core0.6.0/schema0007 unchanged: только bounded OAuth callback browser navigate+HTML fixed303 completion/linked/error; JSON API сохранён, OpenAPI regenerated. Unknown provider identity не создаёт аккаунт/не связывается по email. Provider availability конфигурационная; настоящие SMTP/providers/native/deploy не выполнялись.

[Полные legal тексты](../legal/README.md) и canonical UI JSON/hash/Markdown mirror. publication_ready=false: оператор/статус/контакт/страны ещё неизвестны, вопрос владельцу отправлен. Current API consent package bool/version/time не отдельное purpose evidence; новая QUB-LEGAL-001 до публичного запуска. Тексты не объявлены готовым compliance. Локальный installer dry-run не блокируется неизвестными реквизитами.

## Проверка и завершение

Local final full71browser scenarios:18desktop+19phone+23live fixtures+11real browser/FastAPI/disposable PostgreSQL. Core/legacy975+engineering11=986pass; final failed/skipped0. Python3.13.13/Node22.22.2/PG18.6/Chromium. Format/typecheck/live+demo builds passed. Screenshots light/dark/phone/desktop inspected после structural fixes и окончания RAF movement. Browser viewport/axe/loopback — не physical FPS/keyboard/screenreader/native/providers/SMTP/TLS ingress acceptance.

Implementation commit/exact-SHA CI и обновлённая demo publication будут записаны после push; задача пока review/testing. Base4239201de7c957f7b95a67cf316bc54fe7b7e636. Предыдущие UI-002 evidence сохранены в его отчёте: implementation2d0a8e02728cf281d0ec8d66108396b7ea88aec8, web38441106776/engineering38441107010 success.

## Git, данные и публикация

Existing external .antigravitycli/07eac59c-6b3f-4705-b06f-3fd77ff36ace.json deletion исключать из commits, не восстанавливать. Секретные env/DB/build/browser state вне Git; filled deploy/.env сохранён. Legacy/сервисные references/design-lab/ShadeAI/личная память/skills/subagents/quota reset не менялись. Архивные tournaments/qubite-v1.0 immutable96f0457a523b6b79f21c4092056d8fa8fa69a680, перепроверить origin при push.

Reuse existing [owner-private shell demo](https://qubite-app-shell-kirill.kuzmichevkonstantin9.chatgpt.site), project_id в ignored apps/web/.openai/hosting.json: appgprj_6ace5114ca9c8191adc1bd33365fc909. Owner/custom/один owner viewer/0groups проверены. Static.directory=dist: demo-mode build только в отдельной source copy, не публиковать live API-mode как demo. Формы demo не делают POST, не создают fake account/email, не сохраняют credentials. Старый material-lab остаётся неизменным. Текущая публикация до AUTH-007 — version2/source3f29bb8ffb80e31fd2c55e46611b158c17d76ba6/deploymentappgdep_6ace6eb65328819192aedadeeca763ed succeeded; обновить evidence после новой публикации. Git push и static demo не устанавливают рабочий core/DB.

## Следующая задача

После завершения AUTH-007 — QUB-UI-003, настоящий server catalog и owner hidden/locked настройки перед AUTH-004 Console. Сначала новые вопросы владельцу, дождаться ответов; разрешение AUTH-007 не распространяется на следующий task. AUTH-013/DEPLOY-001/TG-001/CORE-002 остаются альтернативными ready tracks, не запускать всё параллельно. Сервер/VPS и production отложены. Native Web/Android/Linux desktop, затем Windows/macOS по отдельным POC.
