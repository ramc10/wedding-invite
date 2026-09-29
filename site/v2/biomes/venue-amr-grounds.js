/* AMR Unnati grounds: forecourt, lawns, planting, landscape lighting, gate piers. Built into the
 * 'dam' zone's visibility window. Layout: AMR from biomes/dam.js (lot, gate, hall footprint).
 * Reference: the architect's dusk render (grey stone slabs with grass joints, raised granite
 * planters with sculpted bonsai trees, low warm landscape light). No text anywhere.
 * Draw calls: pavers, drive, lawn, stone, bark, foliage, glow, pools + flora bush/grass/flowers. */
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/addons/utils/BufferGeometryUtils.js';
import { AMR } from './dam.js';
import { plant } from './flora.js';
import { rng as makeRng } from '../core/noise.js';

const TIER = { low: 0.4, med: 0.65, high: 1 };
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function speckle(g, w, h, r, n, base, spread, alpha) {
  for (let i = 0; i < n; i++) {
    const v = base + (r() - 0.5) * spread | 0;
    g.fillStyle = `rgba(${v},${v - 2},${v - 6},${alpha})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

/* Large light-grey stone slabs 1.2 x 0.6 m, stretcher-bond rows, with thin grass in the joints.
 * Tile = 4.8 m (across, u) x 4.8 m (along, v): 4 slabs x 8 rows. 512 px → ~10.7 px per 10 cm. */
function paverTex() {
  return canvasTex(512, 512, (g, w, h) => {
    const r = makeRng('amr-pavers'), px = w / 4.8;
    g.fillStyle = '#5d7a30'; g.fillRect(0, 0, w, h);                 // grass bed
    for (let i = 0; i < 1800; i++) {                                  // blades
      g.fillStyle = `rgba(${80 + r() * 60 | 0},${120 + r() * 70 | 0},${35 + r() * 30 | 0},0.85)`;
      g.fillRect(r() * w, r() * h, 1, 2 + r() * 3);
    }
    const J = 0.1 * px;                                             // joint width
    for (let row = 0; row < 8; row++) {
      const off = (row % 2) * 0.6 * px, y = row * 0.6 * px;
      for (let k = -1; k < 5; k++) {
        const x = k * 1.2 * px + off, v = 176 + r() * 26 | 0;
        g.fillStyle = `rgb(${v},${v - 1},${v - 5})`;
        g.fillRect(x + J / 2, y + J / 2, 1.2 * px - J, 0.6 * px - J);
        g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x + J / 2, y + J / 2, 1.2 * px - J, 1.5);
      }
    }
    speckle(g, w, h, r, 9000, 170, 70, 0.22);
    for (let i = 0; i < 14; i++) {                                    // a few fallen leaves, as in the render
      g.fillStyle = `rgba(${200 + r() * 40 | 0},${140 + r() * 40 | 0},60,0.85)`;
      g.beginPath(); g.ellipse(r() * w, r() * h, 3, 1.6, r() * 3, 0, 7); g.fill();
    }
  });
}

/* Drive: darker honed granite slabs 0.9 x 0.45 with thin dark joints. Tile 3.6 m. */
function driveTex() {
  return canvasTex(512, 512, (g, w, h) => {
    const r = makeRng('amr-drive'), px = w / 3.6;
    g.fillStyle = '#4a4744'; g.fillRect(0, 0, w, h);
    for (let row = 0; row < 8; row++) for (let k = -1; k < 5; k++) {
      const x = k * 0.9 * px + (row % 2) * 0.45 * px, y = row * 0.45 * px, v = 128 + r() * 18 | 0;
      g.fillStyle = `rgb(${v},${v - 2},${v - 6})`; g.fillRect(x + 1.5, y + 1.5, 0.9 * px - 3, 0.45 * px - 3);
    }
    speckle(g, w, h, r, 12000, 130, 80, 0.25);
  });
}

function lawnTex() {
  return canvasTex(256, 256, (g, w, h) => {
    const r = makeRng('amr-lawn');
    g.fillStyle = '#4f6d2a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${55 + r() * 45 | 0},${90 + r() * 55 | 0},${25 + r() * 25 | 0},0.55)`;
      g.fillRect(r() * w, r() * h, 1, 2 + r() * 2);
    }
    g.fillStyle = 'rgba(255,255,230,0.05)';                           // faint mowing stripes
    for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 32, h);
  });
}

function stoneTex() {
  return canvasTex(256, 256, (g, w, h) => {
    const r = makeRng('amr-stone');
    g.fillStyle = '#d8d2c6'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, r, 14000, 200, 90, 0.35);
  });
}

function barkTex() {
  return canvasTex(256, 128, (g, w, h) => {                        // u runs along the trunk: furrows along x
    const r = makeRng('amr-bark');
    g.fillStyle = '#8a7a68'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      const v = 90 + r() * 110 | 0;
      g.fillStyle = `rgba(${v},${v - 10},${v - 22},0.55)`; g.fillRect(r() * w, r() * h, 12 + r() * 50, 1 + r() * 2);
    }
  });
}

function poolTex() {
  return canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, false);
}

/* ---------- geometry helpers (road space: s along, l lateral; local x = +lateral, local -z = +s) ---------- */

function flipIfDown(g) {
  g.computeVertexNormals();
  const n = g.attributes.normal.array;
  if (n[1] < 0 && g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    g.computeVertexNormals();
  }
  return g;
}

/** Flat grid over a road-space rectangle at height y; uv in metres / T (u across, v along). */
function surf(ctx, s0, s1, l0, l1, y, T, step = 2, swap = false) {
  const ns = Math.max(1, Math.ceil((s1 - s0) / step)), nl = Math.max(1, Math.ceil((l1 - l0) / 4));
  const pos = [], uv = [], idx = [], p = new THREE.Vector3();
  for (let i = 0; i <= ns; i++) for (let j = 0; j <= nl; j++) {
    const s = s0 + (s1 - s0) * i / ns, l = l0 + (l1 - l0) * j / nl;
    ctx.path.toWorld(s, l, p); pos.push(p.x, y, p.z); if (swap) uv.push(s / T, l / T); else uv.push(l / T, s / T);
    if (i && j) { const a = (i - 1) * (nl + 1) + j - 1, b = a + 1, d = a + nl + 1, e = d + 1; idx.push(a, b, d, b, e, d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return flipIfDown(g);
}

/** Strip of width w along a centreline of [s, l] points, at height y. */
function strip(ctx, pts, w, y, T, lmin = -1e9) {
  const pos = [], uv = [], idx = [], p = new THREE.Vector3();
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let ds = b[0] - a[0], dl = b[1] - a[1]; const L = Math.hypot(ds, dl) || 1; ds /= L; dl /= L;
    if (i) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    for (const k of [-1, 1]) {
      ctx.path.toWorld(pts[i][0] - dl * k * w / 2, Math.max(lmin, pts[i][1] + ds * k * w / 2), p);   // clamp to the wall line
      pos.push(p.x, y, p.z); uv.push((k + 1) * w / 4 / T, acc / T);
    }
    if (i) { const q = (i - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return flipIfDown(g);
}

/** Place a local geometry at road (s, l), height y, yawed with the road (+ extra yaw). */
function at(ctx, geo, s, l, y, yaw = 0) {
  ctx.path.toWorld(s, l, _v); _v.y = y;
  _m.compose(_v, _q.setFromAxisAngle(_up, ctx.path.sample(s).heading + yaw), new THREE.Vector3(1, 1, 1));
  return geo.applyMatrix4(_m);
}

/** Box: w across (lateral, x), h up, d along the road (z); uv in metres / T. Base at y = 0. */
function box(w, h, d, T = 1) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed().translate(0, h / 2, 0);
  const uv = g.attributes.uv.array, du = [d, d, w, w, w, w], dv = [h, h, d, d, h, h];
  for (let i = 0; i < uv.length / 2; i++) { const f = (i / 6) | 0; uv[i * 2] *= du[f] / T; uv[i * 2 + 1] *= dv[f] / T; }
  return g;
}

function tint(g, hex, k = 1) {
  const c = new THREE.Color(hex).multiplyScalar(k), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function merge(list) {
  if (!list.length) return new THREE.BufferGeometry();
  return mergeGeometries(list.map(g => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) n.deleteAttribute(k);
    const N = n.attributes.position.count;
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(N * 2), 2));
    if (!n.attributes.color) n.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(N * 3).fill(1), 3));
    if (!n.attributes.normal) n.computeVertexNormals();
    return n;
  }), false);
}

/* ---------- sculpted bonsai-style tree: twisted tapering trunk, a few arms, cloud-pruned pads ---------- */

/** Tapered, gnarled tube along a curve; rad(t) gives the radius. */
function tube(curve, seg, radial, rad, seed) {
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const p = g.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg; curve.getPointAt(t, c);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j, a = j / radial * Math.PI * 2;
      v.fromBufferAttribute(p, k).sub(c);
      const gn = 1 + 0.16 * Math.sin(a * 3 + t * 11 + seed) + 0.08 * Math.sin(a * 5 - t * 7);
      v.multiplyScalar(rad(t) * gn).add(c); p.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** Natural boulder: a displaced icosphere, flat-bottomed, faceted like weathered granite. */
function rock(R, sx, sy, sz, seed) {
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = 1 + 0.22 * Math.sin(x * 2.3 + seed) * Math.cos(z * 2.1 - seed) + 0.1 * Math.sin(y * 5 + x * 3 + seed * 2);
    p.setXYZ(i, x * R * sx * d, Math.max(-0.25, y) * R * sy * d, z * R * sz * d);
  }
  g.computeVertexNormals();
  return g;
}

const LEAF = [0x6f8f3e, 0x7a9446, 0x5f8238, 0x86a04c];

/** Local-space tree at origin: { bark: [geo], pads: [{x, y, z, R, f, c}] }. H = height; feature = big spreading tree. */
function bonsai(seed, H, detail, feature = false) {
  const r = makeRng('amr-bonsai-' + seed), bark = [], pads = [];
  const ang = r() * Math.PI * 2, lean = H * (feature ? 0.18 : 0.28), r0 = H * (feature ? 0.055 : 0.065);
  const dx = Math.cos(ang), dz = Math.sin(ang), px = -dz, pz = dx;
  const pts = [0, 0.22, 0.45, 0.68, 0.86, 1].map((t, i) => {
    const sw = Math.sin(t * Math.PI * 1.6 + r()) * lean, side = (r() - 0.5) * lean * 0.6;
    return new THREE.Vector3(dx * sw * t * 1.3 + px * side * t, t * H * 0.82, dz * sw * t * 1.3 + pz * side * t);
  });
  const trunk = new THREE.CatmullRomCurve3(pts);
  bark.push(tube(trunk, detail > 1 ? 16 : 10, detail > 1 ? 7 : 5, t => r0 * (0.32 + 0.68 * (1 - t) + 0.7 * Math.pow(1 - t, 8)), seed));
  const top = trunk.getPointAt(1), col = LEAF[(r() * LEAF.length) | 0];
  pads.push({ x: top.x, y: top.y + H * 0.04, z: top.z, R: H * (feature ? 0.3 : 0.26), f: 0.5, c: col });
  const nb = feature ? 7 : 3 + (seed % 2);
  for (let b = 0; b < nb; b++) {
    const t = 0.42 + 0.5 * b / nb + 0.05 * r(), s0 = trunk.getPointAt(t);
    const a = ang + Math.PI * (0.6 + 1.3 * b / nb) + r() * 0.8, L = H * (feature ? 0.42 : 0.33) * (0.7 + 0.5 * r()) * (1.1 - t * 0.4);
    const e = new THREE.Vector3(s0.x + Math.cos(a) * L, s0.y + L * (0.15 + 0.35 * r()), s0.z + Math.sin(a) * L);
    const m = s0.clone().lerp(e, 0.5); m.y -= L * 0.12;
    bark.push(tube(new THREE.CatmullRomCurve3([s0, m, e]), detail > 1 ? 6 : 4, 5, u => r0 * 0.42 * (1 - 0.6 * u) * (1.1 - t * 0.5), seed + b));
    const R = H * (feature ? 0.22 : 0.19) * (0.75 + 0.45 * r());
    pads.push({ x: e.x, y: e.y + R * 0.1, z: e.z, R, f: 0.42 + 0.12 * r(), c: col });
  }
  return { bark, pads };
}

/* ---------- layout ---------- */

function layout(ctx) {
  const { LOT, GATE, hall, wallL } = AMR;
  const o = hall.s, F0 = o - hall.w / 2, F1 = o + hall.w / 2, HF = hall.front, HB = hall.front + hall.d;
  const L0 = wallL + 0.18, L1 = LOT.l1 - 0.1, Gc = GATE.c;
  const PY = ctx.path.roadY(AMR.VENUE.s) + 0.02;
  // drive: the car's own route (same centripetal Catmull-Rom as car/detour.js): in through the gate,
  // up to the drop-off under the canopy, then along the hall front and out through the exit gate
  const cr = pts => new THREE.CatmullRomCurve3(pts.map(([s, l]) => new THREE.Vector3(s, l, 0)), false, 'centripetal');
  const { in: rin, out: rout } = AMR.route;
  const sp = (c, n) => c.getSpacedPoints(n).map(p => [p.x, p.y]);
  const cin = sp(cr(rin), 60), cout = sp(cr(rout), 60);
  const drive = [...cin, ...cout.slice(1)];
  // clearance: distance from (s, l) to the route (both the waypoint polyline and the driven curve)
  const lines = [rin, rout, cin, cout];
  const dist = (s, l) => {
    let d = 1e9;
    for (const P of lines) for (let i = 1; i < P.length; i++) {
      const [as, al] = P[i - 1], ds = P[i][0] - as, dl = P[i][1] - al, n = ds * ds + dl * dl || 1;
      const t = Math.min(1, Math.max(0, ((s - as) * ds + (l - al) * dl) / n));
      d = Math.min(d, Math.hypot(s - as - t * ds, l - al - t * dl));
    }
    return d;
  };
  const CLR = 2.4, clear = (s, l, r = 0) => dist(s, l) - r > CLR;
  return { o, F0, F1, HF, HB, L0, L1, Gc, PY, drive, DW: 5, LOT, GATE, EXIT: AMR.EXIT, wallL, dist, clear, CLR };
}

/** Raised planter with a granite kerb (w across, d along), soil top; LED strip at the base on `ledSides`. */
function planter(ctx, S, L, s0, s1, l0, l1, h, out, ledSides = '') {
  const y = L.PY, w = l1 - l0, d = s1 - s0, sc = (s0 + s1) / 2, lc = (l0 + l1) / 2, k = 0.22;
  const stone = 0xcfc9bd;
  out.stone.push(tint(at(ctx, box(w, h, k), s0 + k / 2, lc, y), stone));
  out.stone.push(tint(at(ctx, box(w, h, k), s1 - k / 2, lc, y), stone));
  out.stone.push(tint(at(ctx, box(k, h, d - 2 * k), sc, l0 + k / 2, y), stone));
  out.stone.push(tint(at(ctx, box(k, h, d - 2 * k), sc, l1 - k / 2, y), stone));
  out.stone.push(tint(at(ctx, box(w - 2 * k, 0.02, d - 2 * k, 2), sc, lc, y + h - 0.08), 0x5e4a38));   // soil / mulch
  // warm LED strip tucked under the kerb's shadow gap
  const led = (g, s, l) => out.glow.push(tint(at(ctx, g, s, l, y + 0.03), 0xffc27a));
  if (ledSides.includes('w')) led(box(0.03, 0.035, d - 0.2), sc, l0 - 0.02);
  if (ledSides.includes('e')) led(box(0.03, 0.035, d - 0.2), sc, l1 + 0.02);
  if (ledSides.includes('s')) led(box(w - 0.2, 0.035, 0.03), s0 - 0.02, lc);
  if (ledSides.includes('n')) led(box(w - 0.2, 0.035, 0.03), s1 + 0.02, lc);
  return y + h - 0.08;                                                // soil level
}

/** Modern gate pier: beige stone, vertical warm LED slit on both broad faces, slim dark metal cap. */
function gatePier(ctx, s, L, out) {
  const y = L.PY, H = 2.4, W = 0.95, D = 0.95, beige = 0xd9c6a6;
  out.stone.push(tint(at(ctx, box(D, H + 0.2, W), s, L.wallL, y - 0.2), beige));
  out.stone.push(tint(at(ctx, box(D + 0.08, 0.07, W + 0.08), s, L.wallL, y + H), 0x2b2a2a));
  out.stone.push(tint(at(ctx, box(D + 0.02, 0.05, W + 0.02), s, L.wallL, y), 0x9d968a));      // plinth line
  for (const f of [-1, 1]) {
    out.glow.push(tint(at(ctx, box(0.02, 1.5, 0.05), s, L.wallL + f * (D / 2 + 0.005), y + 0.45), 0xffc98a));
    // outside the wall the apron ramps down to the road (dam.js): sit the pool on it, not at pad level
    const l = L.wallL + f * 1.2, Yr = ctx.path.roadY(s), t = Math.min(1, Math.max(0, (l - 3.45) / (L.wallL - 3.45)));
    const ya = Yr + 0.025 + (y - Yr) * t * t * (3 - 2 * t);
    out.pools.push({ s, l, r: 1.4, k: 0.35, dy: f < 0 ? ya - y : 0 });
  }
}

/** Flora instances at exact heights (plant() drops them on the terrain; the lot is a raised pad). */
function flora(ctx, kind, list, opts = {}) {
  if (!list.length) return null;
  const W = ctx.world, h0 = W.heightSL;
  let cur = null;
  W.heightSL = (s, l) => cur ? cur.y : h0(s, l);          // plant() reads the ground height right after place()
  try {
    return plant(ctx, { kind, count: list.length, place: (R, i) => (cur = list[i]), seed: 'amr-' + kind, ...opts });
  } finally { W.heightSL = h0; }
}

function makeMats(T) {
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, ...o });
  const M = {
    pave: std({ map: T.pave, roughness: 0.82, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    drive: std({ map: T.drive, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    lawn: std({ map: T.lawn, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    stone: std({ map: T.stone, vertexColors: true, roughness: 0.78 }),
    bark: std({ map: T.bark, vertexColors: true, roughness: 0.95, emissiveMap: T.bark, emissive: 0x000000 }),   // uplit at dusk
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    pool: new THREE.MeshBasicMaterial({ map: T.pool, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }),
  };
  return M;
}

function mesh(geo, mat, name, cast = false) {
  const m = new THREE.Mesh(geo, mat); m.name = name; m.receiveShadow = true; m.castShadow = cast;
  return m;
}

/** Additive light pools: flat quads (rs along s, rl across) tinted warm, strength k. */
function poolGeo(ctx, pools, y) {
  const list = pools.map(p => {
    const g = new THREE.PlaneGeometry(2 * (p.rl ?? p.r), 2 * (p.rs ?? p.r)).rotateX(-Math.PI / 2);
    return tint(at(ctx, g, p.s, p.l, y + (p.dy ?? 0)), p.col ?? 0xffb56a, p.k);
  });
  return merge(list);
}

export default {
  id: 'dam',
  build(ctx) {
    const t0 = performance.now();
    const K = TIER[ctx.quality?.tier] ?? 0.65, detail = K > 0.8 ? 2 : 1;
    const L = layout(ctx), { o, F0, F1, HF, HB, L0, L1, Gc, PY, LOT, GATE } = L;
    const group = new THREE.Group(); group.name = 'venue-amr-grounds';
    const T = { pave: paverTex(), drive: driveTex(), lawn: lawnTex(), stone: stoneTex(), bark: barkTex(), pool: poolTex() };
    T.bark.repeat.set(3, 2);
    const M = makeMats(T);
    const out = { stone: [], glow: [], bark: [], pools: [] };
    const fl = { grass: [], flowers: [], broadleaf: [] };
    const R = makeRng('amr-grounds');

    // 1. forecourt pavers (grass joints), lawns either side and behind the hall, the drive
    group.add(mesh(surf(ctx, F0, F1, L0 - 0.6, HF + 0.4, PY + 0.03, 4.8, 2, true), M.pave, 'amr:forecourt'));
    const lawn = [surf(ctx, LOT.s0 + 0.2, F0, L0, L1, PY + 0.03, 6), surf(ctx, F1, LOT.s1 - 0.2, L0, L1, PY + 0.03, 6),
      surf(ctx, F0, F1, HB - 0.4, L1, PY + 0.03, 6)];
    group.add(mesh(merge(lawn), M.lawn, 'amr:lawns'));
    const LM = L.wallL - 0.35;                                        // the drive starts at the wall line
    group.add(mesh(strip(ctx, L.drive, L.DW, PY + 0.045, 3.6, LM), M.drive, 'amr:drive'));
    for (const k of [-1, 1]) {                                        // slim granite edge bands along the drive
      const edge = L.drive.map((p, i, a) => {
        const q = a[Math.min(a.length - 1, i + 1)], r = a[Math.max(0, i - 1)], ds = q[0] - r[0], dl = q[1] - r[1], n = Math.hypot(ds, dl);
        return [p[0] - dl / n * k * (L.DW / 2 + 0.08), p[1] + ds / n * k * (L.DW / 2 + 0.08)];
      });
      out.stone.push(tint(strip(ctx, edge, 0.16, PY + 0.05, 1, LM), 0xa39d92));
    }

    // 2. planters: along both forecourt edges, and along the hall's base either side of the entrance
    const soilW = planter(ctx, null, L, F0 + 0.4, F0 + 2.6, 12.2, 23.4, 0.5, out, 'n');
    const soilE = planter(ctx, null, L, F1 - 2.6, F1 - 0.4, 12.2, 23.4, 0.5, out, 's');
    const soilB = planter(ctx, null, L, F0 + 3.4, o - 9, 22.9, 24.5, 0.42, out, 'w');
    planter(ctx, null, L, o + 11.5, F1 - 3.4, 22.9, 24.5, 0.42, out, 'w');
    out.pools.push({ s: F0 + 3.0, l: 17.8, rs: 0.9, rl: 6.5, k: 0.28 }, { s: F1 - 3.0, l: 17.8, rs: 0.9, rl: 6.5, k: 0.28 },
      { s: (F0 + 3.4 + o - 9) / 2, l: 22.4, rs: 6, rl: 0.8, k: 0.25 }, { s: (o + 11.5 + F1 - 3.4) / 2, l: 22.4, rs: 5, rl: 0.8, k: 0.25 });
    const trees = [
      [F0 + 1.5, 14.4, soilW, 3.3], [F0 + 1.5, 18.6, soilW, 2.5], [F0 + 1.5, 22.0, soilW, 3.0],
      [F1 - 1.5, 13.8, soilE, 3.5], [F1 - 1.5, 17.4, soilE, 2.6], [F1 - 1.5, 21.6, soilE, 3.1],
      [F0 + 7, 23.6, soilB, 2.2], [o - 13.5, 23.6, soilB, 2.0], [o + 15, 23.6, soilB, 2.0], [F1 - 7, 23.6, soilB, 2.3],
    ];
    // feature trees on low stone plinths on the lawns, each with a boulder, like the render's left tree
    for (const [s, l, H] of [[(LOT.s0 + F0) / 2, 17, 5.2], [F1 + 6, 18.5, 5.6], [F1 + 15, 27, 4.8]]) {
      const hw = Math.min(2, (F0 - LOT.s0) / 2 - 0.4), soil = planter(ctx, null, L, s - hw, s + hw, l - 2, l + 2, 0.38, out, 'nswe');
      trees.push([s, l, soil, H, true]);
      out.stone.push(tint(at(ctx, rock(0.6, 1.3, 0.8, 1, s), s + hw * 0.45, l - 1.1, soil + 0.15), 0x7d776c));
      for (const d of [-1, 1]) out.pools.push({ s: s + d * hw * 0.45, l: l - 1.4, r: 1.3, k: 0.45, dy: soil - PY });
    }
    // a natural boulder in the west planter, as in the render
    out.stone.push(tint(at(ctx, rock(0.5, 1.4, 0.85, 1, 3), F0 + 1.5, 16.4, soilW + 0.1, 0.6), 0x86806f));

    // foliage cushions: flora 'bush' leaf clusters, scaled into cloud-pruned pads and clipped hedges
    const cushions = [], BR = 1.45, BH = 1.9;                          // the bush model's radius and height
    const cushion = (pos, rx, ry, rz, yaw, col) => cushions.push({ m: new THREE.Matrix4().compose(pos.clone().setY(pos.y - ry * 0.67),
      new THREE.Quaternion().setFromAxisAngle(_up, yaw), new THREE.Vector3(rx / BR, ry * 2 / BH, rz / BR)), c: new THREE.Color(col).multiplyScalar(1.25 + 0.4 * R()) });

    // 3. trees: merged bark + foliage
    const skipped = [];
    trees.forEach(([s, l, y, H, feat], i) => {
      if (!L.clear(s, l, H * (feat ? 0.5 : 0.4))) { skipped.push([s - Gc, l]); return; }   // keep the car's corridor clear
      const t = bonsai(i + 1, H, detail, !!feat), yaw = R() * 6.28;
      for (const g of t.bark) out.bark.push(tint(at(ctx, g, s, l, y - 0.05, yaw), 0xc4b29c, 0.8 + 0.3 * R()));
      ctx.path.toWorld(s, l, _v); _v.y = y;
      const tm = new THREE.Matrix4().compose(_v.clone(), new THREE.Quaternion().setFromAxisAngle(_up, ctx.path.sample(s).heading + yaw), new THREE.Vector3(1, 1, 1));
      for (const p of t.pads) cushion(new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(tm), p.R, p.R * p.f, p.R, R() * 6.28, p.c);
      if (!feat) {                                                   // small uplight at the foot of each bonsai
        out.glow.push(tint(at(ctx, new THREE.CylinderGeometry(0.06, 0.07, 0.05, 8).toNonIndexed(), s - 0.35, l - 0.3, y + 0.02), 0xffd9a0));
        out.pools.push({ s, l, r: 0.9, k: 0.35, dy: y - PY });
      }
    });

    // 4. gate piers in both wall openings; the drop-off pool under the canopy; a warm pool at the exit
    const X = L.EXIT, stop = AMR.route.in[AMR.route.in.length - 1];
    gatePier(ctx, GATE.s0 - 0.25, L, out); gatePier(ctx, GATE.s1 + 0.25, L, out);
    gatePier(ctx, X.s0 - 0.25, L, out); gatePier(ctx, X.s1 + 0.25, L, out);
    out.pools.push({ s: stop[0] - 2, l: stop[1] + 0.2, rs: 8, rl: 4.2, k: 0.5, col: 0xffc080 });
    out.pools.push({ s: X.c, l: L.wallL + 2.6, rs: 4.6, rl: 2.4, k: 0.45, col: 0xffc080 });   // inside only: the apron outside falls away

    // 5. low bollard lights along both edges of the drive
    const post = box(0.16, 0.62, 0.16), cap = box(0.2, 0.05, 0.2), lens = box(0.17, 0.09, 0.17);
    for (let i = 3; i < L.drive.length - 1; i += 5) {
      const p = L.drive[i], q = L.drive[i + 1], ds = q[0] - p[0], dl = q[1] - p[1], n = Math.hypot(ds, dl);
      for (const k of [-1, 1]) {
        const s = p[0] - dl / n * k * (L.DW / 2 + 0.55), l = p[1] + ds / n * k * (L.DW / 2 + 0.55);
        if (l < L0 + 0.6 || l > HF - 1.2 || (s > o - 17 && s < o + 2.4 && l > 13.2) || !L.clear(s, l, 0.1)) continue;   // clear of the wall, the canopy, the route
        out.stone.push(tint(at(ctx, post.clone(), s, l, PY), 0x2c2c2e), tint(at(ctx, cap.clone(), s, l, PY + 0.69), 0x2c2c2e));
        out.glow.push(tint(at(ctx, lens.clone(), s, l, PY + 0.6), 0xffcf94));
        out.pools.push({ s, l, r: 1.1, k: 0.42 });
      }
    }

    // 6. low clipped hedges inside the boundary wall on both lawns, and along the back wall
    const hedge = (s0, s1, l, w, h) => {
      const N = Math.max(2, Math.round((s1 - s0) / 1.15)), col = 0x62843a;
      for (let i = 0; i <= N; i++) {
        const s = s0 + (s1 - s0) * i / N; ctx.path.toWorld(s, l, _v); _v.y = PY + h * 0.5;
        cushion(_v, w / 2, h / 2, 0.8, ctx.path.sample(s).heading + (R() - 0.5) * 0.3, col);
      }
    };
    hedge(LOT.s0 + 1, F0 - 0.5, L0 + 0.55, 0.8, 0.85);
    hedge(F1 + 0.5, LOT.s1 - 1, L0 + 0.55, 0.8, 0.85);

    // 7. flora: mounded shrubs along the hall's sides and back; ornamental grasses in the base planters;
    //    white flowers under the bonsai; a few broadleaf shade trees at the lot's far corners
    const n = x => Math.max(1, Math.round(x * K));
    for (let i = 0, N = n(22); i < N; i++) {
      const side = i % 2 ? F1 + 1.8 + R() * 1.2 : F0 - 1.8 - R() * 1.2, l = HF + 1 + (HB - HF - 2) * R();
      const k = 0.55 + 0.4 * R(); ctx.path.toWorld(side, l, _v); _v.y = PY + k * 0.55; cushion(_v, k, k * 0.6, k, R() * 6.28, LEAF[i % 4]);
    }
    const grassRow = (s0, s1, y) => { for (let s = s0; s < s1; s += 0.55 / Math.sqrt(K)) for (const l of [23.3, 24.05]) fl.grass.push({ s: s + 0.2 * R(), lateral: l + 0.1 * R(), y, scale: 0.9 + 0.5 * R() }); };
    grassRow(F0 + 3.8, o - 9.4, soilB); grassRow(o + 11.9, F1 - 3.8, soilB);
    for (const [s, soil] of [[F0 + 1.5, soilW], [F1 - 1.5, soilE]]) for (let i = 0, N = n(16); i < N; i++)
      fl.flowers.push({ s: s + (R() - 0.5) * 1.5, lateral: 12.6 + R() * 10.4, y: soil, scale: 0.5 + 0.3 * R(), tint: R() < 0.7 ? 0xf6f2ea : 0xfff0f4 });
    for (const [s, l] of [[LOT.s0 + 5, 40], [LOT.s0 + 7, 56], [LOT.s1 - 5, 44], [LOT.s1 - 6, 57], [o - 12, 55], [o + 13, 56]])
      fl.broadleaf.push({ s, lateral: l, y: PY, scale: 0.9 + 0.3 * R() });

    group.add(mesh(merge(out.stone), M.stone, 'amr:stone', true));
    group.add(mesh(merge(out.bark), M.bark, 'amr:bark', true));
    if (cushions.length) {                                          // one instanced draw for every pad, hedge and shrub
      const m = flora(ctx, 'bush', cushions.map(() => ({ s: o, lateral: 20, y: PY })));
      const a = m.instanceMatrix.array, c = m.instanceColor.array;
      cushions.forEach((q, i) => { q.m.toArray(a, i * 16); q.c.toArray(c, i * 3); });
      m.count = cushions.length; m.instanceMatrix.needsUpdate = m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere(); m.userData.tris = m.userData.tris / Math.max(1, m.count) * cushions.length;
      m.name = 'amr:foliage'; group.add(m);
    }
    const glow = mesh(merge(out.glow), M.glow, 'amr:glow'); group.add(glow);
    const pools = mesh(poolGeo(ctx, out.pools, PY + 0.07), M.pool, 'amr:pools'); pools.renderOrder = 2; group.add(pools);
    for (const k of Object.keys(fl)) { const m = flora(ctx, k, fl[k]); if (m) group.add(m); }

    let tris = 0;
    group.traverse(m => { if (m.isInstancedMesh) tris += m.userData.tris || 0; else if (m.isMesh) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; });
    window.__amrGrounds = { ms: Math.round(performance.now() - t0), tris: Math.round(tris), calls: group.children.length, o, F0, F1, Gc, PY, skipped };

    const U = ctx.world.U, gcol = M.glow.color;
    return {
      group,
      update() {
        const d = Math.min(1, Math.max(0, U.uDusk.value));
        gcol.setScalar(0.35 + 1.9 * d);
        M.bark.emissive.setRGB(0.16 * d, 0.1 * d, 0.05 * d);
        M.pool.opacity = 0.15 + 0.85 * d;
      }
    };
  }
};
