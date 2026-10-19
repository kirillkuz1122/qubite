-- Регистрация через провайдера (ответ владельца на Q-26, D-189): при открытой
-- регистрации вход через Яндекс/VK/Google без аккаунта создаёт аккаунт, при
-- «по приглашениям» — только с приглашением. Код приглашения начатый вход
-- хранит хешем, до возвращения от провайдера.

ALTER TABLE oauth_flows
    ADD COLUMN invite_hash bytea CHECK (invite_hash IS NULL OR length(invite_hash) = 32),
    ADD CONSTRAINT oauth_flows_invite_only_login CHECK (invite_hash IS NULL OR intent = 'login');
