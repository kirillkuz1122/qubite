import type { TaskStatus } from '@qubite/sync-client';
import { SWIPE_ROW_HOLD_MS } from '@qubite/ui';

const HOLD_SLOP = 8;
const MOUSE_THRESHOLD = 6;
const EDGE_ZONE = 72;
const MAX_SCROLL = 18;

export function edgeScrollSpeed(y: number, top: number, bottom: number): number {
  const zone = Math.min(EDGE_ZONE, (bottom - top) / 2);
  if (zone <= 0) return 0;
  if (y < top + zone) return -Math.ceil(MAX_SCROLL * Math.min(1, (top + zone - y) / zone));
  if (y > bottom - zone) return Math.ceil(MAX_SCROLL * Math.min(1, (y - bottom + zone) / zone));
  return 0;
}

function scrollParent(card: HTMLElement) {
  for (let el = card.parentElement; el && el !== document.scrollingElement; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight && /^(auto|scroll)$/.test(getComputedStyle(el).overflowY))
      return el;
  }
  return null;
}

function visibleBounds(scroller: HTMLElement | null, header: Element | null, dock: Element | null) {
  const viewport = window.visualViewport;
  let viewportTop = viewport?.offsetTop ?? 0;
  let height = viewport?.height ?? window.innerHeight;
  if (!viewport) {
    const style = getComputedStyle(document.documentElement);
    viewportTop = Number.parseFloat(style.getPropertyValue('--app-vt')) || 0;
    height = Number.parseFloat(style.getPropertyValue('--app-vh')) || height;
  }
  const scrollTop = scroller
    ? scroller.getBoundingClientRect().top + scroller.clientTop
    : -Infinity;
  return {
    top: Math.max(viewportTop, scrollTop, header?.getBoundingClientRect().bottom ?? -Infinity),
    bottom: Math.min(
      viewportTop + height,
      scroller ? scrollTop + scroller.clientHeight : Infinity,
      dock?.getBoundingClientRect().top ?? Infinity,
    ),
  };
}

interface DragCallbacks {
  onOver: (status: TaskStatus | null) => void;
  onDrop: (status: TaskStatus) => void;
  onEnd: () => void;
}

/** Один жест указателя. Возвращает отмену для смены экрана или способа переноса. */
export function startBoardDrag(
  event: Pick<PointerEvent, 'pointerId' | 'pointerType' | 'clientX' | 'clientY'>,
  card: HTMLElement,
  board: HTMLElement,
  { onOver, onDrop, onEnd }: DragCallbacks,
) {
  const { pointerId, pointerType, clientX: startX, clientY: startY } = event;
  const hold = pointerType === 'touch' || pointerType === 'pen';
  const scroller = scrollParent(card);
  const scrollContent = scroller ?? document.scrollingElement;
  const contentHeight = scrollContent?.scrollHeight ?? 0;
  const header = board.closest('.main-in')?.querySelector(':scope > .head') ?? null;
  const dock = document.querySelector('.q-dock, .pc-cmd');
  const viewport = window.visualViewport;
  const scrollX = () => window.scrollX + (scroller?.scrollLeft ?? 0);
  const scrollY = () => window.scrollY + (scroller?.scrollTop ?? 0);
  const startScrollX = scrollX();
  const startScrollY = scrollY();
  const controller = new AbortController();
  const listeners = { signal: controller.signal, capture: true };
  let x = startX;
  let y = startY;
  let active = false;
  let over: TaskStatus | null = null;
  let timer: number | undefined;
  let frame: number | undefined;

  function columnAt(cx: number, cy: number, { top, bottom }: ReturnType<typeof visibleBounds>) {
    if (cy < top || cy >= bottom) return null;
    const hit = document.elementsFromPoint(cx, cy).find((el) => el.matches('.board > .col'));
    return hit?.parentElement === board
      ? (hit.getAttribute('data-status') as TaskStatus | null)
      : null;
  }

  function end() {
    if (controller.signal.aborted) return;
    controller.abort();
    window.clearTimeout(timer);
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    if (active) {
      card.style.transform = '';
      card.classList.remove('dragging');
      document.documentElement.classList.remove('q-dragging');
    }
    onEnd();
  }

  function draw() {
    frame = undefined;
    if (!card.isConnected) {
      end();
      return;
    }
    const bounds = visibleBounds(scroller, header, dock);
    let speed = edgeScrollSpeed(y, bounds.top, bounds.bottom);
    if (speed > 0 && scrollContent) {
      // Сдвинутая карточка не должна сама удлинять прокрутку за последней колонкой.
      const remaining = contentHeight - scrollContent.clientHeight - scrollContent.scrollTop;
      speed = Math.min(speed, Math.max(0, remaining));
    }
    const before = scrollY();
    if (speed) (scroller ?? window).scrollBy({ top: speed, behavior: 'instant' });
    const after = scrollY();
    const dx = x - startX + scrollX() - startScrollX;
    const dy = y - startY + after - startScrollY;
    card.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;

    const to = columnAt(x, y, after === before ? bounds : visibleBounds(scroller, header, dock));
    if (to !== over) {
      over = to;
      onOver(to);
    }
    if (after !== before) schedule();
  }

  function schedule() {
    if (active) frame ??= window.requestAnimationFrame(draw);
  }

  function activate() {
    if (!card.isConnected) {
      end();
      return;
    }
    active = true;
    card.classList.add('dragging');
    document.documentElement.classList.add('q-dragging');
    window.getSelection()?.removeAllRanges();
    if (hold) navigator.vibrate?.(10);
    schedule();
  }

  function move(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    x = e.clientX;
    y = e.clientY;
    if (active) {
      schedule();
      return;
    }
    const distance = Math.hypot(x - startX, y - startY);
    if (hold) {
      if (distance > HOLD_SLOP) end();
    } else if (distance >= MOUSE_THRESHOLD) {
      activate();
    }
  }

  function release(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    const to =
      active && card.isConnected
        ? columnAt(e.clientX, e.clientY, visibleBounds(scroller, header, dock))
        : null;
    end();
    if (to) onDrop(to);
  }

  window.addEventListener('pointermove', move, listeners);
  window.addEventListener('pointerup', release, listeners);
  window.addEventListener(
    'pointercancel',
    (e) => {
      if (e.pointerId === pointerId) end();
    },
    listeners,
  );
  window.addEventListener('blur', end, { signal: controller.signal });
  window.addEventListener('scroll', schedule, listeners);
  window.addEventListener('resize', schedule, listeners);
  viewport?.addEventListener('scroll', schedule, listeners);
  viewport?.addEventListener('resize', schedule, listeners);
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') end();
    },
    listeners,
  );
  if (hold) {
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerId !== pointerId && e.pointerType !== 'mouse') end();
      },
      listeners,
    );
    // Слушатель нужен до первого движения, чтобы после удержания браузер ждал preventDefault.
    window.addEventListener(
      'touchmove',
      (e) => {
        if (active && e.cancelable) e.preventDefault();
      },
      { ...listeners, passive: false },
    );
    window.addEventListener('contextmenu', (e) => e.preventDefault(), listeners);
    timer = window.setTimeout(activate, SWIPE_ROW_HOLD_MS);
  }
  return end;
}
