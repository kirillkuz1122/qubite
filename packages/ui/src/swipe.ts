import { loop, Tracker, type Spring } from '@qubite/motion';

const SLOP = 10;
const MAX_SLOPE = Math.tan(Math.PI / 6);
const TEXT_ENTRY =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

type Axis = 'x' | 'y';

export interface SwipeOptions {
  axis: Axis;
  direction: 1 | -1;
  /** Последний предок, прокрутку которого учитываем. Шапка может исключить сам лист. */
  scrollBoundary?: (target: Element) => Element | null;
  filter?: (event: PointerEvent, target: Element) => boolean;
  onStart: () => void;
  /** Смещение в сторону жеста в px. */
  onMove: (distance: number) => void;
  /** Скорость отпускания в px/с, со знаком относительно направления жеста. */
  onEnd: (distance: number, velocity: number) => void;
  onCancel: () => void;
}

export function swipeAxis(dx: number, dy: number): Axis | 'pending' | 'diagonal' {
  if (Math.hypot(dx, dy) < SLOP) return 'pending';
  if (Math.abs(dy) <= Math.abs(dx) * MAX_SLOPE) return 'x';
  if (Math.abs(dx) <= Math.abs(dy) * MAX_SLOPE) return 'y';
  return 'diagonal';
}

export function canScroll(
  target: Element,
  axis: Axis,
  delta: number,
  boundary: Element | null = null,
): boolean {
  for (let el: Element | null = target; el; el = el.parentElement) {
    const page = el === document.scrollingElement;
    const style = getComputedStyle(el);
    const overflow = axis === 'x' ? style.overflowX : style.overflowY;
    if (
      (page && overflow !== 'hidden' && overflow !== 'clip') ||
      /^(auto|scroll|overlay)$/.test(overflow)
    ) {
      const max = axis === 'x' ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
      const pos = axis === 'x' ? el.scrollLeft : el.scrollTop;
      const rtl = axis === 'x' && style.direction === 'rtl';
      const room = delta > 0 ? pos - (rtl ? -max : 0) : (rtl ? 0 : max) - pos;
      if (max > 1 && room > 1) return true;
    }
    if (el === boundary) break;
  }
  return false;
}

export function settleSwipe(spring: Spring, goal: number): void {
  const L = loop();
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) L.set(spring, goal);
  else L.to(spring, goal);
}

/** Pointer Events ведут жест. Touchmove отдаёт браузеру прокрутку или удерживает касание. */
export function swipe(el: HTMLElement, options: SwipeOptions): () => void {
  const { axis, direction } = options;
  const track = new Tracker();
  let press: {
    id: number;
    x: number;
    y: number;
    last: number;
    target: Element;
    boundary: Element | null;
    active: boolean;
    listeners: AbortController;
  } | null = null;
  let suppressClick = false;
  const mounted = new AbortController();

  function stop() {
    const current = press;
    if (!current) return;
    press = null;
    current.listeners.abort();
    if (el.hasPointerCapture?.(current.id)) el.releasePointerCapture(current.id);
  }

  function cancel() {
    const active = press?.active;
    stop();
    if (active) options.onCancel();
  }

  function position(x: number, y: number) {
    if (!press) return null;
    const dx = x - press.x;
    const dy = y - press.y;
    return { dx, dy, delta: axis === 'x' ? dx : dy };
  }

  function blocked(target: Element, delta: number, boundary: Element | null) {
    return window.getSelection()?.isCollapsed === false || canScroll(target, axis, delta, boundary);
  }

  function move(event: PointerEvent) {
    const current = press;
    if (!current || event.pointerId !== current.id) return;
    const point = position(event.clientX, event.clientY)!;
    const stamp = event.timeStamp;
    if (stamp - current.last > 100) track.reset(event.clientX, event.clientY, stamp);
    else track.add(event.clientX, event.clientY, stamp);
    current.last = stamp;
    if (!current.active) {
      const intent = swipeAxis(point.dx, point.dy);
      if (intent === 'pending') return;
      if (
        intent !== axis ||
        point.delta * direction <= 0 ||
        blocked(current.target, point.delta, current.boundary)
      ) {
        stop();
        return;
      }
      current.active = true;
      suppressClick = true;
      try {
        el.setPointerCapture?.(current.id);
      } catch {
        // Слушатели окна продолжают вести жест без захвата.
      }
      options.onStart();
    }
    if (event.cancelable) event.preventDefault();
    options.onMove(point.delta * direction);
  }

  function touchMove(event: TouchEvent) {
    if (!press) return;
    const touch = event.touches[0];
    if (!touch || event.touches.length !== 1) {
      cancel();
      return;
    }
    const point = position(touch.clientX, touch.clientY)!;
    if (press.active) {
      if (event.cancelable) event.preventDefault();
      return;
    }
    // Браузер может начать прокрутку до 10 px. Удерживаем только движение в сторону жеста,
    // когда прокручивать уже нечего. Визуально жест всё равно начинается после порога.
    const cross = axis === 'x' ? point.dy : point.dx;
    if (
      event.cancelable &&
      point.delta * direction > 0 &&
      Math.abs(cross) <= Math.abs(point.delta) * MAX_SLOPE &&
      !blocked(press.target, point.delta, press.boundary)
    ) {
      event.preventDefault();
    }
  }

  function up(event: PointerEvent) {
    const current = press;
    if (!current || event.pointerId !== current.id) return;
    const point = position(event.clientX, event.clientY)!;
    stop();
    if (!current.active) return;
    track.add(event.clientX, event.clientY, event.timeStamp);
    const { vx, vy } = track.velocity();
    const velocity = event.timeStamp - current.last > 100 ? 0 : axis === 'x' ? vx : vy;
    options.onEnd(point.delta * direction, velocity * direction);
  }

  function down(event: PointerEvent) {
    const target = event.target;
    if (
      press ||
      !event.isPrimary ||
      event.button !== 0 ||
      (event.pointerType !== 'touch' && event.pointerType !== 'pen') ||
      !(target instanceof Element) ||
      target.closest(TEXT_ENTRY) ||
      window.getSelection()?.isCollapsed === false ||
      (options.filter && !options.filter(event, target))
    ) {
      return;
    }
    const listeners = new AbortController();
    const listening = { capture: true, signal: listeners.signal };
    press = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      last: event.timeStamp,
      target,
      boundary: options.scrollBoundary?.(target) ?? null,
      active: false,
      listeners,
    };
    track.reset(event.clientX, event.clientY, event.timeStamp);
    window.addEventListener('pointermove', move, listening);
    window.addEventListener('pointerup', up, listening);
    window.addEventListener(
      'pointercancel',
      (e) => {
        if (e.pointerId === press?.id) cancel();
      },
      listening,
    );
    window.addEventListener('touchmove', touchMove, { ...listening, passive: false });
    window.addEventListener('blur', cancel, { signal: listeners.signal });
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || !press?.active) return;
        e.preventDefault();
        e.stopPropagation();
        cancel();
      },
      listening,
    );
  }

  const listening = { capture: true, signal: mounted.signal };
  window.addEventListener(
    'pointerdown',
    (event) => {
      suppressClick = false;
      if (press && press.id !== event.pointerId && event.pointerType !== 'mouse') cancel();
    },
    listening,
  );
  el.addEventListener('pointerdown', down, { signal: mounted.signal });
  el.addEventListener(
    'lostpointercapture',
    (event) => {
      if (event.target === el && event.pointerId === press?.id) cancel();
    },
    { signal: mounted.signal },
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
    stop();
    mounted.abort();
  };
}
