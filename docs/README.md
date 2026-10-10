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
- [Переход сервисов на Haiku 5.5](haiku-migration.md) — маршруты, потолки цены, сохранённые изменения Kwork и результаты проверки.

- [Независимый Auth, питание приложений, Memos/Vikunja и Hermes](runtime-and-knowledge.md)

- Memos/Vikunja: разрешение Qubite и одноразовый первый пароль через `/service-enroll`; root-owned `deploy/knowledge-manager.py`, отдельный `KNOWLEDGE_MANAGEMENT_SOCKET`. Повтор не сбрасывает пароль, чужой существующий логин не захватывается. [Инструкция для телефона/Arch](knowledge-client-guide.md).
