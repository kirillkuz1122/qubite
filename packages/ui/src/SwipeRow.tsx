import { loop, MASS } from '@qubite/motion';
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { DotIcon } from './icons';
import { useMedia } from './media';
import { settleSwipe, swipe } from './swipe';
import { useSpring } from './useSpring';

export const SWIPE_ROW_HOLD_MS = 350;

export interface SwipeRowProps {
  children: ReactNode;
  onEdit: () => void;
  onPlace: () => void;
  onDelete: () => void;
  /** У уже готового дела свайп вправо выключен. */
  onDone?: (() => void) | undefined;
  filter?: (event: PointerEvent, target: Element) => boolean;
}

export function SwipeRow(props: SwipeRowProps) {
  const phone = useMedia('(width < 700px)');
  return phone ? <PhoneSwipeRow {...props} /> : props.children;
}

function PhoneSwipeRow({ children, onEdit, onPlace, onDelete, onDone, filter }: SwipeRowProps) {
  const root = useRef<HTMLDivElement>(null);
  const front = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const props = useRef({ onDone, filter });
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const spring = useSpring(0, MASS.sheet, (x) => {
    const row = root.current;
    const el = front.current;
    if (!row || !el) return;
    const offset = Math.max(-(actions.current?.offsetWidth ?? 0), Math.min(row.clientWidth, x));
    const active = Math.abs(offset) >= 0.5;
    if (active) row.dataset.swipeDirection = offset < 0 ? 'left' : 'right';
    else delete row.dataset.swipeDirection;
    el.style.transform = active ? `translateX(${offset.toFixed(2)}px)` : '';
  });

  useLayoutEffect(() => {
    props.current = { onDone, filter };
  }, [onDone, filter]);

  const settle = useCallback(
    (show: boolean) => {
      openRef.current = show;
      setOpen(show);
      settleSwipe(spring, show ? -(actions.current?.offsetWidth ?? 0) : 0);
    },
    [spring],
  );

  const restoreFocus = useCallback(() => {
    if (actions.current?.contains(document.activeElement))
      front.current
        ?.querySelector<HTMLElement>('button, [tabindex="0"]')
        ?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    const row = root.current;
    const el = front.current;
    if (!row || !el) return;
    let start = 0;
    const L = loop();
    const width = () => actions.current?.offsetWidth ?? 0;
    const distanceFromRest = (distance: number) =>
      Math.max(
        -width(),
        Math.min(props.current.onDone && !openRef.current ? row.clientWidth : 0, start + distance),
      );
    const unlisten = swipe(el, {
      axis: 'x',
      direction: 'both',
      startWithinMs: SWIPE_ROW_HOLD_MS,
      filter: (event, target) =>
        !target.closest('button:not([data-swipe-handle]), a') &&
        (props.current.filter?.(event, target) ?? true),
      onStart: () => {
        start = openRef.current ? -width() : 0;
      },
      onMove: (distance) => L.hold(spring, distanceFromRest(distance), 0),
      onEnd: (distance) => {
        L.hold(spring, distanceFromRest(distance), 0);
        if (!openRef.current && props.current.onDone && distance > row.clientWidth * 0.35) {
          settle(false);
          props.current.onDone();
        } else {
          settle(start + distance <= -width() / 2);
        }
      },
      onCancel: () => settle(openRef.current),
    });
    return () => {
      unlisten();
      L.set(spring, 0);
    };
  }, [settle, spring]);

  useLayoutEffect(() => {
    if (!open) return;
    const listeners = new AbortController();
    const options = { capture: true, signal: listeners.signal };
    window.addEventListener(
      'pointerdown',
      (event) => {
        if (event.target instanceof Node && !root.current?.contains(event.target)) settle(false);
      },
      options,
    );
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        restoreFocus();
        settle(false);
      },
      options,
    );
    return () => listeners.abort();
  }, [open, restoreFocus, settle]);

  function act(action: () => void) {
    restoreFocus();
    settle(false);
    action();
  }

  return (
    <div
      className="q-swipe-row"
      ref={root}
      data-swipe-tabs-ignore=""
      data-swipe-open={open || undefined}
    >
      <div
        className="q-swipe-actions"
        ref={actions}
        role="group"
        aria-label="Действия свайпа"
        aria-hidden={!open}
        inert={!open}
      >
        <Button variant="quiet" size="sm" onClick={() => act(onEdit)}>
          Изменить
        </Button>
        <Button variant="quiet" size="sm" onClick={() => act(onPlace)}>
          Перенести
        </Button>
        <Button className="q-swipe-delete" variant="quiet" size="sm" onClick={() => act(onDelete)}>
          Удалить
        </Button>
      </div>
      {onDone && (
        <div className="q-swipe-done" aria-hidden="true">
          <DotIcon name="check" size={16} />
          Готово
        </div>
      )}
      <div
        className="q-swipe-front"
        ref={front}
        onClickCapture={(event) => {
          if (!openRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          settle(false);
        }}
      >
        {children}
      </div>
    </div>
  );
}
