import { Button, Presence, useFlip } from '@qubite/ui';
import { useEffect, useRef, useState } from 'react';
import { useShell } from '../context';
import type { Task } from '../data';
import { SecHead, TaskList } from '../parts';
import { todayIndex, useStore } from '../state';
import { useInbox } from '../inbox-context';

/** Шкала дня: точка на каждые полчаса с 7:00 до 23:00, дела — цветные, «сейчас» — оранжевая. */
const FROM = 7;
const SLOTS = 33;

function slotOf(time: string): number | null {
  const m = time.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const i = (Number(m[1]) - FROM) * 2 + (Number(m[2]) >= 30 ? 1 : 0);
  return i >= 0 && i < SLOTS ? i : null;
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Strip({ tasks }: { tasks: Task[] }) {
  const now = useNow();
  const cur = Math.min(
    SLOTS - 1,
    Math.max(0, (now.getHours() - FROM) * 2 + (now.getMinutes() >= 30 ? 1 : 0)),
  );
  const marks = new Map<number, string>();
  tasks.forEach((t) => {
    const s = slotOf(t.time);
    if (s !== null) marks.set(s, t.done ? 'green' : t.color);
  });
  const hm = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  return (
    <div className="strip">
      <div className="days" aria-hidden="true">
        {Array.from({ length: SLOTS }, (_, i) => {
          const c = marks.get(i);
          const cls = [i < cur && 'past', i === cur && 'now', c && 'task']
            .filter(Boolean)
            .join(' ');
          return (
            <i
              key={i}
              className={cls || undefined}
              style={c && i !== cur ? { background: `var(--q-${c})` } : undefined}
            />
          );
        })}
      </div>
      <div className="lbl">
        <span>{FROM}:00</span>
        <b>сейчас {hm}</b>
        <span>23:00</span>
      </div>
    </div>
  );
}

export function TodayScreen() {
  const inbox = useInbox();
  const { state, dispatch } = useStore();
  const shell = useShell();
  const day = todayIndex(state);
  const tasks = state.week[day]!.tasks;
  const done = tasks.filter((t) => t.done).length;
  const first = tasks.find((t) => !t.done);
  const [tip, setTip] = useState(true);
  /* подсказка заняла или освободила место — всё, что ниже, доезжает пружиной, а не прыгает */
  const [moved, setMoved] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const tipShown = tip && !!first;
  useFlip(box, moved);
  return (
    <div className="flow" ref={box}>
      <Strip tasks={tasks} />
      <Presence
        className="tip panel"
        show={tipShown}
        swap={first?.id}
        onLayout={() => setMoved((n) => n + 1)}
      >
        {first && (
          <>
            <span className="q-dot av" style={{ background: 'var(--q-ink)' }} />
            <div>
              <b>Прото:</b> сначала «{first.title}» — пока голова свежая.
              <div className="acts">
                <Button size="sm" onClick={() => shell.cheer('proto')}>
                  Начать
                </Button>
                <button className="later" type="button" onClick={() => setTip(false)}>
                  Позже
                </button>
              </div>
            </div>
          </>
        )}
      </Presence>
      <div data-flip="today-rest">
        <SecHead text="ДЕЛА" label="Дела">
          <span className="n">
            {done} из {tasks.length}
          </span>
        </SecHead>
        <TaskList
          tasks={tasks}
          onToggle={(t, d) => {
            dispatch({ type: 'task.toggle', day, id: t.id, done: d });
            if (d) shell.cheer('proto');
          }}
        />
        <SecHead text="ВХОДЯЩИЕ" label="Входящие">
          <button className="more" type="button" onClick={() => shell.go('inbox')}>
            все →
          </button>
        </SecHead>
        {inbox.items.length === 0 && <p className="later">Пусто — всё разобрано.</p>}
        {inbox.items.slice(0, 3).map((it) => (
          <div className="spark" key={it.id}>
            <span className="q-dot" />
            <span>{it.text}</span>
            <small>{it.time}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
