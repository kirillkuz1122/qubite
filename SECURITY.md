# Безопасность Qubite 2.0

Новый security authority — FastAPI/PostgreSQL core. Регистрация не выдаёт module/AI grants; роли турниров не глобальны. Owner status только singleton local bootstrap, owner платные запросы проходят общий gate. Пароль через getpass, не env/argv/чат; startup не создаёт owner/не применяет миграции.

Web cookies host-only, Secure/HttpOnly/Lax, CSRF/Origin и live session checks. OAuth default disabled/network-off, explicit stable identity link; email не соединяет аккаунты. Почта пока mock-only. Runtime contracts: [Web Auth](docs/architecture/WEB_AUTH.md), [policy](docs/architecture/POLICY_GATE.md), [registration](docs/architecture/REGISTRATION.md). Текущая проверка не подтверждает public TLS/production/provider acceptance.

## Старые компоненты

`legacy/` и reference services имеют собственные старые разрешения и известные дефекты. Tournaments отдельный сайт/SQLite/Auth, без импорта или общего cookie Domain. Новый поддомен не даёт право считать старый endpoint API нового core. SiYuan исключён; native Knowledge адаптер не новый Atlas. См. [реестр компонентов](docs/architecture/REPOSITORY_LAYOUT.md) и [legacy security snapshot](legacy/qubite-v1/docs/repository-notes/SECURITY.md).

Перед включением любого перепроектированного сервиса обязательны отдельный API contract, общий policy/budget gate, scoped tokens, negative cross-resource tests и обсуждение владельца. Native VPN/OS capabilities не заменяются React. Перед будущей интеграцией проверить SSRF/allowlists и отсутствие вывода полных приватных текстов в logs.

## Секреты и развёртывание

Заполненный `deploy/.env` сохранён приватно. Новый `.env.example` не содержит ключей; новый корневой `.env` такой же незаполненный шаблон и ignored. Прежний корневой env хранится только в `legacy/qubite-v1/.env`, ignored. Core не читает env-файлы автоматически. БД, загрузки, private configs, browser sessions, caches и build outputs не добавлять в Git.

Test runner копирует исходники без env, создаёт временные DB/HOME/PG и запрещает external network. Старые installers не запускать для нового core; `--plan` legacy installer не устанавливает пакеты и не читает значения secret env. Новый installer/Owner Console module install ещё не реализованы. Push — только код/CI; production deployment отдельно с backup/restore и разрешением владельца. Immutable archives и сохранённые бинарные VPN-сборки не подтверждают доверенную сборку или отсутствие старых секретов в Git-истории.
