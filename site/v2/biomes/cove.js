/* Zone 'cove' — the sea bay before the hills, and the Vizag stop.
 *
 * OBJECTS (every mesh this module adds; draw calls in brackets, ≈22 total)
 *  Sea
 *   1  sea surface ........................ makeWater() from water.js      [1]
 *  Palm Beach Hotel, Visakhapatnam (STOPS[0].venue, left of the road, by the sea)
 *   2  plot lawn — flat terrace top at road level, blended into the verge   [1]
 *   3  sea wall — coursed laterite/granite skirt from the plot to the beach [1]
 *   4  site works (world space, plaster mat): compound wall + terracotta
 *      coping, gate piers, sea-side parapet with steel rail, paver driveway
 *      from the road edge to the porte-cochère                              [1]
 *   5  building shell (hotel-local, plaster mat): two 5-storey wings and a
 *      6-storey centre tower at 3.2 m storeys, floor-slab bands, column
 *      fins, stone plinth, roof parapets + coping, lift machine room, black
 *      Sintex water tanks, porte-cochère canopy on stone-clad columns, pool
 *      deck, loungers, planters                                             [1]
 *   6  glazing — framed sliding doors / windows, baked sky reflection,
 *      curtains, warm interior glow (emissive, rises with uDusk)            [1]
 *   7  balconies — slab, steel posts, handrail, bottom channel (instanced)  [1]
 *   8  balcony glass balustrades (instanced, transparent)                   [1]
 *   9  signage — 'PALM BEACH HOTEL' lit letters on the porte-cochère fascia
 *      (road face + approach face) and on the tower crown; front-faced only [1]
 *  10  pool water (tiled, emissive tint)                                    [1]
 *  11  plot landscaping — palms, clipped shrubs, bougainvillea (flora geo)  [2]
 *  Coast
 *  12  islet — rocky outcrop with cliffs, ledges, scrub crown               [1]
 *  13  islet scrub + palms (share 11's instanced meshes)
 *  14  fishing boats — Andhra wooden navas: lofted plank hull, painted
 *      strakes, tarred bottom, high stem/stern posts, thwarts, outrigger
 *      booms + float log, outboard, nets; bob and roll on the swell        [1]
 *  15  shoreline rocks — tide-line boulders, clusters at the sea wall toe   [2]
 *  16  shore palms, hill palms, hill bushes (flora.plant)                   [3]
 *  17  dune grass on the sea-side verge (garden-beach duneGrass)            [1]
 */
import * as THREE from 'three';
import { makeWater } from './water.js';
import { plant, band, kindGeometry, floraMaterial } from './flora.js';
import { tierK, duneGrass, coastRocks, shoreLat } from './garden-beach.js';
import { STOPS } from '../core/timeline.js';
import { rng as makeRng, smoothstep, clamp } from '../core/noise.js';

const UP = new THREE.Vector3(0, 1, 0);
const BAY = 4, STOREY = 3.2;
const BLD_DZ = 5;  // building offset along the plot, hotel-local (-z = ahead): porte-cochère just past the park spot
const BLD_DX = -6; // and set back from the road so the gate, forecourt and drive read in front of it

/* ---------- geometry helpers ---------- */

/** Non-indexed, normals, flat vertex colour; drops uv (re-projected later). */
function colored(g, hex) {
  g = g.index ? g.toNonIndexed() : g;
  if (g.attributes.uv) g.deleteAttribute('uv');
  g.computeVertexNormals();
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const box = (w, h, d, x, y, z, hex) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
const cyl = (r0, r1, h, seg, x, y, z, hex) => colored(new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y, z), hex);

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
    const g = new Float32Array(cells * cells).map(() => R());
    for (let y = 0; y < N; y++) {
      const fy = (y / N) * cells, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < N; x++) {
        const fx = (x / N) * cells, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
        const x1 = (ix + 1) % cells, y1 = (iy + 1) % cells;
        const a = g[iy * cells + ix], b = g[iy * cells + x1], c = g[y1 * cells + ix], d = g[y1 * cells + x1];
        out[y * N + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
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

/** Paint a per-pixel function into a canvas. f(x, y, i) → [r, g, b] 0..255 */
function paint(N, f) {
  const c = mkCanvas(N), g = c.getContext('2d'), im = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, [r, gg, b] = f(x, y, i);
    im.data.set([r, gg, b, 255], i * 4);
  }
  g.putImageData(im, 0, 0);
  return c;
}

let TEX = null;
/** Shared detail maps: plaster grain (map + bump), lawn, sea-wall stone, rock. */
function textures() {
  if (TEX) return TEX;
  const N = 256;
  const n1 = fbmTile(N, 'grain'), n2 = fbmTile(N, 'grain2', [[64, 0.5], [128, 0.5]]);
  const grain = paint(N, (x, y, i) => { const v = 226 + 22 * n1[i] + 10 * (n2[i] - 0.5); return [v, v, v]; });
  const bump = paint(N, (x, y, i) => { const v = 128 + 70 * (n2[i] - 0.5) + 60 * (n1[i] - 0.5); return [v, v, v]; });
  const gl = fbmTile(N, 'lawn', [[8, 0.35], [32, 0.25], [128, 0.4]]);
  const lawn = paint(N, (x, y, i) => {
    const v = gl[i], blade = ((x * 7 + y * 13) % 5) / 5 * 0.06;
    return [70 + 60 * v + 30 * blade, 112 + 58 * v, 42 + 26 * v];
  });
  TEX = {
    grain: canvasTex(grain), bump: canvasTex(bump, false), lawn: canvasTex(lawn),
    stone: canvasTex(stoneCanvas()), rock: canvasTex(rockCanvas()), pavers: canvasTex(paverCanvas())
  };
  return TEX;
}

/** Interlocking concrete pavers, stretcher bond, grey with a red border band feel:
 *  512 px ≙ 2.4 m (uv = world / 2.4), 64×32 px ≈ 0.3×0.15 m. */
function paverCanvas() {
  const N = 512, n = fbmTile(N, 'pavers', [[8, 0.4], [32, 0.3], [128, 0.3]]), R = makeRng('paver-tone');
  const tone = Array.from({ length: 16 * 8 * 2 }, () => R());
  return paint(N, (x, y, i) => {
    const row = y >> 5, off = (row & 1) * 32, col = ((x + off) & 511) >> 6;
    const lx = (x + off) & 63, ly = y & 31;
    const edge = Math.min(lx, 63 - lx, ly, 31 - ly);
    const t = tone[(row * 8 + col) % tone.length], red = (row % 6 === 0) ? 1 : 0;
    let r = 150 + 30 * t, g = 144 + 26 * t, b = 134 + 22 * t;
    if (red) { r = 150 + 25 * t; g = 92 + 15 * t; b = 72 + 12 * t; }
    const v = (0.8 + 0.35 * n[i]) * (edge < 1 ? 0.45 : edge < 3 ? 0.82 + 0.06 * edge : 1);
    return [r * v, g * v, b * v];
  });
}

/** Coursed laterite/granite blocks with recessed mortar: 256 px ≙ 4 m. */
function stoneCanvas() {
  const N = 256, c = mkCanvas(N), g = c.getContext('2d'), R = makeRng('stone');
  g.fillStyle = '#6d6356'; g.fillRect(0, 0, N, N);
  const rows = 8, rh = N / rows;
  for (let r = 0; r < rows; r++) {
    let x = -(r % 2) * 20 - R() * 10;
    while (x < N) {
      const w = 28 + R() * 34;
      const t = R(), base = t < 0.55 ? [150, 104, 78] : t < 0.85 ? [138, 128, 116] : [118, 92, 70];
      const k = 0.8 + R() * 0.35;
      const col = base.map(v => Math.round(v * k));
      for (const off of [0, N]) {        // wrap horizontally
        g.fillStyle = `rgb(${col})`; g.fillRect(x + 1.5 - off, r * rh + 1.5, w - 3, rh - 3);
        g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 1.5 - off, r * rh + 1.5, w - 3, 3);
        g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 1.5 - off, r * rh + rh - 5, w - 3, 3.5);
      }
      x += w;
    }
  }
  // pitting + salt/damp staining
  const n = fbmTile(N, 'stone-n', [[16, 0.5], [64, 0.5]]);
  const im = g.getImageData(0, 0, N, N);
  for (let i = 0; i < N * N; i++) {
    const k = 0.78 + 0.34 * n[i];
    for (let j = 0; j < 3; j++) im.data[i * 4 + j] = Math.min(255, im.data[i * 4 + j] * k);
  }
  g.putImageData(im, 0, 0);
  return c;
}

/** Weathered coastal granite: grey-brown mottling, lichen, dark cracks. */
function rockCanvas() {
  const N = 256, n = fbmTile(N, 'rock', [[4, 0.3], [16, 0.3], [64, 0.25], [128, 0.15]]);
  const l = fbmTile(N, 'lichen', [[8, 0.6], [32, 0.4]]);
  return paint(N, (x, y, i) => {
    let v = 0.55 + 0.6 * n[i];
    const crack = Math.abs(n[i] - 0.5) < 0.012 ? 0.55 : 1;
    const li = smoothstep(0.62, 0.72, l[i]);
    const r = (132 * v) * (1 - li) + 160 * li, gg = (122 * v) * (1 - li) + 150 * li, b = (110 * v) * (1 - li) + 96 * li;
    return [r * crack, gg * crack, b * crack];
  });
}

/* Glazing atlas: 4×4 window units (3.4 m × 2.75 m each). A dark-bronze
 * aluminium frame with a centre mullion and a transom, glass carrying a baked
 * reflection of the sky and horizon, sheers/curtains behind, and — in the
 * emissive twin — warm room light in about half of them. */
const GA = 4;
function glazingAtlas() {
  const S = 128, N = S * GA, cm = mkCanvas(N), ce = mkCanvas(N);
  const g = cm.getContext('2d'), e = ce.getContext('2d'), R = makeRng('glazing');
  e.fillStyle = '#000'; e.fillRect(0, 0, N, N);
  for (let cy = 0; cy < GA; cy++) for (let cx = 0; cx < GA; cx++) {
    const x0 = cx * S, y0 = cy * S, lit = (cx + cy * GA) % 16 < 9 ? R() < 0.8 : R() < 0.15;
    // glass: sky reflection (bright top → horizon band → darker ground bounce)
    const gr = g.createLinearGradient(0, y0, 0, y0 + S);
    gr.addColorStop(0, '#c9dbe4'); gr.addColorStop(0.38, '#9db6c4'); gr.addColorStop(0.55, '#e3d6c0');
    gr.addColorStop(0.62, '#6f8592'); gr.addColorStop(1, '#3c4a54');
    g.fillStyle = gr; g.fillRect(x0, y0, S, S);
    // what is seen through: curtains (cream sheers) drawn from the sides
    const cw = 16 + R() * 40, side = R() < 0.5;
    const curtain = ['#e8dcc4', '#d9c7a4', '#efe6d4', '#c9b08a'][Math.floor(R() * 4)];
    g.globalAlpha = 0.55;
    g.fillStyle = curtain;
    g.fillRect(x0 + 6, y0 + 26, cw, S - 32);
    if (side) g.fillRect(x0 + S - 6 - cw * 0.7, y0 + 26, cw * 0.7, S - 32);
    if (lit) { g.fillStyle = '#e9c592'; g.fillRect(x0 + 8 + cw, y0 + 30, S - 20 - cw * 1.6, S - 40); }
    g.globalAlpha = 1;
    // diagonal reflection streak
    g.save(); g.beginPath(); g.rect(x0, y0, S, S); g.clip();
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.beginPath(); const o = R() * S;
    g.moveTo(x0 + o, y0); g.lineTo(x0 + o + 26, y0); g.lineTo(x0 + o - 30, y0 + S); g.lineTo(x0 + o - 56, y0 + S); g.fill();
    g.restore();
    // frame: outer 5 px, centre mullion 4 px, transom 3 px at 22 %
    g.fillStyle = '#39332c';
    g.fillRect(x0, y0, S, 5); g.fillRect(x0, y0 + S - 6, S, 6); g.fillRect(x0, y0, 5, S); g.fillRect(x0 + S - 5, y0, 5, S);
    g.fillRect(x0 + S / 2 - 2, y0 + 24, 4, S - 24); g.fillRect(x0, y0 + 24, S, 3);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x0 + 5, y0 + 5, S - 10, 1);
    if (lit) {
      const k = 0.55 + R() * 0.45;
      e.fillStyle = `rgba(255,${Math.round(178 + 40 * k)},${Math.round(110 + 40 * k)},${k})`;
      e.fillRect(x0 + 8, y0 + 28, S - 16, S - 36);
      e.fillStyle = `rgba(255,214,150,${0.5 * k})`; e.fillRect(x0 + 8, y0 + 8, S - 16, 14);
      e.fillStyle = '#000'; e.fillRect(x0 + S / 2 - 2, y0 + 24, 4, S - 24); e.fillRect(x0, y0 + 24, S, 3);
    }
  }
  return { map: canvasTex(cm, true, false), em: canvasTex(ce, true, false) };
}

/** 'PALM BEACH HOTEL' as lit channel letters on a charcoal band, fitted to width. */
function signTexture(board = true) {
  const W = 1024, H = 128, c = mkCanvas(W, H), g = c.getContext('2d');
  if (board) { g.fillStyle = '#2b2a28'; g.fillRect(0, 0, W, H); g.fillStyle = '#b08a4a'; g.fillRect(0, 0, W, 5); g.fillRect(0, H - 5, W, 5); }
  const text = 'PALM BEACH HOTEL';
  let px = 96;
  g.font = `600 ${px}px Georgia, "Times New Roman", serif`;
  const w = g.measureText(text).width;
  px = Math.floor(px * Math.min(1, (W * 0.9) / w));
  g.font = `600 ${px}px Georgia, "Times New Roman", serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(255,200,120,0.9)'; g.shadowBlur = 14;
  g.fillStyle = '#fff3d6'; g.fillText(text, W / 2, H / 2 + 4);
  g.shadowBlur = 0; g.fillText(text, W / 2, H / 2 + 4);
  return canvasTex(c, true, false);
}

/** Pool: aqua mosaic tiles with a dark lane line. */
function poolTexture() {
  const N = 128, n = fbmTile(N, 'pool', [[8, 0.5], [32, 0.5]]);
  return canvasTex(paint(N, (x, y, i) => {
    const grout = (x % 16 < 1 || y % 16 < 1) ? 0.86 : 1, lane = (x > 60 && x < 68) ? 0.55 : 1;
    const v = (0.9 + 0.12 * n[i]) * grout * lane;
    return [70 * v, 190 * v, 205 * v];
  }));
}

/* ---------- Palm Beach Hotel: building (hotel-local, +x = road side, -z = ahead) ---------- */

const DIM = { MX: -3, MW: 14, ML: 48, NS: 5, TW: 17, TL: 16, TS: 6 };
const WHITE = 0xf7f4ee, CREAM = 0xefe5d3, SLAB = 0xfbf9f4, STONE = 0x9c9184, TERRA = 0xb4623c, STEEL = 0x3a3836;

/** Glazing pane on a face with outward normal along `axis` (±1 = sgn) at coordinate c. */
function pane(G, R, axis, sgn, c, a0, a1, y0, y1) {
  const cell = Math.floor(R() * GA * GA), cx = cell % GA, cy = Math.floor(cell / GA);
  let u0 = cx / GA, u1 = (cx + 1) / GA; if (R() < 0.5) [u0, u1] = [u1, u0];
  const v1 = 1 - cy / GA, v0 = 1 - (cy + 1) / GA;
  // corners as seen from outside: bottom-left → bottom-right → top-right → top-left
  let L, Rr;
  if (axis === 'x') { L = sgn > 0 ? a1 : a0; Rr = sgn > 0 ? a0 : a1; }
  else { L = sgn > 0 ? a0 : a1; Rr = sgn > 0 ? a1 : a0; }
  const P = (a, y) => axis === 'x' ? [c, y, a] : [a, y, c];
  const q = [P(L, y0), P(Rr, y0), P(Rr, y1), P(L, y1)], t = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const n = axis === 'x' ? [sgn, 0, 0] : [0, 0, sgn];
  for (const k of [0, 1, 2, 0, 2, 3]) { G.pos.push(...q[k]); G.uv.push(...t[k]); G.nrm.push(...n); }
}

/** One rectangular block: walls, slab bands, fins, glazing, balconies. */
function block(ctx, S, G, B, R, { x, z, w, d, storeys, balcSides = [-1, 1], endGlass = true, skipBalc = () => false }) {
  const { T } = S, H = storeys * STOREY;
  const RC = 0.45;                                                         // glazing recess behind the fins/slab line
  S.parts.push(box(w - 2 * RC, H, d, x, T + H / 2, z, CREAM));
  S.parts.push(box(w + 0.12, 0.5, d + 0.12, x, T + 0.25, z, STONE));                     // stone plinth
  for (let k = 1; k <= storeys; k++) S.parts.push(box(w + 0.5, 0.28, d + 0.5, x, T + k * STOREY - 0.14, z, SLAB));
  const nb = Math.round(d / BAY), bw = d / nb;
  for (const sg of [-1, 1]) {
    const fx = x + sg * w / 2;
    for (let b = 0; b <= nb; b++) S.parts.push(box(0.5, H, 0.42, fx + sg * 0.2, T + H / 2, z - d / 2 + b * bw, WHITE)); // fins
    for (let b = 0; b < nb; b++) for (let k = 0; k < storeys; k++) {
      const za = z - d / 2 + b * bw + 0.3, zb = za + bw - 0.6, y0 = T + k * STOREY + (k ? 0.1 : 0.5);
      const y1 = T + (k + 1) * STOREY - 0.32, gx = fx - sg * (RC - 0.03);
      pane(G, R, 'x', sg, gx, za, zb, y0, y1);
      // aluminium frame: sill, head, jambs and a sliding-door mullion
      S.parts.push(box(0.14, 0.09, zb - za + 0.1, gx + sg * 0.05, y0 - 0.02, (za + zb) / 2, STEEL));
      S.parts.push(box(0.14, 0.09, zb - za + 0.1, gx + sg * 0.05, y1 + 0.02, (za + zb) / 2, STEEL));
      for (const zz of [za - 0.03, zb + 0.03, (za + zb) / 2]) S.parts.push(box(0.12, y1 - y0, 0.07, gx + sg * 0.05, (y0 + y1) / 2, zz, STEEL));
      S.parts.push(box(RC, y1 - y0 + 0.3, 0.1, fx - sg * RC / 2, (y0 + y1) / 2, za - 0.25, WHITE));   // reveal returns
      S.parts.push(box(RC, y1 - y0 + 0.3, 0.1, fx - sg * RC / 2, (y0 + y1) / 2, zb + 0.25, WHITE));
      // split AC outdoor unit on every other balcony wall
      if (k > 0 && (b + k) % 2 === 0) S.parts.push(box(0.3, 0.55, 0.8, fx - sg * RC + sg * 0.16, T + k * STOREY + 0.32, zb - 0.1, 0xe6e4df));
      if (k > 0 && balcSides.includes(sg) && !skipBalc(sg, b, k)) B.push({ x: fx, y: T + k * STOREY, z: za + (bw - 0.6) / 2, sg });
    }
  }
  if (endGlass) for (const sg of [-1, 1]) {
    const fz = z + sg * d / 2;
    for (let k = 0; k < storeys; k++) pane(G, R, 'z', sg, fz + sg * 0.03, x - 1.3, x + 1.3, T + k * STOREY + 0.5, T + (k + 1) * STOREY - 0.4);
    for (const o of [-3.6, 3.6]) S.parts.push(box(1.3, H - 0.6, 0.12, x + o, T + H / 2 + 0.3, fz + sg * 0.06, TERRA)); // cladding strips
  }
  // roof: parapet + coping
  const top = T + H, ph = 1.1;
  S.parts.push(box(w + 0.5, ph, 0.22, x, top + ph / 2, z - d / 2 - 0.14, WHITE), box(w + 0.5, ph, 0.22, x, top + ph / 2, z + d / 2 + 0.14, WHITE));
  S.parts.push(box(0.22, ph, d + 0.5, x - w / 2 - 0.14, top + ph / 2, z, WHITE), box(0.22, ph, d + 0.5, x + w / 2 + 0.14, top + ph / 2, z, WHITE));
  S.parts.push(box(w + 0.7, 0.1, 0.36, x, top + ph + 0.05, z - d / 2 - 0.14, TERRA), box(w + 0.7, 0.1, 0.36, x, top + ph + 0.05, z + d / 2 + 0.14, TERRA));
  S.parts.push(box(0.36, 0.1, d + 0.7, x - w / 2 - 0.14, top + ph + 0.05, z, TERRA), box(0.36, 0.1, d + 0.7, x + w / 2 + 0.14, top + ph + 0.05, z, TERRA));
  S.parts.push(box(w - 0.1, 0.12, d - 0.1, x, top + 0.06, z, 0x9d978c));                 // roof screed
  return top;
}

function sintex(parts, x, y, z) {                                   // black PE water tank on a stand
  parts.push(box(1.9, 0.5, 1.9, x, y + 0.25, z, 0x8f8a80));
  parts.push(cyl(0.78, 0.82, 1.5, 16, x, y + 1.25, z, 0x1c1c1c), cyl(0.5, 0.78, 0.25, 16, x, y + 2.12, z, 0x222222));
  parts.push(cyl(0.2, 0.2, 0.1, 10, x, y + 2.28, z, 0x2a2a2a));
}

function balconyGeos() {
  const w = BAY - 0.6, dp = 1.5, h = 1.05;
  const solid = mergeGeo([
    box(dp, 0.2, w + 0.1, dp / 2, -0.1, 0, SLAB),
    box(0.06, 0.07, w + 0.1, dp - 0.03, h, 0, STEEL),                                      // handrail
    box(dp, 0.07, 0.06, dp / 2, h, w / 2 + 0.02, STEEL), box(dp, 0.07, 0.06, dp / 2, h, -w / 2 - 0.02, STEEL),
    box(0.08, 0.1, w, dp - 0.04, 0.05, 0, STEEL),                                         // shoe channel
    ...[-w / 2, -w / 6, w / 6, w / 2].map(z => box(0.045, h, 0.045, dp - 0.04, h / 2, z, STEEL))
  ]);
  const glass = mergeGeo([
    new THREE.PlaneGeometry(w, h - 0.12).rotateY(Math.PI / 2).translate(dp - 0.04, h / 2 + 0.02, 0).toNonIndexed(),
    new THREE.PlaneGeometry(dp, h - 0.12).translate(dp / 2, h / 2 + 0.02, w / 2).toNonIndexed(),
    new THREE.PlaneGeometry(dp, h - 0.12).translate(dp / 2, h / 2 + 0.02, -w / 2).toNonIndexed()
  ].map(g => { g.deleteAttribute('uv'); return g; }));
  boxUV(solid, 2);
  return { solid, glass };
}

function loungers(parts, x0, z0, z1, flip) {
  for (let z = z0; z <= z1; z += 3.1) {
    parts.push(box(0.72, 0.28, 1.35, x0, 0.14, z + 0.3, 0xf0ece4), box(0.66, 0.07, 1.3, x0, 0.31, z + 0.3, 0x2f5f8a));
    const back = new THREE.BoxGeometry(0.72, 0.08, 0.75).rotateX(flip * 0.9).translate(x0, 0.52, z - 0.62);
    parts.push(colored(back, 0x2f5f8a));
  }
}
function umbrella(parts, x, y, z) {
  parts.push(cyl(0.04, 0.04, 2.4, 6, x, y + 1.2, z, 0x8a6a48));
  parts.push(colored(new THREE.ConeGeometry(1.5, 0.5, 10, 1).translate(x, y + 2.45, z), 0xefe4cc));
}

export function buildHotel(ctx, venue) {
  const { path } = ctx;
  const tx = textures();
  const hotel = new THREE.Group();
  hotel.name = 'palm-beach-hotel';
  const P = path.toWorld(venue.s, venue.lateral);
  hotel.position.set(P.x, 0, P.z);
  hotel.rotation.y = path.sample(venue.s).heading;
  const T = path.roadY(venue.s) - 0.3;                 // plot level (world y)
  const bld = new THREE.Group();
  bld.name = 'hotel-building';
  bld.position.set(BLD_DX, 0, BLD_DZ);
  hotel.add(bld);

  const { MX, MW, ML, NS, TW, TL, TS } = DIM;
  const S = { T, parts: [] }, G = { pos: [], uv: [], nrm: [] }, B = [], R = makeRng('palm-beach');
  const wl = (ML - TL) / 2;
  const top = block(ctx, S, G, B, R, { x: MX, z: -(TL / 2 + wl / 2), w: MW, d: wl, storeys: NS });
  block(ctx, S, G, B, R, { x: MX, z: (TL / 2 + wl / 2), w: MW, d: wl, storeys: NS });
  const ttop = block(ctx, S, G, B, R, { x: MX, z: 0, w: TW, d: TL, storeys: TS, endGlass: false,
    skipBalc: (sg, b, k) => sg > 0 && k === 1 });
  // tower's exposed top storey on its end faces
  for (const sg of [-1, 1]) for (const o of [-4.5, 0, 4.5]) pane(G, R, 'z', sg, sg * (TL / 2 + 0.03), MX + o - 1.6, MX + o + 1.6, T + NS * STOREY + 0.4, ttop - 0.35);
  // roof furniture: Sintex tanks on the wings, lift machine room + crown frame on the tower
  for (const sz of [-1, 1]) for (const [dx, dz] of [[-3, 3], [-0.6, 3], [1.8, 3], [-3, 12]]) sintex(S.parts, MX + dx, top + 0.12, sz * (TL / 2 + dz));
  S.parts.push(box(5, 3, 4.4, MX - 3, ttop + 1.5, -3, CREAM), box(5.4, 0.2, 4.8, MX - 3, ttop + 3.1, -3, SLAB));
  S.parts.push(box(TW - 3, 0.35, 0.5, MX, ttop + 3.4, TL / 2 - 0.2, WHITE));             // crown sign beam
  for (const x of [MX - TW / 2 + 1.8, MX + TW / 2 - 1.8]) S.parts.push(box(0.45, 3.4, 0.45, x, ttop + 1.7, TL / 2 - 0.2, WHITE));
  S.parts.push(box(0.5, 0.35, TL - 3, MX + TW / 2 - 0.2, ttop + 3.4, 0, WHITE));
  for (const z of [-TL / 2 + 1.8, TL / 2 - 1.8]) S.parts.push(box(0.45, 3.4, 0.45, MX + TW / 2 - 0.2, ttop + 1.7, z, WHITE));

  // more roof plant: tilted solar rows on the wings, condensers + a stair
  // head, lightning finials and a dish on the tower
  for (const sz of [-1, 1]) for (let r = 0; r < 3; r++) for (let q = 0; q < 2; q++) {
    const pz = sz * (TL / 2 + 6 + q * 4.2), px = MX + 1.2 + r * 1.9;
    S.parts.push(colored(new THREE.BoxGeometry(1.7, 0.05, 3.9).rotateZ(-0.22).translate(px, top + 0.75, pz), 0x1d2a3e));
    for (const oz of [-1.6, 1.6]) S.parts.push(box(0.06, 0.6, 0.06, px + 0.6, top + 0.42, pz + oz, 0x9a9a9a));
  }
  for (const sz of [-1, 1]) S.parts.push(box(3.2, 2.6, 3, MX + 3.5, top + 1.3, sz * (TL / 2 + wl - 2), CREAM), box(3.5, 0.18, 3.3, MX + 3.5, top + 2.68, sz * (TL / 2 + wl - 2), SLAB));
  for (let i = 0; i < 4; i++) {
    const ux = MX + 2.2 + (i % 2) * 2.4, uz = 1.5 + Math.floor(i / 2) * 2.2;
    S.parts.push(box(1.1, 0.9, 1.6, ux, ttop + 0.57, uz, 0xdcdad4), cyl(0.42, 0.42, 0.05, 16, ux, ttop + 1.04, uz - 0.35, 0x2a2a2a), cyl(0.42, 0.42, 0.05, 16, ux, ttop + 1.04, uz + 0.35, 0x2a2a2a));
  }
  for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) S.parts.push(cyl(0.025, 0.025, 1.6, 5, MX + ax * (TW / 2 - 0.2), ttop + 1.9, az * (TL / 2 - 0.2), 0x8a8a8a));
  S.parts.push(colored(new THREE.SphereGeometry(0.55, 12, 6, 0, Math.PI * 2, 0, 1.1).rotateZ(1.2).translate(MX - 5.5, ttop + 1.1, 4.5), 0xe8e8e8));
  S.parts.push(box(0.1, 0.9, 0.1, MX - 5.2, ttop + 0.5, 4.5, 0x8a8a8a));
  // porte-cochère on the road side of the tower
  const px0 = MX + TW / 2, px1 = px0 + 10, pcx = (px0 + px1) / 2, cy = T + 4.9;
  S.parts.push(box(10, 0.6, 13, pcx, cy, 0, SLAB));
  S.parts.push(box(0.3, 1.4, 13.3, px1, cy, 0, 0x2b2a28), box(10.2, 1.4, 0.3, pcx, cy, 6.65, 0x2b2a28), box(10.2, 1.4, 0.3, pcx, cy, -6.65, 0x2b2a28));
  for (const z of [-5.8, 5.8]) {
    S.parts.push(cyl(0.38, 0.38, 4.2, 14, px1 - 0.8, T + 2.1, z, 0xcdbfa8), box(0.95, 0.35, 0.95, px1 - 0.8, T + 0.17, z, STONE));
  }
  S.parts.push(box(10, 0.06, 13, pcx, T + 0.03, 0, 0x8d877d));                          // drop-off paving
  for (const z of [-3.5, 3.5]) S.parts.push(box(1.6, 0.9, 1.6, px0 + 1.2, T + 0.45, z, TERRA)); // planters

  // pool deck on the sea side
  const dx = MX - MW / 2 - 6.6, poolL = 20, poolW = 6;
  S.parts.push(box(13, 0.18, 30, dx, T + 0.09, 0, 0xd8c9ab));
  for (const sg of [-1, 1]) {
    S.parts.push(box(poolW + 0.8, 0.1, 0.4, dx, T + 0.23, sg * (poolL / 2 + 0.2), 0xeee6d6));
    S.parts.push(box(0.4, 0.1, poolL + 0.8, dx + sg * (poolW / 2 + 0.2), T + 0.23, 0, 0xeee6d6));
  }
  const lp = [];
  loungers(lp, dx - poolW / 2 - 1.6, -8, 8, 1); loungers(lp, dx + poolW / 2 + 1.6, -8, 8, 1);
  for (const z of [-6.5, 0, 6.5]) { umbrella(lp, dx - poolW / 2 - 2.9, 0, z); umbrella(lp, dx + poolW / 2 + 2.9, 0, z); }
  for (const g of lp) g.translate(0, T + 0.18, 0);
  S.parts.push(...lp);

  // sign boards behind the tower-crown letters
  S.parts.push(box(TW - 3.6, (TW - 4.2) / 8 + 0.4, 0.2, MX, ttop + 2.2, TL / 2 - 0.2, 0x2b2a28));
  const shellGeo = boxUV(mergeGeo(S.parts), 3);
  const shellMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tx.grain, bumpMap: tx.bump, bumpScale: 1.2, roughness: 0.86 });
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.name = 'hotel-shell';
  bld.add(shell);

  const ga = glazingAtlas();
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3));
  gg.setAttribute('normal', new THREE.Float32BufferAttribute(G.nrm, 3));
  gg.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2));
  const glassMat = new THREE.MeshStandardMaterial({ map: ga.map, emissiveMap: ga.em, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.12, metalness: 0.15 });
  const glass = new THREE.Mesh(gg, glassMat);
  glass.name = 'hotel-glazing';
  bld.add(glass);

  // balconies (instanced): solid parts + glass balustrades
  const bg = balconyGeos();
  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tx.grain, roughness: 0.6, metalness: 0.2 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xa9ccd0, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.3, depthWrite: false, side: THREE.DoubleSide });
  const bs = new THREE.InstancedMesh(bg.solid, solidMat, B.length), br = new THREE.InstancedMesh(bg.glass, railMat, B.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  B.forEach((b, i) => {
    m.compose(p.set(b.x, b.y, b.z), q.setFromAxisAngle(UP, b.sg > 0 ? 0 : Math.PI), one);
    bs.setMatrixAt(i, m); br.setMatrixAt(i, m);
  });
  bs.computeBoundingSphere(); br.computeBoundingSphere();
  bs.name = 'hotel-balconies'; br.name = 'hotel-balcony-glass';
  br.renderOrder = 2;
  bld.add(bs, br);

  // signage: front-faced planes only (a back face would read mirrored)
  const signTex = signTexture(true);
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissiveMap: signTex, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.5 });
  const facingX = (w, h, x, y, z) => new THREE.PlaneGeometry(w, h).rotateY(Math.PI / 2).translate(x, y, z).toNonIndexed();
  const facingZ = (w, h, x, y, z) => new THREE.PlaneGeometry(w, h).translate(x, y, z).toNonIndexed();
  const sign = new THREE.Mesh(mergeGeo([
    facingX(10.4, 1.3, px1 + 0.16, cy, 0),                                   // porte-cochère, road face
    facingZ(TW - 4.2, (TW - 4.2) / 8, MX, ttop + 2.2, TL / 2 - 0.2 + 0.12)    // tower crown, approach face (the one rooftop sign)
  ]), signMat);
  sign.name = 'hotel-sign';
  bld.add(sign);

  // pool water
  const pt = poolTexture(); pt.repeat.set(poolW / 2, poolL / 2);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(poolW, poolL).rotateX(-Math.PI / 2).translate(dx, T + 0.2, 0),
    new THREE.MeshStandardMaterial({ map: pt, emissive: 0x0c6a78, emissiveIntensity: 0.3, roughness: 0.04, metalness: 0.1 }));
  pool.name = 'hotel-pool';
  bld.add(pool);

  return { hotel, bld, T, shellMat, glassMat, signMat, pool, dims: { ...DIM, top, ttop, px1, pcx, dx } };
}

/* ---------- hotel plot: lawn, sea wall, compound wall, driveway (world space) ---------- */

function wallAlong(parts, pts, h, t, hex, capHex, piers = 0) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const yaw = Math.atan2(dx, dz), base = Math.min(a.y, b.y) - 0.4, mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const top = Math.max(a.y, b.y) + h;
    const g = new THREE.BoxGeometry(t, top - base, len + t * 0.5).rotateY(yaw).translate(mx, (top + base) / 2, mz);
    parts.push(colored(g, hex));
    parts.push(colored(new THREE.BoxGeometry(t + 0.1, 0.08, len + t * 0.5).rotateY(yaw).translate(mx, top + 0.04, mz), capHex));
    if (piers && i % piers === 0) {
      parts.push(colored(new THREE.BoxGeometry(t + 0.25, top - base + 0.35, t + 0.25).rotateY(yaw).translate(a.x, (top + base + 0.35) / 2, a.z), hex));
      parts.push(colored(new THREE.BoxGeometry(t + 0.4, 0.1, t + 0.4).rotateY(yaw).translate(a.x, top + 0.4, a.z), capHex));
    }
  }
}

function buildSite(ctx, venue, H) {
  const { path, world } = ctx;
  const tx = textures();
  const wl = world.waterAt(venue.s) ?? 0;
  const T = H.T;
  // the building's porte-cochère in road coordinates → where the drive meets the road
  const pc = H.bld.localToWorld(new THREE.Vector3(H.dims.px1, T, 0));
  const nPC = path.nearest(pc.x, pc.z);
  // the gate is centred 8 m past the pull-over spot so the parked car sits on the apron just short of it
  const sMid = STOPS[0].park.s + 8, sA = sMid - 41, sB = sMid + 41;
  const latR = -(world.VERGE + 0.6), latS = venue.lateral - 34, rc = 14;
  const seaLat = s => { const de = Math.min(s - sA, sB - s); return de >= rc ? latS : latS + (rc - Math.sqrt(Math.max(0, rc * rc - (rc - de) ** 2))); };
  const plotY = (s, lat) => {
    const t = smoothstep(world.VERGE + 0.6, world.VERGE + 7, -lat);
    return world.heightSL(s, lat) * (1 - t) + T * t;
  };
  const W = (s, lat, dy = 0) => { const p = path.toWorld(s, lat); p.y = plotY(s, lat) + dy; return p; };

  // lawn: a grid between the road edge and the rounded sea edge
  const NR = 48, NC = 26, pos = [], col = [], uv = [], idx = [];
  const cLawn = new THREE.Color(0xffffff), cVerge = new THREE.Color(0xc9b98e), c = new THREE.Color();
  for (let i = 0; i <= NR; i++) {
    const s = sA + (sB - sA) * (i / NR), e = seaLat(s);
    for (let j = 0; j <= NC; j++) {
      const lat = latR + (e - latR) * (j / NC), p = W(s, lat);
      pos.push(p.x, p.y, p.z); uv.push(p.x / 5, p.z / 5);
      c.copy(cVerge).lerp(cLawn, smoothstep(world.VERGE + 0.6, world.VERGE + 3, -lat)).multiplyScalar(0.92 + 0.08 * Math.sin(p.x * 0.3 + p.z * 0.2));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < NC; j++) {
    const a = i * (NC + 1) + j, b = a + NC + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  lg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  lg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  lg.setIndex(idx); lg.computeVertexNormals();
  if (lg.attributes.normal.getY(0) < 0) { idx.reverse(); lg.setIndex(idx); lg.computeVertexNormals(); }
  const lawn = new THREE.Mesh(lg, new THREE.MeshStandardMaterial({ vertexColors: true, map: tx.lawn, roughness: 0.95 }));
  lawn.name = 'hotel-lawn';

  // perimeter (ends + sea edge) in road coords, finer toward the corners
  const per = [], inset = [];
  const push = (s, lat, dS, dL) => { per.push([s, lat]); inset.push([s + dS, lat + dL]); };
  for (let k = 0; k <= 8; k++) push(sA, latR + (latS + rc - latR) * (k / 8), 0.3, 0);
  for (let k = 1; k < 60; k++) { const u = k / 60, s = sA + (sB - sA) * (0.5 - 0.5 * Math.cos(Math.PI * u)); push(s, seaLat(s), 0, 0.3); }
  for (let k = 8; k >= 0; k--) push(sB, latR + (latS + rc - latR) * (k / 8), -0.3, 0);

  // sea wall: battered coursed stone from the plot edge down past the sand
  const cen = W(sMid, (latR + latS) / 2);
  const sw = { pos: [], uv: [], col: [] };
  let run = 0, prev = null;
  const cWet = new THREE.Color(0x4f5a44), cDry = new THREE.Color(0xffffff);
  const col2 = [];
  for (const [s, lat] of per) {
    const top = W(s, lat, 0.05), g = Math.min(world.heightSL(s, lat), wl) - 1.6;
    const out = new THREE.Vector3(top.x - cen.x, 0, top.z - cen.z).normalize().multiplyScalar((top.y - g) * 0.12);
    const bot = new THREE.Vector3(top.x + out.x, g, top.z + out.z);
    if (prev) run += Math.hypot(top.x - prev.x, top.z - prev.z);
    col2.push({ top, bot, u: run / 4 });
    prev = top;
  }
  for (let i = 0; i + 1 < col2.length; i++) {
    const a = col2[i], b = col2[i + 1];
    const V = [[a.bot, a.u], [b.bot, b.u], [b.top, b.u], [a.bot, a.u], [b.top, b.u], [a.top, a.u]];
    for (const [p, u] of V) {
      sw.pos.push(p.x, p.y, p.z); sw.uv.push(u, p.y / 4);
      c.copy(cWet).lerp(cDry, smoothstep(wl - 0.4, wl + 1.2, p.y)); sw.col.push(c.r, c.g, c.b);
    }
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sw.pos, 3));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute(sw.uv, 2));
  sg.setAttribute('color', new THREE.Float32BufferAttribute(sw.col, 3));
  sg.computeVertexNormals();
  const seaWall = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ vertexColors: true, map: tx.stone, bumpMap: tx.stone, bumpScale: 2, roughness: 0.92, side: THREE.DoubleSide }));
  seaWall.name = 'hotel-sea-wall';

  // beach skirt: the plot is reclaimed land, so a sand beach runs from the
  // sea-wall toe (≈1 m above the tide) down under the surf, ~14 m of dry and
  // wet sand between the wall and the waterline. Rows follow the perimeter's
  // outward normal; the far rows sink below the seabed so no edge shows.
  const DS = [0, 0.8, 2.5, 5, 8, 11.5, 15, 19, 24, 30, 38, 48];
  const sandY = d => wl + 1.05 - 0.07 * d - 0.0009 * d * d;
  const bpos = [], bcol = [], buv = [], bidx = [];
  const cDune = new THREE.Color(0xe6d3a6), cDamp = new THREE.Color(0xb49c70), cSub = new THREE.Color(0x8e7b58);
  const nrm = new THREE.Vector3();
  per.forEach(([s, lat], i) => {
    const a = W(...per[Math.max(0, i - 1)]), b = W(...per[Math.min(per.length - 1, i + 1)]), top = W(s, lat);
    nrm.set(b.z - a.z, 0, a.x - b.x).normalize();
    if (nrm.x * (top.x - cen.x) + nrm.z * (top.z - cen.z) < 0) nrm.negate();
    const toeOut = (top.y - (wl - 1.6)) * 0.12 * 0.3;               // start just inside the battered face
    for (const d of DS) {
      const x = top.x + nrm.x * (d + toeOut), z = top.z + nrm.z * (d + toeOut);
      const y = Math.min(sandY(d) + 0.18 * Math.sin(x * 0.21 + z * 0.13) * smoothstep(3, 12, d) * (1 - smoothstep(20, 30, d)), top.y - 0.6);
      bpos.push(x, y, z); buv.push(x / 6, z / 6);
      c.copy(cDune).lerp(cDamp, smoothstep(wl + 0.7, wl + 0.1, y)).lerp(cSub, smoothstep(wl - 0.2, wl - 1.2, y));
      c.multiplyScalar(0.94 + 0.06 * Math.sin(x * 0.7) * Math.sin(z * 0.9));
      bcol.push(c.r, c.g, c.b);
    }
  });
  const NDs = DS.length;
  for (let i = 0; i + 1 < per.length; i++) for (let k = 0; k + 1 < NDs; k++) {
    const a = i * NDs + k, b = (i + 1) * NDs + k;
    bidx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const bgeo = new THREE.BufferGeometry();
  bgeo.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3));
  bgeo.setAttribute('color', new THREE.Float32BufferAttribute(bcol, 3));
  bgeo.setAttribute('uv', new THREE.Float32BufferAttribute(buv, 2));
  bgeo.setIndex(bidx); bgeo.computeVertexNormals();
  if (bgeo.attributes.normal.getY(NDs * 4 + 3) < 0) { bidx.reverse(); bgeo.setIndex(bidx); bgeo.computeVertexNormals(); }
  const beach = new THREE.Mesh(bgeo, new THREE.MeshStandardMaterial({ vertexColors: true, map: tx.grain, bumpMap: tx.bump, bumpScale: 1.5, roughness: 0.97 }));
  beach.name = 'hotel-beach';
  beach.receiveShadow = true;

  // compound wall, set back behind a verge strip, splaying in to a gated entrance
  // (tall piers, an overhead name board, open steel leaves, guard cabin) +
  // sea-side parapet with a steel rail
  const parts = [];
  const gw = 4.6, g0 = sMid - gw, g1 = sMid + gw, latW = Math.min(latR - 2.4, -9.6), latP = latW - 3.2;
  const roadRun = (a, b, l = latW) => { const pts = []; const n = Math.max(1, Math.round((b - a) / 3)); for (let k = 0; k <= n; k++) pts.push(W(a + (b - a) * k / n, l)); return pts; };
  // geometry built in a road frame at (s, lat): local +x = toward the road's right, -z = ahead
  const rf = (g, s, lat, y, hex) => { const p = W(s, lat); return colored(g.rotateY(path.sample(s).heading).translate(p.x, p.y + y, p.z), hex); };
  wallAlong(parts, roadRun(sA + 0.3, g0 - 4.2), 1.5, 0.23, CREAM, TERRA, 1);
  wallAlong(parts, roadRun(g1 + 4.2, sB - 0.3), 1.5, 0.23, CREAM, TERRA, 1);
  wallAlong(parts, [W(g0 - 4.2, latW), W(g0 - 0.7, latP)], 1.5, 0.23, CREAM, TERRA);
  wallAlong(parts, [W(g1 + 4.2, latW), W(g1 + 0.7, latP)], 1.5, 0.23, CREAM, TERRA);
  const sea = inset.map(([s, lat]) => W(s, lat));
  wallAlong(parts, sea, 0.75, 0.25, CREAM, TERRA, 4);
  for (let i = 0; i < sea.length; i += 2) parts.push(box(0.05, 0.4, 0.05, sea[i].x, sea[i].y + 1.0, sea[i].z, STEEL));
  for (let i = 0; i + 2 < sea.length; i += 2) {
    const a = sea[i], b = sea[i + 2], len = Math.hypot(b.x - a.x, b.z - a.z);
    parts.push(colored(new THREE.BoxGeometry(0.06, 0.06, len).rotateY(Math.atan2(b.x - a.x, b.z - a.z)).translate((a.x + b.x) / 2, (a.y + b.y) / 2 + 1.2, (a.z + b.z) / 2), STEEL));
  }
  const PH = 4.6;                                                    // pier height
  for (const s of [g0 - 0.7, g1 + 0.7]) {
    parts.push(rf(new THREE.BoxGeometry(1.3, 0.7, 1.3), s, latP, 0.15, STONE));
    parts.push(rf(new THREE.BoxGeometry(1.1, PH, 1.1), s, latP, PH / 2, CREAM));
    for (const y of [1.6, 3.0]) parts.push(rf(new THREE.BoxGeometry(1.16, 0.06, 1.16), s, latP, y, 0xd9ccb4)); // rustication grooves
    parts.push(rf(new THREE.BoxGeometry(1.35, 0.16, 1.35), s, latP, PH + 0.08, TERRA));
  }
  // overhead name board spanning the piers (the lit sign plane is added below)
  const span = g1 - g0 + 2.5, bs = (g0 + g1) / 2;
  parts.push(rf(new THREE.BoxGeometry(0.55, 1.25, span), bs, latP, PH + 0.78, 0x2b2a28));
  parts.push(rf(new THREE.BoxGeometry(0.7, 0.14, span + 0.2), bs, latP, PH + 1.47, TERRA));
  // open gate leaves swung inward against the splay: steel frame + pickets
  for (const [s, sg] of [[g0 - 0.2, 1], [g1 + 0.2, -1]]) {
    const L = 4.2;
    for (const y of [0.12, 0.9, 1.75]) parts.push(rf(new THREE.BoxGeometry(L, 0.07, 0.06), s, latP - L / 2 - 0.2, y, STEEL));
    for (let k = 0; k <= 26; k++) parts.push(rf(new THREE.BoxGeometry(0.035, 1.75, 0.035), s, latP - 0.3 - k * (L - 0.2) / 26, 0.95, STEEL));
    parts.push(rf(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 10), s, latP - L + 0.1, 0.04, 0x3a3a3a));
  }
  // guard cabin just inside, right of the drive
  { const s = g1 + 3.4, l = latP - 3.2;
    parts.push(rf(new THREE.BoxGeometry(2.4, 2.5, 2.2), s, l, 1.25, CREAM));
    parts.push(rf(new THREE.BoxGeometry(2.9, 0.18, 2.7), s, l, 2.6, TERRA));
    parts.push(rf(new THREE.BoxGeometry(0.04, 0.9, 1.3), s, l + 1.21, 1.5, 0x39434a));  // window toward the gate
    parts.push(rf(new THREE.BoxGeometry(2.5, 0.25, 2.3), s, l, 0.12, STONE)); }
  // gate pier capitals: stepped cornice, a lantern on a plinth, and a granite
  // base course (the piers above are the rusticated shafts)
  for (const s of [g0 - 0.7, g1 + 0.7]) {
    parts.push(rf(new THREE.BoxGeometry(1.25, 0.12, 1.25), s, latP, PH - 0.35, 0xe9dfcb));
    parts.push(rf(new THREE.BoxGeometry(1.2, 0.08, 1.2), s, latP, PH - 0.55, 0xd9ccb4));
    // wall-lantern bracketed on the road face of each pier
    parts.push(rf(new THREE.BoxGeometry(0.3, 0.42, 0.3), s, latP + 0.75, 2.6, 0xf3ecd8));
    parts.push(rf(new THREE.BoxGeometry(0.36, 0.06, 0.36), s, latP + 0.75, 2.84, 0x2b2a28));
    parts.push(rf(new THREE.BoxGeometry(0.2, 0.06, 0.06), s, latP + 0.62, 2.45, 0x2b2a28));
  }
  // entrance apron + drive: pavers from the asphalt edge (the shoulder the car
  // pulls onto), flaring back toward the approach, through the gate to the porte-cochère
  const latE = nPC.lateral - 1.5, latRd = -path.halfWidth + 0.02;
  const NL = 34, dpos = [], duv = [];
  const flare = l => { const u = clamp((latRd - l) / (latRd - latP), 0, 1); return (1 - u) * (1 - u); };
  const halfAt = l => gw + 0.4 + 6 * flare(l);
  const backAt = l => gw + 0.4 + 10.5 * flare(l);                   // reaches park.s − 7 at the road edge
  const lift = l => 0.14 - 0.09 * smoothstep(-world.VERGE, latP, l); // flush with the asphalt at the shoulder
  for (let k = 0; k < NL; k++) {
    const l0 = latRd + (latE - latRd) * (k / NL), l1 = latRd + (latE - latRd) * ((k + 1) / NL);
    const q = [W(sMid - backAt(l0), l0, lift(l0)), W(sMid + halfAt(l0), l0, lift(l0)), W(sMid + halfAt(l1), l1, lift(l1)), W(sMid - backAt(l1), l1, lift(l1))];
    for (const i of [0, 1, 2, 0, 2, 3]) { dpos.push(q[i].x, q[i].y, q[i].z); duv.push(q[i].x / 2.4, q[i].z / 2.4); }
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
  dg.setAttribute('uv', new THREE.Float32BufferAttribute(duv, 2));
  dg.computeVertexNormals();
  if (dg.attributes.normal.getY(0) < 0) { const a = dg.attributes.position.array; for (let i = 0; i < a.length; i += 9) for (let j = 0; j < 3; j++) [a[i + 3 + j], a[i + 6 + j]] = [a[i + 6 + j], a[i + 3 + j]]; dg.computeVertexNormals(); }
  const pavers = new THREE.Mesh(dg, new THREE.MeshStandardMaterial({ map: tx.pavers, bumpMap: tx.pavers, bumpScale: 1.5, roughness: 0.88 }));
  pavers.name = 'hotel-forecourt';
  pavers.receiveShadow = true;
  for (const sg of [-1, 1]) {                                        // kerbs along the drive inside the gate
    const pts = []; for (let k = 0; k <= 8; k++) { const l = latP - 0.8 + (latE + 1.5 - latP) * (k / 8); pts.push(W(sMid + sg * (halfAt(l) + 0.1), l)); }
    wallAlong(parts, pts, 0.12, 0.2, 0xd8d2c6, 0xd8d2c6);
  }
  // forecourt landscaping: clipped hedges behind the kerbs, bollard lights,
  // and a flag court of three poles
  for (const sg of [-1, 1]) for (let k = 0; k < 7; k++) {
    const l0 = latP - 1.4 - k * 3.3, l1 = l0 - 2.8, lm = (l0 + l1) / 2;
    if (l1 < latE + 4) break;
    const sH = sMid + sg * (halfAt(lm) + 0.75);
    const pa = W(sH, l0), pb = W(sH, l1), len = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    const pm = W(sH, lm);
    parts.push(colored(new THREE.BoxGeometry(0.75, 0.8, len).rotateY(Math.atan2(pb.x - pa.x, pb.z - pa.z)).translate(pm.x, pm.y + 0.36, pm.z), 0x5a8a3c));
    const bl = W(sMid + sg * (halfAt(l0) + 0.2), l0 - 1.4);
    parts.push(cyl(0.09, 0.1, 0.8, 8, bl.x, bl.y + 0.4, bl.z, 0x2e2e2e), cyl(0.12, 0.12, 0.12, 8, bl.x, bl.y + 0.84, bl.z, 0xf3efe2));
  }
  for (let k = 0; k < 3; k++) {
    const p = W(g0 - 7 + k * 1.8, latP - 3.5);
    parts.push(cyl(0.06, 0.08, 9.5, 8, p.x, p.y + 4.75, p.z, 0xdcdcdc), cyl(0.3, 0.35, 0.3, 10, p.x, p.y + 0.15, p.z, STONE), colored(new THREE.SphereGeometry(0.1, 8, 6).translate(p.x, p.y + 9.55, p.z), 0xc9a44a));
    const hd = path.sample(g0).heading, fv = new THREE.Vector3(0, 0, -0.8).applyAxisAngle(UP, hd);
    parts.push(colored(new THREE.BoxGeometry(0.03, 1.0, 1.5).rotateY(hd).translate(p.x + fv.x, p.y + 8.9, p.z + fv.z), [0x23355e, 0xefe6d2, 0xb4623c][k]));
  }
  // lit name boards: overhead on the gate (road face) + the monument sign
  const signGeo = (w, h, s, lat, y, yaw = 0) => { const p = W(s, lat); return new THREE.PlaneGeometry(w, h).rotateY(Math.PI / 2 + yaw).translate(0, 0, 0).rotateY(path.sample(s).heading).translate(p.x, p.y + y, p.z).toNonIndexed(); };
  const gateSign = new THREE.Mesh(mergeGeo([
    signGeo(span - 0.6, 1.0, bs, latP + 0.29, PH + 0.78)
  ]), H.signMat);
  gateSign.name = 'hotel-gate-sign';
  const site = new THREE.Mesh(boxUV(mergeGeo(parts), 3), H.shellMat);
  site.name = 'hotel-site';

  // landscaping spots (world), kept off the building, pool deck and drive
  const L = new THREE.Vector3(), D = H.dims;
  const clear = p => {
    H.bld.worldToLocal(L.copy(p));
    if (Math.abs(L.x - D.MX) < D.TW / 2 + 2.5 && Math.abs(L.z) < D.ML / 2 + 2.5) return false;
    if (Math.abs(L.x - D.dx) < 8 && Math.abs(L.z) < 16.5) return false;
    if (L.x > D.MX && L.x < D.px1 + 2 && Math.abs(L.z) < 8) return false;
    return true;
  };
  const R = makeRng('plot-plants'), palms = [], bushes = [];
  const add = (arr, s, lat, sc, tint) => { const p = W(s, lat, -0.1); if (Math.abs(s - sMid) > 16 - Math.min(8, Math.max(0, -lat - 14)) && clear(p)) arr.push({ pos: p, scale: sc, tint }); };
  for (let s = sA + 5; s < sB - 4; s += 7 + R() * 2) add(palms, s, latR - 4.4, 1.05 + R() * 0.3);
  for (let s = sA + 8; s < sB - 8; s += 8 + R() * 3) add(palms, s, seaLat(s) + 3.5, 1.0 + R() * 0.45);
  for (let i = 0; i < 6; i++) add(palms, sA + 12 + R() * (sB - sA - 24), latR - 8 - R() * 10, 0.95 + R() * 0.3);
  for (let s = sA + 1.5; s < sB - 1.5; s += 1.7) add(bushes, s, latR - 1.1, 0.8 + R() * 0.3, R() < 0.22 ? 0xd8408e : 0x9fb86a);
  for (let s = sA + 3; s < sB - 3; s += 2.2) add(bushes, s, seaLat(s) + 1.2, 0.7 + R() * 0.35, R() < 0.3 ? 0xe0569a : 0xa6bf72);
  for (const [s, lat] of [[sMid - 17.5, latR - 1.2], [sMid + 16.5, latR - 1.2], [sMid - 7.5, latR - 7.2], [sMid + 8, latR - 8.4]]) {
    const p = W(s, lat, -0.1); if (clear(p)) bushes.push({ pos: p, scale: 1.25, tint: 0xd23c8c });   // bougainvillea at the gate
  }
  for (const sg of [-1, 1]) for (let k = 0; k < 5; k++) {                                        // palm avenue along the drive
    const l = latR - 10 - k * 6.5, p = W(sMid + sg * 7.2, l, -0.1);
    if (clear(p)) palms.push({ pos: p, scale: 1.15 + 0.08 * ((k * 7 + sg) % 3) });
  }
  return { meshes: [lawn, seaWall, beach, site, pavers, gateSign], palms, bushes, sA, sB, latS };
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
  add(new THREE.BoxGeometry(0.12, 1.1, 0.16).rotateX(-0.35).translate(0, 1.45, -Lb / 2 + 0.05), dark);
  add(new THREE.BoxGeometry(0.12, 0.8, 0.16).rotateX(0.3).translate(0, 1.2, Lb / 2 - 0.05), dark);
  for (const z of [-1.8, -0.2, 1.6]) add(new THREE.BoxGeometry(st(z / (Lb / 2)).w * 2 - 0.08, 0.06, 0.28).translate(0, 0.86, z), wood);
  add(new THREE.BoxGeometry(0.9, 0.04, 5.6).translate(0, 0.32, 0), wood);
  // outrigger: two booms to a float log on the starboard side
  for (const z of [-1.3, 1.3]) add(new THREE.CylinderGeometry(0.055, 0.055, 3.3, 6).rotateZ(Math.PI / 2).translate(1.45, 1.02, z), wood);
  add(new THREE.CylinderGeometry(0.15, 0.15, 4.4, 8).rotateX(Math.PI / 2).translate(3.0, 0.42, 0), 0x5e4a36);
  for (const z of [-1.3, 1.3]) add(new THREE.CylinderGeometry(0.04, 0.04, 0.62, 5).translate(3.0, 0.72, z), wood);
  // outboard on a transom bracket, nets heaped amidships
  add(new THREE.BoxGeometry(0.36, 0.5, 0.5).translate(0.25, 1.35, Lb / 2 + 0.1), 0x2d2f33);
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
    const venue = STOPS[0].venue;
    const wl = world.waterAt(z.mid) ?? 0;

    // sea continues from garden-beach at s0, and runs on past the end of the zone
    group.add(makeWater(ctx, { s0, s1: s1 + 160, lateral0: -world.VERGE, lateral1: -460, y: wl, kind: 'sea', extend: [0, 900] }));

    // the hotel and its plot
    const H = buildHotel(ctx, venue);
    group.add(H.hotel);
    H.hotel.updateMatrixWorld(true);
    const site = buildSite(ctx, venue, H);
    site.meshes.forEach(m => group.add(m));
    const nearHotel = s => s > site.sA - 6 && s < site.sB + 6;
    // shore palms also stay out of the approach sight-line to the hotel
    const inSight = s => s > site.sA - 70 && s < site.sB + 6;
    group.add(plant(ctx, {
      kind: 'palm', count: Math.round(80 * K), seed: 'cove-shore', scale: [0.95, 1.5],
      place: R => {
        const s = s0 + R() * (s1 - s0 + 40);
        if (inSight(s)) return null;
        const sh = shoreLat(ctx, s, 1.2);
        return { s, lateral: sh + 1.5 + R() * Math.max(2, Math.abs(sh) - 8), yaw: Math.PI + (R() - 0.5) * 1.2 + path.sample(s).heading };
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

    // islet offshore, ahead-left of the stop so it frames the hotel
    const isS = z.s0 + (z.s1 - z.s0) * 0.3;
    const isC = path.toWorld(isS, -150); isC.y = wl - 0.2;
    const isl = islet(ctx, isC, 26, wl);
    group.add(isl.mesh);

    // landscaping (plot + islet) shares one palm and one shrub mesh
    group.add(kindAt('palm', [...site.palms, ...isl.palms], 'cove-free-palms', { sink: 0.2 }));
    group.add(kindAt('bush', [...site.bushes, ...isl.bushes], 'cove-free-bush'));

    // rocks: riprap at the sea-wall toe + the islet's skirt of boulders
    const rocks = [...isl.rocks];
    const RR = makeRng('riprap');
    for (let i = 0; i < Math.round(60 * K); i++) {
      const s = site.sA - 4 + RR() * (site.sB - site.sA + 8);
      const lat = site.latS - 0.5 - RR() * 3.5;
      const p = path.toWorld(s, lat), sz = 0.8 + RR() * 1.4;
      p.y = Math.max(world.heightSL(s, lat), wl - 0.6) - sz * 0.25;
      rocks.push({ pos: p, sxyz: [sz * (0.8 + RR() * 0.5), sz * (0.6 + RR() * 0.4), sz * (0.8 + RR() * 0.5)], tint: RR() < 0.5 ? 0x8d8375 : 0x6e675d });
    }
    group.add(kindAt('boulder', rocks, 'cove-rocks-free', { sway: false, rough: 0.95 }));
    group.add(coastRocks(ctx, { s0, s1, count: Math.round(45 * K), seed: 'cove-rocks' }));

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
      if (nearHotel(s)) continue;
      const lat = shoreLat(ctx, s, 0.5) + 3;
      const y = world.heightSL(s, lat);
      if (y < wl) continue;
      spots.push({ pos: path.toWorld(s, lat).setY(y - 0.12), yaw: path.sample(s).heading + Math.PI / 2 + (BR() - 0.5) * 0.5, roll: 0.1, beached: true });
    }
    const bt = boats(ctx, spots);
    group.add(bt.mesh);

    // dune grass on the sea-side verge (not on the hotel plot)
    group.add(duneGrass(ctx, {
      count: Math.round(700 * K), seed: 21,
      place: R => { const s = s0 + R() * (s1 - s0); return nearHotel(s) ? null : { s, lateral: -(world.VERGE + 0.8 + R() * 18) }; }
    }));

    const U = world.U;
    return {
      group,
      update() {
        const d = U.uDusk.value;
        H.glassMat.emissiveIntensity = 0.45 + 2.0 * d;
        H.signMat.emissiveIntensity = 0.7 + 1.6 * d;
        bt.update(U.uTime.value);
      }
    };
  }
};
