-- CMD-005a. Распознавание выбирает человек; на сервере локальных моделей нет.
CREATE TABLE voice_prefs (
    account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    method text NOT NULL DEFAULT 'cloud' CHECK (method IN ('cloud', 'device', 'local', 'own_key')),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Сохраняем исходный результат даже после редактирования текста человеком.
-- Повтор загрузки не вызывает AI и не прикрепляет звук второй раз.
CREATE TABLE inbox_voice_captures (
    object_id uuid PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE,
    transcribed boolean NOT NULL,
    reason text
);
