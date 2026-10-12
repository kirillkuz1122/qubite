# ADR-0001: новый core и legacy authority

Статус RECOMMENDED, OPEN QUESTION до обсуждения. Context: текущие Node/SQLite монолиты и самостоятельные сервисы уже работают, предпочтения владельца Python/React, выбор хостинга отложен владельцем 12.10.2026, возможен VPS. Ограничения Raspberry Pi не являются архитектурным gate.

Рекомендация: FastAPI modular monolith + React/TS PWA, новый Postgres в изолированном dev-окружении после согласования стека; legacy Auth и Tournaments authority сохраняются. pgvector не в первом slice. Небольшой worker jobs, без Kafka/Redis.

Альтернатива: сначала policy/core в Express/SQLite. Меньше RAM/runtime/bridge сложности, больше coupling к текущим ролям и migrations. Этот путь остаётся альтернативой при выборе владельцем более простого перехода; нехватка ресурсов Raspberry Pi сейчас не основание выбирать его.

Последствия: bridge/audience/revoke mapping обязательны; два datastore временно; no dual writes. Перед миграцией/деплоем на выбранный сервер выполнить OPS-001 и backup/restore POC. Проверить: simultaneous idle/peak RSS, queue age, swap pressure, free disk и restore время. Числовые budgets/performance target согласовать, не считать запуск доказательством устойчивости. Reversal routing без уничтожения original DB.
