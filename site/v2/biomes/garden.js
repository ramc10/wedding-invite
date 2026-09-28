/* Zone 'garden' (s 292–597): a formal Lalbagh-style garden either side of the road.
 *
 * Objects (lateral = metres from road centre, mirrored both sides unless noted):
 *   1. kerb       granite kerb stones at |lat| 6.0, 1.2 m blocks, one instanced mesh
 *   2. paths      laterite-gravel promenade |lat| 6.3–7.9 plus cross paths to the beds,
 *                 ribbon meshes that follow the ground (one merged mesh)
 *   3. hedges     clipped box hedges |lat| 8.1–9.0 swept along the road with rounded
 *                 profile + rounded ends, leafy bump texture, gaps at the cross paths
 *   4. topiary    clipped balls on the hedge ends flanking each cross path
 *   5. beds       rounded-rect flower beds (granite edging + laterite soil + foliage
 *                 mound), two rows |lat| 11–14 and 16.5–19.5, species alternating
 *   6. marigolds  instanced ruffled marigold heads (orange/yellow) on marigold beds
 *   7. roses      instanced cupped rose heads (red/pink/white) on rose beds
 *   8. bougain.   bougainvillea mounds (magenta bracts) at hedge gaps
 *   9. lamps      black cast-iron heritage lamp posts along the promenade + lantern glass
 *  10. benches    granite-legged teak benches in the hedge line, facing the road
 *  11. fountain   tiered stone fountain in a gravel circle (right side), water + jets
 *  12. arches     two wedding gates over the road: timber posts + beam + arched batten,
 *                 curtains of marigold strands (individual heads), swags, mango-leaf
 *                 toran, banana plants lashed to both posts
 *  13. trees      flowering-tree avenue (blossom / gold) behind the beds, orchard, shrubs
 *                 (flora kit)
 * Draw calls ≈ 21.
 */
import * as THREE from 'three';
import { plant } from './flora.js';
import { tierK } from './garden-beach.js';
import { fbm } from '../core/noise.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

function lcg(seed) {
  let a = seed >>> 0;
  return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvasTex(W, H, draw, { srgb = true, repeat = true } = {}) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  draw(c.getContext('2d'), W, H);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Dense small-leaf foliage (box / Murraya hedge). Returns {map, bump}. */
function leafTextures(base, seed, dots = null) {
  const R = lcg(seed);
  const leaves = [];
  for (let i = 0; i < 2600; i++) leaves.push([R() * 256, R() * 256, R() * 6.28, 2.5 + R() * 3.5, R()]);
  const flowers = [];
  if (dots) for (let i = 0; i < dots.n; i++) flowers.push([R() * 256, R() * 256, R(), dots.cols[Math.floor(R() * dots.cols.length)]]);
  const paint = (g, bump) => {
    g.fillStyle = bump ? '#202020' : '#1c2e14'; g.fillRect(0, 0, 256, 256);
    for (const [x, y, a, r, k] of leaves) {
      for (const [ox, oy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) {
        if (x + ox < -8 || x + ox > 264 || y + oy < -8 || y + oy > 264) continue;
        g.save(); g.translate(x + ox, y + oy); g.rotate(a);
        if (bump) g.fillStyle = `rgb(${90 + k * 160 | 0},${90 + k * 160 | 0},${90 + k * 160 | 0})`;
        else { const c = new THREE.Color(base).offsetHSL((k - 0.5) * 0.04, (k - 0.5) * 0.15, (k - 0.45) * 0.16); g.fillStyle = '#' + c.getHexString(); }
        g.beginPath(); g.ellipse(0, 0, r, r * 0.5, 0, 0, 7); g.fill();
        if (!bump) { g.strokeStyle = 'rgba(255,255,240,0.12)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(-r, 0); g.lineTo(r, 0); g.stroke(); }
        g.restore();
      }
    }
    for (const [x, y, k, col] of flowers) {
      const r = 2.2 + k * 2.4;
      g.fillStyle = bump ? '#ffffff' : col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      if (!bump) { g.fillStyle = 'rgba(255,255,255,0.28)'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, 7); g.fill(); }
    }
  };
  return {
    map: canvasTex(256, 256, g => paint(g, false)),
    bump: canvasTex(256, 256, g => paint(g, true), { srgb: false })
  };
}

/** Laterite gravel: rust-red grit with pale quartz chips. */
function gravelTextures() {
  const R = lcg(91);
  const chips = [];
  for (let i = 0; i < 5200; i++) chips.push([R() * 256, R() * 256, 0.8 + R() * 2.2, R()]);
  const paint = (g, bump) => {
    g.fillStyle = bump ? '#606060' : '#9a5a3a'; g.fillRect(0, 0, 256, 256);
    for (const [x, y, r, k] of chips) {
      if (bump) { const v = 70 + k * 180 | 0; g.fillStyle = `rgb(${v},${v},${v})`; }
      else g.fillStyle = k < 0.12 ? '#d8cbb4' : k < 0.2 ? '#5a3424' : `hsl(${16 + k * 10},${38 + k * 18}%,${30 + k * 22}%)`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  };
  return { map: canvasTex(256, 256, g => paint(g, false)), bump: canvasTex(256, 256, g => paint(g, true), { srgb: false }) };
}

/** Granite / sandstone speckle, used as a multiply map on vertex-coloured stone. */
function stoneTexture(seed = 5) {
  const R = lcg(seed);
  return canvasTex(128, 128, g => {
    g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1800; i++) {
      const v = 150 + R() * 105 | 0;
      g.fillStyle = R() < 0.1 ? '#6a6a6a' : `rgb(${v},${v},${v - 6})`;
      g.fillRect(R() * 128, R() * 128, 1 + R() * 2, 1 + R() * 2);
    }
  });
}

/** Road-frame at (s, lateral): x = +lateral dir, y = up, z = backward along the road. Ground height at y. */
function roadFrame(ctx, s, lat, yaw = 0, scale = 1, y = null) {
  const smp = ctx.path.sample(s);
  ctx.path.toWorld(s, lat, _v);
  _v.y = y ?? ctx.world.heightSL(s, lat);
  const m = new THREE.Matrix4().makeBasis(smp.right, UP, _w.crossVectors(smp.right, UP));
  if (yaw) m.multiply(new THREE.Matrix4().makeRotationY(yaw));
  m.scale(new THREE.Vector3(scale, scale, scale));
  m.setPosition(_v);
  return m;
}

/* ---------- sweep: a 2D cross-section extruded along the road, hugging the ground ---------- */
class Builder {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.idx = []; }
  get n() { return this.pos.length / 3; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * prof: [[dx, dy], ...] open polyline across the road-normal plane (dx lateral, dy up).
 * opts: ds step, uvScale, ground 'min'|'centre', sink, bump(s, i) → radial offset,
 *       cap radius (rounded ends), centre [cx, cy] for bump/cap scaling, color fn.
 */
function sweep(ctx, B, sA, sB, lat, prof, o = {}) {
  const { path, world } = ctx;
  const ds = o.ds ?? 0.5, cap = o.cap ?? 0, sink = o.sink ?? 0.05, uvS = o.uvScale ?? 1;
  const [cx, cy] = o.centre ?? [0, 0];
  const L = sB - sA;
  if (L <= 0.2) return;
  // ring stations: dense near rounded ends
  const st = [];
  if (cap) for (const f of [0, 0.08, 0.25, 0.5, 0.8]) st.push([f * cap, Math.sqrt(1 - (1 - f) * (1 - f))]);
  for (let d = cap || 0; d <= L - (cap || 0) + 1e-6; d += Math.min(ds, Math.max(0.05, L - 2 * cap))) st.push([d, 1]);
  if (cap) for (const f of [0.8, 0.5, 0.25, 0.08, 0]) st.push([L - f * cap, Math.sqrt(1 - (1 - f) * (1 - f))]);
  const w0 = prof[0][0], w1 = prof[prof.length - 1][0];
  const first = B.n, P = prof.length;
  let acc = [0];
  for (let i = 1; i < P; i++) acc.push(acc[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
  for (const [d, f] of st) {
    const s = sA + d;
    let gy;
    if (o.ground === 'centre') gy = world.heightSL(s, lat);
    else gy = Math.min(world.heightSL(s, lat + w0), world.heightSL(s, lat + w1), world.heightSL(s, lat + (w0 + w1) / 2));
    gy -= sink;
    for (let i = 0; i < P; i++) {
      let [dx, dy] = prof[i];
      dx = cx + (dx - cx) * f; dy = o.keepBase ? dy * (0.35 + 0.65 * f) : cy + (dy - cy) * f;
      if (o.bump) { const r = o.bump(s, i, dx, dy); const a = Math.atan2(dy - cy * 0.8, dx - cx); dx += Math.cos(a) * r; dy += Math.sin(a) * r; }
      const gl = o.ground === 'follow' ? world.heightSL(s, lat + dx) - sink : gy;
      path.toWorld(s, lat + dx, _v);
      B.pos.push(_v.x, gl + dy, _v.z);
      B.uv.push(acc[i] * uvS, s * uvS);
      if (o.color) { const c = o.color(s, i); B.col.push(c.r, c.g, c.b); }
    }
  }
  const N = st.length;
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < P - 1; i++) {
    const a = first + j * P + i, b = a + P;
    if (o.flip) B.idx.push(a, b, a + 1, b, b + 1, a + 1); else B.idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
}

/** Rounded clipped-hedge cross section: w wide, h tall, slightly battered sides. */
function hedgeProfile(w, h, r = 0.22) {
  const p = [[-w / 2 + 0.04, -0.02]];
  const arc = (cx, cy, a0, a1) => { for (let k = 0; k <= 4; k++) { const a = a0 + (a1 - a0) * k / 4; p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  arc(-w / 2 + r, h - r, Math.PI, Math.PI / 2);
  arc(w / 2 - r, h - r, Math.PI / 2, 0);
  p.push([w / 2 - 0.04, -0.02]);
  return p;
}

/* ---------- layout ---------- */
const KERB = 5.95, PROM = [6.15, 7.9], HEDGE = 8.5, BACK = 22.3;
const ROWS = [[10.6, 13.6], [16.2, 19.2]];     // bed rows (|lateral| inner, outer)
const MOD = 32, GAP = 2.4;                       // cross-path module + path width

function layout(s0, s1, arches, fountainS) {
  const cross = [];
  for (let s = s0 + 14; s < s1 - 10; s += MOD) cross.push(s);
  const gaps = cross.map(s => [s - GAP / 2, s + GAP / 2]).concat(arches.map(s => [s - 1.4, s + 1.4]));
  gaps.sort((a, b) => a[0] - b[0]);
  const runs = [];                                // hedge runs between gaps
  let a = s0 + 2;
  for (const [g0, g1] of gaps) { if (g0 - 0.6 - a > 1.5) runs.push([a, g0 - 0.6]); a = Math.max(a, g1 + 0.6); }
  if (s1 - 2 - a > 1.5) runs.push([a, s1 - 2]);
  const beds = [];                                // {s, sg, row, len, kind}
  let k = 0;
  for (let i = 0; i < cross.length; i++) {
    const cA = cross[i], cB = cross[i + 1] ?? Math.min(s1 - 4, cA + MOD);
    const mid = (cA + cB) / 2, span = cB - cA - GAP - 2;
    if (span < 6) continue;
    for (const sg of [-1, 1]) for (let row = 0; row < 2; row++) {
      if (sg > 0 && Math.abs(mid - fountainS) < MOD * 0.6) continue;  // fountain plaza
      const n = span > 20 ? 2 : 1, len = (span - (n - 1) * 1.8) / n;
      for (let j = 0; j < n; j++) {
        const s = cA + GAP / 2 + 1 + len / 2 + j * (len + 1.8);
        beds.push({ s, sg, row, len, kind: ['marigold', 'salvia', 'marigold', 'rose'][(k++ + row * 3) % 4] });
      }
    }
  }
  return { cross, runs, beds };
}

function gardenGround(ctx, L, s0, s1, fountainS, group) {
  const gv = gravelTextures();
  const B = new Builder();
  const flat = (w0, w1, n) => { const p = []; for (let i = 0; i <= n; i++) p.push([w0 + (w1 - w0) * i / n, 0.035]); return p; };
  for (const sg of [-1, 1]) {
    const w0 = sg < 0 ? -PROM[1] : PROM[0], w1 = sg < 0 ? -PROM[0] : PROM[1];
    sweep(ctx, B, s0 - 4, s1 + 4, 0, flat(w0, w1, 4), { ds: 1, ground: 'follow', sink: 0, uvScale: 0.5 });
    // back walk behind the beds
    const b0 = sg * 20.4, b1 = sg * 21.6;
    sweep(ctx, B, s0 + 2, s1 - 2, 0, flat(Math.min(b0, b1), Math.max(b0, b1), 2), { ds: 1.5, ground: 'follow', sink: 0, uvScale: 0.5 });
    for (const c of L.cross) {
      const a = sg < 0 ? -21.6 : 7.8, b = sg < 0 ? -7.8 : 21.6;
      sweep(ctx, B, c - GAP / 2, c + GAP / 2, 0, flat(a, b, 14), { ds: GAP / 3, ground: 'follow', sink: -0.005, uvScale: 0.5 });
    }
  }
  // fountain plaza: gravel disc
  const { path, world } = ctx, first = B.n, RS = 18, RR = 6;
  const fc = path.toWorld(fountainS, 15, new THREE.Vector3());
  const smp = path.sample(fountainS);
  for (let r = 0; r <= RR; r++) for (let a = 0; a < RS; a++) {
    const rad = r === 0 ? 0 : 1.4 + (r / RR) * 5.4, th = a / RS * Math.PI * 2;
    const x = fc.x + (smp.right.x * Math.cos(th) + smp.fwd.x * Math.sin(th)) * rad;
    const z = fc.z + (smp.right.z * Math.cos(th) + smp.fwd.z * Math.sin(th)) * rad;
    B.pos.push(x, world.heightAt(x, z) + 0.045, z); B.uv.push(x * 0.5, z * 0.5);
  }
  for (let r = 0; r < RR; r++) for (let a = 0; a < RS; a++) {
    const i0 = first + r * RS + a, i1 = first + r * RS + (a + 1) % RS;
    B.idx.push(i0, i1 + RS, i0 + RS, i0, i1, i1 + RS);
  }
  const mesh = new THREE.Mesh(B.geometry(), new THREE.MeshStandardMaterial({ map: gv.map, bumpMap: gv.bump, bumpScale: 1.2, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  mesh.name = 'gravel-paths'; mesh.receiveShadow = true;
  group.add(mesh);

  // granite kerb blocks along the road edge
  const box = new THREE.BoxGeometry(0.24, 1, 0.98);
  const kerbM = [];
  for (let s = s0 - 2; s < s1 + 2; s += 1.0) for (const sg of [-1, 1]) {
    const lat = sg * KERB, top = path.roadY(s) + 0.02, bot = world.heightSL(s, lat) - 0.12;
    const m = roadFrame(ctx, s + 0.5, lat, 0, 1, (top + bot) / 2);
    m.scale(new THREE.Vector3(1, top - bot, 1));
    kerbM.push(m);
  }
  const kerb = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ map: stoneTexture(3), color: 0xb9b2a6, roughness: 0.85 }), kerbM.length);
  kerbM.forEach((m, i) => kerb.setMatrixAt(i, m));
  kerb.name = 'kerb'; kerb.receiveShadow = true; kerb.computeBoundingSphere();
  group.add(kerb);
}

/* ---------- clipped hedges, topiary balls, bougainvillea ---------- */
function blobGeometry(detail, seed, amp = 0.12) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    const n = fbm(_v.x * 2.3 + seed, _v.y * 2.3 + _v.z * 1.7, 3);
    _v.multiplyScalar(1 + amp * n);
    if (_v.y < -0.55) _v.y = -0.55 - (_v.y + 0.55) * 0.3;   // flattened base sits on the ground
    p.setXYZ(i, _v.x, _v.y, _v.z);
  }
  // spherical UVs (seam is hidden by the noise-busy texture)
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i).normalize(); uv[i * 2] = Math.atan2(_v.z, _v.x) / Math.PI * 1.5 + 1.5; uv[i * 2 + 1] = _v.y * 1.2; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function hedges(ctx, L, s0, s1, group, K) {
  const lt = leafTextures(0x3d6a28, 17);
  const mat = new THREE.MeshStandardMaterial({ map: lt.map, bumpMap: lt.bump, bumpScale: 2.5, roughness: 0.92, vertexColors: true });
  const B = new Builder();
  const bump = (s, i, dx, dy) => 0.035 * fbm(s * 1.3, dy * 3 + dx * 2, 2);
  const tint = (s, i) => new THREE.Color(0xffffff).multiplyScalar(0.92 + 0.12 * fbm(s * 0.08, 3, 2)).offsetHSL(0.01 * fbm(s * 0.05, 9, 2), 0, 0);
  for (const sg of [-1, 1]) {
    for (const [a, b] of L.runs) sweep(ctx, B, a, b, sg * HEDGE, hedgeProfile(0.85, 0.82), { ds: 0.45, cap: 0.32, centre: [0, 0.35], keepBase: true, bump, color: tint, uvScale: 0.9, sink: 0.08 });
    // taller back hedge framing the parterre
    for (let i = 0; i < L.cross.length; i++) {
      const a = (L.cross[i - 1] ?? s0) + (i ? GAP / 2 + 0.5 : 2), b = L.cross[i] - GAP / 2 - 0.5;
      if (b - a > 2) sweep(ctx, B, a, b, sg * BACK, hedgeProfile(1.0, 1.35, 0.28), { ds: 0.6, cap: 0.35, centre: [0, 0.6], keepBase: true, bump, color: tint, uvScale: 0.9, sink: 0.1 });
    }
    const last = L.cross[L.cross.length - 1] + GAP / 2 + 0.5;
    if (s1 - 2 - last > 2) sweep(ctx, B, last, s1 - 2, sg * BACK, hedgeProfile(1.0, 1.35, 0.28), { ds: 0.6, cap: 0.35, centre: [0, 0.6], keepBase: true, bump, color: tint, uvScale: 0.9, sink: 0.1 });
  }
  const hm = new THREE.Mesh(B.geometry(), mat);
  hm.name = 'hedges'; hm.castShadow = hm.receiveShadow = true;
  group.add(hm);

  // topiary balls on low plinths flanking each cross path, both hedge lines
  const topM = [];
  for (const c of L.cross) for (const sg of [-1, 1]) for (const e of [-1, 1]) {
    topM.push(roadFrame(ctx, c + e * (GAP / 2 + 0.25), sg * HEDGE, 0, 0.62).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)));
  }
  // no vertexColors here: blobGeometry has no colour attribute (it read as (0,0,0) = black balls)
  const topMat = new THREE.MeshStandardMaterial({ map: lt.map, bumpMap: lt.bump, bumpScale: 2.5, roughness: 0.9 });
  const tg = blobGeometry(3, 4, 0.05);
  tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(tg.attributes.position.count * 3).fill(1), 3));
  const top = new THREE.InstancedMesh(tg, topMat, topM.length);
  const tR = ctx.rng('g-topi');
  topM.forEach((m, i) => { top.setMatrixAt(i, m); top.setColorAt(i, new THREE.Color(0xffffff).multiplyScalar(0.95 + tR() * 0.15).offsetHSL((tR() - 0.5) * 0.02, 0, 0)); });
  top.name = 'topiary'; top.castShadow = true; top.computeBoundingSphere();
  group.add(top);

  // bougainvillea mounds at the back-hedge gaps and along the back walk
  const bt = leafTextures(0x355e24, 29, { n: 1500, cols: ['#d0217a', '#e0348e', '#b8166a', '#f05aa8', '#c21d6e'] });
  const bm = new THREE.MeshStandardMaterial({ map: bt.map, bumpMap: bt.bump, bumpScale: 3, roughness: 0.85 });
  const R = ctx.rng('g-bougain'), bgM = [];
  for (const c of L.cross) for (const sg of [-1, 1]) for (const e of [-1, 1]) {
    const m = roadFrame(ctx, c + e * (GAP / 2 + 1.3), sg * (BACK + 0.2), R() * 6, 1);
    bgM.push(m.scale(new THREE.Vector3(1.3 + R() * 0.3, 1.2 + R() * 0.5, 1.3 + R() * 0.3)).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)));
  }
  const bg = new THREE.InstancedMesh(blobGeometry(3, 9, 0.22), bm, bgM.length);
  bgM.forEach((m, i) => bg.setMatrixAt(i, m));
  bg.name = 'bougainvillea'; bg.castShadow = true; bg.computeBoundingSphere();
  group.add(bg);
}

/* ---------- flower beds: granite edging, laterite soil, foliage mound, flower heads ---------- */
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function rrect(hw, hl, rc, n = 6) {        // rounded-rect loop in local (x, z), CCW
  const p = [];
  for (const [cx, cz, a0] of [[hw - rc, hl - rc, 0], [-hw + rc, hl - rc, Math.PI / 2], [-hw + rc, -hl + rc, Math.PI], [hw - rc, -hl + rc, Math.PI * 1.5]])
    for (let k = 0; k <= n; k++) { const a = a0 + k / n * Math.PI / 2; p.push([cx + Math.cos(a) * rc, cz + Math.sin(a) * rc, Math.cos(a), Math.sin(a)]); }
  return p;
}

function beds(ctx, L, group, K) {
  const { path, world } = ctx;
  const frame = new Builder(), fol = { marigold: new Builder(), rose: new Builder(), salvia: new Builder() };
  const heads = { marigold: [], rose: [], salvia: [] };
  const R = ctx.rng('g-beds');
  const stoneC = new THREE.Color(0xcfc8bb), soilC = new THREE.Color(0x7a4630), soilD = new THREE.Color(0x5a3222);
  const smp = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3() };
  for (const bd of L.beds) {
    const [li, lo] = ROWS[bd.row];
    const hw = (lo - li) / 2, hl = bd.len / 2, rc = 0.9;
    path.sample(bd.s, smp);
    const C = path.toWorld(bd.s, bd.sg * (li + hw), new THREE.Vector3());
    const W = (x, z, out) => out.set(C.x + smp.right.x * x + smp.fwd.x * z, 0, C.z + smp.right.z * x + smp.fwd.z * z);
    const gAt = (x, z) => { W(x, z, _w); return world.heightAt(_w.x, _w.z); };
    // edging stones + soil ring as one ring strip: outer-bottom, outer-top, inner-top, soil
    const loop = rrect(hw, hl, rc), base = frame.n;
    const prof = [[0.1, -0.12, stoneC], [0.1, 0.14, stoneC], [-0.06, 0.15, stoneC], [-0.08, 0.07, soilD], [-0.5, 0.09, soilC]];
    for (const [x, z, nx, nz] of loop) {
      const g = gAt(x, z);
      for (const [o, dy, c] of prof) {
        W(x + nx * o, z + nz * o, _v);
        frame.pos.push(_v.x, g + dy, _v.z); frame.uv.push((x + z) * 1.5, dy * 2 + o * 2);
        const k = 0.88 + 0.2 * R(); frame.col.push(c.r * k, c.g * k, c.b * k);
      }
    }
    const P = prof.length, N = loop.length;
    for (let j = 0; j < N; j++) for (let i = 0; i < P - 1; i++) {
      const a = base + j * P + i, b = base + ((j + 1) % N) * P + i;
      frame.idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    // foliage mound grid
    const B = fol[bd.kind], f0 = B.n, NX = 8, NZ = Math.max(6, Math.round(bd.len * 1.4));
    const ihw = hw - 0.42, ihl = hl - 0.42, irc = rc - 0.42;
    const pts = [];
    for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
      let x = (i / NX * 2 - 1) * ihw, z = (j / NZ * 2 - 1) * ihl;
      const cx = ihw - irc, cz = ihl - irc;
      if (Math.abs(x) > cx && Math.abs(z) > cz) {
        const dx = Math.abs(x) - cx, dz = Math.abs(z) - cz, d = Math.hypot(dx, dz);
        if (d > irc) { x = Math.sign(x) * (cx + dx / d * irc); z = Math.sign(z) * (cz + dz / d * irc); }
      }
      const e = Math.min(ihw - Math.abs(x), ihl - Math.abs(z));
      const y = gAt(x, z) + 0.05 + (bd.kind === 'rose' ? 0.42 : 0.26) * smooth(0, 0.8, e) + 0.04 * fbm(x * 1.7 + bd.s, z * 1.7, 2);
      W(x, z, _v); B.pos.push(_v.x, y, _v.z); B.uv.push(x * 0.45, (z + bd.s) * 0.45);
      pts.push([x, z, y]);
    }
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const a = f0 + j * (NX + 1) + i, b = a + NX + 1;
      B.idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    // flower heads on the mound
    // massed planting: heads almost touching, hex-offset rows (Lalbagh carpet beds)
    const sp = { rose: 0.24, salvia: 0.11, marigold: 0.14 }[bd.kind] / Math.sqrt(K);
    let rowI = 0;
    for (let z = -ihl + 0.08; z < ihl - 0.06; z += sp * 0.87, rowI++) for (let x = -ihw + 0.08 + (rowI & 1) * sp * 0.5; x < ihw - 0.06; x += sp) {
      const jx = x + (R() - 0.5) * sp * 0.5, jz = z + (R() - 0.5) * sp * 0.5;
      const e = Math.min(ihw - Math.abs(jx), ihl - Math.abs(jz));
      if (e < 0.05) continue;
      const cx = ihw - irc, cz = ihl - irc;
      if (Math.abs(jx) > cx && Math.abs(jz) > cz && Math.hypot(Math.abs(jx) - cx, Math.abs(jz) - cz) > irc - 0.05) continue;
      const y = gAt(jx, jz) + 0.05 + (bd.kind === 'rose' ? 0.42 : 0.26) * smooth(0, 0.8, e) + 0.04 * fbm(jx * 1.7 + bd.s, jz * 1.7, 2);
      W(jx, jz, _v); _v.y = y + (bd.kind === 'rose' ? 0.06 + R() * 0.12 : bd.kind === 'salvia' ? 0.02 + R() * 0.06 : 0.02 + R() * 0.04);
      heads[bd.kind].push([_v.clone(), R(), R(), R(), e]);
    }
  }
  const fm = new THREE.Mesh(frame.geometry(), new THREE.MeshStandardMaterial({ map: stoneTexture(8), vertexColors: true, roughness: 0.9 }));
  fm.name = 'bed-edging'; fm.receiveShadow = fm.castShadow = true;
  group.add(fm);
  const tex = {
    marigold: leafTextures(0x3f6e2a, 41, { n: 1400, cols: ['#f28c12', '#ffb300', '#e86a10', '#ffc93a'] }),
    rose: leafTextures(0x2c4f22, 43, { n: 700, cols: ['#b3122e', '#d8325a', '#f3c2cc', '#8e0c22'] }),
    salvia: leafTextures(0x2f5a24, 47, { n: 3200, cols: ['#c8141c', '#e0262a', '#a80e18', '#d83a2e'] })
  };
  tex.marigold = leafTextures(0x3f6e2a, 41, { n: 3600, cols: ['#f28c12', '#ffb300', '#e86a10', '#ffc93a'] });
  for (const k of ['marigold', 'rose', 'salvia']) {
    if (!fol[k].n) continue;
    const m = new THREE.Mesh(fol[k].geometry(), new THREE.MeshStandardMaterial({ map: tex[k].map, bumpMap: tex[k].bump, bumpScale: 3, roughness: 0.88 }));
    m.name = 'bed-' + k + '-foliage'; m.receiveShadow = m.castShadow = true;
    group.add(m);
  }
  return heads;
}

/* ---------- flower heads ---------- */
function salviaGeometry() {                   // scarlet sage: a tapering 16 cm raceme of bracts + 2 leaves
  const p = [];
  for (let i = 0; i < 4; i++) {
    const y = 0.03 + i * 0.03, r = 0.034 - i * 0.006;
    p.push(new THREE.ConeGeometry(r, 0.055, 5, 1, true).rotateY(i * 0.8).translate(0, y, 0));
  }
  const g = new THREE.BufferGeometry();
  const all = p.map(x => x.toNonIndexed());
  let n = 0; for (const x of all) n += x.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3).fill(1); let o = 0;
  for (const x of all) { pos.set(x.attributes.position.array, o); o += x.attributes.position.array.length; }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

let _petalTex = null;
function petalTex() {                         // ruffled petal frills, white-ish (instance colour tints)
  if (_petalTex) return _petalTex;
  const R = lcg(77);
  _petalTex = canvasTex(64, 64, g => {
    g.fillStyle = '#e8e0d8'; g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 260; i++) {
      const v = 170 + R() * 85 | 0;
      g.strokeStyle = `rgb(${v},${v * 0.97 | 0},${v * 0.9 | 0})`; g.lineWidth = 1 + R() * 1.5;
      const x = R() * 64, y = R() * 64;
      g.beginPath(); g.arc(x, y, 2 + R() * 3, R() * 6, R() * 6 + 2.5); g.stroke();
    }
  });
  return _petalTex;
}

function marigoldGeometry(detail = 1) {       // ruffled pom-pom, ~7 cm across
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    const r = 1 + 0.16 * Math.sin(_v.x * 9 + _v.z * 7) * Math.cos(_v.y * 8 + _v.x * 3);
    _v.multiplyScalar(r); _v.y *= 0.78;
    p.setXYZ(i, _v.x, _v.y, _v.z);
    const k = 0.62 + 0.38 * smooth(-0.8, 0.6, _v.y);
    col.set([k, k * 0.96, k * 0.9], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function roseGeometry() {                     // cupped bloom on a short green calyx
  const pts = [[0.0, -0.5], [0.45, -0.45], [0.85, -0.1], [1.0, 0.35], [0.75, 0.55], [0.4, 0.42], [0.0, 0.62]].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 7);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    const a = Math.atan2(_v.z, _v.x);
    const wob = 1 + 0.12 * Math.sin(a * 5 + _v.y * 6);
    p.setXYZ(i, _v.x * wob, _v.y, _v.z * wob);
    const k = _v.y < -0.35 ? 0.35 : 0.7 + 0.3 * smooth(-0.3, 0.5, _v.y);
    if (_v.y < -0.35) col.set([0.25, 0.55, 0.2], i * 3); else col.set([k, k, k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function flowerHeads(ctx, heads, group) {
  const specs = {
    marigold: { geo: marigoldGeometry(), r: [0.035, 0.05], cols: [0xff8c0a, 0xffa412, 0xffc21a, 0xf06a0c, 0xffb000] },
    rose: { geo: roseGeometry(), r: [0.05, 0.065], cols: [0xc0102c, 0xd81e3e, 0xa00c24, 0xf06a8a, 0xf6d6dc, 0xe03050] },
    salvia: { geo: salviaGeometry(), r: [0.9, 1.15], cols: [0xd0141a, 0xe0221e, 0xb80e16, 0xe83424] }
  };
  specs.marigold.geo = marigoldGeometry(0); specs.marigold.r = [0.05, 0.068];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
  for (const k of ['marigold', 'rose', 'salvia']) {
    const H = heads[k], S = specs[k];
    if (!H.length) continue;
    const im = new THREE.InstancedMesh(S.geo, new THREE.MeshStandardMaterial({ map: petalTex(), vertexColors: true, roughness: 0.75 }), H.length);
    H.forEach(([p, a, b, d, edge], i) => {
      const r = S.r[0] + (S.r[1] - S.r[0]) * a;
      q.setFromEuler(e.set((b - 0.5) * 0.6, d * 6.28, (a - 0.5) * 0.6));
      im.setMatrixAt(i, m.compose(p, q, sc.setScalar(r)));
      if (k === 'marigold') c.setHex(edge < 0.32 ? (b < 0.5 ? 0xe8580a : 0xf06a0c) : edge < 0.62 ? 0xff8c0a : (b < 0.6 ? 0xffb300 : 0xffc21a));   // banded border -> gold centre
      else c.setHex(S.cols[Math.floor(b * S.cols.length) % S.cols.length]);
      im.setColorAt(i, c.multiplyScalar(0.88 + d * 0.22));
    });
    im.name = k + '-heads'; im.castShadow = false; im.computeBoundingSphere();
    group.add(im);
  }
}

/* ---------- vertex-coloured kit helpers ---------- */
function vc(geo, hex, jitter = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.computeVertexNormals();
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 3) {
    const k = 1 + (jitter ? (Math.sin(i * 12.9898) * 43758.5453 % 1) * jitter : 0);
    for (let j = 0; j < 3 && i + j < n; j++) a.set([c.r * k, c.g * k, c.b * k], (i + j) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function mergeVC(list) {
  const out = new THREE.BufferGeometry();
  for (const [name, k] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]]) {
    let n = 0; for (const g of list) n += g.attributes[name].array.length;
    const a = new Float32Array(n); let o = 0;
    for (const g of list) { a.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(a, k));
  }
  out.computeBoundingSphere();
  return out;
}
const T = (g, x, y, z) => g.translate(x, y, z);

/* ---------- heritage lamp posts, benches ---------- */
function lampGeometry() {
  const iron = 0x1d2124, p = [];
  p.push(vc(T(new THREE.BoxGeometry(0.42, 0.3, 0.42), 0, 0.1, 0), 0xa8a296));                    // granite plinth
  p.push(vc(T(new THREE.CylinderGeometry(0.1, 0.17, 0.55, 8), 0, 0.52, 0), iron));
  p.push(vc(T(new THREE.TorusGeometry(0.12, 0.025, 5, 10).rotateX(Math.PI / 2), 0, 0.8, 0), iron));
  p.push(vc(T(new THREE.CylinderGeometry(0.045, 0.06, 2.3, 8), 0, 1.95, 0), iron));             // shaft
  p.push(vc(T(new THREE.TorusGeometry(0.07, 0.02, 5, 10).rotateX(Math.PI / 2), 0, 2.4, 0), iron));
  p.push(vc(T(new THREE.CylinderGeometry(0.09, 0.05, 0.14, 8), 0, 3.12, 0), iron));             // lantern seat
  for (const [x, z] of [[0.13, 0.13], [-0.13, 0.13], [0.13, -0.13], [-0.13, -0.13]])
    p.push(vc(T(new THREE.BoxGeometry(0.025, 0.46, 0.025), x * 1.1, 3.43, z * 1.1), iron));      // lantern frame
  p.push(vc(T(new THREE.ConeGeometry(0.27, 0.22, 4).rotateY(Math.PI / 4), 0, 3.77, 0), iron));  // hood
  p.push(vc(T(new THREE.SphereGeometry(0.045, 6, 4), 0, 3.92, 0), iron));
  return mergeVC(p);
}

function benchGeometry() {                     // front faces -x
  const stone = 0xb8b0a2, teak = 0x8a5a34, p = [];
  for (const z of [-0.72, 0.72]) {
    p.push(vc(T(new THREE.BoxGeometry(0.5, 0.42, 0.12), 0, 0.21, z), stone));
    p.push(vc(T(new THREE.BoxGeometry(0.1, 0.5, 0.1), 0.24, 0.62, z), stone));
  }
  for (let i = 0; i < 4; i++) p.push(vc(T(new THREE.BoxGeometry(0.1, 0.035, 1.8), -0.2 + i * 0.125, 0.44, 0), teak, 0.15));
  for (let i = 0; i < 2; i++) {
    const g = new THREE.BoxGeometry(0.03, 0.11, 1.8).rotateZ(-0.2);
    p.push(vc(T(g, 0.27 + i * 0.03, 0.62 + i * 0.16, 0), teak, 0.15));
  }
  return mergeVC(p);
}

function furniture(ctx, L, s0, s1, group) {
  const lampsM = [], benchM = [];
  for (let s = s0 + 6; s < s1 - 4; s += 18) for (const sg of [-1, 1]) {
    const ss = s + (sg > 0 ? 9 : 0);
    if (L.cross.some(c => Math.abs(c - ss) < 2.5)) continue;
    lampsM.push(roadFrame(ctx, ss, sg * 7.65));
  }
  for (let i = 0; i < L.cross.length; i++) for (const sg of [-1, 1]) {
    if ((i + (sg > 0 ? 1 : 0)) % 2) continue;
    const s = L.cross[i] + MOD / 2 + (sg > 0 ? 3 : -3);
    if (s > s1 - 4) continue;
    benchM.push(roadFrame(ctx, s, sg * 7.55, sg > 0 ? 0 : Math.PI));
  }
  const lampMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: stoneTexture(12), roughness: 0.55, metalness: 0.35 });
  const lamps = new THREE.InstancedMesh(lampGeometry(), lampMat, lampsM.length);
  const glass = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.11, 0.42, 4).rotateY(Math.PI / 4).translate(0, 3.43, 0),
    new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffc070, emissiveIntensity: 0.35, roughness: 0.15, transparent: true, opacity: 0.85 }), lampsM.length);
  lampsM.forEach((m, i) => { lamps.setMatrixAt(i, m); glass.setMatrixAt(i, m); });
  const benches = new THREE.InstancedMesh(benchGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, map: stoneTexture(14), roughness: 0.8 }), benchM.length);
  benchM.forEach((m, i) => benches.setMatrixAt(i, m));
  for (const x of [lamps, glass, benches]) { x.castShadow = true; x.computeBoundingSphere(); }
  lamps.name = 'lamps'; glass.name = 'lamp-glass'; benches.name = 'benches';
  group.add(lamps, glass, benches);
}

/* ---------- tiered stone fountain ---------- */
function fountain(ctx, s, lat, group) {
  const lathe = (pts, seg = 40) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
  const stone = 0xd4cab8, p = [];
  p.push(vc(lathe([[0, 0.12], [2.75, 0.12], [2.75, 0.5], [2.95, 0.58], [3.3, 0.58], [3.4, 0.5], [3.35, -0.2]]), stone));   // basin
  p.push(vc(lathe([[0.55, 0.1], [0.42, 0.3], [0.3, 0.45], [0.26, 1.0], [0.34, 1.1], [0.2, 1.18]], 16), stone));            // pedestal
  p.push(vc(lathe([[0.15, 1.12], [0.7, 1.2], [1.1, 1.38], [1.2, 1.5], [1.12, 1.52], [0.6, 1.36], [0.05, 1.32]], 32), stone)); // lower bowl
  p.push(vc(lathe([[0.2, 1.33], [0.13, 1.5], [0.12, 2.0], [0.18, 2.08], [0.1, 2.12]], 12), stone));
  p.push(vc(lathe([[0.1, 2.06], [0.4, 2.12], [0.62, 2.28], [0.66, 2.36], [0.6, 2.37], [0.3, 2.25], [0.03, 2.22]], 24), stone)); // upper bowl
  p.push(vc(lathe([[0.08, 2.22], [0.1, 2.4], [0.06, 2.55], [0.1, 2.65], [0.0, 2.85]], 10), stone));                          // finial
  const M = roadFrame(ctx, s, lat);
  const baseY = Math.min(...[-3, 0, 3].flatMap(a => [-3, 0, 3].map(b => ctx.world.heightSL(s + a, lat + b)))) - 0.05;
  M.elements[13] = baseY;
  const body = new THREE.Mesh(mergeVC(p), new THREE.MeshStandardMaterial({ vertexColors: true, map: stoneTexture(21), roughness: 0.8 }));
  body.applyMatrix4(M); body.castShadow = body.receiveShadow = true; body.name = 'fountain';
  // water surfaces: basin pool + two bowls
  const R = lcg(5);
  const ripple = canvasTex(128, 128, g => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 400; i++) { const v = 90 + R() * 80 | 0; g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 1.5; g.beginPath(); g.arc(R() * 128, R() * 128, 3 + R() * 12, 0, 7); g.stroke(); }
  }, { srgb: false });
  const wmat = new THREE.MeshStandardMaterial({ color: 0x4a7a78, roughness: 0.06, metalness: 0.2, bumpMap: ripple, bumpScale: 0.6, transparent: true, opacity: 0.9 });
  const wg = mergeVC([vc(new THREE.CircleGeometry(2.76, 40).rotateX(-Math.PI / 2).translate(0, 0.44, 0), 0xffffff),
    vc(new THREE.CircleGeometry(1.1, 24).rotateX(-Math.PI / 2).translate(0, 1.47, 0), 0xffffff),
    vc(new THREE.CircleGeometry(0.6, 16).rotateX(-Math.PI / 2).translate(0, 2.33, 0), 0xffffff)]);
  wg.attributes.uv.array.forEach((_, i, a) => { a[i] = wg.attributes.position.array[Math.floor(i / 2) * 3 + (i % 2 ? 2 : 0)] * 0.4; });
  const water = new THREE.Mesh(wg, wmat); water.applyMatrix4(M); water.name = 'fountain-water';
  // falling water sheets + a central jet
  const fall = canvasTex(32, 128, g => {
    for (let x = 0; x < 32; x++) { const v = 120 + R() * 135 | 0; g.fillStyle = `rgba(${v},${v},${v},${0.25 + R() * 0.5})`; g.fillRect(x, 0, 1, 128); }
    for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(R() * 32, R() * 128, 1, 3 + R() * 8); }
  });
  fall.repeat.set(6, 1);
  const smat = new THREE.MeshStandardMaterial({ color: 0xeaf4f4, map: fall, alphaMap: fall, transparent: true, opacity: 0.75, roughness: 0.2, depthWrite: false, side: THREE.DoubleSide });
  const sheets = mergeVC([
    vc(new THREE.CylinderGeometry(1.2, 1.32, 1.05, 32, 1, true).translate(0, 0.97, 0), 0xffffff),
    vc(new THREE.CylinderGeometry(0.66, 0.74, 0.82, 24, 1, true).translate(0, 1.94, 0), 0xffffff),
    vc(new THREE.CylinderGeometry(0.015, 0.05, 0.9, 6, 1, true).translate(0, 3.2, 0), 0xffffff)]);
  const spray = new THREE.Mesh(sheets, smat); spray.applyMatrix4(M); spray.name = 'fountain-spray';
  group.add(body, water, spray);
  return dt => { fall.offset.y -= dt * 1.6; ripple.offset.x += dt * 0.03; ripple.offset.y += dt * 0.021; };
}

/* ---------- wedding gate over the road ---------- */
const PX = 5.45, BEAM_Y = 5.7, ARCH_B = 4.35, ARCH_T = 5.3;       // post x, beam height, arch springing/crown
const archY = x => ARCH_B + (ARCH_T - ARCH_B) * Math.sqrt(Math.max(0, 1 - (x / (PX - 0.1)) ** 2));

const POST_TOP = BEAM_Y + 0.24;
function kalashGeometry() {                       // hammered brass pot on a turned stand, sits at y = 0
  const prof = [[0, 0], [0.13, 0], [0.13, 0.03], [0.08, 0.06], [0.07, 0.1], [0.16, 0.16], [0.21, 0.26], [0.22, 0.33],
    [0.19, 0.42], [0.1, 0.49], [0.08, 0.53], [0.1, 0.57], [0.13, 0.59], [0.12, 0.61], [0.07, 0.6]];
  const g = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 28);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {             // faint hammer dimples
    _v.fromBufferAttribute(p, i);
    const k = 1 + 0.012 * Math.sin(Math.atan2(_v.z, _v.x) * 17 + _v.y * 40) * Math.sin(_v.y * 31);
    p.setXYZ(i, _v.x * k, _v.y, _v.z * k);
  }
  g.computeVertexNormals();
  return g;
}
function coconutGeometry() {                      // husked coconut with its fibre tuft, on the kalash mouth
  const g = new THREE.SphereGeometry(0.11, 14, 10);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    const t = _v.y / 0.11; _v.y *= 1.25; if (t > 0.6) { _v.x *= 0.8; _v.z *= 0.8; }
    p.setXYZ(i, _v.x, _v.y + 0.66, _v.z);
    const k = 0.8 + 0.2 * Math.sin(Math.atan2(_v.z, _v.x) * 23 + t * 9);
    col.set([0.46 * k, 0.3 * k, 0.16 * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function gateFrame() {
  const wood = 0x6a4028, p = [];
  for (const sg of [-1, 1]) {
    p.push(vc(T(new THREE.BoxGeometry(0.7, 0.45, 0.7), sg * PX, 0.1, 0), 0xa8a296));
    p.push(vc(T(new THREE.CylinderGeometry(0.15, 0.17, BEAM_Y + 0.1, 14), sg * PX, (BEAM_Y + 0.1) / 2, 0), wood, 0.1));
    p.push(vc(T(new THREE.CylinderGeometry(0.2, 0.22, 0.12, 16), sg * PX, POST_TOP + 0.06, 0), 0xd8d0c0));   // turned cap plate
    p.push(vc(T(coconutGeometry(), sg * PX, POST_TOP + 0.12, 0), 0x7a522c, 0.18));                           // husked coconut
    p.push(vc(T(new THREE.TorusGeometry(0.2, 0.03, 4, 10).rotateX(Math.PI / 2), sg * PX, 1.6, 0), 0xc8b070));   // jute lashing
    p.push(vc(T(new THREE.TorusGeometry(0.2, 0.03, 4, 10).rotateX(Math.PI / 2), sg * PX, 2.8, 0), 0xc8b070));
  }
  p.push(vc(T(new THREE.BoxGeometry(2 * PX + 0.9, 0.28, 0.3), 0, BEAM_Y + 0.1, 0), wood, 0.1));
  const pts = [];
  for (let i = 0; i <= 24; i++) { const x = -(PX - 0.1) + 2 * (PX - 0.1) * i / 24; pts.push(new THREE.Vector3(x, archY(x), 0)); }
  p.push(vc(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.1, 6), 0xb02a24));                  // red-wrapped arch batten
  for (const x of [-3.6, -1.8, 0, 1.8, 3.6]) p.push(vc(T(new THREE.BoxGeometry(0.1, BEAM_Y - archY(x), 0.1), x, (BEAM_Y + archY(x)) / 2, 0), wood));
  return mergeVC(p);
}

/** Local positions of every marigold head + mango leaf on one gate. */
function gateLayout() {
  const R = lcg(1234), F = [], Lv = [];
  const O = 0x0ff8a0c, Y = 0xffb912, D = 0xe8620a, RED = 0xc4122a;
  const strand = (x, z, yTop, yBot, col, tassel) => {
    for (let y = yTop; y > yBot; y -= 0.068) F.push([x + (R() - 0.5) * 0.01, y, z + (R() - 0.5) * 0.01, col, 0.034]);
    if (tassel) F.push([x, yBot - 0.05, z, RED, 0.05]);
  };
  // curtain of strands hanging from the beam to just below the arch batten, front and back
  for (const z of [-0.2, 0.2]) for (let x = -PX + 0.3; x <= PX - 0.3 + 1e-6; x += 0.2) {
    const k = Math.round((x + PX) / 0.2);
    strand(x, z, BEAM_Y - 0.05, archY(x) - 0.2 - 0.12 * Math.abs(Math.sin(k * 0.8)), k % 2 ? O : Y, k % 4 === 0);
  }
  // posts wrapped in vertical strands on each face
  for (const sg of [-1, 1]) for (const [dx, dz] of [[0.19, 0], [-0.19, 0], [0, 0.19], [0, -0.19], [0.14, 0.14], [-0.14, 0.14], [0.14, -0.14], [-0.14, -0.14]])
    strand(sg * PX + dx, dz, BEAM_Y - 0.1, 0.45, (dx + dz) > 0 ? O : Y, false);
  // two swags of dense garland along the beam front and back
  for (const z of [-0.3, 0.3]) for (let i = 0; i < 6; i++) {
    const x0 = -PX + i * (2 * PX / 6), x1 = x0 + 2 * PX / 6;
    for (let t = 0; t <= 1; t += 0.03) for (const dy of [0, 0.065]) F.push([x0 + (x1 - x0) * t, BEAM_Y + 0.08 - dy - Math.sin(t * Math.PI) * 0.45, z, dy ? D : Y, 0.04]);
    F.push([x0, BEAM_Y - 0.05, z, RED, 0.07]);
  }
  // marigold collar round each kalash neck and a dense pom-pom ring on the post cap
  for (const sg of [-1, 1]) {
    for (let a = 0; a < 6.28; a += 0.42) F.push([sg * PX + Math.cos(a) * 0.12, POST_TOP + 0.12 + 0.52, Math.sin(a) * 0.12, a % 0.84 < 0.42 ? O : Y, 0.03]);
    for (let a = 0; a < 6.28; a += 0.26) for (const dy of [0.02, 0.08]) F.push([sg * PX + Math.cos(a) * 0.24, POST_TOP + dy, Math.sin(a) * 0.24, dy > 0.05 ? RED : O, 0.045]);
    // mango leaves fanning from the kalash mouth
    for (let a = 0; a < 6.28; a += 0.7) Lv.push([sg * PX + Math.cos(a) * 0.1, POST_TOP + 0.12 + 0.62, Math.sin(a) * 0.1, -a + Math.PI / 2, 0.8, true]);
  }
  // mango-leaf toran along the beam, both faces
  for (const z of [-0.17, 0.17]) for (let x = -PX - 0.3; x <= PX + 0.3; x += 0.13) Lv.push([x, BEAM_Y - 0.02, z, (R() - 0.5) * 0.3, 0.9 + R() * 0.3]);
  return { F, Lv };
}

function mangoLeafGeometry() {                    // hangs down from origin, ~22 cm, folded on the midrib
  const pos = [], idx = [], N = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N, w = 0.035 * Math.sin(Math.min(1, t * 1.1) * Math.PI) + 0.002, y = -0.02 - t * 0.22, bend = t * t * 0.04;
    pos.push(-w, y, bend + w * 0.4, 0, y, bend, w, y, bend + w * 0.4);
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < 2; j++) { const q = i * 3 + j; idx.push(q, q + 3, q + 1, q + 1, q + 3, q + 4); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function gates(ctx, sList, group) {
  const { path } = ctx;
  const bases = sList.map(s => roadFrame(ctx, s, 0, 0, 1, path.roadY(s) - 0.05));
  const frame = new THREE.InstancedMesh(gateFrame(), new THREE.MeshStandardMaterial({ vertexColors: true, map: stoneTexture(31), roughness: 0.8, side: THREE.DoubleSide }), bases.length);
  const lay = gateLayout();
  const fl = new THREE.InstancedMesh(marigoldGeometry(), new THREE.MeshStandardMaterial({ map: petalTex(), vertexColors: true, roughness: 0.78 }), lay.F.length * bases.length);
  const lvMat = new THREE.MeshStandardMaterial({ color: 0x3c7424, roughness: 0.55, side: THREE.DoubleSide });
  const lv = new THREE.InstancedMesh(mangoLeafGeometry(), lvMat, lay.Lv.length * bases.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
  const R = lcg(99);
  let fi = 0, li = 0;
  bases.forEach((base, k) => {
    frame.setMatrixAt(k, base);
    for (const [x, y, z, col, r] of lay.F) {
      q.setFromEuler(e.set(R() * 6, R() * 6, R() * 6));
      fl.setMatrixAt(fi, m.compose(p.set(x, y, z), q, sc.setScalar(r * (0.9 + R() * 0.25))).premultiply(base));
      fl.setColorAt(fi++, c.setHex(col).multiplyScalar(0.88 + R() * 0.2));
    }
    for (const [x, y, z, yaw, s, fan] of lay.Lv) {
      if (fan) q.setFromEuler(e.set(-2.2 - R() * 0.4, yaw, 0, 'YXZ'));   // tip up and outward over the pot lip
      else q.setFromEuler(e.set(z > 0 ? 0.12 : -0.12, yaw, (R() - 0.5) * 0.25));
      lv.setMatrixAt(li, m.compose(p.set(x, y, z), q, sc.set(s, s, s)).premultiply(base));
      lv.setColorAt(li++, c.setHex(0xffffff).multiplyScalar(0.75 + R() * 0.45).offsetHSL((R() - 0.5) * 0.04, 0, 0));
    }
  });
  // brass kalash finials on both posts
  const brass = new THREE.MeshStandardMaterial({ color: 0xe8b85a, metalness: 0.6, roughness: 0.3, emissive: 0x2a1c06, map: stoneTexture(44) });
  const kal = new THREE.InstancedMesh(kalashGeometry(), brass, bases.length * 2);
  bases.forEach((base, k) => { for (const sg of [-1, 1]) kal.setMatrixAt(k * 2 + (sg > 0), m.makeTranslation(sg * PX, POST_TOP + 0.12, 0).premultiply(base)); });
  for (const x of [frame, fl, lv, kal]) { x.castShadow = true; x.computeBoundingSphere(); }
  frame.name = 'gate-frame'; fl.name = 'gate-marigolds'; lv.name = 'gate-mango-leaves'; kal.name = 'gate-kalash';
  group.add(frame, fl, lv, kal);

}

export default {
  id: 'garden',
  build(ctx) {
    const z = ctx.zones.byId.garden;
    const K = tierK(ctx);
    const group = new THREE.Group();
    group.name = 'garden';
    const s0 = z.s0, s1 = z.s1;
    const arches = [s0 + 30, s0 + (s1 - s0) * 0.62];
    let L = layout(s0, s1, arches, 0);
    const mid = L.cross[Math.floor(L.cross.length / 2)] + MOD / 2;
    L = layout(s0, s1, arches, mid);

    gardenGround(ctx, L, s0, s1, mid, group);
    hedges(ctx, L, s0, s1, group, K);
    flowerHeads(ctx, beds(ctx, L, group, K), group);
    furniture(ctx, L, s0, s1, group);
    const fUpd = fountain(ctx, mid, 15, group);
    gates(ctx, arches, group);

    // flowering-tree avenue behind the back hedge, blossom and gold alternating
    const avenue = (phase) => (R, i) => {
      const s = s0 + 6 + i * 10 + (R() - 0.5) * 1.5;
      if (s > s1 - 4) return null;
      const sg = i % 2 ? 1 : -1;
      return ((i >> 1) % 2 === phase) ? { s, lateral: sg * (25.5 + R() * 2.5) } : null;
    };
    const n = Math.ceil((s1 - s0) / 10);
    group.add(plant(ctx, { kind: 'blossom', count: n, seed: 'g-blossom', place: avenue(0), scale: [1.1, 1.4] }));
    group.add(plant(ctx, { kind: 'marigold', count: n, seed: 'g-gold', place: avenue(1), scale: [1.1, 1.4] }));
    group.add(plant(ctx, {
      kind: 'blossom', count: Math.round(40 * K), seed: 'g-orchard', scale: [0.9, 1.4],
      place: R => ({ s: s0 + R() * (s1 - s0), lateral: (R() < 0.5 ? -1 : 1) * (34 + R() * 60) })
    }));
    group.add(plant(ctx, { kind: 'bush', count: Math.round(50 * K), seed: 'g-bush', place: R => ({ s: s0 + R() * (s1 - s0), lateral: (R() < 0.5 ? -1 : 1) * (29 + R() * 30) }) }));

    return { group, update: (dt) => fUpd(dt) };
  }
};
