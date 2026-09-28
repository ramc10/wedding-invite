/* Shared vegetation kit — instanced, wind-swayed, procedural-photoreal. Owned by the land agent;
 * forest/hills/creek use it, coast, garden and dam import it.
 *
 * API (stable):
 *   plant(ctx, {
 *     kind,            'broadleaf' | 'blossom' | 'marigold' | 'pine' | 'bush' | 'boulder'
 *                      | 'flowers' | 'palm' | 'fern' | 'grass'
 *     count,           instances to try (road/water hits are skipped)
 *     place,           (rng, i) => ({s, lateral, scale?, yaw?, tint?}) | null
 *     scale: [a, b],   uniform scale range (default per kind)
 *     seed,            string|number (default kind)
 *     colors?,         [hex, ...] instance tints picked per instance (multiply the tintable texels)
 *     sink?,           metres pushed into the ground (default per kind)
 *     allowRoad?,      true to skip the road/verge test
 *     minHeight?       skip spots whose ground is below this y
 *   }) → THREE.InstancedMesh (one draw call; add it to your group)
 *
 *   band(s0, s1, near, far, side = 'both') → place fn: uniform scatter in a lateral band.
 *   floraMaterial(opts?) → the shared material (atlas + vertex colour + sway + leaf translucency),
 *                    for custom geometry with a vec3 'aFlora' attribute (x sway 0..1, y leafiness 0..1,
 *                    z instance-tint weight). Optional 'uv' (cell-local, may exceed 1 to tile) and
 *                    'aCell' (atlas cell origin); without them the plain white cell is used.
 *   kindGeometry(kind) → shared indexed BufferGeometry of a kind (for your own InstancedMesh).
 *   KINDS            list of kind names.
 *
 * Look: one procedural 2048² atlas (bark, plated pine bark, ringed palm bark, leaf-cluster cards,
 * blossom / amaltas cards, needle tufts, pinnate palm + fern fronds, bush leaves, flower heads,
 * rock, grass) + a data texture (normal xy, tint mask, height). Trees are tapered trunks with root
 * flare and 2-3 branch orders carrying alpha-tested leaf cards → irregular crowns with sky gaps.
 * Wind: trunk sway small (aFlora.x²), leaf flutter by aFlora.y; translucency toward world.U.uSunDir.
 * Built on MeshStandardMaterial via onBeforeCompile, so scene fog and lights stay built-in.
 */
import * as THREE from 'three';
import { path } from '../core/path.js';
import { world } from '../core/world.js';
import { rng as makeRng, fbm, noise2 } from '../core/noise.js';

const U = world.U;

/* ---------- atlas layout: 4×4 cells of 512 px, cell i at (i%4, i>>2) from the bottom-left ---------- */
const AS = 2048, CS = 512, CELL = 0.25;
const C = { PLAIN: 0, BARK: 1, PINEBARK: 2, PALMBARK: 3, LEAF: 4, BLOSSOM: 5, AMALTAS: 6, NEEDLE: 7,
  FROND: 8, FERN: 9, BUSH: 10, HEADS: 11, FLEAF: 12, ROCK: 13, GRASS: 14, LEAF2: 15 };
const cellOrigin = i => [(i % 4) * CELL, (i >> 2) * CELL];

// per-pixel painters work in texture space (row 0 = bottom). col = Uint8 RGBA, dat = Uint8 RGBA
// (dat: r,g normal xy, b tint mask, a height)
function cellPx(i, fn) {
  const cx = (i % 4) * CS, cy = (i >> 2) * CS;
  for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) fn(x, y, ((cy + y) * AS + cx + x) * 4);
}
// horizontally tileable fbm (blend across the seam)
function tfbm(x, y, W, oct) {
  const t = x / W;
  return fbm(x, y, oct) * (1 - t) + fbm(x - W, y, oct) * t;
}

function barkCell(A, i, { base, dark, ridge = 7, plates = false, rings = false, seed = 0 }) {
  const { col, dat } = A;
  cellPx(i, (x, y, o) => {
    const u = x / CS, v = y / CS;
    let h;
    if (rings) { // palm: leaf-scar rings + fine vertical fibre
      const ry = v * 14 + 0.25 * tfbm(u * 6, v * 3 + seed, 6, 2);
      const r = Math.abs((ry % 1) - 0.5) * 2;
      h = 0.35 + 0.45 * Math.pow(r, 0.6) + 0.12 * tfbm(u * 60, v * 4 + seed, 60, 2);
    } else if (plates) { // chir pine: irregular flat plates split by deep fissures
      const n = tfbm(u * 5, v * 2.2 + seed, 5, 3), m = tfbm(u * 9 + 3, v * 4 + seed, 9, 2);
      const cell = Math.abs(n) * 2 + 0.6 * Math.abs(m);
      h = Math.min(1, 0.25 + cell * 1.1) * (0.85 + 0.15 * tfbm(u * 40, v * 40, 40, 2));
    } else { // broadleaf: vertical furrows
      const f = tfbm(u * ridge, v * 0.6 + seed, ridge, 3) + 0.35 * tfbm(u * ridge * 3, v * 2 + seed, ridge * 3, 2);
      h = 0.5 + 0.5 * Math.sin((u * ridge + f * 1.2) * Math.PI * 2) * 0.6 + 0.25 * f;
      h = Math.max(0, Math.min(1, h + 0.15 * tfbm(u * 50, v * 25, 50, 2)));
    }
    const k = 0.35 + 0.75 * h, lich = plates || rings ? 0 : Math.max(0, tfbm(u * 4 + 9, v * 3, 4, 3) - 0.25) * 1.6;
    col[o] = Math.min(255, (dark[0] + (base[0] - dark[0]) * h) * k * (1 - lich) + 150 * lich);
    col[o + 1] = Math.min(255, (dark[1] + (base[1] - dark[1]) * h) * k * (1 - lich) + 160 * lich);
    col[o + 2] = Math.min(255, (dark[2] + (base[2] - dark[2]) * h) * k * (1 - lich) + 120 * lich);
    col[o + 3] = 255; dat[o + 2] = 64; dat[o + 3] = h * 255;
  });
}

function rockCell(A, i) {
  const { col, dat } = A;
  cellPx(i, (x, y, o) => {
    const u = x / CS, v = y / CS;
    const n = tfbm(u * 6, v * 6, 6, 5), c = Math.abs(tfbm(u * 3 + 7, v * 3, 3, 3));
    const crack = Math.max(0, 1 - c * 14);
    const h = Math.max(0, Math.min(1, 0.55 + 0.4 * n - 0.5 * crack + 0.1 * tfbm(u * 40, v * 40, 40, 2)));
    const lich = Math.max(0, tfbm(u * 5 + 20, v * 5 + 3, 5, 4) - 0.18) * 2.2;
    const g = 0.55 + 0.45 * h;
    let r = 190 * g, gg = 184 * g, b = 172 * g;
    const speck = noise2(x * 0.9, y * 0.9); if (speck > 0.93) { r *= 0.6; gg *= 0.6; b *= 0.6; }
    const lc = noise2(u * 9, v * 9) > 0.5 ? [205, 210, 160] : [215, 200, 150];
    const L = Math.min(1, lich);
    col[o] = r * (1 - L) + lc[0] * L; col[o + 1] = gg * (1 - L) + lc[1] * L; col[o + 2] = b * (1 - L) + lc[2] * L;
    col[o + 3] = 255; dat[o + 2] = 255 * (1 - 0.7 * L); dat[o + 3] = h * 255;
  });
}

function grassCell(A, i) {
  const { col, dat } = A;
  cellPx(i, (x, y, o) => {
    const u = x / CS, v = y / CS;
    const s = tfbm(u * 40, v * 0.8, 40, 2);
    const g = 0.7 + 0.3 * v + 0.2 * s;
    col[o] = 200 * g; col[o + 1] = 220 * g; col[o + 2] = 170 * g; col[o + 3] = 255;
    dat[o + 2] = 255; dat[o + 3] = 128 + 60 * s;
  });
}

/* ---------- canvas-painted cells (local 512² coords, y down; card "up" = canvas up) ---------- */
function gray(l, a = 1, hue = 0) { // near-neutral paint for tintable texels (tint supplies the hue)
  const L = Math.max(0, Math.min(255, l * 255));
  return `rgba(${L * (1 + hue * 0.04) | 0},${L | 0},${L * (1 - hue * 0.12) | 0},${a})`;
}
function rgb(r, g, b, k = 1) { return `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})`; }

function leafPath(g, len, wid, shape = 0.3) {
  g.beginPath(); g.moveTo(0, 0);
  g.bezierCurveTo(wid, -len * shape, wid * 0.9, -len * 0.75, 0, -len);
  g.bezierCurveTo(-wid * 0.9, -len * 0.75, -wid, -len * shape, 0, 0);
}
function leaf(g, x, y, ang, len, wid, fill, { rib = 'rgba(255,255,255,0.18)', shape = 0.3, shade = true } = {}) {
  g.save(); g.translate(x, y); g.rotate(ang);
  leafPath(g, len, wid, shape); g.fillStyle = fill; g.fill();
  if (shade) { // one half a touch darker → reads as a folded leaf
    g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(wid, -len * shape, wid * 0.9, -len * 0.75, 0, -len); g.closePath();
    g.fillStyle = 'rgba(0,0,0,0.13)'; g.fill();
  }
  g.strokeStyle = rib; g.lineWidth = Math.max(1, wid * 0.08);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -len * 0.95); g.stroke();
  g.restore();
}
function twig(g, pts, w0, w1, color) {
  g.strokeStyle = color; g.lineCap = 'round';
  for (let k = 1; k < pts.length; k++) {
    g.lineWidth = w0 + (w1 - w0) * (k / (pts.length - 1));
    g.beginPath(); g.moveTo(pts[k - 1][0], pts[k - 1][1]); g.lineTo(pts[k][0], pts[k][1]); g.stroke();
  }
}
// a wandering twig from (x,y) heading ang (0 = up), n points
function walk(R, x, y, ang, len, n, wob = 0.35) {
  const pts = [[x, y]];
  for (let k = 0; k < n; k++) {
    ang += (R() - 0.5) * wob;
    x += Math.sin(ang) * len / n; y -= Math.cos(ang) * len / n;
    pts.push([x, y]);
  }
  return pts;
}

// broadleaf spray: twig tree with alternate leaves, irregular outline with gaps
function leafSpray(g, R, { n = 5, leaves = 14, len = [42, 80], wid = [0.28, 0.4], shape = 0.3, paint, twigCol = gray(0.35) }) {
  const main = walk(R, 256 + (R() - 0.5) * 40, 512, (R() - 0.5) * 0.3, 380, 8, 0.25);
  twig(g, main, 7, 2, twigCol);
  const tips = [];
  for (let b = 0; b < n; b++) {
    const at = main[2 + Math.floor(R() * 6)], side = b % 2 ? 1 : -1;
    const tw = walk(R, at[0], at[1], side * (0.5 + R() * 0.7), 120 + R() * 120, 5, 0.4);
    twig(g, tw, 3.5, 1.2, twigCol); tips.push(tw);
  }
  tips.push(main);
  for (const tw of tips) for (let k = 1; k < tw.length; k++) {
    const per = k === tw.length - 1 ? 3 : Math.round(leaves / tw.length);
    for (let j = 0; j < per; j++) {
      const [x, y] = tw[k], s = j % 2 ? 1 : -1;
      const L = len[0] + R() * (len[1] - len[0]);
      const a = Math.atan2(tw[k][0] - tw[k - 1][0], tw[k - 1][1] - tw[k][1]) + s * (0.5 + R() * 0.7);
      leaf(g, x + (R() - 0.5) * 10, y + (R() - 0.5) * 10, a, L, L * (wid[0] + R() * (wid[1] - wid[0])), paint(R), { shape });
    }
  }
}

function paintLeaf(g, R) { leafSpray(g, R, { n: 6, leaves: 16, paint: R => gray(0.62 + R() * 0.36, 1, R()) }); }
function paintLeaf2(g, R) { // lanceolate (mango/jamun-like), longer and glossier
  leafSpray(g, R, { n: 5, leaves: 12, len: [70, 120], wid: [0.16, 0.22], shape: 0.4, paint: R => gray(0.58 + R() * 0.4, 1, R()) });
}
function paintBush(g, R) { // dense small leaves over a rounded mass, gaps near the rim
  for (let k = 0; k < 520; k++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 235;
    const x = 256 + Math.cos(a) * r, y = 270 + Math.sin(a) * r * 0.95;
    if (r > 200 && R() < 0.5) continue;
    leaf(g, x, y, R() * 6.28, 22 + R() * 24, 9 + R() * 7, gray(0.5 + R() * 0.45 - r / 900, 1, R()), { shade: R() < 0.5 });
  }
}
function flower5(g, x, y, r, petal, centre) { // simple 5-petal blossom, face-on
  g.save(); g.translate(x, y); g.rotate(Math.random() * 6.28);
  for (let p = 0; p < 5; p++) {
    g.rotate(Math.PI * 2 / 5); g.beginPath(); g.ellipse(0, -r * 0.55, r * 0.42, r * 0.6, 0, 0, 7);
    g.fillStyle = petal; g.fill();
  }
  g.beginPath(); g.arc(0, 0, r * 0.22, 0, 7); g.fillStyle = centre; g.fill(); g.restore();
}
function paintBlossom(g, R) { // pink-trumpet / cherry-like: twigs smothered in flowers, few green leaves
  const main = walk(R, 256, 512, (R() - 0.5) * 0.3, 360, 7, 0.3);
  twig(g, main, 7, 2, rgb(80, 62, 50));
  const tips = [main];
  for (let b = 0; b < 6; b++) {
    const at = main[1 + Math.floor(R() * 6)], s = b % 2 ? 1 : -1;
    const tw = walk(R, at[0], at[1], s * (0.5 + R() * 0.8), 110 + R() * 110, 4, 0.5); twig(g, tw, 3, 1, rgb(85, 64, 50)); tips.push(tw);
  }
  for (const tw of tips) for (let k = 1; k < tw.length; k++) {
    if (R() < 0.35) leaf(g, tw[k][0], tw[k][1], R() * 6.28, 40 + R() * 30, 14, rgb(90, 125, 55, 0.8 + R() * 0.4));
    for (let j = 0; j < 9; j++)
      flower5(g, tw[k][0] + (R() - 0.5) * 70, tw[k][1] + (R() - 0.5) * 70, 12 + R() * 11, gray(0.8 + R() * 0.2), gray(0.45));
  }
}
function paintAmaltas(g, R) { // golden-shower: pinnate leaves above, pendulous racemes hanging down
  const main = walk(R, 40, 140 + R() * 40, 1.45, 460, 7, 0.2);
  twig(g, main, 6, 2, rgb(85, 70, 50));
  for (let k = 1; k < main.length; k++) {
    for (let j = 0; j < 4; j++) leaf(g, main[k][0] + (R() - 0.5) * 30, main[k][1], -0.6 + R() * 1.2 + (j % 2 ? 0.4 : -0.4), 45 + R() * 30, 15, rgb(95, 130, 50, 0.8 + R() * 0.4));
    if (R() < 0.8) { // raceme
      const L = 220 + R() * 150; let x = main[k][0], y = main[k][1];
      g.strokeStyle = rgb(90, 110, 50); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y);
      g.quadraticCurveTo(x + (R() - 0.5) * 50, y + L * 0.5, x + (R() - 0.5) * 30, y + L); g.stroke();
      for (let t = 0; t < 1; t += 0.035) {
        const fx = x + (R() - 0.5) * 22 * (1 - t * 0.5), fy = y + 10 + t * L;
        flower5(g, fx, fy, 13 * (1 - t * 0.6) + R() * 4, gray(0.82 + R() * 0.18), gray(0.6));
      }
    }
  }
}
function paintNeedle(g, R) { // chir pine: twig up the card, long fascicled needles drooping to both sides
  const main = walk(R, 256, 512, 0, 470, 8, 0.12);
  twig(g, main, 8, 3, rgb(95, 70, 55));
  g.lineCap = 'round';
  for (let k = 1; k < main.length; k++) for (let j = 0; j < 22; j++) {
    const [x, y] = main[k], s = R() < 0.5 ? -1 : 1, L = 150 + R() * 110;
    const a0 = s * (0.25 + R() * 0.9);
    g.strokeStyle = gray(0.55 + R() * 0.45, 1, R()); g.lineWidth = 1.6 + R() * 1.4;
    g.beginPath(); g.moveTo(x, y);
    const mx = x + Math.sin(a0) * L * 0.5, my = y - Math.cos(a0) * L * 0.45;
    g.quadraticCurveTo(mx, my, mx + Math.sin(a0) * L * 0.45, my + L * (0.15 + R() * 0.35)); g.stroke();
  }
}
function paintFrond(g, R) { // half coconut frond: rachis on the left edge, leaflets to the right
  g.strokeStyle = rgb(160, 160, 90); g.lineWidth = 9; g.beginPath(); g.moveTo(10, 512); g.lineTo(14, 0); g.stroke();
  g.lineCap = 'round';
  for (let k = 0; k < 64; k++) {
    const t = k / 64, y = 505 - t * 505;
    if (R() < 0.06) continue; // torn / missing leaflet
    const L = 490 * Math.sin(Math.min(1, t * 1.25 + 0.12) * Math.PI * 0.95) * (0.85 + R() * 0.2);
    const a = 0.9 - t * 0.35 + (R() - 0.5) * 0.12, w = 7 + 5 * (1 - t);
    const ex = 14 + Math.sin(a) * L, ey = y - Math.cos(a) * L * 0.55;
    const k2 = 0.85 + R() * 0.3;
    g.strokeStyle = rgb(120, 150, 62, k2); g.lineWidth = w;
    g.beginPath(); g.moveTo(14, y); g.quadraticCurveTo(14 + (ex - 14) * 0.5, y - (y - ey) * 0.75, ex, ey); g.stroke();
    g.strokeStyle = rgb(150, 170, 80, k2); g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(14, y); g.quadraticCurveTo(14 + (ex - 14) * 0.5, y - (y - ey) * 0.75, ex, ey); g.stroke();
  }
}
function paintFern(g, R) { // full frond, pinnae with lobes, tapering to the tip
  g.strokeStyle = rgb(90, 110, 50); g.lineWidth = 5; g.beginPath(); g.moveTo(256, 512); g.quadraticCurveTo(250, 250, 262, 8); g.stroke();
  for (let k = 0; k < 30; k++) {
    const t = k / 30, y = 500 - t * 490, L = 230 * Math.sin(Math.min(1, t * 1.4 + 0.1) * Math.PI) * (1 - t * 0.35);
    for (const s of [-1, 1]) {
      const a = s * (1.25 - t * 0.4);
      for (let j = 0; j < 9; j++) {
        const f = j / 9, r = L * f;
        const x = 256 + Math.sin(a) * r, yy = y - Math.cos(a) * r - f * f * 20;
        const lob = (1 - f) * 16 + 4;
        g.beginPath(); g.ellipse(x, yy, lob, lob * 0.55, a + Math.PI / 2, 0, 7);
        g.fillStyle = rgb(85, 130, 48, 0.8 + R() * 0.45 + t * 0.2); g.fill();
      }
    }
  }
}
function paintHeads(g, R) { // quadrants: pompom top | rose top  /  pompom side | rose side
  const pom = (cx, cy, rx, ry, side) => {
    for (let r = 1; r > 0.05; r -= 0.07) for (let k = 0; k < 40 * r + 6; k++) {
      const a = R() * 6.28, d = r * (0.85 + R() * 0.15);
      const x = cx + Math.cos(a) * rx * d, y = cy + (side ? -Math.abs(Math.sin(a)) * ry * d * 1.1 + ry * 0.4 : Math.sin(a) * ry * d);
      g.beginPath(); g.ellipse(x, y, 11 * (0.5 + r), 7, a, 0, 7);
      g.fillStyle = gray(0.55 + (1 - r) * 0.2 + R() * 0.35); g.fill();
    }
  };
  const rose = (cx, cy, rx, ry, side) => {
    for (let k = 0; k < 26; k++) {
      const t = k / 26, a = k * 2.4, d = (1 - t) * 0.8 + 0.15;
      g.beginPath();
      if (side) g.ellipse(cx + Math.cos(a) * rx * d * 0.6, cy + ry * 0.4 - t * ry * 0.9, rx * 0.5 * (1.1 - t * 0.5), ry * 0.4, 0, 0, 7);
      else g.ellipse(cx + Math.cos(a) * rx * d * 0.45, cy + Math.sin(a) * ry * d * 0.45, rx * 0.45 * (1 - t * 0.6), ry * 0.3, a, 0, 7);
      g.fillStyle = gray(0.45 + t * 0.2 + (1 - t) * 0.35 * R() + 0.2); g.fill();
      g.strokeStyle = gray(0.35, 0.6); g.lineWidth = 1.5; g.stroke();
    }
  };
  pom(128, 128, 110, 110, false); rose(384, 128, 115, 115, false);
  g.fillStyle = rgb(70, 110, 45); g.fillRect(124, 440, 8, 72); g.fillRect(380, 440, 8, 72);
  leaf(g, 128, 470, 0.9, 50, 18, rgb(70, 110, 45)); leaf(g, 384, 480, -0.9, 55, 22, rgb(70, 110, 45));
  pom(128, 370, 110, 85, true); rose(384, 380, 100, 90, true);
}
function paintFLeaf(g, R) { // flower-bed foliage: stems with pinnate (marigold) and serrated (rose) leaves
  for (let k = 0; k < 16; k++) {
    const st = walk(R, 256 + (R() - 0.5) * 160, 512, (R() - 0.5) * 1.3, 300 + R() * 180, 6, 0.3);
    twig(g, st, 4, 2, rgb(70, 105, 42));
    for (let j = 1; j < st.length; j++) for (const s of [-1, 1]) {
      const pin = k % 2 === 0;
      leaf(g, st[j][0], st[j][1], s * (0.9 + R() * 0.5), pin ? 38 + R() * 20 : 50 + R() * 25, pin ? 9 : 22,
        rgb(pin ? 70 : 60, pin ? 118 : 105, 42, 0.8 + R() * 0.45));
    }
  }
}

/* ---------- atlas assembly ---------- */
const PAINT = [[C.LEAF, paintLeaf, 1], [C.LEAF2, paintLeaf2, 1], [C.BUSH, paintBush, 1], [C.BLOSSOM, paintBlossom, 2],
  [C.AMALTAS, paintAmaltas, 2], [C.NEEDLE, paintNeedle, 1], [C.FROND, paintFrond, 1], [C.FERN, paintFern, 1],
  [C.HEADS, paintHeads, 2], [C.FLEAF, paintFLeaf, 0]]; // mask mode: 1 all tintable, 0 none, 2 non-green only
const BUMP = { [C.BARK]: 5, [C.PINEBARK]: 6, [C.PALMBARK]: 4, [C.ROCK]: 4, [C.GRASS]: 0.5 };
let ATLAS = null;
const NB4 = [4, -4, AS * 4, -AS * 4];
function atlas() {
  if (ATLAS) return ATLAS;
  const tA = performance.now();
  const cv = document.createElement('canvas'); cv.width = cv.height = AS;
  const g = cv.getContext('2d', { willReadFrequently: true });
  for (const [i, fn] of PAINT) {
    g.save(); g.setTransform(1, 0, 0, 1, (i % 4) * CS, (3 - (i >> 2)) * CS);
    g.beginPath(); g.rect(4, 4, CS - 8, CS - 8); g.clip();
    fn(g, makeRng(1000 + i)); g.restore();
  }
  const img = g.getImageData(0, 0, AS, AS).data;
  const col = new Uint8Array(AS * AS * 4), dat = new Uint8Array(AS * AS * 4);
  for (let y = 0; y < AS; y++) col.set(img.subarray((AS - 1 - y) * AS * 4, (AS - y) * AS * 4), y * AS * 4);
  const A = { col, dat };
  cellPx(C.PLAIN, (x, y, o) => { col[o] = col[o + 1] = col[o + 2] = col[o + 3] = 255; dat[o + 2] = 255; dat[o + 3] = 128; });
  barkCell(A, C.BARK, { base: [150, 128, 108], dark: [70, 56, 46], ridge: 7, seed: 1 });
  barkCell(A, C.PINEBARK, { base: [150, 105, 80], dark: [55, 42, 38], plates: true, seed: 2 });
  barkCell(A, C.PALMBARK, { base: [165, 150, 130], dark: [85, 75, 62], rings: true, seed: 3 });
  rockCell(A, C.ROCK); grassCell(A, C.GRASS);
  // painted cells: tint mask, height from luminance, bleed colour into transparent texels (no dark mip fringes)
  for (const [i, , mode] of PAINT) {
    let sr = 0, sg = 0, sb = 0, sn = 0;
    cellPx(i, (x, y, o) => {
      const r = col[o], gg = col[o + 1], b = col[o + 2], a = col[o + 3];
      if (a > 128) { sr += r; sg += gg; sb += b; sn++; }
      const green = gg > r * 1.12 && gg > b * 1.2;
      dat[o + 2] = mode === 1 ? 255 : mode === 0 ? 0 : green ? 0 : 255;
      dat[o + 3] = (r + gg + b) / 3;
    });
    const avg = [sr / sn, sg / sn, sb / sn];
    for (let pass = 0; pass < 3; pass++) cellPx(i, (x, y, o) => {
      if (col[o + 3] !== 0 || x === 0 || y === 0 || x === CS - 1 || y === CS - 1) return;
      for (let j = 0; j < 4; j++) { const d = NB4[j]; if (col[o + d + 3] > 0) {
        col[o] = col[o + d]; col[o + 1] = col[o + d + 1]; col[o + 2] = col[o + d + 2]; col[o + 3] = 1; return;
      } }
    });
    cellPx(i, (x, y, o) => { const a = col[o + 3]; if (a === 0) { col[o] = avg[0]; col[o + 1] = avg[1]; col[o + 2] = avg[2]; } else if (a === 1) col[o + 3] = 0; });
  }
  // normals from height (wrapping inside each cell so tiling cells stay seamless)
  for (let i = 0; i < 16; i++) {
    const k = BUMP[i] ?? 0.8, cx = (i % 4) * CS, cy = (i >> 2) * CS;
    const kk = k / 255, M = CS - 1;
    for (let y = 0; y < CS; y++) {
      const row = (cy + y) * AS + cx, rDn = (cy + ((y + M) & M)) * AS + cx, rUp = (cy + ((y + 1) & M)) * AS + cx;
      for (let x = 0; x < CS; x++) {
        const nx = (dat[(row + ((x + M) & M)) * 4 + 3] - dat[(row + ((x + 1) & M)) * 4 + 3]) * kk;
        const ny = (dat[(rDn + x) * 4 + 3] - dat[(rUp + x) * 4 + 3]) * kk;
        const il = 127.5 / Math.sqrt(nx * nx + ny * ny + 1), o = (row + x) * 4;
        dat[o] = nx * il + 127.5; dat[o + 1] = ny * il + 127.5;
      }
    }
  }
  const mk = (arr, srgb) => {
    const t = new THREE.DataTexture(arr, AS, AS, THREE.RGBAFormat);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.anisotropy = 4; t.needsUpdate = true; return t;
  };
  ATLAS = { map: mk(col, true), data: mk(dat, false) };
  const bt = globalThis.__v2 && globalThis.__v2.buildTimes; if (bt) bt.atlas = Math.round(performance.now() - tA);
  return ATLAS;
}

/* ---------- indexed geometry builder ---------- */
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
class GB {
  constructor() { this.p = []; this.n = []; this.uv = []; this.cell = []; this.c = []; this.f = []; this.i = []; this.pv = []; this.nc = 0; }
  vert(p, n, u, v, cell, col, f) {
    const [cu, cv] = cellOrigin(cell);
    this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.uv.push(u, v); this.cell.push(cu, cv);
    this.c.push(col[0], col[1], col[2]); this.f.push(f[0], f[1], f[2]); this.pv.push(0, 0, 0, 2);
    return this.p.length / 3 - 1;
  }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  /** generalized cylinder along spine [{p, r}], rFn(t, ang) → radius multiplier. */
  tube(spine, { radial = 6, cell = C.BARK, uRep = 1, color = [1, 1, 1], sway = () => 0, tint = 0.2, rFn = null, dark = 0 }) {
    const n = spine.length, T = V3(), N = V3(), B = V3(), tmp = V3();
    let len = 0, prev = null, base = this.p.length / 3;
    const r0 = spine[0].r;
    for (let k = 0; k < n; k++) {
      const P = spine[k].p, r = spine[k].r;
      if (k < n - 1) T.subVectors(spine[k + 1].p, P).normalize(); else T.subVectors(P, spine[k - 1].p).normalize();
      if (k === 0) { N.set(0, 0, 1); if (Math.abs(T.z) > 0.9) N.set(1, 0, 0); }
      N.sub(tmp.copy(T).multiplyScalar(N.dot(T))).normalize(); B.crossVectors(T, N);
      if (prev) len += P.distanceTo(prev); prev = P;
      const t = k / (n - 1), v = len * uRep / (2 * Math.PI * Math.max(0.03, r0 * 0.8));
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const rr = r * (rFn ? rFn(t, a) : 1);
        const dir = V3().copy(N).multiplyScalar(ca).addScaledVector(B, sa);
        const shade = 1 - dark * (1 - t) - 0.08 * sa;
        this.vert(V3().copy(P).addScaledVector(dir, rr), dir, (j / radial) * uRep, v, cell,
          [color[0] * shade, color[1] * shade, color[2] * shade], [sway(t), 0, tint]);
      }
      if (k > 0) {
        const a0 = base + (k - 1) * (radial + 1), a1 = base + k * (radial + 1);
        for (let j = 0; j < radial; j++) this.quad(a0 + j, a0 + j + 1, a1 + j + 1, a1 + j);
      }
    }
  }
  /** textured card: centre c, unit axes rt/up, size w×h, uv rect [u0,v0,u1,v1], normal fn(pos) */
  card(c, rt, up, w, h, cell, rect, col, f, nFn) {
    const b = this.p.length / 3, [u0, v0, u1, v1] = rect;
    const nz = V3().crossVectors(rt, up).normalize();
    const corners = [[-0.5, 0, u0, v0], [0.5, 0, u1, v0], [0.5, 1, u1, v1], [-0.5, 1, u0, v1]];
    for (const [x, y, u, v] of corners) {
      const p = V3().copy(c).addScaledVector(rt, x * w).addScaledVector(up, y * h);
      this.vert(p, nFn ? nFn(p, nz) : nz, u, v, cell, typeof col === 'function' ? col(p, y) : col, typeof f === 'function' ? f(p, y) : f);
    }
    // LOD pivot: card centre + an evenly spread rank (golden-ratio sequence) for distance thinning
    const pc = V3().copy(c).addScaledVector(up, h * 0.5), rank = (this.nc++ * 0.6180339887) % 1;
    for (let k = 0, L = this.pv.length - 16; k < 4; k++) { const j = L + k * 4; this.pv[j] = pc.x; this.pv[j + 1] = pc.y; this.pv[j + 2] = pc.z; this.pv[j + 3] = rank; }
    this.quad(b, b + 1, b + 2, b + 3);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aCell', new THREE.Float32BufferAttribute(this.cell, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aFlora', new THREE.Float32BufferAttribute(this.f, 3));
    g.setAttribute('aPivot', new THREE.Float32BufferAttribute(this.pv, 4));
    g.setIndex(this.i);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
const CARD = [0.004, 0.004, 0.996, 0.996];
const hex3 = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
// foliage normal: blend card normal with the direction out of the crown centre (soft volumetric shading)
const crownNormal = (ctr, soft = 0.8, lift = 0.35) => (p, nz) => {
  const v = V3().subVectors(p, ctr).normalize(); v.y += lift; v.normalize();
  return V3().copy(nz).multiplyScalar(1 - soft).addScaledVector(v, soft).normalize();
};
// random unit vector biased up
function randDir(R, upBias = 0) {
  const z = Math.min(1, R() * 2 - 1 + upBias), a = R() * Math.PI * 2, s = Math.sqrt(Math.max(0, 1 - z * z));
  return V3(s * Math.cos(a), z, s * Math.sin(a));
}

/* ---------- kinds ---------- */
const BARKC = [0.78, 0.72, 0.66];

// broadleaf-family tree: flared furrowed trunk, 2-3 branch orders, leaf-cluster cards at the twigs
function tree({ seed = 1, H = 8.5, bole = 0.36, crownR = 3.4, prim = 7, cards = 520, size = [1.2, 1.9],
  cells = [[C.LEAF, 1]], hang = 0, leafCol = 0xffffff, barkCol = BARKC }) {
  const R = makeRng(seed), gb = new GB();
  const r0 = H * 0.026, top = H * 0.8;
  const tR = y => r0 * (1 - 0.62 * Math.min(1, y / top));
  // trunk: gently leaning leader with root flare (5 buttress lobes)
  const lean = V3((R() - 0.5) * 0.5, 0, (R() - 0.5) * 0.5), spine = [];
  for (let k = 0; k <= 10; k++) {
    const y = -0.4 + (top + 0.4) * (k / 10), t = Math.max(0, y) / top;
    spine.push({ p: V3(lean.x * t * t * H * 0.1 + 0.08 * Math.sin(k * 1.7 + seed), y, lean.z * t * t * H * 0.1), r: tR(Math.max(0, y)) });
  }
  const ph = R() * 6;
  gb.tube(spine, { radial: 9, cell: C.BARK, uRep: 2, color: barkCol, dark: 0.25, sway: t => 0.28 * t * t, tint: 0.15,
    rFn: (t, a) => { const f = Math.max(0, 1 - t / 0.13); return 1 + f * f * (0.7 + 0.55 * Math.cos(5 * a + ph)); } });
  const trunkAt = y => { const t = (y + 0.4) / (top + 0.4) * 10, k = Math.min(9, Math.floor(t)); return V3().lerpVectors(spine[k].p, spine[k + 1].p, t - k); };
  const ctr = V3(0, bole * H + (H - bole * H) * 0.5, 0);
  const anchors = [];
  const branch = (from, dir, L, r, order) => {
    const pts = [], n = order === 1 ? 5 : 3, d = dir.clone();
    let p = from.clone();
    for (let k = 0; k <= n; k++) {
      pts.push({ p: p.clone(), r: r * (1 - 0.8 * k / n) });
      d.y += (order === 1 ? 0.12 : 0.08) - hang * 0.18; d.x += (R() - 0.5) * 0.25; d.z += (R() - 0.5) * 0.25; d.normalize();
      p = p.clone().addScaledVector(d, L / n);
    }
    gb.tube(pts, { radial: order === 1 ? 5 : 3, cell: C.BARK, uRep: 1, color: barkCol, sway: t => 0.3 + 0.25 * t + 0.15 * order, tint: 0.15 });
    return pts;
  };
  for (let b = 0; b < prim; b++) {
    const f = b / (prim - 1), y = H * (bole + (0.8 - bole) * f) * (0.95 + R() * 0.08);
    const az = b * 2.4 + R() * 0.8, el = 0.35 + 0.55 * f + (R() - 0.5) * 0.2;
    const dir = V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const L = crownR * (1.05 - 0.35 * f) * (0.85 + R() * 0.3);
    const pts = branch(trunkAt(y), dir, L, tR(y) * 0.62, 1);
    anchors.push(pts[5].p, pts[4].p);
    for (let s = 0; s < 3; s++) {
      const k = 2 + s, at = pts[Math.min(k, 4)].p, sd = V3().subVectors(pts[Math.min(k, 4) + 1].p, at).normalize();
      sd.add(randDir(R, 0.4).multiplyScalar(0.9)).normalize();
      const sp = branch(at, sd, L * (0.4 + R() * 0.2), pts[k].r * 0.55, 2);
      anchors.push(sp[3].p, sp[2].p);
    }
  }
  anchors.push(spine[10].p.clone().add(V3(0, 0.4, 0)), spine[9].p);
  // leaf cards
  const tot = cells.reduce((a, c) => a + c[1], 0), lc = hex3(leafCol);
  const nFn = crownNormal(ctr, 0.8);
  for (let k = 0; k < cards; k++) {
    const a = anchors[k % anchors.length];
    let r = R() * tot, cell = cells[0][0];
    for (const [c, w] of cells) { if ((r -= w) <= 0) { cell = c; break; } }
    const out = V3().subVectors(a, ctr); out.y *= 0.6; out.normalize();
    const up = hang ? V3(0, 1, 0).addScaledVector(randDir(R), 0.35).normalize()
      : out.clone().multiplyScalar(0.8).add(randDir(R, 0.3)).normalize();
    let rt = V3().crossVectors(up, randDir(R)).normalize();
    const w = size[0] + R() * (size[1] - size[0]);
    const c = a.clone().addScaledVector(randDir(R), w * 0.35).addScaledVector(up, hang ? -w * 0.55 : -w * 0.15);
    const lum = 0.85 + R() * 0.25, flip = R() < 0.5;
    const rect = flip ? [CARD[2], CARD[1], CARD[0], CARD[3]] : CARD;
    gb.card(c, rt, up, w, w, cell, rect, (p) => {
      const d = Math.min(1.2, p.distanceTo(ctr) / crownR), sh = (0.5 + 0.5 * d) * (0.8 + 0.2 * Math.min(1, p.y / H + 0.2)) * lum;
      return [lc[0] * sh, lc[1] * sh, lc[2] * sh];
    }, (p, y) => [0.55 + 0.45 * Math.min(1, p.y / H), 1, 1], nFn);
  }
  return gb.geometry();
}

// Himalayan chir pine: tall straight plated trunk, whorls of drooping needle-card branches, open crown
function pine({ seed = 3, H = 11 } = {}) {
  const R = makeRng(seed), gb = new GB(), r0 = H * 0.021, spine = [];
  for (let k = 0; k <= 12; k++) {
    const y = -0.4 + (H * 0.97 + 0.4) * k / 12;
    spine.push({ p: V3(0.05 * Math.sin(k * 1.3 + seed), y, 0.05 * Math.cos(k * 0.9)), r: r0 * (1 - 0.85 * Math.max(0, y) / H) + 0.02 });
  }
  gb.tube(spine, { radial: 8, cell: C.PINEBARK, uRep: 2, color: [0.9, 0.84, 0.8], dark: 0.2, sway: t => 0.3 * t * t, tint: 0.12,
    rFn: (t, a) => 1 + Math.max(0, 1 - t / 0.06) ** 2 * (0.5 + 0.3 * Math.cos(4 * a)) });
  const ctr = V3(0, H * 0.72, 0), nFn = crownNormal(ctr, 0.7, 0.45);
  const needles = (a, up, w, sway) => {
    const rt = V3().crossVectors(up, randDir(R)).normalize();
    gb.card(a.clone().addScaledVector(up, -w * 0.1), rt, up, w * 0.8, w, C.NEEDLE, R() < 0.5 ? CARD : [CARD[2], CARD[1], CARD[0], CARD[3]],
      p => { const s = (0.55 + 0.45 * Math.min(1, p.distanceTo(ctr) / (H * 0.25))) * (0.85 + 0.25 * R()); return [s, s, s]; },
      [sway, 1, 1], nFn);
  };
  const whorls = 9;
  for (let w = 0; w < whorls; w++) {
    const f = w / (whorls - 1), y = H * (0.42 + 0.53 * f), az0 = R() * 6.28;
    const nb = 3 + (R() < 0.5 ? 1 : 0);
    for (let b = 0; b < nb; b++) {
      if (R() < 0.12 && f < 0.6) continue; // gaps: shed branches
      const az = az0 + b * 6.28 / nb + (R() - 0.5) * 0.6, L = H * (0.25 - 0.19 * f) * (0.75 + R() * 0.45);
      let el = -0.25 + 0.75 * f + (R() - 0.5) * 0.2;
      const pts = []; let p = spine[0].p.clone().setY(y);
      for (let k = 0; k <= 4; k++) {
        pts.push({ p: p.clone(), r: r0 * 0.3 * (1 - f * 0.5) * (1 - 0.8 * k / 4) });
        const d = V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
        p = p.clone().addScaledVector(d, L / 4); el += k < 2 ? -0.12 : 0.22; // droop, then upturned tip
      }
      gb.tube(pts, { radial: 4, cell: C.PINEBARK, uRep: 1, color: [0.8, 0.72, 0.66], sway: t => 0.35 + 0.35 * t, tint: 0.1 });
      for (let k = 2; k <= 4; k++) for (let j = 0; j < 3; j++) {
        const at = pts[k].p, dir = V3().subVectors(pts[k].p, pts[k - 1].p).normalize();
        const up = dir.clone().multiplyScalar(0.9).add(randDir(R, 0.2).multiplyScalar(0.5)).normalize();
        needles(at.clone().addScaledVector(randDir(R), 0.25), up, H * 0.075 * (0.8 + R() * 0.5) * (1 - 0.3 * f), 0.5 + 0.4 * f);
      }
    }
  }
  for (let j = 0; j < 7; j++) needles(spine[12].p.clone().add(V3(0, -0.6 * R(), 0)), V3(0, 1, 0).addScaledVector(randDir(R), 0.6).normalize(), H * 0.08, 0.95);
  return gb.geometry();
}

// coconut palm: curved ringed trunk with swollen base, 18 arching pinnate fronds, coconut bunch
function palm({ seed = 17, H = 10 } = {}) {
  const R = makeRng(seed), gb = new GB(), spine = [], bend = 1.6;
  for (let k = 0; k <= 16; k++) {
    const t = k / 16, y = -0.3 + (H + 0.3) * t;
    spine.push({ p: V3(bend * Math.pow(t, 1.7) + 0.15 * Math.sin(t * 5), y, 0.25 * Math.sin(t * 3)), r: 0.16 + 0.06 * (1 - t) });
  }
  gb.tube(spine, { radial: 9, cell: C.PALMBARK, uRep: 1, color: [0.95, 0.9, 0.84], dark: 0.15, sway: t => 0.55 * t * t, tint: 0.2,
    rFn: t => 1 + 0.9 * Math.max(0, 1 - t / 0.07) ** 2 });
  const top = spine[16].p, lean = V3().subVectors(top, spine[14].p).normalize();
  gb.tube([{ p: top.clone().addScaledVector(lean, -0.5), r: 0.19 }, { p: top.clone(), r: 0.24 }, { p: top.clone().addScaledVector(lean, 0.45), r: 0.1 }],
    { radial: 8, cell: C.PALMBARK, color: [0.62, 0.5, 0.36], sway: () => 0.55, tint: 0 });
  // coconuts (PLAIN cell, vertex coloured)
  for (let k = 0; k < 9; k++) {
    const a = k * 2.4, c = top.clone().add(V3(Math.cos(a) * 0.3, -0.3 - 0.18 * (k % 3), Math.sin(a) * 0.3)), b0 = gb.p.length / 3;
    const cc = k % 4 === 0 ? [0.5, 0.42, 0.25] : [0.42, 0.52, 0.2];
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 6; j++) {
      const th = i / 4 * Math.PI, ph = j / 6 * 6.283, n = V3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
      gb.vert(c.clone().addScaledVector(n, 0.14).setY(c.y + n.y * 0.16), n, 0, 0, C.PLAIN, cc, [0.55, 0, 0]);
    }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) gb.quad(b0 + i * 7 + j, b0 + i * 7 + j + 1, b0 + (i + 1) * 7 + j + 1, b0 + (i + 1) * 7 + j);
  }
  const ctr = top.clone().add(V3(0, -0.8, 0)), nFn = crownNormal(ctr, 0.55, 0.6);
  const NF = 21;
  for (let f = 0; f < NF; f++) {
    const dead = f >= NF - 3, age = f / (NF - 1), az = f * 2.39996 + R() * 0.3;
    const el = dead ? -1.0 : 1.05 - 1.25 * age + (R() - 0.5) * 0.15, L = (dead ? 3.4 : 4.6) * (0.85 + R() * 0.25);
    const d0 = V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const side = V3().crossVectors(d0, V3(0, 1, 0)).normalize(), sag = dead ? 0.3 : 0.6 + 1.9 * age;
    const col = dead ? [1.15, 0.85, 0.55] : [0.92 + 0.15 * age, 1, 0.9 - 0.1 * age];
    const base = top.clone().addScaledVector(d0, 0.15), S = 8, rows = [];
    for (let k = 0; k <= S; k++) {
      const t = k / S, p = base.clone().addScaledVector(d0, L * t); p.y -= sag * t * t;
      const w = (dead ? 0.35 : 0.85) * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)), dropW = w * (dead ? 0.9 : 0.4);
      const l = p.clone().addScaledVector(side, w).setY(p.y - dropW), r = p.clone().addScaledVector(side, -w).setY(p.y - dropW);
      rows.push([l, p, r]);
    }
    for (let h = 0; h < 2; h++) {
      const b0 = gb.p.length / 3;
      for (let k = 0; k <= S; k++) {
        const [l, p, r] = rows[k], e = h ? r : l, t = k / S;
        const nz = V3(0, 1, 0);
        gb.vert(p, nFn(p, nz), 0.02, 0.01 + 0.98 * t, C.FROND, col, [0.45 + 0.55 * t, 1, 1]);
        gb.vert(e, nFn(e, nz), 0.99, 0.01 + 0.98 * t, C.FROND, col, [0.45 + 0.55 * t, 1, 1]);
      }
      for (let k = 0; k < S; k++) gb.quad(b0 + k * 2, b0 + k * 2 + 1, b0 + k * 2 + 3, b0 + k * 2 + 2);
    }
  }
  return gb.geometry();
}

function bush({ seed = 5 } = {}) {
  const R = makeRng(seed), gb = new GB(), ctr = V3(0, 0.45, 0), nFn = crownNormal(ctr, 0.8, 0.3);
  for (let s = 0; s < 4; s++) {
    const d = randDir(R, 1.2); d.y = Math.abs(d.y) + 0.8; d.normalize();
    gb.tube([{ p: V3(0, -0.1, 0), r: 0.035 }, { p: d.clone().multiplyScalar(0.5), r: 0.022 }, { p: d.clone().multiplyScalar(0.9), r: 0.01 }],
      { radial: 3, color: [0.7, 0.62, 0.55], sway: t => 0.3 * t, tint: 0.1 });
  }
  for (let k = 0; k < 95; k++) {
    const dir = randDir(R, 0.5); dir.y = Math.abs(dir.y) * 0.9 + 0.05;
    const rr = 0.45 + 0.6 * Math.sqrt(R());
    const at = V3(dir.x * rr * 1.1, 0.12 + dir.y * rr * 0.95, dir.z * rr * 1.1);
    const up = dir.clone().add(randDir(R, 0.5).multiplyScalar(0.6)).normalize(), rt = V3().crossVectors(up, randDir(R)).normalize();
    const w = 0.55 + R() * 0.35;
    gb.card(at.clone().addScaledVector(up, -w * 0.45), rt, up, w, w, C.BUSH, R() < 0.5 ? CARD : [CARD[2], CARD[1], CARD[0], CARD[3]],
      p => { const s = (0.5 + 0.5 * Math.min(1, p.distanceTo(ctr) / 0.9)) * (0.6 + 0.4 * Math.min(1, p.y / 0.9)) * (0.85 + 0.3 * R()); return [s, s, s]; },
      p => [0.15 + 0.5 * Math.min(1, p.y), 0.9, 1], nFn);
  }
  return gb.geometry();
}

function fern({ seed = 13 } = {}) {
  const R = makeRng(seed), gb = new GB(), N = 13;
  for (let f = 0; f < N; f++) {
    const az = f * 2.4 + R() * 0.4, el = 0.55 + R() * 0.7, L = 0.8 + R() * 0.55, S = 6;
    const d = V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const side = V3().crossVectors(d, V3(0, 1, 0)).normalize(), b0 = gb.p.length / 3, roll = (R() - 0.5) * 0.5;
    for (let k = 0; k <= S; k++) {
      const t = k / S, p = d.clone().multiplyScalar(L * t); p.y -= 0.55 * L * t * t * (1.2 - el * 0.5);
      const w = 0.22 * L, sd = side.clone().applyAxisAngle(d, roll);
      const lum = 0.7 + 0.3 * t;
      const nrm = V3().crossVectors(sd, d).normalize(); if (nrm.y < 0) nrm.negate(); nrm.y += 0.6; nrm.normalize();
      gb.vert(p.clone().addScaledVector(sd, -w).setY(p.y - 0.04), nrm, 0.02, 0.01 + 0.98 * t, C.FERN, [lum, lum, lum], [t, 1, 1]);
      gb.vert(p.clone().addScaledVector(sd, w).setY(p.y - 0.04), nrm, 0.98, 0.01 + 0.98 * t, C.FERN, [lum, lum, lum], [t, 1, 1]);
    }
    for (let k = 0; k < S; k++) gb.quad(b0 + k * 2, b0 + k * 2 + 1, b0 + k * 2 + 3, b0 + k * 2 + 2);
  }
  return gb.geometry();
}

// flower-bed clump: criss-crossed foliage cards + marigold/rose heads (top + side cards)
function flowers({ seed = 11 } = {}) {
  const R = makeRng(seed), gb = new GB(), ctr = V3(0, 0.1, 0), nFn = crownNormal(ctr, 0.6, 0.5);
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05 + R() * 0.4, rt = V3(Math.cos(a), 0, Math.sin(a)), up = V3((R() - 0.5) * 0.3, 1, (R() - 0.5) * 0.3).normalize();
    const w = 0.45 + R() * 0.2, off = V3((R() - 0.5) * 0.25, -0.02, (R() - 0.5) * 0.25);
    gb.card(off, rt, up, w, w * 0.95, C.FLEAF, CARD, (p, y) => { const s = 0.55 + 0.45 * y; return [s, s, s]; }, (p, y) => [y * 0.6, 0.8, 0], nFn);
  }
  const Q = [[0.004, 0.504, 0.496, 0.996], [0.504, 0.504, 0.996, 0.996], [0.004, 0.62, 0.496, 0.996], [0.504, 0.62, 0.996, 0.996]];
  const QS = [[0.004, 0.004, 0.496, 0.496], [0.504, 0.004, 0.996, 0.496]];
  for (let k = 0; k < 9; k++) {
    const rose = k % 3 === 2, a = R() * 6.28, d = 0.05 + 0.2 * Math.sqrt(R());
    const c = V3(Math.cos(a) * d, 0.34 + 0.2 * R(), Math.sin(a) * d), s = (rose ? 0.11 : 0.09) + R() * 0.04;
    const tilt = randDir(R, 1.6); tilt.y = Math.abs(tilt.y) + 2; tilt.normalize();
    const rt = V3().crossVectors(tilt, V3(1, 0, 0)).normalize(), fw = V3().crossVectors(rt, tilt);
    // top view: card lying across the head
    gb.card(c.clone().addScaledVector(fw, -s / 2), rt, fw, s, s, C.HEADS, Q[rose ? 1 : 0], [1, 1, 1], [0.9, 0.5, 1], () => tilt);
    for (let j = 0; j < 2; j++) { // side views
      const ang = a + j * Math.PI / 2, srt = V3(Math.cos(ang), 0, Math.sin(ang));
      gb.card(c.clone().add(V3(0, -s * 0.55, 0)), srt, V3(0, 1, 0), s, s * 1.0, C.HEADS, QS[rose ? 1 : 0], [0.92, 0.92, 0.92], (p, y) => [0.9, 0.5, y > 0.3 ? 1 : 0.0], nFn);
    }
  }
  return gb.geometry();
}

// weathered boulder: welded icosphere, fbm-displaced, smooth normals, flattened buried base; triplanar rock in the shader
function boulder({ seed = 9 } = {}) {
  const ico = new THREE.IcosahedronGeometry(1, 3), P = ico.attributes.position, map = new Map(), pos = [], idx = [];
  for (let i = 0; i < P.count; i++) {
    const key = `${P.getX(i).toFixed(4)},${P.getY(i).toFixed(4)},${P.getZ(i).toFixed(4)}`;
    let j = map.get(key);
    if (j === undefined) { j = pos.length / 3; map.set(key, j); pos.push(P.getX(i), P.getY(i), P.getZ(i)); }
    idx.push(j);
  }
  ico.dispose();
  const R = makeRng(seed), o = [R() * 50, R() * 50], n = pos.length / 3, col = [], fl = [], uv = [], cell = [];
  const [cu, cv] = cellOrigin(C.ROCK);
  for (let i = 0; i < n; i++) {
    let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const big = fbm(x * 0.9 + o[0], y * 0.9 + z * 0.7 + o[1], 3), fine = fbm(x * 3.1 + z * 2 + o[1], y * 3.3 + o[0], 3);
    let k = 1 + 0.32 * big + 0.07 * fine;
    const facet = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)); k *= 0.8 + 0.2 / Math.max(0.6, facet); // blocky, weathered
    x *= k * 1.3; y *= k * 0.75; z *= k;
    if (y < -0.2) y = -0.2 + (y + 0.2) * 0.3;
    pos[i * 3] = x; pos[i * 3 + 1] = y + 0.3; pos[i * 3 + 2] = z;
    const ao = Math.min(1, 0.55 + 0.6 * (y + 0.2)), moss = Math.max(0, y) * 0.25;
    col.push(0.62 * ao * (1 - moss * 0.3), 0.6 * ao, 0.55 * ao * (1 - moss)); fl.push(0, 0, 1); uv.push(0, 0); cell.push(cu, cv);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aCell', new THREE.Float32BufferAttribute(cell, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aFlora', new THREE.Float32BufferAttribute(fl, 3));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

// grass clump: 7 two-segment tapered blades, normals bent up
function grass({ seed = 19, blades = 7 } = {}) {
  const R = makeRng(seed), gb = new GB(), up = V3(0, 1, 0);
  for (let b = 0; b < blades; b++) {
    const a = R() * 6.28, r = 0.04 + 0.22 * R(), h = 0.3 + 0.38 * R(), w = 0.035 + 0.02 * R(), lean = 0.2 + 0.3 * R();
    const base = V3(Math.cos(a) * r, 0, Math.sin(a) * r), dir = V3(Math.cos(a), 0, Math.sin(a)), tan = V3(-dir.z, 0, dir.x);
    const b0 = gb.p.length / 3, u = R() * 0.8;
    for (let k = 0; k <= 2; k++) {
      const t = k / 2, p = base.clone().addScaledVector(dir, lean * h * t * t).setY(h * t), ww = w * (1 - t * 0.95);
      const n = V3().crossVectors(tan, V3(0, 1, 0)).multiplyScalar(0.4).add(up).normalize(), s = 0.55 + 0.45 * t;
      gb.vert(p.clone().addScaledVector(tan, -ww), n, u, t * 0.99, C.GRASS, [s, s, s], [t, 0.8, 1]);
      gb.vert(p.clone().addScaledVector(tan, ww), n, u + 0.15, t * 0.99, C.GRASS, [s, s, s], [t, 0.8, 1]);
    }
    gb.quad(b0, b0 + 1, b0 + 3, b0 + 2); gb.quad(b0 + 2, b0 + 3, b0 + 5, b0 + 4);
  }
  return gb.geometry();
}

/* ---------- material ---------- */
const SWAY = `{
  mat4 im = modelMatrix;
  #ifdef USE_INSTANCING
    im = modelMatrix * instanceMatrix;
  #endif
  vec3 ip = im[3].xyz;
  float ph = ip.x * 0.21 + ip.z * 0.17;
  float gust = 0.55 + 0.45 * sin(uTime * 0.7 + ph * 0.3) * sin(uTime * 0.31 + ph * 0.11);
  float k = aFlora.x * aFlora.x;
  vec3 w = vec3(uWind.x, 0.0, uWind.y) * (0.3 * gust + 0.08 * sin(uTime * 1.9 + ph + position.y * 0.4));
  // leaf flutter: small, fast, per-card phase
  w += vec3(sin(uTime * 5.3 + ph * 3.0 + position.x * 2.1), 0.5 * sin(uTime * 6.1 + position.y * 2.7),
            cos(uTime * 4.7 + ph * 2.0 + position.z * 2.3)) * 0.035 * aFlora.y * (0.5 + gust);
  w *= k;
  mat3 R3 = mat3(im);
  float s2 = dot(R3[0], R3[0]);
  transformed += (transpose(R3) * w) / max(s2, 1e-4) * sqrt(s2);
}`;
// distance LOD: past ~90 m a growing share of foliage cards (by rank) collapse to their centre (no raster cost);
// the survivors grow so the crown keeps its coverage. Trunks/tubes and foreign geometry (w ≥ 1) never thin.
const LOD = `if (aPivot.w < 1.0) {
  vec4 lodO = vec4(0.0, 0.0, 0.0, 1.0);
  #ifdef USE_INSTANCING
    lodO = instanceMatrix * lodO;
  #endif
  float lodD = length((modelViewMatrix * lodO).xyz);
  float keep = mix(1.0, 0.3, smoothstep(90.0, 260.0, lodD));
  transformed = aPivot.w >= keep ? aPivot.xyz : aPivot.xyz + (transformed - aPivot.xyz) * min(1.7, inversesqrt(keep));
}`;
const VDECL = `attribute vec3 aFlora; attribute vec2 aCell; attribute vec4 aPivot; uniform float uTime; uniform vec2 uWind;
  varying float vLeaf; varying vec4 vAt; varying vec3 vTint; varying vec3 vObj; varying vec3 vObjN; varying mat3 vO2V;`;
const FDECL = `uniform vec3 uSunDir; uniform vec3 uSunCol; uniform sampler2D uAtlas; uniform sampler2D uData;
  varying float vLeaf; varying vec4 vAt; varying vec3 vTint; varying vec3 vObj; varying vec3 vObjN; varying mat3 vO2V;`;
// atlas sample with in-cell wrapping (explicit gradients → no seams), mip-aware alpha so far canopies stay full
const SAMPLE = `
  vec2 fAtG = vec2(0.248);
  vec2 fGx = dFdx(vAt.xy) * fAtG, fGy = dFdy(vAt.xy) * fAtG;
  bool fRock = abs(vAt.z - 0.25) + abs(vAt.w - 0.75) < 0.01;
  vec3 fBw = pow(abs(vObjN), vec3(4.0)); fBw /= dot(fBw, vec3(1.0));
  vec3 fP = vObj * 0.7, fPx = dFdx(fP) * 0.248, fPy = dFdy(fP) * 0.248;
  vec4 fTc, fTd; vec3 fBump = vec3(0.0);
  if (fRock) {
    vec2 o = vAt.zw + 0.002;
    vec4 cx = textureGrad(uAtlas, o + fract(fP.zy) * 0.246, fPx.zy, fPy.zy), dx = textureGrad(uData, o + fract(fP.zy) * 0.246, fPx.zy, fPy.zy);
    vec4 cy = textureGrad(uAtlas, o + fract(fP.xz) * 0.246, fPx.xz, fPy.xz), dy = textureGrad(uData, o + fract(fP.xz) * 0.246, fPx.xz, fPy.xz);
    vec4 cz = textureGrad(uAtlas, o + fract(fP.xy) * 0.246, fPx.xy, fPy.xy), dz = textureGrad(uData, o + fract(fP.xy) * 0.246, fPx.xy, fPy.xy);
    fTc = cx * fBw.x + cy * fBw.y + cz * fBw.z;
    vec2 nx = dx.xy * 2.0 - 1.0, ny = dy.xy * 2.0 - 1.0, nz = dz.xy * 2.0 - 1.0;
    fBump = vec3(0.0, nx.y, nx.x) * fBw.x + vec3(ny.x, 0.0, ny.y) * fBw.y + vec3(nz.x, nz.y, 0.0) * fBw.z;
    fTd = vec4(0.5, 0.5, 0.0, 1.0);
    fTd.b = dx.b * fBw.x + dy.b * fBw.y + dz.b * fBw.z;
  } else {
    vec2 cuv = vAt.zw + (0.004 + fract(vAt.xy) * 0.992) * 0.25;
    fTc = textureGrad(uAtlas, cuv, fGx, fGy); fTd = textureGrad(uData, cuv, fGx, fGy);
    float lod = log2(max(max(length(fGx), length(fGy)) * 2048.0, 1.0));
    fTc.a = min(1.0, fTc.a * (1.0 + lod * 0.28));
  }
  diffuseColor.rgb *= fTc.rgb * mix(vec3(1.0), vTint, fTd.b);
  diffuseColor.a *= fTc.a;`;
const NORMAL = `
  vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
  vec2 st0 = dFdx(vAt.xy), st1 = dFdy(vAt.xy);
  if (fRock) {
    normal = normalize(normal + vO2V * fBump * 1.2);
  } else {
    vec2 tn = fTd.xy * 2.0 - 1.0;
    vec3 q1p = cross(q1, normal), q0p = cross(normal, q0);
    vec3 T = q1p * st0.x + q0p * st1.x, B = q1p * st0.y + q0p * st1.y;
    float det = max(dot(T, T), dot(B, B)), sc = det == 0.0 ? 0.0 : inversesqrt(det);
    normal = normalize(T * sc * tn.x + B * sc * tn.y + normal * max(0.2, 1.0 - dot(tn, tn)));
  }`;

function patchVertex(sh, sway) {
  const A = atlas();
  sh.uniforms.uTime = U.uTime; sh.uniforms.uWind = U.uWind;
  sh.uniforms.uAtlas = { value: A.map }; sh.uniforms.uData = { value: A.data };
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\n' + VDECL)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vLeaf = aFlora.y; vAt = vec4(uv, aCell); vObj = position; vObjN = normal; vTint = vec3(1.0);
      #if defined(USE_INSTANCING_COLOR)
        vTint = mix(vec3(1.0), instanceColor.rgb, aFlora.z);
      #endif
      {
        mat3 o2v = mat3(modelViewMatrix);
        #ifdef USE_INSTANCING
          o2v = mat3(modelViewMatrix) * mat3(instanceMatrix);
        #endif
        vO2V = o2v;
      }
      ${LOD}
      ${sway ? SWAY : ''}`)
    .replace('#include <color_vertex>', `#include <color_vertex>
      #if defined(USE_COLOR) || defined(USE_INSTANCING_COLOR)
        vColor = vec3(1.0);
        #ifdef USE_COLOR
          vColor *= color.rgb;
        #endif
      #endif`);
}

const matCache = {};
export function floraMaterial({ sway = true, rough = 0.9 } = {}) {
  const key = sway + ':' + rough;
  if (matCache[key]) return matCache[key];
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uSunDir = U.uSunDir; sh.uniforms.uSunCol = U.uSunCol;
    patchVertex(sh, sway);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FDECL)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + SAMPLE)
      .replace('#include <normal_fragment_maps>', `
        #ifdef DOUBLE_SIDED
          if (vLeaf > 0.5) normal *= faceDirection; // foliage keeps its crown normal on both faces
        #endif
        ${NORMAL}`)
      .replace('#include <opaque_fragment>', `{
          vec3 Ls = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          vec3 Vd = normalize(vViewPosition);             // camera → fragment
          float thru = pow(max(dot(Vd, Ls), 0.0), 4.0);   // looking toward the sun through leaves
          float sunUp = smoothstep(-0.05, 0.15, uSunDir.y);
          float wrap = max(0.0, dot(normal, Ls) * 0.5 + 0.5);
          outgoingLight += diffuseColor.rgb * uSunCol * vLeaf * (0.06 * wrap + 0.9 * thru) * sunUp * 0.6;
        }
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'flora3' + key;
  matCache[key] = m;
  return m;
}
let depthMat = null;
function floraDepth() {
  if (depthMat) return depthMat;
  depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaTest: 0.5, side: THREE.DoubleSide });
  depthMat.onBeforeCompile = sh => {
    patchVertex(sh, true);
    sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', '');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FDECL)
      .replace('#include <map_fragment>', `#include <map_fragment>
        { vec2 g = vec2(0.248), gx = dFdx(vAt.xy) * g, gy = dFdy(vAt.xy) * g;
          bool rock = abs(vAt.z - 0.25) + abs(vAt.w - 0.75) < 0.01;
          vec2 cuv = vAt.zw + (0.004 + fract(vAt.xy) * 0.992) * 0.25;
          if (!rock) diffuseColor.a *= textureGrad(uAtlas, cuv, gx, gy).a * 1.3; }`);
  };
  depthMat.customProgramCacheKey = () => 'floradepth3';
  return depthMat;
}

const TREE = { shadow: true };
const DEF = {
  broadleaf: { make: () => tree({ seed: 1, H: 8.5, crownR: 3.5, cells: [[C.LEAF, 0.65], [C.LEAF2, 0.35]] }), sink: 0.25, scale: [0.85, 1.35], ...TREE,
    colors: [0x4f7a2e, 0x5d8a34, 0x6b8f3a, 0x46702c, 0x7a9440, 0x8a8f3a] },
  blossom: { make: () => tree({ seed: 2, H: 6.5, bole: 0.3, crownR: 3.1, prim: 7, cards: 480, size: [1.0, 1.6], cells: [[C.BLOSSOM, 1]] }),
    sink: 0.25, scale: [0.8, 1.2], ...TREE, colors: [0xf4a6bf, 0xf08fb0, 0xf7c0d2, 0xe98aa8] },
  marigold: { make: () => tree({ seed: 4, H: 7.5, bole: 0.34, crownR: 3.2, prim: 7, cards: 470, size: [1.1, 1.7], hang: 0.4,
    cells: [[C.AMALTAS, 1]] }), sink: 0.25, scale: [0.8, 1.2], ...TREE, colors: [0xf29a2e, 0xee8a22, 0xf4b040, 0xe57a1e] },
  pine: { make: () => pine({}), sink: 0.3, scale: [0.8, 1.5], ...TREE, colors: [0x2f5a37, 0x3a6440, 0x2c5030, 0x4a6a3a] },
  bush: { make: () => bush({}), sink: 0.12, scale: [0.6, 1.3], ...TREE, colors: [0x557a33, 0x62843a, 0x4a6e30, 0x708a3c] },
  boulder: { make: () => boulder({}), sink: 0.45, scale: [0.5, 2.2], sway: false, ...TREE, colors: [0xd8cfc0, 0xc2b8a8, 0xe0d4bc, 0xb0a898] },
  flowers: { make: () => flowers({}), sink: 0.03, scale: [0.7, 1.4], colors: [0xfff0f4, 0xffd23a, 0xff8fb0, 0xf4f0ff, 0xff9a3a] },
  fern: { make: () => fern({}), sink: 0.05, scale: [0.7, 1.3], colors: [0xffffff, 0xd8e8b0, 0xc8d8a0] },
  grass: { make: () => grass({}), sink: 0.02, scale: [0.7, 1.3], colors: [0xffffff] },
  palm: { make: () => palm({}), sink: 0.2, scale: [0.75, 1.3], ...TREE, colors: [0xffffff, 0xe8f0c8] }
};
export const KINDS = Object.keys(DEF);
const geoCache = {};
/** Shared geometry of a kind (vertex colour + aFlora + atlas uv/aCell), for custom instancing (terrain grass). */
export function kindGeometry(kind) { return geoCache[kind] || (geoCache[kind] = DEF[kind].make()); }

/* ---------- placement ---------- */

export function band(s0, s1, near, far, side = 'both') {
  return rng => {
    const s = s0 + rng() * (s1 - s0);
    const d = near + rng() * (far - near);
    const sg = side === 'left' ? -1 : side === 'right' ? 1 : (rng() < 0.5 ? -1 : 1);
    return { s, lateral: sg * d };
  };
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _sc = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0), _c = new THREE.Color(), _tl = new THREE.Quaternion(), _ax = new THREE.Vector3();

export function plant(ctx, opts) {
  const { kind, count, place, seed = kind, allowRoad = false, minHeight = -Infinity } = opts;
  const def = DEF[kind];
  if (!def) throw new Error('flora: unknown kind ' + kind);
  const geo = kindGeometry(kind);
  const [a, b] = opts.scale || def.scale;
  const sink = opts.sink ?? def.sink;
  const colors = (opts.colors || def.colors).map(h => new THREE.Color(h));
  const R = makeRng(typeof seed === 'string' ? seed + ':' + kind : seed);
  const mats = [], tints = [];
  const clearRoad = world.VERGE + 1;
  for (let i = 0; i < count; i++) {
    const at = place(R, i);
    if (!at) continue;
    const { s, lateral } = at;
    if (s < 0 || s > path.length) continue;
    if (!allowRoad && Math.abs(lateral) < clearRoad) continue;
    const y = world.heightSL(s, lateral);
    const w = world.waterAt(s);
    if (w !== null && w !== undefined && y < w + 0.3) continue;
    if (y < minHeight) continue;
    path.toWorld(s, lateral, _p);
    const sc = at.scale ?? (a + (b - a) * R());
    _p.y = y - sink * sc;
    _q.setFromAxisAngle(_up, at.yaw ?? R() * Math.PI * 2);
    // small random lean (not for tall trunks), so clumps and rocks don't all stand bolt upright
    // coconut palms lean hard and every which way (5–22°), which is most of what stops a row of them reading as clones
    const tilt = kind === 'boulder' ? 0.25 : kind === 'bush' || kind === 'fern' || kind === 'flowers' ? 0.12 : kind === 'palm' ? 0.09 + 0.3 * R() : 0.03;
    _ax.set(R() - 0.5, 0, R() - 0.5).normalize(); _q.premultiply(_tl.setFromAxisAngle(_ax, kind === 'palm' ? tilt : tilt * R()));
    _sc.setScalar(sc);
    if (kind === 'palm') _sc.y *= 0.7 + 0.75 * R();     // 7–18 m trunks from one 10 m model
    if (kind === 'boulder') _sc.set(sc * (0.8 + 0.4 * R()), sc * (0.7 + 0.5 * R()), sc * (0.8 + 0.4 * R()));
    mats.push(_m.compose(_p, _q, _sc).clone());
    tints.push(at.tint !== undefined ? new THREE.Color(at.tint) : colors[Math.floor(R() * colors.length)].clone()
      .multiplyScalar(0.88 + 0.24 * R()));
  }
  const mesh = new THREE.InstancedMesh(geo, floraMaterial({ sway: def.sway !== false, rough: kind === 'boulder' ? 0.92 : 0.78 }), Math.max(1, mats.length));
  mesh.count = mats.length;
  for (let i = 0; i < mats.length; i++) { mesh.setMatrixAt(i, mats[i]); mesh.setColorAt(i, tints[i]); }
  if (!mats.length) mesh.setColorAt(0, _c.set(1, 1, 1));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  if (def.shadow) { mesh.castShadow = true; mesh.customDepthMaterial = floraDepth(); }
  mesh.name = 'flora:' + kind;
  mesh.userData.tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3 * mats.length;
  return mesh;
}
/** debug: the generated atlas textures { map, data } */
export const _floraAtlas = () => atlas();
