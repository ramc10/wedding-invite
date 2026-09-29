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
 *                factory colour): metallic base under a glossy clearcoat.
 *                The roof's modelled ribs are flattened, the spare-wheel
 *                cover trued up, and normals rebuilt (see creased()).
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
import { damp, clamp, smoothstep } from '../core/noise.js';

const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const LENGTH = 4.25;     // metres, bumper to bumper
const LANE = -1.8;
const ROAD_LIFT = 0.02;  // the road strip sits this far above path.roadY (biomes/terrain.js)
const PAINT = 0x930c15;  // Ford "Ruby Red" metallic (sRGB base coat)
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
let renderer;
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

  // Metallic paint: a metallic base coat under a glossy clearcoat.
  const paint = new THREE.MeshPhysicalMaterial({
    color: PAINT, metalness: 0.6, roughness: 0.28,
    // No normal maps on the paint: the body's UVs are a colour-palette
    // layout, not an unwrap, so any normal map (flake, orange peel) sheared
    // into wavy "dents" across the doors and bonnet.
    clearcoat: 1, clearcoatRoughness: 0.03,
    // the base's own dielectric sheen is mostly the clearcoat's job: keep it
    // low, or the red washes out to pink under an open sky
    specularIntensity: 0.3, specularColor: new THREE.Color(0xffe2dc),
    envMapIntensity: 1.0
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
    const skin = flattenRoof(g), fix = spareCover(skin);
    add(creased(skin, 0.6, 2, fix), paint, 'paint').receiveShadow = true;
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
    // textured black PP plastic (bumper lower, cladding, grille mesh): matte and
    // dark so the model's facets don't catch speculars
    trim: std({ map: null, color: 0x1d1d1f, roughness: 0.86, metalness: 0, envMapIntensity: 0.35 }),
    chrome: std({ map: null, color: 0xaeb2b8, roughness: 0.38, metalness: 1.0, envMapIntensity: 1.0 }),
    interior: std({ color: 0x2a2a2c, roughness: 0.92, metalness: 0, envMapIntensity: 0.15 }),
    tyre: std({ map: null, color: 0x161616, roughness: 0.9, metalness: 0, envMapIntensity: 0.35,
      normalMap: tyreNormal(), normalScale: new THREE.Vector2(1.1, 1.1) }),
    rim: std({ map: null, color: 0xb9bcc0, roughness: 0.4, metalness: 0.75, envMapIntensity: 0.7,
      clearcoat: 0.3, clearcoatRoughness: 0.25 }),                                     // painted-silver alloy, satin lacquer
    // clear polycarbonate lamp covers: the lit reflector behind shows through
    plate: new THREE.MeshStandardMaterial({ map: plateTexture('TS 09 EC 2026'), roughness: 0.45, metalness: 0 }),
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
    // number plates live in an unlisted palette block: find it by shape (a
    // narrow, centred block present at both ends of the car)
    const bbs = new Map(), vv = new THREE.Vector3();
    for (let t = 0; t < I.count; t++) {
      const blk = Math.floor(UV.getX(I.getX(t)) * 32);
      if (BLOCK[blk]) continue;
      if (!bbs.has(blk)) bbs.set(blk, new THREE.Box3());
      bbs.get(blk).expandByPoint(vv.fromBufferAttribute(P, I.getX(t)));
    }
    const plateBlk = new Set();
    for (const [blk, b] of bbs) {
      const sz = b.getSize(vv);
      const cz = Math.abs((b.min.z + b.max.z) / 2), cx = Math.abs((b.min.x + b.max.x) / 2);
      if (sz.x < 0.8 && sz.x > 0.3 && cx < 0.15 && ((sz.z > LENGTH * 0.7 && sz.y < 0.9) || (cz > LENGTH * 0.4 && sz.y < 0.35 && sz.z < 0.3))) plateBlk.add(blk);
    }
    for (let t = 0; t < I.count; t += 3) {
      const a = I.getX(t), b = I.getX(t + 1), cc = I.getX(t + 2);
      const blk = Math.floor(UV.getX(a) * 32);
      const kind = BLOCK[blk] || (plateBlk.has(blk) ? 'plate' : 'trim');
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
    for (const [kind, idx] of groups) {
      let geo = kind === 'trim' || kind === 'chrome' ? creased(subGeo(g, idx), 0.5) : subGeo(g, idx);
      if (kind === 'plate') { geo = compactGeo(g, idx); plateUV(geo); }
      const m = add(geo, MATS[kind], kind, kind !== 'lens'); if (kind === 'lens') m.renderOrder = 2; }
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
    const bb = new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position);
    // the plates: narrow (centred) and at both ends of the car
    if (bb.max.x - bb.min.x < 0.9 && bb.max.z - bb.min.z > LENGTH * 0.7) {
      plateUV(m.geometry);
      add(m.geometry, new THREE.MeshStandardMaterial({ map: plateTexture('TS 09 EC 2026'), roughness: 0.45, metalness: 0 }), 'plates');
      continue;
    }
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

/* The model's roof carries five raised ribs, ~6 mm tall and 6 cm wide,
 * built from long slivers: their 45° walls shade as dark and bright
 * pinstripes (and self-shadow as dashed lines) along the roof. Fit a
 * smooth height field y(x, z) to the roof skin (iteratively dropping the
 * ribs from the fit) and lay the ribbed area back onto it, fading out before
 * the roof rails and the roof's ends. Returns a new geometry. */
function flattenRoof(g) {
  const out = g.clone(), P = out.attributes.position, N = out.attributes.normal;
  const inRoof = i => P.getY(i) > 1.45 && Math.abs(P.getX(i)) < 0.49 && P.getZ(i) > -1.5 && P.getZ(i) < 0.1;
  const all = [];
  for (let i = 0; i < P.count; i++) if (inRoof(i)) all.push(i);
  const idx = all.filter(i => N.getY(i) > 0.2);   // the outer skin (the model's inner shell faces down)
  if (idx.length < 50) return out;
  const basis = (x, z) => [1, x * x, z, z * z, z * z * z, x * x * z, x * x * x * x];
  const K = 7;
  const fit = use => {
    const A = Array.from({ length: K }, () => new Float64Array(K + 1));
    for (const i of use) {
      const b = basis(P.getX(i), P.getZ(i)), y = P.getY(i);
      for (let r = 0; r < K; r++) { for (let c = 0; c < K; c++) A[r][c] += b[r] * b[c]; A[r][K] += b[r] * y; }
    }
    for (let c = 0; c < K; c++) {   // Gauss-Jordan with partial pivoting
      let p = c;
      for (let r = c + 1; r < K; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]];
      for (let r = 0; r < K; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= K; k++) A[r][k] -= f * A[c][k]; }
    }
    const w = A.map((r, i) => r[K] / r[i]);
    return (x, z) => basis(x, z).reduce((s, b, i) => s + b * w[i], 0);
  };
  let use = idx, f;
  for (let it = 0; it < 4; it++) { f = fit(use); use = idx.filter(i => P.getY(i) - f(P.getX(i), P.getZ(i)) < 0.0015); }
  for (const i of all) {   // inner shell too, so its ribs can't poke through the skin
    const x = P.getX(i), z = P.getZ(i);
    const w = smoothstep(0.47, 0.43, Math.abs(x)) * smoothstep(-1.48, -1.43, z) * smoothstep(-0.1, -0.15, z);
    P.setY(i, P.getY(i) + (f(x, z) - P.getY(i)) * w);
  }
  return out;
}

/* The spare-wheel cover (the rearmost thing on the car) is a drum: a flat
 * face, a chamfer and a barrel, built from few, long triangles, with a
 * stray 1-7 mm dip in its face. Lays the face flat (in place, on g) and
 * returns a normal fix for creased(): flat on the face (its outer 3 cm roll
 * into the chamfer), and elsewhere on the drum the normal loses its
 * component around the axis, so the 16-sided chamfer and barrel shade round. */
function spareCover(g) {
  const P = g.attributes.position;
  let zmin = Infinity;
  for (let i = 0; i < P.count; i++) zmin = Math.min(zmin, P.getZ(i));
  const face = new THREE.Box3(), v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) if (P.getZ(i) < zmin + 0.004) face.expandByPoint(v.fromBufferAttribute(P, i));
  const c = face.getCenter(new THREE.Vector3()), R = (face.max.x - face.min.x) / 2;   // the face's rim
  if (!(R > 0.15 && R < 0.5)) return null;
  const rOf = (x, y) => Math.hypot(x - c.x, y - c.y);
  for (let i = 0; i < P.count; i++) {
    if (P.getZ(i) - zmin < 0.012 && rOf(P.getX(i), P.getY(i)) < R + 0.01) P.setZ(i, zmin);
  }
  const barrel = R * 1.25, depth = 0.215;
  return (p, f, n) => {
    const dx = p.x - c.x, dy = p.y - c.y, r = Math.hypot(dx, dy);
    if (p.z > zmin + depth || r > barrel || f.z > 0) return;
    if (p.z < zmin + 0.001 && f.z < -0.995 && r < R - 0.03) { n.set(0, 0, -1); return; }
    if (r < 1e-3) return;
    const tx = -dy / r, ty = dx / r, t = n.x * tx + n.y * ty;   // around-axis component
    if (Math.abs(t) < 0.95) n.set(n.x - t * tx, n.y - t * ty, n.z).normalize();
  };
}

// Crease-angle normals: a new non-indexed geometry whose corners average the
// normals of faces sharing that position only when within `angle` radians,
// so panels shade smoothly but hard edges stay crisp.
// Each face counts by its corner angle (not its area), so the long thin
// slivers of this mesh don't drag a vertex's normal their way (the lumps and
// facets on the doors and spare-wheel cover). `smooth` passes then average
// each corner with the one-ring of faces in its own smoothing group, never
// across a crease: that irons out the tessellation's ripple while the panel
// gaps and edges stay sharp. fix(), if given, has the last word per corner.
function creased(g, angle = 0.6, smooth = 0, fix = null) {
  const src = g.index ? g.toNonIndexed() : g.clone();
  const P = src.attributes.position, n = P.count, cos = Math.cos(angle);
  const F = new Float32Array(n * 3), W = new Float32Array(n);
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    for (let k = 0; k < 3; k++) p[k].fromBufferAttribute(P, i + k);
    fn.subVectors(p[2], p[1]).cross(e1.subVectors(p[0], p[1]));
    // a sliver (under 0.2 mm across) has no trustworthy normal: it gets
    // no say in its neighbours' normals and borrows theirs (below)
    const long = Math.max(p[0].distanceTo(p[1]), p[1].distanceTo(p[2]), p[2].distanceTo(p[0]));
    const sliver = fn.length() < 2e-4 * long;
    if (sliver) fn.set(0, 0, 0); else fn.normalize();
    for (let k = 0; k < 3; k++) {
      e1.subVectors(p[(k + 1) % 3], p[k]); e2.subVectors(p[(k + 2) % 3], p[k]);
      W[i + k] = !sliver && e1.lengthSq() && e2.lengthSq() ? e1.angleTo(e2) : 0;
      F[(i + k) * 3] = fn.x; F[(i + k) * 3 + 1] = fn.y; F[(i + k) * 3 + 2] = fn.z;
    }
  }
  // weld corners by position (0.1 mm)
  const key = i => `${Math.round(P.getX(i) * 1e4)},${Math.round(P.getY(i) * 1e4)},${Math.round(P.getZ(i) * 1e4)}`;
  const buckets = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); let l = buckets.get(k); if (!l) buckets.set(k, l = []); l.push(i); }
  // group[i]: the corners at i's position whose faces are within the crease of i's face
  const group = new Array(n);
  for (const l of buckets.values()) for (const i of l) {
    const g = [];
    if (W[i]) { for (const j of l) if (F[i * 3] * F[j * 3] + F[i * 3 + 1] * F[j * 3 + 1] + F[i * 3 + 2] * F[j * 3 + 2] >= cos) g.push(j); }
    else g.push(...l);   // a sliver's corner: everything at its position
    group[i] = g;
  }
  let N = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, sz = 0;
    for (const j of group[i]) { sx += F[j * 3] * W[j]; sy += F[j * 3 + 1] * W[j]; sz += F[j * 3 + 2] * W[j]; }
    const l = Math.hypot(sx, sy, sz);
    if (l < 1e-6) { sx = F[i * 3]; sy = F[i * 3 + 1]; sz = F[i * 3 + 2]; }
    else { sx /= l; sy /= l; sz /= l; }
    N[i * 3] = sx; N[i * 3 + 1] = sy; N[i * 3 + 2] = sz;
  }
  for (let it = 0; it < smooth; it++) {
    // per face: the sum of its three corner normals (x, y, z in the face's
    // three slots); per corner: the weighted mean over its group's faces
    const S = new Float32Array(n);
    for (let i = 0; i < n; i += 3) for (let c = 0; c < 3; c++) S[i + c] = N[i * 3 + c] + N[(i + 1) * 3 + c] + N[(i + 2) * 3 + c];
    const M = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0, sz = 0;
      for (const j of group[i]) { const f = j - j % 3; sx += S[f] * W[j]; sy += S[f + 1] * W[j]; sz += S[f + 2] * W[j]; }
      const l = Math.hypot(sx, sy, sz);
      if (l < 1e-6) { M[i * 3] = N[i * 3]; M[i * 3 + 1] = N[i * 3 + 1]; M[i * 3 + 2] = N[i * 3 + 2]; }
      else { M[i * 3] = sx / l; M[i * 3 + 1] = sy / l; M[i * 3 + 2] = sz / l; }
    }
    N = M;
  }
  // fix(p, f, n): a last say over each corner's normal n (p its position, f its face's normal)
  const pp = new THREE.Vector3(), ff = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    nn.fromArray(N, i * 3);
    if (fix) { pp.fromBufferAttribute(P, i); ff.fromArray(F, i * 3); fix(pp, ff, nn); }
    // never a zero or NaN normal: a collapsed sliver's would shade NaN, and
    // bloom spreads one NaN pixel into a black octagon over the car
    const l = nn.length();
    if (!(l > 1e-4)) {
      nn.set(0, 0, 0);
      for (const j of buckets.get(key(i))) nn.x += F[j * 3], nn.y += F[j * 3 + 1], nn.z += F[j * 3 + 2];
      if (!(nn.length() > 1e-4)) nn.set(0, 1, 0);
    }
    nn.normalize().toArray(N, i * 3);
  }
  src.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  src.computeBoundingSphere();
  return src;
}

// Indian number plate: white field, thin black border, black characters.
function plateTexture(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 112;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 512, 112);
  g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(6, 6, 500, 100);
  g.fillStyle = '#121212'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 76px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  g.save(); g.translate(256, 60); g.scale(0.86, 1); g.fillText(text, 0, 0); g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// Planar UVs over each end's plate (front z>0 / rear z<0), facing outwards.
function plateUV(g) {
  const P = g.attributes.position, uv = new Float32Array(P.count * 2);
  const bb = [new THREE.Box3(), new THREE.Box3()], v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) bb[P.getZ(i) > 0 ? 0 : 1].expandByPoint(v.fromBufferAttribute(P, i));
  for (let i = 0; i < P.count; i++) {
    const f = P.getZ(i) > 0, B = bb[f ? 0 : 1];
    const w = Math.max(1e-4, B.max.x - B.min.x), h = Math.max(1e-4, B.max.y - B.min.y);
    const x = (P.getX(i) - B.min.x) / w;
    uv[i * 2] = f ? x : 1 - x;
    uv[i * 2 + 1] = (P.getY(i) - B.min.y) / h;
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
  blob(0, cz, hw * 1.1, hl * 1.05, 0.6, 0.5);   // soft penumbra, ends inside the plane
  blob(0, cz, hw * 0.85, hl * 0.85, 0.7, 0.6);    // denser core under the floor
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
    opacity: tier === 'high' ? 0.92 : 0.95, fog: true,
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
 * The car's reflections: a gradient dome from the live sky colours plus two
 * soft white "softbox" strips overhead for the long highlight a real car
 * shows along its shoulder. The sun itself isn't in it: the sun light's own
 * specular (clearcoat included) draws that highlight.
 *
 * The dome is linear in its colours, so instead of re-prefiltering it as the
 * day moves (each PMREM rebuild ran on the main thread mid-drive: a hitch), two
 * *weight* maps are prefiltered once, behind the loader:
 *   A.rgb = how much horizon / zenith / ground each direction sees,
 *   B.r   = the softbox strips,
 * and the car's shaders mix them with the current colours per pixel:
 *   env = hor·A.r + top·A.g + ground·A.b + strip·B.r
 * — exact at every point of the drive, and free to change every frame. */

let envA = null, envB = null;
const envU = {
  carEnvB: { value: null },
  carEnvHor: { value: new THREE.Color() }, carEnvTop: { value: new THREE.Color() },
  carEnvGround: { value: new THREE.Color() }, carEnvStrip: { value: new THREE.Color() }
};

/* Prefiltering costs seconds on first use, so main.js calls this behind the
 * loader, before shaders compile: building it after the page showed froze
 * the first drive. */
function prepareEnv() {
  if (envA || !envMats.length) return;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  const basis = { value: 0 };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: { basis },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: /* glsl */`
      uniform int basis;
      varying vec3 vD;
      void main(){
        vec3 d = normalize(vD);
        float wTop = pow(max(d.y, 0.0), 0.5), wGround = smoothstep(0.02, -0.12, d.y);
        // softboxes: two long bright strips overhead, along the car's length
        float strip = smoothstep(0.93, 0.97, d.y) * (0.6 + 0.4 * smoothstep(0.1, 0.0, abs(abs(d.x) - 0.18)));
        gl_FragColor = basis == 0
          ? vec4((1.0 - wTop) * (1.0 - wGround), wTop * (1.0 - wGround), wGround, 1.0)
          : vec4(strip, 0.0, 0.0, 1.0);
      }`
  }));
  scene.add(dome);
  envA = pmrem.fromScene(scene, 0.015, 0.1, 100);
  basis.value = 1;
  envB = pmrem.fromScene(scene, 0.015, 0.1, 100);
  pmrem.dispose(); dome.geometry.dispose(); dome.material.dispose();
  envU.carEnvB.value = envB.texture;
  envMats.forEach(m => {
    m.envMap = envA.texture;
    m.userData.env0 = m.envMapIntensity;
    m.onBeforeCompile = carEnvShader;
    m.customProgramCacheKey = () => 'carEnv';
    m.needsUpdate = true;
  });
  updateEnv();
}

// Every textureCubeUV(envMap, …) lookup in the IBL chunk becomes carEnv(…).
function carEnvShader(sh) {
  Object.assign(sh.uniforms, envU);
  sh.fragmentShader = sh.fragmentShader.replace('#include <envmap_physical_pars_fragment>', /* glsl */`
    #ifdef ENVMAP_TYPE_CUBE_UV
      uniform sampler2D carEnvB;
      uniform vec3 carEnvHor, carEnvTop, carEnvGround, carEnvStrip;
      vec4 carEnv( vec3 dir, float rough ) {
        vec3 a = textureCubeUV( envMap, dir, rough ).rgb;
        float b = textureCubeUV( carEnvB, dir, rough ).r;
        return vec4( carEnvHor * a.r + carEnvTop * a.g + carEnvGround * a.b + carEnvStrip * b, 1.0 );
      }
    #endif
    ` + THREE.ShaderChunk.envmap_physical_pars_fragment.replaceAll('textureCubeUV( envMap, ', 'carEnv( '));
}

// Per frame: the dome's colours from the live sky (a few uniform copies).
function updateEnv() {
  const U = world.U, dusk = U.uDusk.value;
  envU.carEnvHor.value.copy(U.uSkyHor.value);
  envU.carEnvTop.value.copy(U.uSkyTop.value);
  envU.carEnvGround.value.copy(U.uFogCol.value).multiplyScalar(0.25);
  envU.carEnvStrip.value.setScalar(0.55 * (1 - dusk * 0.7));
  // the sky dims at dusk faster than the dome gradient suggests: keep the
  // car's reflections in step with the scene so it doesn't look self-lit
  const dim = 1 - 0.85 * dusk;
  for (const m of envMats) if (m.userData.env0 != null) m.envMapIntensity = m.userData.env0 * dim;
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

// The car starts here, far enough down the road that the rear three-quarter
// title camera has road and ground behind it (s < 0 is nothing). It drives
// from the very first scroll: the head start shrinks to nothing by CATCH_S,
// so the car moves at ~0.4x scroll speed at first and 1x from CATCH_S on.
const PARK_S = 36, CATCH_S = 120;

function update(dt, s) {
  if (s < CATCH_S) s += PARK_S * (1 - s / CATCH_S) ** 2;
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
  // a detour drives into a venue compound: allow real turns off the road there
  const yawT = detour.carYaw != null ? clamp(detour.carYaw, -1.45, 1.45)
    : Math.abs(ds) > 0.02 && Math.abs(dLat) > 1e-4 ? clamp(-Math.atan(dLat / ds), -0.35, 0.35) : 0;
  state.yaw += (yawT - state.yaw) * damp(8, dt);

  path.sample(s, S);
  path.toWorld(s, state.lateral, pos);
  state.heading = S.heading;
  fwd.copy(S.fwd);

  // sit on the ground under each track (the shoulder falls away): height is
  // the mean of the two sides, the difference becomes a small camber roll
  const track = axleInfo.tx ? axleInfo.tx * 2 : 1.52;
  let yL = groundY(s, state.lateral - track / 2), yR = groundY(s, state.lateral + track / 2);
  // venue courts and drives are paved at road level (core/timeline.js COURTS, dam.js pad)
  if (detour.carLatExact != null) { const fl = path.roadY(s) + ROAD_LIFT; yL = Math.max(yL, fl); yR = Math.max(yR, fl); }
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
  if (envA) updateEnv();
}

const tmpL = new THREE.Vector3();
function lamp(name, out = new THREE.Vector3()) {
  return body.localToWorld(out.copy(lampPos[name] || tmpL.set(0, 0.8, 0)));
}

export const car = {
  init, prepareEnv, update, object, body, pos, fwd, LANE, model: null, indicate, lamp,
  get heading() { return state.heading; },
  get lateral() { return state.lateral; },
  get s() { return state.s; },
  get speed() { return state.vs; },
  get accel() { return state.acc; }
};
