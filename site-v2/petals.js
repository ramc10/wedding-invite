/* Blossom drifting over the garden.
 *
 * Deliberately quiet: a few dozen petals, small, low contrast, and confined to the
 * ribbon rows the manifest marks as garden. They sit below the car in the stack, so
 * they never cross the one thing the eye rests on.
 *
 * Petals ride the ground — their position lives in the same travelled-px space as
 * the ribbon — but lag it slightly, which is what reads as "in the air" rather than
 * painted on. Reduced motion removes them entirely.
 */
(function () {
  'use strict';

  var MAX_DPR   = 2;
  var LAG       = 0.16;   // share of ground motion a petal does not keep up with
  var FADE_ROWS = 260;    // ribbon rows over which a zone eases in and out
  var FPS       = 30;     // slow drift needs no more, and holds cost half as much
  var TINTS = ['#F6DDE3', '#FFF4E8', '#F0A2BD', '#FBE7C6'];

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var cv, cx, W = 0, H = 0, dpr = 1, ps = [], last = 0, prevD = 0, raf = 0;

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function make(fx) {
    var fx2 = fx === undefined ? Math.random() : fx;
    return {
      x: rnd(0.03, 0.97),                  // 0..1 across the ribbon, inside its feather
      y: fx2,                              // 0..1 down the viewport, at spawn
      py: 0,                               // accumulated lag, in travelled px
      size: rnd(2.6, 6.2),
      spin: rnd(-1.1, 1.1),
      phase: rnd(0, 6.28),
      wob: rnd(0.7, 1.5),
      driftX: rnd(-7, 5),                  // px/s of its own wind
      driftY: rnd(5, 16),
      tint: TINTS[(Math.random() * TINTS.length) | 0],
      alpha: rnd(0.35, 0.8)
    };
  }

  function resize() {
    var fx = window.RoadFX;
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var want = Math.round(Math.min(46, Math.max(20, (W * H) / 24000)));
    while (ps.length < want) ps.push(make());
    ps.length = want;
    if (fx) prevD = fx.d;
  }

  /* 0 outside every garden stretch, 1 well inside one */
  function zoneAlpha(fx) {
    var z = fx.zones || (fx.zones = (fx.ribbon.sections || [])
      .filter(function (s) { return s.petals; })
      .map(function (s) { return s.rows; }));
    if (!z || !z.length) return 0;
    var top = fx.d / fx.scale, bot = (fx.d + H) / fx.scale;
    var best = 0;
    for (var i = 0; i < z.length; i++) {
      var over = Math.min(bot, z[i][1]) - Math.max(top, z[i][0]);
      if (over > 0) best = Math.max(best, Math.min(1, over / FADE_ROWS));
    }
    return best;
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - last < 1000 / FPS) return;
    var dt = Math.min(0.1, (t - last) / 1000); last = t;

    var fx = window.RoadFX;
    if (!fx || !fx.ribbon) return;

    var za = zoneAlpha(fx);
    if (za <= 0.001) {
      if (cv.style.opacity !== '0') cv.style.opacity = '0';
      prevD = fx.d;
      return;
    }
    if (cv.style.opacity !== '1') cv.style.opacity = '1';

    var dd = fx.d - prevD; prevD = fx.d;
    /* the ribbon is a portrait column on a wide screen — petals stay on it */
    var rw = fx.rw || W, x0 = (W - rw) / 2;
    cx.clearRect(0, 0, W, H);

    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      p.py += dd * LAG + p.driftY * dt;     // lag behind the ground, plus its own fall
      p.x  += (p.driftX * dt) / rw;
      p.phase += p.spin * dt;

      var sy = p.y * H + p.py;
      if (sy < -30 || sy > H + 30 || p.x < 0.01 || p.x > 0.99) {
        ps[i] = make(dd >= 0 ? -0.04 : 1.04);   // re-enter from the edge we came from
        continue;
      }

      // an ellipse whose width breathes reads as a petal tumbling, at no cost
      var w = p.size * (0.3 + 0.7 * Math.abs(Math.sin(p.phase * p.wob)));
      cx.globalAlpha = p.alpha * za;
      cx.fillStyle = p.tint;
      cx.beginPath();
      cx.ellipse(x0 + p.x * rw, sy, w, p.size, p.phase, 0, 6.2832);
      cx.fill();
    }
    cx.globalAlpha = 1;
  }

  function start() {
    if (!window.RoadFX || !window.RoadFX.ribbon) return setTimeout(start, 120);
    cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:fixed;inset:0;z-index:7;pointer-events:none;' +
                       'opacity:0;transition:opacity .6s ease';
    document.body.appendChild(cv);
    cx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(frame);
  }

  start();
})();
