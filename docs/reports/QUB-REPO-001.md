# QUB-REPO-001 — отделение старого проекта

Дата: 13.10.2026. Основание — ответы владельца до реализации и дополнительное указание заменить корневые env новым пустым шаблоном. [ADR-0021](../architecture/decisions/0021-repository-layout-and-standalone-tournaments.md), [план переноса](../migration/REPOSITORY_REORGANIZATION.md).

## Выполнено

| Исходники | Текущее место и назначение |
|---|---|
| Старые back/front, 11 HTML/legal/error страниц, deploy, учебные материалы | `legacy/qubite-v1/`: самостоятельный старый сайт |
| Flutter VPN, native исходники и сохранённые старые сборки | `legacy/qubite-vpn/`: reference, работоспособность сборок не подтверждалась |
| SiYuan | `legacy/integrations/qubite-siyuan/`: исключён из нового продукта, сохранён |
| Старые руководства сервисов | `docs/legacy-services/`: явно помечены как reference |
| Search, Brief/specbot, Kwork, Search/Writing/Knowledge integrations | Оставлены на месте, README со статусом и отдельные задачи на новое проектирование |
| Новый FastAPI core, contracts, React design lab | Сохранены на прежних местах; runtime не изменён |
| README, AGENTS, CLAUDE, SECURITY, TODO, индекс docs | Переписаны вокруг универсального Qubite; прежние версии сохранены в `legacy/qubite-v1/docs/repository-notes/` |

Перенесены **368 отслеживаемых файлов**. [Manifest](../migration/RELOCATION_MANIFEST.json) содержит old→new и исходные SHA256; каждый изменённый при переносе файл имеет явную причину. HTML, front, scoring/database code и native binary sources сохранены без изменения. Единственная runtime-копия турнирного сайта — в legacy; `modules/tournaments/manifest.json` является описанием компонента, не второй копией приложения. [Классификация](../migration/CODE_ORIGIN.json) отделяет new runtime/specification/prototype/legacy reference/archive.

Турниры теперь **самостоятельная опциональная платформа**: Node/SQLite/Vanilla, собственные аккаунты/роли/сессии, без core SSO/UUID/grants/data. Это отменяет прежний план общего identity adapter. Поддомены новых модулей согласованы; конкретный домен, DNS/TLS и session handoff не настраивались.

## Пути и конфигурация

Обновлены только необходимые legacy path helpers, Writing downloads/assets, тестовые fixture paths, CI npm cache/install и source-copy runner. Старый installer явно устанавливает legacy, различает корень сайта и корень reference services, принимает explicit private env-file. Добавлен nonmutating `--plan`, доступный без sudo и чтения значений env. Исполнения реального installer/systemctl/apt/network не было.

Заполненный **`deploy/.env` сохранён по исходному пути без изменения**: приватное сравнение SHA256 подтвердило совпадение. Прежний корневой env сохранён в `legacy/qubite-v1/.env`, также с совпадением SHA256. Новый root `.env` — незаполненная копия нового `.env.example`, mode0600. Все private env ignored, не предназначены для коммита. Шаблон использует только текущие `QUBITE_CORE_*`; URL/origin/provider credentials пусты, network/mail выключены. Core по-прежнему читает env процесса, без автоматической загрузки файла.

## План следующих задач

Добавлены шесть отдельных discovery-задач: SEARCH/WRITING/VPN/BRIEF/KWORK/KNOWLEDGE-000. Перед каждой — вопросы владельцу, сценарии и связи модулей, затем новый API/permission/data/UI контракт и небольшие implementation tasks. Старое приложение не подключается к core простой сменой URL или оформления.

DEPLOY-001/002 предусматривают новый каталог deploy и selectable installer, поддомены, optional Tournaments, explicit PostgreSQL migrations и interactive owner setup. Сам owner bootstrap/password CLI уже реализован ранее; installer orchestration ещё нет. DEPLOY-003 отдельно планирует restricted operator для установки модулей из Owner Console. Следующее продуктовое обсуждение — **UI-001 оболочка**, затем AUTH-007 auth screens. Разрешение текущего переноса не утверждает следующие задачи.

## Проверки и evidence

Статус: **review/testing**. Полная локальная регрессия завершена успешно; commit/push/exact SHA CI ожидаются.

- 11 engineering guards проходят: карта сохранности, независимый manifest, root cleanup, безопасный installer plan из чужого cwd, явный fixture env до установки, blank core template и ignore env.
- Node99, deploy18, Search95, Brief112, Kwork29, archived SiYuan5, identity32 проходят после переноса.
- Core575 (208+165+202) прошли с реальным disposable PostgreSQL и явными binaries `/tmp/qubite-design-postgres/usr/bin`; системный PostgreSQL не запускался и не устанавливался. Полный harness965 + engineering11 = **976 pass**, no failed/skipped. Local Python3.13.13/Node22.22.2/PG18.6; core группы29.00/51.58/84.52s, каждая <180s.
- Bash syntax19 scripts, check.py67tasks/82docs и `git diff --check` проходят. Protected env проверены приватно; значения не выводились.

В новых relocation тестах исправлены две обнаруженные проблемы: source-copy теперь включает публичные guides из docs для Writing; fixture готовности HTTP игнорирует дополнительный Unix IPC listener платформы. В первом полном запуске не был указан путь extracted PG binaries: prerequisite fail без skip; повтор завершён успешно с явным `--postgres-bin`. Эти неуспешные попытки не считаются pass.

Архивные `tournaments` и `qubite-v1.0` проверены на origin перед переносом и повторно перед коммитом: `96f0457a523b6b79f21c4092056d8fa8fa69a680`. Base main: `e83ba0fc08dea44682ba45d2990f085b2321e7d4`. Отдельное удаление external tooling `.antigravitycli/*.json` не относится к задаче и не включается в коммит. Runtime DB/uploads/секреты не коммитятся; миграция данных, реальные providers/бот/native acceptance и production deploy не выполнялись.

## Откат

До установки — обратный перенос по manifest с проверкой коллизий и отдельным сохранением private env/DB/uploads. Git revert не восстанавливает игнорируемые данные; сначала сохранить их. Не менять архивные refs, не force-push и не reset --hard. Core runtime/schema0.6.0/0007_registration остаются прежними.
