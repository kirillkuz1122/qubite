-- Регистрация и приглашения (AUTH-003), настройки платформы (начало ACC-002).
-- См. docs/architecture/AUTH_AND_PERMISSIONS.md §3.3.

-- ---------------------------------------------------------------- настройки платформы

-- Тумблеры owner: одна строка на настройку. Нет строки — действует значение
-- по умолчанию из кода. `version` растёт при каждом изменении (защита от
-- одновременной правки из двух вкладок).
CREATE TABLE platform_settings (
    key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$'),
    value       jsonb NOT NULL,
    version     bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_by  uuid REFERENCES accounts (id),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- приглашения

-- Приглашение одноразовое: на конкретную почту или общая ссылка (D-057).
-- Код (12 знаков, его же содержит ссылка) показывается один раз; в базе — SHA-256.
CREATE TABLE invitations (
    id          uuid PRIMARY KEY,
    kind        text NOT NULL CHECK (kind IN ('email_bound', 'open_link')),
    email       text CHECK (email = lower(btrim(email))),
    code_hash   bytea NOT NULL UNIQUE CHECK (length(code_hash) = 32),
    note        text NOT NULL DEFAULT '' CHECK (length(note) <= 200),
    created_by  uuid NOT NULL REFERENCES accounts (id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    used_by     uuid REFERENCES accounts (id),
    revoked_at  timestamptz,
    revoked_by  uuid REFERENCES accounts (id),
    CHECK ((kind = 'email_bound') = (email IS NOT NULL)),
    CHECK ((used_at IS NULL) = (used_by IS NULL)),
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
    CHECK (used_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX invitations_created_idx ON invitations (created_at DESC);
