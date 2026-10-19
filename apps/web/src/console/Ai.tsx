import { Note, Switch } from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { must, say } from '../auth/client';
import { AI_MODELS, AI_TASKS, useAiModels, useAiTasks } from './api';

const TASK_LABEL: Record<string, string> = {
  default: 'По умолчанию',
  'inbox.triage': 'Разбор Входящих',
};

/** Цена: микродоллары за миллион токенов → «$0.15». */
const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(micro < 100_000 ? 3 : 2)}`;

/**
 * AI (OWNER_CONSOLE §1.4): разрешённые модели (allowlist) и какая модель для какой задачи.
 * Ключи провайдеров, лимиты и расход — пока командой `qubite ai …` на сервере (D-233, Q-43).
 */
export function AiTab() {
  const qc = useQueryClient();
  const models = useAiModels();
  const tasks = useAiTasks();
  const [error, setError] = useState<string | null>(null);
  const toggle = async (id: string, enabled: boolean) => {
    setError(null);
    try {
      await must(
        api.PATCH('/api/owner/ai/models/{id}', { params: { path: { id } }, body: { enabled } }),
      );
    } catch (e) {
      setError(say(e));
    } finally {
      await qc.invalidateQueries({ queryKey: AI_MODELS });
    }
  };
  const pick = async (task: string, modelId: string) => {
    setError(null);
    try {
      await must(
        api.PUT('/api/owner/ai/tasks/{task}', {
          params: { path: { task } },
          body: { model_id: modelId || null },
        }),
      );
    } catch (e) {
      setError(say(e));
    } finally {
      await Promise.all([
        qc.invalidateQueries({ queryKey: AI_TASKS }),
        qc.invalidateQueries({ queryKey: AI_MODELS }),
      ]);
    }
  };
  if (models.isPending || tasks.isPending) return <p className="cs-small">Загружаем AI…</p>;
  if (models.isError || tasks.isError)
    return <Note tone="bad">{say(models.error ?? tasks.error)}</Note>;
  const enabled = models.data.filter((m) => m.enabled);
  const taskIds = [...new Set(['default', 'inbox.triage', ...tasks.data.map((t) => t.task)])];
  return (
    <div className="cs-stack">
      <Note>
        Ключи провайдеров, лимиты и расход пока настраиваются на сервере командой{' '}
        <code>qubite ai limit …</code>. Даже owner проходит те же проверки бюджета.
      </Note>
      {error && <Note tone="bad">{error}</Note>}
      <div className="cs-panel">
        <h2 className="cs-h">Модели для задач</h2>
        {taskIds.map((task) => (
          <label key={task} className="cs-set">
            <span className="cs-lbl">{TASK_LABEL[task] ?? task}</span>
            <select
              className="cs-select"
              value={tasks.data.find((t) => t.task === task)?.model_id ?? ''}
              onChange={(e) => void pick(task, e.target.value)}
            >
              <option value="">— не выбрана —</option>
              {enabled.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="cs-panel">
        <h2 className="cs-h">Разрешённые модели</h2>
        {models.data.length === 0 && (
          <p className="cs-small">
            Моделей пока нет — посмотрите каталог <code>qubite ai catalog</code> и разрешите нужную:{' '}
            <code>qubite ai model ИМЯ on</code>.
          </p>
        )}
        {models.data.map((m) => (
          <div key={m.id} className="cs-set">
            <span className="cs-lbl">
              {m.id}
              <small className="cs-small">
                {m.provider_id} · вход {usd(m.price_in_per_mtok)} / выход{' '}
                {usd(m.price_out_per_mtok)} за 1M токенов · контекст{' '}
                {Math.round(m.context_tokens / 1000)}k
                {m.blocked_reason ? ` · заблокирована: ${m.blocked_reason}` : ''}
              </small>
            </span>
            <Switch
              label={`Модель ${m.id}`}
              checked={m.enabled}
              onChange={(v) => void toggle(m.id, v)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
