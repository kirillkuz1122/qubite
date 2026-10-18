-- Входящие (CMD-001): поля элемента «inbox.item» поверх общего конверта
-- объекта, место под результат разбора и уведомление «есть новое».
-- Решения — D-190…D-193.

CREATE TABLE inbox_items (
    object_id    uuid PRIMARY KEY REFERENCES objects (id) ON DELETE CASCADE,
    -- Что прислали: текст, ссылка, файл, голос.
    kind         text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'link', 'file', 'voice')),
    -- Полный текст мысли (заголовок объекта — короткая первая строка).
    body         text NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
    url          text CHECK (url IS NULL OR (length(url) <= 2000 AND url ~ '^https?://')),
    -- Откуда пришло.
    source       text NOT NULL DEFAULT 'web'
                 CHECK (source IN ('web', 'desktop', 'android', 'telegram', 'api')),
    -- Когда записано на устройстве (офлайн-запись приходит позже).
    captured_at  timestamptz NOT NULL DEFAULT now(),
    -- new — ждёт разбора; archived — разобрано или убрано в архив (D-190).
    status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'archived')),
    archived_at  timestamptz,
    -- Разбор (делают CMD-003/CMD-004): pending — не разбиралось;
    -- suggested — есть предложение; confirmed — человек принял; skipped — оставлено как есть.
    triage_status text NOT NULL DEFAULT 'pending'
                 CHECK (triage_status IN ('pending', 'suggested', 'confirmed', 'skipped')),
    -- Что это: task, note, project_thought, agent_request, other (список — в коде).
    intent       text CHECK (intent IS NULL OR intent ~ '^[a-z][a-z_]*$'),
    -- Подробности разбора: кто разобрал, уверенность, краткая суть.
    triage       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(triage) = 'object'),
    triaged_at   timestamptz,
    CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);

CREATE INDEX inbox_items_status_idx ON inbox_items (status, captured_at DESC);

-- «Есть новое»: любое событие объекта будит WebSocket владельца объекта.
-- Сервер слушает канал qubite_changes (LISTEN) и рассылает подсказку
-- подключённым устройствам; данные они забирают через /api/v1/sync/pull.
-- Одинаковые уведомления в одной транзакции PostgreSQL склеивает в одно.
CREATE FUNCTION qubite_notify_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    owner uuid;
BEGIN
    IF NEW.object_id IS NOT NULL THEN
        SELECT owner_id INTO owner FROM objects WHERE id = NEW.object_id;
        IF owner IS NOT NULL THEN
            PERFORM pg_notify('qubite_changes', owner::text);
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER events_notify_change
    AFTER INSERT ON events
    FOR EACH ROW EXECUTE FUNCTION qubite_notify_change();

-- Код модуля «Входящие» теперь есть на сервере. Экрана ещё нет, поэтому
-- «бета»; доступ по-прежнему только по гранту (owner — сам по себе).
UPDATE modules SET installed = true, readiness = 'beta', version = version + 1
WHERE id = 'inbox';
