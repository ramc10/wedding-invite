/* Falling sakura petals — a port of the falling-petal layer in the "Sakura River
 * Valley" three.js scene (valley.mengto.here.now), rebuilt as a transparent
 * overlay over the painted road.
 *
 * What makes those petals read as real, and what is kept here unchanged:
 *   - each petal is a tiny curved 3D card (3x2 vertices, cupped and pinched),
 *     not a sprite, so it foreshortens as it turns;
 *   - it tumbles about its own random axis (t * 2.6 rad/s), so it flashes
 *     edge-on and face-on;
 *   - it falls at 0.55..1.15 m/s, rides a shared wind with slow gust fronts,
 *     and flutters side to side on two out-of-phase sines;
 *   - the light comes from behind: a sharp back-scatter term makes petals that
 *     sit between the eye and the sun glow;
 *   - positions live in a box that wraps (mod) around the camera, and petals
 *     shrink to nothing at the box's edges, so none ever pops in or out.
 * Everything runs in the vertex shader from one instanced draw call; the CPU
 * only updates two uniforms a frame.
 *
 * Scrolling moves the camera down the box (road.js moves the ribbon up by d),
 * so near petals sweep past faster than far ones — parallax for free.
 *
 * Three.js comes from road.js (Car3D.loadLibs) — this waits for window.THREE
 * rather than loading a second copy. Reduced motion removes the layer.
 */
(function () {
  'use strict';

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var MAX_DPR = 1.5;        // tiny shapes, no need for a full 3x buffer on phones
  var FOV     = 50;
  var BOX     = [9, 8, 12]; // wrap box (world m) — sized to cover the frustum out to ~12m
  var DENSITY = 0.55;       // petals per m³ — ~475 in the box, the reference's look up close
  /* share of the reference's wind that petals drift on. Its 1–2 m/s crosses a
   * narrow portrait frustum in about a second, so phones get less than desktop;
   * in between it follows the screen's aspect. */
  var WIND_PORTRAIT  = 0.12;
  var WIND_LANDSCAPE = 0.2;
  var SCROLL_M = 0.5;       // camera travel per screen-height of scroll, as a share of the far plane's height

  var canvas, renderer, scene, camera, mat, t0 = 0, raf = 0;

  /* The reference's petal texture (gy/cy): a notched, heart-ended petal with a
   * deep-pink base fading to near-white at the tip. */
  function petalTexture() {
    var S = 64, c = document.createElement('canvas');
    c.width = c.height = S;
    var g = c.getContext('2d');
    g.translate(S / 2, S * 0.06);
    var len = S * 0.9, w = S * 0.46;
    var grad = g.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, 'rgb(236,150,176)');
    grad.addColorStop(0.5, 'rgb(250,208,220)');
    grad.addColorStop(1, 'rgb(255,242,246)');
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(w * 0.9, len * 0.2, w * 1.05, len * 0.75, w * 0.32, len * 0.98);
    g.lineTo(0, len * 0.86);
    g.lineTo(-w * 0.32, len * 0.98);
    g.bezierCurveTo(-w * 1.05, len * 0.75, -w * 0.9, len * 0.2, 0, 0);
    g.closePath();
    g.fillStyle = grad;
    g.fill();
    var tex = new THREE.CanvasTexture(c);
    tex.flipY = false;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  /* The reference's petal card (ET): 2 columns x 3 rows, widest two-thirds of
   * the way up, cupped across its width and bowed along its length. */
  function petalGeometry() {
    var pos = [], uv = [], idx = [];
    for (var o = 0; o <= 2; o++) {
      for (var a = 0; a <= 1; a++) {
        var l = a, c = o / 2;
        var x = (l - 0.5) * 0.6 * (0.55 + 0.45 * Math.sin(c * Math.PI * 0.9 + 0.2));
        var y = c - 0.5;
        var z = -Math.pow(l - 0.5, 2) * 0.35 + Math.pow(c - 0.5, 2) * 0.12;
        pos.push(x, y, z); uv.push(l, c);
      }
    }
    for (var r = 0; r < 2; r++) {
      var i0 = r * 2, i1 = i0 + 1, i2 = i0 + 2, i3 = i2 + 1;
      idx.push(i0, i1, i2, i1, i3, i2);
    }
    var g = new THREE.InstancedBufferGeometry();
    g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return g;
  }

  var VERT = [
    'uniform float uTime; uniform float uWindK; uniform vec3 uWind; uniform vec3 uBox; uniform vec3 uCam;',
    'attribute vec4 aSeed; attribute vec4 aAxis;',
    'varying vec2 vUv; varying vec3 vNrm; varying vec3 vWP; varying float vTone;',
    'mat3 rotAxis(vec3 a, float ang){ float s = sin(ang), c = cos(ang), oc = 1.0 - c;',
    '  return mat3(oc*a.x*a.x + c, oc*a.x*a.y + a.z*s, oc*a.z*a.x - a.y*s,',
    '              oc*a.x*a.y - a.z*s, oc*a.y*a.y + c, oc*a.y*a.z + a.x*s,',
    '              oc*a.z*a.x + a.y*s, oc*a.y*a.z - a.x*s, oc*a.z*a.z + c); }',
    /* one shared wind field: slow gust fronts travelling along the wind */
    'float windGust(vec3 wp){',
    '  float along = dot(wp.xz, uWind.xy);',
    '  float g = 0.55 + 0.45 * sin(uTime * 0.55 - along * 0.045) * (0.6 + 0.4 * sin(uTime * 0.21 + wp.x * 0.013 - wp.z * 0.011));',
    '  return max(g, 0.08) * uWind.z;',
    '}',
    'void main(){',
    '  float t = uTime * aAxis.w;',
    '  vec3 wind = vec3(uWind.x, 0.0, uWind.y);',
    '  vec3 p = aSeed.xyz * uBox;',
    '  float g = windGust(uCam + p - uBox * 0.5);',
    '  p += wind * (uTime * (1.1 + aSeed.w * 0.9)) * (0.7 + 0.5 * g) * uWindK;',
    '  p.y -= uTime * (0.55 + aSeed.w * 0.6);',
    '  p.x += sin(t * 1.7 + aSeed.w * 30.0) * 0.3; p.z += cos(t * 1.3 + aSeed.x * 20.0) * 0.3;',
    /* wrap into a box in front of the camera */
    '  vec3 lo = uCam - uBox * vec3(0.5, 0.5, 1.0);',
    '  vec3 w = mod(p - lo, uBox) + lo;',
    '  vec3 rel = (w - uCam) / (uBox * vec3(0.5, 0.5, 1.0));',
    '  float edge = 1.0 - smoothstep(0.8, 1.0, max(abs(rel.x), abs(rel.y)));',
    '  edge *= smoothstep(-0.03, -0.08, rel.z) * (1.0 - smoothstep(-0.85, -1.0, rel.z));',
    '  mat3 R = rotAxis(normalize(aAxis.xyz), t * 2.6 + aSeed.w * 6.28);',
    '  vec3 lp = R * (position * 0.095 * (0.8 + aSeed.w * 0.5) * edge);',
    '  vec3 wp = w + lp;',
    '  vWP = wp; vUv = uv; vNrm = R * vec3(0.0, 0.0, 1.0); vTone = 0.85 + aSeed.w * 0.3;',
    '  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);',
    '}'
  ].join('\n');

  var FRAG = [
    'uniform sampler2D tPetal; uniform vec3 uSunDir; uniform vec3 uSunCol;',
    'varying vec2 vUv; varying vec3 vNrm; varying vec3 vWP; varying float vTone;',
    'vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }',
    'void main(){',
    '  vec4 tx = texture2D(tPetal, vec2(vUv.x, 1.0 - vUv.y));',
    '  float a = smoothstep(0.3, 0.6, tx.a);',
    '  if (a < 0.01) discard;',
    '  vec3 N = normalize(vNrm); vec3 Vd = normalize(cameraPosition - vWP);',
    '  if (dot(N, Vd) < 0.0) N = -N;',
    '  vec3 alb = pow(tx.rgb, vec3(2.2)) * vTone;',
    /* the reference's pale pink only reads pink in its dusk haze; over a bright
     * green road it washes to white, so push the saturation back up */
    '  alb = max(mix(vec3(dot(alb, vec3(0.2126, 0.7152, 0.0722))), alb, 1.9), 0.0) * vec3(1.0, 0.9, 0.95);',
    '  float ndl = abs(dot(N, uSunDir));',
    '  float back = pow(max(dot(-Vd, uSunDir), 0.0), 5.0);',
    '  vec3 amb = mix(vec3(0.20, 0.24, 0.3), vec3(0.28, 0.24, 0.2), N.y * 0.5 + 0.5);',
    '  vec3 col = alb * (amb * 1.6 + uSunCol * (ndl * 0.1 + back * 0.55 + 0.03));',
    '  col = pow(aces(col * 1.1), vec3(1.0 / 2.2));',
    '  gl_FragColor = vec4(col * a, a);',
    '}'
  ].join('\n');

  function build() {
    canvas = document.createElement('canvas');
    canvas.className = 'petals';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);

    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: false, premultipliedAlpha: true });
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 40);

    var geo = petalGeometry();
    var n = Math.round(BOX[0] * BOX[1] * BOX[2] * DENSITY);
    var seed = new Float32Array(n * 4), axis = new Float32Array(n * 4);
    var v = new THREE.Vector3();
    for (var i = 0; i < n; i++) {
      seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
      v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      axis.set([v.x, v.y, v.z, 0.6 + Math.random() * 0.8], i * 4);
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.setAttribute('aAxis', new THREE.InstancedBufferAttribute(axis, 4));
    geo.instanceCount = n;

    mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:   { value: 0 },
        /* xz direction (screen-right, slightly toward the camera) and strength */
        uWind:   { value: new THREE.Vector3(0.93, 0.36, 1) },
        uWindK:  { value: WIND_LANDSCAPE },
        uBox:    { value: new THREE.Vector3(BOX[0], BOX[1], BOX[2]) },
        uCam:    { value: new THREE.Vector3() },
        /* low golden-hour sun ahead of the camera, so petals glow from behind */
        uSunDir: { value: new THREE.Vector3(0.35, 0.45, -1).normalize() },
        uSunCol: { value: new THREE.Vector3(5.6, 3.55, 1.75) },
        tPetal:  { value: petalTexture() }
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false
    });

    var mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);

    resize();
    window.addEventListener('resize', resize);
    t0 = performance.now();
    raf = requestAnimationFrame(frame);
    requestAnimationFrame(function () { canvas.classList.add('on'); });
  }

  function resize() {
    var W = window.innerWidth, H = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    var k = Math.min(1, Math.max(0, (camera.aspect - 0.5) / 0.8));
    mat.uniforms.uWindK.value = WIND_PORTRAIT + (WIND_LANDSCAPE - WIND_PORTRAIT) * k;
    /* widen the box on landscape screens so the frustum's sides stay covered */
    mat.uniforms.uBox.value.x = Math.max(BOX[0], BOX[1] * camera.aspect * 1.1);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    var fx = window.RoadFX, H = window.innerHeight || 1;
    var farH = 2 * BOX[2] * Math.tan(FOV * Math.PI / 360);
    /* ribbon moves up by d as you scroll, so the camera moves down through the petals */
    var cy = fx ? -(fx.d / H) * farH * SCROLL_M : 0;
    camera.position.set(0, cy, 0);
    mat.uniforms.uCam.value.copy(camera.position);
    mat.uniforms.uTime.value = (now - t0) / 1000;
    renderer.render(scene, camera);
  }

  function start() {
    if (window.THREE && THREE.InstancedBufferGeometry) return build();
    setTimeout(start, 150);
  }

  start();
})();
