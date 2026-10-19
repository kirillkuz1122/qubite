-- Отметка согласия (ответ владельца на Q-41, D-230): при регистрации сервер
-- хранит, какие документы и какой версии человек принял, когда и с какого
-- адреса. Новая версия документов — новая строка, старые остаются.
-- Номер 0021: 0020 занят PLAN-001 (planner).

CREATE TABLE account_consents (
    account_id  uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    -- terms | privacy | personal_data
    document    text        NOT NULL CHECK (document IN ('terms', 'privacy', 'personal_data')),
    version     text        NOT NULL CHECK (length(version) BETWEEN 1 AND 40),
    accepted_at timestamptz NOT NULL DEFAULT now(),
    -- password | yandex | vk | google | telegram
    method      text        NOT NULL,
    ip          text        NOT NULL DEFAULT '',
    PRIMARY KEY (account_id, document, version)
);

-- Вход через провайдера со страницы регистрации несёт версию принятых
-- документов до возвращения от провайдера.
ALTER TABLE oauth_flows
    ADD COLUMN consent_version text CHECK (consent_version IS NULL OR length(consent_version) BETWEEN 1 AND 40);
