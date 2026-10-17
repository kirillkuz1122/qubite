/* Qubite — одна физика на весь интерфейс.
   Любое движение — пружина из одного «материала». Отличается только масса:
   крупное (помощники, листы) тяжелее и мягче, мелкое (кнопки, точки) легче и собраннее.
   Двигаем только transform и opacity. Цикл один на страницу и спит, когда вкладка скрыта. */
(function () {
  'use strict';
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Базовые правила для помощников: изгиб от основания, взгляд, моргание, настроение. */
  var base = document.createElement('style');
  base.textContent = '.buddy .bend{transform-origin:50% 100%;will-change:transform}.buddy svg{display:block;overflow:visible}' +
    '.buddy .look{will-change:transform}.buddy .blink{transform-box:fill-box;transform-origin:center;transition:transform .07s}' +
    '.buddy.is-blink .blink{transform:scaleY(.1)}.buddy .m,.buddy .shut{opacity:0;transition:opacity .18s}.buddy .open{transition:opacity .18s}' +
    '.buddy[data-mood=idle] .m-idle,.buddy[data-mood=happy] .m-happy,.buddy[data-mood=sad] .m-sad,.buddy[data-mood=shut] .shut{opacity:1}' +
    '.buddy[data-mood=shut] .open{opacity:0}';
  document.head.insertBefore(base, document.head.firstChild);
  var MATERIAL = { stiffness: 220, damping: 20 };
  var springs = new Set();
  var tickers = new Set();
  var dirty = new Set();
  var raf = 0;
  var last = 0;

  function frame(now) {
    raf = 0;
    var t = now / 1000;
    var dt = last ? t - last : 1 / 60;
    last = t;
    if (dt > 0.05) dt = 0.05;
    tickers.forEach(function (fn) { fn(t, dt); });
    var steps = Math.max(1, Math.ceil(dt / 0.006));
    var h = dt / steps;
    springs.forEach(function (s) {
      for (var i = 0; i < steps; i++) s.step(h);
      if (s.settled()) springs.delete(s);
      s.emit();
    });
    dirty.forEach(function (fn) { fn(t); });
    dirty.clear();
    if (springs.size || tickers.size) wake();
    else last = 0;
  }
  function wake() {
    if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', function () { last = 0; wake(); });

  function Spring(x, mass, onChange) {
    this.x = x; this.v = 0; this.goal = x; this.m = mass || 1;
    this.cb = onChange || null;
  }
  Spring.prototype.to = function (goal) {
    this.goal = goal;
    if (reduce) { this.x = goal; this.v = 0; this.emit(); return this; }
    springs.add(this); wake(); return this;
  };
  Spring.prototype.kick = function (v) {
    if (reduce) return this;
    this.v += v; springs.add(this); wake(); return this;
  };
  Spring.prototype.set = function (x) {
    this.x = this.goal = x; this.v = 0; springs.delete(this); this.emit(); return this;
  };
  Spring.prototype.step = function (h) {
    var a = (-MATERIAL.stiffness * (this.x - this.goal) - MATERIAL.damping * this.v) / this.m;
    this.v += a * h; this.x += this.v * h;
  };
  Spring.prototype.settled = function () {
    if (Math.abs(this.v) < 0.003 && Math.abs(this.x - this.goal) < 0.003) {
      this.x = this.goal; this.v = 0; return true;
    }
    return false;
  };
  Spring.prototype.emit = function () { if (this.cb) this.cb(this.x, this.v); };

  function render(fn) {
    return function () { dirty.add(fn); wake(); };
  }
  function tick(fn) {
    if (reduce) return function () {};
    tickers.add(fn); wake();
    return function () { tickers.delete(fn); };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* Куда смотрят помощники: палец/курсор, поле ввода в фокусе или «осматриваются». */
  var pointer = { x: innerWidth / 2, y: innerHeight / 3, t: -1e9 };
  var focusFn = null;
  var wander = { x: innerWidth / 2, y: innerHeight / 3, next: 0 };
  function onPointer(e) { pointer.x = e.clientX; pointer.y = e.clientY; pointer.t = performance.now(); }
  addEventListener('pointermove', onPointer, { passive: true });
  addEventListener('pointerdown', onPointer, { passive: true });
  function target() {
    var now = performance.now();
    if (focusFn) { var p = focusFn(); if (p) return { x: p.x, y: p.y, focus: true }; }
    if (now - pointer.t < 3500) return { x: pointer.x, y: pointer.y, focus: false };
    if (now > wander.next) {
      wander.x = innerWidth * (0.15 + Math.random() * 0.7);
      wander.y = innerHeight * (0.1 + Math.random() * 0.6);
      wander.next = now + 1800 + Math.random() * 2600;
    }
    return { x: wander.x, y: wander.y, focus: false };
  }
  function focus(fn) { focusFn = fn; }

  /* Где каретка в поле ввода — чтобы помощники смотрели прямо на текст. */
  var measure = document.createElement('canvas').getContext('2d');
  function caretPoint(input) {
    var r = input.getBoundingClientRect();
    var cs = getComputedStyle(input);
    measure.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    var text = input.value.slice(0, input.selectionStart == null ? input.value.length : input.selectionStart);
    var w = measure.measureText(text || '').width;
    var pad = parseFloat(cs.paddingLeft) || 0;
    return { x: Math.min(r.left + pad + w - input.scrollLeft, r.right - 8), y: r.top + r.height / 2 };
  }

  /* Помощник: изгиб от основания, взгляд, дыхание, моргание, прыжок, настроение.
     Разметка: root > .bend > (svg …  .look > .blink). Настроение — data-mood на root. */
  function buddy(root, o) {
    o = o || {};
    var mass = o.mass || 1.6;
    var maxLean = o.lean == null ? 9 : o.lean;
    var lookR = o.look == null ? 5 : o.look;
    var bend = root.querySelector('.bend');
    var looks = root.querySelectorAll('.look');
    var phase = Math.random() * 6;
    var breath = 0;
    var away = false;
    var draw = render(paint);
    var lean = new Spring(0, mass, draw);
    var sy = new Spring(1, mass, draw);
    var lift = new Spring(0, mass, draw);
    var lx = new Spring(0, 0.35, draw);
    var ly = new Spring(0, 0.35, draw);
    var origin = { x: 0, y: 0 };
    function measureOrigin() {
      var r = (o.eyeEl || root).getBoundingClientRect();
      origin.x = r.left + r.width / 2; origin.y = r.top + r.height * (o.eyeY == null ? 0.25 : o.eyeY);
    }
    measureOrigin();
    addEventListener('resize', measureOrigin);
    addEventListener('scroll', measureOrigin, { passive: true });
    function paint() {
      var s = sy.x * (1 + breath);
      bend.style.transform = 'translate3d(0,' + (-lift.x).toFixed(2) + 'px,0) skewX(' + (-lean.x).toFixed(2) + 'deg) scale(' + (1 / Math.sqrt(s)).toFixed(4) + ',' + s.toFixed(4) + ')';
      var tr = 'translate(' + lx.x.toFixed(2) + 'px,' + ly.x.toFixed(2) + 'px)';
      for (var i = 0; i < looks.length; i++) looks[i].style.transform = tr;
    }
    var lastAim = 0;
    var stopTick = tick(function (t) {
      breath = Math.sin(t * 1.7 + phase) * 0.012;
      if (t - lastAim > 0.06) {
        lastAim = t;
        var g = target();
        var dx = g.x - origin.x, dy = g.y - origin.y;
        var d = Math.hypot(dx, dy) || 1;
        var k = Math.min(1, d / 240);
        if (away) {
          lx.to(-Math.sign(dx || 1) * lookR); ly.to(-lookR * 0.4);
          lean.to(-Math.sign(dx || 1) * maxLean * 0.6);
        } else {
          lx.to(dx / d * k * lookR); ly.to(dy / d * k * lookR);
          lean.to(clamp(dx / 520, -1, 1) * maxLean * (g.focus ? 1 : 0.35));
        }
      }
      draw();
    });
    function blink() {
      if (root.dataset.mood !== 'shut') {
        root.classList.add('is-blink');
        setTimeout(function () { root.classList.remove('is-blink'); }, 120);
      }
      setTimeout(blink, 2200 + Math.random() * 4200);
    }
    setTimeout(blink, 800 + Math.random() * 3000);
    var moodTimer = 0;
    var api = {
      root: root,
      lean: lean, sy: sy, lift: lift,
      jump: function (power) {
        sy.x = 0.84; sy.v = 0; sy.to(1);
        lift.kick(power || 420);
        return api;
      },
      sink: function () { sy.x = 1; sy.to(0.86); setTimeout(function () { sy.to(1); }, 900); return api; },
      mood: function (m, ms) {
        clearTimeout(moodTimer);
        root.dataset.mood = m;
        if (ms) moodTimer = setTimeout(function () { root.dataset.mood = 'idle'; }, ms);
        return api;
      },
      turnAway: function (on) { away = on; root.dataset.mood = on ? 'shut' : 'idle'; return api; },
      drop: function (from, delay) {
        lift.set(from);
        setTimeout(function () {
          lift.to(0);
          var landed = false;
          var stop = tick(function () {
            if (!landed && lift.x < 2) { landed = true; sy.x = 0.8; sy.v = 0; sy.to(1); stop(); }
          });
        }, delay || 0);
        return api;
      },
      remeasure: measureOrigin,
      stop: stopTick
    };
    root.dataset.mood = root.dataset.mood || 'idle';
    root.addEventListener('pointerdown', function () { api.jump(360).mood('happy', 1400); });
    paint();
    return api;
  }

  /* Нажатие: материал сжимается под пальцем и пружинит обратно. */
  function press(el, o) {
    o = o || {};
    var depth = o.depth || 0.92;
    var s = new Spring(1, o.mass || 0.6, render(function () {
      /* squash: сжимается по высоте и чуть раздаётся вширь, как мягкая игрушка */
      var sx = o.squash ? 2 - s.x : s.x;
      el.style.transform = (o.base || '') + ' scale(' + sx.toFixed(4) + ',' + s.x.toFixed(4) + ')';
    }));
    el.addEventListener('pointerdown', function () { s.to(depth); });
    function up() { s.to(1); s.kick(1.2); }
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', function () { if (s.goal !== 1) s.to(1); });
    return s;
  }

  /* Текст-подсказка, который сам себя печатает в пустом поле. */
  function typewriter(input, phrases, o) {
    o = o || {};
    var i = 0, j = 0, dir = 1, timer = 0, base = input.getAttribute('placeholder') || '';
    function step() {
      if (document.activeElement === input || input.value) { input.setAttribute('placeholder', base); timer = setTimeout(step, 900); return; }
      var p = phrases[i];
      j += dir;
      input.setAttribute('placeholder', p.slice(0, j) + (dir > 0 ? '▍' : ''));
      var wait = dir > 0 ? 55 + Math.random() * 60 : 22;
      if (j >= p.length) { dir = -1; wait = 1900; }
      if (j <= 0 && dir < 0) { dir = 1; i = (i + 1) % phrases.length; wait = 400; }
      timer = setTimeout(step, wait);
    }
    if (!reduce) timer = setTimeout(step, o.delay || 900);
    return function () { clearTimeout(timer); input.setAttribute('placeholder', base); };
  }

  window.Q = {
    reduce: reduce, MATERIAL: MATERIAL, Spring: Spring,
    spring: function (x, mass, cb) { return new Spring(x, mass, cb); },
    render: render, tick: tick, clamp: clamp,
    pointer: pointer, target: target, focus: focus, caretPoint: caretPoint,
    buddy: buddy, press: press, typewriter: typewriter
  };
})();
