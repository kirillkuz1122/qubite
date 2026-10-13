-- QUB-AUTH-002: fresh accounts only; no legacy import, password or session tables.
CREATE TABLE qubite_core.subjects (
    id uuid PRIMARY KEY,
    email_original text NOT NULL CHECK (
        char_length(email_original) BETWEEN 3 AND 320
        AND email_original = btrim(email_original)
        AND email_original !~ '[[:cntrl:][:space:]]'
    ),
    email_canonical text COLLATE "C" NOT NULL
        CONSTRAINT subjects_email_canonical_key UNIQUE
        CHECK (octet_length(email_canonical) BETWEEN 3 AND 254
               AND email_canonical !~ '[[:cntrl:][:space:]]'
               AND email_canonical ~ '^[^@]+@[^@]+$'),
    display_name text CHECK (display_name IS NULL OR (
        char_length(display_name) BETWEEN 1 AND 160
        AND display_name = btrim(display_name)
        AND display_name !~ '[[:cntrl:]]'
    )),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'blocked')),
    email_verified_at timestamptz,
    auth_version bigint NOT NULL DEFAULT 1 CHECK (auth_version >= 1),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (updated_at >= created_at),
    -- Composite FK below prevents silently deactivating the singleton owner.
    UNIQUE (id, status)
);

CREATE TABLE qubite_core.platform_owner (
    singleton_id smallint PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
    subject_id uuid NOT NULL UNIQUE,
    subject_status text NOT NULL DEFAULT 'active' CHECK (subject_status = 'active'),
    bootstrapped_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    bootstrap_source text NOT NULL DEFAULT 'local_operator'
        CHECK (bootstrap_source = 'local_operator'),
    FOREIGN KEY (subject_id, subject_status)
        REFERENCES qubite_core.subjects (id, status)
        ON UPDATE RESTRICT ON DELETE RESTRICT
);

COMMENT ON TABLE qubite_core.subjects IS 'Fresh core identity; no role or implicit module/model/budget grants';
COMMENT ON TABLE qubite_core.platform_owner IS 'Explicit local bootstrap only; no public first-registration promotion';
