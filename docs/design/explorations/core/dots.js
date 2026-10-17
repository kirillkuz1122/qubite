/* «Частицы»: всё на экране собрано из круглых точек.
   Каждая точка — пружина к своему месту из того же материала Q (жёсткость и вязкость общие).
   Текст набирается пиксельным шрифтом Tiny5 и раскладывается в точки; помощники — тела из точек,
   которые гнутся от основания: чем выше точка, тем сильнее сдвиг. Рисуем на одном canvas. */
(function () {
  'use strict';
  var TAU = Math.PI * 2;
  var M = Q.MATERIAL;

  /* Форма точки: round 1 — круг, 0 — квадрат, между ними — квадрат со скруглёнными углами.
     size — множитель размера (1 = как в макете). Меняются панелью «Настроить». */
  var look = { round: 1, size: 1 };
  function blob(ctx, x, y, rx, ry) {
    if (ry == null) ry = rx;
    var k = look.round;
    if (k >= 0.995) {
      ctx.moveTo(x + rx, y);
      if (rx === ry) ctx.arc(x, y, rx, 0, TAU); else ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
      return;
    }
    var c = Math.min(rx, ry) * k;
    ctx.moveTo(x - rx + c, y - ry);
    ctx.arcTo(x + rx, y - ry, x + rx, y + ry, c);
    ctx.arcTo(x + rx, y + ry, x - rx, y + ry, c);
    ctx.arcTo(x - rx, y + ry, x - rx, y - ry, c);
    ctx.arcTo(x - rx, y - ry, x + rx, y - ry, c);
    ctx.closePath();
  }

  /* ---------- Текст → клетки ---------- */
  var raster = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  function textCells(text, font, lineRows) {
    var P = 4, lines = text.split('\n'), out = [], cols = 0, minR = 1e9;
    lineRows = lineRows || 7;
    lines.forEach(function (line, li) {
      raster.font = (8 * P) + "px '" + font + "'";
      var w = Math.ceil(raster.measureText(line).width / P) + 2;
      raster.canvas.width = w * P; raster.canvas.height = 12 * P;
      raster.font = (8 * P) + "px '" + font + "'";
      raster.fillStyle = '#000'; raster.textBaseline = 'alphabetic';
      raster.fillText(line, 0, 9 * P);
      var d = raster.getImageData(0, 0, w * P, 12 * P).data;
      for (var r = 0; r < 12; r++) for (var c = 0; c < w; c++) {
        var a = d[((r * P + 2) * w * P + c * P + 2) * 4 + 3];
        if (a > 140) { var row = r + li * lineRows; out.push([c, row]); if (c + 1 > cols) cols = c + 1; if (row < minR) minR = row; }
      }
    });
    out.forEach(function (c) { c[1] -= minR; });
    return { cells: out, cols: cols, rows: lines.length * lineRows - 2 };
  }

  /* ---------- Формы помощников в клетках (низ = 0) ---------- */
  function roundedCols(w, h, rTop) {
    var cells = [];
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      if ((i === 0 || i === w - 1) && j === 0) continue; /* мягкие нижние углы */
      if (j >= h - rTop) {
        var cx = i < rTop ? rTop - 0.5 : i > w - 1 - rTop ? w - rTop - 0.5 : i, cy = h - rTop - 0.5;
        if (Math.hypot(i - cx, j - cy) > rTop - 0.05) continue;
      }
      cells.push([i - (w - 1) / 2, j]);
    }
    return cells;
  }
  function halfDisc(R) {
    var cells = [];
    for (var j = 0; j <= R; j++) for (var i = -R; i <= R; i++) {
      if (i * i + (j + 0.5) * (j + 0.5) > (R + 0.35) * (R + 0.35)) continue;
      if (j === 0 && Math.abs(i) === R) continue;
      cells.push([i, j]);
    }
    return cells;
  }
  /* лица: глаза, рот, очки и клюв — в клетках относительно низа-центра */
  var KINDS = {
    proto: { cells: function () { return roundedCols(8, 22, 3); }, h: 22, eyes: [[-1.6, 18.6], [1.6, 18.6]], mouth: 15.4, mass: 2.1, lean: 8 },
    neit: { cells: function () { return roundedCols(10, 16, 4); }, h: 16, eyes: [[-2.1, 10.8], [2.1, 10.8]], mouth: 6.8, glasses: 1.75, mass: 1.9, lean: 8 },
    elik: { cells: function () { return roundedCols(7, 12, 3.5); }, h: 12, eyes: [[-1.1, 8.4], [1.3, 8.4]], beak: 6.2, mass: 1.3, lean: 12 },
    foti: { cells: function () { return halfDisc(9); }, h: 9.5, eyes: [[-2.2, 5.2], [2.2, 5.2]], mouth: 3.0, mass: 2.4, lean: 5 }
  };

  function Engine(canvas, o) {
    o = o || {};
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.ground = o.ground || '#100f0d'; this.light = o.light || '#f3ede3';
    this.repel = o.repel == null ? 70 : o.repel;
    this.dots = []; this.bodies = []; this.byColor = {}; this.absorbs = [];
    this.box = { x: 0, y: 0 };
    var self = this;
    this.resize = function () {
      var r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      self.W = r.width; self.H = r.height; self.box.x = r.left; self.box.y = r.top;
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      self.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    this.resize();
    addEventListener('resize', this.resize);
    addEventListener('scroll', function () { var r = canvas.getBoundingClientRect(); self.box.x = r.left; self.box.y = r.top; }, { passive: true, capture: true });
    this.start = performance.now() / 1000;
    Q.tick(function (t, dt) { self.frame(t, dt); });
    if (Q.reduce) requestAnimationFrame(function () { self.frame(performance.now() / 1000, 0); });
  }
  Engine.prototype.dot = function (hx, hy, color, r, from, delay) {
    var d = { hx: hx, hy: hy, x: from ? from[0] : hx, y: from ? from[1] : hy, vx: 0, vy: 0, m: 0.75 + Math.random() * 0.5, c: color, r: r, wake: delay || 0, alive: true };
    if (Q.reduce) { d.x = hx; d.y = hy; d.wake = 0; }
    this.dots.push(d);
    (this.byColor[color] = this.byColor[color] || []).push(d);
    return d;
  };
  /* разлёт для появления: точки прилетают из облака и собираются в форму */
  function scatter(W, H) { return [W * (0.2 + Math.random() * 0.9), H * (Math.random() * 1.2 - 0.1)]; }

  Engine.prototype.text = function (str, o) {
    var tc = textCells(str, o.font || 'Q Tiny5', o.lineRows), p = o.pitch, self = this;
    var g = { dots: [], x: o.x, y: o.y, p: p, cols: tc.cols, rows: tc.rows };
    tc.cells.forEach(function (c) {
      var d = self.dot(o.x + (c[0] + 0.5) * p, o.y + (c[1] + 0.5) * p, o.color || self.light, p * (o.r || 0.4),
        o.assemble ? scatter(self.W, self.H) : o.from ? [o.from[0] + (c[0] - tc.cols / 2) * p, o.from[1] + c[1] * p] : null,
        o.assemble ? (o.delay || 0) + c[0] * 0.018 + Math.random() * 0.25 : 0);
      d.cell = c; g.dots.push(d);
    });
    g.move = function (x, y) { g.x = x; g.y = y; g.dots.forEach(function (d) { d.hx = x + (d.cell[0] + 0.5) * p; d.hy = y + (d.cell[1] + 0.5) * p; }); };
    g.width = tc.cols * p; g.height = tc.rows * p;
    return g;
  };

  Engine.prototype.body = function (kind, o) {
    var K = KINDS[kind], self = this, p = o.pitch;
    var b = {
      kind: kind, K: K, x: o.x, y: o.y, p: p, color: o.color, hPx: K.h * p, dots: [],
      lean: Q.spring(0, K.mass), sy: Q.spring(1, K.mass), lift: Q.spring(0, K.mass),
      lx: Q.spring(0, 0.4), ly: Q.spring(0, 0.4), breath: 0, phase: Math.random() * 6,
      mood: 'idle', blink: 0, nextBlink: 1 + Math.random() * 3, away: false, aimT: 0
    };
    K.cells().forEach(function (c) {
      var d = self.dot(0, 0, o.color, p * 0.4, o.assemble ? scatter(self.W, self.H) : null, o.assemble ? (o.delay || 0) + Math.random() * 0.5 : 0);
      d.u = c[0] * p; d.h = (c[1] + 0.5) * p; b.dots.push(d);
    });
    b.point = function (u, h) {
      var s = b.sy.x * (1 + b.breath), lean = Math.tan(b.lean.x * Math.PI / 180) * b.hPx;
      return { x: b.x + u / Math.sqrt(s) + lean * Math.pow(Math.max(0, h) / b.hPx, 1.35), y: b.y - b.lift.x - h * s };
    };
    b.jump = function (v) { b.sy.x = 0.82; b.sy.v = 0; b.sy.to(1); b.lift.kick(v || 380); return b; };
    b.setMood = function (m, ms) { b.mood = m; clearTimeout(b.mt); if (ms) b.mt = setTimeout(function () { b.mood = 'idle'; }, ms); return b; };
    b.turnAway = function (on) { b.away = on; b.mood = on ? 'shut' : 'idle'; return b; };
    b.place = function (x, y, pitch) {
      b.x = x; b.y = y;
      if (pitch && pitch !== b.p) { var k = pitch / b.p; b.p = pitch; b.hPx = K.h * pitch; b.dots.forEach(function (d) { d.u *= k; d.h *= k; d.r = pitch * 0.4; }); }
    };
    this.bodies.push(b);
    return b;
  };

  /* мысль рассыпается на точки и улетает в помощника */
  Engine.prototype.absorb = function (group, body, done) {
    var self = this;
    group.dots.forEach(function (d, i) { d.target = body; d.wake = performance.now() / 1000 + i * 0.004; d.m = 0.5 + Math.random() * 0.4; });
    this.absorbs.push({ g: group, body: body, done: done, fired: false });
  };

  Engine.prototype.frame = function (t, dt) {
    var self = this, ctx = this.ctx;
    var tgt = Q.target();
    var tx = tgt.x - this.box.x, ty = tgt.y - this.box.y;
    this.bodies.forEach(function (b) {
      b.breath = Q.reduce ? 0 : Math.sin(t * 1.7 + b.phase) * 0.014;
      if (t > b.nextBlink) { b.blink = t + 0.12; b.nextBlink = t + 2.2 + Math.random() * 4; }
      if (t - b.aimT > 0.06) {
        b.aimT = t;
        var e = b.point(0, b.K.eyes[0][1] * b.p), dx = tx - e.x, dy = ty - e.y, dd = Math.hypot(dx, dy) || 1, k = Math.min(1, dd / 220);
        if (b.away) { b.lx.to(-Math.sign(dx || 1)); b.ly.to(-0.3); b.lean.to(-Math.sign(dx || 1) * b.K.lean * 0.6); }
        else { b.lx.to(dx / dd * k); b.ly.to(dy / dd * k); b.lean.to(Q.clamp(dx / 520, -1, 1) * b.K.lean * (tgt.focus ? 1 : 0.35)); }
      }
      b.dots.forEach(function (d) { if (!d.target) { var q = b.point(d.u, d.h); d.hx = q.x; d.hy = q.y; } });
    });
    var now = performance.now() / 1000;
    var px = Q.pointer.x - this.box.x, py = Q.pointer.y - this.box.y, pAct = this.repel && performance.now() - Q.pointer.t < 900;
    var R = this.repel, steps = 2, h = Math.min(dt, 0.033) / steps;
    for (var i = 0; i < this.dots.length; i++) {
      var d = this.dots[i];
      if (!d.alive || now < d.wake) continue;
      var hx = d.hx, hy = d.hy;
      if (d.target) {
        var head = d.target.point(0, d.target.K.eyes[0][1] * d.target.p);
        hx = head.x; hy = head.y;
        if (Math.abs(d.x - hx) + Math.abs(d.y - hy) < 10) { d.alive = false; this.dead = true; continue; }
      }
      for (var s = 0; s < steps; s++) {
        var ax = (-M.stiffness * (d.x - hx) - M.damping * d.vx) / d.m;
        var ay = (-M.stiffness * (d.y - hy) - M.damping * d.vy) / d.m;
        if (pAct) {
          var ex = d.x - px, ey = d.y - py, e2 = ex * ex + ey * ey;
          if (e2 < R * R) { var el = Math.sqrt(e2) || 1, f = (R - el) / R * 5200 / d.m; ax += ex / el * f; ay += ey / el * f; }
        }
        d.vx += ax * h; d.vy += ay * h; d.x += d.vx * h; d.y += d.vy * h;
      }
    }
    this.absorbs = this.absorbs.filter(function (a) {
      var left = a.g.dots.some(function (d) { return d.alive; });
      if (!left && !a.fired) { a.fired = true; if (a.done) a.done(); }
      return left;
    });
    /* рисуем: по одному пути на цвет */
    ctx.clearRect(0, 0, this.W, this.H);
    for (var c in this.byColor) {
      var arr = this.byColor[c];
      ctx.beginPath();
      for (var j = 0; j < arr.length; j++) {
        var q = arr[j];
        if (!q.alive) continue;
        if (now < q.wake) continue;
        blob(ctx, q.x, q.y, q.r * look.size);
      }
      ctx.fillStyle = c; ctx.fill();
      if (this.dead) this.byColor[c] = arr.filter(function (q) { return q.alive; });
    }
    if (this.dead) { this.dots = this.dots.filter(function (q) { return q.alive; }); this.dead = false; }
    this.bodies.forEach(function (b) { self.face(b, t); });
  };

  Engine.prototype.face = function (b, t) {
    var ctx = this.ctx, p = b.p, K = b.K, g = this.ground, L = this.light;
    var shut = b.mood === 'shut' || b.mood === 'happy' && b.kind === 'elik';
    var blink = t < b.blink;
    K.eyes.forEach(function (e) {
      var q = b.point(e[0] * p, e[1] * p);
      ctx.fillStyle = g;
      if (shut) {
        ctx.beginPath(); ctx.lineWidth = p * 0.42; ctx.strokeStyle = g; ctx.lineCap = 'round';
        ctx.arc(q.x, q.y + p * 0.35, p * 0.75, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
        return;
      }
      ctx.beginPath(); blob(ctx, q.x, q.y, p * 1.0, blink ? p * 0.18 : p * 1.0); ctx.fill();
      if (!blink) {
        ctx.fillStyle = b.color === L ? '#ff9852' : L;
        ctx.beginPath(); blob(ctx, q.x + b.lx.x * p * 0.42, q.y + b.ly.x * p * 0.42, p * 0.44); ctx.fill();
      }
    });
    if (K.glasses) {
      ctx.strokeStyle = g; ctx.lineWidth = p * 0.34;
      K.eyes.forEach(function (e) { var q = b.point(e[0] * p, e[1] * p); ctx.beginPath(); blob(ctx, q.x, q.y, K.glasses * p); ctx.stroke(); });
    }
    ctx.fillStyle = g;
    if (K.mouth != null) {
      var pts = b.mood === 'happy' ? [[-1.2, 0.35], [0, 0], [1.2, 0.35]].map(function (m) { return [m[0], -m[1]]; }) :
        b.mood === 'sad' ? [[-1.1, -0.3], [0, 0.1], [1.1, -0.3]] : b.mood === 'shut' ? [] : [[-0.5, 0], [0.5, 0]];
      if (b.mood === 'happy') pts = [[-1.3, 0.45], [-0.45, 0], [0.45, 0], [1.3, 0.45]];
      pts.forEach(function (m) { var q = b.point(m[0] * p, (K.mouth + m[1]) * p); ctx.beginPath(); blob(ctx, q.x, q.y, p * 0.4 * look.size); ctx.fill(); });
    }
    if (K.beak != null) {
      var tilt = b.mood === 'happy' ? -0.35 : b.mood === 'sad' ? 0.35 : 0;
      for (var k = 0; k < 7; k++) {
        var q = b.point((0.4 + k) * p, (K.beak - tilt * k) * p);
        ctx.fillStyle = k < 3 ? g : L;
        ctx.beginPath(); blob(ctx, q.x, q.y, p * (k < 3 ? 0.42 : 0.36) * look.size); ctx.fill();
      }
    }
  };

  /* Мелкий текст из точек без физики — для подписей и логотипа */
  var painted = [];
  function paintText(canvas, str, pitch, color, o) {
    o = o || {};
    if (!canvas._dots) { canvas._dots = true; painted.push([canvas, str, pitch, color, o]); }
    var tc = textCells(str, o.font || 'Q Tiny5', o.lineRows);
    var dpr = Math.min(2, devicePixelRatio || 1);
    var w = tc.cols * pitch, h = (o.rows || 7) * pitch;
    canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = color; ctx.beginPath();
    ctx.clearRect(0, 0, w, h);
    tc.cells.forEach(function (c) { var x = (c[0] + 0.5) * pitch, y = (c[1] + 0.5 - (o.top || 0)) * pitch; blob(ctx, x, y, Math.min(pitch / 2, pitch * 0.4 * look.size)); });
    ctx.fill();
  }
  /* перерисовать подписи после смены формы точки (холсты с физикой перерисуются сами) */
  function repaint() { painted.forEach(function (a) { paintText.apply(null, a); }); }
  /* фоновая сетка точек той же формы — картинкой для CSS */
  function gridImage(pitch, half, color, alpha) {
    var c = half * look.round;
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='" + pitch + "' height='" + pitch + "'><rect x='" + (pitch / 2 - half) + "' y='" + (pitch / 2 - half) + "' width='" + 2 * half + "' height='" + 2 * half + "' rx='" + c + "' fill='" + color + "' fill-opacity='" + alpha + "'/></svg>";
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  }

  window.Dots = { Engine: Engine, textCells: textCells, paintText: paintText, repaint: repaint, gridImage: gridImage, look: look, KINDS: KINDS };
})();
