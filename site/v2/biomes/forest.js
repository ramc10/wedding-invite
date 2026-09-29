/* Zone 'forest' (s 0–292): a flowering dry-deciduous roadside forest outside
 * Bengaluru, the kind lining the old Nandi Hills / Chikkaballapur roads.
 *
 * Title shot: the car is parked at s≈0, lateral −1.8, and the camera orbits
 * it from the front-left looking across to the right verge. Nothing tall
 * stands within ~12 m of the car, and the right side behind it is a clean,
 * layered wall of canopy set back 40 m or more.
 *
 * Every object in the scene (draw calls in brackets, ~15 total):
 *   CANOPY     [1] broadleaf  rain tree / tamarind / honge, 9–18 m, in clumps
 *              [1] blossom    pink tabebuia, the flowering edge trees
 *              [1] marigold   gulmohar / golden shower, orange-yellow edge trees
 *              [1] pine       eucalyptus / silver-oak stand far behind (skyline)
 *   UNDERSTORY [1] bush       lantana and young saplings, forest edge, 1–3 m
 *   GROUND     [1] fern       ferns and weeds along ditches and log sides
 *              [1] flowers    wild flower clumps on the verge
 *              [1] litter     leaf-litter patches draped on the ground (canvas alpha)
 *   DEBRIS     [1] logs       fallen trunks + broken limbs, bark texture + moss
 *              [1] rocks      Deccan granite boulders & sheet rock, mossy/lichen tops
 *              [1] mounds     red laterite termite mounds with spires
 *   ROADSIDE   [1] props      km stone (NH yellow cap), 200 m stones, a warning
 *                             sign + a green direction board on striped posts,
 *                             a small whitewashed wayside shrine with a
 *                             kumkum-smeared stone, lamp niche and flag pole;
 *                             one merged mesh on one canvas atlas
 * All flora comes from biomes/flora.js plant(); everything else is built here,
 * snapped to world.heightSL and sunk a little so nothing floats.
 */
import * as THREE from 'three';
import { plant, floraMaterial, kindGeometry } from './flora.js';
import { path } from '../core/path.js';
import { world } from '../core/world.js';
import { mergeGeometries } from '../vendor/addons/utils/BufferGeometryUtils.js';

const TIER = { low: 0.45, med: 0.7, high: 1 };
const CAR = { s: 0, lateral: -1.8 };

/* ---------- small utils ---------- */

function rng(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5; let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// CPU-backed (willReadFrequently) canvases: the height maps are read back for normals, and software
// raster of these small canvases costs less main-thread time than recording and flushing to the GPU
function canvas(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d', { willReadFrequently: true }), w, h);
  return c;
}

function tex(c, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// greyscale height canvas → tangent-space normal map
function normalFrom(c, strength = 2) {
  const w = c.width, h = c.height;
  const src = c.getContext('2d').getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h * 4);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
    const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    out[i] = (-dx / l * 0.5 + 0.5) * 255; out[i + 1] = (dy / l * 0.5 + 0.5) * 255;
    out[i + 2] = (1 / l * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  const t = new THREE.DataTexture(out, w, h);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// value-noise blotches painted onto a context (cheap, tileable enough)
// (vw, vh) = the visible area when it is larger than the w × h tile
function blotch(g, w, h, R, n, rMin, rMax, col, alpha, vw = w, vh = h) {
  for (let i = 0; i < n; i++) {
    const x = R() * w, y = R() * h, r = rMin + R() * (rMax - rMin);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col.replace('A', (alpha * (0.5 + R() * 0.5)).toFixed(3)));
    gr.addColorStop(1, col.replace('A', '0'));
    g.fillStyle = gr;
    // wrapped copies only where the blotch actually crosses an edge (usually just the one)
    for (const ox of [-w, 0, w]) if (x + ox + r > 0 && x + ox - r < vw) for (const oy of [-h, 0, h]) if (y + oy + r > 0 && y + oy - r < vh) {
      if (ox || oy) { g.save(); g.translate(ox, oy); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); }
      else g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
}

/* ---------- textures ---------- */

// bark: vertical fissured grey-brown, u around the log, v along it
function barkTextures() {
  const R = rng('bark');
  const hc = canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = R() * w, wd = 1 + R() * 4;
      g.strokeStyle = `rgba(20,20,20,${0.3 + R() * 0.5})`; g.lineWidth = wd;
      g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y <= h; y += 16) g.lineTo(x + Math.sin(y * 0.05 + i) * 5 + (R() - 0.5) * 4, y);
      g.stroke();
    }
    blotch(g, w, h, R, 60, 4, 18, 'rgba(200,200,200,A)', 0.25);
  });
  const cc = canvas(256, 256, (g, w, h) => {
    g.drawImage(hc, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = '#8a7560'; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    blotch(g, w, h, R, 40, 6, 30, 'rgba(120,125,110,A)', 0.35);   // lichen grey
    blotch(g, w, h, R, 25, 5, 20, 'rgba(60,40,28,A)', 0.4);       // rot
  });
  return { map: tex(cc), normalMap: normalFrom(hc, 3) };
}

// granite: speckled pink-grey with black mica, plus a grain height for normals
function graniteTextures() {
  const R = rng('granite');
  const hc = canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, w, h);
    blotch(g, w, h, R, 70, 8, 40, 'rgba(255,255,255,A)', 0.18);
    blotch(g, w, h, R, 70, 8, 40, 'rgba(0,0,0,A)', 0.18);
    let last = '';
    for (let i = 0; i < 5000; i++) {
      const st = R() < 0.5 ? 'rgba(30,30,30,0.5)' : 'rgba(220,220,220,0.5)';
      if (st !== last) g.fillStyle = last = st;         // re-parse the colour only when it changes
      g.fillRect(R() * w, R() * h, 1 + R() * 2, 1 + R() * 2);
    }
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    for (let i = 0; i < 6; i++) {        // hairline joints
      g.lineWidth = 1 + R(); g.beginPath(); let x = R() * w, y = R() * h; g.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (R() - 0.3) * 30; y += (R() - 0.5) * 30; g.lineTo(x, y); }
      g.stroke();
    }
  });
  const cc = canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#a89c90'; g.fillRect(0, 0, w, h);
    blotch(g, w, h, R, 50, 10, 45, 'rgba(150,120,110,A)', 0.35);
    blotch(g, w, h, R, 40, 10, 40, 'rgba(90,88,84,A)', 0.3);
    let last = '';
    for (let i = 0; i < 7000; i++) {
      const t = R(), st = t < 0.4 ? 'rgba(30,28,28,0.7)' : t < 0.7 ? 'rgba(235,225,215,0.6)' : 'rgba(190,140,120,0.5)';
      if (st !== last) g.fillStyle = last = st;
      g.fillRect(R() * w, R() * h, 1 + R() * 1.5, 1 + R() * 1.5);
    }
    blotch(g, w, h, R, 30, 3, 10, 'rgba(210,200,150,A)', 0.5);    // lichen rosettes
    blotch(g, w, h, R, 20, 4, 14, 'rgba(40,36,30,A)', 0.35);      // weather stain
  });
  return { map: tex(cc), normalMap: normalFrom(hc, 2.2) };
}

// laterite (termite mound) : red-ochre crumbly earth
function lateriteTextures() {
  const R = rng('laterite');
  const hc = canvas(128, 128, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) {
      const v = 60 + R() * 140; g.fillStyle = `rgb(${v},${v},${v})`;
      g.beginPath(); g.arc(R() * w, R() * h, 0.6 + R() * 2.2, 0, 7); g.fill();
    }
  });
  const cc = canvas(128, 128, (g, w, h) => {
    g.fillStyle = '#9a5234'; g.fillRect(0, 0, w, h);
    blotch(g, w, h, R, 40, 5, 25, 'rgba(180,110,70,A)', 0.4);
    blotch(g, w, h, R, 30, 5, 20, 'rgba(90,45,30,A)', 0.4);
    for (let i = 0; i < 2000; i++) {
      g.fillStyle = R() < 0.5 ? 'rgba(70,35,22,0.5)' : 'rgba(200,140,95,0.45)';
      g.fillRect(R() * w, R() * h, 1, 1);
    }
  });
  return { map: tex(cc), normalMap: normalFrom(hc, 2.5) };
}

// leaf litter: dry teak/rain-tree leaves on dust, alpha-feathered patch
function litterTexture() {
  const R = rng('litter');
  const c = canvas(256, 256, (g, w, h) => {
    const leafCols = ['#8a5a2a', '#a8742e', '#6b4420', '#c09048', '#5a3a1e', '#b0623a', '#7a6a38'];
    for (let i = 0; i < 520; i++) {
      const x = R() * w, y = R() * h, d = Math.hypot(x - w / 2, y - h / 2) / (w / 2);
      if (d > 0.95 || R() < d * d * 1.1) continue;
      g.save(); g.translate(x, y); g.rotate(R() * 7);
      const L = 5 + R() * 9;
      g.fillStyle = leafCols[Math.floor(R() * leafCols.length)];
      g.beginPath(); g.ellipse(0, 0, L, L * (0.35 + R() * 0.2), 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(40,25,10,0.6)'; g.lineWidth = 0.7;
      g.beginPath(); g.moveTo(-L, 0); g.lineTo(L, 0); g.stroke();
      g.restore();
    }
    for (let i = 0; i < 40; i++) {       // twigs
      const x = R() * w, y = R() * h; if (Math.hypot(x - w / 2, y - h / 2) > w * 0.4) continue;
      g.strokeStyle = 'rgba(60,40,25,0.85)'; g.lineWidth = 1 + R();
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 40, y + (R() - 0.5) * 40); g.stroke();
    }
  });
  const t = tex(c, false);
  return t;
}

/* ---------- roadside props atlas: 4×4 cells of 256 px ---------- */
const CELL = {
  km: [0, 0], wash: [1, 0], kmside: [2, 0], warn: [3, 0],
  board: [0, 1, 2, 1], stripe: [2, 1], metal: [3, 1],
  kumkum: [0, 2], basalt: [1, 2], flag: [2, 2], plinth: [3, 2],
  shrine: [0, 3], brass: [1, 3], naga: [2, 3], hecto: [3, 3]
};

function atlasTexture() {
  const R = rng('atlas');
  const c = canvas(1024, 1024, (g) => {
    const cell = (k, fn) => { const [cx, cy, cw = 1, ch = 1] = CELL[k]; g.save(); g.translate(cx * 256, cy * 256);
      g.beginPath(); g.rect(0, 0, cw * 256, ch * 256); g.clip(); fn(cw * 256, ch * 256); g.restore(); };
    const grime = (w, h, n = 30, a = 0.18) => {
      blotch(g, w, h, R, n, 6, 40, 'rgba(90,80,60,A)', a);
      for (let i = 0; i < 12; i++) {                    // rain streaks
        const x = R() * w; g.strokeStyle = `rgba(80,70,55,${0.05 + R() * 0.1})`; g.lineWidth = 2 + R() * 6;
        g.beginPath(); g.moveTo(x, h * R() * 0.4); g.lineTo(x + (R() - 0.5) * 6, h); g.stroke();
      }
      g.fillStyle = 'rgba(120,70,40,0.35)'; g.fillRect(0, h * 0.9, w, h * 0.1);   // red-soil splash
    };
    const wash = (w, h) => { g.fillStyle = '#ece8dc'; g.fillRect(0, 0, w, h); grime(w, h); };
    // km stone: yellow NH cap over white, black lettering
    cell('km', (w, h) => {
      wash(w, h);
      g.fillStyle = '#f0b81c'; g.fillRect(0, 0, w, h * 0.42);
      blotch(g, w, h * 0.42, R, 15, 5, 25, 'rgba(150,100,20,A)', 0.25, w, h);
      g.fillStyle = '#161616'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 44px Arial, sans-serif'; g.fillText('NH 44', w / 2, h * 0.27);
      g.font = 'bold 30px Arial, sans-serif'; g.fillText('ಬೆಂಗಳೂರು', w / 2, h * 0.52);
      g.font = 'bold 26px Arial, sans-serif'; g.fillText('BENGALURU', w / 2, h * 0.64);
      g.font = 'bold 62px Arial, sans-serif'; g.fillText('38', w / 2, h * 0.8);
      grime(w, h, 10, 0.12);
    });
    cell('wash', wash);
    cell('kmside', (w, h) => { wash(w, h); g.fillStyle = '#f0b81c'; g.fillRect(0, 0, w, h * 0.42); grime(w, h, 8, 0.12); });
    cell('hecto', (w, h) => { wash(w, h); g.fillStyle = '#e8a020'; g.fillRect(0, 0, w, h * 0.3);
      g.fillStyle = '#181818'; g.font = 'bold 80px Arial'; g.textAlign = 'center'; g.fillText('4', w / 2, h * 0.72); });
    // speed-breaker-ahead warning triangle (red rim, white field, black hump)
    cell('warn', (w, h) => {
      g.fillStyle = '#8a8f94'; g.fillRect(0, 0, w, h);
      const tri = (m) => { g.beginPath(); g.moveTo(w / 2, m * 0.9); g.lineTo(w - m, h - m * 0.55); g.lineTo(m, h - m * 0.55); g.closePath(); };
      g.fillStyle = '#c4161c'; tri(4); g.fill();
      g.fillStyle = '#f4f2ee'; tri(34); g.fill();
      g.fillStyle = '#111'; g.fillRect(w * 0.3, h * 0.74, w * 0.4, 8);
      g.beginPath(); g.ellipse(w / 2, h * 0.74, w * 0.1, h * 0.09, 0, Math.PI, 0); g.fill();
      grime(w, h, 8, 0.1);
    });
    // green direction board, bilingual
    cell('board', (w, h) => {
      g.fillStyle = '#0f6b3a'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#f2f2f2'; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
      g.fillStyle = '#f7f7f7'; g.textBaseline = 'middle';
      const row = (y, kn, en, km, arrow) => {
        g.textAlign = 'left'; g.font = 'bold 26px sans-serif'; g.fillText(kn, 70, y - 22);
        g.font = 'bold 34px Arial, sans-serif'; g.fillText(en, 70, y + 12);
        g.textAlign = 'right'; g.font = 'bold 40px Arial'; g.fillText(km, w - 30, y);
        g.font = 'bold 44px Arial'; g.textAlign = 'center'; g.fillText(arrow, 40, y);
      };
      row(75, 'ನಂದಿ ಬೆಟ್ಟ', 'Nandi Hills', '18', '↑');
      row(180, 'ದೇವನಹಳ್ಳಿ', 'Devanahalli', '12', '←');
      blotch(g, w, h, R, 20, 10, 40, 'rgba(40,40,20,A)', 0.15);
    });
    cell('stripe', (w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#141414' : '#eeeeea'; g.fillRect(0, i * h / 8, w, h / 8); } grime(w, h, 10, 0.15); });
    cell('metal', (w, h) => { g.fillStyle = '#8d9398'; g.fillRect(0, 0, w, h); blotch(g, w, h, R, 20, 10, 40, 'rgba(120,80,50,A)', 0.2); });
    cell('kumkum', (w, h) => { g.fillStyle = '#b3201a'; g.fillRect(0, 0, w, h); blotch(g, w, h, R, 20, 10, 40, 'rgba(230,140,20,A)', 0.4); });
    cell('basalt', (w, h) => { g.fillStyle = '#2a2826'; g.fillRect(0, 0, w, h); blotch(g, w, h, R, 25, 5, 20, 'rgba(90,85,80,A)', 0.3);
      g.fillStyle = '#c21e18'; g.fillRect(w * 0.42, h * 0.2, w * 0.16, h * 0.5);
      g.fillStyle = '#e8b818'; g.fillRect(w * 0.3, h * 0.28, w * 0.1, h * 0.35); g.fillRect(w * 0.6, h * 0.28, w * 0.1, h * 0.35); });
    cell('flag', (w, h) => { g.fillStyle = '#f07a12'; g.fillRect(0, 0, w, h); blotch(g, w, h, R, 15, 10, 40, 'rgba(180,60,10,A)', 0.3); });
    cell('plinth', (w, h) => { g.fillStyle = '#9c9488'; g.fillRect(0, 0, w, h); blotch(g, w, h, R, 40, 5, 30, 'rgba(60,55,45,A)', 0.3);
      for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(40,35,30,0.5)'; g.fillRect(0, i * h / 4, w, 3); } grime(w, h); });
    // shrine wall: whitewash with the ochre-and-white temple stripes
    cell('shrine', (w, h) => {
      wash(w, h);
      for (let i = 0; i < 8; i++) if (i % 2) { g.fillStyle = '#b8401e'; g.fillRect(i * w / 8, h * 0.12, w / 8, h * 0.78); }
      grime(w, h, 25, 0.2);
    });
    cell('brass', (w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#6a4a14'); gr.addColorStop(0.5, '#e8c060'); gr.addColorStop(1, '#6a4a14'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    // nagakallu: coiled twin serpents in relief, turmeric + kumkum smeared
    cell('naga', (w, h) => {
      g.fillStyle = '#56524c'; g.fillRect(0, 0, w, h); blotch(g, w, h, R, 30, 5, 25, 'rgba(30,28,26,A)', 0.4);
      g.strokeStyle = '#3a3733'; g.lineWidth = 14;
      for (const ph of [0, Math.PI]) { g.beginPath();
        for (let y = h * 0.9; y > h * 0.15; y -= 4) g.lineTo(w / 2 + Math.sin(y * 0.05 + ph) * w * 0.18, y); g.stroke(); }
      g.fillStyle = '#3a3733'; g.beginPath(); g.ellipse(w / 2, h * 0.14, w * 0.2, h * 0.08, 0, 0, 7); g.fill();
      blotch(g, w, h, R, 6, 8, 20, 'rgba(230,180,20,A)', 0.8); blotch(g, w, h, R, 6, 6, 16, 'rgba(200,20,20,A)', 0.8);
    });
  });
  return tex(c, false);
}

/* ---------- geometry helpers ---------- */

// box-project a geometry's UVs into atlas cells: faces = {front, back, side, top} → key | [key, v0, v1]
function paint(geo, faces) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  geo.computeBoundingBox();
  const b = geo.boundingBox, P = geo.attributes.position, N = geo.attributes.normal;
  const uv = new Float32Array(P.count * 2);
  const ext = (a, lo, hi) => Math.min(1, Math.max(0, (a - lo) / Math.max(1e-4, hi - lo)));
  const yLo = Math.max(b.min.y, faces.ground ?? b.min.y);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const nx = Math.abs(N.getX(i)), ny = N.getY(i), nz = N.getZ(i);
    let spec, u, v;
    if (Math.abs(ny) > Math.max(nx, Math.abs(nz)) + 0.1) { spec = faces.top || faces.side; u = ext(x, b.min.x, b.max.x); v = ext(z, b.min.z, b.max.z); }
    else if (Math.abs(nz) >= nx) { spec = nz > 0 ? faces.front : (faces.back || faces.side); u = ext(x, b.min.x, b.max.x); if (nz < 0) u = 1 - u; v = ext(y, yLo, b.max.y); }
    else { spec = faces.side; u = ext(z, b.min.z, b.max.z); v = ext(y, yLo, b.max.y); }
    const [key, v0 = 0, v1 = 1] = Array.isArray(spec) ? spec : [spec];
    const [cx, cy, cw = 1, ch = 1] = CELL[key];
    const IN = 0.02;
    u = IN + u * (1 - 2 * IN); v = v0 + (v1 - v0) * (IN + v * (1 - 2 * IN));
    uv[i * 2] = (cx + u * cw) / 4;
    uv[i * 2 + 1] = 1 - (cy + ch) / 4 + v * ch / 4;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

const _S = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(), heading: 0, curvature: 0 };
// road frame at (s, lateral): X = right, Y = up, Z = −fwd (faces oncoming traffic), then yaw about Y
function roadMatrix(s, lateral, yaw = 0, lift = 0) {
  path.sample(s, _S);
  const p = path.toWorld(s, lateral);
  p.y = world.heightSL(s, lateral) + lift;
  const m = new THREE.Matrix4().makeBasis(_S.right, new THREE.Vector3(0, 1, 0), _S.fwd.clone().negate());
  m.multiply(new THREE.Matrix4().makeRotationY(yaw));
  m.setPosition(p);
  return m;
}

const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const cyl = (r0, r1, h, x = 0, y = 0, z = 0, seg = 10) => new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y + h / 2, z);

/* ---------- roadside props ---------- */

function kmStone() {
  const w = 0.56, sh = new THREE.Shape();
  sh.moveTo(-w / 2, -0.35); sh.lineTo(w / 2, -0.35); sh.lineTo(w / 2, 0.62);
  sh.absarc(0, 0.62, w / 2, 0, Math.PI, false); sh.lineTo(-w / 2, -0.35);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 18 });
  g.translate(0, 0, -0.09);
  const stone = paint(g, { front: 'km', back: 'kmside', side: 'kmside', top: ['kmside', 0.7, 1], ground: 0 });
  const footing = paint(box(0.8, 0.3, 0.4, 0, -0.26, 0), { front: 'plinth', side: 'plinth', top: 'plinth' });
  return [stone, footing];
}

function hectoStone() {
  const g = new THREE.BoxGeometry(0.26, 0.7, 0.13, 1, 1, 1).translate(0, 0.1, 0);
  return [paint(g, { front: 'hecto', back: 'hecto', side: 'wash', top: ['hecto', 0.8, 1], ground: 0 })];
}

function warnSign() {
  const s = 0.9, sh = new THREE.Shape();
  sh.moveTo(-s / 2, 0); sh.lineTo(s / 2, 0); sh.lineTo(0, s * 0.866); sh.lineTo(-s / 2, 0);
  const plate = new THREE.ExtrudeGeometry(sh, { depth: 0.015, bevelEnabled: false }).translate(0, 1.75, 0.05);
  return [
    paint(plate, { front: 'warn', back: 'metal', side: 'metal' }),
    paint(cyl(0.035, 0.035, 3.0, 0, -0.45, 0), { front: 'stripe', side: 'stripe', top: 'metal', ground: -0.45 })
  ];
}

function directionBoard() {
  return [
    paint(box(2.4, 1.2, 0.04, 0, 2.1, 0.06), { front: 'board', back: 'metal', side: 'metal', top: 'metal' }),
    paint(cyl(0.05, 0.05, 3.7, -0.9, -0.45, 0), { front: 'stripe', side: 'stripe', top: 'metal' }),
    paint(cyl(0.05, 0.05, 3.7, 0.9, -0.45, 0), { front: 'stripe', side: 'stripe', top: 'metal' }),
    paint(box(2.0, 0.06, 0.05, 0, 2.4, -0.01), { front: 'metal', side: 'metal' }),
    paint(box(2.0, 0.06, 0.05, 0, 2.95, -0.01), { front: 'metal', side: 'metal' })
  ];
}

// wayside shrine: opening faces local +z
function shrine() {
  const P = { front: 'plinth', side: 'plinth', top: 'plinth' };
  const W = { front: 'shrine', side: 'shrine', top: 'wash' };
  const out = [
    paint(box(1.9, 0.75, 1.7, 0, -0.35, 0), P),                    // plinth (buried 0.35)
    paint(box(1.0, 0.45, 0.4, 0, -0.3, 1.02), P),                   // front step
    paint(box(1.1, 1.05, 0.12, 0, 0.4, -0.45), W),                  // back wall
    paint(box(0.12, 1.05, 0.9, -0.49, 0.4, -0.05), W),               // side walls
    paint(box(0.12, 1.05, 0.9, 0.49, 0.4, -0.05), W),
    paint(box(1.1, 0.16, 0.12, 0, 1.29, 0.34), { front: ['kumkum', 0, 1], side: 'wash', top: 'wash' }), // lintel
    paint(box(1.3, 0.1, 1.1, 0, 1.45, -0.05), { front: 'wash', side: 'wash', top: 'wash' }),           // roof slab
    paint(new THREE.SphereGeometry(0.42, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.55, -0.05), { front: 'wash', side: 'wash', top: 'wash' }),
    paint(cyl(0.05, 0.02, 0.25, 0, 1.95, -0.05, 8), { front: 'brass', side: 'brass', top: 'brass' }),
    paint(new THREE.SphereGeometry(0.05, 8, 6).translate(0, 2.23, -0.05), { front: 'brass', side: 'brass', top: 'brass' }),
    paint(new THREE.CapsuleGeometry(0.11, 0.2, 4, 10).translate(0, 0.62, -0.25), { front: 'basalt', side: 'basalt', top: 'kumkum' }),
    paint(box(0.3, 0.06, 0.25, 0, 0.4, -0.25), { front: 'kumkum', side: 'kumkum', top: 'kumkum' }), // cloth-draped pedestal
    paint(cyl(0.05, 0.03, 0.06, 0.22, 0.4, 0.1, 8), { front: 'brass', side: 'brass', top: 'brass' }),   // lamp
    paint(cyl(0.025, 0.02, 3.4, 0.8, 0.0, -0.7, 6), { front: 'metal', side: 'metal', top: 'metal' }),  // flag pole
  ];
  const fl = new THREE.Shape(); fl.moveTo(0, 0); fl.lineTo(0.62, 0.2); fl.lineTo(0, 0.42); fl.lineTo(0, 0);
  out.push(paint(new THREE.ExtrudeGeometry(fl, { depth: 0.01, bevelEnabled: false }).translate(0.82, 2.9, -0.7), { front: 'flag', back: 'flag', side: 'flag' }));
  // nagakallu slabs leaning on the plinth's side
  for (let i = 0; i < 3; i++) {
    const g = box(0.36, 0.72, 0.09).rotateX(-0.12).translate(1.2 + i * 0.02, -0.2, 0.55 - i * 0.45);
    g.rotateY(0); out.push(paint(g, { front: 'naga', back: 'basalt', side: 'basalt', top: 'basalt' }));
  }
  return out;
}

function buildProps(list) {
  const geos = [];
  for (const { make, s, lateral, yaw = 0, lift = 0 } of list) {
    const m = roadMatrix(s, lateral, yaw, lift);
    for (const g of make()) geos.push(g.applyMatrix4(m));
  }
  for (const g of geos) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  const geo = mergeGeometries(geos, false);
  const mat = new THREE.MeshStandardMaterial({ map: atlasTexture(), roughness: 0.82, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'forest:props'; mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/* ---------- natural debris ---------- */

// cheap deterministic 3D value noise for displacement
function noise3(seed) {
  const R = rng(seed), T = new Float32Array(512); for (let i = 0; i < 512; i++) T[i] = R();
  const h = (x, y, z) => T[((x * 73 + y * 151 + z * 283) & 511 + 512) & 511];
  const f = t => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = f(x - xi), v = f(y - yi), w = f(z - zi);
    const L = (a, b, t) => a + (b - a) * t;
    return L(L(L(h(xi, yi, zi), h(xi + 1, yi, zi), u), L(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
             L(L(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), L(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w) * 2 - 1;
  };
}

// moss/lichen + contact darkening as vertex colours (world-up = local +y)
function mossColours(geo, seed, amount = 0.6) {
  const n = noise3(seed), P = geo.attributes.position, N = geo.attributes.normal;
  const col = new Float32Array(P.count * 3);
  geo.computeBoundingBox(); const b = geo.boundingBox;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const up = N.getY(i), m = Math.max(0, Math.min(1, (up - 0.35) * 2 + n(x * 2.5, y * 2.5, z * 2.5) * 1.2)) * amount;
    const ao = 0.55 + 0.45 * Math.min(1, (y - b.min.y) / ((b.max.y - b.min.y) * 0.45));
    // moss: olive-green, drier yellow in patches
    const dry = 0.5 + 0.5 * n(x * 5 + 9, y * 5, z * 5);
    const mr = 0.42 + 0.25 * dry, mg = 0.52 + 0.12 * dry, mb = 0.22;
    col[i * 3] = (1 + (mr - 1) * m) * ao; col[i * 3 + 1] = (1 + (mg - 1) * m) * ao; col[i * 3 + 2] = (1 + (mb - 1) * m) * ao;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 4);
  const n = noise3('rock'), P = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    const d = 1 + 0.28 * n(v.x * 1.2, v.y * 1.2, v.z * 1.2) + 0.1 * n(v.x * 3.1, v.y * 3.1, v.z * 3.1) + 0.03 * n(v.x * 9, v.y * 9, v.z * 9);
    v.multiplyScalar(d);
    v.y = v.y > 0 ? v.y * 0.72 : v.y * 0.5;           // weathered tor: rounded top, flat bed
    v.x *= 1.15;
    P.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv;
  for (let i = 0; i < P.count; i++) uv.setXY(i, (P.getX(i) + P.getZ(i) * 0.6) * 0.45, P.getY(i) * 0.6 + P.getZ(i) * 0.25);
  return mossColours(g, 'rock-moss', 0.75);
}

function logGeometry() {
  // lying along x, length 1 (x −0.5..0.5), radius 1, knobbly, with end-cuts
  const g = new THREE.CylinderGeometry(1, 1, 1, 14, 10, false).rotateZ(Math.PI / 2);
  const n = noise3('log'), P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), r = Math.hypot(y, z);
    if (r < 1e-3) continue;
    const k = (1 + 0.12 * n(x * 6, y * 2, z * 2) + 0.06 * n(x * 20, y * 4, z * 4)) * (1 - 0.18 * (x + 0.5));  // taper
    P.setY(i, y * k); P.setZ(i, z * k * 0.92);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 3);
  return mossColours(g, 'log-moss', 0.65);
}

function moundGeometry() {
  // laterite termite mound: fluted, lumpy main chimney + 4 leaning secondary spires and a slumped skirt
  const prof = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24; prof.push(new THREE.Vector2(Math.max(0.03, 0.95 * Math.pow(1 - t, 1.6) + 0.06 * (1 - t) + 0.035), t * 2.2 - 0.25)); }
  const main = new THREE.LatheGeometry(prof, 30);
  const spire = (x, z, h, r, lean) => new THREE.LatheGeometry(prof.map(p => new THREE.Vector2(p.x * r, p.y * h)), 14)
    .rotateZ(lean * Math.sign(x || 1)).translate(x, -0.05, z);
  const skirt = new THREE.SphereGeometry(1, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.25, 0.28, 1.1).translate(0, -0.12, 0);
  const g = mergeGeometries([main, skirt, spire(0.5, 0.18, 0.62, 0.42, 0.12), spire(-0.34, -0.4, 0.48, 0.36, 0.18),
    spire(-0.2, 0.52, 0.36, 0.3, 0.25), spire(0.3, -0.5, 0.28, 0.28, 0.3)].map(x => x.toNonIndexed()));
  const n = noise3('mound'), P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), ang = Math.atan2(z, x);
    const flute = 0.09 * Math.pow(Math.abs(Math.sin(ang * 3.5 + y * 1.3 + 0.8 * n(x, y * 2, z))), 0.6);
    const k = 1 - flute + 0.32 * n(x * 2.5, y * 2.5, z * 2.5) + 0.12 * n(x * 8, y * 8, z * 8) + 0.04 * n(x * 22, y * 22, z * 22);
    P.setXYZ(i, x * k, y + 0.08 * n(x * 4, 3, z * 4) - (y < 0.1 ? 0.04 : 0), z * k);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv; for (let i = 0; i < P.count; i++) uv.setXY(i, Math.atan2(P.getZ(i), P.getX(i)) * 0.6, P.getY(i) * 1.2);
  return mossColours(g, 'mound-c', 0.12);
}

/* ---------- placement ---------- */

const gauss = R => (R() + R() + R() - 1.5) * 1.15;
const nearCar = (s, lat, r) => Math.hypot(s - CAR.s, lat - CAR.lateral) < r;

// clumped scatter: pick a clump, gaussian around it; clumps given as {s, lat, rs, rl}
function clumped(clumps, { minLat = 7, keepCar = 12, rightGap = null, log = null } = {}) {
  return R => {
    const c = clumps[Math.floor(R() * clumps.length)];
    const s = c.s + gauss(R) * c.rs;
    let lat = c.lat + gauss(R) * c.rl;
    if (Math.sign(lat) !== Math.sign(c.lat) || Math.abs(lat) < minLat) return null;
    if (nearCar(s, lat, keepCar)) return null;
    if (rightGap && lat > 0 && s < rightGap.s && lat < rightGap.lat) return null;
    // the title camera swings out over the left verge at s≈0–50: nothing tall there
    if (rightGap && lat < 0 && s < 55 && lat > -20) return null;
    if (log) log.push({ s, lat });
    return { s, lateral: lat };
  };
}

function makeClumps(R, s0, s1, n, near, far, sRad = [5, 12], lRad = [3, 8]) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    const d = near + Math.pow(R(), 1.3) * (far - near);
    out.push({ s: s0 + R() * (s1 - s0), lat: side * d, rs: sRad[0] + R() * (sRad[1] - sRad[0]), rl: lRad[0] + R() * (lRad[1] - lRad[0]) });
  }
  return out;
}

// low-frequency 1D value noise along s (per side), 0..1: drives grove clumping and the ragged forest edge
function sNoise(seed) {
  const R = rng(seed), T = []; for (let i = 0; i < 256; i++) T.push(R());
  return x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return T[i & 255] * (1 - u) + T[(i + 1) & 255] * u; };
}

// Continuous roadside forest: jittered-stratified rows from the ragged edge (6–10 m) back to `far`,
// thinned by a clump noise so groves and glades alternate, but never leaving the edge bare.
// Returns a placer (R, i) => points[i]; each point carries its own scale.
function grove(seed, { s0, s1, near = [6, 10], far, step, keep = 0.8, scale = [1, 1.5], depthGrow = 0.35, glade = 0.45, avoid = null }) {
  const R = rng(seed), pts = [];
  for (const side of [-1, 1]) {
    const edgeN = sNoise(seed + side), clumpN = sNoise(seed + 'c' + side), clumpN2 = sNoise(seed + 'd' + side);
    for (let s = s0; s < s1; s += step * (0.8 + R() * 0.4)) {
      const e = near[0] + (near[1] - near[0]) * edgeN(s / 22);
      for (let d = e, row = 0; d < far; row++) {
        const st = step * (1 + depthGrow * (d - e) / 20);
        const ps = s + (R() - 0.5) * st * 0.9, lat = side * (d + (R() - 0.5) * st * 0.6);
        const c = 0.6 * clumpN(ps / 18 + d / 30) + 0.4 * clumpN2(ps / 7 - d / 11);
        const p = row === 0 ? keep + (1 - keep) * c : keep * (1 - glade + glade * 2 * c);
        if (R() < p && !(avoid && avoid(ps, lat))) {
          const sc = scale[0] + (scale[1] - scale[0]) * Math.min(1, Math.max(0, 0.5 * R() + 0.7 * c - 0.1));
          pts.push({ s: ps, lateral: lat, scale: sc });
        }
        d += st;
      }
    }
  }
  for (let i = pts.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [pts[i], pts[j]] = [pts[j], pts[i]]; }
  const place = (_, i) => pts[i] || null;
  place.count = pts.length; place.pts = pts;
  return place;
}

// instanced mesh of a custom geometry, each {s, lat, scale:[x,y,z], yaw, pitch?, roll?, sink}
function instanced(geo, mat, items, name) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  mesh.count = items.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  items.forEach((it, i) => {
    if (it.pos) p.copy(it.pos); else { path.toWorld(it.s, it.lat, p); p.y = it.y; }
    if (it.quat) q.copy(it.quat); else q.setFromEuler(e.set(it.pitch || 0, it.yaw || 0, it.roll || 0, 'YXZ'));
    sc.set(...it.scale);
    mesh.setMatrixAt(i, m.compose(p, q, sc));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = name;
  return mesh;
}

// lowest ground under a footprint of radius r (so nothing hangs over a dip)
function groundMin(s, lat, r) {
  let y = world.heightSL(s, lat);
  for (let a = 0; a < 6; a++) y = Math.min(y, world.heightSL(s + Math.cos(a) * r, lat + Math.sin(a * 1.1) * r));
  return y;
}

// leaf-litter patches draped on the terrain in road space (one merged mesh)
function litterMesh(spots, R) {
  const pos = [], uv = [], idx = [], G = 7, p = new THREE.Vector3();
  for (const sp of spots) {
    const r = sp.r, rot = R() * 6.28, base = pos.length / 3;
    for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) {
      const u = i / G, v = j / G, x = (u - 0.5) * 2 * r, z = (v - 0.5) * 2 * r;
      const ds = x * Math.cos(rot) - z * Math.sin(rot), dl = x * Math.sin(rot) + z * Math.cos(rot);
      let lat = sp.lat + dl; if (Math.abs(lat) < world.VERGE + 0.4) lat = Math.sign(lat) * (world.VERGE + 0.4);
      path.toWorld(sp.s + ds, lat, p);
      p.y = world.heightSL(sp.s + ds, lat) + 0.035;
      pos.push(p.x, p.y, p.z); uv.push(u, v);
    }
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const a = base + j * (G + 1) + i, b = a + 1, c = a + G + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: litterTexture(), alphaTest: 0.45, roughness: 0.95,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true; mesh.name = 'forest:litter';
  return mesh;
}

/* ---------- title backdrop: the view past s = 0 (ground there is the flat apron) ---------- */
function backdrop(ctx, R, k) {
  const S = path.sample(0), y0 = path.roadY(0) - 0.9;
  const at = (s, lat) => S.pos.clone().addScaledVector(S.fwd, s).addScaledVector(S.right, lat).setY(y0);
  const out = [];
  const add = (kind, n, fn, colors, [a, b], sink) => {
    const geo = kindGeometry(kind), mesh = new THREE.InstancedMesh(geo, floraMaterial({}), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    let i = 0;
    for (let t = 0; t < n * 3 && i < n; t++) {
      const pt = fn(R); if (!pt) continue;
      const sc = a + (b - a) * R(), p = at(pt.s, pt.lat); p.y -= sink * sc;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6.28);
      mesh.setMatrixAt(i, m.compose(p, q, new THREE.Vector3(sc, sc, sc)));
      mesh.setColorAt(i, c.setHex(colors[Math.floor(R() * colors.length)]).multiplyScalar(0.85 + 0.25 * R()));
      i++;
    }
    mesh.count = i; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); mesh.castShadow = true; mesh.name = 'forest:backdrop:' + kind;
    out.push(mesh);
  };
  // a continuous wall of canopy 30–110 m behind the car, thicker to the right
  const wall = (near, far) => r => {
    const s = -(near + Math.pow(r(), 0.8) * (far - near));
    const lat = -70 + r() * 150;
    if (Math.hypot(s, lat - CAR.lateral) < near) return null;
    return { s, lat };
  };
  add('broadleaf', Math.round(60 * k), wall(28, 120), [0x4f7a2e, 0x5d8a34, 0x46702c, 0x6b8f3a, 0x7a9440], [1.2, 1.9], 0.2);
  add('broadleaf', Math.round(55 * k), wall(110, 230), [0x4a6e30, 0x557a33, 0x5d7a38, 0x66803e], [2.2, 3.4], 0.25);   // far tree line to the horizon
  add('blossom', Math.round(6 * k), wall(26, 70), [0xf4a6bf, 0xf08fb0, 0xf7c0d2], [1.0, 1.4], 0.2);
  add('bush', Math.round(70 * k), r => {         // understorey skirt hiding trunks and the ribbon's cut end
    const s = -(3 + Math.pow(r(), 1.2) * 45), lat = -50 + r() * 110;
    if (Math.hypot(s, lat - CAR.lateral) < 14 || Math.abs(lat) < 7) return null;
    return { s, lat };
  }, [0x557a33, 0x62843a, 0x4a6e30, 0x708a3c, 0x7a8a40], [0.9, 1.8], 0.15);
  return out;
}

export default {
  id: 'forest',
  build(ctx) {
    const { zones, quality } = ctx;
    const z = zones.byId.forest;
    const group = new THREE.Group();
    group.name = 'forest';
    const k = TIER[quality.tier] ?? 1;
    const s0 = Math.max(0, z.s0), s1 = z.s1 + z.blend / 2;
    const n = v => Math.max(1, Math.round(v * k));
    const R = rng('forest-layout');

    // TITLE STRETCH (s < 42): the original sparse clumped layout, so the parked-car frame stays open
    const edge = makeClumps(R, s0, s1, 22, 9, 16, [4, 10], [1.5, 3]);
    const body = makeClumps(R, s0, s1, 26, 16, 80, [8, 18], [5, 12]);
    const gap = { s: 45, lat: 32 };
    const trees = [];
    const early = fn => r => { const p = fn(r); return p && p.s < 42 ? p : null; };
    group.add(plant(ctx, { kind: 'broadleaf', count: n(110), place: early(clumped(body.concat(edge), { minLat: 9, rightGap: gap, log: trees })), scale: [1.0, 1.7], seed: 'fo-bl' }));
    group.add(plant(ctx, { kind: 'bush', count: n(120), place: early(clumped(edge.concat(body), { minLat: 7, keepCar: 12 })), scale: [0.7, 1.5], seed: 'fo-bu' }));
    const verge = makeClumps(R, s0, s1, 30, 7, 12, [3, 7], [0.8, 2]);

    // ROADSIDE FOREST (s 42 → zone end): continuous canopy + understorey on both sides,
    // edge ragged 6–10 m from the road centre, groves and glades from a clump noise.
    const F0 = 42, F1 = s1, q = 1 / Math.sqrt(k);
    const tall = (s, lat) => nearCar(s, lat, 14) || (s < 52 && lat < 0 && lat > -18);
    const logT = pl => { for (const p of pl.pts) trees.push({ s: p.s, lat: p.lateral }); return pl; };
    // main canopy: rain tree / honge umbrellas (broadleaf), 9–14 m, crowns touching
    const canopy = logT(grove('fo-can', { s0: F0, s1: F1, near: [7.5, 11], far: 46, step: 8 * q, keep: 0.92, scale: [0.95, 1.65], avoid: tall }));
    group.add(plant(ctx, { kind: 'broadleaf', count: canopy.count, place: canopy, seed: 'fo-can' }));
    // deep forest behind: bigger, coarser, fills the view to the fog
    const deep = grove('fo-deep', { s0: F0 - 20, s1: F1 + 10, near: [44, 48], far: 110, step: 16 * q, keep: 0.8, scale: [1.3, 2.0], depthGrow: 0.2, glade: 0.3 });
    group.add(plant(ctx, { kind: 'broadleaf', count: deep.count, place: deep, seed: 'fo-deep' }));
    // sparse flowering trees mixed into the edge: pink tabebuia, orange gulmohar/amaltas
    const bloom = logT(grove('fo-bloom', { s0: F0, s1: F1, near: [8, 12], far: 26, step: 14 * q, keep: 0.35, scale: [0.8, 1.2], glade: 0.9, avoid: tall }));
    group.add(plant(ctx, { kind: 'blossom', count: Math.ceil(bloom.count * 0.4), place: (r, i) => bloom.pts[i * 2] || null, seed: 'fo-bs',
      colors: [0xe9a0b8, 0xd98aa4, 0xc9a08a, 0x9aa060] }));
    group.add(plant(ctx, { kind: 'marigold', count: Math.ceil(bloom.count * 0.25), place: (r, i) => bloom.pts[i * 4 + 1] || null, seed: 'fo-mg',
      colors: [0xb8602e, 0xa86a36, 0x8a8a40, 0x6f8a3a] }));
    // mid-layer saplings 2–4 m between the trunks
    const sap = grove('fo-sap', { s0: F0, s1: F1, near: [6.8, 9], far: 30, step: 7.5 * q, keep: 0.6, scale: [0.28, 0.5], glade: 0.6, avoid: (s, l) => nearCar(s, l, 12) });
    group.add(plant(ctx, { kind: 'broadleaf', count: sap.count, place: sap, seed: 'fo-sap', colors: [0x5a7f30, 0x6b8a36, 0x4e7430, 0x7d8e3c] }));
    // understorey: lantana / scrub 1–3 m, densest at the edge where light gets in
    const scrub = grove('fo-scrub', { s0: F0 - 6, s1: F1, near: [6.9, 8.2], far: 28, step: 4.4 * q, keep: 0.9, scale: [0.8, 1.9], depthGrow: 0.5, glade: 0.5, avoid: (s, l) => nearCar(s, l, 12) });
    group.add(plant(ctx, { kind: 'bush', count: scrub.count, place: scrub, seed: 'fo-scrub',
      colors: [0x4f7030, 0x5e7d34, 0x46662c, 0x6d8038, 0x7b7c3a, 0x587a3a] }));

    // GROUND LAYER at the verge
    group.add(plant(ctx, { kind: 'fern', count: n(220), place: clumped(verge.concat(edge), { minLat: 6.9, keepCar: 9 }), seed: 'fo-fe' }));
    group.add(plant(ctx, { kind: 'flowers', count: n(140), place: clumped(verge, { minLat: 6.8, keepCar: 8 }), seed: 'fo-fl',
      colors: [0xe87a9a, 0xe8c040, 0xf4ecd8, 0xd8743a, 0xb890d8] }));

    // ROCKS: granite tors in clusters of 3–6 (one big outcrop left at s≈70), sunk ~35%
    const rocks = [];
    const rockClumps = makeClumps(R, s0 + 15, s1, 9, 9, 45, [2, 4], [1.5, 3]);
    rockClumps.push({ s: 72, lat: -24, rs: 3, rl: 3, big: true });
    for (const c of rockClumps) {
      const m = c.big ? 6 : 3 + Math.floor(R() * 4);
      for (let i = 0; i < m; i++) {
        const s = c.s + gauss(R) * c.rs, lat = c.lat + gauss(R) * c.rl;
        if (Math.abs(lat) < 8 || nearCar(s, lat, 14)) continue;
        const sz = (i === 0 ? (c.big ? 2.6 : 1.1) : 0.25 + R() * 0.7) * (0.8 + R() * 0.4);
        const sy = sz * (0.7 + R() * 0.4);
        rocks.push({ s, lat, y: groundMin(s, lat, sz * 0.8) - sy * 0.3, scale: [sz, sy, sz * (0.8 + R() * 0.4)], yaw: R() * 6.28, roll: (R() - 0.5) * 0.2 });
      }
    }
    const G = graniteTextures();
    group.add(instanced(rockGeometry(), new THREE.MeshStandardMaterial({ map: G.map, normalMap: G.normalMap, vertexColors: true, roughness: 0.9 }), rocks, 'forest:rocks'));

    // LOGS: fallen trunks and broken limbs, resting end-to-end on the ground
    const logs = [], dir = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
    const addLog = (s, lat, len, r) => {
      const ang = R() * 6.28, ds = Math.cos(ang) * len / 2, dl = Math.sin(ang) * len / 2;
      if (Math.abs(lat) - Math.abs(dl) < 7.5 || nearCar(s, lat, 12 + len / 2)) return;
      path.toWorld(s - ds, lat - dl, a); a.y = groundMin(s - ds, lat - dl, r) + r * 0.62;
      path.toWorld(s + ds, lat + dl, b); b.y = groundMin(s + ds, lat + dl, r) + r * 0.62;
      dir.subVectors(b, a); const L = dir.length(); dir.normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(X, dir);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(X, R() * 6.28 * 0 + (R() - 0.5) * 0.6));
      logs.push({ pos: a.clone().add(b).multiplyScalar(0.5), quat: q, scale: [L, r, r] });
    };
    for (let i = 0; i < n(12); i++) { const c = body[Math.floor(R() * body.length)]; addLog(c.s + gauss(R) * c.rs, c.lat + gauss(R) * 3, 3 + R() * 5, 0.18 + R() * 0.22); }
    for (let i = 0; i < n(22); i++) { const c = edge[Math.floor(R() * edge.length)]; addLog(c.s + gauss(R) * c.rs, c.lat + gauss(R) * 3, 0.8 + R() * 2, 0.05 + R() * 0.07); }
    const B = barkTextures();
    group.add(instanced(logGeometry(), new THREE.MeshStandardMaterial({ map: B.map, normalMap: B.normalMap, vertexColors: true, roughness: 0.93 }), logs, 'forest:logs'));

    // TERMITE MOUNDS: laterite, in the drier open patches between clumps
    const mounds = [];
    for (let i = 0; i < n(8); i++) {
      const s = s0 + 20 + R() * (s1 - s0 - 30), lat = (R() < 0.5 ? -1 : 1) * (10 + R() * 22);
      if (nearCar(s, lat, 20) || (lat > 0 && s < gap.s && lat < gap.lat)) continue;
      const h = 0.6 + R() * 0.9, w = 0.7 + R() * 0.5;
      mounds.push({ s, lat, y: groundMin(s, lat, w * 0.8) - 0.1, scale: [w, h, w * (0.8 + R() * 0.3)], yaw: R() * 6.28 });
    }
    const L = lateriteTextures();
    group.add(instanced(moundGeometry(), new THREE.MeshStandardMaterial({ map: L.map, normalMap: L.normalMap, vertexColors: true, roughness: 0.97 }), mounds, 'forest:mounds'));

    // LEAF LITTER under the canopy and along the edge (drapes on the ground)
    const spots = [];
    for (let i = 0; i < n(70) && trees.length; i++) {
      const t = trees[Math.floor(R() * trees.length)];
      if (Math.abs(t.lat) > 45 || nearCar(t.s, t.lat, 13)) continue;
      spots.push({ s: t.s + gauss(R) * 2, lat: t.lat + gauss(R) * 2, r: 1.4 + R() * 2.4 });
    }
    group.add(litterMesh(spots, R));

    // ROADSIDE: km stone, hectometre stone, warning sign, direction board, shrine (+ its tree)
    group.add(buildProps([
      { make: kmStone, s: 118, lateral: -6.4, yaw: -0.5 },
      { make: hectoStone, s: 218, lateral: -6.3, yaw: -0.4 },
      { make: warnSign, s: 150, lateral: -6.9, yaw: -0.15 },
      { make: directionBoard, s: 262, lateral: -7.6, yaw: -0.12 },
      { make: shrine, s: 186, lateral: 9.6, yaw: -Math.PI / 2 + 0.45 }
    ]));
    group.add(plant(ctx, { kind: 'broadleaf', count: 1, place: () => ({ s: 181, lateral: 13.5, scale: 2.0 }), seed: 'fo-peepal' }));

    // POWER LINE: concrete poles on the right verge every ~38 m, three sagging conductors
    const poles = [], wire = [], tops = [];
    for (let s = 50; s < s1; s += 34 + R() * 8) {
      const lat = 7.4 + R() * 0.6, y = world.heightSL(s, lat);
      const S = path.sample(s), rt = S.right.clone().setY(0).normalize();
      poles.push({ s, lat, y: y - 0.3, scale: [1, 1, 1], yaw: Math.atan2(rt.x, rt.z) + (R() - 0.5) * 0.08, roll: (R() - 0.5) * 0.04 });
      const p = new THREE.Vector3(); path.toWorld(s, lat, p); tops.push({ p, y: y + 8.1, rt });
    }
    for (let i = 0; i + 1 < tops.length; i++) for (const o of [-0.7, 0, 0.7]) {
      const A = tops[i], B = tops[i + 1];
      for (let j = 0; j < 12; j++) for (const u of [j / 12, (j + 1) / 12]) {
        const sag = 0.9 * 4 * u * (1 - u), p = A.p.clone().lerp(B.p, u);
        wire.push(p.x + A.rt.x * o, A.y + (B.y - A.y) * u - sag + (o ? 0 : 0.35), p.z + A.rt.z * o);
      }
    }
    const poleGeo = mergeGeometries([new THREE.CylinderGeometry(0.09, 0.14, 8.6, 8).translate(0, 4.3, 0).toNonIndexed(),
      new THREE.BoxGeometry(0.09, 0.1, 1.7).translate(0, 8.05, 0).toNonIndexed()]);
    const pMat = new THREE.MeshStandardMaterial({ color: 0x9c978c, roughness: 0.85, map: G.map, normalMap: G.normalMap });
    group.add(instanced(poleGeo, pMat, poles, 'forest:poles'));
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    const wires = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x2a2826, transparent: true, opacity: 0.7 }));
    wires.name = 'forest:wires'; group.add(wires);

    // TITLE BACKDROP past s = 0
    for (const m of backdrop(ctx, rng('forest-backdrop'), k)) group.add(m);

    return { group };
  }
};
