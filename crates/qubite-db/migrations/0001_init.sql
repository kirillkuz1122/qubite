-- Первая миграция Qubite 2.0: служебная таблица сведений о базе.
-- Настоящие таблицы (аккаунты, объекты, модули) появляются в следующих задачах.

CREATE TABLE qubite_meta (
    key        text PRIMARY KEY,
    value      text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO qubite_meta (key, value) VALUES ('schema_family', 'qubite-2');
