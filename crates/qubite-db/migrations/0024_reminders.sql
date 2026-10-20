-- Напоминания и каналы (PLAN-004): колокольчик, push в браузере, Telegram;
-- тишина. Решения — D-310…D-319.

-- Когда напомнить о деле. NULL — «само»: время задаёт смысл записи (дело со
-- временем — за 15 минут, «сходить куда-то» — за час, с запасом на дорогу).
-- {"before": 60} — за N минут до срока; {"at": "2026-10-20T19:00"} — в это
-- время по часам владельца; {"off": true} — не напоминать.
ALTER TABLE planner_tasks
    ADD COLUMN remind     jsonb CHECK (remind IS NULL OR jsonb_typeof(remind) = 'object'),
    -- «Почему тогда»: ставит тот, кто выбрал время (человек или агент).
    ADD COLUMN remind_why text NOT NULL DEFAULT '' CHECK (length(remind_why) <= 300),
    -- Кто выбрал время: auto — Qubite по смыслу, owner — сам человек, agent — агент.
    ADD COLUMN remind_by  text NOT NULL DEFAULT 'auto' CHECK (remind_by IN ('auto', 'owner', 'agent'));

-- Каналы и тишина человека. Нет строки — значения по умолчанию.
CREATE TABLE notify_settings (
    account_id      uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
    push_enabled    boolean NOT NULL DEFAULT true,
    telegram_enabled boolean NOT NULL DEFAULT true,
    -- Куда сначала, когда человека нет в Qubite; не дошло — во второй.
    first_channel   text NOT NULL DEFAULT 'push' CHECK (first_channel IN ('push', 'telegram')),
    -- Ночь: агент не пишет первым (свои напоминания приходят всегда).
    quiet_from      time NOT NULL DEFAULT '23:00',
    quiet_to        time NOT NULL DEFAULT '08:00',
    -- «Само»: за сколько минут до дела со временем и до «сходить куда-то».
    before_minutes  integer NOT NULL DEFAULT 15 CHECK (before_minutes BETWEEN 0 AND 1440),
    travel_minutes  integer NOT NULL DEFAULT 60 CHECK (travel_minutes BETWEEN 0 AND 1440),
    -- Вкладка Qubite видна (раз в минуту отмечается); давно — «нет в Qubite».
    seen_at         timestamptz,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Колокольчик: всё, что Qubite написал человеку. Push и Telegram — только
-- доставка того же сообщения; прочитанное гаснет везде.
CREATE TABLE notifications (
    id          uuid PRIMARY KEY,
    account_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    -- reminder — напоминание о деле; agent — агент пишет первым; system — служебное.
    kind        text NOT NULL CHECK (kind IN ('reminder', 'agent', 'system')),
    -- owner — человек сам попросил (приходит всегда); agent — агент первым (тишина).
    origin      text NOT NULL CHECK (origin IN ('owner', 'agent', 'system')),
    title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
    body        text NOT NULL DEFAULT '' CHECK (length(body) <= 2000),
    why         text NOT NULL DEFAULT '' CHECK (length(why) <= 300),
    -- Дело (или другой объект), к которому ведёт сообщение.
    object_id   uuid,
    -- Одно событие — одно сообщение (например, напоминание о деле на это время).
    dedup_key   text UNIQUE CHECK (dedup_key IS NULL OR length(dedup_key) <= 200),
    -- Пришло в тишину: только в колокольчик, наружу не отправляется.
    held        boolean NOT NULL DEFAULT false,
    -- Куда ушло наружу: push, telegram; NULL — только колокольчик.
    channel     text CHECK (channel IN ('push', 'telegram')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    read_at     timestamptz
);

CREATE INDEX notifications_account_idx ON notifications (account_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (account_id) WHERE read_at IS NULL;

-- Подписки Web Push: по одной на браузер.
CREATE TABLE push_subscriptions (
    id          uuid PRIMARY KEY,
    account_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    -- Адрес службы push браузера (сервер принимает только известные службы;
    -- http — только локальный, для тестов).
    endpoint    text NOT NULL UNIQUE CHECK (
                    (endpoint ~ '^https://' OR endpoint ~ '^http://(127\.0\.0\.1|localhost)[:/]')
                    AND length(endpoint) <= 2000),
    -- Ключи браузера (base64url): p256dh — открытый ключ, auth — секрет.
    p256dh      text NOT NULL CHECK (length(p256dh) BETWEEN 80 AND 100),
    auth        text NOT NULL CHECK (length(auth) BETWEEN 16 AND 32),
    label       text NOT NULL DEFAULT '' CHECK (length(label) <= 200),
    created_at  timestamptz NOT NULL DEFAULT now(),
    last_ok_at  timestamptz,
    failures    integer NOT NULL DEFAULT 0 CHECK (failures >= 0)
);

CREATE INDEX push_subscriptions_account_idx ON push_subscriptions (account_id);

-- Что куда ушло: чтобы не отправить дважды и погасить в Telegram прочитанное.
CREATE TABLE notification_deliveries (
    notification_id uuid NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
    channel     text NOT NULL CHECK (channel IN ('push', 'telegram')),
    -- ID подписки push или чата Telegram.
    target      text NOT NULL,
    -- ID сообщения в Telegram (чтобы погасить его).
    external_id text,
    status      text NOT NULL CHECK (status IN ('sent', 'failed', 'closed')),
    error       text CHECK (error IS NULL OR length(error) <= 500),
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (notification_id, channel, target)
);
