# ADR-0013 — новый единый аккаунт без переноса legacy identity

13.10.2026. **CONFIRMED пользователем:** существующих аккаунтов для переноса нет; прежний owner можно создать заново; проект сейчас нигде не запущен и действующего деплоя нет. Разрешено менять вход Search и остальных собственных сервисов, создать единый API. Это уточнение заменяет предположение о работающем legacy Auth/обязательной совместимости в ADR-0001/0005/0007 и плане миграции. Состояние удалённых серверов не исследовалось: основание — прямое сообщение владельца.

**Engineering decision в разрешённой AUTH-008:** fresh PostgreSQL identity внутри FastAPI core, новые UUID аккаунтов, явный локальный bootstrap единственного owner. Старые passwords/sessions/grants/целочисленные IDs не импортируются. Новый core не зависит от Node introspection; обычный вход собственных Search/Writing/VPN/Docs единый. Для web — один origin, opaque HttpOnly cookie; для native — внешний браузер и authorization code + PKCE; для расширений/агентов — отдельные scoped API keys. Все credentials проверяет core, права/объекты/бюджеты проверяются отдельно. Никакого owner auto-paid.

| Альтернатива | Итог |
|---|---|
| Legacy bridge + импорт scrypt/сессий/старых grants | Отвергнуто для текущей fresh установки: нет пользователей/сессий, ради которых нужно поддерживать два authority |
| Отдельный login/база пользователей в каждом сервисе | Отвергнуто: повторный вход, несогласованный revoke и права |
| FastAPI/Postgres как единственный identity authority | Выбрано: один subject, один lifecycle сессий, модульные permissions, меньше переходного кода |
| Отдельный внешний IdP и распределённые JWT | Сейчас не требуется; для небольшого modular monolith opaque tokens с DB revocation проще. OIDC/federation можно добавить позднее |

Архив `tournaments`/`qubite-v1.0`96f0457 остаётся неизменным. Не удаляем локальные БД/файлы/старые исходники в рамках спецификации. Возврат к legacy import возможен отдельным ADR и задачей, если позже обнаружится нужный источник; новый core не станет автоматически проверять его пароли. После появления новых данных rollback сохраняет эти записи, не заменяет их старым snapshot.

Tournaments остаётся optional Node/SQLite/Vanilla модулем. При включении в новую платформу identity принимает от core, tournament roles хранит локально; это не полная перепись движка. AliasVault master-password, upstream OAuth/API credentials и Telegram Bot API tokens не становятся паролем Qubite. ShadeAI independent/read-only граница сохраняется.

**Статус реализации:** только спецификация, контракт и synthetic проверки AUTH-008. Core пока имеет лишь health/readiness/technical migration. Следующая задача AUTH-002 — schema subjects/owner + локальный bootstrap без legacy mapping; затем AUTH-009 — настоящий password/session API. AUTH-012/013/014 отделяют native, API keys и private introspection. Search/Writing/VPN runtime изменяются в своих bounded срезах.

[Спецификация и consumers](../../migration/IDENTITY_CUTOVER.md), [машинный контракт](../../../contracts/identity-v2.json), [проверки](../../reports/QUB-AUTH-008.md).
