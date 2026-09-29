/* AMR Unnati Convention hall (after the architect's render the couple sent), seen at dusk.
 * Built into the 'dam' zone's visibility window; landscaping is venue-amr-grounds.js.
 *
 * Local frame: a group at the hall's front-centre (s = AMR.hall.s, lateral = AMR.hall.front,
 * y = pad level), rotation.y = heading. Local -z = road-forward, +x = away from the road, so the
 * facade faces -x. Seen from the forecourt, the left wing is at -z, the right louvre block at +z.
 *   1. Left wing: charcoal ACP band (y 5..9) of panels with warm LED slot dashes, parapet above;
 *      ground floor set back 2.6 m: warm-lit glazing, copper fins in bays, teak soffit.
 *   2. Entrance portal (z 3..16): limestone cheeks with random vertical LED slits, a charcoal
 *      header carrying the one name sign (EB Garamond, brass, backlit), teak-lined opening,
 *      backlit jali at the back, ring chandelier, planters with palms, four lit steps.
 *   3. Steel-and-glass waffle pergola over the drop-off, rising outward, on two round columns.
 *   4. Right block (z 16..22): taller wall of dense vertical copper louvres.
 * No lights: every glow is emissive / additive, driven by world.U.uDusk.
 */
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/addons/utils/BufferGeometryUtils.js';
import { AMR } from './dam.js';
import { kindGeometry, floraMaterial } from './flora.js';
import { rng as makeRng } from '../core/noise.js';

const FONT_URL = w => new URL(`../../fonts/eb-garamond-${w}.woff2`, import.meta.url).href;

/* ---------- canvas textures ---------- */

function canvas(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}
function tex(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function grain(g, w, h, R, n, rgb, a) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${rgb},${a * R()})`;
    g.fillRect(R() * w, R() * h, 1 + R() * 2, 1 + R() * 1.5);
  }
}

/* Limestone cheek: 4 m wide x 10.4 m tall (v = y / 10.4). Returns { map, emi }.
 * Slabs 1.2 x 0.6 m with hairline joints; random vertical LED slits; the emissive also carries
 * the uplight wash at the foot of the wall and a softer one under the top. */
const STONE_W = 4, STONE_H = 10.4;
function stoneTex() {
  const R = makeRng(4242), W = 256, H = 666, px = W / STONE_W;
  const slits = [];
  for (let i = 0; i < 13; i++) {
    const x = (0.15 + (i + R() * 0.6) * 3.7 / 13) * px, len = (0.35 + R() * R() * 1.8) * px, y = (0.6 + R() * 9) * px;
    slits.push([Math.round(x), y, len]);
  }
  const map = canvas(W, H, (g, w, h) => {
    g.fillStyle = '#d9c4a0'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 0.6 * px) {          // slabs: each its own shade, bedding streaks
      const off = (Math.round(y / (0.6 * px)) % 2) * 0.6 * px;
      for (let x = -off; x < w; x += 1.2 * px) {
        const v = R() * 8 - 4;
        g.fillStyle = `rgba(${214 + v | 0},${192 + v | 0},${156 + v | 0},0.9)`;
        g.fillRect(x, y, 1.2 * px, 0.6 * px);
        for (let k = 0; k < 3; k++) { g.fillStyle = `rgba(150,125,90,${0.06 * R()})`; g.fillRect(x, y + R() * 0.6 * px, 1.2 * px, 1 + R() * 2); }
      }
      g.fillStyle = 'rgba(120,98,70,0.18)'; g.fillRect(0, y, w, 1);
    }
    for (let y = 0; y < h; y += 0.6 * px) {
      const off = (Math.round(y / (0.6 * px)) % 2) * 0.6 * px;
      for (let x = -off; x < w; x += 1.2 * px) { g.fillStyle = 'rgba(120,98,70,0.14)'; g.fillRect(x, y, 1, 0.6 * px); }
    }
    grain(g, w, h, R, 5000, '120,95,65', 0.18);
    grain(g, w, h, R, 2500, '240,228,205', 0.2);
    for (const [x, y, len] of slits) { g.fillStyle = '#f6e6c8'; g.fillRect(x - 1, y, 2, len); }
  });
  const emi = canvas(W, H, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    let gr = g.createLinearGradient(0, h, 0, h - 3.2 * px);          // uplight pooling at the foot
    gr.addColorStop(0, 'rgba(255,190,120,0.7)'); gr.addColorStop(0.4, 'rgba(255,170,100,0.3)'); gr.addColorStop(1, 'rgba(255,160,90,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    gr = g.createLinearGradient(0, 0, 0, 2 * px);                      // grazing light under the top
    gr.addColorStop(0, 'rgba(255,180,110,0.18)'); gr.addColorStop(1, 'rgba(255,170,100,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.shadowColor = 'rgba(255,190,110,0.8)'; g.shadowBlur = 6;
    for (const [x, y, len] of slits) { g.fillStyle = '#ffdca6'; g.fillRect(x - 1, y, 2, len); }
  });
  return { map: tex(map), emi: tex(emi) };
}

/* Left-wing band: 8 m x 4 m tile of charcoal panels (1.0 x 1.33 m, rows offset) with short
 * horizontal LED dashes sitting in the joints, staggered. */
function ledTex() {
  const R = makeRng(77), W = 512, H = 256, px = W / 8, ph = H / 3;
  const dashes = [];
  const map = canvas(W, H, (g, w, h) => {
    g.fillStyle = '#1b1c1e'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 3; r++) {
      const off = r % 2 ? px * 0.5 : 0;
      for (let x = -off; x < w; x += px) {
        const v = 44 + R() * 16 | 0;
        g.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
        g.fillRect(x + 2, r * ph + 2, px - 4, ph - 4);
        const sh = g.createLinearGradient(0, r * ph, 0, (r + 1) * ph);
        sh.addColorStop(0, 'rgba(255,255,255,0.05)'); sh.addColorStop(1, 'rgba(0,0,0,0.12)');
        g.fillStyle = sh; g.fillRect(x + 2, r * ph + 2, px - 4, ph - 4);
        if (R() < 0.62) {                                            // a dash in this panel's lower joint
          const L = px * (0.45 + R() * 0.4), dx = x + 6 + R() * (px - L - 12);
          dashes.push([dx, (r + 1) * ph - 3, L]);
        }
      }
    }
    for (const [x, y, L] of dashes) { g.fillStyle = '#ffe4b8'; g.fillRect(x, y, L, 3); }
  });
  const emi = canvas(W, H, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.shadowColor = 'rgba(255,180,90,1)'; g.shadowBlur = 7;
    for (const [x, y, L] of dashes) { g.fillStyle = '#ffd9a0'; g.fillRect(x, y, L, 3); }
  });
  return { map: tex(map), emi: tex(emi) };
}

/* Teak soffit slats, 2 m square tile, run along the facade. */
function woodTex() {
  const R = makeRng(9), W = 256;
  return tex(canvas(W, W, (g, w, h) => {
    const n = 16, sw = w / n;
    for (let i = 0; i < n; i++) {
      const v = R() * 26 - 13;
      g.fillStyle = `rgb(${176 + v | 0},${112 + v * 0.8 | 0},${62 + v * 0.5 | 0})`;
      g.fillRect(0, i * sw, w, sw);
      for (let k = 0; k < 14; k++) { g.fillStyle = `rgba(90,50,20,${0.12 * R()})`; g.fillRect(0, i * sw + R() * sw, w, 1); }
      g.fillStyle = 'rgba(40,20,8,0.55)'; g.fillRect(0, i * sw + sw - 2, w, 2);
    }
  }));
}

/* Ground-floor interior seen through the glazing: 12 m x 4.6 m tile. Warm terracotta walls,
 * a row of downlights, pale floor with reflections, dark mullions every 1.5 m. */
function interiorTex() {
  const R = makeRng(31), W = 512, H = 196, px = W / 12;
  return tex(canvas(W, H, (g, w, h) => {
    let gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#24140c'); gr.addColorStop(0.18, '#8a4628'); gr.addColorStop(0.6, '#a85c34'); gr.addColorStop(0.8, '#d49a66'); gr.addColorStop(1, '#6a4028');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += px * 0.5) {                       // vertical terracotta cladding behind
      g.fillStyle = `rgba(90,40,20,${0.15 + 0.2 * R()})`; g.fillRect(x, h * 0.18, 2, h * 0.6);
    }
    for (let i = 0; i < 10; i++) {                                // pools of downlight on the back wall
      const x = (i + 0.5) * w / 10 + (R() - 0.5) * 10;
      const rg = g.createRadialGradient(x, h * 0.22, 1, x, h * 0.35, h * 0.45);
      rg.addColorStop(0, 'rgba(255,230,180,0.9)'); rg.addColorStop(1, 'rgba(255,200,140,0)');
      g.fillStyle = rg; g.fillRect(x - h * 0.5, 0, h, h);
      g.fillStyle = '#fff4dc'; g.fillRect(x - 3, h * 0.14, 6, 2);
    }
    for (let i = 0; i < 5; i++) {                                 // a few silhouettes of tables / people
      g.fillStyle = 'rgba(40,20,12,0.45)';
      const x = R() * w; g.fillRect(x, h * 0.66, 14 + R() * 24, h * 0.12);
    }
    g.fillStyle = 'rgba(20,14,12,0.9)';
    for (let x = 0; x < w; x += px * 1.5) g.fillRect(x, 0, 3, h);
    g.fillRect(0, h * 0.12, w, 2);
  }));
}

/* Jali: one 1 m tile of an eight-point-star lattice. Holes glow, the stone lattice is lit
 * cream-bronze; the whole screen's radial brightness comes from vertex colours. */
function jaliTex() {
  const W = 256;
  const t = tex(canvas(W, W, (g, w) => {
    const s = w, BAR = '#6a543c';
    g.fillStyle = '#ffeac4'; g.fillRect(0, 0, w, w);
    const cells = [[s / 2, s / 2], [0, 0], [s, 0], [0, s], [s, s]];
    g.strokeStyle = BAR; g.fillStyle = BAR; g.lineJoin = 'miter';
    const starPath = (cx, cy, r, rot) => {
      g.beginPath();
      for (let i = 0; i < 16; i++) { const a = rot + i * Math.PI / 8, rr = i % 2 ? r * 0.7 : r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      g.closePath();
    };
    for (const [x, y] of cells) {
      g.lineWidth = s * 0.06; starPath(x, y, s * 0.36, 0); g.stroke();                    // interlocking star network
      g.lineWidth = s * 0.04; starPath(x, y, s * 0.2, Math.PI / 8); g.stroke();
      g.beginPath(); g.arc(x, y, s * 0.06, 0, 7); g.fill();
    }
    g.lineWidth = s * 0.03;                                                              // bars tying the stars
    for (const [x, y] of [[s / 2, 0], [0, s / 2], [s, s / 2], [s / 2, s]]) { g.beginPath(); g.arc(x, y, s * 0.075, 0, 7); g.stroke(); }
  }));
  return t;
}

/* The one name sign: brushed-brass capitals, backlit halo on the charcoal. */
async function loadFonts() {
  const faces = [600, 500].map(w => new FontFace('AMR Garamond', `url(${FONT_URL(w)})`, { weight: String(w) }));
  try { await Promise.all(faces.map(f => f.load())); }
  catch (e) { throw new Error('venue-amr: EB Garamond failed to load (' + FONT_URL(600) + '): ' + e.message); }
  faces.forEach(f => document.fonts.add(f));
}
function signTex() {
  const c = canvas(1024, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const line = (txt, weight, size, spacing, y, pass) => {
      g.font = `${weight} ${size}px "AMR Garamond"`; g.letterSpacing = spacing;
      const x = w / 2 + parseFloat(spacing) / 2;            // letterSpacing trails: re-centre
      if (pass === 0) { g.shadowColor = 'rgba(255,165,80,0.7)'; g.shadowBlur = 22; g.fillStyle = 'rgba(255,180,110,0.35)'; }
      else {
        g.shadowBlur = 0;
        const gr = g.createLinearGradient(0, y - size * 0.75, 0, y);
        gr.addColorStop(0, '#f6dfa4'); gr.addColorStop(0.45, '#d4a95c'); gr.addColorStop(0.55, '#b9873e'); gr.addColorStop(1, '#e8c77f');
        g.fillStyle = gr;
      }
      const mw = g.measureText(txt).width;
      g.save(); if (mw > w * 0.94) { g.translate(w / 2, 0); g.scale(w * 0.94 / mw, 1); g.translate(-w / 2, 0); }
      g.fillText(txt, x, y); g.restore();
    };
    for (const pass of [0, 1]) {
      line('AMR UNNATI', 600, 112, '22px', 136, pass);
      line('CONVENTION', 500, 44, '28px', 206, pass);
    }
  });
  const t = tex(c, { repeat: false });
  return t;
}

/* Soft radial pool for additive light on floors and walls. */
function poolTex() {
  return tex(canvas(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  }), { repeat: false });
}

/* ---------- geometry helpers (local frame) ---------- */

const _c = new THREE.Color(), _e = new THREE.Euler(), _mm = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _pv = new THREE.Vector3(), _sv = new THREE.Vector3(1, 1, 1);
/* Default UVs: planar per face in metres / tile (u along the face's horizontal, v up). */
const metreUV = (tu, tv = tu) => (x, y, z, nx, ny, nz) =>
  Math.abs(ny) > 0.7 ? [x / tu, z / tv] : Math.abs(nx) > Math.abs(nz) ? [-z * Math.sign(nx) / tu, y / tv] : [x * Math.sign(nz || 1) / tu, y / tv];

/** Transform g (rotation euler rx,ry,rz then position), recompute UVs by `uv`, add vertex colour; push. */
function add(list, g, x, y, z, { rx = 0, ry = 0, rz = 0, col = 0xffffff, uv = metreUV(1) } = {}) {
  _mm.compose(_pv.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _sv);
  g.applyMatrix4(_mm);
  const P = g.attributes.position, N = g.attributes.normal, n = P.count;
  const U = new Float32Array(n * 2), C = new Float32Array(n * 3);
  _c.set(col);
  for (let i = 0; i < n; i++) {
    const [u, v] = uv(P.getX(i), P.getY(i), P.getZ(i), N.getX(i), N.getY(i), N.getZ(i));
    U[i * 2] = u; U[i * 2 + 1] = v;
    C[i * 3] = _c.r; C[i * 3 + 1] = _c.g; C[i * 3 + 2] = _c.b;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  list.push(g);
  return g;
}
/** Axis box from min corner to max corner. */
const box = (list, x0, y0, z0, x1, y1, z1, o) =>
  add(list, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, o);
/** Vertical plane facing -x (toward the road) spanning z0..z1, y0..y1 at x. */
const faceX = (list, x, z0, z1, y0, y1, o) =>
  add(list, new THREE.PlaneGeometry(z1 - z0, y1 - y0), x, (y0 + y1) / 2, (z0 + z1) / 2, { ry: -Math.PI / 2, ...o });

function meshOf(list, mat, name) {
  const g = list.length === 1 ? list[0] : mergeGeometries(list.map(g => g.index ? g : g), false);
  if (!g) throw new Error('venue-amr: merge failed for ' + name);
  const m = new THREE.Mesh(g, mat);
  m.name = 'amr:' + name;
  m.userData.tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
  return m;
}

/* ---------- materials ---------- */

function makeMats(T) {
  const std = o => new THREE.MeshStandardMaterial(o);
  const M = {
    dark: std({ vertexColors: true, roughness: 0.55, metalness: 0.12 }),
    led: std({ map: T.led.map, emissiveMap: T.led.emi, emissive: 0xffffff, roughness: 0.5, metalness: 0.1 }),
    stone: std({ map: T.stone.map, emissiveMap: T.stone.emi, emissive: 0xffffff, roughness: 0.85 }),
    wood: std({ map: T.wood, emissiveMap: T.wood, emissive: 0xffffff, roughness: 0.7 }),
    copper: std({ vertexColors: true, color: 0x8c5a3e, roughness: 0.55, metalness: 0.1, emissive: 0x2a1207 }),
    interior: new THREE.MeshBasicMaterial({ map: T.interior }),
    jali: new THREE.MeshBasicMaterial({ map: T.jali, vertexColors: true }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    pool: new THREE.MeshBasicMaterial({ map: T.pool, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    cglass: std({ color: 0x8fa2ad, transparent: true, opacity: 0.32, roughness: 0.08, metalness: 0.3, emissive: 0x6a4524, depthWrite: false, side: THREE.DoubleSide }),
    sign: std({ map: T.sign, emissiveMap: T.sign, emissive: 0xffffff, transparent: true, roughness: 0.35, metalness: 0.3, depthWrite: false }),
  };
  return M;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* ---------- 1. hall body, left wing, right louvre block ---------- */

const CHAR = 0x3a3c40, CHAR_D = 0x2a2b2e, PLINTH = 0x8c8a86;
const X_BACK = 22, Z0 = -22, Z1 = 22, P0 = 3, P1 = 16;          // hall extent; portal z range
const BAND = [5, 9], PARA = 9.7, XG = 2.6, XM = 3.0;               // band, parapet top, glass line, mass line

function buildBody(L, lo) {
  const { dark, led, wood, interior, copper } = L;
  // the mass behind everything, and the band over the left wing
  box(dark, XM, 0, Z0, X_BACK, PARA - 0.2, Z1, { col: CHAR });
  box(dark, 0, BAND[0], Z0, XM, BAND[1], P0, { col: CHAR });
  box(dark, -0.12, BAND[1], Z0 - 0.12, X_BACK, PARA, P0, { col: CHAR_D });            // parapet coping
  faceX(led, -0.015, Z0, P0, BAND[0], BAND[1], { uv: (x, y, z) => [z / 8, (y - BAND[0]) / 4] });
  add(wood, new THREE.PlaneGeometry(XM, P0 - Z0), XM / 2, BAND[0] - 0.01, (Z0 + P0) / 2, { rx: Math.PI / 2, uv: metreUV(2) });
  faceX(interior, XG, Z0 + 0.6, P0, 0.3, BAND[0], { uv: (x, y, z) => [z / 12, (y - 0.3) / 4.7] });
  box(dark, -0.2, -0.4, Z0, XM, 0.3, P0, { col: PLINTH });                              // plinth / walkway
  box(dark, 0, 0.3, Z0, XM, BAND[0], Z0 + 0.6, { col: CHAR });                          // end pier
  for (let z = Z0 + 5; z < P0; z += 5) box(dark, XG - 0.1, 0.3, z - 0.18, XG + 0.05, BAND[0], z + 0.18, { col: CHAR_D });  // mullion piers
  // copper fins in alternate bays, just proud of the glass
  const step = lo ? 0.5 : 0.36;
  for (let b = Z0 + 0.6; b < P0 - 1; b += 5) {
    if (Math.round((b - Z0) / 5) % 2) continue;
    for (let z = b + 0.4; z < Math.min(b + 3.4, P0 - 0.2); z += step)
      box(copper, XG - 0.42, 0.3, z - 0.035, XG - 0.04, BAND[0], z + 0.035, { col: 0xffffff });
  }

  // right block: taller, dense vertical copper louvres on the front and on the end facing the approach
  const RB = 11;
  box(dark, 0, 0, P1, X_BACK, RB, Z1, { col: CHAR_D });
  box(dark, -0.55, RB - 0.45, P1, X_BACK, RB, Z1 + 0.55, { col: CHAR });                 // cap
  box(dark, -0.55, -0.4, P1, 0, 0.3, Z1 + 0.55, { col: PLINTH });
  const ls = lo ? 0.42 : 0.26, FR = makeRng(5), tint = () => new THREE.Color(0xffffff).multiplyScalar(0.8 + 0.25 * FR()).getHex();
  for (let z = P1 + 0.25; z < Z1 + 0.3; z += ls)
    box(copper, -0.5, 0.3, z - 0.045, -0.06, RB - 0.45, z + 0.045, { col: tint() });
  const XE = 7.5, ZE = Z1 + 0.5;                                                          // end facing the approach
  for (let x = 0.25; x < XE; x += ls)
    box(copper, x - 0.045, 0.3, Z1 + 0.06, x + 0.045, RB - 0.45, ZE, { col: tint() });
  box(dark, XE, BAND[1], Z1, X_BACK, RB - 0.45, ZE, { col: CHAR });
  box(dark, XE, 0, Z1, XE + 0.5, BAND[1], ZE + 0.1, { col: CHAR_D });
  box(dark, X_BACK - 0.5, 0, Z1, X_BACK, BAND[1], ZE + 0.1, { col: CHAR_D });
  // the LED-slot band and warm glazing wrap round this end, so the approach reads as one building
  const endFace = (list, y0, y1, uv) => add(list, new THREE.PlaneGeometry(X_BACK - XE - 1, y1 - y0), (XE + X_BACK) / 2, (y0 + y1) / 2, ZE + 0.01, { uv });
  endFace(led, BAND[0], BAND[1], (x, y) => [x / 8, (y - BAND[0]) / 4]);
  endFace(interior, 0.3, BAND[0], (x, y) => [x / 12, (y - 0.3) / 4.7]);
  box(dark, XE, BAND[0] - 0.25, ZE - 0.2, X_BACK, BAND[0], ZE + 0.05, { col: CHAR_D });
  box(dark, XE, -0.4, Z1, X_BACK, 0.3, ZE + 0.4, { col: PLINTH });
}

/* ---------- 2. entrance portal ---------- */

const PX = -3, PT = 10.4, OP = [5, 14], OH = 6.8, FL = 0.6, XJ = 2.9;   // front, top, opening z, soffit, floor, jali
const stoneUV = (x, y, z, nx, ny, nz) => [metreUV(STONE_W)(x, y, z, nx, ny, nz)[0], y / STONE_H];

function buildPortal(L, lo) {
  const { dark, stone, wood, glow, pool, jali } = L;
  // limestone cheeks, full height, returning into the opening
  box(stone, PX, 0, P0, XJ, PT, OP[0], { uv: stoneUV });
  box(stone, PX, 0, OP[1], XJ, PT, P1, { uv: stoneUV });
  box(dark, PX - 0.05, PT - 0.02, P0 - 0.05, XM, PT + 0.18, P1 + 0.05, { col: CHAR_D });   // thin coping
  box(dark, PX, OH, OP[0], XJ, PT, OP[1], { col: CHAR });                                // charcoal header (the sign)
  // teak-lined opening
  add(wood, new THREE.PlaneGeometry(XJ - PX, OP[1] - OP[0]), (PX + XJ) / 2, OH - 0.01, (OP[0] + OP[1]) / 2,
    { rx: Math.PI / 2, rz: 0, uv: (x, y, z) => [z / 2, x / 2] });
  // floor + four steps down to the forecourt, LED strip under every nosing, wash on the riser below
  box(stone, PX, -0.4, OP[0] - 0.6, XJ, FL, OP[1] + 0.6, { uv: () => [0.01, 0.4] });
  const TR = 0.42, RH = 0.15;
  for (let k = 1; k <= 3; k++) {
    const x0 = PX - TR * k, top = FL - RH * k;
    box(stone, x0, -0.4, OP[0] - 0.6 - 0.3 * k, PX, top, OP[1] + 0.6 + 0.3 * k, { uv: () => [0.01, 0.4] });
  }
  for (let k = 0; k <= 3; k++) {
    const xf = PX - TR * k, top = FL - RH * k, z0 = OP[0] - 0.6 - 0.3 * k, z1 = OP[1] + 0.6 + 0.3 * k;
    box(glow, xf - 0.012, top - 0.035, z0 + 0.1, xf, top - 0.012, z1 - 0.1, { col: 0xffc27a });
    faceX(pool, xf - 0.02, z0 + 0.1, z1 - 0.1, top - RH, top - 0.02,
      { col: 0xc98040, uv: (x, y) => [0.5, 0.5 + 0.5 * (top - y) / RH] });
    add(pool, new THREE.PlaneGeometry(TR * 1.4, z1 - z0), xf - TR * 0.5, top - RH + 0.005, (z0 + z1) / 2,
      { rx: -Math.PI / 2, col: 0x7a4a22, uv: (x, y, z) => [0.5 + (xf - x) / (TR * 2), 0.5] });
  }
  // dark bronze doors on the inner cheeks, flanking the jali
  box(dark, 1.0, FL, OP[0], 2.5, FL + 3.3, OP[0] + 0.06, { col: 0x2b221c });
  box(dark, 1.0, FL, OP[1] - 0.06, 2.5, FL + 3.3, OP[1], { col: 0x2b221c });

  // the jali: floor to soffit, glowing from behind, brightest at its heart
  const JZ = [OP[0] + 0.35, OP[1] - 0.35], JW = JZ[1] - JZ[0], JH = OH - FL;
  const jg = new THREE.PlaneGeometry(JW, JH, 12, 10);
  add(jali, jg, XJ - 0.02, (FL + OH) / 2, (JZ[0] + JZ[1]) / 2, { ry: -Math.PI / 2, uv: (x, y, z) => [(z - JZ[0]) / 1.05, (y - FL) / 1.05] });
  const JP = jg.attributes.position, JC = jg.attributes.color;
  for (let i = 0; i < JP.count; i++) {
    const dz = (JP.getZ(i) - (JZ[0] + JZ[1]) / 2) / (JW / 2), dy = (JP.getY(i) - (FL + JH * 0.45)) / (JH / 2);
    const v = 1.15 - 0.45 * Math.min(1, Math.sqrt(dz * dz * 0.8 + dy * dy * 0.6));
    JC.setXYZ(i, v, v * 0.93, v * 0.8);
  }
  const fr = 0.12;                                                                       // bronze frame
  box(dark, XJ - 0.1, FL, JZ[0] - fr, XJ + 0.05, OH, JZ[0], { col: 0x4a3526 });
  box(dark, XJ - 0.1, FL, JZ[1], XJ + 0.05, OH, JZ[1] + fr, { col: 0x4a3526 });
  // warm pool on the portal floor in front of the jali, and on the stone cheeks' inner faces
  add(pool, new THREE.PlaneGeometry(5, JW + 1), XJ - 2.2, FL + 0.01, (JZ[0] + JZ[1]) / 2, { rx: -Math.PI / 2, col: 0xa06a36, uv: (x, y, z) => [(x - XJ + 4.7) / 5, (z - JZ[0] + 0.5) / (JW + 1)] });
  // planters with small palms either side of the jali
  const seg = lo ? 10 : 18;
  for (const z of [JZ[0] + 0.9, JZ[1] - 0.9]) {
    add(dark, new THREE.CylinderGeometry(0.34, 0.26, 1.1, seg), XJ - 1.0, FL + 0.55, z, { col: 0x2e2a27 });
  }
  return { palmAt: [[XJ - 1.0, FL + 1.05, JZ[0] + 0.9], [XJ - 1.0, FL + 1.05, JZ[1] - 0.9]] };
}

/* ---------- 3. canopy, chandelier, sign ---------- */

const CZ = [2.4, 16.6], CD = 8.2, CY = 9.9, TILT = -0.12;                 // canopy z span, depth, root height, pitch

function buildCanopy(L, lo) {
  const { dark, cglass, pool } = L;
  const beams = [], glass = [];
  // waffle grid in the canopy's own plane (x' from -CD..0 outward, y' = 0 top of beams)
  const nx = 9, nz = 16, W = CZ[1] - CZ[0];
  box(beams, -CD, -0.34, CZ[0], 0, 0, CZ[0] + 0.16, { col: CHAR_D });                   // rim beams
  box(beams, -CD, -0.34, CZ[1] - 0.16, 0, 0, CZ[1], { col: CHAR_D });
  box(beams, -CD, -0.34, CZ[0], -CD + 0.16, 0, CZ[1], { col: CHAR_D });
  box(beams, -0.16, -0.34, CZ[0], 0, 0, CZ[1], { col: CHAR_D });
  for (let i = 1; i < nx; i++) { const x = -CD * i / nx; box(beams, x - 0.035, -0.2, CZ[0], x + 0.035, 0, CZ[1], { col: CHAR }); }
  for (let j = 1; j < nz; j++) { const z = CZ[0] + W * j / nz; box(beams, -CD, -0.2, z - 0.035, 0, 0, z + 0.035, { col: CHAR }); }
  add(glass, new THREE.PlaneGeometry(CD, W), -CD / 2, 0.02, (CZ[0] + CZ[1]) / 2, { rx: -Math.PI / 2 });
  const place = g => { g.rotateZ(TILT); g.translate(PX, CY, 0); return g; };
  dark.push(...beams.map(place)); L.cglass.push(...glass.map(place));
  // warm light caught on the underside: a faint additive sheet just under the grid
  const under = add(pool, new THREE.PlaneGeometry(CD, W), -CD / 2, -0.36, (CZ[0] + CZ[1]) / 2,
    { rx: Math.PI / 2, col: 0x5a3818, uv: (x, y, z) => [0.5 + x / (CD * 1.4), 0.5 + (z - (CZ[0] + CZ[1]) / 2) / (W * 1.1)] });
  L.pool[L.pool.length - 1] = place(under);
  // two slender round columns at the outer corners, to the underside of the rim
  const cx = PX - CD + 0.35, top = CY + Math.sin(-TILT) * (CD - 0.35) - 0.34;
  for (const z of [CZ[0] + 0.5, CZ[1] - 0.5]) {
    add(dark, new THREE.CylinderGeometry(0.19, 0.21, top, lo ? 10 : 20), cx, top / 2, z, { col: 0x55585d });
    add(pool, new THREE.PlaneGeometry(2.4, 2.4), cx, 0.03, z, { rx: -Math.PI / 2, col: 0x6a4020, uv: (x, y, zz) => [(x - cx) / 2.4 + 0.5, (zz - z) / 2.4 + 0.5] });
  }
}

function buildChandelier(L, lo) {
  const cz = (OP[0] + OP[1]) / 2, cx = -0.6, seg = lo ? 40 : 72;
  [[1.5, 6.05, 0.08], [1.08, 5.6, -0.12], [0.68, 5.2, 0.16]].forEach(([r, y, t]) => {
    add(L.glow, new THREE.TorusGeometry(r, 0.045, 6, seg), cx, y, cz, { rx: Math.PI / 2 + t, rz: t * 0.6, col: 0xffd9a0 });
    for (let k = 0; k < 3; k++) {                                                        // hair-thin suspension wires
      const a = k * 2.094 + r, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      add(L.dark, new THREE.CylinderGeometry(0.006, 0.006, OH - y, 3), x, (OH + y) / 2, z, { col: 0x777777 });
    }
  });
  add(L.pool, new THREE.PlaneGeometry(5, 5), cx, OH - 0.03, cz, { rx: Math.PI / 2, col: 0x8a5a2a, uv: (x, y, z) => [(x - cx) / 5 + 0.5, (z - cz) / 5 + 0.5] });
}

/* the one name: brass letters on the charcoal header over the opening */
function buildSign(L) {
  const w = 7.6, h = w / 4, y = (OH + PT) / 2 + 0.05;
  add(L.sign, new THREE.PlaneGeometry(w, h), PX - 0.02, y, (OP[0] + OP[1]) / 2, { ry: -Math.PI / 2, uv: (x, yy, z) => [(z - (OP[0] + OP[1]) / 2) / w + 0.5, (yy - y) / h + 0.5] });
}

/* ---------- assembly ---------- */

export default {
  id: 'dam',
  async build(ctx) {
    const { path, quality } = ctx;
    const lo = quality.tier === 'low';
    await loadFonts();
    const T = { stone: stoneTex(), led: ledTex(), wood: woodTex(), interior: interiorTex(), jali: jaliTex(), sign: signTex(), pool: poolTex() };
    const M = makeMats(T);
    const L = {}; for (const k in M) L[k] = [];

    buildBody(L, lo);
    const { palmAt } = buildPortal(L, lo);
    buildCanopy(L, lo);
    buildChandelier(L, lo);
    buildSign(L);

    const group = new THREE.Group();
    group.name = 'venue-amr';
    const S = AMR.hall.s, PY = path.roadY(AMR.VENUE.s) + 0.02;
    group.position.copy(path.toWorld(S, AMR.hall.front)); group.position.y = PY;
    group.rotation.y = path.sample(S).heading;
    let tris = 0;
    const order = { cglass: 5, pool: 6, sign: 7 };
    for (const k in L) {
      if (!L[k].length) continue;
      const m = meshOf(L[k], M[k], k);
      m.renderOrder = order[k] || 0;
      tris += m.userData.tris; group.add(m);
    }

    // small palms in the planters (flora kit, instanced)
    const pg = kindGeometry('palm');
    const palms = new THREE.InstancedMesh(pg, floraMaterial({ sway: false, rough: 0.8 }), palmAt.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    palmAt.forEach(([x, y, z], i) => {
      m4.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 2.4 + 0.7), new THREE.Vector3(0.24, 0.2, 0.24));
      palms.setMatrixAt(i, m4);
    });
    palms.name = 'amr:palms'; group.add(palms);
    tris += (pg.index ? pg.index.count : pg.attributes.position.count) / 3 * palmAt.length;
    group.userData.tris = tris;
    if (typeof window !== 'undefined') window.__amr = { tris, calls: group.children.length };

    const U = ctx.world.U;
    let last = -1;
    return {
      group,
      update() {
        const d = U.uDusk.value;
        if (Math.abs(d - last) < 0.002) return;
        last = d;
        const k = smooth(0.12, 0.75, d);
        M.led.emissiveIntensity = 1.5 * k;
        M.stone.emissiveIntensity = 1.3 * k;
        M.wood.emissiveIntensity = 0.08 + 0.6 * k;
        M.copper.emissiveIntensity = 0.2 + 0.8 * k;
        M.interior.color.setScalar(0.25 + 0.42 * k);
        M.jali.color.setScalar(0.4 + 0.7 * k);
        M.glow.color.setScalar(0.35 + 0.8 * k);
        M.pool.opacity = 0.15 + 0.85 * k;
        M.cglass.emissiveIntensity = 0.1 + 0.5 * k;
        M.sign.emissiveIntensity = 0.2 + 0.8 * k;
      }
    };
  }
};
