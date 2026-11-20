-- AOS-5h: подтверждение и исправления принадлежат владельцу сообщения.
CREATE TABLE command_turns (
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    id uuid NOT NULL,
    text text NOT NULL,
    source text NOT NULL,
    result jsonb NOT NULL,
    agent_model text,
    inbox_id uuid,
    corrected boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, id)
);
CREATE INDEX command_turns_recent ON command_turns (account_id, created_at DESC);

-- Модель фонового запуска остаётся той, для которой была показана оценка.
ALTER TABLE agent_messages ADD COLUMN dispatch_model text;
