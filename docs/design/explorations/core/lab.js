/* Панель для экспериментов: кнопка «Настроить» в углу раскрывается в ползунки и переключатели.
   Это инструмент для выбора стиля, а не часть дизайна, поэтому выглядит нейтрально.
   Выбор запоминается в браузере и общий для лендинга и «Сегодня» одного направления. */
(function () {
  'use strict';
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* без хранилища просто не запомним */ }
  }

  var css = document.createElement('style');
  css.textContent =
    '.lab{position:fixed;z-index:1000;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));font:500 14px/1.3 system-ui,sans-serif;color:#f3ede3}' +
    '.lab-btn{height:40px;padding:0 14px 0 12px;border:0;border-radius:20px;background:rgba(20,18,16,.86);color:#f3ede3;font:inherit;display:flex;align-items:center;gap:8px;cursor:pointer;box-shadow:0 6px 18px -8px rgba(0,0,0,.6)}' +
    '.lab-btn i{width:14px;height:14px;border-radius:50%;border:2px solid #ff9852;display:block}' +
    '.lab-panel{position:absolute;left:0;bottom:48px;width:min(300px,calc(100vw - 24px));padding:14px 14px 12px;border-radius:16px;background:rgba(20,18,16,.94);box-shadow:0 16px 40px -14px rgba(0,0,0,.7);display:none}' +
    '.lab.open .lab-panel{display:block}' +
    '.lab-title{font-size:13px;color:#a59c90;margin:0 0 10px}' +
    '.lab-row{margin-bottom:12px}.lab-row:last-child{margin-bottom:0}' +
    '.lab-row label{display:flex;justify-content:space-between;margin-bottom:6px}.lab-row label b{font-weight:500;color:#ff9852;font-variant-numeric:tabular-nums}' +
    '.lab-row input[type=range]{width:100%;accent-color:#ff9852;margin:0}' +
    '.lab-ends{display:flex;justify-content:space-between;font-size:12px;color:#8a8176;margin-top:2px}' +
    '.lab-seg{display:flex;flex-wrap:wrap;gap:6px}' +
    '.lab-seg button{border:1px solid rgba(243,237,227,.22);background:none;color:#f3ede3;font:inherit;font-size:13px;padding:7px 10px;border-radius:10px;cursor:pointer}' +
    '.lab-seg button.on{background:#f3ede3;color:#14120f;border-color:#f3ede3}' +
    /* на телефоне внизу стоят помощники, поэтому кнопка — «язычок» у правого края */
    '@media (max-width:760px){.lab{left:auto;right:0;bottom:auto;top:58%}.lab-btn{width:32px;height:46px;padding:0;border-radius:14px 0 0 14px;justify-content:center;font-size:0;gap:0}' +
    '.lab-panel{left:auto;right:8px;bottom:auto;top:54px}}';
  document.head.appendChild(css);

  /* opts: { title, controls: [{type:'range', key, label, min, max, step, value, ends:[a,b], format}, {type:'choice', key, label, options:[{value,label}], value}], onChange(state) } */
  /* opts.state — общий объект настроек страницы (если есть); opts.sync() — обновить панель после изменений снаружи;
     onChange(state, key) — key пустой при первом вызове */
  function panel(opts) {
    var state = opts.state || load(opts.store, {});
    opts.controls.forEach(function (c) { if (state[c.key] == null) state[c.key] = c.value; });
    var root = document.createElement('div');
    root.className = 'lab';
    root.innerHTML = '<button class="lab-btn" type="button" aria-label="Настроить" aria-expanded="false"><i></i>Настроить</button><div class="lab-panel" role="dialog" aria-label="' + opts.title + '"><p class="lab-title">' + opts.title + '</p></div>';
    var btn = root.firstChild, box = root.lastChild, syncs = [];
    opts.sync = function () { syncs.forEach(function (f) { f(); }); };
    opts.controls.forEach(function (c) {
      var row = document.createElement('div');
      row.className = 'lab-row';
      if (c.type === 'range') {
        var fmt = c.format || function (v) { return v; };
        row.innerHTML = '<label><span>' + c.label + '</span><b></b></label><input type="range" min="' + c.min + '" max="' + c.max + '" step="' + c.step + '">' +
          (c.ends ? '<div class="lab-ends"><span>' + c.ends[0] + '</span><span>' + c.ends[1] + '</span></div>' : '');
        var input = row.querySelector('input'), out = row.querySelector('b');
        input.value = state[c.key]; out.textContent = fmt(+state[c.key]);
        input.addEventListener('input', function () {
          state[c.key] = +input.value; out.textContent = fmt(+input.value);
          save(opts.store, state); opts.onChange(state, c.key);
        });
        syncs.push(function () { input.value = state[c.key]; out.textContent = fmt(+state[c.key]); });
      } else {
        row.innerHTML = '<label><span>' + c.label + '</span></label><div class="lab-seg"></div>';
        var seg = row.querySelector('.lab-seg');
        c.options.forEach(function (o) {
          var b = document.createElement('button');
          b.type = 'button'; b.textContent = o.label; b.dataset.v = o.value;
          b.className = state[c.key] === o.value ? 'on' : '';
          b.addEventListener('click', function () {
            state[c.key] = o.value;
            seg.querySelectorAll('button').forEach(function (x) { x.className = x.dataset.v === o.value ? 'on' : ''; });
            save(opts.store, state); opts.onChange(state, c.key);
          });
          seg.appendChild(b);
        });
        syncs.push(function () { seg.querySelectorAll('button').forEach(function (x) { x.className = x.dataset.v === state[c.key] ? 'on' : ''; }); });
      }
      box.appendChild(row);
    });
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = !root.classList.contains('open');
      root.classList.toggle('open', open); btn.setAttribute('aria-expanded', open);
    });
    /* ползунок не должен «трогать» сам макет: точки и взгляд помощников его не замечают */
    ['pointerdown', 'pointermove'].forEach(function (t) { root.addEventListener(t, function (e) { e.stopPropagation(); }); });
    document.addEventListener('pointerdown', function (e) {
      if (!root.contains(e.target)) { root.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    });
    document.body.appendChild(root);
    opts.onChange(state);
    return state;
  }

  window.Lab = { panel: panel };
})();
