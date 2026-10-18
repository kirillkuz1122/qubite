-- Аккаунты и вход (AUTH-001): аккаунты, единственный owner платформы,
-- пароли, сессии и журнал попыток входа для лимитов.
-- См. docs/architecture/AUTH_AND_PERMISSIONS.md.
--
-- Внешние ключи objects.owner_id и др. на accounts пока не добавляем:
-- синхронизация и тесты ядра создают объекты для любых UUID. Ключи появятся,
-- когда объекты начнут создаваться через API от имени аккаунта (ACC-001/CMD-001).

-- ---------------------------------------------------------------- аккаунты

CREATE TABLE accounts (
    id                 uuid PRIMARY KEY,                      -- UUIDv7, не меняется никогда
    -- Почта хранится в нижнем регистре, без пробелов по краям: так «Kirill@x.ru»
    -- и «kirill@x.ru» — один аккаунт.
    email              text NOT NULL UNIQUE
                       CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 320
                              AND position('@' IN email) > 1),
    email_verified_at  timestamptz,
    status             text NOT NULL DEFAULT 'pending_email'
                       CHECK (status IN ('active', 'pending_email', 'blocked')),
    display_name       text NOT NULL DEFAULT '' CHECK (length(display_name) <= 100),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    -- Активный аккаунт всегда с подтверждённой почтой (D-058).
    CHECK (status <> 'active' OR email_verified_at IS NOT NULL)
);

-- ---------------------------------------------------------------- owner платформы

-- Ровно одна строка: первичный ключ — константа true. Вторую строку база
-- не примет никогда (D-052, D-053). Менять и удалять запись тоже нельзя:
-- передача прав владельца, если понадобится, — отдельная миграция по решению владельца.
CREATE TABLE platform_owner (
    singleton   boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    account_id  uuid NOT NULL UNIQUE REFERENCES accounts (id),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER platform_owner_immutable
    BEFORE UPDATE OR DELETE ON platform_owner
    FOR EACH ROW EXECUTE FUNCTION qubite_forbid_change();
CREATE TRIGGER platform_owner_no_truncate
    BEFORE TRUNCATE ON platform_owner
    FOR EACH STATEMENT EXECUTE FUNCTION qubite_forbid_change();

-- ---------------------------------------------------------------- пароли

CREATE TABLE credentials_password (
    account_id  uuid PRIMARY KEY REFERENCES accounts (id),
    hash        text NOT NULL CHECK (hash LIKE '$argon2id$%'),   -- строка PHC, сам пароль не хранится
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- сессии

CREATE TABLE sessions (
    id             uuid PRIMARY KEY,
    account_id     uuid NOT NULL REFERENCES accounts (id),
    token_hash     bytea NOT NULL UNIQUE CHECK (length(token_hash) = 32),  -- SHA-256 токена из cookie
    csrf_hash      bytea NOT NULL CHECK (length(csrf_hash) = 32),          -- SHA-256 CSRF-токена
    kind           text NOT NULL DEFAULT 'web' CHECK (kind IN ('web', 'device')),
    user_agent     text NOT NULL DEFAULT '' CHECK (length(user_agent) <= 500),
    ip             text NOT NULL DEFAULT '' CHECK (length(ip) <= 64),
    created_at     timestamptz NOT NULL DEFAULT now(),
    last_seen_at   timestamptz NOT NULL DEFAULT now(),
    expires_at     timestamptz NOT NULL,
    revoked_at     timestamptz,
    revoke_reason  text CHECK (revoke_reason IN ('logout', 'revoked', 'logout_everywhere', 'password_changed')),
    CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);

CREATE INDEX sessions_account_live_idx ON sessions (account_id, last_seen_at DESC) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------- попытки входа

-- Только для лимитов перебора. Хранится сутки, потом удаляется.
CREATE TABLE login_attempts (
    id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at       timestamptz NOT NULL DEFAULT now(),
    email    text NOT NULL,
    ip       text NOT NULL DEFAULT '',
    success  boolean NOT NULL
);

CREATE INDEX login_attempts_email_idx ON login_attempts (email, at);
CREATE INDEX login_attempts_ip_idx ON login_attempts (ip, at) WHERE NOT success;
CREATE INDEX login_attempts_at_idx ON login_attempts (at);
