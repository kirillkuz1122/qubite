-- «Почему откатил?» (AGT-007, D-397): откат — обратная связь агенту. После
-- того как ты откатил действие агента, он спрашивает (по желанию): «ошибся»,
-- «не сейчас», «не надо такого» или свой текст. «Ошибся», «не надо такого»
-- и свой текст — урок (задача agent.learn), «не сейчас» и молчание — нет.
-- Описание — docs/product/AGENT.md §5.

CREATE TABLE agent_revert_why (
    -- Пакет отката (один откат — одна кнопка, может быть несколько строк ленты).
    batch_id    uuid PRIMARY KEY,
    account_id  uuid NOT NULL REFERENCES accounts (id),
    asked_at    timestamptz NOT NULL DEFAULT now(),
    -- mistake — ошибся, not_now — не сейчас, never — не надо такого, own — свой текст.
    kind        text CHECK (kind IN ('mistake', 'not_now', 'never', 'own')),
    answer      text NOT NULL DEFAULT '' CHECK (char_length(answer) <= 500),
    answered_at timestamptz,
    CHECK ((kind IS NULL) = (answered_at IS NULL))
);

-- Неотвеченные — их видит агент в разговоре (можно ответить в Telegram).
CREATE INDEX agent_revert_why_open_idx ON agent_revert_why (account_id, asked_at)
    WHERE kind IS NULL;
