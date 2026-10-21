import { loop, MASS } from '@qubite/motion';
import type { TaskStatus } from '@qubite/sync-client';
import { Button, Field, Presence, Segmented, Swap, useFlow, useSpring } from '@qubite/ui';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useShell } from '../context';
import { AgentTimeline } from '../AgentTimeline';
import { SecHead, TaskList } from '../parts';
import { usePlanner } from '../planner-context';

type Mode = 'week' | 'board';
const MODES: readonly Mode[] = ['week', 'board'];

export function PlannerScreen() {
  const [mode, setMode] = useState<Mode>('week');
  return (
    <>
      <Segmented<Mode>
        label="Вид"
        value={mode}
        onChange={(m) => setMode(m)}
        options={[
          { value: 'week', label: 'Неделя' },
          { value: 'board', label: 'Доска' },
        ]}
      />
      <Swap view={mode} order={MODES}>
        {mode === 'week' ? <Week /> : <Board />}
      </Swap>
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
          detail={(t) => <AgentTimeline trail={{ object: t.id }} compact />}
          onToggle={(t, d) => {
            void planner.toggle(t.id, d);
            if (d) shell.cheer('proto');
          }}
        />
      </div>
      <Projects />
    </>
  );
}

/**
 * Проекты (D-289): «Новый проект» прямо здесь, строка проекта раскрывается — видны его дела.
 * `data-obj` — чтобы Command мог показать и открыть проект («новый проект …»).
 */
function Projects() {
  const planner = usePlanner();
  const shell = useShell();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const made = await planner.newProject(name.trim());
      setOpen(made.id);
      setName('');
      setAdding(false);
      shell.cheer('proto');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* «+ Новый проект» — справа от заголовка (отзыв 21.10, D-435) */}
      <SecHead text="ПРОЕКТЫ" label="Проекты">
        <span className="sec-h-end">
          <span className="n">{planner.projects.length}</span>
          {!adding && (
            <Button className="proj-add" size="sm" onClick={() => setAdding(true)}>
              + Новый проект
            </Button>
          )}
        </span>
      </SecHead>
      <Presence show={adding}>
        <form className="proj-new" onSubmit={create} aria-label="Новый проект">
          <Field
            label="Название проекта"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            hint="Дела в него — из Command: #тег проекта, например «#алгебра решить № 5»."
          />
          <div className="proj-new-row">
            <Button type="submit" variant="fill" size="sm" disabled={!name.trim() || busy}>
              Создать
            </Button>
            <Button size="sm" onClick={() => setAdding(false)}>
              Отмена
            </Button>
          </div>
        </form>
      </Presence>
      {planner.loaded && planner.projects.length === 0 && !adding && (
        <p className="later">
          Проектов пока нет. Создай кнопкой «+ Новый проект» или в Command: «новый проект Алгебра».
        </p>
      )}
      {planner.projects.map((p) => (
        <div className="proj-item" key={p.id}>
          <button
            type="button"
            className="proj"
            data-obj={`proj-${p.id}`}
            aria-expanded={open === p.id}
            onClick={() => setOpen(open === p.id ? null : p.id)}
          >
            <span className="q-dot" style={{ background: `var(--q-${p.color})` }} />
            <span className="name">{p.name}</span>
            <span className="bar" aria-hidden="true">
              {Array.from({ length: p.dots }, (_, k) => (
                <i
                  key={k}
                  style={k < p.filled ? { background: `var(--q-${p.color})` } : undefined}
                />
              ))}
            </span>
            <span className="n">
              {p.done}/{p.total}
            </span>
          </button>
          {open === p.id && (
            <div className="proj-tasks" role="region" aria-label={`Дела проекта ${p.name}`}>
              {p.tasks.length === 0 ? (
                <p className="later">
                  Дел пока нет — напиши в Command «#{p.tag} что сделать завтра».
                </p>
              ) : (
                <TaskList
                  tasks={p.tasks}
                  detail={(t) => <AgentTimeline trail={{ object: t.id }} compact />}
                  onToggle={(t, d) => {
                    void planner.toggle(t.id, d);
                    if (d) shell.cheer('proto');
                  }}
                />
              )}
              <div className="trail">
                <AgentTimeline trail={{ project: p.id }} compact />
              </div>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

const ORDER: TaskStatus[] = ['todo', 'doing', 'done'];

/**
 * Доска (D-289): карточку можно перетащить в другую колонку мышью, перенести клавишами ← →
 * (карточка в фокусе) или через меню «Переместить в…» — без долгого таскания.
 * Перетаскивание — на событиях указателя: карточка едет за мышью через `transform`, колонка
 * под курсором подсвечивается. Пальцем на телефоне — меню «⋯» (прокрутку не перехватываем).
 */
function Board() {
  const { board, move } = usePlanner();
  const shell = useShell();
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const refocus = useRef<{ id: string; status: TaskStatus } | null>(null);

  function columnAt(x: number, y: number): TaskStatus | null {
    const hit = document.elementsFromPoint(x, y).find((el) => el.matches('.board .col'));
    return (hit?.getAttribute('data-status') as TaskStatus | null) ?? null;
  }

  /** Нажали мышью на карточку: слушаем движение до отпускания (только на время переноса). */
  function onPointerDown(e: PointerEvent<HTMLDivElement>, id: string, from: TaskStatus) {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const d = { x: e.clientX, y: e.clientY, el: e.currentTarget, moving: false };
    const moveCard = (ev: globalThis.PointerEvent) => {
      const dx = ev.clientX - d.x;
      const dy = ev.clientY - d.y;
      if (!d.moving) {
        if (Math.hypot(dx, dy) < 6) return;
        d.moving = true;
        d.el.classList.add('dragging');
        // пока несём карточку, текст вокруг не выделяется
        getSelection()?.removeAllRanges();
        document.documentElement.classList.add('q-dragging');
      }
      d.el.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      setOver(columnAt(ev.clientX, ev.clientY));
    };
    const drop = (ev: globalThis.PointerEvent) => {
      removeEventListener('pointermove', moveCard);
      removeEventListener('pointerup', drop);
      removeEventListener('pointercancel', drop);
      d.el.style.transform = '';
      d.el.classList.remove('dragging');
      document.documentElement.classList.remove('q-dragging');
      setOver(null);
      if (!d.moving || ev.type === 'pointercancel') return;
      const to = columnAt(ev.clientX, ev.clientY);
      if (to && to !== from) moveTo(id, to);
    };
    addEventListener('pointermove', moveCard);
    addEventListener('pointerup', drop);
    addEventListener('pointercancel', drop);
  }

  function moveTo(id: string, status: TaskStatus) {
    setMenu(null);
    setOver(null);
    // фокус остаётся на перенесённой карточке — можно сразу нести дальше (после перерисовки)
    refocus.current = document.activeElement?.closest('[data-card]') ? { id, status } : null;
    void move(id, status);
    if (status === 'done') shell.cheer('proto');
  }

  useEffect(() => {
    const want = refocus.current;
    if (!want) return;
    const el = document.querySelector<HTMLElement>(
      `.board .col[data-status="${want.status}"] [data-card="${CSS.escape(want.id)}"]`,
    );
    if (!el) return;
    el.focus();
    refocus.current = null;
  }, [board]);

  function onKey(e: KeyboardEvent<HTMLDivElement>, id: string, from: TaskStatus) {
    const i = ORDER.indexOf(from);
    const to =
      e.key === 'ArrowRight' ? ORDER[i + 1] : e.key === 'ArrowLeft' ? ORDER[i - 1] : undefined;
    if (!to) return;
    e.preventDefault();
    moveTo(id, to);
  }

  return (
    <div className="board">
      {board.map((c) => (
        <div
          className={over === c.status ? 'col over' : 'col'}
          key={c.status}
          data-status={c.status}
          role="group"
          aria-label={`${c.name}: ${c.cards.length}`}
        >
          <h3>
            <span className="q-dot" style={{ background: `var(--q-${c.color})` }} />
            {c.name}
            <b>{c.cards.length}</b>
          </h3>
          {c.cards.map((card) => (
            <div
              className="card panel"
              key={card.id}
              data-card={card.id}
              data-obj={card.id}
              tabIndex={0}
              aria-label={`${card.title}. Перенести: стрелки влево и вправо`}
              onPointerDown={(e) => onPointerDown(e, card.id, c.status)}
              onKeyDown={(e) => onKey(e, card.id, c.status)}
            >
              <div className="card-top">
                <span className="card-title">{card.title}</span>
                <button
                  type="button"
                  className="card-more"
                  aria-label="Переместить в…"
                  aria-expanded={menu === card.id}
                  onClick={() => setMenu(menu === card.id ? null : card.id)}
                >
                  ⋯
                </button>
              </div>
              <div className="meta">
                <span className="q-dot" style={{ background: `var(--q-${card.color})` }} />
                {card.tag}
              </div>
              {menu === card.id && (
                <div className="card-menu" role="menu" aria-label="Переместить в">
                  {board
                    .filter((to) => to.status !== c.status)
                    .map((to) => (
                      <button
                        key={to.status}
                        type="button"
                        role="menuitem"
                        onClick={() => moveTo(card.id, to.status)}
                      >
                        <span className="q-dot" style={{ background: `var(--q-${to.color})` }} />
                        {to.name}
                      </button>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
