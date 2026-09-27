/* Zone 'hills' (s 1321–1740, golden hour) — an Eastern-Ghats hill road.
 *
 * Objects (draw calls in brackets, all built in road space and grounded on
 * gH(), which is world.heightSL raised over the road cuttings):
 *  1. Road cuttings [2]: layered laterite/khondalite rock faces on the inside
 *     (uphill side) of the bends, with a stone-lined drain at the foot, a
 *     crumbling brow, and a grassed top that feathers back into the terrain.
 *  2. Trees [2]: flora-kit pines (Pinus kesiya plantation groves) and dry-deciduous
 *     broadleaves, grove-clustered on the slopes.
 *  3. Ground [6]: flora boulders in outcrop clusters, lantana scrub, golden grass;
 *     own instances of grass/scrub/scree on the raised cutting tops and feet.
 *  7. Crash barrier [2]: galvanised W-beam on yellow/black posts, valley side
 *     of the bends.
 *  9. Warning signs [2]: curve/hairpin triangles (red border) and chevron
 *     boards on banded posts.
 * 10. Kilometre stones [1]: white slab, yellow dome top, black lettering.
 * 11. Electricity line [2]: PSC concrete poles with crossarm + insulators, and
 *     three sagging conductors per span (crossing the road once).
 * 12. Distant ridgelines [1]: three receding ridge rings that the height fog
 *     turns into hazy blue-gold layers.
 * Total ≈ 18 draw calls. Instance counts scale with ctx.quality.tier.
 */
import * as THREE from 'three';
import { kindGeometry, floraMaterial, plant } from './flora.js';
import { terrain } from './terrain.js';
import { fbm, noise2, rng as makeRng, smoothstep, clamp } from '../core/noise.js';

const TIER = { low: 0.45, med: 0.7, high: 1 };

/* ---------- road cuttings: where the road is cut into the hillside ---------- */
// side: -1 left, +1 right; H: peak face height (m)
const CUTS = [
  { a: 1372, b: 1482, side: -1, H: 6.5 },
  { a: 1512, b: 1566, side: 1, H: 3.6 },
  { a: 1588, b: 1712, side: 1, H: 7.5 }
];
const D0 = 7.0;            // |lateral| of the cut foot (beyond gravel + drain)
const BATTER = 0.3;        // face lean: metres back per metre up
// valley-side spans that get a crash barrier / parapet (opposite the cuts)
const BARRIERS = [
  { a: 1380, b: 1476, side: 1, kind: 'beam' },
  { a: 1596, b: 1706, side: -1, kind: 'beam' },
  { a: 1518, b: 1562, side: -1, kind: 'beam' },
  { a: 1334, b: 1364, side: 1, kind: 'beam' }
];
const BAR_LAT = 5.35;

function cutH(c, s) {
  if (s <= c.a || s >= c.b) return 0;
  const t = smoothstep(c.a, c.a + 22, s) * smoothstep(c.b, c.b - 22, s);
  return c.H * t * (0.78 + 0.32 * fbm(s * 0.035 + c.a, 3.1, 3));
}

export default {
  id: 'hills',
  build(ctx) {
    const { path, world, zones, quality } = ctx;
    const z = zones.byId.hills;
    const group = new THREE.Group();
    group.name = 'hills';
    const k = TIER[quality.tier] ?? 1;
    const n = v => Math.max(1, Math.round(v * k));
    const s0 = z.s0 - z.blend / 2, s1 = Math.min(z.s1 + z.blend / 2, 1760);

    // cutting top height at (s, lat), or -Infinity outside any cutting
    const cutTop = (s, lat) => {
      let best = -Infinity;
      for (const c of CUTS) {
        if (Math.sign(lat) !== c.side || s <= c.a || s >= c.b) continue;
        const H = cutH(c, s); if (H < 0.2) continue;
        const d = Math.abs(lat), road = path.roadY(s);
        const brow = D0 + H * BATTER + 0.8;
        if (d < D0 + H * BATTER) continue;               // in front of the face
        const y = d < brow ? road + H : road + H - (d - brow) * 0.32 - Math.pow(Math.max(0, d - brow) * 0.05, 2) * 6;
        best = Math.max(best, y);
      }
      return best;
    };
    const gH = (s, lat) => Math.max(world.heightSL(s, lat), cutTop(s, lat));
    const inFace = (s, lat) => CUTS.some(c => Math.sign(lat) === c.side && cutH(c, s) > 0.3 &&
      Math.abs(lat) > D0 - 1.2 && Math.abs(lat) < D0 + cutH(c, s) * BATTER + 0.9);
    const nearBarrier = (s, lat) => BARRIERS.some(b => Math.sign(lat) === b.side && s > b.a - 2 && s < b.b + 2 &&
      Math.abs(Math.abs(lat) - BAR_LAT) < 1.2);

    const env = { THREE, ctx, path, world, gH, cutTop, inFace, nearBarrier, s0, s1, n, k, group, terrain };
    buildCuttings(env);
    buildTrees(env);
    buildGround(env);
    buildFurniture(env);
    buildRidges(env);
    return { group };
  }
};

/* ---------- shared helpers ---------- */

// merge non-indexed geometries sharing the same attribute set
function mergeGeo(parts) {
  const names = Object.keys(parts[0].attributes);
  let N = 0; for (const g of parts) N += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const k = parts[0].attributes[name].itemSize, a = new Float32Array(N * k);
    let o = 0;
    for (const g of parts) { a.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(a, k));
  }
  parts.forEach(g => g.dispose());
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

// one InstancedMesh from a list of {s, lat, y?, yaw?, sc (num|[x,y,z]), tint?, tilt?}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _v = new THREE.Vector3();
function instance(env, geo, mat, list, name, { sink = 0, headingYaw = false } = {}) {
  const { path } = env;
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  mesh.count = list.length;
  const c = new THREE.Color();
  list.forEach((it, i) => {
    path.toWorld(it.s, it.lat, _p);
    const sc = Array.isArray(it.sc) ? it.sc : [it.sc ?? 1, it.sc ?? 1, it.sc ?? 1];
    _p.y = (it.y ?? env.gH(it.s, it.lat)) - sink * sc[1];
    const yaw = (headingYaw ? path.sample(it.s).heading : 0) + (it.yaw ?? 0);
    _e.set(it.tiltX ?? 0, yaw, it.tiltZ ?? 0, 'YXZ');
    _q.setFromEuler(_e);
    mesh.setMatrixAt(i, _m.compose(_p, _q, _v.set(sc[0], sc[1], sc[2])));
    mesh.setColorAt(i, c.set(it.tint ?? 0xffffff));
  });
  if (!list.length) mesh.setColorAt(0, c.set(0xffffff));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = 'hills:' + name;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3 * list.length;
  env.group.add(mesh);
  return mesh;
}

// canvas → texture
function canvasTex(w, h, draw, { srgb = true, repeat = true } = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.userData.canvas = cv;
  return t;
}

// height canvas → tangent-space normal map
function normalFromHeight(src, strength = 2) {
  const w = src.width, h = src.height, d = src.getContext('2d').getImageData(0, 0, w, h).data;
  return canvasTex(w, h, g => {
    const img = g.createImageData(w, h), o = img.data;
    const H = (x, y) => d[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (H(x - 1, y) - H(x + 1, y)) * strength, dy = (H(x, y - 1) - H(x, y + 1)) * strength;
      const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
      o[i] = (dx / l * 0.5 + 0.5) * 255; o[i + 1] = (-dy / l * 0.5 + 0.5) * 255; o[i + 2] = (1 / l * 0.5 + 0.5) * 255; o[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}

/* ---------- 1. road cuttings ---------- */

// tileable value noise (period P lattice cells)
function pnoise(x, y, P, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const f = t => t * t * (3 - 2 * t), u = f(xf), v = f(yf);
  const h = (a, b) => { a = ((a % P) + P) % P; b = ((b % P) + P) % P; return noise2(a * 1.013 + seed * 31.7, b * 0.987 + seed * 17.3); };
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// layered rock: returns { map, normalMap, roughnessMap }
function strataTextures() {
  // Weathered khondalite/gneiss cut: blasted blocks (jittered cells, elongated along gently dipping
  // foliation), each with its own tilt and tone; hairline joints, rain streaks, iron staining, lichen.
  const W = 512, GX = 6, GY = 10, R = makeRng('hi-rock-tex');
  const pts = [];
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
    const r = R(), tone = r < 0.55 ? 0 : r < 0.8 ? 1 : r < 0.93 ? 2 : 3;
    pts.push({ x: (i + 0.15 + 0.7 * R()) / GX * W, y: (j + 0.15 + 0.7 * R()) / GY * W,
      tx: (R() - 0.5) * 1.6, ty: (R() - 0.5) * 1.2 - 0.35, h: 0.3 + 0.4 * R(), tone, v: 0.95 + 0.1 * R() });
  }
  // grey-buff gneiss, rusty weathered, dark fresh, pale kaolinised
  const TONE = [[172, 158, 138], [174, 136, 104], [138, 130, 120], [196, 182, 160]];
  const alb = new Uint8ClampedArray(W * W * 4), hgt = new Uint8ClampedArray(W * W * 4);
  const cw = W / GX, ch = W / GY;
  for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
    // foliation: shear the lookup so blocks dip and wobble (periodic, so it tiles)
    const qx = px, qy = py + 22 * Math.sin(px / W * Math.PI * 2) + 7 * (pnoise(px / 40, py / 40, 12.8, 1) - 0.5);
    const ci = Math.floor(qx / cw), cj = Math.floor(qy / ch);
    let d1 = 1e9, d2 = 1e9, best = null, bdx = 0, bdy = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = ci + di, jj = cj + dj, p = pts[(((jj % GY) + GY) % GY) * GX + (((ii % GX) + GX) % GX)];
      const fx = p.x + Math.floor(ii / GX) * W, fy = p.y + Math.floor(jj / GY) * W;
      const dx = (qx - fx) / 1.7, dy = qy - fy, d = Math.hypot(dx, dy);  // elongated along x
      if (d < d1) { d2 = d1; d1 = d; best = p; bdx = qx - fx; bdy = qy - fy; } else if (d < d2) d2 = d;
    }
    const edge = d2 - d1;                                        // distance to the joint
    // only some joints are open cracks; the rest read through relief alone
    const open = smoothstep(0.42, 0.6, pnoise(px / 26, py / 26, 19.69, 7));
    const crack = edge < 1.8 ? (1 - edge / 1.8) * open : 0;
    const fine = pnoise(px / 3, py / 3, 170.67, 2), mid = pnoise(px / 16, py / 16, 32, 3), big = pnoise(px / 64, py / 64, 8, 4);
    const streak = pnoise(px / 5, py / 90, 102.4, 5);           // rain-wash streaks (vertical)
    // height: tilted block faces, rounded near joints, grainy
    let hv = best.h + (best.tx * bdx + best.ty * bdy) / 90 + 0.1 * fine + 0.12 * mid;
    hv -= 0.35 * crack + (edge < 5 ? (1 - edge / 5) * 0.08 : 0);
    // colour from broad weathering fields (not per block): grey-buff base drifting to pale / dark
    const wz = pnoise(px / 90, py / 70, 5.69, 8), t = [0, 1, 2].map(k => TONE[0][k] + (TONE[3][k] - TONE[0][k]) * smoothstep(0.55, 0.85, wz)
      + (TONE[2][k] - TONE[0][k]) * smoothstep(0.45, 0.15, wz));
    const rust = smoothstep(0.6, 0.85, big) * 0.45 * (0.6 + 0.4 * streak);
    let sh = best.v * (0.8 + 0.22 * fine + 0.18 * (mid - 0.5)) * (1 - 0.4 * crack) * (1 - 0.18 * smoothstep(0.5, 0.8, streak));
    let r = t[0] * sh, g = t[1] * sh, b = t[2] * sh;
    r += (158 - r) * rust * 0.5; g += (104 - g) * rust * 0.5; b += (70 - b) * rust * 0.5;       // iron staining
    const lichen = pnoise(px / 2, py / 2, 256, 6) > 0.8 && mid > 0.55 ? 0.6 : 0;
    r += (196 - r) * lichen * 0.4; g += (190 - g) * lichen * 0.4; b += (160 - b) * lichen * 0.4;
    const i = (py * W + px) * 4;
    alb[i] = r; alb[i + 1] = g; alb[i + 2] = b; alb[i + 3] = 255;
    hgt[i] = hgt[i + 1] = hgt[i + 2] = clamp(hv, 0, 1) * 255; hgt[i + 3] = 255;
  }
  const put = arr => (g, w, h) => g.putImageData(new ImageData(arr, w, h), 0, 0);
  const map = canvasTex(W, W, put(alb));
  const hc = canvasTex(W, W, put(hgt), { srgb: false });
  const normalMap = normalFromHeight(hc.userData.canvas, 5);
  // roughness: cracks and streaks rougher, block faces a touch smoother
  const rough = canvasTex(W, W, (g, w, h) => {
    const img = g.createImageData(w, h), o = img.data;
    for (let i = 0; i < w * h * 4; i += 4) { const v = 255 - hgt[i] * 0.35; o[i] = o[i + 1] = o[i + 2] = v; o[i + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
  return { map, normalMap, rough };
}

// dry-grass detail for the cutting tops (luminance around 1)
function grassDetail() {
  return canvasTex(256, 256, (g, w, h) => {
    const img = g.createImageData(w, h), o = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = 0.72 + 0.3 * pnoise(x / 3, y / 9, 85.33, 5) + 0.18 * (pnoise(x / 20, y / 20, 12.8, 6) - 0.5);
      const i = (y * w + x) * 4; o[i] = 255 * v; o[i + 1] = 240 * v; o[i + 2] = 200 * v; o[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}

function buildCuttings(env) {
  const { path, world, group, terrain } = env;
  const ROWS = [0, 0.04, 0.1, 0.17, 0.24, 0.32, 0.4, 0.48, 0.56, 0.64, 0.72, 0.79, 0.86, 0.92, 0.96, 1];
  const TOPD = [0, 0.5, 1.3, 2.6, 4.5, 7, 10.5, 15, 21, 28];
  const fP = [], fN = [], fU = [], fC = [], fI = [];
  const tP = [], tU = [], tC = [], tI = [];
  const v = new THREE.Vector3(), col = new THREE.Color(), soil = new THREE.Color(0x5e3b28), dust = new THREE.Color(0xc9a77c);
  for (const c of CUTS) {
    const vOff = c.a * 0.013;
    const base0 = fP.length / 3, base1 = tP.length / 3;
    let rowsN = 0;
    for (let s = c.a; s <= c.b + 1e-6; s += 0.7) {
      rowsN++;
      const H = cutH(c, s), road = path.roadY(s);
      // face: foot buried a little below the verge, leaning back, strata ledges
      const pts = [[D0 - 0.35, -0.35]];
      for (const t of ROWS) {
        const yy = t * H;
        // blocky relief: broad bulges + blast-scar hollows + small ledges (never at the buried foot)
        const led = t === 0 ? 0 : 0.45 * fbm(s * 0.11 + c.a, yy * 0.32, 4) + 0.22 * Math.abs(fbm(s * 0.45, yy * 0.9 + 3, 2))
          + 0.1 * Math.round(fbm(s * 0.2 + 9, yy * 1.3, 2) * 3);
        const crumble = t > 0.9 ? 0.25 * fbm(s * 0.3, 7.7, 2) : 0;
        pts.push([D0 + yy * BATTER + led + crumble + (t === 0 ? 0 : 0.05), yy + (t === 0 ? -0.05 : 0)]);
      }
      const ground0 = world.heightSL(s, c.side * D0) - road;
      pts[1][1] = Math.min(pts[1][1], ground0 - 0.05);
      for (let j = 0; j < pts.length; j++) {
        const [d, y] = pts[j];
        path.toWorld(s, c.side * d, v);
        fP.push(v.x, road + y, v.z);
        fU.push(s / 7, (y + s * 0.02) / 7 + vOff);
        // tone: dusty at the foot, topsoil at the brow, broad mottling
        const t = j === 0 ? 0 : ROWS[j - 1];
        const m = 0.82 + 0.25 * fbm(s * 0.04 + c.a, y * 0.2, 3);
        col.setRGB(m, m * 0.98, m * 0.95);
        col.lerp(dust, smoothstep(0.9, 0, y) * 0.35);
        if (H > 0.5) col.lerp(soil, smoothstep(H - 0.9, H - 0.2, y) * 0.8);
        fC.push(col.r, col.g, col.b);
      }
      // top: grassed, falling back into the hillside
      const db = pts[pts.length - 1][0];
      for (let j = 0; j < TOPD.length; j++) {
        const d = db + TOPD[j];
        let y = j === 0 ? H : Math.max(env.cutTop(s, c.side * d) - road, -3);
        if (j === 1) y += 0.12;
        if (j === TOPD.length - 1) y = Math.min(y, world.heightSL(s, c.side * d) - road - 0.6);
        path.toWorld(s, c.side * d, v);
        tP.push(v.x, road + y, v.z);
        tU.push(s / 4, d / 4);
        terrain.groundColor(s, c.side * d, road + y, j < 2 ? 0.5 : 0.1, col);
        if (j === 0) col.lerp(soil, 0.6);
        tC.push(col.r, col.g, col.b);
      }
    }
    const nf = ROWS.length + 1, nt = TOPD.length;
    for (let r = 0; r < rowsN - 1; r++) {
      for (let j = 0; j < nf - 1; j++) {
        const a = base0 + r * nf + j, b = a + nf;
        if (c.side < 0) fI.push(a, b, a + 1, b, b + 1, a + 1); else fI.push(a, a + 1, b, b, a + 1, b + 1);
      }
      for (let j = 0; j < nt - 1; j++) {
        const a = base1 + r * nt + j, b = a + nt;
        if (c.side < 0) tI.push(a, b, a + 1, b, b + 1, a + 1); else tI.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  const tex = strataTextures();
  const face = new THREE.BufferGeometry();
  face.setAttribute('position', new THREE.Float32BufferAttribute(fP, 3));
  face.setAttribute('uv', new THREE.Float32BufferAttribute(fU, 2));
  face.setAttribute('color', new THREE.Float32BufferAttribute(fC, 3));
  face.setIndex(fI); face.computeVertexNormals();
  const faceMat = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(1.4, 1.4),
    roughnessMap: tex.rough, roughness: 1, vertexColors: true, side: THREE.DoubleSide });
  const fm = new THREE.Mesh(face, faceMat); fm.name = 'hills:cut-face'; fm.receiveShadow = fm.castShadow = true;
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(tP, 3));
  top.setAttribute('uv', new THREE.Float32BufferAttribute(tU, 2));
  top.setAttribute('color', new THREE.Float32BufferAttribute(tC, 3));
  top.setIndex(tI); top.computeVertexNormals();
  const tm = new THREE.Mesh(top, new THREE.MeshStandardMaterial({ map: grassDetail(), vertexColors: true, roughness: 1 }));
  tm.name = 'hills:cut-top'; tm.receiveShadow = true;
  group.add(fm, tm);
}

/* ---------- 2–4. trees (shared flora kit) ---------- */

// plant() grounds on world.heightSL, so keep its instances off the raised cutting tops,
// off the rock faces and clear of the barrier line.
function freeGround(env, s, lat) {
  return !env.inFace(s, lat) && !env.nearBarrier(s, lat) && env.cutTop(s, lat) < env.world.heightSL(s, lat) + 0.08;
}

// grove-clustered place fn: centres drawn once, members scattered round them (tighter near the core)
function groves(env, seed, { count, near, far, radius, fill = 0.8, side = 0 }) {
  const R = makeRng(seed), C = [];
  for (let i = 0; i < count; i++) {
    const sg = side || (R() < 0.5 ? -1 : 1);
    C.push({ s: env.s0 + R() * (env.s1 - env.s0), lat: sg * (near + Math.pow(R(), 0.9) * (far - near)), r: radius * (0.6 + 0.8 * R()) });
  }
  return (rng) => {
    const g = C[Math.floor(rng() * C.length)];
    const a = rng() * Math.PI * 2, d = g.r * Math.pow(rng(), fill);
    const s = g.s + Math.cos(a) * d, lat = g.lat + Math.sin(a) * d * 0.8;
    if (Math.sign(lat) !== Math.sign(g.lat) || Math.abs(lat) < near * 0.8) return null;
    return { s, lat };
  };
}

function buildTrees(env) {
  const { ctx, n, group } = env;
  const guard = (fn, extra) => (R, i) => {
    const p = fn(R, i);
    if (!p || p.s < env.s0 || p.s > env.s1 || !freeGround(env, p.s, p.lat)) return null;
    return extra ? extra(p, R) : { s: p.s, lateral: p.lat };
  };
  // Pinus kesiya plantations: dense even-aged groves up the slopes, a few strays
  const pineG = groves(env, 'hi-pine-g', { count: 26, near: 13, far: 190, radius: 26, fill: 0.7 });
  group.add(plant(ctx, { kind: 'pine', count: n(330), seed: 'hi-pine', scale: [0.85, 1.35],
    colors: [0x2f5230, 0x365a34, 0x2b4a2c, 0x44603a, 0x3a5634],
    place: guard(pineG, (p, R) => ({ s: p.s, lateral: p.lat, yaw: R() * 6.28,
      scale: (0.9 + 0.35 * (fbm(p.s * 0.02, p.lat * 0.02 + 40, 2) + 0.5)) * (0.85 + 0.25 * R()) })) }));
  // dry-deciduous broadleaves (teak / terminalia scrub-forest), olive to sun-yellowed
  const blG = groves(env, 'hi-bl-g', { count: 30, near: 9.5, far: 120, radius: 14, fill: 0.55 });
  group.add(plant(ctx, { kind: 'broadleaf', count: n(95), seed: 'hi-bl', scale: [0.8, 1.45],
    colors: [0x7d8a3c, 0x8f8a3a, 0x6f8036, 0x9a8a44, 0x78843a, 0xa89040], place: guard(blG) }));
}

/* ---------- 5–6. outcrops, scree, scrub, dry grass ---------- */

function buildGround(env) {
  const { ctx, n, group, world, path } = env;
  const guard = fn => (R, i) => { const p = fn(R, i); return p && freeGround(env, p.s, p.lat) ? { s: p.s, lateral: p.lat } : null; };
  // rock outcrops: clusters of half-buried boulders on the slopes
  const rockG = groves(env, 'hi-rock-g', { count: 34, near: 9, far: 150, radius: 5, fill: 0.5 });
  group.add(plant(ctx, { kind: 'boulder', count: n(150), seed: 'hi-rock', scale: [0.4, 2.4], sink: 0.55,
    colors: [0xc8b8a0, 0xb8a890, 0xa89a88, 0xc0a888, 0x9c9084], place: guard(rockG) }));
  // scrub (lantana / thorn bush) under and between groves and along the verges
  const scrubG = groves(env, 'hi-scrub-g', { count: 60, near: 7.4, far: 80, radius: 7, fill: 0.6 });
  group.add(plant(ctx, { kind: 'bush', count: n(320), seed: 'hi-scrub', scale: [0.5, 1.3],
    colors: [0x7a7a38, 0x8a8438, 0x6a7434, 0x9a8a44, 0x5f6a32, 0xa08a48], place: guard(scrubG) }));
  // golden grass: everywhere open, thickest on verges
  const RG0 = makeRng('hi-grass-d');
  group.add(plant(ctx, { kind: 'grass', count: n(2600), seed: 'hi-grass', scale: [1.0, 2.0],
    colors: [0xe8c070, 0xd8b060, 0xf0cc80, 0xc8a050, 0xdcb870],
    place: (R) => {
      const sg = R() < 0.5 ? -1 : 1, lat = sg * (6.4 + Math.pow(R(), 1.8) * 60), s = env.s0 + R() * (env.s1 - env.s0);
      if (fbm(s * 0.05, lat * 0.07 + 3, 2) < -0.2 || !freeGround(env, s, lat)) return null;
      return { s, lateral: lat };
    } }));

  // on the cutting tops (raised above heightSL) and at their feet: own instances grounded on gH
  const RC = makeRng('hi-cut'), topScrub = [], topGrass = [], scree = [];
  for (const c of CUTS) for (let s = c.a + 6; s < c.b - 6; s += 0.7 + RC() * 1.6) {
    const H = cutH(c, s); if (H < 0.8) continue;
    const brow = D0 + H * BATTER + 0.5;
    for (let q = 0; q < 3; q++) topGrass.push({ s: s + RC(), lat: c.side * (brow + 0.2 + Math.pow(RC(), 1.5) * 7),
      sc: [1.2 + RC(), 1.4 + 1.2 * RC(), 1.2 + RC()], yaw: RC() * 6.28, tint: [0xe8c070, 0xd8b060, 0xc8a050][q] });
    if (RC() < 0.35) topScrub.push({ s, lat: c.side * (brow + 0.6 + RC() * 6), sc: 0.6 + 0.6 * RC(), yaw: RC() * 6.28,
      tint: [0x7a7a38, 0x8a8438, 0x6a7434][Math.floor(RC() * 3)] });
    if (H > 1.2 && RC() < 0.55) scree.push({ s, lat: c.side * (D0 + 0.05 + RC() * 0.6), sc: [0.22 + 0.3 * RC(), 0.2 + 0.25 * RC(), 0.22 + 0.3 * RC()],
      yaw: RC() * 6.28, tint: [0xe0d4bc, 0xd0c4ac, 0xc8b89c][Math.floor(RC() * 3)], y: world.heightSL(s, c.side * D0) });
  }
  const sway = floraMaterial({ sway: true, rough: 0.85 });
  const m1 = instance(env, kindGeometry('grass'), sway, topGrass, 'cut-grass', { sink: 0.02 }); m1.castShadow = false;
  const m2 = instance(env, kindGeometry('bush'), sway, topScrub, 'cut-scrub', { sink: 0.1 }); m2.castShadow = false;
  instance(env, kindGeometry('boulder'), floraMaterial({ sway: false, rough: 0.92 }), scree, 'scree', { sink: 0.3 });
}

/* ---------- 7–11. roadside furniture ---------- */

// weathered paint / concrete grime (luminance ~0.7–1), shared by all furniture
let _grime = null;
function grimeTex() {
  return _grime || (_grime = canvasTex(256, 256, (g, w, h) => {
    const img = g.createImageData(w, h), o = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const streak = pnoise(x / 2.5, y / 40, 102.4, 8), blot = pnoise(x / 18, y / 18, 14.22, 9), fine = pnoise(x, y, 256, 10);
      let v = 0.94 - 0.2 * Math.max(0, streak - 0.55) * 2 - 0.16 * Math.max(0, blot - 0.6) * 2.5 + 0.08 * (fine - 0.5);
      if (y > h * 0.8) v -= (y / h - 0.8) * 0.6 * blot;        // splash dirt at the bottom
      const i = (y * w + x) * 4; o[i] = o[i + 1] = o[i + 2] = clamp(v, 0, 1) * 255; o[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }));
}

// non-indexed part with uv + flat vertex colour
function cpart(geo, color, { u0 = 0, v0 = 0, u1 = 1, v1 = 1 } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
  g.computeVertexNormals();
  const c = new THREE.Color(color), a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// sweep a 2D profile [[out, up], …] along the road at |lateral| = lat0 on one side
function sweep(env, a, b, side, lat0, profile, { step = 1, colorAt = null, heightAt = null } = {}) {
  const { path } = env, P = [], C = [], UV = [], v = new THREE.Vector3(), c = new THREE.Color(0xffffff);
  const ring = s => {
    const base = heightAt ? heightAt(s) : path.roadY(s);
    return profile.map(([o, up]) => { path.toWorld(s, side * (lat0 + o), v); return [v.x, base + up, v.z]; });
  };
  let r0 = ring(a);
  for (let s = a; s < b - 1e-6; s += step) {
    const s2 = Math.min(b, s + step), r1 = ring(s2);
    if (colorAt) colorAt(s, c);
    for (let j = 0; j < profile.length - 1; j++) {
      const q = [r0[j], r1[j], r1[j + 1], r0[j], r1[j + 1], r0[j + 1]];
      const uv = [[s, j], [s2, j], [s2, j + 1], [s, j], [s2, j + 1], [s, j + 1]];
      q.forEach((p, i) => { P.push(...p); C.push(c.r, c.g, c.b); UV.push(uv[i][0] / 3, uv[i][1] / profile.length); });
    }
    r0 = r1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.computeVertexNormals();
  return g;
}

function buildBarriers(env) {
  const { path, world, group } = env;
  const grime = grimeTex();
  // W-beam: two bulges facing the road; o = metres toward the valley, up = height
  const W = [[0.0, 0.44], [-0.07, 0.49], [-0.07, 0.55], [-0.02, 0.6], [-0.07, 0.65], [-0.07, 0.71], [0.0, 0.76], [0.02, 0.76], [0.02, 0.44], [0.0, 0.44]];
  const rails = [], posts = [], blocks = [];
  for (const B of BARRIERS) {
    const ground = s => world.heightSL(s, B.side * (BAR_LAT + 0.15));
    if (B.kind === 'beam') {
      // flared ends ramp down to the ground over 4 m
      const h = s => ground(s) - (1 - smoothstep(B.a, B.a + 4, s) * smoothstep(B.b, B.b - 4, s)) * 0.62;
      rails.push(sweep(env, B.a, B.b, B.side, BAR_LAT, W, { step: 0.5, heightAt: h,
        // painted in alternating 2 m yellow / black sections, the paint worn in places
        colorAt: (s, c) => c.set(Math.floor(s / 2) % 2 ? 0xd8a818 : 0x1c1c1a).multiplyScalar(0.85 + 0.25 * (fbm(s * 0.7, 3.3, 2) + 0.5)) }));
      for (let s = B.a + 2; s <= B.b - 2; s += 2) {
        posts.push({ s, lat: B.side * (BAR_LAT + 0.12), y: ground(s) - 0.35, sc: 1, tint: 0x9a9c98 });
      }
    } else {
      for (let s = B.a; s <= B.b; s += 1.25) {
        blocks.push({ s, lat: B.side * (BAR_LAT + 0.1), y: ground(s) - 0.12, sc: 1,
          tint: Math.round(s / 1.25) % 2 ? 0xe4b82a : 0x222220, yaw: 0 });
      }
    }
  }
  if (rails.length) {
    const rail = new THREE.Mesh(mergeGeo(rails), new THREE.MeshStandardMaterial({ color: 0xffffff, map: grime, vertexColors: true,
      metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide }));
    rail.name = 'hills:w-beam'; rail.castShadow = rail.receiveShadow = true;
    group.add(rail);
  }
  const post = new THREE.BoxGeometry(0.1, 1.15, 0.16); post.translate(0, 0.575, 0);
  instance(env, post, new THREE.MeshStandardMaterial({ map: grime, roughness: 0.7, metalness: 0.2 }), posts, 'barrier-posts', { headingYaw: true });
  const blk = new THREE.BoxGeometry(0.45, 0.62, 1.15, 1, 2, 2);
  const p = blk.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.82); } // battered sides
  blk.translate(0, 0.31, 0); blk.computeVertexNormals();
  instance(env, blk, new THREE.MeshStandardMaterial({ map: grime, roughness: 0.92 }), blocks, 'parapet', { headingYaw: true });
}

// sign + milestone atlas (1024×512): row 0 = four 256² sign faces, row 1 = stone faces + post stripes
function signAtlas() {
  return canvasTex(1024, 512, (g) => {
    g.fillStyle = '#8f9290'; g.fillRect(0, 0, 1024, 512);
    const tri = (x, draw) => {
      g.save(); g.translate(x, 0);
      g.fillStyle = '#9a9c9a'; g.fillRect(0, 0, 256, 256);
      g.beginPath(); g.moveTo(128, 14); g.lineTo(246, 234); g.lineTo(10, 234); g.closePath();
      g.fillStyle = '#c8281e'; g.fill();
      g.beginPath(); g.moveTo(128, 58); g.lineTo(212, 214); g.lineTo(44, 214); g.closePath();
      g.fillStyle = '#f4f1e8'; g.fill();
      g.strokeStyle = '#141414'; g.fillStyle = '#141414'; g.lineWidth = 13; g.lineCap = 'round'; g.lineJoin = 'round';
      draw(); g.restore();
    };
    const arrowHead = (x, y, ang) => {
      g.save(); g.translate(x, y); g.rotate(ang); g.beginPath(); g.moveTo(0, -18); g.lineTo(16, 8); g.lineTo(-16, 8); g.closePath(); g.fill(); g.restore();
    };
    // 0: curve to the right, 1: curve to the left, 3: hairpin right
    tri(0, () => { g.beginPath(); g.moveTo(112, 205); g.lineTo(112, 150); g.quadraticCurveTo(112, 120, 140, 104); g.stroke(); arrowHead(146, 100, 1.0); });
    tri(256, () => { g.beginPath(); g.moveTo(144, 205); g.lineTo(144, 150); g.quadraticCurveTo(144, 120, 116, 104); g.stroke(); arrowHead(110, 100, -1.0); });
    tri(768, () => { g.beginPath(); g.moveTo(106, 205); g.lineTo(106, 125); g.arc(128, 125, 22, Math.PI, 0); g.lineTo(150, 170); g.stroke(); arrowHead(150, 180, Math.PI); });
    // 2: chevron board — black arrows on yellow, pointing left
    g.fillStyle = '#e6b820'; g.fillRect(512, 0, 256, 256);
    g.fillStyle = '#161616';
    for (const cx of [590, 690]) { g.beginPath(); g.moveTo(cx - 40, 128); g.lineTo(cx + 20, 40); g.lineTo(cx + 60, 40); g.lineTo(cx, 128); g.lineTo(cx + 60, 216); g.lineTo(cx + 20, 216); g.closePath(); g.fill(); }
    g.strokeStyle = '#161616'; g.lineWidth = 10; g.strokeRect(517, 5, 246, 246);
    // row 1: milestones — white slab, yellow dome, black letters (240 px wide each)
    const stone = (x, top, big) => {
      g.fillStyle = '#efece4'; g.fillRect(x, 256, 240, 256);
      g.fillStyle = '#e7b31c'; g.fillRect(x, 256, 240, 96);
      g.fillStyle = '#151515'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 34px Arial, sans-serif'; if (top) g.fillText(top, x + 120, 318);
      g.font = 'bold 40px Arial, sans-serif'; g.fillText(big[0], x + 120, 392);
      g.font = 'bold 72px Arial, sans-serif'; g.fillText(big[1], x + 120, 458);
    };
    stone(0, '', ['ARAKU', '24']);
    stone(240, '', ['VIZAG', '87']);
    stone(480, '', ['', '2']);
    stone(720, '', ['', '4']);
    // post stripes (black / white bands) at x 960–1024
    for (let y = 256; y < 512; y += 32) { g.fillStyle = ((y - 256) / 32) % 2 ? '#141414' : '#eeeeea'; g.fillRect(960, y, 64, 32); }
    // light weathering over everything
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(90,80,60,${Math.random() * 0.06})`; g.fillRect(Math.random() * 1024, Math.random() * 512, 3, 3 + Math.random() * 10); }
  }, { repeat: false });
}
const AT = (x0, y0, x1, y1) => ({ u0: x0 / 1024, u1: x1 / 1024, v0: 1 - y1 / 512, v1: 1 - y0 / 512 });

function buildSigns(env) {
  const { path, world, group } = env;
  const parts = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), e = new THREE.Euler();
  const place = (geo, s, lat, yaw, y) => {
    path.toWorld(s, lat, v); v.y = y ?? world.heightSL(s, lat);
    q.setFromEuler(e.set(0, path.sample(s).heading + yaw, 0));
    geo.applyMatrix4(m.compose(v, q, new THREE.Vector3(1, 1, 1)));
    parts.push(geo);
  };
  const POST = AT(962, 258, 1022, 510);
  const signPost = (h) => { const g = new THREE.CylinderGeometry(0.038, 0.038, h, 8, 1, true); g.translate(0, h / 2 - 0.3, 0);
    return cpart(g, 0xffffff, { ...POST, v1: POST.v0 + (POST.v1 - POST.v0) * Math.min(1, h / 2.4) }); };
  // triangle warning sign: 0.9 m side, face toward oncoming (+s) traffic
  const tri = (slot) => {
    const g = new THREE.BufferGeometry(), r = 0.9 / Math.sqrt(3), cy = 2.35;
    const P = [0, cy + r, 0, -0.45, cy - r / 2, 0, 0.45, cy - r / 2, 0];
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    const x0 = slot * 256;
    g.setAttribute('uv', new THREE.Float32BufferAttribute([(x0 + 128) / 1024, 1 - 14 / 512, (x0 + 10) / 1024, 1 - 234 / 512, (x0 + 246) / 1024, 1 - 234 / 512], 2));
    const back = g.clone(); back.index = null; back.scale(-1, 1, 1); back.translate(0, 0, -0.012);
    back.setAttribute('uv', new THREE.Float32BufferAttribute([0.99, 0.99, 0.99, 0.99, 0.99, 0.99], 2));
    // face +z of the placed frame = toward the approaching car; the grey back sits behind it
    return [cpart(g, 0xffffff, {}), cpart(back, 0x8a8a88, {})];
  };
  const warn = (s, lat, slot, flip = 0) => { for (const g of [...tri(slot), signPost(2.3)]) place(g, s, lat, 0.25 * Math.sign(lat) * -1 + flip); };
  warn(1352, -6.3, 1);            // left curve ahead (uphill, cut on the left)
  warn(1575, -6.3, 0);            // right curve ahead
  warn(1655, -6.3, 3);            // tight right bend
  warn(1492, 6.3, 0, Math.PI);    // for downhill traffic: we see its back
  // chevrons along the outside of the bends, on the barrier line
  for (const B of BARRIERS) {
    if (B.kind !== 'beam') continue;
    for (let s = B.a + 8; s < B.b - 6; s += 14) {
      const g = new THREE.PlaneGeometry(0.6, 0.75); g.translate(0, 1.55, 0);
      const flipU = B.side > 0 ? AT(512, 0, 768, 256) : AT(768, 0, 512, 256);   // arrow points into the bend
      const face = cpart(g, 0xffffff, flipU);
      const bk = new THREE.PlaneGeometry(0.6, 0.75); bk.translate(0, 1.55, -0.01);
      place(face, s, B.side * (BAR_LAT + 0.45), -0.3 * B.side);
      place(cpart(bk, 0x7a7c7a, { u0: 0.99, u1: 0.995, v0: 0.99, v1: 0.995 }), s, B.side * (BAR_LAT + 0.45), -0.3 * B.side);
      place(signPost(1.9), s, B.side * (BAR_LAT + 0.45), 0);
    }
  }
  // milestones: 0.5 × 0.8 m slab with a round top (km), 0.3 × 0.48 m (200 m stones)
  const stone = (slot, s, lat, w, hgt) => {
    const sh = new THREE.Shape(); const r = w / 2;
    sh.moveTo(-r, -0.15); sh.lineTo(r, -0.15); sh.lineTo(r, hgt - r); sh.absarc(0, hgt - r, r, 0, Math.PI, false); sh.lineTo(-r, -0.15);
    const g = new THREE.ExtrudeGeometry(sh, { depth: w * 0.4, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1, curveSegments: 10 });
    g.translate(0, 0, -w * 0.2);
    const uv = g.attributes.uv, p = g.attributes.position, nz = g.attributes.normal;
    g.computeVertexNormals();
    for (let i = 0; i < uv.count; i++) {
      const x = p.getX(i), y = p.getY(i), front = Math.abs(g.attributes.normal.getZ(i)) > 0.7;
      const fx = front ? (x / w + 0.5) : 0.5, fy = (y + 0.15) / (hgt + 0.15);
      uv.setXY(i, (slot * 240 + 10 + fx * 220) / 1024, 1 - (512 - fy * 256) / 512);
    }
    place(cpart(g, 0xffffff), s, lat, Math.sign(lat) * 0.2);
  };
  stone(0, 1346, -6.2, 0.5, 0.8);
  stone(1, 1346.6, 6.2, 0.5, 0.8);
  stone(2, 1546, -6.2, 0.3, 0.48);
  const mat = new THREE.MeshStandardMaterial({ map: signAtlas(), vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(mergeGeo(parts), mat);
  mesh.name = 'hills:signs'; mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
}

// PSC concrete pole (tapered rectangular), steel crossarm, three porcelain pin insulators
function poleGeo() {
  const parts = [];
  const shaft = new THREE.BoxGeometry(0.2, 9.0, 0.15, 1, 6, 1);
  const p = shaft.attributes.position;
  for (let i = 0; i < p.count; i++) { const t = (p.getY(i) + 4.5) / 9; p.setX(i, p.getX(i) * (1 - 0.45 * t)); p.setZ(i, p.getZ(i) * (1 - 0.35 * t)); }
  shaft.translate(0, 4.5 - 1.0, 0);
  parts.push(cpart(shaft, 0xb3aea4));
  const arm = new THREE.BoxGeometry(1.6, 0.08, 0.08); arm.translate(0, 7.55, 0.1);
  parts.push(cpart(arm, 0x4c4038));
  const brace = new THREE.BoxGeometry(0.04, 0.9, 0.04); brace.rotateZ(0.75); brace.translate(0.3, 7.25, 0.1);
  parts.push(cpart(brace, 0x4c4038));
  for (const [x, y] of [[-0.72, 7.6], [0.72, 7.6], [0, 8.0]]) {
    const ins = new THREE.CylinderGeometry(0.035, 0.055, 0.16, 8); ins.translate(x, y + 0.08, 0.1);
    parts.push(cpart(ins, 0xd9d6cc));
  }
  return mergeGeo(parts);
}
const POLE_ATTACH = [[-0.72, 7.78], [0.72, 7.78], [0, 8.18]];

function buildPoles(env) {
  const { path, group, gH } = env;
  // run on the valley side, crossing the road once (s 1525 → 1565)
  const poles = [];
  for (let s = 1326; s <= 1528; s += 40) poles.push({ s, lat: 7.8 });
  for (let s = 1566; s <= 1728; s += 41) poles.push({ s, lat: -7.9 });
  for (const P of poles) { P.y = gH(P.s, P.lat); P.yaw = 0; P.sc = 1; P.tint = 0xffffff; }
  const mat = new THREE.MeshStandardMaterial({ map: grimeTex(), vertexColors: true, roughness: 0.85 });
  instance(env, poleGeo(), mat, poles, 'poles', { headingYaw: true });
  // conductors: catenary sag, thin triangular tubes
  const P3 = [], a = new THREE.Vector3(), b = new THREE.Vector3(), r = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const attach = (P, k, out) => {
    const smp = path.sample(P.s); path.toWorld(P.s, P.lat, out);
    out.addScaledVector(smp.right, POLE_ATTACH[k][0]).addScaledVector(smp.fwd, -0.1); out.y = P.y + POLE_ATTACH[k][1]; return out;
  };
  const R = 0.016, SEG = 18, side = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (let i = 0; i < poles.length - 1; i++) for (let k = 0; k < 3; k++) {
    attach(poles[i], k, a); attach(poles[i + 1], k, b);
    const L = a.distanceTo(b), sag = 0.012 * L + 0.1 * k;
    const dir = r.subVectors(b, a).normalize(); side.crossVectors(dir, up).normalize(); nrm.crossVectors(side, dir);
    const ring = t => {
      const c = a.clone().lerp(b, t); c.y -= 4 * sag * t * (1 - t);
      return [0, 1, 2].map(j => { const ang = j / 3 * Math.PI * 2; return c.clone().addScaledVector(side, Math.cos(ang) * R).addScaledVector(nrm, Math.sin(ang) * R); });
    };
    let r0 = ring(0);
    for (let q = 1; q <= SEG; q++) {
      const r1 = ring(q / SEG);
      for (let j = 0; j < 3; j++) { const j2 = (j + 1) % 3; P3.push(...r0[j].toArray(), ...r1[j].toArray(), ...r1[j2].toArray(), ...r0[j].toArray(), ...r1[j2].toArray(), ...r0[j2].toArray()); }
      r0 = r1;
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P3, 3)); g.computeVertexNormals();
  const wires = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3a3836, metalness: 0.6, roughness: 0.45 }));
  wires.name = 'hills:wires';
  group.add(wires);
}

function buildFurniture(env) { buildBarriers(env); buildSigns(env); buildPoles(env); }

/* ---------- 12. distant ridgelines ---------- */

function buildRidges(env) {
  const { path, group } = env;
  const C = path.toWorld(1540, 0), h0 = path.sample(1540).heading, baseY = path.roadY(1540);
  const P = [], Cc = [], I = [];
  const LAYERS = [
    { R: 420, H: 55, col: 0x55603f, f: 3.0, seed: 1 },
    { R: 700, H: 95, col: 0x5a6250, f: 2.2, seed: 2 },
    { R: 1150, H: 150, col: 0x66697a, f: 1.6, seed: 3 }
  ];
  const col = new THREE.Color(), dark = new THREE.Color();
  for (const L of LAYERS) for (const sd of [-1, 1]) {
    const seg = 240, base = P.length / 3;
    for (let i = 0; i <= seg; i++) {
      // flanking arcs only (30°–150° off the road), so nothing stands across the dam ahead
      const t = i / seg, ang = h0 + sd * Math.PI * (0.16 + 0.68 * t);
      const dx = -Math.sin(ang), dz = -Math.cos(ang);
      const u = t * L.f * 3 + (sd > 0 ? 40 : 0);
      // rounded Ghats skyline: broad swells + ridged (1-|n|) spurs + fine crest roughness, no plateaus
      const broad = fbm(u * 0.8 + L.seed * 10, L.seed, 3) + 0.5;
      const spur = 1 - Math.abs(fbm(u * 2.2 + 7 * L.seed, 3 + L.seed, 4)) * 2;
      const ridge = 0.25 + 0.55 * broad + 0.3 * spur * spur + 0.04 * fbm(u * 14, L.seed, 2);
      const taper = smoothstep(0, 0.18, t) * smoothstep(1, 0.82, t);   // arc ends sink out of sight
      const top = baseY - 60 + (48 + L.H * Math.max(0.12, ridge)) * taper;
      const rr = L.R * (1 + 0.08 * fbm(u * 2, 5 + L.seed, 2));
      P.push(C.x + dx * rr, top, C.z + dz * rr, C.x + dx * rr * 0.98, baseY - 70, C.z + dz * rr * 0.98);
      col.set(L.col).multiplyScalar(0.9 + 0.2 * fbm(u * 6, L.seed, 3)); dark.set(L.col).multiplyScalar(0.7);
      Cc.push(col.r, col.g, col.b, dark.r, dark.g, dark.b);
      if (i < seg) { const a = base + i * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
  g.setIndex(I); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  m.name = 'hills:ridges'; m.frustumCulled = false;
  group.add(m);
}
