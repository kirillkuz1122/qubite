-- Forward-only OAuth addition; original subjects/owner/passwords are preserved.
ALTER TABLE qubite_core.sessions ADD COLUMN password_proven boolean NOT NULL DEFAULT true;
CREATE TABLE qubite_core.oauth_providers (
    provider text PRIMARY KEY CHECK (provider IN ('google','yandex','vk','telegram')),
    enabled boolean NOT NULL DEFAULT false,
    version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO qubite_core.oauth_providers(provider) VALUES ('google'),('yandex'),('vk'),('telegram');
CREATE TABLE qubite_core.oauth_identities (
    provider text NOT NULL REFERENCES qubite_core.oauth_providers(provider) ON DELETE RESTRICT,
    issuer text NOT NULL CHECK (char_length(issuer) BETWEEN 1 AND 128),
    provider_subject text COLLATE "C" NOT NULL CHECK (char_length(provider_subject) BETWEEN 1 AND 255),
    subject_id uuid NOT NULL REFERENCES qubite_core.subjects(id) ON DELETE RESTRICT,
    linked_at timestamptz NOT NULL,
    PRIMARY KEY(provider,issuer,provider_subject),
    UNIQUE(subject_id,provider)
);
CREATE TABLE qubite_core.oauth_states (
    state_hash bytea PRIMARY KEY CHECK (octet_length(state_hash)=32),
    browser_hash bytea NOT NULL CHECK (octet_length(browser_hash)=32),
    provider text NOT NULL REFERENCES qubite_core.oauth_providers(provider) ON DELETE RESTRICT,
    provider_version bigint NOT NULL CHECK (provider_version>=1),
    config_hash bytea NOT NULL CHECK (octet_length(config_hash)=32),
    intent text NOT NULL CHECK (intent IN ('login','link')),
    subject_id uuid REFERENCES qubite_core.subjects(id) ON DELETE RESTRICT,
    session_hash bytea CHECK (session_hash IS NULL OR octet_length(session_hash)=32),
    auth_version bigint,
    credential_version bigint,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (expires_at>created_at),
    used_at timestamptz CHECK (used_at IS NULL OR used_at>=created_at),
    CHECK ((intent='login' AND subject_id IS NULL AND session_hash IS NULL AND auth_version IS NULL AND credential_version IS NULL)
        OR (intent='link' AND subject_id IS NOT NULL AND session_hash IS NOT NULL AND auth_version IS NOT NULL AND credential_version IS NOT NULL AND auth_version>=1 AND credential_version>=1))
);
CREATE INDEX oauth_states_expiry ON qubite_core.oauth_states(expires_at);
CREATE TABLE qubite_core.oauth_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider text NOT NULL REFERENCES qubite_core.oauth_providers(provider) ON DELETE RESTRICT,
    subject_id uuid REFERENCES qubite_core.subjects(id) ON DELETE RESTRICT,
    action text NOT NULL CHECK (action IN ('provider_enable','provider_disable','link','unlink','login')),
    source text NOT NULL CHECK (source IN ('local_operator','web')),
    created_at timestamptz NOT NULL
);
COMMENT ON TABLE qubite_core.oauth_states IS 'One-use browser-bound flow; no raw state, verifier, nonce or upstream token stored';
COMMENT ON TABLE qubite_core.oauth_identities IS 'Explicit binding by provider issuer subject; never email linking';
COMMENT ON TABLE qubite_core.oauth_audit IS 'Security metadata only; no upstream identifiers, email, tokens or response bodies';
