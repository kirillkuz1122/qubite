/**
 * Жесты пальцем и мышью на pointer events: перетаскивание, бросок со скоростью, отмена.
 * Сам жест ничего не двигает — он сообщает смещение и скорость, а двигают пружины (Loop.hold и Loop.to).
 */

/**
 * «Резинка» у края: за пределами [min, max] элемент идёт за пальцем всё туже и туже.
 * dim — насколько далеко максимум можно вытянуть (в тех же единицах, что x).
 */
export function rubber(x: number, min: number, max: number, dim = 60): number {
  const band = (over: number) => (1 - 1 / ((over * 0.55) / dim + 1)) * dim;
  if (x < min) return min - band(min - x);
  if (x > max) return max + band(x - max);
  return x;
}

/**
 * Куда «докатится» брошенный элемент: положение плюс путь, который даёт скорость v (ед./с).
 * rate — сколько скорости остаётся за 1 мс (как у прокрутки на телефоне); 0,99 — короткий бросок.
 */
export function project(x: number, v: number, rate = 0.99): number {
  return x + ((v / 1000) * rate) / (1 - rate);
}

/** Скорость пальца по последним точкам (за последние 100 мс), ед./с. */
export class Tracker {
  private pts: { x: number; y: number; t: number }[] = [];

  reset(x: number, y: number, t: number): void {
    this.pts = [{ x, y, t }];
  }

  add(x: number, y: number, t: number): void {
    this.pts.push({ x, y, t });
    while (this.pts.length > 2 && t - this.pts[0]!.t > 100) this.pts.shift();
  }

  velocity(): { vx: number; vy: number } {
    const a = this.pts[0];
    const b = this.pts[this.pts.length - 1];
    if (!a || !b || b.t - a.t < 1) return { vx: 0, vy: 0 };
    const dt = (b.t - a.t) / 1000;
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  }
}

export interface DragMove {
  /** смещение от точки нажатия */
  dx: number;
  dy: number;
  /** где палец сейчас (координаты окна) */
  x: number;
  y: number;
}
export interface DragEnd extends DragMove {
  /** скорость пальца в момент отпускания, px/с */
  vx: number;
  vy: number;
}

export interface DragOptions {
  /** по какой оси жест: если палец пошёл по другой — отдаём жест прокрутке (по умолчанию both) */
  axis?: 'x' | 'y' | 'both';
  /** сколько пикселей проехать, прежде чем нажатие станет перетаскиванием */
  threshold?: number;
  /** начинать ли жест с этого касания (например, только с выбранного пункта) */
  filter?: (e: PointerEvent) => boolean;
  /** палец коснулся (ещё не перетаскивание) */
  onDown?: (at: { x: number; y: number }, e: PointerEvent) => void;
  /** нажатие стало перетаскиванием */
  onStart?: (m: DragMove) => void;
  onMove?: (m: DragMove) => void;
  /** отпустили после перетаскивания */
  onEnd?: (e: DragEnd) => void;
  /** отпустили, не сдвинув: обычное нажатие */
  onTap?: (at: { x: number; y: number }) => void;
  /** жест отменён: Escape, система забрала палец (прокрутка, звонок), палец ушёл в другую ось */
  onCancel?: () => void;
  /** часы — для тестов; по умолчанию время события */
  now?: () => number;
}

export interface DragHandle {
  /** идёт ли перетаскивание прямо сейчас */
  readonly active: boolean;
  /** отменить текущий жест (например, по Escape) */
  cancel(): void;
  /** снять обработчики */
  destroy(): void;
}

/**
 * Перетаскивание элемента. Палец «захватывается» (pointer capture), поэтому жест не теряется,
 * если палец ушёл за край. Escape и pointercancel отменяют жест — элемент должен вернуться на место.
 */
export function drag(el: HTMLElement, o: DragOptions): DragHandle {
  const axis = o.axis ?? 'both';
  const threshold = o.threshold ?? 6;
  const track = new Tracker();
  let id: number | null = null;
  let sx = 0;
  let sy = 0;
  let started = false;
  const win = el.ownerDocument?.defaultView ?? null;
  const time = (e: Event) => (o.now ? o.now() : e.timeStamp || performance.now());
  const move = (e: PointerEvent): DragMove => ({
    dx: e.clientX - sx,
    dy: e.clientY - sy,
    x: e.clientX,
    y: e.clientY,
  });

  const stop = () => {
    if (id !== null) {
      try {
        el.releasePointerCapture?.(id);
      } catch {
        /* палец уже отпущен */
      }
    }
    id = null;
    started = false;
    win?.removeEventListener('keydown', onKey, true);
  };
  const cancel = () => {
    if (id === null) return;
    const was = started;
    stop();
    if (was) o.onCancel?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && started) {
      e.preventDefault();
      cancel();
    }
  };

  const down = (e: PointerEvent) => {
    if (id !== null || (e.button !== undefined && e.button > 0)) return;
    if (o.filter && !o.filter(e)) return;
    id = e.pointerId ?? 1;
    sx = e.clientX;
    sy = e.clientY;
    started = false;
    track.reset(e.clientX, e.clientY, time(e));
    win?.addEventListener('keydown', onKey, true);
    o.onDown?.({ x: e.clientX, y: e.clientY }, e);
  };
  const moveH = (e: PointerEvent) => {
    if (id === null || (e.pointerId ?? 1) !== id) return;
    track.add(e.clientX, e.clientY, time(e));
    const m = move(e);
    if (!started) {
      const ax = Math.abs(m.dx);
      const ay = Math.abs(m.dy);
      if (Math.max(ax, ay) < threshold) return;
      if ((axis === 'x' && ay > ax) || (axis === 'y' && ax > ay)) {
        // палец пошёл не туда — это прокрутка, а не наш жест
        stop();
        return;
      }
      started = true;
      try {
        el.setPointerCapture?.(id);
      } catch {
        /* без захвата тоже работает, пока палец над элементом */
      }
      o.onStart?.(m);
    }
    e.preventDefault();
    o.onMove?.(m);
  };
  const up = (e: PointerEvent) => {
    if (id === null || (e.pointerId ?? 1) !== id) return;
    track.add(e.clientX, e.clientY, time(e));
    const was = started;
    const m = move(e);
    stop();
    if (was) o.onEnd?.({ ...m, ...track.velocity() });
    else o.onTap?.({ x: e.clientX, y: e.clientY });
  };
  const cancelH = (e: PointerEvent) => {
    if (id !== null && (e.pointerId ?? 1) === id) cancel();
  };
  /**
   * Потеря захвата — только своего. Вложенная кнопка, которая сама держала палец, тоже теряет его,
   * когда жест забирает палец себе; её событие всплывает сюда, но это не отмена нашего жеста.
   */
  const lostH = (e: PointerEvent) => {
    if (e.target === el && started) cancelH(e);
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', moveH);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancelH);
  el.addEventListener('lostpointercapture', lostH);
  return {
    get active() {
      return started;
    },
    cancel,
    destroy() {
      stop();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', moveH);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancelH);
      el.removeEventListener('lostpointercapture', lostH);
    },
  };
}
