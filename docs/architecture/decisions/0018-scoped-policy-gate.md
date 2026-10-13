# ADR-0018 — Раздельные grants и общий scoped policy gate

Дата13.10.2026. CONFIRMED продуктовые ответы / инженерная реализация в явно порученной QUB-AUTH-003. Владелец после обсуждения списка56задач сказал выполнить эту задачу, затем ответил: до ручных разрешений только аккаунт; read/write/manage раздельны. Дополнительно подтвердил процесс: **перед каждой следующей задачей сначала вопросы, затем ответы и реализация**. Это не approval всей платформы/деплоя и не отмена согласования AI/UI/registration.

## Решение

Новое core PostgreSQL хранит policy отдельно от identity. Gate использует authenticated session и проверяет installed/enabled module, точный module/action grant, workspace membership, exact resource/workspace/module и ACL. Owner управляет metadata через отдельный owner API с own-password recent reauth; owner/workspace owner/tournament roles не получают implicit content/AI grants. Action permissions не наследуются между read/write/manage, явный deny/default absence/expiry запрещают. AI требует точного provider/model allow, но исполнение заблокировано до atomic budget dispatcher AI-001/002.

Все REST effects и server-internal job/tool/WS adapters используют общий PolicyStore и live recheck. Короткая internal capability имеет один Target/channel, originating session и версии; при любой policy mutation становится непригодной. Никаких self-reported actor/role/budget/token scopes. Stateful PG revision + shared/exclusive transaction locks делают revoke линейным относительно guarded DB effects. Owner commands используют If-Match/idempotency/audit в одной транзакции. Scope AUTH-003: primitives и read-only WS probe, не production content API/UI/worker.

## Альтернативы и последствия

Глобальные роли/owner bypass и UI-only проверки отвергнуты исходным access document. Один «доступ ко всему модулю» отвергнут явным ответом владельца. Per-object ACL без module/workspace intersection создавал бы обход default deny. Долгие JWT с положительно кешируемым allow не подходят immediate revoke.

Global policy epoch/exclusive admin writer выбран для первого bounded slice: надёжный простой порядок locks, все старые delegated contexts требуют повторного issuance даже после несвязанной mutation. Масштабирование до per-subject/resource epochs и настоящих persistent jobs — будущая оптимизация с сохранением negative matrix. Все21таблицы core только additive; никто не мигрирует legacy accounts. Full domain registry/installer, sharing, Console UI, SMTP/native/keys/introspection, provider budget reserve и production rollout остаются отдельными карточками. [Полный контракт/ограничения](../POLICY_GATE.md).
