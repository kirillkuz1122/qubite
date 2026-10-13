-- Fresh enrollment only. No legacy aliases, ownership or module grants.
ALTER TABLE qubite_core.auth_rate_limits DROP CONSTRAINT auth_rate_limits_scope_check;
ALTER TABLE qubite_core.auth_rate_limits ADD CONSTRAINT auth_rate_limits_scope_check
    CHECK (scope IN ('bootstrap_ip','login_ip','login_identifier',
        'email_request_ip','email_request_identifier','email_confirm_ip','email_confirm_identifier',
        'register_ip','register_identifier','register_invite','registration_owner'));
CREATE TABLE qubite_core.registration_state (
    singleton smallint PRIMARY KEY CHECK (singleton=1),
    mode text NOT NULL CHECK (mode IN ('disabled','invite','public')),
    revision bigint NOT NULL CHECK (revision>=1),
    consent_version text NOT NULL CHECK (length(consent_version) BETWEEN 1 AND 80)
);
INSERT INTO qubite_core.registration_state VALUES (1,'invite',1,'qubite-account-v1');
CREATE TABLE qubite_core.registration_invites (
    id uuid PRIMARY KEY,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash)=32),
    request_hash bytea NOT NULL CHECK (octet_length(request_hash)=32),
    email_canonical text COLLATE "C",
    created_by uuid NOT NULL REFERENCES qubite_core.subjects(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (expires_at>created_at AND expires_at<=created_at+interval '7 days'),
    revoked_at timestamptz CHECK (revoked_at IS NULL OR revoked_at>=created_at),
    redeemed_at timestamptz CHECK (redeemed_at IS NULL OR redeemed_at>=created_at),
    redeemed_by uuid UNIQUE REFERENCES qubite_core.subjects(id) ON DELETE RESTRICT,
    CHECK ((redeemed_at IS NULL)=(redeemed_by IS NULL))
);
CREATE INDEX registration_invites_created ON qubite_core.registration_invites(created_at DESC,id);
CREATE TABLE qubite_core.registration_consents (
    subject_id uuid PRIMARY KEY REFERENCES qubite_core.subjects(id) ON DELETE RESTRICT,
    consent_version text NOT NULL,
    accepted_at timestamptz NOT NULL,
    source text NOT NULL CHECK (source IN ('invite','public')),
    invite_id uuid UNIQUE REFERENCES qubite_core.registration_invites(id) ON DELETE RESTRICT,
    CHECK (source<>'invite' OR invite_id IS NOT NULL)
);
CREATE TABLE qubite_core.registration_audit (
    id uuid PRIMARY KEY,
    actor_id uuid REFERENCES qubite_core.subjects(id) ON DELETE RESTRICT,
    action text NOT NULL CHECK (action IN ('mode','invite_create','invite_revoke','register')),
    target_id uuid,
    revision bigint NOT NULL CHECK (revision>=1),
    mode text NOT NULL CHECK (mode IN ('disabled','invite','public')),
    created_at timestamptz NOT NULL
);
COMMENT ON TABLE qubite_core.registration_invites IS 'One-use enrollment capability, hash only. Not email proof, login credential or grant';
COMMENT ON TABLE qubite_core.registration_consents IS 'Versioned explicit enrollment consent; legal text publication/review is separate';
