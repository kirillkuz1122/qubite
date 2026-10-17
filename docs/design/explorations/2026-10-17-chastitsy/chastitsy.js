/* «Частицы» — общее для страниц направления: вид точки, тема, палитра для холстов
   и смена темы волной точек. Выбор общий для лендинга и приложения (хранится в браузере). */
(function () {
  'use strict';
  var STORE = 'qubite.chastitsy.look.v3';
  var DEF = { round: 50, size: 95, theme: 'dark' };
  /* те же цвета, что в chastitsy.css: холсты рисуют ими напрямую */
  var PAL = {
    dark: { bg: '#100f0d', panel: '#1b1916', ink: '#f3ede3', mute: '#a59c90', dim: '#8a8176', faint: 'rgba(243,237,227,.2)', ghost: 'rgba(243,237,227,.1)',
      orange: '#ff9852', sky: '#71cfff', yellow: '#ffe163', green: '#90dea5', peach: '#ffb98a', grid: 0.085 },
    light: { bg: '#f3eee5', panel: '#fffcf6', ink: '#1f1a17', mute: '#5d5650', dim: '#6e665e', faint: 'rgba(31,26,23,.2)', ghost: 'rgba(31,26,23,.1)',
      orange: '#f7883e', sky: '#3ea9e8', yellow: '#edb500', green: '#3fae69', peach: '#f39a6b', grid: 0.1 }
  };
  var state = (function () {
    try { var v = JSON.parse(localStorage.getItem(STORE)); return Object.assign({}, DEF, v || {}); } catch (e) { return Object.assign({}, DEF); }
  })();
  var listeners = [];
  var sys = matchMedia('(prefers-color-scheme: light)');
  function themeName() { return state.theme === 'auto' ? (sys.matches ? 'light' : 'dark') : state.theme; }
  var current = themeName();
  function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* без хранилища просто не запомним */ } }

  function apply() {
    var root = document.documentElement;
    root.dataset.theme = current;
    root.style.setProperty('--round', state.round / 100);
    if (window.Dots) { Dots.look.round = state.round / 100; Dots.look.size = state.size / 100; Dots.repaint(); }
    listeners.forEach(function (fn) { fn(state, PAL[current]); });
  }
  /* смена палитры холстов: каждый цвет старой темы → такой же цвет новой */
  function swapCanvases(from, to) {
    if (!window.Dots) return;
    var map = {};
    Object.keys(PAL[from]).forEach(function (k) { if (typeof PAL[from][k] === 'string') map[PAL[from][k]] = PAL[to][k]; });
    Dots.retheme(map);
  }

  /* Смена темы волной: от кнопки расходятся точки нового фона, закрывают экран, тема меняется, слой тает.
     Двигаем только размер точек на отдельном холсте и его прозрачность. */
  function wave(next, origin, done) {
    if (Q.reduce) { done(); return; }
    var c = document.createElement('canvas'), dpr = Math.min(2, devicePixelRatio || 1), W = innerWidth, H = innerHeight;
    c.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:3000;pointer-events:none;transition:opacity .35s';
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    document.body.appendChild(c);
    var ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var P = W < 760 ? 14 : 18, ox = origin ? origin.x : W / 2, oy = origin ? origin.y : 0;
    var far = Math.max(Math.hypot(ox, oy), Math.hypot(W - ox, oy), Math.hypot(ox, H - oy), Math.hypot(W - ox, H - oy));
    var col = PAL[next].bg, t0 = performance.now(), dur = 560, spread = 1.3, swapped = false;
    function shape(x, y, h) {
      var k = Dots.look.round, cr = h * k;
      if (k >= 0.995) { ctx.moveTo(x + h, y); ctx.arc(x, y, h, 0, Math.PI * 2); return; }
      ctx.moveTo(x - h + cr, y - h);
      ctx.arcTo(x + h, y - h, x + h, y + h, cr); ctx.arcTo(x + h, y + h, x - h, y + h, cr);
      ctx.arcTo(x - h, y + h, x - h, y - h, cr); ctx.arcTo(x - h, y - h, x + h, y - h, cr); ctx.closePath();
    }
    function frame(now) {
      var t = (now - t0) / dur, full = true;
      ctx.clearRect(0, 0, W, H); ctx.fillStyle = col; ctx.beginPath();
      for (var y = P / 2; y < H + P; y += P) for (var x = P / 2; x < W + P; x += P) {
        var k = Q.clamp(t * (1 + spread) - Math.hypot(x - ox, y - oy) / far * spread, 0, 1);
        if (k < 1) full = false;
        if (k > 0) shape(x, y, P * 0.76 * (1 - Math.pow(1 - k, 3)));
      }
      ctx.fill();
      if (full && !swapped) {
        swapped = true; done();
        requestAnimationFrame(function () { c.style.opacity = '0'; setTimeout(function () { c.remove(); }, 400); });
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function set(key, value, origin) {
    state[key] = value; save();
    if (key === 'theme') {
      var next = themeName();
      if (next !== current) {
        var from = current;
        wave(next, origin, function () { current = next; apply(); swapCanvases(from, next); });
        return;
      }
    }
    apply();
  }
  sys.addEventListener('change', function () { if (state.theme === 'auto') set('theme', 'auto'); });

  /* Панель «Настроить» для лендинга: форма точки и тема. */
  function lab(title) {
    var opts = {
      title: title || 'Частицы: точка и тема', store: STORE, state: state,
      controls: [
        { type: 'range', key: 'round', label: 'Скругление', min: 0, max: 100, step: 1, value: DEF.round, ends: ['квадрат', 'круг'], format: function (v) { return v + '%'; } },
        { type: 'range', key: 'size', label: 'Размер точки', min: 60, max: 125, step: 1, value: DEF.size, ends: ['мельче', 'крупнее'], format: function (v) { return v + '%'; } },
        { type: 'choice', key: 'theme', label: 'Тема', value: DEF.theme, options: [{ value: 'dark', label: 'Тёмная' }, { value: 'light', label: 'Светлая' }, { value: 'auto', label: 'Как в системе' }] }
      ],
      onChange: function (s, key) { if (key) set(key, s[key]); }
    };
    Lab.panel(opts);
    listeners.push(function () { if (opts.sync) opts.sync(); });
    return opts;
  }

  /* фоновая сетка точек той же формы и цвета темы */
  function grid(el, pitch, half) {
    function paint() { var p = PAL[current]; el.style.backgroundImage = Dots.gridImage(pitch, half * Dots.look.size, p.ink, p.grid); }
    listeners.push(paint);
    paint();
  }

  apply();
  window.Chast = {
    state: state, set: set, lab: lab, grid: grid, PAL: PAL,
    get pal() { return PAL[current]; }, get theme() { return current; },
    on: function (fn) { listeners.push(fn); }
  };
})();
