/* Zone 'dam' — "Dawat by the Manair": the road rides the crest of the Lower
 * Manair dam (Karimnagar) at sunset, then pulls up at AMR Unnati Convention,
 * which stands at road level on the right just past the far end of the dam.
 *
 * Objects (road frame: +lateral = right of travel; reservoir left, valley right):
 *  DAM
 *   1. Downstream face: concrete ribbon on the 'drop' terrain (ogee-like curve
 *      from crest to toe), lift joints + water streaks, bump-mapped.
 *   2. Upstream face: stone pitching (riprap) from the crest down under the
 *      reservoir, with a concrete coping strip where it meets the footpath.
 *   3. Crest: raised footpaths with painted black/white kerbs both sides.
 *   4. Crest parapets: continuous walls (no segment gaps), whitewashed, with
 *      expansion joints every 15 m and a steel pipe railing on posts above.
 *   5. Abutments: masonry entry pillars with caps at both ends of the crest on
 *      both sides, and wing walls turning down into the ground.
 *   6. Spillway: bays between rounded-nose piers (2.8 m thick) that run from
 *      the reservoir under the road and down the downstream face as divide walls.
 *   7. Radial gates: curved steel skin plates between the piers, two arms per
 *      gate to trunnions on the piers; two gates part-open and spilling.
 *   8. Hoist gantry: a deck on tall pier heads above the gates with a hoist
 *      house per bay.
 *   9. Spill sheets: animated white water down the ogee of the open bays.
 *  10. Stilling basin at the toe: walls, end sill and churning foam water.
 *  11. Control tower on the reservoir side with an access bridge.
 *  12. Highway sodium street lamps: tapered octagonal poles, outreach arm,
 *      cobra-head luminaires, orange pools of light on the road at dusk.
 *  13. Dam name board at the start of the crest.
 *  SETTING
 *  14. Reservoir (makeWater 'lake') and hazy hills on the far shore.
 *  15. River leaving the stilling basin across the valley (makeWater 'creek').
 *  16. Paddy fields with bunds on the valley floor; valley trees (instanced).
 *  VENUE: AMR Unnati Convention (STOPS[1].venue, road level, right side)
 *  17. Level lot pad with retaining skirt where the ground falls away.
 *  18. Boundary wall along the road and around the lot, with coping.
 *  19. Entrance gate: two pillars with lamp globes, arch board, open gates.
 *  20. Hall: columned portico (porte-cochère), glass curtain wall between
 *      pilasters, side walls, flat roof with parapet, fascia signage.
 *  21. Parking: paved court with stall lines, a few parked cars.
 *  22. Lawn: grass, string lights on poles, lantern posts, a lit mandap.
 *  23. Palms and shrubs around the hall (flora kit).
 *
 * Contract: export default { id, build(ctx) → {group, update?(dt, s, cam), dispose?()} }.
 */
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/addons/utils/BufferGeometryUtils.js';
import { makeWater } from './water.js';
import { plant } from './flora.js';
import { STOPS } from '../core/timeline.js';
import { fbm, hash2, smoothstep, rng as makeRng } from '../core/noise.js';

const FLOOR = -16;           // valley floor (matches world.js 'drop')
const VENUE = STOPS[1].venue;

/* ---------- procedural textures ---------- */

function canvasTex(w, h, draw, repeat = true, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function speckle(g, w, h, r, n, base, spread, a) {
  for (let i = 0; i < n; i++) {
    const v = base + r() * spread | 0;
    g.fillStyle = `rgba(${v},${v - 5},${v - 14},${a * r()})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

// weathered concrete: warm grey, speckle, form-panel lift lines, dark water streaks
function concreteTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#b0a898'; g.fillRect(0, 0, w, h);
    const r = makeRng('concrete');
    speckle(g, w, h, r, 16000, 140, 70, 0.28);
    for (let i = 0; i < 50; i++) {
      g.fillStyle = `rgba(${90 + r() * 40 | 0},${88 + r() * 30 | 0},${80 + r() * 20 | 0},${0.05 + 0.07 * r()})`;
      g.beginPath(); g.arc(r() * w, r() * h, 10 + r() * 50, 0, 7); g.fill();
    }
    g.fillStyle = 'rgba(60,55,48,0.4)';
    for (let y = 0; y < h; y += 128) g.fillRect(0, y, w, 3);
    g.fillStyle = 'rgba(60,55,48,0.2)';
    for (let x = 0; x < w; x += 256) g.fillRect(x, 0, 2, h);
    for (let i = 0; i < 55; i++) {
      const x = r() * w, y0 = r() * h, len = 40 + r() * 300, wd = 1 + r() * 7, dark = r() < 0.8;
      const gr = g.createLinearGradient(0, y0, 0, y0 + len);
      gr.addColorStop(0, dark ? 'rgba(48,44,38,0.2)' : 'rgba(235,230,215,0.25)');
      gr.addColorStop(1, 'rgba(48,44,38,0)');
      g.fillStyle = gr; g.fillRect(x, y0, wd, len);
      if (y0 + len > h) g.fillRect(x, y0 - h, wd, len);
    }
  });
}

// stone pitching: irregular dressed stones in grey mortar, shaded edges
function riprapTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#5b544b'; g.fillRect(0, 0, w, h);
    const r = makeRng('riprap');
    for (let y = 0; y < h; y += 24) {
      let x = -r() * 30;
      while (x < w) {
        const sw = 22 + r() * 34, sh = 20 + r() * 8, v = 100 + r() * 60 | 0, cx = x + sw / 2, cy = y + 12 + (r() - 0.5) * 4;
        const pts = []; const n = 5 + (r() * 3 | 0), a0 = r() * 6.28;
        for (let k = 0; k < n; k++) { const a = a0 + k / n * 6.283 + (r() - 0.5) * 0.5, rr = 0.8 + 0.2 * r(); pts.push([Math.cos(a) * sw / 2 * rr, Math.sin(a) * sh / 2 * rr]); }
        const tone = `rgb(${v},${v - 5 | 0},${v - 14 | 0})`, lit = `rgba(255,240,215,${0.05 + 0.06 * r()})`;
        for (const dx of [0, -w, w]) {
          g.fillStyle = tone; g.beginPath(); pts.forEach(([px, py], k) => k ? g.lineTo(cx + dx + px, cy + py) : g.moveTo(cx + dx + px, cy + py)); g.closePath(); g.fill();
          g.fillStyle = lit; g.beginPath(); pts.forEach(([px, py], k) => k ? g.lineTo(cx + dx + px * 0.7 - 2, cy + py * 0.6 - 3) : g.moveTo(cx + dx + px * 0.7 - 2, cy + py * 0.6 - 3)); g.closePath(); g.fill();
        }
        x += sw - 2;
      }
    }
    speckle(g, w, h, r, 9000, 80, 90, 0.35);
  });
}

// whitewashed parapet: lime wash over concrete, dirt at the foot, joint at u=0
function parapetTex() {
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#e4ddcf'; g.fillRect(0, 0, w, h);
    const r = makeRng('parapet');
    speckle(g, w, h, r, 3000, 170, 70, 0.3);
    const gr = g.createLinearGradient(0, h, 0, h * 0.4);
    gr.addColorStop(0, 'rgba(70,60,50,0.55)'); gr.addColorStop(1, 'rgba(70,60,50,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(40,36,32,0.8)'; g.fillRect(0, 0, 2, h);   // expansion joint
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 0, w, 4); // coping
  });
}

// kerb stones painted alternately black and white (1 m each, u in metres/2)
function kerbTex() {
  return canvasTex(64, 16, (g, w, h) => {
    g.fillStyle = '#e8e4da'; g.fillRect(0, 0, w / 2, h);
    g.fillStyle = '#1e1e1e'; g.fillRect(w / 2, 0, w / 2, h);
    const r = makeRng('kerb'); speckle(g, w, h, r, 300, 80, 120, 0.4);
  });
}
// footpath slabs: cast concrete, 2 m panels (joint at u=0), dust and scuffs
function pathTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#9d978c'; g.fillRect(0, 0, w, h);
    const r = makeRng('path'); speckle(g, w, h, r, 2500, 110, 80, 0.35);
    for (let i = 0; i < 12; i++) { g.fillStyle = `rgba(70,62,52,${0.05 + 0.08 * r()})`; g.beginPath(); g.arc(r() * w, r() * h, 6 + r() * 20, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(50,46,40,0.7)'; g.fillRect(0, 0, 2, h);
  });
}
// paddy: plots of young rice at different stages, earth bunds between them.
// One tile = 4 x 3 plots, ~96 x 72 m.
function paddyTex() {
  return canvasTex(512, 512, (g, w, h) => {
    const r = makeRng('paddy');
    const cols = ['#6f9a3a', '#83a843', '#5f8a34', '#9aab4c', '#7a9c3c', '#8fb050', '#a8a458', '#6b8f45'];
    g.fillStyle = '#7d6a4c'; g.fillRect(0, 0, w, h);
    const pw = w / 4, ph = h / 3;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const x = i * pw + 4, y = j * ph + 4, cw = pw - 8, ch = ph - 8;
      g.fillStyle = cols[r() * cols.length | 0]; g.fillRect(x, y, cw, ch);
      const wet = r() < 0.25; // flooded plot catching the sky
      if (wet) { g.fillStyle = 'rgba(200,170,150,0.35)'; g.fillRect(x, y, cw, ch); }
      g.strokeStyle = 'rgba(40,60,20,0.18)'; g.lineWidth = 1;
      for (let k = 0; k < ch; k += 3) { g.beginPath(); g.moveTo(x, y + k); g.lineTo(x + cw, y + k + (r() - 0.5)); g.stroke(); }
      speckle(g, cw, ch, r, 400, 60, 80, 0.15);
    }
    g.fillStyle = 'rgba(160,140,100,0.5)';
    for (let i = 0; i <= 4; i++) g.fillRect(i * pw - 2, 0, 4, h);
    for (let j = 0; j <= 3; j++) g.fillRect(0, j * ph - 2, w, 4);
  });
}

// curtain-wall glass: blue-grey panes, aluminium mullions, warm interior with chandeliers
function glassTex() {
  return canvasTex(512, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#6f7f93'); gr.addColorStop(0.5, '#a88f78'); gr.addColorStop(1, '#e0a868');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const r = makeRng('glass');
    for (let i = 0; i < 14; i++) { // chandeliers / downlights
      const x = r() * w, y = h * (0.15 + 0.3 * r());
      const rg = g.createRadialGradient(x, y, 0, x, y, 18 + r() * 14);
      rg.addColorStop(0, 'rgba(255,236,190,0.95)'); rg.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = rg; g.fillRect(x - 40, y - 40, 80, 80);
    }
    g.fillStyle = 'rgba(60,40,30,0.35)'; // silhouettes of chairs / people
    for (let i = 0; i < 60; i++) g.fillRect(r() * w, h * (0.72 + 0.2 * r()), 3 + r() * 4, 10 + r() * 16);
    g.fillStyle = '#9aa0a6';
    for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 4, h);
    for (const y of [0, h * 0.5, h - 4]) g.fillRect(0, y, w, 4);
  });
}

// churning foam for the stilling basin
function foamTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#8fa3a0'; g.fillRect(0, 0, w, h);
    const r = makeRng('foam');
    for (let i = 0; i < 700; i++) {
      const x = r() * w, y = r() * h, rad = 2 + r() * 14;
      g.fillStyle = `rgba(250,248,240,${0.25 + 0.6 * r()})`;
      for (const dx of [0, -w, w]) for (const dy of [0, -h, h]) { g.beginPath(); g.arc(x + dx, y + dy, rad, 0, 7); g.fill(); }
    }
  });
}

// lawn: mottled grass
function lawnTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#56803a'; g.fillRect(0, 0, w, h);
    const r = makeRng('lawn');
    for (let i = 0; i < 9000; i++) {
      const v = r();
      g.fillStyle = `rgba(${60 + v * 70 | 0},${100 + v * 60 | 0},${30 + v * 30 | 0},0.5)`;
      g.fillRect(r() * w, r() * h, 1, 2 + r() * 3);
    }
  });
}

// paving for the parking court: grey interlock pavers; stalls drawn at 2.5 m (u = s/10, v = lat/10)
function paveTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#8a857c'; g.fillRect(0, 0, w, h);
    const r = makeRng('pave');
    for (let y = 0; y < h; y += 8) for (let x = (y / 8 % 2) * 8; x < w; x += 16) {
      const v = 120 + r() * 30 | 0; g.fillStyle = `rgb(${v},${v - 4},${v - 10})`; g.fillRect(x + 1, y + 1, 14, 6);
    }
    g.fillStyle = 'rgba(245,245,235,0.9)';
    for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 5, h * 0.5);   // stall lines (2.5 m apart)
    g.fillRect(0, h * 0.5 - 3, w, 5);
  });
}

// plaster / ACP for the hall: warm cream with faint panel lines
function plasterTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#e9dfcc'; g.fillRect(0, 0, w, h);
    const r = makeRng('plaster'); speckle(g, w, h, r, 5000, 190, 60, 0.25);
    g.fillStyle = 'rgba(120,100,80,0.18)';
    for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 128) g.fillRect(0, y, w, 1);
  });
}

// signs atlas: dam board (top), venue fascia (middle), gate arch (bottom)
function signTex() {
  return canvasTex(1024, 384, (g, w, h) => {
    const b = h / 3;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#1d4a7a'; g.fillRect(0, 0, w, b);
    g.fillStyle = '#ffffff'; g.font = 'bold 54px Arial, sans-serif';
    g.fillText('LOWER MANAIR DAM', w / 2, b * 0.38);
    g.font = '30px Arial, sans-serif'; g.fillText('KARIMNAGAR  ·  I & CAD DEPT.', w / 2, b * 0.76);
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(8, 8, w - 16, b - 16);
    g.fillStyle = '#1c1a1c'; g.fillRect(0, b, w, b);
    g.fillStyle = '#ffd27a'; g.font = 'bold 78px Georgia, serif';
    g.shadowColor = '#ffb040'; g.shadowBlur = 16;
    g.fillText('AMR UNNATI CONVENTION', w / 2, b * 1.5 + 4);
    g.fillStyle = '#6a1424'; g.shadowBlur = 0; g.fillRect(0, 2 * b, w, b);
    g.fillStyle = '#ffe2a0'; g.font = 'bold 64px Georgia, serif';
    g.fillText('AMR UNNATI CONVENTION', w / 2, b * 2.42);
    g.font = '28px Georgia, serif'; g.fillText('WELCOME', w / 2, b * 2.8);
    g.strokeStyle = '#e8b85a'; g.lineWidth = 6; g.strokeRect(10, 2 * b + 10, w - 20, b - 20);
  }, false);
}
/* ---------- geometry helpers (road frame: +x = right/lateral, -z = forward/s) ---------- */

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

/** Place a geometry built in the local road frame at (s, lateral, y). */
function place(ctx, geo, s, lat, y, yaw = 0) {
  const h = ctx.path.sample(s).heading + yaw;
  ctx.path.toWorld(s, lat, _v); _v.y = y;
  _m.compose(_v, _q.setFromAxisAngle(_up, h), ONE);
  return geo.applyMatrix4(_m);
}

/** Box with UVs in metres / T (so the texture tiles at a constant scale). */
function box(w, h, d, T = 6) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0] / T, uv.getY(i) * dims[f][1] / T);
  }
  return g.toNonIndexed();
}

/** Cylinder (non-indexed) with UVs roughly in metres / T. */
function cyl(r0, r1, h, seg = 10, T = 4) {
  const g = new THREE.CylinderGeometry(r0, r1, h, seg);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6.28 * r1 / T, uv.getY(i) * h / T);
  return g.toNonIndexed();
}

/** Grid ribbon in road space: rows along s, columns across lats; yFn(s, lat, j) → world y.
 *  uvFn(s, lat, y, i, j) → [u, v]. colFn optional → THREE.Color. */
function ribbon(ctx, ss, lats, yFn, uvFn, colFn) {
  const pos = [], uv = [], col = [], idx = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < ss.length; i++) for (let j = 0; j < lats.length; j++) {
    const s = ss[i], l = lats[j], y = yFn(s, l, j);
    ctx.path.toWorld(s, l, p);
    pos.push(p.x, y, p.z);
    const t = uvFn(s, l, y, i, j); uv.push(t[0], t[1]);
    if (colFn) { const c = colFn(s, l, y); col.push(c.r, c.g, c.b); }
  }
  const C = lats.length;
  for (let i = 1; i < ss.length; i++) for (let j = 1; j < C; j++) {
    const a = (i - 1) * C + j - 1, b = a + 1, d = i * C + j - 1, e = d + 1;
    idx.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colFn) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Sweep an open profile along the road: prof(s) → [[lat, y], …] (continuous, so no
 *  gaps between segments on curves). u = s / U, v = distance along the profile / V. */
function sweep(ctx, ss, prof, U = 4, V = 4, flip = false) {
  const pos = [], uv = [], idx = [], p = new THREE.Vector3();
  let C = 0;
  for (let i = 0; i < ss.length; i++) {
    const pr = prof(ss[i]); C = pr.length;
    let acc = 0;
    for (let j = 0; j < C; j++) {
      if (j) acc += Math.hypot(pr[j][0] - pr[j - 1][0], pr[j][1] - pr[j - 1][1]);
      ctx.path.toWorld(ss[i], pr[j][0], p);
      pos.push(p.x, pr[j][1], p.z); uv.push(ss[i] / U, acc / V);
    }
  }
  for (let i = 1; i < ss.length; i++) for (let j = 1; j < C; j++) {
    const a = (i - 1) * C + j - 1, b = a + 1, d = i * C + j - 1, e = d + 1;
    if (flip) idx.push(a, d, b, b, d, e); else idx.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** Rectangular wall section for sweep: centred on lat, from y0 to y0+h, width w. */
const wallProf = (lat, w, y0, h) => [[lat - w / 2, y0 - 0.3], [lat - w / 2, y0 + h], [lat + w / 2, y0 + h], [lat + w / 2, y0 - 0.3]];

const range = (a, b, step) => { const o = []; for (let v = a; v < b; v += step) o.push(v); o.push(b); return o; };

/** Solid vertex colour for a geometry. */
function tint(g, hex, jitter = 0, seed = 1) {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  const k = jitter ? 1 - jitter * 0.5 + jitter * hash2(seed, 3.7) : 1;
  for (let i = 0; i < n; i++) { a[i * 3] = c.r * k; a[i * 3 + 1] = c.g * k; a[i * 3 + 2] = c.b * k; }
  g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3));
  return g;
}

/** Non-indexed merge keeping position/normal/uv/color (missing uv → 0, colour → white). */
function merge(list) {
  const clean = list.map(g => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) n.deleteAttribute(k);
    const N = n.attributes.position.count;
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(N * 2), 2));
    if (!n.attributes.color) n.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(N * 3).fill(1), 3));
    if (!n.attributes.normal) n.computeVertexNormals();
    return n;
  });
  return mergeGeometries(clean, false);
}

const TIER = { low: 0.45, med: 0.7, high: 1 };

/** Glow material: unlit, brightens as the sun goes down (see update). */
function glowMat(hex, extra = {}) {
  const m = new THREE.MeshBasicMaterial({ color: hex, ...extra });
  m.userData.base = new THREE.Color(hex);
  return m;
}

/** Catenary of points between a and b (world), sagging `sag` metres. */
function catenary(out, a, b, n, sag) {
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t), a.z + (b.z - a.z) * t);
  }
}
/*__PART4__*/

/* ---------- layout (road space) ---------- */

const CREST_A = 1746, CREST_B = 2186, RIP_B = 2166; // left pitching ends where the far bank rises        // abutments (crest ends)
const FOOT = [3.6, 5.4], PAR = 5.6, PAR_W = 0.4, PAR_H = 0.95;
const SP = { n: 5, bay: 12, pier: 2.8, c: 2020 }; // spillway: bays, clear width, pier thickness, centre s
SP.len = SP.n * SP.bay + (SP.n + 1) * SP.pier;
SP.a = SP.c - SP.len / 2; SP.b = SP.c + SP.len / 2;
const pierS = i => SP.a + SP.pier / 2 + i * (SP.bay + SP.pier);
const bayS = i => pierS(i) + (SP.bay + SP.pier) / 2;
const OPEN = [1, 3];                          // bays spilling
const TOE = 32, BASIN = [30, 46], RIVER = [52, 68];
const LOT = { s0: VENUE.s - 32, s1: VENUE.s + 46, l0: 8, l1: VENUE.lateral + 26 };

function makeMats() {
  const conc = concreteTex();
  const M = {
    conc: new THREE.MeshStandardMaterial({ map: conc, bumpMap: conc, bumpScale: 1.2, roughness: 0.92, vertexColors: true, side: THREE.DoubleSide }),
    riprap: new THREE.MeshStandardMaterial({ map: riprapTex(), roughness: 0.95, vertexColors: true, side: THREE.DoubleSide }),
    parapet: new THREE.MeshStandardMaterial({ map: parapetTex(), roughness: 0.85, side: THREE.DoubleSide }),
    kerb: new THREE.MeshStandardMaterial({ map: kerbTex(), roughness: 0.8, side: THREE.DoubleSide }),
    path: new THREE.MeshStandardMaterial({ map: pathTex(), roughness: 0.9, side: THREE.DoubleSide }),
    steel: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.45, roughness: 0.5, side: THREE.DoubleSide }),
    glow: glowMat(0xffffff, { vertexColors: true }),
    paddy: new THREE.MeshStandardMaterial({ map: paddyTex(), roughness: 0.9, vertexColors: true, side: THREE.DoubleSide }),
    hills: new THREE.MeshStandardMaterial({ roughness: 1, vertexColors: true, side: THREE.DoubleSide }),
    plaster: new THREE.MeshStandardMaterial({ map: plasterTex(), roughness: 0.8, vertexColors: true }),
    glass: new THREE.MeshStandardMaterial({ map: glassTex(), roughness: 0.15, metalness: 0.3, emissive: 0xffffff, emissiveIntensity: 0.4 }),
    pave: new THREE.MeshStandardMaterial({ map: paveTex(), roughness: 0.85 }),
    lawn: new THREE.MeshStandardMaterial({ map: lawnTex(), roughness: 0.95 }),
  };
  M.glass.emissiveMap = M.glass.map;
  const sign = signTex();
  M.sign = new THREE.MeshStandardMaterial({ map: sign, emissiveMap: sign, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.6 });
  M.lawn.map.repeat.set(1, 1);
  return M;
}

/* ---------- 1–4: dam body, crest, parapets ---------- */

function buildBody(ctx, M) {
  const { path, world } = ctx;
  const H = (s, l) => world.heightSL(s, l);
  const Y = s => path.roadY(s);
  const ss = range(CREST_A, CREST_B, 2);
  const out = { conc: [], riprap: [], parapet: [], kerb: [], steel: [], path: [] };

  // 1. downstream face draped on the 'drop' ground; the last column dips into the valley floor
  const dl = [5.5, 6, 6.6, 7.3, 8, 9, 10, 11, 12, 13.5, 15, 16.5, 18, 20, 22, 24, 26.5, 29, TOE, TOE + 1.5];
  const c = new THREE.Color();
  out.conc.push(ribbon(ctx, ss, dl, (s, l, j) => {
    const g = H(s, l);
    return j === dl.length - 1 ? g - 0.4 : j === 0 ? Y(s) + 0.1 : g + 0.18;
  }, (s, l, y) => [s / 6, (l + Y(s) - y) / 6], (s, l, y) => {
    const wet = smoothstep(0, -14, y - Y(s) + 6) * 0.25, n = fbm(s * 0.05, l * 0.1) * 0.08;
    return c.setRGB(1 - wet + n, 1 - wet + n, 0.97 - wet * 1.1 + n);
  }));

  // 2. upstream stone pitching down under the reservoir (water 2.0)
  const ul = [-5.5, -6.2, -7, -8.5, -10, -12, -14, -17, -20, -24, -28, -33, -38, -44, -46];
  const wl = 2.0;
  out.riprap.push(ribbon(ctx, range(CREST_A, RIP_B, 2), ul, (s, l, j) => {
    const g = H(s, l);
    return j === ul.length - 1 ? g - 0.5 : j === 0 ? Y(s) - 0.05 : g + 0.1;
  }, (s, l) => [s / 8, -l / 8], (s, l, y) => {
    const k = y < wl + 0.25 ? 0.55 : 1 - 0.25 * smoothstep(wl + 1.6, wl + 0.3, y); // wet band + silt below
    return c.setRGB(k, k * 0.97, k * 0.93);
  }));
  // coping strip where the pitching meets the crest
  out.conc.push(tint(sweep(ctx, range(CREST_A, RIP_B, 2), s => [[-5.8, Y(s) - 0.9], [-6.5, Y(s) - 0.2], [-6.5, Y(s) + 0.05], [-5.8, Y(s) + 0.05]], 6, 6), 0xd8d0c0));

  // 3. raised footpaths (concrete) + painted kerbs
  for (const sg of [-1, 1]) {
    const a = sg * FOOT[0], b = sg * FOOT[1];
    out.path.push(sweep(ctx, ss, s => [[a, Y(s) + 0.2], [b, Y(s) + 0.2], [sg * (PAR - PAR_W / 2), Y(s) + 0.2]], 2, 2, sg < 0));
    out.kerb.push(sweep(ctx, ss, s => [[a, Y(s) - 0.1], [a, Y(s) + 0.2], [a + sg * 0.2, Y(s) + 0.22]], 2, 0.3, sg > 0));
  }

  // 4. parapets: continuous walls with an expansion joint every 15 m (texture u=0), pipe railing above
  for (const sg of [-1, 1]) {
    const li = sg * (PAR - PAR_W / 2), lo = sg * (PAR + PAR_W / 2);
    const top = s => Y(s) + 0.2 + PAR_H;
    out.parapet.push(sweep(ctx, ss, s => [[li, Y(s) + 0.2], [li, top(s)]], 15, PAR_H + 0.3));
    out.parapet.push(sweep(ctx, ss, s => [[lo, Math.min(Y(s) - 0.6, H(s, lo + sg * 0.6) - 0.3)], [lo, top(s)]], 15, PAR_H + 0.3));
    out.conc.push(tint(sweep(ctx, ss, s => [[li - sg * 0.04, top(s)], [li - sg * 0.04, top(s) + 0.08], [lo + sg * 0.04, top(s) + 0.08], [lo + sg * 0.04, top(s)]], 6, 6), 0xf2eee6));
    // railing: posts every 2.5 m, two pipes
    const rails = [];
    for (let s = CREST_A + 1; s < CREST_B - 1; s += 2.5) {
      rails.push(place(ctx, cyl(0.03, 0.03, 0.6, 6), s, sg * PAR, top(s) + 0.38));
    }
    for (const dy of [0.36, 0.64]) rails.push(sweep(ctx, ss, s => {
      const y = top(s) + 0.08 + dy, r = 0.03; return [[sg * PAR - r, y - r], [sg * PAR - r, y + r], [sg * PAR + r, y + r], [sg * PAR + r, y - r], [sg * PAR - r, y - r]];
    }, 4, 4));
    out.steel.push(tint(merge(rails), 0x5a6068));
  }
  return out;
}

/* ---------- 6–10: spillway, radial gates, hoist gantry, spill, stilling basin ---------- */

const GATE = { LT: 17.5, R: 9, tb: 33 * Math.PI / 180, tt: 12 * Math.PI / 180, lift: 10 * Math.PI / 180 };

/** Box between two local points a, b (THREE.Vector3), cross-section w x h. */
function strut(a, b, w, h) {
  const d = _v.subVectors(b, a), len = d.length();
  const g = box(w, h, len, 2);
  const m = new THREE.Matrix4().lookAt(a, b, _up);
  m.setPosition(a.x + d.x / 2, a.y + d.y / 2, a.z + d.z / 2);
  return g.applyMatrix4(m);
}

/** Curved skin plate: φ from p0 to p1 around the trunnion, width W along local z. */
function skin(LT, TY, R, p0, p1, W) {
  const pos = [], uv = [], idx = [], N = 10;
  for (let i = 0; i <= N; i++) {
    const p = p0 + (p1 - p0) * i / N, x = LT - R * Math.cos(p), y = TY + R * Math.sin(p);
    pos.push(x, y, -W / 2, x, y, W / 2); uv.push(0, i / N, 1, i / N);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g.toNonIndexed();
}

function buildSpillway(ctx, M) {
  const { path, world } = ctx;
  const H = (s, l) => world.heightSL(s, l);
  const out = { conc: [], steel: [], spill: [], foam: [] };
  const Yc = path.roadY(SP.c), Yd = Yc + 8.3;
  const minH = (s0, s1, l) => Math.min(H(s0, l), H((s0 + s1) / 2, l), H(s1, l));

  // piers: extruded side profile following the face, rounded nose towards the road
  for (let i = 0; i <= SP.n; i++) {
    const s = pierS(i), Y0 = path.roadY(s), s0 = s - SP.pier / 2, s1 = s + SP.pier / 2;
    const sh = new THREE.Shape();
    sh.moveTo(7.4, Yd - 0.8); sh.lineTo(11.8, Yd - 0.8); sh.lineTo(11.8, Y0 + 4.2);
    sh.lineTo(GATE.LT + 1.2, Y0 + 4.2);
    for (let l = GATE.LT + 2.5; l <= TOE; l += 1.5) sh.lineTo(l, Math.max(H(s, l) + 2.3, H(s, l) + 2.3 + (Y0 + 4.2 - H(s, l) - 2.3) * smoothstep(GATE.LT + 6, GATE.LT + 1, l)));
    sh.lineTo(TOE + 0.5, H(s, TOE) + 1.0); sh.lineTo(TOE + 0.5, H(s, TOE) - 1.2);
    for (let l = TOE; l >= 7.4; l -= 1.5) sh.lineTo(l, minH(s0, s1, l) - 1.0);
    sh.lineTo(7.4, minH(s0, s1, 7.4) - 1.0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: SP.pier, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, -SP.pier / 2);
    const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) / 6, uv.getY(k) / 6);
    out.conc.push(tint(place(ctx, g, s, 0, 0), 0xcfc7b8, 0.1, i));
    const hN = Yd - 0.8 - (H(s, 7.4) - 1.0);
    out.conc.push(tint(place(ctx, cyl(SP.pier / 2, SP.pier / 2, hN, 16, 6), s, 7.4, H(s, 7.4) - 1.0 + hN / 2), 0xcfc7b8, 0.1, i));
    // trunnion hubs on each face of the pier
    for (const sd of [-1, 1]) {
      const hub = cyl(0.55, 0.55, 0.6, 12).rotateX(Math.PI / 2).translate(GATE.LT, 0, sd * (SP.pier / 2 + 0.3));
      out.steel.push(tint(place(ctx, hub, s, 0, 0), 0x2e3a42));
    }
  }

  // bridge-deck fascia between the road and the pier noses
  const ssp = range(SP.a - 1.5, SP.b + 1.5, 2);
  out.conc.push(tint(sweep(ctx, ssp, s => { const y = path.roadY(s); return [[5.8, y - 0.1], [7.6, y - 0.1], [7.6, y - 1.5], [5.8, y - 1.5]]; }, 6, 6), 0xbdb5a6));

  // hoist gantry deck with railings, and a hoist house per bay
  out.conc.push(tint(sweep(ctx, ssp, () => [[7.0, Yd - 0.8], [7.0, Yd], [12.2, Yd], [12.2, Yd - 0.8], [7.0, Yd - 0.8]], 6, 6), 0xd4ccbc));
  const rails = [];
  for (const l of [7.1, 12.1]) for (const dy of [0.55, 1.05]) rails.push(sweep(ctx, ssp, () => [[l - 0.03, Yd + dy], [l + 0.03, Yd + dy], [l + 0.03, Yd + dy + 0.06], [l - 0.03, Yd + dy + 0.06], [l - 0.03, Yd + dy]], 4, 4));
  for (let s = SP.a - 1; s < SP.b + 1; s += 2) for (const l of [7.1, 12.1]) rails.push(place(ctx, cyl(0.03, 0.03, 1.1, 5), s, l, Yd + 0.55));
  out.steel.push(tint(merge(rails), 0xe0b030));
  for (let j = 0; j < SP.n; j++) {
    const s = bayS(j);
    out.conc.push(tint(place(ctx, box(3.4, 2.7, 5.2, 3), s, 9.6, Yd + 1.35), 0xe6dcc0, 0.08, j));
    out.conc.push(tint(place(ctx, box(3.9, 0.18, 5.8, 3), s, 9.6, Yd + 2.8), 0x8a4a38));
    out.steel.push(tint(place(ctx, box(0.06, 1.9, 1.0, 2), s - 1.2, 7.9 + 3.4 / 2 - 0.1, Yd + 1.15), 0x4a5a44)); // door
  }

  // radial gates: skin plate, girders, arms, hoist ropes; open bays lifted
  for (let j = 0; j < SP.n; j++) {
    const s = bayS(j), W = SP.bay - 0.1, open = OPEN.includes(j);
    const sillL = GATE.LT - GATE.R * Math.cos(GATE.tb);
    const TY = minH(s - W / 2, s + W / 2, sillL) + 0.05 + GATE.R * Math.sin(GATE.tb);
    const a = open ? GATE.lift : 0, p0 = -GATE.tb + a, p1 = GATE.tt + a, R = GATE.R;
    const parts = [skin(GATE.LT, TY, R, p0, p1, W)];
    for (const f of [0.1, 0.4, 0.7, 0.95]) {
      const p = p0 + (p1 - p0) * f, r = R - 0.35;
      parts.push(box(0.35, 0.55, W, 2).rotateZ(-p).translate(GATE.LT - r * Math.cos(p), TY + r * Math.sin(p), 0));
    }
    for (const zs of [-1, 1]) {
      const z = zs * (W / 2 - 0.9), T = new THREE.Vector3(GATE.LT, TY, z);
      for (const f of [0.15, 0.85]) {
        const p = p0 + (p1 - p0) * f, r = R - 0.6;
        parts.push(strut(T, new THREE.Vector3(GATE.LT - r * Math.cos(p), TY + r * Math.sin(p), z), 0.45, 0.6));
      }
      const top = new THREE.Vector3(GATE.LT - R * Math.cos(p1), TY + R * Math.sin(p1), z);
      parts.push(strut(top, new THREE.Vector3(9.4, Yd - 0.8, z), 0.05, 0.05));
    }
    const g = merge(parts);
    tint(g, 0x6d8894, 0.1, j);
    const col = g.attributes.color, pp = g.attributes.position;
    for (let k = 0; k < pp.count; k++) { const r = smoothstep(TY - 2, TY - 5, pp.getY(k)) * 0.35; col.setXYZ(k, col.getX(k) + r * 0.3, col.getY(k) - r * 0.1, col.getZ(k) - r * 0.35); }
    out.steel.push(place(ctx, g, s, 0, 0));

    // 9. spill sheet from under the open gate down the ogee into the basin
    if (open) {
      const sillY = TY + R * Math.sin(p0);
      const sl = range(GATE.LT - R * Math.cos(p0) - 0.3, BASIN[0] + 3, 0.8);
      out.spill.push(ribbon(ctx, range(s - W / 2 + 0.1, s + W / 2 - 0.1, 1.5), sl, (ss, l) => Math.max(H(ss, l) + 0.3, l < GATE.LT - 5 ? sillY + 0.5 : -99),
        (ss, l) => [(ss - s) / 4, l / 6]));
    }
  }

  // 10. stilling basin: side walls, end sill, churning foam
  let top = -99, bot = 99;
  for (let s = SP.a; s <= SP.b; s += 4) for (let l = TOE - 3; l <= BASIN[1]; l += 2) { const h = H(s, l); top = Math.max(top, h); bot = Math.min(bot, h); }
  const BY = top + 0.35, L0 = TOE - 4, L1 = BASIN[1];
  for (const s of [SP.a - 0.6, SP.b + 0.6]) {
    const hgt = BY + 1.4 - (bot - 1.5);
    out.conc.push(tint(place(ctx, box(L1 - L0 + 1.2, hgt, 1.2, 4), s, (L0 + L1) / 2, bot - 1.5 + hgt / 2), 0xb4ac9c));
  }
  const ssb = range(SP.a - 1.2, SP.b + 1.2, 3);
  out.conc.push(tint(sweep(ctx, ssb, () => [[L1, bot - 1.5], [L1, BY + 0.6], [L1 + 1.2, BY + 0.6], [L1 + 1.2, bot - 1.5]], 6, 6), 0xb4ac9c));
  out.foam.push(ribbon(ctx, range(SP.a - 0.2, SP.b + 0.2, 3), range(L0, L1 + 0.2, 1), () => BY, (s, l) => [s / 12, l / 12]));
  // outflow over the end sill towards the river
  out.spill.push(ribbon(ctx, range(SP.a, SP.b, 3), range(L1 + 1.2, RIVER[0] + 2, 1), (s, l) => Math.max(H(s, l) + 0.15, l < L1 + 2 ? BY + 0.5 : -99), (s, l) => [s / 8, l / 6]));
  return { out, BY };
}

/* ---------- 5, 11–13: abutments, control tower, sodium lamps, name board ---------- */

/** Wall running across the road frame at s (thickness t): tops/bottoms per lateral sample. */
function wallAcross(ctx, s, lats, topFn, botFn, t) {
  const pos = [], uv = [], p = new THREE.Vector3(), q = new THREE.Vector3();
  const quad = (a, b, c, d, ua, ub) => { pos.push(...a, ...b, ...c, ...b, ...d, ...c); uv.push(...ua, ...ub); };
  const P = (ds, l, y) => { ctx.path.toWorld(s + ds, l, p); return [p.x, y, p.z]; };
  for (let k = 1; k < lats.length; k++) {
    const l0 = lats[k - 1], l1 = lats[k], t0 = topFn(l0), t1 = topFn(l1), b0 = botFn(l0), b1 = botFn(l1);
    for (const ds of [-t / 2, t / 2]) quad(P(ds, l0, b0), P(ds, l1, b1), P(ds, l0, t0), P(ds, l1, t1),
      [l0 / 4, b0 / 4, l1 / 4, b1 / 4, l0 / 4, t0 / 4], [l1 / 4, b1 / 4, l1 / 4, t1 / 4, l0 / 4, t0 / 4]);
    quad(P(-t / 2, l0, t0), P(-t / 2, l1, t1), P(t / 2, l0, t0), P(t / 2, l1, t1),
      [l0 / 4, 0, l1 / 4, 0, l0 / 4, t / 4], [l1 / 4, 0, l1 / 4, t / 4, l0 / 4, t / 4]);
  }
  const l = lats[lats.length - 1], tt = topFn(l), bb = botFn(l);
  quad(P(-t / 2, l, bb), P(t / 2, l, bb), P(-t / 2, l, tt), P(t / 2, l, tt), [0, bb / 4, t / 4, bb / 4, 0, tt / 4], [t / 4, bb / 4, t / 4, tt / 4, 0, tt / 4]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function buildFurniture(ctx, M, K) {
  const { path, world } = ctx;
  const H = (s, l) => world.heightSL(s, l);
  const out = { conc: [], steel: [], glow: [], sign: [], pools: [] };
  const stone = 0xc2a27c;

  // 5. abutments: masonry pillars where the parapets end + wing walls down the slopes
  for (const s of [CREST_A, CREST_B]) {
    const Y = path.roadY(s), sgn = s === CREST_A ? -1 : 1;
    for (const sg of [-1, 1]) {
      out.conc.push(tint(place(ctx, box(1.1, 2.4, 1.3, 2), s, sg * PAR, Y + 1.0), stone, 0.1, s + sg));
      out.conc.push(tint(place(ctx, box(1.35, 0.22, 1.55, 2), s, sg * PAR, Y + 2.3), 0xf0ebe0));
      out.conc.push(tint(place(ctx, new THREE.SphereGeometry(0.3, 12, 8).toNonIndexed(), s, sg * PAR, Y + 2.62), 0xf0ebe0));
      const lats = sg > 0 ? range(PAR + 0.2, TOE + 3, 1.5) : range(PAR + 0.2, 34, 1.5).map(v => -v);
      const ws = sg < 0 && s === CREST_B ? RIP_B : s;
      const top = l => Math.min(Y + 0.9, Math.max(H(ws - 0.7, l), H(ws + 0.7, l), H(ws, l)) + 0.9);
      const bot = l => Math.min(H(ws - 0.7, l), H(ws + 0.7, l), H(ws, l)) - 1.2;
      out.conc.push(tint(wallAcross(ctx, ws + sgn * 0.2, lats, top, bot, 1.4), stone, 0.1, s * 3 + sg));
    }
  }

  // 11. control tower in the reservoir with an access bridge from the left parapet
  {
    const s = 1872, Y = path.roadY(s), L = -30, g0 = H(s, L) - 2;
    out.conc.push(tint(place(ctx, box(6, Y + 3.2 - g0, 6, 4), s, L, (Y + 3.2 + g0) / 2), 0xcfc6b4, 0.05, 7));
    out.conc.push(tint(place(ctx, box(7, 3.2, 7, 4), s, L, Y + 4.8), 0xe8e0cc));
    out.conc.push(tint(place(ctx, box(7.8, 0.3, 7.8, 4), s, L, Y + 6.55), 0x8a4a38));
    out.glow.push(tint(place(ctx, box(0.06, 1.2, 4.5, 2), s, L + 3.52, Y + 4.9), 0xffc070));
    out.conc.push(tint(place(ctx, box(-PAR - 0.2 - L - 3, 0.7, 2.2, 4), s, (L + 3 + (-PAR - 0.2)) / 2, Y - 0.15), 0xbdb5a6));
    for (let l = L + 5; l < -PAR - 2; l += 6) out.conc.push(tint(place(ctx, box(0.8, Y - 0.5 - (H(s, l) - 1), 0.8, 4), s, l, (Y - 0.5 + H(s, l) - 1) / 2), 0xbdb5a6));
    for (const dz of [-1.05, 1.05]) out.steel.push(tint(place(ctx, box(-PAR - 0.2 - L - 3, 0.05, 0.05, 2), s + dz, (L + 3 - PAR - 0.2) / 2, Y + 0.95), 0x5a6068));
  }

  // 12. sodium street lamps: tapered octagonal poles, outreach arm, cobra-head luminaire, light pool
  const spots = [];
  let side = 1;
  for (let s = CREST_A + 12; s < CREST_B - 6; s += 30, side = -side) {
    const Y = path.roadY(s) + 0.2, l = side * 5.0, h = 9;
    out.steel.push(tint(place(ctx, cyl(0.07, 0.13, h, 8), s, l, Y + h / 2), 0x9a9c98));
    out.steel.push(tint(place(ctx, cyl(0.2, 0.22, 0.5, 8), s, l, Y + 0.25), 0x9a9c98));
    const arm = strut(new THREE.Vector3(l, Y + h - 0.2, 0), new THREE.Vector3(l - side * 2.1, Y + h + 0.25, 0), 0.08, 0.08);
    out.steel.push(tint(place(ctx, arm, s, 0, 0), 0x9a9c98));
    const head = box(0.95, 0.22, 0.42, 1).rotateZ(side * 0.12).translate(l - side * 2.5, Y + h + 0.3, 0);
    out.steel.push(tint(place(ctx, head, s, 0, 0), 0x6e726e));
    out.glow.push(tint(place(ctx, box(0.7, 0.05, 0.32, 1).translate(l - side * 2.5, Y + h + 0.17, 0), s, 0, 0), 0xffa347));
    spots.push({ s, lat: l - side * 2.5, y: Y + h + 0.1 });
    const pool = new THREE.PlaneGeometry(15, 15).rotateX(-Math.PI / 2).toNonIndexed();
    out.pools.push(place(ctx, pool, s, l - side * 3.2, path.roadY(s) + 0.06));
  }

  // 13. dam name board at the start of the crest (left side, angled to the approach)
  {
    const s = CREST_A - 9, l = -7.2, gy = H(s, l);
    const b = new THREE.PlaneGeometry(4.6, 1.5);
    const uv = b.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setY(k, 2 / 3 + uv.getY(k) / 3);
    out.sign.push(place(ctx, b.rotateY(0.55).translate(0, gy + 2.6, 0), s, l, 0));
    out.steel.push(tint(place(ctx, box(4.8, 1.7, 0.08, 2).rotateY(0.55).translate(-0.05 * Math.sin(0.55), gy + 2.6, -0.05 * Math.cos(0.55)), s, l, 0), 0x2a2e33));
    for (const d of [-1.9, 1.9]) out.steel.push(tint(place(ctx, cyl(0.06, 0.06, 3.4, 6).translate(d * Math.cos(0.55), gy + 1.4, -d * Math.sin(0.55) - 0.1), s, l, 0), 0x3a3e42));
  }
  return { out, spots };
}

/* ---------- 14–16: reservoir, far hills, river, paddy, valley trees ---------- */

function buildSetting(ctx, M, K, group) {
  const { path, world } = ctx;
  const H = (s, l) => world.heightSL(s, l);
  const s0 = CREST_A - 260, s1 = CREST_B + 40;

  // 14. reservoir + hazy hills on the far shore
  group.add(makeWater(ctx, { s0: CREST_A - 120, s1: CREST_B + 20, lateral0: -world.VERGE, lateral1: -440, y: 2.0, kind: 'lake' }));
  const c = new THREE.Color(), haze = new THREE.Color(0x8a7f8e), near = new THREE.Color(0x4f5a3e);
  // far ridge laid on a straight world line (road-space ribbons fold this far out on curves)
  const A = path.toWorld(CREST_A - 150, 0), Bw = path.toWorld(CREST_B + 150, 0);
  const dir = Bw.clone().sub(A), len = dir.length(); dir.normalize();
  const nL = new THREE.Vector3(-dir.z, 0, dir.x);
  if (nL.dot(path.sample((CREST_A + CREST_B) / 2).right) > 0) nL.negate();          // point towards the reservoir side
  const off = [0, 70, 140, 210, 300, 390], hp = [], hc = [], hi = [];
  const cols = range(-500, len + 500, 14);
  for (const t of cols) for (let j = 0; j < off.length; j++) {
    const fade = smoothstep(-500, -150, t) * smoothstep(len + 500, len + 150, t);
    const ridge = (22 + 40 * (0.5 + 0.5 * fbm(t * 0.0025, 3.1)) + 10 * fbm(t * 0.007, 7.7)) * (0.35 + 0.65 * fade);
    const k = j / (off.length - 1);
    const y = j === 0 ? -4 : 2 + ridge * smoothstep(0, 0.4, k) * (1 - 0.3 * smoothstep(0.6, 1, k)) + fbm(t * 0.01, j) * 2.5;
    const x = A.x + dir.x * t + nL.x * (410 + off[j]), zz = A.z + dir.z * t + nL.z * (410 + off[j]);
    hp.push(x, y, zz);
    c.copy(near).lerp(haze, 0.35 + 0.4 * k).multiplyScalar(0.85 + 0.25 * smoothstep(0, 60, y)); hc.push(c.r, c.g, c.b);
  }
  for (let a = 1; a < cols.length; a++) for (let j = 1; j < off.length; j++) {
    const p0 = (a - 1) * off.length + j - 1, p1 = p0 + 1, p2 = p0 + off.length, p3 = p2 + 1;
    hi.push(p0, p1, p2, p1, p3, p2);
  }
  const hills = new THREE.BufferGeometry();
  hills.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3));
  hills.setAttribute('color', new THREE.Float32BufferAttribute(hc, 3));
  hills.setIndex(hi); hills.computeVertexNormals();
  const hm = new THREE.Mesh(hills, M.hills); hm.name = 'dam:hills'; group.add(hm);

  // 15. river leaving the stilling basin, down the valley parallel to the dam
  const rs0 = CREST_A + 5, rs1 = CREST_B + 20;
  let ry = -99;
  for (let s = rs0; s <= rs1; s += 6) for (let l = RIVER[0] + 2; l <= RIVER[1] - 2; l += 2) ry = Math.max(ry, H(s, l));
  let rMed = []; for (let s = rs0; s <= rs1; s += 6) rMed.push(H(s, (RIVER[0] + RIVER[1]) / 2));
  rMed.sort((a, b) => a - b);
  const RY = Math.min(ry + 0.2, rMed[Math.floor(rMed.length * 0.8)] + 0.6);
  group.add(makeWater(ctx, { s0: rs0, s1: rs1, lateral0: RIVER[0], lateral1: RIVER[1], y: RY, kind: 'creek' }));

  // 16. paddy fields with bunds, both sides of the river
  const paddyGeo = [];
  for (const [a, b] of [[TOE + 2, RIVER[0] - 1], [RIVER[1] + 1, 150]]) {
    const lats = range(a, b, 3);
    paddyGeo.push(ribbon(ctx, range(CREST_A + 12, CREST_B - 4, 4), lats, (s, l, j) => {
      const g = H(s, l); return j === 0 || j === lats.length - 1 ? g - 0.25 : g + 0.3;
    }, (s, l) => [s / 96, l / 72], (s, l) => {
      const inBasin = s > SP.a - 4 && s < SP.b + 4 && l < RIVER[0];
      const k = inBasin ? 0 : 0.9 + 0.15 * fbm(s * 0.01, l * 0.01);
      return c.setRGB(k, k, k);
    }));
  }
  // drop the rows that sit under the stilling basin/outflow (colour 0 → removed)
  const pg = merge(paddyGeo), keep = [], cc = pg.attributes.color, pp = pg.attributes.position, uu = pg.attributes.uv;
  for (let t = 0; t < pp.count; t += 3) {
    if (cc.getX(t) === 0 || cc.getX(t + 1) === 0 || cc.getX(t + 2) === 0) continue;
    for (let k = 0; k < 3; k++) keep.push(t + k);
  }
  const pk = new THREE.BufferGeometry();
  for (const [n, A] of [['position', pp], ['uv', uu], ['color', cc], ['normal', pg.attributes.normal]]) {
    const arr = new Float32Array(keep.length * A.itemSize);
    keep.forEach((v, i) => { for (let d = 0; d < A.itemSize; d++) arr[i * A.itemSize + d] = A.array[v * A.itemSize + d]; });
    pk.setAttribute(n, new THREE.BufferAttribute(arr, A.itemSize));
  }
  const paddy = new THREE.Mesh(pk, M.paddy); paddy.name = 'dam:paddy'; paddy.receiveShadow = true; group.add(paddy);

  // valley trees: toddy palms on the bunds, mango/neem clumps near the river and toe
  const avoid = (s, l) => (l > RIVER[0] - 3 && l < RIVER[1] + 3) || (s > SP.a - 6 && s < SP.b + 6 && l < BASIN[1] + 8) || l < TOE + 2
    || (s > LOT.s0 - 6 && l < LOT.l1 + 8);
  group.add(plant(ctx, { kind: 'palm', count: Math.round(70 * K), seed: 'dam-palms', scale: [0.9, 1.4], place: R => {
    const s = CREST_A - 60 + R() * (CREST_B - CREST_A + 40), l = TOE + 4 + R() * 150;
    const bs = Math.round(s / 24) * 24 + (R() - 0.5) * 2, bl = Math.round(l / 18) * 18;  // on bund lines
    return avoid(bs, bl) ? null : { s: bs, lateral: bl };
  } }));
  group.add(plant(ctx, { kind: 'broadleaf', count: Math.round(90 * K), seed: 'dam-trees', scale: [0.9, 1.5], place: R => {
    const s = CREST_A - 60 + R() * (CREST_B - CREST_A + 40);
    const l = R() < 0.5 ? RIVER[1] + 4 + R() * 8 : TOE + 3 + R() * 190;
    return avoid(s, l) ? null : { s, lateral: l };
  } }));
  group.add(plant(ctx, { kind: 'bush', count: Math.round(80 * K), seed: 'dam-bush', place: R => {
    const s = CREST_A - 40 + R() * (CREST_B - CREST_A + 20), l = RIVER[0] - 3 + R() * 2 + (R() < 0.5 ? 0 : RIVER[1] - RIVER[0] + 4);
    return avoid(s, l + (l < RIVER[0] ? -1 : 1) * 5) ? null : { s, lateral: l };
  } }));
  return { RY };
}

/* ---------- 17–23: AMR Unnati Convention ---------- */

function car(col) {
  const parts = [
    tint(box(4.2, 0.62, 1.74, 2).translate(0, 0.62, 0), col),
    tint(box(2.3, 0.56, 1.56, 2).translate(-0.2, 1.2, 0), 0x1d2328),
    tint(box(2.1, 0.06, 1.5, 2).translate(-0.2, 1.5, 0), col),
    tint(box(0.05, 0.14, 1.2, 1).translate(2.1, 0.7, 0), 0xe8e8e0),
  ];
  for (const x of [-1.35, 1.35]) for (const z of [-0.78, 0.78]) parts.push(tint(cyl(0.32, 0.32, 0.22, 10).rotateX(Math.PI / 2).translate(x, 0.32, z), 0x151515));
  return merge(parts);
}

function buildVenue(ctx, M, K, group) {
  const { path, world } = ctx;
  const H = (s, l) => world.heightSL(s, l);
  const PY = path.roadY(VENUE.s) + 0.02;               // lot pad level = road level
  const out = { plaster: [], steel: [], glow: [], sign: [], glass: [], conc: [] };
  const ssl = range(LOT.s0, LOT.s1, 3), cream = 0xefe4cf;

  // 17. pad (paved) + lawn overlay
  const pave = new THREE.Mesh(ribbon(ctx, ssl, range(LOT.l0 - 0.4, LOT.l1, 2), () => PY, (s, l) => [s / 10, (l - LOT.l0) / 10]), M.pave);
  pave.receiveShadow = true; pave.name = 'venue:pad'; group.add(pave);
  const LW = { s0: VENUE.s + 27, s1: LOT.s1 - 1.5, l0: 20, l1: LOT.l1 - 1.5 };
  const lawn = new THREE.Mesh(ribbon(ctx, range(LW.s0, LW.s1, 3), range(LW.l0, LW.l1, 3), () => PY + 0.04, (s, l) => [s / 8, l / 8]), M.lawn);
  lawn.receiveShadow = true; lawn.name = 'venue:lawn'; group.add(lawn);

  // 18. boundary wall with coping; its sides also retain the pad where the ground falls away
  const top = PY + 1.9, low = (s, l) => Math.min(H(s, l), PY) - 0.8;
  for (const s of [LOT.s0, LOT.s1]) out.plaster.push(tint(wallAcross(ctx, s, range(LOT.l0 - 0.5, LOT.l1 + 0.3, 2), () => top, l => low(s, l), 0.35), cream, 0.05, s));
  const wallS = (a, b, l) => {
    const ss = range(a, b, 2);
    out.plaster.push(tint(sweep(ctx, ss, s => [[l - 0.17, low(s, l)], [l - 0.17, top], [l + 0.17, top], [l + 0.17, low(s, l)]], 6, 6), cream, 0.05, a));
    out.conc.push(tint(sweep(ctx, ss, () => [[l - 0.24, top], [l - 0.24, top + 0.1], [l + 0.24, top + 0.1], [l + 0.24, top]], 6, 6), 0x8a3b2e));
    for (let s = a + 3; s < b - 1; s += 3) out.plaster.push(tint(place(ctx, box(0.5, top - PY + 0.3, 0.5, 2), s, l, (top + PY) / 2 + 0.05), 0xe4d6bc));
  };
  const G0 = VENUE.s - 29, G1 = VENUE.s - 21;          // gate opening facing the road
  wallS(LOT.s0, G0 - 0.7, LOT.l0 - 0.4); wallS(G1 + 0.7, LOT.s1, LOT.l0 - 0.4); wallS(LOT.s0, LOT.s1, LOT.l1 + 0.1);

  // 19. entrance gate: pillars with lamp globes, arch board, open steel leaves
  for (const s of [G0, G1]) {
    out.plaster.push(tint(place(ctx, box(1.3, 4.2, 1.3, 2), s, LOT.l0 - 0.4, PY + 2.1), 0xd8b98a));
    out.plaster.push(tint(place(ctx, box(1.6, 0.3, 1.6, 2), s, LOT.l0 - 0.4, PY + 4.35), 0xf4ecdc));
    out.glow.push(tint(place(ctx, new THREE.SphereGeometry(0.34, 14, 10).toNonIndexed(), s, LOT.l0 - 0.4, PY + 4.85), 0xffe2a8));
  }
  const arch = new THREE.PlaneGeometry(G1 - G0 + 1.3, 1.4).rotateY(-Math.PI / 2);
  { const uv = arch.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) / 3); }
  out.sign.push(place(ctx, arch, (G0 + G1) / 2, LOT.l0 - 0.45 - 0.4, PY + 5.5));
  out.steel.push(tint(place(ctx, box(0.3, 1.6, G1 - G0 + 1.5, 2), (G0 + G1) / 2, LOT.l0 - 0.4, PY + 5.5), 0x5a1020));
  for (const [s, dir] of [[G0 + 0.6, 1], [G1 - 0.6, -1]]) {
    const leaf = [];
    for (let k = 0; k <= 8; k++) leaf.push(box(0.05, 1.8, 0.05, 1).translate(k * 0.45, 0.9, 0));
    for (const y of [0.1, 0.9, 1.75]) leaf.push(box(3.7, 0.08, 0.06, 1).translate(1.8, y, 0));
    out.steel.push(tint(place(ctx, merge(leaf), s, LOT.l0 - 0.3, PY, dir * 0.25), 0x2b2b2e));
  }

  // 20. the hall: plinth, block, glass curtain wall between pilasters, fascia sign, porte-cochère
  const HS = VENUE.s + 2, HL = 36, HW = 44, HD = 22, HH = 9.5, fl = HL - HD / 2; // front line
  out.plaster.push(tint(place(ctx, box(HD + 1.2, 0.7, HW + 1.2, 3), HS, HL, PY + 0.35), 0xb9a88c));
  out.plaster.push(tint(place(ctx, box(HD, HH, HW, 4), HS, HL, PY + 0.7 + HH / 2), cream, 0.04, 3));
  out.plaster.push(tint(place(ctx, box(HD + 0.6, 0.9, HW + 0.6, 4), HS, HL, PY + 0.7 + HH + 0.45), 0xd9ccb2));
  const gl = new THREE.PlaneGeometry(HW - 2, HH - 3).rotateY(-Math.PI / 2);
  out.glass.push(place(ctx, gl, HS, fl - 0.06, PY + 0.7 + (HH - 3) / 2 + 0.2));
  for (const sd of [-1, 1]) {      // side windows
    const sw = new THREE.PlaneGeometry(HD - 6, 3).rotateY(sd > 0 ? Math.PI : 0);
    out.glass.push(place(ctx, sw, HS + sd * (HW / 2 + 0.06), HL, PY + 3.4));
  }
  for (let k = 0; k <= 8; k++) out.plaster.push(tint(place(ctx, box(0.9, HH - 1.2, 0.9, 3), HS - HW / 2 + 1 + k * (HW - 2) / 8, fl - 0.4, PY + 0.7 + (HH - 1.2) / 2), 0xf6efe2));
  out.plaster.push(tint(place(ctx, box(0.8, 2.2, HW + 0.4, 3), HS, fl - 0.45, PY + 0.7 + HH - 1.4), 0x3a2a24));
  const fas = new THREE.PlaneGeometry(26, 1.9).rotateY(-Math.PI / 2);
  { const uv = fas.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setY(k, 1 / 3 + uv.getY(k) / 3); }
  out.sign.push(place(ctx, fas, HS, fl - 0.87, PY + 0.7 + HH - 1.4));
  // porte-cochère: slab on six columns, steps up to the doors
  const PC = { l0: fl - 9, l1: fl - 0.4, w: 16 };
  out.plaster.push(tint(place(ctx, box(PC.l1 - PC.l0, 0.8, PC.w, 3), HS, (PC.l0 + PC.l1) / 2, PY + 6.2), 0xf3ead8));
  out.plaster.push(tint(place(ctx, box(PC.l1 - PC.l0 + 0.3, 0.35, PC.w + 0.3, 3), HS, (PC.l0 + PC.l1) / 2, PY + 6.75), 0x8a3b2e));
  out.glow.push(tint(place(ctx, box(PC.l1 - PC.l0 - 1.5, 0.04, PC.w - 2, 1), HS, (PC.l0 + PC.l1) / 2, PY + 5.78), 0xffd9a0));
  for (const l of [PC.l0 + 0.6, (PC.l0 + PC.l1) / 2]) for (const ds of [-PC.w / 2 + 0.8, 0, PC.w / 2 - 0.8]) {
    if (ds === 0 && l !== PC.l0 + 0.6) continue;
    out.plaster.push(tint(place(ctx, cyl(0.38, 0.42, 5.8, 16, 3), HS + ds, l, PY + 2.9), 0xfaf5ea));
    out.plaster.push(tint(place(ctx, box(1.0, 0.3, 1.0, 1), HS + ds, l, PY + 0.15), 0xb9a88c));
  }
  for (let k = 0; k < 3; k++) out.plaster.push(tint(place(ctx, box(1.2, 0.18 * (3 - k), 10, 2), HS, fl - 0.6 - 1.2 * k, PY + 0.09 * (3 - k)), 0xcdbfa6));
  return { out, PY, LW, HS, HL, fl };
}

/* 21–23: parking, lawn with string lights + mandap, palms */
function dressVenue(ctx, M, K, group, V) {
  const { path } = ctx;
  const { out, PY, LW } = V;
  // 21. a few parked cars nose-in along the front wall
  const cols = [0xf2f2ee, 0x9b1b22, 0x3c3f44, 0xc0c4c8, 0x1f3f6e, 0xe9e6dc];
  const R = makeRng('cars');
  let n = 0;
  for (let s = LOT.s0 + 4; s < LOT.s1 - 20 && n < 6; s += 2.5) {
    if (s > VENUE.s - 32 && s < VENUE.s - 18) continue;  // keep the gate throat clear
    if (R() < 0.45) continue;
    out.steel.push(place(ctx, car(cols[n % cols.length]), s + 1.25, 10.7, PY, Math.PI + (R() - 0.5) * 0.06));
    n++;
  }
  // 22. lawn: string lights between poles, lantern posts, lit mandap
  const poles = [];
  for (const s of [LW.s0 + 1, LW.s1 - 1]) for (const l of [LW.l0 + 1, (LW.l0 + LW.l1) / 2, LW.l1 - 1]) {
    out.steel.push(tint(place(ctx, cyl(0.05, 0.07, 5, 6), s, l, PY + 2.5), 0x2a2a2a));
    poles.push(path.toWorld(s, l).setY(PY + 4.9));
  }
  const bulbs = [], wire = [];
  const pairs = [[0, 3], [1, 4], [2, 5], [0, 1], [1, 2], [3, 4], [4, 5], [0, 4], [2, 4]];
  for (const [a, b] of pairs) {
    const pts = []; catenary(pts, poles[a], poles[b], 14, 0.9);
    for (let k = 0; k < pts.length; k += 3) {
      if (k) wire.push(pts[k - 3], pts[k - 2], pts[k - 1], pts[k], pts[k + 1], pts[k + 2]);
      bulbs.push(new THREE.SphereGeometry(0.07, 6, 4).toNonIndexed().translate(pts[k], pts[k + 1] - 0.08, pts[k + 2]));
    }
  }
  out.glow.push(tint(merge(bulbs), 0xffd890));
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
  group.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x222222 })));
  for (let s = LW.s0 + 4; s < LW.s1 - 2; s += 6) for (const l of [LW.l0 + 0.5, LW.l1 - 0.5]) {
    out.steel.push(tint(place(ctx, cyl(0.05, 0.06, 1.2, 6), s, l, PY + 0.6), 0x2a2a2a));
    out.glow.push(tint(place(ctx, box(0.22, 0.3, 0.22, 1), s, l, PY + 1.35), 0xffc070));
  }
  // mandap: four carved posts, stepped platform, marigold-draped canopy glowing from within
  const ms = (LW.s0 + LW.s1) / 2, ml = (LW.l0 + LW.l1) / 2 + 6;
  out.plaster.push(tint(place(ctx, box(6.5, 0.45, 6.5, 2), ms, ml, PY + 0.25), 0xe9dcc0));
  for (const ds of [-2.6, 2.6]) for (const dl of [-2.6, 2.6]) {
    out.plaster.push(tint(place(ctx, cyl(0.16, 0.2, 3.4, 10), ms + ds, ml + dl, PY + 0.45 + 1.7), 0xd9a441));
  }
  out.plaster.push(tint(place(ctx, box(6.4, 0.35, 6.4, 2), ms, ml, PY + 4.0), 0xc8442a));
  out.plaster.push(tint(place(ctx, new THREE.ConeGeometry(4.3, 1.8, 4).rotateY(Math.PI / 4).toNonIndexed(), ms, ml, PY + 5.05), 0xe07a1f));
  for (const dl of [-2.6, 2.6]) out.glow.push(tint(place(ctx, box(0.08, 0.9, 5.4, 1), ms, ml + dl, PY + 3.4), 0xffa030)); // marigold strings
  out.glow.push(tint(place(ctx, box(5.6, 0.05, 5.6, 1), ms, ml, PY + 3.8), 0xffc880));
  // 23. palms along the front wall and round the lawn
  group.add(plant(ctx, { kind: 'palm', count: 10, seed: 'venue-palms', scale: [0.9, 1.15], place: (R, i) => {
    if (i < 5) return { s: LOT.s0 + 3 + i * 4.2 + (i > 1 ? 14 : 0), lateral: LOT.l1 - 2 - R() * 6 };
    return { s: LW.s0 + 2 + (i - 5) * 4, lateral: LW.l1 - 1.2 };
  } }));
}

/* ---------- assembly ---------- */

function streakTex() {
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = 'rgba(235,242,240,0.55)'; g.fillRect(0, 0, w, h);
    const r = makeRng('spill');
    for (let i = 0; i < 160; i++) {
      const x = r() * w, y = r() * h, len = 30 + r() * 120;
      g.fillStyle = `rgba(255,255,255,${0.3 + 0.6 * r()})`;
      for (const dy of [0, -h]) g.fillRect(x, y + dy, 1 + r() * 3, len);
    }
  });
}

function meshOf(list, mat, name, shadow = true) {
  const m = new THREE.Mesh(merge(list), mat);
  m.name = name; m.receiveShadow = true; m.castShadow = shadow;
  return m;
}

export default {
  id: 'dam',
  build(ctx) {
    const { world } = ctx;
    const K = TIER[ctx.quality?.tier] ?? 0.7;
    const group = new THREE.Group(); group.name = 'dam';
    const M = makeMats();
    const B = buildBody(ctx, M);
    const S = buildSpillway(ctx, M);
    const F = buildFurniture(ctx, M, K);
    buildSetting(ctx, M, K, group);
    const V = buildVenue(ctx, M, K, group);
    dressVenue(ctx, M, K, group, V);

    group.add(meshOf([...B.conc, ...S.out.conc, ...F.out.conc, ...V.out.conc], M.conc, 'dam:concrete'));
    group.add(meshOf(B.riprap, M.riprap, 'dam:riprap', false));
    group.add(meshOf(B.parapet, M.parapet, 'dam:parapet'));
    group.add(meshOf(B.kerb, M.kerb, 'dam:kerb', false));
    group.add(meshOf(B.path, M.path, 'dam:footpath', false));
    group.add(meshOf([...B.steel, ...S.out.steel, ...F.out.steel, ...V.out.steel], M.steel, 'dam:steel'));
    group.add(meshOf(V.out.plaster, M.plaster, 'venue:hall'));
    group.add(meshOf(V.out.glass, M.glass, 'venue:glass', false));
    group.add(meshOf([...F.out.sign, ...V.out.sign], M.sign, 'dam:signs', false));
    const glow = meshOf([...F.out.glow, ...V.out.glow], M.glow, 'dam:glow', false); group.add(glow);

    // spill sheets + outflow (scrolling streaks), basin foam
    const st = streakTex();
    const spillMat = new THREE.MeshStandardMaterial({ map: st, transparent: true, opacity: 0.92, roughness: 0.35, depthWrite: false, color: 0xe8f0ee });
    const spill = meshOf(S.out.spill, spillMat, 'dam:spill', false); group.add(spill);
    const ft = foamTex();
    const foamMat = new THREE.MeshStandardMaterial({ map: ft, roughness: 0.6, color: 0xeef2ee });
    group.add(meshOf(S.out.foam, foamMat, 'dam:foam', false));

    // sodium light pools on the road
    const pc = canvasTex(128, 128, (g, w) => {
      const rg = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.45, 'rgba(255,255,255,0.45)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.fillRect(0, 0, w, w);
    }, false);
    const poolMat = new THREE.MeshBasicMaterial({ map: pc, color: 0xff9a40, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const pools = meshOf(F.out.pools, poolMat, 'dam:pools', false); pools.renderOrder = 2; group.add(pools);

    const U = world.U;
    const base = new THREE.Color(1, 1, 1);
    return {
      group,
      update(dt = 0.016) {
        const d = U.uDusk.value;
        const k = 0.55 + 2.2 * smoothstep(0.05, 0.8, d);
        M.glow.color.copy(base).multiplyScalar(k);
        poolMat.opacity = 0.1 + 0.55 * smoothstep(0.1, 0.8, d);
        M.glass.emissiveIntensity = 0.35 + 1.4 * d;
        M.sign.emissiveIntensity = 0.45 + 1.3 * d;
        st.offset.y -= dt * 1.1;
        ft.offset.x += dt * 0.05; ft.offset.y -= dt * 0.12;
      },
      dispose() {
        group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        for (const m of Object.values(M)) { m.map?.dispose(); m.dispose(); }
        st.dispose(); ft.dispose(); pc.dispose();
      }
    };
  }
};
