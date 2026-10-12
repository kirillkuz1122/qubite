# ADR-0002: owner и независимые права

CONFIRMED пользовательским access document: owner normal home + separate console; tournament roles scoped; default deny; manual grants/no subscriptions; все paid вызовы server gate, owner self budget обязателен. Разделение целей уже согласовано, детали реализации RECOMMENDED.

Механика: verified singleton platform owner, module entitlements, resource ACL, model/action allowlist и atomic reservations. Объединение старых organizer/admin с platform capabilities отвергнуто: противоречит явному продуктовому решению. UI-only enforcement отвергнуто: прямой API/MCP/job bypass.

Последствия: legacy owner auto-paid поведение services/writing/search не переносится; explicit self grants, audit, revocation/version checks. Old Auth/role хранить до проверенного scope adapter, не менять всем аккаунтам roles из одной migration. Approval tech details через AUTH task specs.
