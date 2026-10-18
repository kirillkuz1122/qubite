-- AI-шлюз и бюджеты (AI-001). См. docs/architecture/AI_COST_GUARD.md.
--
-- Деньги — целые микродоллары (1 $ = 1 000 000). По умолчанию лимитов нет,
-- а без личного денежного лимита AI запрещён: бюджет по умолчанию — ноль (D-173).

CREATE TABLE ai_providers (
    id              text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]*$'),
    kind            text NOT NULL CHECK (kind IN ('openrouter', 'openai', 'local', 'mock')),
    base_url        text NOT NULL DEFAULT '',
    -- Ссылка на секрет (сам ключ — зашифрованно, ACC-004); здесь ключа нет никогда.
    key_secret_ref  text,
    enabled         boolean NOT NULL DEFAULT false,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_models (
    id                  text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9_.:/-]*$'),
    provider_id         text NOT NULL REFERENCES ai_providers (id),
    external_id         text NOT NULL,                -- имя модели у провайдера
    capabilities        text[] NOT NULL DEFAULT ARRAY['text'],
    -- Цена за миллион токенов в микродолларах.
    price_in_per_mtok   bigint NOT NULL CHECK (price_in_per_mtok >= 0),
    price_out_per_mtok  bigint NOT NULL CHECK (price_out_per_mtok >= 0),
    context_tokens      integer NOT NULL DEFAULT 0 CHECK (context_tokens >= 0),
    -- Входит в allowlist.
    enabled             boolean NOT NULL DEFAULT false,
    -- Заблокирована: например, ответ оказался дороже оценки (D-073). Снимает owner.
    blocked_reason      text,
    prices_updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Лимит: на что (scope), за какой период, в чём измеряется.
CREATE TABLE ai_limits (
    id           uuid PRIMARY KEY,
    scope_kind   text NOT NULL CHECK (scope_kind IN ('platform', 'user', 'module', 'model', 'provider', 'user_module')),
    account_id   uuid REFERENCES accounts (id),
    module_id    text REFERENCES modules (id),
    model_id     text REFERENCES ai_models (id),
    provider_id  text REFERENCES ai_providers (id),
    period       text NOT NULL CHECK (period IN ('hour', 'day', 'month', 'all')),
    metric       text NOT NULL CHECK (metric IN ('usd', 'requests', 'tokens')),
    limit_value  bigint NOT NULL CHECK (limit_value >= 0),
    created_by   uuid REFERENCES accounts (id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    revoked_at   timestamptz,
    CHECK ((account_id IS NOT NULL) = (scope_kind IN ('user', 'user_module'))),
    CHECK ((module_id IS NOT NULL) = (scope_kind IN ('module', 'user_module'))),
    CHECK ((model_id IS NOT NULL) = (scope_kind = 'model')),
    CHECK ((provider_id IS NOT NULL) = (scope_kind = 'provider'))
);

-- Один живой лимит на сочетание «область + период + метрика».
CREATE UNIQUE INDEX ai_limits_live ON ai_limits (
    scope_kind, coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(module_id, ''), coalesce(model_id, ''), coalesce(provider_id, ''), period, metric
) WHERE revoked_at IS NULL;

-- Счётчик: одна строка на лимит и период («2026-10-18», «2026-10», «all»…).
CREATE TABLE ai_usage_counters (
    limit_id    uuid NOT NULL REFERENCES ai_limits (id),
    period_key  text NOT NULL,
    reserved    bigint NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    spent       bigint NOT NULL DEFAULT 0 CHECK (spent >= 0),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (limit_id, period_key)
);

CREATE TABLE ai_calls (
    id               uuid PRIMARY KEY,
    request_id       text NOT NULL UNIQUE CHECK (length(request_id) BETWEEN 1 AND 200),
    account_id       uuid NOT NULL REFERENCES accounts (id),
    module_id        text NOT NULL REFERENCES modules (id),
    model_id         text NOT NULL REFERENCES ai_models (id),
    status           text NOT NULL CHECK (status IN ('reserved', 'sending', 'succeeded', 'failed_not_sent', 'unknown', 'denied')),
    attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    estimate_usd     bigint NOT NULL CHECK (estimate_usd >= 0),
    estimate_tokens  bigint NOT NULL CHECK (estimate_tokens >= 0),
    actual_usd       bigint CHECK (actual_usd >= 0),
    tokens_in        bigint,
    tokens_out       bigint,
    -- Что и в каких периодах зарезервировано: [{limit_id, period_key, amount}].
    -- Возврат и списание идут ровно по этим строкам, даже если сменился пояс.
    reservations     jsonb NOT NULL DEFAULT '[]'::jsonb,
    error_code       text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    settled_at       timestamptz
);

CREATE INDEX ai_calls_account_idx ON ai_calls (account_id, created_at DESC);
CREATE INDEX ai_calls_open_idx ON ai_calls (updated_at) WHERE status IN ('reserved', 'sending', 'unknown');

-- Журнал вызова: без текста запроса и без секретов.
CREATE TABLE ai_call_events (
    id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    call_id  uuid NOT NULL REFERENCES ai_calls (id),
    at       timestamptz NOT NULL DEFAULT now(),
    kind     text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_.]*$'),
    details  jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX ai_call_events_call_idx ON ai_call_events (call_id, id);

CREATE TRIGGER ai_call_events_append_only
    BEFORE UPDATE OR DELETE ON ai_call_events
    FOR EACH ROW EXECUTE FUNCTION qubite_forbid_change();
