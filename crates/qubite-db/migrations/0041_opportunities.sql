-- AGT-005a, D-730…D-731. Сведения источников и личное решение о мероприятии.
CREATE TABLE opportunities (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    source text NOT NULL CHECK (length(source) BETWEEN 1 AND 100),
    external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 2000),
    kind text NOT NULL CHECK (kind IN ('olympiad', 'hackathon', 'contest')),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 500),
    subject text NOT NULL DEFAULT '',
    stage text NOT NULL DEFAULT '',
    grades text NOT NULL DEFAULT '',
    registration_until timestamptz,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL CHECK (ends_at >= starts_at),
    place text NOT NULL DEFAULT '',
    url text NOT NULL,
    tags text[] NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'suggested', 'interested', 'dismissed')),
    why text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, source, external_id)
);

CREATE INDEX opportunities_account_date_idx
    ON opportunities (account_id, (COALESCE(registration_until, starts_at)), starts_at, id);

-- Как у home_settings и calendar_events, изоляция задаётся на сервере:
-- account_id берётся только из сессии; каждый запрос ограничен account_id.
-- Отдельных ролей PostgreSQL/RLS у соседних таблиц нет.
