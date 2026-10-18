-- Письма с кодами (AUTH-002): подтверждение почты и восстановление пароля.
-- В письме — 6-значный код и ссылка с длинным случайным токеном; в базе
-- только их SHA-256. Код привязан к почте, ссылка — сама по себе.
-- См. docs/architecture/AUTH_AND_PERMISSIONS.md §3.2.

CREATE TABLE email_challenges (
    id            uuid PRIMARY KEY,
    account_id    uuid NOT NULL REFERENCES accounts (id),
    purpose       text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
    -- Почта, на которую ушло письмо (в нижнем регистре).
    email         text NOT NULL,
    code_hash     bytea NOT NULL CHECK (length(code_hash) = 32),   -- SHA-256(id || ':' || код)
    link_hash     bytea NOT NULL UNIQUE CHECK (length(link_hash) = 32),
    attempts      integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    ip            text NOT NULL DEFAULT '' CHECK (length(ip) <= 64),
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    -- Закрыт: использован, заменён новым письмом или кончились попытки.
    closed_at     timestamptz,
    closed_reason text CHECK (closed_reason IN ('used', 'replaced', 'attempts')),
    CHECK ((closed_at IS NULL) = (closed_reason IS NULL))
);

CREATE INDEX email_challenges_email_idx ON email_challenges (email, purpose, created_at DESC);
CREATE INDEX email_challenges_account_idx ON email_challenges (account_id);
