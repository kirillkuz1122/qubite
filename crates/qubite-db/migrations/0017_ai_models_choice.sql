-- AI-004 (D-210…D-213): owner сам выбирает модели и провайдеров, лимит
-- «на каждого пользователя», защита от зацикливания.

-- Каталог провайдера целиком (обновляется вместе с ценами): из него owner
-- включает модели. Включённые модели — по-прежнему в ai_models.
CREATE TABLE ai_catalog (
    provider_id         text NOT NULL REFERENCES ai_providers (id),
    external_id         text NOT NULL,
    context_tokens      integer NOT NULL DEFAULT 0 CHECK (context_tokens >= 0),
    price_in_per_mtok   bigint NOT NULL CHECK (price_in_per_mtok >= 0),
    price_out_per_mtok  bigint NOT NULL CHECK (price_out_per_mtok >= 0),
    fetched_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_id, external_id)
);

-- Провайдеры OpenRouter для модели (slug, по порядку). Пусто — OpenRouter
-- выбирает сам; иначе — только эти и без автосмены (allow_fallbacks = false).
ALTER TABLE ai_models ADD COLUMN routing_providers text[] NOT NULL DEFAULT '{}'
    CHECK (array_position(routing_providers, '') IS NULL);
-- «Не отдавать данные провайдерам, которые их собирают»: NULL — по настройке сервера.
ALTER TABLE ai_models ADD COLUMN data_collection text
    CHECK (data_collection IN ('allow', 'deny'));

-- Модель по умолчанию (`default`) и для отдельных задач (`inbox.triage` …).
CREATE TABLE ai_model_defaults (
    task        text PRIMARY KEY CHECK (task ~ '^[a-z][a-z0-9_.]*$' AND length(task) <= 60),
    model_id    text NOT NULL REFERENCES ai_models (id),
    changed_by  uuid REFERENCES accounts (id),
    changed_at  timestamptz NOT NULL DEFAULT now()
);

-- Лимит «на каждого пользователя»: одно значение, счётчик у каждого свой.
-- Сам AI не открывает (нужен личный лимит или режим owner, D-173).
ALTER TABLE ai_limits DROP CONSTRAINT ai_limits_scope_kind_check;
ALTER TABLE ai_limits ADD CONSTRAINT ai_limits_scope_kind_check CHECK (scope_kind IN
    ('platform', 'user', 'module', 'model', 'provider', 'user_module', 'each_user'));

-- Защита от зацикливания: фоновая задача и «отпечаток» запроса (хеш
-- с секретом процесса, не текст) — чтобы ловить одинаковые повторы.
ALTER TABLE ai_calls ADD COLUMN job_id uuid;
ALTER TABLE ai_calls ADD COLUMN fingerprint text;
CREATE INDEX ai_calls_recent_idx ON ai_calls (account_id, created_at);
CREATE INDEX ai_calls_job_idx ON ai_calls (job_id, created_at) WHERE job_id IS NOT NULL;
