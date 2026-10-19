-- Telegram-бот (CMD-006): уведомления владельцу, их тумблеры, привязка
-- Telegram кодом из профиля и служебное состояние бота. Решения — D-196…D-198.

-- Очередь уведомлений владельцу. Кладёт кто угодно (сервер, бот, скрипт
-- бэкапа через `qubite notify`), отправляет `qubite bot`.
CREATE TABLE owner_notifications (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind        text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]*$'),
    text        text NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
    -- Одно и то же событие — одно уведомление (например «AI 80 % за октябрь»).
    dedup_key   text UNIQUE CHECK (dedup_key IS NULL OR length(dedup_key) <= 300),
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- Отправлено или пропущено (вид выключен владельцем).
    sent_at     timestamptz,
    skipped     boolean NOT NULL DEFAULT false,
    attempts    integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error  text
);

CREATE INDEX owner_notifications_pending_idx ON owner_notifications (id) WHERE sent_at IS NULL;

-- Владелец выключил вид уведомлений. Нет строки — включено.
CREATE TABLE owner_notification_settings (
    kind        text PRIMARY KEY CHECK (kind ~ '^[a-z][a-z0-9_]*$'),
    enabled     boolean NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Привязка Telegram из профиля: одноразовый код для ссылки t.me/<бот>?start=<код>.
CREATE TABLE telegram_link_codes (
    code_hash   bytea PRIMARY KEY CHECK (length(code_hash) = 32),
    account_id  uuid NOT NULL REFERENCES accounts (id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz
);

-- Служебное состояние бота: смещение обновлений Telegram, курсор аудита,
-- «сервер не отвечает» и т. п.
CREATE TABLE bot_state (
    key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.]*$'),
    value       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
