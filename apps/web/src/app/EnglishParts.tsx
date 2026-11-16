/**
 * Общие части «Английского»: экран занятия поверх всего (урок, тренажёр глаголов), ход точками,
 * строка «что получил» и отказ в доступе. Вынесены из уроков, чтобы ими пользовались и глаголы.
 */
import { Presence } from '@qubite/ui';
import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Fail, say } from '../auth/client';
import type { Delta } from './english-lessons';
import { days } from './english-lessons-view';

export function Denied({ error }: { error: unknown }) {
  const denied = error instanceof Fail && error.status === 403;
  return (
    <p className="later" role="status">
      {denied
        ? 'Английский — часть агента: нет доступа к модулю «Агент Qubite». Его включает owner в Console.'
        : say(error)}
    </p>
  );
}

/** Отдельный слой в body: transform оболочки не ограничивает полный экран. */
export function LessonScreen({
  children,
  onClose,
  label = 'Урок английского',
}: {
  children: ReactNode;
  onClose: () => void;
  /** Как назвать экран для экранного диктора. */
  label?: string;
}) {
  const screen = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useLayoutEffect(() => {
    const root = document.getElementById('root');
    const wasInert = root?.inert ?? false;
    const overflow = document.body.style.overflow;
    const back = document.activeElement as HTMLElement | null;
    if (root) root.inert = true;
    document.body.style.overflow = 'hidden';
    screen.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      // Sheet перехватывает Escape раньше, в фазе capture.
      if (e.key === 'Escape') close.current();
      if (e.key !== 'Tab' || !screen.current?.contains(document.activeElement)) return;
      const controls = [
        ...screen.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (
        e.shiftKey &&
        (document.activeElement === first || document.activeElement === screen.current)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      if (root) root.inert = wasInert;
      document.body.style.overflow = overflow;
      back?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div
      ref={screen}
      className="eng-lesson-screen"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
    >
      <Presence show className="eng-lesson-presence">
        {children}
      </Presence>
    </div>,
    document.body,
  );
}

/** Полоска хода урока точками: пройдено, текущее, впереди. */
export function Progress({
  total,
  done,
  now,
  label = 'Ход урока',
}: {
  total: number;
  done: number;
  now: number | null;
  label?: string;
}) {
  return (
    <div
      className="eng-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
    >
      {Array.from({ length: total }, (_, i) => (
        <span key={i} data-on={i < done ? '' : undefined} data-now={i === now ? '' : undefined} />
      ))}
    </div>
  );
}

export function Gain({ d, announce = true }: { d: Delta; announce?: boolean }) {
  return (
    <p className="eng-gain" role={announce ? 'status' : undefined}>
      {d.xp > 0 && <b>+{d.xp} XP</b>}
      {d.streak_up && <> · огонёк {days(d.streak)}</>}
      {d.ring_closed && <> · цель дня закрыта</>}
      {d.quests_closed && <> · все задания дня</>}
      {d.unlocked.map((u) => (
        <span key={u.kind + u.id}>
          {' '}
          · {u.kind === 'badge' ? 'достижение' : 'Частица'} «{u.title}»
        </span>
      ))}
    </p>
  );
}
