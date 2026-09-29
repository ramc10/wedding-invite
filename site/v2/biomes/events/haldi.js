/* Haldi (Nov 18, 8 AM, morning sun off the sea). Built into the 'cove' zone's visibility window.
 * Placement: core/timeline.js EVENTS.haldi.
 *
 * A sunlit designer haldi on a raised, bleached-wood deck over the sand:
 * jute rugs and dhurries, a marigold-draped bamboo mandap with sagging yellow and
 * mustard drapes (plus a sheer layer), marigold string curtains and a mango-leaf
 * toran, a wooden chowki for the couple with a brass urli and turmeric bowls, a U of
 * printed floor gaddis and bolsters, fringed yellow chhatris, potted banana plants,
 * a flower rangoli, and a marigold arch at the deck's near end facing the court.
 * Court (core/timeline.js COURTS.haldi): a road-level forecourt of terracotta pavers
 * with a marigold-yellow sandstone border, laterite plinth down to the sand, potted
 * bananas and brass urlis on its edges, clear of the "Take me here" route.
 *
 * Scene-local frame: group at the deck centre, rotation.y = heading; local -z is
 * road-forward, +x is toward the road. Deck top is local y = 0.
 * Draw calls: wood, rugs, gaddis, fabric, sheer, brass, leaves, strings, marigolds, pavers, stone = 11.
 */
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/addons/utils/BufferGeometryUtils.js';
import { EVENTS, COURTS, STOP } from '../../core/timeline.js';
import { rng as makeRng } from '../../core/noise.js';

const TIER = { high: 1, med: 0.6, low: 0.35 };

/* ------------------------------------------------------------ geometry helpers */
// every part is converted to non-indexed with a colour attribute so it merges freely
function part(geo, color, uvScale) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (uvScale) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale[0] + (uvScale[2] || 0), uv.getY(i) * uvScale[1] + (uvScale[3] || 0));
  }
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
function place(g, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  M4.compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz, 'YXZ')), S.set(sx, sy, sz));
  return g.applyMatrix4(M4);
}
function box(w, h, d, x, y, z, color, uvS, ry = 0) {
  return part(place(new THREE.BoxGeometry(w, h, d), x, y, z, 0, ry), color, uvS);
}
function cyl(rt, rb, h, seg, x, y, z, color, uvS, open = false) {
  return part(place(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), x, y, z), color, uvS);
}
// a cylinder between two points (poles, rails, bamboo)
function rod(a, b, r, seg, color) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  Q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  M4.compose(V.addVectors(a, b).multiplyScalar(0.5), Q, S.set(1, 1, 1));
  return part(g.applyMatrix4(M4), color);
}
function merged(list) { const g = mergeGeometries(list, false); for (const p of list) p.dispose(); return g; }

/* ------------------------------------------------------------ canvas textures */
function mkCanvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// bleached deck planks: 512 px = 2 x 2 m, boards run along local z (texture v)
function plankTex(R) {
  const c = mkCanvas(512), x = c.getContext('2d');
  const bw = 512 / 14;
  for (let i = 0; i < 14; i++) {
    const l = 226 + R() * 22 | 0;
    x.fillStyle = `rgb(${l},${l - 4},${l - 12})`; x.fillRect(i * bw, 0, bw, 512);
    for (let k = 0; k < 22; k++) {                       // grain streaks
      const gx = i * bw + 2 + R() * (bw - 4), a = 0.04 + R() * 0.08;
      x.strokeStyle = `rgba(110,90,70,${a})`; x.lineWidth = 0.6 + R();
      x.beginPath(); x.moveTo(gx, 0);
      for (let y = 0; y <= 512; y += 32) x.lineTo(gx + Math.sin(y * 0.02 + k) * 1.5, y);
      x.stroke();
    }
    x.fillStyle = 'rgba(70,58,46,0.55)'; x.fillRect(i * bw, 0, 1.6, 512);        // gap
    const j = R() * 512;                                                          // butt joint
    x.fillRect(i * bw, j, bw, 1.4);
    x.fillStyle = 'rgba(60,50,40,0.35)';                                          // nail heads
    for (const yy of [j - 8, j + 9]) { x.fillRect(i * bw + 6, yy, 2, 2); x.fillRect(i * bw + bw - 8, yy, 2, 2); }
  }
  return tex(c);
}

// rugs atlas (2 x 2): jute | mustard dhurrie / rangoli (alpha) | green dhurrie
function rugTex(R, size) {
  const c = mkCanvas(size), x = c.getContext('2d'), h = size / 2;
  x.scale(size / 1024, size / 1024);
  const H = 512;
  // jute: woven natural fibre with a darker bound border
  x.fillStyle = '#c9ad7d'; x.fillRect(0, 0, H, H);
  for (let y = 0; y < H; y += 4) for (let xx = 0; xx < H; xx += 4) {
    const l = ((xx + y) / 4) % 2 ? 0.08 : -0.06;
    x.fillStyle = l > 0 ? `rgba(255,240,210,${l + R() * 0.05})` : `rgba(90,65,35,${-l + R() * 0.05})`;
    x.fillRect(xx, y, 4, 4);
  }
  x.strokeStyle = '#8a6a42'; x.lineWidth = 14; x.strokeRect(10, 10, H - 20, H - 20);
  x.strokeStyle = '#a4834f'; x.lineWidth = 4; x.strokeRect(30, 30, H - 60, H - 60);
  // dhurries: flat-woven stripes with a small zig-zag band
  const dhurrie = (ox, oy, base, stripes) => {
    x.fillStyle = base; x.fillRect(ox, oy, H, H);
    let y = 0;
    for (const [col, w] of stripes) { x.fillStyle = col; x.fillRect(ox, oy + y, H, w); x.fillRect(ox, oy + H - y - w, H, w); y += w; }
    for (let yy = 0; yy < H; yy += 3) { x.fillStyle = `rgba(0,0,0,${R() * 0.05})`; x.fillRect(ox, oy + yy, H, 1); }
    x.fillStyle = stripes[1][0];
    for (let xx = 0; xx < H; xx += 24) {                 // zig-zag band in the middle
      x.beginPath(); x.moveTo(ox + xx, oy + 250); x.lineTo(ox + xx + 12, oy + 238); x.lineTo(ox + xx + 24, oy + 250);
      x.lineTo(ox + xx + 12, oy + 262); x.closePath(); x.fill();
    }
    for (let yy = 0; yy < H; yy += 2) for (let xx = 0; xx < H; xx += 6) {
      x.fillStyle = `rgba(255,255,255,${R() * 0.05})`; x.fillRect(ox + xx, oy + yy, 3, 1);
    }
  };
  dhurrie(H, 0, '#e7d7b0', [['#b8195a', 22], ['#e9a21a', 40], ['#e7d7b0', 24], ['#d98b12', 60], ['#e7d7b0', 40], ['#e9a21a', 30], ['#e7d7b0', 70]]);
  dhurrie(H, H, '#ece2c6', [['#e0761a', 20], ['#4d7a2e', 46], ['#ece2c6', 30], ['#6f9a3a', 34], ['#ece2c6', 60], ['#c21f63', 14], ['#ece2c6', 100]]);
  // rangoli: flower-petal rings, transparent outside
  x.clearRect(0, H, H, H);
  const cx = H / 2, cy = H + H / 2;
  const ring = (r, n, len, wid, col, rot = 0) => {
    x.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rot;
      x.save(); x.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r); x.rotate(a);
      x.beginPath(); x.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2); x.fill(); x.restore();
    }
  };
  const disc = (r, col) => { x.fillStyle = col; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); };
  disc(246, '#e8820f');
  for (let i = 0; i < 900; i++) {                        // loose marigold petals texture
    const a = R() * Math.PI * 2, r = 200 + R() * 46;
    x.fillStyle = R() < 0.5 ? '#f5a312' : '#d86a08';
    x.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3, 3);
  }
  disc(200, '#f4c41c');
  ring(200, 36, 22, 10, '#f0ead8');
  disc(176, '#c2185b');
  ring(176, 28, 20, 12, '#e84d8a', 0.05);
  disc(150, '#3f7a2a');
  ring(146, 16, 34, 13, '#6ea83a', 0.2);
  disc(112, '#f6b818');
  ring(110, 24, 14, 8, '#fff6dc');
  disc(84, '#e0620c');
  ring(62, 12, 26, 12, '#f7d23a', 0.13);
  disc(34, '#b8124e');
  disc(14, '#fff2c4');
  return tex(c, true, false);
}

// block-printed cotton for gaddis and bolsters (2 x 2 atlas):
// mustard | fuchsia / leaf green | ivory
const PRINTS = [
  ['#d8961c', '#8e2a14', '#f3dca0'], ['#b8175a', '#f0b832', '#f7c6d8'],
  ['#4b7a2b', '#f1e3b8', '#e58a1a'], ['#efe2c2', '#c2185b', '#5f8f34']
];
function printTex(R) {
  const c = mkCanvas(512), x = c.getContext('2d');
  PRINTS.forEach(([base, ink, ink2], i) => {
    const ox = (i % 2) * 256, oy = (i >> 1) * 256;
    x.fillStyle = base; x.fillRect(ox, oy, 256, 256);
    for (let yy = 0; yy < 256; yy += 2) { x.fillStyle = `rgba(0,0,0,${R() * 0.04})`; x.fillRect(ox, oy + yy, 256, 1); }
    // borders top and bottom
    for (const by of [8, 232]) {
      x.fillStyle = ink; x.fillRect(ox, oy + by, 256, 16);
      x.fillStyle = ink2;
      for (let xx = 4; xx < 256; xx += 12) { x.beginPath(); x.arc(ox + xx, oy + by + 8, 3, 0, Math.PI * 2); x.fill(); }
    }
    // buti: small four-petal flowers in a half-drop grid
    for (let r = 0; r < 8; r++) for (let k = 0; k < 9; k++) {
      const px = ox + 8 + k * 30 + (r % 2) * 15, py = oy + 38 + r * 24;
      if (px > ox + 250) continue;
      x.fillStyle = ink;
      for (let a = 0; a < 4; a++) { x.beginPath(); x.ellipse(px + Math.cos(a * 1.571) * 3.5, py + Math.sin(a * 1.571) * 3.5, 3, 2, a * 1.571, 0, 7); x.fill(); }
      x.fillStyle = ink2; x.beginPath(); x.arc(px, py, 1.8, 0, 7); x.fill();
    }
  });
  return tex(c, true, false);
}
// uv window for print i (small inset to avoid mip bleed)
const printUV = i => [0.48, 0.48, (i % 2) * 0.5 + 0.01, (i >> 1) ? 0.01 : 0.51];
// leaves atlas 256 x 512: left half a banana blade (length along v, torn slits cut
// out of the edges), right half a glossy mango leaf on transparent
function leafTex(R) {
  const c = mkCanvas(256, 512), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, '#8a9a3a'); g.addColorStop(0.12, '#7fae45'); g.addColorStop(0.46, '#6ea23c');
  g.addColorStop(0.5, '#c9d98a'); g.addColorStop(0.54, '#6ea23c'); g.addColorStop(0.88, '#7fae45'); g.addColorStop(1, '#9a9a40');
  x.fillStyle = g; x.fillRect(0, 0, 128, 512);
  for (let y = -40; y < 560; y += 3) {                     // fine parallel lateral veins
    x.strokeStyle = `rgba(${R() < 0.5 ? '40,80,20' : '210,235,160'},${0.08 + R() * 0.08})`; x.lineWidth = 1;
    x.beginPath(); x.moveTo(64, y); x.lineTo(0, y + 26); x.moveTo(64, y); x.lineTo(128, y + 26); x.stroke();
  }
  x.globalCompositeOperation = 'destination-out';          // wind tears from the edges
  for (let k = 0; k < 26; k++) {
    const y = 40 + R() * 470, side = R() < 0.5 ? 0 : 1, d = 20 + R() * 40;
    x.beginPath();
    if (side === 0) { x.moveTo(0, y); x.lineTo(d, y + d * 0.42); x.lineTo(0, y + 2.5); }
    else { x.moveTo(128, y); x.lineTo(128 - d, y + d * 0.42); x.lineTo(128, y + 2.5); }
    x.fill();
  }
  x.globalCompositeOperation = 'source-over';
  // mango leaf: lanceolate, dark glossy green, pale midrib
  x.save(); x.translate(192, 0);
  x.fillStyle = '#3f7d26';
  x.beginPath(); x.moveTo(0, 500);
  x.bezierCurveTo(46, 420, 50, 160, 0, 8); x.bezierCurveTo(-50, 160, -46, 420, 0, 500); x.fill();
  const mg = x.createLinearGradient(-40, 0, 40, 0);
  mg.addColorStop(0, 'rgba(20,50,10,0.35)'); mg.addColorStop(0.5, 'rgba(160,210,110,0.25)'); mg.addColorStop(1, 'rgba(20,50,10,0.35)');
  x.globalCompositeOperation = 'source-atop'; x.fillStyle = mg; x.fillRect(-64, 0, 128, 512);
  x.strokeStyle = 'rgba(200,225,140,0.8)'; x.lineWidth = 3; x.beginPath(); x.moveTo(0, 500); x.lineTo(0, 10); x.stroke();
  x.globalCompositeOperation = 'source-over'; x.restore();
  return tex(c, true, false);
}
// marigold heads for strings and ropes: 128 px tile = 2 x 2 flowers in a half-drop,
// greyscale (tinted by vertex colour), each a shaded pompom of ruffled petals
function pompomTex(R) {
  const c = mkCanvas(128), x = c.getContext('2d');
  x.fillStyle = '#a8a8a8'; x.fillRect(0, 0, 128, 128);
  const head = (cx, cy) => {
    for (const [ox, oy] of [[0, 0], [128, 0], [-128, 0], [0, 128], [0, -128]]) {
      const g = x.createRadialGradient(cx + ox - 6, cy + oy - 6, 2, cx + ox, cy + oy, 34);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.65, '#f2f2f2'); g.addColorStop(1, '#b4b4b4');
      x.fillStyle = g; x.beginPath(); x.arc(cx + ox, cy + oy, 33, 0, 7); x.fill();
    }
    for (let i = 0; i < 70; i++) {                     // ruffled petal edges
      const a = R() * 7, r = R() * 30, l = 170 + R() * 60 | 0;
      x.strokeStyle = `rgba(${l},${l},${l},0.5)`; x.lineWidth = 1.5;
      x.beginPath(); x.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3 + R() * 3, a, a + 2.2); x.stroke();
    }
  };
  head(32, 32); head(96, 96); head(96, 32); head(32, 96);
  return tex(c);
}
// court pavers: 512 px = 2 m of handmade terracotta / laterite in a basket weave
// (0.25 m cells of two 0.25 x 0.125 bricks, alternating direction), sand-grout joints
function paverTex(R) {
  const c = mkCanvas(512), x = c.getContext('2d'), P = 64;
  x.fillStyle = '#a88f72'; x.fillRect(0, 0, 512, 512);
  const brick = (bx, by, w, h) => {
    const r = 150 + R() * 42, g = r * (0.46 + R() * 0.1), b = r * (0.3 + R() * 0.07);
    x.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`; x.fillRect(bx + 1.5, by + 1.5, w - 3, h - 3);
    for (let k = 0; k < 26; k++) {                                   // pores and fired speckle
      const d = R() < 0.6;
      x.fillStyle = d ? `rgba(60,25,10,${0.12 + R() * 0.2})` : `rgba(235,190,140,${0.1 + R() * 0.15})`;
      x.fillRect(bx + 2 + R() * (w - 5), by + 2 + R() * (h - 5), 1 + R() * 2, 1 + R() * 1.6);
    }
    const gr = x.createLinearGradient(bx, by, bx + w, by + h);        // slight worn crown
    gr.addColorStop(0, 'rgba(255,220,180,0.08)'); gr.addColorStop(1, 'rgba(40,15,5,0.1)');
    x.fillStyle = gr; x.fillRect(bx + 1.5, by + 1.5, w - 3, h - 3);
  };
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const ox = i * P, oy = j * P;
    if ((i + j) % 2) { brick(ox, oy, P, P / 2); brick(ox, oy + P / 2, P, P / 2); }
    else { brick(ox, oy, P / 2, P); brick(ox + P / 2, oy, P / 2, P); }
  }
  return tex(c);
}
// dressed stone (greyscale, tinted by vertex colour): sandstone border, laterite plinth
function stoneTex(R) {
  const c = mkCanvas(256), x = c.getContext('2d');
  x.fillStyle = '#e6e6e6'; x.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 2600; k++) {
    const l = 170 + R() * 85 | 0;
    x.fillStyle = `rgba(${l},${l},${l},${0.25 + R() * 0.35})`;
    x.fillRect(R() * 256, R() * 256, 1 + R() * 3, 1 + R() * 2);
  }
  for (let y = 0; y < 256; y += 64) {                                 // coursed joints every 0.5 m
    x.fillStyle = 'rgba(80,70,60,0.45)'; x.fillRect(0, y, 256, 2);
    for (let xx = (y / 64) % 2 ? 64 : 0; xx < 256; xx += 128) x.fillRect(xx, y, 2, 64);
  }
  return tex(c);
}
const rugUV = printUV;   // same 2 x 2 atlas layout: 0 jute, 1 mustard dhurrie, 2 rangoli, 3 green dhurrie

/* ------------------------------------------------------------ colours */
const C = {
  deck: 0xe9e2d4, deckOld: 0xc9c0ae, post: 0xa89c88, bamboo: 0xd4b77a, bambooDk: 0xb08f55,
  teak: 0xa0683a, terracotta: 0xb65a34, coconut: 0x6b4a2a, sandstone: 0xd89c34, laterite: 0x9a5236,
  yellow: 0xf6c21c, mustard: 0xdc9812, saffron: 0xee8a12, sheer: 0xfff0b0, pink: 0xd8246e,
  turmeric: 0xe8a30c, water: 0x4d7470, brass: 0xd0a24a,
  leaf: 0xf2f6e8, leafLt: 0xffffff, mango: 0x2f6b24
};
const BEAD = [0xe8700a, 0xf39a0c, 0xf6bf1a, 0xfad54a, 0xd8246e, 0xfff4dc, 0x4f8a2a];  // orange .. yellow, pink, jasmine, leaf

export default {
  id: 'cove',
  build(ctx) {
    const { path, world, quality } = ctx;
    const K = TIER[quality.tier] ?? 1;
    const R = makeRng('haldi-morning');
    const E0 = EVENTS.haldi, s0 = E0.s, latMid = (E0.lat[0] + E0.lat[1]) / 2;
    const HX = (E0.lat[0] - E0.lat[1]) / 2, HZ = E0.len / 2;           // 6.8 x 13 half extents
    const group = new THREE.Group();
    group.name = 'event-haldi';
    const origin = path.toWorld(s0, latMid);
    // deck top: clear of the highest ground on the footprint, never above the road
    let gMax = -1e9;
    for (let ds = -HZ; ds <= HZ; ds += 2) for (let l = E0.lat[0]; l >= E0.lat[1]; l -= 1.5) gMax = Math.max(gMax, world.heightSL(s0 + ds, l));
    const Y0 = Math.min(path.roadY(s0) - 0.04, Math.max(path.roadY(s0) - 0.35, gMax + 0.07));
    group.position.set(origin.x, Y0, origin.z);
    group.rotation.y = path.sample(s0).heading;
    const ground = (x, z) => world.heightSL(s0 - z, latMid + x) - Y0;   // local ground height
    group.updateMatrixWorld(true);
    const CO = COURTS.haldi, ROUTE = STOP.haldi.route;
    // road coords -> scene-local point (y given in world units)
    const L = (s, lat, y) => { const w = path.toWorld(s, lat); w.y = y; return group.worldToLocal(w); };
    const AX = -11 - latMid, AZ = HZ;                                   // arch: deck near end, lat -11, facing the court

    const WOOD = [], RUG = [], GAD = [], FAB = [], SHE = [], BR = [], LF = [], CRT = [], CST = [];
    const beads = [];   // [x, y, z, colourIndex, scale]
    const bead = (x, y, z, ci, s = 1) => beads.push(x, y, z, ci, s);

    /* ---------------- deck: slab, fascia, joists, posts, railing */
    WOOD.push(box(HX * 2, 0.12, HZ * 2, 0, -0.06, 0, C.deck, [HX, HZ]));
    for (const sx of [-1, 1]) {
      WOOD.push(box(0.05, 0.32, HZ * 2 + 0.1, sx * (HX + 0.025), -0.16, 0, C.deckOld, [0.2, 6]));
      WOOD.push(box(HX * 2, 0.32, 0.05, 0, -0.16, sx * (HZ + 0.025), C.deckOld, [3, 0.2]));
    }
    const nx = 7, nz = 11;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = -HX + 0.25 + i * (HX * 2 - 0.5) / (nx - 1), z = -HZ + 0.25 + j * (HZ * 2 - 0.5) / (nz - 1);
      const g = ground(x, z) - 0.3;
      if (g > -0.35) continue;
      const h = -0.3 - g;
      WOOD.push(box(0.2, h, 0.2, x, -0.3 - h / 2, z, C.post, [0.1, h / 2]));
      if (j === 0) WOOD.push(box(0.12, 0.22, HZ * 2, x, -0.36, 0, C.post, [0.1, 6]));   // bearers along z
    }
    // sea side and end railing: square posts, top rail and a mid rail
    const railRun = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 1.6));
      const ry = Math.atan2(bx - ax, bz - az);
      for (let k = 0; k <= n; k++) {
        const t = k / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        WOOD.push(box(0.09, 0.95, 0.09, x, 0.475, z, C.deck, [0.1, 0.5]));
      }
      for (const [y, h, w] of [[0.97, 0.05, 0.14], [0.5, 0.05, 0.05]])
        WOOD.push(box(w, h, len, (ax + bx) / 2, y, (az + bz) / 2, C.deck, [0.1, len / 2], ry));
    };
    railRun(-HX + 0.05, -HZ + 0.05, -HX + 0.05, HZ - 0.05);
    railRun(-HX + 0.05, -HZ + 0.05, HX - 0.05, -HZ + 0.05);
    railRun(-HX + 0.05, HZ - 0.05, AX - 1.55, HZ - 0.05);             // near end, open for the arch
    railRun(AX + 1.55, HZ - 0.05, HX - 0.05, HZ - 0.05);
    railRun(HX - 0.05, -HZ + 0.05, HX - 0.05, HZ - 0.05);               // road side

    /* ---------------- entrance: bamboo arch across the deck's near end, facing the court */
    const AW = 1.4, archZ = AZ - 0.12, archH = 2.75, archPts = [];
    for (let k = 0; k <= 16; k++) {
      const a = Math.PI * (k / 16);
      archPts.push(new THREE.Vector3(AX - Math.cos(a) * AW, archH + Math.sin(a) * 0.55, archZ));
    }
    for (const sx of [-1, 1]) WOOD.push(rod(new THREE.Vector3(AX + sx * AW, -0.02, archZ), new THREE.Vector3(AX + sx * AW, archH, archZ), 0.07, 8, C.bamboo));
    for (let k = 0; k < 16; k++) WOOD.push(rod(archPts[k], archPts[k + 1], 0.06, 7, C.bamboo));

    /* ---------------- mandap: four bamboo posts, beams, draped canopy */
    const MX0 = -0.9, MX1 = -5.5, MZ = 2.4, MH = 3.3, MXC = (MX0 + MX1) / 2;
    const corners = [[MX0, -MZ], [MX0, MZ], [MX1, -MZ], [MX1, MZ]];
    for (const [x, z] of corners) {
      WOOD.push(rod(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, MH + 0.15, z), 0.085, 10, C.bamboo));
      if (K >= 0.6) for (let y = 0.4; y < MH; y += 0.45) WOOD.push(cyl(0.092, 0.092, 0.03, 10, x, y, z, C.bambooDk));   // bamboo nodes
      BR.push(cyl(0.13, 0.15, 0.16, 12, x, 0.08, z, C.brass));
      BR.push(part(place(new THREE.SphereGeometry(0.09, 10, 6), x, MH + 0.24, z), C.brass));
    }
    const beam = (ax, az, bx, bz) => WOOD.push(rod(new THREE.Vector3(ax, MH, az), new THREE.Vector3(bx, MH, bz), 0.065, 8, C.bamboo));
    beam(MX0, -MZ, MX0, MZ); beam(MX1, -MZ, MX1, MZ); beam(MX0, -MZ, MX1, -MZ); beam(MX0, MZ, MX1, MZ);

    // ceiling: alternating yellow / mustard panels running front-to-back, each sagging
    const sagPanel = (x0, x1, z0, z1, y, sag, color, list, ruche = 0.05) => {
      const nu = 12, nv = 4, g = new THREE.PlaneGeometry(1, 1, nu, nv), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i) + 0.5, v = p.getY(i) + 0.5;
        p.setXYZ(i, x0 + (x1 - x0) * u, y - sag * Math.sin(Math.PI * u) - ruche * Math.sin(Math.PI * v) * Math.sin(Math.PI * u), z0 + (z1 - z0) * v);
      }
      g.computeVertexNormals();
      list.push(part(g, color));
    };
    const NP = 6;
    for (let k = 0; k < NP; k++) {
      const z0 = -MZ + (k / NP) * MZ * 2, z1 = -MZ + ((k + 1) / NP) * MZ * 2;
      sagPanel(MX0, MX1, z0, z1, MH + 0.02, 0.42 + (k % 2) * 0.06, k % 2 ? C.mustard : C.yellow, FAB);
    }
    sagPanel(MX0 - 0.1, MX1 + 0.1, -MZ + 0.1, MZ - 0.1, MH - 0.04, 0.62, C.sheer, SHE, 0.1);   // sheer inner layer

    // swag valance: scalloped fabric hanging along an edge, pushed a little outward
    const swag = (ax, az, bx, bz, nx, nz, n, depth, y, color, list, bulge = 0.08) => {
      const nu = n * 8, nr = 3, pos = [], idx = [];
      for (let i = 0; i <= nu; i++) {
        const t = i / nu, sc = Math.sin(Math.PI * ((t * n) % 1 || (i === nu ? 0 : 0)));
        const d = 0.12 + depth * Math.abs(Math.sin(Math.PI * t * n));
        for (let r = 0; r <= nr; r++) {
          const q = r / nr, o = bulge * Math.sin(Math.PI * q) * (0.4 + Math.abs(Math.sin(Math.PI * t * n)));
          pos.push(ax + (bx - ax) * t + nx * o, y - d * q, az + (bz - az) * t + nz * o);
        }
      }
      for (let i = 0; i < nu; i++) for (let r = 0; r < nr; r++) {
        const a = i * (nr + 1) + r, b = a + nr + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      list.push(part(g, color));
    };
    const edges = [
      [MX0, -MZ, MX0, MZ, 1, 0], [MX1, MZ, MX1, -MZ, -1, 0],
      [MX0, MZ, MX1, MZ, 0, 1], [MX1, -MZ, MX0, -MZ, 0, -1]
    ];
    for (const [ax, az, bx, bz, ex, ez] of edges) {
      swag(ax + ex * 0.04, az + ez * 0.04, bx + ex * 0.04, bz + ez * 0.04, ex, ez, 3, 0.38, MH + 0.06, C.yellow, FAB);
      swag(ax + ex * 0.1, az + ez * 0.1, bx + ex * 0.1, bz + ez * 0.1, ex, ez, 2, 0.3, MH + 0.1, C.mustard, FAB, 0.12);
      swag(ax + ex * 0.13, az + ez * 0.13, bx + ex * 0.13, bz + ez * 0.13, ex, ez, 4, 0.2, MH + 0.12, C.sheer, SHE, 0.1);
    }
    // sheer corner drapes: gathered to the post with a marigold tie-back at 1.2 m
    const drape = (px, pz, dx, dz, color, list) => {
      const nu = K >= 1 ? 14 : 8, nv = K >= 1 ? 18 : 10, pos = [], idx = [];
      for (let j = 0; j <= nv; j++) {
        const v = j / nv, y = MH * (1 - v);
        const tie = Math.abs(y - 1.2);
        const w = 0.12 + (y > 1.2 ? Math.min(0.75, tie * 0.42) : Math.min(0.4, tie * 0.35));
        for (let i = 0; i <= nu; i++) {
          const u = i / nu, pleat = 0.05 * Math.sin(u * Math.PI * 7) * (w / 0.8);
          pos.push(px + dx * u * w - dz * pleat, y, pz + dz * u * w + dx * pleat);
        }
      }
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const a = j * (nu + 1) + i, b = a + nu + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      list.push(part(g, color));
    };
    for (const [x, z] of corners) {
      const inx = x === MX0 ? -1 : 1;                 // along the side, toward the other post
      drape(x, z - Math.sign(z) * 0.1, inx, 0, C.sheer, SHE);
      for (let a = 0; a < 14; a++) bead(x + Math.cos(a / 14 * 6.283) * 0.14, 1.2, z + Math.sin(a / 14 * 6.283) * 0.14, a % 2 ? 0 : 2, 1.1);
    }

    /* ---------------- marigold strings, toran, garlands */
    // strings and ropes are textured tubes (a pompom texture, tinted per piece), not beads:
    // continuous like real laris, and a string costs 12 triangles whatever its length
    const MR = [], FL = 0.132;                            // one texture tile = two flowers
    const ORANGE = [0xf28a12, 0xf59a1a], YELLOW = [0xf8c420, 0xfad640];
    const string = (x, z, yTop, len, k) => {
      const r = 0.03, around = 2 * Math.PI * r / FL;
      let y = yTop, left = len, seg = 0;
      const two = k % 4 === 3;                            // most strings one colour, some alternate
      while (left > 0.05) {
        const l = two ? Math.min(left, 0.3 + R() * 0.3) : left;
        const col = (two ? (seg % 2 ? ORANGE : YELLOW) : k % 2 ? ORANGE : YELLOW)[R() < 0.5 ? 0 : 1];
        MR.push(part(place(new THREE.CylinderGeometry(r, r, l, 6, 1, true), x, y - l / 2, z, 0, R() * 3), col, [around, l / FL, R(), 0]));
        y -= l; left -= l; seg++;
      }
      bead(x, y - 0.02, z, k % 3 ? 4 : 5, 1.25);           // a rose or jasmine tassel at the end
    };
    const tube = (pts, r, color, closed = false) => {
      const curve = new THREE.CatmullRomCurve3(pts, closed), len = curve.getLength();
      const g = new THREE.TubeGeometry(curve, Math.max(4, Math.round(len / 0.1)), r, 6, closed);
      MR.push(part(g, color, [len / FL, 2 * Math.PI * r / FL]));
    };
    const strSp = 0.12 / Math.sqrt(K);
    // back: a full curtain framing the sea view, longest at the ends
    for (let z = -MZ + 0.08, k = 0; z <= MZ - 0.08; z += strSp, k++) {
      const e = Math.abs(z) / MZ;
      string(MX1 - 0.14, z, MH - 0.05, 1.3 + 1.1 * e * e, k);
    }
    // sides: a mid-length curtain
    for (const sz of [-1, 1]) for (let x = MX1 + 0.15, k = 0; x <= MX0 - 0.15; x += strSp, k++) {
      const e = Math.abs(x - MXC) / (MX0 - MXC);
      string(x, sz * (MZ + 0.14), MH - 0.05, 0.9 + 0.7 * e * e, k);
    }
    // front: short strings under the swag
    for (let z = -MZ + 0.1, k = 0; z <= MZ - 0.1; z += strSp * 1.4, k++) string(MX0 + 0.16, z, MH - 0.2, 0.35 + 0.25 * Math.abs(Math.sin(z * 2)), k);

    // mango-leaf toran across the front beam, with marigolds between the leaves
    const leafQuad = (x, y, z, len, wid, rotY, tilt, color, list) => {
      // a lanceolate leaf with a slight midrib fold: 4 triangles
      const g = new THREE.BufferGeometry();
      const p = [0, 0, 0, -wid / 2, -len * 0.4, 0.02, 0, -len * 0.45, -0.015, wid / 2, -len * 0.4, 0.02, 0, -len, 0];
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0.75, 1, 0.5, 0.6, 0.75, 0.55, 1, 0.6, 0.75, 0], 2));
      g.setIndex([0, 1, 2, 0, 2, 3, 1, 4, 2, 2, 4, 3]); g.computeVertexNormals();
      list.push(part(place(g, x, y, z, tilt, rotY, 0), color));
    };
    const toran = (x0, z0, x1, z1, y, lenL, ry) => {
      const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.1);
      for (let i = 0; i <= n; i++) {
        const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n, sag = 0.08 * Math.sin(Math.PI * i / n);
        leafQuad(x, y - sag, z, lenL * (0.85 + R() * 0.3), 0.1, ry + (R() - 0.5) * 0.3, (R() - 0.5) * 0.25, R() < 0.5 ? 0xffffff : 0xd8e4c8, LF);
        bead(x + 0.02 * Math.sin(ry), y - sag - 0.01, z + 0.02 * Math.cos(ry), i % 2 ? 0 : 2, 1.2);
      }
    };
    toran(MX0 + 0.2, -MZ + 0.1, MX0 + 0.2, MZ - 0.1, MH - 0.02, 0.24, Math.PI / 2);
    // posts wrapped in a marigold spiral
    for (const [x, z] of corners) {
      const pts = [];
      for (let y = 0.15, a = 0; y < MH; y += 0.04, a += 0.5) pts.push(new THREE.Vector3(x + Math.cos(a) * 0.12, y, z + Math.sin(a) * 0.12));
      tube(pts, 0.032, 0xf28a12);
    }
    // thick garland: an orange rope with a yellow rope wound round it
    const rope = (pts, r, cA, cB) => {
      const curve = new THREE.CatmullRomCurve3(pts), len = curve.getLength(), n = Math.round(len / 0.05), wound = [];
      tube(pts, r, cA);
      const fr = new THREE.CatmullRomCurve3(pts).computeFrenetFrames(n, false);
      for (let i = 0; i <= n; i++) {
        const P = curve.getPointAt(i / n), a = i * 0.9, N = fr.normals[i], B = fr.binormals[i];
        wound.push(P.clone().addScaledVector(N, Math.cos(a) * r * 0.95).addScaledVector(B, Math.sin(a) * r * 0.95));
      }
      tube(wound, r * 0.5, cB);
    };
    // arch: garland up the posts and over the curved head, a toran under the head
    const archRope = [new THREE.Vector3(AX - AW, 0.2, archZ), new THREE.Vector3(AX - AW, archH * 0.5, archZ), ...archPts.slice(1, -1).map(p => p.clone()),
      new THREE.Vector3(AX + AW, archH * 0.5, archZ), new THREE.Vector3(AX + AW, 0.2, archZ)];
    archRope[2].y -= 0.03; archRope[archRope.length - 3].y -= 0.03;
    rope(archRope, 0.1, 0xee7d0c, 0xf7c21c);
    toran(AX - AW + 0.14, archZ + 0.12, AX + AW - 0.14, archZ + 0.12, archH - 0.04, 0.2, 0);
    for (let x = -AW + 0.22, k = 0; x <= AW - 0.2; x += 0.2, k++) string(AX + x, archZ - 0.02, archH - 0.12, 0.35 + 0.35 * Math.sin(Math.PI * (x + AW) / (2 * AW)), k);
    // festoons along the sea-side railing
    const fStep = 1.6 * (K < 0.5 ? 2 : 1);
    for (let z = -HZ + 0.1; z < HZ - 1; z += fStep) {
      const z1 = Math.min(z + fStep, HZ - 0.1), pts = [];
      for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector3(-HX + 0.12, 0.98 - 0.28 * Math.sin(Math.PI * t), z + (z1 - z) * t)); }
      tube(pts, 0.035, (z / fStep | 0) % 2 ? 0xf08a0c : 0xf6bf1a);
    }

    /* ---------------- rugs and rangoli */
    const rug = (w, d, x, z, cell, y = 0.006) =>
      RUG.push(part(place(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), x, y, z), 0xffffff, rugUV(cell)));
    for (let x = 6.0; x > -0.4; x -= 1.45) rug(1.44, 1.3, x, 0, 0);                    // jute runner up the aisle
    for (let z = AZ - 0.75; z > 5.6; z -= 1.3) rug(1.2, 1.28, AX, z, 0);               // and in from the arch
    rug(4.2, 4.4, MXC, 0, 1, 0.009);                                                   // mandap dhurrie
    rug(1.5, 1.5, -2.15, 0, 2, 0.016);                                                 // rangoli
    for (const sz of [-1, 1]) {
      for (let x = 4.3; x > -1; x -= 1.95) rug(1.9, 1.9, x, sz * 4.25, 0, 0.004);      // jute under the U arms
      rug(1.9, 2.8, 5.3, sz * 2.45, 3, 0.008);
    }

    /* ---------------- seating: printed gaddis and bolsters in a U */
    const gaddi = (w, d, x, z, ry, print) => {
      const g = new THREE.BoxGeometry(w, 0.14, d, 6, 1, 3), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) {
        const u = 2 * p.getX(i) / w, v = 2 * p.getZ(i) / d;
        p.setY(i, p.getY(i) + 0.035 * (1 - u * u) * (1 - v * v));
      }
      g.computeVertexNormals();
      GAD.push(part(place(g, x, 0.075, z, 0, ry), 0xffffff, printUV(print)));
    };
    const bolster = (len, r, x, y, z, ry, print) => {
      const g = new THREE.CylinderGeometry(r, r, len, 14, 1).rotateZ(Math.PI / 2), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {          // soft ends
        const e = Math.abs(p.getX(i)) / (len / 2);
        if (e > 0.99) { p.setY(i, p.getY(i) * 0.85); p.setZ(i, p.getZ(i) * 0.85); }
      }
      g.computeVertexNormals();
      GAD.push(part(place(g, x, y, z, 0, ry), 0xffffff, printUV(print)));
    };
    const cushion = (x, z, ry, print) => {
      const g = new THREE.BoxGeometry(0.42, 0.42, 0.12, 3, 3, 1), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = 2 * p.getX(i) / 0.42, v = 2 * p.getY(i) / 0.42;
        p.setZ(i, p.getZ(i) * (1 - 0.6 * u * u * v * v) * (1 + 0.3 * (1 - u * u) * (1 - v * v)));
      }
      g.computeVertexNormals();
      GAD.push(part(place(g, x, 0.36, z, -0.35, ry, 0), 0xffffff, printUV(print)));
    };
    const seatP = [0, 1, 2, 1, 0, 2];
    for (const sz of [-1, 1]) {
      [4.3, 2.35, 0.4].forEach((x, i) => {
        const pr = seatP[i + (sz > 0 ? 3 : 0)];
        gaddi(1.8, 0.78, x, sz * 4.2, 0, pr);
        bolster(1.72, 0.13, x, 0.27, sz * 4.52, 0, pr === 1 ? 2 : 1);
        cushion(x - 0.45, sz * 4.36, sz > 0 ? Math.PI : 0, 3);
        cushion(x + 0.45, sz * 4.36, sz > 0 ? Math.PI : 0, pr === 0 ? 1 : 0);
      });
      gaddi(1.8, 0.78, 5.35, sz * 2.45, Math.PI / 2, sz > 0 ? 1 : 2);
      bolster(1.72, 0.13, 5.67, 0.27, sz * 2.45, Math.PI / 2, 0);
      cushion(5.5, sz * 2.45, -Math.PI / 2, 3);
    }

    /* ---------------- couple's chowki with brass urli, lamp and turmeric bowls */
    const CX = -3.75;
    WOOD.push(box(0.8, 0.08, 1.5, CX, 0.3, 0, C.teak, [0.4, 0.8]));
    WOOD.push(box(0.72, 0.1, 1.42, CX, 0.21, 0, 0x8a5530, [0.4, 0.8]));
    for (const [lx, lz] of [[-0.34, -0.68], [-0.34, 0.68], [0.34, -0.68], [0.34, 0.68]])
      WOOD.push(cyl(0.045, 0.035, 0.2, 8, CX + lx, 0.1, lz, C.teak));
    GAD.push(part(place(new THREE.BoxGeometry(0.72, 0.06, 1.4), CX, 0.37, 0), 0xffffff, printUV(0)));
    bolster(1.36, 0.12, CX - 0.3, 0.52, 0, Math.PI / 2, 1);
    const lathe = (prof, seg, x, y, z, color, list = BR) =>
      list.push(part(place(new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(r, h)), seg), x, y, z), color));
    // urli: wide shallow brass bowl with water and floating flowers
    const UX = -2.7, UZ = 1.35;
    lathe([[0, 0], [0.18, 0], [0.2, 0.03], [0.34, 0.08], [0.44, 0.15], [0.47, 0.18], [0.45, 0.185], [0.41, 0.15], [0.3, 0.09], [0, 0.06]], 28, UX, 0, UZ, C.brass);
    BR.push(part(place(new THREE.CircleGeometry(0.43, 24).rotateX(-Math.PI / 2), UX, 0.155, UZ), C.water));
    for (let i = 0; i < 16; i++) {
      const a = i * 2.4, r = 0.08 + 0.28 * Math.sqrt((i + 0.5) / 16);
      bead(UX + Math.cos(a) * r, 0.165, UZ + Math.sin(a) * r, i % 3 === 0 ? 4 : i % 3 === 1 ? 2 : 0, 1.7);
    }
    // turmeric: brass thali with three small bowls of paste
    const TX = -2.7, TZ = -1.3;
    BR.push(cyl(0.3, 0.29, 0.025, 28, TX, 0.013, TZ, C.brass));
    for (let i = 0; i < 3; i++) {
      const bx = TX + Math.cos(i * 2.09) * 0.15, bz = TZ + Math.sin(i * 2.09) * 0.15;
      lathe([[0, 0], [0.05, 0], [0.085, 0.04], [0.095, 0.07], [0.085, 0.07], [0, 0.03]], 16, bx, 0.025, bz, C.brass);
      FAB.push(part(place(new THREE.CircleGeometry(0.08, 14).rotateX(-Math.PI / 2), bx, 0.085, bz), i === 2 ? 0xc6202a : C.turmeric));
    }
    // kuthu vilakku: tall brass oil lamp beside the seat
    lathe([[0, 0], [0.2, 0], [0.2, 0.03], [0.1, 0.07], [0.04, 0.12], [0.03, 0.8], [0.05, 0.84], [0.03, 0.88], [0.03, 1.0],
      [0.16, 1.04], [0.17, 1.07], [0.03, 1.08], [0.02, 1.2], [0.05, 1.26], [0, 1.32]], 20, CX - 0.2, 0, -1.25, C.brass);
    lathe([[0, 0], [0.2, 0], [0.2, 0.03], [0.1, 0.07], [0.04, 0.12], [0.03, 0.8], [0.05, 0.84], [0.03, 0.88], [0.03, 1.0],
      [0.16, 1.04], [0.17, 1.07], [0.03, 1.08], [0.02, 1.2], [0.05, 1.26], [0, 1.32]], 20, CX - 0.2, 0, 1.25, C.brass);
    // purna kumbham at the arch foot: brass kalash, coconut and mango leaves
    for (const sz of [-1, 1]) {
      const kx = AX + sz * (AW - 0.05), kz = AZ - 0.55;
      lathe([[0, 0], [0.12, 0], [0.13, 0.03], [0.2, 0.14], [0.21, 0.22], [0.16, 0.34], [0.09, 0.4], [0.12, 0.44], [0.1, 0.45], [0, 0.44]], 20, kx, 0, kz, C.brass);
      WOOD.push(part(place(new THREE.SphereGeometry(0.12, 10, 8), kx, 0.53, kz, 0, 0, 0, 1, 1.25, 1), C.coconut));
      for (let i = 0; i < 7; i++) leafQuad(kx + Math.cos(i * 0.9) * 0.07, 0.49, kz + Math.sin(i * 0.9) * 0.07, 0.26, 0.11, -i * 0.9 + Math.PI / 2, -2.2, 0xffffff, LF);
    }

    /* ---------------- chhatris: fringed Rajasthani umbrellas on tall poles */
    const UH = 3.0, UR = 1.65;
    const canopyY = (r, th) => UH + 0.55 * (1 - r / UR) - 0.07 * (r / UR) * Math.sin(th * 4) ** 2;
    const canopyRing = (ux, uz, r0, r1, color) => {
      const nt = K >= 1 ? 40 : 28, nr = K >= 1 ? 3 : 2, pos = [], idx = [];
      for (let i = 0; i <= nt; i++) for (let j = 0; j <= nr; j++) {
        const th = i / nt * Math.PI * 2, r = r0 + (r1 - r0) * j / nr;
        pos.push(ux + Math.cos(th) * r, canopyY(r, th), uz + Math.sin(th) * r);
      }
      for (let i = 0; i < nt; i++) for (let j = 0; j < nr; j++) {
        const a = i * (nr + 1) + j, b = a + nr + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      FAB.push(part(g, color));
    };
    const chhatri = (ux, uz) => {
      WOOD.push(rod(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(ux, UH + 0.6, uz), 0.04, 8, C.teak));
      BR.push(cyl(0.18, 0.22, 0.22, 16, ux, 0.11, uz, C.brass));
      BR.push(cyl(0.05, 0.05, 0.25, 10, ux, 1.5, uz, C.brass));
      lathe([[0, 0], [0.06, 0], [0.09, 0.06], [0.05, 0.14], [0.02, 0.2], [0.01, 0.34], [0, 0.36]], 12, ux, UH + 0.52, uz, C.brass);
      canopyRing(ux, uz, 0, 1.05, C.yellow);
      canopyRing(ux, uz, 1.05, 1.22, C.saffron);
      canopyRing(ux, uz, 1.22, 1.3, C.pink);
      canopyRing(ux, uz, 1.3, UR, C.yellow);
      // fringe: a scalloped skirt, with a tassel bead at each scallop
      const nt = 64, pos = [], idx = [];
      for (let i = 0; i <= nt; i++) {
        const th = i / nt * Math.PI * 2, y = canopyY(UR, th), d = 0.16 + 0.1 * Math.abs(Math.sin(th * 8));
        pos.push(ux + Math.cos(th) * UR, y + 0.01, uz + Math.sin(th) * UR, ux + Math.cos(th) * (UR + 0.02), y - d, uz + Math.sin(th) * (UR + 0.02));
        if (i < nt) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      FAB.push(part(g, C.saffron));
      for (let i = 0; i < 16; i++) {
        const th = (i + 0.5) / 16 * Math.PI * 2;
        const y = canopyY(UR, th) - 0.27;
        bead(ux + Math.cos(th) * (UR + 0.03), y, uz + Math.sin(th) * (UR + 0.03), 4, 1.2);
        bead(ux + Math.cos(th) * (UR + 0.03), y - 0.07, uz + Math.sin(th) * (UR + 0.03), 2, 1.0);
      }
      // ribs under the canopy
      for (let i = 0; i < 8; i++) {
        const th = i / 8 * Math.PI * 2;
        WOOD.push(rod(new THREE.Vector3(ux, UH + 0.5, uz), new THREE.Vector3(ux + Math.cos(th) * (UR - 0.05), canopyY(UR, th) - 0.03, uz + Math.sin(th) * (UR - 0.05)), 0.012, 4, C.teak));
      }
    };
    const umbrellas = [[5.3, 9.0], [3.9, -9.4], [-3.4, 9.8], [-3.4, -9.8]];
    umbrellas.forEach(([ux, uz], i) => {
      chhatri(ux, uz);
      rug(2.8, 2.8, ux, uz, i % 2 ? 1 : 3, 0.008);
      gaddi(1.6, 0.72, ux + 0.95, uz, Math.PI / 2, i % 3);
      bolster(1.5, 0.12, ux + 1.27, 0.26, uz, Math.PI / 2, (i + 1) % 3);
      gaddi(1.6, 0.72, ux - 0.95, uz, Math.PI / 2, (i + 2) % 3);
      bolster(1.5, 0.12, ux - 1.27, 0.26, uz, Math.PI / 2, i % 3);
      BR.push(cyl(0.26, 0.25, 0.02, 24, ux + 0.35, 0.02, uz + 0.45, C.brass));                // tray with a lota
      lathe([[0, 0], [0.06, 0], [0.1, 0.06], [0.09, 0.12], [0.045, 0.16], [0.055, 0.2], [0, 0.2]], 14, ux + 0.35, 0.03, uz + 0.45, C.brass);
    });

    /* ---------------- banana plants in terracotta pots, and banana-leaf decor */
    const bananaLeaf = (bx, by, bz, ang, L, W, rise, droop, color) => {
      const nt = 10, pos = [], idx = [], uv = [];
      const dx = Math.cos(ang), dz = Math.sin(ang);
      for (let i = 0; i <= nt; i++) {
        const t = i / nt, w = W * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.95)), 0.55) * (t < 0.12 ? t / 0.12 : 1);
        const cx = bx + dx * L * t, cy = by + (rise * t - droop * t * t) * L, cz = bz + dz * L * t;
        const tw = 0.25 * t;                                    // the blade twists as it droops
        for (const s of [-1, 0, 1]) {
          const o = s * w, up = s === 0 ? 0.035 : -Math.abs(o) * 0.12 + s * tw * w * 0.4;
          pos.push(cx - dz * o, cy + up, cz + dx * o); uv.push(0.25 + s * 0.245, t);
        }
      }
      for (let i = 0; i < nt; i++) for (let s = 0; s < 2; s++) {
        const a = i * 3 + s, b = a + 3;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      LF.push(part(g, color));
    };
    const banana = (x, z, h, potted = true, yb = 0, pot = 1) => {
      const y0 = yb + (potted ? 0.5 * pot : 0);
      if (potted) {
        lathe([[0, 0], [0.2, 0], [0.24, 0.05], [0.3, 0.42], [0.33, 0.47], [0.33, 0.52], [0.26, 0.5], [0, 0.46]].map(([r, h]) => [r * pot, h * pot]), 16, x, yb, z, C.terracotta, WOOD);
      }
      LF.push(part(place(new THREE.CylinderGeometry(0.06, 0.1, h, 8, 1, true), x, y0 + h / 2, z), 0xc8d8a0, [0, 0, 0.25, 0.5]));
      const n = Math.round((K < 0.5 ? 4.5 : 6) + R() * 2);
      for (let i = 0; i < n; i++) {
        const a = i * 2.4 + R(), bl = 1.1 + R() * 0.6;
        bananaLeaf(x, y0 + h - 0.05 - R() * 0.2, z, a, bl, 0.2 + R() * 0.06, 0.9 + R() * 0.6, 1.0 + R() * 0.5, R() < 0.5 ? C.leaf : C.leafLt);
      }
    };
    for (const [x, z] of [[-HX + 0.55, HZ - 0.55], [-HX + 0.55, -HZ + 0.55], [HX - 0.55, HZ - 0.55], [HX - 0.55, -HZ + 0.55],
      [MX1 - 0.5, MZ + 0.6], [MX1 - 0.5, -MZ - 0.6], [-HX + 0.6, HZ - 1.6], [-HX + 0.6, -HZ + 1.6]]) banana(x, z, 1.1 + R() * 0.5);
    for (const sx of [-1, 1]) banana(AX + sx * (AW + 0.32), AZ - 0.4, 1.9, true);         // banana stems tied at the arch
    bananaLeaf(TX - 0.4, 0.035, TZ, 0, 0.95, 0.2, 0, 0, 0xe8f0d8);                         // leaf laid under the thali

    /* ---------------- the court: road-level forecourt the car drives into ("Take me here") */
    const c0 = CO.s0, cs1 = CO.s1, SEA = CO.lat[1] ?? -16.5, cY = s => path.roadY(s) + 0.02;
    const ss = u => u * u * (3 - 2 * u);
    // a surface strip between two edges pa(t), pb(t) -> [s, lat], at court height + dy
    const band = (pa, pb, n, dy, color, list, m = 2) => {
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= n; i++) for (const e of [pa(i / n), pb(i / n)]) {
        const p = L(e[0], e[1], cY(e[0]) + dy); pos.push(p.x, p.y, p.z); uv.push(e[1] / m, e[0] / m);
      }
      for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      if (g.attributes.normal.getY(0) < 0) { g.setIndex(idx.map((_, k) => idx[k - k % 3 + [0, 2, 1][k % 3]])); g.computeVertexNormals(); }
      list.push(part(g, color));
    };
    // plinth face: from the paving edge down into the sand along [s, lat] points
    const plinth = pts => {
      const pos = [], uv = [], idx = [];
      let run = 0;
      pts.forEach(([s, lat], i) => {
        if (i) run += Math.hypot(s - pts[i - 1][0], lat - pts[i - 1][1]);
        const top = cY(s), bot = Math.min(top - 0.1, world.heightSL(s, lat) - 0.3);
        const a = L(s, lat, top + 0.03), b = L(s, lat, bot);
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z); uv.push(run / 2, 0, run / 2, (top - bot) / 2);
      });
      for (let i = 0; i < pts.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      CST.push(part(g, C.laterite));
    };
    const line = (sA, latA, sB, latB, n = 12) => Array.from({ length: n + 1 }, (_, i) => [sA + (sB - sA) * i / n, latA + (latB - latA) * i / n]);
    // aprons where the route leaves and rejoins the lane beyond the court's ends
    const apA = s => -3.7 - 3.2 * ss((s - (c0 - 7)) / 7), apB = s => -3.7 - 3.4 * (1 - ss((s - cs1) / 7));
    const paved = [[c0 - 7, c0, apA], [c0, cs1, () => SEA], [cs1, cs1 + 7, apB]];
    for (const [sA, sB, sea] of paved) {
      const n = Math.ceil(sB - sA), nl = Math.max(2, Math.ceil((-3.7 - Math.min(sea(sA), sea(sB))) / 1.6));
      for (let j = 0; j < nl; j++)
        band(t => { const s = sA + (sB - sA) * t; return [s, -3.7 + (sea(s) + 3.7) * j / nl]; },
          t => { const s = sA + (sB - sA) * t; return [s, -3.7 + (sea(s) + 3.7) * (j + 1) / nl]; }, n, 0, 0xffffff, CRT);
      if (sea !== paved[1][2]) plinth(Array.from({ length: n + 1 }, (_, i) => { const s = sA + (sB - sA) * i / n; return [s, sea(s)]; }));
    }
    plinth(line(c0, apA(c0), c0, SEA, 8)); plinth(line(c0, SEA, cs1, SEA, 24)); plinth(line(cs1, SEA, cs1, apB(cs1), 8));
    // marigold-yellow sandstone border on three sides, and two inlay bands leading to the arch
    const BW = 0.5, gold = C.sandstone;
    band(t => [c0 + (cs1 - c0) * t, SEA], t => [c0 + (cs1 - c0) * t, SEA + BW], 24, 0.012, gold, CST);
    band(t => [c0, -3.7 + (SEA + 3.7) * t], t => [c0 + BW, -3.7 + (SEA + 3.7) * t], 6, 0.012, gold, CST);
    band(t => [cs1 - BW, -3.7 + (SEA + 3.7) * t], t => [cs1, -3.7 + (SEA + 3.7) * t], 6, 0.012, gold, CST);
    for (const bl of [-11 - 1.7, -11 + 1.7])
      band(t => [c0 + 16 + (cs1 - BW - c0 - 16) * t, bl - 0.13], t => [c0 + 16 + (cs1 - BW - c0 - 16) * t, bl + 0.13], 4, 0.012, gold, CST);

    /* ---------------- steps from the court down (or up) onto the deck, under the arch */
    {
      const e = L(cs1, -11, cY(cs1)), yc = e.y, zc = e.z;                // court edge, local
      const risers = Math.max(1, Math.round(Math.abs(yc) / 0.16)), T = Math.max(1, risers - 1), d = (zc - AZ) / T;
      for (let k = 0; k < T; k++) {
        const top = risers > 1 ? yc * (1 - (k + 1) / risers) : yc, z = zc - (k + 0.5) * d;
        const gb = Math.min(ground(AX - AW, z), ground(AX + AW, z), top - 0.12) - 0.1;
        CST.push(box(2 * AW + 0.9, top - gb, d + 0.02, AX, (top + gb) / 2, z, C.sandstone, [1.1, 0.3]));
      }
    }

    /* ---------------- court dressing: potted bananas and brass urlis, clear of the route */
    const segs = [ROUTE.in, ROUTE.out].flatMap(r => r.slice(1).map((p, i) => [r[i], p]));
    const dRoute = (s, lat) => Math.min(...segs.map(([a, b]) => {
      const ds = b[0] - a[0], dl = b[1] - a[1], t = Math.max(0, Math.min(1, ((s - a[0]) * ds + (lat - a[1]) * dl) / (ds * ds + dl * dl)));
      return Math.hypot(s - a[0] - ds * t, lat - a[1] - dl * t);
    }));
    const urli = (x, y, z) => {
      lathe([[0, 0], [0.1, 0], [0.16, 0.05], [0.14, 0.13], [0.22, 0.16], [0, 0.16]], 16, x, y, z, C.brass);   // stand
      const U = [[0, 0], [0.18, 0], [0.2, 0.03], [0.34, 0.08], [0.44, 0.15], [0.47, 0.18], [0.45, 0.185], [0.41, 0.15], [0.3, 0.09], [0, 0.06]];
      lathe(U.map(([r, h]) => [r * 1.45, h * 1.45]), 22, x, y + 0.16, z, C.brass);
      BR.push(part(place(new THREE.CircleGeometry(0.6, 24).rotateX(-Math.PI / 2), x, y + 0.16 + 0.22, z), C.water));
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4, r = 0.12 + 0.38 * Math.sqrt((i + 0.5) / 9);
        bead(x + Math.cos(a) * r, y + 0.385, z + Math.sin(a) * r, i % 4 === 0 ? 5 : i % 2 ? 2 : 0, 1.5);
      }
    };
    const PROPS = [];
    for (let k = 0; k < 6; k++) PROPS.push([c0 + 1.6 + k * 4.1, SEA + 0.95, k % 2 ? 'u' : 'b']);   // sea edge
    for (const lat of [-10, -13.6]) PROPS.push([c0 + 0.95, lat, lat < -12 ? 'b' : 'u']);              // far end
    for (const s of [c0 + 10, c0 + 14, c0 + 18]) PROPS.push([s, -4.75, 'u']);                         // road edge
    PROPS.push([cs1 - 1.1, -14.2, 'b'], [cs1 - 1.1, -7.9, 'b']);                                      // flanking the steps
    for (const [s, lat, kind] of PROPS) {
      if (dRoute(s, lat) < (kind === 'b' ? 3.8 : 3.0)) continue;
      const p = L(s, lat, cY(s));
      kind === 'b' ? banana(p.x, p.z, 1.5 + R() * 0.4, true, p.y, 1.35) : urli(p.x, p.y, p.z);
    }

    /* ---------------- meshes: one per material, beads instanced */
    const tris = { n: 0 };
    const mesh = (list, mat, name, cast = true, recv = true) => {
      if (!list.length) return null;
      const g = merged(list);
      tris.n += g.attributes.position.count / 3;
      const m = new THREE.Mesh(g, mat);
      m.name = 'haldi-' + name; m.castShadow = cast; m.receiveShadow = recv;
      group.add(m);
      return m;
    };
    const RT = rugTex(R, K < 0.5 ? 512 : 1024), PT = printTex(R), WT = plankTex(R);
    mesh(WOOD, new THREE.MeshStandardMaterial({ map: WT, vertexColors: true, roughness: 0.82 }), 'wood');
    mesh(RUG, new THREE.MeshStandardMaterial({ map: RT, vertexColors: true, roughness: 0.95, alphaTest: 0.5 }), 'rugs', false);
    mesh(GAD, new THREE.MeshStandardMaterial({ map: PT, vertexColors: true, roughness: 0.88 }), 'gaddis');
    mesh(FAB, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, side: THREE.DoubleSide,
      emissive: 0x4a2c00, emissiveIntensity: 0.35 }), 'fabric');
    mesh(SHE, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide, transparent: true,
      opacity: 0.5, depthWrite: false, emissive: 0x5a4a10, emissiveIntensity: 0.4 }), 'sheer', false, false);
    mesh(BR, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.7, roughness: 0.26, emissive: 0x3a2508, emissiveIntensity: 0.4 }), 'brass');
    mesh(LF, new THREE.MeshStandardMaterial({ map: leafTex(R), vertexColors: true, roughness: 0.55, side: THREE.DoubleSide, alphaTest: 0.5 }), 'leaves');

    mesh(CRT, new THREE.MeshStandardMaterial({ map: paverTex(R), vertexColors: true, roughness: 0.9 }), 'court', false);
    mesh(CST, new THREE.MeshStandardMaterial({ map: stoneTex(R), vertexColors: true, roughness: 0.8, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), 'stone', false);
    const pomp = pompomTex(R);
    mesh(MR, new THREE.MeshStandardMaterial({ map: pomp, vertexColors: true, roughness: 0.9, emissive: 0x5a2600, emissiveIntensity: 0.35 }), 'marigold-strings');
    const nB = beads.length / 5;
    const bg = K >= 1 ? new THREE.SphereGeometry(0.034, 7, 5) : new THREE.IcosahedronGeometry(0.034, 0);   // 56 / 20 tris
    const bm = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ map: pomp, roughness: 0.9, emissive: 0x401800, emissiveIntensity: 0.25 }), nB);
    const col = new THREE.Color();
    for (let i = 0; i < nB; i++) {
      const o = i * 5, s = beads[o + 4];
      M4.compose(V.set(beads[o], beads[o + 1], beads[o + 2]), Q.setFromEuler(E.set(R() * 6, R() * 6, 0)), S.set(s, s * 0.85, s));
      bm.setMatrixAt(i, M4);
      col.set(BEAD[beads[o + 3]]).multiplyScalar(0.9 + R() * 0.2);
      bm.setColorAt(i, col);
    }
    bm.computeBoundingSphere();
    bm.castShadow = true; bm.receiveShadow = true; bm.name = 'haldi-marigolds';
    group.add(bm);
    tris.n += nB * (bg.index ? bg.index.count : bg.attributes.position.count) / 3;
    group.userData.stats = { beads: nB, tris: Math.round(tris.n), draws: group.children.length };
    if (typeof window !== 'undefined') (window.__haldi = group.userData.stats);

    return {
      group,
      update() {}
    };
  }
};
