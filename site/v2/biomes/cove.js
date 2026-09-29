/* Zone 'cove' — the sea bay before the hills. The Haldi and Muhurtham decks
 * (biomes/events/) stand on its sand; everything here keeps off them.
 *
 * OBJECTS (every mesh this module adds; draw calls in brackets, ≈11 total)
 *  Sea
 *   1  sea surface ........................ makeWater() from water.js      [1]
 *  Coast
 *   2  islet — rocky outcrop with cliffs, ledges, scrub crown               [1]
 *   3  islet scrub + palms (flora geo at explicit points)                  [2]
 *   4  fishing boats — Andhra wooden navas: lofted plank hull, painted
 *      strakes, tarred bottom, high stem/stern posts, thwarts, outrigger
 *      booms + float log, outboard, nets; bob and roll on the swell        [1]
 *   5  shoreline rocks — tide-line boulders, the islet's skirt of boulders [2]
 *   6  shore palms, hill palms, hill bushes (flora.plant)                   [3]
 *   7  dune grass on the sea-side verge (garden-beach duneGrass)            [1]
 */
import * as THREE from 'three';
import { makeWater } from './water.js';
import { plant, band, kindGeometry, floraMaterial } from './flora.js';
import { tierK, duneGrass, shoreLat } from './garden-beach.js';
import { onEventSite } from '../core/timeline.js';
import { rng as makeRng, smoothstep } from '../core/noise.js';

const UP = new THREE.Vector3(0, 1, 0);

/* ---------- geometry helpers ---------- */

/** Non-indexed, flat normals, flat vertex colour; drops uv (re-projected later).
 *  Indexed primitives are split and get faceted normals; already non-indexed
 *  input (boxGeo) keeps the face normals it carries. */
function colored(g, hex) {
  if (g.index) { g = g.toNonIndexed(); g.computeVertexNormals(); }
  else if (!g.attributes.normal) g.computeVertexNormals();
  if (g.attributes.uv) g.deleteAttribute('uv');
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
/* Unit box, non-indexed, with face normals (cheaper than splitting an indexed BoxGeometry). */
let UNIT = null;
/** Non-indexed w×h×d box centred at (x, y, z): position + normal only. */
function boxGeo(w, h, d, x = 0, y = 0, z = 0) {
  if (!UNIT) { const u = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(); UNIT = { p: u.attributes.position.array, n: u.attributes.normal.array }; }
  const up = UNIT.p, p = new Float32Array(up.length);
  for (let i = 0; i < up.length; i += 3) { p[i] = up[i] * w + x; p[i + 1] = up[i + 1] * h + y; p[i + 2] = up[i + 2] * d + z; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(UNIT.n.slice(), 3));
  return g;
}

/** Concatenate non-indexed geometries (attributes of the first one). */
function mergeGeo(list) {
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(list[0].attributes)) {
    const k = list[0].attributes[name].itemSize;
    let n = 0; for (const g of list) n += g.attributes[name].array.length;
    const a = new Float32Array(n); let o = 0;
    for (const g of list) { a.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(a, k));
  }
  return out;
}

/** Box-projected UVs in metres/scale from position + normal (for detail maps). */
function boxUV(g, scale = 3) {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / scale; uv[i * 2 + 1] = v / scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/* ---------- procedural textures ---------- */

/** Tileable value-noise fbm in [0,1], N×N. */
function fbmTile(N, seed, octs = [[4, 0.36], [8, 0.26], [16, 0.18], [32, 0.12], [64, 0.08]]) {
  const R = makeRng(seed), out = new Float32Array(N * N);
  for (const [cells, amp] of octs) {
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = R();
    // the x lattice terms are the same on every row
    const X0 = new Int32Array(N), X1 = new Int32Array(N), SX = new Float64Array(N);
    for (let x = 0; x < N; x++) {
      const fx = (x / N) * cells, ix = Math.floor(fx), tx = fx - ix;
      X0[x] = ix; X1[x] = (ix + 1) % cells; SX[x] = tx * tx * (3 - 2 * tx);
    }
    for (let y = 0; y < N; y++) {
      const fy = (y / N) * cells, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
      const r0 = iy * cells, r1 = ((iy + 1) % cells) * cells, o = y * N;
      for (let x = 0; x < N; x++) {
        const ix = X0[x], x1 = X1[x], sx = SX[x];
        const a = g[r0 + ix], b = g[r0 + x1], c = g[r1 + ix], d = g[r1 + x1];
        out[o + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
      }
    }
  }
  return out;
}

function canvasTex(c, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function mkCanvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/** Paint a per-pixel function into a canvas. f(x, y, i, o) writes r, g, b (0..255) to o[0..2] */
function paint(N, f) {
  const c = mkCanvas(N), g = c.getContext('2d'), im = g.createImageData(N, N), d = im.data, px = [0, 0, 0];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, o = i * 4;
    f(x, y, i, px);
    d[o] = px[0]; d[o + 1] = px[1]; d[o + 2] = px[2]; d[o + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return c;
}

let TEX = null;
/** Shared detail maps: wood grain (map + bump) for the boats, rock for the islet. */
function textures() {
  if (TEX) return TEX;
  const N = 256;
  const n1 = fbmTile(N, 'grain'), n2 = fbmTile(N, 'grain2', [[64, 0.5], [128, 0.5]]);
  const grain = paint(N, (x, y, i, o) => { const v = 226 + 22 * n1[i] + 10 * (n2[i] - 0.5); o[0] = v; o[1] = v; o[2] = v; });
  const bump = paint(N, (x, y, i, o) => { const v = 128 + 70 * (n2[i] - 0.5) + 60 * (n1[i] - 0.5); o[0] = v; o[1] = v; o[2] = v; });
  TEX = { grain: canvasTex(grain), bump: canvasTex(bump, false), rock: canvasTex(rockCanvas()) };
  return TEX;
}

/** Weathered coastal granite: grey-brown mottling, lichen, dark cracks. */
function rockCanvas() {
  const N = 256, n = fbmTile(N, 'rock', [[4, 0.3], [16, 0.3], [64, 0.25], [128, 0.15]]);
  const l = fbmTile(N, 'lichen', [[8, 0.6], [32, 0.4]]);
  return paint(N, (x, y, i, o) => {
    let v = 0.55 + 0.6 * n[i];
    const crack = Math.abs(n[i] - 0.5) < 0.012 ? 0.55 : 1;
    const li = smoothstep(0.62, 0.72, l[i]);
    const r = (132 * v) * (1 - li) + 160 * li, gg = (122 * v) * (1 - li) + 150 * li, b = (110 * v) * (1 - li) + 96 * li;
    o[0] = r * crack; o[1] = gg * crack; o[2] = b * crack;
  });
}

/* ---------- flora geometry at explicit world points ---------- */

function kindAt(kind, pts, seed, { sway = true, rough = 0.85, sink = 0 } = {}) {
  const R = makeRng(seed);
  const mesh = new THREE.InstancedMesh(kindGeometry(kind), floraMaterial({ sway, rough }), Math.max(1, pts.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), c = new THREE.Color(), p = new THREE.Vector3();
  pts.forEach((pt, i) => {
    const s = pt.scale ?? 1;
    q.setFromAxisAngle(UP, pt.yaw ?? R() * 6.283);
    if (pt.sxyz) sc.set(...pt.sxyz); else sc.setScalar(s);
    p.copy(pt.pos); p.y -= sink * s;
    mesh.setMatrixAt(i, m.compose(p, q, sc));
    mesh.setColorAt(i, c.set(pt.tint ?? 0xffffff).multiplyScalar(0.88 + R() * 0.24));
  });
  if (!pts.length) mesh.setColorAt(0, c.set(0xffffff));
  mesh.count = pts.length;
  mesh.computeBoundingSphere();
  mesh.name = 'cove:' + kind;
  return mesh;
}

/* ---------- islet: a rocky outcrop with a scrub crown ---------- */

function islet(ctx, center, Rad, wl) {
  const r = makeRng('islet');
  const tx = textures();
  const rings = 26, segs = 96, pos = [], col = [], uv = [], idx = [];
  const cRock = new THREE.Color(0xffffff), cDark = new THREE.Color(0x6a6258), cWet = new THREE.Color(0x3e4038);
  const cGreen = new THREE.Color(0x6e8a44), cDry = new THREE.Color(0xa39a64), c = new THREE.Color();
  const edge = [];
  for (let j = 0; j < segs; j++) {
    const a = (j / segs) * Math.PI * 2;
    edge.push(1 + 0.2 * Math.sin(a * 3 + 1.3) + 0.12 * Math.sin(a * 5 + 0.4) + 0.06 * Math.sin(a * 11 + 2) + (r() - 0.5) * 0.08);
  }
  const H = (u, a, j) => {
    const plateau = 8.5 + 1.4 * Math.sin(a * 2 + 0.7) * (1 - u);
    const cliff = Math.pow(1 - smoothstep(0.5, 0.86, u), 0.7);     // steep sides
    const shelf = 1 - smoothstep(0.86, 1.12, u);                  // rock shelf at the waterline
    const lump = (r() - 0.5) * (u > 0.45 && u < 0.95 ? 1.6 : 0.5);
    return plateau * cliff + 0.9 * shelf - 2.8 * smoothstep(1.0, 1.25, u) + lump - (1 - u) * 0.8 * (u < 0.3 ? 1 : 0) * 0;
  };
  const vert = [];
  pos.push(0, 9.2, 0); col.push(cGreen.r, cGreen.g, cGreen.b); uv.push(0, 0); vert.push(9.2);
  for (let k = 1; k <= rings; k++) {
    const u = (k / rings) * 1.25;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2, rr = Rad * u * edge[j];
      const y = H(u, a, j);
      pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
      uv.push((a * Rad) / 6, y / 6 + u * 2);
      const veg = smoothstep(0.62, 0.45, u) * smoothstep(3.5, 6, y);
      if (y < 0.9) c.copy(cWet).lerp(cDark, smoothstep(-0.5, 0.9, y));
      else c.copy(cRock).lerp(cDark, r() * 0.35).multiplyScalar(0.8 + 0.2 * Math.sin(y * 2.7 + Math.sin(a * 7) * 0.8)); // bedding strata
      c.lerp(r() < 0.5 ? cGreen : cDry, veg * (0.7 + r() * 0.3));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let k = 1; k < rings; k++) {
    const a0 = 1 + (k - 1) * segs, a1 = 1 + k * segs;
    for (let j = 0; j < segs; j++) { const j1 = (j + 1) % segs; idx.push(a0 + j, a0 + j1, a1 + j, a0 + j1, a1 + j1, a1 + j); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: tx.rock, bumpMap: tx.rock, bumpScale: 3, roughness: 0.93 }));
  mesh.position.copy(center);
  mesh.name = 'islet';
  // the top of the rock at (u, a) for dressing
  const topAt = (u, a) => {
    const j = Math.round((a / (Math.PI * 2)) * segs) % segs;
    const k = Math.max(1, Math.round((u / 1.25) * rings));
    const i = 1 + (k - 1) * segs + ((j + segs) % segs);
    return new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).add(center);
  };
  const palms = [], bushes = [], rocks = [];
  for (let i = 0; i < 6; i++) palms.push({ pos: topAt(0.1 + r() * 0.35, r() * 6.283).add(new THREE.Vector3(0, -0.3, 0)), scale: 0.85 + r() * 0.4 });
  for (let i = 0; i < 70; i++) {
    const u = 0.05 + r() * 0.5, a = r() * 6.283, p = topAt(u, a);
    if (p.y - center.y > 4) bushes.push({ pos: p.setY(p.y - 0.25), scale: 0.9 + r() * 1.1, tint: r() < 0.5 ? 0x7f9a4a : 0xa9a868 });
  }
  for (let i = 0; i < 40; i++) {
    const a = r() * 6.283, j = Math.round((a / 6.283) * segs) % segs, rr = Rad * edge[j] * (1.02 + r() * 0.18);
    const s = 1.2 + r() * 2.6;
    rocks.push({ pos: new THREE.Vector3(center.x + Math.cos(a) * rr, wl - 0.5 * s * 0.4, center.z + Math.sin(a) * rr), sxyz: [s * (0.8 + r() * 0.5), s * (0.5 + r() * 0.5), s * (0.8 + r() * 0.5)], tint: 0x8a8174 });
  }
  return { mesh, palms, bushes, rocks };
}

/* ---------- Andhra wooden fishing boats (navas) ---------- */

/* Lofted plank hull: stations along z (-z = bow), each a rounded-V section
 * from gunwale to keel; strakes get painted bands (the top two carry the
 * per-boat colour through aTint), a white sheer stripe, and tar below the
 * waterline. The inside of the hull (back faces) reads as bare wood. */
function boatGeometry() {
  const Lb = 8.4, NS = 28, K = 10, parts = [];
  const st = t => ({
    w: 0.82 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 2.4)), 0.55) + 0.02,
    ys: 1.0 + (t < 0 ? 0.75 * Math.pow(-t, 3) : 0.45 * Math.pow(t, 3)),
    yk: 0.22 * t * t
  });
  const P = (i, k) => {
    const t = (i / NS) * 2 - 1, { w, ys, yk } = st(t), th = (k / K) * Math.PI - Math.PI / 2;
    const f = Math.pow(1 - Math.cos(th), 0.75);
    return [w * Math.sin(th), yk + (ys - yk) * f, t * Lb / 2];
  };
  const pos = [], col = [], tint = [];
  const cTar = new THREE.Color(0x2a221d), cWhite = new THREE.Color(0xf1ece0), cBand = new THREE.Color(0xffffff),
    cYel = new THREE.Color(0xe8b830), c = new THREE.Color();
  for (let i = 0; i < NS; i++) for (let k = 0; k < K; k++) {
    const a = P(i, k), b = P(i + 1, k), cc = P(i + 1, k + 1), d = P(i, k + 1);
    const strake = Math.min(k, K - 1 - k);                  // 0 = gunwale, 4 = keel
    const my = (a[1] + cc[1]) / 2;
    let tn = 0;
    if (my < 0.42) c.copy(cTar);
    else if (strake === 0) { c.copy(cBand); tn = 1; }
    else if (strake === 1) c.copy(cWhite);
    else if (strake === 2) { c.copy(cBand); tn = 1; }
    else c.copy(cYel);
    c.multiplyScalar(k % 2 ? 0.93 : 1);                      // plank seams
    for (const p of [a, b, cc, a, cc, d]) { pos.push(...p); col.push(c.r, c.g, c.b); tint.push(tn); }
  }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hull.computeVertexNormals();
  // outward check at mid-ship, port side: normal should point to -x
  const probe = (NS / 2 * K + 2) * 6;
  if (hull.attributes.normal.getX(probe) * pos[probe * 3] < 0) {
    for (let i = 0; i < pos.length; i += 9) for (let j = 0; j < 3; j++) [pos[i + 3 + j], pos[i + 6 + j]] = [pos[i + 6 + j], pos[i + 3 + j]];
    hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    hull.computeVertexNormals();
  }
  hull.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  hull.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 1));
  parts.push(hull);
  const wood = 0x7a5a3c, dark = 0x3d2f24;
  const T0 = g => { g.setAttribute('aTint', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count), 1)); return g; };
  const add = (g, hex) => parts.push(T0(colored(g, hex)));
  // stem and stern posts, thwarts, a floor board
  add(boxGeo(0.12, 1.1, 0.16).rotateX(-0.35).translate(0, 1.45, -Lb / 2 + 0.05), dark);
  add(boxGeo(0.12, 0.8, 0.16).rotateX(0.3).translate(0, 1.2, Lb / 2 - 0.05), dark);
  for (const z of [-1.8, -0.2, 1.6]) add(boxGeo(st(z / (Lb / 2)).w * 2 - 0.08, 0.06, 0.28).translate(0, 0.86, z), wood);
  add(boxGeo(0.9, 0.04, 5.6).translate(0, 0.32, 0), wood);
  // outrigger: two booms to a float log on the starboard side
  for (const z of [-1.3, 1.3]) add(new THREE.CylinderGeometry(0.055, 0.055, 3.3, 6).rotateZ(Math.PI / 2).translate(1.45, 1.02, z), wood);
  add(new THREE.CylinderGeometry(0.15, 0.15, 4.4, 8).rotateX(Math.PI / 2).translate(3.0, 0.42, 0), 0x5e4a36);
  for (const z of [-1.3, 1.3]) add(new THREE.CylinderGeometry(0.04, 0.04, 0.62, 5).translate(3.0, 0.72, z), wood);
  // outboard on a transom bracket, nets heaped amidships
  add(boxGeo(0.36, 0.5, 0.5).translate(0.25, 1.35, Lb / 2 + 0.1), 0x2d2f33);
  add(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6).translate(0.25, 0.75, Lb / 2 + 0.18), 0x2d2f33);
  add(new THREE.SphereGeometry(0.6, 10, 6).scale(1, 0.35, 1.4).translate(0, 0.55, 0.6), 0x5d6b52);
  const g = mergeGeo(parts.map(p => { if (p.attributes.uv) p.deleteAttribute('uv'); if (!p.attributes.normal) p.computeVertexNormals(); return p; }));
  return boxUV(g, 1.5);
}

function boatMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: textures().grain, bumpMap: textures().bump, roughness: 0.72, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTint;')
      .replace('#include <color_vertex>', `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb = color.rgb * mix(vec3(1.0), instanceColor.rgb, aTint);
        #endif`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb = vec3(0.30, 0.21, 0.14);');
  };
  m.customProgramCacheKey = () => 'cove-boat';
  return m;
}

function boats(ctx, spots) {
  const mesh = new THREE.InstancedMesh(boatGeometry(), boatMaterial(), spots.length);
  const tints = [0x2f6fb8, 0xc8402e, 0x2b8f6e, 0x3a4fb0, 0xd06a2a, 0x1f8a9a];
  const c = new THREE.Color();
  spots.forEach((sp, i) => mesh.setColorAt(i, c.setHex(tints[i % tints.length])));
  mesh.name = 'boats';
  mesh.frustumCulled = false; // bobbing moves instances; few enough to always draw
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
  const update = t => {
    spots.forEach((sp, i) => {
      const ph = i * 1.7, f = sp.beached ? 0 : 1;
      p.copy(sp.pos); p.y += f * Math.sin(t * 1.1 + ph) * 0.1;
      e.set(f * Math.sin(t * 0.9 + ph) * 0.04 + (sp.pitch ?? 0), sp.yaw + f * Math.sin(t * 0.13 + ph) * 0.08, f * Math.sin(t * 1.3 + ph * 2) * 0.06 + (sp.roll ?? 0), 'YXZ');
      mesh.setMatrixAt(i, m.compose(p, q.setFromEuler(e), sc));
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { mesh, update };
}

export default {
  id: 'cove',
  build(ctx) {
    const { path, world, zones } = ctx;
    const z = zones.byId.cove;
    const K = tierK(ctx);
    const group = new THREE.Group();
    group.name = 'cove';
    const s0 = z.s0, s1 = z.s1;
    const wl = world.waterAt(z.mid) ?? 0;

    // sea continues from garden-beach at s0, and runs on past the end of the zone
    group.add(makeWater(ctx, { s0, s1: s1 + 160, lateral0: -world.VERGE, lateral1: -460, y: wl, kind: 'sea', extend: [0, 900] }));

    // Haldi and Muhurtham stand on decks on this sand: palms, grass, rocks and beached boats keep off them
    group.add(plant(ctx, {
      kind: 'palm', count: Math.round(80 * K), seed: 'cove-shore', scale: [0.95, 1.5],
      place: R => {
        const s = s0 + R() * (s1 - s0 + 40);
        const sh = shoreLat(ctx, s, 1.2), lateral = sh + 1.5 + R() * Math.max(2, Math.abs(sh) - 8);
        if (onEventSite(s, lateral, 3)) return null;
        return { s, lateral, yaw: Math.PI + (R() - 0.5) * 1.2 + path.sample(s).heading };
      }
    }));
    group.add(plant(ctx, { kind: 'palm', count: Math.round(45 * K), seed: 'cove-hill', scale: [0.9, 1.3], place: band(s0, s1, 8, 70, 'right') }));
    group.add(plant(ctx, { kind: 'bush', count: Math.round(70 * K), seed: 'cove-bush', place: (() => {
      // scrub in drifts (lantana / cashew clumps) instead of an even dotting
      const CR = makeRng('cove-drifts'), C = [];
      for (let i = 0; i < 14; i++) C.push([s0 + CR() * (s1 - s0), 9 + Math.pow(CR(), 1.4) * 65, 3 + CR() * 7]);
      return R => { const [cs, cl, r] = C[Math.floor(R() * C.length)], a = R() * 6.283, d = r * Math.sqrt(R());
        return { s: cs + Math.cos(a) * d * 1.6, lateral: cl + Math.sin(a) * d, scale: 0.7 + R() * 0.7 }; };
    })() }));

    // islet offshore, ahead-left, framing the bay
    const isS = z.s0 + (z.s1 - z.s0) * 0.3;
    const isC = path.toWorld(isS, -150); isC.y = wl - 0.2;
    const isl = islet(ctx, isC, 26, wl);
    group.add(isl.mesh);

    // the islet's crown: one palm and one shrub mesh
    group.add(kindAt('palm', isl.palms, 'cove-free-palms', { sink: 0.2 }));
    group.add(kindAt('bush', isl.bushes, 'cove-free-bush'));

    // rocks: the islet's skirt of boulders, and tide-line boulders along the shore (garden-beach coastRocks' placement, off the decks)
    group.add(kindAt('boulder', isl.rocks, 'cove-rocks-free', { sway: false, rough: 0.95 }));
    group.add(plant(ctx, {
      kind: 'boulder', count: Math.round(45 * K), seed: 'cove-rocks', scale: [0.6, 2.4], allowRoad: false,
      colors: [0x8d8375, 0x7a7266, 0xa49886, 0x6e675d],
      place: R => {
        const s = s0 + R() * (s1 - s0);
        let lat = -12;
        for (; lat > -80; lat -= 2) if (world.heightSL(s, lat) < 0.6) break;
        const lateral = lat + (R() - 0.3) * 6;
        return onEventSite(s, lateral, 3) ? null : { s, lateral };
      }
    }));

    // fishing boats: afloat between the shore and the islet, two drawn up on the sand
    const spots = [];
    const BR = makeRng('boats');
    const nb = ctx.quality.tier === 'low' ? 3 : 5;
    for (let i = 0; i < nb; i++) {
      const s = s0 + 30 + (i + 0.3 * BR()) * ((s1 - s0 - 60) / nb);
      const lat = Math.min(shoreLat(ctx, s, -1.6) - 10 - BR() * 30, -30);
      spots.push({ pos: path.toWorld(s, lat).setY(wl - 0.4), yaw: BR() * 6.283 });
    }
    for (const f of [0.08, 0.14]) {
      const s = s0 + (s1 - s0) * f;
      const lat = shoreLat(ctx, s, 0.5) + 3;
      if (onEventSite(s, lat, 6)) continue;
      const y = world.heightSL(s, lat);
      if (y < wl) continue;
      spots.push({ pos: path.toWorld(s, lat).setY(y - 0.12), yaw: path.sample(s).heading + Math.PI / 2 + (BR() - 0.5) * 0.5, roll: 0.1, beached: true });
    }
    const bt = boats(ctx, spots);
    group.add(bt.mesh);

    // dune grass on the sea-side verge (not on the event decks)
    group.add(duneGrass(ctx, {
      count: Math.round(700 * K), seed: 21,
      place: R => { const s = s0 + R() * (s1 - s0); const lateral = -(world.VERGE + 0.8 + R() * 18); return onEventSite(s, lateral, 2) ? null : { s, lateral }; }
    }));

    const U = world.U;
    return {
      group,
      update() {
        bt.update(U.uTime.value);
      }
    };
  }
};
