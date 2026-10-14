# ADR-0026 — точный учёт и резервирование AI-бюджетов

14.10.2026. CONFIRMED: перед AI-001 заданы три вопроса; владелец выбрал USD, полный набор ограничений и настраиваемый часовой пояс, первоначально Екатеринбург. Разрешён один bounded task AI-001; AI-002/Console/real providers требуют своих вопросов.

## Решение

- Деньги — integer micro-USD: 1 USD = 1 000 000 единиц. Не float и не смешивание валют; рублёвое отображение/FX отдельно.
- Независимые пределы денег, запросов, токенов за день, месяц и всё время. Пересечение применимых global/user/module/project/exact provider+model; установка нового лимита не сбрасывает уже учтённые суммы. Global и personal all-time денежные caps обязательны; отсутствующий/нулевой блокирует запрос, включая owner. Дополнительные ограничения включаются явной owner-командой; null отдельной размерности означает, что её не ограничили.
- Для каждого вызова ledger ведётся по всем scope/period, даже если конкретный дополнительный предел ещё не задан. Поэтому последующее включение лимита учитывает прежний расход.
- UTC хранит моменты; календарные границы вычисляются в IANA platform timezone. Текущие buckets сохраняют прежние границы при смене зоны. Следующий начинается после окончания предыдущего, без пересечения; смена зоны не создаёт второй текущий день/месяц. All-time никогда не сбрасывается. Старый незавершённый резерв дополнительно уменьшает свободный лимит следующего периода до reconciliation.
- PostgreSQL transaction locks, stable order, idempotency payload fingerprint, reservation+allocations+outbox в одном commit. Provider/model exact grants и resource ACL проверяются live в той же транзакции. Утверждённая неизменяемая mock price snapshot с expiry и конечной верхней границей; неизвестная цена блокирует.
- Финальный usage записывается полностью, остаток возвращается. Timeout/unknown не освобождается по TTL. Actual выше оценки стоимости или token bound → вся стоимость остаётся в ledger, exact route замораживается. Новый price ID не обходит freeze.
- Проект — явный policy resource модуля projects, а не произвольный UUID клиента/workspace alias. Связь ресурса с проектом owner-managed, только внутри одного workspace; она влияет на учёт, не даёт доступ к данным проекта. Это accounting metadata, не готовый Projects engine.

## Границы и альтернативы

Существующие REST/job/tool/WS paid effects остаются закрыты. AI-001 содержит внутренние authenticated owner hooks и trusted mock ledger events, без HTTP spend/webhook/provider endpoint, без worker/lease/network. Record-dispatched — отметка тестового учёта, не разрешение выполнить платный вызов. AI-002 добавляет guarded mock dispatcher/revoke/crash acceptance; AUTH-004 — полноценную Console и HTTP budget controls. Price approval hooks принимают только provider=mock. Личные ChatGPT квоты/финансирование — AI-003, без предполагаемых интеграций.

UTC-only periods отклонены ответом владельца; float отклонён из-за округления; удаление ledger при смене лимита/зоны отклонено из-за потери учёта. Любая миграция постоянной БД — отдельная backup/restore/staging процедура. 0009 additive; прежние0001..0008 сохраняются. После0009 старый core не получает writable доступ; recovery forward, не DROP/down и не возврат legacy authority.

[Контракт](../AI_BUDGETS.md), [Cost Guard](../AI_COST_GUARD.md), [отчёт](../../reports/QUB-AI-001.md).
