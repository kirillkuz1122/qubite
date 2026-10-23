/**
 * Сцены лендинга на холстах с точками — перенос landing.html на движок @qubite/ui.
 * Каждая сцена получает холст и палитру, возвращает остановку. Всё движется в общем цикле
 * (@qubite/motion): точки — пружины, помощники — тела из точек.
 */
import { loop } from '@qubite/motion';
import {
  DotEngine,
  textCells,
  type Body,
  type CompanionKind,
  type Dot,
  type Palette,
} from '@qubite/ui';

const FONT = 'Qubite Tiny5';
const COL: Record<CompanionKind, keyof Palette> = {
  elik: 'yellow',
  proto: 'ink',
  neit: 'sky',
  foti: 'orange',
};
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Попал ли палец в помощника. */
function hit(b: Body, px: number, py: number, below = true): boolean {
  const q = b.point(0, b.hPx / 2);
  return below
    ? Math.abs(px - q.x) < b.p * 6 && py < b.y && py > b.y - b.hPx * 1.05
    : Math.abs(px - q.x) < b.p * 6 && Math.abs(py - q.y) < b.hPx * 0.6;
}

export interface Scroll {
  y: number;
}

/* ---------------------------------------------------------------- первый экран */

export interface HeroApi {
  /** мысль из строки рассыпается на точки и улетает в Элика */
  catchThought(text: string, from: { x: number; y: number }, done: () => void): void;
  /** помощники закрывают глаза (в строке пишут пароль) */
  shy(on: boolean): void;
  stop(): void;
}

export function hero(
  cv: HTMLCanvasElement,
  P: Palette,
  scroll: Scroll,
  el: { copy: HTMLElement; legend: HTMLElement },
): HeroApi {
  const L = loop();
  const eng = new DotEngine(cv, { ground: P.bg, light: P.ink, repel: 64 });
  const W = eng.W;
  const H = eng.H;
  const phone = W < 760;
  const HEAD = 'МЫСЛЬ —\nЭТО ТОЧКА';
  const lft = phone ? 16 : Math.max(16, Math.min(80, W * 0.055));
  const cols = textCells(HEAD, FONT, 8).cols;
  /* +3 клетки — место для оранжевой точки-мысли в конце фразы */
  const hp = phone ? Math.min(9, (W - 32) / (cols + 3)) : Math.min(15, (W * 0.48) / cols);
  const top = phone ? 82 : Math.max(120, H * 0.16);
  const head = eng.text(HEAD, {
    x: lft,
    y: top,
    pitch: hp,
    color: P.ink,
    assemble: true,
    delay: 0.1,
    r: 0.46,
    lineRows: 8,
  });
  el.copy.style.top = `${top + head.height + (phone ? 14 : 30)}px`;
  let lastRow = 0;
  let lastCol = 0;
  head.dots.forEach((d) => {
    const c = d.cell ?? [0, 0];
    if (c[1] > lastRow) {
      lastRow = c[1];
      lastCol = 0;
    }
    if (c[1] === lastRow) lastCol = Math.max(lastCol, c[0]);
  });
  const thought = eng.dot(
    lft + (lastCol + 3) * hp,
    top + (lastRow - 0.5) * hp,
    P.orange,
    hp * 0.95,
    [W * 0.9, H * 0.2],
  );
  thought.wake = performance.now() / 1000 + 1.4;

  /* помощники: сзади Прото и Нейт, спереди Фоти и Элик */
  const bp = phone ? 9 : Math.min(12, H / 75);
  const baseY = H - (phone ? 30 : Math.max(70, H * 0.1));
  let cx = phone ? W * 0.52 : Math.max(W * 0.72, lft + 560 + 17 * bp);
  cx = Math.round(cx / bp) * bp;
  const mk = (k: CompanionKind, dx: number, delay: number) =>
    eng.body(k, { x: cx + dx * bp, y: baseY, pitch: bp, color: P[COL[k]], assemble: true, delay });
  const proto = mk('proto', 0.5, 0.5);
  const neit = mk('neit', 12.5, 0.6);
  const foti = mk('foti', -8, 0.7);
  const elik = mk('elik', 4, 0.8);
  const crew = [proto, neit, foti, elik];
  for (let x = cx - 22 * bp; x < Math.min(W, cx + 24 * bp); x += bp)
    eng.dot(x, baseY + bp * 0.9, P.faint, bp * 0.22);
  if (!phone) {
    el.legend.style.left = `${cx - 21 * bp}px`;
    el.legend.style.top = `${baseY + bp * 2.4}px`;
  }

  /* прокрутка: заголовок рассыпается вверх, строка уходит */
  const base = head.dots.map((d) => ({
    bx: d.hx,
    by: d.hy,
    nx: (Math.random() - 0.5) * 2,
    ny: -0.4 - Math.random(),
  }));
  let lastP = -1;
  const stopTick = L.tick((t) => {
    thought.r = hp * (0.95 + Math.sin(t * 3) * 0.08);
    const p = clamp(scroll.y / (H * 0.9), 0, 1);
    if (Math.abs(p - lastP) < 0.002) return;
    lastP = p;
    const e = p * p * 160;
    head.dots.forEach((d, i) => {
      const b = base[i];
      if (!b) return;
      d.hx = b.bx + b.nx * e;
      d.hy = b.by + b.ny * e;
    });
    el.copy.style.opacity = (1 - p * 1.4).toFixed(3);
    el.copy.style.transform = `translateY(${(-p * 40).toFixed(1)}px)`;
  });

  const down = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    crew
      .slice()
      .reverse()
      .some((b) => hit(b, px, py) && (b.jump(340).setMood('happy', 1400), true));
  };
  cv.addEventListener('pointerdown', down);

  return {
    catchThought(text, from, done) {
      const r = cv.getBoundingClientRect();
      const g = eng.text(text.slice(0, 40), {
        x: from.x - r.left,
        y: from.y - r.top + 8,
        pitch: phone ? 2.4 : 3,
        color: P.yellow,
        r: 0.42,
      });
      setTimeout(() => {
        crew.forEach((b) => b.setMood('happy', 1500));
        eng.absorb(g.dots, elik, () => {
          elik.jump(480);
          done();
        });
      }, 260);
    },
    shy(on) {
      crew.forEach((b) => b.turnAway(on));
    },
    stop() {
      stopTick();
      cv.removeEventListener('pointerdown', down);
      eng.destroy();
    },
  };
}

/* ---------------------------------------------------------------- история «Как устроено» */

interface Target {
  x: number;
  y: number;
  c: string;
  r: number;
  drift?: boolean;
  orbit?: Orbit;
}
interface Orbit {
  cx: number;
  cy: number;
  a: number;
  b: number;
  tilt: number;
  th: number;
  w: number;
}
interface Build {
  t: Target[];
  who?: CompanionKind;
  shy?: boolean;
  atom?: { cx: number; cy: number; R: number };
}

export function story(
  cv: HTMLCanvasElement,
  pal: () => Palette,
  section: HTMLElement,
  scroll: Scroll,
  onStep: (step: number) => void,
): () => void {
  const L = loop();
  const P0 = pal();
  const eng = new DotEngine(cv, { ground: P0.bg, light: P0.ink, repel: 40 });
  const W = eng.W;
  const H = eng.H;
  const phone = W < 760;
  const Z = phone
    ? { x: 18, y: 76, w: W - 36, h: H - 76 - 300 }
    : { x: W * 0.44, y: H * 0.15, w: W * 0.5, h: H * 0.7 };
  const bp = phone ? 4.4 : Math.max(5.5, Math.min(8, H / 100));
  /* место под помощника справа */
  const V = { x: Z.x, y: Z.y, w: Z.w - (phone ? 12 : 16) * bp, h: Z.h };
  const spot = { x: Z.x + Z.w - (phone ? 5 : 6) * bp, y: Z.y + Z.h };
  const N = phone ? 760 : 1100;
  const pool: Dot[] = [];
  for (let i = 0; i < N; i++)
    pool.push(eng.dot(Z.x + Math.random() * Z.w, Z.y + Math.random() * Z.h, P0.ink, 0));
  /* у каждой точки — куда ей дальше, «дрейф» на месте и орбита */
  const next: ({ x: number; y: number; c: string; r: number; at: number } | null)[] = pool.map(
    () => null,
  );
  const drift: ({ bx: number; by: number; f: number; ph: number; a: number } | null)[] = pool.map(
    () => null,
  );
  const orbit: (Orbit | null)[] = pool.map(() => null);
  const crew = {} as Record<CompanionKind, Body>;
  (Object.keys(COL) as CompanionKind[]).forEach((k) => {
    const b = eng.body(k, { x: spot.x, y: spot.y, pitch: bp, color: P0[COL[k]] });
    L.set(b.lift, -H);
    b.settle();
    crew[k] = b;
  });

  const line = (
    t: Target[],
    x0: number,
    y: number,
    len: number,
    p: number,
    c: string,
    r: number,
  ) => {
    for (let x = x0; x <= x0 + len; x += p) t.push({ x, y, c, r });
  };
  const textDots = (
    t: Target[],
    str: string,
    x: number,
    y: number,
    p: number,
    c: string,
    r = 0.42,
  ) => {
    const tc = textCells(str, FONT);
    tc.cells.forEach((cl) =>
      t.push({ x: x + (cl[0] + 0.5) * p, y: y + (cl[1] + 0.5) * p, c, r: p * r }),
    );
    return tc.cols * p;
  };

  const BUILD: (() => Build)[] = [
    /* 0 — облако мыслей */
    () => {
      const P = pal();
      const t: Target[] = [];
      const n = Math.round(N * 0.62);
      const cx = V.x + V.w / 2;
      const cy = V.y + V.h / 2;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random());
        const k = Math.random();
        t.push({
          x: cx + Math.cos(a) * rr * V.w * 0.5,
          y: cy + Math.sin(a) * rr * V.h * 0.46,
          drift: true,
          c:
            k < 0.16 ? P.yellow : k < 0.22 ? P.sky : k < 0.26 ? P.orange : k < 0.6 ? P.mute : P.ink,
          r: k < 0.26 ? rnd(2.4, 4.2) : rnd(1.1, 2.8),
        });
      }
      return { t };
    },
    /* 1 — «Входящие»: строки мыслей */
    () => {
      const P = pal();
      const t: Target[] = [];
      const rows = 5;
      const p = phone ? 5 : 7;
      const rh = V.h / (rows + 0.3);
      for (let r = 0; r < rows; r++) {
        const y = V.y + rh * (r + 0.55);
        t.push({ x: V.x + p, y: y + p * 0.3, c: P.yellow, r: p * 0.85 });
        line(t, V.x + p * 3.4, y, V.w * rnd(0.42, 0.72), p, P.ink, p * 0.33);
        line(t, V.x + p * 3.4, y + p * 1.5, V.w * rnd(0.18, 0.34), p * 0.85, P.dim, p * 0.24);
        line(t, V.x + V.w - p * 4, y, p * 2, p, P.dim, p * 0.24);
      }
      return { t, who: 'elik' };
    },
    /* 2 — неделя: дни столбиками, дела — блоки по часам, «сейчас» — оранжевая линия */
    () => {
      const P = pal();
      const t: Target[] = [];
      const cw = V.w / 7;
      const p = Math.sqrt((0.256 * V.w * V.h) / (N * 0.6));
      const today = 4;
      const now = 16.6;
      const DAYS = phone
        ? ['П', 'В', 'С', 'Ч', 'П', 'С', 'В']
        : ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
      const EV: [number, number, keyof Palette][][] = [
        [
          [9, 1.5, 'sky'],
          [15, 1, 'green'],
          [19, 1, 'peach'],
        ],
        [
          [8.5, 2, 'sky'],
          [16, 1.5, 'orange'],
        ],
        [
          [10, 1, 'green'],
          [14, 2, 'orange'],
          [20, 1, 'peach'],
        ],
        [
          [9, 1.5, 'sky'],
          [17, 2.5, 'orange'],
        ],
        [
          [8, 1, 'green'],
          [11, 1, 'green'],
          [16, 1.5, 'orange'],
          [18.5, 1, 'sky'],
          [20.5, 1, 'peach'],
        ],
        [[11, 3, 'peach']],
        [
          [12, 1, 'sky'],
          [18, 1.5, 'orange'],
        ],
      ];
      const lp = phone ? 2.9 : 3.4;
      const top = V.y + lp * 12;
      const hh = (V.y + V.h - top) / 14.5;
      const yAt = (h: number) => top + (h - 8) * hh;
      for (let d = 0; d < 7; d++) {
        const x0 = V.x + d * cw;
        const m = Math.max(2, Math.floor((cw - p * 1.2) / p));
        const tw = textCells(DAYS[d]!, FONT).cols * lp;
        textDots(t, DAYS[d]!, x0 + (m * p - tw) / 2, V.y, lp, d === today ? P.orange : P.mute, 0.5);
        for (let k = 0; k < m; k++)
          t.push({ x: x0 + p * 0.5 + k * p, y: top - p * 0.4, c: P.faint, r: p * 0.16 });
        EV[d]!.forEach(([h0, len, color]) => {
          const y0 = yAt(h0) + p * 0.5;
          const rows = Math.max(1, Math.round((len * hh) / p) - 1);
          const done = d === today && h0 + len < now;
          for (let r = 0; r < rows; r++)
            for (let k = 0; k < m; k++)
              t.push({
                x: x0 + p * 0.5 + k * p,
                y: y0 + r * p,
                c: P[done ? 'green' : color],
                r: p * (done ? 0.3 : 0.38),
              });
        });
        /* редкая сетка часов — бледные точки */
        for (let h = 8; h <= 22; h += 2)
          t.push({ x: x0 + p * 0.5, y: yAt(h), c: P.line, r: p * 0.16 });
      }
      /* рамка «сегодня» из бледных точек */
      const fx0 = V.x + today * cw - p * 0.2;
      const fx1 = fx0 + cw - p * 0.6;
      const fy0 = V.y - p;
      const fy1 = V.y + V.h + p * 0.4;
      for (let fx = fx0; fx <= fx1; fx += p * 0.8) {
        t.push({ x: fx, y: fy0, c: P.faint, r: p * 0.18 });
        t.push({ x: fx, y: fy1, c: P.faint, r: p * 0.18 });
      }
      for (let fy = fy0 + p * 0.8; fy < fy1; fy += p * 0.8) {
        t.push({ x: fx0, y: fy, c: P.faint, r: p * 0.18 });
        t.push({ x: fx1, y: fy, c: P.faint, r: p * 0.18 });
      }
      /* «сейчас» поперёк сегодняшнего дня */
      const nx0 = V.x + today * cw - p * 0.6;
      const ny = yAt(now);
      t.push({ x: nx0, y: ny, c: P.orange, r: p * 0.62 });
      for (let x = nx0 + p; x < nx0 + cw; x += p * 0.8)
        t.push({ x, y: ny, c: P.orange, r: p * 0.2 });
      return { t, who: 'proto' };
    },
    /* 3 — страница конспекта: строки, список и парабола «от руки» */
    () => {
      const P = pal();
      const t: Target[] = [];
      const p = Math.max(phone ? 4.6 : 6.4, V.w / 80);
      const x0 = V.x + (phone ? 0 : V.w * 0.04);
      const w = phone ? V.w : V.w * 0.86;
      const y0 = V.y;
      const h = V.h;
      for (let x = x0; x <= x0 + w; x += p) {
        t.push({ x, y: y0, c: P.faint, r: p * 0.2 });
        t.push({ x, y: y0 + h, c: P.faint, r: p * 0.2 });
      }
      for (let y = y0 + p; y < y0 + h; y += p) {
        t.push({ x: x0, y, c: P.faint, r: p * 0.2 });
        t.push({ x: x0 + w, y, c: P.faint, r: p * 0.2 });
      }
      const ix = x0 + p * 2.4;
      const iw = w - p * 4.8;
      line(t, ix, y0 + p * 3, iw * 0.55, p * 0.8, P.ink, p * 0.42);
      line(t, ix, y0 + p * 5.6, iw * 0.9, p * 0.85, P.mute, p * 0.24);
      line(t, ix, y0 + p * 7.2, iw * 0.7, p * 0.85, P.mute, p * 0.24);
      [0, 1].forEach((k) => {
        const yy = y0 + p * (9.8 + k * 2.4);
        t.push({ x: ix + p * 0.4, y: yy, c: k ? P.dim : P.green, r: p * 0.5 });
        line(t, ix + p * 2, yy, iw * (k ? 0.36 : 0.5), p * 0.85, k ? P.mute : P.dim, p * 0.24);
      });
      const gx = ix + iw * 0.08;
      const gy = y0 + h - p * 2.4;
      const gw = iw * 0.62;
      const gh = h - p * 16.5;
      line(t, gx - gw * 0.1, gy, gw * 1.2, p * 0.8, P.dim, p * 0.2);
      for (let yy = gy; yy > gy - gh; yy -= p * 0.8)
        t.push({ x: gx + gw / 2, y: yy, c: P.dim, r: p * 0.2 });
      for (let u = -1; u <= 1.0001; u += 0.045)
        t.push({
          x: gx + gw / 2 + (u * gw) / 2 + Math.sin(u * 9) * 1.2,
          y: gy - u * u * gh * 0.92 - 2,
          c: P.sky,
          r: p * 0.36,
        });
      textDots(t, 'Y=X²', gx + gw * 0.92, gy - gh * 0.95, phone ? 2.4 : 3, P.sky, 0.46);
      return { t, who: 'neit' };
    },
    /* 4 — личное: сердце из тёплых точек */
    () => {
      const P = pal();
      const t: Target[] = [];
      const size = Math.min(V.w, V.h) * 0.92;
      const p = Math.sqrt((0.55 * size * size) / (N * 0.6));
      const cx = V.x + V.w / 2;
      const cy = V.y + V.h * 0.47;
      for (let y = cy - size / 2; y <= cy + size / 2; y += p)
        for (let x = cx - size / 2; x <= cx + size / 2; x += p) {
          const u = (x - cx) / (size * 0.42);
          const v = -(y - cy) / (size * 0.42) + 0.15;
          const f = Math.pow(u * u + v * v - 1, 3) - u * u * v * v * v;
          if (f <= 0)
            t.push({ x, y, c: f > -0.06 ? P.orange : P.peach, r: p * (f > -0.06 ? 0.4 : 0.34) });
        }
      return { t, who: 'foti', shy: true };
    },
    /* 5 — атом: ядро и орбиты, помощники вокруг */
    () => {
      const P = pal();
      const t: Target[] = [];
      const cx = Z.x + Z.w * 0.5;
      const cy = Z.y + Z.h * 0.48;
      const R = Math.min(Z.w, Z.h) * 0.42;
      const p = phone ? 4 : 5.5;
      for (let y = -3; y <= 3; y++)
        for (let x = -3; x <= 3; x++)
          if (x * x + y * y <= 10)
            t.push({ x: cx + x * p, y: cy + y * p, c: P.orange, r: p * 0.42 });
      [0, 60, 120].forEach((deg, o) => {
        const n = phone ? 44 : 64;
        for (let k = 0; k < n; k++)
          t.push({
            x: 0,
            y: 0,
            orbit: {
              cx,
              cy,
              a: R,
              b: R * 0.36,
              tilt: (deg * Math.PI) / 180,
              th: (k / n) * Math.PI * 2,
              w: 0.22 + o * 0.05,
            },
            c: P.faint,
            r: p * 0.3,
          });
      });
      return { t, atom: { cx, cy, R } };
    },
  ];

  let stage = -1;
  let drifting: number[] = [];
  let orbiting: number[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  function go(s: number) {
    if (s === stage) return;
    stage = s;
    const B = BUILD[s]!();
    const T = B.t;
    const now = performance.now() / 1000;
    /* «точка → место»: обе стороны по горизонтали, лишние точки гаснут на месте */
    const free = pool.map((_, i) => i).sort((a, b) => pool[a]!.x - pool[b]!.x);
    T.forEach((q) => {
      if (q.orbit) {
        q.x = q.orbit.cx + Math.cos(q.orbit.th) * q.orbit.a;
        q.y = q.orbit.cy + Math.sin(q.orbit.th) * q.orbit.b;
      }
    });
    T.sort((a, b) => a.x - b.x);
    const used = new Set<number>();
    const step = free.length / Math.max(1, T.length);
    drifting = [];
    orbiting = [];
    T.forEach((q, i) => {
      const di = free[Math.min(free.length - 1, Math.floor(i * step))]!;
      used.add(di);
      const delay = L.reduced ? 0 : ((q.x - Z.x) / Z.w) * 0.22 + Math.random() * 0.08;
      next[di] = { x: q.x, y: q.y, c: q.c, r: q.r, at: now + delay };
      drift[di] = q.drift
        ? { bx: q.x, by: q.y, f: rnd(0.4, 0.9), ph: Math.random() * 6, a: rnd(3, 9) }
        : null;
      orbit[di] = q.orbit ?? null;
      if (q.drift) drifting.push(di);
      if (q.orbit) orbiting.push(di);
    });
    pool.forEach((d, i) => {
      if (used.has(i)) return;
      next[i] = null;
      drift[i] = null;
      orbit[i] = null;
      d.rt = 0;
    });
    /* помощники: нужный поднимается на своё место, остальные уходят вниз */
    const kinds = Object.keys(crew) as CompanionKind[];
    kinds.forEach((k) => crew[k].turnAway(false));
    if (B.atom) {
      const A = B.atom;
      const spots: Record<CompanionKind, [number, number]> = {
        elik: [-0.95, -0.55],
        proto: [0.95, -0.5],
        neit: [-0.9, 0.75],
        foti: [0.92, 0.78],
      };
      kinds.forEach((k, i) => {
        const b = crew[k];
        const q = spots[k];
        b.place(A.cx + q[0] * A.R, A.cy + q[1] * A.R * 0.62 + 6 * bp, bp * 0.8);
        timers.push(setTimeout(() => L.to(b.lift, 0), i * 90));
      });
    } else {
      kinds.forEach((k) => {
        const b = crew[k];
        if (k === B.who) {
          if (b.lift.goal !== 0 || b.p !== bp) {
            b.place(spot.x, spot.y, bp);
            L.set(b.lift, -H * 0.5);
            L.to(b.lift, 0);
            timers.push(setTimeout(() => b.jump(300).setMood('happy', 1200), 380));
          }
          if (B.shy) timers.push(setTimeout(() => b.turnAway(true), 500));
        } else L.to(b.lift, -H * 0.8);
      });
    }
    onStep(s);
  }

  let top0 = 0;
  let len = 1;
  const measure = () => {
    const r = section.getBoundingClientRect();
    top0 = r.top + scrollY;
    len = section.offsetHeight - innerHeight;
  };
  measure();
  addEventListener('resize', measure);
  go(0);
  /* шаги применяются с задержкой по горизонтали — перестройка идёт волной слева направо */
  const stopTick = L.tick((t, dt) => {
    go(clamp(Math.floor(((scroll.y - top0) / len) * 6), 0, 5));
    if (!eng.on) return;
    const now = performance.now() / 1000;
    pool.forEach((d, i) => {
      const n = next[i];
      if (n && now >= n.at) {
        d.hx = n.x;
        d.hy = n.y;
        d.rt = n.r;
        eng.paint(d, n.c);
        next[i] = null;
        const dr = drift[i];
        if (dr) {
          dr.bx = n.x;
          dr.by = n.y;
        }
      }
    });
    drifting.forEach((i) => {
      const q = drift[i];
      const d = pool[i]!;
      if (next[i] || !q) return;
      d.hx = q.bx + Math.sin(t * q.f + q.ph) * q.a;
      d.hy = q.by + Math.cos(t * q.f * 0.8 + q.ph) * q.a * 0.7;
    });
    orbiting.forEach((i) => {
      const o = orbit[i];
      const d = pool[i]!;
      if (next[i] || !o) return;
      o.th += dt * o.w;
      const x = Math.cos(o.th) * o.a;
      const y = Math.sin(o.th) * o.b;
      const c = Math.cos(o.tilt);
      const s = Math.sin(o.tilt);
      d.hx = o.cx + x * c - y * s;
      d.hy = o.cy + x * s + y * c;
    });
  });

  const down = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    (Object.values(crew) as Body[]).some(
      (b) =>
        b.lift.goal === 0 && hit(b, px, py, false) && (b.jump(320).setMood('happy', 1200), true),
    );
  };
  cv.addEventListener('pointerdown', down);

  return () => {
    stopTick();
    timers.forEach(clearTimeout);
    removeEventListener('resize', measure);
    cv.removeEventListener('pointerdown', down);
    eng.destroy();
  };
}

/* ---------------------------------------------------------------- помощник в карточке Command */

export interface MiniCrew {
  show(kind: CompanionKind, swap: boolean): void;
  jump(kind: CompanionKind): void;
  stop(): void;
}

export function miniCrew(cv: HTMLCanvasElement, P: Palette): MiniCrew {
  const L = loop();
  const ce = new DotEngine(cv, { ground: P.panel, light: P.ink, repel: 0 });
  const PIT: Record<CompanionKind, number> = { elik: 4.4, proto: 3.1, neit: 3.6, foti: 3.0 };
  const mini = {} as Record<CompanionKind, Body>;
  (Object.keys(COL) as CompanionKind[]).forEach((k) => {
    const b = ce.body(k, {
      x: ce.W / 2 + (k === 'elik' ? -6 : 0),
      y: ce.H - 2,
      pitch: (PIT[k] * ce.W) / 64,
      color: P[COL[k]],
    });
    L.set(b.lift, -120);
    b.settle();
    mini[k] = b;
  });
  const timers: ReturnType<typeof setTimeout>[] = [];
  return {
    show(kind, swap) {
      (Object.keys(mini) as CompanionKind[]).forEach((k) => {
        L.to(mini[k].lift, k === kind ? 0 : -120);
        if (k === kind && swap)
          timers.push(setTimeout(() => mini[k].jump(200).setMood('happy', 900), 200));
      });
    },
    jump(kind) {
      mini[kind].jump(380).setMood('happy', 1400);
    },
    stop() {
      timers.forEach(clearTimeout);
      ce.destroy();
    },
  };
}

/* ---------------------------------------------------------------- учёба: страница Ink дописывается */

export function study(
  cv: HTMLCanvasElement,
  P: Palette,
  section: HTMLElement,
  scroll: Scroll,
  onProgress: (p: number) => void,
): () => void {
  const L = loop();
  const eng = new DotEngine(cv, { ground: P.bg, light: P.ink, repel: 30 });
  const W = eng.W;
  const H = eng.H;
  const phone = W < 760;
  const A = phone
    ? { x: 20, y: 78, w: W - 40, h: H * 0.33 }
    : { x: W * 0.5, y: H * 0.16, w: W * 0.42, h: H * 0.68 };
  const p = phone ? 3.4 : 4.6;
  const wob = (u: number) => Math.sin(u * 23.7) * 0.004 + Math.sin(u * 7.3) * 0.003;
  const axisX: [number, number][] = [];
  const axisY: [number, number][] = [];
  const para: [number, number][] = [];
  const label: [number, number][] = [];
  for (let u = 0; u <= 1; u += 0.01) axisX.push([0.04 + u * 0.62, 0.86 + wob(u)]);
  axisX.push([0.64, 0.84], [0.62, 0.82]);
  for (let v = 0; v <= 1; v += 0.012) axisY.push([0.35 + wob(v + 3), 0.94 - v * 0.86]);
  axisY.push([0.335, 0.105], [0.32, 0.13]);
  for (let x = -1; x <= 1.0001; x += 0.02)
    para.push([0.35 + x * 0.25 + wob(x + 9), 0.86 - x * x * 0.62 + wob(x)]);
  for (let a = 0; a <= 1; a += 0.08) label.push([0.72 + a * 0.03, 0.2 + a * 0.06]);
  for (let b = 0; b <= 1; b += 0.06) label.push([0.79 - b * 0.06, 0.2 + b * 0.14]);
  for (let c = 0; c <= 1; c += 0.12) label.push([0.83 + c * 0.05, 0.245]);
  for (let c = 0; c <= 1; c += 0.12) label.push([0.83 + c * 0.05, 0.275]);
  for (let e = 0; e <= 1; e += 0.1) label.push([0.91 + e * 0.05, 0.22 + e * 0.08]);
  for (let f = 0; f <= 1; f += 0.1) label.push([0.96 - f * 0.05, 0.22 + f * 0.08]);
  for (let g = 0; g <= 1; g += 0.12) {
    const ang = Math.PI * (1.1 - g * 1.25);
    label.push([
      0.985 + Math.cos(ang) * 0.012 + g * 0.006,
      0.19 - Math.sin(ang) * 0.012 + (g > 0.7 ? (g - 0.7) * 0.05 : 0),
    ]);
  }
  for (let h = 0; h <= 1; h += 0.25) label.push([0.98 + h * 0.022, 0.205]);
  const strokes: { pts: [number, number][]; c: keyof Palette }[] = [
    { pts: axisX, c: 'dim' },
    { pts: axisY, c: 'dim' },
    { pts: para, c: 'sky' },
    { pts: label, c: 'ink' },
  ];
  const dots: { d: Dot; full: number }[] = [];
  strokes.forEach((st) => {
    let last: [number, number] | null = null;
    st.pts.forEach((q) => {
      const X = A.x + q[0] * A.w;
      const Y = A.y + q[1] * A.h;
      if (last && Math.hypot(X - last[0], Y - last[1]) < p * 0.9) return;
      last = [X, Y];
      dots.push({ d: eng.dot(X, Y, P[st.c], 0), full: p * (st.c === 'dim' ? 0.32 : 0.46) });
    });
  });
  const pen = eng.dot(A.x, A.y, P.orange, 0);
  let top0 = 0;
  let len = 1;
  let shown = -1;
  const measure = () => {
    const r = section.getBoundingClientRect();
    top0 = r.top + scrollY;
    len = section.offsetHeight - innerHeight;
  };
  measure();
  addEventListener('resize', measure);
  const stopTick = L.tick(() => {
    if (!eng.on) return;
    const pr = clamp((scroll.y - top0 + innerHeight * 0.3) / (len * 0.85), 0, 1);
    const n = Math.round(pr * dots.length);
    if (n === shown) return;
    shown = n;
    dots.forEach(({ d, full }, i) => {
      const on = i < n;
      if (on && d.r === 0 && d.rt == null) d.r = 0.01;
      d.rt = on ? full : 0;
    });
    const tip = dots[Math.max(0, n - 1)]?.d;
    if (tip) {
      pen.hx = tip.hx;
      pen.hy = tip.hy;
    }
    pen.rt = n > 0 && n < dots.length ? p * 0.9 : 0;
    onProgress(pr);
  });
  return () => {
    stopTick();
    removeEventListener('resize', measure);
    eng.destroy();
  };
}

/* ---------------------------------------------------------------- значки принципов */

export const RULE_ICONS = {
  offline: [
    '..#####..',
    '.#.....#.',
    '#..###..#',
    '..#...#..',
    '....#....',
    '.........',
    '....#....',
  ],
  hand: [
    '.#.......',
    '###....##',
    '.#....###',
    '.....###.',
    '....###..',
    '...###...',
    '..###....',
    '.##......',
    '#........',
  ],
  lock: ['...###...', '..#...#..', '..#...#..', '.#######.', '.###.###.', '.###.###.', '.#######.'],
  server: [
    '#########',
    '#.......#',
    '#########',
    '.........',
    '#########',
    '#.......#',
    '#########',
  ],
};
export type RuleIcon = keyof typeof RULE_ICONS;

export function ruleIcon(cv: HTMLCanvasElement, P: Palette, icon: RuleIcon): () => void {
  const eng = new DotEngine(cv, { ground: P.bg, light: P.ink, repel: 18 });
  const p = eng.W / 10;
  const now = performance.now() / 1000;
  RULE_ICONS[icon].forEach((row, j) =>
    row.split('').forEach((ch, i) => {
      if (ch !== '#') return;
      const warm = icon === 'lock' && j > 2;
      const ai = icon === 'hand' && i < 3 && j < 3;
      const d = eng.dot(
        p * (i + 1),
        p * (j + 0.6),
        warm ? P.orange : ai ? P.yellow : P.ink,
        p * 0.4,
        [eng.W / 2 + (Math.random() - 0.5) * eng.W, eng.H + 10],
      );
      d.wake = now + (i + j) * 0.03;
    }),
  );
  return () => eng.destroy();
}

/* ---------------------------------------------------------------- финал */

export function final(cv: HTMLCanvasElement, P: Palette, acts: HTMLElement): () => void {
  const eng = new DotEngine(cv, { ground: P.bg, light: P.ink, repel: 60 });
  const W = eng.W;
  const H = eng.H;
  const phone = W < 760;
  const STR = 'НАЧНИ\nС ОДНОЙ ТОЧКИ';
  const tc = textCells(STR, FONT, 8);
  const p = phone ? Math.min(8, (W - 36) / (tc.cols + 2)) : Math.min(14, (W * 0.62) / tc.cols);
  const x0 = phone ? 18 : (W - tc.cols * p) / 2;
  const y0 = H * (phone ? 0.16 : 0.18);
  const bp = phone ? 6 : 8;
  const base = H - (phone ? 26 : 40);
  const cx = W / 2;
  acts.style.left = phone ? '18px' : `calc(50% - ${acts.offsetWidth / 2}px)`;
  acts.style.top = `${y0 + tc.rows * p + (phone ? 28 : 44)}px`;
  const g = eng.text(STR, {
    x: x0,
    y: y0,
    pitch: p,
    color: P.ink,
    assemble: true,
    r: 0.46,
    lineRows: 8,
  });
  /* точка в конце — та самая мысль */
  const last = g.dots.reduce<Dot | null>((m, d) => {
    if (!m) return d;
    const a = d.cell ?? [0, 0];
    const b = m.cell ?? [0, 0];
    return a[1] > b[1] || (a[1] === b[1] && a[0] > b[0]) ? d : m;
  }, null);
  const lc = last?.cell ?? [0, 0];
  const dot = eng.dot(x0 + (lc[0] + 2.5) * p, y0 + (lc[1] + 0.5) * p, P.orange, p * 0.6, [
    W / 2,
    H,
  ]);
  dot.wake = performance.now() / 1000 + 1.1;
  const order: [CompanionKind, number][] = [
    ['foti', -14],
    ['proto', -4.5],
    ['elik', 3],
    ['neit', 11.5],
  ];
  const crew = order.map(([k, dx], i) =>
    eng.body(k, {
      x: cx + dx * bp,
      y: base,
      pitch: bp,
      color: P[COL[k]],
      assemble: true,
      delay: 0.5 + i * 0.1,
    }),
  );
  for (let x = cx - 22 * bp; x < cx + 20 * bp; x += bp)
    eng.dot(x, base + bp * 0.9, P.faint, bp * 0.22);
  const timers: ReturnType<typeof setTimeout>[] = [];
  timers.push(
    setTimeout(
      () =>
        crew.forEach((b, i) =>
          timers.push(setTimeout(() => b.jump(300).setMood('happy', 1500), i * 120)),
        ),
      1700,
    ),
  );
  return () => {
    timers.forEach(clearTimeout);
    eng.destroy();
  };
}
