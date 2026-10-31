-- NULL сохраняет Markdown до первого обмена с редактором.
ALTER TABLE docs_pages ADD COLUMN ystate bytea;
ALTER TABLE docs_pages ADD COLUMN search tsvector NOT NULL DEFAULT ''::tsvector;

-- Заголовок живёт в objects: generated column не может читать другую таблицу.
-- Триггеры охватывают также rename через sync и остальные пути записи body.
CREATE FUNCTION docs_search_body() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.search := setweight(to_tsvector('russian', coalesce(
        (SELECT title FROM objects WHERE id = NEW.object_id), '')), 'A')
        || setweight(to_tsvector('russian', NEW.body), 'B');
    RETURN NEW;
END;
$$;
CREATE TRIGGER docs_search_body BEFORE INSERT OR UPDATE OF body ON docs_pages
    FOR EACH ROW EXECUTE FUNCTION docs_search_body();

CREATE FUNCTION docs_search_title() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE docs_pages SET search = setweight(to_tsvector('russian', NEW.title), 'A')
        || setweight(to_tsvector('russian', body), 'B')
    WHERE object_id = NEW.id;
    RETURN NEW;
END;
$$;
CREATE TRIGGER docs_search_title AFTER UPDATE OF title ON objects
    FOR EACH ROW WHEN (OLD.title IS DISTINCT FROM NEW.title)
    EXECUTE FUNCTION docs_search_title();

UPDATE docs_pages d SET search = setweight(to_tsvector('russian', o.title), 'A')
    || setweight(to_tsvector('russian', d.body), 'B')
FROM objects o WHERE o.id = d.object_id;
CREATE INDEX docs_pages_search_gin ON docs_pages USING gin (search);
