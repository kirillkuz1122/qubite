-- AGT-006c. Длительность самого дела, без дороги.
-- Откат: ALTER TABLE planner_tasks DROP COLUMN duration_minutes, DROP COLUMN duration_by;
-- откат удаляет оценки длительности и требует отдельного решения владельца.
ALTER TABLE planner_tasks
    ADD COLUMN duration_minutes integer CHECK (duration_minutes BETWEEN 1 AND 1440),
    ADD COLUMN duration_by text CHECK (duration_by IN ('owner', 'agent')),
    ADD CONSTRAINT planner_task_duration_pair CHECK (
        (duration_minutes IS NULL AND duration_by IS NULL) OR
        (duration_minutes IS NOT NULL AND duration_by IS NOT NULL)
    );
