-- Ночная проверка 18.10.2026 (D-179): `request_id` уникален в пределах
-- аккаунта, а не всей платформы. Иначе один пользователь мог бы занять чужой
-- `request_id` (чужой запрос получил бы отказ «уже был») и узнать статус
-- чужого запроса.

ALTER TABLE ai_calls DROP CONSTRAINT ai_calls_request_id_key;
ALTER TABLE ai_calls ADD CONSTRAINT ai_calls_account_request_key UNIQUE (account_id, request_id);
