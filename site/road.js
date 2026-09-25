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
  /* ...but only on a phone. A portrait tablet (768-1024 wide) is portrait too, and
   * the full 23% zoomed an iPad in to ~1.5x its landscape framing — the verges
   * cut off, and the sides jumping every rotation. So the crop is held at 23% up
   * to CROP_FULL_W (the same 640px phone breakpoint road.css uses) and eased
   * out to none by CROP_NONE_W, where plain fit-to-width takes over — close to
   * what the same tablet shows in landscape. */
  var CROP_FULL_W = 640;
  var CROP_NONE_W = 900;
  var ZOOM     = 1.0;   /* fit to width — no runtime crop */
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

  /* "Take me here" detours — where the car turns off the road and parks when
   * a painted callout is tapped (see Detour). Keyed by the callout's url in
   * ribbon.json. Picked by hand against the art rather than derived from the
   * tap box: the dam's callout sits over the reservoir, so "park next to the
   * bubble" would drive the car into the lake.
   *   exit     ribbon row the car's centre is on when it leaves the road
   *   park     [x, row] of the parked car's centre, x from the road centre
   *   heading  parked nose direction in CSS degrees: 0 is straight down the
   *            road (the car's nose points screen-down), negative swings the
   *            nose toward screen-right. Keep within ±180.
   * All in native ribbon px, like R.links — so if build-ribbon.py moves a
   * segment, these rows move with it and must be re-picked. */
  var DETOURS = {
    'https://www.google.com/maps/search/?api=1&query=Palm+Beach+Hotel+Visakhapatnam':
      { exit: 2990, park: [235, 3185], heading: -115 },
    'https://www.google.com/maps/search/?api=1&query=AMR+Unnati+Convention+Karimnagar':
      { exit: 4770, park: [-305, 4950], heading: 110 }
  };

  /* time of day — [at, tintRGB, tintA, duskRGB, duskA]
   * The tint layer is a plain alpha overlay (normal blending), not soft-light:
   * a blend mode over the moving ribbon makes the compositor re-read and
   * re-blend the full-screen backdrop every frame. These tint values were
   * least-squares fitted against screenshots of the old soft-light look
   * (originals, soft-light: 255,217,160 .14 / 255,240,204 .09 /
   * 255,248,232 .05 / 255,192,120 .17 / 255,154,90 .22 / 118,116,186 .26 /
   * 74,92,150 .30), so a flat overlay only needs about a third of the old
   * alpha to give the same warm lift. Normal blending can't reproduce soft-
   * light's midtone contrast, so the match is close, not exact. The last
   * three stops sit past DAY_SPAN and are never reached today; they were
   * fitted the same way so the table stays coherent if DAY_SPAN grows. */
  var DAY = [
    [0.00, 255, 226,  70, .046,  20, 26, 40, .00],
    [0.18, 255, 255, 154, .029,  20, 26, 40, .00],
    [0.40, 255, 255, 195, .016,  20, 26, 40, .00],
    [0.62, 255, 185,  33, .051,  46, 30, 32, .05],
    [0.80, 255, 141,  18, .068,  34, 26, 46, .14],
    [0.92,  63,  53, 255, .025,  16, 18, 40, .30],
    [1.00,   0,   0, 114, .041,  10, 12, 30, .42]
  ];


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
  /* last values written to .streaks — see tick(). streakOn starts false to
   * match road.css's own starting visibility:hidden. */
  var streakOn = false, streakOp = '', streakTf = '';
  /* ys mirrors window.scrollY exactly — everything downstream reads ys so effect
   * layers have one source of truth, but there is no lag between the two. */
  var ys = 0;

  /* A small read-only surface for optional effect layers, so they never have to
   * parse values back out of the ribbon's transform. */
  window.RoadFX = { d: 0, scale: 1, still: true, ribbon: null };

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  /* Writes opacity only when it actually changes. tick() runs every scroll
   * frame and most overlay panels sit at a steady '1' or '0' for the whole
   * time their leg is on screen — reassigning the same value every frame is
   * normally a cheap no-op, but the events panel carries several text nodes
   * each with a 3-layer text-shadow (large blur radii), and on some mobile
   * WebKit builds a redundant opacity write can still trigger a repaint of
   * that shadow rather than being fully no-op'd. Skipping the write when
   * nothing changed removes that cost outright rather than relying on the
   * browser to optimise it away. */
  var _op = Object.create(null);
  function setOpacity(el, id, v) {
    v = v ? '1' : '0';
    if (_op[id] === v) return;
    _op[id] = v;
    el.style.opacity = v;
  }

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
   * known.
   *
   * Three.js itself (~550KB with its loaders) is loaded from HERE, not from
   * <script> tags in index.html. As deferred tags ahead of road.js they held
   * this whole file — ribbon, legs, the page's scroll height — hostage until
   * they'd downloaded, which on a slow phone connection meant several seconds
   * of a page that couldn't scroll, for what is visually a small car. Now the
   * scene builds straight away and the car slot stays empty until Three.js
   * and the model arrive, as it always has. No stand-in image: art/car.webp
   * is the old pink painted car, not the EcoSport, and flashing it for a
   * moment on every reload read as a bug, not a loading state. It's only
   * used if the 3D car fails outright (fallback()). */
  var Car3D = (function () {
    var canvas, renderer, scene, camera, model;
    var aspect = 95 / 173;   // width/height, painted car.webp's ratio as a placeholder
    var ready = false;
    var lastW = 1;           // last width measure() asked for
    var libs = 'loading';    // 'loading' | 'ok' | 'failed' — state of vendor/three.min.js
    var wantInit = false;    // start() has called init() but libs were still loading

    /* Started by buildRibbon() once every ribbon chunk has arrived, not when
     * road.js runs: on a slow connection bandwidth is the bottleneck, and
     * Three.js (then the 3.5MB .glb it fetches) downloading alongside the
     * ribbon art only delays the road itself, which is the thing people came
     * to see — the painted car covers the wait. On a normal connection the
     * ribbon is in within a fraction of a second, so the 3D car is barely
     * later than before. vendor/three.min.js is one self-hosted, tree-shaken
     * bundle with the loaders already inside (see tools/three-bundle.js), so
     * there is no load order to manage and no third-party origin to connect
     * to. A failure (offline, a dropped request) falls back to the painted
     * car in build(). */
    function loadLibs() {
      var s = document.createElement('script');
      s.src = 'vendor/three.min.js';
      s.onerror = function () { libsDone('failed'); };
      s.onload = function () { libsDone('ok'); };
      document.head.appendChild(s);
    }
    function libsDone(state) {
      if (libs !== 'loading') return;
      libs = state;
      if (wantInit) build();
    }

    /* Called from start(). The canvas stays in place, transparent, until the
     * model is drawn on it — build() runs whenever both this and loadLibs()
     * have happened, in whichever order. */
    function init(canvasEl) {
      canvas = canvasEl;
      wantInit = true;
      if (libs !== 'loading') build();
    }

    function build() {
      if (!canvas) return;
      /* A failed request for vendor/three.min.js (offline, a dropped
       * request) leaves window.THREE undefined —
       * calling into it would throw. Fall back the same way a failed model
       * fetch does, before ever touching THREE. */
      if (libs !== 'ok' || typeof THREE === 'undefined' || !THREE.GLTFLoader || !THREE.DRACOLoader) {
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
      dracoLoader.setDecoderPath('vendor/draco/');
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
        /* re-apply lastW with the model's real aspect, then render */
        resize(lastW);
        hasCar();
      }, undefined, function (err) {
        /* A blank canvas is worse than the flat car this replaced — a slow
         * connection, a blocked CDN, or a dropped request now shows no car at
         * all, forever, instead of falling back to what always worked. Swap
         * the canvas back out for the original painted image on failure. */
        console.error('car3d: model failed to load, falling back to painted car', err);
        fallback();
      });
    }

    function paintedCar() {
      var img = document.createElement('img');
      img.src = 'art/car.webp'; img.alt = '';
      img.style.cssText = 'display:block;width:100%;height:auto;transform:rotate(180deg)';
      return img;
    }

    function fallback() {
      if (!canvas || !canvas.parentNode) return;
      canvas.parentNode.replaceChild(paintedCar(), canvas);
      canvas = null;
      hasCar();
    }

    /* .car-shadow is drawn from .car-idle's box, not from the car's pixels,
     * so it would sit on the road under an empty slot while the model loads.
     * It is shown only once there is a car above it (see road.css). */
    function hasCar() {
      var idle = document.querySelector('.car-idle');
      if (idle) idle.classList.add('has-car');
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
      lastW = widthPx;
      if (!canvas) return;
      var heightPx = widthPx / aspect;
      canvas.style.width = widthPx + 'px';
      canvas.style.height = heightPx + 'px';
      if (renderer) {
        renderer.setSize(widthPx, heightPx, false);
        if (ready) renderer.render(scene, camera);
      }
    }

    return { init: init, resize: resize, loadLibs: loadLibs };
  })();

  /* ------------------------------------------------------------ sheets
   * The glass event pop-ups (<dialog class="sheet"> in index.html). A native
   * modal dialog gives focus trapping, Esc-to-close and the top layer for
   * free. The page is scroll-locked while one is open: every scroll px
   * drives the road, so a stray swipe over the backdrop would otherwise
   * move the whole scene under the sheet. */
  var Sheets = (function () {
    var all = Array.prototype.slice.call(document.querySelectorAll('dialog.sheet'));

    all.forEach(function (d) {
      d.querySelector('.sheet-directions').href = d.dataset.map;
      d.querySelector('.sheet-close').addEventListener('click', function () { close(d); });
      /* a click whose target is the dialog itself landed on the backdrop */
      d.addEventListener('click', function (e) { if (e.target === d) close(d); });
      d.addEventListener('close', function () {
        document.documentElement.classList.remove('sheet-open');
      });
      /* swipe the sheet down by its grab handle to dismiss (phones) */
      var y0 = null;
      d.addEventListener('touchstart', function (e) {
        y0 = d.scrollTop <= 0 ? e.touches[0].clientY : null;
      }, { passive: true });
      d.addEventListener('touchend', function (e) {
        if (y0 !== null && e.changedTouches[0].clientY - y0 > 90) close(d);
        y0 = null;
      });
      tabs(d);
    });

    function tabs(d) {
      var list = d.querySelector('[role="tablist"]');
      if (!list) return;
      var btns = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
      var pill = list.querySelector('.sheet-pill');
      function select(i, focus) {
        btns.forEach(function (b, j) {
          var on = j === i;
          b.setAttribute('aria-selected', on);
          b.tabIndex = on ? 0 : -1;
          document.getElementById(b.getAttribute('aria-controls')).hidden = !on;
        });
        pill.style.width = btns[i].offsetWidth + 'px';
        pill.style.transform = 'translateX(' + btns[i].offsetLeft + 'px)';
        if (focus) btns[i].focus();
      }
      btns.forEach(function (b, i) {
        b.addEventListener('click', function () { select(i); });
        b.addEventListener('keydown', function (e) {
          var k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
          if (k) { e.preventDefault(); select((i + k + btns.length) % btns.length, true); }
        });
      });
      /* the pill is sized from laid-out tabs, so it can only be placed
       * once the dialog is actually showing */
      d.addEventListener('sheetopen', function () {
        select(Math.max(0, btns.findIndex(function (b) { return b.getAttribute('aria-selected') === 'true'; })));
      });
    }

    function open(d) {
      document.documentElement.classList.add('sheet-open');
      d.showModal();
      d.dispatchEvent(new Event('sheetopen'));
    }
    function close(d) {
      d.classList.add('closing');
      setTimeout(function () { d.classList.remove('closing'); d.close(); }, 220);
    }
    function find(url) {
      return all.filter(function (d) { return d.dataset.map === url; })[0];
    }
    return { open: open, find: find };
  })();

  /* ------------------------------------------------------------ detour
   * "Take me here" taken literally: tapping a venue's callout drives the car
   * off the road and parks it beside the callout before that venue's sheet
   * opens, then backs it out onto the road once the sheet is closed.
   *
   *   1. align  — scroll the page (so the road engine itself drives the car,
   *               forward or in reverse) until the car sits at the exit row
   *   2. turn   — page held still; the car follows a cubic Bézier from its
   *               spot on the road to the parking spot, nose along the curve
   *   3. parked — a short beat, then the sheet opens
   *   4. back   — sheet closed (by any route: its 'close' event); the car
   *               reverses along the same curve, and the page stays at the
   *               venue
   *
   * The off-road part never touches the scroll engine: it is an offset and
   * heading (S.det) that tick() adds onto the transform it already writes,
   * in the same space — x from the car anchor's centre, y from S.carY.
   *
   * Scrolling is blocked while the car is moving (it would otherwise drag
   * the road out from under it), never while the sheet is open (its own
   * content scrolls), and a failsafe always hands control back. Anything
   * that makes the drive unsafe to play — reduced motion, no car drawn yet,
   * a parking spot that wouldn't be on screen — skips straight to the sheet,
   * which is exactly what a tap did before this existed. */
  var Detour = (function () {
    var ALIGN_MS_PER_VH = 900, ALIGN_MIN = 300, ALIGN_MAX = 1100;
    var TURN_MS = 1100, PARK_BEAT_MS = 250, BACK_MS = 900, FAILSAFE_MS = 4000;
    /* keys that scroll the page, blocked with the wheel and touch while locked */
    var SCROLL_KEYS = { ' ': 1, ArrowUp: 1, ArrowDown: 1, PageUp: 1, PageDown: 1, Home: 1, End: 1 };
    var NOT_PASSIVE = { passive: false };

    var job = null;   // the running detour, or null when idle

    function block(e) { e.preventDefault(); }
    function blockKeys(e) { if (SCROLL_KEYS[e.key]) e.preventDefault(); }
    function lock(on) {
      var f = on ? 'addEventListener' : 'removeEventListener';
      window[f]('wheel', block, NOT_PASSIVE);
      window[f]('touchmove', block, NOT_PASSIVE);
      window[f]('keydown', blockKeys);
    }

    function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

    /* Runs step(0..1, eased) once per frame for ms, then done(). Progress is
     * read off the clock, not counted in frames, so a dropped frame or a
     * backgrounded tab can only make it skip ahead, never drift. */
    function animate(ms, step, done) {
      var t0 = performance.now();
      (function frame(now) {
        var t = clamp((now - t0) / ms, 0, 1);
        step(ease(t));
        if (t < 1) job.raf = requestAnimationFrame(frame);
        else { job.raf = 0; done(); }
      })(t0);
    }

    function arm(ms) {
      clearTimeout(job.failsafe);
      job.failsafe = setTimeout(function () { cancel(); }, ms);
    }

    /* The car's shadow is a box-shadow inside the rotating car (road.css
     * .car-shadow), so turning the car would swing the shadow round with it.
     * Counter-rotate its offset so it keeps falling screen-down. Mirrors the
     * 8px offset in road.css; '' hands it back to the stylesheet. */
    function shadow(rot) {
      if (!el.shadow) return;
      if (!rot) { el.shadow.style.boxShadow = ''; return; }
      var r = rot * Math.PI / 180;
      el.shadow.style.boxShadow = (8 * Math.sin(r)).toFixed(2) + 'px calc(1000px + ' +
        (8 * Math.cos(r)).toFixed(2) + 'px) 14px rgba(10,16,8,.35)';
    }

    function place(p) {
      S.det = p;
      shadow(p ? p.rot : 0);
      ping();
    }

    /* The off-road leg as a cubic Bézier in tick()'s car space, relative to
     * where the car sits on the road right now. It leaves pointing straight
     * down the road (no snap as it starts to turn) and arrives pointing
     * along the parked heading; the car's nose follows the curve's tangent
     * the whole way. Returns null if the parked car wouldn't be fully on
     * screen — the tap then just opens the sheet. */
    function route(cfg, d) {
      var pan = panAt(d);
      var carX = trackAt(R.roadCentre, (d + S.carY) / S.scale) * S.scale - pan;
      var px = (trackAt(R.roadCentre, cfg.park[1]) + cfg.park[0]) * S.scale - pan - carX;
      var py = cfg.park[1] * S.scale - d - S.carY;
      var reach = Math.max(el.carImg.offsetWidth, el.carImg.offsetHeight) / 2;
      var sx = S.vw / 2 + carX + px, sy = S.carY + py;
      if (sx - reach < 0 || sx + reach > S.vw || sy - reach < 0 || sy + reach > S.vh) return null;

      var h = cfg.heading * Math.PI / 180;
      var k = Math.sqrt(px * px + py * py) * 0.5;
      var P = [[0, 0], [0, k], [px + Math.sin(h) * k, py - Math.cos(h) * k], [px, py]];
      return function (t) {
        var u = 1 - t;
        var b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
        var d0 = 3 * u * u, d1 = 6 * u * t, d2 = 3 * t * t;
        var tx = d0 * (P[1][0] - P[0][0]) + d1 * (P[2][0] - P[1][0]) + d2 * (P[3][0] - P[2][0]);
        var ty = d0 * (P[1][1] - P[0][1]) + d1 * (P[2][1] - P[1][1]) + d2 * (P[3][1] - P[2][1]);
        return {
          x: b0 * P[0][0] + b1 * P[1][0] + b2 * P[2][0] + b3 * P[3][0],
          y: b0 * P[0][1] + b1 * P[1][1] + b2 * P[2][1] + b3 * P[3][1],
          /* 0deg is nose-down, so a tangent (tx, ty) is rotate(atan2(-tx, ty)) */
          rot: Math.atan2(-tx, ty) * 180 / Math.PI
        };
      };
    }

    function go(url, sheet) {
      if (job) return;                       // one detour at a time; extra taps do nothing
      var cfg = DETOURS[url];
      if (!cfg || RM || !el.carImg.classList.contains('has-car')) { Sheets.open(sheet); return; }

      job = { sheet: sheet, stage: 'align', raf: 0, timer: 0, failsafe: 0, path: null };
      lock(true);
      arm(FAILSAFE_MS);

      var d1 = clamp(cfg.exit * S.scale - S.carY, 0, S.travel);
      var y0 = window.scrollY, y1 = scrollForD(d1);
      var ms = clamp(Math.abs(y1 - y0) / S.vh * ALIGN_MS_PER_VH, ALIGN_MIN, ALIGN_MAX);
      animate(ms, function (t) { window.scrollTo(0, y0 + (y1 - y0) * t); }, function () {
        /* build the curve from where scrollTo actually landed (it rounds),
         * not from where it was asked to go */
        job.path = route(cfg, posAt(window.scrollY).d);
        if (!job.path) { open(); return; }
        job.stage = 'turn';
        animate(TURN_MS, function (t) { place(job.path(t)); }, function () {
          job.stage = 'parked';
          job.timer = setTimeout(open, PARK_BEAT_MS);
        });
      });
    }

    function open() {
      clearTimeout(job.failsafe);
      lock(false);                            // the sheet's own content has to scroll
      job.stage = 'sheet';
      job.sheet.addEventListener('close', back, { once: true });
      Sheets.open(job.sheet);
    }

    function back() {
      if (!job || job.stage !== 'sheet') return;
      if (!job.path) { finish(); return; }    // never left the road: nothing to reverse
      job.stage = 'back';
      lock(true);
      arm(BACK_MS + FAILSAFE_MS);
      animate(BACK_MS, function (t) { place(job.path(1 - t)); }, finish);
    }

    function finish() {
      clearTimeout(job.failsafe);
      lock(false);
      place(null);
      job = null;
    }

    /* Drop whatever is running and put the car back on the road: a real
     * resize (the curve's px are stale), or the failsafe. If the sheet
     * hadn't opened yet, open it — the tap still gets its answer. */
    function cancel() {
      if (!job) return;
      cancelAnimationFrame(job.raf);
      clearTimeout(job.timer);
      var sheet = job.sheet, pending = job.stage !== 'sheet' && job.stage !== 'back';
      sheet.removeEventListener('close', back);
      finish();
      if (pending) Sheets.open(sheet);
    }

    return { go: go, cancel: cancel };
  })();

  /* index.html preloads this (rel=preload as=fetch crossorigin) so the request
   * is already in flight while the HTML is still parsing. That preload is only
   * reused if this request's mode/credentials match it: fetch()'s defaults
   * (cors, same-origin credentials) are exactly what crossorigin="anonymous"
   * gives the preload — add options here and the preload must change too, or
   * Chrome downloads it twice and warns the preload went unused. */
  fetch('ribbon.json').then(function (r) { return r.json(); }).then(start);

  function start(data) {
    R = data;
    window.RoadFX.ribbon = R;
    el.ribbon = $('ribbon'); el.streaks = $('streaks'); el.clouds = $('clouds');
    el.car = $('car'); el.carImg = document.querySelector('.car-idle');
    el.carAnchor = document.querySelector('.car-anchor');
    el.shadow = document.querySelector('.car-shadow');
    el.tint = $('tint'); el.dusk = $('dusk');
    el.legs = $('legs'); el.rail = $('rail'); el.cue = $('cue');
    el.title = $('title'); el.titleVenue = $('titleVenue');
    el.details = $('details'); el.venue = $('venue');
    el.damCaption = $('damCaption'); el.damVenue = $('damVenue');
    el.ending = $('ending'); el.endingVenue = $('endingVenue');

    Car3D.init($('car3d'));

    /* The smear used to be an feTurbulence SVG (wide, very tall cells, so it
     * reads as smear along the direction of travel, not grain) blended with
     * mix-blend-mode: overlay under two CSS masks. It is now that same noise
     * pre-rendered to a plain tile, because each part cost something every
     * moving frame: overlay needs the road behind it isolated and read back,
     * two extra compositor render passes per frame (about 7 → 5 in a trace).
     * The tile already holds what the rest did:
     *  - its colour and alpha are worked out so a normal blend adds what
     *    overlay added over average tarmac (overlay of a light grey g adds
     *    b·(2g−1) to tarmac b; the tile's colour 2·b and alpha (2g−1) add the
     *    same amount);
     *  - the fade off the verges is baked into its alpha — the tile is
     *    stretched to the element's width, so it lines up exactly;
     *  - it tiles without a seam (crossfaded with itself half a tile down).
     *    feTurbulence's stitchTiles never tiled seamlessly in Chromium, and
     *    the per-tile fade mask meant to hide that never applied: layered
     *    masks default to mask-composite: add, a union, so each mask filled
     *    in the other's gaps and neither did anything.
     * STREAK_TILE must stay 420, the tile's own height (the file is 2x,
     * 400x840, for sharpness on high-DPR phones). */
    el.streaks.style.backgroundImage = 'url("art/streak.webp")';
    el.streaks.style.backgroundRepeat = 'repeat-y';
    el.streaks.style.backgroundSize = '100% ' + STREAK_TILE + 'px';

    buildRibbon();
    buildLegs();
    buildVhProbe();
    measure();
    ys = window.scrollY;
    tick(ys);

    window.addEventListener('scroll', ping, { passive: true });
    /* window resize only. visualViewport's resize used to be wired here too, but
     * it fires on every mobile address-bar show/hide and pinch-zoom — exactly the
     * events that must NOT remeasure (see onResize) — and it never reports a
     * layout change window resize would miss. */
    window.addEventListener('resize', onResize);
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

      /* shown: whether tick() currently lets this tile paint (see cullTiles) */
      return { img: img, y: c.y, h: c.h, top: 0, hpx: 0, shown: true };
    });
    el.ribbon.appendChild(frag);
    Promise.all(loads).then(function () {
      el.ribbon.style.visibility = '';
      Car3D.loadLibs();  // only now — see Car3D.loadLibs for why not sooner
    });

    /* Tappable boxes painted into the art (e.g. a "take me here" callout) —
     * a plain child of #ribbon, like the chunk images, so it pans and scales
     * with the art via the ribbon's own translate3d at zero runtime cost. Its
     * own position/size is set in measure() once native rows are scaled, the
     * same way chunk tops/heights are. left/right in R.links are already
     * road-relative (see build-ribbon.py) — offset from THIS element's own
     * centre, not the ribbon's, so it needs its own centred positioning
     * rather than reusing el.ribbon's left:50%. */
    el.links = (R.links || []).map(function (l) {
      var a = document.createElement('a');
      a.className = 'map-link';
      a.href = l.url; a.target = '_blank'; a.rel = 'noopener';
      a.setAttribute('aria-label', 'Open in Google Maps');
      /* A matching event sheet (index.html, matched by data-map) takes over
       * the tap — the car drives there first, then the sheet opens (see
       * Detour); without one, the href above still opens the map. */
      var sheet = Sheets.find(l.url);
      if (sheet) {
        a.setAttribute('aria-label', 'Event details');
        a.addEventListener('click', function (e) { e.preventDefault(); Detour.go(l.url, sheet); });
      }
      el.ribbon.appendChild(a);
      return { a: a, top: l.top, bottom: l.bottom, left: l.left, right: l.right };
    });
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

  /* A zero-width, invisible, fixed box that is 100lvh tall — read in measure() as
   * the viewport height every length in the journey is derived from.
   *
   * innerHeight is the wrong number for that on a phone: it is the *visible*
   * height, which shrinks and grows by ~80px every time the address bar shows or
   * hides — i.e. constantly, mid-scroll, as a side effect of the scroll itself.
   * Every leg height, S.travel and S.carY is derived from it, so remeasuring
   * against it changed the page's own length under the reader's thumb (~180px)
   * and snapped the road ~155px forward or back. lvh is the height *with the bar
   * hidden* and does not move while it animates, so the maths is pinned to one
   * stable screen. On a desktop lvh == innerHeight, so nothing changes there.
   * The 100vh line is only a parser fallback for engines without lvh (they drop
   * the second declaration); measure() does not trust the probe there anyway. */
  function buildVhProbe() {
    el.vhProbe = document.createElement('div');
    el.vhProbe.setAttribute('aria-hidden', 'true');
    el.vhProbe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100vh;height:100lvh;' +
      'visibility:hidden;pointer-events:none';
    document.body.appendChild(el.vhProbe);
  }
  var HAS_LVH = !!(window.CSS && CSS.supports && CSS.supports('height', '100lvh'));

  function measure() {
    S.vw = window.innerWidth;
    /* The innerHeight this measure was taken at — onResize compares against it
     * to tell a real window resize from address-bar churn. */
    S.ih = window.innerHeight;
    /* Stable height, not innerHeight — see buildVhProbe(). Without lvh (iOS <15.4,
     * old Android) fall back to innerHeight as it is right now: onResize already
     * refuses to remeasure on address-bar-sized changes, so whatever height this
     * measure is taken at stays the one height the whole journey is built on
     * until a real resize, which is the property that matters. A 0 from the probe
     * (not laid out yet) falls back the same way. */
    S.vh = (HAS_LVH && el.vhProbe.offsetHeight) || S.ih;
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
    var cropPct = MOBILE_CROP_PCT *
      clamp((CROP_NONE_W - S.vw) / (CROP_NONE_W - CROP_FULL_W), 0, 1);
    var cropFloor = isPortrait ? (S.vw / (1 - 2 * cropPct)) / R.width : 0;
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
    /* Pin the car's fixed anchor to the exact px the maths assumes. road.css's
     * top:56lvh gets the same answer where lvh exists, but a % or vh top would
     * track innerHeight live on a phone while S.carY does not (by design — see
     * onResize), leaving the car off the painted road by half the address bar.
     * Setting it here keeps the two locked in every engine and after every
     * resize onResize chooses to ignore. */
    el.carAnchor.style.top = S.carY + 'px';

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

    /* Each chunk's h runs R.chunkOverlap rows past the next chunk's y (see
     * build-ribbon.py's slice), and chunks are appended in order, so every
     * later tile paints on top of the one before: the earlier tile's bottom
     * edge is always covered, and the later tile's top edge lands on the
     * same pixels it covers. That is what keeps the joins invisible — so
     * tops/heights are NOT rounded to whole CSS px any more. Rounding was the
     * old defence against hairlines between butt-joined chunks, but it moves
     * each tile by up to half a CSS px (1.5 device px at DPR 3) against its
     * neighbour — a visible jog in the painting once tiles overlap instead
     * of butting. Unrounded, every row sits at exactly row * S.scale, as it
     * would in one single image; the browser's own device-pixel snapping is
     * all that is left, and the overlap hides it. */
    C.forEach(function (c) {
      c.top = c.y * S.scale;
      c.hpx = c.h * S.scale;
      c.img.style.top = c.top + 'px';
      c.img.style.height = c.hpx + 'px';
    });

    /* R.links' top/bottom are already ribbon rows (like a chunk's c.y) and
     * left/right are already offsets from that link's own road centre (see
     * build-ribbon.py) — both need the same *S.scale as everything else
     * here, and the road-centre offset needs S.rw/2 added since el.ribbon's
     * own left edge, not its centre, is (0,0) for an absolutely-positioned
     * child of it. */
    (el.links || []).forEach(function (l) {
      l.a.style.top = Math.round(l.top * S.scale) + 'px';
      l.a.style.height = Math.round((l.bottom - l.top) * S.scale) + 'px';
      l.a.style.left = Math.round(S.rw / 2 + l.left * S.scale) + 'px';
      l.a.style.width = Math.round((l.right - l.left) * S.scale) + 'px';
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
    /* ...and so leg 0 only has the *remaining* half of its drive left to scroll.
     * Without this its section kept the full drive's height: tick() reached
     * u = 1 at y = drive/2, then the car sat parked at the first join for the
     * other half-drive (~0.27 screens) until legTop[1] — scroll moving, road not,
     * right at the start of the page. Pull every later leg up by the head start. */
    for (var lk = 1; lk < S.n; lk++) S.legTop[lk] -= S.leg0HeadStart;
    el.sections[0].style.height =
      Math.round(S.legDrive[0] - S.leg0HeadStart + (S.n === 1 ? S.vh : 0)) + 'px';
    S.docLen = top - S.leg0HeadStart;

    var rw = R.roadWidth * S.scale;
    el.streaks.style.width = rw + 'px';
    el.streaks.style.marginLeft = (-rw / 2) + 'px';
    /* el.carImg is .car-idle, the wrapper around the canvas (kept sized to
     * match for layout, and for .car-shadow, whose insets are % of it).
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

  /* A resize changes every derived length — remeasure and redraw against it —
   * but only a *real* one.
   *
   * On a phone the window "resizes" every time the address bar slides in or out,
   * which happens as a side effect of scrolling itself. Remeasuring then rebuilt
   * every leg from the new height: the page got ~180px shorter under the reader's
   * thumb and the road jumped ~155px at the same scrollY. So on a touch screen
   * only two things count as a real resize: a width change (rotation, split
   * view), or a height change bigger than any toolbar could explain (25% — the
   * iOS bar is ~12% of a portrait phone, a rotation is ~50%). Everything else is
   * left alone; S.vh already comes from lvh (see buildVhProbe), so the layout
   * built at load is already the right one for the bar-hidden screen too.
   *
   * A desktop window (fine pointer + hover) has no collapsing toolbar, and every
   * height change there is the user dragging the window — ignoring a 10% drag
   * would leave the journey fitted to a screen that no longer exists — so it
   * remeasures on everything, as before. */
  var FINE_POINTER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var onResize = function () {
    var w = window.innerWidth, h = window.innerHeight;
    if (!FINE_POINTER && w === S.vw && Math.abs(h - S.ih) <= S.ih * 0.25) return;
    Detour.cancel();
    measure(); ys = window.scrollY; ping();
  };

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

  /* Where the journey is at scroll position y: the active leg i, that leg's
   * own 0..1 progress u, and d, the distance travelled in px. A pure function
   * of y — tick() draws from it, and Detour inverts it (scrollForD) to find
   * the scroll position that puts the car at a given point on the road. */
  function posAt(y) {
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
    return { i: i, u: u, d: RM ? 0 : from + (to - from) * p };
  }

  /* The scroll position whose d is `d` — posAt inverted by bisection. d only
   * ever grows with y, so this converges on the one answer; 40 halvings of
   * any real page length is far below a pixel. */
  function scrollForD(d) {
    var lo = 0, hi = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    for (var k = 0; k < 40; k++) {
      var mid = (lo + hi) / 2;
      if (posAt(mid).d < d) lo = mid; else hi = mid;
    }
    return hi;
  }

  /* Zoom hides S.crop px off each side. Where a segment's subject runs to the
   * frame edge — the dam does — slide the window toward it, giving up the
   * emptier side instead of cutting the subject in half. */
  function panAt(d) {
    return trackAt(R.bias, (d + S.vh / 2) / S.scale) * S.crop;
  }

  function tick(y) {
    var pos = posAt(y), i = pos.i, u = pos.u, d = pos.d;
    var prog = S.travel ? d / S.travel : 0;      // 0..1 across the whole journey

    /* measured speed — everything reactive keys off this, so it all settles to
     * zero during every arrival hold rather than merely looking slow */
    var v = pd === undefined ? 0 : Math.abs(d - pd);
    pd = d;
    vsm = vsm * .68 + Math.min(1, v / (S.vh * .013)) * .32;
    var vs = vsm < .01 ? 0 : vsm;

    var pan = panAt(d);
    el.ribbon.style.transform =
      'translate3d(' + (-pan).toFixed(2) + 'px,' + (-d).toFixed(2) + 'px,0)';

    cullTiles(d);

    /* the car keeps to the painted road even where it wanders, and rides the pan —
     * plus, only while a "take me here" detour is driving it off the road, that
     * detour's own offset and heading (S.det, see Detour) */
    var cx = trackAt(R.roadCentre, (d + S.carY) / S.scale) * S.scale - pan;
    var det = S.det || { x: 0, y: 0, rot: 0 };
    el.car.style.transform =
      'translate3d(' + (cx + det.x).toFixed(2) + 'px,' + (-5 * vs + det.y).toFixed(2) + 'px,0) ' +
      'rotate(' + (Math.sin(d / (S.vh * .7)) * 1.6 * vs + det.rot).toFixed(3) + 'deg)';

    if (!RM) {
      /* The smear only exists while moving. At vs 0 it is hidden outright,
       * not just left at opacity 0 — an opacity-0 layer that will-change keeps
       * promoted still holds its compositor layer and raster tiles for a
       * 300vh strip nobody can see. visibility (not display) so hiding it
       * never costs a layout. Style is only written when a value really
       * changes, and while hidden opacity/transform aren't touched at all:
       * during arrival holds and the settle frames after a stop the loop
       * keeps ticking with nothing here moving. The frame it comes back sees
       * fresh values that differ from the cache and writes them. */
      var on = vs > 0;
      if (on) {
        var op = (vs * .5).toFixed(3);
        var tf = 'translate3d(' + cx.toFixed(2) + 'px,' +
          (-((d * STREAK_LEAD) % STREAK_TILE)).toFixed(2) + 'px,0)';
        if (op !== streakOp) { el.streaks.style.opacity = op; streakOp = op; }
        if (tf !== streakTf) { el.streaks.style.transform = tf; streakTf = tf; }
      }
      if (on !== streakOn) { el.streaks.style.visibility = on ? 'visible' : ''; streakOn = on; }
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
    var showTitle = revealed && i <= TITLE_LAST_LEG;
    var showDetails = revealed && i > TITLE_LAST_LEG && !onDam && !onLast;
    var showDam = revealed && onDam;
    setOpacity(el.title, 'title', showTitle);
    setOpacity(el.titleVenue, 'titleVenue', showTitle);
    setOpacity(el.details, 'details', showDetails);
    setOpacity(el.venue, 'venue', showDetails);
    setOpacity(el.damCaption, 'damCaption', showDam);
    setOpacity(el.damVenue, 'damVenue', showDam);
    setOpacity(el.ending, 'ending', revealed && showEnding);
    setOpacity(el.endingVenue, 'endingVenue', revealed && showEnding);
  }

  /* Time of day as a cross-fade, not a colour change. daylight() used to
   * write a freshly interpolated backgroundColor to #tint and #dusk on every
   * scroll frame — and a changed background colour is a repaint, of two
   * full-viewport layers, every frame the car moves (in a trace, ~6x the
   * paint and raster work of the same scroll with the colour held still).
   * Caching the string didn't help: the interpolated colour really does
   * change almost every frame.
   *
   * So each layer is now two stacked children, each holding one DAY stop's
   * colour at that stop's own alpha, and only their opacity moves: (1 - t)
   * on the stop behind, t on the stop ahead. Opacity on a composited layer
   * is applied by the compositor with no repaint at all; the colours are
   * repainted only when the journey crosses into the next pair of stops,
   * which happens a handful of times over the whole drive. With normal
   * blending (see .tint in road.css) this lands within a fraction of a
   * level of the old interpolated colour — the alphas involved are small
   * enough that stacking two faint layers and blending one in-between
   * colour come out the same. */
  function fadePair(host) {
    host.style.backgroundColor = 'transparent';
    var mk = function () {
      var d = document.createElement('div');
      d.style.cssText = 'position:absolute;inset:0;will-change:opacity;opacity:0';
      host.appendChild(d);
      return d;
    };
    return { a: mk(), b: mk(), seg: -1, oa: '', ob: '' };
  }
  function setPair(p, seg, ca, cb, t) {
    if (p.seg !== seg) { p.seg = seg; p.a.style.backgroundColor = ca; p.b.style.backgroundColor = cb; }
    var oa = (1 - t).toFixed(3), ob = t.toFixed(3);
    if (oa !== p.oa) { p.oa = oa; p.a.style.opacity = oa; }
    if (ob !== p.ob) { p.ob = ob; p.b.style.opacity = ob; }
  }
  var tintPair, duskPair;

  /* Hide tiles more than CULL_VH viewports clear of the visible window, so
   * the browser can drop their raster tiles and decoded pixels instead of
   * holding the whole ~53MB ribbon resident — the reason for tiling in the
   * first place (see build-ribbon.py's slice). A whole viewport of margin on
   * each side means a tile is already visible, and so rasterised, well
   * before it scrolls in: at SPEED the ground moves 0.75px per scroll px, so
   * even a hard fling covers a viewport over several frames. A jump (a
   * resize, a programmatic scrollTo) lands in the same tick() that flips the
   * tiles, so the frame that shows the new position already has them.
   * Written only on change: toggling visibility forces a style recalc and a
   * repaint of the ribbon layer, which must not happen every scroll frame.
   * '' (not 'visible') so the tiles still inherit the ribbon's own
   * load-time hidden state from buildRibbon(). */
  var CULL_VH = 1;
  function cullTiles(d) {
    var lo = d - S.vh * CULL_VH, hi = d + S.vh * (1 + CULL_VH);
    for (var k = 0; k < C.length; k++) {
      var c = C[k], on = c.top + c.hpx > lo && c.top < hi;
      if (on !== c.shown) { c.shown = on; c.img.style.visibility = on ? '' : 'hidden'; }
    }
  }

  function daylight(f) {
    f = clamp(f, 0, 1);
    var i = 0;
    while (i < DAY.length - 2 && f > DAY[i + 1][0]) i++;
    var a = DAY[i], b = DAY[i + 1];
    var t = clamp((f - a[0]) / (b[0] - a[0]), 0, 1);
    var rgba = function (s, j) { return 'rgba(' + s[j] + ',' + s[j + 1] + ',' + s[j + 2] + ',' + s[j + 3] + ')'; };
    if (!tintPair) { tintPair = fadePair(el.tint); duskPair = fadePair(el.dusk); }
    setPair(tintPair, i, rgba(a, 1), rgba(b, 1), t);
    setPair(duskPair, i, rgba(a, 5), rgba(b, 5), t);
  }
})();
