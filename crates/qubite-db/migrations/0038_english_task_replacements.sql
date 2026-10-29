-- ENG-007c / D-582: письменные замены голосовых заданий только в этом прохождении.
-- Ответов и попыток здесь нет; исходная программа и пороги прохождения не меняются.
ALTER TABLE english_runs
    ADD COLUMN replacements jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(replacements) = 'array');
