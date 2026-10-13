# Handoff — QUB-AUTH-007, 14.10.2026, done в согласованных границах

Владелец ответил на три вопроса до реализации: анонимный сайт — лендинг → отдельный Qubite Auth → обычная главная; Android открывает системный браузер, native возврат отдельно; новые legal/cookies/data consent; приглашения по ссылке и вручную. AUTH-007 разрешена, повторное подтверждение не требуется. [Отчёт](../reports/QUB-AUTH-007.md), [ADR-0024](../architecture/decisions/0024-public-landing-and-qubite-auth.md).

## Реализовано

apps/web0.3.0: существующие Поток/Игрушечная/Лента/Unbounded/Manrope100/503 из src/material. Landing/auth/legal отдельно от authenticated Command shell. Email/password/register/verify/reset, server-controlled registration mode/version, две независимые unchecked consent choices, fresh CSRF/no-store/timeout/Abort. Invite/proof из fragment очищаются до render/API; GET не подтверждает email/пароль. После входа fresh me/access, server authority/default deny. Профиль: own sessions/revoke/logout-all с own-password reauth, provider metadata/link/unlink. Password/possession proofs не сохраняются в browser storage/transition snapshots/logs.

Core0.6.0/schema0007 unchanged: только bounded OAuth callback browser navigate+HTML fixed303 completion/linked/error; JSON API сохранён, OpenAPI regenerated. Unknown provider identity не создаёт аккаунт/не связывается по email. Provider availability конфигурационная; настоящие SMTP/providers/native/deploy не выполнялись.

[Полные legal тексты](../legal/README.md) и canonical UI JSON/hash/Markdown mirror. publication_ready=false: оператор/статус/контакт/страны ещё неизвестны, вопрос владельцу отправлен. Current API consent package bool/version/time не отдельное purpose evidence; новая QUB-LEGAL-001 до публичного запуска. Тексты не объявлены готовым compliance. Локальный installer dry-run не блокируется неизвестными реквизитами.

## Проверка и завершение

Local final full71browser scenarios:18desktop+19phone+23live fixtures+11real browser/FastAPI/disposable PostgreSQL. Core/legacy975+engineering11=986pass; final failed/skipped0. Python3.13.13/Node22.22.2/PG18.6/Chromium. Format/typecheck/live+demo builds passed. Screenshots light/dark/phone/desktop inspected после structural fixes и окончания RAF movement. Browser viewport/axe/loopback — не physical FPS/keyboard/screenreader/native/providers/SMTP/TLS ingress acceptance.

Implementationac2c8ef4e895ed690e5f545e0b5f8b82cb6b0950 pushed/origin verified. Exact-SHA web38451493363 completed/success19:03:38UTC,71pass; engineering38451493360 completed/success19:06:53UTC,986pass. Completion docs SHA отдельно от проверенного implementation. Base4239201de7c957f7b95a67cf316bc54fe7b7e636. Предыдущие UI-002 evidence сохранены в его отчёте: implementation2d0a8e02728cf281d0ec8d66108396b7ea88aec8, web38441106776/engineering38441107010 success.

## Git, данные и публикация

Existing external .antigravitycli/07eac59c-6b3f-4705-b06f-3fd77ff36ace.json deletion исключать из commits, не восстанавливать. Секретные env/DB/build/browser state вне Git; filled deploy/.env сохранён. Legacy/сервисные references/design-lab/ShadeAI/личная память/skills/subagents/quota reset не менялись. Архивные tournaments/qubite-v1.0 immutable96f0457a523b6b79f21c4092056d8fa8fa69a680, перепроверить origin при push.

Reuse existing [owner-private shell demo](https://qubite-app-shell-kirill.kuzmichevkonstantin9.chatgpt.site), project_id в ignored apps/web/.openai/hosting.json: appgprj_6ace5114ca9c8191adc1bd33365fc909. Owner/custom/один owner viewer/0groups проверены. Static.directory=dist: demo-mode build только в отдельной source copy, не публиковать live API-mode как demo. Формы demo не делают POST, не создают fake account/email, не сохраняют credentials. Старый material-lab остаётся неизменным. Публикация AUTH-007 — **version3/source9c0707a40dc3c504747d4543eab4a3c55e19fb76/deploymentappgdep_6ace8192efb08191ae7bb0ca82a71245 succeeded2026-10-13T19:08:19.269750+00:00**; owner/custom/один owner viewer/0groups повторно подтверждены. Artifact15files/686080bytes, только .openai/hosting.json+dist, noenv/core/test fixture. [Лендинг](https://qubite-app-shell-kirill.kuzmichevkonstantin9.chatgpt.site/#/welcome), [Auth](https://qubite-app-shell-kirill.kuzmichevkonstantin9.chatgpt.site/#/auth/login).69tasks16done/4ready/49backlog. Git push и static demo не устанавливают рабочий core/DB.

## Следующая задача

После завершения AUTH-007 — QUB-UI-003, настоящий server catalog и owner hidden/locked настройки перед AUTH-004 Console. Сначала новые вопросы владельцу, дождаться ответов; разрешение AUTH-007 не распространяется на следующий task. AUTH-013/DEPLOY-001/TG-001/CORE-002 остаются альтернативными ready tracks, не запускать всё параллельно. Сервер/VPS и production отложены. Native Web/Android/Linux desktop, затем Windows/macOS по отдельным POC.
