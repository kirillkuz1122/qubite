/** Общие части разделов: заголовок секции из точек и список дел с перетекающим выделением. */
import {
  Button,
  DotIcon,
  DotText,
  Presence,
  RingCheck,
  WIDE,
  useMedia,
  useSlide,
} from '@qubite/ui';
import { Fragment, useId, useRef, useState, type ReactNode } from 'react';
import type { Task } from './data';
import { usePlanner } from './planner-context';

export function SecHead({
  text,
  label,
  children,
}: {
  text: string;
  label: string;
  children?: ReactNode;
}) {
  const wide = useMedia(WIDE);
  return (
    <div className="sec-h">
      <h2 className="q-sr">{label}</h2>
      <DotText text={text} pitch={wide ? 3.4 : 3.1} assemble={false} repel={20} label={label} />
      {children}
    </div>
  );
}

export function UndatedBlock({
  tasks,
  onToggle,
  onLayout,
}: {
  tasks: Task[];
  onToggle: (t: Task, done: boolean) => void;
  onLayout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const hasTasks = tasks.length > 0;
  return (
    <div inert={!hasTasks}>
      <Presence show={hasTasks} className="undated" onLayout={onLayout}>
        <Button
          variant="quiet"
          size="sm"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
        >
          <DotIcon name={open ? 'up' : 'down'} size={16} />
          Без даты · {tasks.length}
        </Button>
        <div id={listId} inert={!open}>
          <Presence show={open} onLayout={onLayout}>
            <TaskList tasks={tasks} onToggle={onToggle} />
          </Presence>
        </div>
      </Presence>
    </div>
  );
}

export function TaskList({
  tasks,
  meta,
  detail,
  onToggle,
}: {
  tasks: Task[];
  /** подпись под делом; по умолчанию — проект */
  meta?: (t: Task) => ReactNode;
  /** что показать под выбранным делом (например, ленту агента у дела) */
  detail?: (t: Task) => ReactNode;
  onToggle: (t: Task, done: boolean) => void;
}) {
  const planner = usePlanner();
  /* на телефоне срок стоит под названием и не сжимает его (DESIGN_SYSTEM §0.2) */
  const wide = useMedia(WIDE);
  const sel = useSlide(58);
  const at = useRef<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="list">
      {sel.node}
      {tasks.map((t) => (
        <Fragment key={t.id}>
          <div
            data-obj={t.id}
            className={t.done ? 'row done' : 'row'}
            aria-expanded={detail ? open === t.id : undefined}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('.q-ring')) return;
              const row = e.currentTarget;
              if (at.current === t.id) {
                sel.hide();
                at.current = null;
                setOpen(null);
                return;
              }
              sel.to(row.offsetTop, row.offsetHeight);
              at.current = t.id;
              setOpen(t.id);
            }}
          >
            <RingCheck
              done={t.done}
              onToggle={(d) => onToggle(t, d)}
              label={`Готово: ${t.title}`}
            />
            <div className="t">
              <div className="title">
                <Button
                  className="task-open"
                  dot={false}
                  aria-label={`Открыть дело: ${t.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    planner.openTask(t.id);
                  }}
                >
                  {t.title}
                </Button>
              </div>
              {wide ? (
                (meta ?? defaultMeta)(t)
              ) : (
                <div className="row-sub">
                  {t.time && <span className="time">{t.time}</span>}
                  {(meta ?? defaultMeta)(t)}
                </div>
              )}
              <Presence show={t.travelMinutes != null} className="task-travel">
                в пути {t.travelMinutes} мин
              </Presence>
            </div>
            {wide && <span className="time">{t.time}</span>}
          </div>
          {detail && (
            <Presence show={open === t.id} className="trail">
              {detail(t)}
            </Presence>
          )}
        </Fragment>
      ))}
    </div>
  );
}

function defaultMeta(t: Task) {
  if (!t.tag || t.done) return null;
  return (
    <div className="meta">
      <span className="q-dot" style={{ background: `var(--q-${t.color})` }} />
      {t.tag}
    </div>
  );
}
