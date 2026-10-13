-- Additive metadata only. No domain content, account creation or automatic grants.
CREATE TABLE qubite_core.policy_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    revision bigint NOT NULL CHECK (revision >= 1)
);
INSERT INTO qubite_core.policy_state VALUES (true, 1);
CREATE TABLE qubite_core.policy_modules (
    id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]{0,31}$'),
    installed boolean NOT NULL DEFAULT false,
    enabled boolean NOT NULL DEFAULT false
);
INSERT INTO qubite_core.policy_modules(id) VALUES
('docs'),('planner'),('search'),('writing'),('vpn'),('vault'),('tournaments'),
('life'),('ink'),('learn'),('knowledge'),('inbox'),('notifications'),('teams'),
('finance'),('focus'),('studio'),('pulse'),('support');
CREATE TABLE qubite_core.policy_entitlements (
    subject_id uuid NOT NULL REFERENCES qubite_core.subjects(id),
    module text NOT NULL REFERENCES qubite_core.policy_modules(id),
    action text NOT NULL CHECK (action IN ('read','write','manage','ai')),
    effect text NOT NULL CHECK (effect IN ('allow','deny')),
    expires_at timestamptz,
    PRIMARY KEY(subject_id,module,action)
);
CREATE TABLE qubite_core.policy_workspaces (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES qubite_core.subjects(id)
);
CREATE TABLE qubite_core.policy_memberships (
    workspace_id uuid NOT NULL REFERENCES qubite_core.policy_workspaces(id),
    subject_id uuid NOT NULL REFERENCES qubite_core.subjects(id),
    role text NOT NULL CHECK (role IN ('viewer','editor','manager','organizer','moderator','admin')),
    enabled boolean NOT NULL,
    expires_at timestamptz,
    PRIMARY KEY(workspace_id,subject_id)
);
CREATE TABLE qubite_core.policy_resources (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES qubite_core.policy_workspaces(id),
    module text NOT NULL REFERENCES qubite_core.policy_modules(id),
    UNIQUE(id,workspace_id,module)
);
CREATE TABLE qubite_core.policy_acl (
    resource_id uuid NOT NULL REFERENCES qubite_core.policy_resources(id),
    subject_id uuid NOT NULL REFERENCES qubite_core.subjects(id),
    action text NOT NULL CHECK (action IN ('read','write','manage','ai')),
    effect text NOT NULL CHECK (effect IN ('allow','deny')),
    expires_at timestamptz,
    PRIMARY KEY(resource_id,subject_id,action)
);
CREATE TABLE qubite_core.policy_ai_grants (
    subject_id uuid NOT NULL REFERENCES qubite_core.subjects(id),
    module text NOT NULL REFERENCES qubite_core.policy_modules(id),
    provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{0,47}$'),
    model text NOT NULL CHECK (model ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$'),
    effect text NOT NULL CHECK (effect IN ('allow','deny')),
    expires_at timestamptz,
    PRIMARY KEY(subject_id,module,provider,model)
);
CREATE TABLE qubite_core.policy_audit (
    command_id uuid PRIMARY KEY,
    actor_id uuid NOT NULL REFERENCES qubite_core.subjects(id),
    request_hash bytea NOT NULL CHECK (octet_length(request_hash)=32),
    expected_revision bigint NOT NULL,
    revision bigint NOT NULL UNIQUE,
    kind text NOT NULL,
    reason text NOT NULL CHECK (reason IN ('grant','revoke','configure','create','manual')),
    change jsonb NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE TABLE qubite_core.policy_delegations (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash)=32),
    subject_id uuid NOT NULL REFERENCES qubite_core.subjects(id),
    session_id uuid NOT NULL REFERENCES qubite_core.sessions(id),
    auth_version bigint NOT NULL,
    policy_revision bigint NOT NULL,
    channel text NOT NULL CHECK (channel IN ('job','tool','ws')),
    target jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (expires_at>created_at),
    CHECK (expires_at <= created_at+interval '5 minutes')
);
CREATE INDEX policy_delegations_expiry ON qubite_core.policy_delegations(expires_at);
CREATE INDEX policy_resources_scope ON qubite_core.policy_resources(workspace_id,module);
