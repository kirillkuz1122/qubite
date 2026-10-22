-- Проект как папка (PROJ-001, D-470…D-479): документы проекта.
--
-- Документ — объект ядра `docs.page` (заголовок, версия, корзина, история) и
-- его текст Markdown здесь. В проект он входит обычной связью ядра `part_of`
-- (документ → проект), как и дело. Это первая простая версия: настоящий
-- редактор (Lexical) и синхронизация без сети — DOC-002, он переведёт эти
-- документы в свой формат (текст Markdown переносится как есть).
--
-- Файлы проекта — уже готовые вложения ядра (`attachments`) у объекта
-- проекта, отдельная таблица им не нужна.

CREATE TABLE docs_pages (
    object_id  uuid PRIMARY KEY REFERENCES objects (id) ON DELETE CASCADE,
    body       text NOT NULL DEFAULT '' CHECK (length(body) <= 200000)
);

-- Код документов проекта есть на сервере; доступ — по гранту, как всегда.
UPDATE modules SET installed = true, readiness = 'beta', version = version + 1
WHERE id = 'docs';
