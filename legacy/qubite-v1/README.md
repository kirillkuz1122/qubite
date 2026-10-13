# Qubite Tournaments — самостоятельная legacy-платформа

Node.js/Express, SQLite и прежний Vanilla интерфейс сохранены. Здесь находятся back/front, все 11 старых HTML (включая legal/404/maintenance), старый deploy и учебные материалы. Общие старые service handlers также сохранены для совместимости исходников; они не становятся новыми сервисами Qubite 2.0.

Последнее решение владельца13.10.2026: турнирный сайт самостоятельный и опциональный. Собственные legacy аккаунты/роли/сессии/SQLite; никаких SSO, общих UUID, cookies, grants или чтения БД core. Будущий новый installer сможет отдельно выбрать этот компонент и его поддомен. Сейчас DNS/новая установка не настроены. [Описание компонента](../../modules/tournaments/README.md).

## Локальный запуск

Из корня репозитория:

```sh
npm ci --prefix legacy/qubite-v1/back
node legacy/qubite-v1/back/server.js
```

Конфигурация старого приложения — env процесса, optional explicit QUBITE_LEGACY_ENV_FILE и локальный legacy .env. При переносе прежний root .env сохранён здесь приватно; startup может загрузить его. Для безопасных экспериментов использовать harness/isolated fixtures, а не этот файл. Заполненный deploy/.env по прежнему пути в корне не удалён и не автоматически подключён к новому core.

## Установка старого приложения

```sh
bash legacy/qubite-v1/deploy/install.sh --plan
```

Plan без sudo, network, env values и системных изменений. Реальная legacy установка — отдельно утверждённый запуск `sudo bash legacy/qubite-v1/deploy/install.sh --env-file /private/legacy.env`; предполагает apt-based сервер и меняет system services. Меню прямо называет legacy platform и прежние сервисы; оно не устанавливает FastAPI core. Исправленные пути проверены в fixtures/plan; реальная серверная установка не выполнялась.

Старые документы в docs/, pre-move repository notes в docs/repository-notes/. Они сохраняют исторические особенности/дефекты и не разрешают новую интеграцию. Реальные нужны данные/SQLite/uploads сохранить отдельно перед любым deploy.
