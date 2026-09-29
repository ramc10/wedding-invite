/* A beach venue's compound, the way AMR Unnati's works: a low wall along
 * Beach Road with gate piers where the drive turns in and where it leaves,
 * and a paved driveway that follows the "Take me here" route exactly
 * (core/timeline.js STOP[id].route, the same centripetal curve car/detour.js
 * drives), flared into a bellmouth at the road and widened into a drop-off
 * apron at the stop, kerbed and lined with bollards. The rest of the court
 * (COURTS[id]) is lawn at road level.
 *
 * buildCompound(ctx, id, style) → { group, update(dusk) }
 *   style: { drive: {base, joint, accent} (css colours for the paver texture),
 *            stone: hex (wall, piers, kerbs), cap: hex (coping, pier caps),
 *            glow: hex (LED slits, bollard lamps), seaWall: bool }
 * Draw calls: lawn, drive, stone, glow, pools = 5. No lights. */
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/addons/utils/BufferGeometryUtils.js';
import { COURTS, STOP } from '../../core/timeline.js';
import { smoothstep } from '../../core/noise.js';

const W = 4.2;            // drive width
const WALL = -5.75;       // road-side wall line (lateral)
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
    if (p.z < -3.4) out.push({ s: p.x, l: p.z, ts: t.x, tl: t.z });
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
/** an ellipse of radii (rs, rl) at (s, l), dy above the road: the drop-off apron */
function apron(ctx, s, l, rs, rl, dy) {
  const pos = [], uv = [], idx = [], N = 28;
  const c = at(ctx, s, l, dy); pos.push(c.x, c.y, c.z); uv.push(0, 0);
  for (let i = 0; i <= N; i++) {
    const a = i / N * Math.PI * 2, ss = s + Math.cos(a) * rs, ll = l + Math.sin(a) * rl;
    const p = at(ctx, ss, ll, dy); pos.push(p.x, p.y, p.z); uv.push((ss - s) / 2.4, (ll - l) / 2.4);
    if (i) idx.push(0, i, i + 1);
  }
  return geo(pos, uv, idx);
}
/** a box of size (along s, up, across) at (s, l), bottom at dy above the road, turned with the road */
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
function box(ctx, ds, h, dl, s, l, dy, geom) {
  const g = (geom || new THREE.BoxGeometry(dl, h, ds)).toNonIndexed();
  g.translate(0, h / 2, 0);
  const p = at(ctx, s, l, dy).clone();
  Q.setFromAxisAngle(UP, ctx.path.sample(s).heading);
  return g.applyMatrix4(M4.compose(p, Q, ONE));
}

/* ---------- the compound ---------- */
export function buildCompound(ctx, id, style) {
  const C = COURTS[id], R = STOP[id].route, stop = R.in[R.in.length - 1];
  const inS = samples(R.in), outS = samples(R.out);
  // wider where it meets the road (a bellmouth), so the turn in reads as a proper entrance
  const hw = q => W / 2 + 2.2 * smoothstep(-6.2, -3.6, q.l);
  const drive = [strip(ctx, inS, hw, 0.03, 1 / 2.4, -3.62), strip(ctx, outS, hw, 0.03, 1 / 2.4, -3.62), apron(ctx, stop[0] + 1, stop[1] - 0.6, 5.2, 3.4, 0.031)];

  // lawn over the rest of the court, just under the drive
  const lp = [], lu = [], li = [], ns = Math.ceil((C.s1 - C.s0) / 1.5), nl = Math.ceil((WALL - C.lat[1]) / 1.5);
  for (let i = 0; i <= ns; i++) for (let j = 0; j <= nl; j++) {
    const s = C.s0 + (C.s1 - C.s0) * i / ns, l = WALL - (WALL - C.lat[1]) * j / nl, p = at(ctx, s, l, 0.012);
    lp.push(p.x, p.y, p.z); lu.push(s / 3, l / 3);
    if (i && j) { const a = (i - 1) * (nl + 1) + j - 1, b = i * (nl + 1) + j - 1; li.push(a, b, a + 1, b, b + 1, a + 1); }
  }
  const lawn = geo(lp, lu, li);

  // kerbs: a slim stone edge either side of the drive
  const kerbs = [];
  for (const sm of [inS, outS]) for (const k of [-1, 1]) {
    const edge = sm.map(q => { const h = hw(q) * k; return { s: q.s - q.tl * h, l: q.l + q.ts * h, ts: q.ts, tl: q.tl }; }).filter(q => q.l < WALL + 0.2);
    if (edge.length > 2) kerbs.push(strip(ctx, edge, () => 0.12, 0.07));
  }

  // road-side wall with a gate where the drive comes in and one where it leaves
  const stone = [...kerbs], cap = [], glow = [], pools = [];
  const gates = [crossing(inS, WALL), crossing(outS, WALL)].filter(Boolean)
    .map(g => ({ s: g.s, half: (W / 2 + 0.9) / Math.max(0.35, Math.abs(g.tl)) * Math.hypot(g.ts, g.tl) }));
  const runs = []; let a = C.s0;
  for (const g of gates.sort((x, y) => x.s - y.s)) { runs.push([a, g.s - g.half]); a = g.s + g.half; }
  runs.push([a, C.s1]);
  const wallAlong = (s0, s1, l) => {
    for (let s = s0; s < s1 - 0.05; s += 2) {
      const d = Math.min(2, s1 - s), m = s + d / 2;
      stone.push(box(ctx, d + 0.02, WALL_H, 0.32, m, l, 0));
      cap.push(box(ctx, d + 0.02, 0.07, 0.42, m, l, WALL_H));          // coping
    }
  };
  for (const [s0, s1] of runs) if (s1 - s0 > 0.5) wallAlong(s0, s1, WALL);
  if (style.seaWall) wallAlong(C.s0, C.s1, C.lat[1] + 0.2);
  // return wall across the court's near end
  for (let l = WALL - 1; l > C.lat[1]; l -= 2) stone.push(box(ctx, 0.32, WALL_H, 2.02, C.s0 + 0.16, l, 0));

  // gate piers: stone, a warm LED slit facing the road, a dark cap; a light pool either side
  for (const g of gates) for (const k of [-1, 1]) {
    const s = g.s + k * (g.half + 0.35);
    stone.push(box(ctx, 0.7, 2.3, 0.7, s, WALL, 0));
    cap.push(box(ctx, 0.84, 0.1, 0.84, s, WALL, 2.3));
    glow.push(box(ctx, 0.06, 1.5, 0.02, s, WALL + 0.36, 0.45));
    pools.push({ s, l: WALL + 1.1, r: 1.7 }, { s, l: WALL - 1.1, r: 1.6 });
  }
  // bollards along both edges of the drive, every ~4.5 m, off the lane
  for (const sm of [inS, outS]) {
    let run = 0;
    sm.forEach((q, i) => {
      if (i) run += Math.hypot(q.s - sm[i - 1].s, q.l - sm[i - 1].l);
      if (q.l > WALL - 1.2 || run < 4.5) return;
      run = 0;
      for (const k of [-1, 1]) {
        const h = hw(q) + 0.55, s = q.s - q.tl * h * k, l = q.l + q.ts * h * k;
        if (l > WALL - 0.8 || l < C.lat[1] + 0.6 || s < C.s0 + 0.6 || s > C.s1 - 0.6) continue;
        stone.push(box(ctx, 0.2, 0.75, 0.2, s, l, 0));
        glow.push(box(ctx, 0.21, 0.08, 0.21, s, l, 0.6));
        pools.push({ s, l, r: 1.5 });
      }
    });
  }
  pools.push({ s: stop[0] + 1, l: stop[1] - 0.6, r: 5 });   // the drop-off, softly lit

  return assemble(ctx, id, style, { drive, lawn, stone, cap, glow, pools });
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
  add(P.lawn, new THREE.MeshStandardMaterial({ map: lawnTex(), roughness: 0.96, ...off(-1) }), id + ':lawn');
  // at night the walls and drive take a soft warm fill from the venue's lamps (no real lights),
  // so they don't read as black slabs beside the lit deck
  const driveMat = new THREE.MeshStandardMaterial({ map: paverTex(style.drive), roughness: 0.82, emissive: style.glow, emissiveIntensity: 0, ...off(-3) });
  driveMat.emissiveMap = driveMat.map;
  add(mergeGeometries(P.drive.map(g => { g.deleteAttribute('normal'); g.computeVertexNormals(); return g; })), driveMat, id + ':drive');
  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, emissive: style.glow, emissiveIntensity: 0 });
  add(mergeGeometries([...colored(P.stone, style.stone), ...colored(P.cap, style.cap)]), wallMat, id + ':walls', true);
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
    }
  };
}
