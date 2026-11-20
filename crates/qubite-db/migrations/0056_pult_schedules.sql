-- AOS-4. Сервер хранит расписание и расход. Запуски выполняет внешний раннер.
CREATE TABLE pult_schedules (
    id uuid PRIMARY KEY,
    name text NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 60),
    kind text NOT NULL CHECK (kind IN ('active', 'quiet')),
    schedule_text text NOT NULL CHECK (char_length(schedule_text) BETWEEN 1 AND 120),
    -- Понедельник = 0, воскресенье = 6.
    days smallint[] NOT NULL CHECK (
        cardinality(days) BETWEEN 1 AND 7
        AND array_position(days, NULL) IS NULL
        AND days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
    ),
    where_run text NOT NULL CHECK (where_run IN ('pi', 'cloud', 'ci')),
    model text CHECK (char_length(model) BETWEEN 1 AND 80),
    cap_tokens bigint CHECK (cap_tokens > 0),
    cap_usd numeric CHECK (cap_usd > 0 AND cap_usd < 'Infinity'::numeric),
    enabled boolean NOT NULL DEFAULT true,
    paused_reason text CHECK (paused_reason = 'cap' AND NOT enabled),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pult_schedule_runs (
    id uuid PRIMARY KEY,
    schedule_id uuid NOT NULL REFERENCES pult_schedules (id) ON DELETE CASCADE,
    at timestamptz NOT NULL DEFAULT now(),
    tokens bigint NOT NULL CHECK (tokens >= 0),
    usd numeric NOT NULL CHECK (usd >= 0 AND usd < 'Infinity'::numeric),
    outcome text NOT NULL CHECK (outcome IN ('found', 'quiet', 'failed')),
    note text CHECK (char_length(note) <= 200)
);

CREATE INDEX pult_schedule_runs_schedule_at ON pult_schedule_runs (schedule_id, at DESC, id DESC);
