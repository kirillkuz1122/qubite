/**
 * Холст с точками: всё на нём — надписи и помощники — собрано из точек.
 * Каждая точка — пружина к своему месту из того же материала, что и весь интерфейс (MATERIAL);
 * от пальца точки разлетаются и возвращаются. Помощники — тела из точек, которые гнутся от основания:
 * чем выше точка, тем сильнее сдвиг. Перенос макета docs/design/explorations/core/dots.js.
 */
import { loop, MATERIAL, type Spring } from '@qubite/motion';
import { pointer, target } from './attention';
import { blob, dotLook } from './look';
import { PIXEL_FONT, textCells, type Cell } from './text';
import type { CompanionKind } from '../tokens';

export interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hx: number;
  hy: number;
  m: number;
  c: string;
  r: number;
  /** радиус, к которому точка плавно растёт или сжимается */
  rt: number | null;
  /** до этого времени (с) точка не появляется — для сборки по очереди */
  wake: number;
  alive: boolean;
  cell?: Cell;
  /** положение внутри тела помощника */
  u?: number;
  h?: number;
  /** помощник, в которого точка «впитывается» */
  into?: Body | null;
}

export interface TextGroup {
  dots: Dot[];
  x: number;
  y: number;
  p: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
}

export type Mood = 'idle' | 'happy' | 'sad' | 'shut';

interface Kind {
  cells: () => Cell[];
  h: number;
  eyes: [number, number][];
  mouth?: number;
  glasses?: number;
  beak?: number;
  mass: number;
  lean: number;
}

export interface Body {
  kind: CompanionKind;
  K: Kind;
  x: number;
  y: number;
  p: number;
  color: string;
  hPx: number;
  dots: Dot[];
  lean: Spring;
  sy: Spring;
  lift: Spring;
  lx: Spring;
  ly: Spring;
  breath: number;
  phase: number;
  mood: Mood;
  blink: number;
  nextBlink: number;
  away: boolean;
  aimT: number;
  moodTimer: ReturnType<typeof setTimeout> | undefined;
  point(u: number, h: number): { x: number; y: number };
  jump(v?: number): Body;
  setMood(m: Mood, ms?: number): Body;
  turnAway(on: boolean): Body;
  place(x: number, y: number, pitch?: number): Body;
  /** поставить точки тела сразу на места, без полёта */
  settle(): Body;
}

/* ---------- Формы помощников в клетках (низ = 0) ---------- */
function roundedCols(w: number, h: number, rTop: number): Cell[] {
  const cells: Cell[] = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if ((i === 0 || i === w - 1) && j === 0) continue;
      if (j >= h - rTop) {
        const cx = i < rTop ? rTop - 0.5 : i > w - 1 - rTop ? w - rTop - 0.5 : i;
        const cy = h - rTop - 0.5;
        if (Math.hypot(i - cx, j - cy) > rTop - 0.05) continue;
      }
      cells.push([i - (w - 1) / 2, j]);
    }
  }
  return cells;
}
function halfDisc(R: number): Cell[] {
  const cells: Cell[] = [];
  for (let j = 0; j <= R; j++) {
    for (let i = -R; i <= R; i++) {
      if (i * i + (j + 0.5) * (j + 0.5) > (R + 0.35) * (R + 0.35)) continue;
      if (j === 0 && Math.abs(i) === R) continue;
      cells.push([i, j]);
    }
  }
  return cells;
}

/** Лица: глаза, рот, очки и клюв — в клетках относительно низа-центра. */
export const KINDS: Record<CompanionKind, Kind> = {
  proto: {
    cells: () => roundedCols(8, 22, 3),
    h: 22,
    eyes: [
      [-1.6, 18.6],
      [1.6, 18.6],
    ],
    mouth: 15.4,
    mass: 2.1,
    lean: 8,
  },
  neit: {
    cells: () => roundedCols(10, 16, 4),
    h: 16,
    eyes: [
      [-2.1, 10.8],
      [2.1, 10.8],
    ],
    mouth: 6.8,
    glasses: 1.75,
    mass: 1.9,
    lean: 8,
  },
  elik: {
    cells: () => roundedCols(7, 12, 3.5),
    h: 12,
    eyes: [
      [-1.1, 8.4],
      [1.3, 8.4],
    ],
    beak: 6.2,
    mass: 1.3,
    lean: 12,
  },
  foti: {
    cells: () => halfDisc(9),
    h: 9.5,
    eyes: [
      [-2.2, 5.2],
      [2.2, 5.2],
    ],
    mouth: 3.0,
    mass: 2.4,
    lean: 5,
  },
};

/** Ширина и высота помощника в клетках — чтобы подобрать размер холста. */
export function companionSize(kind: CompanionKind): { w: number; h: number } {
  const cells = KINDS[kind].cells();
  const xs = cells.map((c) => c[0]);
  return { w: Math.max(...xs) - Math.min(...xs) + 1 + (kind === 'elik' ? 7 : 0), h: KINDS[kind].h };
}

const engines = new Set<DotEngine>();

/** Сменить палитру всех холстов страницы сразу (смена темы): каждый цвет — по таблице «было → стало». */
export function recolorAll(map: Record<string, string>): void {
  engines.forEach((e) => e.recolor(map));
}

export interface EngineOptions {
  /** цвет фона — им рисуются «дырки» глаз */
  ground: string;
  /** основной цвет — зрачки светлых помощников */
  light: string;
  /** радиус, в котором точки убегают от пальца; 0 — не убегают */
  repel?: number;
}

export class DotEngine {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  ground: string;
  light: string;
  repel: number;
  dots: Dot[] = [];
  bodies: Body[] = [];
  /** false — холст за экраном: не считаем и не рисуем */
  on = true;
  W = 0;
  H = 0;
  private box = { x: 0, y: 0 };
  private byColor = new Map<string, Dot[]>();
  private dirtyColors = true;
  private dead = false;
  private absorbs: { dots: Dot[]; done?: () => void; fired: boolean }[] = [];
  /** облегчённый режим: считаем и рисуем через кадр, время копим */
  private skip = false;
  private owed = 0;
  /** когда последний раз уточняли место холста на экране, мс */
  private boxT = 0;
  private stopTick: () => void;
  private onResize = () => this.resize();
  private onScroll = () => {
    const r = this.canvas.getBoundingClientRect();
    this.box = { x: r.left, y: r.top };
  };

  constructor(canvas: HTMLCanvasElement, o: EngineOptions) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ground = o.ground;
    this.light = o.light;
    this.repel = o.repel ?? 64;
    this.resize();
    addEventListener('resize', this.onResize);
    addEventListener('scroll', this.onScroll, { passive: true, capture: true });
    this.stopTick = loop().tick((t, dt) => this.frame(t, dt));
    if (loop().reduced) requestAnimationFrame(() => this.frame(performance.now() / 1000, 0));
    engines.add(this);
  }

  destroy(): void {
    this.stopTick();
    removeEventListener('resize', this.onResize);
    removeEventListener('scroll', this.onScroll, { capture: true });
    engines.delete(this);
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.W = r.width;
    this.H = r.height;
    this.box = { x: r.left, y: r.top };
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  dot(
    hx: number,
    hy: number,
    color: string,
    r: number,
    from?: [number, number] | null,
    delay = 0,
  ): Dot {
    const d: Dot = {
      hx,
      hy,
      x: from ? from[0] : hx,
      y: from ? from[1] : hy,
      vx: 0,
      vy: 0,
      m: 0.75 + Math.random() * 0.5,
      c: color,
      r,
      rt: null,
      wake: delay,
      alive: true,
    };
    if (loop().reduced) {
      d.x = hx;
      d.y = hy;
      d.wake = 0;
    }
    this.dots.push(d);
    this.dirtyColors = true;
    return d;
  }

  /** Перекрасить одну точку. */
  paint(d: Dot, color: string): void {
    if (d.c !== color) {
      d.c = color;
      this.dirtyColors = true;
    }
  }

  /** Сменить палитру: map — старый цвет → новый. */
  recolor(map: Record<string, string>): void {
    this.dots.forEach((d) => (d.c = map[d.c] ?? d.c));
    this.bodies.forEach((b) => (b.color = map[b.color] ?? b.color));
    this.ground = map[this.ground] ?? this.ground;
    this.light = map[this.light] ?? this.light;
    this.dirtyColors = true;
    if (loop().reduced) this.frame(performance.now() / 1000, 0);
  }

  /** разлёт для появления: точки прилетают из облака и собираются в форму */
  private scatter(): [number, number] {
    return [this.W * (0.2 + Math.random() * 0.9), this.H * (Math.random() * 1.2 - 0.1)];
  }

  text(
    str: string,
    o: {
      x: number;
      y: number;
      pitch: number;
      color: string;
      r?: number;
      assemble?: boolean;
      delay?: number;
      lineRows?: number;
    },
  ): TextGroup {
    const tc = textCells(str, PIXEL_FONT, o.lineRows);
    const p = o.pitch;
    const g: TextGroup = {
      dots: [],
      x: o.x,
      y: o.y,
      p,
      cols: tc.cols,
      rows: tc.rows,
      width: tc.cols * p,
      height: tc.rows * p,
    };
    tc.cells.forEach((c) => {
      const d = this.dot(
        o.x + (c[0] + 0.5) * p,
        o.y + (c[1] + 0.5) * p,
        o.color,
        p * (o.r ?? 0.42),
        o.assemble ? this.scatter() : null,
        o.assemble ? (o.delay ?? 0) + c[0] * 0.018 + Math.random() * 0.25 : 0,
      );
      d.cell = c;
      g.dots.push(d);
    });
    if (o.assemble) {
      const now = performance.now() / 1000;
      g.dots.forEach((d) => (d.wake += now));
    }
    return g;
  }

  /** Перестроить надпись в другую: те же точки разлетаются и собираются в новые буквы. */
  morph(
    g: TextGroup,
    str: string,
    o: { color?: string; r?: number; lineRows?: number } = {},
  ): TextGroup {
    const tc = textCells(str, PIXEL_FONT, o.lineRows);
    const p = g.p;
    const by = (a: Cell, b: Cell) => a[0] - b[0] || a[1] - b[1];
    const cells = tc.cells.slice().sort(by);
    const old = g.dots
      .filter((d) => d.alive)
      .sort((a, b) => by(a.cell ?? [0, 0], b.cell ?? [0, 0]));
    const taken: boolean[] = [];
    const next: Dot[] = [];
    const reduced = loop().reduced;
    cells.forEach((c, i) => {
      const j = Math.floor((i * old.length) / cells.length);
      let d = old[j];
      if (!d || taken[j])
        d = this.dot(
          d ? d.x : g.x,
          d ? d.y : g.y,
          o.color ?? d?.c ?? this.light,
          p * (o.r ?? 0.42),
        );
      else taken[j] = true;
      d.cell = c;
      d.hx = g.x + (c[0] + 0.5) * p;
      d.hy = g.y + (c[1] + 0.5) * p;
      d.rt = p * (o.r ?? 0.42);
      d.wake = 0;
      if (o.color) this.paint(d, o.color);
      if (!reduced) {
        d.vx += (Math.random() - 0.5) * 260;
        d.vy -= Math.random() * 180;
      }
      next.push(d);
    });
    old.forEach((d, j) => {
      if (taken[j]) return;
      const c = cells[Math.floor(Math.random() * cells.length)] ?? [0, 0];
      d.hx = g.x + (c[0] + 0.5) * p;
      d.hy = g.y + (c[1] + 0.5) * p;
      d.rt = 0;
      setTimeout(
        () => {
          d.alive = false;
          this.dead = true;
        },
        reduced ? 0 : 600,
      );
    });
    Object.assign(g, {
      dots: next,
      cols: tc.cols,
      rows: tc.rows,
      width: tc.cols * p,
      height: tc.rows * p,
    });
    return g;
  }

  body(
    kind: CompanionKind,
    o: { x: number; y: number; pitch: number; color: string; assemble?: boolean; delay?: number },
  ): Body {
    const K = KINDS[kind];
    const L = loop();
    const p = o.pitch;
    const b: Body = {
      kind,
      K,
      x: o.x,
      y: o.y,
      p,
      color: o.color,
      hPx: K.h * p,
      dots: [],
      lean: L.spring(0, K.mass),
      sy: L.spring(1, K.mass),
      lift: L.spring(0, K.mass),
      lx: L.spring(0, 0.4),
      ly: L.spring(0, 0.4),
      breath: 0,
      phase: Math.random() * 6,
      mood: 'idle',
      blink: 0,
      nextBlink: 1 + Math.random() * 3,
      away: false,
      aimT: 0,
      moodTimer: undefined,
      point(u, h) {
        const s = b.sy.x * (1 + b.breath);
        const lean = Math.tan((b.lean.x * Math.PI) / 180) * b.hPx;
        return {
          x: b.x + u / Math.sqrt(s) + lean * Math.pow(Math.max(0, h) / b.hPx, 1.35),
          y: b.y - b.lift.x - h * s,
        };
      },
      jump(v = 380) {
        b.sy.x = 0.82;
        b.sy.v = 0;
        L.to(b.sy, 1);
        L.kick(b.lift, v);
        return b;
      },
      setMood(m, ms) {
        b.mood = m;
        clearTimeout(b.moodTimer);
        if (ms) b.moodTimer = setTimeout(() => (b.mood = 'idle'), ms);
        return b;
      },
      turnAway(on) {
        b.away = on;
        b.mood = on ? 'shut' : 'idle';
        return b;
      },
      place(x, y, pitch) {
        b.x = x;
        b.y = y;
        if (pitch && pitch !== b.p) {
          const k = pitch / b.p;
          b.p = pitch;
          b.hPx = K.h * pitch;
          b.dots.forEach((d) => {
            d.u = (d.u ?? 0) * k;
            d.h = (d.h ?? 0) * k;
            d.r = pitch * 0.4;
          });
        }
        return b;
      },
      settle() {
        b.dots.forEach((d) => {
          const q = b.point(d.u ?? 0, d.h ?? 0);
          d.x = d.hx = q.x;
          d.y = d.hy = q.y;
          d.vx = d.vy = 0;
        });
        return b;
      },
    };
    const now = performance.now() / 1000;
    K.cells().forEach((c) => {
      const d = this.dot(
        0,
        0,
        o.color,
        p * 0.4,
        o.assemble ? this.scatter() : null,
        o.assemble ? now + (o.delay ?? 0) + Math.random() * 0.5 : 0,
      );
      d.u = c[0] * p;
      d.h = (c[1] + 0.5) * p;
      b.dots.push(d);
    });
    if (!o.assemble) b.settle();
    this.bodies.push(b);
    return b;
  }

  /** Мысль рассыпается на точки и улетает в помощника. */
  absorb(dots: Dot[], body: Body, done?: () => void): void {
    const now = performance.now() / 1000;
    dots.forEach((d, i) => {
      d.into = body;
      d.wake = now + i * 0.004;
      d.m = 0.5 + Math.random() * 0.4;
    });
    this.absorbs.push({ dots, fired: false, ...(done ? { done } : {}) });
  }

  frame(t: number, dt: number): void {
    if (!this.on || !this.ctx) return;
    const L = loop();
    if (L.lite && !L.reduced && dt > 0) {
      this.skip = !this.skip;
      if (this.skip) {
        this.owed += dt;
        return;
      }
      dt += this.owed;
      this.owed = 0;
    }
    // страница могла сдвинуться без прокрутки (исчезла карточка выше) — пока палец рядом,
    // уточняем место холста, иначе точки убегали бы от пальца «не там»
    const ms = performance.now();
    if (ms - pointer.t < 900 && ms - this.boxT > 120) {
      this.boxT = ms;
      this.onScroll();
    }
    const ctx = this.ctx;
    const tg = target();
    const tx = tg.x - this.box.x;
    const ty = tg.y - this.box.y;
    for (const b of this.bodies) {
      b.breath = L.reduced || L.lite ? 0 : Math.sin(t * 1.7 + b.phase) * 0.014;
      if (t > b.nextBlink) {
        b.blink = t + 0.12;
        b.nextBlink = t + 2.2 + Math.random() * 4;
      }
      if (t - b.aimT > 0.06) {
        b.aimT = t;
        const e = b.point(0, (b.K.eyes[0]?.[1] ?? 0) * b.p);
        const dx = tx - e.x;
        const dy = ty - e.y;
        const dd = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, dd / 220);
        if (b.away) {
          L.to(b.lx, -Math.sign(dx || 1));
          L.to(b.ly, -0.3);
          L.to(b.lean, -Math.sign(dx || 1) * b.K.lean * 0.6);
        } else {
          L.to(b.lx, (dx / dd) * k);
          L.to(b.ly, (dy / dd) * k);
          L.to(b.lean, Math.max(-1, Math.min(1, dx / 520)) * b.K.lean * (tg.focus ? 1 : 0.35));
        }
      }
      for (const d of b.dots) {
        if (d.into) continue;
        const q = b.point(d.u ?? 0, d.h ?? 0);
        d.hx = q.x;
        d.hy = q.y;
      }
    }
    const now = performance.now() / 1000;
    const px = pointer.x - this.box.x;
    const py = pointer.y - this.box.y;
    const R = this.repel;
    const pAct = R > 0 && !L.lite && performance.now() - pointer.t < 900;
    const steps = 2;
    const h = (Math.min(dt, 0.04) * L.tempo) / steps;
    for (const d of this.dots) {
      if (!d.alive || now < d.wake) continue;
      if (d.rt != null) {
        d.r += (d.rt - d.r) * Math.min(1, dt * 9);
        if (Math.abs(d.rt - d.r) < 0.01) {
          d.r = d.rt;
          d.rt = null;
        }
      }
      let hx = d.hx;
      let hy = d.hy;
      if (d.into) {
        const head = d.into.point(0, (d.into.K.eyes[0]?.[1] ?? 0) * d.into.p);
        hx = head.x;
        hy = head.y;
        if (Math.abs(d.x - hx) + Math.abs(d.y - hy) < 10) {
          d.alive = false;
          this.dead = true;
          continue;
        }
      }
      if (L.reduced) {
        d.x = hx;
        d.y = hy;
        continue;
      }
      for (let s = 0; s < steps; s++) {
        let ax = (-MATERIAL.stiffness * (d.x - hx) - MATERIAL.damping * d.vx) / d.m;
        let ay = (-MATERIAL.stiffness * (d.y - hy) - MATERIAL.damping * d.vy) / d.m;
        if (pAct) {
          const ex = d.x - px;
          const ey = d.y - py;
          const e2 = ex * ex + ey * ey;
          if (e2 < R * R) {
            const el = Math.sqrt(e2) || 1;
            const f = (((R - el) / R) * 5200) / d.m;
            ax += (ex / el) * f;
            ay += (ey / el) * f;
          }
        }
        d.vx += ax * h;
        d.vy += ay * h;
        d.x += d.vx * h;
        d.y += d.vy * h;
      }
    }
    this.absorbs = this.absorbs.filter((a) => {
      const left = a.dots.some((d) => d.alive);
      if (!left && !a.fired) {
        a.fired = true;
        a.done?.();
      }
      return left;
    });
    if (this.dead) {
      this.dots = this.dots.filter((d) => d.alive);
      this.dead = false;
      this.dirtyColors = true;
    }
    if (this.dirtyColors) {
      this.dirtyColors = false;
      this.byColor.clear();
      for (const d of this.dots) {
        const list = this.byColor.get(d.c);
        if (list) list.push(d);
        else this.byColor.set(d.c, [d]);
      }
    }
    /* рисуем: по одному пути на цвет */
    ctx.clearRect(0, 0, this.W, this.H);
    this.byColor.forEach((list, color) => {
      ctx.beginPath();
      for (const q of list) {
        if (!q.alive || now < q.wake || q.r <= 0) continue;
        blob(ctx, q.x, q.y, q.r * dotLook.size);
      }
      ctx.fillStyle = color;
      ctx.fill();
    });
    for (const b of this.bodies) this.face(ctx, b, t);
  }

  private face(ctx: CanvasRenderingContext2D, b: Body, t: number): void {
    const p = b.p;
    const K = b.K;
    const g = this.ground;
    const Lc = this.light;
    const shut = b.mood === 'shut' || (b.mood === 'happy' && b.kind === 'elik');
    const blink = t < b.blink;
    for (const e of K.eyes) {
      const q = b.point(e[0] * p, e[1] * p);
      ctx.fillStyle = g;
      if (shut) {
        ctx.beginPath();
        ctx.lineWidth = p * 0.42;
        ctx.strokeStyle = g;
        ctx.lineCap = 'round';
        ctx.arc(q.x, q.y + p * 0.35, p * 0.75, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        continue;
      }
      ctx.beginPath();
      blob(ctx, q.x, q.y, p, blink ? p * 0.18 : p);
      ctx.fill();
      if (!blink) {
        ctx.fillStyle = b.color === Lc ? '#ff9852' : Lc;
        ctx.beginPath();
        blob(ctx, q.x + b.lx.x * p * 0.42, q.y + b.ly.x * p * 0.42, p * 0.44);
        ctx.fill();
      }
    }
    if (K.glasses) {
      ctx.strokeStyle = g;
      ctx.lineWidth = p * 0.34;
      for (const e of K.eyes) {
        const q = b.point(e[0] * p, e[1] * p);
        ctx.beginPath();
        blob(ctx, q.x, q.y, K.glasses * p);
        ctx.stroke();
      }
    }
    ctx.fillStyle = g;
    if (K.mouth != null && b.mood !== 'shut') {
      const pts: [number, number][] =
        b.mood === 'happy'
          ? [
              [-1.3, 0.45],
              [-0.45, 0],
              [0.45, 0],
              [1.3, 0.45],
            ]
          : b.mood === 'sad'
            ? [
                [-1.1, -0.3],
                [0, 0.1],
                [1.1, -0.3],
              ]
            : [
                [-0.5, 0],
                [0.5, 0],
              ];
      for (const m of pts) {
        const q = b.point(m[0] * p, (K.mouth + m[1]) * p);
        ctx.beginPath();
        blob(ctx, q.x, q.y, p * 0.4 * dotLook.size);
        ctx.fill();
      }
    }
    if (K.beak != null) {
      const tilt = b.mood === 'happy' ? -0.35 : b.mood === 'sad' ? 0.35 : 0;
      for (let k = 0; k < 7; k++) {
        const q = b.point((0.4 + k) * p, (K.beak - tilt * k) * p);
        ctx.fillStyle = k < 3 ? g : Lc;
        ctx.beginPath();
        blob(ctx, q.x, q.y, p * (k < 3 ? 0.42 : 0.36) * dotLook.size);
        ctx.fill();
      }
    }
  }
}
