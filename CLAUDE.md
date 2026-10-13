# Claude — Qubite 2.0

Всегда русский. Сначала полностью читать [AGENTS.md](AGENTS.md), [handoff](docs/project/LAST_HANDOFF.md), [проектный контекст](docs/project/PROJECT_CONTEXT.md), исходные QUBITE документы и текущие задачи/ADR. Перед каждой новой задачей вопросы владельцу и ответы.

Новый проект — FastAPI/PostgreSQL core и React/TypeScript UI. Legacy сайт/deploy/VPN отдельно, оставшиеся старые сервисы reference. Tournaments — standalone optional со своим Auth, без нового SSO; модули на поддоменах. [Актуальная структура](docs/architecture/REPOSITORY_LAYOUT.md), [ADR-0021](docs/architecture/decisions/0021-repository-layout-and-standalone-tournaments.md).

Данные/секреты не коммитить; заполненный deploy/.env сохранять, новый корневой .env не источник старых секретов. Owner CLI и tests — core/README.md. Один task → checks/tests → docs/evidence → русский commit → сразу push main. Архив immutable, push не deploy. Skills/subagents/quota reset не применять; ShadeAI read-only. Факты кода, planned API, mocks и live/device acceptance всегда различать.
