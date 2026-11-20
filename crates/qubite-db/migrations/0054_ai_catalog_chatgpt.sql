-- AI-003 (#266): запоминаем, какие модели подписки видели при прошлом
-- обновлении, чтобы ручное выключение модели не сбрасывалось каждый день.
ALTER TABLE ai_catalog ADD COLUMN listed boolean NOT NULL DEFAULT false;
-- Всё, что уже лежит в каталоге подписки, прежний код видел в списке
-- (скрытые модели он отбрасывал). Отмечаем их, иначе первое обновление
-- сочтёт их новыми и включит модели, которые owner выключил руками.
UPDATE ai_catalog SET listed = true WHERE provider_id = 'chatgpt';

-- Убрать автоматическое назначение из 0035. Явный выбор owner записан
-- с changed_by и остаётся в силе.
DELETE FROM ai_model_defaults
WHERE task IN ('english.program', 'english.review')
  AND model_id = 'chatgpt:gpt-6.1-sol'
  AND changed_by IS NULL;
