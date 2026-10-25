-- Живой голос Нейта через подписку ChatGPT (ENG-005, D-573, D-590…D-599).
--
-- 1. Модели OpenAI Realtime у провайдера `chatgpt` со способностью `realtime`.
--    Платит подписка человека — цена 0 $; учёт — запросы (выдача временного
--    ключа) и секунды сеанса. Строки выключены (`enabled = false`): allowlist
--    owner подписке не нужен (D-531), а текстовые запросы их не берут.
-- 2. Сеансы realtime в AI-шлюзе: сколько и как долго — для своих лимитов
--    (сеансов в день, минут в день, длина сеанса). Не закрытый браузером
--    сеанс считается по худшему случаю — до своего потолка длины.
-- 3. «Английский»: выбор голоса (ChatGPT / ElevenLabs), модель и голос
--    realtime, привязка сеанса к разговору, реплики расшифровки без повторов.

INSERT INTO ai_providers (id, kind, base_url, enabled)
VALUES ('chatgpt', 'chatgpt', 'https://api.openai.com/v1', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_models (id, provider_id, external_id, capabilities,
                       price_in_per_mtok, price_out_per_mtok, enabled)
VALUES ('chatgpt:gpt-realtime-1.5', 'chatgpt', 'gpt-realtime-1.5', ARRAY['realtime'], 0, 0, false),
       ('chatgpt:gpt-realtime-mini', 'chatgpt', 'gpt-realtime-mini', ARRAY['realtime'], 0, 0, false)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------- шлюз

CREATE TABLE ai_realtime_sessions (
    call_id      uuid PRIMARY KEY REFERENCES ai_calls (id),
    account_id   uuid NOT NULL REFERENCES accounts (id),
    model_id     text NOT NULL,
    -- Потолок длины: столько засчитывается, если браузер не сообщил конец.
    max_seconds  integer NOT NULL CHECK (max_seconds > 0),
    -- Сколько длился (без пауз); NULL — ещё идёт или не закрыт.
    seconds      integer CHECK (seconds >= 0),
    started_at   timestamptz NOT NULL DEFAULT now(),
    ended_at     timestamptz
);

CREATE INDEX ai_realtime_sessions_account_idx ON ai_realtime_sessions (account_id, started_at DESC);

-- ---------------------------------------------------------------- английский

ALTER TABLE english_learners
    -- NULL — сам: ChatGPT, если подписка подключена, иначе ElevenLabs.
    ADD COLUMN voice_engine   text CHECK (voice_engine IN ('chatgpt', 'elevenlabs')),
    ADD COLUMN realtime_model text CHECK (char_length(realtime_model) BETWEEN 1 AND 64),
    ADD COLUMN realtime_voice text CHECK (char_length(realtime_voice) BETWEEN 1 AND 32);

CREATE TABLE english_realtime (
    call_id      uuid PRIMARY KEY REFERENCES ai_calls (id),
    account_id   uuid NOT NULL REFERENCES accounts (id),
    session_id   uuid NOT NULL REFERENCES english_sessions (id),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX english_realtime_session_idx ON english_realtime (session_id);

-- Реплика из расшифровки realtime: ID элемента разговора у OpenAI —
-- повторная отправка той же реплики не пишет её второй раз.
ALTER TABLE english_messages
    ADD COLUMN realtime_item text CHECK (char_length(realtime_item) BETWEEN 1 AND 100);

CREATE UNIQUE INDEX english_messages_realtime_item_idx
    ON english_messages (session_id, realtime_item) WHERE realtime_item IS NOT NULL;
