-- Only durable configuration receipts, no browser secrets or account import.
CREATE TABLE qubite_core.owner_console_commands (
    id uuid PRIMARY KEY,
    actor_id uuid NOT NULL REFERENCES qubite_core.subjects(id),
    request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
    expected text NOT NULL,
    receipt jsonb NOT NULL,
    changes jsonb NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE INDEX owner_console_commands_timeline ON qubite_core.owner_console_commands(created_at DESC, id);
