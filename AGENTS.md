## Qubite 2.0 — актуальный старт сессии (13.10.2026)

**AUTH-00313.10.2026 — review/testing:** core0.5.0/schema0006_policy; раздельные ручные module/action grants, workspace/resource intersection, owner-only metadata commands с If-Match/idempotency/reauth/audit. Общий REST/job/tool/WS gate, live revoke/session/expiry/version; paid AI закрыт до AI-001/002. [Контракт](docs/architecture/POLICY_GATE.md), [отчёт](docs/reports/QUB-AUTH-003.md). Только аккаунт до grants подтверждено владельцем; перед каждой будущей задачей сначала вопросы и ответы. UI/registration/real modules/installer/native/provider/deploy отдельно. Final local all844+harness6=850pass, implementation/push/CI ещё проверяются; точные evidence в tasks.json/LAST_HANDOFF. Прежние snapshots ниже исторические.

## Порядок работы с владельцем

13.10.2026 владелец уточнил: **перед выполнением каждой следующей задачи сначала задать ему вопросы по решениям/нюансам и только после его ответов начинать реализацию**. Не переносить согласование одной задачи на следующую. Если открытых решений нет, кратко уточнить границу результата. По AUTH-003 вопросы заданы и ответы получены: до ручной выдачи модулей только аккаунт/профиль/настройки; read/write/manage раздельны. Эта задача разрешена; будущие задачи автоматически не утверждены.

**AUTH-01113.10.2026 — done:** core0.4.0/schema0005, verify/reset API для существующих UUID, mock-only delivery/off default, one-use/TTL/attempt/rate/version gates и atomic password/session revoke. [Контракт](docs/architecture/EMAIL_CHALLENGES.md), [отчёт](docs/reports/QUB-AUTH-011.md), [ADR-0017](docs/architecture/decisions/0017-email-challenges-and-recovery.md). Email-2FA только protocol contract, не runtime; registration/policy/UI/SMTP/deploy отдельно. Implementationf3d4b6c/CI38373075395 success,762 local+CI checks. Current status/evidence в tasks.json/LAST_HANDOFF; прежние milestones ниже исторические.

**AUTH-010 done13.10.2026:** implementationd93affa/CI38364255314 success,697 local+CI checks; актуальный core0.3.0/current0004_oauth, identity-v2 partial implemented AUTH-009/010. [OAuth schema/API](docs/architecture/OAUTH_IDENTITY.md), [report](docs/reports/QUB-AUTH-010.md), [ADR-0016](docs/architecture/decisions/0016-explicit-oauth-identities.md). Stable issuer/sub, no email matching/implicit signup; own-password link/unlink, default disabled/network-off, one-use browser state/PKCE/version/config/current actor gates. No real keys/providers/deploy/owner; следующая AUTH-011 verify/reset. Предыдущие milestones ниже исторические; latest status/CI/SHA в tasks.json/LAST_HANDOFF. OAuth native redirects и module/AI grants не реализованы.

Текущий код ниже описывает legacy Qubite; новая универсальная платформа создаётся небольшими согласованными задачами. Перед задачей читать [память проекта](docs/project/PROJECT_CONTEXT.md), [handoff](docs/project/LAST_HANDOFF.md), [kickoff](QUBITE_AGENT_KICKOFF_PROMPT.md), полностью master/access документы в корне, [аудит](docs/architecture/CURRENT_STATE.md), [ADR](docs/architecture/decisions/README.md), [tasks.json](docs/plan/tasks.json). Точный kickoff с суффиксом V2 отсутствует; не объявлять его прочитанным и не переименовывать пользовательский источник без причины.

- Продуктовые правила access policy имеют приоритет над старой глобальной моделью ролей: normal home для owner, separate Owner Console, tournament-only organizer/moderator/admin, manual module/model grants и budgets, default deny. Эти правила целевые, в legacy ещё есть owner auto-paid bypass.
- Стек согласован 12.10.2026: FastAPI/Python, React/TS, Postgres нового core, SQLite турниров. Нужные shared функции и новый Auth FastAPI/Postgres. **13.10.2026: владелец сообщил, что деплоя/аккаунтов нет, owner можно создать заново. Fresh identity/единый API без legacy bridge/password/session import/login alias — [ADR-0013](docs/architecture/decisions/0013-fresh-identity-and-unified-login.md), [контракт](docs/migration/IDENTITY_CUTOVER.md).** Старые runtime исходники остаются, это не живой authority нового продукта. Новый дизайн/минимальная регистрация без account code-entry (ADR-0005/0007). Web/Android/Linux desktop и deploy/installer обязательны (ADR-0006). Детальные решения/POC не считать реализованными; массовый рефакторинг не начинать. Выбирать только ready задачи с done dependencies и approval, один bounded cycle. [Harness](docs/engineering/AGENT_HARNESS.md) задаёт проверки/документацию/evidence/коммит/push.
- Архив `tournaments` и тег `qubite-v1.0` на GitHub указывают на `96f0457a523b6b79f21c4092056d8fa8fa69a680`; не менять/удалять/force-push. Разработка main, временные task branches разрешены с tested merge. Русские коммиты и немедленный push после commit сохраняются.
- Git archive не backup runtime. Production deployment отдельно после явного разрешения, backup/restore/staging/checks; push не считать deploy. Не перезапускать live services по факту изменения docs.
- Хостинг отложен владельцем 12.10.2026, возможен VPS. Не блокировать локальное проектирование/разработку ресурсами Raspberry Pi; inventory/capacity/backup/restore остаются обязательными перед миграцией и деплоем. Ответами позднее 12.10.2026 стек согласован; локальные задачи разрешены по harness, live migration/deploy отдельно.
- ShadeAI `/home/kirill/programing/ShadeAI` только read-only для будущего connector, без import/merge/secrets/cloud runtime changes.
- Проверки: `python3 scripts/engineering/check.py`; `python3 scripts/engineering/verify.py --suite all --python <test-venv-python>`. Runner использует source-copy без .env, isolated HOME/DB и no external network. Итоги в [QUB-001](docs/reports/QUB-001.md); pass mocks не означает real API/device/production acceptance.
- AUTH-009 done: implementation1dc57cb/CI38354136689 success,597 local+CI checks. Реальный Web Auth/core0.2.0/explicit0003_auth, Argon2id/local initial owner password, CSRF/session/reauth/revoke; [runtime](docs/architecture/WEB_AUTH.md), [отчёт](docs/reports/QUB-AUTH-009.md). Identity-v2 partial_implementation, implemented AUTH-009/010, остальные planned. AUTH-008 source specification/oracle не полный verifier. AUTH-002 done: новые PG accounts/explicit local singleton owner bootstrap,477 local+CI checks; [схема/CLI](docs/architecture/IDENTITY_SCHEMA.md), [отчёт](docs/reports/QUB-AUTH-002.md). Current migration0006_policy, startup не пишет БД/не вычисляет password hash; постоянный owner/пароль не создавались, только disposable fixtures. Следующая AUTH-011 verify/reset, status в tasks.json. Политика/React/native/keys/ingress ещё отдельные. Search/Writing/VPN/native переходят в своих bounded задачах; unified login не объединяет vault master secrets/bot/node credentials. Identity suite включена в verify.py all. Проектные решения/контекст хранить в docs/project и ADR, не в личной памяти агента; никаких секретов, production DB, private messages или browser state в Git.
- DESIGN-001 done: **Поток/Игрушечная/Лента/Unbounded/Manrope и ритм100/503 подтверждены владельцем после просмотра версии4.** [Color Plastic04](docs/design/COLOR_PLASTIC.md), [Flux contract](docs/design/FLUX_DESIGN_SYSTEM.md), [ADR-0012](docs/architecture/decisions/0012-flux-design-system.md): пять ярких наборов с semantic roles, выбран toy; production layout/device checks остаются UI-002. [Лаборатория](assets/design-lab/README.md), [report](docs/reports/QUB-DESIGN-001.md), 133 browser tests. Старые сцены/Milo сохранены. Не использовать skills/quota reset/subagents по прямому запросу. Reuse owner-private project_id из hosting.json, tokens не хранить; CI tests-only, отдельное demo publish разрешено, production Qubite отдельно. UI-002/PET-* backlog, реальные agents отсутствуют.

---

# Qubite Agent Notes

Этот файл предназначен для ИИ-ассистентов и новых разработчиков, которые впервые читают репозиторий.

## Что это за репозиторий

`qubite` — русскоязычный рабочий MVP-прототип платформы для учебных соревнований.

Главный продуктовый фокус сейчас:

- участник (`user`)
- турнир как главный объект системы
- честное описание текущего состояния, а не “как хотелось бы”

## Не делайте ложных предположений

- Legacy runtime не React/Vite/Next. Новый независимый React/TS дизайн-прототип — `assets/design-lab/`, собственный package.json/lock/toolchain, не product frontend.
- Фронтенд здесь в основном живёт в:
  - `index.html`
  - `front/css/styles.css`
  - `front/js/app.js`
  - `front/js/api.js`
- Бэкенд здесь в основном живёт в:
  - `back/server.js`
  - `back/src/db.js`
  - `back/src/task-runtime.js`
  - `back/src/security.js`
  - `back/src/config.js`
- Legacy использует `SQLite`; новый core storage PostgreSQL с explicit migrations0001..0006, subjects/platform_owner/credentials/web sessions/OAuth identities/security metadata.
- Текущий CAPTCHA-слой — `Cloudflare Turnstile`, но в roadmap есть переход на `Yandex SmartCaptcha`.

## Ключевые файлы

### Фронтенд

- `index.html` — landing/workspace shell
- `front/css/styles.css` — вся тема и визуальная система
- `front/js/app.js` — UI, модалки, role workspaces, runtime-поведение
- `front/js/api.js` — API-клиент и client state

### Бэкенд

- `back/server.js` — route handlers и middleware
- `back/src/db.js` — схема SQLite и почти вся прикладная логика
- `back/src/task-runtime.js` — типы задач и автоматическая проверка
- `back/src/security.js` — пароли, токены, helper security functions
- `back/src/request-guard.js` — abuse/rate/origin guards
- `back/src/oauth.js` — OAuth providers
- `back/src/turnstile.js` — текущая CAPTCHA-интеграция

### Новый core

- `core/qubite/migrations.py`, `core/qubite/sql/0002_identity.sql` — explicit transactional schema/history gates.
- `core/qubite/identity/accounts.py` — fresh subjects и owner bootstrap; `__main__.py` — local CLI, no public signup/bootstrap.
- `core/qubite/identity/auth/` — passwords/tokens/store/http/routes, `0003_auth.sql` — actual Web Auth schema; config Auth origin/local mode explicit; OAuth добавлен в identity/oauth/, bearer/native ещё отсутствуют.
- `core/qubite/identity/oauth/`, `core/qubite/sql/0004_oauth.sql` — fixed provider adapters/state/explicit linking и operator enable/disable; `core/tests/test_oauth.py` — signed fixtures/real PG, не live providers.
- `core/tests/test_auth.py` — real PG/HTTP/race/role/secret-free negative cases; `set-owner-password` только local TTY/getpass, никакой пароль в argv/модель.
- `core/tests/test_identity.py` — real disposable PostgreSQL cases; [CLI/schema](docs/architecture/IDENTITY_SCHEMA.md), [core запуск](core/README.md).

- `core/qubite/identity/challenges/`, `core/qubite/sql/0005_challenges.sql` — verify/reset существующих UUID, mock-only mail transport; `core/tests/test_challenges.py`, [контракт](docs/architecture/EMAIL_CHALLENGES.md). Public registration/email-2FA runtime ещё отсутствуют.

### Telegram Bot

- `back/src/telegram-bot.js` — точка входа, запуск polling, /start, /help, роутинг
- `back/src/telegram/access.js` — проверка прав (owner из env, moderator из env + БД)
- `back/src/telegram/menus.js` — inline-клавиатуры и шаблоны меню
- `back/src/telegram/notifier.js` — push-уведомления owner'у о критичных audit-событиях
- `back/src/telegram/handlers/settings.js` — owner-тумблеры system_settings
- `back/src/telegram/handlers/analytics.js` — overview, метрики, детальная статистика
- `back/src/telegram/handlers/moderation.js` — задачи, заявки организаторов, блокировка юзеров
- `back/src/telegram/handlers/admin.js` — пользователи, турниры, команды, задачи, аудит (owner)
- `back/src/telegram/handlers/access.js` — /grant, /revoke, /list для управления доступами (owner)

### Deploy / Ops

- `deploy/nginx/*`
- `deploy/proxy/*`
- `deploy/firewall/*`
- `deploy/cloudflare/*`
- `deploy/sysctl/*`
- `deploy/PROD_STEPS_RU.md`

### Документация

- `README.md` — быстрый вход
- `docs/README.md` — карта docs
- `docs/architecture.md`
- `docs/product-and-roles.md`
- `docs/development.md`
- `docs/deploy-and-production.md`
- `SECURITY.md`
- `TODO.md`
- `SMARTCAPTCHA_THEME.md`

## Что уже есть в коде

- роли: `user`, `organizer`, `moderator`, `admin`, `owner`
- типы задач: `single_choice`, `multiple_choice`, `short_text`, `number`
- турниры, команды, рейтинг, аналитика
- organizer/moderation/admin/owner contours
- Excel import для задач и roster
- OAuth через Google/Yandex/VK (серверный PKCE)/Telegram (direct redirect)
- Telegram-бот для управления платформой (owner + модераторы)
- Elo-подобная рейтинговая система с таблицей `rating_changes`, историей и UI
- cookie/localStorage notice в `front/js/app.js` + legal-текст в `privacy.html`

## Что ещё нельзя выдавать за реализованное

- code runner для программирования
- AI-проверка как готовая user-facing функция
- апелляции
- drag-and-drop / visual task types

## Обязательное правило сопровождения

Если вы меняете:

- роли и доступы
- tournament/runtime flow
- env или deploy behavior
- auth / verification / CAPTCHA
- legal pages
- карту ключевых файлов

нужно обновлять одновременно:

- соответствующий код
- `README.md`
- релевантные файлы в `docs/`
- `SECURITY.md` / `TODO.md`, если это касается security или roadmap
- этот `AGENTS.md`

## Если docs расходятся с кодом

Верить нужно коду, а docs надо исправлять.

## Операционная шпаргалка (факты из кода)

Эта секция — быстрый справочник, чтобы не перечитывать весь репозиторий заново.

### Стек и запуск

- Node.js + Express 5 + `sqlite3` + `xlsx`. CommonJS (`"type": "commonjs"`).
- Legacy `package.json` — в `back/`; новый отдельный prototype package — `assets/design-lab/`. В корне package.json нет. Не запускать React команды в back или корне.
- Запуск локально: `cd back && npm install && node server.js`.
- Production-запуск: `npm start` (`node server.js`), обычно под PM2 + Nginx.
- По умолчанию слушает `127.0.0.1:3000` (см. `.env` → `HOST`, `PORT`, `APP_BASE_URL`).
- SQLite-файл по умолчанию: `back/data/qubite.sqlite` (`DATABASE_PATH`).

### Тесты и верификация

- Есть targeted Node/Python suites; `npm test` в `back/` пока намеренно возвращает ошибку. Список и команды: `docs/architecture/ENV_AND_TESTS.md`, `docs/engineering/TEST_STRATEGY.md`.
- Верификация: targeted автоматические проверки плюс ручной UI/API прогон там, где acceptance требует реального поведения.
- Для e2e/UI-проверок подходит skill `webapp-testing` / `playwright`.

### Витрина турниров для участника

- `/api/tournaments` должен отдавать не только опубликованные/текущие, но и `ended`-турниры: вкладка «Прошедшие» в пользовательском UI зависит от этой выдачи.
- `draft` и `archived` не попадают в пользовательскую витрину; organizer/admin-контуры показывают их отдельно.
- Для `access_scope = 'code'` и `access_scope = 'closed'` действует `catalog_visible`: по умолчанию такие турниры скрыты из общей витрины; скрытый roster-турнир виден только пользователям из `tournament_roster_entries`.

### Git workflow

- Коммиты и push по умолчанию делать в ветку `main`.
- **После каждого коммита сразу делать `git push origin main`.**
- Перед коммитом проверять `git status --short --branch`; случайные удаления вроде `.env.example` не включать в коммит без отдельного подтверждения.
- **Коммиты писать на русском языке.** Без conventional-commit префиксов (`feat`, `fix` и т.д.) — просто описание на русском.
- **Не добавлять в коммиты строки `Generated with [Devin]` и `Co-Authored-By: Devin`.** Если после коммита они всё же попали в сообщение (например, из-за встроенного скрипта), сразу исправить: `git commit --amend` с чистым текстом без этих строк.

### Размеры ключевых файлов (важно для стратегии правок)

- `back/server.js` — ~9.3K строк (почти все HTTP-роуты в одном файле).
- `back/src/db.js` — ~7.5K строк (схема + большая часть прикладной логики + рейтинговая система).
- `front/js/app.js` — ~16.4K строк (вся UI-логика, модалки, role workspaces).
- `front/js/api.js` — ~1.7K строк (API-клиент + client state).
- `index.html` — ~1.4K строк (shell приложения, не SPA-роутер).

### Рейтинговая система

- Стартовый рейтинг: `RATING_START = 1200` (определено в `back/src/db.js`).
- Минимальный рейтинг: `RATING_MIN = 800`.
- Формула: Elo-подобная, `newRating = oldRating + K * (actualScore - expectedScore)`.
- K = `max(16, round(48 - rating/100))` — уменьшается с ростом рейтинга.
- `expectedScore` учитывает средний рейтинг соперников турнира.
- `actualScore` = нормализованное место (1.0 за 1-е, 0.0 за последнее).
- Декей: -2 RP/день после 30 дней неактивности (но не ниже `RATING_START`).
- Ежедневный бонус: +2 RP за решённую задачу (макс. +10 за день).
- Таблица `rating_changes`: полная история каждого изменения с `details_json`.
- Типы изменений: `tournament_result`, `daily_bonus`, `decay`, `migration`, `correction`.
- API: `/api/rating/me/history`, `/api/rating/me/explain`, `/api/rating/history/:userId` (admin).
- UI: модалки «Как считается рейтинг» и «История рейтинга».
- Звания: Новичок (<1300), Исследователь (1300+), Практик (1450+), Стратег (1600+), Эксперт (1750+), Кандидат в мастера (1900+), Мастер (2100+), Грандмастер (2350+), Легенда (2600+).
- Миграция: при первом запросе `refreshUserCompetitionStats` старый рейтинг сохраняется как `change_type = 'migration'`.

Из-за этих монолитов: для точечных правок используйте `grep`/`edit` по сигнатурам, **не** перечитывайте файлы целиком. Монолитность `db.js` и `app.js` уже зафиксирована как tech debt в `TODO.md`.

### Важные dev-флаги из `.env`

- `TURNSTILE_DEV_BYPASS=true` — в dev капча пропускается, в prod должно быть `false`.
- `SEED_DEMO_DATA=false` — на включении создаются демо-данные в БД.
- `NODE_ENV=dev` — влияет на режимы логирования и guard'ов.
- `TRUST_PROXY=0` — в проде за Nginx должно быть `1`.
- `INITIAL_OWNER_EMAIL` — bootstrap-почта owner'а: первый пользователь, подтвердивший эту почту, становится `owner`, если owner ещё не назначен.
- Лимиты body: `JSON_BODY_LIMIT=32kb`, `HEAVY_JSON_BODY_LIMIT=256kb`, `IMPORT_JSON_BODY_LIMIT=2mb` (используются в `server.js` на разных группах роутов).
- `VK_APP_ID` — ID приложения VK ID. `VK_CLIENT_SECRET` — «Защищённый ключ» из VK Developer Console. VK OAuth использует серверный PKCE-flow (code_verifier хранится в `oauth_states`).
- `OAUTH_GOOGLE_ENABLED`, `OAUTH_YANDEX_ENABLED`, `OAUTH_VK_ENABLED`, `OAUTH_TELEGRAM_ENABLED` — аварийные env kill-switch'и для отдельных способов входа; при `false` провайдер скрывается из UI и web-start endpoint не работает. Оперативное включение/выключение owner делает без рестарта через `system_settings`: `oauth_google_enabled`, `oauth_yandex_enabled`, `oauth_vk_enabled`, `oauth_telegram_enabled`.
- `proxy_naive_enabled=true` — runtime-тумблер в `system_settings`; при `false` NaiveProxy не выдаётся в app server list, catalog/subscription links и sync credentials, а VLESS/SNI-профили остаются доступными.
- `TELEGRAM_BOT_TOKEN` — токен бота; если пуст, бот не запускается и Telegram Login Widget не включается.
- `TELEGRAM_OWNER_ID` — Telegram user ID владельца (единственный source of truth для owner-доступа в боте).
- `TELEGRAM_MODERATOR_IDS` — CSV доп. модераторов (жёсткий whitelist, требует рестарта); динамические выдачи — через БД (`telegram_access`).
- `TELEGRAM_ENABLED=true` — kill-switch только для Telegram-бота без удаления токена; Login Widget зависит от `TELEGRAM_BOT_TOKEN`.

### Прочее

- Статические HTML-страницы в корне (`about.html`, `privacy.html`, `terms.html`, `security.html`, `acceptable-use.html`, `404.html`, `4041.html`, `maintenance.html`) отдаются бэкендом; при правке legal-страниц надо держать в синхроне ссылки из `index.html`.
- `back/src/imports.js` и `back/src/email.js` существуют, но в карте ключевых файлов выше не перечислены как «самые важные» — заглядывать туда, только если задача касается Excel-импорта или писем соответственно.
- `front/js/icons.js` — справочник SVG-иконок для UI.
- Рабочая ветка разработки и мейнлайн — `main`.

### Поиск / AliasVault / сервисы

- `back/src/services.js`, `back/src/vault-integration.js`, `back/src/proxy/personal.js`, `back/src/proxy/availability.js`: owner grants/invites, guarded enrollment, личные VPN-ссылки и доступность нод.
- `services/search/`: отдельное FastAPI-приложение + SQLite + статический интерфейс; source для fresh install. Не коммитить `.env`, `.venv`, search-data/runtime или browser storageState.
- `deploy/install.sh`, `deploy/services/*`, `deploy/vault-manager.py`: компоненты/ingress/узкий Unix socket manager. Старый `setup-proxy-node.sh` остаётся рабочим.
- Новые тесты: `node --test back/tests/services.test.js`, `python3 -m unittest discover -s deploy/services/tests`, search pytest. Старое `npm test` пока не подключено к ним.
- Документы: `docs/services.md`, `docs/design-system.md`; `/design-system` — живой пример компонентов.
- Native AliasVault registration нельзя открывать, обходя public proxy gate. Мастер-пароли не отправлять Qubite и не логировать. История поиска теперь хранится без дополнительного шифрования по выбору пользователя; сохранять изоляцию аккаунтов и отдельные права history у API-ключей. Старые ciphertext не удалять без успешного переноса.
- `SERVICES_VPN_ENABLED=false`: master сам не VPN-нода, но внешние ноды можно добавлять; свежий heartbeat активной ноды включает выдачу. Не отключать управление нодами вместе с пользовательскими VPN-кнопками.
- Корневой `index.html` может содержать пользовательские незакоммиченные изменения: при работе с сервисами не включать посторонние правки. Версию app.js меняйте точечно, если требуется обновление кеша после добавления сервиса.

- `back/src/telegram/handlers/services.js`: owner-only private-chat меню `/services`, бюджеты и grants через общие domain-функции. Exact reply/TTL защищают prompts от взаимного перехвата; регистрировать этот обработчик перед proxy/support message handlers. Telegram OAuth выключается отдельно от TELEGRAM_ENABLED.

- `back/src/service-api.js`, `services/search/agent_api.py`: scoped/revocable search keys, API search/fetch/history; `integrations/qubite-search/` содержит MCP и переносимый skill. Токены никогда не добавлять в git, URLs или логи.

- `services/search/grounding.py`: текущая UTC-дата, даты источников и один Jev для проверки ответа/визуализаций. Статусы advisory: не гарантировать истинность сайта, не запускать автоматические платные повторы. Free-only аккаунты не должны вызывать платную проверку.
- `/api/owner/services/search-analytics` → `/internal/analytics`: агрегаты ledger по моделям/аккаунтам/UTC-дням, только owner и внутренние секреты. Старые суммы сохраняются с неизвестной моделью.
- `integrations/kwork/`: независимый private bot, polling отдельно от worker. 👍/👎 — примеры предпочтений в SQLite, не обучение весов; не смешивать предыдущие отклики с контекстом новых заказов.
- `back/src/search-logs.js`: owner-only тексты запросов в отдельной таблице, не payload/summary общего аудита. Владельцы защищены по умолчанию. Защита аккаунта удаляет текст и блокирует вставки SQL-триггером/условием; не изменяет личную историю или ledger. Не раскрывать запросы модераторам/admin и не импортировать старую историю в служебный журнал.

- `services/search/search_engines.py`: ограниченный публичный каталог, реальные Server-Timing, merged engines. Не передавать одновременно `engines` и `categories`: SearXNG добавит defaults. Строгий safe search исключает неподдерживающие движки. `deploy/services/searx_defaults.py` задаёт бесплатные defaults для новой установки.
- `services/search/static/search-tools.js`: прямые HTTPS-картинки без Referer, fallback в SSRF-защищённый прокси; клиентские плееры только по точному allowlist хостов/ID. Не вставлять iframe_src/HTML из поисковой выдачи и не проксировать видео через Pi. Тесты: search pytest и `node --test services/search/tests/test_media.cjs`.
- `services/search/static/mobile-menu.js`: на ширине до 760px переносит существующий `.sidebar` в native dialog, возвращает его при закрытии/расширении окна. Кнопку меню не связывать с правом history; скрытые по правам элементы остаются скрытыми. Не дублировать DOM боковой панели или обработчики разделов.

- `back/src/writing.js`, `back/public/writing.*`, `integrations/qubite-writing/`, `deploy/services/languagetool.py`: независимые grants/ключи/бюджеты редактора. Локальные запросы `check`, платные операции `ai.*` нельзя смешивать в ledger. Тексты не логировать, ИИ только по кнопке, отмена не перезаписывает последующие правки. Firefox signature нужна отдельно; unsigned XPI нельзя выдавать за постоянно установленный. `docs/writing.md` и `back/tests/writing.test.js`.
- В фоне расширения `me` разрешайте по собственным runtime ID и URL `options.html`, не по отсутствию `sender.tab`: настройки тоже могут быть вкладкой. Регрессия: `back/tests/writing-addon.test.js`.

- `integrations/qubite-writing/firefox/highlights.js` — общий клиентский слой подчёркиваний расширения и `/writing` (через `/writing-assets/highlights.js`); UTF-16 offsets, mirror для input/textarea, Range для contenteditable. Не вставлять служебные span в DOM чужого редактора. При input снимать отметки, проверять исходный текст перед заменой, не допускать пересечения с чувствительными полями. Меню снаружи закрывать через composedPath, чтобы не закрывать его при клике внутри Shadow DOM.

- `services/specbot/`: личный Telegram-бот для интервью и PDF, отдельный от авторизации платформы. Единственный OWNER_ID управляет приглашениями; клиент закрепляется за хешированным start-токеном. PDF по умолчанию только владельцу. Haiku 5.5 `anthropic` → `google-vertex/global` с явными only/allow_fallbacks:false; ошибки ключа/402 не переключать. Компактный state + все ещё не учтённые реплики; не терять ручные ответы из-за усечения последних сообщений. Поздний ответ ИИ после смены revision не отправлять. Денежный ledger сохранять при удалении переписки. Голосовые — существующая функция Hermes, без собственного загрузчика моделей. `docs/specbot.md`, pytest `services/specbot/tests/`, unit `qubite-specbot`. На Pi memory cgroup отключён: не выдавать MemoryMax за проверенную защиту от OOM.

- Specbot хранит имя/@username клиента только из объекта Telegram User после проверки привязанного ID. Не передавать эти метаданные в промпт ИИ; owner получает уведомление первого входа и профиль в карточке. Пользователь без username остаётся идентифицирован по Telegram ID.

- Kwork → Brief: `kwork_brief.py`, локальный `services/specbot/bridge.py`, `docs/kwork-brief.md`. Только owner-кнопка готового отклика; callback лишь ставит job, worker без ИИ вызывает helper. `external_invites` + приватный HMAC-ключ восстанавливают один start-токен; `brief_links` хранит приватную ссылку/вариант для повторной доставки. Новые метаданные возвращаются существующим запросом Haiku; старые карточки — без платной регенерации. На Pi Kwork новее репозитория: применять `install_brief_hooks.py` точечно, сохранять prompt_versions/variants/attachments/аналитику. Не публиковать отклик; переговоры включаются только отдельной конфигурацией.

- Переговоры: `negotiation.py`/CLI/personal, `kwork_negotiation.py`, [инструкция](docs/kwork-negotiations.md). Только новые принятые Kwork-интервью; один проект на клиента. Не создавать ещё Telethon client/session/polling: hooks существующего tg-listener сохраняют blocklist и Hermes STT. Неизменные предложения подтверждаются owner в Kwork-боте, новая реплика/ТЗ отменяет старое разрешение. Unknown send → pause без повторов; failed AI → только явный retry. Контекст ограничен 65k байт, Luna после 100k не включать вопреки этому ограничению. Приватные конфиги/базы/сессии не читать в модель и не добавлять в git.

- В Specbot проверяйте error в JSON даже при HTTP 200 и finish_reason=error: временная ошибка Anthropic допускает единственный fallback на Google того же тарифа. Не переключать при 401/402; неизвестную стоимость учитывать резервом. Логировать только маршрут/код/категорию, никогда body или текст провайдерской ошибки.

- Specbot: focus — постоянный локальный приоритет интервью, спрашивается между названием и выдачей приглашения. steering — только следующий вопрос, не FINAL/then_final; снимать только после атомарного сохранения вопроса/outbox. steering_version защищает новое (в том числе идентичное) указание от завершения старого запроса. Миграции добавляют focus/version без потери переписки. Пропуск создания защищён owner/TTL/ticket; старые кнопки не создают второе приглашение.

- В Specbot recent_questions ограничены 12 фразами из 8 последних assistant-реплик, изолированы по session и не передаются в FINAL. Политика вопросов сверяет known_requirements и счётчик ответов, допускает черновик с открытыми деталями; не выдавать изменения промпта за гарантию отсутствия смысловых повторов.

- Haiku 5.5: $0.10/$0.50 за 1M вход/выход до 100k входных токенов, выше тариф растёт в пять раз. Specbot ограничен 65k байт, поиск — 90k байт сериализованного запроса; Writing и Kwork имеют короткие ограничения текста. При изменении модели пересчитывать резерв/ledger и max_price, не только строку model. Writing: Anthropic без платных повторов; поиск deep и Brief: Anthropic → Google, явные only, max_price и allow_fallbacks:false. MiMo Hermes и Jev не менять вместе с сервисами.

### Независимые процессы Auth и управление сервисами (09.10.2026)

- `back/src/auth-surface.js` переиспользует index/app.js для `/auth`; `front/auth.css` использует реальные токены темы Qubite. Не создавать вторую урезанную реализацию входа.
- `QUBITE_PROCESS_ROLE=auth` запускает отдельный Auth без основного workspace/бота. Platform не запускает embedded polling; `back/telegram-worker.js` — единственный control bot. Сервисы/редактор регистрируются до workspace gate.
- `back/src/service-runtime.js`, `back/src/telegram/handlers/runtime.js`, `deploy/runtime-manager.py`: фиксированный allowlist, owner/private chat, подтверждение, root-owned менеджер. Auth/сеть/SSH не выключать.
- `back/src/process-events.js` сохраняет поддержку/критичные уведомления при разделении процессов, private Unix sockets, без durable очереди.
- `back/src/knowledge-services.js`: только внешний доступ Memos/Vikunja; нативные аккаунты отдельные. `integrations/qubite-knowledge` — ограниченный MCP и skill Hermes.
- Есть целевые Node/Python тесты (`node --test back/tests/*.test.js`, `python3 -m unittest discover -s deploy/services/tests`); прежняя фраза о полном отсутствии тестов устарела. `npm test` по-прежнему не агрегирует их.
- [Операционная документация](docs/runtime-and-knowledge.md), включая новые env, cookie SSO, cgroup ограничения и backup.

- Memos/Vikunja: разрешение Qubite и одноразовый первый пароль через `/service-enroll`; root-owned `deploy/knowledge-manager.py`, отдельный `KNOWLEDGE_MANAGEMENT_SOCKET`. Повтор не сбрасывает пароль, чужой существующий логин не захватывается. [Инструкция для телефона/Arch](docs/knowledge-client-guide.md).

- `back/src/knowledge-api.js`: нативный login/Bearer/refresh проверяется по активной привязке и Qubite grant; не открывать общий API анонимно. Tunnel ingress должен сохранять прежние hostname+path маршруты, включая Kwork tracking.

- Вход нативных клиентов Vikunja: Qubite сохраняет путь и параметры `/oauth/authorize` через вход/первый пароль. Обмен PKCE-кода, вращение OAuth refresh и нативный cookie refresh проверяют активную привязку и grant перед возвратом токена. Переходы остаются на точном origin сервиса; callback в приложение выполняет сам Vikunja.

- `back/src/siyuan.js`: отдельный owner-only gate и серверная выдача native cookie; не добавлять SiYuan в grants/первый пароль Memos/Vikunja. `integrations/qubite-siyuan` ограничивает доступ одним блокнотом, не выставлять нативный токен/SQL модели. Native Docker-порт только loopback, Caddy проверяет каждую HTTP/WS сессию; [инструкция](docs/siyuan.md).

- Нативный AI SiYuan 3.8.6: `providers[]`, `/api/setting/setAI`, отдельные `agent.modelId`/`editing.modelId`. OpenRouter/Haiku подготовлены с пустым API key; не подставлять ключ другого сервиса. Нативный API канонизирует ID: проверять фактические привязки после записи. Сохранять остальные AI-разделы и policy, приватный backup 600; MCP Hermes не получает административные операции. Без ключа нельзя считать генерацию проверенной.

- Telegram-заявки: `leads.py`/CLI/personal, `kwork_leads.py`, `install_lead_hooks.py`, [документация](docs/telegram-leads.md). Только выбранные группы и реальные авторы; правила/blacklist, hash исходника перед DM, одна существующая сессия. AI импортировать лениво: venv listener не обязан иметь httpx. Не запускать helper при пустой очереди. Owner notifications — отдельный короткий путь `/notifications` helper, generation tick не возвращает их, чтобы не дублировать. Новые таблицы/связи: [схема](docs/telegram-leads-schema.md). Авто после 48 ч и 30 оценок, 27 одобрений/30, источник+явное приглашение+свежесть+Jev; это не обучение весов и не измеренная precision. Фидбек автоматических отправок не добавлять. PeerFlood → пауза; папки после verified send, сохранять другие чаты. Не давать агенту карту/платежи/пароли подписок.

- Telegram-заявки: `lead_bot.py` и `qubite-leadbot` — отдельный owner-only Bot API polling; приватный токен вне git. Новые публичные источники через `/sources`/`/addsource`, подключает существующий listener. Карточки Kwork/сообществ разделены по sid, manual «Нормальный заказ» разрешает отклик до суток, без снятия проверки автора/blacklist/бюджета.

- Карточки Telegram-заявок: публикация черновика+разрешение atomic после проверки актуальности, отказ во время ИИ не восстанавливает заявку. Та же owner-карточка редактируется по durable `lead.card.*`, после реальной отправки/отказа удаляется, обучение остаётся. Удалённая владельцем карточка обрабатывается без повтора клиенту.

- Jev/Haiku Telegram-заявок не получают соседнюю переписку. Сомнение/обсуждение → `uncertain`, исходник и кнопки без предварительного Haiku; явный найм и buyer≥.90/suitable≥.75 либо owner-good допускают черновик. Не считать `бот` совпадением внутри `работа`. Отрицательная обратная связь закрывает тихо. Legacy-cleanup собственных owner-карточек ограничен новым bot ID, 100 сообщениями, флагом и blacklist.

- `Store.listing` исключает учётные `telegram_leads.sid`; `Bot.authorize/current` не допускают клиента к ним даже при известном ID. Учётная сессия status=lead, invite истёк/token отсутствует; реальное интервью — отдельная запись. Не удалять usage при очистке таких записей.

### Qubite 2.0: Telegram и мониторинг (уточнение 12.10.2026)

Control bot полностью переделать с сохранением нужных capabilities; один независимый consumer. Турнирные settings/roles/moderation/analytics внутри Tournaments; global Users/Grants/AI/Analytics/Infrastructure в Owner Console, Support scoped отдельно. Матрица: docs/architecture/TELEGRAM_AND_OBSERVABILITY.md, ответы TG-1..6 записаны, foundation продолжается. Владелец указал заполненный deploy/.env для локального использования при необходимости; не выводить/коммитить секреты, no real keys в test harness. Runtime/platform/bot credentials не проверены самим наличием env.

Последнее решение 12.10.2026 (ADR-0007): нужные общие legacy функции реализуем на FastAPI/Postgres; permanent shared JS adapter отменён, Node/Auth лишь до verified cutover, tournament engine отдельно Node/SQLite. TG-1..6 закрыты: прежний bot, text/voice auto capture без меню (durable raw+scoped budget/undo), guest support+independent staff grants, service controls с confirmation, critical+daily уведомления с app links, агрегированная analytics. Читать TELEGRAM_CAPTURE_AND_NOTIFICATIONS. Не выдавать docs за работающий bot/UI.

Уточнение React scope 12.10.2026: все собственные included services, включая VPN/Writing/Search, получают React/TS и полностью новый дизайн; Tournaments сохраняет legacy Node/SQLite/Vanilla UI. ADR-0008 и SVC-* parity/API→UI задачи, roadmap now 49 tasks. TEST-001 и CORE-001 завершены; independent core foundation создан. DESIGN-001: прототипы опубликованы; итоговая витрина Поток/Игрушечная принята владельцем13.10.2026. Product UI/Auth/domain пока не реализованы. Сводный актуальный отчёт docs/reports/STATUS-2026-10-12.md.

QUB-TEST-001 done (12.10.2026, commit 6952277, CI run 38207835631 success): 25 настоящих server.js Auth HTTP tests с temp SQLite/source-copy и mocked external transport. Полный runner+harness 357 pass (Node94); [отчёт](docs/reports/QUB-TEST-001.md). Три `legacy defect` tests фиксируют нерешённые cookie/OAuth switch/unverified linking ошибки, не считать их безопасными требованиями нового Auth. Linking — P0 cutover gate. Legacy runtime не изменён; далее CORE-001 foundation завершён, registry/handoff источник статуса.

QUB-CORE-001 done (a85f047, CI38211426535 success): создан независимый `core/qubite` FastAPI foundation (live/ready/OpenAPI + explicit SQL migrations), пока без identity/domain/UI. [Документация](docs/architecture/CORE_FOUNDATION.md), [запуск](core/README.md), [report](docs/reports/QUB-CORE-001.md). Core tests требуют native initdb/postgres: verify.py --suite core/all --python <test-python> [--postgres-bin <bin>], missing binaries fail/no skip, fresh private cluster в /tmp. API startup не вызывает migration и не открывает legacy DB. Full local runner+harness386 pass; последующие migrations/cutover/deploy отдельно. DESIGN-001 Material Lab принят владельцем13.10.2026; product данные/React migration ещё не реализованы.


## DESIGN-001 / Поток — уточнение 13.10.2026

Владелец выбрал **Поток/Flux**, второй материал Milo. [ADR-0012](docs/architecture/decisions/0012-flux-design-system.md) и [контракт](docs/design/FLUX_DESIGN_SYSTEM.md): default FluxStudio — единая витрина компонентов, пять палитр без dominant purple, 5 heading/5 body choices, пять SVG logo families ×12 назначений, 22 UI icons, refined gaze/8 scripted states/3 speech patterns. Layout приложения не финализирован; Поток/Игрушечная/Лента/Unbounded/Manrope приняты, production device checks отдельно. Настройки in-memory. Legacy hash-сцены сохранены, тестировать явно по маршрутам. Shared sleeping RAF/timed selection/2D pill/lightweight coarse renderer, no actual AI/service integration. Сценарии hidden/edge peek/contextual appearance/retreat — требования PET-001/002, точные места/условия обсуждаются при разработке. Skills/reset не использовать в текущем дизайн-цикле. Private demo publication разрешена, live Qubite deploy отдельно. Следующий рекомендуемый ready bounded cycle AUTH-008; UI dependency gates не снимать.

13.10.2026, DESIGN-001 итерация04: владелец по скриншотам выбрал **Ленту, Unbounded (заголовки), Manrope (текст), ритм100/503**. Это defaults; типографику/семью не переспрашивать. Прежняя палитра отвергнута; [Цветной пластик](docs/design/COLOR_PLASTIC.md) фиксирует пять новых семантических наборов action/select/idea/success и распределение цвета по всему specimen. После просмотра версии4 владелец выбрал **Игрушечную** и поручил сохранить; DESIGN-001 done. Final product layout/device checks отдельно. Старые решения о персонажах/edge scenarios/правах сохраняются.

- `core/qubite/policy/`, `core/qubite/sql/0006_policy.sql`: independent grants/workspace/resource ACL, short exact session-bound internal delegation, owner versioned commands и WS probe. `core/tests/test_policy.py`, `contracts/policy-v1.json`, docs/architecture/POLICY_GATE.md. Domain modules/registrar/installer/Console UI/budget dispatcher отдельно, implicit owner/paid bypass отсутствует.
