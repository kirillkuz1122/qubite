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
| [0008](0008-react-service-surfaces.md) | CONFIRMED 12.10.2026 | собственные VPN/Writing/Search и остальные included UI на React; Tournaments сохраняет Vanilla/Node/SQLite |

| [0009](0009-core-foundation.md) | Engineering decision в одобренной CORE-001 | independent factory/contract, explicit SQL migration, native disposable PG tests |
| [0010](0010-material-lab.md) | CONFIRMED scope / историческое исследование | пять отдельных живых React-концепций, static private demo, без runtime integration |
| [0011](0011-milo-live-controls.md) | CONFIRMED Milo/настройка/характеры; OPEN финальная физика | материал controls во всём интерфейсе, пять механик Milo, четыре scoped помощника |
