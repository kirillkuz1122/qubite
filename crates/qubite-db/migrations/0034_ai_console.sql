-- AI-003 (D-530…D-539): AI и бюджеты в Owner Console и в профиле.

-- Защита от зацикливания (D-213) — настраивает owner в Console. Нет строки —
-- значения из настроек сервера (QUBITE_AI_USER_REQUESTS_PER_MINUTE …). 0 — выключено.
CREATE TABLE ai_loop_guard (
    singleton           boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    user_per_minute     integer NOT NULL CHECK (user_per_minute BETWEEN 0 AND 10000),
    job_per_minute      integer NOT NULL CHECK (job_per_minute BETWEEN 0 AND 10000),
    repeat_limit        integer NOT NULL CHECK (repeat_limit BETWEEN 0 AND 10000),
    repeat_window_secs  integer NOT NULL CHECK (repeat_window_secs BETWEEN 1 AND 86400),
    changed_by          uuid REFERENCES accounts (id),
    changed_at          timestamptz NOT NULL DEFAULT now()
);

-- Ключи провайдеров: owner — для всей платформы (account_id NULL, D-442), человек —
-- свой (D-493). Только зашифрованными (QUBITE_AI_SECRET_KEY, в базе ключа нет);
-- hint — последние 4 символа, чтобы узнать ключ на экране.
CREATE TABLE ai_keys (
    id          uuid PRIMARY KEY,
    account_id  uuid REFERENCES accounts (id),
    provider_id text NOT NULL CHECK (provider_id IN ('openrouter')),
    key_enc     text NOT NULL,
    hint        text NOT NULL CHECK (length(hint) <= 8),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ai_keys_one ON ai_keys (
    coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid), provider_id
);

-- Откуда у человека AI (D-493): owner платит (личный лимит в $), своя подписка
-- ChatGPT или свой ключ OpenRouter. Нет строки — owner.
CREATE TABLE ai_sources (
    account_id     uuid PRIMARY KEY REFERENCES accounts (id),
    source         text NOT NULL CHECK (source IN ('owner', 'chatgpt', 'own_key')),
    -- модель подписки для текстовых задач; NULL — первая из каталога подписки
    chatgpt_model  text REFERENCES ai_models (id),
    changed_at     timestamptz NOT NULL DEFAULT now()
);

-- Кто платит за вызов: платформа (ключ owner), своя подписка, свой ключ.
ALTER TABLE ai_calls ADD COLUMN paid_by text NOT NULL DEFAULT 'platform'
    CHECK (paid_by IN ('platform', 'subscription', 'own_key'));
CREATE INDEX ai_calls_created_idx ON ai_calls (created_at DESC);

-- ChatGPT по подписке — у каждого свой вход (D-493). Установка одна (host_id и
-- client_id — в ai_chatgpt_session), токены — по людям.
CREATE TABLE ai_chatgpt_tokens (
    account_id         uuid PRIMARY KEY REFERENCES accounts (id),
    subject            text,
    email              text,
    scopes             text,
    access_token_enc   text,
    refresh_token_enc  text,
    id_token_enc       text,
    expires_at         timestamptz,
    updated_at         timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ai_chatgpt_tokens (account_id, subject, email, scopes, access_token_enc,
                               refresh_token_enc, id_token_enc, expires_at)
SELECT account_id, subject, email, scopes, access_token_enc, refresh_token_enc,
       id_token_enc, expires_at
FROM ai_chatgpt_session WHERE account_id IS NOT NULL AND refresh_token_enc IS NOT NULL;
UPDATE ai_chatgpt_session SET access_token_enc = NULL, refresh_token_enc = NULL,
    id_token_enc = NULL, expires_at = NULL, account_id = NULL;

-- Начатый вход через браузер: проверка возврата (state), PKCE и nonce — на сервере.
CREATE TABLE ai_chatgpt_logins (
    state         text PRIMARY KEY,
    account_id    uuid NOT NULL REFERENCES accounts (id),
    verifier      text NOT NULL,
    nonce         text NOT NULL,
    redirect_uri  text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
