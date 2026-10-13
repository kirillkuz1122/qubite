# Deploy Qubite 2.0 — будущий installer

Этот каталог принадлежит новому deploy track. Заполненный deploy/.env оставлен по требованию владельца13.10.2026, не удалён/не изменён и ignored; он содержит старые настройки, не загружается новым core. Новый незаполненный core шаблон — ../.env.example. Не source старую конфигурацию для нового API.

Старые installer/Nginx/Caddy/proxy/firewall/services scripts перенесены в [legacy/qubite-v1/deploy](../legacy/qubite-v1/deploy/). Legacy `install.sh --plan` проверяет пути; real installation старого сайта отдельно, с explicit private env file. Новый install.sh здесь ещё не реализован, старый не маскируется под него.

Обязательные будущие задачи: DEPLOY-001 новая спецификация/OS/package/subdomain manifest; DEPLOY-002 fresh installer с selectable modules, optional standalone Tournaments, отдельными data/env/units, explicit PG migrations/interactive owner setup, dry-run/rollback/backup/restore; DEPLOY-003 безопасное управление установкой модулей из Owner Console через operator allowlist, без arbitrary shell. Владелец сможет выбирать компоненты и параметры; точная механика обсуждается до соответствующей задачи. Production deployment не разрешён этим переносом. [Требования](../docs/engineering/DEPLOYMENT_AND_BACKUPS.md).
