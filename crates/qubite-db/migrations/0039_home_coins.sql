-- HOME-002, D-701…D-705: выбранные монеты и расширяемый каталог тем.
ALTER TABLE home_settings
    ADD COLUMN coins text[] NOT NULL DEFAULT '{bitcoin,the-open-network}'
        CHECK (cardinality(coins) <= 6),
    DROP CONSTRAINT home_settings_topics_check,
    DROP CONSTRAINT home_settings_currencies_check,
    ADD CONSTRAINT home_settings_currencies_check CHECK (cardinality(currencies) <= 8);
