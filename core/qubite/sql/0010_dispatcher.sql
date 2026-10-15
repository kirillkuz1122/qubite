-- Mock-only durable dispatch. Never replay a pre-existing dispatched/unknown call.
ALTER TABLE qubite_core.ai_budget_state ADD COLUMN timeout_seconds integer NOT NULL DEFAULT 60
    CHECK(timeout_seconds BETWEEN 1 AND 300);
CREATE TABLE qubite_core.ai_dispatch_jobs (
    invocation_id uuid PRIMARY KEY REFERENCES qubite_core.ai_budget_outbox(invocation_id),
    status text NOT NULL CHECK(status IN ('queued','leased','sending','retry_wait','unknown','released','settled')),
    lease_token uuid,
    lease_until timestamptz,
    attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
    next_attempt_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    timeout_seconds integer NOT NULL CHECK(timeout_seconds BETWEEN 1 AND 300),
    reason text,
    CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE TABLE qubite_core.ai_dispatch_attempts (
    invocation_id uuid NOT NULL REFERENCES qubite_core.ai_dispatch_jobs(invocation_id),
    number integer NOT NULL CHECK(number BETWEEN 1 AND 3),
    lease_token uuid NOT NULL UNIQUE,
    provider_request_id uuid NOT NULL UNIQUE,
    state text NOT NULL CHECK(state IN ('sending','not_sent','succeeded','unknown')),
    started_at timestamptz NOT NULL,
    deadline timestamptz NOT NULL,
    finished_at timestamptz,
    PRIMARY KEY(invocation_id,number),
    CHECK(deadline>started_at)
);
INSERT INTO qubite_core.ai_dispatch_jobs(invocation_id,status,next_attempt_at,expires_at,timeout_seconds)
SELECT i.id,CASE WHEN i.state='reserved' AND o.state='pending' THEN 'queued'
    WHEN i.state IN ('released','settled') THEN i.state ELSE 'unknown' END,
    i.created_at,i.created_at+interval '5 minutes',60
FROM qubite_core.ai_budget_invocations i JOIN qubite_core.ai_budget_outbox o ON o.invocation_id=i.id;
CREATE INDEX ai_dispatch_ready ON qubite_core.ai_dispatch_jobs(status,next_attempt_at,lease_until);
