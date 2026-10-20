/** Общие части разделов: заголовок секции из точек и список дел с перетекающим выделением. */
import { DotText, RingCheck, useSlide } from '@qubite/ui';
import { Fragment, useRef, useState, type ReactNode } from 'react';
import { useShell } from './context';
import type { Task } from './data';

export function SecHead({
  text,
  label,
  children,
}: {
  text: string;
  label: string;
  children?: ReactNode;
}) {
  const { wide } = useShell();
  return (
    <div className="sec-h">
      <h2 className="q-sr">{label}</h2>
      <DotText text={text} pitch={wide ? 3.4 : 3.1} assemble={false} repel={20} label={label} />
      {children}
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
              <div className="title">{t.title}</div>
              {(meta ?? defaultMeta)(t)}
            </div>
            <span className="time">{t.time}</span>
          </div>
          {detail && open === t.id && <div className="trail">{detail(t)}</div>}
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
