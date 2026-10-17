/* «Пиксель»: тетрадь в клетку. Помощники и рисунки — закрашенные клетки.
   Физика та же (пружины Q), но экран клетчатый: всё, что двигается, округляется до целой клетки,
   поэтому движение идёт шажками, как в пиксельной игре. Изгиб от основания — сдвиг рядов:
   чем выше ряд, тем дальше он уезжает. */
(function () {
  'use strict';
  var PAL = { l: '#c9d6e2', k: '#1f1a17', w: '#ffffff', o: '#ff9852', y: '#ffe163', s: '#71cfff', g: '#7fd39a', c: '#ff7a59', p: '#fbf7ef', d: '#e8702f', b: '#3d95d6' };

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
    proto: { rows: block(7, 13, 1, 'k'), e: 'w', eyes: [[2, 3], [4, 3]], mouth: { idle: [[3, 6]], happy: [[2, 6], [3, 7], [4, 6]], sad: [[2, 7], [3, 6], [4, 7]] }, mass: 2.1, lean: 2 },
    neit: { rows: block(9, 10, 2, 's'), e: 'k', eyes: [[2, 3], [6, 3]], glasses: true, mouth: { idle: [[4, 7]], happy: [[3, 7], [4, 8], [5, 7]], sad: [[3, 8], [4, 7], [5, 8]] }, mass: 1.9, lean: 2 },
    elik: { rows: block(6, 9, 2, 'y'), e: 'k', eyes: [[2, 3], [4, 3]], beak: { idle: [[4, 6], [5, 6], [6, 6], [7, 6], [8, 6]], happy: [[4, 6], [5, 6], [6, 5], [7, 5], [8, 4]], sad: [[4, 6], [5, 6], [6, 7], [7, 7], [8, 8]] }, mass: 1.3, lean: 3 },
    foti: { rows: dome([5, 9, 11, 11, 11], 11, 'o'), e: 'k', eyes: [[3, 1], [7, 1]], mouth: { idle: [[4, 3], [5, 4], [6, 3]], happy: [[3, 3], [4, 4], [5, 4], [6, 4], [7, 3]], sad: [[4, 4], [5, 3], [6, 4]] }, mass: 2.4, lean: 1 }
  };
  var DOODLES = {
    heart: ['.cc.cc.', 'ccccccc', 'cwccccc', '.ccccc.', '..ccc..', '...c...'],
    spark: ['...y...', '...y...', '..yyy..', 'yyyyyyy', '..yyy..', '...y...', '...y...'],
    cal: ['.k...k.', 'kkkkkkk', 'koooook', 'kwwwwwk', 'klwlwlk', 'kwwwwwk', 'klwlwwk', 'kkkkkkk'],
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
      if (K.beak) (K.beak[mood] || K.beak.idle).forEach(function (m) { face(m[0], m[1], 'k'); });
    });
  };

  window.Pixels = { Board: Board, PAL: PAL, KINDS: KINDS, DOODLES: DOODLES };
})();
