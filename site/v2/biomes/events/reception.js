/* Reception by the Shore — Nov 17, 7 PM, seen at night.
 * Placement: core/timeline.js EVENTS.reception (deck spans lat[0]..lat[1], s ± len/2).
 * Scene-local frame: group at the deck centre, rotation.y = road heading, so
 * local -z = road-forward (the stage end), +x = toward the road, y = 0 is the deck top.
 * No THREE lights: night light is faked with a baked "warm fill" (per-vertex aLit
 * × uWarm added as emissive), emissive flames/bulbs, additive glow points and
 * additive light pools. 11 draw calls, the forecourt included (merged into the ivory,
 * brass, flame, flower, glow and pool meshes). */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from '../../vendor/addons/utils/BufferGeometryUtils.js';
import { EVENTS, COURTS, STOP } from '../../core/timeline.js';

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

/* ---------- layout (local metres) ---------- */
const HX = 6.8, HZ = 15;                    // deck half extents (x across, z along the road)
const STAGE = { z0: -HZ, z1: -11.4, hx: 4.6, h: 0.36 };
const DANCE = { z0: -11.2, z1: -7.4, hx: 3.0 };
const TABLES = [[-3.9, -4.6], [0.6, -4.9], [-3.4, -0.1], [1.1, -0.4], [-3.9, 4.4], [0.6, 4.1], [-3.4, 9.0], [1.1, 8.7]];
const CANOPY = { x0: -5.6, x1: 3.2, z0: -10.4, z1: 4.8, peaks: [[-1.2, -6.4], [-1.2, 1.4]], hEdge: 2.75, hPeak: 6.6 };
const LAT_C = (EVENTS.reception.lat[0] + EVENTS.reception.lat[1]) / 2;
const ENTRY = { x: -11 - LAT_C, z: HZ - 0.45, w: 1.4 }; // arch at the deck's near end (lat -11), facing the court (+z)
const SEA_STAIR_Z = -1.5;                     // gap in the sea-side balustrade, lantern path to the water
const LIGHTS = [                              // fake light rig for the baked warm fill: [x,y,z, strength, radius]
  [-1.2, 3.2, -6.4, 1.0, 7.5], [-1.2, 3.2, 1.4, 1.0, 7.5], [0, 2.2, -12.6, 0.9, 4.5],
  [-1.5, 4.2, 9.5, 0.7, 7.0], [-6.6, 1.0, 0, 0.35, 9], [ENTRY.x, 1.8, ENTRY.z + 0.6, 0.7, 3.4]
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
  const H = 1.0, runs = [
    [[-HX + 0.08, -HZ + 0.08], [-HX + 0.08, SEA_STAIR_Z - 1.0]], [[-HX + 0.08, SEA_STAIR_Z + 1.0], [-HX + 0.08, HZ - 0.08]],
    [[-HX + 0.08, HZ - 0.08], [ENTRY.x - 2.3, HZ - 0.08]], [[-HX + 0.08, -HZ + 0.08], [HX - 0.3, -HZ + 0.08]]
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
  const C = CANOPY, NU = tier === 'low' ? 26 : tier === 'med' ? 36 : 48, NV = Math.round(NU * 1.6);
  const SPX = 2, SPZ = 3, pull = 0.75, lift = 0.6, R = 4.7;
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
  const poles = C.peaks.map(([x, z]) => [x, z, C.hPeak + 0.25]);
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
  for (const [x, z] of [[-0.19, 0.18], [0.19, 0.18], [-0.18, -0.18], [0.18, -0.18]]) gd.rod(P(x * 1.08, 0, z * 1.08), P(x, 0.45, z), r, G, 5);
  gd.rod(P(-0.18, 0.45, -0.18), P(-0.17, 0.93, -0.22), r, G, 5); gd.rod(P(0.18, 0.45, -0.18), P(0.17, 0.93, -0.22), r, G, 5);
  gd.rod(P(-0.17, 0.93, -0.22), P(0.17, 0.93, -0.22), r * 1.2, G, 5);
  gd.rod(P(-0.18, 0.6, -0.19), P(0.18, 0.6, -0.19), r, G, 5);
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
    for (let k = 0; k < 16; k++) {
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
  const { iv, gd, gl, em, box } = K, y = STAGE.h, zb = -14.5;
  // backdrop: ivory panel wall with a flower-covered moon gate
  // pleated ivory drape on a slim brass frame (soft vertical folds catch the light)
  const drape = new THREE.PlaneGeometry(7.2, 3.3, tier === 'low' ? 48 : 96, 1), dp = drape.attributes.position;
  for (let i = 0; i < dp.count; i++) dp.setZ(i, 0.05 * Math.sin(dp.getX(i) * Math.PI / 0.22) + (dp.getY(i) < 0 ? 0.03 * Math.sin(dp.getX(i) * 7.1) : 0));
  drape.computeVertexNormals();
  iv.add(drape, 0xf2eadf, 0, y + 1.65, zb - 0.12);
  iv.add(box, 0xece4d6, 0, y + 1.65, zb - 0.22, 0, 0, 0, 7.2, 3.3, 0.04);        // backing
  gd.add(box, CHAMP, 0, y + 3.33, zb - 0.1, 0, 0, 0, 7.4, 0.05, 0.08);
  for (const s of [-1, 1]) gd.add(box, CHAMP, s * 3.66, y + 1.67, zb - 0.1, 0, 0, 0, 0.05, 3.34, 0.08);
  const nR = tier === 'low' ? 140 : tier === 'med' ? 220 : 340, R0 = 1.7, cy = y + 1.85;
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
    armchair(K, s * 0.62, -12.9);
    // tall brass stands with glass hurricanes and pillar candles
    const sx = s * 3.55, sz = -12.2;
    gd.rod(V(sx, y, sz), V(sx, y + 1.55, sz), 0.022, CHAMP, 8);
    gd.add(new THREE.CylinderGeometry(0.16, 0.2, 0.04, 14), CHAMP, sx, y + 0.02, sz);
    gd.add(new THREE.CylinderGeometry(0.12, 0.08, 0.05, 14), CHAMP, sx, y + 1.56, sz);
    gl.add(new THREE.CylinderGeometry(0.1, 0.1, 0.42, 14, 1, true), 0xffffff, sx, y + 1.8, sz);
    iv.add(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 10), 0xfff6e2, sx, y + 1.68, sz);
    em.add(K.flame, 0xffcf8a, sx, y + 1.815, sz, 0, 0, 0, 1.3, 2.2, 1.3);
    K.glows.push([sx, y + 1.83, sz, 0.22, 1]);
    K.pools.push([sx, y + 0.01, sz, 1.4, 0.5]);
  }
  K.pools.push([0, y + 0.01, -13.0, 3.2, 0.55], [0, 0.03, -9.3, 3.4, 0.45]);
}

/* ---------- entrance: floral arch at the deck's near end, facing the court (+z) ---------- */
function buildEntrance(K, tier) {
  const { iv, box } = K, x0 = ENTRY.x, z = ENTRY.z, w = ENTRY.w, hp = 2.3;
  const pts = [V(x0 - w, 0, z), V(x0 - w, hp, z)];
  for (let k = 1; k <= 14; k++) { const a = Math.PI - k / 14 * Math.PI; pts.push(V(x0 + Math.cos(a) * w, hp + Math.sin(a) * w, z)); }
  pts.push(V(x0 + w, 0, z));
  for (let k = 0; k < pts.length - 1; k++) iv.rod(pts[k], pts[k + 1], 0.05, 0xefe8dc, 8);
  for (const s of [-1, 1]) iv.add(box, 0xefe8dc, x0 + s * w, 0.07, z, 0, 0, 0, 0.32, 0.14, 0.32);
  // flowers: a full drift up the left pillar and over the crown, lighter down the right
  const n = tier === 'low' ? 100 : tier === 'med' ? 170 : 250;
  for (let k = 0; k < n; k++) {
    const t = Math.pow(Math.random(), 1.25);
    const f = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), q = pts[i].clone().lerp(pts[i + 1], f - i);
    if (q.y < 0.5 && Math.random() < 0.6) continue;
    const col = Math.random() < 0.08 ? 0x55654a : Math.random() < 0.28 ? 0xf1d8d6 : 0xfbf8f3;
    K.flowers.push([q.x + (Math.random() - 0.5) * 0.2, q.y + (Math.random() - 0.5) * 0.18, q.z + (Math.random() - 0.5) * 0.2, 0.05 + Math.random() * 0.04, col]);
  }
  for (const s of [-1, 1]) for (let k = 0; k < 16; k++)             // floor mounds at the pillars' feet
    K.flowers.push([x0 + s * (w + (Math.random() - 0.3) * 0.5), Math.random() * 0.4, z + (Math.random() - 0.5) * 0.5, 0.06 + Math.random() * 0.04, Math.random() < 0.25 ? 0xf1d8d6 : Math.random() < 0.15 ? 0x55654a : 0xfaf6ee]);
  pampas(K, x0 - 0.5, hp + w - 0.25, z, 5, 1.2, 0.9);
  K.pools.push([x0, 0.01, z, 2.0, 0.5], [x0, 0.02, z - 2.2, 1.8, 0.35]);
  lantern(K, x0 - w - 0.5, 0, z + 0.1, 0.9); lantern(K, x0 + w + 0.5, 0, z + 0.1, 0.9);
}

/* ---------- forecourt: honed ivory stone at road level with brass inlay, where the car drives in ---------- */
const STONE = 0xe8dcc6, STONE_B = 0xd5c19c, GROUT = 0xb3a488, SKIRT = 0xcdb994;
function quads(bk, list) {                 // list: [[a,b,c,d], col, hint] in local coords; hint = wanted normal side
  const pos = [], nor = [], colr = [], c = new THREE.Color(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  for (const [[a, b, cc, d], col, hint] of list) {
    e1.subVectors(b, a); e2.subVectors(d, a); n.crossVectors(e1, e2).normalize();
    const q = n.dot(hint) < 0 ? (n.negate(), [a, d, cc, a, cc, b]) : [a, b, cc, a, cc, d];
    c.set(col);
    for (const v of q) { pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); colr.push(c.r, c.g, c.b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  bk.parts.push(g);
}
function buildCourt(K, ctx, group) {
  const { path, world } = ctx, C = COURTS.reception, E = EVENTS.reception, R = STOP.reception.route;
  const h0 = path.sample(E.s).heading, UP = V(0, 1, 0), TOP = 0.02;
  const L = (s, lat, dy = TOP) => { const v = path.toWorld(s, lat); v.y += dy; return group.worldToLocal(v); };
  const G = (s, lat) => world.heightSL(s, lat) - path.roadY(s) - 0.25;           // sand height, road-relative, sunk a bit
  const put = (bk, geo, col, s, lat, dy, sx, sy, sz, ry = 0) => { const p = L(s, lat, dy); return bk.add(geo, col, p.x, p.y, p.z, 0, path.sample(s).heading - h0 + ry, 0, sx, sy, sz); };
  const polys = [R.in, R.out];
  K.clear = (s, lat) => {                  // metres to the nearest "Take me here" route segment
    let d = 1e9;
    for (const pl of polys) for (let i = 0; i < pl.length - 1; i++) {
      const [as, al] = pl[i], [bs, bl] = pl[i + 1], ds = bs - as, dl = bl - al;
      const t = Math.max(0, Math.min(1, ((s - as) * ds + (lat - al) * dl) / (ds * ds + dl * dl)));
      d = Math.min(d, Math.hypot(s - as - ds * t, lat - al - dl * t));
    }
    return d;
  };
  const s0 = C.s0, s1 = C.s1, l0 = -16.5, l1 = -3.7, B = 0.6, top = [], brass = [];
  const tile = (sa, sb, la, lb, col, dy = TOP) => top.push([[L(sa, la, dy), L(sb, la, dy), L(sb, lb, dy), L(sa, lb, dy)], col, UP]);
  const vary = (k) => { const c = new THREE.Color(k), j = (Math.random() - 0.5) * 0.05; return c.offsetHSL(0, 0, j).getHex(); };
  tile(s0, s1, l0, l1, GROUT, TOP - 0.008);                                        // grout bed
  const J = 0.004;
  // border band: long slabs of a deeper sand stone
  for (let s = s0; s < s1 - 1e-3; s += 1.2) { const e = Math.min(s1, s + 1.2);
    tile(s + J, e - J, l0 + J, l0 + B - J, vary(STONE_B)); tile(s + J, e - J, l1 - B + J, l1 - J, vary(STONE_B)); }
  for (let l = l0 + B; l < l1 - B - 1e-3; l += 1.2) { const e = Math.min(l1 - B, l + 1.2);
    tile(s0 + J, s0 + B - J, l + J, e - J, vary(STONE_B)); tile(s1 - B + J, s1 - J, l + J, e - J, vary(STONE_B)); }
  // field: 1.2 × 0.8 honed ivory slabs in running bond
  let row = 0;
  for (let l = l0 + B; l < l1 - B - 1e-3; l += 0.8, row++) {
    const le = Math.min(l1 - B, l + 0.8);
    for (let s = s0 + B - (row % 2) * 0.6; s < s1 - B - 1e-3; s += 1.2) {
      const sa = Math.max(s0 + B, s), sb = Math.min(s1 - B, s + 1.2);
      if (sb - sa > 0.05) tile(sa + J, sb - J, l + J, le - J, vary(STONE));
    }
  }
  // brass inlay: a line framing the field, and a double ring round the drop-off
  const strip = (pts, w) => { for (let i = 0; i < pts.length - 1; i++) {
    const [as, al] = pts[i], [bs, bl] = pts[i + 1], len = Math.hypot(bs - as, bl - al), ns = -(bl - al) / len * w / 2, nl = (bs - as) / len * w / 2;
    brass.push([[L(as + ns, al + nl, TOP + 0.002), L(bs + ns, bl + nl, TOP + 0.002), L(bs - ns, bl - nl, TOP + 0.002), L(as - ns, al - nl, TOP + 0.002)], 0xa98446, UP]); } };
  const f0 = s0 + B + 0.05, f1 = s1 - B - 0.05, g0 = l0 + B + 0.05, g1 = l1 - B - 0.05;
  strip([[f0, g0], [f1, g0], [f1, g1], [f0, g1], [f0, g0]], 0.03);
  const [cs, cl] = R.in[R.in.length - 1];
  for (const r of [3.0, 3.25]) { const ring = []; for (let k = 0; k <= 64; k++) { const a = k / 64 * Math.PI * 2; ring.push([cs + Math.cos(a) * r, cl + Math.sin(a) * r]); } strip(ring, 0.025); }
  strip([[cs + 3.25, cl], [f1, cl]], 0.03);                                       // axis line on to the steps
  quads(K.iv, top); quads(K.gd, brass);
  K.pools.push(...[[cs, cl, 3.6, 0.42]].map(([s, l, r, k]) => { const p = L(s, l); return [p.x, p.y, p.z, r, k]; }));
  return { L, G, put, s0, s1, l0, l1 };
}

/* court edges: retaining skirt, sea parapet with lanterns, road-side planters, bollards, steps down to the deck */
function buildCourtEdges(K, cc) {
  const { L, G, put, s0, s1, l0, l1 } = cc, box = K.box, TOP = 0.02, side = [];
  const skirt = (a, b, n) => {             // a,b: [s,lat] along the edge; n: [ds,dl] outward
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(len / 1.0));
    for (let i = 0; i < k; i++) {
      const p = [a[0] + (b[0] - a[0]) * i / k, a[1] + (b[1] - a[1]) * i / k], q = [a[0] + (b[0] - a[0]) * (i + 1) / k, a[1] + (b[1] - a[1]) * (i + 1) / k];
      const gp = Math.min(G(...p), TOP - 0.1), gq = Math.min(G(...q), TOP - 0.1), o = L(p[0] + n[0], p[1] + n[1]).sub(L(...p));
      side.push([[L(p[0], p[1], TOP), L(q[0], q[1], TOP), L(q[0], q[1], gq), L(p[0], p[1], gp)], SKIRT, o]);
    }
  };
  skirt([s0, l0], [s1, l0], [0, -1]); skirt([s0, l0], [s0, l1], [-1, 0]); skirt([s1, l0], [s1, l1], [1, 0]);
  quads(K.iv, side);
  // steps from the court down to the deck's near end, centred on the arch; court-level stone either side
  const la = -11 - ENTRY.w - 0.9, lb = -11 + ENTRY.w + 0.9, h = L(s1, -11).y, r = Math.max(1, Math.round(Math.abs(h) / 0.16)), n = Math.max(1, r - 1);
  const run = E => E.s - E.len / 2 - s1, gap = run(EVENTS.reception);
  for (let i = 1; i <= n; i++) {
    const t = TOP - h * i / (n + 1), bot = Math.min(t - 0.3, G(s1 + gap / 2, -11)), sm = s1 + gap * (i - 0.5) / n;
    put(K.iv, box, STONE, sm, -11, (t + bot) / 2, lb - la, t - bot, gap / n);
    put(K.gd, box, CHAMP, s1 + gap * i / n - 0.02, -11, t + 0.004, lb - la, 0.012, 0.04);   // brass nosing
  }
  for (const [p, q] of [[l0, la], [lb, -7.4]]) {
    const bot = Math.min(TOP - 0.4, G(s1 + gap / 2, (p + q) / 2));
    put(K.iv, box, STONE_B, s1 + gap / 2, (p + q) / 2, (TOP + bot) / 2, q - p, TOP - bot, gap + 0.02);
  }
  // sea-side parapet (and along the far-from-deck end) with brass lanterns on the coping
  const wall = (a, b) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.round(len / 2)), ry = Math.atan2(b[1] - a[1], b[0] - a[0]);
    for (let i = 0; i < k; i++) {
      const sm = a[0] + (b[0] - a[0]) * (i + 0.5) / k, lm = a[1] + (b[1] - a[1]) * (i + 0.5) / k;
      put(K.iv, box, SKIRT, sm, lm, TOP + 0.25, 0.34, 0.5, len / k + 0.01, ry);
      put(K.iv, box, 0xeee4d2, sm, lm, TOP + 0.53, 0.44, 0.06, len / k + 0.02, ry);
    }
  };
  wall([s0 + 0.17, l0 + 0.17], [s1 - 0.02, l0 + 0.17]); wall([s0 + 0.17, l0 + 0.17], [s0 + 0.17, -8.9]);
  const warmAt = [];
  for (let s = s0 + 2; s < s1 - 1; s += 4) {
    const p = L(s, l0 + 0.17, TOP + 0.56); lantern(K, p.x, p.y, p.z, 0.85);
    const q = L(s, l0 + 1.1); K.pools.push([q.x, q.y, q.z, 1.5, 0.4]); warmAt.push(q);
  }
  // road-side planters: a low stone trough with a clipped hedge and white blooms, only where the car never goes
  for (let s = s0 + 5; s < s1 - 4; s += 1.4) {
    const sm = s + 0.65;
    if (K.clear(s, -4.3) < 2.5 || K.clear(s + 1.3, -4.3) < 2.5) continue;
    put(K.iv, box, SKIRT, sm, -4.3, TOP + 0.22, 0.6, 0.44, 1.3);
    put(K.iv, box, 0x4a5d3c, sm, -4.3, TOP + 0.56, 0.48, 0.26, 1.22);
    for (let k = 0; k < 4; k++) { const p = L(s + 0.1 + Math.random() * 1.1, -4.3 + (Math.random() - 0.5) * 0.4, TOP + 0.66 + Math.random() * 0.04);
      K.flowers.push([p.x, p.y, p.z, 0.05 + Math.random() * 0.02, Math.random() < 0.25 ? 0xf1d8d6 : 0xfbf8f2]); }
  }
  // stone bollards with a glowing brass-lined slot, at the mouths and the corners of the court
  for (const [s, l] of [[s0 + 4.6, -4.3], [s1 - 3.4, -4.3], [s0 + 0.2, -8.4], [s1 - 0.6, l0 + 0.9], [s0 + 12, l0 + 0.9]]) {
    if (K.clear(s, l) < 2.45) continue;
    put(K.iv, box, 0xeee4d2, s, l, TOP + 0.38, 0.22, 0.76, 0.22);
    put(K.gd, box, CHAMP, s, l, TOP + 0.78, 0.25, 0.04, 0.25);
    const p = L(s, l, TOP + 0.62); K.em.add(box, 0xffc98e, p.x, p.y, p.z, 0, 0, 0, 0.235, 0.09, 0.235);
    K.glows.push([p.x, p.y, p.z, 0.3, 1]);
    const q = L(s, l); K.pools.push([q.x, q.y, q.z, 1.7, 0.5]); warmAt.push(q);
  }
  // tall brass lantern posts at the court's sea corners and beside the steps
  for (const [s, l] of [[s0 + 0.9, l0 + 0.9], [s1 - 0.9, l0 + 0.9], [s1 - 0.5, la - 0.6]]) {
    const p = L(s, l, TOP);
    put(K.iv, box, 0xeee4d2, s, l, TOP + 0.2, 0.42, 0.4, 0.42);
    K.gd.rod(V(p.x, p.y + 0.4, p.z), V(p.x, p.y + 2.5, p.z), 0.045, 0x3a342c, 8);
    lantern(K, p.x, p.y + 2.5, p.z, 1.15);
    K.pools.push([p.x, p.y, p.z, 2.6, 0.45]); warmAt.push(p);
  }
  for (let s = s0 + 6; s < s1 - 4; s += 3.5) { const q = L(s, -5.2); LIGHTS.push([q.x, q.y + 0.8, q.z, 0.35, 1.6]); }
  const st = L(...STOP.reception.route.in.at(-1), 1.2);
  for (const q of warmAt) LIGHTS.push([q.x, q.y + 0.5, q.z, 0.45, 1.8]);
  LIGHTS.push([st.x, st.y, st.z, 0.3, 4.5]);
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
  for (let z = -13.2; z <= 13.6; z += 2.2) if (Math.abs(z - SEA_STAIR_Z) > 1.3) lantern(K, -HX + 0.32, 0, z);
  for (let x = -4.8; x <= 4.8; x += 2.4) if (Math.abs(x - ENTRY.x) > 2.6) lantern(K, x, 0, HZ - 0.32);
  // down the sea stair and across the sand to the water's edge
  for (let k = 0; k < 4; k++) for (const s of [-1, 1]) {
    const x = -HX - 1.55 - k * 0.95, z = SEA_STAIR_Z + s * (0.95 + k * 0.08);
    lantern(K, x, K.groundY(x, z) + 0.1, z, 1.35);
  }
  for (let z = -12; z <= 12; z += 4.8) if (Math.abs(z - SEA_STAIR_Z) > 2) { const x = -HX - 1.1; lantern(K, x, K.groundY(x, z) + 0.1, z, 1.2); }
}

/* ---------- fairy lights: catenary swags from slim brass poles ---------- */
function buildFairy(K, tier) {
  const px = HX - 0.15, zs = [-13.6, -9, -4.5, 0, 4.6, 9.5, 14.4], H = 4.5;
  for (const x of [-px, px]) for (const z of zs) {
        K.gd.rod(V(x, 0, z), V(x, H + 0.12, z), 0.028, 0x3a342c, 6);
    K.gd.add(K.ring, CHAMP, x, H + 0.12, z, Math.PI / 2, 0, 0, 0.5, 0.5, 0.5);
  }
  const strands = [];
  for (const x of [-px, px]) for (let i = 0; i < zs.length - 1; i++) strands.push([V(x, H, zs[i]), V(x, H, zs[i + 1]), 0.55]);
  for (let i = 4; i < zs.length - 1; i++) strands.push([V(-px, H, zs[i]), V(px, H, zs[i + 1]), 1.3], [V(-px, H, zs[i + 1]), V(px, H, zs[i]), 1.3]);
  strands.push([V(-px, H, zs[5]), V(px, H, zs[5]), 1.1], [V(-px, H, zs[6]), V(px, H, zs[6]), 0.9]);
  // over the canopy's sides: long swags from the tent's rim poles out to the perimeter
  for (let k = 0; k <= 3; k++) {
    const z = CANOPY.z0 + (CANOPY.z1 - CANOPY.z0) * k / 3;
    strands.push([V(CANOPY.x1, CANOPY.hEdge + 0.1, z), V(px, H, z), 0.4]);
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
  K.pools.push([-2, 0.02, 10.5, 5.5, 0.28], [-6.2, 0.02, 0, 3, 0.2]);
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
    const latC = (E.lat[0] + E.lat[1]) / 2;
    const group = new THREE.Group();
    group.name = 'event-reception';
    // deck top: brief's roadY - 0.35, but never below the sand (the berm near the wall sits ~road level)
    const P = path.toWorld(E.s, latC);
    let gMax = -1e9;
    for (let z = -HZ; z <= HZ; z += 2.5) for (let x = -HX; x <= HX; x += 1.7) gMax = Math.max(gMax, world.heightSL(E.s - z, latC + x));
    const deckY = Math.max(P.y - 0.35, gMax + 0.14);
    group.position.set(P.x, deckY, P.z);
    group.rotation.y = path.sample(E.s).heading;
    group.updateMatrixWorld(true);
    const K = {
      tk: bucket(), iv: bucket(), gd: bucket(), gl: bucket(), em: bucket(),
      flowers: [], glows: [], pools: [], bulbs: [], wire: [],
      groundY: (x, z) => world.heightSL(E.s - z, latC + x) - deckY,
      box: new THREE.BoxGeometry(1, 1, 1), flame: new THREE.SphereGeometry(0.014, 6, 4),
      roof: new THREE.ConeGeometry(1, 1, 4, 1), ring: new THREE.TorusGeometry(0.035, 0.008, 4, 10),
      candle: new THREE.CylinderGeometry(0.045, 0.045, 0.16, 8),
      plume: new THREE.LatheGeometry([V(0.006, 0, 0), V(0.008, 0.5, 0), V(0.03, 0.6, 0), V(0.055, 0.78, 0), V(0.035, 0.93, 0), V(0.001, 1, 0)], 5)
    };
    buildCourtEdges(K, buildCourt(K, ctx, group));
    buildDeck(K);
    buildDining(K, tier);
    buildStage(K, tier);
    buildEntrance(K, tier);
    buildLanterns(K);
    buildFairy(K, tier);
    const canopy = canopyGeometry(tier);
    for (const [x, z, h] of canopy.poles) K.iv.rod(V(x, 0, z), V(x, h, z), h > 4 ? 0.075 : 0.05, 0xe9e4da, 10);
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
    return {
      group,
      update(dt, s, cam) {
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
