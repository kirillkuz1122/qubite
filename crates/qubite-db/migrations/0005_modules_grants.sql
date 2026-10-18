-- Каталог модулей и гранты (ACC-001). См. docs/architecture/AUTH_AND_PERMISSIONS.md.
--
-- По умолчанию запрещено: новый аккаунт не получает ни одного гранта (D-054, D-172).
-- Owner имеет всё и без грантов, но выключенный модуль выключен и для него.

-- ---------------------------------------------------------------- каталог

CREATE TABLE modules (
    id          text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]*$'),
    title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
    -- Код модуля есть на сервере.
    installed   boolean NOT NULL DEFAULT false,
    -- Глобальный переключатель владельца.
    state       text NOT NULL DEFAULT 'enabled' CHECK (state IN ('enabled', 'disabled', 'maintenance')),
    -- Готовность: planned — «Готовится» для всех, кроме owner.
    readiness   text NOT NULL DEFAULT 'planned' CHECK (readiness IN ('planned', 'beta', 'stable')),
    -- Как модуль выглядит для тех, у кого нет доступа (D-036).
    visibility  text NOT NULL DEFAULT 'locked' CHECK (visibility IN ('locked', 'hidden')),
    version     bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid REFERENCES accounts (id)
);

-- Модули из docs/product/MODULES.md, которые выдаются пользователям.
-- Ядро, вход, оболочка, Owner Console и AI-шлюз сюда не входят: это не модули
-- с грантами, а части платформы (AI проверяется флагом `ai` в каждом модуле).
-- Пока ни один модуль не написан — все «не установлены» и «готовятся».
INSERT INTO modules (id, title) VALUES
    ('command', 'Command'),
    ('inbox', 'Входящие'),
    ('today', 'Сегодня'),
    ('notify', 'Уведомления'),
    ('planner', 'Planner'),
    ('docs', 'Docs'),
    ('ink', 'Ink'),
    ('atlas', 'Atlas'),
    ('learn', 'Learn'),
    ('agents', 'Агенты'),
    ('pulse', 'Pulse'),
    ('teams', 'Teams'),
    ('life', 'Life'),
    ('finance', 'Finance'),
    ('focus', 'Focus'),
    ('studio', 'Studio'),
    ('reader', 'Reader'),
    ('home', 'Qubite Home'),
    ('extensions', 'Extensions / MCP'),
    ('search', 'Search'),
    ('writer', 'Writer'),
    ('vpn', 'VPN'),
    ('kwork', 'Kwork'),
    ('vault', 'Vault'),
    ('telegram', 'Telegram'),
    ('tournaments', 'Tournaments');

-- ---------------------------------------------------------------- гранты

-- История выдачи: изменение гранта закрывает старую строку и добавляет новую.
-- Живая (не отозванная) строка на пару «аккаунт + модуль» — одна.
CREATE TABLE module_grants (
    id          uuid PRIMARY KEY,
    account_id  uuid NOT NULL REFERENCES accounts (id),
    module_id   text NOT NULL REFERENCES modules (id),
    can_read    boolean NOT NULL DEFAULT true,
    can_write   boolean NOT NULL DEFAULT false,
    can_manage  boolean NOT NULL DEFAULT false,
    can_ai      boolean NOT NULL DEFAULT false,
    granted_by  uuid REFERENCES accounts (id),
    granted_at  timestamptz NOT NULL DEFAULT now(),
    revoked_at  timestamptz,
    revoked_by  uuid REFERENCES accounts (id),
    reason      text CHECK (length(reason) <= 500),
    version     bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
    -- Изменять, управлять и пользоваться AI нельзя, не видя модуль.
    CHECK (can_read OR NOT (can_write OR can_manage OR can_ai))
);

CREATE UNIQUE INDEX module_grants_live ON module_grants (account_id, module_id) WHERE revoked_at IS NULL;
CREATE INDEX module_grants_module_idx ON module_grants (module_id) WHERE revoked_at IS NULL;
