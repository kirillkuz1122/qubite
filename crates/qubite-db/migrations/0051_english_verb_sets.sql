-- ENG-008 (D-899). Свои слова к неправильным глаголам: человек добавляет их списком
-- или с фото (доска, учебник, скрин домашки). Свой глагол учится так же, как
-- встроенный — прогресс в `english_verb_progress` по `verb_id` вида `my:…`.
CREATE TABLE english_verb_custom (
    account_id     uuid NOT NULL REFERENCES accounts (id),
    verb_id        text NOT NULL CHECK (verb_id LIKE 'my:%' AND char_length(verb_id) BETWEEN 4 AND 64),
    v1             text NOT NULL CHECK (char_length(v1) BETWEEN 1 AND 40),
    v2             text NOT NULL CHECK (char_length(v2) BETWEEN 1 AND 40),
    v3             text NOT NULL CHECK (char_length(v3) BETWEEN 1 AND 40),
    ru             text NOT NULL DEFAULT '' CHECK (char_length(ru) <= 80),
    created_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, verb_id)
);

-- Набор — «задание»: список глаголов (встроенных и своих), который учат вместе.
CREATE TABLE english_verb_sets (
    id             uuid PRIMARY KEY,
    account_id     uuid NOT NULL REFERENCES accounts (id),
    title          text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
    source         text NOT NULL CHECK (source IN ('photo', 'text')),
    verb_ids       jsonb NOT NULL CHECK (jsonb_typeof(verb_ids) = 'array'),
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX english_verb_sets_account_idx ON english_verb_sets (account_id, created_at DESC);
