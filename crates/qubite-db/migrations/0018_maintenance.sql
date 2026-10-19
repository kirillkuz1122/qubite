-- Техработы (ACC-005, D-206…): обрыв соединений, одноразовые пропуска owner.

-- Включили или выключили техработы — всем WebSocket «проверьте права»:
-- соединения не-owner закрываются сразу, а не через полминуты по таймеру.
-- Работает и когда техработы включили из другого процесса (команда, бот).
CREATE FUNCTION qubite_platform_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.key = 'maintenance.enabled' THEN
        PERFORM pg_notify('qubite_changes', '*');
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER platform_settings_changed
    AFTER INSERT OR UPDATE ON platform_settings
    FOR EACH ROW EXECUTE FUNCTION qubite_platform_changed();

-- Секреты платформы, которые создаёт сам сервер (ключ подписи пропусков).
CREATE TABLE platform_secrets (
    name        text PRIMARY KEY,
    value       bytea NOT NULL CHECK (length(value) >= 32),
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Использованные пропуска owner: каждый — один раз.
CREATE TABLE maintenance_passes_used (
    nonce    bytea PRIMARY KEY CHECK (length(nonce) = 16),
    used_at  timestamptz NOT NULL DEFAULT now()
);
