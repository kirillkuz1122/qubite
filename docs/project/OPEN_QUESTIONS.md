# Архитектурные вопросы после аудита

Ответы записывать здесь и в ADR; не выдавать RECOMMENDED за accepted. Implementation tasks остаются backlog до нужного решения.

1. Q-ARCH P0: принимаем новый Python/FastAPI + React/TS core рядом с legacy (вариант B), или foundation сначала в Express (A)? Рекомендация B, независимо от текущей Raspberry Pi; исходные сервисы в обоих вариантах сохраняются.
2. Q-DB P0: Postgres только для нового core? Рекомендация да, SQLite legacy не трогать; pgvector позже. Выбор БД обсуждаем сейчас; параметры хостинга и capacity/restore проверки отложены до миграции и деплоя.
3. Q-IDENTITY P0: legacy Auth остаётся authority первого release с introspection adapter и проверенной owner mapping? Рекомендация да. Полный перенос учётных записей позже отдельным cutover.
4. Q-ROLLOUT P0: opt-in новый UI на /next (или отдельный staging hostname), old root/ссылки сохраняются до acceptance? Рекомендация /next в staging. Production reference, хостинг и порядок выкладки уточнить перед серверным этапом; они не блокируют локальное проектирование.
5. Q-DATA P1: Life key recovery и offline revoke retention; backup destination и приемлемые RPO/RTO уточнить перед миграцией/деплоем. Рекомендация off-host encrypted + fresh pre-migration snapshot; конкретные recovery/copy права требуют решения.
6. Q-INK P1: точные модель/стилус/Android версия и доступность физического планшета для input probe. Не выводить pressure/tilt по названию.

Уже отвечено документами, не спрашивать повторно: обычная главная owner, manual grants/no tariffs, scoped tournament roles, новые Docs/Planner собственные, Shade только connector, реальный paid test/deploy отдельно. Root kickoff V2 отсутствует; доступный kickoff полноценно задаёт V2 цели. Если имеется другой V2, сравнить before execution, не придумывать его текст.
