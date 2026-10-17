/* «Пиксель»: бумага в клетку. Помощники и рисунки — закрашенные клетки.
   Физика та же (пружины Q), но экран клетчатый: всё, что двигается, округляется до целой клетки,
   поэтому движение идёт шажками, как в пиксельной игре. Изгиб от основания — сдвиг рядов:
   чем выше ряд, тем дальше он уезжает.

   Разрешение (scale) — сколько клеток рисунка приходится на одну клетку первого макета:
   1 — крупно (как было), 2 — вдвое мельче. Помощники и рисунки строятся из простых форм
   под любое разрешение, поэтому бумага, помощники, сердечки и календарик всегда в одной клетке. */
(function () {
  'use strict';
  /* P — тело Прото, E — его глаза, B — клюв Элика снаружи тела, O — контур рисунков, R и l — «строчка»-земля.
     Эти цвета меняет фон: на тёмном Прото становится светлым, иначе он пропадёт. h — румянец Фоти. */
  var PAL = { l: '#c9d6e2', R: '#dce7f0', k: '#1f1a17', P: '#1f1a17', E: '#ffffff', B: '#1f1a17', O: '#1f1a17', w: '#ffffff', o: '#ff9852', y: '#ffe163', s: '#71cfff', g: '#7fd39a', c: '#ff7a59', p: '#fbf7ef', d: '#e8702f', b: '#3d95d6', h: '#f0604d' };

  /* Фоны страницы. grid: lines — клетка, dots — точки в узлах клетки, none — без сетки. */
  var LIGHT = { ink: '#1f1a17', ink2: '#5d5650', ink3: '#736c66', box: '#ffffff', hl: '#ffe163', btnBg: '#1f1a17', btnFg: '#ffffff', shadow: 'rgba(31,26,23,.13)', pal: { P: '#1f1a17', E: '#ffffff', B: '#1f1a17', O: '#1f1a17' } };
  var THEMES = {
    warm: { label: 'Светлая — тёплая бумага', paper: '#f6f1e8', rule: '#ebe2d4', margin: 'transparent', grid: 'lines', ground: ['#e0d4c2', '#ebe2d4'], ink3: '#6c625a' },
    night: { label: 'Тёмная — ночь', paper: '#151412', rule: '#262421', margin: 'transparent', grid: 'lines', ground: ['#34302b', '#2a2723'],
      ink: '#f3ede3', ink2: '#b4ab9f', ink3: '#9a9186', box: '#1f1d1a', hl: 'rgba(255,225,99,.3)', btnBg: '#f3ede3', btnFg: '#151412', shadow: 'rgba(0,0,0,.45)',
      pal: { P: '#f3ede3', E: '#1f1a17', B: '#f3ede3', O: '#f3ede3' } }
  };
  var GRIDS = {
    lines: 'linear-gradient(var(--rule) 1px, transparent 1px), linear-gradient(90deg, var(--rule) 1px, transparent 1px)',
    dots: 'radial-gradient(circle at 1px 1px, var(--rule) 1.4px, transparent 1.9px)',
    none: 'none'
  };
  function theme(name) {
    var t = THEMES[name] || THEMES.warm, st = document.body.style;
    var v = function (k) { return t[k] != null ? t[k] : LIGHT[k]; };
    st.setProperty('--paper', t.paper); st.setProperty('--rule', t.rule); st.setProperty('--margin', t.margin);
    st.setProperty('--grid', GRIDS[t.grid]);
    st.setProperty('--ink', v('ink')); st.setProperty('--ink-2', v('ink2')); st.setProperty('--ink-3', v('ink3'));
    st.setProperty('--box', v('box')); st.setProperty('--hl', v('hl')); st.setProperty('--btn-bg', v('btnBg')); st.setProperty('--btn-fg', v('btnFg'));
    st.setProperty('--shadow', v('shadow'));
    var pal = t.pal || LIGHT.pal;
    for (var key in pal) PAL[key] = pal[key];
    PAL.l = t.ground[0]; PAL.R = t.ground[1];
    document.body.dataset.bg = name;
  }

  /* ---------- Разрешение и объём ---------- */
  var scale = 1, volume = false, cache = {};
  function setScale(s) { if (s !== scale) { scale = s; cache = {}; } }
  function S(v) { return Math.max(1, Math.round(v * scale)); }

  /* ---------- Формы: картинка — массив рядов, в клетке буква цвета или '.' ---------- */
  function grid(w, h) { var a = []; for (var j = 0; j < h; j++) { var r = []; for (var i = 0; i < w; i++) r.push('.'); a.push(r); } return a; }
  /* прямоугольник со скруглёнными углами: rt — радиус сверху, rb — снизу (в клетках) */
  function roundRect(w, h, rt, rb, col) {
    var g = grid(w, h);
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      var x = i + 0.5, y = j + 0.5, top = y < h / 2, r = top ? rt : rb, cy = top ? r : h - r;
      var cx = x < r ? r : x > w - r ? w - r : x;
      if ((top ? y < r : y > h - r) && Math.hypot(x - cx, y - cy) > r - 0.1) continue;
      g[j][i] = col;
    }
    return g;
  }
  /* холмик: половина эллипса на всю ширину, нижние углы срезаны */
  function dome(w, h, col) {
    var g = grid(w, h), a = w / 2;
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      var x = (i + 0.5 - a) / a, y = (h - j - 0.5) / h;
      if (x * x + y * y <= 1.04 && !(j === h - 1 && (i === 0 || i === w - 1))) g[j][i] = col;
    }
    return g;
  }
  /* два глаза симметрично: просвет между ними ближе к g0, но так, чтобы поля слева и справа были равны */
  function pair(W, ew, g0) {
    var best = 1;
    for (var g = 1, found = false; g <= W - 2 * ew - 2; g++) {
      if ((W - 2 * ew - g) % 2) continue;
      if (!found || Math.abs(g - g0) < Math.abs(best - g0) - 1e-9) { best = g; found = true; }
    }
    var m = Math.floor((W - 2 * ew - best) / 2);
    return [m, m + ew + best];
  }
  function centerCols(W) { return W % 2 ? [(W - 1) / 2] : [W / 2 - 1, W / 2]; }
  /* рот по центру: улыбка — уголки вверх, грусть — вниз; hw — сколько клеток в каждую сторону */
  function mouth(o, W, my, mood, hw, col) {
    var cc = centerCols(W), a = cc[0], b = cc[cc.length - 1];
    if (mood !== 'happy' && mood !== 'sad') { cc.forEach(function (x) { o.push([x, my, col]); }); return; }
    var up = mood === 'happy';
    cc.forEach(function (x) { o.push([x, up ? my + 1 : my, col]); });
    for (var k = 1; k <= hw; k++) {
      var corner = k === hw, y = up ? (corner ? my : my + 1) : (corner ? my + 1 : my);
      o.push([a - k, y, col]); o.push([b + k, y, col]);
    }
  }
  /* глаз: открыт — блок ew×eh (с бликом, если хватает клеток), моргнул — нижний ряд, зажмурился — «^» */
  function eye(o, x, y, ew, eh, st, col, glint) {
    if (st.shut) {
      var ym = y + Math.floor((eh - 1) / 2);
      o.push([x - 1, ym + 1, col]);
      for (var i = 0; i < ew; i++) o.push([x + i, ym, col]);
      o.push([x + ew, ym + 1, col]);
      return;
    }
    x += st.dx; y += st.dy;
    if (st.blink) { for (var b = 0; b < ew; b++) o.push([x + b, y + eh - 1, col]); return; }
    for (var j = 0; j < eh; j++) for (var k = 0; k < ew; k++) o.push([x + k, y + j, col]);
    if (glint && ew >= 2 && eh >= 3) o.push([x, y, glint]);
  }
  /* куда можно сдвинуть глаза при взгляде: только так, чтобы они остались на теле и не задели рот */
  function gazeRange(rows, eyes, ew, eh, ey, limit) {
    function fits(dx, dy) {
      return eyes.every(function (x) {
        for (var j = 0; j < eh; j++) for (var i = 0; i < ew; i++) {
          var r = rows[ey + dy + j], c = x + dx + i;
          if (!r || r[c] == null || r[c] === '.') return false;
        }
        return ey + dy + eh <= limit && ey + dy >= 1;
      });
    }
    return { l: fits(-1, 0), r: fits(1, 0), u: scale >= 1.2 && fits(0, -1), d: scale >= 1.2 && fits(0, 1) };
  }

  /* ---------- Помощники ---------- */
  function buildBuddy(kind) {
    var s = scale, ew = Math.round(s * 1.1), eh = Math.round(s * 1.9), hw = s >= 1.6 ? 2 : 1, sp;
    if (kind === 'proto') {
      /* Прото — высокий тёмный прямоугольник; глаза светлые, в мелкой клетке — со зрачками */
      var W = S(7), H = S(13), ex = pair(W, ew, 1.2 * s), ey = Math.round(3 * s), my = ey + eh + Math.max(1, Math.round(0.9 * s));
      sp = { w: W, h: H, c: 'P', rows: roundRect(W, H, Math.max(2, Math.round(1.8 * s)), 2, 'P'), eyeY: ey, mass: 2.1, lean: 2, ext: 0 };
      sp.range = gazeRange(sp.rows, ex, ew, eh, ey, my - 1);
      sp.face = function (o, st) {
        if (ew >= 2 && !st.shut && !st.blink) {
          var ph = eh >= 4 ? 2 : 1;
          ex.forEach(function (x, i) {
            eye(o, x, ey, ew, eh, NO_GAZE, 'E');
            var px = st.lx > 0.3 ? ew - 1 : st.lx < -0.3 ? 0 : i === 0 ? ew - 1 : 0;
            var py = st.ly > 0.35 ? eh - ph : st.ly < -0.35 ? 0 : Math.floor((eh - ph) / 2);
            for (var j = 0; j < ph; j++) o.push([x + px, ey + py + j, 'P']);
          });
        } else ex.forEach(function (x) { eye(o, x, ey, ew, eh, st, 'E'); });
        mouth(o, W, my, st.shut ? 'idle' : st.mood, hw, 'E');
      };
    } else if (kind === 'neit') {
      /* Нейт — мудрец в очках: оправа, белые стёкла, зрачок ходит внутри стекла */
      var Wn = S(9), Hn = S(10), lw = s >= 1.4 ? 2 : 1, lh = Math.round(s * 1.9), fw = lw + 2;
      var fx = pair(Wn, fw, 1 * s), ly = Math.round(3 * s), mn = ly + lh + 1 + Math.max(1, Math.round(1.2 * s));
      sp = { w: Wn, h: Hn, c: 's', rows: roundRect(Wn, Hn, Math.round(2.6 * s), 2, 's'), eyeY: ly, mass: 1.9, lean: 2, ext: 0 };
      sp.face = function (o, st) {
        fx.forEach(function (x0, i) {
          var x = x0 + 1;
          for (var a = -1; a <= lw; a++) for (var b = -1; b <= lh; b++) {
            var edge = a === -1 || a === lw || b === -1 || b === lh, corner = (a === -1 || a === lw) && (b === -1 || b === lh);
            if (edge && !corner) o.push([x + a, ly + b, 'k']);
          }
          if (st.shut) { /* за стёклами — закрытые глаза */
            for (var c = 0; c < lw; c++) for (var d = 0; d < lh; d++) o.push([x + c, ly + d, 'w']);
            for (var e = 0; e < lw; e++) o.push([x + e, ly + Math.floor(lh / 2), 'k']);
            return;
          }
          for (var c2 = 0; c2 < lw; c2++) for (var d2 = 0; d2 < lh; d2++) o.push([x + c2, ly + d2, 'w']);
          var ph = lh >= 3 ? 2 : 1;
          if (st.blink) { for (var f = 0; f < lw; f++) o.push([x + f, ly + lh - 1, 'k']); return; }
          var px = lw === 1 ? 0 : st.lx > 0.3 ? 1 : st.lx < -0.3 ? 0 : i === 0 ? 1 : 0;
          var py = st.ly > 0.2 ? lh - ph : st.ly < -0.35 ? 0 : Math.max(0, Math.floor((lh - ph) / 2));
          for (var q = 0; q < ph; q++) o.push([x + px, ly + py + q, 'k']);
        });
        /* перемычка очков */
        for (var bx = fx[0] + fw; bx < fx[1]; bx++) o.push([bx, ly, 'k']);
        mouth(o, Wn, mn, st.shut ? 'idle' : st.mood, hw, 'k');
      };
    } else if (kind === 'elik') {
      /* Элик — столбик со скруглённым верхом и клювом-чёрточкой, смотрит вправо */
      var We = S(6), He = S(9), mr = Math.max(1, Math.round(0.9 * s)), gp = Math.max(1, Math.round(1.2 * s));
      var x2 = We - mr - ew, xe = [x2 - gp - ew, x2], eye0 = Math.round(3 * s), by = eye0 + eh + Math.max(1, Math.round(0.8 * s));
      var inside = Math.round(2 * s), L = Math.round(3 * s), bt = s >= 1.4 ? 2 : 1;
      sp = { w: We, h: He, c: 'y', rows: roundRect(We, He, Math.min(Math.floor(We / 2), Math.round(2.6 * s)), 2, 'y'), eyeY: eye0, mass: 1.3, lean: 3, ext: L };
      sp.range = gazeRange(sp.rows, xe, ew, eh, eye0, by - 1);
      sp.face = function (o, st) {
        xe.forEach(function (x) { eye(o, x, eye0, ew, eh, st, 'k', 'w'); });
        var mood = st.shut ? 'idle' : st.mood;
        /* клюв: на теле — тёмная чёрточка-рот, снаружи — оранжевый, к кончику тоньше */
        for (var k = -inside; k < L; k++) {
          var out = k + 1, dy = out <= 0 ? 0 : mood === 'happy' ? -Math.floor(out / 2) : mood === 'sad' ? Math.floor(out / 2) : 0;
          var th = k >= 0 && bt > 1 && k >= Math.ceil(L / 2) ? 1 : bt;
          for (var t = 0; t < th; t++) o.push([We + k, by + dy + t, k >= 0 ? (scale > 1 ? 'd' : 'B') : 'k']);
        }
      };
    } else {
      /* Фоти — тёплый оранжевый холмик; всегда чуть улыбается, в мелкой клетке — с румянцем */
      var Wf = Math.round(11 * s), Hf = Math.round(5.5 * s), ef = pair(Wf, ew, 3 * s), eyf = Math.max(1, Math.round(1.2 * s));
      var mf = Math.min(eyf + eh + (s >= 1.6 ? 1 : 0), Hf - 3);
      sp = { w: Wf, h: Hf, c: 'o', rows: dome(Wf, Hf, 'o'), eyeY: eyf, mass: 2.4, lean: 1, ext: 0 };
      sp.range = gazeRange(sp.rows, ef, ew, eh, eyf, mf - 1);
      sp.face = function (o, st) {
        ef.forEach(function (x) { eye(o, x, eyf, ew, eh, st, 'k', 'w'); });
        var mood = st.shut ? 'idle' : st.mood;
        mouth(o, Wf, mf, mood === 'sad' ? 'sad' : 'happy', mood === 'happy' ? hw + 1 : hw, 'k');
        if (s >= 1.4 && !st.shut) { o.push([ef[0] - 1, eyf + eh, 'h']); o.push([ef[1] + ew, eyf + eh, 'h']); }
      };
    }
    if (!sp.range) sp.range = { l: true, r: true, u: false, d: false };
    /* тело одним списком клеток; для объёма — где светлый край, где тень, где контур */
    var has = function (x, y) { var r = sp.rows[y]; return r && r[x] != null && r[x] !== '.'; };
    sp.cells = []; sp.outline = [];
    for (var y = 0; y < sp.h; y++) for (var x = 0; x < sp.w; x++) if (has(x, y)) {
      var tone = !has(x - 1, y) || !has(x, y - 1) || !has(x - 1, y - 1) ? 1 : (!has(x + 1, y) || (!has(x, y + 1) && y < sp.h - 1)) ? 2 : 0;
      sp.cells.push([x, y, tone]);
    }
    var seen = {};
    sp.cells.forEach(function (c) {
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var nx = c[0] + d[0], ny = c[1] + d[1], key = nx + ',' + ny;
        if (!has(nx, ny) && ny < sp.h && !seen[key]) { seen[key] = 1; sp.outline.push([nx, ny]); }
      });
    });
    return sp;
  }
  var NO_GAZE = { dx: 0, dy: 0 };

  /* ---------- Рисунки на полях ---------- */
  var CLASSIC = {
    heart: ['.cc.cc.', 'ccccccc', 'cwccccc', '.ccccc.', '..ccc..', '...c...'],
    spark: ['...y...', '...y...', '..yyy..', 'yyyyyyy', '..yyy..', '...y...', '...y...'],
    cal: ['.O...O.', 'OOOOOOO', 'OoooooO', 'OwwwwwO', 'OlwlwlO', 'OwwwwwO', 'OlwlwwO', 'OOOOOOO'],
    check: ['......g', '.....gg', 'g...gg.', 'gg.gg..', '.ggg...', '..g....'],
    note: ['yyyyyy', 'ykkkky', 'yyyyyy', 'ykkkyy', 'yyyyy.']
  };
  function rowsOf(list) { return list.map(function (r) { return r.split(''); }); }
  function heart() {
    var w = S(7), h = S(6), g = grid(w, h), r = w * 0.27, cy = h * 0.33;
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      var x = i + 0.5, y = j + 0.5;
      var lobe = Math.hypot(x - w * 0.285, y - cy) <= r + 0.12 || Math.hypot(x - w * 0.715, y - cy) <= r + 0.12;
      var tip = y >= cy && Math.abs(x - w / 2) <= (w / 2 - 0.15) * (h - y) / (h - cy) + 0.18;
      if (lobe || tip) g[j][i] = 'c';
    }
    var hx = Math.round(w * 0.2), hy = Math.round(h * 0.3);
    g[hy][hx] = 'w'; if (scale >= 1.6) { g[hy - 1][hx] = 'w'; g[hy][hx + 1] = 'w'; }
    return g;
  }
  function spark() {
    var n = 2 * Math.floor(3.5 * scale) + 1, c = (n - 1) / 2, g = grid(n, n);
    for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
      var x = Math.abs(i - c) / (c + 0.5), y = Math.abs(j - c) / (c + 0.5);
      if (Math.pow(x, 0.6) + Math.pow(y, 0.6) <= 1) g[j][i] = 'y';
    }
    return g;
  }
  function check() {
    var w = S(7), h = S(6), g = grid(w, h), half = 0.55 * scale + 0.12;
    var P = [[0.07 * w, 0.5 * h], [0.38 * w, 0.84 * h], [0.95 * w, 0.1 * h]];
    function seg(px, py, a, b) {
      var vx = b[0] - a[0], vy = b[1] - a[1], t = Q.clamp(((px - a[0]) * vx + (py - a[1]) * vy) / (vx * vx + vy * vy), 0, 1);
      return Math.hypot(px - a[0] - vx * t, py - a[1] - vy * t);
    }
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) if (Math.min(seg(i + 0.5, j + 0.5, P[0], P[1]), seg(i + 0.5, j + 0.5, P[1], P[2])) <= half) g[j][i] = 'g';
    return g;
  }
  function cal() {
    var w = S(7), ringH = scale >= 1.6 ? 2 : 1, h = S(8) + ringH - 1, top = ringH, hb = Math.max(1, Math.round(scale * 0.9)), g = grid(w, h);
    for (var j = top; j < h; j++) for (var i = 0; i < w; i++) g[j][i] = j === top || j === h - 1 || i === 0 || i === w - 1 ? 'O' : j <= top + hb ? 'o' : 'w';
    var rw = scale >= 1.6 ? 2 : 1, r1 = Math.max(1, Math.round(w * 0.22));
    for (var rj = 0; rj < top; rj++) for (var k = 0; k < rw; k++) { g[rj][r1 + k] = 'O'; g[rj][w - 1 - r1 - k] = 'O'; }
    /* дни — клетки через одну, «сегодня» оранжевое */
    var x0 = scale >= 1.4 ? 2 : 1, n = 0;
    for (var y = top + hb + 2; y < h - 1; y += 2) for (var x = x0; x < w - 1; x += 2) { n++; g[y][x] = n === 4 ? 'o' : 'l'; }
    return g;
  }
  function note() {
    var w = S(6), h = S(5), g = grid(w, h);
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) g[j][i] = 'y';
    for (var y = 1, n = 0; y < h - 1; y += 2, n++) for (var x = 1; x < w - (n % 2 ? 2 : 1); x++) g[y][x] = 'k';
    g[h - 1][w - 1] = '.';
    return g;
  }
  var MAKE = { heart: heart, spark: spark, check: check, cal: cal, note: note };
  function doodleRows(name) {
    var key = 'd:' + name;
    if (!cache[key]) {
      var rows = scale === 1 ? rowsOf(CLASSIC[name]) : MAKE[name]();
      var has = function (x, y) { var r = rows[y]; return r && r[x] != null && r[x] !== '.'; }, out = [], seen = {};
      for (var y = 0; y < rows.length; y++) for (var x = 0; x < rows[y].length; x++) if (has(x, y))
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { var nx = x + d[0], ny = y + d[1], k = nx + ',' + ny; if (!has(nx, ny) && !seen[k]) { seen[k] = 1; out.push([nx, ny]); } });
      cache[key] = { rows: rows, outline: name === 'cal' ? [] : out };
    }
    return cache[key];
  }
  function buddySprite(kind) { var key = 'b:' + kind; return cache[key] || (cache[key] = buildBuddy(kind)); }
  function size(kind) { var sp = buddySprite(kind); return { w: sp.w, h: sp.h, ext: sp.ext }; }

  /* светлый край и тень для «объёма» */
  var SHADE = { P: ['#4a423c', null], o: ['#ffc59a', '#e8702f'], y: ['#fff3b0', '#e8c23a'], s: ['#b9e8ff', '#3fa7e0'] };
  function tone(c, t) {
    if (!t || !volume) return c;
    if (c === 'P') { if (PAL.P !== '#1f1a17') return t === 1 ? '#ffffff' : '#d8cfc2'; return t === 1 ? SHADE.P[0] : 'P'; }
    return SHADE[c] ? SHADE[c][t - 1] : c;
  }

  function Board(canvas, o) {
    o = o || {};
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.cell = o.cell || 20;
    /* на бумаге между клетками видна линия сетки; на маленьких «листочках» — сплошные клетки */
    this.gap = o.lines === false || this.cell < 6 ? 0 : 1;
    this.buddies = []; this.doodles = []; this.extra = [];
    var self = this;
    this.resize = function () {
      var r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      self.W = r.width; self.H = r.height; self.box = { x: r.left, y: r.top }; self.dpr = dpr;
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      self.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    this.resize();
    addEventListener('resize', this.resize);
    addEventListener('scroll', function () { var r = canvas.getBoundingClientRect(); self.box = { x: r.left, y: r.top }; }, { passive: true, capture: true });
    Q.tick(function (t) { self.frame(t); });
    if (Q.reduce) requestAnimationFrame(function () { self.frame(0); });
  }
  /* клетка: края округляем до пикселя экрана, чтобы клетки не расплывались; между крупными клетками видна линия бумаги */
  Board.prototype.fill = function (x, y, color) {
    var C = this.cell, g = this.gap, d = this.dpr;
    var x0 = Math.round((x * C + g) * d) / d, y0 = Math.round((y * C + g) * d) / d;
    var x1 = Math.round((x + 1) * C * d) / d, y1 = Math.round((y + 1) * C * d) / d;
    this.ctx.fillStyle = PAL[color] || color;
    this.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  };
  /* помощник: (cx, base) — клетка центра основания */
  Board.prototype.buddy = function (kind, cx, base) {
    var sp = buddySprite(kind);
    var b = { kind: kind, sp: sp, cx: cx, base: base, w: sp.w, h: sp.h,
      lean: Q.spring(0, sp.mass), lift: Q.spring(0, sp.mass), lx: Q.spring(0, 0.5), ly: Q.spring(0, 0.5),
      mood: 'idle', blink: 0, nextBlink: 1 + Math.random() * 3, away: false, aimT: 0, phase: Math.random() * 6 };
    /* прыжок одной высоты при любой клетке */
    b.jump = function (v) { b.lift.kick((v || 260) * scale); return b; };
    b.setMood = function (m, ms) { b.mood = m; clearTimeout(b.mt); if (ms) b.mt = setTimeout(function () { b.mood = 'idle'; }, ms); return b; };
    b.turnAway = function (on) { b.away = on; b.mood = on ? 'shut' : 'idle'; return b; };
    b.head = function () { var C = this.cell; return { x: b.cx * C, y: (b.base - b.h * 0.8) * C }; }.bind(this);
    this.buddies.push(b);
    return b;
  };
  Board.prototype.doodle = function (name, x, y, o) {
    o = o || {};
    var d = { name: name, x: x, y: y, ox: Q.spring(0, o.mass || 0.8), oy: Q.spring(0, o.mass || 0.8), phase: Math.random() * 6, bob: o.bob !== false };
    this.doodles.push(d);
    return d;
  };
  /* рисунок по имени (сердце, звезда, календарь, галочка, заметка) в текущей клетке */
  Board.prototype.sprite = function (name, x, y) {
    var self = this, D = typeof name === 'string' ? doodleRows(name) : { rows: rowsOf(name), outline: [] }, rows = D.rows;
    if (volume) D.outline.forEach(function (p) { self.fill(x + p[0], y + p[1], 'k'); });
    for (var r = 0; r < rows.length; r++) for (var c = 0; c < rows[r].length; c++) { var ch = rows[r][c]; if (ch !== '.') this.fill(x + c, y + r, ch); }
  };
  Board.prototype.drawBuddy = function (b, t) {
    var self = this, sp = b.sp;
    var lift = Math.round(Math.max(0, b.lift.x) / 10), lean = b.lean.x * scale;
    var left = b.cx - Math.floor(sp.w / 2), top0 = b.base - sp.h - lift;
    function sh(y) { var fb = sp.h - 1 - Q.clamp(y, 0, sp.h - 1); return Math.round(lean * Math.pow(fb / (sp.h - 1), 1.3)); }
    if (volume) sp.outline.forEach(function (p) { self.fill(left + p[0] + sh(p[1]), top0 + p[1], 'k'); });
    sp.cells.forEach(function (c) { self.fill(left + c[0] + sh(c[1]), top0 + c[1], tone(sp.c, c[2])); });
    /* взгляд: глаза сдвигаются на клетку, только если остаются на теле */
    var lx = Q.clamp(b.lx.x, -1, 1), ly = Q.clamp(b.ly.x, -1, 1);
    var dx = lx > 0.45 && sp.range.r ? 1 : lx < -0.45 && sp.range.l ? -1 : 0;
    var dy = ly > 0.5 && sp.range.d ? 1 : ly < -0.5 && sp.range.u ? -1 : 0;
    var st = { mood: b.mood, shut: b.mood === 'shut', blink: t < b.blink, lx: lx, ly: ly, dx: dx, dy: dy }, face = [];
    sp.face(face, st);
    face.forEach(function (p) { self.fill(left + p[0] + sh(p[1]), top0 + p[1], p[2]); });
  };

  Board.prototype.frame = function (t) {
    var self = this, C = this.cell, ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    var tgt = Q.target(), tx = tgt.x - this.box.x, ty = tgt.y - this.box.y;
    var P = Q.pointer, px = P.x - this.box.x, py = P.y - this.box.y, pAct = performance.now() - P.t < 1200;
    /* рисунки на полях: качаются на одну клетку и отходят от пальца */
    this.doodles.forEach(function (d) {
      var rows = doodleRows(d.name).rows, w = rows[0].length, h = rows.length;
      var cx = (d.x + w / 2) * C, cy = (d.y + h / 2) * C, dx = cx - px, dy = cy - py, dd = Math.hypot(dx, dy), reach = 6 * C * scale;
      if (pAct && dd < reach) { var f = (reach - dd) / C * 0.6 / scale; d.ox.to(dx / (dd || 1) * f); d.oy.to(dy / (dd || 1) * f); }
      else if (d.ox.goal || d.oy.goal) { d.ox.to(0); d.oy.to(0); }
      var bob = d.bob && !Q.reduce ? Math.round(Math.sin(t * 1.4 + d.phase) * 0.6 * scale) : 0;
      self.sprite(d.name, d.x + Math.round(d.ox.x), d.y + Math.round(d.oy.x) + bob);
    });
    this.extra.forEach(function (fn) { fn(self, t); });
    this.buddies.forEach(function (b) {
      var sp = b.sp;
      if (t > b.nextBlink) { b.blink = t + 0.14; b.nextBlink = t + 2.2 + Math.random() * 4; }
      if (t - b.aimT > 0.08) {
        b.aimT = t;
        var ex = b.cx * C, ey = (b.base - sp.h + sp.eyeY) * C, dx = tx - ex, dy = ty - ey, dd = Math.hypot(dx, dy) || 1, k = Math.min(1, dd / 200);
        if (b.away) { b.lx.to(-Math.sign(dx || 1)); b.ly.to(0); b.lean.to(-Math.sign(dx || 1) * sp.lean); }
        else { b.lx.to(dx / dd * k * 1.2); b.ly.to(dy / dd * k * 0.9); b.lean.to(tgt.focus ? Q.clamp(dx / 400, -1, 1) * sp.lean : 0); }
      }
      self.drawBuddy(b, t);
    });
  };

  window.Pixels = {
    Board: Board, PAL: PAL, THEMES: THEMES, theme: theme,
    setScale: setScale, setVolume: function (v) { volume = !!v; }, size: size,
    doodleSize: function (name) { var r = doodleRows(name).rows; return { w: r[0].length, h: r.length }; },
    get scale() { return scale; }
  };
})();
