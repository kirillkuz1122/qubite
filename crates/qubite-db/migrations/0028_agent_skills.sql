-- Навыки агента (AGT-003): агент пишет и уточняет их сам, куратор убирает
-- неиспользуемые в архив. Решения — D-292, D-325, D-360…D-369; описание —
-- docs/product/AGENT.md §4.
--
-- Навык — это файл «Навыки/<навык>.md» папки агента (AGT-001, `agent.file`,
-- формат SKILL.md). Здесь только то, что нужно навыку сверх текста:
-- закреплён ли, в архиве ли, когда им пользовались и встроенный ли он.
-- «Закреплён» и «в архиве» меняются через ленту (с откатом), как текст;
-- «когда пользовались» — счётчик сервера, в ленту не пишется.

ALTER TABLE agent_files
    -- Закреплённый навык куратор не трогает.
    ADD COLUMN pinned   boolean NOT NULL DEFAULT false,
    -- В архиве: агент его не видит в списке, файл не удалён и возвращается одной кнопкой.
    ADD COLUMN archived boolean NOT NULL DEFAULT false,
    -- Когда агент последний раз действовал по навыку или открывал его
    -- (а также когда навык вернули из архива) — по этому судит куратор.
    ADD COLUMN used_at  timestamptz,
    ADD COLUMN uses     integer NOT NULL DEFAULT 0 CHECK (uses >= 0),
    -- Встроенный навык (пишем мы, проверен тестами): ключ из кода. Его
    -- копия — навык человека: правится и уточняется как любой другой.
    ADD COLUMN builtin  text CHECK (builtin ~ '^[a-z][a-z0-9-]{1,40}$'),
    ADD CONSTRAINT agent_files_skill_only
        CHECK (kind = 'skill' OR (NOT pinned AND NOT archived AND builtin IS NULL));

-- Встроенный навык заводится человеку один раз (и не возвращается сам, если
-- человек его переписал или убрал).
CREATE UNIQUE INDEX agent_files_builtin_idx ON agent_files (account_id, builtin)
    WHERE builtin IS NOT NULL;

-- Куратор ищет живые неиспользуемые навыки.
CREATE INDEX agent_files_skills_idx ON agent_files (account_id)
    WHERE kind = 'skill' AND NOT archived AND NOT pinned;
