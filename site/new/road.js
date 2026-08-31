/* Wedding Road — scroll engine.
 *
 * The scene is ONE painted ribbon (road, both verges, every terrain) moved by a
 * single translate3d. Terrain changes are painted into the art, so there is no
 * mask, no cross-fade and no layer handoff anywhere in this file — the class of
 * artefact that produces simply cannot occur.
 *
 * Scroll model: each stop is one leg. A leg is exactly as long as it needs to cover
 * its own stretch of ribbon at the journey's one constant speed, then holds still
 * while the copy is read — but only if it has copy. The rendered position trails the
 * real scroll position, so a wheel notch or a flicked thumb glides rather than jumps.
 */
(function () {
  'use strict';

  /* Ceremony copy. Empty until the stops are confirmed — the leg count then comes
   * from the ribbon's segment count instead. To add copy, push one object per
   * stop: { place, ceremony, when } or { hero } for the opening card. */
  var STOPS = [
    { hero: 'Bhavya & Ramcharan', city: 'Bengaluru' },
    { city: 'Visakhapatnam',                     // the beach
      events: [
        { name: 'Reception', when: '17th November at 7 PM' },
        { name: 'Haldi',     when: '18th November at 9 AM' },
        { name: 'Wedding',   when: '18th November at 8:30 PM' }
      ] },
    {},                                          // the lake — a quiet stretch
    { city: 'Karimnagar',                        // the dam
      events: [
        { name: 'Reception', when: '21st November at 7:30 PM' }
      ] },
    { hero: 'The Beginning' }                    // the closing garden
  ];

  /* Scroll model. Legs used to get an equal slice of the page each, but the stops
   * they drive between are not equally spaced along the ribbon — so one leg crawled
   * 280px of world while the next covered 1200px, and three of the five spent their
   * back half completely frozen. Instead: one constant world speed everywhere, and
   * a leg is exactly as long as its drive needs, plus a hold only where there is
   * something to read. */
  var SPEED     = 0.75;  // world px per scroll px — the one pace of the whole journey
  var HOLD_VH   = 0.26;  // arrival hold, in viewports, at stops that carry copy
  var MIN_LEG_VH = 0.55; // no leg is shorter than this, however close its stop
  var GLIDE     = 0.115; // per-16ms share of the gap to the true scroll position
  /* Never upscale the painting. Past 1:1 it is both blurry and zoomed so far in that
   * a desktop screen holds only a few hundred ribbon rows — which, now that the page
   * is exactly as long as the drive needs, turned the desktop journey into twenty
   * screens of scrolling. A wide window gets a centred panel instead, feathered at
   * the edges in measure(). */
  var MAX_SCALE = 1.0;
  var ZOOM      = 1.0;   /* fit to width — no runtime crop */
  var CAR_ROAD  = 0.78;  // car width as a share of the painted road
  var STREAK_LEAD = 1.12;
  var STREAK_TILE = 420;
  var DAY_SPAN  = 0.55;  // how far along the daylight schedule the journey travels

  /* time of day — [at, tintRGB, tintA, duskRGB, duskA] */
  var DAY = [
    [0.00, 255, 217, 160, .14,  20, 26, 40, .00],
    [0.18, 255, 240, 204, .09,  20, 26, 40, .00],
    [0.40, 255, 248, 232, .05,  20, 26, 40, .00],
    [0.62, 255, 192, 120, .17,  46, 30, 32, .05],
    [0.80, 255, 154,  90, .22,  34, 26, 46, .14],
    [0.92, 118, 116, 186, .26,  16, 18, 40, .30],
    [1.00,  74,  92, 150, .30,  10, 12, 30, .42]
  ];

  var NOISE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.62'/%3E%3C/svg%3E";
  /* wide, very tall cells — reads as smear along the direction of travel, not grain */
  var SMEAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='420'%3E%3Cfilter id='s'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.03 0.006' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='420' filter='url(%23s)' opacity='.7'/%3E%3C/svg%3E";

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var R = null, C = [], S = {}, el = {};
  var raf = 0, lastLeg = -1, pd, vsm = 0;
  /* ys trails window.scrollY. Everything downstream reads ys, so a wheel notch or a
   * flicked thumb — both of which arrive as a jump, not a sweep — still glides. */
  var ys = 0, prevT = 0;

  /* A small read-only surface for optional effect layers, so they never have to
   * parse values back out of the ribbon's transform. */
  window.RoadFX = { d: 0, scale: 1, still: true, ribbon: null };

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  fetch('ribbon.json').then(function (r) { return r.json(); }).then(start);

  function start(data) {
    R = data;
    window.RoadFX.ribbon = R;
    el.ribbon = $('ribbon'); el.streaks = $('streaks'); el.clouds = $('clouds');
    el.car = $('car'); el.carImg = document.querySelector('.car-idle');
    el.tint = $('tint'); el.dusk = $('dusk'); el.grain = $('grain');
    el.legs = $('legs'); el.rail = $('rail'); el.cue = $('cue');

    el.grain.style.backgroundImage = 'url("' + NOISE + '")';
    el.streaks.style.backgroundImage = 'url("' + SMEAR + '")';
    el.streaks.style.backgroundRepeat = 'repeat-y';
    el.streaks.style.backgroundSize = '100% ' + STREAK_TILE + 'px';
    el.streaks.style.webkitMaskImage = el.streaks.style.maskImage =
      'linear-gradient(90deg, rgba(0,0,0,0) 0%, #000 18%, #000 82%, rgba(0,0,0,0) 100%)';

    buildRibbon();
    buildLegs();
    measure();
    ys = window.scrollY;                        // a reload mid-page must not glide in
    tick(ys);

    window.addEventListener('scroll', ping, { passive: true });
    window.addEventListener('resize', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  }

  /* ------------------------------------------------------------- build */

  function buildRibbon() {
    var frag = document.createDocumentFragment();
    C = R.chunks.map(function (c, i) {
      var img = new Image();
      img.alt = ''; img.decoding = 'async';
      img.setAttribute('data-src', c.src);
      if (i === 0) img.src = c.src;                 // above the fold, load it now
      frag.appendChild(img);

      return { img: img, y: c.y, h: c.h, on: i === 0, top: 0, hpx: 0 };
    });
    el.ribbon.appendChild(frag);
  }

  function legCount() {
    return (R.stops && R.stops.length) || STOPS.length || R.legs || R.segments || 3;
  }



  function buildLegs() {
    var n = legCount(), frag = document.createDocumentFragment(), rail = document.createDocumentFragment();
    el.copies = []; el.sections = []; el.hasCopy = [];
    var cframe = document.createElement('div');
    cframe.className = 'copy-layer';
    for (var i = 0; i < n; i++) {
      var sec = document.createElement('section');
      sec.className = 'leg';
      var copy = document.createElement('div'); copy.className = 'copy';
      var s = STOPS[i] || {};
      if (s.hero) {
        copy.classList.add('centred');           // only the opening line is centred
        var hp = document.createElement('p');
        hp.className = 'hero';
        hp.textContent = s.hero;
        copy.appendChild(hp);
      } else if (s.events) {
        var list = document.createElement('ul');
        list.className = 'events';
        s.events.forEach(function (e) {
          var li = document.createElement('li');
          var nm = document.createElement('span'); nm.className = 'ev-name'; nm.textContent = e.name;
          var wh = document.createElement('span'); wh.className = 'ev-when'; wh.textContent = e.when;
          li.appendChild(nm); li.appendChild(wh);
          list.appendChild(li);
        });
        copy.appendChild(list);
      }
      if (s.city) {
        var ct = document.createElement('span');
        ct.className = 'city';
        ct.textContent = s.city;
        copy.appendChild(ct);
      }
      /* The copy lives in a fixed layer, not inside its section. A block now stays up
       * until the next one is ready to take over, which is well past the end of its
       * own section — and a sticky element cannot outlive its parent's scroll range,
       * so the text used to slide away up the screen instead of holding still. */
      cframe.appendChild(copy);
      frag.appendChild(sec);
      el.copies.push(copy);
      el.sections.push(sec);
      /* a leg holds only if it has something to hold for */
      el.hasCopy.push(!!(s.hero || s.events));
      rail.appendChild(document.createElement('i'));
    }
    el.legs.appendChild(frag);
    document.body.appendChild(cframe);
    el.rail.appendChild(rail);
    el.dots = Array.prototype.slice.call(el.rail.children);
  }

  /* ----------------------------------------------------------- measure */

  function measure() {
    S.vw = window.innerWidth;
    S.vh = window.innerHeight;
    S.scale = Math.min(S.vw / R.width * ZOOM, MAX_SCALE);
    S.rw = R.width * S.scale;
    S.travel = Math.max(1, R.height * S.scale - S.vh);
    S.n = legCount();
    S.carY = S.vh * 0.56;

    el.ribbon.style.width = S.rw + 'px';
    el.ribbon.style.marginLeft = (-S.rw / 2) + 'px';
    /* every chunk is absolutely positioned, so without this the box is 0px tall and
     * anything measured against it — the edge mask below — collapses */
    el.ribbon.style.height = (R.height * S.scale) + 'px';
    S.crop = Math.max(0, (S.rw - S.vw) / 2);   // px the zoom hides on each side

    /* On a screen wider than the painting we show it as a centred panel rather
     * than upscaling it to blur. Feather the crop so it settles into the ground
     * instead of ending on two hard vertical lines. */
    var fade = S.rw < S.vw - 2
      ? 'linear-gradient(90deg, rgba(0,0,0,0) 0, #000 42px, #000 calc(100% - 42px), rgba(0,0,0,0) 100%)'
      : 'none';
    el.ribbon.style.webkitMaskImage = el.ribbon.style.maskImage = fade;

    /* round to whole pixels so adjacent chunks share an exact edge — a fractional
     * height here is what would show up as a hairline seam across the scene */
    C.forEach(function (c) {
      var t = Math.round(c.y * S.scale);
      var b = Math.round((c.y + c.h) * S.scale);
      c.top = t; c.hpx = b - t;
      c.img.style.top = t + 'px';
      c.img.style.height = c.hpx + 'px';
    });

    /* Where each leg comes to rest, in travelled px. The ribbon names the rows worth
     * stopping at; anchoring one to the car's line puts the subject beside the car
     * when the world stops. Without stops this is an even division, which lands
     * arrivals wherever they fall — usually on filler.
     *
     * A stop can still be unreachable: fitting the ribbon to width means a narrow
     * screen scales it down and shows far more rows per screen than a wide one, so
     * a row that sits beside the car on a desktop is already behind it on a phone.
     * Every leg therefore has to advance regardless, or its drive is dead. */
    S.rests = [];
    for (var li = 0, prevD = 0; li < S.n; li++) {
      var row = R.stops && R.stops[li];
      var want = row != null ? row * S.scale - S.carY : (li + 1) / S.n * S.travel;
      var least = prevD + S.vh * 0.30;
      prevD = clamp(Math.max(want, least), 0, S.travel);
      S.rests.push(prevD);
    }
    /* The last stop has to be the end of the ribbon, or whatever is left over is
     * unreachable and the final leg is a dead scroll. */
    S.rests[S.n - 1] = S.travel;

    /* Now hand each leg exactly the scroll it needs to drive its own span at the
     * one shared speed, plus its hold. Legs are no longer the same height.
     *
     * A leg pulls away from a standstill only where the leg before it stopped, and
     * comes to one only where it has something to arrive at; elsewhere the speed is
     * carried straight across the join. The ease bands are a fixed length in px, not
     * a share of the leg — as a share, a long leg spent its first thousand pixels
     * still accelerating, which reads as sluggish rather than as pulling away. */
    S.legTop = []; S.legLen = []; S.legDrive = []; S.ein = []; S.eout = []; S.vpeak = [];
    var top = 0;
    for (var lj = 0; lj < S.n; lj++) {
      var span = S.rests[lj] - (lj ? S.rests[lj - 1] : 0);
      var inN = (lj === 0 || el.hasCopy[lj - 1]) ? 1 : 0;
      var outN = (el.hasCopy[lj] || lj === S.n - 1) ? 1 : 0;
      /* An ease band gives up half its length of travel, so the drive has to be
       * longer to still cover the span at the shared speed. Solved by iterating
       * twice — band depends on drive, drive on band. */
      var drive = Math.max(S.vh * MIN_LEG_VH, span / SPEED), a = 0, c = 0, V = 1;
      for (var it = 0; it < 2; it++) {
        var band = Math.min(0.45, S.vh * 0.62 / drive);
        a = inN * band; c = outN * band;
        V = 1 / (1 - a / 2 - c / 2);
        drive = Math.max(S.vh * MIN_LEG_VH, span * V / SPEED);
      }
      /* No hold at a leg with nothing to read — it drives straight into the next,
       * so any pause here would be a stall with no reason behind it. */
      var hold = el.hasCopy[lj] ? S.vh * HOLD_VH : 0;
      S.legTop.push(top);
      S.legDrive.push(drive);
      S.ein.push(a); S.eout.push(c); S.vpeak.push(V);
      S.legLen.push(drive + hold);
      top += drive + hold;
      el.sections[lj].style.height = Math.round(drive + hold) + 'px';
    }
    /* .pin is zero-height, so the closing screen needs real page under it */
    el.sections[S.n - 1].style.height = Math.round(S.legLen[S.n - 1] + S.vh) + 'px';

    /* When each block of copy shows and hides, in scroll px.
     *
     * Keyed to scroll rather than to a share of its leg, because legs are no longer
     * the same length — and keyed to scroll rather than to distance travelled,
     * because two stops can sit close together on the ribbon yet far apart on the
     * page. A block used to disappear at its own leg's boundary, long before the
     * next block's leg had driven far enough to show anything, which left a wide
     * stretch of the journey with nothing to read. Now a block holds until the next
     * one is about to arrive, and only then hands over.
     */
    var restY = [];
    for (var ri = 0; ri < S.n; ri++) restY.push(S.legTop[ri] + S.legDrive[ri]);
    S.showA = []; S.showB = []; S.hideA = []; S.hideB = [];
    for (var ci = 0; ci < S.n; ci++) {
      var sA = restY[ci] - S.vh * 0.58, sB = restY[ci] - S.vh * 0.12;
      /* the next block that actually has something to say — an empty leg in between
       * is not a reason to clear the screen */
      var nxt = Infinity;
      for (var cj = ci + 1; cj < S.n; cj++) {
        if (el.hasCopy[cj]) { nxt = restY[cj] - S.vh * 0.58; break; }
      }
      /* Clear exactly as the next block starts to arrive — any later and two
       * different texts ghost over each other in the same corner of the screen.
       *
       * A block with no successor also clears in time to leave the closing stretch
       * of art to itself — unless it belongs to the final leg, where the page ends
       * on the hold it arrives at and there is nothing left to leave clear. */
      var endCap = ci === S.n - 1 ? Infinity : top - S.vh * 0.35;
      var hB = Math.min(restY[ci] + S.vh * 2.4, nxt, endCap);
      var hA = Math.max(sB + S.vh * 0.05, hB - S.vh * 0.42);
      S.showA.push(sA); S.showB.push(sB);
      S.hideA.push(hA); S.hideB.push(Math.max(hA + 1, hB));
    }
    S.docLen = top;

    var rw = R.roadWidth * S.scale;
    el.streaks.style.width = rw + 'px';
    el.streaks.style.marginLeft = (-rw / 2) + 'px';
    el.carImg.style.width = (rw * CAR_ROAD) + 'px';
    el.clouds.style.backgroundSize = '100% ' + Math.max(900, S.vh * 1.7) + 'px';
    S.cloudTile = Math.max(900, S.vh * 1.7);
  }

  /* A resize changes every derived length, so there is nothing to glide from —
   * snap to the true position and redraw. */
  var onResize = function () { measure(); ys = window.scrollY; ping(); };

  /* -------------------------------------------------------------- loop */

  function ping() {
    if (!raf) { prevT = 0; raf = requestAnimationFrame(frame); }
  }

  function frame(now) {
    raf = 0;
    var y = window.scrollY;

    if (RM) { ys = y; tick(ys); return; }

    /* Frame-rate independent easing: GLIDE is defined per 60fps frame, so a 120Hz
     * screen must take smaller bites and a stuttering one larger, or the world
     * drifts at a different speed on every device. */
    var dt = prevT ? Math.min(64, now - prevT) : 16.67;
    prevT = now;
    var k = 1 - Math.pow(1 - GLIDE, dt / 16.67);

    var gap = y - ys;
    ys += gap * k;
    if (Math.abs(y - ys) < 0.35) ys = y;        // land exactly, don't creep forever

    tick(ys);

    /* Keep running while the world is still catching up, and for a moment after,
     * so the velocity-driven layers have time to settle back to zero. */
    if (ys !== y || vsm > 0.004) raf = requestAnimationFrame(frame);
  }

  /* sample one of the ribbon's per-row tracks at a given native row */
  function trackAt(track, nativeY) {
    if (!track) return 0;
    var v = track.values;
    var f = nativeY / track.step;
    var i = clamp(Math.floor(f), 0, v.length - 1);
    var j = Math.min(v.length - 1, i + 1);
    return v[i] + (v[j] - v[i]) * (f - i);
  }

  /* Distance travelled, 0..1, for a trapezoid speed profile: ease up over the first
   * `a`, hold V flat, ease down over the last `c`. The ramps are themselves
   * smoothstepped, so acceleration starts and ends at zero and there is no kick at
   * either corner. Where a band is 0 the leg simply enters or leaves at full speed. */
  function curve(x, a, c, V) {
    if (a > 0 && x < a) { var s = x / a; return V * a * (s * s * s - s * s * s * s / 2); }
    if (c > 0 && x > 1 - c) { var q = (1 - x) / c; return 1 - V * c * (q * q * q - q * q * q * q / 2); }
    return V * (a / 2 + (x - a));
  }

  /* smooth 0..1 across [a,b], flat outside it */
  function ramp(x, a, b) {
    var s = clamp((x - a) / (b - a), 0, 1);
    return s * s * (3 - 2 * s);
  }

  function tick(y) {
    var n = S.n;
    var i = 0;
    while (i < n - 1 && y >= S.legTop[i + 1]) i++;
    var into = y - S.legTop[i];
    var u = clamp(into / S.legDrive[i], 0, 1);

    var p = curve(u, S.ein[i], S.eout[i], S.vpeak[i]);
    var from = i === 0 ? 0 : S.rests[i - 1];
    var to = S.rests[i];
    var d = RM ? 0 : from + (to - from) * p;
    var prog = S.travel ? d / S.travel : 0;      // 0..1 across the whole journey

    /* attach chunk art only as the drive brings it near */
    for (var k = 0; k < C.length; k++) {
      var c = C[k];
      var top = c.top - d;
      /* just over one viewport of lookahead — enough that art is always decoded
       * before it arrives, without paying for the whole journey at first paint */
      if (top < S.vh * 1.05 && top + c.hpx > -S.vh * 0.6 && !c.on) {
        c.img.src = c.img.getAttribute('data-src');
        c.on = true;
      }
    }

    /* measured speed — everything reactive keys off this, so it all settles to
     * zero during every arrival hold rather than merely looking slow */
    var v = pd === undefined ? 0 : Math.abs(d - pd);
    pd = d;
    vsm = vsm * .68 + Math.min(1, v / (S.vh * .013)) * .32;
    var vs = vsm < .01 ? 0 : vsm;

    /* Zoom hides S.crop px off each side. Where a segment's subject runs to the
     * frame edge — the dam does — slide the window toward it, giving up the emptier
     * side instead of cutting the subject in half. */
    var pan = trackAt(R.bias, (d + S.vh / 2) / S.scale) * S.crop;
    el.ribbon.style.transform =
      'translate3d(' + (-pan).toFixed(2) + 'px,' + (-d).toFixed(2) + 'px,0)';

    /* the car keeps to the painted road even where it wanders, and rides the pan */
    var cx = trackAt(R.roadCentre, (d + S.carY) / S.scale) * S.scale - pan;
    el.car.style.transform =
      'translate3d(' + cx.toFixed(2) + 'px,' + (-5 * vs).toFixed(2) + 'px,0) ' +
      'rotate(' + (Math.sin(d / (S.vh * .7)) * 1.6 * vs).toFixed(3) + 'deg)';

    if (!RM) {
      el.streaks.style.opacity = (vs * .5).toFixed(3);
      el.streaks.style.transform =
        'translate3d(' + cx.toFixed(2) + 'px,' +
        (-((d * STREAK_LEAD) % STREAK_TILE)).toFixed(2) + 'px,0)';
      el.clouds.style.transform =
        'translate3d(0,' + (-((d * .055) % S.cloudTile)).toFixed(2) + 'px,0)';
    }

    window.RoadFX.d = d;
    window.RoadFX.scale = S.scale;
    window.RoadFX.still = vs === 0;

    daylight(prog * DAY_SPAN);

    /* Copy + rail. Every block is driven from the same scroll position rather than
     * only the current leg's, so one can still be on screen while its leg is behind
     * us — which is the whole point: it holds until the next one takes over. */
    for (var ci = 0; ci < n; ci++) {
      if (!el.hasCopy[ci]) continue;
      var a = ramp(y, S.showA[ci], S.showB[ci]) * (1 - ramp(y, S.hideA[ci], S.hideB[ci]));
      var st = el.copies[ci].style;
      if (a === 0 && st.opacity === '0') continue;      // already parked
      st.opacity = a.toFixed(3);
      st.transform = 'translate3d(0,' + ((1 - a) * 16).toFixed(1) + 'px,0)';
    }
    if (lastLeg !== i) {
      el.dots.forEach(function (dot, k) { dot.classList.toggle('on', k === i); });
      lastLeg = i;
    }
    el.cue.style.opacity = y > S.vh * .35 ? '0' : '1';
  }

  function daylight(f) {
    f = clamp(f, 0, 1);
    var i = 0;
    while (i < DAY.length - 2 && f > DAY[i + 1][0]) i++;
    var a = DAY[i], b = DAY[i + 1];
    var t = clamp((f - a[0]) / (b[0] - a[0]), 0, 1);
    var L = function (j) { return a[j] + (b[j] - a[j]) * t; };
    el.tint.style.backgroundColor = 'rgba(' + Math.round(L(1)) + ',' + Math.round(L(2)) + ',' + Math.round(L(3)) + ',' + L(4).toFixed(3) + ')';
    el.dusk.style.backgroundColor = 'rgba(' + Math.round(L(5)) + ',' + Math.round(L(6)) + ',' + Math.round(L(7)) + ',' + L(8).toFixed(3) + ')';
  }
})();
