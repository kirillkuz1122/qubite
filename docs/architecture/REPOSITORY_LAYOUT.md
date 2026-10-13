# Структура и происхождение исходников

CONFIRMED владельцем13.10.2026, QUB-REPO-001. Qubite 2.0 — универсальная платформа; корень больше не старый сайт. [ADR-0021](decisions/0021-repository-layout-and-standalone-tournaments.md) имеет приоритет над прежним планом SSO турниров.

## Классификация

NEW RUNTIME: core/qubite, migrations/SQL, core/tests; contracts реализованных и явно planned API. Runtime0.6.0/current0007_registration. NEW ENGINEERING: scripts/engineering, tests/engineering/identity, .github tests-only CI. NEW SPECIFICATION: docs/product/architecture/design/migration/engineering/plan/project; отчёты — historical evidence, не обещание runtime. PROTOTYPE: assets/design-lab, отдельный React package/toolchain.

LEGACY ARCHIVED: legacy/qubite-v1 (back/front/11 HTML/legal/.env.example/старый deploy/docs); legacy/qubite-vpn (Flutter, native источники, старые binary builds); legacy/integrations/qubite-siyuan (исключён из нового продукта). LEGACY REFERENCE: services/search, services/specbot, integrations/kwork/qubite-search/qubite-writing/qubite-knowledge; нужен новый interview/design/core API до подключения. [Карта](../legacy-services/README.md).

modules/tournaments — metadata/инструкции optional standalone package. Единственная копия runtime в legacy/qubite-v1, без симлинков и без дублирования. Описание само не устанавливает компонент/не регистрирует его в core. Новая apps/web ещё не создана; не плодить пустые scaffolds вместо UI-001.

## Domains и данные

Все продуктовые модули — отдельные поддомены выбранного основного домена, общий React/codebase и FastAPI/core authority. Поддомен не требует отдельной базы/микросервера; fixed host allowlist/routing/host-only sessions/redirect handshake и provider callbacks прорабатываются перед ingress. Не включать wildcard CORS/cookie Domain ради общего входа. Основная оболочка/account/settings/Owner Console остаются частью новой платформы. Конкретный домен/DNS/TLS не подтверждены и не настроены.

Tournaments исключение: самостоятельный старый сайт, Node/SQLite/Vanilla, свой Auth/данные/owner/roles, без связи с core identity, ресурсами и grants. Будущий installer позволяет не устанавливать или opt-in установить на tournaments.<domain> со своими service/env/data/backup. Owner Console future operator может управлять установкой по allowlist, без чтения старых пользовательских данных или arbitrary shell.

## Конфигурация

Root .env.example — актуальные env keys core, без секретов; root .env по запросу владельца заменён такой же незаполненной конфигурацией и ignored. Прежний root env перемещён в legacy/qubite-v1/.env, не в Git. Filled deploy/.env сохранён на месте/без изменения; deploy/README описывает future installer. Старый deploy код в legacy/qubite-v1/deploy. Config core по-прежнему читает process env, не автозагружает файлы.

Для legacy path helper ROOT_DIR указывает старый сайт, REPOSITORY_DIR — корень shared reference integrations/services. Installer явно разделяет эти пути и принимает приватный env-file, не создаёт симлинков совместимости. [Точная карта old→new](../migration/RELOCATION_MANIFEST.json) содержит все368 tracked moves; private runtime/env/DB перемещения сохраняются вне Git.

## Gates

Core/contract/design runtime не переписывается этим переносом. CI/harness знают новые пути; isolated Node HTTP/static/assets и Python service suites должны проходить. New API/data design и real releases — новые маленькие задачи с вопросами владельцу. Старые docs/repository-notes сохраняют тексты/evidence перед переносом и явно historical; не использовать их как startup карту.
