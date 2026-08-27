/* Wedding Road — sectioned engine.
 *
 * The difference from the reference build is one idea: a section owns its scroll
 * and its band of the painting. Section i drives from where section i-1 came to
 * rest, to its own stop row, over its own scroll length. Nothing about section 2
 * appears in section 1's arithmetic, so rebuilding one cannot move another.
 *
 * The other change is framing. Fitting the ribbon's width to the window meant a
 * phone saw ~1740 rows of painting per screen and a laptop ~500 — the same art
 * composed completely differently, and the same section driving for one screen on
 * one device and seven on the other. Rows-per-screen is fixed instead; phones come
 * out fitting the width exactly, and wider windows letterbox.
 */
(function () {
  'use strict';

  var REF_ASPECT      = 2.16;  // a portrait phone; the framing every device matches
  var DRIVE_DEFAULT   = 0.55;  // share of a section spent moving; the rest is the hold
  var CAR_LINE        = 0.56;  // where the car sits down the viewport
  var CAR_ROAD        = 0.78;  // car width as a share of the painted road

  var DAY = [
    [0.00, 255, 217, 160, .14],
    [0.35, 255, 244, 214, .07],
    [0.70, 255, 205, 140, .15],
    [1.00, 255, 168, 104, .21]
  ];
  var NOISE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.62'/%3E%3C/svg%3E";

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var R = null, C = [], S = {}, el = {}, raf = 0, hot = 0, lastY = -1, lastSec = -1, pd, vsm = 0;

  window.RoadFX = { d: 0, scale: 1, rw: 0, still: true, ribbon: null, section: 0 };

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  fetch('sections.json').then(function (r) { return r.json(); }).then(start);

  function start(data) {
    R = data;
    window.RoadFX.ribbon = R;
    el.ribbon = $('ribbon'); el.car = $('car');
    el.carImg = document.querySelector('.car-idle');
    el.tint = $('tint'); el.grain = $('grain');
    el.world = document.querySelector('.world'); el.ambient = $('ambient');
    el.sections = $('sections'); el.cue = $('cue');
    el.grain.style.backgroundImage = 'url("' + NOISE + '")';

    buildRibbon();
    buildSections();
    measure();
    tick(window.scrollY);
    window.addEventListener('scroll', ping, { passive: true });
    window.addEventListener('resize', onResize);
  }

  function buildRibbon() {
    var frag = document.createDocumentFragment();
    C = R.chunks.map(function (c, i) {
      var img = new Image();
      img.alt = ''; img.decoding = 'async';
      img.setAttribute('data-src', c.src);
      if (i === 0) img.src = c.src;
      frag.appendChild(img);
      return { img: img, y: c.y, h: c.h, on: i === 0, top: 0, hpx: 0 };
    });
    el.ribbon.appendChild(frag);
  }

  function buildSections() {
    var frag = document.createDocumentFragment();
    el.copies = [];
    R.sections.forEach(function (s) {
      var sec = document.createElement('section');
      sec.className = 'sec';
      sec.setAttribute('data-id', s.id);
      var pin = document.createElement('div'); pin.className = 'pin';
      var copy = document.createElement('div'); copy.className = 'copy';
      if (s.copy) {
        copy.innerHTML = '<p class="place"></p><h2 class="ceremony"></h2><p class="when"></p>';
        copy.querySelector('.place').textContent = s.copy.place || '';
        copy.querySelector('.ceremony').textContent = s.copy.ceremony || '';
        copy.querySelector('.when').textContent = s.copy.when || '';
      }
      pin.appendChild(copy); sec.appendChild(pin); frag.appendChild(sec);
      el.copies.push(copy);
    });
    el.sections.appendChild(frag);
    el.secEls = Array.prototype.slice.call(el.sections.children);
  }

  /* the row a section comes to rest on */
  function restRow(i) {
    var s = R.sections[i];
    return s.stopRow != null ? s.stopRow : s.rows[1];
  }

  function measure() {
    S.vw = window.innerWidth;
    S.vh = window.innerHeight;
    /* Fit width on a portrait phone, letterbox anything wider — either way the same
     * number of painted rows fills the screen. Derived from the frame width, not a
     * constant, so changing the frame cannot silently letterbox the phone too. */
    S.scale = Math.min(S.vw / R.width, S.vh / (R.width * REF_ASPECT));
    S.rw = R.width * S.scale;
    S.maxD = Math.max(0, R.height * S.scale - S.vh);
    S.carY = S.vh * CAR_LINE;

    el.ribbon.style.width = S.rw + 'px';
    el.ribbon.style.marginLeft = (-S.rw / 2) + 'px';
    el.ribbon.style.height = (R.height * S.scale) + 'px';
    var fade = S.rw < S.vw - 2
      ? 'linear-gradient(90deg, rgba(0,0,0,0) 0, #000 40px, #000 calc(100% - 40px), rgba(0,0,0,0) 100%)'
      : 'none';
    el.ribbon.style.webkitMaskImage = el.ribbon.style.maskImage = fade;

    C.forEach(function (c) {
      var t = Math.round(c.y * S.scale), b = Math.round((c.y + c.h) * S.scale);
      c.top = t; c.hpx = b - t;
      c.img.style.top = t + 'px'; c.img.style.height = c.hpx + 'px';
    });

    /* each section's own slice of the page, laid out end to end */
    var y = 0;
    S.secs = R.sections.map(function (s, i) {
      var px = S.vh * (s.scrollVh || 150) / 100;
      var o = { y0: y, px: px, drive: s.drive || DRIVE_DEFAULT,
                from: i === 0 ? s.rows[0] : restRow(i - 1), to: restRow(i) };
      y += px;
      return o;
    });
    S.total = y;
    el.secEls.forEach(function (e, i) {
      e.style.height = S.secs[i].px + 'px';
    });
    /* one screen of tail so the last section's hold is reachable */
    el.sections.style.paddingBottom = S.vh + 'px';

    var rw = R.roadWidth * S.scale;
    el.carImg.style.width = (rw * CAR_ROAD) + 'px';
    S.wide = S.rw < S.vw - 2;
    el.world.classList.toggle('wide', S.wide);
    S.ambIdx = -1;
  }

  var onResize = function () { measure(); lastY = -1; ping(); };
  function ping() { hot = 12; if (!raf) raf = requestAnimationFrame(frame); }
  function frame() {
    raf = 0;
    var y = window.scrollY;
    if (y !== lastY) { lastY = y; hot = 12; tick(y); }
    else if (hot > 0) hot--;
    if (hot > 0) raf = requestAnimationFrame(frame);
  }

  function trackAt(t, nativeY) {
    if (!t) return 0;
    var v = t.values, f = nativeY / t.step;
    var i = clamp(Math.floor(f), 0, v.length - 1);
    var j = Math.min(v.length - 1, i + 1);
    return v[i] + (v[j] - v[i]) * (f - i);
  }

  function copyAlpha(t, last) {
    if (t < .42) return 0;
    if (t < .54) return (t - .42) / .12;
    if (last || t < .93) return 1;
    return Math.max(0, 1 - (t - .93) / .06);
  }

  function tick(y) {
    var n = S.secs.length, i = 0;
    while (i < n - 1 && y >= S.secs[i].y0 + S.secs[i].px) i++;
    var s = S.secs[i];
    var t = clamp((y - s.y0) / s.px, 0, 1);
    var u = Math.min(1, t / s.drive);
    var p = 1 - Math.pow(1 - u, 3);

    var row = s.from + (s.to - s.from) * p;
    var d = RM ? 0 : clamp(row * S.scale - S.carY, 0, S.maxD);

    el.ribbon.style.transform = 'translate3d(0,' + (-d).toFixed(2) + 'px,0)';

    for (var k = 0; k < C.length; k++) {
      var c = C[k];
      if (c.on) continue;
      var top = c.top - d;
      if (top < S.vh * 1.05 && top + c.hpx > -S.vh * 0.6) {
        c.img.src = c.img.getAttribute('data-src');
        c.on = true;
      }
    }

    if (S.wide) {
      /* follow the chunk under the car; only reassign when it actually changes */
      var ai = 0;
      for (var q = 0; q < C.length; q++) if (C[q].top <= d + S.carY) ai = q;
      if (ai !== S.ambIdx && C[ai].on) {
        S.ambIdx = ai;
        el.ambient.src = C[ai].img.getAttribute('data-src');
      }
    }

    var v = pd === undefined ? 0 : Math.abs(d - pd);
    pd = d;
    vsm = vsm * .68 + Math.min(1, v / (S.vh * .018)) * .32;
    var vs = vsm < .01 ? 0 : vsm;

    var cx = trackAt(R.roadCentre, (d + S.carY) / S.scale) * S.scale;
    el.car.style.transform =
      'translate3d(' + cx.toFixed(2) + 'px,' + (-5 * vs).toFixed(2) + 'px,0) ' +
      'rotate(' + (Math.sin(d / (S.vh * .7)) * 1.6 * vs).toFixed(3) + 'deg)';

    window.RoadFX.d = d;
    window.RoadFX.scale = S.scale;
    window.RoadFX.rw = S.rw;
    window.RoadFX.still = vs === 0;
    window.RoadFX.section = i;

    daylight(S.total ? y / S.total : 0);

    if (el.copies[i]) {
      var a = copyAlpha(t, i === n - 1);
      el.copies[i].style.opacity = a.toFixed(3);
      el.copies[i].style.transform = 'translate3d(0,' + ((1 - a) * 16).toFixed(1) + 'px,0)';
    }
    if (lastSec !== i && lastSec >= 0 && el.copies[lastSec]) {
      el.copies[lastSec].style.opacity = '0';
    }
    lastSec = i;
    el.cue.style.opacity = y > S.vh * .35 ? '0' : '1';
  }

  function daylight(f) {
    f = clamp(f, 0, 1);
    var i = 0;
    while (i < DAY.length - 2 && f > DAY[i + 1][0]) i++;
    var a = DAY[i], b = DAY[i + 1];
    var t = clamp((f - a[0]) / (b[0] - a[0]), 0, 1);
    var L = function (j) { return a[j] + (b[j] - a[j]) * t; };
    el.tint.style.backgroundColor =
      'rgba(' + Math.round(L(1)) + ',' + Math.round(L(2)) + ',' + Math.round(L(3)) + ',' + L(4).toFixed(3) + ')';
  }
})();
