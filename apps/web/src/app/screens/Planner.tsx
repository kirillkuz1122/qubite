import { loop, MASS } from '@qubite/motion';
import { Segmented, useFlow, useSpring } from '@qubite/ui';
import { useLayoutEffect, useRef, useState } from 'react';
import { useShell } from '../context';
import { BOARD, PROJECTS } from '../data';
import { SecHead, TaskList } from '../parts';
import { todayIndex, useStore } from '../state';

type Mode = 'week' | 'board';

export function PlannerScreen() {
  const [mode, setMode] = useState<Mode>('week');
  const view = useRef<HTMLDivElement>(null);
  const vs = useSpring(0, MASS.pill, (v) => {
    const el = view.current;
    if (!el) return;
    el.style.opacity = Math.min(1, Math.max(0, 1 - Math.abs(v))).toFixed(3);
    el.style.transform = v === 0 ? '' : `translateX(${(v * 26).toFixed(2)}px)`;
  });
  return (
    <>
      <Segmented<Mode>
        label="Вид"
        value={mode}
        onChange={(m) => {
          if (m === mode) return;
          setMode(m);
          const L = loop();
          L.set(vs, m === 'board' ? 1 : -1);
          L.to(vs, 0);
        }}
        options={[
          { value: 'week', label: 'Неделя' },
          { value: 'board', label: 'Доска' },
        ]}
      />
      <div ref={view}>{mode === 'week' ? <Week /> : <Board />}</div>
    </>
  );
}

function Week() {
  const { state, dispatch } = useStore();
  const shell = useShell();
  const [cur, setCur] = useState(() => todayIndex(state));
  const [shownDay, setShownDay] = useState(cur);
  const { node: flowNode, to: flowTo } = useFlow(70, 0, { className: 'q-chip-flow' });
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  const first = useRef(true);
  const list = useRef<HTMLDivElement>(null);
  const ls = useSpring(0, MASS.pill, (v) => {
    const el = list.current;
    if (!el) return;
    el.style.opacity = Math.min(1, Math.max(0, 1 - Math.abs(v))).toFixed(3);
    el.style.transform = v === 0 ? '' : `translateX(${(v * 22).toFixed(2)}px)`;
  });

  useLayoutEffect(() => {
    const b = btns.current[cur];
    if (!b) return;
    flowTo(b.offsetLeft + 3, b.offsetLeft + b.offsetWidth - 3, first.current);
    first.current = false;
  }, [cur, flowTo]);

  function pick(i: number) {
    if (i === cur) return;
    const dir = i > cur ? 1 : -1;
    setCur(i);
    const L = loop();
    L.to(ls, -dir * 0.7);
    setTimeout(
      () => {
        setShownDay(i);
        L.set(ls, dir * 0.7);
        L.to(ls, 0);
      },
      L.reduced ? 0 : 120,
    );
  }

  const day = state.week[shownDay]!;
  return (
    <>
      <div className="week" role="tablist" aria-label="Дни недели">
        {flowNode}
        {state.week.map((d, i) => (
          <button
            key={d.d}
            type="button"
            role="tab"
            aria-selected={i === cur}
            aria-label={`${d.d}, ${d.n}`}
            ref={(el) => void (btns.current[i] = el)}
            className={
              [i === cur && 'on', d.today && 'today'].filter(Boolean).join(' ') || undefined
            }
            onClick={() => pick(i)}
          >
            {d.d}
            <b>{d.n}</b>
            <span className="pips">
              {d.tasks.map((t) => (
                <i key={t.id} style={{ background: `var(--q-${t.done ? 'faint' : t.color})` }} />
              ))}
            </span>
          </button>
        ))}
      </div>
      <div ref={list}>
        <TaskList
          tasks={day.tasks}
          meta={(t) => (
            <div className="meta">
              <span className="q-dot" style={{ background: `var(--q-${t.color})` }} />
              {day.today ? 'сегодня' : `${day.d}, ${day.n}`}
            </div>
          )}
          onToggle={(t, d) => {
            dispatch({ type: 'task.toggle', day: shownDay, id: t.id, done: d });
            if (d) shell.cheer('proto');
          }}
        />
      </div>
      <SecHead text="ПРОЕКТЫ" label="Проекты">
        <span className="n">{PROJECTS.length}</span>
      </SecHead>
      {PROJECTS.map((p) => (
        <div className="proj" key={p.name}>
          <span className="q-dot" style={{ background: `var(--q-${p.color})` }} />
          <span className="name">{p.name}</span>
          <span className="bar" aria-hidden="true">
            {Array.from({ length: p.total }, (_, k) => (
              <i key={k} style={k < p.done ? { background: `var(--q-${p.color})` } : undefined} />
            ))}
          </span>
          <span className="n">
            {p.done}/{p.total}
          </span>
        </div>
      ))}
    </>
  );
}

function Board() {
  return (
    <div className="board">
      {BOARD.map((c) => (
        <div className="col" key={c.name}>
          <h3>
            <span className="q-dot" style={{ background: `var(--q-${c.color})` }} />
            {c.name}
            <b>{c.cards.length}</b>
          </h3>
          {c.cards.map(([t, color, tag]) => (
            <div className="card panel" key={t}>
              {t}
              <div className="meta">
                <span className="q-dot" style={{ background: `var(--q-${color})` }} />
                {tag}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
