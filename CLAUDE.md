# Claude — Qubite 2.0

Всегда русский. Сначала полностью читать [AGENTS.md](AGENTS.md), [handoff](docs/project/LAST_HANDOFF.md), [проектный контекст](docs/project/PROJECT_CONTEXT.md), исходные QUBITE документы и текущие задачи/ADR. Перед каждой новой задачей вопросы владельцу и ответы.

Новый проект — FastAPI/PostgreSQL core и React/TypeScript UI. Legacy сайт/deploy/VPN отдельно, оставшиеся старые сервисы reference. Tournaments — standalone optional со своим Auth, без нового SSO; модули на поддоменах. [Актуальная структура](docs/architecture/REPOSITORY_LAYOUT.md), [ADR-0021](docs/architecture/decisions/0021-repository-layout-and-standalone-tournaments.md).

Данные/секреты не коммитить; заполненный deploy/.env сохранять, новый корневой .env не источник старых секретов. Owner CLI и tests — core/README.md. Один task → checks/tests → docs/evidence → русский commit → сразу push main. Архив immutable, push не deploy. Skills/subagents/quota reset не применять; ShadeAI read-only. Факты кода, planned API, mocks и live/device acceptance всегда различать.

UI-001: apps/web partial shell0.1.0; compile-time live/demo отдельные, no live fake writes. Command fixed bottom; settings-only owner entry. UI-003 server visibility перед AUTH-004, следующая AUTH-007 auth forms; вопросы до нового task. Оба engineering/web CI exact SHA; source fixtures не физическая приёмка. [ADR-0022](docs/architecture/decisions/0022-web-shell-and-command.md).

UI-00213.10.2026: apps/web0.2.0 использует готовую физику/controls/SVG выбранного Потока из src/material; [provenance](docs/design/MATERIAL_PROVENANCE.md), [ADR-0023](docs/architecture/decisions/0023-approved-flux-material-in-web.md). Следующая AUTH-007 прямо разрешена в том же сообщении, вопросы по экрану/черновикам legal/ссылкам invite отправлены; дождаться ответов перед её реализацией. Не спрашивать разрешение на следующую повторно, но ответы на открытые решения нужны.
