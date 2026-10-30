-- AGT-006a. Здесь только место назначения; исходные координаты не хранятся.
-- Откат структуры: ALTER TABLE planner_tasks DROP COLUMN place_text,
-- DROP COLUMN place_lat, DROP COLUMN place_lon, DROP COLUMN travel_minutes;
-- он удаляет данные места, поэтому требует отдельного решения владельца.
ALTER TABLE planner_tasks
    ADD COLUMN place_text text CHECK (char_length(place_text) <= 1000),
    ADD COLUMN place_lat double precision,
    ADD COLUMN place_lon double precision,
    ADD COLUMN travel_minutes integer CHECK (travel_minutes BETWEEN 0 AND 525600),
    ADD CONSTRAINT planner_task_place_point CHECK (
        (place_lat IS NULL AND place_lon IS NULL) OR
        (place_lat IS NOT NULL AND place_lon IS NOT NULL AND
         place_lat BETWEEN -90 AND 90 AND place_lon BETWEEN -180 AND 180)
    );
