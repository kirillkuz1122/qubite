-- Английский: голосовой разговор с репетитором (ENG-001, D-450…D-459).
--
-- 1. Голосовой слой AI-шлюза: провайдер ElevenLabs и две голосовые модели.
--    Цена голосовой модели — микродоллары за миллион единиц: у `stt` единица —
--    секунда звука, у `tts` — знак текста (qubite-ai::voice). Провайдер
--    выключен, пока на сервере нет QUBITE_ELEVENLABS_API_KEY.
-- 2. Разговоры и реплики: что сказал ученик, что ответил репетитор, ошибки.
--    Ошибки и прогресс ещё и в памяти агента — файл «Английский.md».

ALTER TABLE ai_providers DROP CONSTRAINT ai_providers_kind_check;
ALTER TABLE ai_providers ADD CONSTRAINT ai_providers_kind_check
    CHECK (kind IN ('openrouter', 'openai', 'local', 'mock', 'chatgpt', 'elevenlabs'));

INSERT INTO ai_providers (id, kind, base_url, enabled)
VALUES ('elevenlabs', 'elevenlabs', 'https://api.elevenlabs.io', false)
ON CONFLICT (id) DO NOTHING;

-- Scribe: $0,40 за час звука → $111,12 за миллион секунд (с запасом вверх).
-- Flash v2.5: до $0,10 за 1000 знаков → $100 за миллион знаков.
INSERT INTO ai_models (id, provider_id, external_id, capabilities,
                       price_in_per_mtok, price_out_per_mtok, enabled)
VALUES ('elevenlabs/scribe_v1', 'elevenlabs', 'scribe_v1', ARRAY['stt'], 111120000, 0, true),
       ('elevenlabs/eleven_flash_v2_5', 'elevenlabs', 'eleven_flash_v2_5', ARRAY['tts'], 100000000, 0, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_model_defaults (task, model_id)
VALUES ('voice.stt', 'elevenlabs/scribe_v1'),
       ('voice.tts', 'elevenlabs/eleven_flash_v2_5')
ON CONFLICT (task) DO NOTHING;

-- ---------------------------------------------------------------- разговоры

-- Один разговор: открылся экран — начался, «Закончить» или 30 минут тишины —
-- закончился; тогда итог пишется в «Английский.md» (одна строка ленты агента).
CREATE TABLE english_sessions (
    id             uuid PRIMARY KEY,
    account_id     uuid NOT NULL REFERENCES accounts (id),
    started_at     timestamptz NOT NULL DEFAULT now(),
    last_at        timestamptz NOT NULL DEFAULT now(),
    finished_at    timestamptz,
    -- Реплик ученика; верно с первого раза; с ошибками.
    turns          integer NOT NULL DEFAULT 0 CHECK (turns >= 0),
    correct        integer NOT NULL DEFAULT 0 CHECK (correct >= 0),
    mistakes       integer NOT NULL DEFAULT 0 CHECK (mistakes >= 0),
    -- Итог записан в память агента (строка ленты).
    memory_action  uuid
);

CREATE INDEX english_sessions_account_idx ON english_sessions (account_id, started_at DESC);
-- Не больше одного открытого разговора на человека.
CREATE UNIQUE INDEX english_sessions_open_idx ON english_sessions (account_id)
    WHERE finished_at IS NULL;

-- Реплика: ученик (текст или голос) или репетитор (ответ, разбор ошибок, что
-- повторить). Речь репетитора хранится, чтобы «ещё раз» не стоило денег.
CREATE TABLE english_messages (
    id            uuid PRIMARY KEY,
    session_id    uuid NOT NULL REFERENCES english_sessions (id),
    account_id    uuid NOT NULL REFERENCES accounts (id),
    seq           bigint GENERATED ALWAYS AS IDENTITY,
    role          text NOT NULL CHECK (role IN ('learner', 'tutor')),
    text          text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4000),
    -- У ученика: как сказал — текстом или голосом.
    via           text NOT NULL DEFAULT 'text' CHECK (via IN ('text', 'voice')),
    -- У репетитора: ok — верно, mistake — есть ошибки, none — не про язык.
    verdict       text CHECK (verdict IN ('ok', 'mistake', 'none')),
    -- [{"wrong": "I goed", "right": "I went", "why": "go — неправильный глагол"}]
    mistakes      jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(mistakes) = 'array'),
    -- Что ученик должен повторить правильно (пусто — ничего).
    repeat        text NOT NULL DEFAULT '' CHECK (char_length(repeat) <= 500),
    -- Ученик повторил правильно то, что просили.
    repeated      boolean NOT NULL DEFAULT false,
    speech        bytea,
    speech_mime   text,
    -- Вызовы AI-шлюза: распознавание (у ученика), модель и речь (у репетитора).
    stt_call      uuid,
    ai_call       uuid,
    tts_call      uuid,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CHECK ((speech IS NULL) = (speech_mime IS NULL))
);

CREATE INDEX english_messages_session_idx ON english_messages (session_id, seq);
CREATE INDEX english_messages_account_idx ON english_messages (account_id, seq DESC);
