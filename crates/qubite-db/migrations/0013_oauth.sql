-- Вход через внешних провайдеров (AUTH-004): Яндекс ID, VK ID, Google, Telegram.
-- Решения — D-194, D-195.
--
-- Вход — только по сохранённому ID у провайдера. Совпадение почты аккаунты
-- не объединяет (D-060): привязать провайдера можно лишь из открытого
-- аккаунта с подтверждением пароля.

CREATE TABLE oauth_identities (
    provider       text NOT NULL CHECK (provider IN ('yandex', 'vk', 'google', 'telegram')),
    -- ID человека у провайдера (строка: у VK и Telegram — число, у Google — sub).
    subject        text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
    account_id     uuid NOT NULL REFERENCES accounts (id),
    -- Что провайдер сообщил при привязке — только для показа в профиле.
    email          text CHECK (email IS NULL OR length(email) <= 320),
    display_name   text NOT NULL DEFAULT '' CHECK (length(display_name) <= 200),
    linked_at      timestamptz NOT NULL DEFAULT now(),
    last_login_at  timestamptz,
    PRIMARY KEY (provider, subject),
    -- У аккаунта не больше одной привязки к каждому провайдеру.
    UNIQUE (account_id, provider)
);

-- Начатые входы. Секрет `state` лежит у браузера в cookie и приходит обратно
-- в адресе возврата; в базе — только его хеш. Вход одноразовый, живёт 10 минут.
CREATE TABLE oauth_flows (
    id             uuid PRIMARY KEY,
    state_hash     bytea NOT NULL UNIQUE CHECK (length(state_hash) = 32),
    provider       text NOT NULL CHECK (provider IN ('yandex', 'vk', 'google')),
    intent         text NOT NULL CHECK (intent IN ('login', 'link')),
    -- Для привязки: чей аккаунт и из какой сессии.
    account_id     uuid REFERENCES accounts (id),
    session_id     uuid REFERENCES sessions (id),
    -- PKCE: секрет, хеш которого ушёл провайдеру.
    code_verifier  text NOT NULL CHECK (length(code_verifier) BETWEEN 43 AND 128),
    -- Куда вернуть человека после входа (путь на нашем сайте).
    return_to      text NOT NULL DEFAULT '/' CHECK (return_to ~ '^/[^/\\]' OR return_to = '/'),
    created_at     timestamptz NOT NULL DEFAULT now(),
    expires_at     timestamptz NOT NULL,
    used_at        timestamptz,
    CHECK ((intent = 'link') = (account_id IS NOT NULL AND session_id IS NOT NULL))
);

CREATE INDEX oauth_flows_expires_idx ON oauth_flows (expires_at);

-- Подписанные данные Telegram уже использованы (повтор не пускает второй раз).
CREATE TABLE oauth_seen (
    digest   bytea PRIMARY KEY CHECK (length(digest) = 32),
    seen_at  timestamptz NOT NULL DEFAULT now()
);
