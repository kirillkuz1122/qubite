-- AI-002 (D-200): режим «owner без личного лимита».
--
-- По умолчанию выключен: owner, как и все, без личного денежного лимита AI
-- не получает (D-173, D-176). Owner включает режим осознанно (`qubite ai
-- owner-unlimited on`), каждое переключение — в аудите. Действует только
-- на owner платформы; общие лимиты (платформа, модуль, модель, провайдер)
-- и лимит самого ключа провайдера продолжают работать.

CREATE TABLE ai_owner_unlimited (
    singleton   boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    enabled     boolean NOT NULL DEFAULT false,
    changed_by  uuid REFERENCES accounts (id),
    changed_at  timestamptz NOT NULL DEFAULT now()
);
