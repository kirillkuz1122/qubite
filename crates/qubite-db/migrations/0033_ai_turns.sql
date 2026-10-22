-- Ход живого разговора (ENG-001, баг владельца 22.10.2026): распознавание,
-- ответ модели и озвучка по предложениям — несколько вызовов, но для защиты от
-- зацикливания это один запрос. Деньги и резерв — по каждому вызову, как раньше.
ALTER TABLE ai_calls ADD COLUMN turn_id uuid;
CREATE INDEX ai_calls_turn_idx ON ai_calls (account_id, turn_id) WHERE turn_id IS NOT NULL;
