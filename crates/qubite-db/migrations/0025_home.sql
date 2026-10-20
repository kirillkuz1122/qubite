-- Главная (HOME-001): настройки виджетов и сводка от AI.
-- Решения — D-340…D-349.

-- Настройки виджетов Главной. Нет строки — значения по умолчанию:
-- Челябинск; доллар, евро, юань; все темы новостей (D-328, D-309).
-- Хранится город и его точка из справочника погоды — не координаты человека.
CREATE TABLE home_settings (
    account_id   uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
    place_name   text NOT NULL CHECK (length(place_name) BETWEEN 1 AND 100),
    place_region text NOT NULL DEFAULT '' CHECK (length(place_region) <= 200),
    latitude     double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude    double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    -- Коды валют ЦБ в порядке показа.
    currencies   text[] NOT NULL DEFAULT '{USD,EUR,CNY}'
                 CHECK (cardinality(currencies) <= 6),
    -- Темы новостей: ai, code, study; пусто — без новостей.
    topics       text[] NOT NULL DEFAULT '{ai,code,study}'
                 CHECK (topics <@ ARRAY['ai', 'code', 'study']::text[]),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Сводка от AI на Главной: её пишет агент инструментом `home.digest.write`.
-- Каждая сводка — строка в ленте агента (`action_id`); откатил строку —
-- сводка пропала с Главной. Только дописывается, как и лента.
CREATE TABLE home_digests (
    id          uuid PRIMARY KEY,
    account_id  uuid NOT NULL REFERENCES accounts (id),
    action_id   uuid NOT NULL UNIQUE REFERENCES agent_actions (id),
    -- День по часам платформы, на который сводка.
    day         date NOT NULL,
    -- Пункты: [{"kind": "important", "text": "…", "link": {"type": "task", "id": "…", "title": "…"}}].
    items       jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX home_digests_account_idx ON home_digests (account_id, day DESC, created_at DESC);

CREATE TRIGGER home_digests_append_only
    BEFORE UPDATE OR DELETE ON home_digests
    FOR EACH ROW EXECUTE FUNCTION qubite_forbid_change();
CREATE TRIGGER home_digests_no_truncate
    BEFORE TRUNCATE ON home_digests
    FOR EACH STATEMENT EXECUTE FUNCTION qubite_forbid_change();

-- Имена инструментов бывают из трёх частей: `home.digest.write` (AGENT §13).
ALTER TABLE agent_actions DROP CONSTRAINT agent_actions_tool_check;
ALTER TABLE agent_actions ADD CONSTRAINT agent_actions_tool_check
    CHECK (tool ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$');
