**AI-002, 15.10.2026 — done:** core 0.9.0/schema0010_dispatcher; подтверждены максимум 3 попытки только при доказанной неотправке, задержки 1/2 с, настраиваемые 60 с, ручной выбор другой модели. [Контракт](../architecture/AI_DISPATCHER.md), [ADR-0027](../architecture/decisions/0027-mock-dispatcher-and-safe-retries.md), [отчёт](../reports/QUB-AI-002.md). На реализации `f84f81b` обе CI completed/success: engineering38669028602 — 1114, web38669028756 — 86, всего 1200 проверок. Внутренняя mock-библиотека; реальные провайдеры, публичные платные операции и startup worker закрыты. Далее AUTH-004 с новыми вопросами. Старые snapshots ниже исторические.

**AI-00114.10.2026 — done:** core0.8.0/schema0009_budgets, owner answers USD/full caps/configurable Екатеринбург timezone. [Контракт](../architecture/AI_BUDGETS.md), [ADR-0026](../architecture/decisions/0026-atomic-mock-budgets.md), [отчёт](../reports/QUB-AI-001.md). Final1155local+CI: budgets61/regression1069/browser86; code4c243a7, engineering38565394275 и web38565393551 exact-SHA completed/success. Internal mock ledger, generic paid effects closed; AI-002 dispatcher затем AUTH-004, новые вопросы перед каждым. Старые snapshots ниже исторические.

# Журнал завершения задач Qubite

Актуальные статусы и evidence — в [tasks.json](../plan/tasks.json), [handoff](LAST_HANDOFF.md) и датированных отчётах. Этот журнал фиксирует результат bounded cycle; source tests не означают приёмку устройства или рабочий deployment.

## 14.10.2026 — QUB-UI-003, done

Server catalog/shared hidden-vs-locked, default locked и upcoming/disabled labels после read grant. Core0.7.0/schema0008 additive metadata, apps/web0.4.0 с existing Flux и guarded explicit owner save. Installation/grants/AI untouched. 86browser/1008regression local+CI, final9771158 with per-row draft retention, exact-SHA web38505000027/engineering38505000011 success, private demo v5 succeeded. Evidence — [отчёт](../reports/QUB-UI-003.md).

## 14.10.2026 — QUB-AUTH-007, done

apps/web0.3.0: публичный лендинг, отдельный Qubite Auth, регистрация/invite/verify/reset и безопасность профиля поверх FastAPI. Существующий живой Поток используется без смены дизайна. Browser OAuth fixed303 completion, JSON API сохранён. Новые четыре legal текста; сведения оператора/страны перед public launch в QUB-LEGAL-001. 71browser/986regression local+CI; implementationac2c8ef, exact-SHA web38451493363/engineering38451493360 success; private demo version3 succeeded. Git/hosting evidence — [отчёт](../reports/QUB-AUTH-007.md).

## 13.10.2026 — QUB-UI-002

Выбранные живые controls/physics/SVG перенесены из assets в apps/web0.2.0. Flow503мс, bounded viscous drag, native sliders/drag switches, scene/dialog transitions, lite/quiet/strength/duration prefs. [Отчёт](../reports/QUB-UI-002.md).49browser/976regression; implementation2d0a8e0, exact-SHA web38441106776/engineering38441107010 success, private demo version2 succeeded. Историческое состояние до AUTH-007: задача была разрешена, затем ответы получены и реализован следующий slice.

## 13.10.2026 — QUB-UI-001

Первая React shell в apps/web, live read identity/access и separate fictional demo; Command fixed bottom, owner entry Settings. Hidden/locked owner UI preview, server persistence UI003 новая зависимость полной Console. Локально36browser+976regression; real device/full login ещё отдельно. [Отчёт](../reports/QUB-UI-001.md); Implementation23b6119, exact-SHA CI38424077786/38424077501 success. Private demo v1 succeeded; Git/hosting evidence в отчёте. Next AUTH007, сначала вопросы.

## 13.10.2026 — QUB-REPO-001

Перенос старого сайта/deploy/HTML/учебных материалов и Flutter VPN в legacy; standalone optional Tournaments без нового SSO; оставшиеся сервисы маркированы reference. Корневые инструкции описывают универсальную платформу. Filled deploy env сохранён, root env новый пустой, предыдущий root env сохранён приватно. Добавлены discovery задач сервисов и будущие installer/operator требования. Задача done: local+CI976 pass; implementation66c7b46, CI38401965245 completed/success 2026-10-13T13:08:52Z. Подробности — [полный отчёт](../reports/QUB-REPO-001.md). Реальный installer/deploy и новый UI не исполнялись.

## Предыдущие задачи

AUTH-006: owner-controlled registration API, core0.6.0/0007, [отчёт](../reports/QUB-AUTH-006.md). AUTH-005: email/password boundary, [отчёт](../reports/QUB-AUTH-005.md). Другие завершённые implementation slices и их exact-SHA CI сохранены в registry и [каталоге отчётов](../reports/); не заменять их evidence результатами текущего переноса.
