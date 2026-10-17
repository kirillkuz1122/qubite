-- Ядро объектов Qubite (FND-004): конверт объекта, связи, события, аудит,
-- файлы и очередь фоновых задач. См. docs/architecture/DATA_MODEL.md.
--
-- Аккаунтов пока нет (AUTH-001), поэтому owner_id/created_by — просто uuid
-- без внешнего ключа; ключ на accounts добавит миграция AUTH-001.

-- Защита append-only таблиц: изменять и удалять записи нельзя никому.
CREATE FUNCTION qubite_forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'таблица % только для добавления записей', TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- ---------------------------------------------------------------- объекты

CREATE TABLE objects (
    id           uuid PRIMARY KEY,                         -- UUIDv7, создаётся в коде (в т.ч. офлайн на устройстве)
    type         text NOT NULL CHECK (type ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),  -- 'inbox.item', 'planner.task'
    module_id    text NOT NULL CHECK (module_id ~ '^[a-z][a-z0-9_]*$'),
    owner_id     uuid NOT NULL,
    workspace_id uuid,
    visibility   text NOT NULL DEFAULT 'private'
                 CHECK (visibility IN ('private', 'workspace', 'shared_link', 'vault')),
    title        text NOT NULL DEFAULT '' CHECK (length(title) <= 1000),
    revision     bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    source_refs  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_refs) = 'array'),
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   uuid NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   uuid NOT NULL,
    deleted_at   timestamptz,
    CHECK (split_part(type, '.', 1) = module_id)
);

CREATE INDEX objects_owner_idx ON objects (owner_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX objects_type_idx ON objects (type, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX objects_workspace_idx ON objects (workspace_id) WHERE workspace_id IS NOT NULL;

-- ---------------------------------------------------------------- связи

CREATE TABLE relations (
    id          uuid PRIMARY KEY,
    from_id     uuid NOT NULL REFERENCES objects (id) ON DELETE CASCADE,
    to_id       uuid NOT NULL REFERENCES objects (id) ON DELETE CASCADE,
    type        text NOT NULL CHECK (type ~ '^[a-z][a-z0-9_]*$'),   -- 'related_to', 'derived_from', ...
    source      text NOT NULL CHECK (source IN ('manual', 'ai', 'import', 'system')),
    confidence  real CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid NOT NULL,
    deleted_at  timestamptz,
    CHECK (from_id <> to_id)
);

-- Одна живая связь каждого типа между парой объектов.
CREATE UNIQUE INDEX relations_unique_live ON relations (from_id, to_id, type) WHERE deleted_at IS NULL;
CREATE INDEX relations_to_idx ON relations (to_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------- события

CREATE TABLE events (
    seq        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- порядок для курсоров синхронизации
    id         uuid NOT NULL UNIQUE,
    at         timestamptz NOT NULL DEFAULT now(),
    actor_id   uuid,                       -- NULL — система
    object_id  uuid,                       -- без внешнего ключа: история переживает объект
    kind       text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_.]*$'),   -- 'object.created'
    payload    jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX events_object_idx ON events (object_id, seq) WHERE object_id IS NOT NULL;

CREATE TRIGGER events_append_only
    BEFORE UPDATE OR DELETE ON events
    FOR EACH ROW EXECUTE FUNCTION qubite_forbid_change();
CREATE TRIGGER events_no_truncate
    BEFORE TRUNCATE ON events
    FOR EACH STATEMENT EXECUTE FUNCTION qubite_forbid_change();

-- ---------------------------------------------------------------- аудит

CREATE TABLE audit_log (
    seq          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id           uuid NOT NULL UNIQUE,
    at           timestamptz NOT NULL DEFAULT now(),
    actor_id     uuid,
    action       text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.]*$'),
    target_kind  text NOT NULL,
    target_id    text,
    before       jsonb,
    after        jsonb,
    reason       text,
    request_id   text
);

CREATE INDEX audit_log_target_idx ON audit_log (target_kind, target_id, seq);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, seq);

CREATE TRIGGER audit_log_append_only
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION qubite_forbid_change();
CREATE TRIGGER audit_log_no_truncate
    BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION qubite_forbid_change();

-- ---------------------------------------------------------------- файлы

CREATE TABLE file_blobs (
    sha256      bytea PRIMARY KEY CHECK (length(sha256) = 32),
    size        bigint NOT NULL CHECK (size >= 0),
    mime        text NOT NULL DEFAULT 'application/octet-stream',
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE attachments (
    object_id   uuid NOT NULL REFERENCES objects (id) ON DELETE CASCADE,
    sha256      bytea NOT NULL REFERENCES file_blobs (sha256),
    name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid NOT NULL,
    PRIMARY KEY (object_id, name)
);

CREATE INDEX attachments_blob_idx ON attachments (sha256);

-- ---------------------------------------------------------------- фоновые задачи

CREATE TABLE jobs (
    id               uuid PRIMARY KEY,
    kind             text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_.]*$'),
    payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
    status           text NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'running', 'succeeded', 'dead')),
    attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts     integer NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
    run_at           timestamptz NOT NULL DEFAULT now(),
    locked_by        text,
    locked_until     timestamptz,
    last_error       text,
    idempotency_key  text UNIQUE,
    created_at       timestamptz NOT NULL DEFAULT now(),
    finished_at      timestamptz,
    CHECK ((status = 'running') = (locked_by IS NOT NULL AND locked_until IS NOT NULL))
);

-- Быстрый поиск следующей задачи: готовые к запуску и с истёкшей арендой.
CREATE INDEX jobs_ready_idx ON jobs (run_at) WHERE status = 'queued';
CREATE INDEX jobs_lease_idx ON jobs (locked_until) WHERE status = 'running';
