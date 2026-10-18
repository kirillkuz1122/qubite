import { Spring, type SpringListener } from './spring';

/** Самый длинный кадр, который мы честно считаем: после паузы вкладки не «телепортируемся». */
const MAX_DT = 0.05;
/** Внутренний шаг физики — мелкий, чтобы лёгкие пружины не разлетались. */
const SUBSTEP = 0.006;

export type Ticker = (t: number, dt: number) => void;

export interface LoopHost {
  requestFrame(cb: (now: number) => void): number;
  hidden(): boolean;
  reducedMotion(): boolean;
}

/** Окружение браузера: один requestAnimationFrame, сон в скрытой вкладке, «меньше движения». */
export function browserHost(): LoopHost {
  const media =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  return {
    requestFrame: (cb) =>
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(cb)
        : (setTimeout(() => cb(performance.now()), 16) as unknown as number),
    hidden: () => typeof document !== 'undefined' && document.hidden,
    reducedMotion: () => !!media?.matches,
  };
}

/**
 * Один цикл анимации на страницу. Пружины и «тикеры» (холсты с точками) крутятся в нём;
 * когда двигать нечего, цикл засыпает и не тратит батарею.
 */
export class Loop {
  private springs = new Set<Spring>();
  private tickers = new Set<Ticker>();
  private dirty = new Set<() => void>();
  private raf = 0;
  private last = 0;

  constructor(private host: LoopHost) {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this.last = 0;
        this.wake();
      });
    }
  }

  get reduced(): boolean {
    return this.host.reducedMotion();
  }

  /** Новая пружина. onChange вызывается после каждого шага — пиши в нём только transform и opacity. */
  spring(x: number, mass = 1, onChange: SpringListener | null = null): Spring {
    return new Spring(x, mass, onChange);
  }

  /** Отправить пружину к цели. При «меньше движения» — сразу в цель. */
  to(s: Spring, goal: number): Spring {
    s.goal = goal;
    if (this.reduced) {
      s.x = goal;
      s.v = 0;
      s.emit();
      return s;
    }
    this.springs.add(s);
    this.wake();
    return s;
  }

  /** Толчок: добавить скорость (прыжок, отскок). При «меньше движения» ничего не делает. */
  kick(s: Spring, v: number): Spring {
    if (this.reduced) return s;
    s.v += v;
    this.springs.add(s);
    this.wake();
    return s;
  }

  /** Поставить сразу, без движения. */
  set(s: Spring, x: number): Spring {
    s.x = s.goal = x;
    s.v = 0;
    this.springs.delete(s);
    s.emit();
    return s;
  }

  /** Подписка на каждый кадр (холсты с точками). Возвращает отписку. */
  tick(fn: Ticker): () => void {
    this.tickers.add(fn);
    this.wake();
    return () => this.tickers.delete(fn);
  }

  /** Отложить отрисовку до конца кадра: сколько пружин ни сдвинулось — рисуем один раз. */
  render(fn: () => void): () => void {
    return () => {
      this.dirty.add(fn);
      this.wake();
    };
  }

  /** Есть ли что двигать (для тестов и отладки). */
  get busy(): boolean {
    return this.springs.size > 0 || this.tickers.size > 0;
  }

  /** Один кадр. Вызывает браузер, а тесты — напрямую, со своим временем. */
  frame(now: number): void {
    this.raf = 0;
    const t = now / 1000;
    let dt = this.last ? t - this.last : 1 / 60;
    this.last = t;
    if (dt > MAX_DT) dt = MAX_DT;
    this.tickers.forEach((fn) => fn(t, dt));
    const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
    const h = dt / steps;
    this.springs.forEach((s) => {
      for (let i = 0; i < steps; i++) s.step(h);
      if (s.settle()) this.springs.delete(s);
      s.emit();
    });
    this.dirty.forEach((fn) => fn());
    this.dirty.clear();
    if (this.busy) this.wake();
    else this.last = 0;
  }

  private wake(): void {
    if (!this.raf && !this.host.hidden())
      this.raf = this.host.requestFrame((now) => this.frame(now));
  }
}

let shared: Loop | null = null;

/** Общий цикл страницы. */
export function loop(): Loop {
  if (!shared) shared = new Loop(browserHost());
  return shared;
}
