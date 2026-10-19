-- AI-005 (D-219): провайдер «ChatGPT по подписке» (Sign in with ChatGPT для
-- open-source клиентов). Выключен по умолчанию (QUBITE_AI_CHATGPT_ENABLED).

ALTER TABLE ai_providers DROP CONSTRAINT ai_providers_kind_check;
ALTER TABLE ai_providers ADD CONSTRAINT ai_providers_kind_check
    CHECK (kind IN ('openrouter', 'openai', 'local', 'mock', 'chatgpt'));

-- Одна связь с ChatGPT на установку: подписка того, кто вошёл (owner), и только
-- для его собственных запросов. Токены — только зашифрованными (ключ —
-- QUBITE_AI_SECRET_KEY, в базе его нет). client_id и host_id переживают выход:
-- их нужно переиспользовать при следующем входе.
CREATE TABLE ai_chatgpt_session (
    singleton          boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    host_id            text NOT NULL,                 -- ext_agent_host_id этой установки
    client_id          text,                          -- выданный при первом входе oaiapp_…
    account_id         uuid REFERENCES accounts (id), -- кто вошёл (только owner)
    subject            text,                          -- sub из ID-токена OpenAI
    email              text,
    scopes             text,
    access_token_enc   text,
    refresh_token_enc  text,
    id_token_enc       text,
    expires_at         timestamptz,
    updated_at         timestamptz NOT NULL DEFAULT now()
);
