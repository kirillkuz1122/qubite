# QUB-UI-002 — возвращён утверждённый Поток

13.10.2026. Исправление соответствия дизайну по прямому запросу владельца: UI-001 использовал утверждённые цвета/шрифты, но оставил настоящую физику материала на следующий slice. Владелец потребовал перенести готовые assets сейчас. [ADR-0023](../architecture/decisions/0023-approved-flux-material-in-web.md), [происхождение](../design/MATERIAL_PROVENANCE.md).

## Изменения

apps/web0.2.0: перенесены scheduler/spring/bounded drag, ползунки, switches, flowing tabs/navigation и scene morph из витрины. Сохранены профиль Потока и выбранная Toy/Лента/Unbounded/Manrope. Service marks также из готовых SVG, без загрузки старого сервиса. Ссылки/действия реагируют на касание, удержание, тягу, hover/focus и плавно собираются обратно. Навигация перетекает503мс при тапе, ретаргет из текущего положения при быстрой смене; новые независимые CSS checkbox/thumb не используются. Owner preview hidden/locked теперь через тот же LivingTabs.

Настройки силы0–100/длительности250–900мс/quiet/lite сохраняются с dark в существующем cosmetic localStorage.100%/503мс — defaults; OS reduce/quiet/сила0 останавливают анимации; coarse pointer по умолчанию lite. Упрощённый свет/края сохраняют движение; RAF общий только для активных контролов, нет perpetual idle loop или React state per-frame. Range значение остаётся нативным и точным, keyboard работает. Pointer ownership и cancel защищают от постороннего пальца/случайного click/submit; release в тот же пункт также собирает material. Dialog open/close анимирован, Escape/focus trap/return focus сохранены. Snapshot формы очищается до хранения, ghost inert/aria-hidden.

Витрина остаётся неизменной. Core0.6.0/SQL/контракты/legacy/env/данные/инфраструктура не меняются. Demo роли и временные записи не попадают в live, owner не read/AI bypass. Регистрация/auth forms не объявляются выполненными; следующая AUTH-007 разрешена владельцем, три вопроса отправлены, требуются ответы перед реализацией.

## Проверки

TS/live+demo builds/format; Playwright49:17desktop+18phone (включая Input.dispatchTouchEvent)+14live API fixtures. Pointer/keyboard/cancel, native range/switch, bounded drag no click, перетекание mid-flight и возврат, cosmetic persistence, idle0RAF, dynamic reduced motion, exact server grants/revoke/stale response. Axe обе темы/main/catalog/profile/owner/dialog;360–1440px/landscape/reflow/keyboard signal. Скриншоты desktop/phone/settings просмотрены визуально. Это эмуляция Chromium, не измерение FPS/клавиатуры на физическом устройстве.

Полный harness all965 + engineering11 =976pass, source-copy без env/external network, disposable PostgreSQL18.6/SQLite. Core groups208/165/202:27.37/50.90/88.85s. Python3.13.13/Node22.22.2/system Chromium. Первые browser runs выявили временный выход нового слоя за экран и axe во время fade; clip исправлен, axe ждёт subtree animations. Финальные проверки/CI и публикация фиксируются после завершения; не выдавать попытки с ошибками за приёмку.

## Git и демо

Base4f3d113b5d7a76b817585181da0159e049cb5c25. Постороннее удаление .antigravitycli не включать. Push не deploy; существующее owner-private shell demo обновить после сохранения source, старый material-lab не заменять. Exact-SHA web/engineering CI, remote archive refs и deployment status фиксируются в completion evidence. Физическая приёмка/ответы AUTH-007 ещё открыты.
