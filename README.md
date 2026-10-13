# Qubite 2.0

Qubite — универсальное персональное пространство для заметок, документов, учёбы, проектов, планирования и AI-помощников. Модули используют общие аккаунты, разрешения, связи объектов и API. Турниры сохранены как самостоятельная опциональная старая платформа.

## Что уже создано

В `core/` работает независимое FastAPI/PostgreSQL ядро 0.6.0: explicit migrations0001..0007, аккаунты и local owner bootstrap, Web Auth, OAuth linking, verification/reset protocol, ручные разрешения и регистрация с приглашениями. Реальная почта, production ingress и интерфейс Owner Console ещё не созданы.

В `assets/design-lab/` — принятая React/TypeScript витрина Поток/Игрушечная/Лента, Unbounded/Manrope. В `apps/web/` создана первая оболочка приложения с проверкой аккаунта/прав через API. Формы входа, настоящие входящие, каталог настроек на сервере и сервисные модули — следующие задачи. Сайт, Android и Linux desktop обязательны; Windows/macOS — дальнейший portable track.

## Карта репозитория

| Каталог | Статус и назначение |
|---|---|
| `apps/web/` | Новая React оболочка0.1.0; live/demo отдельны, ещё без auth forms/domain writes |
| `core/`, `contracts/` | Новое ядро и проверяемые API-контракты; planned routes обозначены отдельно |
| `docs/` | Требования, архитектура, задачи, решения, отчёты и память проекта |
| `assets/design-lab/` | Дизайн-прототип, не рабочий клиент API |
| `scripts/engineering/`, `tests/` | Development Harness и проверки |
| `services/`, `integrations/` | Старые сервисы/референсы; ещё не модули нового ядра |
| `modules/tournaments/` | Описание самостоятельного optional legacy-компонента, без SSO/core grants |
| `legacy/qubite-v1/` | Старые Node/Express/SQLite, Vanilla UI, HTML/legal и deployment |
| `legacy/qubite-vpn/` | Старый Flutter VPN-клиент и сборки, не новый клиент Qubite |
| `legacy/integrations/qubite-siyuan/` | Сохранённая интеграция SiYuan, исключённая из нового продукта |
| `deploy/` | Место будущего нового installer; сейчас описание и приватный старый `.env` |

## Начало работы

- [Запуск нового core и создание owner](core/README.md).
- [Запуск оболочки и её демо](apps/web/README.md).
- [Дизайн-витрина](assets/design-lab/README.md).
- [Самостоятельные турниры и их legacy installer](modules/tournaments/README.md).
- [Карта оставшихся старых сервисов](docs/legacy-services/README.md).
- [Документация](docs/README.md), [задачи](docs/plan/tasks.json), [последний handoff](docs/project/LAST_HANDOFF.md).

```sh
python3 scripts/engineering/check.py
python3 -m unittest discover -s tests/engineering
python3 scripts/engineering/verify.py --suite all --python <test-venv-python>
```

Core читает только переменные процесса. Корневые `.env.example` и незаполненный `.env` — новый шаблон core; автоматической загрузки нет. Заполненный `deploy/.env` сохранён по требованию владельца и не используется новым core. Прежний корневой `.env` сохранён приватно в `legacy/qubite-v1/.env`; секреты/БД/загрузки в Git не включаются.

## Границы разработки

Все продуктовые модули планируются на поддоменах одного выбранного домена, с общим React/FastAPI ядром. Точное имя домена, TLS, ingress и module session handoff ещё не настроены. Tournaments — самостоятельная платформа: свой вход, свои данные и роли, без связи аккаунтов с Qubite 2.0; установка опциональна. Это последнее решение владельца13.10.2026 по [ADR-0021](docs/architecture/decisions/0021-repository-layout-and-standalone-tournaments.md).

Перед каждой задачей — вопросы владельцу и ответы, затем один цикл: реализация → тесты → проверка → документация → русский коммит → push. Push не deploy. Архивная ветка `tournaments` и тег `qubite-v1.0` неизменны на `96f0457a523b6b79f21c4092056d8fa8fa69a680`.
