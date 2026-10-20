-- Агент Qubite (AGT-002): таймлайн действий с откатом.
-- Агент меняет данные человека без «да», поэтому каждое его действие лежит
-- здесь: кто, что, почему и точное «было → стало» по каждому объекту.
-- Откат — новое действие (как `git revert`), старые строки не меняются.
-- Решения — D-293, D-300…D-309; описание — docs/product/AGENT.md §5.

-- Модуль «Агент» в каталоге: без гранта агента нет, Qubite работает как
-- обычный планер. Это не `agents` (свои агенты и помощники, P2), а один
-- встроенный агент человека (D-300).
INSERT INTO modules (id, title, installed, readiness)
VALUES ('agent', 'Агент Qubite', true, 'beta');

-- ---------------------------------------------------------------- пробуждения

-- Одно пробуждение агента (новая мысль, утро, свободное окно, ответ …).
-- Строка дописывается при старте; закрыть её можно один раз (D-302).
CREATE TABLE agent_runs (
    id           uuid PRIMARY KEY,
    account_id   uuid NOT NULL REFERENCES accounts (id),
    trigger      text NOT NULL
                 CHECK (trigger IN ('inbox', 'morning', 'window', 'reply', 'review', 'manual')),
    started_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz,
    status       text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
    -- Модель, если агент звал AI (через AI-шлюз, CMD-004).
    model        text,
    CHECK ((status = 'running') = (finished_at IS NULL))
);

CREATE INDEX agent_runs_account_idx ON agent_runs (account_id, started_at DESC);

-- Закрыть пробуждение можно один раз; остальное в строке не меняется.
CREATE FUNCTION qubite_agent_run_finish_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' OR OLD.finished_at IS NOT NULL
       OR NEW.id <> OLD.id OR NEW.account_id <> OLD.account_id
       OR NEW.trigger <> OLD.trigger OR NEW.started_at <> OLD.started_at THEN
        RAISE EXCEPTION 'пробуждение агента можно только закрыть, один раз'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER agent_runs_finish_only
    BEFORE UPDATE OR DELETE ON agent_runs
    FOR EACH ROW EXECUTE FUNCTION qubite_agent_run_finish_only();
CREATE TRIGGER agent_runs_no_truncate
    BEFORE TRUNCATE ON agent_runs
    FOR EACH STATEMENT EXECUTE FUNCTION qubite_forbid_change();

-- ---------------------------------------------------------------- действия

-- Лента «Что сделал агент». Только дописывается: откат и исправление —
-- новые строки со ссылкой на старую (`reverts`, `corrects`). Состояние
-- «откачено» не хранится, а считается по ссылкам (D-303).
CREATE TABLE agent_actions (
    seq         bigint GENERATED ALWAYS AS IDENTITY UNIQUE,   -- порядок ленты
    id          uuid PRIMARY KEY,
    account_id  uuid NOT NULL REFERENCES accounts (id),
    -- Действия агента — в его пробуждении; твои (откат, исправление) — без.
    run_id      uuid REFERENCES agent_runs (id),
    -- Шаги одного решения: откатываются вместе одной кнопкой.
    batch_id    uuid NOT NULL,
    -- agent — агент; owner — ты сам (откат, исправление); system — Qubite.
    actor       text NOT NULL CHECK (actor IN ('agent', 'owner', 'system')),
    -- Навык, по которому действовал агент (AGT-003); пока без ключа.
    skill_id    uuid,
    -- Инструмент: `task.create`, `inbox.file`, `timeline.revert`, …
    tool        text NOT NULL CHECK (tool ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
    -- Что сделано — фраза для ленты.
    summary     text NOT NULL CHECK (length(summary) BETWEEN 1 AND 500),
    -- Почему — на что агент опирался (память, навык, просьба).
    reason      text CHECK (length(reason) <= 1000),
    -- Это откат действия …
    reverts     uuid REFERENCES agent_actions (id),
    -- … или твоя поправка к действию агента (агент на ней учится).
    corrects    uuid REFERENCES agent_actions (id),
    -- Цена: вызов AI-шлюза, если он был.
    ai_call_id  uuid REFERENCES ai_calls (id),
    at          timestamptz NOT NULL DEFAULT now(),
    CHECK (reverts IS NULL OR corrects IS NULL),
    CHECK (actor <> 'agent' OR run_id IS NOT NULL)
);

CREATE INDEX agent_actions_account_idx ON agent_actions (account_id, seq DESC);
CREATE INDEX agent_actions_batch_idx ON agent_actions (batch_id);
CREATE INDEX agent_actions_reverts_idx ON agent_actions (reverts) WHERE reverts IS NOT NULL;
CREATE INDEX agent_actions_corrects_idx ON agent_actions (corrects) WHERE corrects IS NOT NULL;

CREATE TRIGGER agent_actions_append_only
    BEFORE UPDATE OR DELETE ON agent_actions
    FOR EACH ROW EXECUTE FUNCTION qubite_forbid_change();
CREATE TRIGGER agent_actions_no_truncate
    BEFORE TRUNCATE ON agent_actions
    FOR EACH STATEMENT EXECUTE FUNCTION qubite_forbid_change();

-- ---------------------------------------------------------------- было → стало

-- Точный снимок объекта до и после действия (заголовок, корзина, поля
-- модуля, версия — как в синхронизации). По нему делается откат и
-- проверяется, не меняли ли объект после агента.
CREATE TABLE agent_action_changes (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    action_id    uuid NOT NULL REFERENCES agent_actions (id),
    -- Без внешнего ключа: история переживает объект.
    object_id    uuid NOT NULL,
    object_type  text NOT NULL,
    -- NULL — объекта до действия не было (создан).
    before       jsonb CHECK (before IS NULL OR jsonb_typeof(before) = 'object'),
    after        jsonb NOT NULL CHECK (jsonb_typeof(after) = 'object'),
    -- Проект объекта до или после (для ленты у проекта).
    project_ids  uuid[] NOT NULL DEFAULT '{}'
);

CREATE INDEX agent_action_changes_action_idx ON agent_action_changes (action_id);
CREATE INDEX agent_action_changes_object_idx ON agent_action_changes (object_id);
CREATE INDEX agent_action_changes_project_idx ON agent_action_changes USING gin (project_ids);

CREATE TRIGGER agent_action_changes_append_only
    BEFORE UPDATE OR DELETE ON agent_action_changes
    FOR EACH ROW EXECUTE FUNCTION qubite_forbid_change();
CREATE TRIGGER agent_action_changes_no_truncate
    BEFORE TRUNCATE ON agent_action_changes
    FOR EACH STATEMENT EXECUTE FUNCTION qubite_forbid_change();
