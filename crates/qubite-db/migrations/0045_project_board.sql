-- PLAN-002a. NULL — стандартная доска «Надо / В работе / Готово».
-- Откат: ALTER TABLE planner_projects DROP COLUMN board;
-- откат удаляет настройки досок и требует отдельного решения владельца.
ALTER TABLE planner_projects ADD COLUMN board jsonb;
