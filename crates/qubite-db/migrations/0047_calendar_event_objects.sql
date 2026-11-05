-- DOC-003d-1, D-795: события доступны упоминаниям и обратным ссылкам.
-- UUID остаётся прежним, включая ссылки /calendar?event=<id>.
INSERT INTO objects (
    id, type, module_id, owner_id, title, created_by, updated_by,
    created_at, updated_at, deleted_at
)
SELECT id, 'calendar.event', 'calendar', owner_id, title, owner_id, owner_id,
       created_at, updated_at, CASE WHEN deleted THEN updated_at END
FROM calendar_events
ON CONFLICT DO NOTHING;
