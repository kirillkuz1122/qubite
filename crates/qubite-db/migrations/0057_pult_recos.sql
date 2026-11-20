-- AOS-5d (D-1093, D-1094). Карточки недели и задания, которые забирает менеджер.
CREATE TABLE pult_recos (
    id uuid PRIMARY KEY,
    week text NOT NULL CHECK (week ~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$'),
    ref text NOT NULL CHECK (char_length(ref) BETWEEN 1 AND 128),
    arms text NOT NULL CHECK (arms IN ('apps', 'routines', 'memory', 'skills', 'jokers')),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
    noticed text NOT NULL CHECK (char_length(noticed) BETWEEN 1 AND 300),
    will_do text NOT NULL CHECK (char_length(will_do) BETWEEN 1 AND 300),
    effort text NOT NULL CHECK (effort IN ('S', 'M', 'L')),
    saving text CHECK (char_length(saving) <= 80),
    files text[] NOT NULL CHECK (cardinality(files) <= 8 AND array_position(files, NULL) IS NULL),
    joker boolean NOT NULL CHECK (joker = (arms = 'jokers')),
    status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'basket', 'no', 'later', 'applied')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (week, ref)
);

CREATE INDEX pult_recos_basket ON pult_recos (created_at, id) WHERE status = 'basket';

CREATE TABLE pult_reco_batches (
    id uuid PRIMARY KEY,
    brief text NOT NULL CHECK (char_length(brief) > 0),
    card_ids uuid[] NOT NULL CHECK (cardinality(card_ids) > 0 AND array_position(card_ids, NULL) IS NULL),
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'taken')),
    created_at timestamptz NOT NULL DEFAULT now(),
    taken_at timestamptz,
    CHECK ((status = 'taken') = (taken_at IS NOT NULL))
);

CREATE INDEX pult_reco_batches_queue ON pult_reco_batches (created_at, id) WHERE status = 'queued';
