/* Ground, road and roadside grass for the whole drive, built in road space
 * (s, lateral) from world.heightSL, in 160 m chunks so off-screen chunks cull.
 *
 * Objects (all owned here):
 *  1. Asphalt: a two-lane Indian highway, 7.2 m wide. One strip per chunk.
 *     A 1024 px procedural sheet (albedo, normal and roughness) covers 30 m:
 *     aggregate chips, tyre-polished wheel paths, an oil streak down each lane,
 *     cracks, sealed patches, oil stains, a dusty and crumbly edge. The edge
 *     is alpha-tested so it breaks up raggedly over the gravel shoulder.
 *  2. Lane markings: analytic in the road shader, so they stay crisp at any
 *     distance. Edge lines are 0.15 m solid white; the centre line is 0.15 m,
 *     dashed 3 m on and 4.5 m off. Paint wear comes from the roughness sheet.
 *  3. Shoulders: gravel and dust from the asphalt edge to about 1.5 m out.
 *     They are drawn by the ground shader, so shoulder, verge and field are
 *     one surface with no seam. The ground rises to 2 cm under the asphalt
 *     edge and slopes down to the verge level. The road uses polygonOffset,
 *     so the overlap never z-fights.
 *  4. Verge: worn dirt with a ragged, noise-driven edge into the grass.
 *  5. Terrain chunks: a splatted, detail-textured ground shader with grass,
 *     soil, gravel, sand (with wet sand) and rock, blended by slope, height,
 *     zone and shoreline. Macro, mid and micro detail samples break up tiling,
 *     and a bump map adds close relief. Normals come from a grid with ghost
 *     rows, so neighbouring chunks share identical edge normals (no seams).
 *  6. Aprons: ground discs past each end of the road for the title and ending
 *     views. They use the same ground shader, just under road level.
 *  7. Grass: dense tufts of fine blades (thin, tapered, curved, dark at the
 *     root and light at the tip, 0.25 to 0.6 m tall). Tufts are clumped and
 *     tinted by zone: lush in the forest and garden, golden in the hills,
 *     sparse near sand. They sway in the wind and shrink into the ground
 *     texture at 28 to 46 m. They sit in a band that recycles around the car,
 *     with the count scaled by quality tier.
 *
 * API: init(ctx), update(dt, s, cam), road (Mesh[]), ground (Mesh[]), LAT,
 *      groundColor(s, lateral, y, slope, out) → THREE.Color
 */
import * as THREE from 'three';
import { path } from '../core/path.js';
import { world } from '../core/world.js';
import { ZONES, weightsAt } from '../core/zones.js';
import { fbm, noise2, rng as makeRng, smoothstep } from '../core/noise.js';

const HW = path.halfWidth;          // 3.6: asphalt half-width
const LAT = (() => {
  const v = [0.6, 2, 3.2, 3.5, 3.8, 4.4, 5.1, 5.8, 6.8, 8, 10, 13, 17, 22, 28, 36, 46, 58, 72, 90, 112, 138, 170, 210];
  return [...v.slice().reverse().map(x => -x), ...v];
})();
const DS = 4;           // metres per ground row
const CHUNK = 160;      // metres per chunk
const SHOULDER = 1.5;   // gravel shoulder width beyond the asphalt edge

// per-profile grass tint (sRGB): [lush, dry, far]
const PAL = {
  forest: [0x4f6e2c, 0x6f7a36, 0x3f5c32],
  flat:   [0x5f8a30, 0x8c9a44, 0x557a38],
  hill:   [0x9a8c44, 0xc0a256, 0x7a7444],
  sea:    [0x74903e, 0xa29a58, 0x6a8842],
  drop:   [0x6d6b44, 0x8a7a52, 0x5a5c42]
};
const PALC = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, v.map(h => new THREE.Color(h))]));
const SAND = new THREE.Color(0xdcc7a0), ROCK = new THREE.Color(0x837a6c), DIRT = new THREE.Color(0x8f7a58),
  GRAVEL = new THREE.Color(0x9a927f), DRY = new THREE.Color(0xb09a52);
const _a = new THREE.Color(), _b = new THREE.Color();

/** Splat weights at a spot: grass tint (zone macro colour) + soil, sand, rock, gravel, wet.
 *  w: weightsAt(s), when the caller already has it (a ground row shares one). */
function splat(s, lat, y, slope, o, w = weightsAt(s)) {
  const side = lat < 0 ? 'left' : 'right', d = Math.abs(lat);
  const patch = fbm(s * 0.018 + 7, lat * 0.022, 3);
  const fine = fbm(s * 0.09, lat * 0.09, 2);
  const tint = o.tint.setRGB(0, 0, 0);
  let lush = 0;
  for (let k = 0; k < ZONES.length; k++) {
    if (!w[k]) continue;
    const prof = ZONES[k].profile[side], p = PALC[prof];
    _a.copy(p[0]).lerp(p[1], smoothstep(-0.25, 0.35, patch));
    _a.lerp(p[2], smoothstep(60, 180, d) * 0.7);
    tint.r += _a.r * w[k]; tint.g += _a.g * w[k]; tint.b += _a.b * w[k];
    lush += w[k] * (prof === 'hill' ? 0.2 : prof === 'drop' ? 0.4 : 1);
  }
  const rel = y - path.roadY(s);
  // dry upper slopes, but the line wanders with macro noise instead of a contour band
  const macro = fbm(s * 0.011 + 31, lat * 0.013 + 5, 3), rj = rel + 14 * macro + 6 * fine;
  tint.lerp(DRY, smoothstep(4, 40, rj) * (0.22 + 0.2 * smoothstep(-0.3, 0.4, macro)));
  tint.lerp(DIRT, 0.12 * smoothstep(0.1, 0.6, -macro) * smoothstep(12, 40, d));   // 20–80 m earthy swathes
  tint.multiplyScalar(0.86 + 0.24 * fine + 0.08 * macro);
  o.lush = lush;
  // soil: dry patches in the field + the worn verge beside the shoulder
  const vergeEdge = world.VERGE + 0.8 + 1.4 * noise2(s * 0.3, lat > 0 ? 3 : 9);
  let soil = smoothstep(0.35, 0.75, -patch) * 0.55 * (1.2 - lush);
  soil = Math.max(soil, smoothstep(vergeEdge, vergeEdge - 1.6, d));
  // gravel shoulder: from the asphalt edge out ~1.5 m, ragged
  const gEdge = HW + SHOULDER + 0.5 * (noise2(s * 0.5, lat > 0 ? 5 : 11) - 0.5);
  const gravel = smoothstep(gEdge + 0.5, gEdge - 0.4, d);
  // shoreline sand, wet sand at the water line
  let sand = 0, wet = 0;
  const water = world.waterAt(s);
  if (water !== null && d > HW + 2) {
    sand = smoothstep(water + 2.2, water + 0.7, y);
    wet = smoothstep(water + 0.45, water - 0.3, y);
  }
  const rock = slope > 0.4 ? smoothstep(0.4, 0.95, slope + 0.15 * fine) : 0;
  o.soil = soil; o.sand = sand; o.rock = rock; o.gravel = gravel; o.wet = wet;
  return o;
}

const _sp = { tint: new THREE.Color() };
/** Ground colour at a spot (approximate, after splatting). Grass and other modules tint by it. */
function groundColor(s, lat, y, slope, out = new THREE.Color()) {
  const o = splat(s, lat, y, slope, _sp);
  out.copy(o.tint);
  out.lerp(DIRT, o.soil * 0.85);
  out.lerp(GRAVEL, o.gravel * 0.9);
  out.lerp(SAND, o.sand * 0.95);
  out.lerp(_b.copy(SAND).multiplyScalar(0.72), o.wet * 0.8);
  out.lerp(ROCK, o.rock * 0.9);
  return out;
}

/* Turn rate at s from heading change over ±span (signed: + = turning left). */
const _ts = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(), heading: 0, curvature: 0 };
function turn(s, span = 14) {
  const a = path.sample(Math.max(0, s - span), _ts).heading, b = path.sample(Math.min(path.length, s + span), _ts).heading;
  let dh = b - a; if (dh > Math.PI) dh -= 2 * Math.PI; else if (dh < -Math.PI) dh += 2 * Math.PI;
  return dh / (2 * span);
}

/* Soft-clamped lateral so rows never cross on the inside of a bend. */
function safeLat(lat, k) {
  if (!k) return lat;
  const inside = (k > 0 && lat < 0) || (k < 0 && lat > 0);
  if (!inside) return lat;
  const R = 1 / Math.abs(k), Lc = R * 0.8, d = Math.abs(lat);
  const d0 = Math.min(12, Lc * 0.5);
  if (d <= d0) return lat;
  const L2 = Math.max(1, Lc - d0);
  return Math.sign(lat) * (d0 + L2 * (1 - Math.exp(-(d - d0) / L2)));
}

/* Ground height for the mesh: heightSL, except the shoulder rises to meet the
 * asphalt edge (the flat band under the asphalt is dropped out of the way). */
function meshY(s, lat) {
  const d = Math.abs(lat), ry = path.roadY(s);
  if (d <= HW - 0.2) return ry - 0.25;
  if (d < world.VERGE) {
    const t = smoothstep(HW + 0.1, world.VERGE, d);
    return d < HW + 0.1 ? ry - 0.02 - 0.03 * smoothstep(HW + 0.1, HW - 0.1, d) : ry - 0.02 - 0.10 * t;
  }
  return world.heightSL(s, lat);
}

const ground = [], road = [];

/* ---------- procedural texture helpers ---------- */
function hash(x, y) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
/* Periodic value noise over a 1024² random table: pn(u, v, fu, fv) with u, v in
 * [0, 1) tiles exactly with fu × fv cells (fu, fv ≤ 1024, integers). */
function makePN(seed) {
  const T = new Float32Array(1024 * 1024), R = makeRng(seed);
  for (let i = 0; i < T.length; i++) T[i] = R();
  return (u, v, fu, fv) => {
    const x = u * fu, y = v * fv, xi = Math.floor(x), yi = Math.floor(y);
    const tx = x - xi, ty = y - yi, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const i0 = ((xi % fu) + fu) % fu, i1 = (i0 + 1) % fu, j0 = ((yi % fv) + fv) % fv, j1 = (j0 + 1) % fv;
    const a = T[j0 * 1024 + i0], b = T[j0 * 1024 + i1], c = T[j1 * 1024 + i0], d = T[j1 * 1024 + i1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
function canvasTex(W, H, data, srgb) {  // DataTexture: keeps RGB exact under any alpha
  const t = new THREE.DataTexture(new Uint8Array(data.buffer), W, H, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
/* Normal map (RGBA8) from a height field in metres, px size (mx, my) metres. */
function normalFrom(Hf, W, H, mx, my, wrapX) {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const xl = wrapX ? (x - 1 + W) % W : Math.max(0, x - 1), xr = wrapX ? (x + 1) % W : Math.min(W - 1, x + 1);
    const yu = (y - 1 + H) % H, yd = (y + 1) % H;
    const dx = (Hf[y * W + xr] - Hf[y * W + xl]) / (2 * mx), dy = (Hf[yd * W + x] - Hf[yu * W + x]) / (2 * my);
    const l = Math.hypot(dx, dy, 1), i = (y * W + x) * 4;
    out[i] = (-dx / l * 0.5 + 0.5) * 255; out[i + 1] = (-dy / l * 0.5 + 0.5) * 255; out[i + 2] = (1 / l * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  return out;
}

/* Ground detail, tileable 512²: R relief (bump), G broad mottling,
 * B grass strokes, A pebbles/clods. */
function detailPixels() {
  const N = 512, pn = makePN('gdetail'), R = makeRng('detail');
  const strokes = new Float32Array(N * N).fill(0.45), peb = new Float32Array(N * N).fill(0.5);
  for (let i = 0; i < 9000; i++) {          // fine grass strokes, wrapped
    const x = R() * N, y = R() * N, len = 4 + R() * 9, v = R() < 0.45 ? 0.1 : 0.7 + R() * 0.3, dx = (R() - 0.5) * 0.9;
    for (let t = 0; t < len; t++) { const xi = ((Math.round(x + dx * t) % N) + N) % N, yi = ((Math.round(y - t) % N) + N) % N; strokes[yi * N + xi] = v * (1 - 0.4 * t / len) + 0.2 * t / len; }
  }
  for (let i = 0; i < 5200; i++) {          // pebbles and clods
    const cx = R() * N, cy = R() * N, r = 0.8 + Math.pow(R(), 3) * 4.5, v = R() < 0.5 ? 0.08 + R() * 0.2 : 0.7 + R() * 0.3;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const q = Math.hypot(x - cx, (y - cy) * 1.2) / r; if (q > 1) continue;
      const j = (((y % N) + N) % N) * N + (((x % N) + N) % N);
      peb[j] = v * (1 - 0.35 * q * q);
    }
  }
  const data = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, i = (y * N + x) * 4, j = y * N + x;
    const fine = 0.45 * pn(u, v, 32, 32) + 0.3 * pn(u, v, 64, 64) + 0.25 * pn(u, v, 128, 128);
    const broad = 0.6 * pn(u, v, 4, 4) + 0.4 * pn(u, v, 8, 8);
    const pb = peb[j] !== 0.5 ? (peb[j] - 0.5) * 0.35 : 0;
    data[i] = (fine * 0.8 + pb + 0.1) * 255;
    data[i + 1] = broad * 255;
    data[i + 2] = strokes[j] * 255;
    data[i + 3] = peb[j] * 255;
  }
  return data;
}
function detailTexture() { const t = canvasTex(512, 512, new Uint8ClampedArray(512 * 512 * 4), false); t.anisotropy = 8; return t; }

/* Asphalt aggregate, tileable 512² over 1.1 m (≈2 mm/px): R albedo, G height.
 * Angular grey chips 3–12 mm (granite, a few quartz and dark basalt) packed in
 * bitumen binder with fine sand between. Tiled in world metres by the road shader. */
let AGG = null;
function aggregatePixels() {
  const N = 512, R = makeRng('aggregate'), pn = makePN('agg-n');
  const alb = new Float32Array(N * N), hgt = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) { const x = i % N, y = (i / N) | 0; alb[i] = 0.2 + 0.1 * pn(x / N, y / N, 128, 128) + 0.06 * hash(x, y); hgt[i] = 0.1 * hash(x + 7, y); }
  for (let k = 0; k < 7000; k++) {
    const cx = R() * N, cy = R() * N, r = 1.2 + Math.pow(R(), 2.2) * 5, t = R();
    const tone = t < 0.08 ? 0.85 + R() * 0.15 : t < 0.2 ? 0.28 + R() * 0.1 : 0.45 + R() * 0.3;
    const sides = 4 + Math.floor(R() * 4), rot = R() * 6.28, sq = 0.6 + R() * 0.5, sh = R() * 0.3;
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const dx = x - cx, dy = (y - cy) / sq, a = Math.atan2(dy, dx) + rot;
      const poly = Math.cos(Math.PI / sides) / Math.cos(((a % (2 * Math.PI / sides)) + 2 * Math.PI / sides) % (2 * Math.PI / sides) - Math.PI / sides);
      const q = Math.hypot(dx, dy) / (r * poly); if (q > 1) continue;
      const j = (((y % N) + N) % N) * N + (((x % N) + N) % N), hv = 0.35 + 0.65 * Math.sqrt(1 - q * q);
      if (hv < hgt[j]) continue;
      hgt[j] = hv; alb[j] = tone * (1 - 0.25 * q) + sh * (dx / r) * 0.15 + 0.04 * hash(x, y + 3);
    }
  }
  const data = new Uint8ClampedArray(N * N * 4);
  for (let i = 0; i < N * N; i++) { data[i * 4] = alb[i] * 255; data[i * 4 + 1] = hgt[i] * 255; data[i * 4 + 2] = 0; data[i * 4 + 3] = 255; }
  return data;
}
function aggregateTexture() { return canvasTex(512, 512, new Uint8ClampedArray(512 * 512 * 4), false); }

/* ---------- asphalt sheet: 1024 px across the carriageway, 30 m along ---------- */
const RL = HW + 0.35;   // road strip half-width (asphalt breaks up over the shoulder)
const REPEAT = 30;      // metres of road per sheet

function asphaltSheet(tier) {
  const W = tier === 'low' ? 512 : 1024, H = W * 2;
  const mx = 2 * RL / W, my = REPEAT / H;               // metres per px
  const pn = makePN('asphalt'), R = makeRng('asphalt-f');
  const N = W * H, Hf = new Float32Array(N), crack = new Float32Array(N), patchM = new Float32Array(N), stain = new Float32Array(N);
  const X = lat => (lat + RL) / mx, Y = s => s / my;
  // stamp a soft disc into a mask, wrapping along the road
  const stamp = (M, cx, cy, r, v, max = true) => {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.max(0, Math.floor(cx - r - 1)); x <= Math.min(W - 1, cx + r + 1); x++) {
      const q = 1 - Math.hypot(x - cx, y - cy) / (r + 0.5); if (q <= 0) continue;
      const j = (((y % H) + H) % H) * W + x, a = Math.min(1, q * 1.6) * v;
      M[j] = max ? Math.max(M[j], a) : M[j] + a;
    }
  };
  const seal = new Float32Array(N), patchT = new Float32Array(N);
  // wandering crack, metres: ragged width that swells and pinches, a faint ravelled
  // shoulder either side, and some sealed with a wide soft band of tar
  const crackLine = (lat, s, dirLat, dirS, len, wpx, sealed = R() < 0.3) => {
    let x = X(lat), y = Y(s), ang = Math.atan2(dirS / my, dirLat / mx), wv = 1;
    const steps = len / Math.min(mx, my);
    for (let t = 0; t < steps; t++) {
      ang += (R() - 0.5) * 0.3;
      wv = Math.max(0.35, Math.min(2.4, wv + (R() - 0.5) * 0.35));
      x += Math.cos(ang); y += Math.sin(ang);
      const w = wpx * wv * (0.7 + 0.5 * R());
      stamp(crack, x, y, w, 1);
      stamp(crack, x, y, w * 3.2 + 1, 0.22);
      if (sealed) stamp(seal, x, y, (0.035 + 0.02 * wv) / mx, 0.85);
      if (R() < 0.006) crackLine((x * mx) - RL, y * my, Math.cos(ang + 1.3), Math.sin(ang + 1.3), len * 0.3 * R(), wpx * 0.7, false);
    }
  };
  // longitudinal cracks: lane joint at the centre and near each edge; transverse ones
  crackLine(0.08, 2, 0, 1, 9, 0.9, true); crackLine(-0.05, 17, 0, 1, 6, 0.8);
  crackLine(-HW + 0.55, 5, 0.05, 1, 12, 1.0); crackLine(HW - 0.6, 20, -0.04, 1, 8, 0.9);
  for (let k = 0; k < 5; k++) crackLine(-HW + 0.3 + R() * 2.4, R() * REPEAT, 1, (R() - 0.5) * 0.2, 1 + R() * 2.5, 0.8);
  // alligator cracking in the left outer wheel path
  for (let k = 0; k < 16; k++) crackLine(-2.6 + R() * 0.7, 24 + R() * 3.5, R() - 0.5, R() - 0.5, 0.3 + R() * 0.6, 0.6, false);
  // patches: irregular blobs of every size, from pothole fills to utility cuts;
  // noisy superellipse outline, soft edge, each its own age (fresh black or grey)
  for (let k = 0; k < 11; k++) {
    const big = R() < 0.35, a = (big ? 0.7 + R() * 1.1 : 0.18 + R() * 0.45), b = a * (0.6 + R() * 1.4) * (big ? 1.4 : 1);
    const cl = -HW + a + R() * (2 * HW - 2 * a), cs = R() * REPEAT, rot = (R() - 0.5) * 0.5, ex = R() < 0.4 ? 4 + R() * 3 : 2;
    const tone = R() < 0.45 ? 1 + R() * 0.3 : 2.2 + R() * 0.8, seed = R() * 50, ca = Math.cos(rot), sa = Math.sin(rot);
    const rx = (a + b) * 1.3 / mx, ry = (a + b) * 1.3 / my;
    for (let y = Math.floor(Y(cs) - ry); y <= Y(cs) + ry; y++) for (let x = Math.max(0, Math.floor(X(cl) - rx)); x <= Math.min(W - 1, X(cl) + rx); x++) {
      const dl = x * mx - RL - cl, ds = y * my - cs, pl = (dl * ca - ds * sa) / a, ps = (dl * sa + ds * ca) / b;
      const th = Math.atan2(ps, pl) / (2 * Math.PI) + 0.5;
      const rad = 1 + 0.18 * (pn(th, seed / 50, 7, 7) - 0.5) * 2 + 0.07 * (pn(th, 0.5 + seed / 100, 29, 29) - 0.5) * 2;
      const q = Math.pow(Math.pow(Math.abs(pl), ex) + Math.pow(Math.abs(ps), ex), 1 / ex) / rad;
      const m = smoothstep(1.0, 0.86, q); if (m <= 0) continue;
      const j = (((y % H) + H) % H) * W + x;
      if (m > patchM[j]) { patchM[j] = m; patchT[j] = tone; }
    }
  }
  // oil stains: in the lane centres; each a different drip cluster
  for (let k = 0; k < 10; k++) {
    const lat = (R() < 0.5 ? -1.8 : 1.8) + (R() - 0.5) * 0.9, s = R() * REPEAT, n = 2 + Math.floor(R() * 9), sp = 0.1 + R() * 0.6, el = 0.3 + R() * 1.6;
    for (let q = 0; q < n; q++) stamp(stain, X(lat + (R() - 0.5) * sp * 0.5), Y(s + (R() - 0.5) * sp * el), (0.04 + Math.pow(R(), 2) * 0.24) / mx, 0.2 + R() * 0.45, false);
  }
  return { W, H, mx, my, pn, Hf, crack, patchM, stain, seal, patchT };
}

/* Pixel pass: albedo (alpha = ragged asphalt edge), height → normal, and
 * roughness (G) + paint-wear mask (R). */
function asphaltPixels(tier) {
  const A = asphaltSheet(tier), { W, H, mx, my, pn, Hf, crack, patchM, stain, seal, patchT } = A;
  const alb = new Uint8ClampedArray(W * H * 4), rgh = new Uint8ClampedArray(W * H * 4);
  const wheel = d => Math.exp(-Math.pow((d - 1.02) / 0.28, 2)) + Math.exp(-Math.pow((d - 2.58) / 0.3, 2));
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const edgeN = [0.25, 0.75].map(u0 => 0.6 * pn(u0, v, 2, 300) + 0.4 * pn(u0 + 0.1, v, 2, 1000)); // ragged edge noise
    for (let x = 0; x < W; x++) {
      const u = x / W, lat = (x + 0.5) * mx - RL, d = Math.abs(lat), j = y * W + x, i = j * 4;
      const mott = 0.6 * pn(u, v, 6, 24) + 0.4 * pn(u, v, 24, 96);
      const g1 = pn(u, v, 512, 1000), g2 = hash(x, y), g3 = pn(u + 0.5, v, 1000, 1000);
      const chip = smoothstep(0.62, 0.8, g1) * (0.5 + 0.5 * hash(x >> 1, y >> 1));   // light quartzite chips
      const pit = smoothstep(0.2, 0.08, g3);                                         // voids in the binder
      const edge = HW + 0.02 + 0.3 * edgeN[lat < 0 ? 0 : 1] - 0.08;
      const crumb = d > edge - 0.18 ? smoothstep(0.55, 0.8, pn(u, v, 400, 800)) : 0;  // crumbling lip
      const wp = wheel(d), dust = smoothstep(HW - 1.1, HW + 0.1, d);
      const oil = Math.exp(-Math.pow((d - 1.8) / 0.32, 2)) * smoothstep(0.35, 0.7, pn(u, v, 8, 80));
      const pm = patchM[j], pt = patchT[j], ck = crack[j], st = Math.min(1, stain[j]), sl = seal[j];
      // albedo (sRGB bytes): aged grey asphalt, a touch warm
      // fine aggregate comes from a world-scale tile in the shader; the sheet carries tone
      let L = 98 + 30 * (mott - 0.5) + 4 * (g2 - 0.5) + 14 * chip * (1 - 0.55 * wp) - 12 * pit;
      L -= 9 * wp + 16 * oil;
      if (pm > 0) { const PL = (pt < 2 ? 52 + 14 * (pt - 1) : 76 + 12 * (pt - 2.2)) + 10 * (mott - 0.5) + 8 * chip; L += (PL - L) * pm; L *= 1 - 0.12 * pm * (1 - pm) * 4; }
      L += (36 + 8 * mott - L) * sl * 0.8;                          // tar-sealed crack band
      L += (40 + 10 * mott - L) * ck * 0.8;                          // crack: dark grey, not black
      L *= 1 - 0.5 * st;
      let r = L + 3, g = L + 2, b = L;
      { const k = dust * 0.55 * (1 - pm); r += (158 - r) * k; g += (142 - g) * k; b += (118 - b) * k; }  // dust at the edge
      alb[i] = r; alb[i + 1] = g; alb[i + 2] = b;
      alb[i + 3] = d < edge && crumb < 0.5 ? 255 : 0;
      // height, metres
      Hf[j] = 0.004 * chip * (1 - 0.6 * wp) - 0.003 * pit + 0.0015 * g2 - 0.004 * ck * (1 - 0.7 * sl) + 0.0012 * sl + 0.0025 * pm
        - 0.01 * smoothstep(edge - 0.25, edge, d);
      // roughness 0..1 in G; paint-wear mask in R
      let ro = 0.9 - 0.28 * wp - 0.2 * oil - 0.25 * st + 0.06 * dust + 0.05 * (g2 - 0.5);
      ro += ((pt < 2 ? 0.7 : 0.86) - ro) * pm; ro += (0.5 - ro) * sl * 0.8;
      rgh[i + 1] = Math.max(0.25, Math.min(1, ro)) * 255;
      const wear = 0.55 + 0.45 * (2 * pn(u, v, 48, 300) - 0.5) - 0.5 * pit - 0.4 * ck;
      rgh[i] = Math.max(0, Math.min(1, wear * (g2 > 0.1 ? 1 : 0.3))) * 255;
      rgh[i + 2] = 0; rgh[i + 3] = 255;
    }
  }
  const nrm = normalFrom(Hf, W, H, mx, my, false);
  return { W, H, alb, nrm, rgh };
}

/* The asphalt sheet is ~2 M pixels of noise: generate it in a worker (same
 * functions, same seeds → identical bytes) while the first leg builds on the
 * main thread. The textures exist at once (right size, so the program is the
 * same); their pixels land before ready (terrain.ready). */
let ROADJOB = null;
function asphaltJob(tier) {
  const noiseURL = new URL('../core/noise.js', import.meta.url).href;
  const src = `import { rng as makeRng, smoothstep } from '${noiseURL}';
const HW = ${HW}, RL = ${RL}, REPEAT = ${REPEAT};
${hash}\n${makePN}\n${normalFrom}\n${asphaltSheet}\n${asphaltPixels}\n${aggregatePixels}\n${detailPixels}
onmessage = e => { const r = asphaltPixels(e.data); r.agg = aggregatePixels(); r.det = detailPixels(); postMessage(r, [r.alb.buffer, r.nrm.buffer, r.rgh.buffer, r.agg.buffer, r.det.buffer]); };`;
  return new Promise((res, rej) => {
    let w;
    try { w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), { type: 'module' }); }
    catch (e) { rej(e); return; }
    w.onmessage = e => { res(e.data); w.terminate(); };
    w.onerror = e => { rej(e); w.terminate(); };
    w.postMessage(tier);
  }).catch(() => Object.assign(asphaltPixels(tier), { agg: aggregatePixels(), det: detailPixels() }));   // no module workers: do it here
}
function asphaltTextures(tier) {
  const W = tier === 'low' ? 512 : 1024, H = W * 2;
  const mk = srgb => { const t = canvasTex(W, H, new Uint8ClampedArray(W * H * 4), srgb); t.wrapS = THREE.ClampToEdgeWrapping; t.anisotropy = 16; return t; };
  const map = mk(true), normalMap = mk(false), roughMap = mk(false);
  ROADJOB = asphaltJob(tier).then(r => {
    AGG = AGG || aggregateTexture(); DETAIL = DETAIL || detailTexture();
    for (const [t, d] of [[map, r.alb], [normalMap, r.nrm], [roughMap, r.rgh], [AGG, r.agg], [DETAIL, r.det]]) { t.image.data.set(new Uint8Array(d.buffer)); t.needsUpdate = true; }
  });
  return { map, normalMap, roughMap };
}

/* ---------- ground: splatted, detail-textured ---------- */
let DETAIL = null;
function groundMaterial() {
  DETAIL = DETAIL || detailTexture();
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, bumpMap: DETAIL, bumpScale: 1.6 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uDetail = { value: DETAIL }; sh.uniforms.uCamPos = world.U.uCamPos;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSplat; attribute float aWet;\nvarying vec3 vGW; varying vec4 vSplat; varying float vWet;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz; vSplat = aSplat; vWet = aWet;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW; varying vec4 vSplat; varying float vWet; uniform sampler2D uDetail; uniform vec3 uCamPos; float gRough;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 p = vGW.xz;
          float dist = distance(vGW, uCamPos);
          vec4 d0 = texture2D(uDetail, p * 0.37);
          vec4 d0b = texture2D(uDetail, mat2(0.8, -0.6, 0.6, 0.8) * p * 0.113 + vec2(0.13, 0.71));
          vec4 d1 = texture2D(uDetail, p * 0.047 + vec2(0.31, 0.17));
          vec4 d2 = texture2D(uDetail, p * 0.0071 + vec2(0.7, 0.2));
          float nearF = 1.0 - smoothstep(25.0, 150.0, dist);
          float micro = mix(d0.r, d0b.r, 0.45);
          float bn = (d1.r - 0.5) * 0.9 + (micro - 0.5) * 0.6 * nearF + (d2.g - 0.5) * 0.5;
          float wSoil = smoothstep(0.3, 0.7, vSplat.x + bn * 0.55);
          float wSand = smoothstep(0.25, 0.75, vSplat.y + bn * 0.35);
          float wRock = smoothstep(0.3, 0.7, vSplat.z + (d1.r - 0.5) * 0.7 + (d0b.a - 0.5) * 0.3);
          float wGrav = smoothstep(0.3, 0.7, vSplat.w + (d0.a - 0.5) * 0.45 * nearF + bn * 0.2);
          vec3 tint = diffuseColor.rgb;
          float strokes = mix(0.55, mix(d0.b, d0b.b, 0.35), nearF);
          vec3 grass = tint * (0.66 + 0.6 * strokes) * (0.8 + 0.4 * d1.g) * mix(vec3(1.06, 1.0, 0.86), vec3(0.92, 1.0, 1.07), d2.g);
          vec3 soil = vec3(0.235, 0.165, 0.098) * (0.72 + 0.56 * micro) * (0.85 + 0.3 * d1.g);
          soil = mix(soil, soil * vec3(1.45, 1.4, 1.3), smoothstep(0.66, 0.82, d0.a) * nearF);
          soil = mix(soil, soil * 0.55, smoothstep(0.36, 0.2, d0.a) * nearF);
          vec3 grav = vec3(0.27, 0.24, 0.2) * (0.78 + 0.44 * micro) * (0.9 + 0.2 * d1.g);
          grav *= mix(1.0, 0.5 + 1.0 * d0.a, nearF * 0.9);
          grav = mix(grav, vec3(0.36, 0.21, 0.13) * (0.75 + 0.5 * micro), smoothstep(0.35, 0.65, d2.g + (d1.r - 0.5) * 0.6) * 0.7);   // red-earth murram in stretches
          vec3 sand = vec3(0.64, 0.52, 0.36) * (0.9 + 0.14 * d1.r + 0.1 * micro);
          sand *= 1.0 - 0.48 * vWet;
          float strata = sin(vGW.y * 2.3 + d1.r * 7.0) * 0.5 + 0.5;
          vec3 rock = vec3(0.22, 0.2, 0.18) * (0.55 + 0.55 * micro + 0.25 * strata) * (0.8 + 0.4 * d1.g);
          vec3 c = grass;
          c = mix(c, soil, wSoil);
          c = mix(c, sand, wSand);
          c = mix(c, grav, wGrav);
          c = mix(c, rock, wRock);
          diffuseColor.rgb = c;
          gRough = mix(mix(0.97, 0.92, wRock), 0.42, vWet * wSand);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;');
  };
  m.customProgramCacheKey = () => 'v2ground2';
  return m;
}

const BUMP_UV = 0.37;   // ground uv = world xz × this (bump map scale matches d0)

let GMAT = null;
function buildGround(ctx, from = 0, to = path.length) {
  const mat = GMAT || (GMAT = groundMaterial());
  const tmp = new THREE.Vector3(), cols = LAT.length, o = { tint: new THREE.Color() };
  const A = new THREE.Vector3(), B = new THREE.Vector3(), Nn = new THREE.Vector3(), along = new THREE.Vector3();
  for (let s0 = from; s0 < Math.min(to, path.length); s0 += CHUNK) {
    const s1 = Math.min(path.length, s0 + CHUNK);
    const rows = Math.ceil((s1 - s0) / DS) + 1;
    const rowS = r => r < 0 ? s0 + r * DS : r >= rows ? s1 + (r - rows + 1) * DS : Math.min(s1, s0 + r * DS);
    // grid with one ghost row either side, so edge normals match the neighbour chunk
    const GR = rows + 2, P = new Float32Array(GR * cols * 3), LS = new Float32Array(GR * cols);
    for (let g = 0; g < GR; g++) {
      const s = rowS(g - 1), k = turn(s);
      for (let c = 0; c < cols; c++) {
        const lat = safeLat(LAT[c], k), i = (g * cols + c) * 3;
        path.toWorld(s, lat, tmp);
        P[i] = tmp.x; P[i + 1] = meshY(s, lat); P[i + 2] = tmp.z; LS[g * cols + c] = lat;
      }
    }
    const n = rows * cols;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), clr = new Float32Array(n * 3),
      spl = new Float32Array(n * 4), wet = new Float32Array(n), uv = new Float32Array(n * 2);
    const at = (g, c, v) => v.set(P[(g * cols + c) * 3], P[(g * cols + c) * 3 + 1], P[(g * cols + c) * 3 + 2]);
    for (let r = 0; r < rows; r++) {
      const g = r + 1, s = rowS(r), w = weightsAt(s);
      for (let c = 0; c < cols; c++) {
        const v = r * cols + c;
        at(g + 1, c, A); at(g - 1, c, B); along.subVectors(A, B);
        at(g, Math.min(cols - 1, c + 1), A); at(g, Math.max(0, c - 1), B); A.sub(B);
        Nn.crossVectors(A, along).normalize(); if (Nn.y < 0) Nn.negate();
        nor[v * 3] = Nn.x; nor[v * 3 + 1] = Nn.y; nor[v * 3 + 2] = Nn.z;
        const gi = (g * cols + c) * 3;
        pos[v * 3] = P[gi]; pos[v * 3 + 1] = P[gi + 1]; pos[v * 3 + 2] = P[gi + 2];
        uv[v * 2] = P[gi] * BUMP_UV; uv[v * 2 + 1] = P[gi + 2] * BUMP_UV;
        const lat = LS[g * cols + c], slope = Math.sqrt(Math.max(0, 1 - Nn.y * Nn.y)) / Math.max(0.05, Nn.y);
        splat(s, lat, P[gi + 1], slope, o, w);
        clr[v * 3] = o.tint.r; clr[v * 3 + 1] = o.tint.g; clr[v * 3 + 2] = o.tint.b;
        spl[v * 4] = o.soil; spl[v * 4 + 1] = o.sand; spl[v * 4 + 2] = o.rock; spl[v * 4 + 3] = o.gravel; wet[v] = o.wet;
      }
    }
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)((rows - 1) * (cols - 1) * 6);
    for (let r = 0, q = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      idx[q++] = a; idx[q++] = b; idx[q++] = d; idx[q++] = b; idx[q++] = e; idx[q++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(clr, 3));
    geo.setAttribute('aSplat', new THREE.BufferAttribute(spl, 4));
    geo.setAttribute('aWet', new THREE.BufferAttribute(wet, 1));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.name = 'ground';
    ctx.scene.add(m);
    ground.push(m);
  }
}

/* ---------- road ---------- */
function roadMaterial(tier) {
  const { map, normalMap, roughMap } = asphaltTextures(tier);
  const m = new THREE.MeshStandardMaterial({
    map, normalMap, roughnessMap: roughMap, normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 1, metalness: 0, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4
  });
  AGG = AGG || aggregateTexture();
  const RLs = RL.toFixed(3);
  // each 30 m block of road picks its own mirror and phase, so the sheet never visibly repeats
  const G = (chunk, re, fn) => { const c = THREE.ShaderChunk[chunk]; if (!re.test(c)) console.warn('road chunk', chunk); return c.replace(re, fn); };
  const mapF = G('map_fragment', /texture2D\(\s*map\s*,\s*vMapUv\s*\)/, () => 'textureGrad(map, gUv, dFdx(vMapUv), dFdy(vMapUv))');
  const rghF = G('roughnessmap_fragment', /texture2D\(\s*roughnessMap\s*,\s*vRoughnessMapUv\s*\)/, () => 'textureGrad(roughnessMap, gUv, dFdx(vMapUv), dFdy(vMapUv))');
  const nrmF = G('normal_fragment_maps', /texture2D\(\s*normalMap\s*,\s*vNormalMapUv\s*\)\.xyz\s*\*\s*2\.0\s*-\s*1\.0\s*;/,
    () => 'textureGrad(normalMap, gUv, dFdx(vMapUv), dFdy(vMapUv)).xyz * 2.0 - 1.0; mapN.x *= gFlip;');
  m.onBeforeCompile = sh => {
    sh.uniforms.uDetail = { value: DETAIL }; sh.uniforms.uAgg = { value: AGG };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRoad; varying vec2 vRoad;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vRoad; uniform sampler2D uDetail; uniform sampler2D uAgg; float gPaint, gFlip, gAggH, gNear, gJoint; vec2 gUv;
        float rh(float n) { return fract(sin(n * 91.713) * 43758.545); }
        float band(float x, float c, float hw, float fw) { return clamp((hw - abs(x - c)) / fw + 0.5, 0.0, 1.0); }`)
      .replace('#include <map_fragment>', `{
          float blk = floor(vRoad.y / ${REPEAT}.0), h = rh(blk);
          gFlip = h < 0.5 ? -1.0 : 1.0;
          gUv = vec2((gFlip * vRoad.x + ${RLs}) / ${(2 * RL).toFixed(3)}, vRoad.y / ${REPEAT}.0 + floor(rh(blk + 17.0) * 8.0) / 8.0);
          // a transverse joint crack where blocks meet, ragged across the road
          float jn = texture2D(uDetail, vec2(vRoad.x * 0.21, blk * 0.37)).r;
          float jd = abs(vRoad.y - blk * ${REPEAT}.0 - 0.03 * (jn - 0.5) * 6.0);
          jd = min(jd, abs(vRoad.y - (blk + 1.0) * ${REPEAT}.0));
          gJoint = (1.0 - smoothstep(0.004, 0.004 + 0.012 * jn + max(fwidth(vRoad.y), 1e-4), jd)) * step(0.3, texture2D(uDetail, vec2(vRoad.x * 0.09, blk * 0.11)).g);
        }
        ${mapF}
        {
          float lat = vRoad.x, s = vRoad.y;
          // macro variation along the road so the 30 m sheet never reads as a repeat
          vec4 mac = texture2D(uDetail, vec2(s * 0.0047, lat * 0.011 + 0.37));
          vec4 mac2 = texture2D(uDetail, vec2(s * 0.021 + 0.5, lat * 0.05));
          diffuseColor.rgb *= (0.88 + 0.24 * mac.g) * (0.93 + 0.14 * mac2.g);
          // world-scale aggregate: chips resolve up close, average out with distance
          vec4 ag = texture2D(uAgg, vRoad / 1.1), ag2 = texture2D(uAgg, mat2(0.8, -0.6, 0.6, 0.8) * vRoad / 0.73 + 0.31);
          gNear = 1.0 - smoothstep(0.004, 0.03, max(fwidth(vRoad.y), fwidth(vRoad.x)));
          float aL = mix(ag.r, ag2.r, 0.3);
          diffuseColor.rgb *= mix(1.0, 0.35 + 1.45 * aL, 0.8);
          gAggH = mix(ag.g, ag2.g, 0.3);
          diffuseColor.rgb *= 1.0 - 0.45 * gJoint;
          float fw = max(fwidth(lat), 1e-4), fs = max(fwidth(s), 1e-4);
          float edgeL = ${(HW - 0.25).toFixed(3)};
          float lines = max(band(lat, -edgeL, 0.075, fw), band(lat, edgeL, 0.075, fw));
          float ph = mod(s + 1.2, 7.5);
          float dash = clamp(ph / fs + 0.5, 0.0, 1.0) * clamp((3.0 - ph) / fs + 0.5, 0.0, 1.0);
          lines = max(lines, band(lat, 0.0, 0.075, fw) * dash);
          float wear = textureGrad(roughnessMap, gUv, dFdx(vMapUv), dFdy(vMapUv)).r;
          float far = smoothstep(0.02, 0.3, fs);                       // far away the speckle averages out
          gPaint = lines * mix(smoothstep(0.18, 0.5, wear * (0.75 + 0.5 * mac2.r)), 0.85, far);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.78, 0.72), gPaint);
        }`)
      .replace('#include <roughnessmap_fragment>', rghF + '\nroughnessFactor = mix(roughnessFactor, 0.62, gPaint); roughnessFactor = mix(roughnessFactor, 0.97, gAggH * 0.3);')
      .replace('#include <normal_fragment_maps>', nrmF + `
        {  // aggregate bump from screen-space derivatives of the chip height
          vec2 dH = vec2(dFdx(gAggH), dFdy(gAggH)) * 0.004 * gNear * (1.0 - gPaint);
          vec3 sX = dFdx(-vViewPosition), sY = dFdy(-vViewPosition), R1 = cross(sY, normal), R2 = cross(normal, sX);
          float det = dot(sX, R1) * faceDirection;
          normal = normalize(abs(det) * normal - sign(det) * (dH.x * R1 + dH.y * R2));
        }`);
  };
  m.customProgramCacheKey = () => 'v2road3';
  return m;
}

function buildRoad(ctx) {
  const rmat = roadMaterial(ctx.quality.tier);
  const tmp = new THREE.Vector3();
  const cols = [[-RL, 0.0], [-HW, 0.02], [-1.8, 0.02], [0, 0.02], [1.8, 0.02], [HW, 0.02], [RL, 0.0]];
  const nc = cols.length;
  for (let s0 = 0; s0 < path.length; s0 += CHUNK) {
    const s1 = Math.min(path.length, s0 + CHUNK);
    const rows = Math.ceil((s1 - s0) / 2) + 1;
    const pos = [], uv = [], ar = [], nor = [], idx = [];
    for (let r = 0; r < rows; r++) {
      const s = Math.min(s1, s0 + r * 2);
      for (const [lat, dy] of cols) {
        path.toWorld(s, lat, tmp);
        pos.push(tmp.x, tmp.y + dy, tmp.z);
        uv.push((lat + RL) / (2 * RL), s / REPEAT);
        ar.push(lat, s);
        nor.push(0, 1, 0);
      }
      if (r) {
        const a = (r - 1) * nc;
        for (let c = 0; c < nc - 1; c++) idx.push(a + c, a + c + 1, a + c + nc, a + c + 1, a + c + nc + 1, a + c + nc);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aRoad', new THREE.Float32BufferAttribute(ar, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, rmat);
    m.receiveShadow = true;
    m.name = 'road';
    ctx.scene.add(m);
    road.push(m);
  }
}

/* ---------- grass: tufts of fine blades in a band that recycles around the car ---------- */
const G = { mesh: null, n: 0, B: 80, back: 14, near: 26, far: 46 };

/* One tuft: NB thin tapered blades, curved, 0.25–0.6 m, root-dark → tip-light. */
function tuftGeometry(NB) {
  const R = makeRng('tuft'), pos = [], nor = [], col = [], hh = [], idx = [];
  const T = [0, 0.38, 0.72, 1];
  for (let b = 0; b < NB; b++) {
    const rr = 0.13 * Math.sqrt(R()), ra = R() * Math.PI * 2;
    const ox = Math.cos(ra) * rr, oz = Math.sin(ra) * rr;
    const h = 0.25 + 0.35 * Math.pow(R(), 0.8), w0 = 0.011 + 0.01 * R();
    const face = R() * Math.PI * 2, fx = Math.cos(face), fz = Math.sin(face);   // blade width direction
    const la = ra + (R() - 0.5) * 1.2, lean = (0.12 + 0.4 * R()) * h;           // lean outward, curving
    const lx = Math.cos(la), lz = Math.sin(la);
    const dead = R() < 0.12, br = 0.8 + 0.35 * R();
    const base = pos.length / 3;
    for (const t of T) {
      const bend = lean * t * t, y = h * (t - 0.18 * t * t * lean / h);
      const cx = ox + lx * bend, cz = oz + lz * bend, w = t < 1 ? w0 * (1 - t * 0.75) : 0;
      // normal: blade face normal, bent strongly toward up so lighting stays soft
      const nx = -fz * 0.35 + lx * 0.2, nz = fx * 0.35 + lz * 0.2, ny = 0.9, nl = Math.hypot(nx, ny, nz);
      const k = Math.pow(t, 0.7), dk = dead ? 1 : 0;
      const cr = (0.3 + 0.95 * k + dk * 0.35 * k) * br, cg = (0.3 + 0.9 * k + dk * 0.15 * k) * br, cb = (0.24 + 0.72 * k - dk * 0.2 * k) * br;
      for (const sgn of t < 1 ? [-1, 1] : [0]) {
        pos.push(cx + fx * w * sgn, y, cz + fz * w * sgn);
        nor.push(nx / nl, ny / nl, nz / nl); col.push(cr, cg, cb); hh.push(t);
      }
    }
    // rows: 0-1, 2-3, 4-5, tip 6
    for (let q = 0; q < 2; q++) { const a = base + q * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    idx.push(base + 4, base + 5, base + 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(hh, 1));
  g.setIndex(idx);
  return g;
}

function grassMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.82, metalness: 0 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uTime: world.U.uTime, uWind: world.U.uWind, uCamPos: world.U.uCamPos, uSunCol: world.U.uSunCol,
      uFade: { value: new THREE.Vector2(G.near, G.far) } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aH; varying float vH; uniform float uTime; uniform vec2 uWind; uniform vec3 uCamPos; uniform vec2 uFade;')
      .replace('#include <project_vertex>', `
        vH = aH;
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          vec3 root = instanceMatrix[3].xyz;
        #else
          vec3 root = vec3(0.0);
        #endif
        float fade = 1.0 - smoothstep(uFade.x, uFade.y, distance(root, uCamPos));
        float hgt = (mvPosition.y - root.y) * fade;
        float ph = dot(root.xz, vec2(0.13, 0.17));
        float gust = 0.55 + 0.45 * sin(uTime * 1.3 + ph) + 0.2 * sin(uTime * 3.1 + ph * 2.3 + aH);
        mvPosition.xz += uWind * gust * 0.5 * hgt * aH;
        mvPosition.y = root.y - 0.02 + hgt * (1.0 - 0.12 * aH * gust * length(uWind));
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH; uniform vec3 uSunCol;')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uSunCol * 0.06 * vH;');
  };
  m.customProgramCacheKey = () => 'v2grass2';
  return m;
}

function buildGrass(ctx) {
  const tier = ctx.quality.tier;
  const n = { low: 900, med: 2000, high: 3200 }[tier] ?? 2000;   // high capped for frame time
  const mesh = new THREE.InstancedMesh(tuftGeometry(tier === 'low' ? 7 : 10), grassMaterial(), n);
  mesh.frustumCulled = false;
  mesh.name = 'grass';
  mesh.receiveShadow = true;
  const R = makeRng('grass');
  G.u = new Float32Array(n); G.lat = new Float32Array(n); G.k = new Int32Array(n).fill(-1e6);
  G.yaw = new Float32Array(n); G.sc = new Float32Array(n); G.rnd = new Float32Array(n);
  const minD = HW + SHOULDER - 0.3;
  // clumped: clusters of 2–9 tufts, denser near the road
  for (let i = 0; i < n;) {
    const side = R() < 0.5 ? -1 : 1, cu = R(), cl = minD + Math.pow(R(), 1.6) * 22, m = 2 + Math.floor(R() * 8), rad = 0.35 + R() * 0.9;
    for (let q = 0; q < m && i < n; q++, i++) {
      const a = R() * Math.PI * 2, r = rad * Math.sqrt(R());
      G.u[i] = (cu + Math.cos(a) * r / G.B + 1) % 1;
      G.lat[i] = side * Math.max(minD - 0.3, cl + Math.sin(a) * r);
      G.yaw[i] = R() * Math.PI * 2; G.sc[i] = 0.8 + 0.5 * R(); G.rnd[i] = R();
    }
  }
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < n; i++) { mesh.setColorAt(i, _a.setRGB(1, 1, 1)); mesh.setMatrixAt(i, _m4.makeScale(0, 0, 0)); }
  G.mesh = mesh; G.n = n;
  ctx.scene.add(mesh);
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _sv = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
const _gs = { tint: new THREE.Color() };

function respawn(i, s) {
  const lat = G.lat[i], rnd = G.rnd[i];
  let show = s >= 0 && s <= path.length;
  let hs = 1;
  if (show) {
    const y = world.heightSL(s, lat);
    const w = world.waterAt(s);
    const slope = Math.abs(world.heightSL(s, lat + 1.5) - world.heightSL(s, lat - 1.5)) / 3;
    const o = splat(s, lat, y, slope, _gs);
    const bare = Math.max(o.gravel * 1.4, o.soil * 0.9, o.sand * 1.6, o.rock * 1.2, (w !== null && y < w + 0.6) ? 1 : 0);
    const patch = fbm(s * 0.05 + 3, lat * 0.06, 2);
    show = rnd > bare + 0.15 * smoothstep(0.1, -0.5, patch) - 0.05 && patch > -0.55;
    hs = (0.75 + 0.35 * o.lush) * (1 - 0.35 * Math.max(o.soil, o.sand, o.gravel)) * (0.85 + 0.3 * smoothstep(-0.3, 0.5, patch));
    path.toWorld(s, lat, _v); _v.y = y;
    _a.copy(o.tint).multiplyScalar(0.95 + 0.2 * rnd);
    if (o.lush < 0.5) _a.lerp(DRY, 0.25 * rnd);             // golden, straw-tipped hills
    _a.lerp(DIRT, 0.25 * o.soil);
    G.mesh.setColorAt(i, _a);
  }
  const sc = show ? G.sc[i] : 0;
  _q.setFromAxisAngle(_Y, G.yaw[i]);
  _sv.set(sc, sc * hs * (0.85 + 0.3 * Math.abs(Math.sin(i * 12.9898))), sc);
  G.mesh.setMatrixAt(i, _m4.compose(_v, _q, _sv));
}

function updateGrass(s) {
  if (!G.mesh) return;
  const B = G.B, start = s - G.back;
  let any = false;
  for (let i = 0; i < G.n; i++) {
    const k = Math.ceil((start - G.u[i] * B) / B);
    if (k !== G.k[i]) { G.k[i] = k; respawn(i, G.u[i] * B + k * B); any = true; }
  }
  if (any) { G.mesh.instanceMatrix.needsUpdate = true; G.mesh.instanceColor.needsUpdate = true; }
}

/* ---------- aprons: ground past each end of the road, same shader ---------- */
function buildAprons(ctx) {
  const mat = ground[0].material;
  const S = path.sample(0), o = { tint: new THREE.Color() };
  for (const [s, dir] of [[0, 1], [path.length, -1]]) {
    path.sample(s, S);
    const c = S.pos.clone().addScaledVector(S.fwd, -dir * 472);
    const geo = new THREE.CircleGeometry(460, 64, 0, Math.PI * 2).rotateX(-Math.PI / 2);
    geo.translate(c.x, path.roadY(s) - 0.9, c.z);
    const p = geo.attributes.position, n = p.count;
    const clr = new Float32Array(n * 3), spl = new Float32Array(n * 4), uv = new Float32Array(n * 2);
    splat(s, 60, path.roadY(s), 0, o);
    for (let v = 0; v < n; v++) {
      const x = p.getX(v), z = p.getZ(v), f = 0.9 + 0.2 * noise2(x * 0.02, z * 0.02);
      clr.set([o.tint.r * f, o.tint.g * f, o.tint.b * f], v * 3);
      spl[v * 4] = 0.25 * noise2(x * 0.03 + 9, z * 0.03);
      uv[v * 2] = x * BUMP_UV; uv[v * 2 + 1] = z * BUMP_UV;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(clr, 3));
    geo.setAttribute('aSplat', new THREE.BufferAttribute(spl, 4));
    geo.setAttribute('aWet', new THREE.BufferAttribute(new Float32Array(n), 1));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const disc = new THREE.Mesh(geo, mat);
    disc.receiveShadow = true; disc.name = 'apron';
    ctx.scene.add(disc);
    ground.push(disc);
  }
}

/* ---------- lifecycle ---------- */
function init(ctx) {
  const T = ctx.buildTimes || {}, t = f => { const t0 = performance.now(); f(ctx); T['t:' + f.name] = Math.round(performance.now() - t0); };
  t(function buildGroundNear(c) { buildGround(c, 0, NEAR); }); t(buildRoad); t(buildGrass); t(buildAprons);
}

/* Ground chunks past the first NEAR metres: built after ready, one chunk per
 * task so the title keeps animating. Called by main before the other legs. */
const NEAR = CHUNK * 5;
async function initRest(ctx) {
  for (let s0 = NEAR; s0 < path.length; s0 += CHUNK) {
    buildGround(ctx, s0, s0 + CHUNK);
    await new Promise(r => setTimeout(r));
  }
}

function update(dt, s) { updateGrass(s); }

/** Resolves once the worker-made road textures are filled in. */
const ready = () => ROADJOB || Promise.resolve();

export const terrain = { init, initRest, update, ready, ground, road, LAT, groundColor };
