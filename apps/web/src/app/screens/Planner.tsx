import { loop, MASS } from '@qubite/motion';
import { Segmented, useFlow, useSpring } from '@qubite/ui';
import { useLayoutEffect, useRef, useState } from 'react';
import { useShell } from '../context';
import { SecHead, TaskList } from '../parts';
import { usePlanner } from '../planner-context';

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
  const planner = usePlanner();
  const shell = useShell();
  const [cur, setCur] = useState(() => planner.today);
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

  const day = planner.week[shownDay]!;
  return (
    <>
      <div className="week" role="tablist" aria-label="Дни недели">
        {flowNode}
        {planner.week.map((d, i) => (
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
        {planner.loaded && day.tasks.length === 0 && (
          <p className="later">{day.today ? 'На сегодня дел нет.' : 'В этот день дел нет.'}</p>
        )}
        <TaskList
          tasks={day.tasks}
          meta={(t) => (
            <div className="meta">
              <span className="q-dot" style={{ background: `var(--q-${t.color})` }} />
              {day.today ? 'сегодня' : `${day.d}, ${day.n}`}
            </div>
          )}
          onToggle={(t, d) => {
            void planner.toggle(t.id, d);
            if (d) shell.cheer('proto');
          }}
        />
      </div>
      <SecHead text="ПРОЕКТЫ" label="Проекты">
        <span className="n">{planner.projects.length}</span>
      </SecHead>
      {planner.loaded && planner.projects.length === 0 && (
        <p className="later">
          Проектов пока нет — напиши в Command «/д #алгебра …», и он появится.
        </p>
      )}
      {planner.projects.map((p) => (
        <div className="proj" key={p.id}>
          <span className="q-dot" style={{ background: `var(--q-${p.color})` }} />
          <span className="name">{p.name}</span>
          <span className="bar" aria-hidden="true">
            {Array.from({ length: p.dots }, (_, k) => (
              <i key={k} style={k < p.filled ? { background: `var(--q-${p.color})` } : undefined} />
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
  const { board } = usePlanner();
  return (
    <div className="board">
      {board.map((c) => (
        <div className="col" key={c.name}>
          <h3>
            <span className="q-dot" style={{ background: `var(--q-${c.color})` }} />
            {c.name}
            <b>{c.cards.length}</b>
          </h3>
          {c.cards.map((card) => (
            <div className="card panel" key={card.id}>
              {card.title}
              <div className="meta">
                <span className="q-dot" style={{ background: `var(--q-${card.color})` }} />
                {card.tag}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
