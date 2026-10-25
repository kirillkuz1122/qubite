-- Диктовка «скажи → получи текст» через подписку ChatGPT (ENG-005 для ENG-006):
-- сеанс OpenAI Realtime только распознавания. Платит подписка — 0 $; учёт —
-- как у живого разговора (ai_realtime_sessions), но в «разговоров в день» не
-- считается. Строка выключена: allowlist owner подписке не нужен (D-531).
INSERT INTO ai_models (id, provider_id, external_id, capabilities,
                       price_in_per_mtok, price_out_per_mtok, enabled)
VALUES ('chatgpt:gpt-4o-mini-transcribe', 'chatgpt', 'gpt-4o-mini-transcribe', ARRAY['realtime'], 0, 0, false)
ON CONFLICT (id) DO NOTHING;
