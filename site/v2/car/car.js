/* The EcoSport, driving the road at scroll.s. Never falls back to
 * art/car.webp (the old pink car) — if the model fails, the drive runs carless.
 *
 * Model: ../models/ecosport/scene-compressed.glb — "2012 Ford EcoSport" by
 * tonielpro520, CC-BY-4.0 (credit shown in the page, see ui/).
 * Local +Z is the car's front, +X its left side, y = 0 the tyre contact plane.
 *
 * The compressed model is three palette-atlased meshes plus a few small ones,
 * so parts aren't separate nodes. Every triangle's UV points at one 4px block
 * of a 32-block palette (u = (block + .5) / 32), which tells us what it is.
 * Sub-objects and how each is dressed:
 *
 *   body paint   mesh_0_7. Ford "Ruby Red" metallic (a deep candy red
 *                factory colour): metallic base with a flake normal map, a
 *                clearcoat with a faint orange-peel normal. Box-projected
 *                UVs are generated for it (the palette UVs are one texel).
 *   glass        mesh_0_1. Dark privacy tint, near-mirror clearcoat, env-lit.
 *   tyres        mesh_0 block 14 near an axle. Near-black rubber with a
 *                canvas normal map: sidewall ribs + raised lettering band, tread
 *                grooves on the crown. Polar UVs generated per wheel.
 *   rims         mesh_0 block 15 near an axle. Brushed-silver alloy.
 *   discs        mesh_0_6 near an axle: cast-iron, spin with the wheel.
 *   calipers / plates   mesh_0_2 / mesh_0_3 / mesh_0_4, as modelled, lit.
 *   lamps        mesh_0_5, split head/tail × left/right: emissive at dusk,
 *                amber when indicating, red brighter under braking; a small
 *                restrained glow sprite each; on 'high' two SpotLights cast
 *                real beams on the road and a red PointLight washes the back.
 *   chrome       mesh_0 blocks 8/13: polished metal (badges, grille bar).
 *   trim         mesh_0 blocks 0/12 and anything unlisted: satin black
 *                plastic (bumpers' lower, cladding, mirrors, roof rails).
 *   interior     mesh_0 block 9: matte, dark; seen through the tint only.
 *   shadow       a baked contact-shadow/AO decal (body footprint + four
 *                dark tyre patches) always; plus real sun shadows on 'high'.
 *
 * The wheels hang off `object` (unsprung) and the rest off `body` (sprung), so
 * the body bobs, rolls and dives over wheels that stay on the road. Front
 * wheels steer with the car's actual rate of turn (road curvature + detour yaw).
 *
 * Lit by a PMREM of a gradient sky built from the live sky uniforms (on the
 * car's own materials only — never scene.environment).
 *
 * API: init(ctx) → Promise, update(dt, s), object (Group), pos (Vector3, ground
 *      contact centre), fwd (Vector3), heading, lateral (current metres from centre),
 *      LANE (default lateral: left lane, India drives on the left), speed (m/s),
 *      indicate(side)  side: 'left' | 'right' | 'both' | null — blink the indicators
 *      lamp(name)      Vector3 in world space: 'head' | 'tail' (centre of the pair)
 * The car agent owns this file (paint, wheels, bob/lean, lights).
 */
import * as THREE from 'three';
import { path } from '../core/path.js';
import { world } from '../core/world.js';
import { detour } from './detour.js';
import { damp, clamp, smoothstep, rng } from '../core/noise.js';

const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const LENGTH = 4.25;     // metres, bumper to bumper
const LANE = -1.8;
const ROAD_LIFT = 0.02;  // the road strip sits this far above path.roadY (biomes/terrain.js)
const PAINT = 0x9a0f16;  // Ford "Ruby Red" metallic (sRGB base coat)
const WHEELBASE = 2.52;  // EcoSport, metres

const S = path.sample(0);
const object = new THREE.Group();   // on the road: position, heading, road grade
const body = new THREE.Group();     // sprung mass: bob, roll into curves, pitch on accel
object.add(body);
const pos = new THREE.Vector3(), fwd = new THREE.Vector3(0, 0, -1);
const state = { heading: 0, lateral: LANE, speed: 0, vs: 0, acc: 0, s: 0, dist: 0, pitch: 0, roll: 0, t: 0, yaw: 0 };
const wheels = [];               // {pivot (spin), steer, r, front, side}
const footprint = new THREE.Box3();          // paint mesh bounds, body space
const axleInfo = { list: [], r: 0.33 };
const lamps = { head: [], tail: [] };   // {mat, side: +1 left / -1 right, glow}
const lampPos = { head: new THREE.Vector3(0, 0.8, 2.1), tail: new THREE.Vector3(0, 0.9, -2.1) };
let blink = null, blinkT = 0;
let envTarget = null, pmrem = null, envScene = null, envU = null, envT = 9, renderer;
const envMats = [];
let tier = 'high', spots = [], tailLight = null;

/* ------------------------------------------------------------ init */

async function init(ctx) {
  renderer = ctx.renderer;
  tier = ctx.quality.tier;
  ctx.scene.add(object);
  window.__carObject = object;   // debug handle for close-up QA shots
  try {
    const T = ctx.buildTimes || {}, t0 = performance.now();
    // ?car=<file in v2/models> swaps the model for side-by-side QA
    const pick = new URLSearchParams(location.search).get('car');
    const url = pick ? new URL('../models/' + pick.replace(/[^\w.-]/g, ''), import.meta.url) : new URL('../../models/ecosport/scene-compressed.glb', import.meta.url);
    const gltf = await ctx.loadGLTF(url.href);
    const t1 = performance.now();
    buildCar(gltf.scene);
    const t2 = performance.now();
    object.add(contactShadow());
    Object.assign(T, { carLoad: Math.round(t1 - t0), carBuild: Math.round(t2 - t1) });
    // The reflection environment (a PMREM prefilter) costs seconds on first
    // use; build it just after the page shows rather than behind the loader.
    addEventListener('v2:ready', () => setTimeout(() => {
      buildEnv();
      envMats.forEach(m => { m.envMap = envTarget.texture; m.needsUpdate = true; });
    }, 800), { once: true });
    if (tier === 'high') buildLampLights();
  } catch (e) {
    console.error('[v2] car model failed to load', e);
  }
}

function buildCar(root) {
  // Bake every mesh's transform (plus the fit-to-LENGTH scale and centring)
  // into its geometry, so geometry space == body space in metres.
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const k = LENGTH / Math.max(size.z, size.x);
  const c = box.getCenter(new THREE.Vector3());
  const T = new THREE.Matrix4().makeScale(k, k, k)
    .multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
  const meshes = [];
  root.traverse(o => { if (o.isMesh) meshes.push(o); });
  const byName = {};
  for (const m of meshes) {
    m.geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(T, m.matrixWorld));
    m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1);
    byName[m.name] = m;
  }

  const model = new THREE.Group();
  body.add(model);
  car.model = model;

  // Metallic paint: a metallic base coat whose flakes (a fine random normal
  // map) break up the highlight, under a glossy clearcoat with a faint
  // orange-peel ripple. Box-projected UVs in metres (palette UVs are 1 texel).
  const tex = paintTextures();
  const paint = new THREE.MeshPhysicalMaterial({
    color: PAINT, metalness: 0.4, roughness: 0.34,
    // No normal maps on the paint: the body's UVs are a colour-palette
    // layout, not an unwrap, so any normal map (flake, orange peel) sheared
    // into wavy "dents" across the doors and bonnet.
    clearcoat: 1, clearcoatRoughness: 0.03,
    specularIntensity: 0.6, specularColor: new THREE.Color(0xff9a8a),
    envMapIntensity: 1.25
  });
  // privacy-tinted glass: almost no transmission, strong clean reflections
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x020304, metalness: 0, roughness: 0.03, ior: 1.52, specularIntensity: 0.8,
    clearcoat: 0.6, clearcoatRoughness: 0.02,
    transparent: true, opacity: 0.9, envMapIntensity: 0.85, depthWrite: false
  });
  envMats.push(paint, glass);

  const add = (geo, mat, name, shadow = true) => {
    const m = new THREE.Mesh(geo, mat); m.name = name;
    m.castShadow = shadow;
    model.add(m); return m;
  };
  if (byName.mesh_0_7) {
    const g = byName.mesh_0_7.geometry;
    boxUV(g);
    add(g, paint, 'paint').receiveShadow = true;
    footprint.setFromBufferAttribute(g.attributes.position);
  }
  if (byName.mesh_0_1) add(byName.mesh_0_1.geometry, glass, 'glass').renderOrder = 2;

  // Axles: the brake discs, clustered by corner.
  const discs = byName.mesh_0_6;
  const axles = [];
  if (discs) {
    const P = discs.geometry.attributes.position;
    const bx = [0, 1, 2, 3].map(() => new THREE.Box3());
    const v = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      bx[(v.x > 0 ? 1 : 0) + (v.z > 0 ? 2 : 0)].expandByPoint(v);
    }
    bx.forEach(b => { if (!b.isEmpty()) axles.push(b.getCenter(new THREE.Vector3())); });
  }
  const tyreR = axles.length ? axles.reduce((a, p) => a + p.y, 0) / axles.length : 0.33;

  // mesh_0: split by palette block; tyre/rim blocks and discs lose their wheel triangles.
  const pal = byName.mesh_0;
  const mat0 = pal ? pal.material : null;
  const std = (o) => { const m = new THREE.MeshPhysicalMaterial({ map: mat0 && mat0.map, ...o }); envMats.push(m); return m; };
  const MATS = {
    trim: std({ roughness: 0.62, metalness: 0, envMapIntensity: 0.55 }),              // satin black plastic
    chrome: std({ color: 0xb8bcc2, roughness: 0.22, metalness: 1.0, envMapIntensity: 1.0 }),
    interior: std({ color: 0x2a2a2c, roughness: 0.92, metalness: 0, envMapIntensity: 0.15 }),
    tyre: std({ map: null, color: 0x161616, roughness: 0.9, metalness: 0, envMapIntensity: 0.35,
      normalMap: tyreNormal(), normalScale: new THREE.Vector2(1.1, 1.1) }),
    rim: std({ map: null, color: 0xa9adb2, roughness: 0.3, metalness: 1, envMapIntensity: 1.15,
      clearcoat: 0.6, clearcoatRoughness: 0.08 }),                                     // painted-silver alloy, lacquered
    // clear polycarbonate lamp covers: the lit reflector behind shows through
    lens: std({ map: null, color: 0xffffff, roughness: 0.04, metalness: 0, envMapIntensity: 1.0,
      clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.28, depthWrite: false })
  };
  // palette block → what it is (identified by isolating each block on screen)
  const BLOCK = { 0: 'trim', 8: 'chrome', 9: 'interior', 10: 'lens', 12: 'trim', 13: 'chrome', 14: 'tyre', 15: 'rim' };
  const WHEEL_BLOCKS = new Set([14, 15]);

  const inWheel = (P, a, b, cc) => {
    // index of the axle whose cylinder holds all three vertices, or -1
    for (let w = 0; w < axles.length; w++) {
      const A = axles[w];
      let ok = true;
      for (const i of [a, b, cc]) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        if (Math.sign(x) !== Math.sign(A.x) || Math.abs(x) < Math.abs(A.x) - tyreR * 0.8 ||
            Math.hypot(y - A.y, z - A.z) > tyreR * 1.1) { ok = false; break; }
      }
      if (ok) return w;
    }
    return -1;
  };
  const wheelIdx = axles.map(() => []);           // per wheel: [ {geo-source, indices} ]
  const wheelParts = axles.map(() => new Map());  // per wheel: material → indices (from mesh_0)
  const discWheel = axles.map(() => []);

  if (pal) {
    const g = pal.geometry, P = g.attributes.position, UV = g.attributes.uv, I = g.index;
    const groups = new Map();
    for (let t = 0; t < I.count; t += 3) {
      const a = I.getX(t), b = I.getX(t + 1), cc = I.getX(t + 2);
      const blk = Math.floor(UV.getX(a) * 32);
      const kind = BLOCK[blk] || 'trim';
      if (WHEEL_BLOCKS.has(blk)) {
        const w = inWheel(P, a, b, cc);
        if (w >= 0) {
          // rim triangles reaching out past the rim flange are the tyre's
          // inner bead (else they show as silver spikes on the sidewall)
          const A = axles[w];
          const rMax = Math.max(...[a, b, cc].map(i => Math.hypot(P.getY(i) - A.y, P.getZ(i) - A.z)));
          const k = kind === 'rim' && rMax > tyreR * 0.84 ? 'tyre' : kind;
          const m = wheelParts[w];
          if (!m.has(k)) m.set(k, []);
          m.get(k).push(a, b, cc);
          continue;
        }
      }
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind).push(a, b, cc);
    }
    for (const [kind, idx] of groups) { const m = add(subGeo(g, idx), MATS[kind], kind, kind !== 'lens'); if (kind === 'lens') m.renderOrder = 2; }
    wheelParts.forEach((m, w) => {
      for (const [kind, idx] of m) {
        const geo = compactGeo(g, idx);
        if (kind === 'tyre') { tyreUV(geo, axles[w], tyreR); axleInfo.tx = Math.abs(geo.boundingSphere.center.x); }
        wheelIdx[w].push([geo, MATS[kind]]);
      }
    });
  }
  if (discs) {
    const g = discs.geometry, P = g.attributes.position, I = g.index;
    const rest = [];
    for (let t = 0; t < I.count; t += 3) {
      const a = I.getX(t), b = I.getX(t + 1), cc = I.getX(t + 2);
      const w = inWheel(P, a, b, cc);
      (w >= 0 ? discWheel[w] : rest).push(a, b, cc);
    }
    const dm = new THREE.MeshStandardMaterial({ map: discs.material.map, color: 0x9a9690, roughness: 0.45, metalness: 0.85 });   // cast iron
    envMats.push(dm);
    if (rest.length) add(subGeo(g, rest), dm, 'discs');
    discWheel.forEach((idx, w) => { if (idx.length) wheelIdx[w].push([subGeo(g, idx), dm]); });
  }
  // Wheels are unsprung: they hang off `object`, not `body`, so the body can
  // bob and roll while the tyres stay planted. steer (y) → spin (x).
  const unsprung = new THREE.Group(); unsprung.name = 'wheels';
  object.add(unsprung);
  axles.forEach((A, w) => {
    const steer = new THREE.Group();
    steer.position.copy(A);
    const pivot = new THREE.Group();
    steer.add(pivot);
    for (const [geo, mat] of wheelIdx[w]) {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(A).negate();
      m.castShadow = true;
      pivot.add(m);
    }
    unsprung.add(steer);
    wheels.push({ pivot, steer, r: tyreR, front: A.z > 0, side: Math.sign(A.x) });
  });
  axleInfo.list = axles.map(a => a.clone());
  axleInfo.r = tyreR;

  // calipers, plates: as they come, just lit properly
  for (const n of ['mesh_0_4', 'mesh_0_2', 'mesh_0_3']) {
    const m = byName[n]; if (!m) continue;
    m.material.roughness = 0.6;
    add(m.geometry, m.material, n);
  }

  // Lamps: the reflector mesh, split front/back and left/right so each lamp
  // can glow (dusk) or blink amber (indicator) on its own.
  const refl = byName.mesh_0_5;
  if (refl) {
    const g = refl.geometry, P = g.attributes.position, I = g.index;
    const idx = [[], [], [], []];  // headL, headR, tailL, tailR
    const bb = [0, 1, 2, 3].map(() => new THREE.Box3());
    const v = new THREE.Vector3();
    for (let t = 0; t < I.count; t += 3) {
      let x = 0, z = 0;
      for (let j = 0; j < 3; j++) { x += P.getX(I.getX(t + j)); z += P.getZ(I.getX(t + j)); }
      const q = (z > 0 ? 0 : 2) + (x > 0 ? 0 : 1);
      for (let j = 0; j < 3; j++) { idx[q].push(I.getX(t + j)); bb[q].expandByPoint(v.fromBufferAttribute(P, I.getX(t + j))); }
    }
    idx.forEach((ix, q) => {
      if (!ix.length) return;
      const head = q < 2;
      const mat = new THREE.MeshStandardMaterial({
        map: refl.material.map, roughness: 0.12, metalness: head ? 0.6 : 0.1,
        color: head ? 0xffffff : 0x9a1410,
        emissive: new THREE.Color(0), emissiveIntensity: 1
      });
      envMats.push(mat);
      add(subGeo(g, ix), mat, head ? 'headlamp' : 'taillamp');
      const centre = bb[q].getCenter(new THREE.Vector3());
      const glow = glowSprite(head ? 0xfff1d6 : 0xff2a1a, head ? 0.42 : 0.26);
      glow.position.copy(centre).add(new THREE.Vector3(0, 0, head ? 0.16 : -0.08));   // proud of the lens
      body.add(glow);
      (head ? lamps.head : lamps.tail).push({ mat, side: q % 2 === 0 ? 1 : -1, glow, head });
    });
    const avg = (arr, out) => { out.set(0, 0, 0); arr.forEach(l => out.add(l.glow.position)); return out.multiplyScalar(1 / Math.max(1, arr.length)); };
    avg(lamps.head, lampPos.head); avg(lamps.tail, lampPos.tail);
  }

}

// A geometry sharing g's attributes with its own index.
function subGeo(g, idx) {
  const n = new THREE.BufferGeometry();
  for (const k in g.attributes) n.setAttribute(k, g.attributes[k]);
  n.setIndex(idx);
  n.computeBoundingBox();
  n.boundingSphere = new THREE.Sphere();
  n.boundingBox.getBoundingSphere(n.boundingSphere);
  return n;
}

// A standalone geometry holding only the vertices idx uses (so its UVs can
// be rewritten without touching the shared palette geometry).
function compactGeo(g, idx) {
  const remap = new Map(), keys = Object.keys(g.attributes);
  const out = {}; keys.forEach(k => { out[k] = []; });
  const index = idx.map(i => {
    let j = remap.get(i);
    if (j === undefined) {
      j = remap.size; remap.set(i, j);
      for (const k of keys) {
        const A = g.attributes[k];
        for (let c = 0; c < A.itemSize; c++) out[k].push(A.getComponent(i, c));
      }
    }
    return j;
  });
  const n = new THREE.BufferGeometry();
  for (const k of keys) n.setAttribute(k, new THREE.Float32BufferAttribute(out[k], g.attributes[k].itemSize));
  n.setIndex(index);
  n.computeBoundingSphere();
  return n;
}

// Box-projected UVs in metres, by each vertex's dominant normal axis.
function boxUV(g) {
  const P = g.attributes.position, N = g.attributes.normal;
  const uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    const ax = Math.abs(N.getX(i)), ay = Math.abs(N.getY(i)), az = Math.abs(N.getZ(i));
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const [u, v] = ax >= ay && ax >= az ? [z, y] : ay >= az ? [x, z] : [x, y];
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// Tyre UVs: u = angle round the axle; v in [0, .5) = sidewall radius
// (rim edge → shoulder), v in [.5, 1] = across the tread crown.
function tyreUV(g, A, R) {
  const P = g.attributes.position, N = g.attributes.normal;
  let rIn = R, xIn = Infinity, xOut = 0;
  for (let i = 0; i < P.count; i++) {
    const r = Math.hypot(P.getY(i) - A.y, P.getZ(i) - A.z), ax = Math.abs(P.getX(i));
    rIn = Math.min(rIn, r); xIn = Math.min(xIn, ax); xOut = Math.max(xOut, ax);
  }
  const uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    const dy = P.getY(i) - A.y, dz = P.getZ(i) - A.z, r = Math.hypot(dy, dz);
    uv[i * 2] = Math.atan2(dy, dz) / (Math.PI * 2) + 0.5;
    uv[i * 2 + 1] = Math.abs(N.getX(i)) > 0.55
      ? 0.48 * clamp((r - rIn) / Math.max(0.01, R - rIn), 0, 1)
      : 0.52 + 0.48 * clamp((Math.abs(P.getX(i)) - xIn) / Math.max(0.01, xOut - xIn), 0, 1);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// Height canvas → tangent-space normal map (x wraps).
function normalMap(hc, strength, wrapY = true) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const yu = wrapY ? y - 1 : Math.max(0, y - 1), yd = wrapY ? y + 1 : Math.min(h - 1, y + 1);
    const nx = (H(x - 1, y) - H(x + 1, y)) * strength, ny = (H(x, yd) - H(x, yu)) * strength;
    const l = Math.hypot(nx, ny, 1), k = (y * w + x) * 4;
    d[k] = (nx / l * 0.5 + 0.5) * 255; d[k + 1] = (ny / l * 0.5 + 0.5) * 255; d[k + 2] = (1 / l * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Paint: metallic flakes (per-texel random tilt) and orange peel (soft blobs).
function paintTextures() {
  const R = rng('paint'), N = 256;
  const fc = document.createElement('canvas'); fc.width = fc.height = N;
  const fg = fc.getContext('2d'), img = fg.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const a = R() * Math.PI * 2, t = R() * 0.5;
    img.data[i * 4] = (Math.cos(a) * t * 0.5 + 0.5) * 255;
    img.data[i * 4 + 1] = (Math.sin(a) * t * 0.5 + 0.5) * 255;
    img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = 255;
  }
  fg.putImageData(img, 0, 0);
  const flake = new THREE.CanvasTexture(fc);
  flake.wrapS = flake.wrapT = THREE.RepeatWrapping; flake.repeat.set(9, 9);
  const pc = document.createElement('canvas'); pc.width = pc.height = N;
  const pg = pc.getContext('2d');
  pg.fillStyle = '#808080'; pg.fillRect(0, 0, N, N);
  for (let i = 0; i < 900; i++) {
    const x = R() * N, y = R() * N, r = 3 + R() * 7, v = R() < 0.5 ? 255 : 0;
    for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
      const gr = pg.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      gr.addColorStop(0, `rgba(${v},${v},${v},0.25)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
      pg.fillStyle = gr; pg.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  const peel = normalMap(pc, 3);
  peel.repeat.set(3, 3);
  return { flake, peel };
}

// Tyre: a height canvas → normal map. Bottom half = sidewall (radius runs
// up the canvas): bead ring, fine ribs, raised lettering, shoulder notches.
// Top half = tread crown: three circumferential grooves, blocks and sipes.
function tyreNormal() {
  const W = 1024, H = 256, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
  const row = f => H - 4 - f * 118;                 // sidewall radius fraction → canvas y
  const ring = (f, wpx, col) => { g.fillStyle = col; g.fillRect(0, row(f) - wpx / 2, W, wpx); };
  ring(0.06, 5, '#b0b0b0'); ring(0.14, 2, '#6a6a6a');
  ring(0.24, 1.5, '#989898'); ring(0.28, 1.5, '#989898'); ring(0.86, 2, '#6a6a6a');
  g.fillStyle = '#c4c4c4'; g.textBaseline = 'middle';
  g.font = 'bold 30px Arial, Helvetica, sans-serif';
  g.fillText('ECOSPORT RADIAL', 40, row(0.56)); g.fillText('ECOSPORT RADIAL', 552, row(0.56));
  g.font = 'bold 15px Arial, Helvetica, sans-serif';
  g.fillText('205/60 R16 92H  TUBELESS', 330, row(0.52)); g.fillText('205/60 R16 92H  TUBELESS', 842, row(0.52));
  g.fillStyle = '#5a5a5a';
  for (let x = 0; x < W; x += 16) g.fillRect(x, row(1.0), 5, row(0.9) - row(1.0));
  // tread crown (top half, y 0..120 = across the width)
  g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, W, 122);
  g.fillStyle = '#303030';
  for (const f of [0.27, 0.5, 0.73]) g.fillRect(0, f * 120 - 4, W, 8);         // main grooves
  g.strokeStyle = '#4a4a4a'; g.lineWidth = 3;
  for (let x = 0; x < W + 20; x += 15) {                                        // lateral block edges
    for (const [y0, y1, o] of [[0, 28, 0], [36, 56, 7], [64, 84, 3], [92, 120, 10]]) {
      g.beginPath(); g.moveTo(x + o, y0); g.lineTo(x + o + 6, y1); g.stroke();
    }
  }
  g.strokeStyle = '#707070'; g.lineWidth = 1;
  for (let x = 7; x < W; x += 15) { g.beginPath(); g.moveTo(x, 40); g.lineTo(x + 4, 52); g.moveTo(x + 2, 68); g.lineTo(x + 6, 80); g.stroke(); }
  return normalMap(c, 5, false);
}

/* ------------------------------------------------------------ contact shadow
 * Baked AO/contact decal in the body's footprint: a wide soft penumbra, a
 * denser core under the floor, and four near-black tyre contact patches.
 * Drawn with shadowBlur (canvas filter isn't in Safari). */

function contactShadow() {
  const bw = footprint.isEmpty() ? 1.78 : footprint.max.x - footprint.min.x;
  const bl = footprint.isEmpty() ? LENGTH : footprint.max.z - footprint.min.z;
  const cz = footprint.isEmpty() ? 0 : (footprint.max.z + footprint.min.z) / 2;
  // plane ~1.25x the body; every layer is a radial falloff that reaches 0
  // well inside the plane's edge, so no edge of the card can ever show
  const W = bw * 1.25, L = bl * 1.18, CW = 128, CH = 256;
  const c = document.createElement('canvas'); c.width = CW; c.height = CH;
  const g = c.getContext('2d');
  const X = x => (x + W / 2) * CW / W, Z = z => (z - cz + L / 2) * CH / L, M = CW / W;
  // elliptical radial blob: centre (x,z), radii (rx,rz) in metres
  const blob = (x, z, rx, rz, alpha, core = 0.35) => {
    g.save();
    g.translate(X(x), Z(z)); g.scale(rx * M, rz * M);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    gr.addColorStop(0, `rgba(0,0,0,${alpha})`);
    gr.addColorStop(core, `rgba(0,0,0,${alpha * 0.85})`);
    gr.addColorStop(0.7, `rgba(0,0,0,${alpha * 0.3})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill();
    g.restore();
  };
  const hw = bw / 2, hl = bl / 2;
  blob(0, cz, hw * 1.08, hl * 1.04, 0.5, 0.45);   // soft penumbra, ends inside the plane
  blob(0, cz, hw * 0.78, hl * 0.8, 0.45, 0.5);    // denser core under the floor
  const R = axleInfo.r;
  for (const A of axleInfo.list) {
    const tx = Math.sign(A.x) * (axleInfo.tx || hw - 0.14);
    blob(tx, A.z, 0.16, R * 0.75, 0.85, 0.3);     // tyre contact patch
  }
  // hard guarantee: zero alpha on the outer border
  g.globalCompositeOperation = 'destination-in';
  const e = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  e.addColorStop(0.8, '#000'); e.addColorStop(0.97, 'rgba(0,0,0,0)');
  g.setTransform(CW / 2, 0, 0, CH / 2, CW / 2, CH / 2);
  g.fillStyle = e; g.fillRect(-1, -1, 2, 2);
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000, map: tex, transparent: true, depthWrite: false,
    opacity: tier === 'high' ? 0.75 : 0.9, fog: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(W, L), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0.006, cz);
  m.renderOrder = 1;
  m.name = 'contactShadow';
  return m;
}

/* ------------------------------------------------------------ environment
 * A tiny scene — gradient dome from the live sky colours, a warm sun disc and
 * two soft white "softbox" strips overhead for the long highlight a real car
 * shows along its shoulder — prefiltered with PMREM. Rebuilt (throttled) as
 * the time of day moves, so the paint goes gold at the dam and dim at dusk. */

function buildEnv() {
  pmrem = new THREE.PMREMGenerator(renderer);
  envScene = new THREE.Scene();
  const U = world.U;
  envU = {
    top: { value: new THREE.Color() }, hor: { value: new THREE.Color() },
    ground: { value: new THREE.Color(0x2b2620) }, sunDir: { value: new THREE.Vector3() },
    sunCol: { value: new THREE.Color() }, dusk: { value: 0 }
  };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: envU,
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: /* glsl */`
      uniform vec3 top, hor, ground, sunDir, sunCol; uniform float dusk;
      varying vec3 vD;
      void main(){
        vec3 d = normalize(vD);
        vec3 c = mix(hor, top, pow(max(d.y, 0.0), 0.5));
        c = mix(c, ground, smoothstep(0.02, -0.12, d.y));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += sunCol * (pow(s, 400.0) * 40.0 + pow(s, 8.0) * 0.5) * (1.0 - dusk * 0.8);
        // softboxes: two long bright strips overhead, along the car's length
        float strip = smoothstep(0.93, 0.97, d.y) * (0.6 + 0.4 * smoothstep(0.1, 0.0, abs(abs(d.x) - 0.18)));
        c += vec3(1.0) * strip * 1.4 * (1.0 - dusk * 0.7);
        gl_FragColor = vec4(c, 1.0);
      }`
  }));
  envScene.add(dome);
  refreshEnv(true);
}

const lastSky = new THREE.Color(-1, -1, -1), lastSun = new THREE.Vector3();
function refreshEnv(force) {
  const U = world.U;
  const drift = Math.abs(lastSky.r - U.uSkyHor.value.r) + Math.abs(lastSky.g - U.uSkyHor.value.g) +
    Math.abs(lastSky.b - U.uSkyHor.value.b) + lastSun.distanceTo(U.uSunDir.value);
  if (!force && drift < 0.03) return;
  lastSky.copy(U.uSkyHor.value); lastSun.copy(U.uSunDir.value);
  envU.top.value.copy(U.uSkyTop.value);
  envU.hor.value.copy(U.uSkyHor.value);
  envU.sunDir.value.copy(U.uSunDir.value);
  envU.sunCol.value.copy(U.uSunCol.value);
  envU.dusk.value = U.uDusk.value;
  envU.ground.value.copy(U.uFogCol.value).multiplyScalar(0.25);
  const next = pmrem.fromScene(envScene, 0.015, 0.1, 100);
  // the sky dims at dusk faster than the dome gradient suggests: keep the
  // car's reflections in step with the scene so it doesn't look self-lit
  const dim = 1 - 0.85 * U.uDusk.value;
  envMats.forEach(m => {
    if (m.userData.env0 == null) m.userData.env0 = m.envMapIntensity;
    m.envMap = next.texture; m.envMapIntensity = m.userData.env0 * dim;
  });
  if (envTarget) envTarget.dispose();
  envTarget = next;
}

/* ------------------------------------------------------------ lamps */

let glowTex = null;
function glowSprite(color, size) {
  if (!glowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.2, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: true
  }));
  s.scale.setScalar(size);
  s.renderOrder = 3;
  return s;
}

// Real lights only on the high tier: they cost a little on every lit fragment.
// They stay in the scene at intensity 0 (toggling visibility would recompile
// every material in the scene).
function buildLampLights() {
  for (const side of [1, -1]) {
    // halogen low beam: ~35° cone, 40 m reach, aimed straight down the lane
    // (+Z forward) with a slight downward pitch. The target is a child of the
    // body, so it moves and steers with the car.
    const sp = new THREE.SpotLight(0xfff0d8, 0, 40, THREE.MathUtils.degToRad(17.5), 0.5, 1.2);
    sp.position.set(0.55 * side, lampPos.head.y, lampPos.head.z + 0.05);
    sp.target.position.set(0.55 * side - 1.4, 0, lampPos.head.z + 22);   // ~2° down, a little toward the lane centre (-X)
    body.add(sp, sp.target);
    spots.push(sp);
  }
  tailLight = new THREE.PointLight(0xff2a14, 0, 3.5, 2);
  // low and well behind the bumper: it should tint the road behind the car,
  // not hot-spot the spare-wheel cover it would otherwise sit against
  tailLight.position.set(0, 0.35, lampPos.tail.z - 1.6);
  body.add(tailLight);
}

function indicate(side) { blink = side || null; blinkT = 0; }

const AMBER = new THREE.Color(0xff8a10), HEAD = new THREE.Color(0xfff1d6), TAIL = new THREE.Color(0xff1a0c);
function updateLamps(dt) {
  const on = smoothstep(0.25, 0.65, world.U.uDusk.value);
  blinkT += dt;
  const flash = blink && (blinkT % 0.8) < 0.42 ? 1 : 0;
  for (const arr of [lamps.head, lamps.tail]) for (const l of arr) {
    const blinking = flash && (blink === 'both' || (blink === 'left') === (l.side > 0));
    const base = l.head ? on * 2.2 : on * 1.6 + (state.acc < -3 ? 1.2 : 0); // brake glow too
    if (blinking) {
      l.mat.emissive.copy(AMBER); l.mat.emissiveIntensity = 3;
      l.glow.material.color.copy(AMBER); l.glow.material.opacity = 0.9;
    } else {
      l.mat.emissive.copy(l.head ? HEAD : TAIL); l.mat.emissiveIntensity = base;
      l.glow.material.color.copy(l.head ? HEAD : TAIL);
      l.glow.material.opacity = Math.min(l.head ? 0.7 : 0.8, base * 0.3);
    }
  }
  spots.forEach(sp => { sp.intensity = on * 70; });
  if (tailLight) tailLight.intensity = on * 0.3;
}

/* ------------------------------------------------------------ update */

// Ground height under a road-space point, matching biomes/terrain.js: the
// asphalt strip sits ROAD_LIFT above roadY, the gravel shoulder falls to
// -0.1 at its outer edge, the verge beyond is world.heightSL.
const SHOULDER = 1.5;
function groundY(s, lat) {
  const hw = path.halfWidth, a = Math.abs(lat), r = path.roadY(s);
  if (a <= hw) return r + ROAD_LIFT;
  if (a <= hw + SHOULDER) return r + ROAD_LIFT - (ROAD_LIFT + 0.1) * (a - hw) / SHOULDER;
  return Math.max(world.heightSL(s, lat), r - 0.12);
}

const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));

// The car waits here through the title: far enough down the road that the
// rear three-quarter title camera has road and ground behind it (s < 0 is
// nothing). The first metres of scroll swing the camera round; then it drives.
const PARK_S = 36;

function update(dt, s) {
  s = Math.max(s, PARK_S);
  if (detour.carS != null) s = detour.carS;
  const prevS = state.s;
  state.s = s;
  let ds = s - prevS;
  if (Math.abs(ds) > 40) ds = 0;   // a cut, not a drive
  state.speed = dt > 0 ? clamp(ds / dt, -60, 60) : 0;
  const vPrev = state.vs;
  state.vs += (state.speed - state.vs) * damp(4, dt);
  const accRaw = dt > 0 ? (state.vs - vPrev) / dt : 0;
  state.acc += (clamp(accRaw, -12, 12) - state.acc) * damp(3, dt);
  state.dist += ds;
  state.t += dt;

  const prevLat = state.lateral;
  if (detour.carLatExact != null) state.lateral = detour.carLatExact;
  else state.lateral += ((detour.carLateral ?? LANE) - state.lateral) * damp(2.2, dt);
  // steer: point the car along its actual track, so a lane change or pull-over
  // turns the nose instead of sliding the car sideways
  const dLat = state.lateral - prevLat;
  // atan (not atan2) of the track slope, and only when the car is actually
  // moving sideways: atan2(0, ds<0) is π, which used to swing the car 26°
  // sideways every time the page was scrolled back up.
  const yawT = detour.carYaw != null ? clamp(detour.carYaw, -0.35, 0.35)
    : Math.abs(ds) > 0.02 && Math.abs(dLat) > 1e-4 ? clamp(-Math.atan(dLat / ds), -0.35, 0.35) : 0;
  state.yaw += (yawT - state.yaw) * damp(8, dt);

  path.sample(s, S);
  path.toWorld(s, state.lateral, pos);
  state.heading = S.heading;
  fwd.copy(S.fwd);

  // sit on the ground under each track (the shoulder falls away): height is
  // the mean of the two sides, the difference becomes a small camber roll
  const track = axleInfo.tx ? axleInfo.tx * 2 : 1.52;
  const yL = groundY(s, state.lateral - track / 2), yR = groundY(s, state.lateral + track / 2);
  pos.y = (yL + yR) / 2;
  const camber = Math.atan2(yL - yR, track);
  object.position.copy(pos);
  // pitch with the road grade
  const grade = Math.atan2(path.roadY(s + 1.8) - path.roadY(s - 1.8), 3.6);
  object.rotation.set(0, 0, 0);
  object.rotation.y = state.heading + Math.PI + state.yaw;
  object.rotateX(-grade);
  object.rotateZ(camber);

  // rate of turn of the car itself (road curvature + detour yaw), rad/m, + = left
  const hTot = state.heading + state.yaw;
  let turn = state.turn || 0;
  if (Math.abs(ds) > 1e-3 && state.hPrev != null) turn = clamp(wrapA(hTot - state.hPrev) / ds, -0.3, 0.3);
  state.hPrev = hTot;
  state.turn = (state.turn || 0) + (turn - (state.turn || 0)) * damp(6, dt);

  // wheels roll with distance; the fronts steer (bicycle model, a touch of Ackermann)
  const steer = clamp(Math.atan(WHEELBASE * state.turn), -0.55, 0.55);
  state.steer = (state.steer || 0) + (steer - (state.steer || 0)) * damp(5, dt);
  for (const w of wheels) {
    w.pivot.rotation.x += ds / w.r;
    if (w.front) w.steer.rotation.y = state.steer * (1 + 0.08 * Math.sign(state.steer) * w.side);
  }

  // sprung body: roll out of turns (lateral accel = v² × turn rate), dive
  // under braking, squat under power, small road-texture bob.
  if (RM) { body.position.y = 0; body.rotation.set(0, 0, 0); }
  else {
    const v = clamp(state.vs, -25, 25);   // a scroll fling is not a 200 km/h car
    const rollT = clamp(v * v * state.turn * 0.005, -0.022, 0.022);
    const pitchT = clamp(-state.acc * 0.0025, -0.018, 0.018);
    // critically-ish damped spring, so the body settles with a small overshoot
    state.rollV = (state.rollV || 0) + ((rollT - state.roll) * 60 - (state.rollV || 0) * 11) * Math.min(dt, 0.05);
    state.roll += state.rollV * Math.min(dt, 0.05);
    state.pitchV = (state.pitchV || 0) + ((pitchT - state.pitch) * 70 - (state.pitchV || 0) * 12) * Math.min(dt, 0.05);
    state.pitch += state.pitchV * Math.min(dt, 0.05);
    const sp = clamp(Math.abs(v) / 25, 0, 1);
    const d = state.dist;
    const bob = (Math.sin(d * 1.7) * 0.6 + Math.sin(d * 3.1 + 1.3) * 0.4) * 0.006 * sp
      + Math.sin(state.t * 9) * 0.0006;   // engine idle shimmer
    body.position.y = bob;
    body.rotation.set(state.pitch + Math.sin(d * 2.3) * 0.0018 * sp, 0, state.roll);
  }

  updateLamps(dt);
  envT += dt;
  if (envT > 0.5 && pmrem) { envT = 0; refreshEnv(false); }
}

const tmpL = new THREE.Vector3();
function lamp(name, out = new THREE.Vector3()) {
  return body.localToWorld(out.copy(lampPos[name] || tmpL.set(0, 0.8, 0)));
}

export const car = {
  init, update, object, body, pos, fwd, LANE, model: null, indicate, lamp,
  get heading() { return state.heading; },
  get lateral() { return state.lateral; },
  get s() { return state.s; },
  get speed() { return state.vs; },
  get accel() { return state.acc; }
};
