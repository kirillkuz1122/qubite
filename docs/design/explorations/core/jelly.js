/* «Желе»: рисует мягкие объёмные фигуры одним способом — тело с градиентом,
   внутренний блик сверху, тень снизу и пятно отражения. Всё статично: двигаем только transform. */
(function () {
  'use strict';
  var JELLY = {
    orange: { c: '#ff9852', hi: '#ffc699', lo: '#e8702f' },
    ink: { c: '#24333f', hi: '#55687a', lo: '#121b24' },
    sky: { c: '#42b2f2', hi: '#a6e0ff', lo: '#1f8ccf' },
    yellow: { c: '#ffe163', hi: '#fff4bd', lo: '#efc232' },
    white: { c: '#ffffff', hi: '#ffffff', lo: '#d3e9f8' },
    green: { c: '#7fd89a', hi: '#c6f2d2', lo: '#4fb873' },
    coral: { c: '#ff8a5c', hi: '#ffc0a4', lo: '#e8623a' }
  };
  var uid = 0;
  /* path — контур фигуры в своих координатах (w×h); spec — где пятно отражения */
  function svg(path, w, h, color, o) {
    o = o || {};
    var j = JELLY[color] || color;
    var id = 'j' + (++uid);
    var sx = o.specX == null ? 0.3 : o.specX, sy = o.specY == null ? 0.16 : o.specY;
    return '<defs>' +
      '<linearGradient id="' + id + 'b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + j.hi + '"/><stop offset=".42" stop-color="' + j.c + '"/><stop offset="1" stop-color="' + j.lo + '"/></linearGradient>' +
      '<radialGradient id="' + id + 'g" cx="' + sx + '" cy="' + (sy + 0.06) + '" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="' + id + 's"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="' + id + 'r" x1="0" y1="0" x2="0" y2="1"><stop offset=".6" stop-color="' + j.lo + '" stop-opacity="0"/><stop offset="1" stop-color="' + j.lo + '" stop-opacity=".55"/></linearGradient>' +
      '</defs>' +
      '<path d="' + path + '" fill="url(#' + id + 'b)"/>' +
      '<path d="' + path + '" fill="url(#' + id + 'g)"/>' +
      '<path d="' + path + '" fill="url(#' + id + 'r)"/>' +
      '<ellipse cx="' + (w * sx) + '" cy="' + (h * sy) + '" rx="' + (w * (o.specW || 0.16)) + '" ry="' + (Math.min(h, w) * (o.specH || 0.08)) + '" fill="url(#' + id + 's)" transform="rotate(' + (o.specRot || -18) + ' ' + (w * sx) + ' ' + (h * sy) + ')"/>';
  }
  function rr(w, h, rt, rb) {
    return 'M0 ' + rt + 'A' + rt + ' ' + rt + ' 0 0 1 ' + rt + ' 0H' + (w - rt) + 'A' + rt + ' ' + rt + ' 0 0 1 ' + w + ' ' + rt +
      'V' + (h - rb) + 'A' + rb + ' ' + rb + ' 0 0 1 ' + (w - rb) + ' ' + h + 'H' + rb + 'A' + rb + ' ' + rb + ' 0 0 1 0 ' + (h - rb) + 'Z';
  }
  /* Мягкая капсула, которая тянется без искажения скруглений:
     левый край, середина и правый край двигаются отдельно (только transform). */
  function pill(el, o) {
    o = o || {};
    var H = o.h || el.offsetHeight, r = H / 2;
    el.classList.add('pill3');
    el.innerHTML = '<i class="l"></i><i class="m"></i><i class="r"></i>' + el.innerHTML;
    var l = el.querySelector('.l'), m = el.querySelector('.m'), rt = el.querySelector('.r');
    var left = Q.spring(o.left || 0, o.massL || 0.8), right = Q.spring(o.right || H, o.massR || 0.8);
    var draw = Q.render(function () {
      var a = left.x, b = Math.max(left.x + H, right.x);
      l.style.transform = 'translateX(' + a.toFixed(2) + 'px)';
      rt.style.transform = 'translateX(' + (b - H).toFixed(2) + 'px)';
      m.style.transform = 'translateX(' + (a + r).toFixed(2) + 'px) scaleX(' + Math.max(0.001, b - a - H).toFixed(2) + ')';
    });
    left.cb = right.cb = draw;
    draw();
    return { left: left, right: right, draw: draw,
      /* при движении передний край летит первым, задний догоняет — капля вытягивается */
      moveTo: function (a, b) {
        var fwd = a > left.goal;
        left.m = fwd ? 1.5 : 0.55; right.m = fwd ? 0.55 : 1.5;
        left.to(a); right.to(b);
      } };
  }
  window.Jelly = { colors: JELLY, svg: svg, rr: rr, pill: pill };
})();
