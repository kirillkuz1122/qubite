/**
 * «Когда писать» (AGT-004, D-294, D-309): как часто агент пишет первым — «сколько захочет»
 * (учится по ответам), число в день или «не писать»; «не сегодня»; что сейчас (тишина ночью и на
 * уроках, свободные окна) и что агент заметил по ответам. Решает сервер, не модель.
 */
import { Button, Note, Range, Segmented } from '@qubite/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Fail, must, say } from '../auth/client';
import {
  MODES,
  messages,
  todayLine,
  windowsLine,
  type AgentPace,
  type PaceMode,
} from './pace-view';

const PACE = ['agent-pace'] as const;

type Change = { mode?: string; per_day?: number; not_today?: boolean };

export function AgentPaceView() {
  const qc = useQueryClient();
  const pace = useQuery({
    queryKey: PACE,
    queryFn: (): Promise<AgentPace> => must(api.GET('/api/v1/agent/pace')),
    retry: false,
    refetchInterval: 60_000,
  });
  const [error, setError] = useState<string | null>(null);
  const [perDay, setPerDay] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (pace.isPending) return <p className="later">Загружаю…</p>;
  if (pace.isError) {
    const denied = pace.error instanceof Fail && pace.error.status === 403;
    return (
      <p className="later" role="status">
        {denied
          ? 'Агент выключен: нет доступа к модулю «Агент Qubite». Его включает owner в Console.'
          : say(pace.error)}
      </p>
    );
  }
  const p = pace.data;
  const save = async (change: Change) => {
    try {
      const next = await must(api.PATCH('/api/v1/agent/pace', { body: change }));
      qc.setQueryData<AgentPace>(PACE, next);
      setError(null);
    } catch (e) {
      setError(say(e));
    }
  };
  const count = perDay ?? p.per_day;

  return (
    <div className="pace" data-obj="agent-pace">
      {error && <Note tone="bad">{error}</Note>}
      <section className="pace-block">
        <b>Как часто писать первым</b>
        <Segmented<PaceMode>
          label="Как часто писать первым"
          value={p.mode as PaceMode}
          onChange={(mode) => void save({ mode })}
          options={MODES}
        />
        {p.mode === 'count' && (
          <Range
            label="В день — не больше"
            value={count}
            min={1}
            max={10}
            format={messages}
            onChange={(v) => {
              setPerDay(v);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => void save({ per_day: v }), 400);
            }}
          />
        )}
        <small>
          {p.mode === 'auto'
            ? '«Да» на его вопросы — пишет чаще, «позже» и «не сегодня» — реже.'
            : p.mode === 'count'
              ? 'Не больше этого числа в день и не чаще раза в час.'
              : 'Твои напоминания о делах приходят всегда — они не в этом счёте.'}
        </small>
      </section>

      <section className="pace-block" aria-live="polite">
        <b>Сегодня</b>
        <p>{todayLine(p)}</p>
        {p.mode !== 'off' && (
          <Button
            size="sm"
            variant={p.not_today ? 'fill' : 'outline'}
            onClick={() => void save({ not_today: !p.not_today })}
          >
            {p.not_today ? 'Снова можно сегодня' : 'Не сегодня'}
          </Button>
        )}
        <p className="pace-mute">{windowsLine(p.windows)}</p>
        <p className="pace-mute">
          Молчит ночью (часы — в профиле, «Напоминания») и на уроках из «Расписание.md» в «Записях».
          Спрашивает «есть 30 минут?» в свободное окно — ответ кнопкой в колокольчике или в
          Telegram.
        </p>
      </section>

      {p.patterns.length > 0 && (
        <section className="pace-block">
          <b>Агент заметил</b>
          <ul>
            {p.patterns.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
