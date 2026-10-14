# QUB-AI-001 — atomic mock budgets, 14.10.2026

Статус: **done в согласованных mock-only границах**. Implementation `4c243a7a87b145ba01dd10595c0bcbdc23112633` сохранён и отправлен origin main; completion docs отдельно.

Ответы владельца получены до реализации: USD; полный набор caps; настраиваемый timezone, сначала Екатеринбург. [ADR-0026](../architecture/decisions/0026-atomic-mock-budgets.md), [реализуемый контракт](../architecture/AI_BUDGETS.md). Разрешён только AI-001; следующий task требует новых вопросов.

Core0.8.0/schema0009_budgets: additive12tables, integer money/request/token accounts с day/month/all и пятью scopes. Owner guarded internal hooks, approved immutable mock prices, live permissions, atomic reservation+allocations+outbox, exact usage settlement, unknown retention и route freeze при actual over bound. Настройки/timezone не обнуляют расход. Нет public AI endpoints/real provider/dispatcher/Console budget UX. Existing generic paid gate закрыт; AI-002 dispatcher и AUTH-004 UI отдельно. Документы и тесты различают бухгалтерский dispatched marker и сетевую отправку.

Base1aaddb2deb6c032be7b5dfa87264a4a8c205ccc2/main. Archive origin/tournaments и qubite-v1.0 проверены на96f0457a523b6b79f21c4092056d8fa8fa69a680. Чужое удаление .antigravitycli/07eac59c-6b3f-4705-b06f-3fd77ff36ace.json исключено. Legacy/секреты/заполненный env/постоянные данные/ShadeAI/skills/subagents/личная память/quota reset не менялись. Push не deploy; private static preview менять не требуется: UI не изменяется.

## Evidence

- Targeted budgets61 passed48.79s; final full regression all1058+harness11=1069pass. Core groups208/175/202/22/61 in29.78/57.44/82.65/8.88/46.11s. No failed/skipped final. Integer validation/ceil/DST/calendar входит в61. Local log /tmp/qubite-budget-regression.log. Local browser86pass1.2m (18desktop+19phone+33HTTP fixtures+16real core), format/build/build:demo passed. Total1155local; engineering38565394275 completed/success12:46:37UTC1069pass; web38565393551 completed/success12:41:15UTC86pass; оба exact-SHA4c243a7a87b145ba01dd10595c0bcbdc23112633.
- Первая попытка escalated запуска disposable PG не выполнилась: automatic approval review403; повтор после сбоя принят; disposable тесты прошли. Это сбой review service, не решение о небезопасности тестов.
- Первичный budgets прогон59pass/2fail: negative test helper запрашивал CSRF после блокировки аккаунта/удаления таблицы; исправлен prefetch до fault injection, final61pass. Первичный local browser launcher использовал неправильное имя env path, исправлено на QUBITE_WEB_CHROMIUM; final86pass1.2m.
- CI budgets61 passed73.49s, core208/175/202/22 in58.29/102.09/144.28/15.65s, unchanged timeout180; web86passed1.5m. Complete logs /tmp/qubite-budget-ci-engineering.log и /tmp/qubite-budget-ci-web.log. Watcher connection reset не был CI failure: оба completed-success подтверждены прямым run view.
- Фактические concurrency/ledger tests прошли; source-copy tests не production/account/provider/device acceptance.

Rollback/recovery: предыдущие migrations не переписаны, старый core после0009 отказывает; preserve new accounting, forward fix без down/drop/reset. Реальная migration и реальные AI расходы этим заданием не разрешены.

## Следующий цикл

AI-002 — guarded mock dispatcher: повторная проверка grant/revoke/price перед отправкой, lease/crash/unknown delivery и fallback. Сначала новые вопросы и ответы; эта задача автоматически не разрешена. Далее AUTH-004 — полный Console users/grants/budgets. Тестовые price/grants/caps не являются production настройками; настоящий AI/SMTP/native/installer/поддомены/сервер отдельно.
