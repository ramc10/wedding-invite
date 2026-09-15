/* Wedding Road — scroll engine.
 *
 * The scene is ONE painted ribbon (road, both verges, every terrain) moved by a
 * single translate3d. Terrain changes are painted into the art, so there is no
 * mask, no cross-fade and no layer handoff anywhere in this file — the class of
 * artefact that produces simply cannot occur.
 *
 * Scroll model: each ribbon segment is one leg, driven at the journey's one
 * constant speed with no hold anywhere — a continuous drive from end to end.
 * The rendered position is a direct function of scroll position: no lag, no
 * easing, no catching up.
 */
(function () {
  'use strict';

  /* Leg count comes straight from the ribbon's own segment count (below). */

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
  /* leg index (0-based) of garden-beach.png in the manifest — the opening
   * title covers the two opening legs (garden-lead, garden) and hands off to
   * the event/venue details once this leg's own drive finishes, i.e. once
   * the active leg index has moved past it. */
  var TITLE_LAST_LEG = 2;
  /* leg index (0-based) of dam-reservoir.png in the manifest — the per-
   * section caption shows only while this specific leg is the active one. */
  var DAM_LEG = 5;
  /* how far into the final leg's own drive (0..1) before "The Beginning"
   * appears — waits until the forest scene is well established rather than
   * cutting to it the instant the leg starts. */
  var ENDING_REVEAL_AT = 0.3;

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

  /* ---------------------------------------------------------------- car3D
   * Replaces the flat painted car.webp with a real glTF model (2012 Ford
   * EcoSport, CC-BY-4.0 by tonielpro520 - credit required, see
   * models/ecosport/license.txt), rendered top-down to sit in the same
   * .car-idle slot the painted image used. Position/rotation-on-scroll is
   * still driven entirely by tick()'s transform on #car (.car-track) - this
   * module only owns what's INSIDE that slot: the canvas's own size and
   * what's drawn on it. aspect starts at the painted image's old ratio
   * (95:173) so sizing is sane before the model finishes loading; it's
   * corrected to the model's real aspect once the glTF's bounding box is
   * known. */
  var Car3D = (function () {
    var canvas, renderer, scene, camera, model;
    var aspect = 95 / 173;   // width/height, painted car.webp's ratio as a placeholder
    var ready = false;

    function init(canvasEl) {
      canvas = canvasEl;
      /* A blocked or failed CDN request (ad-blocker, offline, a dropped
       * request for one of the three <script> tags) leaves window.THREE
       * undefined — calling into it would throw and, since this runs partway
       * through start(), take the rest of that function's setup down with
       * it. Fall back the same way a failed model fetch does, before ever
       * touching THREE. */
      if (typeof THREE === 'undefined' || !THREE.GLTFLoader || !THREE.DRACOLoader) {
        console.error('car3d: THREE/GLTFLoader/DRACOLoader unavailable, falling back to painted car');
        fallback();
        return;
      }
      scene = new THREE.Scene();
      camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
      camera.position.set(0, 10, 0.001); // tiny z offset avoids gimbal-lock look-down artifacts
      camera.up.set(0, 0, -1);
      camera.lookAt(0, 0, 0);

      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.65;

      /* flat, soft lighting - the painted scene has its own baked-in light
       * source, so a strong key light here would fight it and, combined with
       * glossy paint, read as an unreal "candy" highlight (tuned down once
       * already in the standalone test - see car-3d-test2.html history).
       * Exposure/intensities dropped further (0.85->0.65, and each light
       * scaled down to match) for an overall darker car, same relative
       * balance so it doesn't slide back toward glossy/candy. */
      scene.add(new THREE.AmbientLight(0xffffff, 0.65));
      var key = new THREE.DirectionalLight(0xffffff, 0.55);
      key.position.set(3, 8, 4);
      scene.add(key);
      var fill = new THREE.DirectionalLight(0xffffff, 0.22);
      fill.position.set(-4, 3, -2);
      scene.add(fill);

      var dracoLoader = new THREE.DRACOLoader();
      dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/');
      var loader = new THREE.GLTFLoader();
      loader.setDRACOLoader(dracoLoader);
      loader.load('models/ecosport/scene-compressed.glb', function (gltf) {
        model = gltf.scene;
        scene.add(model);

        var box = new THREE.Box3().setFromObject(model);
        var size = box.getSize(new THREE.Vector3());
        var center = box.getCenter(new THREE.Vector3());
        var topY = box.max.y;    // highest point anywhere on the car (roof), used only as a raycast start height
        /* Flowers landed on the back/boot with -Z as "front" - the opposite
         * of what the standalone car-3d-test2.html render suggested. That
         * test used a different camera/scene setup than this live module,
         * so its "front faced up" observation didn't carry over; +Z is the
         * front here instead, confirmed against the live site after the
         * -Z attempt put them on the wrong end. */
        var frontZ = box.max.z;
        model.position.sub(center);
        model.updateMatrixWorld(true); // raycasting below needs the recentred transform applied, not last frame's stale matrix

        buildFlowers(model, size, topY, frontZ);

        var halfW = size.x / 2, halfD = size.z / 2;
        aspect = size.x / size.z;
        camera.left = -halfW; camera.right = halfW;
        camera.top = halfD; camera.bottom = -halfD;
        camera.far = size.y * 10 + 20;
        camera.position.y = size.y * 6 + 10;
        camera.updateProjectionMatrix();

        ready = true;
        resize(canvas.clientWidth || 1);
        renderer.render(scene, camera);
      }, undefined, function (err) {
        /* A blank canvas is worse than the flat car this replaced — a slow
         * connection, a blocked CDN, or a dropped request now shows no car at
         * all, forever, instead of falling back to what always worked. Swap
         * the canvas back out for the original painted image on failure. */
        console.error('car3d: model failed to load, falling back to painted car', err);
        fallback();
      });
    }

    function fallback() {
      if (!canvas || !canvas.parentNode) return;
      var img = document.createElement('img');
      img.src = 'art/car.webp'; img.alt = '';
      img.style.cssText = 'display:block;width:100%;height:auto;transform:rotate(180deg)';
      canvas.parentNode.replaceChild(img, canvas);
      canvas = null;
    }

    /* Wedding-car flower decoration, built procedurally (small clustered
     * spheres, no external asset) rather than the downloaded marigold
     * garland - that's still pending, this is a placeholder in the same
     * spirit as the painted van's single hood flower cluster. Placed by
     * FRACTION of the model's own measured bbox, not fixed world units, so
     * it holds its position/scale if the model is ever swapped for a
     * differently-sized one. Screen-up (the car's front, confirmed against
     * the live render) is -Z in this orthographic top-down setup - see the
     * camera.up/lookAt in init() - so the bonnet cluster sits toward -Z.
     *
     * Height is NOT size.y/2 or box.max.y - that's the roof, and the first
     * version of this placed flowers there by mistake (a flat "top of car"
     * assumption, not the bonnet's actual, lower surface). Each bloom casts
     * a ray straight down onto the car mesh at its own X/Z and sits at
     * whatever height that ray actually hits, so it follows the bonnet's
     * real contour instead of floating at roof height above it. */
    function buildFlowers(carModel, size, topY, frontZ) {
      var flowers = new THREE.Group();
      var raycaster = new THREE.Raycaster();
      var down = new THREE.Vector3(0, -1, 0);

      /* x/z are in carModel's LOCAL space (flowers end up parented to it,
       * placed with these same local coordinates), but intersectObject
       * tests against carModel's WORLD-space geometry. The first version of
       * this raycast fed local x/z straight in as if they were world
       * coordinates - since carModel.position is offset by -center (set
       * just before buildFlowers is called), that silently missed the mesh
       * for most/all points, and blooms ended up positioned far outside the
       * car in world space once carModel's transform was applied a SECOND
       * time on render - which is what made them invisible, not just
       * misplaced. Transform local->world for the ray, and the hit point
       * world->local for the result, so both ends agree on which space
       * they're in. */
      var localToWorld = new THREE.Vector3();
      var worldToLocal = new THREE.Vector3();
      function surfaceY(x, z, fallback) {
        localToWorld.set(x, topY + 1, z);
        carModel.localToWorld(localToWorld);
        var worldDown = down.clone().transformDirection(carModel.matrixWorld);
        raycaster.set(localToWorld, worldDown.normalize());
        var hits = raycaster.intersectObject(carModel, true);
        if (!hits.length) return fallback;
        worldToLocal.copy(hits[0].point);
        carModel.worldToLocal(worldToLocal);
        return worldToLocal.y;
      }

      var petalColors = [0xE07A2E, 0xF2A93C, 0xE8578A, 0xFFFFFF]; // marigold orange/gold, pink accent, white accent
      function bloom(x, z, scale, colorIdx) {
        var g = new THREE.Group();
        var petalMat = new THREE.MeshToonMaterial({ color: petalColors[colorIdx % petalColors.length] });
        var centerMat = new THREE.MeshToonMaterial({ color: 0x7A4A1E });
        var petalGeo = new THREE.SphereGeometry(0.05 * scale, 6, 5);
        var n = 6;
        for (var i = 0; i < n; i++) {
          var a = (i / n) * Math.PI * 2;
          var p = new THREE.Mesh(petalGeo, petalMat);
          p.position.set(Math.cos(a) * 0.055 * scale, 0, Math.sin(a) * 0.055 * scale);
          g.add(p);
        }
        var c = new THREE.Mesh(new THREE.SphereGeometry(0.04 * scale, 8, 6), centerMat);
        g.add(c);
        var y = surfaceY(x, z, topY);
        g.position.set(x, y + 0.03 * scale, z);
        return g;
      }

      /* denser bonnet cluster, tighter spread than the first pass (which
       * spread as wide as the whole car and sat on the roof) - closer
       * together, closer to the front edge, more blooms filling the gaps.
       * frontZ is now the car's +Z (front) edge, so every offset here
       * SUBTRACTS from it to fan the cluster back toward the car's centre -
       * the opposite sign from when frontZ was the -Z edge, or the whole
       * cluster would sit just past the front bumper in empty space. */
      var hoodZ = frontZ - size.z * 0.14;
      var spread = size.x * 0.11;
      var positions = [
        [0, hoodZ], [0, hoodZ - spread * 0.9],
        [-spread * 0.8, hoodZ - spread * 0.3], [spread * 0.8, hoodZ - spread * 0.3],
        [-spread * 0.5, hoodZ - spread * 1.1], [spread * 0.5, hoodZ - spread * 1.1],
        [-spread * 0.3, hoodZ + spread * 0.3], [spread * 0.3, hoodZ + spread * 0.3],
        [0, hoodZ - spread * 1.7]
      ];
      positions.forEach(function (p, i) {
        var scale = 0.75 + (i % 3) * 0.12;      // slight size variation, not uniform
        var colorIdx = i % petalColors.length;
        flowers.add(bloom(p[0], p[1], scale, colorIdx));
      });

      carModel.add(flowers);
    }

    /* mirrors what CSS `width:100%; height:auto` used to do for the <img> -
     * a canvas has no intrinsic aspect ratio, so both the CSS box size and
     * the renderer's internal pixel buffer are set here from the model's
     * own measured aspect (or the placeholder, before it has loaded). */
    function resize(widthPx) {
      if (!canvas) return;
      var heightPx = widthPx / aspect;
      canvas.style.width = widthPx + 'px';
      canvas.style.height = heightPx + 'px';
      if (renderer) {
        renderer.setSize(widthPx, heightPx, false);
        if (ready) renderer.render(scene, camera);
      }
    }

    return { init: init, resize: resize };
  })();

  fetch('ribbon.json').then(function (r) { return r.json(); }).then(start);

  function start(data) {
    R = data;
    window.RoadFX.ribbon = R;
    el.ribbon = $('ribbon'); el.streaks = $('streaks'); el.clouds = $('clouds');
    el.car = $('car'); el.carImg = document.querySelector('.car-idle');
    el.tint = $('tint'); el.dusk = $('dusk'); el.grain = $('grain');
    el.legs = $('legs'); el.rail = $('rail'); el.cue = $('cue');
    el.title = $('title'); el.titleVenue = $('titleVenue');
    el.details = $('details'); el.venue = $('venue');
    el.damCaption = $('damCaption'); el.damVenue = $('damVenue');
    el.ending = $('ending'); el.endingVenue = $('endingVenue');

    Car3D.init($('car3d'));

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
    el.sections = [];
    for (var i = 0; i < n; i++) {
      var sec = document.createElement('section');
      sec.className = 'leg';
      frag.appendChild(sec);
      el.sections.push(sec);
    }
    el.legs.appendChild(frag);
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
    /* MOBILE_CROP_PCT is a fixed, non-negotiable target — do not add a second
     * floor here (e.g. "guarantee scroll reaches the last join") to fix a
     * mobile scroll problem. That was tried twice: it works, but it means
     * the actual crop on a real phone drifts wherever a taller route
     * happens to need (~40% at one point), silently breaking the crop this
     * is meant to hold. The dam-unreachable problem that motivated it is
     * fixed at the rest-point allocation below instead — every leg's share
     * of S.travel compresses together if it has to, rather than needing
     * S.scale itself to grow past what 23% actually means. */
    S.scale = Math.max(fitWidth, cropFloor);
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
     * leg simply drives into the next at the shared speed.
     *
     * At a fixed crop percentage the scale can be small enough that the last
     * few joins, scaled, land past S.travel entirely — the mobile crop floor
     * is tuned to a look, not to this ribbon's current length, and the route
     * has grown since. Greedily flooring each rest at prevD + 0.30*vh (as
     * this used to) claims that whole floor for every early leg regardless
     * of what is left for the ones after it, so by the last leg or two there
     * is nothing left at all — a leg pinned to the exact same point as the
     * one before it, collapsed to zero drive. That's a real regression, not
     * a stylistic tradeoff: the last leg is the dam, and a collapsed leg
     * reads as "the dam never fully appears" or "the page ends before
     * showing it" — worse than a tighter crop ever would.
     *
     * Compute every leg's wanted position first, uncompressed, then rescale
     * the whole sequence down to fit S.travel if the last one overruns it.
     * Every leg keeps a fair, non-zero share of whatever room actually
     * exists — compressed and faster-paced near the end rather than
     * hollowed out to nothing. */
    var wants = [];
    for (var wi = 0; wi < S.n; wi++) {
      var wrow = R.joins && R.joins[wi];
      wants.push(wrow != null ? wrow * S.scale - S.carY : (wi + 1) / S.n * S.travel);
    }
    var overrun = wants[S.n - 1] > S.travel ? wants[S.n - 1] / S.travel : 1;
    S.rests = [];
    for (var li = 0, prevD = 0; li < S.n; li++) {
      var want = wants[li] / overrun;
      /* Still a floor against two legs landing on the exact same point, but
       * sized to what is actually left to share rather than a fixed 0.30vh —
       * a fixed floor is exactly what caused the greedy collapse above. */
      var roomLeft = (S.n - li) > 0 ? (S.travel - prevD) / (S.n - li) : 0;
      var least = prevD + Math.min(S.vh * 0.30, Math.max(1, roomLeft * 0.5));
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

    var rw = R.roadWidth * S.scale;
    el.streaks.style.width = rw + 'px';
    el.streaks.style.marginLeft = (-rw / 2) + 'px';
    /* el.carImg is .car-idle, the wrapper around the canvas (kept sized to
     * match for layout/drop-shadow bounds, as it was for the old <img>).
     * The canvas no longer inherits size from it, though - a canvas has no
     * width:100%-from-parent auto-height behaviour the way an <img> does,
     * so Car3D.resize sets the canvas's own CSS box AND its internal pixel
     * buffer directly, from the model's real aspect ratio once loaded. */
    var carW = rw * CAR_ROAD;
    el.carImg.style.width = carW + 'px';
    Car3D.resize(carW);
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
    /* Overlay hand-off, front to back: hidden at the very top, then the
     * title while the journey is still inside its own leg(s), then the
     * event details once the beach leg (TITLE_LAST_LEG) is behind us —
     * except the dam leg (DAM_LEG), which swaps in its own caption instead,
     * and the very last leg, which closes on "The Beginning" in the title's
     * own style rather than the events list. i is the leg index tick()
     * already computed above — reused, not re-derived. */
    var revealed = y > S.vh * .03;
    var onDam = i === DAM_LEG;
    var onLast = i === S.n - 1;
    /* "The Beginning" waits until the last leg's own drive is well under way
     * (ENDING_REVEAL_AT) rather than cutting to it the instant the leg
     * starts — u is this leg's own 0..1 progress, already computed above. */
    var showEnding = onLast && u > ENDING_REVEAL_AT;
    el.title.style.opacity = el.titleVenue.style.opacity =
      revealed && i <= TITLE_LAST_LEG ? '1' : '0';
    el.details.style.opacity = el.venue.style.opacity =
      revealed && i > TITLE_LAST_LEG && !onDam && !onLast ? '1' : '0';
    el.damCaption.style.opacity = el.damVenue.style.opacity =
      revealed && onDam ? '1' : '0';
    el.ending.style.opacity = el.endingVenue.style.opacity =
      revealed && showEnding ? '1' : '0';
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
