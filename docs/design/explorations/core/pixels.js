/* «Пиксель»: тетрадь в клетку. Помощники и рисунки — закрашенные клетки.
   Физика та же (пружины Q), но экран клетчатый: всё, что двигается, округляется до целой клетки,
   поэтому движение идёт шажками, как в пиксельной игре. Изгиб от основания — сдвиг рядов:
   чем выше ряд, тем дальше он уезжает. */
(function () {
  'use strict';
  /* P — тело Прото, E — его глаза, B — клюв Элика снаружи тела, O — контур рисунков, R и l — «строчка»-земля.
     Эти цвета меняет фон: на тёмном Прото становится светлым, иначе он пропадёт. */
  var PAL = { l: '#c9d6e2', R: '#dce7f0', k: '#1f1a17', P: '#1f1a17', E: '#ffffff', B: '#1f1a17', O: '#1f1a17', w: '#ffffff', o: '#ff9852', y: '#ffe163', s: '#71cfff', g: '#7fd39a', c: '#ff7a59', p: '#fbf7ef', d: '#e8702f', b: '#3d95d6' };

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

  /* тело: прямоугольник со ступенчатыми скруглениями (без острых углов) */
  function block(w, h, rt, color) {
    var rows = [];
    for (var r = 0; r < h; r++) {
      var cut = 0;
      if (r < rt) cut = rt - r;
      if (r === h - 1) cut = Math.max(cut, 1);
      var line = '';
      for (var c = 0; c < w; c++) line += c < cut || c >= w - cut ? '.' : color;
      rows.push(line);
    }
    return rows;
  }
  function dome(widths, w, color) {
    return widths.map(function (n, i) {
      var pad = (w - n) / 2, line = '';
      for (var c = 0; c < w; c++) line += c >= pad && c < w - pad ? color : '.';
      if (i === widths.length - 1) line = '.' + line.slice(1, -1) + '.';
      return line;
    });
  }
  /* лица: клетки [x, y] от левого верхнего угла тела; e — цвет глаз */
  var KINDS = {
    proto: { rows: block(7, 13, 1, 'P'), e: 'E', eyes: [[2, 3], [4, 3]], mouth: { idle: [[3, 6]], happy: [[2, 6], [3, 7], [4, 6]], sad: [[2, 7], [3, 6], [4, 7]] }, mass: 2.1, lean: 2 },
    neit: { rows: block(9, 10, 2, 's'), e: 'k', eyes: [[2, 3], [6, 3]], glasses: true, mouth: { idle: [[4, 7]], happy: [[3, 7], [4, 8], [5, 7]], sad: [[3, 8], [4, 7], [5, 8]] }, mass: 1.9, lean: 2 },
    elik: { rows: block(6, 9, 2, 'y'), e: 'k', eyes: [[2, 3], [4, 3]], beak: { idle: [[4, 6], [5, 6], [6, 6], [7, 6], [8, 6]], happy: [[4, 6], [5, 6], [6, 5], [7, 5], [8, 4]], sad: [[4, 6], [5, 6], [6, 7], [7, 7], [8, 8]] }, mass: 1.3, lean: 3 },
    foti: { rows: dome([5, 9, 11, 11, 11], 11, 'o'), e: 'k', eyes: [[3, 1], [7, 1]], mouth: { idle: [[4, 3], [5, 4], [6, 3]], happy: [[3, 3], [4, 4], [5, 4], [6, 4], [7, 3]], sad: [[4, 4], [5, 3], [6, 4]] }, mass: 2.4, lean: 1 }
  };
  var DOODLES = {
    heart: ['.cc.cc.', 'ccccccc', 'cwccccc', '.ccccc.', '..ccc..', '...c...'],
    spark: ['...y...', '...y...', '..yyy..', 'yyyyyyy', '..yyy..', '...y...', '...y...'],
    cal: ['.O...O.', 'OOOOOOO', 'OoooooO', 'OwwwwwO', 'OlwlwlO', 'OwwwwwO', 'OlwlwwO', 'OOOOOOO'],
    check: ['......g', '.....gg', 'g...gg.', 'gg.gg..', '.ggg...', '..g....'],
    pencil: ['..sssssssb', 'kkssssssssbb'.slice(0, 10), '..sssssssb'],
    note: ['yyyyyy', 'ykkkky', 'yyyyyy', 'ykkkyy', 'yyyyy.']
  };

  function Board(canvas, o) {
    o = o || {};
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.cell = o.cell || 20;
    this.buddies = []; this.doodles = []; this.extra = [];
    var self = this;
    this.resize = function () {
      var r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      self.W = r.width; self.H = r.height; self.box = { x: r.left, y: r.top };
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      self.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    this.resize();
    addEventListener('resize', this.resize);
    addEventListener('scroll', function () { var r = canvas.getBoundingClientRect(); self.box = { x: r.left, y: r.top }; }, { passive: true, capture: true });
    Q.tick(function (t) { self.frame(t); });
    if (Q.reduce) requestAnimationFrame(function () { self.frame(0); });
  }
  Board.prototype.fill = function (x, y, color) {
    var C = this.cell, g = C >= 8 ? 1 : 0; /* на крупной сетке видны линии тетради между клетками */
    this.ctx.fillStyle = PAL[color] || color;
    this.ctx.fillRect(x * C + g, y * C + g, C - g, C - g);
  };
  /* помощник: (cx, base) — клетка центра основания */
  Board.prototype.buddy = function (kind, cx, base) {
    var K = KINDS[kind];
    var b = { kind: kind, K: K, cx: cx, base: base, w: K.rows[0].length, h: K.rows.length,
      lean: Q.spring(0, K.mass), lift: Q.spring(0, K.mass), lx: Q.spring(0, 0.5), ly: Q.spring(0, 0.5),
      mood: 'idle', blink: 0, nextBlink: 1 + Math.random() * 3, away: false, aimT: 0, phase: Math.random() * 6 };
    b.jump = function (v) { b.lift.kick(v || 260); return b; };
    b.setMood = function (m, ms) { b.mood = m; clearTimeout(b.mt); if (ms) b.mt = setTimeout(function () { b.mood = 'idle'; }, ms); return b; };
    b.turnAway = function (on) { b.away = on; b.mood = on ? 'shut' : 'idle'; return b; };
    b.head = function () { var C = this.cell; return { x: (b.cx) * C, y: (b.base - b.h * 0.8) * C }; }.bind(this);
    this.buddies.push(b);
    return b;
  };
  Board.prototype.doodle = function (name, x, y, o) {
    o = o || {};
    var d = { rows: DOODLES[name], x: x, y: y, ox: Q.spring(0, o.mass || 0.8), oy: Q.spring(0, o.mass || 0.8), phase: Math.random() * 6, bob: o.bob !== false };
    this.doodles.push(d);
    return d;
  };
  Board.prototype.sprite = function (rows, x, y) {
    for (var r = 0; r < rows.length; r++) for (var c = 0; c < rows[r].length; c++) { var ch = rows[r][c]; if (ch !== '.') this.fill(x + c, y + r, ch); }
  };


  /* ---------- Помощники в двойном разрешении (варианты «Мелкая клетка» и «Объём») ----------
     Те же размеры на экране, но клетка вдвое мельче: скругления плавнее, глаза со зрачками. */
  var SHADE = { P: ['#4a423c', '#000000'], o: ['#ffc59a', '#e8702f'], y: ['#fff3b0', '#e8c23a'], s: ['#b9e8ff', '#3fa7e0'] };
  function rrCells(w, h, rt, rb) {
    var out = {};
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      var r = j < h / 2 ? rt : rb, cy = j < h / 2 ? r - 0.5 : h - r - 0.5;
      var cx = i < r ? r - 0.5 : i > w - 1 - r ? w - r - 0.5 : i;
      var inCorner = (j < r || j > h - 1 - r) && (i < r || i > w - 1 - r);
      if (inCorner && Math.hypot(i - cx, j - cy) > r - 0.1) continue;
      out[i + ',' + j] = 1;
    }
    return out;
  }
  function discCells(R) {
    var out = {};
    for (var j = 0; j < R; j++) for (var i = 0; i < 2 * R; i++) {
      var dx = i + 0.5 - R, dy = R - (j + 0.5);
      if (dx * dx + dy * dy <= R * R + 0.5 && !(j === R - 1 && (i === 0 || i === 2 * R - 1))) out[i + ',' + j] = 1;
    }
    return out;
  }
  function rect(x, y, w, h) { var a = []; for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) a.push([x + i, y + j]); return a; }
  var HI = {
    proto: { w: 14, h: 26, body: rrCells(14, 26, 5, 2), c: 'P', sclera: [rect(3, 6, 3, 4), rect(8, 6, 3, 4)], pupil: [[4, 7], [9, 7]], pc: 'B', ec: 'E',
      mouth: { idle: [[6, 14], [7, 14]], happy: [[5, 13], [6, 14], [7, 14], [8, 13]], sad: [[5, 15], [6, 14], [7, 14], [8, 15]] }, mc: 'E' },
    neit: { w: 18, h: 20, body: rrCells(18, 20, 7, 2), c: 's', sclera: [rect(3, 6, 4, 4), rect(11, 6, 4, 4)], pupil: [[4, 7], [12, 7]], pc: 'k', glasses: true,
      mouth: { idle: [[8, 15], [9, 15]], happy: [[7, 14], [8, 15], [9, 15], [10, 14]], sad: [[7, 16], [8, 15], [9, 15], [10, 16]] }, mc: 'k' },
    elik: { w: 12, h: 18, body: rrCells(12, 18, 6, 2), c: 'y', eyes: [[3, 5], [7, 5]], beakY: 11, beakFrom: 6, beakTo: 17 },
    foti: { w: 22, h: 11, body: discCells(11), c: 'o', eyes: [[7, 3], [13, 3]],
      mouth: { idle: [[9, 7], [10, 8], [11, 8], [12, 7]], happy: [[8, 6], [9, 7], [10, 8], [11, 8], [12, 7], [13, 6]], sad: [[9, 8], [10, 7], [11, 7], [12, 8]] }, mc: 'k' }
  };
  var variant = 'classic';
  Board.prototype.drawHi = function (b, t, lean, lift, shut, blink) {
    var self = this, H = HI[b.kind], C = this.cell / 2, ctx = this.ctx, vol = variant === 'volume';
    var left = b.cx * 2 - Math.floor(H.w / 2), top0 = b.base * 2 - H.h, L = lift * 2;
    function sh(y) { var fb = H.h - 1 - y; return Math.round(lean * 2 * Math.pow(Math.max(0, fb) / (H.h - 1), 1.3)); }
    function px(x, y, col) { ctx.fillStyle = PAL[col] || col; var g = C >= 8 ? 1 : 0; ctx.fillRect((left + x + sh(y)) * C + g, (top0 + y - L) * C + g, C - g, C - g); }
    var has = function (x, y) { return H.body[x + ',' + y]; };
    if (vol) for (var k in H.body) { /* контур: клетки вокруг тела */
      var q = k.split(','), x = +q[0], y = +q[1];
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { var nx = x + d[0], ny = y + d[1]; if (!has(nx, ny) && ny < H.h) px(nx, ny, 'k'); });
    }
    for (var key in H.body) {
      var a = key.split(','), cx = +a[0], cy = +a[1], col = H.c;
      if (vol && SHADE[H.c]) {
        if (!has(cx - 1, cy) || !has(cx, cy - 1) || !has(cx - 1, cy - 1)) col = H.c === 'P' && PAL.P !== '#1f1a17' ? '#ffffff' : SHADE[H.c][0];
        else if (!has(cx + 1, cy) || !has(cx, cy + 1)) col = H.c === 'P' && PAL.P !== '#1f1a17' ? '#d8cfc2' : SHADE[H.c][1];
        if (H.c === 'P' && PAL.P === '#1f1a17' && col === SHADE.P[1]) col = 'P';
      }
      px(cx, cy, col);
    }
    var lx = Math.round(Q.clamp(b.lx.x, -1, 1)), ly = Math.round(Q.clamp(b.ly.x, -1, 1));
    if (H.glasses) H.sclera.forEach(function (r0) {
      var x0 = r0[0][0], y0 = r0[0][1];
      for (var i = -1; i <= 4; i++) for (var j = -1; j <= 4; j++) if ((i === -1 || i === 4 || j === -1 || j === 4) && !((i === -1 || i === 4) && (j === -1 || j === 4))) px(x0 + i, y0 + j, 'k');
      px(x0 + 4, y0 + 1, 'k'); px(x0 + 5, y0 + 1, 'k'); px(x0 + 6, y0 + 1, 'k'); px(x0 + 7, y0 + 1, 'k');
    });
    if (H.sclera) H.sclera.forEach(function (r0, i) {
      if (shut) { var x0 = r0[0][0], y0 = r0[0][1] + 2; px(x0, y0, H.ec || 'k'); px(x0 + 1, y0 - 1, H.ec || 'k'); px(x0 + 2, y0, H.ec || 'k'); if (H.glasses) px(x0 + 3, y0, 'k'); return; }
      r0.forEach(function (c) { px(c[0], c[1], H.glasses ? 'w' : H.ec); });
      if (blink) { r0.forEach(function (c) { if (c[1] !== r0[r0.length - 1][1]) px(c[0], c[1], H.c); }); return; }
      var p = H.pupil[i], wSc = H.glasses ? 4 : 3, hSc = 4;
      var x = Q.clamp(p[0] + lx, r0[0][0], r0[0][0] + wSc - 2), y = Q.clamp(p[1] + ly, r0[0][1], r0[0][1] + hSc - 2);
      px(x, y, H.pc); px(x + 1, y, H.pc); px(x, y + 1, H.pc); px(x + 1, y + 1, H.pc);
    });
    if (H.eyes) H.eyes.forEach(function (e) {
      var x = e[0] + lx, y = e[1] + Math.max(0, ly);
      if (shut) { px(e[0] - 1, e[1] + 2, 'k'); px(e[0], e[1] + 1, 'k'); px(e[0] + 1, e[1] + 1, 'k'); px(e[0] + 2, e[1] + 2, 'k'); return; }
      if (blink) { px(x, y + 2, 'k'); px(x + 1, y + 2, 'k'); return; }
      for (var j = 0; j < 3; j++) { px(x, y + j, 'k'); px(x + 1, y + j, 'k'); }
    });
    var mood = shut ? 'idle' : b.mood;
    if (H.mouth) (H.mouth[mood] || H.mouth.idle).forEach(function (m) { px(m[0], m[1], H.mc); });
    if (H.beakY != null) for (var bx = H.beakFrom; bx <= H.beakTo; bx++) {
      var out = bx - (H.w - 1), dy = mood === 'happy' ? -Math.max(0, Math.floor(out / 2)) : mood === 'sad' ? Math.max(0, Math.floor(out / 2)) : 0;
      var c = bx >= H.w ? 'B' : 'k';
      px(bx, H.beakY + dy, c); px(bx, H.beakY + 1 + dy, c);
    }
  };

  Board.prototype.frame = function (t) {
    var self = this, C = this.cell, ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    var tgt = Q.target(), tx = tgt.x - this.box.x, ty = tgt.y - this.box.y;
    var P = Q.pointer, px = P.x - this.box.x, py = P.y - this.box.y, pAct = performance.now() - P.t < 1200;
    /* рисунки на полях: качаются на одну клетку и отходят от пальца */
    this.doodles.forEach(function (d) {
      var w = d.rows[0].length, h = d.rows.length;
      var cx = (d.x + w / 2) * C, cy = (d.y + h / 2) * C, dx = cx - px, dy = cy - py, dd = Math.hypot(dx, dy);
      if (pAct && dd < 6 * C) { var f = (6 * C - dd) / C * 0.6; d.ox.to(dx / (dd || 1) * f); d.oy.to(dy / (dd || 1) * f); }
      else if (d.ox.goal || d.oy.goal) { d.ox.to(0); d.oy.to(0); }
      var bob = d.bob && !Q.reduce ? Math.round(Math.sin(t * 1.4 + d.phase) * 0.6) : 0;
      self.sprite(d.rows, d.x + Math.round(d.ox.x), d.y + Math.round(d.oy.x) + bob);
    });
    this.extra.forEach(function (fn) { fn(self, t); });
    this.buddies.forEach(function (b) {
      var K = b.K;
      if (t > b.nextBlink) { b.blink = t + 0.14; b.nextBlink = t + 2.2 + Math.random() * 4; }
      var left = b.cx - Math.floor(b.w / 2), top0 = b.base - b.h;
      if (t - b.aimT > 0.08) {
        b.aimT = t;
        var ex = b.cx * C, ey = (top0 + K.eyes[0][1]) * C, dx = tx - ex, dy = ty - ey, dd = Math.hypot(dx, dy) || 1, k = Math.min(1, dd / 200);
        if (b.away) { b.lx.to(-Math.sign(dx || 1)); b.ly.to(0); b.lean.to(-Math.sign(dx || 1) * K.lean); }
        else { b.lx.to(dx / dd * k * 1.2); b.ly.to(dy / dd * k * 0.9); b.lean.to(tgt.focus ? Q.clamp(dx / 400, -1, 1) * K.lean : 0); }
      }
      /* дыхание: раз в пару секунд тело на клетку «приседает» по верхнему ряду */
      var lift = Math.round(Math.max(0, b.lift.x) / 10);
      var lean = b.lean.x;
      if (variant !== 'classic') { self.drawHi(b, t, lean, lift, b.mood === 'shut', t < b.blink); return; }
      function shift(r) { var fromBottom = b.h - 1 - r; return Math.round(lean * Math.pow(fromBottom / (b.h - 1), 1.3)); }
      for (var r = 0; r < b.h; r++) {
        var row = K.rows[r], s = shift(r);
        for (var c = 0; c < row.length; c++) if (row[c] !== '.') self.fill(left + c + s, top0 + r - lift, row[c]);
      }
      /* взгляд: двигаются только глаза, на одну клетку и не выходя за тело */
      var lx = Math.round(Q.clamp(b.lx.x, -1, 1));
      K.eyes.forEach(function (e) { if (e[0] + lx < 0 || e[0] + lx > b.w - 1) lx = 0; });
      var face = function (x, y, color) { self.fill(left + x + shift(y), top0 + y - lift, color); };
      var eye = function (x, y, color) { face(x + lx, y, color); };
      var shut = b.mood === 'shut', blink = t < b.blink;
      if (K.glasses) {
        /* очки Нейта: чёрная оправа, белые стёкла, зрачок ходит вверх-вниз внутри стекла */
        K.eyes.forEach(function (e) {
          [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1], [0, 2]].forEach(function (q) { face(e[0] + q[0], e[1] + q[1], 'k'); });
          face(e[0], e[1], 'w'); face(e[0], e[1] + 1, 'w');
          if (!shut && !blink) face(e[0], e[1] + (b.ly.x > 0.2 ? 1 : 0), 'k');
          else face(e[0], e[1] + 1, 'k');
        });
        face(K.eyes[0][0] + 2, K.eyes[0][1], 'k');
      } else K.eyes.forEach(function (e) {
        if (shut) { face(e[0] - 1, e[1] + 1, K.e); face(e[0], e[1], K.e); face(e[0] + 1, e[1] + 1, K.e); }
        else if (blink) eye(e[0], e[1] + 1, K.e);
        else { eye(e[0], e[1], K.e); eye(e[0], e[1] + 1, K.e); }
      });
      var mood = shut ? 'idle' : b.mood;
      if (K.mouth) (K.mouth[mood] || K.mouth.idle).forEach(function (m) { face(m[0], m[1], K.e); });
      /* клюв: внутри тела — тёмный, снаружи — цвета «чернил» фона, чтобы был виден и на тёмном */
      if (K.beak) (K.beak[mood] || K.beak.idle).forEach(function (m) { face(m[0], m[1], m[0] >= b.w ? 'B' : 'k'); });
    });
  };

  window.Pixels = { setVariant: function (v) { variant = v; }, Board: Board, PAL: PAL, KINDS: KINDS, DOODLES: DOODLES, THEMES: THEMES, theme: theme };
})();
