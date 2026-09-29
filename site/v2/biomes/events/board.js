/* Palm Beach Hotel roadside board (right verge). Built into the 'garden-beach' zone's visibility window.
 * Placement: core/timeline.js EVENTS.board. A five-star resort's entrance monument, facing oncoming cars.
 *
 * OBJECTS (board-local: +x = away from the road, -z = road-forward; draw calls in brackets, 10 total)
 *   1  plinth — honed sandstone blocks 3.6 × 0.5 m on a darker footing course, capping slab   [1]
 *   2  panel body + uplight housings — dark bronze                                            [1]
 *   3  brushed-brass frame round the face, brass reveal on the plinth                        [1]
 *   4  panel face — smoked teak, palm-frond monogram, 'PALM BEACH HOTEL' (EB Garamond 600)
 *      and 'Visakhapatnam' (Mrs Saint Delafield) in gold leaf; 2048×1024 canvas, lettering
 *      drawn only after both site fonts have loaded (FontFace), emissive at dusk             [1]
 *   5  uplight lenses (emissive)                                                              [1]
 *   6  light pools on the ground (additive)                                                   [1]
 *   7  uplight wash on the face (additive)                                                    [1]
 *   8  clipped hedge + a low fern border at the base (flora bush / fern geo)                [2]
 *   9  two small coconut palms flanking it (flora palm geo)                                   [1]
 * Time of day: world.U.uDusk drives the lettering glow, lenses, pools and wash.
 */
import * as THREE from 'three';
import { EVENTS } from '../../core/timeline.js';
import { kindGeometry, floraMaterial } from '../flora.js';
import { rng as makeRng } from '../../core/noise.js';

const ANGLE = -0.3;              // face turned ~17° toward the approaching traffic (road is at -x)
const PW = 3.2, PH = 1.6;        // panel face
const PLW = 3.6, PLH = 0.5, PLD = 0.9;

/* ---------- fonts: the site's own files, never a silent fallback ---------- */

let FONTS = null;
function loadFonts() {
  if (!FONTS) FONTS = Promise.all([
    new FontFace('EB Garamond', 'url(../fonts/eb-garamond-600.woff2)', { weight: '600' }),
    new FontFace('Mrs Saint Delafield', 'url(../fonts/mrs-saint-delafield-400.woff2)', { weight: '400' })
  ].map(f => f.load().then(ff => { document.fonts.add(ff); return ff; })));
  return FONTS;
}

/* ---------- canvases ---------- */

function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function tex(c, renderer, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Gold-leaf gradient across a band of the canvas (y0..y1). */
function gold(g, y0, y1) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, '#fff0bf'); gr.addColorStop(0.42, '#f0cd7c'); gr.addColorStop(0.62, '#cf9f4c'); gr.addColorStop(1, '#f7dc96');
  return gr;
}

/** Fine-line palm-frond monogram: two arching fronds from a short stem, centred at (cx, cy), size r. */
function monogram(g, cx, cy, r, stroke) {
  g.save(); g.translate(cx, cy); g.strokeStyle = stroke; g.lineCap = 'round';
  // enclosing ring
  g.lineWidth = r * 0.028; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
  g.lineWidth = r * 0.012; g.beginPath(); g.arc(0, 0, r * 0.9, 0, Math.PI * 2); g.stroke();
  // trunk
  g.lineWidth = r * 0.035;
  g.beginPath(); g.moveTo(r * 0.05, r * 0.72); g.quadraticCurveTo(-r * 0.05, r * 0.2, 0, -r * 0.18); g.stroke();
  // fronds: a quadratic rib, leaflets drawn as short lines off it
  const frond = (ang, len, bend) => {
    const ex = Math.cos(ang) * len, ey = Math.sin(ang) * len, qx = ex * 0.5 + Math.sin(ang) * bend, qy = ey * 0.5 - Math.abs(Math.cos(ang)) * bend;
    const P = t => [2 * (1 - t) * t * qx + t * t * ex, -r * 0.18 + 2 * (1 - t) * t * qy + t * t * ey];
    g.lineWidth = r * 0.022; g.beginPath(); g.moveTo(0, -r * 0.18);
    g.quadraticCurveTo(qx, -r * 0.18 + qy, ex, -r * 0.18 + ey); g.stroke();
    g.lineWidth = r * 0.012;
    for (let i = 1; i < 11; i++) {
      const t = i / 11, [x, y] = P(t), [x2, y2] = P(Math.min(1, t + 0.02));
      const dx = x2 - x, dy = y2 - y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, ll = r * 0.2 * Math.sin(Math.PI * (0.15 + 0.85 * t)) * (1 - 0.3 * t);
      for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + (nx * sg + dx / L * 0.8) * ll, y + (ny * sg + dy / L * 0.8) * ll + ll * 0.35); g.stroke(); }
    }
  };
  for (const [a, l, b] of [[-2.5, 0.62, 0.12], [-0.64, 0.62, 0.12], [-2.0, 0.66, 0.1], [-1.14, 0.66, 0.1], [-1.57, 0.6, 0.02], [-2.95, 0.5, 0.16], [-0.19, 0.5, 0.16]])
    frond(a, r * l, r * b);
  g.restore();
}

/** The panel face: smoked teak, a brass keyline, monogram, name and script. 2048×1024 ≙ 3.2×1.6 m. */
function faceCanvas() {
  const W = 2048, H = 1024, c = mk(W, H), g = c.getContext('2d'), R = makeRng('board-teak');
  // smoked teak: horizontal grain, a few boards, low contrast so the gold carries
  g.fillStyle = '#35231a'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) {
    const y = R() * H, a = 0.03 + R() * 0.07, lw = 0.6 + R() * 2.4;
    g.strokeStyle = R() < 0.5 ? `rgba(10,5,2,${a})` : `rgba(120,78,44,${a * 0.8})`; g.lineWidth = lw;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= W; x += 128) g.lineTo(x, y + Math.sin(x * 0.002 + i) * 5 + (R() - 0.5) * 2);
    g.stroke();
  }
  for (let k = 1; k < 4; k++) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, (k * H) / 4 - 1, W, 2); }
  const vig = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62);
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = vig; g.fillRect(0, 0, W, H);
  // brass keyline, inset
  g.strokeStyle = gold(g, 0, H); g.lineWidth = 5; g.strokeRect(46, 46, W - 92, H - 92);
  g.lineWidth = 1.5; g.strokeRect(62, 62, W - 124, H - 124);

  // lettering: a dark bevel shadow under, a pale highlight above, gold leaf on top (raised, gilded letters)
  const letter = (txt, font, spacing, cx, cy, h) => {
    g.font = font; g.letterSpacing = spacing; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillText(txt, cx + 3, cy + 5);
    g.fillStyle = 'rgba(255,240,200,0.55)'; g.fillText(txt, cx - 1.5, cy - 2);
    g.fillStyle = gold(g, cy - h, cy); g.fillText(txt, cx, cy);
  };
  monogram(g, W / 2, 238, 124, gold(g, 114, 362));
  // name: fit to 82% of the width with generous tracking
  let px = 230, sp = 0.24;
  g.font = `600 ${px}px "EB Garamond"`; g.letterSpacing = `${px * sp}px`;
  const w = g.measureText('PALM BEACH HOTEL').width;
  px = Math.floor(px * Math.min(1, (W * 0.86) / w));
  letter('PALM BEACH HOTEL', `600 ${px}px "EB Garamond"`, `${Math.round(px * sp)}px`, W / 2 + px * sp / 2, 610, px * 0.7);
  // hairline rule with a small lozenge
  g.fillStyle = gold(g, 640, 660);
  g.fillRect(W / 2 - 330, 668, 290, 3); g.fillRect(W / 2 + 40, 668, 290, 3);
  g.save(); g.translate(W / 2, 669.5); g.rotate(Math.PI / 4); g.fillRect(-9, -9, 18, 18); g.restore();
  letter('Visakhapatnam', '400 220px "Mrs Saint Delafield"', '0px', W / 2, 872, 170);
  return c;
}

/** Honed sandstone blocks (Dholpur beige), 1024×256 ≙ 4 × 1 m: two courses, fine mortar joints. */
function stoneCanvas() {
  const W = 1024, H = 256, c = mk(W, H), g = c.getContext('2d'), R = makeRng('board-stone');
  g.fillStyle = '#8c7a62'; g.fillRect(0, 0, W, H);
  for (let r = 0; r < 2; r++) {
    let x = -(r ? 120 : 0);
    while (x < W) {
      const w = 200 + R() * 110, k = 0.93 + R() * 0.1;
      g.fillStyle = `rgb(${Math.round(214 * k)},${Math.round(192 * k)},${Math.round(160 * k)})`;
      g.fillRect(x + 2, r * 128 + 2, w - 4, 124);
      x += w;
    }
  }
  const im = g.getImageData(0, 0, W, H), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const n = 1 + (R() - 0.5) * 0.07; d[i] *= n; d[i + 1] *= n; d[i + 2] *= n; }
  g.putImageData(im, 0, 0);
  return c;
}

/** Radial falloff (white centre → clear), for the additive pools and the wash. */
function radial(N = 128, squash = 1) {
  const c = mk(N, N), g = c.getContext('2d'), gr = g.createRadialGradient(N / 2, N / 2 * squash, 0, N / 2, N / 2 * squash, N / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, N, N);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ---------- geometry ---------- */

/** Box w×h×d with its base centred at (x, y, z); UVs in metres / uvScale (box-projected). */
function slab(w, h, d, x, y, z, uvScale = 0) {
  const g = new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
  if (uvScale) {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
      const u = ax > 0.5 ? p.getZ(i) : p.getX(i), v = ay > 0.5 ? p.getZ(i) : p.getY(i);
      uv.setXY(i, u / uvScale, v / uvScale);
    }
  }
  return g;
}

function merged(list) {
  const out = list.map(g => (g.index ? g.toNonIndexed() : g));
  const geo = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    let n = 0; for (const g of out) n += g.attributes[name].array.length;
    const a = new Float32Array(n); let o = 0;
    for (const g of out) { a.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    geo.setAttribute(name, new THREE.BufferAttribute(a, out[0].attributes[name].itemSize));
  }
  return geo;
}

/** Instanced flora at board-local points [{x, z, y?, s, yaw?, tint?, tilt?}]. */
function flora(kind, pts, seed, opts) {
  const R = makeRng(seed);
  const mesh = new THREE.InstancedMesh(kindGeometry(kind), floraMaterial(opts), pts.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  pts.forEach((p, i) => {
    e.set(p.tilt?.[0] ?? 0, p.yaw ?? R() * 6.283, p.tilt?.[1] ?? 0, 'YXZ');
    m.compose(new THREE.Vector3(p.x, p.y ?? 0, p.z), q.setFromEuler(e), new THREE.Vector3(p.s, p.sy ?? p.s, p.s));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.set(p.tint ?? 0xffffff).multiplyScalar(0.9 + R() * 0.2));
  });
  mesh.computeBoundingSphere();
  mesh.name = 'board:' + kind;
  return mesh;
}

/* ---------- build ---------- */

export default {
  id: 'garden-beach',
  async build(ctx) {
    const { path, world, renderer } = ctx;
    const B = EVENTS.board, U = world.U, t0 = performance.now();
    const group = new THREE.Group();
    group.name = 'event-board';

    // ground: the verge may fall away a little; the footing course runs down to the lowest point
    let yMin = Infinity, yMax = -Infinity;
    for (let ds = -2.5; ds <= 2.5; ds += 1.25) for (let dl = -1.5; dl <= 1.5; dl += 0.75) {
      const y = world.heightSL(B.s + ds, B.lateral + dl); yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
    }
    const P = path.toWorld(B.s, B.lateral);
    group.position.set(P.x, yMax, P.z);
    group.rotation.y = path.sample(B.s).heading;
    const drop = yMax - yMin + 0.12;                   // footing depth below the local grade

    const board = new THREE.Group();                  // the monument, turned toward approaching cars
    board.rotation.y = ANGLE;
    group.add(board);

    // 1 plinth: footing course, two courses of honed sandstone, a capping slab
    const stoneMat = new THREE.MeshStandardMaterial({ map: tex(stoneCanvas(), renderer, true), roughness: 0.82 });
    stoneMat.map.repeat.set(0.25, 1);
    const plinth = new THREE.Mesh(merged([
      slab(PLW + 0.24, 0.12 + drop, PLD + 0.24, 0, -drop, 0, 1),
      slab(PLW, PLH - 0.06, PLD, 0, 0.12, 0, 1),
      slab(PLW + 0.08, 0.06, PLD + 0.08, 0, 0.12 + PLH - 0.06, 0, 1)
    ]), stoneMat);
    plinth.name = 'board-plinth';
    board.add(plinth);

    // 2 panel body (dark bronze), set back on the plinth, with the uplight housings on the ground in front
    const top = 0.12 + PLH, gap = 0.1, PD = 0.16, pz = -0.08;
    const bronzeMat = new THREE.MeshStandardMaterial({ color: 0x2b241d, roughness: 0.5, metalness: 0.55 });
    const lamps = [-1.1, 1.1].map(x => [x, PLD / 2 + 0.55]);
    const body = new THREE.Mesh(merged([
      slab(PW + 0.12, PH + 0.12, PD, 0, top + gap - 0.06, pz),
      slab(PW - 0.6, gap, PD - 0.06, 0, top, pz),       // shadow-gap plinth under the panel
      ...lamps.map(([x, z]) => slab(0.2, 0.14, 0.2, x, -0.04, z))
    ]), bronzeMat);
    body.name = 'board-panel';
    board.add(body);

    // 3 brushed-brass frame, slightly proud of the face
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xc9a25a, roughness: 0.32, metalness: 0.6 });
    const fz = pz + PD / 2 + 0.012, fw = 0.045, y0 = top + gap - 0.06, y1 = y0 + PH + 0.12;
    const frame = new THREE.Mesh(merged([
      slab(PW + 0.12, fw, 0.03, 0, y0, fz), slab(PW + 0.12, fw, 0.03, 0, y1 - fw, fz),
      slab(fw, PH + 0.12, 0.03, -(PW + 0.12) / 2 + fw / 2, y0, fz), slab(fw, PH + 0.12, 0.03, (PW + 0.12) / 2 - fw / 2, y0, fz),
      slab(PW - 0.6, 0.012, 0.012, 0, top + gap - 0.012, pz + (PD - 0.06) / 2 + 0.006)   // brass reveal line
    ]), brassMat);
    frame.name = 'board-frame';
    board.add(frame);

    // 4 the face: lettering drawn only once both site fonts are in
    await loadFonts();
    await document.fonts.ready;
    if (!document.fonts.check('600 64px "EB Garamond"') || !document.fonts.check('64px "Mrs Saint Delafield"'))
      throw new Error('board: site fonts did not load');
    const faceTex = tex(faceCanvas(), renderer);
    const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.55, metalness: 0, emissive: 0xffd08a, emissiveMap: faceTex, emissiveIntensity: 0.14 });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), faceMat);
    face.position.set(0, top + gap + PH / 2, pz + PD / 2 + 0.002);
    face.name = 'board-face';
    board.add(face);

    // 5 uplight lenses: small warm discs on top of the housings, tilted at the face
    const LENS = new THREE.Color(0xffe2b0), lensMat = new THREE.MeshBasicMaterial({ color: LENS.clone() });
    const lensGeo = merged(lamps.map(([x, z]) => new THREE.CircleGeometry(0.07, 16).rotateX(-Math.PI / 2 + 0.35).translate(x, 0.101, z)));
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.name = 'board-lenses';
    board.add(lens);

    // 6 light pools on the ground round each lamp, 7 the wash fanning up the face
    const glow = radial();
    const addMat = o => new THREE.MeshBasicMaterial({ map: glow, color: 0xffc47a, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const poolMat = addMat(0);
    const pools = new THREE.Mesh(merged(lamps.map(([x, z]) => new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2).translate(x, 0.03, z - 0.35))), poolMat);
    pools.name = 'board-pools';
    pools.renderOrder = 2;
    board.add(pools);
    const washMat = addMat(0); washMat.map = radial(128, 1.7);   // hotspot low on the face, fading up
    const wash = new THREE.Mesh(merged(lamps.map(([x]) => new THREE.PlaneGeometry(2.0, 2.4).translate(x * 0.9, top + gap + 0.95, pz + PD / 2 + 0.01))), washMat);
    wash.name = 'board-wash';
    wash.renderOrder = 2;
    board.add(wash);

    // 8 planting: a clipped hedge hugging the plinth, a low fern border in front of it
    const R = makeRng('board-plants'), hedge = [], bloom = [];
    for (let x = -PLW / 2 - 0.3; x <= PLW / 2 + 0.31; x += 0.42) {
      hedge.push({ x, z: PLD / 2 + 0.32, y: -0.1, s: 0.4 + R() * 0.04, sy: 0.26, tint: 0x6a9440 });
      hedge.push({ x: x * 1.02, z: -PLD / 2 - 0.3, y: -0.1, s: 0.46 + R() * 0.05, sy: 0.4, tint: 0x5f8a3a });
    }
    for (const sg of [-1, 1]) for (let z = -PLD / 2 - 0.1; z <= PLD / 2 + 0.2; z += 0.42) hedge.push({ x: sg * (PLW / 2 + 0.4), z, y: -0.1, s: 0.44, sy: 0.34, tint: 0x5f8a3a });
    for (let x = -PLW / 2; x <= PLW / 2; x += 0.45) {
      if (lamps.some(([lx]) => Math.abs(lx - x) < 0.25)) continue;
      bloom.push({ x: x + (R() - 0.5) * 0.1, z: PLD / 2 + 0.8 + (R() - 0.5) * 0.12, y: -0.03, s: 0.5 + R() * 0.15, tint: 0xd8e8b0 });
    }
    board.add(flora('bush', hedge, 'board-hedge', { sway: false, rough: 0.8 }));
    board.add(flora('fern', bloom, 'board-fern', { sway: true }));

    // 9 two small coconut palms flanking it, leaning gently outward
    board.add(flora('palm', [
      { x: -PLW / 2 - 1.3, z: -0.4, y: -0.2, s: 0.42, sy: 0.44, yaw: 0.6, tilt: [0.02, 0.1] },
      { x: PLW / 2 + 1.3, z: -0.6, y: -0.2, s: 0.44, sy: 0.52, yaw: 2.4, tilt: [-0.03, -0.12] }
    ], 'board-palms', { sway: true }));

    if (ctx.buildTimes) ctx.buildTimes.board = Math.round(performance.now() - t0);   // incl. the font wait
    return {
      group,
      update() {
        const d = U.uDusk.value;
        faceMat.emissiveIntensity = 0.14 + 0.5 * d;
        lensMat.color.copy(LENS).multiplyScalar(0.6 + 0.4 * d);
        poolMat.opacity = 0.06 + 0.55 * d;
        washMat.opacity = 0.04 + 0.35 * d;
      }
    };
  }
};
