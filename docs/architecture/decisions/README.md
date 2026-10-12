# Журнал архитектурных решений

Правило: CONFIRMED — явное решение владельца, RECOMMENDED — инженерное предложение, OPEN QUESTION — выбор не сделан. Документирование рекомендации не разрешает её реализацию. Approval записывается с датой и основанием; альтернативы/обратимость сохраняются.

| ADR | Статус | Решение |
|---|---|---|
| [0001](0001-migration-and-stack.md) | CONFIRMED стек | FastAPI/React/Postgres alongside legacy, SQLite турниров |
| [0002](0002-owner-and-access.md) | CONFIRMED для продукта / RECOMMENDED механика | single owner, scoped roles, default deny, budgets |
| [0003](0003-development-and-release.md) | CONFIRMED git / RECOMMENDED release gates | main, archive immutable, isolated task cycle, deploy separately |
| [0004](0004-local-first-and-privacy.md) | CONFIRMED принцип / OPEN QUESTION детали | local-first, history и private vault recovery |
| [0005](0005-identity-transition.md) | Обновлено владельцем 12.10.2026 | FastAPI Auth, временная legacy compatibility, новая UI/регистрация |
| [0006](0006-clients-and-deployment.md) | CONFIRMED scope / POC механизм | web/Android/Linux desktop, portable clients, deploy + installer |
| [0007](0007-platform-extraction-and-capture.md) | CONFIRMED 12.10.2026 | нужные shared функции FastAPI, optional legacy Tournaments, automatic capture/support/notifications |
