/**
 * Куда смотрят помощники: палец или курсор, поле ввода в фокусе — или «осматриваются» сами.
 * Один набор слушателей на страницу.
 */
export interface Point {
  x: number;
  y: number;
}

export const pointer = { x: 0, y: 0, t: -1e9 };
let focusFn: (() => Point | null) | null = null;
const wander = { x: 0, y: 0, next: 0 };
let installed = false;

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  pointer.x = innerWidth / 2;
  pointer.y = innerHeight / 3;
  const on = (e: PointerEvent) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.t = performance.now();
  };
  addEventListener('pointermove', on, { passive: true });
  addEventListener('pointerdown', on, { passive: true });
}

/** Помощники смотрят на эту точку, пока фокус не снят (null). */
export function focusOn(fn: (() => Point | null) | null): void {
  focusFn = fn;
}

export function target(): Point & { focus: boolean } {
  install();
  const now = performance.now();
  const f = focusFn?.();
  if (f) return { ...f, focus: true };
  if (now - pointer.t < 3500) return { x: pointer.x, y: pointer.y, focus: false };
  if (now > wander.next) {
    wander.x = innerWidth * (0.15 + Math.random() * 0.7);
    wander.y = innerHeight * (0.1 + Math.random() * 0.6);
    wander.next = now + 1800 + Math.random() * 2600;
  }
  return { x: wander.x, y: wander.y, focus: false };
}

/** Где каретка в поле ввода — чтобы помощники смотрели прямо на текст. */
export function caretPoint(input: HTMLInputElement): Point {
  const r = input.getBoundingClientRect();
  const cs = getComputedStyle(input);
  const m = document.createElement('canvas').getContext('2d');
  let w = 0;
  if (m) {
    m.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    w = m.measureText(input.value.slice(0, input.selectionStart ?? input.value.length)).width;
  }
  const pad = parseFloat(cs.paddingLeft) || 0;
  return { x: Math.min(r.left + pad + w - input.scrollLeft, r.right - 8), y: r.top + r.height / 2 };
}
