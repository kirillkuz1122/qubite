# ADR-0001: стек нового core и границы legacy

CONFIRMED 12.10.2026 ответами владельца 1–2: Python/FastAPI, React/TypeScript, PostgreSQL для нового core. Qubite Tournaments сохраняет SQLite и текущий Node writer на этапе выделения модуля. Новый modular monolith и bounded worker рядом с legacy; pgvector отдельным POC позже, без обязательных Kafka/Redis/Kubernetes.

Согласование стека позволяет готовить небольшие локальные foundation задачи. Оно не разрешает массовую перепись, перенос live данных или деплой. Выбор хостинга отложен; возможен VPS. Raspberry Pi не определяет архитектуру.

Auth: делегированное владельцем решение — сначала переиспользовать серверный Auth с новым UI и упрощением flow, затем отдельный перенос identity authority в Python/Postgres. Подробности и критерии в [ADR-0005](0005-identity-transition.md).

Альтернатива Express/SQLite foundation рассмотрена, не выбрана. Последствия выбранного пути: временно два runtime/store, explicit identity mapping, no dual writes. Перед миграцией/деплоем — inventory/drift, ресурсы фактически выбранного сервера, backup/restore, staging и rollback; локальный core этих серверных проверок не ждёт.
