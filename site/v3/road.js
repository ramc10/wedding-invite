/* Wedding Road — scroll engine.
 *
 * The scene is ONE painted ribbon (road, both verges, every terrain) moved by a
 * single translate3d. Terrain changes are painted into the art, so there is no
 * mask, no cross-fade and no layer handoff anywhere in this file — the class of
 * artefact that produces simply cannot occur.
 *
 * Scroll model: each ribbon segment is one leg, driven at the journey's one
 * constant speed with no hold anywhere — a continuous drive from end to end.
 * A plain divider line marks each leg boundary as it scrolls past. The
 * rendered position is a direct function of scroll position: no lag, no
 * easing, no catching up.
 */
(function () {
  'use strict';

  /* No ceremony copy in this pass — the route is a pure visual drive, with a
   * plain divider line marking each section boundary instead of text. Leg
   * count now comes straight from the ribbon's own segment count (below). */

  /* Scroll model. Legs used to get an equal slice of the page each, but the joins
   * they drive between are not equally spaced along the ribbon — so one leg crawled
   * 280px of world while the next covered 1200px. Instead: one constant world speed
   * everywhere, and a leg is exactly as long as its own drive needs. */
  var SPEED     = 0.75;  // world px per scroll px — the one pace of the whole journey
  var MIN_LEG_VH = 0.55; // no leg is shorter than this, however close its join
  /* Never upscale the painting. Past 1:1 it is both blurry and zoomed so far in that
   * a desktop screen holds only a few hundred ribbon rows — which, now that the page
   * is exactly as long as the drive needs, turned the desktop journey into twenty
   * screens of scrolling. A wide window gets a centred panel instead, feathered at
   * the edges in measure(). */
  var MAX_SCALE = 1.0;
  /* Fit-to-width alone renders the (roughly square) ribbon shorter than a portrait
   * screen — chosen by eye against the real art (see the crop-slider comparison):
   * 23% cropped off each side is the least zoom that still reads as "the garden",
   * not empty ground under it or a tube of road. This is a floor on scale, not an
   * override — see measure(). On a landscape window fitWidth already clears it
   * naturally, so it's a no-op there, same as MAX_SCALE only ever binding on a
   * wide one. */
  var MOBILE_CROP_PCT = 0.23;
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

  /* The browser's own scroll restoration (reload, back/forward, bfcache) drops a
   * fresh visit into the middle of this drive-then-hold spine instead of at the
   * garden opening — reads as the car starting the journey already at the beach,
   * zoomed out to wherever that scroll position's leg happens to sit. This is a
   * single continuous scene keyed entirely off scrollY, not a document the
   * browser should be remembering a reading position in. */
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var R = null, C = [], S = {}, el = {};
  var raf = 0, pd, vsm = 0;
  /* ys mirrors window.scrollY exactly — everything downstream reads ys so effect
   * layers have one source of truth, but there is no lag between the two. */
  var ys = 0;

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
    /* Two masks layered: the horizontal one keeps the smear off the verges: the
     * vertical one — tiled at the same pitch as the noise texture itself — fades
     * each tile toward transparent top and bottom. feTurbulence's stitchTiles
     * does not always tile seamlessly in every browser, and without this a
     * visible line can appear at every repeat as the ribbon scrolls. */
    var edgeFade = 'linear-gradient(90deg, rgba(0,0,0,0) 0%, #000 18%, #000 82%, rgba(0,0,0,0) 100%)';
    var tileFade = 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, #000 8%, #000 92%, rgba(0,0,0,0) 100%)';
    el.streaks.style.webkitMaskImage = el.streaks.style.maskImage = edgeFade + ', ' + tileFade;
    el.streaks.style.webkitMaskSize = el.streaks.style.maskSize = '100% 100%, 100% ' + STREAK_TILE + 'px';
    el.streaks.style.webkitMaskRepeat = el.streaks.style.maskRepeat = 'no-repeat, repeat-y';

    buildRibbon();
    buildLegs();
    measure();
    ys = window.scrollY;
    tick(ys);

    window.addEventListener('scroll', ping, { passive: true });
    window.addEventListener('resize', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  }

  /* ------------------------------------------------------------- build */

  function buildRibbon() {
    var frag = document.createDocumentFragment();
    /* Chunks can finish loading out of order. Revealed one at a time, a late
     * chunk briefly shows the page's dark ground through the gap next to its
     * already-painted neighbour — which reads as a hard seam, not a loading
     * state. Hold the whole ribbon hidden until every chunk has arrived. */
    el.ribbon.style.visibility = 'hidden';
    var loads = [];
    C = R.chunks.map(function (c, i) {
      var img = new Image();
      img.alt = ''; img.decoding = 'async';
      loads.push(new Promise(function (res) { img.onload = img.onerror = res; }));
      img.src = c.src;                              // whole ribbon is small; load it all now
      frag.appendChild(img);

      return { img: img, y: c.y, h: c.h, top: 0, hpx: 0 };
    });
    el.ribbon.appendChild(frag);
    Promise.all(loads).then(function () { el.ribbon.style.visibility = ''; });
  }

  function legCount() {
    /* One leg per painted segment — with no copy to drive the layout, this is
     * the only meaningful boundary left to divide the journey by. */
    return R.segments || R.legs || 3;
  }

  function buildLegs() {
    var n = legCount(), frag = document.createDocumentFragment();
    el.sections = []; el.dividers = [];
    for (var i = 0; i < n; i++) {
      var sec = document.createElement('section');
      sec.className = 'leg';
      frag.appendChild(sec);
      el.sections.push(sec);
    }
    el.legs.appendChild(frag);

    /* One divider per boundary between legs — n-1 of them, none before the
     * first leg or after the last. Lives inside #ribbon itself (positioned in
     * measure(), once native rows are known) rather than the fixed copy layer
     * this route used to have, so it scrolls with the art at no runtime cost. */
    for (var j = 0; j < n - 1; j++) {
      var div = document.createElement('div');
      div.className = 'divider';
      el.ribbon.appendChild(div);
      el.dividers.push(div);
    }
  }

  /* ----------------------------------------------------------- measure */

  function measure() {
    S.vw = window.innerWidth;
    S.vh = window.innerHeight;
    /* Fit-to-viewport zoom is computed against zoomWidth (the normal frame width),
     * not R.width (the ribbon's actual pixel width) — the two differ when a
     * "wide" segment made the canvas wider than the rest of the route for one
     * subject's sake. Scaling to R.width there would shrink the whole journey to
     * fit that one segment's extra margin; instead every segment renders at the
     * same scale, and only the wide one runs past the viewport at the edges,
     * same as any painting wider than the screen already does below. */
    var fitWidth = Math.min(S.vw / (R.zoomWidth || R.width) * ZOOM, MAX_SCALE);
    /* The crop floor below only ever needs to bind on a portrait screen — a
     * landscape window is the "never upscale past 1:1 on desktop" case, and
     * must stay a no-op there.
     *
     * This used to be inferred from whether fitWidth alone already rendered
     * the ribbon taller than the viewport, on the assumption that a short
     * ribbon means portrait and a tall one means landscape. That broke the
     * moment the ribbon grew past ~3 segments (adding garden-lead.png and
     * beach-hills.png took it from 2171px to 3780px): fitWidth's ribbon
     * height now clears every real phone's viewport too, so the proxy read
     * "already tall enough" on portrait screens and silently zeroed the crop
     * — the exact "shows the whole image, no crop" bug this replaced. Read
     * the screen's own shape instead, which doesn't drift as the ribbon
     * grows. */
    var isPortrait = S.vh > S.vw;
    /* rw = vw / (1 - 2*crop) is the render width that leaves exactly MOBILE_CROP_PCT
     * cropped off each side of a vw-wide viewport; dividing by R.width turns that
     * into a scale. */
    var cropFloor = isPortrait ? (S.vw / (1 - 2 * MOBILE_CROP_PCT)) / R.width : 0;
    /* The crop floor above was tuned against the ribbon's size at the time and
     * doesn't grow as more segments are added later — every plate added since
     * shrinks how much of the ribbon's own height that same scale actually
     * reaches. Once the ribbon grew to 6 segments, the crop-floor scale left
     * less total scroll travel (R.height*scale - vh) than where the LAST join
     * itself lands at that same scale: the final leg had nowhere left to
     * drive, and the one before it absorbed the shortfall, collapsing two
     * legs onto the same rest point — a dead stretch of scroll doing nothing.
     * Floor scale again here, at whatever it takes for travel to clear the
     * last join with a full viewport-height of real driving room left over,
     * so this doesn't quietly break again the next time a segment is added. */
    var lastJoin = R.joins && R.joins.length ? R.joins[R.joins.length - 1] : 0;
    /* Solving R.height*scale - vh >= lastJoin*scale + vh for scale: the total
     * travel must clear the last join's own scaled position by at least one
     * more full viewport of real driving room. Gated to portrait only, same
     * as cropFloor — applying this on desktop too would mean upscaling past
     * 1:1 there, which breaks the "never upscale on desktop" rule this file
     * has protected through several rounds already. A short/wide desktop
     * window could in principle hit this same collapse, but that's a rarer,
     * separate case to solve later, not a reason to blur every desktop view. */
    var reachFloor = (isPortrait && lastJoin && R.height > lastJoin) ? (2 * S.vh) / (R.height - lastJoin) : 0;
    S.scale = Math.max(fitWidth, cropFloor, reachFloor);
    S.n = legCount();
    S.rw = R.width * S.scale;
    S.travel = Math.max(1, R.height * S.scale - S.vh);
    S.carY = S.vh * 0.56;

    el.ribbon.style.width = S.rw + 'px';
    el.ribbon.style.marginLeft = (-S.rw / 2) + 'px';
    /* every chunk is absolutely positioned, so without this the box is 0px tall and
     * anything measured against it — the edge mask below — collapses */
    el.ribbon.style.height = (R.height * S.scale) + 'px';
    S.crop = Math.max(0, (S.rw - S.vw) / 2);   // px the zoom hides on each side

    /* On a screen wider than the painting, the ribbon renders as a centred panel
     * with empty ground on both sides. The rail is fixed to the viewport edge, so
     * without this it drifts into that empty margin instead of hugging the art.
     * The padding itself must stay small and fixed here — 3vw of the *viewport*
     * pushes the dots deep into the empty margin instead of just inside the
     * panel's true edge, which is exactly the bug this is fixing. */
    var panelMargin = Math.max(0, (S.vw - S.rw) / 2);
    el.rail.style.right = panelMargin > 0
      ? (panelMargin + 14) + 'px'
      : 'max(14px, 3vw)';

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

    /* Where each leg ends, in travelled px — the ribbon's own segment joins,
     * scaled and offset by the car's line the same way a copy arrival used
     * to be. No text anywhere means no reason to pause at any of them: every
     * leg simply drives into the next at the shared speed. */
    S.rests = [];
    for (var li = 0, prevD = 0; li < S.n; li++) {
      var row = R.joins && R.joins[li];              // joins[i] = start of leg i+1
      var want = row != null ? row * S.scale - S.carY : (li + 1) / S.n * S.travel;
      var least = prevD + S.vh * 0.30;
      prevD = clamp(Math.max(want, least), 0, S.travel);
      S.rests.push(prevD);
    }
    /* The last leg has to end at the end of the ribbon, or whatever is left
     * over is unreachable and the final leg is a dead scroll. */
    S.rests[S.n - 1] = S.travel;

    /* Hand each leg exactly the scroll it needs to drive its own span at the
     * one shared speed. Only the very first leg eases in from a standstill —
     * every other boundary carries speed straight across, since there is
     * nothing to arrive at or hold for anywhere in between. */
    S.legTop = []; S.legDrive = []; S.ein = []; S.eout = []; S.vpeak = [];
    var top = 0;
    for (var lj = 0; lj < S.n; lj++) {
      var span = S.rests[lj] - (lj ? S.rests[lj - 1] : 0);
      var inN = lj === 0 ? 1 : 0;
      /* An ease band gives up half its length of travel, so the drive has to be
       * longer to still cover the span at the shared speed. Solved by iterating
       * twice — band depends on drive, drive on band. */
      var drive = Math.max(S.vh * MIN_LEG_VH, span / SPEED), a = 0, V = 1;
      for (var it = 0; it < 2; it++) {
        var band = Math.min(0.45, S.vh * 0.62 / drive);
        a = inN * band;
        V = 1 / (1 - a / 2);
        drive = Math.max(S.vh * MIN_LEG_VH, span * V / SPEED);
      }
      S.legTop.push(top);
      S.legDrive.push(drive);
      S.ein.push(a); S.eout.push(0); S.vpeak.push(V);
      top += drive;
      el.sections[lj].style.height = Math.round(drive) + 'px';
    }
    /* .pin is zero-height, so the closing screen needs real page under it */
    el.sections[S.n - 1].style.height = Math.round(S.legDrive[S.n - 1] + S.vh) + 'px';

    /* Scroll 0 opens with the car already halfway down leg 0's own drive, not at
     * the road's literal first inch — see tick(). */
    S.leg0HeadStart = S.legDrive[0] / 2;
    S.docLen = top;

    /* Dividers sit at each join's own native row, scaled and panned exactly
     * like a chunk image — a plain child of #ribbon, not a tick()-driven
     * overlay, so they scroll with the art at no runtime cost. */
    el.dividers.forEach(function (div, k) {
      div.style.top = Math.round((R.joins[k] || 0) * S.scale) + 'px';
    });

    var rw = R.roadWidth * S.scale;
    el.streaks.style.width = rw + 'px';
    el.streaks.style.marginLeft = (-rw / 2) + 'px';
    el.carImg.style.width = (rw * CAR_ROAD) + 'px';
    el.clouds.style.backgroundSize = '100% ' + Math.max(900, S.vh * 1.7) + 'px';
    S.cloudTile = Math.max(900, S.vh * 1.7);
  }

  /* A resize changes every derived length — remeasure and redraw against it. */
  var onResize = function () { measure(); ys = window.scrollY; ping(); };

  /* -------------------------------------------------------------- loop */

  function ping() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function frame() {
    raf = 0;
    var y = window.scrollY;

    /* The car's position is a direct function of scroll position, not an
     * animation racing to catch up to it — no glide, no trailing. Scroll stops,
     * the car stops on that same frame; scroll moves, the car moves that same
     * distance, in sync. */
    ys = y;
    tick(ys);

    /* Keep running only while the velocity-driven layers (bob, tilt, streaks)
     * are still settling back to zero after motion stops — the car itself is
     * already at rest by then. */
    if (vsm > 0.004) raf = requestAnimationFrame(frame);
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
    /* The journey opens with the car already at the midpoint of leg 0's drive,
     * not at the road's true first inch — so scroll 0 reads as "already under
     * way in the garden" rather than a dead stop nobody asked to arrive at.
     * Only leg 0 gets this head start; every later leg still measures its own
     * scroll from its own top. */
    if (i === 0) into += S.leg0HeadStart;
    var u = clamp(into / S.legDrive[i], 0, 1);

    var p = curve(u, S.ein[i], S.eout[i], S.vpeak[i]);
    var from = i === 0 ? 0 : S.rests[i - 1];
    var to = S.rests[i];
    var d = RM ? 0 : from + (to - from) * p;
    var prog = S.travel ? d / S.travel : 0;      // 0..1 across the whole journey

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
