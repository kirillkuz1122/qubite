# Документация Qubite 2.0 и legacy

Новый комплект проектирует платформу; legacy-код продолжает существовать. Стек согласован 12.10.2026; механика и клиентские POC описаны в ADR. Не считать планы реализацией.

- [Отчёт QUB-001](reports/QUB-001.md), [текущее состояние и inventory](architecture/CURRENT_STATE.md), [security audit](architecture/SECURITY_AUDIT.md), [ShadeAI read-only](architecture/SHADEAI_INTEGRATION.md).
- [Видение](product/VISION.md), [требования и 48 идеи](product/REQUIREMENTS.md), [полная source trace](product/SOURCE_TRACE.md), [Owner Console](product/OWNER_CONSOLE.md).
- [Архитектурные альтернативы](architecture/TARGET_ARCHITECTURE.md), [модули](architecture/MODULES_AND_BOUNDARIES.md), [данные](architecture/DATA_MODEL.md), [permissions](architecture/AUTH_AND_PERMISSIONS.md), [cost guard](architecture/AI_COST_GUARD.md).
- [Sync/history](architecture/SYNC_AND_HISTORY.md), [AI memory/skills](architecture/AI_MEMORY_SKILLS_AND_TOOLS.md), [Plugins/MCP](architecture/PLUGINS_AND_MCP.md), [ADR](architecture/decisions/README.md).
- [Миграция](migration/LEGACY_TO_QUBITE.md), [backup/deploy](engineering/DEPLOYMENT_AND_BACKUPS.md), [тесты](engineering/TEST_STRATEGY.md), [harness](engineering/AGENT_HARNESS.md), [дизайн](design/DESIGN_SYSTEM_PLAN.md).
- [Roadmap](plan/ROADMAP.md), [49 task cards](plan/TASKS.md), [machine tasks](plan/tasks.json), [project memory](project/PROJECT_CONTEXT.md), [handoff](project/LAST_HANDOFF.md), [open questions](project/OPEN_QUESTIONS.md).

Ниже сохранён прежний индекс документации работающего проекта. Новая архитектура не отменяет операционные ограничения существующих сервисов.

---

# Документация Qubite

Этот каталог собирает рабочую документацию по текущему состоянию репозитория `qubite`.

## Как читать этот комплект

- `README.md` в корне — быстрый вход и карта проекта.
- Документы в `docs/` — основная проектная документация.
- `SECURITY.md`, `TODO.md`, `deploy/*` — operational docs и служебные reference-файлы.
- `docs/explanatory-note-typst/` — отдельный академический артефакт, а не source of truth для продукта и эксплуатации.

## Основные документы

- [`../README.md`](../README.md) — обзор проекта, стек, быстрый старт
- [`architecture.md`](architecture.md) — архитектура, ключевые модули, потоки данных, runtime-сценарии
- [`product-and-roles.md`](product-and-roles.md) — продуктовая модель, роли, ограничения доступа
- [`development.md`](development.md) — локальная разработка, env, логи, точки входа
- [`deploy-and-production.md`](deploy-and-production.md) — production-модель, deploy-практика, инфраструктурные assumptions
- [`../SECURITY.md`](../SECURITY.md) — меры защиты, ограничения и риски
- [`../TODO.md`](../TODO.md) — roadmap, known issues, technical debt
- [`../SMARTCAPTCHA_THEME.md`](../SMARTCAPTCHA_THEME.md) — заметка по миграции CAPTCHA-слоя

## Принципы поддержания docs

- Документация не должна описывать “как хотелось бы”, если этого нет в коде.
- Если функция есть частично, это нужно помечать как `частично реализовано`.
- Если часть системы сырая, это нужно явно выносить в `Known issues` или `Technical debt`.
- При изменении ролей, env, deploy или ключевых сценариев нужно обновлять и docs, и [`../AGENTS.md`](../AGENTS.md).

- [Редактор текста, Firefox и Linux](writing.md) — локальный LanguageTool, ИИ, права, ключи и бюджеты.
- [Личный Telegram-бот для ТЗ](specbot.md) — приглашения, промпты, интервью, ручное управление и документы.
- [Переговоры по Brief в Kwork-боте](kwork-negotiations.md) — оценка ТЗ, подтверждения, личный Telegram и ограничения.
- [Заявки из сообществ Telegram](telegram-leads.md) — источники, обучение, первые обращения и папки; [схема SQLite](telegram-leads-schema.md).
- [Переход сервисов на Haiku 5.5](haiku-migration.md) — маршруты, потолки цены, сохранённые изменения Kwork и результаты проверки.

- [Независимый Auth, питание приложений, Memos/Vikunja и Hermes](runtime-and-knowledge.md)

- Memos/Vikunja: разрешение Qubite и одноразовый первый пароль через `/service-enroll`; root-owned `deploy/knowledge-manager.py`, отдельный `KNOWLEDGE_MANAGEMENT_SOCKET`. Повтор не сбрасывает пароль, чужой существующий логин не захватывается. [Инструкция для телефона/Arch](knowledge-client-guide.md).

- [Telegram, аналитика и мониторинг: parity matrix](architecture/TELEGRAM_AND_OBSERVABILITY.md).

- [Решение о переносе общих функций и турнирах](architecture/decisions/0007-platform-extraction-and-capture.md), [Telegram capture и уведомления](architecture/TELEGRAM_CAPTURE_AND_NOTIFICATIONS.md).

- [Полный актуальный отчёт 12.10.2026](reports/STATUS-2026-10-12.md), [React scope сервисов](architecture/decisions/0008-react-service-surfaces.md).

[Первая coding задача QUB-TEST-001: реальный Auth HTTP baseline, evidence и известные дефекты](reports/QUB-TEST-001.md).

[Созданный core foundation](architecture/CORE_FOUNDATION.md), [запуск](../core/README.md), [отчёт QUB-CORE-001](reports/QUB-CORE-001.md).
