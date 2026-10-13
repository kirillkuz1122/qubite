# Документация универсального Qubite

Документы различают фактический runtime, целевые спецификации, прототипы и старые референсы. Текущий статус в [LAST_HANDOFF](project/LAST_HANDOFF.md) и [tasks.json](plan/tasks.json); старые milestones в отчётах не текущие команды запуска.

- [Видение](product/VISION.md), [требования](product/REQUIREMENTS.md), [Owner Console](product/OWNER_CONSOLE.md).
- [Карта репозитория и статусов](architecture/REPOSITORY_LAYOUT.md), [архитектура](architecture/TARGET_ARCHITECTURE.md), [модули](architecture/MODULES_AND_BOUNDARIES.md), [ADR](architecture/decisions/README.md).
- [Qubite Auth UI](design/AUTH_UX.md), [отчёт AUTH-007](reports/QUB-AUTH-007.md), [новые правовые тексты](legal/README.md).
- [Оболочка приложения](../apps/web/README.md), [её решение](architecture/decisions/0022-web-shell-and-command.md), [отчёт UI-001](reports/QUB-UI-001.md).
- [Core запуск/owner](../core/README.md), [Web Auth](architecture/WEB_AUTH.md), [OAuth](architecture/OAUTH_IDENTITY.md), [email](architecture/EMAIL_CHALLENGES.md), [policy](architecture/POLICY_GATE.md), [регистрация](architecture/REGISTRATION.md).
- [Development Harness](engineering/AGENT_HARNESS.md), [тесты](engineering/TEST_STRATEGY.md), [будущий deploy и backup](engineering/DEPLOYMENT_AND_BACKUPS.md).
- [План](plan/ROADMAP.md), [карточки](plan/TASKS.md), [память проекта](project/PROJECT_CONTEXT.md), [журнал задач](project/CHANGELOG.md), [отчёты](reports/).
- [Принятый дизайн](design/FLUX_DESIGN_SYSTEM.md), [палитра](design/COLOR_PLASTIC.md), [React витрина](../assets/design-lab/README.md).
- [Переезд исходников](migration/REPOSITORY_REORGANIZATION.md), [машинная карта old→new](migration/RELOCATION_MANIFEST.json).
- [Старые сервисы, подлежащие перепроектированию](legacy-services/README.md). Это не договор API нового core.
- [Старая турнирная платформа](../legacy/qubite-v1/README.md), [старые документы сайта](../legacy/qubite-v1/docs/), [Flutter VPN](../legacy/qubite-vpn/README.md).

Исходные QUBITE master/access/kickoff в корне сохраняются. Последние согласованные решения владельца имеют приоритет над историческими формулировками; изменения требований записываются в ADR.
