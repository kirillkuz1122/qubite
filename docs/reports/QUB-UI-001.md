# QUB-UI-001 — первая оболочка приложения

13.10.2026. Согласован один bounded task, вопросы/ответы до реализации: состав навигации, закреплённый Command/Lite, owner per-module hidden/locked. [ADR-0022](../architecture/decisions/0022-web-shell-and-command.md). Base main7da65e0edc5f9aecd0bc3de1f3e5c220be0bbd00. Задача done в указанных ниже границах; implementation и оба exact-SHA CI подтверждены.

## Реализовано

Новый независимый apps/web0.1.0, React19.3.0/TypeScript5.9.3/Vite8.3.4, exact npm lock. Принятый Поток/Игрушечная/Лента/Unbounded/Manrope. Непрозрачный пластик, orange action/blue selection/yellow thought/green enabled; светлая/тёмная тема, quiet и OS reduced motion. Без фонового animation RAF, filters или тяжёлых canvas. Начальные motion503ms; финальная физика Потока — UI-002, не объявлена перенесённой целиком.

Главная, каталог, входящие, профиль/свои permissions, настройки; desktop sidebar и mobile bottom navigation. Владелец использует обычную главную; управление только из Settings. Direct hash URLs: denied для закрытых разделов/owner nonowner, missing для hidden/unknown, unavailable для granted будущего модуля. Tournaments и старые handlers не встроены.

Qubite Command закреплён внизу, Lite — компактный вид. Safe-area/измеренная высота/VisualViewport; keyboard signal поднимает panel и скрывает mobile nav. На телефоне input16px против focus zoom. Семантические inputs/checkbox/select/dialog, skip link/heading focus/modal trap/escape/return focus; длинный текст экранирует React.

Live dist получает только GET existing me+me/access с same-origin cookies/no-store, строгими DTO, expiry и независимыми actions. Owner не read bypass. Refresh on focus/online/visibility/60s: stale identity удаляется, old requests abort+generation discard. Ошибки401/403→anonymous, network/429/503/malformed→unavailable без backend error leakage. Нет имитации sync/save или HTTP mutations.

Demo dist-demo компилируется отдельно: вымышленные owner/member/new, ephemeral Command text→inbox в памяти, явные подписи. Смена demo аккаунта/перезагрузка удаляет demo текст; только косметические dark/quiet живут localStorage. Микрофон/voice/AI/providers/API не вызываются. Query/localStorage не включают demo actor в live.

Owner интерфейс per-module hidden/locked **preview только в демо**; не серверная настройка или выдача прав. Для настоящего filtered catalog/persistence/CSRF/reauth/audit/concurrency добавлена UI-003, зависимость AUTH-004. До её реализации ungranted live catalog default hidden. Следующая AUTH-007 forms, далее остальные задачи после своих вопросов.

## Проверки и границы

Локально: TS+live/demo build; Playwright36 (11desktop+11emulated phone+14live API fixtures), axe light/dark/home/catalog/profile/owner/dialog. Viewports360×740/390×844/768×1024/1280×900/1440×1000 и landscape844×390; нет horizontal overflow или Command/nav overlap, footer reachable. Direct URLs, hidden vs locked, owner denial, expired/read-vs-write, forged local actor, bad DTO/status, revoked session и late async response. VisualViewport keyboard test synthetic; узкий viewport проверяет reflow, не реальный browser zoom200%. Real physical keyboard/phone/screen reader и full browser/core login acceptance ещё отдельно. Локальные screenshots визуально просмотрены, не evidence устройства.

Регрессия: all965 + engineering11 =976pass, real disposable PostgreSQL18.6/SQLite/source copy без env/внешних API. Core groups208/165/202 за52.44/105.52/160.47s; Node22.22.2/Python3.13.13. Core/legacy/runtime/design-lab не изменены. Browser fixtures36 не смешивать с real PG976; суммарно1012 локальных проверок. Один известный upstream Starlette deprecation warning, без failed/skipped.

Первый UI test run26pass/8fail выявил focus trap; остальные ошибки locator/scroll target/axe during incoming fade исправлены. После исправлений34pass, после mobile refinements и keyboard test финальный36pass; не считать неуспешные попытки успешной приёмкой. Ошибки выбора cwd/font imports устранены до successful builds. Временный403 сервиса automatic review один раз не позволил начать browser run; повторный запуск после «продолжай» был одобрен и выполнен.

## Сохранность и выпуск

.env, core SQL/contracts, legacy code, design-lab и ShadeAI не изменены. Постороннее удаление .antigravitycli JSON не включать в commit. Archive refs immutable96f0457a523b6b79f21c4092056d8fa8fa69a680; remote verification записывается ниже. CIweb.yml отдельно от engineering.yml; оба обязаны пройти на implementation exactSHA. No system service install/restart/migrations/account bootstrap, real provider calls или production Qubite deploy.

Демо для владельца публикуется отдельно с вымышленными данными; старую material-lab витрину не заменять. URL/version/deployment подтверждать только по successful status. Следующую задачу не начинать автоматически.

## Подтверждённый Git/CI и демо

Implementation **23b61190de2795060c08fa8b7f5e9a29bffafae4**, pushed main/origin verified. [Web CI38424077786](https://github.com/kirillkuz1122/qubite/actions/runs/38424077786) completed/success **2026-10-13T15:41:42Z**: independent npm ci32 packages, format/две сборки, Chromium Playwright36 за31.7s. [Core/legacy CI38424077501](https://github.com/kirillkuz1122/qubite/actions/runs/38424077501) completed/success **15:45:58Z**, all965+engineering11, PostgreSQL16/Python3.14.8. CI суммарно1012checks; failure-only trace upload step skipped по условию, тесты не skipped. Docs completion отдельным commit после evidence, его SHA не заменяет implementation proof.

[Приватное демо оболочки](https://qubite-app-shell-kirill.kuzmichevkonstantin9.chatgpt.site) — Sites version1, deployment **appgdep_6ace5ec036b08191a22eafc8daf7399a succeeded**. Project appgprj_6ace5114ca9c8191adc1bd33365fc909: current user owner, custom access, один allowed owner viewer,0groups. Источник publication **f28554425ee5bd4278a6827d632ddb2899bb9bc6** — только apps/web source из implementation и hosting metadata, без core/legacy/env. Static archive13files/583680bytes; demo mode собран в поддерживаемый Sites каталог dist в отдельной /tmp копии. Локальные product dist/live и dist-demo/demo не смешаны; .openai metadata ignored. Старый material-lab site не заменён. Адрес successful publication не означает запуск рабочего Qubite API или физическую приёмку пользователя.

Первая автоматическая проверка source push отклонена из-за неподтверждённого конкретного destination; ownership/access проверены через Sites get_site (owner only), после этого повторное согласование разрешило push. Токен только в памяти и getpass, не в файлах/коммитах/выводе. Invalid archive directory dist-demo исправлен на поддерживаемый dist в publication copy перед успешным save/deploy; прежние failed попытки не считать публикацией. Token уничтожен в памяти после push. Ни user browser authentication, ни обход private audience не выполнялись.

Remote immutable archive branch/tag повторно проверены на96f0457a523b6b79f21c4092056d8fa8fa69a680. 68tasks:14done/4ready/50backlog. AUTH-007 следующий цикл **только после новых вопросов/ответов владельца**.
