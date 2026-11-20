/**
 * Настольный помощник (DESK-001, этап 0): четыре варианта облика и их кадры.
 *
 * Фигура — как у помощников сайта (packages/ui/src/dots/engine.ts): тело из точек по сетке,
 * глаза — тёмные точки со светлым зрачком, рот и клюв — точками. Здесь только «что нарисовать»:
 * список простых примитивов (точка, дуга, многоугольник). Его одинаково рисуют Canvas
 * (paintCanvas — так будет в apps/desktop) и SVG (toSvg — для Figma и скриншотов).
 * Никакой 3D и камеры: всё — круги и дуги.
 *
 * Координаты тела — в клетках от низа-центра, y вверх (как KINDS в engine.ts).
 */

/* Цвета — значения токенов тёмной темы (DESIGN_SYSTEM §1.1). В коде будут --q-*. */
export const C = {
  ink: '#f3ede3',
  bg: '#100f0d',
  mute: '#a59c90',
  faint: '#3a3732',
  orange: '#ff9852',
  sky: '#71cfff',
  yellow: '#ffe163',
  green: '#90dea5',
  red: '#f08b85',
  peach: '#ffb98a',
};

/* ---------- формы тела ---------- */

function rounded(w, h, r, top = true, bottom = false) {
  const cells = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = i - (w - 1) / 2;
      let ok = true;
      const corner = (cy) => {
        const cx = i < r ? r - 0.5 : i > w - 1 - r ? w - r - 0.5 : i;
        return Math.hypot(i - cx, j - cy) <= r - 0.05;
      };
      if (top && j >= h - r) ok = corner(h - r - 0.5);
      if (ok && bottom && j < r) ok = corner(r - 0.5);
      if (ok) cells.push([x, j]);
    }
  }
  return cells;
}
/** Круг точек целиком (для значков вокруг фигуры), центр в 0,0. */
function blot(rx, ry = rx) {
  const cells = [];
  for (let j = -Math.ceil(ry); j <= Math.ceil(ry); j++) {
    for (let i = -Math.ceil(rx); i <= Math.ceil(rx); i++) {
      if ((i / (rx + 0.3)) ** 2 + (j / (ry + 0.3)) ** 2 <= 1) cells.push([i, j]);
    }
  }
  return cells;
}
function disc(R, cy, rx = R, ry = R) {
  const cells = [];
  for (let j = Math.floor(cy - ry); j <= Math.ceil(cy + ry); j++) {
    for (let i = -Math.ceil(rx); i <= Math.ceil(rx); i++) {
      if ((i / (rx + 0.3)) ** 2 + ((j - cy) / (ry + 0.3)) ** 2 <= 1 && j >= 0) cells.push([i, j]);
    }
  }
  return cells;
}

/**
 * Варианты. eyes — центры глаз, mouth — высота рта, h — высота тела в клетках.
 * mass/damping — характер пружины (D-180): тяжелее — ленивее, меньше вязкость — больше качается.
 */
export const LOOKS = {
  muon: {
    name: 'Мюон',
    color: C.peach,
    h: 10,
    cells: () => {
      const b = rounded(11, 10, 3);
      // уши: треугольники из точек над макушкой
      for (const s of [-1, 1]) {
        b.push([s * 4, 10], [s * 3, 10], [s * 2, 10], [s * 4, 11], [s * 3, 11], [s * 4, 12]);
      }
      return b;
    },
    // хвост — отдельной цепочкой, чтобы им махать
    tail: [
      [6, 1],
      [7, 1.6],
      [7.8, 2.5],
      [8.2, 3.6],
      [8.1, 4.7],
      [7.6, 5.6],
    ],
    eyes: [
      [-2.2, 6.4],
      [2.2, 6.4],
    ],
    mouth: 4.3,
    nose: true,
    mass: 1.6,
    damping: 18,
  },
  bozon: {
    name: 'Бозон',
    color: C.green,
    h: 12,
    cells: () => disc(6, 5.6),
    eyes: [
      [-2.1, 7],
      [2.1, 7],
    ],
    mouth: 4.4,
    antenna: true,
    mass: 1.4,
    damping: 22,
  },
  gluon: {
    name: 'Глюон',
    color: C.sky,
    h: 11,
    cells: () => {
      const b = rounded(11, 11, 4);
      // «подол» желе: нижний ряд шире на клетку с каждой стороны
      b.push([-6, 0], [6, 0], [-6, 1], [6, 1]);
      return b;
    },
    eyes: [
      [-2.3, 6.6],
      [2.3, 6.6],
    ],
    mouth: 4,
    mass: 2.0,
    damping: 11,
  },
  homka: {
    name: 'Хомка',
    color: C.yellow,
    h: 11,
    cells: () => {
      const b = disc(6.5, 5, 7.2, 5.2);
      for (const s of [-1, 1]) b.push([s * 4, 10], [s * 5, 10], [s * 4.5, 10.8]);
      return b;
    },
    eyes: [
      [-2.6, 6.6],
      [2.6, 6.6],
    ],
    mouth: 4.6,
    cheeks: true,
    mass: 2.4,
    damping: 21,
  },
  kyubi: {
    name: 'Кьюби',
    color: C.orange,
    h: 12,
    cells: () => disc(5.5, 6.5),
    eyes: [
      [-2, 8.3],
      [2, 8.3],
    ],
    mouth: 6.1,
    // кубит: кольцо-экватор сферы Блоха и стрелка-состояние |ψ⟩; в «думает» — суперпозиция
    bloch: true,
    superpose: true,
    topExtra: 3,
    mass: 1.8,
    damping: 19,
  },
  utya: {
    name: 'Утя',
    color: C.yellow,
    h: 12,
    // уточка в профиль, смотрит вправо; клюв открывается, когда она говорит, радуется или зевает
    cells: (F) => {
      const open = F && ['grin', 'yawn', 'o-small'].includes(F.mouth);
      const rows = open
        ? ['........yyyy...', '.......yyyyyyoo', '.......yyyyyy..', '.......yyyyyy..', '.......yyyyyooo', 'y.....yyyyyy...', 'yy.yyyyyyyyyy..', 'yyyyyyyyyyyyyy.', 'yyyyywwwwyyyyy.', '.yyyyyywwwyyyy.', '..yyyyyyyyyyy..', '....yyyyyyy....']
        : ['........yyyy...', '.......yyyyyy..', '.......yyyyyyoo', '.......yyyyyooo', '........yyyyy..', 'y.....yyyyyy...', 'yy.yyyyyyyyyy..', 'yyyyyyyyyyyyyy.', 'yyyyywwwwyyyyy.', '.yyyyyywwwyyyy.', '..yyyyyyyyyyy..', '....yyyyyyy....'];
      const col = { y: null, o: C.orange, w: C.peach };
      const cells = [];
      rows.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && cells.push([i - 7, rows.length - 1 - j, col[ch]])));
      return cells;
    },
    eyes: [[3, 9.4]],
    mouth: null,
    mass: 1.5,
    damping: 16,
  },
};

/* ---------- позы и кадры ---------- */

/**
 * Кадр = поза тела + лицо + предметы вокруг.
 * sx, sy — сжатие/растяжение; lean — сдвиг макушки в клетках (изгиб от основания, главный приём
 * COMPANIONS.md); dy — подскок; look — куда смотрят зрачки (-1…1); alpha — прозрачность.
 */
export const FRAMES = [
  // состояния
  { id: 'sleep', title: 'Спит', group: 'state', sy: 0.88, sx: 1.06, eyes: 'sleep', mouth: 'flat', props: ['zzz'] },
  { id: 'listen', title: 'Слушает', group: 'state', lean: 1.2, eyes: 'wide', look: [0.5, -0.3], mouth: 'o-small', props: ['waves'] },
  { id: 'think', title: 'Думает', group: 'state', lean: -0.6, eyes: 'open', look: [0.6, -0.8], mouth: 'side', props: ['thought'] },
  { id: 'doing', title: 'Делает', group: 'state', lean: 0.8, sy: 0.96, eyes: 'focus', look: [0.7, 0.4], mouth: 'flat', props: ['spinner'] },
  { id: 'confirm', title: 'Ждёт «Да»', group: 'state', lean: 1.6, eyes: 'open', look: [0.8, -0.6], mouth: 'smile-small', props: ['ask'] },
  { id: 'error', title: 'Ошибка', group: 'state', sy: 0.9, sx: 1.04, eyes: 'open', look: [0, 0.6], mouth: 'sad', props: ['bang'] },
  // настроения
  { id: 'quiet', title: 'Тихо в углу', group: 'mood', scale: 0.62, alpha: 0.6, eyes: 'half', look: [-0.8, -0.7], mouth: 'flat', props: ['corner'] },
  { id: 'play', title: 'Играет', group: 'mood', lean: 2.4, dy: 2.2, sy: 1.06, sx: 0.95, eyes: 'open', look: [1, -0.7], mouth: 'grin', props: ['cursor', 'dust'] },
  { id: 'joy', title: 'Радость', group: 'mood', dy: 1.4, sy: 1.08, sx: 0.95, eyes: 'happy', mouth: 'grin', props: ['sun'] },
  { id: 'sad', title: 'Грусть', group: 'mood', sy: 0.86, sx: 1.07, lean: -0.4, eyes: 'open', look: [0, 0.9], mouth: 'sad', props: ['rain'] },
  { id: 'hurt', title: 'Обида', group: 'mood', sx: 0.92, lean: -1.2, eyes: 'cross', look: [-1, 0.2], mouth: 'pout', props: ['vein'] },
  { id: 'yawn', title: 'Зевает · 01:00', group: 'mood', sy: 1.04, eyes: 'squint', mouth: 'yawn', props: ['moon'] },
  { id: 'stretch', title: 'Потягивается', group: 'mood', sy: 1.24, sx: 0.84, eyes: 'happy', mouth: 'o-small', props: ['tea'] },
  // для сцен на столе: без значков вокруг
  { id: 'idle', title: 'Покой', group: 'extra', eyes: 'open', look: [0.6, -0.5], mouth: 'smile-small' },
  { id: 'tuck', title: 'Тихо (без окна)', group: 'extra', alpha: 0.6, eyes: 'half', look: [-0.8, -0.7], mouth: 'flat' },
];

/* ---------- сборка примитивов ---------- */

const DOT = 0.44; // радиус точки тела в долях шага

/**
 * Собрать список примитивов кадра.
 * @returns {{w:number,h:number,ops:Array}} размеры холста в px и что рисовать
 */
export function frame(lookId, frameId, { pitch = 8, cols = 26, rows = 26, t = 0, over = null } = {}) {
  const L = LOOKS[lookId];
  // over — поправки на лету (дыхание, взгляд за курсором, наклон при беге)
  const F = { ...(FRAMES.find((f) => f.id === frameId) ?? FRAMES[0]), ...(over ?? {}) };
  if (L.superpose && F.id === 'think' && !F.inner) {
    // суперпозиция: два полупрозрачных Кьюби со стрелками в разные стороны, между ними — «или»
    const opt = { pitch, cols, rows, t };
    const left = frame(lookId, 'think', { ...opt, over: { ...over, inner: true, shift: -6.6, alpha: 0.72, arrow: [-0.5, 1], props: [], lean: 0 } });
    const right = frame(lookId, 'think', { ...opt, over: { ...over, inner: true, shift: 6.6, alpha: 0.72, arrow: [0.5, -1], props: [], lean: 0, look: [-0.6, -0.8] } });
    const mid = [-2, -1, 0, 1, 2].map((k) => ({ k: 'dot', x: (cols * pitch) / 2 + k * pitch * 0.9, y: rows * pitch - 9.7 * pitch, r: pitch * 0.2, color: C.yellow, alpha: 0.7 }));
    return { w: left.w, h: left.h, ops: [...left.ops, ...right.ops, ...mid] };
  }
  const W = cols * pitch;
  const H = rows * pitch;
  const ops = [];
  const scale = F.scale ?? 1;
  const p = pitch * scale;
  const sx = F.sx ?? 1;
  const sy = F.sy ?? 1;
  const lean = F.lean ?? 0;
  const dy = F.dy ?? 0;
  // где стоит фигура: тихий — в правом нижнем углу, остальные — по центру
  const cx = (F.id === 'quiet' ? W - 7 * pitch : F.id === 'play' ? W / 2 - 3 * pitch : W / 2) + (F.shift ?? 0) * pitch;
  const base = H - 3.2 * pitch;
  const a = F.alpha ?? 1;
  const pt = (x, y) => ({
    x: cx + (x * sx + lean * Math.max(0, y) / L.h) * p,
    y: base - (y * sy + dy) * p,
  });
  const dot = (x, y, r, color, alpha = a) =>
    ops.push({ k: 'dot', ...pt(x, y), r: r * p * Math.max(1, sx), ry: r * p * Math.max(1, sy), color, alpha });
  const free = (x, y, r, color, alpha = a) => ops.push({ k: 'dot', x, y, r, color, alpha });

  // тень на полу: три плоские точки — показывает подскок
  if (dy > 0.5) {
    for (let i = -2; i <= 2; i++) free(cx + i * pitch * 1.2, base + pitch * 0.9, pitch * 0.32, C.faint, 0.8 * a);
  }

  if (L.bloch) bloch(dot, F, false, a);
  for (const [x, y, c] of L.cells(F)) dot(x, y, DOT, c ?? L.color);
  if (L.bloch) bloch(dot, F, true, a, t);
  if (L.tail) {
    const wag = F.id === 'play' || F.id === 'joy' ? -0.8 : F.id === 'sad' || F.id === 'hurt' ? 1.4 : 0;
    L.tail.forEach(([x, y], k) => dot(x + (wag * k) / 5, y - (F.id === 'sad' ? k * 0.55 : 0), DOT, L.color));
  }
  if (L.antenna) {
    // антенна-«переносчик»: стебелёк и огонёк; во время дела огонёк светится оранжевым
    dot(0.4, 11.4, 0.3, L.color);
    dot(0.9, 12.2, 0.3, L.color);
    const on = F.id === 'doing' || F.id === 'confirm' || F.id === 'listen';
    dot(1.4, 13.1, 0.62, on ? C.orange : F.id === 'error' ? C.red : C.yellow);
  }
  if (L.cheeks) {
    // щёки-копилки: в «радости» и «потягивается» надуты (туда он складывает запомненное)
    const big = F.id === 'joy' ? 1.25 : 0.95;
    for (const s of [-1, 1]) dot(s * 4.4, 4.6, 0.7 * big, C.orange, 0.75 * a);
  }

  face(ops, L, F, pt, p, a);
  props(ops, L, F, { pt, p, pitch, W, H, cx, base, a, t });
  return { w: W, h: H, ops };
}

/** Куда смотрит стрелка-состояние Кьюби в каждом кадре (вверх — «да», вниз — сон и грусть). */
const ARROW = {
  sleep: [0.9, -0.6], listen: [1, 0.35], doing: null, confirm: [0.8, 1], error: [-0.9, -0.5], quiet: [-0.7, 1],
  play: [1, 0.5], joy: [0, 1], sad: [-0.3, -1], hurt: [-1, 0.15], yawn: [-1, 0.25], stretch: [0, 1], idle: [0.6, 1], tuck: [-0.7, 1],
};

/** Сфера Блоха: задняя половина кольца — до тела, передняя и стрелка — после. */
function bloch(dot, F, front, a, t = 0) {
  const cy = 6.2;
  // у «двойников» суперпозиции кольца нет — иначе две сферы сливаются в кашу
  for (let k = 0; k < (F.inner ? 0 : 28); k++) {
    const ang = (k / 28) * Math.PI * 2;
    const x = Math.cos(ang) * 8.6;
    const y = Math.sin(ang) * 2;
    if ((y < 0) === front) dot(x, cy + y, 0.28, front ? C.ink : C.mute, a * (front ? 1 : 0.45));
  }
  if (!front) return;
  let [ax, ay] = F.arrow ?? ARROW[F.id] ?? [0.6, 1];
  if (F.id === 'doing' && !F.arrow) [ax, ay] = [Math.cos(t * 2 + 1), Math.sin(t * 2 + 1)]; // делает — стрелка крутится
  const len = Math.hypot(ax, ay);
  const n = F.id === 'stretch' ? 8 : 6;
  for (let k = 1; k <= n; k++) {
    const d = 5.5 + k * 0.9;
    const tip = k === n;
    const tipColor = F.id === 'error' ? C.red : F.id === 'listen' || F.id === 'confirm' ? C.orange : C.yellow;
    dot((ax / len) * d, 6.5 + (ay / len) * d, tip ? 0.62 : 0.26, tip ? tipColor : C.ink, a);
  }
}

function face(ops, L, F, pt, p, a) {
  const [lx, ly] = F.look ?? [0, 0];
  for (const [ex, ey] of L.eyes) {
    const q = pt(ex, ey);
    const kind = F.eyes ?? 'open';
    if (kind === 'happy' || kind === 'sleep' || kind === 'squint') {
      // ^ ^ — дуга вверх; спит — дуга вниз; щурится — плоская чёрточка
      const up = kind === 'happy';
      if (kind === 'squint') {
        ops.push({ k: 'line', x1: q.x - p * 0.8, y1: q.y, x2: q.x + p * 0.8, y2: q.y, w: p * 0.42, color: C.bg, alpha: a });
      } else {
        ops.push({
          k: 'arc',
          x: q.x,
          y: q.y + (up ? p * 0.35 : -p * 0.35),
          r: p * 0.78,
          a0: up ? Math.PI * 1.15 : Math.PI * 0.15,
          a1: up ? Math.PI * 1.85 : Math.PI * 0.85,
          w: p * 0.42,
          color: C.bg,
          alpha: a,
        });
      }
      continue;
    }
    if (kind === 'cross') {
      // обида: глаза — «>» «<», смотрит в сторону
      const s = ex < 0 ? 1 : -1;
      ops.push({ k: 'line', x1: q.x - s * p * 0.6, y1: q.y - p * 0.6, x2: q.x + s * p * 0.5, y2: q.y, w: p * 0.4, color: C.bg, alpha: a });
      ops.push({ k: 'line', x1: q.x + s * p * 0.5, y1: q.y, x2: q.x - s * p * 0.6, y2: q.y + p * 0.6, w: p * 0.4, color: C.bg, alpha: a });
      continue;
    }
    const r = kind === 'wide' ? 1.18 : kind === 'focus' ? 0.86 : 1;
    const ry = kind === 'half' ? 0.55 : 1;
    ops.push({ k: 'dot', x: q.x, y: q.y + (kind === 'half' ? p * 0.3 : 0), r: p * r, ry: p * r * ry, color: C.bg, alpha: a });
    ops.push({ k: 'dot', x: q.x + lx * p * 0.42, y: q.y + ly * p * 0.42 + (kind === 'half' ? p * 0.3 : 0), r: p * 0.44 * (kind === 'half' ? 0.8 : 1), color: C.ink, alpha: a });
    if (kind === 'half') {
      // веко: полоска цвета тела по верхней половине глаза
      ops.push({ k: 'dot', x: q.x, y: q.y - p * 0.25, r: p * 1.1, ry: p * 0.48, color: L.color, alpha: a });
    }
  }
  // брови: обида и ошибка
  if (F.id === 'error') {
    for (const [ex, ey] of L.eyes) {
      const s = ex < 0 ? -1 : 1;
      for (let k = 0; k < 3; k++) {
        const dir = F.id === 'hurt' ? 1 : -1; // обида — домиком вниз к носу; ошибка — домиком вверх
        const q = pt(ex + s * (k - 1) * 0.55, ey + 1.55 + dir * (1 - k) * 0.28 * -1);
        ops.push({ k: 'dot', x: q.x, y: q.y, r: p * 0.26, color: C.bg, alpha: a });
      }
    }
  }
  if (L.nose) {
    const q = pt(0, L.mouth + 0.9);
    ops.push({ k: 'dot', x: q.x, y: q.y, r: p * 0.34, color: C.orange, alpha: a });
  }
  if (L.mouth == null) return; // у Ути вместо рта — клюв в клетках тела
  const m = F.mouth ?? 'flat';
  const shapes = {
    flat: [[-0.5, 0], [0.5, 0]],
    side: [[0.2, 0], [1.1, 0.25]],
    'smile-small': [[-0.9, 0.3], [0, 0], [0.9, 0.3]],
    grin: [[-1.4, 0.5], [-0.5, 0], [0.5, 0], [1.4, 0.5]],
    sad: [[-1.1, -0.3], [0, 0.1], [1.1, -0.3]],
    pout: [[-1.3, 0.05], [-0.6, 0.2]],
  };
  if (m === 'o-small' || m === 'yawn') {
    const q = pt(0, L.mouth - (m === 'yawn' ? 0.6 : 0));
    const r = m === 'yawn' ? 1.3 : 0.62;
    ops.push({ k: 'dot', x: q.x, y: q.y, r: p * r * 0.8, ry: p * r, color: C.bg, alpha: a });
    return;
  }
  if (L.nose) {
    // у кота рот «ω»: две маленькие дуги
    if (m === 'flat' || m === 'side' || m === 'smile-small' || m === 'grin') {
      for (const s of [-1, 1]) {
        const q = pt(s * 0.55, L.mouth + 0.2);
        ops.push({ k: 'arc', x: q.x, y: q.y, r: p * 0.55 * (m === 'grin' ? 1.25 : 1), a0: 0.1 * Math.PI, a1: 0.9 * Math.PI, w: p * 0.32, color: C.bg, alpha: a });
      }
      return;
    }
  }
  for (const [x, y] of shapes[m] ?? shapes.flat) {
    const q = pt(x, L.mouth + y);
    ops.push({ k: 'dot', x: q.x, y: q.y, r: p * 0.4, color: C.bg, alpha: a });
  }
}

/** Значки из точек вокруг фигуры: облако, солнце, «z», «?» … Всё — точки и дуги. */
function props(ops, L, F, { pt, p, pitch, W, cx, base, a, t }) {
  const free = (x, y, r, color, alpha = a) => ops.push({ k: 'dot', x, y, r, color, alpha });
  const top = pt(0, L.h + (L.antenna ? 2 : 0) + (L.topExtra ?? 0) + (L.cells().some((c) => c[1] > 11) ? 1.5 : 0));
  const grid = (pattern, ox, oy, s, color) => {
    pattern.forEach((row, j) =>
      [...row].forEach((ch, i) => {
        if (ch !== '.') free(ox + i * s, oy + j * s, s * 0.42, color);
      }),
    );
  };
  for (const pr of F.props ?? []) {
    if (pr === 'zzz') {
      const Z = ['###', '..#', '.#.', '#..', '###'];
      grid(Z, top.x + 3 * pitch, top.y - 1 * pitch, pitch * 0.42, C.mute);
      grid(Z, top.x + 5 * pitch, top.y - 4 * pitch, pitch * 0.6, C.ink);
    }
    if (pr === 'waves') {
      for (let k = 0; k < 3; k++) {
        ops.push({ k: 'arc', x: top.x + 6.5 * pitch, y: top.y + 2 * pitch, r: pitch * (1.2 + k * 1.1), a0: -0.35 * Math.PI, a1: 0.35 * Math.PI, w: pitch * 0.42, color: k === 0 ? C.orange : C.ink, alpha: a * (1 - k * 0.28), dotted: true });
      }
    }
    if (pr === 'thought') {
      [0.3, 0.45, 0.62].forEach((r, k) => free(top.x + (2.2 + k * 1.6) * pitch, top.y - (0.2 + k * 1.3) * pitch, pitch * r * 1.4, C.ink, a * (0.5 + k * 0.25)));
    }
    if (pr === 'spinner') {
      // кольцо из 8 точек: одна яркая бежит по кругу (как «кольцо дела» в DS)
      const ox = top.x + 5.5 * pitch;
      const oy = top.y - 0.5 * pitch;
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2 + t;
        const lead = k === 0;
        free(ox + Math.cos(ang) * pitch * 1.8, oy + Math.sin(ang) * pitch * 1.8, pitch * (lead ? 0.5 : 0.32), lead ? C.orange : C.mute, a * (lead ? 1 : 0.4 + (k / 8) * 0.5));
      }
    }
    if (pr === 'ask') {
      const Q = ['.##.', '#..#', '...#', '..#.', '..#.', '....', '..#.'];
      grid(Q, top.x + 4 * pitch, top.y - 6 * pitch, pitch * 0.78, C.orange);
    }
    if (pr === 'bang') {
      const B = ['#', '#', '#', '#', '.', '#'];
      grid(B, top.x + 4.5 * pitch, top.y - 5.5 * pitch, pitch * 0.8, C.red);
    }
    if (pr === 'corner') {
      // кусочек «видео»: тёмный прямоугольник-окно, на которое он тихо смотрит
      ops.push({ k: 'rect', x: pitch * 1.5, y: pitch * 2, w: W - pitch * 13, h: pitch * 12, r: pitch, color: C.faint, alpha: 1 });
      ops.push({ k: 'poly', pts: [[W / 2 - pitch * 6.5, pitch * 6.5], [W / 2 - pitch * 6.5, pitch * 9.5], [W / 2 - pitch * 3.8, pitch * 8]], color: C.mute, alpha: 0.9 });
    }
    if (pr === 'cursor') {
      const ox = cx + 9 * pitch;
      const oy = top.y - 0.5 * pitch;
      const s = pitch * 0.5;
      ops.push({ k: 'poly', pts: [[0, 0], [0, 16], [4, 12.5], [7, 18.5], [9.5, 17.3], [6.6, 11.6], [11.5, 11.5]].map(([x, y]) => [ox + x * s * 0.5, oy + y * s * 0.5]), color: C.ink, alpha: 1, stroke: C.bg });
    }
    if (pr === 'dust') {
      for (let k = 0; k < 4; k++) free(cx - (6 + k * 1.4) * pitch, base - (0.4 + (k % 2) * 0.7) * pitch, pitch * (0.42 - k * 0.07), C.mute, a * (0.8 - k * 0.15));
    }
    if (pr === 'sun') {
      const ox = top.x + 6.5 * pitch;
      const oy = top.y - 1.5 * pitch;
      for (const [i, j] of blot(2)) free(ox + i * pitch * 0.62, oy + j * pitch * 0.62, pitch * 0.3, C.yellow);
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2 + 0.2;
        free(ox + Math.cos(ang) * pitch * 2.7, oy + Math.sin(ang) * pitch * 2.7, pitch * 0.34, C.yellow, a * 0.9);
      }
    }
    if (pr === 'rain') {
      const ox = top.x;
      const oy = top.y - 5.8 * pitch;
      const cloud = ['...###.....', '..#####.##.', '.##########', '###########', '.#########.'];
      grid(cloud, ox - 5 * pitch * 0.72, oy - 2.6 * pitch, pitch * 0.72, C.mute);
      for (let k = -2; k <= 2; k++) {
        const x = ox + k * pitch * 1.1;
        for (let d = 0; d < 2; d++) free(x - d * pitch * 0.25, oy + (1.9 + ((k + 3) % 3) * 0.8 + d * 0.6) * pitch, pitch * 0.26, C.sky, a);
      }
    }
    if (pr === 'vein') {
      const ox = top.x + 4.6 * pitch;
      const oy = top.y + 1.2 * pitch;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        free(ox + dx * pitch * 0.55, oy + dy * pitch * 0.55, pitch * 0.32, C.red);
        free(ox + dx * pitch * 1.05, oy + dy * pitch * 0.75, pitch * 0.24, C.red);
        free(ox + dx * pitch * 0.75, oy + dy * pitch * 1.05, pitch * 0.24, C.red);
      }
    }
    if (pr === 'moon') {
      const ox = top.x + 5.5 * pitch;
      const oy = top.y - 2.5 * pitch;
      for (const [i, j] of blot(5)) {
        if (Math.hypot(i - 2.6, j + 2) < 4.6) continue; // серп: круг минус сдвинутый круг
        free(ox + i * pitch * 0.4, oy + j * pitch * 0.4, pitch * 0.19, C.yellow, a * 0.95);
      }
      free(ox + 3.5 * pitch, oy - 1.5 * pitch, pitch * 0.2, C.ink, a * 0.7);
      free(ox + 2.6 * pitch, oy + 1.8 * pitch, pitch * 0.16, C.ink, a * 0.5);
    }
    if (pr === 'tea') {
      const ox = cx + 8.6 * pitch;
      const oy = base;
      const cup = ['#####', '#####', '#####', '.###.'];
      cup.forEach((row, j) => [...row].forEach((ch, i) => ch === '#' && free(ox + i * pitch * 0.62, oy - (3 - j) * pitch * 0.62 - pitch * 0.3, pitch * 0.27, C.orange)));
      free(ox + 5 * pitch * 0.62, oy - 2 * pitch * 0.62 - pitch * 0.3, pitch * 0.22, C.orange);
      for (let k = 0; k < 3; k++) free(ox + (1 + (k % 2)) * pitch * 0.62, oy - (4.4 + k * 1.1) * pitch * 0.62 - pitch * 0.3, pitch * 0.18, C.mute, a * (0.8 - k * 0.2));
    }
  }
}

/* ---------- вывод ---------- */

function circlePath(x, y, rx, ry = rx) {
  const f = (n) => n.toFixed(2);
  return `M${f(x - rx)} ${f(y)}a${f(rx)} ${f(ry)} 0 1 0 ${f(2 * rx)} 0a${f(rx)} ${f(ry)} 0 1 0 ${f(-2 * rx)} 0Z`;
}

/** SVG: точки одного цвета и прозрачности — одним путём (мало слоёв в Figma). */
export function toSvg({ w, h, ops }, { background } = {}) {
  const f = (n) => n.toFixed(2);
  const out = [];
  if (background) out.push(`<rect width="${w}" height="${h}" fill="${background}"/>`);
  let run = null;
  const flush = () => {
    if (run) out.push(`<path d="${run.d.join('')}" fill="${run.color}"${run.alpha < 1 ? ` fill-opacity="${run.alpha.toFixed(2)}"` : ''}/>`);
    run = null;
  };
  for (const o of ops) {
    if (o.k === 'dot') {
      if (!run || run.color !== o.color || run.alpha !== o.alpha) {
        flush();
        run = { color: o.color, alpha: o.alpha, d: [] };
      }
      run.d.push(circlePath(o.x, o.y, o.r, o.ry ?? o.r));
      continue;
    }
    flush();
    const op = o.alpha < 1 ? ` opacity="${o.alpha.toFixed(2)}"` : '';
    if (o.k === 'arc') {
      const x0 = o.x + Math.cos(o.a0) * o.r;
      const y0 = o.y + Math.sin(o.a0) * o.r;
      const x1 = o.x + Math.cos(o.a1) * o.r;
      const y1 = o.y + Math.sin(o.a1) * o.r;
      const large = o.a1 - o.a0 > Math.PI ? 1 : 0;
      out.push(`<path d="M${f(x0)} ${f(y0)}A${f(o.r)} ${f(o.r)} 0 ${large} 1 ${f(x1)} ${f(y1)}" fill="none" stroke="${o.color}" stroke-width="${f(o.w)}" stroke-linecap="round"${o.dotted ? ` stroke-dasharray="0 ${f(o.w * 2.1)}"` : ''}${op}/>`);
    } else if (o.k === 'line') {
      out.push(`<path d="M${f(o.x1)} ${f(o.y1)}L${f(o.x2)} ${f(o.y2)}" stroke="${o.color}" stroke-width="${f(o.w)}" stroke-linecap="round"${op}/>`);
    } else if (o.k === 'poly') {
      out.push(`<path d="M${o.pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z" fill="${o.color}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="1.2" stroke-linejoin="round"` : ''}${op}/>`);
    } else if (o.k === 'rect') {
      out.push(`<rect x="${f(o.x)}" y="${f(o.y)}" width="${f(o.w)}" height="${f(o.h)}" rx="${f(o.r)}" fill="${o.color}"${op}/>`);
    }
  }
  flush();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${out.join('')}</svg>`;
}

/** Canvas: те же примитивы — так фигуру будет рисовать apps/desktop (окно-оверлей). */
export function paintCanvas(ctx, { ops }) {
  for (const o of ops) {
    ctx.globalAlpha = o.alpha ?? 1;
    if (o.k === 'dot') {
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.ellipse(o.x, o.y, o.r, o.ry ?? o.r, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (o.k === 'arc') {
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.w;
      ctx.lineCap = 'round';
      ctx.setLineDash(o.dotted ? [0, o.w * 2.1] : []);
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, o.a0, o.a1);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (o.k === 'line') {
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.w;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(o.x1, o.y1);
      ctx.lineTo(o.x2, o.y2);
      ctx.stroke();
    } else if (o.k === 'poly') {
      ctx.fillStyle = o.color;
      ctx.beginPath();
      o.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
      if (o.stroke) {
        ctx.strokeStyle = o.stroke;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    } else if (o.k === 'rect') {
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.roundRect(o.x, o.y, o.w, o.h, o.r);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
