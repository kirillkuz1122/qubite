# Handoff — QUB-UI-002, 13.10.2026, review/testing

Владелец потребовал вернуть настоящий выбранный материал: UI-001 перенёс цвета/шрифты, но оставил физику до следующей задачи; это не удовлетворило владельца. Сделана UI-002 по прямому запросу, не новый дизайн. [Отчёт](../reports/QUB-UI-002.md), [ADR-0023](../architecture/decisions/0023-approved-flux-material-in-web.md), [карта готовых assets](../design/MATERIAL_PROVENANCE.md).

apps/web0.2.0: src/material выделен из assets/design-lab — scheduler/spring/buttons/slider/switch/tabs/navigation/morph и Ribbon SVG. Новый app не импортирует prototype Auth/демо runtime/legacy сервисы. Default100%/503мс, косметические prefs сохранены; OS reduce/quiet/0/lite/coarse pointer, native semantics/gesture cancel/no idle RAF. IA/Command/owner entry остаются согласованными; catalog visibility demo-preview до UI003, grants только core API и no owner bypass. Диалоги плавно открываются/закрываются, закрытие возвращает focus.

Local49browser:17desktop+18phone включая Chromium Input.dispatchTouchEvent+14live API fixtures, no failed/skipped; format/две сборки/axe/screenshots. Это не физическая приёмка телефона/FPS или full browser/core auth. Регрессия all965+engineering11=976pass, disposable PostgreSQL18.6/SQLite/source-copy без env/network; core groups27.37/50.90/88.85s. Core0.6.0/schema0007/legacy/design-lab не изменены. Exact-SHA CI/push/hosting ещё подтвердить в completion evidence.

## Следующая задача уже разрешена, ответы ожидаются

AUTH-007 прямо разрешена владельцем в том же сообщении: «это дорабатывай и следующую задачу тоже выполняй». Не запрашивать разрешение повторно. По постоянному правилу владельца вопросы перед каждой задачей обязательны; отправлены три, **ответов пока нет**, auth forms ещё не реализовывались:

1. Отдельный экран «Вход / Создать аккаунт» с обычной главной после входа или окно поверх главной? Предложен отдельный экран.
2. Подготовить черновики новых terms/privacy с явным требованием owner approval перед production или только место для документов? Старые legal в legacy и не подходят новому Qubite. API consent_version техническая, не готовые правовые тексты.
3. Приглашение из ссылки плюс ручная вставка ссылки/токена или только ссылка? Invite не вход; email/password и verification-first уже решены.

После ответов — AUTH-007 поверх existing FastAPI session/register/challenges/OAuth, использовать src/material. Важные реальные ограничения: mail transport только injected mock; неизвестный OAuth identity не создаёт аккаунт/не связывается по email; callback сейчас JSON API, browser completion потребует отдельного проверяемого fixed-route поведения без open redirect. SMTP/provider credentials/ChatGPT enable не объявлять существующими. Не применять legacy verifier. После AUTH007 новые задачи снова обсуждаются отдельно.

## Сохранность и публикация

Base4f3d113b5d7a76b817585181da0159e049cb5c25. Existing external .antigravitycli deletion исключить. Секретные env/DB/build/browser state вне Git; deploy/.env не изменён. ShadeAI/личная память/skills/subagents/quota reset не менялись.

Существующее [owner-private shell demo](https://qubite-app-shell-kirill.kuzmichevkonstantin9.chatgpt.site) обновить, не создавать другой site. Project из ignored apps/web/.openai/hosting.json appgprj_6ace5114ca9c8191adc1bd33365fc909; Sitesget_site подтвердил owner/custom/один owner viewer/0groups. Static.directory=dist: публикация требует demo-mode build в отдельной source copy, нельзя публиковать live dist как demo. Старый material-lab остаётся отдельной неизменной витриной. Push и demo publication не устанавливают production core/DB.
