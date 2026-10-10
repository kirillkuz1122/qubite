# SQLite: Telegram-заявки

Дополнение существующей базы Brief, миграция через CREATE TABLE/INDEX IF NOT EXISTS. `created_at`/`updated_at` — UTC Unix timestamp, запросы параметризованы, foreign_keys=ON.

| Таблица | Связи и удаление | Основные индексы |
| --- | --- | --- |
| lead_sources | username PK, chat_id UNIQUE; состояние подключения и правила | username, chat_id |
| telegram_leads | sid → sessions CASCADE; source → lead_sources RESTRICT; proposal → negotiation_proposals SET NULL; brief_id → sessions SET NULL | UNIQUE(chat_id,message_id), sid, status+created_at, client+created_at, feedback+updated_at |
| negotiation_folder_jobs | client PK — Telegram ID, отдельной таблицы пользователей здесь нет | client |

Сессии/предложения/ledger остаются в прежних таблицах. Наблюдение сохраняет только сообщения-кандидаты и короткий контекст; отзывы связываются с конкретной заявкой. Hash исходного текста позволяет отменить старый отклик. Источник, автор и Telegram ID проверяются повторно перед личной отправкой. Folder job создаётся после verified sent, а не при формировании черновика.

Миграция не изменяет/очищает старые данные. Новые состояния: pending, processing, draft, approved, contacted, filtered, changed, rejected, expired, budget_wait, failed. processing после аварии становится failed, без нового платного вызова.
