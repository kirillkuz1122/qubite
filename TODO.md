# TODO / Roadmap / Known Issues

**AUTH-00613.10.2026 — done:** core0.6.0/current0007_registration; owner-controlled invite/default/public/disabled API, оба одноразовых invite, strict minimal enrollment/consents, pending→email verify→login, no module/AI grants. [Контракт](docs/architecture/REGISTRATION.md), [отчёт](docs/reports/QUB-AUTH-006.md), [ADR-0020](docs/architecture/decisions/0020-owner-controlled-registration.md). Вопросы заданы и ответы получены до реализации. React controls/mail/legal/deploy отдельно. AUTH-015 глобальные switches, AUTH-016 ChatGPT eligibility/identity, AI-003 personal plan vs owner API сохранены в backlog. Далее обсудить UI-001 shell, затем AUTH-007 auth UI; перед каждым task снова вопросы. Implementation2035e1e / CI38390796988 exact SHA success11:36:36UTC;969 local+CI checks. Current evidence в tasks.json/LAST_HANDOFF, milestones ниже исторические.

**AUTH-005, 13.10.2026 — done:** согласованная проверка существующего входа email/password без account code-entry. [Границы API](docs/architecture/ACCOUNT_LOGIN.md), [отчёт](docs/reports/QUB-AUTH-005.md), [ADR-0019](docs/architecture/decisions/0019-account-login-boundary.md). Core0.5.0/schema0006_policy и runtime без изменений; old routes404/strict DTO, email proofs отдельно, shared/personal tournament join сохранён. Local+CI all892+harness6=898pass; implementationcf302d9 / CI38385240872 completed-success10:47:23UTC. Далее AUTH-006 минимальная регистрация; сначала вопросы и ответы владельца. Предыдущие milestones ниже исторические, актуальный статус в tasks.json/LAST_HANDOFF.

**AUTH-00313.10.2026 — done:** core0.5.0/schema0006_policy; раздельные ручные module/action grants, workspace/resource intersection, owner-only metadata commands с If-Match/idempotency/reauth/audit. Общий REST/job/tool/WS gate, live revoke/session/expiry/version; paid AI закрыт до AI-001/002. [Контракт](docs/architecture/POLICY_GATE.md), [отчёт](docs/reports/QUB-AUTH-003.md). Только аккаунт до grants подтверждено владельцем; перед каждой будущей задачей сначала вопросы и ответы. UI/registration/real modules/installer/native/provider/deploy отдельно. Final local+CI all844+harness6=850pass; implementationd4c813e/CI38381905595 completed-success10:17:52UTC. Registry56:10done/4ready/42backlog, evidence в tasks.json/LAST_HANDOFF. Прежние snapshots ниже исторические.

**AUTH-01113.10.2026 — done:** core0.4.0/schema0005, verify/reset API для существующих UUID, mock-only delivery/off default, one-use/TTL/attempt/rate/version gates и atomic password/session revoke. [Контракт](docs/architecture/EMAIL_CHALLENGES.md), [отчёт](docs/reports/QUB-AUTH-011.md), [ADR-0017](docs/architecture/decisions/0017-email-challenges-and-recovery.md). Email-2FA только protocol contract, не runtime; registration/policy/UI/SMTP/deploy отдельно. Implementationf3d4b6c/CI38373075395 success,762 local+CI checks. Current status/evidence в tasks.json/LAST_HANDOFF; прежние milestones ниже исторические.

**AUTH-01013.10.2026:** OAuth/explicit linking реализованы локальным bounded slice, [контракт](docs/architecture/OAUTH_IDENTITY.md)/[report](docs/reports/QUB-AUTH-010.md). Следующая AUTH-011 verify/reset. Real provider app/keys/redirect registration/roundtrips, React/Auth UX/native/keys/policy/service cutover остаются своими задачами; network/providers default off. Ниже предыдущие milestones и legacy backlog, current tasks.json определяет порядок.

**AUTH-00913.10.2026:** рабочий password/session API и local owner password setup реализованы. Далее AUTH-010 OAuth, AUTH-011 verify/reset и approved policy/UI slices. [Runtime](docs/architecture/WEB_AUTH.md), [report](docs/reports/QUB-AUTH-009.md). Ниже предыдущие записи/legacy backlog; current tasks.json определяет порядок.

**AUTH-002 реализована:** fresh PG account schema/local owner bootstrap. Next AUTH-009 password/session/CSRF/revoke, затем AUTH-003 policy; никакой legacy verifier/import. [Отчёт](docs/reports/QUB-AUTH-002.md).

**Qubite2, актуальное13.10.2026:** AUTH-008 фиксирует fresh единый вход, без переноса старых аккаунтов/bridge ([контракт](docs/migration/IDENTITY_CUTOVER.md)). Далее AUTH-002 PG accounts/local owner bootstrap → AUTH-009 password/session API → AUTH-003 policy; native/keys/private introspection отдельные AUTH-012/013/014, затем свои React сервисы. Игрушечная/Поток/Лента/Unbounded/Manrope приняты. Ниже legacy backlog, он не меняет порядок нового [реестра задач](docs/plan/tasks.json).

Этот файл больше не пытается быть “вечным списком идей”. Он фиксирует три вещи:

- что реально нужно сделать дальше;
- что уже болит в текущей версии;
- какой технический долг мешает проекту.

## Ближайшие приоритеты

- Довести organizer/moderator/admin UX до состояния, где им можно пользоваться без постоянной борьбы с интерфейсом.
- Усилить регистрацию и anti-bot flow.
- Почистить и стабилизировать runtime турнира.
- Довести RU legal pages и ссылки на них в интерфейсе до связного состояния.

## Roadmap

### Product

- Апелляции.
- Задачи по программированию с реальным runner/sandbox.
- Визуальные типы задач, включая drag-and-drop-подобные механики.
- Улучшение participant UX как основного контура проекта.
- Улучшение organizer UX как следующего по важности контура.

### Auth / Integrations

- Миграция CAPTCHA-слоя с Cloudflare Turnstile на Яндекс SmartCaptcha для российского контура.
- Production-регрессия существующего Telegram OAuth: login уже реализован, не считать его отсутствующей функцией.

### Ops / Docs

- Поддерживать docs в актуальном состоянии вместе с кодом.
- Вынести секреты из Git и убрать `deploy/.env` из роли “production reference”.

## Уже есть в проекте и не должно висеть как “просто план”

- OAuth через Google, Yandex, VK ID и Telegram Login Widget уже есть в коде.
- Excel-импорт задач уже есть.
- Excel-импорт roster / списка допуска уже есть.
- Команды и командные турниры уже есть.
- Leaderboard и аналитические выборки уже есть.
- Organizer/moderation/admin/owner контуры уже есть.
- Telegram-бот для управления платформой (owner + модераторы) уже есть.

Если эти части требуют доработки, это нужно описывать как `сырой UX` или `частично доведено`, а не как “вообще не сделано”.

## Already implemented (rating system)

- Elo-подобная рейтинговая система с учётом силы соперников.
- Стартовый рейтинг = 1200 RP (звание «Новичок»).
- Рейтинг может расти и падать в зависимости от результата турнира.
- Снижение рейтинга за неактивность (декей: -2 RP/день после 30 дней).
- Таблица `rating_changes` с полной историей каждого изменения.
- API `/api/rating/me/history` и `/api/rating/me/explain`.
- UI: модалка «Как считается рейтинг» и «История рейтинга».
- Миграция старых рейтингов через `change_type = 'migration'`.

## Known issues

- Регистрация пока недостаточно хорошо защищена от массового спама/ботов.
- Turnstile неудобен как долгосрочное решение для российского пользовательского контура.
- Organizer/moderator интерфейсы заметно слабее participant-контура.
- Tournament runtime местами сырой.
- Часть deploy-знания всё ещё живёт “в голове оператора”.

## Technical debt

- `back/src/db.js` слишком монолитен.
- `front/js/app.js` слишком монолитен.
- Продуктовая логика местами размазана между сервером, сериализацией и UI.
- Документация раньше жила отдельно от реального кода; это нужно продолжать исправлять.
- Production-like secrets в репозитории — плохой паттерн.

## Напоминание для следующих итераций

Когда реализуется новая функция или меняется важный сценарий, нужно обновлять одновременно:

- `README.md`
- нужные файлы из `docs/`
- `SECURITY.md`, если меняется security/deploy behavior
- `AGENTS.md`, если меняется карта ключевых файлов или правила поддержки docs

## Дополнительные сервисы — состояние 2026-10-03

Реализованы единый вход поиска, личные grants/лимиты, приглашённый AliasVault, browser-encrypted history, MyServices, AdminUsers, будущие VPN-ноды и компонентный установщик. На Raspberry проверены создание/блокировка/удаление отдельного тестового хранилища, cookie SSO, история и desktop/mobile layout.

Остаётся: прогнать полный fresh install на отдельной машине; тест восстановления архивов; проверить расширение Firefox и автозаполнение на физических телефонах; автоматизировать резервные копии в fresh installer. Для VPN нужен доступный входящий сервер, отсутствующий на нынешней Raspberry. Автоматический выбор VPN-ноды и qubiteapp.ru отложены по просьбе пользователя; текущие сети не перестраивать.

Также добавлено owner-only управление сервисами и общим бюджетом в существующем Telegram-боте Qubite; проверить реальные клики владельца в `/services` после развёртывания.

### Независимый Auth и knowledge сервисы

- [x] Отдельные Auth/control bot, физическое on/off allowlisted процессов, внешние grants Memos/Vikunja и ограниченный MCP Hermes.
- [ ] Универсальный OIDC для сторонних клиентов и универсальные сервисные коды: текущие cookie SSO/турнирные коды не выдавать за эту функцию.
- [ ] Автоматическое создание нативных аккаунтов Memos/Vikunja и полноценный installer lifecycle.
- [ ] Долговечная очередь межпроцессных событий; текущий IPC сохраняет live notifications, но не гарантирует доставку при выключенном получателе.
- [ ] Включить и проверить memory cgroup отдельным согласованным обслуживанием; нагрузочные тесты с одновременной STT.

- Memos/Vikunja: разрешение Qubite и одноразовый первый пароль через `/service-enroll`; root-owned `deploy/knowledge-manager.py`, отдельный `KNOWLEDGE_MANAGEMENT_SOCKET`. Повтор не сбрасывает пароль, чужой существующий логин не захватывается. [Инструкция для телефона/Arch](docs/knowledge-client-guide.md).

- [ ] SiYuan: пользовательская проверка интерфейса Zen/телефон; отдельные экземпляры для друзей только по отдельному запросу (текущий workspace личный).
- [x] SiYuan: подготовлен OpenRouter / Haiku 5.5 для агента и редактора, API key пустой; настройки и привязки проверены через нативный API.
- [ ] После добавления отдельного ключа SiYuan проверить реальный ответ, вызов инструментов с подтверждениями и расход бюджета.
- [x] Ограниченные переговоры по новым Brief Kwork: личный Telegram, одно напоминание, подтверждение коммерческих условий владельцем, пауза/отказ и защита старых карточек.
- [ ] Пользовательская проверка полного сценария переговоров с реальным клиентом; тесты транспорта используют подставной Telegram API, без рассылки клиентам.
- [x] Telegram-заявки: код, owner feedback, Jev/Haiku, проверка исходника, scoped transport, папки и ограничения авто; локальные тесты пройдены.
- [ ] Проверить реальный поток выбранных сообществ и собрать оценки владельца; подтвердить точный Godshop. Оценить качество/задержки перед расширением автоматических контактов.

- Telegram-заявки: отдельный owner-бот, добавление источников @username/точное название/ID, кнопка ручного разрешения первого контакта и журнал отправок реализованы; 141 сценарий проверены. Точность на реальных заказах и готовность перехода после обучения пока не подтверждены.

## Qubite 2.0 — приоритет перед рефакторингом

Новый backlog: [ROADMAP](docs/plan/ROADMAP.md), [TASKS](docs/plan/TASKS.md), [machine state](docs/plan/tasks.json). Сейчас audit/design review/testing; стек и migration authority ожидают обсуждения. Сначала полный legacy auth/runtime/rating characterization, read-only server drift и backup/restore, затем approved Owner Console/default-deny/mock budgets и note→sync→search→restore. Все 48 идеи сохранены в требованиях. Не менять legacy roles/DB/сервисы по одному roadmap пункту без утверждённой маленькой задачи.

Qubite 2.0: полный control-bot redesign с capability parity, split Tournaments settings vs Owner Console, scoped Support, analytics/Infrastructure collector+UI. Исправить при переносе load average label и Telegram duration contract, exact reply/TTL support, process resets/gaps. Подробности в docs/architecture/TELEGRAM_AND_OBSERVABILITY.md и task registry; live изменения отдельно.
