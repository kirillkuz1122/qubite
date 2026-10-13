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
| [0012](0012-flux-design-system.md) | CONFIRMED Поток/Игрушечная/Лента/Unbounded/Manrope | мобильная витрина компонентов, пять палитр и семейств знаков, независимая типографика, сценарии появления помощников |
| [0013](0013-fresh-identity-and-unified-login.md) | CONFIRMED fresh identity 13.10.2026 / engineering protocol | новый единый FastAPI/Postgres Auth, явный local owner bootstrap, без импорта/bridge legacy аккаунтов |
| [0014](0014-fresh-accounts-and-owner-bootstrap.md) | Engineering decision в approved AUTH-002 | explicit fresh schema, canonical email, active singleton FK, local transactional bootstrap и readonly schema gates |
| [0015](0015-web-password-sessions.md) | Engineering decision в approved AUTH-009 | Argon2id, одноразовый preauth/CSRF, PG sessions/rates/reauth, partial runtime contract и explicit local password setup |
| [0016](0016-explicit-oauth-identities.md) | Engineering decision в approved AUTH-010 | явная stable provider identity, own-password linking, disabled/network-off default, browser state/PKCE/version gates, forward0004 |
| [0017](0017-email-challenges-and-recovery.md) | Engineering decision в approved AUTH-011 | hash-only one-use verify/reset, existing UUID/verified recovery, atomic version+revoke, mock-only mail; email-2FA contract отдельно от runtime |
| [0018](0018-scoped-policy-gate.md) | CONFIRMED ответы AUTH-003 / инженерная реализация | manual independent grants, exact resource gate REST/job/tool/WS, owner no paid bypass |
| [0019](0019-account-login-boundary.md) | CONFIRMED границы AUTH-005 / проверяемый контракт | существующий email/password без account code-entry, отдельные tournament/email/OAuth протоколы |
| [0020](0020-owner-controlled-registration.md) | CONFIRMED AUTH-006 answers / bounded engineering | owner enrollment modes, both invites, verification-first login, atomic consent/redemption |

| [0021](0021-repository-layout-and-standalone-tournaments.md) | CONFIRMED13.10.2026 | Чистый новый корень, legacy/reference классификация, поддомены, independent optional турниры и env preservation |
