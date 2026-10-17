-- Синхронизация (FND-005): журнал принятых операций устройств.
-- Повторная отправка операции с тем же op_id возвращает сохранённый результат
-- и ничего не применяет второй раз.

CREATE TABLE sync_ops (
    op_id       uuid PRIMARY KEY,
    owner_id    uuid NOT NULL,
    device_id   uuid NOT NULL,
    object_id   uuid NOT NULL,
    result      jsonb,                         -- OpResult; заполняется в той же транзакции
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sync_ops_owner_idx ON sync_ops (owner_id, created_at);
