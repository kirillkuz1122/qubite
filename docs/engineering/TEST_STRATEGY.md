# Тестовая стратегия

Baseline 12.10.2026: existing 65 Node tests и 18 deploy unittest прошли вне filesystem/socket sandbox; подробный итог изолированного harness см. [отчёт](../reports/QUB-001.md). npm test пока не агрегирует suites. Новые tests — catalog + grading characterization; полный tournament HTTP/E2E пока не готов.

## Пирамида и release gates

| Уровень | Scope | Команда/цель |
|---|---|---|
| Docs/tasks harness | schema/states/dependency cycles/approved ready/done evidence | python3 scripts/engineering/check.py; unittest tests/engineering |
| Legacy unit/domain | security/task-runtime/catalog/schema, grants/usage/keys | verify.py --suite node |
| Service contract/integration | auth/native enrollment/revoke, Search fetch/auth/ledger, Brief outbox/AI mocks, Kwork hooks, managers | verify.py --suite all --python <test-venv-python> |
| Новое Core integration | actual API + disposable Postgres migrations + concurrent locks + fake provider | отдельные test commands появятся после реализации core; два процесса для budget race |
| UI/E2E | owner/nonowner/denied direct URL, capture/offline/two-device/restore, legacy tournaments | Playwright fixtures + isolated HTTP, screenshot/viewports; команды создаются QUB-TEST-002/QUB-UI-001 |
| Hardware/performance | Android pen, crash/autosave/PDF/frame pacing; Pi simultaneous load | реальные устройство/нагрузка; fake device не закрывает acceptance |
| Ops | backup/restore/schema rollout/canary/rollback | disposable restore + read-only checks, production отдельно |

Critical legacy scenarios: register/login/logout/revoke/email/password reset/OAuth state and PKCE, blocked user; end catalog + hidden roster/code; individual/team join + deadline + late join; submission/grading/drafts/penalty + authoritative totals; rating history/no duplicate bonus/decay; services owner protection/revoke/budgets/key scopes; native API bindings; one bot; unknown sends paused.

Paid security: все access policy 10 cases, owner no budget, forged role/header, cross workspace/team/private graph/search/cache, public guests, MCP/plugin/WS/background bypass, 100 requests/two workers, period rollover/double settle/unknown delivery/revoke while job. Provider mock counter 0 при отказе. No real AI/TG/HA/Kwork endpoints в CI.

CI на push/PR только tests, без deployment credentials. Python dependency lock сохраняет воспроизводимость; Node npm ci использует существующий lock. Если required suite failed/missing dependencies/timeout — gate красный, не skip green. UI/typecheck/lint появятся с соответствующим кодом и будут required для его задач; сейчас не выдумывать команды для несуществующего React.

Тесты отдельных модулей проверяют helpers/router fixtures; passing suite не доказывает full server.js integration. Coverage измерять по risk/requirements, не строкам. Нет нового теста ради mirror implementation; нужны regression boundaries и failure cases. Формат evidence: command/runtime/date/fixture scope/counts/result/limitations. При ошибке среды отдельный bounded retry с той же изоляцией, не менять dependencies из-за необъяснённого hang.
