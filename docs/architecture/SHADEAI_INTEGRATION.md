# ShadeAI: read-only аудит будущего адаптера

ПРОВЕРЕНО КОДОМ 12.10.2026: /home/kirill/programing/ShadeAI, SHA 3b34be7210fd5c4b3efb661abb8a2440b8fb6451. Файлы не изменялись, зависимости/модели не устанавливались, сервис не запускался. AGENTS, README, карта core/android/web, API, config, db models и event bus прочитаны. Правило Zero-Cloud/4GB сохраняется.

Core — FastAPI, async SQLAlchemy SQLite; NotificationRaw/events_log; EventBus asyncio.create_task без durable delivery. LLMEngine/StubLLMEngine — интерфейс и заглушка; health возвращает llm_status=not_loaded. notifications ingest сохраняет запись и вызывает process_notification, status queued сам по себе не доказывает рабочий background pipeline. HAClient делает REST action; привычки/полный локальный интеллект не реализованы. React/Vite dashboard и Kotlin/Compose Android существуют; новые аппаратные проверки не проводились. Старый отчёт TASK-03 подтверждает эмулятор, не телефон.

| Текущий API | Защита | Будущая операция адаптера |
|---|---|---|
| GET /api/v1/health | открытый, проверяет HA до 2s | integrations.shade.status; короткий timeout/circuit breaker |
| GET /api/v1/notifications | Bearer SHADE_API_KEY | opt-in ingest выбранных событий с provenance; не все тексты уведомлений |
| POST /api/v1/notifications | Bearer | разрешённый capture, dedupe вне legacy API |
| POST /api/v1/ha/action | Bearer, domain/service/entity_id/data | только allowlist конкретных действий + approval; legacy API широк, gateway обязан сузить |

Рекомендация: независимый connector, никак не import кода/SQLite. Qubite token → entitlement + action ACL → адаптер с отдельным локальным Shade credential → проверенный локальный endpoint. Ключ не доступен LLM/MCP/client. Опасные действия запрашивают подтверждение конкретных параметров, timeout неизвестной доставки не повторяется автоматически. Нужны adapter contract tests с fake HA/Shade, revoke, injection, duplicate/unknown outcome. Никаких внешних AI-вызовов из Shade по факту включения интеграции.

Открыто: локальный reachability, доступный серверный scope, перечень безопасных entity/service, согласие на события уведомлений, будущий event API вместо polling. QUB-INT-001 — исследование/контракт; подключение в позднем релизе.
