# ADR-0001: новый core и legacy authority

Статус RECOMMENDED, OPEN QUESTION до обсуждения. Context: текущие Node/SQLite монолиты и самостоятельные сервисы уже работают, предпочтения владельца Python/React, Pi 4GB указан docs, capacity не измерена.

Рекомендация: FastAPI modular monolith + React/TS PWA, новый Postgres после isolated capacity/backup POC; legacy Auth и Tournaments authority сохраняются. pgvector не в первом slice. Небольшой worker jobs, без Kafka/Redis.

Альтернатива: сначала policy/core в Express/SQLite. Меньше RAM/runtime/bridge сложности, больше coupling к текущим ролям и migrations. Если Pi не проходит measured gate или owner выбирает минимальный runtime, предпочесть этот путь и сохранить typed contracts.

Последствия: bridge/audience/revoke mapping обязательны; два datastore временно; no dual writes. Revisit после OPS-001: simultaneous idle/peak RSS, queue age, swap pressure, free disk и restore время. Числовые budgets/performance target согласовать, не считать запуск доказательством устойчивости. Reversal routing без уничтожения original DB.
