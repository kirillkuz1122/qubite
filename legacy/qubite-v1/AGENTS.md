# Работа со старым Qubite

Сначала читать корневой AGENTS.md и текущую задачу. Здесь standalone legacy Node/Express/SQLite/Vanilla приложение, отдельные аккаунты и роли. Не подключать его Auth/paid owner bypass к новому core. Архивную Git ветку tournaments/tag не менять.

Монолиты back/server.js, back/src/db.js, front/js/app.js править только по сигнатурам через rg, без массовой переписи. Относительная ROOT_DIR — этот legacy каталог; shared reference assets Writing задаются через явный REPOSITORY_DIR. Данные/секреты/env/node_modules не включать в Git. Legacy installer после переносов запускается только из deploy внутри этого каталога; `--plan` проверяет пути без установки. Real deploy/polling отдельно разрешаются владельцем.

Для проверок использовать root scripts/engineering/verify.py; source-copy excludes env, temporary SQLite/PG/HOME. Известные старые AUTH-L01/L02/L03 и устаревшие native guides не исправлены этой задачей. Исторические подробные notes: docs/repository-notes/AGENTS.md. Старые сервисы не являются runtime нового продукта.
