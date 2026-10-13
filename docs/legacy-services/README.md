# Старые сервисы — источники для нового проектирования

LEGACY REFERENCE13.10.2026. Эти исходники остаются на месте по решению владельца, их смысл/полезные алгоритмы сохраняются как референс. Интерфейсы, API и взаимодействие модулей Qubite 2.0 проектируются заново после вопросов владельцу. Нельзя просто обернуть старые endpoints или перекрасить HTML и считать миграцию выполненной.

| Источник | Статус | Новый track |
|---|---|---|
| services/search, integrations/qubite-search | Старый внешний поиск, SQLite/static UI/old service Auth | QUB-SVC-SEARCH-000→001→002; связи Command/Docs/Projects/источники/новый core API |
| legacy/qubite-v1/back/src/writing.js, integrations/qubite-writing | Старый Writer/LanguageTool/addon, старые grants/keys | QUB-SVC-WRITING-000→001→002; общий core API, новый editor/diff |
| legacy/qubite-v1/back/src/proxy, legacy/qubite-v1/deploy/proxy, legacy/qubite-vpn | Старые VPN server/client/OS mechanisms | QUB-SVC-VPN-000→001→002; новый core management API и React, native tunnel отдельно |
| services/specbot | Старые Brief/spec/leads/negotiation и Telegram flows | QUB-SVC-BRIEF-000; новое обсуждение → Docs/Projects/Inbox/Finance связи |
| integrations/kwork | Старые parser/worker/bot и preference examples | QUB-SVC-KWORK-000; новая спецификация bounded adapter, никаких внешних sends этой задачей |
| integrations/qubite-knowledge | Старый MCP gateway к native Memos/Vikunja | QUB-SVC-KNOWLEDGE-000; не новое ядро/Atlas, выбрать нужные возможности; свои Docs/Planner сохраняются |
| legacy/integrations/qubite-siyuan | Сохранённый архив по решению владельца, в продукт не включать | Новых задач интеграции нет |

Сервисные Markdown здесь — старые руководства с явно указанным статусом. Текущий audit/API inventory хранит историческую baseline и карту перемещения; новые API требуют отдельного проверенного контракта, единого Auth/policy/budget/events/objects. upstream/master/bot/node secrets отделены от аккаунта Qubite.

Каждое discovery task: вопросы → пользовательские сценарии → какие старые функции оставить/выкинуть/развить → связи модулей → typed core API/permissions/data authority → маленькие implementation slices с acceptance. Ответы не переносятся автоматически на следующий сервис. Сами сервисы и инструкции здесь не live deployment; source tests/installed runtime/device acceptance различаются.
