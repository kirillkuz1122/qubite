# Сохранённые старые приложения

Этот каталог отделяет старые реализации от нового Qubite 2.0. Код не удалён и не автоматически подключён к новому ядру. Immutable Git branch tournaments/tag qubite-v1.0 сохраняются отдельно и не изменяются этим переносом.

- [qubite-v1](qubite-v1/README.md): старый сайт, турнирный runtime/SQLite/Vanilla, собственные аккаунты, прежние сервисные handlers/бот и установка.
- [qubite-vpn](qubite-vpn/README.md): старый Flutter VPN-клиент с native adapters и сохранёнными готовыми сборками. Работоспособность на устройствах здесь не заявляется.
- [SiYuan](integrations/qubite-siyuan/README.md): сохранённый MCP bridge; по решению владельца не нужен в Qubite 2.0.

services/integrations вне legacy остаются old reference, а не новый runtime: [карта](../docs/legacy-services/README.md). Новые модули проектируются заново с вопросами владельцу и общим core API. Не переносить legacy роли/токены/бюджеты в новую платформу автоматически.
