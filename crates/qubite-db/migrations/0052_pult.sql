-- HAR-002, этап AOS-5 (D-980…). «Пульт» владельца: сборщики на его машинах шлют
-- сводку о сессиях Claude Code и лимитах; сервер хранит последнюю сводку каждого
-- сборщика и историю событий агентов, которую пишет код (0 токенов, D-941).

-- Сборщик — программа владельца на ПК. Токен показывается один раз, здесь только хеш.
CREATE TABLE pult_collectors (
    id            uuid PRIMARY KEY,
    name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
    token_hash    bytea NOT NULL UNIQUE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz
);

-- Последняя сводка сборщика целиком (старые не храним: нужна только «сейчас»).
CREATE TABLE pult_reports (
    collector_id  uuid PRIMARY KEY REFERENCES pult_collectors (id) ON DELETE CASCADE,
    received_at   timestamptz NOT NULL DEFAULT now(),
    body          jsonb NOT NULL
);

-- Что сервер видел об агенте в прошлый раз — чтобы заметить перемену и записать событие.
CREATE TABLE pult_agent_state (
    agent    text PRIMARY KEY CHECK (char_length(agent) BETWEEN 1 AND 80),
    facts    jsonb NOT NULL,
    seen_at  timestamptz NOT NULL DEFAULT now()
);

-- История агента для карточки. Пишет код при перемене статуса, PR и CI.
CREATE TABLE pult_events (
    id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    agent  text NOT NULL CHECK (char_length(agent) BETWEEN 1 AND 80),
    at     timestamptz NOT NULL,
    kind   text NOT NULL CHECK (kind IN ('start', 'pr', 'ci_red', 'ci_green', 'wait', 'done', 'info')),
    text   text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 300)
);
CREATE INDEX pult_events_agent ON pult_events (agent, at DESC);
