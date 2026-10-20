import { Note, Segmented, Switch } from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { must, say } from '../auth/client';
import { MODULES, useDanger, useModules, type ModuleItem } from './api';

/**
 * Модули (OWNER_CONSOLE §1.3): установлен, состояние, готовность, как виден без доступа.
 * Меняется сразу, с версией: если модуль уже изменили в другом месте — честная ошибка.
 * Доступ людям — в их карточке («Люди»).
 */
export function ModulesTab() {
  const qc = useQueryClient();
  const modules = useModules();
  const danger = useDanger();
  const [error, setError] = useState<string | null>(null);
  const change = async (m: ModuleItem, patch: Record<string, unknown>) => {
    setError(null);
    try {
      await danger(() =>
        must(
          api.PATCH('/api/owner/modules/{id}', {
            params: { path: { id: m.id } },
            body: { ...patch, expected_version: m.version },
          }),
        ),
      );
    } catch (e) {
      setError(`${m.title}: ${say(e)}`);
    } finally {
      await qc.invalidateQueries({ queryKey: MODULES });
    }
  };
  if (modules.isPending) return <p className="cs-small">Загружаем модули…</p>;
  if (modules.isError) return <Note tone="bad">{say(modules.error)}</Note>;
  return (
    <div className="cs-stack">
      {error && <Note tone="bad">{error}</Note>}
      {modules.data.map((m) => (
        <div key={m.id} className="cs-panel" role="group" aria-label={m.title}>
          <div className="cs-set">
            <h2 className="cs-h">{m.title}</h2>
            <Switch
              label={`${m.title} установлен`}
              checked={m.installed}
              onChange={(v) => void change(m, { installed: v })}
            />
          </div>
          {m.installed && (
            <>
              <div className="cs-set">
                <span className="cs-lbl">Состояние</span>
                <Segmented<string>
                  label={`Состояние ${m.title}`}
                  variant="chips"
                  wrap
                  value={m.state}
                  onChange={(v) => void change(m, { state: v })}
                  options={[
                    { value: 'enabled', label: 'Включён' },
                    { value: 'disabled', label: 'Выключен' },
                    { value: 'maintenance', label: 'Техработы' },
                  ]}
                />
              </div>
              <div className="cs-set">
                <span className="cs-lbl">Готовность</span>
                <Segmented<string>
                  label={`Готовность ${m.title}`}
                  variant="chips"
                  wrap
                  value={m.readiness}
                  onChange={(v) => void change(m, { readiness: v })}
                  options={[
                    { value: 'planned', label: 'Готовится' },
                    { value: 'beta', label: 'Бета' },
                    { value: 'stable', label: 'Готов' },
                  ]}
                />
              </div>
              <div className="cs-set">
                <span className="cs-lbl">Без доступа</span>
                <Segmented<string>
                  label={`Видимость ${m.title}`}
                  variant="chips"
                  wrap
                  value={m.visibility}
                  onChange={(v) => void change(m, { visibility: v })}
                  options={[
                    { value: 'locked', label: 'С замком' },
                    { value: 'hidden', label: 'Скрыт' },
                  ]}
                />
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
