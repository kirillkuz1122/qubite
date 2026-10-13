-- Explicit web authentication only; no legacy import, native tokens or grants.
CREATE TABLE qubite_core.password_credentials (
    subject_id uuid PRIMARY KEY REFERENCES qubite_core.subjects(id) ON DELETE RESTRICT,
    password_hash text NOT NULL CHECK (length(password_hash) BETWEEN 80 AND 200
        AND password_hash LIKE '$argon2id$v=19$m=19456,t=2,p=1$%'),
    credential_version bigint NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE qubite_core.sessions (
    id uuid PRIMARY KEY,
    subject_id uuid NOT NULL REFERENCES qubite_core.subjects(id) ON DELETE RESTRICT,
    kind text NOT NULL DEFAULT 'web' CHECK (kind = 'web'),
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    csrf_hash bytea NOT NULL CHECK (octet_length(csrf_hash) = 32),
    auth_version bigint NOT NULL CHECK (auth_version >= 1),
    created_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    absolute_expires_at timestamptz NOT NULL,
    reauthed_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (created_at <= last_seen_at AND last_seen_at < expires_at
        AND expires_at <= absolute_expires_at AND created_at <= reauthed_at),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX sessions_subject_active ON qubite_core.sessions(subject_id, created_at DESC)
    WHERE revoked_at IS NULL;
CREATE TABLE qubite_core.auth_preauth (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    csrf_hash bytea NOT NULL CHECK (octet_length(csrf_hash) = 32),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    CHECK (expires_at > created_at),
    CHECK (used_at IS NULL OR used_at >= created_at)
);
CREATE INDEX auth_preauth_expiry ON qubite_core.auth_preauth(expires_at);
CREATE TABLE qubite_core.auth_rate_limits (
    scope text NOT NULL CHECK (scope IN ('bootstrap_ip', 'login_ip', 'login_identifier')),
    bucket_hash bytea NOT NULL CHECK (octet_length(bucket_hash) = 32),
    hits integer NOT NULL CHECK (hits BETWEEN 1 AND 1000000),
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (scope, bucket_hash)
);
CREATE INDEX auth_rate_limits_expiry ON qubite_core.auth_rate_limits(expires_at);
COMMENT ON TABLE qubite_core.auth_preauth IS 'Short-lived one-use login CSRF challenges; not user sessions';
COMMENT ON TABLE qubite_core.auth_rate_limits IS 'Shared fixed-window counters; digests are not anonymous personal data';
