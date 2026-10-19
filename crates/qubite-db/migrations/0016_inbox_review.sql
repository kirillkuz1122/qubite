-- Входящие: «посмотри сам» и автоочистка корзины (ответ владельца на Q-25, D-199).
--
-- Разбирает Входящие сам Qubite Command. Если он не уверен, что это и куда
-- положить, элемент помечается «нужно решение владельца» — и владелец выбирает.

ALTER TABLE inbox_items
    ADD COLUMN needs_review  boolean NOT NULL DEFAULT false,
    -- Почему нужно решение: «не понял, дело это или заметка», «два подходящих проекта»…
    ADD COLUMN review_reason text CHECK (review_reason IS NULL OR length(review_reason) <= 500);

CREATE INDEX inbox_items_review_idx ON inbox_items (captured_at DESC) WHERE needs_review;
