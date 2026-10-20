-- Агент пишет первым (AGT-004): как часто, «не сегодня», что он написал и
-- что ему ответили; кнопки под сообщением в колокольчике и Telegram.
-- Решения — D-350…D-359.

-- Как часто агент пишет первым. Нет строки — «сколько Qubite захочет» (D-309).
CREATE TABLE agent_pace (
    account_id  uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
    -- auto — сколько захочет (учится по ответам), count — не больше per_day,
    -- off — вообще не писать первым.
    mode        text NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'count', 'off')),
    per_day     integer NOT NULL DEFAULT 3 CHECK (per_day BETWEEN 1 AND 20),
    -- «Не сегодня»: в этот день (по часам владельца) агент первым не пишет.
    quiet_day   date,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Кнопки под сообщением («Да · 15 минут · Позже · Не сегодня») и ответ на них.
ALTER TABLE notifications
    ADD COLUMN options jsonb NOT NULL DEFAULT '[]'
        CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) <= 4),
    ADD COLUMN answer  text CHECK (answer IS NULL OR length(answer) BETWEEN 1 AND 20),
    ADD COLUMN answered_at timestamptz;

-- Что агент написал первым: для лимита дня, «давно не вспоминали» и
-- закономерностей («по вторникам после 17 обычно свободен»).
CREATE TABLE agent_nudges (
    id          uuid PRIMARY KEY,
    account_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    notice_id   uuid NOT NULL UNIQUE REFERENCES notifications (id) ON DELETE CASCADE,
    -- Строка ленты агента, которой сообщение записано.
    action_id   uuid NOT NULL REFERENCES agent_actions (id),
    -- Когда по часам владельца.
    local_at    timestamp NOT NULL,
    -- «Есть N минут?» с кнопками.
    ask_minutes integer CHECK (ask_minutes BETWEEN 5 AND 240),
    -- Что предложил (дело, проект, мысль).
    object_id   uuid,
    -- Входит в лимит дня. Ответ на твоё «да» — не входит: ты сам спросил.
    counted     boolean NOT NULL,
    -- yes — да, short — 15 минут, later — позже, not_today — не сегодня.
    answer      text CHECK (answer IN ('yes', 'short', 'later', 'not_today')),
    answered_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_nudges_day_idx ON agent_nudges (account_id, local_at DESC);
CREATE INDEX agent_nudges_object_idx ON agent_nudges (account_id, object_id, created_at DESC)
    WHERE object_id IS NOT NULL;

-- Повод проснуться «срок» (приближается срок или урок).
ALTER TABLE agent_runs DROP CONSTRAINT agent_runs_trigger_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_trigger_check
    CHECK (trigger IN ('inbox', 'morning', 'window', 'due', 'reply', 'review', 'manual'));
