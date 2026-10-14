-- Additive mock accounting only. No paid grants, prices or positive caps are seeded.
CREATE TABLE qubite_core.ai_budget_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
    revision bigint NOT NULL CHECK(revision>=1),
    timezone text NOT NULL
);
INSERT INTO qubite_core.ai_budget_state VALUES(true,1,'Asia/Yekaterinburg');
CREATE TABLE qubite_core.ai_budget_accounts (
    id uuid PRIMARY KEY,
    scope text NOT NULL CHECK(scope IN ('global','user','module','project','model')),
    key text NOT NULL,
    UNIQUE(scope,key)
);
CREATE TABLE qubite_core.ai_budget_limits (
    account_id uuid NOT NULL REFERENCES qubite_core.ai_budget_accounts(id),
    period text NOT NULL CHECK(period IN ('all','day','month')),
    usd_micro bigint CHECK(usd_micro BETWEEN 0 AND 1000000000000),
    requests bigint CHECK(requests BETWEEN 0 AND 1000000000000),
    tokens bigint CHECK(tokens BETWEEN 0 AND 1000000000000),
    PRIMARY KEY(account_id,period),
    CHECK(usd_micro IS NOT NULL OR requests IS NOT NULL OR tokens IS NOT NULL)
);
CREATE TABLE qubite_core.ai_budget_buckets (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES qubite_core.ai_budget_accounts(id),
    period text NOT NULL CHECK(period IN ('all','day','month')),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz,
    timezone text NOT NULL,
    spent_usd bigint NOT NULL DEFAULT 0 CHECK(spent_usd>=0),
    reserved_usd bigint NOT NULL DEFAULT 0 CHECK(reserved_usd>=0),
    spent_requests bigint NOT NULL DEFAULT 0 CHECK(spent_requests>=0),
    reserved_requests bigint NOT NULL DEFAULT 0 CHECK(reserved_requests>=0),
    spent_tokens bigint NOT NULL DEFAULT 0 CHECK(spent_tokens>=0),
    reserved_tokens bigint NOT NULL DEFAULT 0 CHECK(reserved_tokens>=0),
    UNIQUE(account_id,period,starts_at),
    CHECK((period='all' AND ends_at IS NULL) OR (period<>'all' AND ends_at>starts_at))
);
CREATE TABLE qubite_core.ai_budget_prices (
    id uuid PRIMARY KEY,
    snapshot jsonb NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE TABLE qubite_core.ai_budget_project_bindings (
    resource_id uuid PRIMARY KEY REFERENCES qubite_core.policy_resources(id),
    project_id uuid NOT NULL REFERENCES qubite_core.policy_resources(id)
);
CREATE TABLE qubite_core.ai_budget_invocations (
    id uuid PRIMARY KEY,
    subject_id uuid NOT NULL REFERENCES qubite_core.subjects(id),
    session_id uuid NOT NULL REFERENCES qubite_core.sessions(id),
    idempotency_key uuid NOT NULL,
    fingerprint bytea NOT NULL CHECK(octet_length(fingerprint)=32),
    target jsonb NOT NULL,
    usage_bound jsonb NOT NULL,
    price_id uuid NOT NULL REFERENCES qubite_core.ai_budget_prices(id),
    policy_revision bigint NOT NULL,
    budget_revision bigint NOT NULL,
    reserved_usd bigint NOT NULL CHECK(reserved_usd>=0),
    reserved_tokens bigint NOT NULL CHECK(reserved_tokens>=0),
    state text NOT NULL CHECK(state IN ('reserved','dispatched','unknown','released','settled')),
    provider_request_id uuid UNIQUE,
    usage jsonb,
    created_at timestamptz NOT NULL,
    UNIQUE(subject_id,idempotency_key)
);
CREATE TABLE qubite_core.ai_budget_allocations (
    invocation_id uuid NOT NULL REFERENCES qubite_core.ai_budget_invocations(id),
    bucket_id uuid NOT NULL REFERENCES qubite_core.ai_budget_buckets(id),
    PRIMARY KEY(invocation_id,bucket_id)
);
CREATE TABLE qubite_core.ai_budget_outbox (
    invocation_id uuid PRIMARY KEY REFERENCES qubite_core.ai_budget_invocations(id),
    state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','marked','closed'))
);
CREATE TABLE qubite_core.ai_budget_events (
    event_id uuid PRIMARY KEY,
    invocation_id uuid NOT NULL REFERENCES qubite_core.ai_budget_invocations(id),
    kind text NOT NULL CHECK(kind IN ('dispatched','unknown','released','settled')),
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    CHECK(kind<>'settled' OR data->'usage' IS NOT NULL)
);
CREATE TABLE qubite_core.ai_budget_freezes (
    provider text NOT NULL,
    model text NOT NULL,
    invocation_id uuid NOT NULL REFERENCES qubite_core.ai_budget_invocations(id),
    created_at timestamptz NOT NULL,
    PRIMARY KEY(provider,model)
);
CREATE TABLE qubite_core.ai_budget_audit (
    command_id uuid PRIMARY KEY,
    actor_id uuid NOT NULL REFERENCES qubite_core.subjects(id),
    request_hash bytea NOT NULL CHECK(octet_length(request_hash)=32),
    expected_revision bigint NOT NULL,
    revision bigint NOT NULL UNIQUE,
    change jsonb NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE INDEX ai_budget_open_buckets ON qubite_core.ai_budget_buckets(account_id,period,starts_at DESC);
CREATE INDEX ai_budget_invocation_events ON qubite_core.ai_budget_events(invocation_id,kind);
-- No GC/TTL releases and no destructive accounting migrations.
