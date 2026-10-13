# Qubite 2.0 — старт сессии

Всегда отвечать на русском. Qubite — универсальная платформа, а не турнирный проект. Последнее решение владельца13.10.2026: старый сайт/VPN/deploy/учебные материалы в `legacy/`; оставшиеся сервисы — референсы для отдельного нового проектирования; каждый модуль на поддомене; Tournaments — самостоятельная опциональная платформа без нового SSO. [ADR-0021](docs/architecture/decisions/0021-repository-layout-and-standalone-tournaments.md), [структура](docs/architecture/REPOSITORY_LAYOUT.md), [handoff](docs/project/LAST_HANDOFF.md).

## Перед каждой задачей

Сначала задать владельцу вопросы о решениях/границах и дождаться ответов. Подтверждение этой задачи не разрешает следующую. Новые ответы владельца имеют приоритет над историческими источниками и ADR. Читать актуальные [PROJECT_CONTEXT](docs/project/PROJECT_CONTEXT.md), LAST_HANDOFF, [tasks.json](docs/plan/tasks.json), [ADR](docs/architecture/decisions/README.md), [аудит](docs/architecture/CURRENT_STATE.md), [Harness](docs/engineering/AGENT_HARNESS.md).

Полные исходные документы владельца: [kickoff](QUBITE_AGENT_KICKOFF_PROMPT.md), [master](QUBITE_MASTER_CONTEXT.md), [access](QUBITE_ACCESS_AND_OWNER_CONSOLE.md). V2 kickoff отсутствует; не объявлять его прочитанным. Источники не переписывать вместо решений; поправки записывать в ADR/проектный контекст. Исторические milestone snapshots не текущий статус.

## Фактическое состояние

- Новый runtime: `core/qubite/`, FastAPI/Python + PostgreSQL, 0.6.0/schema0007_registration. AUTH-002/009/010/011/003/005/006 реализованы в своих границах, identity-v2 partial; реальные providers/SMTP/native/auth screens ещё отдельно.
- Нет действующих аккаунтов/деплоя по сообщению владельца13.10; fresh identity, без импорта паролей/сессий/legacy bridge. Singleton owner создаётся explicit local CLI, пароль только TTY/getpass; startup не создаёт owner и не мигрирует БД.
- Новый UI: `apps/web/`0.1.0 partial shell, live identity/grants через core API; demo roles/capture/visibility только compile-time dist-demo, не runtime permission switch. Fixed Qubite Command/Lite; owner entry settings. Server catalog hidden/locked UI-003 перед Console AUTH-004; следующая AUTH-007 требует новых вопросов. [ADR-0022](docs/architecture/decisions/0022-web-shell-and-command.md).
- Новый UI — React/TypeScript; утверждены Поток/Игрушечная/Лента/Unbounded/Manrope100/503. `assets/design-lab/` — прототип, не production приложение. Web/Android/Linux desktop и новый deploy/installer обязательны, механизм после своих POC.
- Owner использует обычную главную; отдельная Owner Console. До ручных grants только аккаунт/профиль/настройки; read/write/manage раздельны. Общий server gate и default deny; paid AI закрыт до budget/dispatcher задач. Owner не получает paid bypass.
- `services/` и `integrations/` — старые реализации с [реестром](docs/legacy-services/README.md). До нового API/прав/дизайна/test acceptance не подключать их напрямую к core. Search/Writing/VPN/Brief/Kwork сначала новое обсуждение/проектирование; не ограничиваться сменой стиля. Старый Knowledge — адаптер native Memos/Vikunja, не готовый новый Atlas; SiYuan не включать в продукт.
- Самостоятельный Tournaments: `modules/tournaments/manifest.json` описывает `legacy/qubite-v1`. Node/SQLite/Vanilla UI и собственный legacy Auth; не общие UUID/cookies/grants Qubite. Реальной новой установки/host routing пока нет. Старые API/бот/служебные сервисы сохранены для parity, а не объявлены новыми модулями.

## Пути, данные и проверки

Корень: новая документация/apps/web/core/contracts/assets/scripts/tests. Старые HTML/legal, back/front и deploy в `legacy/qubite-v1/`. Старый Flutter клиент в `legacy/qubite-vpn/`. Старые инструкции сайта в `legacy/qubite-v1/docs/`; сервисные справки в `docs/legacy-services/`. Карта каждого переноса и контрольные суммы — [manifest](docs/migration/RELOCATION_MANIFEST.json).

Не удалять заполненный `deploy/.env`. Корневой `.env` по прямому запросу владельца заменён незаполненным новым шаблоном; прежний сохранён в `legacy/qubite-v1/.env`. Все секретные env/DB/runtime/uploads/browser state вне Git. Core не загружает env-файлы автоматически. Не переносить секреты между новым и старым Auth. Не запускать installers, polling, network providers/платные запросы или live migrations по результатам source tests.

`python3 scripts/engineering/check.py`; `python3 -m unittest discover -s tests/engineering`; `python3 scripts/engineering/verify.py --suite all --python <test-python>`. Runner использует source-copy без env, isolated HOME/SQLite/реальный disposable PostgreSQL и no external network. Legacy Node dependencies: `npm ci --prefix legacy/qubite-v1/back`. Node `npm test` не проверка; использовать harness. Не создавать тесты, которые лишь повторяют реализацию; relocation checks нужны против потери файлов/путей.

UI дополнительно: npm ci / format:check / build / build:demo / Playwright в apps/web; web.yml и engineering.yml exact SHA обязательны. Browser API fixtures не real browser/backend/device acceptance.

Подробные старые операционные заметки сохранены в [историческом AGENTS](legacy/qubite-v1/docs/repository-notes/AGENTS.md). Для изменений legacy читать также `legacy/qubite-v1/AGENTS.md`; монолиты server/db/app не перечитывать целиком, использовать rg по сигнатурам. Не переносить их глобальные роли/paid bypass в core.

## Git и завершение

Работать main, один одобренный bounded task. Before/staged review, tests, docs/evidence, русский коммит без conventional prefix, немедленный push origin main. Не включать чужие правки/секреты. Не force-push/reset --hard/удалять архив. `tournaments` и `qubite-v1.0` immutable96f0457a523b6b79f21c4092056d8fa8fa69a680. Проверять actual CI exact SHA, не смешивать unit/mocks с реальной приёмкой устройств/сервера.

Push не deploy. Production отдельно после явного разрешения, inventory/backup/restore/staging/checks; сервер/VPS пока отложен. ShadeAI `/home/kirill/programing/ShadeAI` только read-only. Не применять skills/subagents/quota reset по прямому указанию владельца. Проектную память/решения сохранять в docs/project и ADR; личную память агента не менять.
