-- Лента синхронизации (SYNC-007, D-875…D-877): курсор, который не теряет
-- изменения.
--
-- Было: устройства забирали изменения по `events.seq`. Этот номер выдаётся при
-- вставке, до commit: медленная транзакция получает seq=1, быстрая — seq=2 и
-- фиксируется первой; устройство запоминает курсор 2 и событие 1 не увидит
-- уже никогда.
--
-- Стало: у каждого объекта одна строка «когда он менялся в последний раз» с
-- номером `pos`. Номер выдаётся не при вставке события, а в самом конце
-- транзакции (отложенный триггер) под одной блокировкой на базу, которая
-- держится до конца commit. Поэтому порядок `pos` — это порядок commit:
-- строка с меньшим номером всегда становится видна раньше строки с большим,
-- и курсор «всё до pos включительно получено» ничего не пропускает.
--
-- Блокировка берётся только на время commit (не на всю транзакцию), а её
-- владелец в это время ничего больше не ждёт: у ленты нет внешних ключей и
-- её строки меняются только под этой же блокировкой. Взаимной блокировки с
-- обычными блокировками строк объектов быть не может.

CREATE SEQUENCE sync_feed_pos_seq AS bigint;

CREATE TABLE sync_feed (
    -- Без внешнего ключа на objects: его проверка брала бы блокировку строки
    -- объекта во время commit. Строка навсегда удалённого объекта остаётся и
    -- при выдаче просто пропускается.
    object_id  uuid PRIMARY KEY,
    pos        bigint NOT NULL,
    owner_id   uuid NOT NULL,
    module_id  text NOT NULL,
    -- Последнее событие объекта — для разбора «почему объект в ленте».
    event_seq  bigint NOT NULL
);

CREATE INDEX sync_feed_owner_idx ON sync_feed (owner_id, pos);

CREATE FUNCTION qubite_sync_feed_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    obj record;
BEGIN
    IF NEW.object_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT owner_id, module_id INTO obj FROM objects WHERE id = NEW.object_id;
    IF NOT FOUND THEN
        RETURN NULL; -- объект удалили навсегда в этой же транзакции
    END IF;
    -- Одна блокировка на базу; отпускается сама, когда commit уже виден всем.
    PERFORM pg_advisory_xact_lock(hashtextextended('qubite.sync_feed', 0));
    INSERT INTO sync_feed (object_id, pos, owner_id, module_id, event_seq)
    VALUES (NEW.object_id, nextval('sync_feed_pos_seq'), obj.owner_id, obj.module_id, NEW.seq)
    ON CONFLICT (object_id) DO UPDATE
        SET pos = EXCLUDED.pos,
            owner_id = EXCLUDED.owner_id,
            module_id = EXCLUDED.module_id,
            event_seq = EXCLUDED.event_seq;
    RETURN NULL;
END;
$$;

-- Пока идёт перенос, новые события не пишутся: иначе событие, вставленное
-- между переносом и появлением триггера, не попало бы в ленту.
LOCK TABLE events IN SHARE ROW EXCLUSIVE MODE;

-- Отложенный триггер: срабатывает в конце транзакции, прямо перед commit.
CREATE CONSTRAINT TRIGGER events_sync_feed
    AFTER INSERT ON events
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION qubite_sync_feed_touch();

-- Перенос: все объекты, у которых есть события, в порядке последнего события.
-- Старые числовые курсоры устройств сервер больше не принимает за позицию:
-- устройство с таким курсором один раз забирает всё заново (D-877).
INSERT INTO sync_feed (object_id, pos, owner_id, module_id, event_seq)
SELECT ordered.id, nextval('sync_feed_pos_seq'), ordered.owner_id, ordered.module_id, ordered.seq
FROM (
    SELECT o.id, o.owner_id, o.module_id, last.seq
    FROM (
        SELECT object_id, max(seq) AS seq
        FROM events
        WHERE object_id IS NOT NULL
        GROUP BY object_id
    ) last
    JOIN objects o ON o.id = last.object_id
    ORDER BY last.seq
) ordered;
