-- CMD-005d, D-854: личный ключ только в зашифрованном виде.
CREATE TABLE voice_keys (
    account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    base_url text NOT NULL CHECK (octet_length(base_url) <= 2048),
    model text NOT NULL CHECK (octet_length(model) BETWEEN 1 AND 256),
    key_sealed text NOT NULL,
    key_last4 text NOT NULL CHECK (char_length(key_last4) = 4),
    updated_at timestamptz NOT NULL DEFAULT now()
);
