**AI-00215.10.2026:** текущий [mock dispatcher](AI_DISPATCHER.md)/[ADR-0027](decisions/0027-mock-dispatcher-and-safe-retries.md), core0.9.0/0010. Базовый ledger AI-001 ниже сохранён; dispatcher имеет только internal mock hooks, без реальных paid effects. Ранее future dispatcher notes ниже заменяются этим контрактом, не означают public/job/tool/native paid admission.

**AI-00114.10.2026:** [реализованный mock accounting контракт](AI_BUDGETS.md) / [ADR-0026](decisions/0026-atomic-mock-budgets.md). USD/full caps/configurable timezone initially Asia/Yekaterinburg подтверждены. Core0.8.0/0009; generic paid gate закрыт до AI-002 dispatcher. Dispatch/revoke/lease/fallback ниже — target следующего slice, не реализованный worker.

# AI Cost Guard

CONFIRMED: server enforcement до внешнего вызова; owner не исключение, нет платных тестов без отдельного разрешения. RECOMMENDED: единый gateway с budget reservation для всех новых/адаптированных Search/Writer/Hermes/Brief/model/tool/jobs. Старые ledgers сохраняются, aggregate cost center сначала показывает их как отдельные источники, не выдаёт сумму за global enforcement.

## Алгоритм

1. Проверить active subject + module/action/resource, initiator∩agent∩tool scopes, exact provider/model/action allowlist. Validated payload, input bytes/tokens, max output, timeout/step budget. Missing/unknown price or budget → deny.
2. Worst-case reserve в integer micro-USD (ceil input/output/других charges по versioned price); FX только presentation, currency не смешивается. Цена из approved snapshot с expiry, а не универсальная константа master. Модель/контекст/провайдер с неизвестной upper bound не вызывается.
3. Transaction: lock все applicable budget buckets в стабильном порядке (user/module/model/project/global/period), проверить spent+reserved+estimate≤cap и requests/tokens quota. UNIQUE(subject,idempotency_key) с payload/model fingerprint. Записать reservation+invocation+outbox атомарно. Commit, только затем dispatcher вызывает провайдера.
4. Перед dispatch повторно проверить revoke/module/model, lease и pricing. При отмене до отправки release reserve; при отправке state=dispatched с durable provider request metadata. Provider auto-fallback запрещён, отдельный approved route/fallback тоже проходит reserve.
5. Success → append actual usage, settle ровно один раз, release остатка. Timeout/неизвестная доставка → unknown, reserve сохраняется, автоматического повтора нет. Cancel UI не значит free/refund. Webhook reconcile использует уникальный event/provider_request_id. Crash после отправки без результата не освобождает резерв по TTL.
6. Actual>estimate: записать всю реальную стоимость, freeze route/новые вызовы, alert; не обрезать бухгалтерию до cap. Hard cap гарантируется gate лишь при корректной upper bound/ограничении провайдера — этот риск проверяется, не скрывается.

Состояния: reserved→dispatched→settled либо reserved→released; dispatched→unknown→settled/reconciled. Повторный request возвращает существующий result/status; несовпадающий fingerprint → conflict. Смена календарного периода platform timezone не обнуляет unfinished reserve: он привязан к original buckets. AI spend и Finance personal ledger — разные домены с read-only reporting связью.

Postgres row lock выбран как candidate механизма, [официальное описание](https://www.postgresql.org/docs/current/explicit-locking.html). Не держать lock во время сети. Worker делает lease, quota запросов резервируется вместе с деньгами; transaction retry bounded, без provider retry.

## Mock acceptance

100 конкурентных запросов в двух процессах при cap=1 и estimate=0.6 → ровно один dispatched; spent+reserved≤1. Owner cap=0, no entitlement/model/provider/price, public guest, plugin escalation → 0 paid calls. Повтор idempotency и double settle не удваивают ledger. Crash до dispatch/после dispatch, partial usage, grant revoked, period change, poisoned price, quota race, fallback mismatch покрываются отдельно. Настоящий provider разрешается только после mock suite и price/cost acceptance владельца.
