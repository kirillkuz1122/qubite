-- DOC-004a: полные снимки; мягкое удаление документа сохраняет историю.
CREATE TABLE docs_versions (
    id uuid PRIMARY KEY,
    doc_id uuid NOT NULL REFERENCES objects (id) ON DELETE CASCADE,
    owner_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('auto', 'named', 'before_restore')),
    name text CHECK (length(name) <= 80),
    title text NOT NULL,
    ystate bytea NOT NULL,
    text text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NOT NULL
);
CREATE INDEX docs_versions_doc_created_idx ON docs_versions (doc_id, created_at DESC);
