-- ENG-008 (D-887…D-889). Неправильные глаголы: интервальное повторение.
-- Сами глаголы встроены в сервер (`content/english/verbs.json`), в базе — только
-- как идёт каждый глагол у человека: «лёгкость», интервал и когда повторять.
CREATE TABLE english_verb_progress (
    account_id     uuid NOT NULL REFERENCES accounts (id),
    verb_id        text NOT NULL CHECK (char_length(verb_id) BETWEEN 1 AND 64),
    ease           real NOT NULL DEFAULT 2.5 CHECK (ease BETWEEN 1.3 AND 3.0),
    interval_days  integer NOT NULL DEFAULT 0 CHECK (interval_days BETWEEN 0 AND 3650),
    due_on         date NOT NULL,
    reps           integer NOT NULL DEFAULT 0 CHECK (reps >= 0),
    lapses         integer NOT NULL DEFAULT 0 CHECK (lapses >= 0),
    last_wrong_on  date,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, verb_id)
);

CREATE INDEX english_verb_progress_due_idx ON english_verb_progress (account_id, due_on);
