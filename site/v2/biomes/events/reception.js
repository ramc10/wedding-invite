/* Reception by the Shore — Nov 17, 7 PM, seen at night.
 * Placement: core/timeline.js EVENTS.reception (deck spans lat[0]..lat[1], s ± len/2).
 * Scene-local frame: group at the deck centre, rotation.y = road heading, so
 * local -z = road-forward (the stage end), +x = toward the road, y = 0 is the deck top.
 * No THREE lights: night light is faked with a baked "warm fill" (per-vertex aLit
 * × uWarm added as emissive), emissive flames/bulbs, additive glow points and
 * additive light pools. 11 draw calls (+ the shared compound's own), island centrepiece included.
 * Laid out on SITES.reception's axis: arch at d0 → aisle → dance floor → moon-gate stage at stage.s. */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from '../../vendor/addons/utils/BufferGeometryUtils.js';
import { EVENTS, SITES, STOP } from '../../core/timeline.js';
import { buildCompound } from './compound.js';

const TEAK = 0x8a5a36, TEAK_D = 0x5e3b22, IVORY = 0xf3ece0, LINEN = 0xf7f3ec, CHAMP = 0xd9bf8a;
const WARM = new THREE.Color(0xffc68c);          // ~2700 K

/* ---------- geometry bucket: collect transformed parts, merge once per material ---------- */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
function bucket() {
  const parts = [];
  return {
    parts,
    /* add geo at (x,y,z) with rotation (rx,ry,rz) and scale (sx,sy,sz), tinted col */
    add(geo, col, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
      let g = geo.index ? geo.toNonIndexed() : geo.clone();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
      g.applyMatrix4(_m);
      const c = new THREE.Color(col), n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3));
      parts.push(g);
      return g;
    },
    /* segment cylinder from a to b (Vector3s), radius r */
    rod(a, b, r, col, seg = 6) {
      const d = _p.subVectors(b, a), len = d.length();
      const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true).toNonIndexed();
      g.applyQuaternion(_q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
      g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      return this.add(g, col);
    },
    merge(litFn) {
      const g = mergeGeometries(this.parts, false);
      this.parts.forEach(p => p.dispose());
      if (litFn) {
        const pos = g.attributes.position, n = pos.count, a = new Float32Array(n);
        for (let i = 0; i < n; i++) a[i] = litFn(pos.getX(i), pos.getY(i), pos.getZ(i));
        g.setAttribute('aLit', new THREE.Float32BufferAttribute(a, 1));
      }
      g.computeBoundingSphere();
      return g;
    }
  };
}

/* warm fill: emissive += albedo × uWarm × aLit (aLit baked from the fake light rig) */
function warmPatch(mat, warmU, gain = 1, back = 1) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uWarm = warmU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLit;\nvarying float vLit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = aLit;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uWarm;\nvarying float vLit;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uWarm * (vLit * ${gain.toFixed(2)} * (gl_FrontFacing ? 1.0 : ${back.toFixed(2)}));`);
  };
  mat.customProgramCacheKey = () => 'rcpWarm' + gain + '/' + back;
  return mat;
}

/* ---------- canvas textures ---------- */
function teakTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  const W = 256 / 8;                                    // 8 boards across
  for (let b = 0; b < 8; b++) {
    const l = 0.86 + Math.random() * 0.2;
    g.fillStyle = `rgb(${200 * l | 0},${178 * l | 0},${160 * l | 0})`;
    g.fillRect(b * W, 0, W, 512);
    for (let k = 0; k < 14; k++) {                      // grain streaks along the board
      g.strokeStyle = `rgba(90,55,30,${0.05 + Math.random() * 0.08})`;
      g.lineWidth = 0.6 + Math.random() * 1.2;
      const x = b * W + 2 + Math.random() * (W - 4);
      g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y <= 512; y += 32) g.lineTo(x + Math.sin(y * 0.02 + k) * 1.5, y);
      g.stroke();
    }
    g.fillStyle = 'rgba(30,18,10,0.85)'; g.fillRect(b * W, 0, 1.5, 512);    // board gap
    const j = Math.random() * 512;                                         // butt joint
    g.fillRect(b * W, j, W, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function radialTexture(inner = 0.18) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(inner, 'rgba(255,255,255,0.5)');
  gr.addColorStop(0.55, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/* ---------- layout (local metres, from core/timeline.js SITES.reception) ----------
 * The group sits on the axis at the deck centre: x = lateral - ax, z = -(s - E.s). */
const SR = SITES.reception, ER = EVENTS.reception;
const HX = (SR.lat[0] - SR.lat[1]) / 2, HZ = ER.len / 2;   // deck half extents (x across, z along the road)
const zOf = s => -(s - ER.s);
const STAGE = { z0: zOf(SR.stage.s + SR.stage.depth / 2), z1: zOf(SR.stage.s - SR.stage.depth / 2), hx: 4.6, h: 0.36 };
const ZB = STAGE.z0 + 0.35;                                 // backdrop line
const DANCE = { z0: STAGE.z1 + 0.2, z1: STAGE.z1 + 3.8, hx: 3.0 };
const AISLE = SR.aisle / 2;
const TX = 3.55, TZ = [-1.5, 2.5, 6.5, 10.5];              // round tables, mirrored about the axis
const TABLES = TZ.flatMap(z => [[-TX, z], [TX, z]]);
const CANOPY = { x0: -6.0, x1: 6.0, z0: -3.5, z1: 12.4, peaks: [[0, 0.5], [0, 8.5]], hEdge: 2.75, hPeak: 6.3, mast: 6.4 };
const ENTRY = { x: 0, z: HZ - 0.45, w: 1.4 };             // arch at d0 on the axis, facing the forecourt (+z)
const SEA_STAIR_Z = zOf(SR.stage.s) + 5.3;                 // gap in the sea-side balustrade, lantern path to the water
const LIGHTS = [                              // fake light rig for the baked warm fill: [x,y,z, strength, radius]
  [0, 3.2, 0.5, 1.0, 7.0], [0, 3.2, 8.5, 1.0, 7.0],
  [0, 2.2, STAGE.z0 + 2.2, 1.15, 5.2], [0, 1.2, DANCE.z1, 0.5, 4], [-6.6, 1.0, 0, 0.3, 8], [6.6, 1.0, 0, 0.3, 8],
  [0, 1.8, ENTRY.z + 0.6, 0.7, 3.4], [0, 1.0, 6, 0.35, 5]
];
function litAt(x, y, z) {
  let v = 0.04;
  for (const [lx, ly, lz, k, r] of LIGHTS) {
    const d2 = (x - lx) ** 2 + (y - ly) ** 2 * 0.6 + (z - lz) ** 2;
    v += k * Math.exp(-d2 / (r * r));
  }
  return Math.min(v, 1.4);
}

/* ---------- deck, posts, fascia, steps, stage, dance floor, balustrade ---------- */
function buildDeck(K) {
  const { tk, iv, gd, gl, groundY } = K;
  const box = new THREE.BoxGeometry(1, 1, 1);
  // deck boards: one slab, planks come from the texture (board lines run along z)
  const top = tk.add(box, 0xffffff, 0, -0.06, 0, 0, 0, 0, HX * 2, 0.12, HZ * 2);
  const uv = top.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * HX * 2 / 1.12, uv.getY(i) * HZ * 2 / 2.3);
  // fascia board (slim, darker) round the edge
  const fh = 0.26;
  tk.add(box, TEAK_D, 0, -fh / 2, -HZ - 0.02, 0, 0, 0, HX * 2 + 0.08, fh, 0.04);
  tk.add(box, TEAK_D, 0, -fh / 2, HZ + 0.02, 0, 0, 0, HX * 2 + 0.08, fh, 0.04);
  tk.add(box, TEAK_D, -HX - 0.02, -fh / 2, 0, 0, 0, 0, 0.04, fh, HZ * 2);
  tk.add(box, TEAK_D, HX + 0.02, -fh / 2, 0, 0, 0, 0, 0.04, fh, HZ * 2);
  // posts on a ~2.5 m grid down to the sand, plus bearers under the joists
  const post = new THREE.BoxGeometry(0.2, 1, 0.2);
  for (let x = -HX + 0.25; x <= HX; x += 2.2) for (let z = -HZ + 0.3; z <= HZ; z += 2.45) {
    const gy = groundY(x, z) - 0.3, h = -0.2 - gy;
    if (h > 0.05) tk.add(post, TEAK_D, x, gy + h / 2, z, 0, 0, 0, 1, h, 1);
  }
  for (let x = -HX + 0.25; x <= HX; x += 2.2) tk.add(box, TEAK_D, x, -0.22, 0, 0, 0, 0, 0.16, 0.2, HZ * 2 - 0.2);
  // stage: low teak platform with a darker skirt, ivory carpet on top
  const S = STAGE, sz = (S.z0 + S.z1) / 2, sl = S.z1 - S.z0;
  tk.add(box, TEAK_D, 0, S.h / 2, sz + 0.1, 0, 0, 0, S.hx * 2, S.h, sl - 0.2);
  iv.add(box, LINEN, 0, S.h + 0.01, sz + 0.15, 0, 0, 0, S.hx * 2 - 0.3, 0.02, sl - 0.5);
  tk.add(box, TEAK, 0, S.h / 4, S.z1 + 0.17, 0, 0, 0, 3.0, S.h / 2, 0.34);                 // one step up
  // dance floor: polished ivory panels with fine champagne seams
  const D = DANCE, dz = (D.z0 + D.z1) / 2, dl = D.z1 - D.z0;
  iv.add(box, 0xfbf6ee, 0, 0.012, dz, 0, 0, 0, D.hx * 2, 0.024, dl);
  for (let x = -D.hx + 1; x < D.hx; x += 1) gd.add(box, CHAMP, x, 0.026, dz, 0, 0, 0, 0.02, 0.004, dl);
  for (let z = D.z0 + 0.95; z < D.z1; z += 0.95) gd.add(box, CHAMP, 0, 0.026, z, 0, 0, 0, D.hx * 2, 0.004, 0.02);
  // glass balustrade: sea side and both ends, slim brass posts and a brass cap rail
  // glass balustrade round the deck, mirrored about the axis: open under the arch; the sea stair's gap on the left
  const e = HX - 0.08, f = HZ - 0.08, gw = ENTRY.w + 0.9, H = 1.0, runs = [
    [[-e, -f], [-e, SEA_STAIR_Z - 1.0]], [[-e, SEA_STAIR_Z + 1.0], [-e, f]], [[e, -f], [e, f]],
    [[-e, f], [-gw, f]], [[gw, f], [e, f]], [[-e, -f], [e, -f]]
  ];
  for (const [a, b] of runs) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / 1.5));
    const ry = Math.atan2(b[0] - a[0], b[1] - a[1]);
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      gd.add(box, CHAMP, x, H / 2, z, 0, 0, 0, 0.05, H, 0.05);
      if (i < n) gl.add(box, 0xffffff, x + (b[0] - a[0]) / n / 2, H * 0.47, z + (b[1] - a[1]) / n / 2, 0, ry, 0, 0.012, H * 0.86, len / n - 0.08);
    }
    gd.add(box, CHAMP, (a[0] + b[0]) / 2, H + 0.02, (a[1] + b[1]) / 2, 0, ry, 0, 0.07, 0.04, len + 0.05);
  }
  // sea stair down to the sand
  const sandY = groundY(-HX - 1.2, SEA_STAIR_Z), nS = Math.max(1, Math.round(-sandY / 0.18));
  for (let i = 1; i <= nS; i++) tk.add(box, TEAK, -HX - i * 0.3 + 0.1, sandY * i / nS - 0.06 + 0.0, SEA_STAIR_Z, 0, 0, 0, 0.32, 0.12, 1.8);
}

/* ---------- sailcloth stretch tent: scalloped edges, peaked poles ---------- */
function canopyGeometry(tier) {
  const C = CANOPY, NU = tier === 'low' ? 26 : tier === 'med' ? 34 : 42, NV = Math.round(NU * 1.6);
  const SPX = 3, SPZ = 3, pull = 0.75, lift = 0.6, R = 5.4;
  const pos = [], idx = [];
  const frac = t => t - Math.floor(t);
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
    const u = i / NU, v = j / NV;
    let x = C.x0 + u * (C.x1 - C.x0), z = C.z0 + v * (C.z1 - C.z0), y = C.hEdge;
    // scallops: each edge span curves inward and lifts between its poles (tension)
    const su = Math.sin(Math.PI * frac(v * SPZ)), sv = Math.sin(Math.PI * frac(u * SPX));
    const wu0 = Math.max(0, 1 - u / 0.22) ** 2, wu1 = Math.max(0, 1 - (1 - u) / 0.22) ** 2;
    const wv0 = Math.max(0, 1 - v / 0.22) ** 2, wv1 = Math.max(0, 1 - (1 - v) / 0.22) ** 2;
    x += pull * su * (wu0 - wu1); z += pull * sv * (wv0 - wv1);
    y += lift * (su * Math.max(wu0, wu1) + sv * Math.max(wv0, wv1));
    let pk = 0;
    for (const [px, pz] of C.peaks) {
      const r = Math.sqrt((x - px) ** 2 + (z - pz) ** 2 + 0.04) / R;
      if (r < 1) pk = Math.max(pk, (1 - r) ** 2.1);
    }
    y += (C.hPeak - C.hEdge) * pk / (1 - 0.04 / R) ** 2.1 * 0.93;
    pos.push(x, y, z);
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = pos.length / 3, lit = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const y = pos[k * 3 + 1];
    lit[k] = 0.55 + 0.45 * Math.min(1, litAt(pos[k * 3], 3.0, pos[k * 3 + 2])) + 0.25 * (1 - (y - C.hEdge) / (C.hPeak - C.hEdge));
  }
  g.setAttribute('aLit', new THREE.Float32BufferAttribute(lit, 1));
  g.computeBoundingSphere();
  // pole positions: peaks + every scallop tip on the rim
  const poles = [];                       // the peaks hang from mast cables (nothing stands in the aisle)
  for (let k = 0; k <= SPZ; k++) {
    const z = C.z0 + (C.z1 - C.z0) * k / SPZ;
    poles.push([C.x0, z, C.hEdge + 0.12], [C.x1, z, C.hEdge + 0.12]);
  }
  for (let k = 1; k < SPX; k++) {
    const x = C.x0 + (C.x1 - C.x0) * k / SPX;
    poles.push([x, C.z0, C.hEdge + 0.12], [x, C.z1, C.hEdge + 0.12]);
  }
  return { geo: g, poles };
}

/* ---------- dining: round tables in floor-length linen, gold chiavari chairs, low centrepieces ---------- */
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function rotY(x, z, a) { const c = Math.cos(a), s = Math.sin(a); return [x * c + z * s, -x * s + z * c]; }
function chair(K, cx, cz, a) {            // a: facing angle (chair front looks along local +z rotated by a)
  const { gd, iv } = K, P = (x, y, z) => { const [rx, rz] = rotY(x, z, a); return V(cx + rx, y, cz + rz); };
  const r = 0.013, G = CHAMP;
  for (const [x, z] of [[-0.19, 0.18], [0.19, 0.18], [-0.18, -0.18], [0.18, -0.18]]) gd.rod(P(x * 1.08, 0, z * 1.08), P(x, 0.45, z), r, G, 4);
  gd.rod(P(-0.18, 0.45, -0.18), P(-0.17, 0.93, -0.22), r, G, 4); gd.rod(P(0.18, 0.45, -0.18), P(0.17, 0.93, -0.22), r, G, 4);
  gd.rod(P(-0.17, 0.93, -0.22), P(0.17, 0.93, -0.22), r * 1.2, G, 4);
  gd.rod(P(-0.18, 0.6, -0.19), P(0.18, 0.6, -0.19), r, G, 4);
  for (const x of [-0.07, 0, 0.07]) gd.rod(P(x, 0.6, -0.19), P(x, 0.93, -0.22), r * 0.7, G, 4);
  gd.rod(P(-0.2, 0.2, 0.19), P(0.2, 0.2, 0.19), r * 0.8, G, 4); gd.rod(P(-0.2, 0.2, -0.19), P(0.2, 0.2, -0.19), r * 0.8, G, 4);
  gd.add(K.box, G, cx, 0.45, cz, 0, a, 0, 0.42, 0.03, 0.4);
  iv.add(K.box, IVORY, cx, 0.485, cz, 0, a, 0, 0.4, 0.045, 0.38);             // seat cushion
}
function buildDining(K, tier) {
  const { iv, em, gl } = K, seg = tier === 'low' ? 16 : 24;
  const cloth = new THREE.LatheGeometry([V(0, 0.765, 0), V(0.9, 0.765, 0), V(0.93, 0.745, 0), V(0.94, 0.6, 0), V(0.97, 0.12, 0), V(1.0, 0.004, 0)], seg);
  const votive = new THREE.CylinderGeometry(0.035, 0.032, 0.09, 8, 1, true);
  const flame = new THREE.SphereGeometry(0.014, 5, 4);
  const plate = new THREE.CylinderGeometry(0.13, 0.13, 0.008, 12);
  for (const [tx, tz] of TABLES) {
    iv.add(cloth, LINEN, tx, 0, tz);
    const nc = tier === 'low' ? 6 : 8;
    for (let k = 0; k < nc; k++) {
      const a = (k + 0.5) / nc * Math.PI * 2, px = tx + Math.sin(a) * 1.28, pz = tz + Math.cos(a) * 1.28;
      chair(K, px, pz, a + Math.PI);
      iv.add(plate, 0xffffff, tx + Math.sin(a) * 0.7, 0.772, tz + Math.cos(a) * 0.7);
      K.gd.add(plate, CHAMP, tx + Math.sin(a) * 0.7, 0.768, tz + Math.cos(a) * 0.7, 0, 0, 0, 1.12, 0.5, 1.12);   // gold charger
    }
    // centrepiece: a low mound of white roses and blush, a few leaves, three votives
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.22;
      const col = k < 3 ? 0x6f7f5a : k < 5 ? 0xf1d8d6 : 0xfbf8f2;
      K.flowers.push([tx + Math.cos(a) * r, 0.81 + (0.22 - r) * 0.35, tz + Math.sin(a) * r, k < 3 ? 0.045 : 0.05 + Math.random() * 0.015, col]);
    }
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * Math.PI * 2 + 0.4, x = tx + Math.cos(a) * 0.36, z = tz + Math.sin(a) * 0.36;
      gl.add(votive, 0xffffff, x, 0.815, z);
      em.add(flame, 0xffc27a, x, 0.83, z, 0, 0, 0, 1, 1.6, 1);
      K.glows.push([x, 0.84, z, 0.13, 1]);
    }
    K.pools.push([tx, 0.772, tz, 0.75, 0.5]);
  }
}

/* ---------- stage: floral moon-gate backdrop, pampas, couple's armchairs, tall candle stands ---------- */
function armchair(K, x, z) {
  const { iv, box } = K, y = STAGE.h;
  iv.add(box, IVORY, x, y + 0.22, z, 0, 0, 0, 0.72, 0.44, 0.66);           // base
  iv.add(box, 0xfbf7ef, x, y + 0.47, z + 0.04, 0, 0, 0, 0.56, 0.1, 0.56);   // seat cushion
  iv.add(box, IVORY, x, y + 0.78, z - 0.28, -0.12, 0, 0, 0.72, 0.72, 0.14); // back
  for (const s of [-1, 1]) iv.add(box, IVORY, x + s * 0.33, y + 0.6, z + 0.02, 0, 0, 0, 0.12, 0.3, 0.62);
  K.gd.add(box, CHAMP, x, y + 0.02, z, 0, 0, 0, 0.74, 0.04, 0.68);
}
function pampas(K, x, y, z, n, spread, h) {
  const plume = K.plume;
  for (let k = 0; k < n; k++) {
    const a = (k / (n - 1) - 0.5) * spread, hh = h * (0.8 + Math.random() * 0.35);
    K.iv.add(plume, 0xe6d6b8, x + Math.sin(a) * 0.1, y, z, (Math.random() - 0.5) * 0.25, 0, a, 1, hh, 1);
  }
}
function buildStage(K, tier) {
  const { iv, gd, gl, em, box } = K, y = STAGE.h, zb = ZB, zc = STAGE.z0 + 2.3;
  // backdrop: ivory panel wall with a flower-covered moon gate
  // pleated ivory drape on a slim brass frame (soft vertical folds catch the light)
  const drape = new THREE.PlaneGeometry(7.2, 3.3, tier === 'low' ? 48 : 96, 1), dp = drape.attributes.position;
  for (let i = 0; i < dp.count; i++) dp.setZ(i, 0.05 * Math.sin(dp.getX(i) * Math.PI / 0.22) + (dp.getY(i) < 0 ? 0.03 * Math.sin(dp.getX(i) * 7.1) : 0));
  drape.computeVertexNormals();
  iv.add(drape, 0xf2eadf, 0, y + 1.65, zb - 0.12);
  iv.add(box, 0xece4d6, 0, y + 1.65, zb - 0.22, 0, 0, 0, 7.2, 3.3, 0.04);        // backing
  gd.add(box, CHAMP, 0, y + 3.33, zb - 0.1, 0, 0, 0, 7.4, 0.05, 0.08);
  for (const s of [-1, 1]) gd.add(box, CHAMP, s * 3.66, y + 1.67, zb - 0.1, 0, 0, 0, 0.05, 3.34, 0.08);
  const nR = tier === 'low' ? 120 : tier === 'med' ? 180 : 260, R0 = 1.7, cy = y + 1.85;
  for (let k = 0; k < nR; k++) {
    const t = Math.random(), a = -0.32 * Math.PI + t * 1.64 * Math.PI;          // open at the bottom
    const r = R0 + (Math.random() - 0.5) * 0.42, depth = Math.random() * 0.22;
    const lower = Math.sin(a) < -0.5 ? 1.25 : 1;                                 // heavier clusters low
    const leaf = Math.random() < 0.3, col = leaf ? (Math.random() < 0.5 ? 0x4a5a40 : 0x6d7c5c) : Math.random() < 0.35 ? 0xefcfcd : Math.random() < 0.5 ? 0xfdfbf7 : 0xf6efe4;
    K.flowers.push([Math.cos(a) * r, cy + Math.sin(a) * r, zb + (leaf ? 0.0 : 0.08) + depth * (leaf ? 0.5 : 1), (leaf ? 0.12 : 0.085 + Math.random() * 0.06) * lower, col]);
  }
  for (const s of [-1, 1]) {                                                     // floor mounds at the gate's feet
    for (let k = 0; k < nR / 5; k++) K.flowers.push([s * (1.3 + Math.random() * 0.9), y + Math.random() * 0.55, zb + 0.1 + Math.random() * 0.45, 0.07 + Math.random() * 0.05, Math.random() < 0.3 ? 0xf1d8d6 : Math.random() < 0.2 ? 0x55654a : 0xfaf6ee]);
    pampas(K, s * 2.9, y, zb + 0.15, 9, 1.3, 2.2);
    pampas(K, s * 1.55, cy + 1.3, zb + 0.08, 5, 1.0, 0.9);
    armchair(K, s * 0.62, zc);
    // tall brass stands with glass hurricanes and pillar candles
    const sx = s * 3.55, sz = STAGE.z1 - 1.3;
    gd.rod(V(sx, y, sz), V(sx, y + 1.55, sz), 0.022, CHAMP, 8);
    gd.add(new THREE.CylinderGeometry(0.16, 0.2, 0.04, 14), CHAMP, sx, y + 0.02, sz);
    gd.add(new THREE.CylinderGeometry(0.12, 0.08, 0.05, 14), CHAMP, sx, y + 1.56, sz);
    gl.add(new THREE.CylinderGeometry(0.1, 0.1, 0.42, 14, 1, true), 0xffffff, sx, y + 1.8, sz);
    iv.add(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 10), 0xfff6e2, sx, y + 1.68, sz);
    em.add(K.flame, 0xffcf8a, sx, y + 1.815, sz, 0, 0, 0, 1.3, 2.2, 1.3);
    K.glows.push([sx, y + 1.83, sz, 0.22, 1]);
    K.pools.push([sx, y + 0.01, sz, 1.4, 0.5]);
  }
  K.pools.push([0, y + 0.01, zc, 3.2, 0.55], [0, 0.03, (DANCE.z0 + DANCE.z1) / 2, 3.4, 0.45]);
}

/* ---------- entrance: floral arch at the deck's near end, facing the court (+z) ---------- */
function buildEntrance(K, tier) {
  const { iv, box } = K, x0 = ENTRY.x, z = ENTRY.z, w = ENTRY.w, hp = 2.3;
  const pts = [V(x0 - w, 0, z), V(x0 - w, hp, z)];
  for (let k = 1; k <= 14; k++) { const a = Math.PI - k / 14 * Math.PI; pts.push(V(x0 + Math.cos(a) * w, hp + Math.sin(a) * w, z)); }
  pts.push(V(x0 + w, 0, z));
  for (let k = 0; k < pts.length - 1; k++) iv.rod(pts[k], pts[k + 1], 0.05, 0xefe8dc, 8);
  for (const s of [-1, 1]) iv.add(box, 0xefe8dc, x0 + s * w, 0.07, z, 0, 0, 0, 0.32, 0.14, 0.32);
  // flowers: an even drift up both pillars and over the crown (symmetric: it frames the axis)
  const n = tier === 'low' ? 90 : tier === 'med' ? 140 : 200;
  for (let k = 0; k < n; k++) {
    const t = Math.random();
    const f = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), q = pts[i].clone().lerp(pts[i + 1], f - i);
    if (q.y < 0.5 && Math.random() < 0.6) continue;
    const col = Math.random() < 0.08 ? 0x55654a : Math.random() < 0.28 ? 0xf1d8d6 : 0xfbf8f3;
    K.flowers.push([q.x + (Math.random() - 0.5) * 0.2, q.y + (Math.random() - 0.5) * 0.18, q.z + (Math.random() - 0.5) * 0.2, 0.05 + Math.random() * 0.04, col]);
  }
  for (const s of [-1, 1]) for (let k = 0; k < 16; k++)             // floor mounds at the pillars' feet
    K.flowers.push([x0 + s * (w + (Math.random() - 0.3) * 0.5), Math.random() * 0.4, z + (Math.random() - 0.5) * 0.5, 0.06 + Math.random() * 0.04, Math.random() < 0.25 ? 0xf1d8d6 : Math.random() < 0.15 ? 0x55654a : 0xfaf6ee]);
  for (const s of [-1, 1]) pampas(K, x0 + s * 0.55, hp + w - 0.3, z, 4, 0.9, 0.8);
  K.pools.push([x0, 0.01, z, 2.0, 0.5], [x0, 0.02, z - 2.2, 1.8, 0.35]);
  lantern(K, x0 - w - 0.5, 0, z + 0.1, 0.9); lantern(K, x0 + w + 0.5, 0, z + 0.1, 0.9);
}

/* ---------- aisle: linen runner with a champagne border, lanterns and posies lining it ---------- */
function buildAisle(K) {
  const { iv, gd, box } = K, z0 = DANCE.z1, z1 = HZ, zm = (z0 + z1) / 2, L = z1 - z0, rw = AISLE * 1.25;
  iv.add(box, 0xf6f0e4, 0, 0.006, zm, 0, 0, 0, rw, 0.012, L);
  for (const s of [-1, 1]) gd.add(box, CHAMP, s * (rw / 2 + 0.03), 0.007, zm, 0, 0, 0, 0.06, 0.014, L);
  for (let z = z1 - 2.2; z > z0 + 0.8; z -= 2.6) for (const s of [-1, 1]) {
    const x = s * (AISLE + 0.12);
    lantern(K, x, 0, z, 0.8);
    for (let k = 0; k < 5; k++) K.flowers.push([x + s * 0.12 + (Math.random() - 0.5) * 0.2, 0.05 + Math.random() * 0.1, z + 0.2 + (Math.random() - 0.5) * 0.35,
      0.05 + Math.random() * 0.03, k < 1 ? 0x55654a : k < 3 ? 0xf1d8d6 : 0xfbf8f2]);
  }
}

/* ---------- island centrepiece (forecourt, road coords): white roses, pampas, hurricane ring ---------- */
function buildIsland(K, ctx, group) {
  const { path } = ctx, I = SR.island, R = STOP.reception.route, polys = [R.in, R.out];
  const clear = (s, lat) => {                // metres to the nearest "Take me here" route segment
    let d = 1e9;
    for (const pl of polys) for (let i = 0; i < pl.length - 1; i++) {
      const [as, al] = pl[i], [bs, bl] = pl[i + 1], ds = bs - as, dl = bl - al;
      const t = Math.max(0, Math.min(1, ((s - as) * ds + (lat - al) * dl) / (ds * ds + dl * dl)));
      d = Math.min(d, Math.hypot(s - as - ds * t, lat - al - dl * t));
    }
    return Math.min(d, Math.hypot(s - SR.stop.s, lat - SR.stop.l) - 1.1);
  };
  // island-local frame: u along s, v along lateral (half-axes: the bed is an oval inside the island)
  const rs = Math.max(1.2, I.rs * 0.62), rl = Math.max(0.7, I.rl * 0.62);
  const L = (u, v, dy) => { const w = path.toWorld(I.s + u, I.l + v); w.y = path.roadY(I.s + u) + 0.012 + dy; return group.worldToLocal(w); };
  const ok = (u, v) => clear(I.s + u, I.l + v) > 2.45;
  // stone-edged bed, raised a hand's height, soil top
  const n = 36;
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI * 2, b = (k + 1) / n * Math.PI * 2;
    const pa = L(Math.cos(a) * rs, Math.sin(a) * rl, 0.09), pb = L(Math.cos(b) * rs, Math.sin(b) * rl, 0.09);
    const dx = pb.x - pa.x, dz = pb.z - pa.z;
    K.iv.add(K.box, 0xe6dccb, (pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2, 0, Math.atan2(-dz, dx), 0, Math.hypot(dx, dz) + 0.03, 0.18, 0.16);
  }
  const c = L(0, 0, 0.16);
  K.iv.add(new THREE.CylinderGeometry(1, 1, 0.06, 28), 0x3a2e24, c.x, c.y, c.z, 0, path.sample(I.s).heading - group.rotation.y, 0, rl - 0.05, 1, rs - 0.05);
  const HMAX = 1.45;
  // roses: a low dome of white and blush, highest at the centre (≤ 0.75 m), a few leaves
  const nR = K.tier === 'low' ? 110 : K.tier === 'med' ? 170 : 240;
  for (let k = 0; k < nR; k++) {
    const r = Math.sqrt(Math.random()) * 0.92, a = Math.random() * Math.PI * 2, u = Math.cos(a) * r * rs, v = Math.sin(a) * r * rl;
    const p = L(u, v, 0.2 + 0.55 * (1 - r * r) + Math.random() * 0.06), leaf = Math.random() < 0.18;
    K.flowers.push([p.x, p.y, p.z, leaf ? 0.08 : 0.065 + Math.random() * 0.04, leaf ? 0x4f5f44 : Math.random() < 0.22 ? 0xf1d8d6 : 0xfbf8f2]);
  }
  // pampas: a soft sheaf rising from the centre, capped below HMAX
  const pc = L(0, 0, 0.3);
  for (let k = 0; k < 11; k++) {
    const a = k / 11 * Math.PI * 2, tilt = 0.28 + Math.random() * 0.12;
    K.iv.add(K.plume, 0xe6d6b8, pc.x, pc.y, pc.z, Math.sin(a) * tilt, 0, Math.cos(a) * tilt, 1, (HMAX - 0.3) * (0.8 + Math.random() * 0.2), 1);
  }
  // a ring of glass hurricanes with pillar candles on the bed's rim
  const nH = 10;
  for (let k = 0; k < nH; k++) {
    const a = k / nH * Math.PI * 2 + 0.3, u = Math.cos(a) * (rs + 0.25), v = Math.sin(a) * (rl + 0.25);
    if (!ok(u, v)) continue;
    const p = L(u, v, 0), s = 1.1;
    K.gl.add(K.hurricane, 0xffffff, p.x, p.y + 0.23 * s, p.z, 0, 0, 0, s, s, s);
    K.iv.add(K.candle, 0xfff4de, p.x, p.y + 0.1, p.z, 0, 0, 0, 1.1, 1.3, 1.1);
    K.em.add(K.flame, 0xffc47a, p.x, p.y + 0.225, p.z, 0, 0, 0, 1.5, 2.5, 1.5);
    K.glows.push([p.x, p.y + 0.24, p.z, 0.3, 1]);
    K.pools.push([p.x, p.y, p.z, 0.9, 0.5]);
  }
  K.pools.push([c.x, c.y, c.z, Math.max(rs, rl) + 1.4, 0.35]);
  LIGHTS.push([c.x, c.y + 0.8, c.z, 0.7, Math.max(rs, rl) + 0.8]);
}

/* ---------- brass lanterns (glass panes, pillar candle) ---------- */
function lantern(K, x, y, z, s = 1) {
  const { gd, gl, iv, em, box } = K, w = 0.26 * s, h = 0.46 * s;
  gd.add(box, CHAMP, x, y + 0.03 * s, z, 0, 0, 0, w + 0.03, 0.06 * s, w + 0.03);
  for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) gd.add(box, CHAMP, x + a * w / 2, y + h / 2, z + b * w / 2, 0, 0, 0, 0.02 * s, h, 0.02 * s);
  gd.add(K.roof, CHAMP, x, y + h + 0.07 * s, z, 0, Math.PI / 4, 0, w * 0.78, 0.14 * s, w * 0.78);
  gd.add(K.ring, CHAMP, x, y + h + 0.19 * s, z, Math.PI / 2, 0, 0, s, s, s);
  gl.add(box, 0xffffff, x, y + h / 2 + 0.02 * s, z, 0, 0, 0, w - 0.01, h - 0.06 * s, w - 0.01);
  iv.add(K.candle, 0xfff4de, x, y + 0.06 * s + 0.08 * s, z, 0, 0, 0, s, s, s);
  em.add(K.flame, 0xffc47a, x, y + 0.25 * s, z, 0, 0, 0, 1.6 * s, 2.6 * s, 1.6 * s);
  K.glows.push([x, y + 0.26 * s, z, 0.36 * s, 1]);
  K.pools.push([x, y + 0.012, z, 0.95 * s + 0.2, 0.55]);
}
function buildLanterns(K) {
  // both long edges of the deck, mirrored (clear of the sea stair's gap and the tent masts)
  for (let z = -HZ + 1.6; z <= HZ - 1.2; z += 2.2) for (const s of [-1, 1]) {
    if (s < 0 && Math.abs(z - SEA_STAIR_Z) < 1.3) continue;
    if (CANOPY.peaks.some(([, pz]) => Math.abs(z - pz) < 0.7)) continue;
    lantern(K, s * (HX - 0.32), 0, z);
  }
  for (const s of [-1, 1]) for (let x = ENTRY.w + 1.6; x < HX - 0.5; x += 2.2) lantern(K, s * x, 0, HZ - 0.32);
  // down the sea stair and across the sand to the water's edge
  for (let k = 0; k < 4; k++) for (const s of [-1, 1]) {
    const x = -HX - 1.55 - k * 0.95, z = SEA_STAIR_Z + s * (0.95 + k * 0.08);
    lantern(K, x, K.groundY(x, z) + 0.1, z, 1.35);
  }
}

/* ---------- fairy lights: catenary swags from slim brass poles ---------- */
function buildFairy(K, tier) {
  // slim poles in mirrored pairs outside the tent: over the dance floor and at the arch end
  const px = HX - 0.15, zs = [DANCE.z0 - 0.4, CANOPY.z0 - 0.6, HZ - 0.6], H = 4.3;
  for (const x of [-px, px]) for (const z of zs) {
    K.gd.rod(V(x, 0, z), V(x, H + 0.12, z), 0.028, 0x3a342c, 6);
    K.gd.add(K.ring, CHAMP, x, H + 0.12, z, Math.PI / 2, 0, 0, 0.5, 0.5, 0.5);
  }
  const strands = [], rimY = CANOPY.hEdge - 0.12, rx = CANOPY.x1;
  // swags across the axis: over the dance floor (a pair crossed between them) and at the arch end
  for (const z of zs) strands.push([V(-px, H, z), V(px, H, z), 1.0]);
  strands.push([V(-px, H, zs[0]), V(px, H, zs[1]), 1.2], [V(-px, H, zs[1]), V(px, H, zs[0]), 1.2]);
  // under the canopy: across the axis between each pair of rim poles
  for (let k = 0; k <= 3; k++) {
    const z = CANOPY.z0 + (CANOPY.z1 - CANOPY.z0) * k / 3;
    strands.push([V(-rx, rimY, z), V(rx, rimY, z), 0.28]);
  }
  // along each side: perimeter poles to the tent's corner poles
  for (const s of [-1, 1]) {
    strands.push([V(s * px, H, zs[0]), V(s * px, H, zs[1]), 0.5], [V(s * px, H, zs[1]), V(s * rx, rimY + 0.2, CANOPY.z0), 0.3]);
    strands.push([V(s * rx, rimY + 0.2, CANOPY.z1), V(s * px, H, zs[2]), 0.35]);
  }
  const step = tier === 'low' ? 0.5 : tier === 'med' ? 0.38 : 0.28, wire = [];
  for (const [a, b, sag] of strands) {
    const len = a.distanceTo(b), n = Math.ceil(len / step);
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n, p = a.clone().lerp(b, t); p.y -= sag * 4 * t * (1 - t);
      if (prev) wire.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
      prev = p;
      if (i > 0 && i < n) { K.bulbs.push(p); K.glows.push([p.x, p.y - 0.02, p.z, 0.075, 0]); }
    }
  }
  K.wire = wire;
  K.pools.push([0, 0.02, 13.4, 3.5, 0.3], [0, 0.02, (zs[0] + zs[1]) / 2, 4.5, 0.25]);
}

/* ---------- glow points: additive sprites for bulbs, flames and washes (one draw) ---------- */
function glowPoints(glows, tex) {
  const n = glows.length, pos = new Float32Array(n * 3), size = new Float32Array(n), kind = new Float32Array(n), ph = new Float32Array(n);
  glows.forEach(([x, y, z, s, k], i) => { pos.set([x, y, z], i * 3); size[i] = s; kind[i] = k; ph[i] = Math.random() * 100; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex }, uTime: { value: 0 }, uOn: { value: 0 }, uPx: { value: 400 } },
    vertexShader: `attribute float aSize; attribute float aKind; attribute float aPh;
      uniform float uTime, uOn, uPx; varying float vI; varying vec3 vC;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float tw = aKind < 0.5 ? 0.78 + 0.22 * sin(uTime * (1.3 + fract(aPh) * 1.7) + aPh)
                 : aKind < 1.5 ? 0.86 + 0.08 * sin(uTime * 9.0 + aPh) + 0.06 * sin(uTime * 23.0 + aPh * 3.0) : 1.0;
        vI = uOn * tw * (aKind > 1.5 ? 0.22 : 1.0);
        vC = aKind < 0.5 ? vec3(1.0, 0.74, 0.42) * 0.85 : vec3(1.0, 0.64, 0.3);
        gl_PointSize = max(1.5, aSize * projectionMatrix[1][1] * uPx / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D uTex; varying float vI; varying vec3 vC;
      void main() { float a = texture2D(uTex, gl_PointCoord).r; a *= a; gl_FragColor = vec4(vC * a * vI, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const pts = new THREE.Points(g, mat);
  pts.name = 'reception-glow';
  return pts;
}
function lightPools(pools, tex) {
  const parts = [], q = new THREE.PlaneGeometry(1, 1).toNonIndexed();
  q.rotateX(-Math.PI / 2);
  for (const [x, y, z, r, k] of pools) {
    const g = q.clone(); g.scale(r * 2, 1, r * 2); g.translate(x, y + 0.015, z);
    const c = new Float32Array(g.attributes.position.count * 3).fill(k);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g);
  }
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffa860, vertexColors: true, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const m = new THREE.Mesh(mergeGeometries(parts), mat);
  m.name = 'reception-pools'; m.renderOrder = 2;
  return m;
}

export default {
  id: 'garden-beach',
  build(ctx) {
    const { path, world, quality } = ctx, tier = quality.tier, E = EVENTS.reception;
    const latC = SR.ax;
    const group = new THREE.Group();
    group.name = 'event-reception';
    // deck top level with the forecourt at the arch (SITES.md: road - 0.05 … road + 0.02)
    const P = path.toWorld(E.s, latC);
    const deckY = path.roadY(SR.d0) + 0.005;
    group.position.set(P.x, deckY, P.z);
    group.rotation.y = path.sample(E.s).heading;
    group.updateMatrixWorld(true);
    const K = {
      tk: bucket(), iv: bucket(), gd: bucket(), gl: bucket(), em: bucket(),
      flowers: [], glows: [], pools: [], bulbs: [], wire: [],
      groundY: (x, z) => world.heightSL(E.s - z, latC + x) - deckY,
      box: new THREE.BoxGeometry(1, 1, 1), flame: new THREE.SphereGeometry(0.014, 6, 4),
      roof: new THREE.ConeGeometry(1, 1, 4, 1), ring: new THREE.TorusGeometry(0.035, 0.008, 3, 6),
      candle: new THREE.CylinderGeometry(0.045, 0.045, 0.16, 8), hurricane: new THREE.CylinderGeometry(0.1, 0.1, 0.46, 14, 1, true), tier,
      plume: new THREE.LatheGeometry([V(0.006, 0, 0), V(0.008, 0.5, 0), V(0.03, 0.6, 0), V(0.055, 0.78, 0), V(0.035, 0.93, 0), V(0.001, 1, 0)], 5)
    };
    buildIsland(K, ctx, group);
    buildAisle(K);
    buildDeck(K);
    buildDining(K, tier);
    buildStage(K, tier);
    buildEntrance(K, tier);
    buildLanterns(K);
    buildFairy(K, tier);
    const canopy = canopyGeometry(tier);
    for (const [x, z, h] of canopy.poles) K.iv.rod(V(x, 0, z), V(x, h, z), 0.05, 0xe9e4da, 10);
    // tension rig: a mast either side of the tent for each peak, a cable from each mast head to the peak ring
    for (const [, pz] of CANOPY.peaks) {
      const top = V(0, CANOPY.hPeak + 0.2, pz);
      K.gd.add(new THREE.TorusGeometry(0.22, 0.03, 6, 20), CHAMP, 0, CANOPY.hPeak + 0.12, pz, Math.PI / 2, 0, 0);
      for (const sx of [-1, 1]) {
        const m = V(sx * CANOPY.mast, CANOPY.hPeak + 0.45, pz);
        K.iv.rod(V(m.x, 0, pz), m, 0.07, 0xe9e4da, 10);
        K.gd.add(K.ring, CHAMP, m.x, m.y + 0.02, pz, Math.PI / 2, 0, 0, 1.4, 1.4, 1.4);
        K.gd.rod(m, top, 0.012, 0x5a5048, 4);
        K.gd.rod(m, V(sx * (HX + 0.4), -0.2, pz), 0.01, 0x5a5048, 4);          // guy line down past the deck edge
      }
    }
    // brass candle chandeliers hung from the peak poles
    const hoop = new THREE.TorusGeometry(0.6, 0.016, 4, 28);
    for (const [cx, cz] of CANOPY.peaks) {
      const cy = 4.15;
      K.gd.add(hoop, CHAMP, cx, cy, cz, Math.PI / 2, 0, 0);
      K.gd.add(hoop, CHAMP, cx, cy - 0.18, cz, Math.PI / 2, 0, 0, 0.55, 0.55, 0.55);
      for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2; K.gd.rod(V(cx + Math.cos(a) * 0.6, cy, cz + Math.sin(a) * 0.6), V(cx, cy + 1.1, cz), 0.006, CHAMP, 3); }
      for (let k = 0; k < 10; k++) {
        const a = k / 10 * Math.PI * 2, x = cx + Math.cos(a) * 0.6, z = cz + Math.sin(a) * 0.6;
        K.iv.add(K.candle, 0xfff4de, x, cy + 0.07, z, 0, 0, 0, 0.5, 0.7, 0.5);
        K.em.add(K.flame, 0xffc47a, x, cy + 0.15, z, 0, 0, 0, 1.2, 2, 1.2);
        K.glows.push([x, cy + 0.16, z, 0.16, 1]);
      }
      K.pools.push([cx, 0.02, cz, 4.2, 0.35]);
    }

    const warmU = { value: new THREE.Color(0, 0, 0) };
    const teakMat = warmPatch(new THREE.MeshStandardMaterial({ map: teakTexture(), vertexColors: true, color: 0x74482a, roughness: 0.88 }), warmU, 1.3);
    const ivoryMat = warmPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 }), warmU, 1.0);
    const goldMat = warmPatch(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.75, roughness: 0.32 }), warmU, 0.9);
    const canopyU = { value: new THREE.Color(0, 0, 0) };
    const canopyMat = warmPatch(new THREE.MeshStandardMaterial({ color: LINEN, roughness: 0.95, side: THREE.DoubleSide }), canopyU, 1.0, 1.8);
    const flowerMat = warmPatch(new THREE.MeshStandardMaterial({ roughness: 0.78 }), warmU, 1.0);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xeef4f2, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.16, depthWrite: false, emissive: 0xffb36b, emissiveIntensity: 0 });
    const emMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff });
    const add = (geo, mat, name, order) => { const m = new THREE.Mesh(geo, mat); m.name = name; if (order) m.renderOrder = order; group.add(m); return m; };
    add(K.tk.merge(litAt), teakMat, 'reception-teak');
    add(K.iv.merge(litAt), ivoryMat, 'reception-ivory');
    add(K.gd.merge(litAt), goldMat, 'reception-brass');
    add(canopy.geo, canopyMat, 'reception-canopy');
    add(K.gl.merge(), glassMat, 'reception-glass', 3);
    const emMesh = add(K.em.merge(), emMat, 'reception-flames');

    // flowers: one instanced bloom (white roses, blush, a few leaves)
    const bloom = mergeVertices(new THREE.OctahedronGeometry(1, 1).deleteAttribute('normal').deleteAttribute('uv')); bloom.computeVertexNormals(); bloom.scale(1, 0.72, 1);
    const nF = K.flowers.length, fl = new THREE.InstancedMesh(bloom, flowerMat, nF), fLit = new Float32Array(nF), m4 = new THREE.Matrix4(), c = new THREE.Color();
    K.flowers.forEach(([x, y, z, r, col], i) => {
      m4.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(Math.random() * 0.8, Math.random() * 6.3, Math.random() * 0.8)), _s.set(r, r, r));
      fl.setMatrixAt(i, m4); fl.setColorAt(i, c.set(col)); fLit[i] = litAt(x, y, z);
    });
    bloom.setAttribute('aLit', new THREE.InstancedBufferAttribute(fLit, 1));
    fl.name = 'reception-flowers'; group.add(fl);

    // fairy bulbs + wires
    const bulbGeo = new THREE.OctahedronGeometry(0.018, 0), bulbMat = new THREE.MeshBasicMaterial({ color: 0x8c8a82 });
    const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, K.bulbs.length);
    K.bulbs.forEach((p, i) => bulbs.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
    bulbs.name = 'reception-bulbs'; group.add(bulbs);
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(K.wire, 3));
    const wire = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x2e2922, transparent: true, opacity: 0.55 }));
    wire.name = 'reception-wires'; group.add(wire);

    const tex = radialTexture();
    const glow = glowPoints(K.glows, tex); group.add(glow);
    const pools = lightPools(K.pools, tex); group.add(pools);

    const dayBulb = new THREE.Color(0x8c8a82), nightBulb = new THREE.Color(2.2, 1.7, 1.05), sz = new THREE.Vector2();
    // the compound (lawn, runway drive, road wall and gates) is built in road coords, so it sits beside the deck group
    const comp = buildCompound(ctx, 'reception', { drive: { base: '#e7dcc6', joint: '#b8a78a', accent: '#c7a878' },
      stone: 0xd8c6a2, cap: 0x7b5b3c, glow: 0xffc98e, seaWall: false });
    const outer = new THREE.Group(); outer.name = 'reception';
    outer.add(group, comp.group);
    return {
      group: outer,
      update(dt, s, cam) {
        comp.update(world.U.uDusk.value);
        const d = world.U.uDusk.value, on = THREE.MathUtils.smoothstep(d, 0.15, 0.8);
        warmU.value.copy(WARM).multiplyScalar(on * 0.42);
        canopyU.value.setRGB(1.0, 0.78, 0.55).multiplyScalar(on * 0.7);
        glassMat.emissiveIntensity = on * 0.06;
        emMat.color.setScalar(1 + on * 1.6); emMesh.visible = on > 0.02;
        bulbMat.color.copy(dayBulb).lerp(nightBulb, on);
        glow.visible = pools.visible = on > 0.02;
        glow.material.uniforms.uOn.value = on;
        glow.material.uniforms.uTime.value = world.U.uTime.value;
        ctx.renderer.getDrawingBufferSize(sz); glow.material.uniforms.uPx.value = sz.y * 0.5;
        pools.material.opacity = on * 0.85;
      }
    };
  }
};
