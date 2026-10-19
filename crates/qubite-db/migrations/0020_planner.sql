-- Planner (PLAN-001): проекты и дела поверх общего конверта объекта.
-- Дело принадлежит проекту через обычную связь ядра `part_of`
-- (дело → проект), а не через колонку: так связи видят и Command, и граф.
-- Решения — D-250…D-264.

CREATE TABLE planner_projects (
    object_id  uuid PRIMARY KEY REFERENCES objects (id) ON DELETE CASCADE,
    -- Цвет точки проекта из палитры «Частиц».
    color      text NOT NULL DEFAULT 'orange'
               CHECK (color IN ('orange', 'sky', 'yellow', 'green', 'peach')),
    -- Как проект пишут в Command: «#алгебра». Без пробелов и «#».
    tag        text NOT NULL CHECK (tag ~ '^[^[:space:]#]{1,64}$'),
    -- active — идёт; archived — закончен или отложен (дела остаются).
    status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    notes      text NOT NULL DEFAULT '' CHECK (length(notes) <= 20000)
);

CREATE INDEX planner_projects_tag_idx ON planner_projects (lower(tag));

CREATE TABLE planner_tasks (
    object_id    uuid PRIMARY KEY REFERENCES objects (id) ON DELETE CASCADE,
    notes        text NOT NULL DEFAULT '' CHECK (length(notes) <= 20000),
    -- todo — надо; doing — в работе; done — сделано.
    status       text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
    priority     text NOT NULL DEFAULT 'normal'
                 CHECK (priority IN ('normal', 'important', 'urgent')),
    -- Срок — день и (необязательно) время по часам владельца, без пояса:
    -- «во вторник в 16:00» остаётся 16:00, куда бы ни уехал телефон.
    due_date     date,
    due_time     time,
    -- Шаги с галочками: [{"id": "…", "title": "…", "done": false}].
    subtasks     jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(subtasks) = 'array'),
    -- Повторение: {"freq": "daily"|"weekly"|"monthly", "interval": 1, "weekdays": [2], "month_day": 5}.
    recurrence   jsonb CHECK (recurrence IS NULL OR jsonb_typeof(recurrence) = 'object'),
    completed_at timestamptz,
    -- Серия повторений: ID первого дела серии и следующее дело, созданное
    -- при выполнении этого (второй раз не создаётся).
    series_id    uuid,
    next_id      uuid,
    CHECK (due_time IS NULL OR due_date IS NOT NULL),
    CHECK (recurrence IS NULL OR due_date IS NOT NULL),
    CHECK ((status = 'done') = (completed_at IS NOT NULL))
);

CREATE INDEX planner_tasks_due_idx ON planner_tasks (due_date) WHERE status <> 'done';

-- Код модуля есть на сервере, экраны «Сегодня» и Planner — на настоящих
-- данных; доступ по-прежнему только по гранту (owner — сам по себе).
UPDATE modules SET installed = true, readiness = 'beta', version = version + 1
WHERE id = 'planner';
