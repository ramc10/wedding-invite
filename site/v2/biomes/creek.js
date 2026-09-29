/* Zone 'creek' (s 2172–2540): the dusk "The Beginning" ending. A country road at
 * dusk with a stream winding through the meadow on the right, forest on the left.
 *
 * Objects (draw calls in brackets):
 *   Flora (flora.js plant(), instanced):
 *     [1] broadleaf forest, left, clustered on a noise field, climbing the slope
 *     [1] pines mixed into the back of the left forest, in small stands
 *     [1] blossom trees, a few at the forest edge (not a pink wall)
 *     [1] broadleaf on the right: mango-grove clusters + lone trees beyond the stream
 *     [1] finale trees ringing the road's end, clear of the crane camera
 *     [1] trees lining the road's continuation past the end (see Extension)
 *     [1] ferns (left understorey)   [1] bushes (both sides)   [1] wild flowers (right)
 *     [1] crop field: rows of tall grass clumps in an open field right of the stream
 *   Stream:
 *     [1] water ribbon (water.js makeWater 'creek'), bent to creekLat(s), darker body, low foam
 *     [1] bank rocks (boulders) lining both banks, bedded into the ground
 *     [1] pebbles: small flattened stones on the bank edges and shallows
 *     [1] reeds: tall dark grass clumps in clumps along the banks
 *   Built:
 *     [1] wood/stone/iron/clay mesh (one textured MeshStandardMaterial, vertex tinted):
 *         lamp posts (stone footing, square post, arm, brace, hook, iron lantern frame + cap),
 *         clay diyas on small stone plinths at the post feet, the wooden footbridge
 *         (log stringers, plank deck, posts, handrails) with stone abutments
 *     [1] warm glow mesh (unlit): lantern glass and diya flames
 *     [1] light pools: additive warm discs on the ground/road under each lantern and diya
 *     [1] fireflies + lantern halos (one additive Points draw), few and small
 *   Extension (past the last metre, for the final crane shot):
 *     [1] the road carried on 700 m with the same asphalt material, bending gently away
 *     [1] ground under/around it (same ground material/colouring as terrain.js), seamless at s=L
 *
 * AMR Unnati (built by dam.js) stands on the right at the start of this zone: its lot is
 * kept clear (inVenue) and the stream starts after it (CREEK_S0).
 */
import * as THREE from 'three';
import { plant, band } from './flora.js';
import { makeWater } from './water.js';
import { terrain } from './terrain.js';
import { fbm, rng as makeRng } from '../core/noise.js';
import { STOP } from '../core/timeline.js';

const VEN = STOP.karimnagar.venue;
const inVenue = (s, lat) => lat > 0 && Math.abs(s - VEN.s) < 55 && lat < VEN.lateral + 30;
const CREEK_S0 = VEN.s + 60;

const TIER = { low: 0.45, med: 0.7, high: 1 };

// clustered scatter against a noise field
function clustered(s0, s1, near, far, { freq = 0.02, thresh = 0.0, bias = 1.2, side = 'both', seed = 5 } = {}) {
  return R => {
    for (let t = 0; t < 8; t++) {
      const s = s0 + R() * (s1 - s0);
      const sg = side === 'left' ? -1 : side === 'right' ? 1 : (R() < 0.5 ? -1 : 1);
      const lat = sg * (near + Math.pow(R(), bias) * (far - near));
      if (inVenue(s, lat)) continue;
      if (fbm(s * freq + seed, lat * freq * 1.3, 3) > thresh) return { s, lateral: lat };
    }
    return null;
  };
}

// the stream's centre line: winds between lateral 12 and 20
const creekLat = s => 16 + 3.2 * Math.sin(s * 0.021) + 1.2 * Math.sin(s * 0.057 + 1.3);
const HW = 2.2; // stream half width (nominal)
// the real half width breathes: pools and narrows, so the banks don't run ruler-straight
const hwAt = s => HW + 0.55 * Math.sin(s * 0.043 + 0.7) + 0.3 * Math.sin(s * 0.117 + 2.1);
// the open crop field right of the stream
const FIELD = { s0: 2345, s1: 2470, near: 6, far: 62 };
const inField = (s, lat) => s > FIELD.s0 - 4 && s < FIELD.s1 + 4 && lat > creekLat(s) + FIELD.near - 2 && lat < creekLat(s) + FIELD.far + 4;
// the footbridge
const BRIDGE_S = 2322;

// keep trees off the stream band, the field and the venue lot
const offCreek = place => (R, i) => {
  const p = place(R, i);
  if (!p) return null;
  if (p.lateral > 0 && p.s > CREEK_S0 - 10 && Math.abs(p.lateral - creekLat(p.s)) < HW + 2.8) return null;
  if (p.lateral > 0 && inField(p.s, p.lateral)) return null;
  if (Math.abs(p.s - BRIDGE_S) < 5 && p.lateral > 4 && p.lateral < creekLat(BRIDGE_S) + 8) return null;
  if (inVenue(p.s, p.lateral)) return null;
  return p;
};

/* The ending crane (car/camera.js END rig): the car parks at END_S = L-8 in the left lane
 * (lateral -1.8); the camera rises to 15 m back-left (yaw 0.55) and 13 m up, aiming 60 m
 * ahead and 26 m up. finaleCam(ctx) → clear(x, z, H, r): false when a tree of height H and
 * crown radius r would block that shot (or sit in the crane's path up to it). The frame
 * keeps a central wedge open (road + dusk sky) and lets trees frame it from the sides. */
function finaleCam(ctx) {
  const { path } = ctx, L = path.length, sE = L - 8, LANE = -1.8;
  const smp = path.sample(sE), car = path.toWorld(sE, LANE, new THREE.Vector3());
  const y0 = path.roadY(sE);
  const fx = smp.fwd.x, fz = smp.fwd.z, fl = Math.hypot(fx, fz);
  const F = [fx / fl, fz / fl], Lf = [F[1], -F[0]];                    // forward, left (x, z)
  const DEG = Math.PI / 180, cy = y0 + 13;
  // the rest pose (yaw 0.55) and the still-settling pose seen a few metres earlier (≈ yaw 0.3)
  const views = [[0.55, 15], [0.28, 13.5]].map(([yaw, dist]) => {
    const cx = car.x - F[0] * Math.cos(yaw) * dist + Lf[0] * Math.sin(yaw) * dist;
    const cz = car.z - F[1] * Math.cos(yaw) * dist + Lf[1] * Math.sin(yaw) * dist;
    const lx = car.x + F[0] * 60 - cx, lz = car.z + F[1] * 60 - cz, ll = Math.hypot(lx, lz);
    return { cx, cz, D: [lx / ll, lz / ll], Rt: [-lz / ll, lx / ll] };
  });
  const inView = (x, z, H, r, { cx, cz, D, Rt }) => {
    const dx = x - cx, dz = z - cz;
    const fwd = dx * D[0] + dz * D[1], side = dx * Rt[0] + dz * Rt[1];
    const dist = Math.hypot(dx, dz);
    r *= 1.3;                                                         // spreading limbs reach past the nominal crown
    if (dist < r + 7) return true;                                    // the camera's own bubble
    if (fwd <= 0) return false;                                       // behind the camera
    const ax = Math.abs(Math.atan2(side, fwd)) - Math.atan2(r, dist); // nearest crown edge, off-axis
    const top = Math.atan2(H - (cy - y0) + 1, dist);                  // tree top above the horizon
    if (ax < 15 * DEG && top > 1.5 * DEG) return true;                // the open centre: road + sky
    if (ax < 30 * DEG && dist < 45 && top > -4 * DEG) return true;    // no big near canopy mid-frame
    if (ax < 45 * DEG && dist < 26) return true;                      // nothing looming at the edges
    return false;
  };
  return (x, z, H, r, s = null, lat = null) => {
    // the crane path: the camera slides from the chase spot out to the left as it climbs
    if (s != null && s > L - 115 && s < L - 4 && lat < 0) {
      const w = THREE.MathUtils.smoothstep(s, L - 110, L - 21);
      const camLat = LANE - 1.5 - 6.3 * w;
      if (lat > camLat - r - 3) return false;
    }
    return !views.some(v => inView(x, z, H, r, v));
  };
}
// wrap a road-frame placer with the finale test (tree size at the plant's max scale)
const noCam = (ctx, clear, H, r, place) => {
  const v = new THREE.Vector3();
  return (R, i) => {
    const p = place(R, i);
    if (!p) return null;
    ctx.path.toWorld(p.s, p.lateral, v);
    return clear(v.x, v.z, H, r, p.s, p.lateral) ? p : null;
  };
};

export default {
  id: 'creek',
  build(ctx) {
    const { zones, quality, path } = ctx;
    const z = zones.byId.creek;
    const group = new THREE.Group();
    group.name = 'creek';
    const k = TIER[quality.tier] ?? 1;
    const n = v => Math.max(1, Math.round(v * k));
    const s0 = z.s0 - z.blend / 2, s1 = Math.min(path.length ?? z.s1, z.s1) + z.blend / 2;
    // sub-step times (ms) into ctx.buildTimes as 'cr:<step>', like terrain.js's 't:' keys
    let tb = performance.now();
    const T = (k, v) => { if (ctx.buildTimes) ctx.buildTimes['cr:' + k] = Math.round(performance.now() - tb); tb = performance.now(); return v; };
    const ext = extFrame(ctx);

    T('ext', 0);
    buildFlora(ctx, group, s0, s1, n, ext, T);
    const segs = T('creek', buildCreek(ctx, group, Math.max(z.s0 - 20, CREEK_S0), s1));
    T('channel', buildChannel(ctx, group, segs, Math.max(z.s0 - 20, CREEK_S0), s1));
    T('banks', buildBanks(ctx, group, Math.max(z.s0 - 20, CREEK_S0), Math.min(s1, path.length), n));
    const lamps = T('lamps', buildLamps(ctx, group, z.s0 + 10, z.s1 - 4));
    const flies = T('flies', buildFireflies(ctx, group, z.s0, z.s1, lamps.spots));
    T('extension', buildExtension(ctx, group, ext));

    return {
      group,
      update(dt, s) { flies.update(s); lamps.update(); },
      dispose() {
        // flora meshes share cached geometry/material; terrain materials are borrowed
        group.traverse(o => {
          if (o.name.startsWith('flora:') || o.userData.borrowed) return;
          o.geometry?.dispose?.(); o.material?.dispose?.();
        });
      }
    };
  }
};

/* ---------- the road's continuation past s = L: a frame (d metres past the end, lateral) ---------- */
function extFrame(ctx) {
  const { path, world } = ctx;
  const L = path.length, end = path.sample(L);
  const D = 700, STEP = 2, N = D / STEP + 1;
  const P = new Float32Array(N * 2), FR = new Float32Array(N * 4);
  const bend = d => 0.22 * THREE.MathUtils.smoothstep(d, 110, 420) - 0.08 * THREE.MathUtils.smoothstep(d, 380, 650);
  let x = end.pos.x, z = end.pos.z;
  for (let i = 0; i < N; i++) {
    const a = bend(i * STEP), c = Math.cos(a), s = Math.sin(a);
    const fx = end.fwd.x * c + end.fwd.z * s, fz = -end.fwd.x * s + end.fwd.z * c;
    const rx = end.right.x * c + end.right.z * s, rz = -end.right.x * s + end.right.z * c;
    P[i * 2] = x; P[i * 2 + 1] = z;
    FR[i * 4] = fx; FR[i * 4 + 1] = fz; FR[i * 4 + 2] = rx; FR[i * 4 + 3] = rz;
    x += fx * STEP; z += fz * STEP;
  }
  const y0 = path.roadY(L);
  return {
    L, D, y0,
    toWorld(d, lat, out = new THREE.Vector3()) {
      const f = Math.min(N - 1.001, Math.max(0, d / STEP)), i = Math.floor(f), t = f - i;
      const lerp = (A, k, w) => A[i * w + k] * (1 - t) + A[(i + 1) * w + k] * t;
      return out.set(lerp(P, 0, 2) + lerp(FR, 2, 4) * lat, y0, lerp(P, 1, 2) + lerp(FR, 3, 4) * lat);
    },
    // ground height past the end: the zone's own side profiles, with s running on past L
    height(d, lat) { return world.heightSL(L + Math.max(0, d), lat); }
  };
}

// re-seat the instances of a plant() mesh (all planted at s ≈ L) onto the extension frame
function seatOnExt(mesh, ext, spots, sink) {
  // only the translation moves: write it straight into the instance matrices
  const a = mesh.instanceMatrix.array, p = new THREE.Vector3();
  for (let i = 0; i < mesh.count; i++) {
    const { d, lat } = spots[i], o = i * 16;
    ext.toWorld(d, lat, p);
    const sy = Math.hypot(a[o + 4], a[o + 5], a[o + 6]);         // the instance's y scale
    a[o + 12] = p.x; a[o + 13] = ext.height(d, lat) - sink * sy; a[o + 14] = p.z;
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

/* ---------- trees, grove, field, understorey ---------- */
function buildFlora(ctx, group, s0, s1, n, ext, T = () => {}) {
  const L = ctx.path.length;
  s1 = Math.min(s1, L);
  const add = o => group.add(o);
  const clear = finaleCam(ctx);
  // finale test at each plant's tallest (broadleaf H 8.5 / crown 3.5, pine H 11 / crown 2.6 at scale 1)
  const BL = (sMax, place) => noCam(ctx, clear, 8.5 * sMax, 3.5 * sMax, place);
  const GREENS = [0x3f5c3a, 0x4a6440, 0x355238, 0x566a3c, 0x5e6a38, 0x44603e];
  // left: the forest — broadleaf canopy climbing the slope, stands of pine further back
  add(plant(ctx, { kind: 'broadleaf', count: n(230), seed: 'cr-bl-l',
    place: BL(2.0, clustered(s0, s1, 8, 120, { side: 'left', freq: 0.018, thresh: -0.15, bias: 1.1 })),
    scale: [1.0, 2.0], colors: GREENS }));
  add(plant(ctx, { kind: 'pine', count: n(90), seed: 'cr-pine',
    place: noCam(ctx, clear, 11 * 2.2, 2.6 * 2.2, clustered(s0, s1, 22, 140, { side: 'left', freq: 0.035, thresh: 0.12, bias: 0.9, seed: 21 })),
    scale: [1.3, 2.2], colors: [0x2c4630, 0x34503a, 0x2a3f2e] }));
  // right: lone trees in the meadow, mango-grove clumps beyond the field
  add(plant(ctx, { kind: 'broadleaf', count: n(90), seed: 'cr-bl-r',
    place: BL(2.1, offCreek(clustered(s0, s1, 9, 150, { side: 'right', freq: 0.03, thresh: 0.12, bias: 1.1, seed: 13 }))),
    scale: [1.2, 2.1], colors: [0x3e5a38, 0x4a6440, 0x36503a, 0x55683c] }));
  // the finale: tall trees ringing the road's end, clear of the ending crane camera
  add(plant(ctx, { kind: 'broadleaf', count: n(90), seed: 'cr-finale',
    place: BL(2.7, R => {
      const s = L - 70 + R() * 70;
      const sg = R() < 0.55 ? -1 : 1;
      const lat = sg * (9 + Math.pow(R(), 0.8) * 34);
      if (sg > 0 && Math.abs(lat - creekLat(s)) < HW + 2.5) return null;
      return { s, lateral: lat };
    }),
    scale: [1.8, 2.7], colors: [0x3a5636, 0x46603c, 0x2f4a32] }));
  T('trees');
  // past the end: trees lining the road on as it bends away, clumped, with gaps (fields)
  const spots = [];
  const Rx = makeRng('cr-ext');
  const EXT_N = n(150), V = new THREE.Vector3();
  let miss = 0;
  while (spots.length < EXT_N) {
    const d = 6 + Math.pow(Rx(), 0.9) * 420;
    const sg = Rx() < 0.5 ? -1 : 1;
    const lat = sg * (8 + Math.pow(Rx(), 1.3) * (d < 60 ? 40 : 110));
    if (fbm(d * 0.025 + (sg > 0 ? 40 : 0), lat * 0.03, 3) < -0.05) continue;
    ext.toWorld(d, lat, V);
    if (!clear(V.x, V.z, 8.5 * 2.6, 3.5 * 2.6)) { if (++miss > 4000) break; continue; }
    spots.push({ d, lat });
  }
  // two tree populations (big canopy trees, smaller scrub trees) so the horizon isn't one clone
  const big = spots.filter((_, i) => i % 3 !== 2), small = spots.filter((_, i) => i % 3 === 2);
  const extTrees = plant(ctx, { kind: 'broadleaf', count: big.length, seed: 'cr-ext-t',
    place: (R, i) => ({ s: L - 0.5, lateral: big[i].lat < 0 ? -20 : 20 }),
    scale: [1.3, 3.0], colors: [0x2f4a32, 0x3a5636, 0x46603c, 0x283f2c, 0x4a5a34], allowRoad: true });
  seatOnExt(extTrees, ext, big, 0.2);
  add(extTrees);
  const extScrub = plant(ctx, { kind: 'bush', count: small.length, seed: 'cr-ext-s',
    place: (R, i) => ({ s: L - 0.5, lateral: small[i].lat < 0 ? -20 : 20 }),
    scale: [1.8, 3.4], colors: [0x3c5234, 0x4c5a36, 0x34482e, 0x505a34], allowRoad: true });
  seatOnExt(extScrub, ext, small, 0.2);
  add(extScrub);
  // lone palmyra palms standing out of the fields: the Telangana skyline
  const palms = [];
  const Rp = makeRng('cr-palmyra');
  while (palms.length < n(26)) {
    const d = 25 + Rp() * 380, sg = Rp() < 0.6 ? 1 : -1, lat = sg * (14 + Rp() * 130);
    ext.toWorld(d, lat, V);
    if (!clear(V.x, V.z, 14, 2.5)) { if (++miss > 8000) break; continue; }
    palms.push({ d, lat });
    if (Rp() < 0.35) palms.push({ d: d + 3 + Rp() * 5, lat: lat + (Rp() - 0.5) * 8 });   // pairs
  }
  const extPalm = plant(ctx, { kind: 'palm', count: palms.length, seed: 'cr-ext-p',
    place: () => ({ s: L - 0.5, lateral: 20 }),
    scale: [1.2, 1.8], colors: [0xb8c090, 0xa0a878], allowRoad: true });
  seatOnExt(extPalm, ext, palms, 0.2);
  add(extPalm);
  // hedgerows along the field bunds: shrubs in broken lines, not a scatter
  const low = [];
  const Rl = makeRng('cr-ext-low');
  const HEDGE = [-46, -17, 13, 37, 78];
  while (low.length < n(70)) {
    const d = 8 + Math.pow(Rl(), 1.1) * 300, h = HEDGE[Math.floor(Rl() * HEDGE.length)];
    if (fbm(d * 0.05 + h, h * 0.1, 2) < 0.0) continue;                // gaps in the hedge
    low.push({ d, lat: h + (Rl() - 0.5) * 2.5 });
  }
  const extLow = plant(ctx, { kind: 'bush', count: low.length, seed: 'cr-ext-b',
    place: (R, i) => ({ s: L - 0.5, lateral: low[i].lat < 0 ? -20 : 20 }),
    scale: [0.5, 1.5], colors: [0x4a6440, 0x566e42, 0x3e5a3a, 0x5a6a3a, 0x6a6a40], allowRoad: true });
  seatOnExt(extLow, ext, low, 0.12);
  add(extLow);
  // paddy / millet rows between the hedges, running with the road
  const crop = [];
  const Rc = makeRng('cr-ext-crop');
  const PLOTS = [[13, 37, 10, 230, 1.0], [-46, -17, 30, 200, 1.2], [37, 78, 40, 260, 1.4]];
  while (crop.length < n(2400)) {
    const [a, b, d0, d1, gap] = PLOTS[Math.floor(Rc() * PLOTS.length)];
    const rowsN = Math.floor((b - a - 2) / gap), lat = a + 1 + Math.floor(Rc() * rowsN) * gap + (Rc() - 0.5) * 0.15;
    const d = d0 + Rc() * (d1 - d0);
    if (fbm(d * 0.02 + a, lat * 0.02, 2) < -0.35) continue;         // a fallow patch
    crop.push({ d, lat });
  }
  const extCrop = plant(ctx, { kind: 'grass', count: crop.length, seed: 'cr-ext-c',
    place: () => ({ s: L - 0.5, lateral: 20 }),
    scale: [0.9, 1.5], colors: [0x8e9a4c, 0x9a9a52, 0x7e8c44, 0xa89a58], allowRoad: true });
  seatOnExt(extCrop, ext, crop, 0.02);
  add(extCrop);
  T('extFlora');
  buildHamlet(ctx, group, ext, HEDGE);
  T('hamlet');
  // the open field: rows of ripening crop parallel to the stream
  add(plant(ctx, { kind: 'grass', count: n(2600), seed: 'cr-field',
    place: R => {
      const s = FIELD.s0 + R() * (FIELD.s1 - FIELD.s0);
      const row = Math.floor(R() * (FIELD.far - FIELD.near) / 0.9);
      const lat = creekLat(s) + FIELD.near + row * 0.9 + (R() - 0.5) * 0.15;
      return { s, lateral: lat };
    },
    scale: [1.5, 2.1], colors: [0x9a9a52, 0x8e9a4c, 0xa89a58, 0x869246] }));
  T('field');
  // understorey
  add(plant(ctx, { kind: 'fern', count: n(200), seed: 'cr-fern',
    place: clustered(s0, s1, 6.2, 40, { side: 'left', freq: 0.06, thresh: -0.2, bias: 1.6 }),
    scale: [0.7, 1.3], colors: [0x4e7040, 0x5a7a44, 0x3f6238] }));
  add(plant(ctx, { kind: 'bush', count: n(120), seed: 'cr-bush',
    place: offCreek((R, i) => { const p = clustered(s0, s1, 6.4, 60, { freq: 0.05, thresh: -0.1, bias: 1.7 })(R, i);
      return p && p.s > L - 90 && R() < 0.7 ? null : p; }),
    scale: [0.4, 1.4], colors: [0x4a6440, 0x566e42, 0x3e5a3a] }));
  add(plant(ctx, { kind: 'flowers', count: n(110), seed: 'cr-fl',
    place: offCreek(clustered(s0, s1, 6.2, 34, { side: 'right', freq: 0.08, thresh: 0.05, bias: 1.4, seed: 17 })),
    colors: [0xf6cad4, 0xfff0d0, 0xd8a8e0, 0xffd070] }));
  T('under');
}


/* a far hamlet: a few dark huts with warm lit windows and a temple lamp on the horizon */
function buildHamlet(ctx, group, ext, HEDGE) {
  const R = makeRng('cr-hamlet'), v = new THREE.Vector3();
  const walls = [], lights = [];
  const box = (arr, cx, cy, cz, sx, sy, sz, yaw) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.rotateY(yaw); g.translate(cx, cy, cz); arr.push(g);
  };
  const SITES = [[300, 58, 5], [335, -70, 4], [380, 120, 3]];
  for (const [d0, lat0, k] of SITES) {
    for (let i = 0; i < k; i++) {
      const d = d0 + (R() - 0.5) * 30, lat = lat0 + (R() - 0.5) * 30;
      ext.toWorld(d, lat, v);
      const y = ext.height(d, lat), w = 4 + R() * 3, h = 2.6 + R() * 1.2, yaw = R() * Math.PI;
      box(walls, v.x, y + h / 2 - 0.2, v.z, w, h, 3.5 + R() * 2, yaw);
      box(walls, v.x, y + h + 0.3, v.z, w + 0.6, 0.6, 4.5, yaw);           // flat roof slab / parapet
      if (R() < 0.75) box(lights, v.x + Math.cos(yaw) * 0.4, y + 1.3, v.z - Math.sin(yaw) * 0.4, 0.9, 0.8, 4.6 + R(), yaw);
    }
  }
  // temple lamp on a low rise
  ext.toWorld(410, -38, v);
  const ty = ext.height(410, -38);
  box(walls, v.x, ty + 4, v.z, 3, 8, 3, 0.3);
  box(lights, v.x, ty + 8.6, v.z, 0.7, 0.7, 0.7, 0.3);
  const merge = arr => { const g = mergeGeoms(arr); arr.forEach(a => a.dispose()); return g; };
  const wm = new THREE.Mesh(merge(walls), new THREE.MeshStandardMaterial({ color: 0x3a3430, roughness: 0.95 }));
  wm.name = 'creek-hamlet';
  const lm = new THREE.Mesh(merge(lights), new THREE.MeshBasicMaterial({ color: 0xffb35a, fog: false }));
  lm.name = 'creek-hamlet-lights';
  group.add(wm, lm);
}
function mergeGeoms(arr) {
  const P = [], N = [], I = [];
  for (const g of arr) {
    const b = P.length / 3, p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { P.push(p.getX(i), p.getY(i), p.getZ(i)); N.push(n.getX(i), n.getY(i), n.getZ(i)); }
    for (const i of g.index.array) I.push(i + b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setIndex(I); g.computeBoundingSphere();
  return g;
}

/* ---------- the stream: short segments, each sitting just above its lowest ground,
 * bent to follow creekLat(s), then merged into one mesh (one draw call) ---------- */
function buildCreek(ctx, group, s0, s1) {
  const { world, path } = ctx;
  s1 = Math.min(s1, path.length);
  const SEG = 14;
  const P = [], D = [], F = [], I = [];
  const Y = [];
  const v = new THREE.Vector3();
  for (let a = s0; a < s1 - 1; a += SEG) {
    const b = Math.min(s1, a + SEG + 1.5); // overlap hides seams
    const c = creekLat((a + b) / 2);
    let lo = Infinity;
    for (let s = a - 2; s <= b + 2; s += 2) {
      const cl = creekLat(s);
      const hw = hwAt(s); for (let l = cl - hw; l <= cl + hw; l += 1.1) lo = Math.min(lo, world.heightSL(s, l));
    }
    const y = lo + 0.16; // near-flush with the meadow so the lips don't float
    const w = makeWater(ctx, { s0: a, s1: b, lateral0: c - HW, lateral1: c + HW, y, kind: 'creek' });
    const pos = w.geometry.attributes.position;
    const base = P.length / 3;
    for (let i = 0; i < pos.count; i++) {
      const q = path.nearest(pos.getX(i), pos.getZ(i));
      const lat = creekLat(q.s) + (q.lateral - c) * hwAt(q.s) / HW;
      const p = path.toWorld(q.s, lat, v);
      P.push(p.x, y, p.z);
      // read the stream as deeper than the flat meadow under it: darker body, foam only at the lips
      const edge = Math.min(1, Math.abs(lat - creekLat(q.s)) / hwAt(q.s));
      D.push(Math.max(y - world.heightSL(q.s, lat), 0) + 0.9 * (1 - edge * edge));
      F.push(q.s, (lat - creekLat(q.s)) / hwAt(q.s));
    }
    Y.push({ a, b, y });
    const idx = w.geometry.index.array;
    for (let i = 0; i < idx.length; i++) I.push(idx[i] + base);
    w.material.dispose();
    w.geometry.dispose();
  }
  const mat = streamMaterial(ctx);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(D, 1));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(F, 2));
  g.setIndex(I);
  g.computeBoundingSphere(); g.computeBoundingBox();
  const m = new THREE.Mesh(g, mat);
  m.name = 'water-creek'; m.renderOrder = 1;
  group.add(m);
  return Y;
}

/* the stream's own surface: a near-black body that mirrors the dusk sky and the dark
 * treeline, broken by ripples flowing downstream (aFlow = s, normalised offset) */
function streamMaterial(ctx) {
  const U = ctx.world.U;
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: U.uTime, uSkyTop: U.uSkyTop, uSkyHor: U.uSkyHor, uSunCol: U.uSunCol, uDusk: U.uDusk },
    vertexShader: /* glsl */`
attribute vec2 aFlow;
varying vec2 vFlow; varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vFlow = aFlow;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */`
uniform float uTime, uDusk;
uniform vec3 uSkyTop, uSkyHor, uSunCol;
varying vec2 vFlow; varying vec3 vW;
#include <fog_pars_fragment>
float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
float ht(vec2 p, float t) {
  vec2 q = vec2(p.x - t * 0.55, p.y * 2.2);
  return vn(q * 1.3) * 0.5 + vn(q * 3.1 + 7.0) * 0.3 + vn(vec2(q.x * 6.0 - t, q.y * 5.0)) * 0.2
       + 0.25 * sin(q.x * 4.0 + q.y * 3.0 - t * 2.0) * (0.4 + 0.6 * abs(vFlow.y));
}
void main() {
  float t = uTime;
  vec2 p = vFlow;
  float dist = length(cameraPosition - vW);
  float e = 0.06, h0 = ht(p, t);
  vec2 g = vec2(ht(p + vec2(e, 0.0), t) - h0, ht(p + vec2(0.0, e), t) - h0) / e;
  float k = 0.07 / (1.0 + dist * 0.035);
  vec3 N = normalize(vec3(-g.x * k, 1.0, -g.y * k));
  vec3 V = normalize(cameraPosition - vW);
  vec3 R = reflect(-V, N);
  float ry = clamp(R.y, 0.0, 1.0);
  vec3 sky = mix(uSkyHor, uSkyTop, pow(ry, 0.45));
  // the far bank and treeline mirrored just above the horizon: a dark, ragged band
  float tl = 0.10 + 0.05 * vn(vec2(vW.x * 0.08 + vW.z * 0.05, 3.0));
  sky = mix(vec3(0.025, 0.035, 0.03), sky, smoothstep(tl - 0.03, tl + 0.04, ry));
  float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(V, N), 0.0, 1.0), 5.0);
  vec3 body = vec3(0.018, 0.03, 0.03);
  vec3 col = mix(body, sky * 0.62, clamp(fres * 0.9 + 0.08, 0.0, 0.85));
  // silty shallows and a wet dark lip at the edges
  float ed = smoothstep(0.7, 1.0, abs(vFlow.y));
  col = mix(col, vec3(0.05, 0.045, 0.035), ed * 0.55);
  // riffle glints where the ripple crests catch the last light
  float gl = smoothstep(0.72, 0.9, h0) * (1.0 - smoothstep(20.0, 60.0, dist));
  col += (uSunCol * 0.3 + vec3(0.25, 0.2, 0.28)) * gl * 0.18;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`
  });
}

/* the banked channel: sloped mud lips each side, wet and dark at the water, drying into the meadow */
function bankTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d'), R = makeRng('cr-mud'), img = g.createImageData(256, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 256; x++) {
    const n = 0.5 + 0.35 * fbm(x * 0.05, y * 0.12, 3) + 0.15 * (R() - 0.5);
    const i = (y * 256 + x) * 4, v = Math.max(0, Math.min(255, 150 + n * 105));
    img.data[i] = v; img.data[i + 1] = v * 0.97; img.data[i + 2] = v * 0.9; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 260; k++) {                                     // grit and pebble specks
    g.fillStyle = `rgba(${R() < 0.5 ? '255,245,225' : '40,34,28'},${0.25 + R() * 0.4})`;
    g.beginPath(); g.ellipse(R() * 256, R() * 64, 0.6 + R() * 1.6, 0.5 + R(), R() * 3, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildChannel(ctx, group, segs, s0, s1) {
  const { world, path } = ctx;
  s1 = Math.min(s1, path.length);
  const wy = s => {                                                   // water level, blended between segments
    let best = segs[0], i = 0;
    for (; i < segs.length; i++) if (s < (segs[i].a + segs[i].b) / 2) break;
    const A = segs[Math.max(0, i - 1)], B = segs[Math.min(segs.length - 1, i)];
    const ca = (A.a + A.b) / 2, cb = (B.a + B.b) / 2;
    return best && cb > ca ? A.y + (B.y - A.y) * THREE.MathUtils.smoothstep(s, ca, cb) : A.y;
  };
  // [offset past the water edge (m), rise over the water (m) or null = ground, wetness]
  const COLS = [[-0.7, -0.3, 1], [-0.15, 0.0, 1], [0.25, 0.14, 0.9], [0.8, 0.28, 0.55], [1.6, 0.22, 0.2], [2.7, null, 0]];
  const pos = [], clr = [], uv = [], idx = [], v = new THREE.Vector3(), col = new THREE.Color(), gc = new THREE.Color();
  const WET = new THREE.Color(0x14110d), MUD = new THREE.Color(0x33291e);
  const nc = COLS.length;
  let base = 0;
  for (const sg of [-1, 1]) {
    let rows = 0;
    for (let s = s0; s <= s1; s += 1.5, rows++) {
      const y = wy(s), cl = creekLat(s), hw = hwAt(s);
      COLS.forEach(([o, rise, wet], c) => {
        const wob = c > 0 && c < nc - 1 ? 0.25 * fbm(s * 0.15 + sg * 5, c, 2) : 0;
        const lat = cl + sg * (hw + o + wob);
        path.toWorld(s, lat, v);
        const gy = world.heightSL(s, lat);
        const yy = rise === null ? gy - 0.06 : Math.max(y + rise, rise > 0 ? gy + rise * 0.5 : -1e9);
        pos.push(v.x, yy, v.z);
        uv.push(s / 5, c / (nc - 1));
        if (terrain.groundColor) terrain.groundColor(s, lat, gy, 0.1, gc); else gc.setHex(0x2c3a26);
        col.copy(gc).lerp(MUD, Math.min(1, wet * 1.6)).lerp(WET, Math.max(0, wet - 0.5) * 2);
        clr.push(col.r, col.g, col.b);
      });
    }
    for (let r = 1; r < rows; r++) for (let c = 0; c < nc - 1; c++) {
      const a = base + (r - 1) * nc + c, b = a + 1, d = a + nc, e = d + 1;
      if (sg > 0) idx.push(a, d, b, b, d, e); else idx.push(a, b, d, b, e, d);
    }
    base += rows * nc;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals(); g.computeBoundingSphere();
  const tex = bankTex();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, bumpMap: tex, bumpScale: 2, roughness: 0.62, side: THREE.DoubleSide }));
  m.receiveShadow = true; m.name = 'creek-banks';
  group.add(m);
}

/* ---------- banks: rocks, pebbles and reeds along both lips of the stream ---------- */
function buildBanks(ctx, group, s0, s1, n) {
  const side = R => (R() < 0.5 ? -1 : 1);
  const lip = (s, sg, off) => creekLat(s) + sg * (hwAt(s) + off);
  const clearBridge = (s, lat) => Math.abs(s - BRIDGE_S) < 1.6 ? null : { s, lateral: lat };
  // bank rocks: half-buried, clumped, larger on the outside of bends
  group.add(plant(ctx, { kind: 'boulder', count: n(150), seed: 'cr-rock',
    place: R => {
      const s = s0 + R() * (s1 - s0);
      if (fbm(s * 0.08, 3, 2) < -0.15) return null;
      return clearBridge(s, lip(s, side(R), -0.35 + R() * 1.1));
    },
    scale: [0.25, 0.75], sink: 0.45, colors: [0x6e6a62, 0x7c766c, 0x5f5b54, 0x877f72] }));
  // pebbles: small, flat, many, right at the water line and on the dry lip
  group.add(plant(ctx, { kind: 'boulder', count: n(700), seed: 'cr-peb',
    place: R => {
      const s = s0 + R() * (s1 - s0);
      return { s, lateral: lip(s, side(R), -0.5 + Math.pow(R(), 1.6) * 1.6) };
    },
    scale: [0.05, 0.14], sink: 0.2, colors: [0x9a938a, 0x8a847c, 0xa8a094, 0x6f6a63, 0xb2a894] }));
  // reeds: tall dark clumps in stands along the lips, thinning out between stands
  group.add(plant(ctx, { kind: 'grass', count: n(1400), seed: 'cr-reed',
    place: R => {
      const s = s0 + R() * (s1 - s0);
      if (fbm(s * 0.05 + 11, 1, 2) < -0.05) return null;
      return clearBridge(s, lip(s, side(R), -0.25 + Math.pow(R(), 1.8) * 1.4));
    },
    scale: [0.8, 1.5], colors: [0x5a6a36, 0x4e5e30, 0x6a7040, 0x5e5a34, 0x7a7448] }));
}

/* ---------- built things: one textured mesh (wood/stone/iron/clay), one glow mesh, one pool mesh ---------- */
function woodTexture() {
  const W = 256, c = document.createElement('canvas'); c.width = c.height = W;
  const g = c.getContext('2d'), R = makeRng('cr-wood');
  const img = g.createImageData(W, W);
  for (let y = 0; y < W; y++) {
    const band = Math.sin(y * 0.9 + Math.sin(y * 0.13) * 3) * 0.5 + 0.5;
    for (let x = 0; x < W; x++) {
      const knot = Math.sin((x + fbm(x * 0.02, y * 0.05, 2) * 60) * 0.05 + y * 0.35) * 0.5 + 0.5;
      let v = 150 + 40 * band * knot + 26 * (R() - 0.5) + 30 * fbm(x * 0.01, y * 0.08, 3);
      if (x > 236 && y > 236) v = 200; // flat patch for stone/iron/clay (uv ≈ 0.97, 0.03)
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// part prototypes, made once and shared: every lamp is the same boxes, cones and lathes
const PROTO = new Map();
function proto(key, make) {
  let g = PROTO.get(key);
  if (!g) { g = make(); if (g.index) { const n = g.toNonIndexed(); g.dispose(); g = n; } PROTO.set(key, g); }
  return g;
}
const box = (w, h, d) => proto(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));

function builder() {
  // growable typed buffers: the lamps and bridge come to ~40k vertices
  let cap = 4096, n = 0;
  let P = new Float32Array(cap * 3), N = new Float32Array(cap * 3), UV = new Float32Array(cap * 2), C = new Float32Array(cap * 3);
  const grow = need => {
    while (cap < need) cap *= 2;
    const g = (A, k) => { const B = new Float32Array(cap * k); B.set(A); return B; };
    P = g(P, 3); N = g(N, 3); UV = g(UV, 2); C = g(C, 3);
  };
  const col = new THREE.Color();
  return {
    // append a (shared, non-indexed) part transformed by m; the matrices are rigid, so normals take its 3×3
    add(geo, m, hex, flat) {
      const p = geo.attributes.position.array, nr = geo.attributes.normal?.array, uv = geo.attributes.uv?.array;
      const e = m.elements, cnt = p.length / 3;
      if (n + cnt > cap) grow(n + cnt);
      col.set(hex);
      for (let i = 0; i < cnt; i++, n++) {
        const i3 = i * 3, o3 = n * 3, o2 = n * 2;
        const x = p[i3], y = p[i3 + 1], z = p[i3 + 2];
        P[o3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        P[o3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        P[o3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        if (nr) {
          const a = nr[i3], b = nr[i3 + 1], c = nr[i3 + 2];
          const nx = e[0] * a + e[4] * b + e[8] * c, ny = e[1] * a + e[5] * b + e[9] * c, nz = e[2] * a + e[6] * b + e[10] * c;
          const l = Math.hypot(nx, ny, nz) || 1;
          N[o3] = nx / l; N[o3 + 1] = ny / l; N[o3 + 2] = nz / l;
        }
        UV[o2] = flat || !uv ? 0.97 : uv[i * 2] * 0.9; UV[o2 + 1] = flat || !uv ? 0.03 : 0.05 + uv[i * 2 + 1] * 0.85;
        C[o3] = col.r; C[o3 + 1] = col.g; C[o3 + 2] = col.b;
      }
    },
    geometry(withNormals = true) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P.slice(0, n * 3), 3));
      if (withNormals) g.setAttribute('normal', new THREE.BufferAttribute(N.slice(0, n * 3), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(UV.slice(0, n * 2), 2));
      g.setAttribute('color', new THREE.BufferAttribute(C.slice(0, n * 3), 3));
      g.computeBoundingSphere();
      return g;
    }
  };
}

// a local frame at road coords (s, lat): x = road right, y = up, z = right × up
function frameAt(ctx, s, lat, y) {
  const smp = ctx.path.sample(s), up = new THREE.Vector3(0, 1, 0);
  const X = smp.right.clone().setY(0).normalize(), Z = new THREE.Vector3().crossVectors(X, up);
  const o = ctx.path.toWorld(s, lat, new THREE.Vector3()); o.y = y;
  const F = new THREE.Matrix4().makeBasis(X, up, Z).setPosition(o);
  const tmp = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  const at = new THREE.Vector3(), out = new THREE.Matrix4();
  // matrix for a part at local (x, y, z) with local rotation (rx, ry, rz); reused, so use it before the next call
  return (x, yy, z, rx = 0, ry = 0, rz = 0) =>
    out.multiplyMatrices(F, tmp.compose(at.set(x, yy, z), q.setFromEuler(e.set(rx, ry, rz)), one));
}

const WOOD = 0x5c4232, WOOD2 = 0x6e5440, STONE = 0x7a746a, IRON = 0x2a2622, CLAY = 0x9c5230;
const LAMP_EVERY = 16;
function lampSpots(ctx, s0, s1) {
  const out = [];
  let side = -1;
  for (let s = s0; s < s1; s += LAMP_EVERY, side = -side) {
    // keep the right verge clear where the car pulls over for AMR Unnati
    if (side > 0 && s < VEN.s + 25) continue;
    out.push({ s, lat: side * (ctx.path.halfWidth + 1.8), side });
  }
  return out;
}

// the surface a pool of light lands on: asphalt, shoulder or ground
function surfY(ctx, s, lat) {
  const { path, world } = ctx, hw = path.halfWidth, a = Math.abs(lat), r = path.roadY(s);
  if (a < hw) return r + 0.02;
  if (a < hw + 1.5) return r + 0.02 - 0.12 * (a - hw) / 1.5;
  return world.heightSL(s, lat);
}

const DIYA = [[0, 0], [0.045, 0], [0.07, 0.015], [0.085, 0.042], [0.08, 0.048], [0.066, 0.03], [0, 0.026]].map(p => new THREE.Vector2(...p));
const FLAME = [[0, 0], [0.011, 0.01], [0.014, 0.026], [0.008, 0.046], [0, 0.064]].map(p => new THREE.Vector2(...p));

function buildLamps(ctx, group, s0, s1) {
  const { world } = ctx;
  const B = builder(), G = builder();
  const pools = [];                                  // {s, lat, r, k}
  const spots = [];                                  // lantern glass centres (for halos)
  const diya = (M, x, y, z, yaw) => {
    B.add(proto('diya', () => new THREE.LatheGeometry(DIYA, 10)), M(x, y, z, 0, yaw), CLAY, true);
    B.add(proto('spout', () => new THREE.ConeGeometry(0.018, 0.05, 6)), M(x + Math.cos(yaw) * 0.085, y + 0.04, z - Math.sin(yaw) * 0.085, 0, yaw, -(Math.PI / 2 - 0.3)), CLAY, true);
    G.add(proto('flame', () => new THREE.LatheGeometry(FLAME, 6)), M(x + Math.cos(yaw) * 0.1, y + 0.05, z - Math.sin(yaw) * 0.1), 0xffc868, true);
  };
  const R = makeRng('cr-lamps');
  for (const { s, lat, side } of lampSpots(ctx, s0, s1)) {
    const gy = Math.min(world.heightSL(s, lat - 0.2), world.heightSL(s, lat + 0.2));
    const M = frameAt(ctx, s, lat, gy);
    const inX = -side;                              // toward the road
    B.add(box(0.34, 0.34, 0.34), M(0, 0.1, 0, 0, R() * 0.3), STONE, true);            // stone footing
    B.add(box(0.12, 2.7, 0.12), M(0, 1.55, 0), WOOD);                                  // post
    B.add(box(0.16, 0.05, 0.16), M(0, 2.92, 0), WOOD2);                                // post cap
    B.add(box(0.95, 0.08, 0.08), M(inX * 0.42, 2.72, 0), WOOD);                        // arm
    B.add(box(0.5, 0.05, 0.05), M(inX * 0.2, 2.52, 0, 0, 0, inX * Math.PI / 4), WOOD); // brace
    const lx = inX * 0.8;
    B.add(box(0.015, 0.16, 0.015), M(lx, 2.6, 0), IRON, true);                         // hook
    // lantern: pyramid cap, rim, corner bars, base plate, finial
    B.add(proto('lcap', () => new THREE.ConeGeometry(0.15, 0.11, 4)), M(lx, 2.47, 0, 0, Math.PI / 4), IRON, true);
    B.add(box(0.21, 0.02, 0.21), M(lx, 2.41, 0), IRON, true);
    for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) B.add(box(0.02, 0.27, 0.02), M(lx + cx * 0.088, 2.27, cz * 0.088), IRON, true);
    B.add(box(0.2, 0.03, 0.2), M(lx, 2.125, 0), IRON, true);
    B.add(proto('finial', () => new THREE.ConeGeometry(0.03, 0.05, 6)), M(lx, 2.09, 0, Math.PI), IRON, true);
    G.add(box(0.165, 0.25, 0.165), M(lx, 2.27, 0), 0xffb45a, true);                    // glass
    spots.push(M(lx, 2.27, 0).elements.slice(12, 15));
    pools.push({ s, lat: lat + inX * 0.8, r: 4.2, k: 1 });
    // clay diyas on a low stone plinth by the post, one more on the ground
    B.add(box(0.42, 0.24, 0.3), M(inX * 0.45, 0.06, 0.3, 0, 0.1), STONE, true);
    diya(M, inX * 0.36, 0.18, 0.3, R() * 6);
    diya(M, inX * 0.56, 0.18, 0.26, R() * 6);
    diya(M, inX * 0.3, 0.0, -0.32, R() * 6);
    pools.push({ s: s + 0.3, lat: lat + inX * 0.45, r: 1.1, k: 0.7 });
  }
  buildBridge(ctx, B, G, pools, diya);

  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(), vertexColors: true, roughness: 0.88, metalness: 0 });
  const mesh = new THREE.Mesh(B.geometry(), wood);
  mesh.name = 'creek-built'; mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff });
  const glow = new THREE.Mesh(G.geometry(false), glowMat);
  glow.name = 'creek-glow';
  group.add(glow);
  const poolMat = buildPools(ctx, group, pools);
  return {
    spots,
    update() {
      const d = world.U.uDusk.value;
      glowMat.color.setScalar(0.6 + 1.1 * d);
      poolMat.uniforms.uK.value = 0.25 + 0.75 * d;
    }
  };
}

/* a small plank footbridge across the stream, with log stringers, rails and stone abutments */
function buildBridge(ctx, B, G, pools, diya) {
  const { world } = ctx;
  const s = BRIDGE_S, c = creekLat(s), SPAN = HW + 1.5;
  const gy = Math.max(world.heightSL(s, c - SPAN), world.heightSL(s, c + SPAN));
  const M = frameAt(ctx, s, c, gy);
  const R = makeRng('cr-bridge');
  const dy = x => 0.28 + 0.22 * (1 - (x / SPAN) ** 2);           // deck top above the banks
  const slope = x => -0.44 * x / (SPAN * SPAN);
  // stone abutments bedded into each bank
  for (const sx of [-1, 1]) B.add(box(1.1, 0.55, 1.8), M(sx * (SPAN + 0.35), 0.0, 0, 0, R() * 0.06), STONE, true);
  // log stringers, in segments following the arch
  for (let x = -SPAN - 0.6; x < SPAN + 0.6 - 0.01; x += 1.2) {
    const xm = x + 0.6, xa = Math.max(-SPAN, Math.min(SPAN, xm));
    for (const z of [-0.48, 0.48]) {
      const g = proto('stringer', () => new THREE.CylinderGeometry(0.1, 0.1, 1.24, 7).rotateZ(Math.PI / 2));
      B.add(g, M(xm, dy(xa) - 0.15, z, 0, 0, Math.atan(slope(xa))), WOOD);
    }
  }
  // piles into the stream bed
  for (const x of [-1.2, 1.2]) for (const z of [-0.5, 0.5]) B.add(proto('pile', () => new THREE.CylinderGeometry(0.08, 0.09, 1.3, 7)), M(x, dy(x) - 0.75, z), WOOD);
  // plank deck: slightly irregular boards with small gaps
  for (let x = -SPAN - 0.4; x <= SPAN + 0.4; x += 0.2) {
    const xa = Math.max(-SPAN, Math.min(SPAN, x));
    const tint = new THREE.Color(WOOD2).multiplyScalar(0.8 + 0.35 * R()).getHex();
    B.add(box(0.17, 0.045, 1.25 + R() * 0.12), M(x, dy(xa) - 0.02 + R() * 0.012, (R() - 0.5) * 0.05, 0, (R() - 0.5) * 0.04, Math.atan(slope(xa))), tint);
  }
  // posts and rails
  const px = [-SPAN, 0, SPAN];
  for (const z of [-0.64, 0.64]) {
    for (const x of px) B.add(box(0.09, 1.0, 0.09), M(x, dy(x) + 0.42, z), WOOD);
    for (let i = 0; i < px.length - 1; i++) {
      const xa = px[i], xb = px[i + 1], xm = (xa + xb) / 2;
      for (const h of [0.88, 0.45]) {
        const ya = dy(xa) + h, yb = dy(xb) + h;
        const len = Math.hypot(xb - xa, yb - ya);
        B.add(box(len + 0.06, 0.065, 0.065), M(xm, (ya + yb) / 2, z, 0, 0, Math.atan2(yb - ya, xb - xa)), WOOD);
      }
    }
  }
  // a pair of diyas on the near abutment, like someone lit them for the evening
  const D = (x, y, z, rx = 0, ry = 0, rz = 0) => M(x, y, z, rx, ry, rz);
  diya(D, -SPAN - 0.2, 0.28, 0.6, 1.2);
  diya(D, -SPAN - 0.45, 0.28, -0.62, 2.8);
  pools.push({ s, lat: c - SPAN - 0.3, r: 1.3, k: 0.8 });
}

/* ---------- pools of warm light on the ground: additive discs draped on the surface ---------- */
const POOL_VERT = /* glsl */`
attribute vec3 aPool; // x,y in -1..1 across the disc, z intensity
uniform float uK;
varying vec3 vP;
#include <fog_pars_vertex>
void main() {
  vP = aPool;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const POOL_FRAG = /* glsl */`
uniform float uK;
varying vec3 vP;
#include <fog_pars_fragment>
void main() {
  float r = length(vP.xy);
  float a = pow(max(0.0, 1.0 - r), 2.2) * vP.z * uK;
  vec3 col = vec3(1.0, 0.62, 0.28) * a * 0.55;
  gl_FragColor = vec4(col, 1.0);
  #ifdef USE_FOG
  gl_FragColor.rgb = hfApply(gl_FragColor.rgb, vHfWP) - hfApply(vec3(0.0), vHfWP);
  #endif
}`;

function buildPools(ctx, group, pools) {
  const { path } = ctx;
  const P = [], A = [], I = [];
  const v = new THREE.Vector3(), K = 8;
  for (const { s, lat, r, k } of pools) {
    const base = P.length / 3;
    for (let j = 0; j <= K; j++) for (let i = 0; i <= K; i++) {
      const u = i / K * 2 - 1, w = j / K * 2 - 1;
      const ss = s + w * r, ll = lat + u * r;
      path.toWorld(ss, ll, v);
      P.push(v.x, surfY(ctx, ss, ll) + 0.05, v.z);
      A.push(u, w, k);
    }
    for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) {
      const a = base + j * (K + 1) + i, b = a + 1, d = a + K + 1, e = d + 1;
      I.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aPool', new THREE.Float32BufferAttribute(A, 3));
  g.setIndex(I);
  g.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uK: { value: 1 } },
    vertexShader: POOL_VERT, fragmentShader: POOL_FRAG
  });
  const m = new THREE.Mesh(g, mat);
  m.name = 'creek-pools'; m.renderOrder = 2;
  group.add(m);
  return mat;
}

/* ---------- fireflies + lantern halos: one additive Points draw ---------- */
const FLY_VERT = /* glsl */`
attribute vec4 aFly; // x seed, y size, z kind (0 firefly, 1 halo), w phase
uniform float uTime, uDusk, uPx;
varying float vA; varying float vKind;
#include <fog_pars_vertex>
void main() {
  vec3 p = position;
  float t = uTime, sd = aFly.x, fly = 1.0 - aFly.z;
  p += fly * vec3(sin(t * 0.37 + sd * 6.1) * 0.7, sin(t * 0.9 + sd * 11.0) * 0.25 + sin(t * 0.23 + sd) * 0.3, cos(t * 0.31 + sd * 4.3) * 0.7);
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // fireflies glow in slow pulses and are dark most of the time
  float blink = smoothstep(0.55, 1.0, sin(t * (0.8 + sd * 0.12) + aFly.w));
  vA = fly * uDusk * blink + aFly.z * (0.3 + 0.7 * uDusk) * (0.94 + 0.06 * sin(t * 7.0 + sd * 9.0));
  vKind = aFly.z;
  gl_PointSize = clamp(aFly.y * uPx / -mvPosition.z, 1.0, 140.0);
  #include <fog_vertex>
}`;
const FLY_FRAG = /* glsl */`
varying float vA; varying float vKind;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float core = smoothstep(1.0, 0.0, r);
  float a = mix(core * core * (0.5 + 1.6 * smoothstep(0.3, 0.0, r)), pow(core, 3.0) * 0.4, vKind) * vA;
  vec3 col = mix(vec3(0.8, 1.0, 0.45), vec3(1.0, 0.7, 0.36), vKind) * a;
  gl_FragColor = vec4(col, 1.0);
  #ifdef USE_FOG
  gl_FragColor.rgb = hfApply(gl_FragColor.rgb, vHfWP) - hfApply(vec3(0.0), vHfWP);
  #endif
}`;

function buildFireflies(ctx, group, s0, s1, spots) {
  const { path, world, quality, renderer } = ctx;
  const R = makeRng('creek-flies');
  const count = ({ low: 40, med: 60, high: 80 })[quality.tier] ?? 60;
  const P = [], A = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // mostly low over the stream banks and the forest edge
    const s = s0 + R() * (s1 - s0);
    const lat = R() < 0.55 ? creekLat(s) + (R() - 0.5) * 9 : -(7 + Math.pow(R(), 1.3) * 14);
    path.toWorld(s, lat, v);
    P.push(v.x, world.heightSL(s, lat) + 0.3 + R() * 1.4, v.z);
    A.push(R() * 10, 0.3 + R() * 0.25, 0, R() * 6.28);
  }
  for (const [x, y, z] of spots) { P.push(x, y, z); A.push(R() * 10, 3.2, 1, 0); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aFly', new THREE.Float32BufferAttribute(A, 4));
  g.computeBoundingSphere();
  g.boundingSphere.radius += 3;
  const mat = new THREE.ShaderMaterial({
    fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: world.U.uTime, uDusk: world.U.uDusk, uPx: { value: 600 } },
    vertexShader: FLY_VERT, fragmentShader: FLY_FRAG
  });
  const pts = new THREE.Points(g, mat);
  pts.name = 'creek-fireflies';
  pts.renderOrder = 3;
  group.add(pts);
  const sz = new THREE.Vector2();
  return {
    update() { renderer?.getSize?.(sz); mat.uniforms.uPx.value = Math.max(300, sz.y || 600) * (renderer?.getPixelRatio?.() || 1) * 0.5; }
  };
}

/* ---------- the road and ground carried on past s = L for the final crane shot ---------- */
function buildExtension(ctx, group, ext) {
  const { path } = ctx;
  // match terrain.js's road strip: RL = hw + 0.35, 30 m sheets, aRoad = (lat, s) for the painted lines
  const hw = path.halfWidth, RL = hw + 0.35, REPEAT = 30, BUMP_UV = 0.37;
  const v = new THREE.Vector3();
  // road: same cross-section and material as terrain.js, seamless at d = 0
  {
    const cols = [[-RL, 0.0], [-hw, 0.02], [-1.8, 0.02], [0, 0.02], [1.8, 0.02], [hw, 0.02], [RL, 0.0]];
    const nc = cols.length;
    const pos = [], uv = [], ar = [], nor = [], idx = [];
    const rows = Math.round(ext.D / 2) + 1;
    for (let r = 0; r < rows; r++) {
      const d = r * 2;
      for (const [lat, dy] of cols) {
        ext.toWorld(d, lat, v);
        pos.push(v.x, ext.y0 + dy, v.z);
        uv.push((lat + RL) / (2 * RL), (ext.L + d) / REPEAT);
        ar.push(lat, ext.L + d); nor.push(0, 1, 0);
      }
      if (r) { const a = (r - 1) * nc; for (let c = 0; c < nc - 1; c++) idx.push(a + c, a + c + 1, a + c + nc, a + c + 1, a + c + nc + 1, a + c + nc); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aRoad', new THREE.Float32BufferAttribute(ar, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const rm = terrain.road?.[0]?.material;
    const m = new THREE.Mesh(g, rm || new THREE.MeshStandardMaterial({ color: 0x333336, roughness: 0.9 }));
    m.userData.borrowed = !!rm;
    m.receiveShadow = true; m.name = 'creek-ext-road';
    group.add(m);
  }
  // ground: terrain.js's lateral columns (so the seam at d = 0 matches), rows widening with distance
  {
    const LAT = terrain.LAT || [-210, -120, -60, -30, -12, -6, -2, 2, 6, 12, 30, 60, 120, 210];
    const lats = [-420, -330, -260, ...LAT, 260, 330, 420];
    const ds = [];
    for (let d = 0; d <= ext.D; d += Math.min(12, 3 + d * 0.03)) ds.push(d);
    const cols = lats.length, pos = [], clr = [], spl = [], guv = [], idx = [];
    const col = new THREE.Color();
    const hRow = new Float32Array(cols);
    ds.forEach((d, r) => {
      for (let c = 0; c < cols; c++) {
        const lat = lats[c];
        ext.toWorld(d, lat, v);
        const y = ext.height(d, lat);
        pos.push(v.x, y, v.z); hRow[c] = y;
        guv.push(v.x * BUMP_UV, v.z * BUMP_UV);
        spl.push(0.3 * Math.max(0, fbm(v.x * 0.03 + 9, v.z * 0.03, 2)), 0, 0, 0);
      }
      for (let c = 0; c < cols; c++) {
        const a = Math.max(0, c - 1), b = Math.min(cols - 1, c + 1);
        const slope = Math.abs(hRow[b] - hRow[a]) / Math.max(0.5, Math.abs(lats[b] - lats[a]));
        if (terrain.groundColor) terrain.groundColor(ext.L + d, lats[c], hRow[c], slope, col); else col.setHex(0x3b4a2c);
        clr.push(col.r, col.g, col.b);
      }
      if (r) for (let c = 0; c < cols - 1; c++) {
        const a = (r - 1) * cols + c, b = a + 1, dd = a + cols, e = dd + 1;
        idx.push(a, b, dd, b, e, dd);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
    g.setAttribute('aSplat', new THREE.Float32BufferAttribute(spl, 4));
    g.setAttribute('aWet', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(guv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const gm = terrain.ground?.[0]?.material;
    const m = new THREE.Mesh(g, gm || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    m.userData.borrowed = !!gm;
    m.receiveShadow = true; m.name = 'creek-ext-ground';
    group.add(m);
  }
}
