# QUB-UI-001 — первая оболочка приложения

13.10.2026. Согласован один bounded task, вопросы/ответы до реализации: состав навигации, закреплённый Command/Lite, owner per-module hidden/locked. [ADR-0022](../architecture/decisions/0022-web-shell-and-command.md). Base main7da65e0edc5f9aecd0bc3de1f3e5c220be0bbd00. Implementation Git/CI evidence дополняется после push, task пока review/testing.

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
