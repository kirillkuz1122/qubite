-- Email possession proofs, not account identifiers, login tokens or grants.
ALTER TABLE qubite_core.auth_rate_limits DROP CONSTRAINT auth_rate_limits_scope_check;
ALTER TABLE qubite_core.auth_rate_limits ADD CONSTRAINT auth_rate_limits_scope_check
    CHECK (scope IN ('bootstrap_ip','login_ip','login_identifier',
                    'email_request_ip','email_request_identifier','email_confirm_ip','email_confirm_identifier'));
CREATE TABLE qubite_core.email_challenges (
    id uuid PRIMARY KEY,
    subject_id uuid NOT NULL REFERENCES qubite_core.subjects(id) ON DELETE RESTRICT,
    purpose text NOT NULL CHECK (purpose IN ('verify','reset')),
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash)=32),
    email_canonical text COLLATE "C" NOT NULL,
    auth_version bigint NOT NULL CHECK (auth_version>=1),
    credential_version bigint CHECK (credential_version>=1),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    delivered_at timestamptz,
    finished_at timestamptz,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    CHECK (expires_at>created_at AND expires_at<=created_at+interval '30 minutes'),
    CHECK (delivered_at IS NULL OR delivered_at>=created_at),
    CHECK (finished_at IS NULL OR finished_at>=created_at),
    CHECK (purpose<>'reset' OR credential_version IS NOT NULL)
);
CREATE INDEX email_challenges_subject ON qubite_core.email_challenges(subject_id,purpose)
    WHERE finished_at IS NULL;
CREATE INDEX email_challenges_expiry ON qubite_core.email_challenges(expires_at);
COMMENT ON TABLE qubite_core.email_challenges IS 'Hashed one-use email proofs. Plaintext exists only in injected delivery memory; no SMTP runtime';
