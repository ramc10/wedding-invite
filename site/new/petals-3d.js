/* Blossom drifting over the garden — same idea as the old flat-canvas petals.js,
 * rebuilt as real 3D geometry (bent, twisted, lit) instead of a painted ellipse.
 *
 * Petals ride the ground — their position lives in the same travelled-px space as
 * the ribbon, at nearly the ground's own scroll speed (GROUND_SPEED) — plus a small
 * independent drift/fall, which is what reads as "in the air" rather than pinned
 * to the road. Confined to the road's own painted width (not the letterboxed
 * viewport) and to the ribbon rows the manifest marks as garden (petalZones),
 * fading in and out at each zone's edge. Reduced motion removes them entirely.
 */
(function () {
  'use strict';

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!window.THREE) return;

  var MAX_DPR   = 2;
  var GROUND_SPEED = 0.94; // share of the ground's own scroll speed a petal keeps up with
  var FADE_ROWS = 260;    // ribbon rows over which a zone eases in and out
  var FPS       = 30;     // slow drift needs no more, and holds cost half as much
  var TINTS = ['#F6DDE3', '#FFF4E8', '#F0A2BD', '#FBE7C6'];
  var COUNT_MIN = 16, COUNT_MAX = 34;   // fewer than the 2D version — each one reads more

  var THREE = window.THREE;
  var cv, renderer, scene, camera, mesh, dummy, colorAttr, ribbonEl;
  var W = 0, H = 0, roadX0 = 0, roadW = 0, ps = [], last = 0, prevD = 0, raf = 0, za = 0;

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function make(fx) {
    var fx2 = fx === undefined ? Math.random() : fx;
    return {
      x: rnd(-0.05, 1.05),                 // 0..1 across the viewport
      y: fx2,                              // 0..1 down the viewport, at spawn
      py: 0,                               // accumulated lag, in travelled px
      size: rnd(6, 13),                    // px radius, roughly — scaled to world units below
      spin: rnd(-0.7, 0.7),
      tumble: rnd(-0.5, 0.5),
      phase: rnd(0, 6.28),
      driftX: rnd(-7, 5),                  // px/s of its own wind
      driftY: rnd(5, 15),
      z: rnd(-0.4, 0.4),                   // slight depth scatter, purely visual
      tint: TINTS[(Math.random() * TINTS.length) | 0]
    };
  }

  /* the same bent, twisted teardrop from the isolated petal test */
  function petalGeometry() {
    var shape = new THREE.Shape();
    shape.moveTo(0, -0.62);
    shape.bezierCurveTo(0.34, -0.5, 0.4, 0.05, 0.22, 0.42);
    shape.bezierCurveTo(0.12, 0.6, -0.12, 0.6, -0.22, 0.42);
    shape.bezierCurveTo(-0.4, 0.05, -0.34, -0.5, 0, -0.62);
    var geo = new THREE.ShapeGeometry(shape, 10);

    var pos = geo.attributes.position;
    var curl = 0.30, twist = 0.14;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), y = pos.getY(i);
      var t = (y + 0.62) / 1.22;
      var z = curl * Math.sin(t * Math.PI * 0.85) * (0.4 + 0.6 * Math.abs(x) / 0.4);
      var xz = twist * Math.sin(t * Math.PI) * x;
      pos.setZ(i, z + xz);
    }
    geo.computeVertexNormals();
    return geo;
  }

  /* petals spawn across the painted road's own width, not the full (possibly
   * letterboxed) viewport — the ribbon is centred and often narrower than the
   * window, and scattering across the dead margins would just look wrong. Read
   * fresh each frame: at start() the ribbon may not have settled into its final
   * size yet, and a stale value would never correct itself afterward. */
  function updateRoadBounds() {
    if (!ribbonEl) ribbonEl = document.getElementById('ribbon');
    if (ribbonEl) {
      var rect = ribbonEl.getBoundingClientRect();
      roadX0 = rect.left; roadW = rect.width || W;
    } else {
      roadX0 = 0; roadW = W;
    }
  }

  function resize() {
    var fx = window.RoadFX;
    var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    renderer.setPixelRatio(1);              // canvas already sized in device px above
    renderer.setSize(W * dpr, H * dpr, false);

    camera.left = 0; camera.right = W;
    camera.top = 0; camera.bottom = H;
    camera.near = -500; camera.far = 500;
    camera.updateProjectionMatrix();

    updateRoadBounds();

    var want = Math.round(Math.min(COUNT_MAX, Math.max(COUNT_MIN, (roadW * H) / 42000)));
    while (ps.length < want) ps.push(make());
    ps.length = want;
    if (mesh) mesh.count = want;
    if (fx) prevD = fx.d;
  }

  /* 0 outside every garden stretch, 1 well inside one */
  function zoneAlpha(fx) {
    var z = fx.ribbon.petalZones;
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

    /* zoneAlpha already ramps smoothly over FADE_ROWS of scroll — a second, slower
     * ease on top of that just adds lag, which is what let petals visibly outlive
     * their zone (still drawing, faded, over the beach). Use it directly. */
    za = zoneAlpha(fx);

    if (za <= 0.003) {
      if (cv.style.opacity !== '0') cv.style.opacity = '0';
      prevD = fx.d;
      return;
    }
    if (cv.style.opacity !== '1') cv.style.opacity = '1';

    updateRoadBounds();
    var dd = fx.d - prevD; prevD = fx.d;

    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      p.py += dd * GROUND_SPEED + p.driftY * dt;
      p.x  += (p.driftX * dt) / roadW;
      p.phase += (p.spin + p.tumble) * dt;

      var sy = p.y * H + p.py;
      if (sy < -30 || sy > H + 30 || p.x < -0.1 || p.x > 1.1) {
        ps[i] = p = make(dd >= 0 ? -0.04 : 1.04);
      }

      var sx = roadX0 + p.x * roadW;
      var breathe = 0.35 + 0.65 * Math.abs(Math.sin(p.phase * 1.1));
      /* camera.top=0, bottom=H, so world Y already matches screen Y (grows down) */
      dummy.position.set(sx, sy, p.z * 40);
      dummy.rotation.set(
        0.3 + Math.sin(p.phase * 0.7) * 0.5,
        p.phase,
        Math.sin(p.phase * 1.3) * 0.4
      );
      dummy.scale.setScalar(p.size * breathe);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tintColor(p.tint));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.material.opacity = za;

    renderer.render(scene, camera);
  }

  var colorCache = {};
  function tintColor(hex) {
    if (!colorCache[hex]) colorCache[hex] = new THREE.Color(hex);
    return colorCache[hex];
  }

  function start() {
    if (!window.RoadFX || !window.RoadFX.ribbon) return setTimeout(start, 120);

    cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:fixed;inset:0;z-index:7;pointer-events:none;' +
                       'opacity:0;transition:opacity .6s ease';
    document.body.appendChild(cv);

    renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;

    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(0, 1, 0, 1, -500, 500);
    camera.position.z = 10;

    var key = new THREE.DirectionalLight(0xfff2d8, 1.1);
    key.position.set(-60, -120, 90);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));

    var geo = petalGeometry();
    var mat = new THREE.MeshStandardMaterial({
      roughness: 0.55, metalness: 0,
      side: THREE.DoubleSide,
      transparent: true, opacity: 1,
      depthWrite: false
    });
    mesh = new THREE.InstancedMesh(geo, mat, COUNT_MAX);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT_MAX * 3), 3);
    dummy = new THREE.Object3D();
    scene.add(mesh);

    resize();
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(frame);
  }

  start();
})();
