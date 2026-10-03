/* INS Kursura (S20), the submarine museum on RK Beach — left verge, at the start of the beach, before the
 * first event. Built into the 'garden-beach' zone's visibility window. Placement: core/timeline.js
 * EVENTS.submarine. A Foxtrot-class boat, 91.3 m × 7.5 m, lying on low concrete saddles on a road-level
 * paved deck behind the Beach Road parapet, parallel to the road, bow toward oncoming cars.
 * Modelled from Wikimedia Commons photos (category "INS Kursura (S20)").
 *
 * OBJECTS (sub-local: bow at z = 0 facing +z, the hull running to z = -L; +x toward the road; draw calls in brackets)
 *   1  deck — red-brick pavers at road level, concrete retaining faces down to the sand        [2]
 *   2  deck railing along the sea edge and ends (sea-wall blue)                                 [1]
 *   3  hull — weathered black, silver-painted bow bulb and cap (vertex colours)                 [1]
 *   4  sail, bow planes, stern planes, rudder, masts, saddles — black steel                     [1]
 *   5  torpedo tubes: six in two columns of three in the bow face, dark, two with red warheads [1]
 *   6  three propellers, cream-painted                                                          [1]
 *   7  visitors' staircase up the road side to a landing forward of the sail                   [1]
 *   8  anchor on a plinth before the bow                                                         [1]
 *   9  naval ensign on the sail                                                                  [1]
 *   10 granite sign by the parapet: 'INS KURSURA' / 'Submarine Museum · RK Beach'               [2]
 * Time of day: world.U.uDusk drives the sign's glow.
 */
import * as THREE from 'three';
import { EVENTS } from '../../core/timeline.js';
import { rng as makeRng, fbm, smoothstep } from '../../core/noise.js';
import { loadFonts } from './board.js';

const L = 91.3;          // length overall
const HW = 3.75, HH = 3.6;   // full-section half-beam, half-height
const KEEL = 0.4;        // keel above the deck (saddles)
const SAIL0 = 0.3 * L, SAIL_L = 14, SAIL_H = 4.6, SAIL_W = 2.6;

/* ---------- hull section along u (0 bow … 1 stern) ---------- */
const halfW = u => {
  const x = u * L;
  if (x < 11) return 0.45 + (HW - 0.45) * Math.pow(Math.sin(Math.PI / 2 * x / 11), 0.95);   // a narrow, tall stem
  if (u < 0.62) return HW;
  return Math.max(0.35, HW * (1 - Math.pow((u - 0.62) / 0.38, 1.7)));
};
const halfH = u => {
  const x = u * L;
  if (x < 3) return 2.5 + (HH - 2.5) * Math.sin(Math.PI / 2 * x / 3);
  if (u < 0.68) return HH;
  return Math.max(0.6, HH - (HH - 1.0) * Math.pow((u - 0.68) / 0.32, 1.5));
};
const centreY = u => HH - 0.5 * (HH - halfH(u));   // keel line rises a little at the stern, the deck line falls more

function hullGeometry() {
  const N = 140, M = 64, n = 2.4, pos = [], col = [], idx = [], R = makeRng('kursura-hull');
  const BLACK = new THREE.Color(0x232527), FADE = new THREE.Color(0x3a3d40), RUST = new THREE.Color(0x5e4838), SILVER = new THREE.Color(0xb4b8b8);
  const c = new THREE.Color();
  const us = [];
  for (let i = 0; i <= N; i++) us.push(0.5 - 0.5 * Math.cos(Math.PI * i / N));   // dense at the ends
  for (const u of us) {
    const w = halfW(u), h = halfH(u), cy = centreY(u), z = -u * L, x = u * L;
    for (let j = 0; j < M; j++) {
      const th = (j / M) * Math.PI * 2, ct = Math.cos(th), st = Math.sin(th);
      const px = w * Math.sign(ct) * Math.pow(Math.abs(ct), 2 / n), ry = Math.sign(st) * Math.pow(Math.abs(st), 2 / n);
      pos.push(px, cy + h * ry, z);
      // weathered black: faded panels, rust bleeding down from the casing, silver bow bulb and cap
      const streak = fbm(x * 0.9 + px * 0.3, (cy + h * ry) * 0.12, 3), panel = fbm(x * 0.08, ry * 1.5 + px * 0.2, 2);
      c.copy(BLACK).lerp(FADE, smoothstep(-0.1, 0.5, panel) * 0.7);
      if (ry > 0.3) c.lerp(RUST, smoothstep(0.1, 0.5, streak) * smoothstep(0.3, 0.9, ry) * 0.55);
      if ((x < 4.5 && ry > 0.62) || (x < 6.5 && ry < -0.62)) c.copy(SILVER).multiplyScalar(0.92 + R() * 0.08);
      c.multiplyScalar(0.94 + R() * 0.08);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const a = i * M + j, b = i * M + (j + 1) % M, c2 = a + M, d = b + M;
    idx.push(a, c2, b, b, c2, d);
  }
  // end caps: a fan to a centre point at the bow and at the stern
  for (const [i, u] of [[0, 0], [N, 1]]) {
    const ci = pos.length / 3;
    pos.push(0, centreY(u), -u * L + (u ? -0.25 : 0.12));
    col.push(BLACK.r, BLACK.g, BLACK.b);
    for (let j = 0; j < M; j++) { const a = i * M + j, b = i * M + (j + 1) % M; u ? idx.push(ci, b, a) : idx.push(ci, a, b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------- helpers ---------- */

function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, renderer, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Collects transformed, non-indexed pieces into one geometry (position, normal, uv). */
class Bin {
  constructor() { this.list = []; }
  add(g, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) {
    g = g.index ? g.toNonIndexed() : g;
    if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    this.list.push(g);
    return this;
  }
  geo() {
    const geo = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      let n = 0; for (const g of this.list) n += g.attributes[name].array.length;
      const a = new Float32Array(n); let o = 0;
      for (const g of this.list) { a.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
      geo.setAttribute(name, new THREE.BufferAttribute(a, this.list[0].attributes[name].itemSize));
    }
    return geo;
  }
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0, r1, h, seg = 12) => new THREE.CylinderGeometry(r0, r1, h, seg);
/** a cylinder between two points */
function rod(bin, r, a, b, seg = 8) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = cyl(r, r, len, seg).toNonIndexed();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  bin.list.push(g);
}

/* ---------- textures ---------- */

// 512 px = 2.4 m: red-brick pavers in running bond, as on the museum's promenade
function paverCanvas() {
  const n = 512, c = mk(n, n), g = c.getContext('2d'), R = makeRng('kursura-pavers');
  g.fillStyle = '#6e4a40'; g.fillRect(0, 0, n, n);
  const pw = n / 4, ph = n / 8;
  for (let r = 0; r < 8; r++) for (let k = -1; k < 5; k++) {
    const x = k * pw + (r % 2) * pw / 2, y = r * ph, v = 0.86 + R() * 0.2;
    g.fillStyle = `rgb(${Math.round(160 * v)},${Math.round(92 * v)},${Math.round(76 * v)})`;
    g.fillRect(x + 3, y + 3, pw - 6, ph - 6);
  }
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(40,25,20,${R() * 0.08})`; g.fillRect(R() * n, R() * n, 2, 2); }
  return c;
}

/** Indian naval ensign: white field, the tricolour in the canton, the navy's octagon on the fly. */
function ensignCanvas() {
  const W = 300, H = 200, c = mk(W, H), g = c.getContext('2d');
  g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, W, H);
  const cw = W / 2, ch = H / 2;
  g.fillStyle = '#ff9933'; g.fillRect(0, 0, cw, ch / 3);
  g.fillStyle = '#ffffff'; g.fillRect(0, ch / 3, cw, ch / 3);
  g.fillStyle = '#138808'; g.fillRect(0, (2 * ch) / 3, cw, ch / 3);
  g.strokeStyle = '#000080'; g.lineWidth = 2; g.beginPath(); g.arc(cw / 2, ch / 2, ch / 7, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#1b2a6b'; g.beginPath();
  for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + (k * Math.PI) / 4; g.lineTo(W * 0.73 + Math.cos(a) * 34, H * 0.55 + Math.sin(a) * 34); }
  g.closePath(); g.fill();
  g.fillStyle = '#d9b44a'; g.beginPath(); g.arc(W * 0.73, H * 0.55, 13, 0, Math.PI * 2); g.fill();
  return c;
}

/** The sign's face: black granite, 'INS KURSURA' and 'Submarine Museum · RK Beach' in gold leaf. */
function signCanvas() {
  const W = 1536, H = 640, c = mk(W, H), g = c.getContext('2d'), R = makeRng('kursura-granite');
  g.fillStyle = '#18171b'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 16000; i++) { g.fillStyle = R() < 0.6 ? `rgba(255,255,255,${R() * 0.07})` : `rgba(0,0,0,${R() * 0.25})`; g.fillRect(R() * W, R() * H, 1 + R() * 2, 1 + R() * 2); }
  const gold = (y0, y1) => {
    const gr = g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, '#fff0bf'); gr.addColorStop(0.42, '#f0cd7c'); gr.addColorStop(0.62, '#cf9f4c'); gr.addColorStop(1, '#f7dc96');
    return gr;
  };
  g.strokeStyle = gold(0, H); g.lineWidth = 4; g.strokeRect(34, 34, W - 68, H - 68);
  const line = (txt, px, sp, cy) => {
    g.font = `600 ${px}px "EB Garamond"`; g.letterSpacing = `${Math.round(px * sp)}px`;
    px = Math.floor(px * Math.min(1, (W * 0.84) / g.measureText(txt).width));      // fit inside the keyline
    g.font = `600 ${px}px "EB Garamond"`; g.letterSpacing = `${Math.round(px * sp)}px`;
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const cx = W / 2 + px * sp / 2;
    g.fillStyle = 'rgba(0,0,0,0.8)'; g.fillText(txt, cx + 2, cy + 4);
    g.fillStyle = gold(cy - px * 0.72, cy); g.fillText(txt, cx, cy);
  };
  line('INS KURSURA', 200, 0.16, 300);
  g.fillStyle = gold(360, 366); g.fillRect(W / 2 - 300, 362, 600, 3);
  line('SUBMARINE MUSEUM · RK BEACH', 74, 0.22, 470);
  return c;
}

/* ---------- build ---------- */

export default {
  id: 'garden-beach',
  async build(ctx) {
    const { path, world, renderer } = ctx;
    const E = EVENTS.submarine, U = world.U, t0 = performance.now();
    const group = new THREE.Group();
    group.name = 'event-submarine';

    // 1 the deck: one level, a little above the highest ground under it (and never below the road)
    let deckY = -Infinity;
    for (let s = E.s0; s <= E.s1; s += 2) {
      deckY = Math.max(deckY, path.roadY(s) + 0.05);
      for (let l = E.lat[0]; l >= E.lat[1]; l -= 1.5) deckY = Math.max(deckY, world.heightSL(s, l) + 0.12);
    }
    {
      const top = [], face = [], P = new THREE.Vector3();
      const quad = (arr, a, b, c, d, ua, ub, uc, ud) => arr.push([a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]);
      const v = (s, l, y) => { path.toWorld(s, l, P); return [P.x, y, P.z]; };
      const low = (s, l) => world.heightSL(s, l) - 0.4;
      const [l0, l1] = E.lat;
      for (let s = E.s0; s < E.s1 - 1e-6; s += 2) {
        const s2 = Math.min(E.s1, s + 2);
        quad(top, v(s, l0, deckY), v(s, l1, deckY), v(s2, l1, deckY), v(s2, l0, deckY),
          [l0 / 2.4, s / 2.4], [l1 / 2.4, s / 2.4], [l1 / 2.4, s2 / 2.4], [l0 / 2.4, s2 / 2.4]);
        // sea-side retaining face
        quad(face, v(s, l1, deckY), v(s, l1, low(s, l1)), v(s2, l1, low(s2, l1)), v(s2, l1, deckY),
          [s / 3, deckY / 3], [s / 3, low(s, l1) / 3], [s2 / 3, low(s2, l1) / 3], [s2 / 3, deckY / 3]);
      }
      for (const [s, flip] of [[E.s0, false], [E.s1, true]]) for (let l = l0; l > l1 + 1e-6; l -= 1.5) {
        const l2 = Math.max(l1, l - 1.5);
        const q = [v(s, l, deckY), v(s, l, low(s, l)), v(s, l2, low(s, l2)), v(s, l2, deckY)];
        const uv = [[l / 3, deckY / 3], [l / 3, low(s, l) / 3], [l2 / 3, low(s, l2) / 3], [l2 / 3, deckY / 3]];
        if (flip) { q.reverse(); uv.reverse(); }
        quad(face, ...q, ...uv);
      }
      const mesh = (tris, mat, name) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flatMap(t => t[0]), 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(tris.flatMap(t => t[1]), 2));
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, mat); m.name = name; m.receiveShadow = true;
        return m;
      };
      const pavers = tex(paverCanvas(), renderer, true);
      // winding: make the top face up whichever way the road runs
      const topMesh = mesh(top, new THREE.MeshStandardMaterial({ map: pavers, roughness: 0.9, side: THREE.DoubleSide }), 'submarine-deck');
      group.add(topMesh);
      group.add(mesh(face, new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.92, side: THREE.DoubleSide }), 'submarine-deck-walls'));

      // 2 railing along the sea edge and the two ends
      const rail = new Bin(), A = new THREE.Vector3(), B = new THREE.Vector3();
      const edge = [];
      for (let l = l0 - 0.4; l > l1; l -= 2.2) edge.push([E.s0 + 0.15, l]);
      for (let s = E.s0 + 0.15; s < E.s1; s += 2.4) edge.push([s, l1 + 0.15]);
      for (let l = l1 + 0.15; l < l0 - 0.3; l += 2.2) edge.push([E.s1 - 0.15, l]);
      edge.push([E.s1 - 0.15, l0 - 0.4]);
      for (let i = 0; i < edge.length; i++) {
        path.toWorld(edge[i][0], edge[i][1], A); A.y = deckY;
        rod(rail, 0.035, A, B.copy(A).setY(deckY + 1.0), 6);
        if (i) {
          path.toWorld(edge[i - 1][0], edge[i - 1][1], B);
          for (const h of [0.5, 0.98]) rod(rail, 0.028, new THREE.Vector3(B.x, deckY + h, B.z), new THREE.Vector3(A.x, deckY + h, A.z), 6);
        }
      }
      const railMesh = new THREE.Mesh(rail.geo(), new THREE.MeshStandardMaterial({ color: 0x2f5e78, roughness: 0.5, metalness: 0.4 }));
      railMesh.name = 'submarine-railing';
      group.add(railMesh);
    }

    // the boat: straight, on the chord between its bow and stern stations
    const sub = new THREE.Group();
    sub.name = 'kursura';
    const Pb = path.toWorld(E.bow, E.ax), Ps = path.toWorld(E.bow + L, E.ax);
    sub.position.set(Pb.x, deckY + KEEL, Pb.z);
    sub.rotation.y = Math.atan2(-(Ps.x - Pb.x), -(Ps.z - Pb.z));
    group.add(sub);
    if (ctx.buildTimes) { const m = new THREE.Vector3().addVectors(Pb, Ps).multiplyScalar(0.5), nn = path.nearest(m.x, m.z); ctx.buildTimes.subMidLateral = +nn.lateral.toFixed(2); }

    // 3 hull
    const hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.25 });
    const hull = new THREE.Mesh(hullGeometry(), hullMat);
    hull.name = 'kursura-hull';
    hull.castShadow = hull.receiveShadow = true;
    sub.add(hull);

    // 4 sail, planes, rudder, masts, saddles
    const steel = new Bin();
    {
      const s = new THREE.Shape();
      s.moveTo(0, 0); s.quadraticCurveTo(0.1, SAIL_H * 0.9, 2.0, SAIL_H); s.lineTo(SAIL_L - 3.4, SAIL_H);
      s.lineTo(SAIL_L - 2.2, SAIL_H - 0.7); s.quadraticCurveTo(SAIL_L - 0.6, 1.4, SAIL_L, 0); s.closePath();
      const bev = 0.4, g = new THREE.ExtrudeGeometry(s, { depth: SAIL_W - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.8, bevelSegments: 4, curveSegments: 16 });
      g.rotateY(Math.PI / 2);                       // shape x (length) → -z, extrusion → +x
      g.translate(-(SAIL_W - 2 * bev) / 2, 0, 0);
      const uS = (SAIL0 + SAIL_L / 2) / L;
      steel.add(g, { y: centreY(uS) + halfH(uS) - 0.6, z: -SAIL0 });
      // bridge windows: a dark band near the top front is part of the colour; masts and periscopes on top
      const topY = centreY(uS) + halfH(uS) - 0.6 + SAIL_H;
      for (const [dz, r, h] of [[-3.6, 0.16, 2.6], [-4.6, 0.12, 3.4], [-5.8, 0.14, 2.2], [-7.2, 0.1, 1.6]]) steel.add(cyl(r, r * 1.2, h, 10), { y: topY + h / 2, z: -SAIL0 + dz });
      steel.add(box(0.5, 0.35, 0.9), { y: topY + 2.0, z: -SAIL0 - 7.2 });     // radar
      // bow planes: long rods out to either side, high on the bow
      const ub = 5.5 / L;
      steel.add(cyl(0.16, 0.16, 2 * (halfW(ub) + 2.2), 10), { rz: Math.PI / 2, y: centreY(ub) + 1.4, z: -5.5 });
      // stern planes and rudder
      const us = (L - 5) / L, cyS = centreY(us);
      steel.add(box(2 * halfW(us) + 5.2, 0.16, 2.6), { y: cyS - 0.2, z: -(L - 5) });
      steel.add(box(0.2, 4.6, 2.8), { y: cyS - 0.6, z: -(L - 2.2) });
      // propeller shafts (side), and the saddles under the keel
      for (const sg of [-1, 1]) steel.add(cyl(0.14, 0.14, 7, 8), { rx: Math.PI / 2, x: sg * 2.3, y: cyS - 1.2, z: -(L - 6.5) });
      for (const z of [-8, -22, -38, -54, -68]) steel.add(box(3.2, KEEL + 0.25, 1.4), { y: -KEEL - 0.25 + (KEEL + 0.25) / 2, z });
    }
    const steelMesh = new THREE.Mesh(steel.geo(), new THREE.MeshStandardMaterial({ color: 0x26282b, roughness: 0.6, metalness: 0.3 }));
    steelMesh.name = 'kursura-sail-planes';
    steelMesh.castShadow = true;
    sub.add(steelMesh);

    // 5 torpedo tubes in the bow face: two columns of three either side of the stem
    {
      // the station where the hull is just wider than the tube column (x 0.62 ± 0.41): the frames stand proud of it
      let uz = 0; while (halfW(uz) < 1.0 && uz < 0.05) uz += 0.0005;
      const zT = -uz * L + 0.35, cy = centreY(uz), dark = new Bin(), red = new Bin();
      for (const sg of [-1, 1]) for (const [k, dy] of [[0, -0.9], [1, -0.15], [2, 0.6]]) {
        dark.add(box(0.82, 0.72, 0.5), { x: sg * 0.62, y: cy + dy, z: zT - 0.1 });                   // recessed frame
        dark.add(cyl(0.3, 0.3, 0.12, 20), { rx: Math.PI / 2, x: sg * 0.62, y: cy + dy, z: zT + 0.18 });   // tube mouth
        if ((k === 1 && sg < 0) || (k === 0 && sg > 0)) red.add(new THREE.CircleGeometry(0.17, 18), { x: sg * 0.62, y: cy + dy, z: zT + 0.245 });
      }
      const tubes = new THREE.Mesh(dark.geo(), new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.7 }));
      tubes.name = 'kursura-tubes';
      sub.add(tubes);
      const warheads = new THREE.Mesh(red.geo(), new THREE.MeshStandardMaterial({ color: 0xa3221c, roughness: 0.5 }));
      warheads.name = 'kursura-warheads';
      sub.add(warheads);
    }

    // 6 three propellers, cream-painted
    {
      const props = new Bin(), cyS = centreY((L - 5) / L);
      const prop = (x, y, z, r) => {
        props.add(cyl(0.2, 0.28, 0.6, 12), { rx: Math.PI / 2, x, y, z });
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2, g = box(0.42, r, 0.06).toNonIndexed();
          g.translate(0, r / 2 + 0.15, 0); g.rotateY(0.5); g.rotateZ(a);
          g.translate(x, y, z); props.list.push(g);
        }
      };
      prop(0, centreY(1) , -L - 0.4, 1.1);
      for (const sg of [-1, 1]) prop(sg * 2.3, cyS - 1.2, -(L - 2.8), 0.95);
      const pm = new THREE.Mesh(props.geo(), new THREE.MeshStandardMaterial({ color: 0xe6dfcf, roughness: 0.5, metalness: 0.2 }));
      pm.name = 'kursura-propellers';
      sub.add(pm);
    }

    // 7 visitors' staircase up the road side (+x) to a landing on the casing just forward of the sail
    {
      const st = new Bin(), zTop = -(SAIL0 - 1.6), uT = -zTop / L, yTop = centreY(uT) + halfH(uT) - 0.15 - (-KEEL) - KEEL;
      const H = yTop + KEEL, run = H / Math.tan(40 * Math.PI / 180), n = Math.round(H / 0.24), xs = HW + 0.9, wid = 1.2;
      const lift = -KEEL;                            // sub-local y of the deck
      for (let i = 0; i < n; i++) {
        const t = (i + 1) / n;
        st.add(box(wid, 0.05, 0.3), { x: xs, y: lift + t * H - 0.03, z: zTop + run * (1 - t) + 0.15 });
      }
      const a = new THREE.Vector3(), b = new THREE.Vector3();
      for (const sx of [xs - wid / 2, xs + wid / 2]) {
        rod(st, 0.06, a.set(sx, lift, zTop + run + 0.3), b.set(sx, lift + H, zTop + 0.2));                    // stringer
        rod(st, 0.03, a.set(sx, lift + 0.95, zTop + run + 0.3), b.set(sx, lift + H + 0.95, zTop + 0.2));      // handrail
        for (let k = 0; k <= 6; k++) { const t = k / 6; rod(st, 0.025, a.set(sx, lift + t * H, zTop + run * (1 - t) + 0.25), b.set(sx, lift + t * H + 0.95, zTop + run * (1 - t) + 0.25)); }
      }
      // landing, reaching in over the casing, with its rails
      st.add(box(xs + wid / 2 - 0.6, 0.08, 2.2), { x: (xs + wid / 2 + 0.6) / 2, y: lift + H - 0.04, z: zTop - 0.9 });
      for (const z of [zTop + 0.2, zTop - 2.0]) rod(st, 0.03, a.set(0.6, lift + H + 0.95, z), b.set(xs + wid / 2, lift + H + 0.95, z));
      for (const z of [zTop + 0.2, zTop - 2.0]) rod(st, 0.025, a.set(xs + wid / 2, lift + H, z), b.set(xs + wid / 2, lift + H + 0.95, z));
      // a deck-level post at the foot
      st.add(box(1.6, 0.06, 1.0), { x: xs, y: lift + 0.03, z: zTop + run + 0.8 });
      const sm = new THREE.Mesh(st.geo(), new THREE.MeshStandardMaterial({ color: 0x1e2023, roughness: 0.55, metalness: 0.5 }));
      sm.name = 'kursura-stairs';
      sm.castShadow = true;
      sub.add(sm);
    }

    // 8 the anchor, upright on a low plinth before the bow
    {
      const an = new Bin(), z = 5.5, y0 = -KEEL;
      an.add(box(1.2, 0.5, 1.2), { y: y0 + 0.25, z });                       // plinth
      const b = y0 + 0.5;
      an.add(box(0.22, 2.4, 0.22), { y: b + 1.5, z });                        // shank
      an.add(new THREE.TorusGeometry(0.22, 0.06, 8, 16), { y: b + 2.9, z });  // ring
      an.add(box(1.3, 0.16, 0.16), { y: b + 2.3, z });                        // stock
      for (const sg of [-1, 1]) {
        an.add(box(0.2, 1.1, 0.2), { rz: sg * 0.95, x: sg * 0.42, y: b + 0.55, z });   // arms
        an.add(box(0.42, 0.45, 0.08), { rz: sg * 0.4, x: sg * 0.86, y: b + 0.9, z });  // flukes
      }
      const am = new THREE.Mesh(an.geo(), new THREE.MeshStandardMaterial({ color: 0x2b2c2e, roughness: 0.7, metalness: 0.3 }));
      am.name = 'kursura-anchor';
      sub.add(am);
    }

    // 9 the ensign on a short staff at the back of the sail, flown along the boat so the road sees it
    {
      const topY = centreY((SAIL0 + SAIL_L / 2) / L) + halfH(0.4) - 0.6 + SAIL_H, z = -(SAIL0 + SAIL_L - 3.6);
      const staff = new THREE.Mesh(cyl(0.035, 0.035, 2.6, 6), new THREE.MeshStandardMaterial({ color: 0xdedad0, roughness: 0.5 }));
      staff.position.set(0, topY + 1.3, z);
      sub.add(staff);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.0), new THREE.MeshStandardMaterial({ map: tex(ensignCanvas(), renderer), roughness: 0.8, side: THREE.DoubleSide }));
      flag.rotation.y = -Math.PI / 2;              // in the z-y plane, hoist at the staff, flying sternward
      flag.position.set(0, topY + 2.05, z - 0.78);
      flag.name = 'kursura-ensign';
      sub.add(flag);
    }

    // 10 the sign: black granite on a sandstone base, by the parapet before the bow, turned toward oncoming cars
    await loadFonts();
    await document.fonts.ready;
    if (!document.fonts.check('600 64px "EB Garamond"')) throw new Error('submarine: site font did not load');
    const signTex = tex(signCanvas(), renderer);
    const signMat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.3, emissive: 0xffd08a, emissiveMap: signTex, emissiveIntensity: 0.12 });
    {
      const sign = new THREE.Group(), SW = 3.0, SH = 1.25;
      const P = path.toWorld(E.s0 + 4, -8.2);
      sign.position.set(P.x, deckY, P.z);
      sign.rotation.y = path.sample(E.s0 + 4).heading + Math.PI / 2 - 0.55;   // face the road, swung toward oncoming cars
      const base = new THREE.Mesh(new Bin().add(box(SW + 0.3, 0.9, 0.5), { y: 0.45 }).add(box(SW + 0.12, SH + 0.12, 0.22), { y: 0.9 + SH / 2 + 0.06, z: -0.05 }).geo(),
        new THREE.MeshStandardMaterial({ color: 0xc9b08a, roughness: 0.85 }));
      sign.add(base);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), signMat);
      face.position.set(0, 0.96 + SH / 2, 0.07);
      sign.add(face);
      sign.name = 'kursura-sign';
      group.add(sign);
    }

    if (ctx.buildTimes) ctx.buildTimes.submarine = Math.round(performance.now() - t0);
    return {
      group,
      update() {
        signMat.emissiveIntensity = 0.12 + 0.5 * U.uDusk.value;
      }
    };
  }
};
