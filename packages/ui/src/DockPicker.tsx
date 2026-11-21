import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Button } from './Button';
import type { NavItem } from './Dock';
import { useFlow } from './Flow';
import { Presence } from './Presence';

const HOLD_MS = 350;
const HOLD_SLOP = 8;

export function useDockPicker(
  dock: RefObject<HTMLElement | null>,
  enabled: boolean,
  openPicker: () => boolean,
  onPick: (id: string) => void,
) {
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const latest = useRef({ openPicker, onPick });
  latest.current = { openPicker, onPick };

  useEffect(() => {
    const element = dock.current;
    if (!enabled || !element) return;
    const host = element;
    const mounted = new AbortController();
    const listening = { capture: true, signal: mounted.signal };
    let press: {
      id: number;
      x: number;
      y: number;
      timer: number;
      opened: boolean;
      listeners: AbortController;
    } | null = null;
    let frame: number | undefined;
    let suppressClick = false;

    function hit(x: number, y: number) {
      const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-dock-pick]');
      return row && list.current?.contains(row) ? (row.dataset.dockPick ?? null) : null;
    }

    function cancel() {
      const current = press;
      if (!current) return;
      press = null;
      current.listeners.abort();
      window.clearTimeout(current.timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      if (current.opened) {
        if (host.hasPointerCapture(current.id)) host.releasePointerCapture(current.id);
        setOpen(false);
        setHighlight(null);
      }
    }

    function move(event: PointerEvent) {
      if (event.pointerId !== press?.id) return;
      if (!press.opened) {
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) >= HOLD_SLOP) cancel();
        return;
      }
      press.x = event.clientX;
      press.y = event.clientY;
      frame ??= requestAnimationFrame(() => {
        frame = undefined;
        if (press?.opened) setHighlight(hit(press.x, press.y));
      });
    }

    function up(event: PointerEvent) {
      if (event.pointerId !== press?.id) return;
      const choice = press.opened ? hit(event.clientX, event.clientY) : null;
      cancel();
      if (choice !== null) latest.current.onPick(choice);
    }

    host.addEventListener(
      'pointerdown',
      (event) => {
        if (
          press ||
          !event.isPrimary ||
          event.button !== 0 ||
          (event.pointerType !== 'touch' && event.pointerType !== 'pen') ||
          !(event.target instanceof Element) ||
          !event.target.closest('.q-navb')
        )
          return;

        const listeners = new AbortController();
        const tracking = { capture: true, signal: listeners.signal };
        const id = event.pointerId;
        const timer = window.setTimeout(() => {
          if (press?.id !== id) return;
          if (!latest.current.openPicker()) {
            cancel();
            return;
          }
          press.opened = true;
          suppressClick = true;
          try {
            host.setPointerCapture(id);
          } catch {
            // Слушатели окна продолжают получать движение и отпускание.
          }
          navigator.vibrate?.(10);
          setOpen(true);
        }, HOLD_MS);
        press = { id, x: event.clientX, y: event.clientY, timer, opened: false, listeners };
        window.addEventListener('pointermove', move, tracking);
        window.addEventListener('pointerup', up, tracking);
        window.addEventListener(
          'pointercancel',
          (e) => {
            if (e.pointerId === press?.id) cancel();
          },
          tracking,
        );
        window.addEventListener(
          'touchmove',
          (e) => {
            if (press?.opened && e.cancelable) e.preventDefault();
          },
          { ...tracking, passive: false },
        );
        window.addEventListener('blur', cancel, tracking);
        window.addEventListener(
          'keydown',
          (e) => {
            if (e.key !== 'Escape') return;
            if (press?.opened) {
              e.preventDefault();
              e.stopImmediatePropagation();
            }
            cancel();
          },
          tracking,
        );
      },
      listening,
    );
    window.addEventListener(
      'pointerdown',
      (event) => {
        suppressClick = false;
        if (press && event.pointerId !== press.id) cancel();
      },
      listening,
    );
    host.addEventListener(
      'lostpointercapture',
      (event) => {
        if (event.target === host && event.pointerId === press?.id) cancel();
      },
      listening,
    );
    host.addEventListener(
      'contextmenu',
      (event) => {
        if (press || suppressClick) event.preventDefault();
      },
      listening,
    );
    window.addEventListener(
      'click',
      (event) => {
        if (!suppressClick || event.detail === 0) return;
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
      },
      listening,
    );
    return () => {
      cancel();
      mounted.abort();
    };
  }, [dock, enabled]);

  return { list, open: enabled && open, highlight };
}

export function DockPicker({
  list,
  items,
  open,
  highlight,
}: {
  list: RefObject<HTMLDivElement | null>;
  items: NavItem[];
  open: boolean;
  highlight: string | null;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const { node, to } = useFlow(44, 0, { className: 'q-dock-pick-flow' });
  useLayoutEffect(() => {
    if (!open || highlight === null) return;
    const row = grid.current?.querySelector<HTMLElement>('[data-highlight]');
    if (row) to(row.offsetLeft, row.offsetLeft + row.offsetWidth, true, row.offsetTop);
  }, [highlight, open, to]);

  return (
    <div ref={list} className="q-dock-picker" inert={!open}>
      <Presence show={open} className="q-dock-picker-panel">
        <div ref={grid} className="q-dock-picker-list" role="group" aria-label="Выбор модуля">
          {node}
          {items.map((item) => (
            <Button
              key={item.id}
              variant="quiet"
              className="q-dock-pick"
              tabIndex={-1}
              data-dock-pick={item.id}
              data-highlight={item.id === highlight ? '' : undefined}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </Presence>
    </div>
  );
}
