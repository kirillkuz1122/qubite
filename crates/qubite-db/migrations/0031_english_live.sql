-- Английский: разговор потоком (ENG-001, дополнение владельца — «ответ почти
-- сразу, около секунды»). D-457…D-459.
--
-- Живое распознавание ElevenLabs (scribe_v2_realtime, WebSocket): своя
-- способность `stt_live`, единица — секунда звука. $0,60 за час звука с
-- запасом вверх → $166,67 за миллион секунд. Включена; провайдер включает
-- запуск с ключом QUBITE_ELEVENLABS_API_KEY.
INSERT INTO ai_models (id, provider_id, external_id, capabilities,
                       price_in_per_mtok, price_out_per_mtok, enabled)
VALUES ('elevenlabs/scribe_v2_realtime', 'elevenlabs', 'scribe_v2_realtime', ARRAY['stt_live'],
        166670000, 0, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_model_defaults (task, model_id)
VALUES ('voice.stt.live', 'elevenlabs/scribe_v2_realtime')
ON CONFLICT (task) DO NOTHING;

-- Замеры задержки ответа репетитора (мс от конца фразы): до первого звука,
-- до первого куска текста модели, распознавание. Пусто — ход без потока.
ALTER TABLE english_messages ADD COLUMN latency jsonb;
