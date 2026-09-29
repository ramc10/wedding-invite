/* A beach venue's arrival forecourt, laid out on the site axis (core/timeline.js SITES[id], COURTS[id]):
 * a low wall along Beach Road with gate piers at gateIn / gateOut; a kerbed paved drive that follows
 * SITES[id].route.in / .out exactly (bellmouth at the road, clipped at lateral -3.35), widening into a
 * formal 7 × 7 m drop-off on the axis at the stop; a carpet runner on a paved walk from there to the
 * arch line d0; the planted island (stone kerb, lawn, clipped hedge ring, centre left for the scene's
 * centrepiece); lawn over the rest, with two pairs of lantern posts flanking the carpet near the arch;
 * bollards in mirrored pairs. Everything taller than 5 cm keeps 2.4 m off both routes, 3.5 m off the stop.
 *
 * buildCompound(ctx, id, style) → { group, update(dusk) }
 *   style: { drive: {base, joint, accent} (css colours for the paver texture),
 *            stone: hex (wall, piers, kerbs), cap: hex (coping, pier caps, lantern posts),
 *            glow: hex (LED slits, lamps), seaWall: bool, carpet?: css colour (default glow-tinted cream) }
 * Draw calls: lawn, drive, walls, carpet, glow, pools = 6. No lights. */
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/addons/utils/BufferGeometryUtils.js';
import { COURTS, SITES, SITE_WALL } from '../../core/timeline.js';
import { smoothstep } from '../../core/noise.js';

const W = 4.2;            // drive width
const WALL = SITE_WALL;   // road-side wall line (lateral)
const WALL_H = 0.7;

function canvasTex(size, draw, rep = [1, 1]) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
// 512 px = 2.4 m: running-bond pavers, 0.6 × 0.3 m, with a hairline joint and a little tone jitter
function paverTex({ base, joint, accent }) {
  return canvasTex(512, (g, n) => {
    g.fillStyle = joint; g.fillRect(0, 0, n, n);
    const pw = n / 4, ph = n / 8;
    let seed = 7; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let r = 0; r < 8; r++) for (let c = -1; c < 5; c++) {
      const x = c * pw + (r % 2) * pw / 2, y = r * ph;
      g.fillStyle = base; g.globalAlpha = 1; g.fillRect(x + 2, y + 2, pw - 4, ph - 4);
      g.fillStyle = accent; g.globalAlpha = 0.08 + R() * 0.14; g.fillRect(x + 2, y + 2, pw - 4, ph - 4);
    }
    g.globalAlpha = 1;
  });
}
// close-mown turf with faint mowing stripes
function lawnTex() {
  return canvasTex(256, (g, n) => {
    g.fillStyle = '#5d7d3a'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 5000; i++) {
      const v = 70 + Math.random() * 60;
      g.fillStyle = `rgba(${v * 0.7 | 0},${v + 30 | 0},${v * 0.45 | 0},0.35)`;
      g.fillRect(Math.random() * n, Math.random() * n, 1, 2 + Math.random() * 3);
    }
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, 0, n / 2, n);
  }, [1, 1]);
}
// the runner: u across (0…1), v along (2 m a tile): a fine weave and a darker border band
function carpetTex() {
  const t = canvasTex(256, (g, n) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, n, n);
    for (let y = 0; y < n; y += 2) { g.fillStyle = `rgba(120,100,70,${0.04 + (y % 4 ? 0.03 : 0)})`; g.fillRect(0, y, n, 1); }
    for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(90,70,40,${Math.random() * 0.06})`; g.fillRect(Math.random() * n, Math.random() * n, 2, 1); }
    g.fillStyle = 'rgba(150,110,60,0.45)'; g.fillRect(n * 0.05, 0, n * 0.035, n); g.fillRect(n * 0.915, 0, n * 0.035, n);
    g.fillStyle = 'rgba(150,110,60,0.22)'; g.fillRect(n * 0.11, 0, n * 0.012, n); g.fillRect(n * 0.878, 0, n * 0.012, n);
  });
  t.wrapS = THREE.ClampToEdgeWrapping; return t;
}
function glowTex() {
  return canvasTex(64, (g, n) => {
    const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, n, n);
  });
}

/* ---------- the route, sampled where it leaves the road (lateral < -3.4) ---------- */
const curveOf = pts => new THREE.CatmullRomCurve3(pts.map(([s, l]) => new THREE.Vector3(s, 0, l)), false, 'centripetal');
function samples(pts, step = 0.6) {
  const c = curveOf(pts), n = Math.ceil(c.getLength() / step), out = [];
  const p = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    c.getPointAt(i / n, p); c.getTangentAt(i / n, t);
    if (p.z < -3.2) out.push({ s: p.x, l: p.z, ts: t.x, tl: t.z });   // from just over the road's edge
  }
  return out;
}
/** where a sampled drive crosses lateral L: {s, ts, tl} */
function crossing(sm, L) {
  for (let i = 1; i < sm.length; i++) {
    const a = sm[i - 1], b = sm[i];
    if ((a.l - L) * (b.l - L) <= 0) { const k = (L - a.l) / (b.l - a.l || 1); return { s: a.s + (b.s - a.s) * k, ts: a.ts, tl: a.tl }; }
  }
  return null;
}

/* ---------- geometry helpers, in road coords (s along, l lateral; world via path.toWorld) ---------- */
const V = new THREE.Vector3();
function at(ctx, s, l, dy) { ctx.path.toWorld(s, l, V); V.y = ctx.path.roadY(s) + dy; return V; }
/** a strip along samples, half-width hw(sample) either side of the centreline, dy above the road */
function strip(ctx, sm, hw, dy, uvK = 1 / 2.4, maxL = Infinity) {
  const pos = [], uv = [], idx = [];
  let along = 0;
  sm.forEach((q, i) => {
    if (i) along += Math.hypot(q.s - sm[i - 1].s, q.l - sm[i - 1].l);
    const nl = q.ts, ns = -q.tl, h = hw(q);                     // normal to the tangent, in (s, l)
    for (const k of [-1, 1]) {
      const p = at(ctx, q.s + ns * h * k, Math.min(maxL, q.l + nl * h * k), dy);   // never onto the road
      pos.push(p.x, p.y, p.z); uv.push((k * h) * uvK, along * uvK);
    }
    if (i) { const b = i * 2; idx.push(b - 2, b - 1, b, b - 1, b + 1, b); }
  });
  return geo(pos, uv, idx);
}
function geo(pos, uv, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) { g.index.array.reverse(); g.computeVertexNormals(); }
  return g.toNonIndexed();
}
/** a flat rectangle s0…s1 × l0…l1 in road coords, dy above the road (a grid, so it follows the road's bend) */
function rect(ctx, s0, s1, l0, l1, dy, uvK = 1 / 2.4, uvL = null) {
  const pos = [], uv = [], idx = [], ns = Math.max(1, Math.ceil((s1 - s0) / 1.5)), nl = Math.max(1, Math.ceil(Math.abs(l1 - l0) / 1.5));
  for (let i = 0; i <= ns; i++) for (let j = 0; j <= nl; j++) {
    const s = s0 + (s1 - s0) * i / ns, l = l0 + (l1 - l0) * j / nl, p = at(ctx, s, l, dy);
    pos.push(p.x, p.y, p.z); uv.push(uvL ? uvL(l) : l * uvK, s * uvK);
    if (i && j) { const a = (i - 1) * (nl + 1) + j - 1, b = i * (nl + 1) + j - 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  }
  return geo(pos, uv, idx);
}
/** a closed ring wall along a loop of [s, l] points: outer face, top and inner face, `w` wide and
 *  `h` tall, bottom at dy (the loop's own line is the outer edge; the inner edge is pulled toward c) */
function ringWall(ctx, loop, c, w, h, dy) {
  const pos = [], idx = [], n = loop.length;
  loop.forEach(([s, l]) => {
    const d = Math.hypot(s - c[0], l - c[1]) || 1, si = s - (s - c[0]) / d * w, li = l - (l - c[1]) / d * w;
    for (const [ss, ll, y] of [[s, l, dy], [s, l, dy + h], [si, li, dy + h], [si, li, dy]]) { const p = at(ctx, ss, ll, y); pos.push(p.x, p.y, p.z); }
  });
  for (let i = 0; i < n; i++) {
    const a = i * 4, b = ((i + 1) % n) * 4;
    for (let k = 0; k < 3; k++) idx.push(a + k, b + k, a + k + 1, b + k, b + k + 1, a + k + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const out = g.toNonIndexed(); out.computeVertexNormals(); return out;
}
/** a flat fan over a star-shaped loop around c, dy above the road */
function fan(ctx, loop, c, dy) {
  const pos = [], uv = [], idx = [], p0 = at(ctx, c[0], c[1], dy);
  pos.push(p0.x, p0.y, p0.z); uv.push(c[1] / 3, c[0] / 3);
  loop.forEach(([s, l], i) => { const p = at(ctx, s, l, dy); pos.push(p.x, p.y, p.z); uv.push(l / 3, s / 3); idx.push(0, i + 1, (i + 1) % loop.length + 1); });
  return geo(pos, uv, idx);
}
/** a box of size (along s, up, across) at (s, l), bottom at dy above the road, turned with the road */
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
function box(ctx, ds, h, dl, s, l, dy, geom, yaw = 0) {
  const g = (geom || new THREE.BoxGeometry(dl, h, ds)).toNonIndexed();
  g.translate(0, h / 2, 0);
  const p = at(ctx, s, l, dy).clone();
  Q.setFromAxisAngle(UP, ctx.path.sample(s).heading + yaw);
  return g.applyMatrix4(M4.compose(p, Q, ONE));
}

/* ---------- the compound ---------- */
/** distance from (s, l) to a polyline of [s, l] points (segments, off the road only) */
function polyDist(pts, s, l) {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [as, al] = pts[i - 1], [bs, bl] = pts[i];
    if (al > -3.35 && bl > -3.35) continue;                 // on the road: not the compound's business
    const ds = bs - as, dl = bl - al, t = Math.max(0, Math.min(1, ((s - as) * ds + (l - al) * dl) / (ds * ds + dl * dl || 1)));
    d = Math.min(d, Math.hypot(s - as - ds * t, l - al - dl * t));
  }
  return d;
}
export function buildCompound(ctx, id, style) {
  const S = SITES[id], C = COURTS[id], ax = S.ax, st = S.stop, R = S.route;
  // the corridor: nothing taller than 5 cm within 2.4 m of either route or 3.5 m of the stop
  const clear = (s, l, pad = 0) => polyDist(R.in, s, l) >= 2.4 + pad && polyDist(R.out, s, l) >= 2.4 + pad && Math.hypot(s - st.s, l - st.l) >= 3.5 + pad;
  const pairClear = (s, dl, pad) => clear(s, ax + dl, pad) && clear(s, ax - dl, pad);
  // drop-off: a formal paved rectangle on the axis, ~7 × 7 m, centred on the stop
  const DR = { s0: st.s - 3.5, s1: st.s + 3.5, l0: ax + 3.5, l1: ax - 3.5 };
  const inDR = q => q.s > DR.s0 + 0.4 && q.s < DR.s1 - 0.4 && q.l < DR.l0 && q.l > DR.l1;
  const inS = samples(R.in).filter(q => !inDR(q)), outS = samples(R.out).filter(q => !inDR(q));
  // the drive flares into a bellmouth where it meets the road, and never spills onto it
  const hw = q => W / 2 + 2.2 * smoothstep(-6.2, -3.6, q.l);
  // the carpet starts 6.5 m past the stop: the car pulls away across the paving before it, never over the carpet
  const WALK = 1.5, cs0 = st.s + 6.5, cs1 = S.d0;             // the carpet's paved walk, half-width, and its span
  const drive = [strip(ctx, inS, hw, 0.03, 1 / 2.4, -3.35), strip(ctx, outS, hw, 0.03, 1 / 2.4, -3.35),
    rect(ctx, DR.s0, DR.s1, DR.l0, DR.l1, 0.031), rect(ctx, DR.s1 - 0.05, cs1, ax + WALK, ax - WALK, 0.032)];
  // where each drive crosses the promenade strip (road edge to the wall) the flared strip folds at the
  // road-edge clip and leaves gaps: pave that crossing solidly, a rectangle over the whole bellmouth
  for (const leg of [R.in, R.out]) {
    const on = leg.filter(([, l]) => l < -3.2 && l > WALL - 0.6);
    if (!on.length) continue;
    const ss = on.map(([s]) => s), sA = Math.min(...ss) - 4.4, sB = Math.max(...ss) + 4.4;
    drive.push(rect(ctx, sA, sB, -3.4, WALL - 0.45, 0.029));
  }
  // the carpet: a runner along the axis from the drop-off to the arch line
  const carpet = rect(ctx, cs0 + 0.25, cs1, ax + 0.8, ax - 0.8, 0.034, 0.5, l => (l - (ax - 0.8)) / 1.6);

  // lawn over the whole forecourt, just under the drive
  const lawn = [rect(ctx, C.s0, C.s1 + 0.5, WALL, C.lat[1], 0.012, 1 / 3)];
  const stone = [], cap = [], hedge = [], glow = [], pools = [];

  // kerbs: a slim stone edge either side of each leg (not across the drop-off)
  for (const sm of [inS, outS]) for (const k of [-1, 1]) {
    const edge = sm.map(q => { const h = hw(q) * k; return { s: q.s - q.tl * h, l: q.l + q.ts * h, ts: q.ts, tl: q.tl }; })
      .filter(q => q.l < WALL + 0.2 && !(q.s > DR.s0 - 0.1 && q.s < DR.s1 + 0.1 && q.l < DR.l0 + 0.1 && q.l > DR.l1 - 0.1));
    if (edge.length > 2) stone.push(strip(ctx, edge, () => 0.12, 0.03, 1, Infinity).translate(0, 0.02, 0));
  }
  // and a kerb line round the drop-off rectangle and the walk
  for (const l of [DR.l0 + 0.06, DR.l1 - 0.06]) stone.push(box(ctx, DR.s1 - DR.s0, 0.05, 0.12, st.s, l, 0.02));
  for (let s = cs0; s < cs1 - 0.05; s += 1) for (const k of [-1, 1]) {   // the walk's kerbs, but not across the out leg
    const d = Math.min(1, cs1 - s), l = ax + k * (WALK + 0.06);
    if (polyDist(R.out, s + d / 2, l) > W / 2 + 0.3) stone.push(box(ctx, d, 0.05, 0.12, s + d / 2, l, 0.02));
  }

  // the island: SITES.island's oval, pulled in wherever it would reach the corridor or the drop-off,
  // as a raised planted bed: 15 cm stone kerb, lawn top, a clipped low hedge ring; its centre left free
  const I = S.island, N = 64, loop = [];
  for (let i = 0; i < N; i++) {
    const a = -i / N * Math.PI * 2;
    let k = 1;
    for (; k > 0.2; k -= 0.02) {
      const s = I.s + Math.cos(a) * I.rs * k, l = I.l + Math.sin(a) * I.rl * k;
      if (clear(s, l, 0.05) && l > DR.l0 + 0.3 && l < WALL - 0.5) break;
    }
    loop.push([I.s + Math.cos(a) * I.rs * k, I.l + Math.sin(a) * I.rl * k]);
  }
  const IC = [I.s, I.l];
  stone.push(ringWall(ctx, loop, IC, 0.22, 0.15, 0));
  const inner = loop.map(([s, l]) => { const d = Math.hypot(s - I.s, l - I.l) || 1; return [s - (s - I.s) / d * 0.22, l - (l - I.l) / d * 0.22]; });
  lawn.push(fan(ctx, inner, IC, 0.14));
  const hedgeLoop = inner.map(([s, l]) => { const d = Math.hypot(s - I.s, l - I.l) || 1; return [s - (s - I.s) / d * 0.12, l - (l - I.l) / d * 0.12]; });
  hedge.push(ringWall(ctx, hedgeLoop, IC, 0.42, 0.4, 0.14), ringWall(ctx, hedgeLoop.map(([s, l]) => { const d = Math.hypot(s - I.s, l - I.l) || 1; return [s - (s - I.s) / d * 0.05, l - (l - I.l) / d * 0.05]; }), IC, 0.32, 0.46, 0.14));

  // welcome garden: lawn (already down); two pairs of tall slim lantern posts flanking the carpet near the arch
  const LAMP = 2.6;
  let placed = 0;
  for (let s = S.d0 - 1.4; s > cs0 + 1 && placed < 2; s -= 0.5) {
    if (!pairClear(s, LAMP, 0.25)) continue;
    for (const k of [-1, 1]) {
      const l = ax + k * LAMP;
      stone.push(box(ctx, 0.36, 0.3, 0.36, s, l, 0.012));                  // plinth
      cap.push(box(ctx, 0.09, 2.2, 0.09, s, l, 0.3));                       // post
      cap.push(box(ctx, 0.3, 0.05, 0.3, s, l, 2.5), box(ctx, 0.3, 0.05, 0.3, s, l, 2.9), box(ctx, 0.12, 0.08, 0.12, s, l, 2.95));
      glow.push(box(ctx, 0.22, 0.35, 0.22, s, l, 2.55));                     // the lantern's lit glass
      pools.push({ s, l, r: 2.2 });
    }
    placed++; s -= 2.6;
  }

  // the road wall, with gate gaps sized to the drive where it crosses (at gateIn / gateOut)
  const inAll = samples(R.in), outAll = samples(R.out);
  const gates = [[S.gateIn, crossing(inAll, WALL)], [S.gateOut, crossing(outAll, WALL)]].map(([gs, c]) => {
    const sin = c ? Math.max(0.35, Math.abs(c.tl) / Math.hypot(c.ts, c.tl)) : 1;
    return { s: gs, half: (hw({ l: WALL }) + 0.35) / sin };
  });
  // walls run down to the sand where it falls away below the forecourt (a retaining face, not a floating slab)
  const foot = (s, l) => Math.min(0, (ctx.world.heightSL ? ctx.world.heightSL(s, l) : Infinity) - ctx.path.roadY(s) - 0.1);
  const wallAlong = (s0, s1, l) => {
    for (let s = s0; s < s1 - 0.05; s += 2) {
      const d = Math.min(2, s1 - s), m = s + d / 2, f = Math.max(-4, Math.min(foot(s, l), foot(s + d, l)));
      stone.push(box(ctx, d + 0.02, WALL_H - f, 0.32, m, l, f));
      cap.push(box(ctx, d + 0.02, 0.07, 0.42, m, l, WALL_H));             // coping
    }
  };
  const runs = []; let a0 = C.s0;
  for (const g of gates) { runs.push([a0, g.s - g.half - 0.35]); a0 = g.s + g.half + 0.35; }
  runs.push([a0, C.s1]);
  for (const [s0, s1] of runs) if (s1 - s0 > 0.4) wallAlong(s0, s1, WALL);
  if (style.seaWall) wallAlong(C.s0, C.s1, C.lat[1] + 0.2);
  else for (let s = C.s0; s < C.s1 + 0.45; s += 2) {                  // no parapet: a flush stone edge down to the sand
    const d = Math.min(2, C.s1 + 0.5 - s), f = Math.max(-4, Math.min(foot(s, C.lat[1]), foot(s + d, C.lat[1])));
    if (f < -0.02) stone.push(box(ctx, d + 0.02, 0.05 - f, 0.3, s + d / 2, C.lat[1] + 0.1, f));
  }
  // the low end wall across the forecourt at its start (s = a)
  for (let l = WALL - 0.16; l > C.lat[1] + 0.05; l -= 2) {
    const d = Math.min(2, l - C.lat[1]);
    const f = Math.max(-4, Math.min(foot(C.s0, l), foot(C.s0, l - d)));
    stone.push(box(ctx, 0.32, WALL_H - f, d + 0.02, C.s0 + 0.16, l - d / 2, f));
    cap.push(box(ctx, 0.42, 0.07, d + 0.02, C.s0 + 0.16, l - d / 2, WALL_H));
  }
  // gate piers: stone, a warm LED slit facing the road, a dark cap; a light pool either side
  for (const g of gates) for (const k of [-1, 1]) {
    const s = g.s + k * (g.half + 0.35);
    stone.push(box(ctx, 0.7, 2.3, 0.7, s, WALL, 0));
    cap.push(box(ctx, 0.84, 0.1, 0.84, s, WALL, 2.3), box(ctx, 0.5, 0.18, 0.5, s, WALL, 2.4));
    glow.push(box(ctx, 0.06, 1.5, 0.02, s, WALL + 0.36, 0.45));
    pools.push({ s, l: WALL + 1.1, r: 1.7 }, { s, l: WALL - 1.1, r: 1.6 });
  }
  // bollards, in mirrored pairs about the axis: at the drop-off's corners and down the carpet
  const bollard = (s, l) => {
    stone.push(box(ctx, 0.2, 0.75, 0.2, s, l, 0));
    cap.push(box(ctx, 0.24, 0.05, 0.24, s, l, 0.75));
    glow.push(box(ctx, 0.21, 0.1, 0.21, s, l, 0.58));
    pools.push({ s, l, r: 1.4 });
  };
  const BD = 3.5 + 0.35;
  for (const s of [DR.s0 + 0.3, DR.s1 - 0.3]) if (pairClear(s, BD, 0)) { bollard(s, ax + BD); bollard(s, ax - BD); }
  for (let s = cs1 - 0.6; s > cs0 + 0.5; s -= 2.4) if (pairClear(s, WALK + 0.45, 0)) { bollard(s, ax + WALK + 0.45); bollard(s, ax - WALK - 0.45); }
  pools.push({ s: st.s, l: ax, r: 4.6 }, { s: (cs0 + cs1) / 2 + 2, l: ax, r: 3.4 });   // the drop-off and the carpet, softly lit

  return assemble(ctx, id, style, { drive, carpet, lawn, stone, cap, hedge, glow, pools });
}

/* ---------- meshes and materials ---------- */
function colored(list, hex) {
  const c = new THREE.Color(hex);
  return list.map(g => {
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  });
}
function assemble(ctx, id, style, P) {
  const group = new THREE.Group(); group.name = 'compound-' + id;
  const add = (g, m, name, shadow) => { const x = new THREE.Mesh(g, m); x.name = name; x.receiveShadow = true; x.castShadow = !!shadow; group.add(x); return x; };
  const off = n => ({ polygonOffset: true, polygonOffsetFactor: n, polygonOffsetUnits: n });
  add(mergeGeometries(P.lawn), new THREE.MeshStandardMaterial({ map: lawnTex(), roughness: 0.96, ...off(-1) }), id + ':lawn');
  // at night the walls and drive take a soft warm fill from the venue's lamps (no real lights),
  // so they don't read as black slabs beside the lit deck
  const driveMat = new THREE.MeshStandardMaterial({ map: paverTex(style.drive), roughness: 0.82, side: THREE.DoubleSide,   // the bellmouth flare folds a few triangles over
    emissive: style.glow, emissiveIntensity: 0, ...off(-3) });
  driveMat.emissiveMap = driveMat.map;
  add(mergeGeometries(P.drive.map(g => { g.deleteAttribute('normal'); g.computeVertexNormals(); return g; })), driveMat, id + ':drive');
  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, side: THREE.DoubleSide, emissive: style.glow, emissiveIntensity: 0 });
  // the warm fill takes each surface's own colour, so the green hedge doesn't turn beige at night
  wallMat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor.rgb * 1.5;'); };
  add(mergeGeometries([...colored(P.stone, style.stone), ...colored(P.cap, style.cap), ...colored(P.hedge, 0x2f4a22)]), wallMat, id + ':walls', true);
  // the carpet: a woven runner with a darker border, flush on the walk
  const cc = new THREE.Color(style.carpet || 0xf1e7d4); if (!style.carpet) cc.lerp(new THREE.Color(style.glow), 0.12);
  const carpetMat = new THREE.MeshStandardMaterial({ map: carpetTex(), color: cc, roughness: 0.95, emissive: style.glow, emissiveIntensity: 0, ...off(-5) });
  carpetMat.emissiveMap = carpetMat.map;
  add(P.carpet, carpetMat, id + ':carpet');
  const glowMat = new THREE.MeshBasicMaterial({ color: style.glow, toneMapped: false });
  add(mergeGeometries(colored(P.glow, 0xffffff)), glowMat, id + ':glow');
  // light pools: flat additive quads a few cm above the ground
  const q = [];
  for (const p of P.pools) {
    const g = new THREE.PlaneGeometry(p.r * 2, p.r * 2).rotateX(-Math.PI / 2).toNonIndexed();
    const c = at(ctx, p.s, p.l, 0.06).clone(); Q.setFromAxisAngle(UP, ctx.path.sample(p.s).heading);
    q.push(g.applyMatrix4(M4.compose(c, Q, ONE)));
  }
  const poolMat = new THREE.MeshBasicMaterial({ map: glowTex(), color: style.glow, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, ...off(-6) });
  const pm = add(mergeGeometries(q), poolMat, id + ':pools'); pm.renderOrder = 2;
  const base = new THREE.Color(style.glow), dim = new THREE.Color(0x6b665c);
  return {
    group,
    update(d) {
      const on = smoothstep(0.15, 0.8, d);
      glowMat.color.copy(dim).lerp(base, on).multiplyScalar(1 + 1.8 * on);
      poolMat.opacity = 0.32 * on;
      wallMat.emissiveIntensity = 0.16 * on;
      driveMat.emissiveIntensity = 0.1 * on;
      carpetMat.emissiveIntensity = 0.14 * on;
    }
  };
}
