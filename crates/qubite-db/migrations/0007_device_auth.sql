-- Вход приложений (AUTH-006): OAuth 2.0 для нативных приложений (RFC 8252)
-- с PKCE (RFC 7636). Приложение открывает системный браузер, человек
-- подтверждает вход в своей web-сессии, приложение меняет одноразовый код
-- на токены устройства: короткий access и долгий refresh с ротацией.
--
-- Сессия устройства — строка `sessions` с kind = 'device'. В `token_hash`
-- лежит хеш текущего access-токена, срок access — `access_expires_at`,
-- срок всей сессии (refresh) — `expires_at`, как у web.

ALTER TABLE sessions
    ADD COLUMN device_name text NOT NULL DEFAULT '' CHECK (length(device_name) <= 100),
    ADD COLUMN client_id text,
    ADD COLUMN access_expires_at timestamptz,
    ADD CONSTRAINT sessions_device_fields CHECK (
        (kind = 'device') = (client_id IS NOT NULL AND access_expires_at IS NOT NULL));

ALTER TABLE sessions DROP CONSTRAINT sessions_revoke_reason_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_revoke_reason_check CHECK (
    revoke_reason IN ('logout', 'revoked', 'logout_everywhere', 'password_changed', 'refresh_reuse'));

-- Одноразовый код подтверждения: живёт 5 минут, привязан к PKCE-вызову,
-- приложению и адресу возврата.
CREATE TABLE device_auth_codes (
    id              uuid PRIMARY KEY,
    code_hash       bytea NOT NULL UNIQUE CHECK (length(code_hash) = 32),
    account_id      uuid NOT NULL REFERENCES accounts (id),
    -- Web-сессия, в которой человек подтвердил вход.
    web_session_id  uuid NOT NULL REFERENCES sessions (id),
    client_id       text NOT NULL,
    redirect_uri    text NOT NULL CHECK (length(redirect_uri) <= 300),
    code_challenge  text NOT NULL CHECK (length(code_challenge) = 43),
    device_name     text NOT NULL DEFAULT '' CHECK (length(device_name) <= 100),
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    used_at         timestamptz,
    -- Сессия, выданная по коду. Повтор кода закрывает и её (RFC 6749 §4.1.2).
    issued_session_id uuid REFERENCES sessions (id)
);

CREATE INDEX device_auth_codes_expires_idx ON device_auth_codes (expires_at);

-- Refresh-токены. Каждый одноразовый: при обновлении выдаётся новый.
-- Повторное предъявление уже использованного — признак кражи: вся сессия
-- устройства закрывается.
CREATE TABLE device_refresh_tokens (
    token_hash  bytea PRIMARY KEY CHECK (length(token_hash) = 32),
    session_id  uuid NOT NULL REFERENCES sessions (id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    used_at     timestamptz
);

CREATE INDEX device_refresh_tokens_session_idx ON device_refresh_tokens (session_id);
