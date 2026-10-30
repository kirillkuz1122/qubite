-- CAL-001a, D-720…D-722. Событие — отдельный объект calendar_event.
CREATE TABLE calendar_events (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES accounts(id),
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 500),
    notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 20000),
    starts_at bigint NOT NULL,
    ends_at bigint NOT NULL CHECK (ends_at > starts_at),
    all_day boolean NOT NULL DEFAULT false,
    place text NOT NULL DEFAULT '' CHECK (char_length(place) <= 500),
    project_id uuid REFERENCES planner_projects(object_id),
    recurrence jsonb CHECK (recurrence IS NULL OR jsonb_typeof(recurrence) = 'object'),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    deleted boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX calendar_events_window_idx ON calendar_events (owner_id, starts_at, ends_at)
    WHERE NOT deleted;
CREATE INDEX calendar_events_recurrence_idx ON calendar_events (owner_id)
    WHERE NOT deleted AND recurrence IS NOT NULL;
