/* Muhurtham (Nov 18, 8 PM, night): a Telugu wedding mandap on a deck by the sea.
 * Placement: core/timeline.js SITES.muhurtham, one procession axis at lateral S.ax: the drop-off
 * (kolam on the apron) → the island centrepiece beside it → the jasmine-and-marigold arch at d0 →
 * the red aisle runner lined with diyas between mirrored blocks of chairs → the gold mandap
 * centred at stage.s with the agni kund at its centre; the sea on the left.
 *
 * Scene-local frame: the group sits at the deck centre on the axis, rotation.y = heading; local -z
 * is road-forward (+s), +x is toward the road. The deck top is local y = 0. The mandap is built in
 * its own frame (guests toward its +x) and turned so its front faces the arch (+z).
 *
 * No THREE lights: firelight is faked in the shader (litMat: warm emissive falling off from
 * the agni kund and the four brass lamps), plus one instanced additive mesh that holds every
 * flame, halo and light pool. The forecourt (lawn, drive, walls, carpet) is compound.js.
 *
 * Draw calls: wood, stone, gold, runner, leaf, chairs, kolam, flowers, fx = 9 (+ compound). <80k triangles on 'high'. */
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/addons/utils/BufferGeometryUtils.js';
import { SITES } from '../../core/timeline.js';
import { buildCompound } from './compound.js';

const S = SITES.muhurtham;
const S_C = (S.d0 + S.d1) / 2;                  // deck centre (s)
const HALF_Z = (S.d1 - S.d0) / 2;               // 14
const LAT_C = S.ax;                             // -13.5: the axis
const X_ROAD = S.lat[0] - LAT_C;                // +6.7: road-side deck edge
const X_SEA = S.lat[1] - LAT_C;                 // -6.7: sea-side deck edge
const AX = 0;                                   // the entrance arch (x), on the axis, at the deck's near end
const AW = 1.45, AH = 1.9;                      // arch half-width, height of the springing
const MX = 0;                                   // mandap centre in its own frame
const MZ = S_C - S.stage.s;                     // mandap centre (local z): stage.s on the axis
const PH = 0.45;                                // mandap platform height
const PIL = 2.3;                                // pillar offset from mandap centre
const PIL_H = 3.0;                              // pillar height above the platform
const MFRAME = new THREE.Matrix4().makeTranslation(0, 0, MZ).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
const toDeck = (x, z) => [-z, x + MZ];          // mandap frame (x toward the guests) → deck frame

/* ---------- geometry bag: transformed copies with vertex colours, merged once ---------- */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function mat(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}
class Bag {
  constructor(uv = false) { this.list = []; this.uv = uv; this.post = null; }
  add(geo, hex, m, jitter = 0.04, rng = Math.random) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    if (this.post) g.applyMatrix4(this.post);
    if (!this.uv) g.deleteAttribute('uv');
    else if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const n = g.attributes.position.count, col = new Float32Array(n * 3), c = new THREE.Color(hex);
    for (let i = 0; i < n; i += 3) {
      const k = 1 + (rng() - 0.5) * jitter;
      for (let j = i; j < Math.min(n, i + 3); j++) { col[j * 3] = c.r * k; col[j * 3 + 1] = c.g * k; col[j * 3 + 2] = c.b * k; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    this.list.push(g);
    return g;
  }
  box(w, h, d, hex, x, y, z, ry = 0, jitter) { return this.add(new THREE.BoxGeometry(w, h, d), hex, mat(x, y, z, 0, ry), jitter); }
  merge() { const g = mergeGeometries(this.list, false); this.list.length = 0; return g; }
}

/* ---------- firelight material: warm emissive from the fire + four lamps, dusk-scaled ---------- */
const LIT = {
  uGlow: { value: 0 },                               // 0 day … 1 night
  uFlick: { value: 1 },                              // fire flicker multiplier
  uFire: { value: new THREE.Vector3(0, PH + 0.5, MZ) },
  uLamps: { value: [0, 1, 2, 3].map(i => new THREE.Vector3((i & 1 ? 1 : -1) * (PIL + 0.55), PH + 1.55, MZ + (i & 2 ? 1 : -1) * (PIL + 0.55))) },
  uArch: { value: new THREE.Vector3(AX, 1.9, HALF_Z - 0.6) }
};
function litMat(params, { self = 0, amb = 0.1 } = {}) {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, LIT, { uSelf: { value: self }, uAmb: { value: amb } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLoc; varying vec3 vLocN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
  vec4 lp4 = vec4(transformed, 1.0); vec3 ln = objectNormal;
  #ifdef USE_INSTANCING
  lp4 = instanceMatrix * lp4; ln = mat3(instanceMatrix) * ln;
  #endif
  vLoc = lp4.xyz; vLocN = normalize(ln);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLoc; varying vec3 vLocN;
uniform float uGlow, uFlick, uSelf, uAmb; uniform vec3 uFire, uArch; uniform vec3 uLamps[4];
float mLight(vec3 p, float r) { vec3 d = p - vLoc; float q = dot(d, d) / (r * r);
  return (0.45 + 0.55 * max(dot(vLocN, normalize(d)), 0.0)) / (1.0 + q); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  float lit = uAmb + uSelf + 1.7 * uFlick * mLight(uFire, 2.0);
  for (int i = 0; i < 4; i++) lit += 0.4 * mLight(uLamps[i], 1.2);
  lit += 0.35 * mLight(uArch, 1.5);
  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.66, 0.36) * lit * uGlow;`);
  };
  return m;
}

/* ---------- canvas textures ---------- */
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
// teak deck boards: u runs across the boards (1 unit = 1 m), v along them
function woodTex(R) {
  return canvasTex(256, 256, (g, w, h) => {
    const boards = 7;                          // 0.14 m boards at 1 m / 256 px
    for (let b = 0; b < boards; b++) {
      const x0 = Math.round(b * w / boards), x1 = Math.round((b + 1) * w / boards);
      const l = 0.82 + R() * 0.3;
      g.fillStyle = `rgb(${Math.round(150 * l)},${Math.round(104 * l)},${Math.round(70 * l)})`;
      g.fillRect(x0, 0, x1 - x0, h);
      for (let k = 0; k < 16; k++) {           // grain streaks
        g.fillStyle = `rgba(${R() < 0.5 ? '60,34,18' : '200,150,105'},${0.05 + R() * 0.08})`;
        g.fillRect(x0 + R() * (x1 - x0), 0, 1 + R() * 2, h);
      }
      const j = Math.round(R() * h);           // butt joint
      g.fillStyle = 'rgba(30,18,10,0.7)'; g.fillRect(x0, j, x1 - x0, 2);
      g.fillStyle = 'rgba(25,14,8,0.9)'; g.fillRect(x1 - 2, 0, 2, h);   // gap between boards
    }
  });
}
// red silk runner with a gold zari border and a small woven motif
function runnerTex() {
  return canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#7e0a12'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) { g.fillStyle = `rgba(0,0,0,${0.04 + (y % 8 ? 0.03 : 0)})`; g.fillRect(0, y, w, 2); }
    const gold = '#d9a93a';
    g.fillStyle = gold; g.fillRect(0, 0, 30, h); g.fillRect(w - 30, 0, 30, h);
    g.fillStyle = '#7a0c12'; g.fillRect(8, 0, 4, h); g.fillRect(w - 12, 0, 4, h);
    g.fillStyle = gold;
    for (let y = 16; y < h; y += 64) {         // buttis (small gold motifs) down the centre field
      for (const x of [w * 0.32, w * 0.68]) {
        g.save(); g.translate(x, y + (x > w / 2 ? 32 : 0)); g.rotate(Math.PI / 4);
        g.fillRect(-7, -7, 14, 14); g.restore();
      }
    }
    g.strokeStyle = 'rgba(217,169,58,0.8)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(40, 0); g.lineTo(40, h); g.moveTo(w - 40, 0); g.lineTo(w - 40, h); g.stroke();
  });
}

// white rice-flour kolam: a pulli (dot) kolam woven round a lotus, on transparent ground
function kolamTex() {
  return canvasTex(512, 512, (g, w) => {
    const c = w / 2;
    g.strokeStyle = '#f6f1e6'; g.fillStyle = '#f6f1e6'; g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineWidth = 5;
    g.beginPath(); g.arc(c, c, 236, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 3;
    g.beginPath(); g.arc(c, c, 224, 0, Math.PI * 2); g.stroke();
    // scalloped border: 24 loops
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2;
      g.beginPath(); g.arc(c + Math.cos(a) * 205, c + Math.sin(a) * 205, 17, a + Math.PI * 0.5, a + Math.PI * 1.5, true); g.stroke();
      g.beginPath(); g.arc(c + Math.cos(a + 0.13) * 214, c + Math.sin(a + 0.13) * 214, 3.5, 0, 7); g.fill();
    }
    // dot grid (pulli) with the lines looping round each dot: a 5 x 5 diamond lattice
    const S = 34;
    for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
      if (Math.abs(i) + Math.abs(j) > 4) continue;
      const x = c + (i - j) * S * 0.72, y = c + (i + j) * S * 0.72;
      g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
      if (Math.abs(i) + Math.abs(j) === 4) { g.beginPath(); g.arc(x, y, 16, 0, 7); g.stroke(); }
    }
    // eight-petal lotus in the centre, sikku curves round it
    g.lineWidth = 4;
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      g.save(); g.translate(c, c); g.rotate(a);
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(26, -40, 0, -78); g.quadraticCurveTo(-26, -40, 0, 0); g.stroke();
      g.beginPath(); g.moveTo(0, -84); g.bezierCurveTo(60, -120, 110, -60, 150, -150); g.stroke();
      g.beginPath(); g.arc(0, -168, 12, 0, 7); g.stroke();
      g.restore();
    }
    g.beginPath(); g.arc(c, c, 16, 0, 7); g.stroke();
    g.beginPath(); g.arc(c, c, 5, 0, 7); g.fill();
  }, false);
}

/* ---------- fx: every flame, halo and light pool in one instanced additive mesh ----------
 * aFx = (kind, phase, strength, _): kind 0 flame (y-billboard), 1 halo (billboard), 2 pool (flat) */
function fxMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uGlow: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
attribute vec4 aFx; varying vec2 vUv; varying vec4 vFx; uniform float uTime;
void main() {
  vUv = uv; vFx = aFx;
  vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
  if (aFx.x > 1.5) { gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); return; }
  float t = uTime * (aFx.x < 0.5 ? 1.0 : 0.6) + aFx.y * 6.28;
  float f = 0.9 + 0.07 * sin(t * 9.1) + 0.05 * sin(t * 15.7 + 1.3);
  vec2 off = position.xy * vec2(sx, sy * f);
  if (aFx.x < 0.5) off.x += sin(t * 5.3) * 0.08 * sx * (position.y + 0.5);   // tip sway
  c.xy += off;
  gl_Position = projectionMatrix * c;
}`,
    fragmentShader: `
varying vec2 vUv; varying vec4 vFx; uniform float uTime, uGlow;
void main() {
  float t = uTime + vFx.y * 6.28;
  vec3 col; float a;
  if (vFx.x < 0.5) {
    vec2 p = vUv - vec2(0.5, 0.18);
    p.x += 0.06 * sin(vUv.y * 7.0 - t * 8.0) * vUv.y;
    float w = mix(0.36, 0.0, pow(clamp(p.y / 0.82, 0.0, 1.0), 0.9)) * smoothstep(-0.2, 0.05, p.y);
    float d = abs(p.x) / max(w, 1e-3);
    float body = smoothstep(1.0, 0.25, d) * smoothstep(-0.18, 0.02, p.y) * smoothstep(0.82, 0.3, p.y);
    float core = smoothstep(0.55, 0.0, d) * smoothstep(0.5, 0.05, p.y);
    col = mix(vec3(0.95, 0.26, 0.03), vec3(1.0, 0.72, 0.28), core) + vec3(0.25, 0.2, 0.1) * core * core;
    a = body;
  } else {
    float r = length(vUv - 0.5) * 2.0;
    a = pow(max(1.0 - r, 0.0), vFx.x > 1.5 ? 1.6 : 2.2);
    col = vec3(1.0, 0.6, 0.26);
    a *= 0.92 + 0.08 * sin(t * 7.0) * sin(t * 3.1);
  }
  gl_FragColor = vec4(col * a * vFx.z * (0.35 + 0.65 * uGlow), 1.0);
}`
  });
}

/* ---------- 1. deck: boards, fascia, posts on the sand, bearers, sea-side handrail ---------- */
function buildDeck(ctx, wood, stone, groundAt) {
  const { THREE: T3 = THREE } = ctx;
  const W = X_ROAD - X_SEA, L = 2 * HALF_Z;
  // boards: one plane whose uv is in metres (u across the boards = z, v along = x)
  const top = new T3.PlaneGeometry(W, L, 1, 1).rotateX(-Math.PI / 2).translate((X_ROAD + X_SEA) / 2, 0, 0);
  const uv = top.attributes.uv, p = top.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getZ(i), p.getX(i));
  wood.add(top, 0xffffff, null, 0);
  // fascia board round the edge and a bearer grid under it
  wood.box(W + 0.1, 0.28, 0.08, 0x6e4a31, (X_ROAD + X_SEA) / 2, -0.15, HALF_Z + 0.02);
  wood.box(W + 0.1, 0.28, 0.08, 0x6e4a31, (X_ROAD + X_SEA) / 2, -0.15, -HALF_Z - 0.02);
  wood.box(0.08, 0.28, L, 0x6e4a31, X_SEA - 0.02, -0.15, 0);
  wood.box(0.08, 0.28, L, 0x6e4a31, X_ROAD + 0.02, -0.15, 0);
  for (let x = X_SEA + 0.4; x < X_ROAD; x += 2.2) wood.box(0.16, 0.24, L - 0.2, 0x4a3122, x, -0.2, 0);
  // posts down to the sand (dark tarred timber), with a cross brace every other bay
  for (let x = X_SEA + 0.4; x < X_ROAD; x += 2.2) {
    for (let z = -HALF_Z + 0.4; z <= HALF_Z - 0.3; z += 2.6) {
      const gy = groundAt(x, z) - 0.3, h = -0.3 - gy;
      if (h < 0.05) continue;
      wood.box(0.2, h, 0.2, 0x3b2a1f, x, gy + h / 2, z, 0, 0.1);
    }
  }
  // sea-side and end handrails: posts, top rail, mid rail (white-painted hardwood)
  const xs = X_SEA + 0.08, xr = X_ROAD - 0.08, zf = -HALF_Z + 0.08, zn = HALF_Z - 0.08;
  const railRuns = [
    [xs, zf, xs, zn], [xr, zf, xr, zn], [xs, zf, xr, zf],
    [xs, zn, AX - AW - 0.7, zn], [AX + AW + 0.7, zn, xr, zn]          // near end: open at the arch
  ];
  for (const [x0, z0, x1, z1] of railRuns) {
    const len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0);
    const n = Math.ceil(len / 1.8);
    for (let i = 0; i <= n; i++) {
      const t = i / n; stone.box(0.09, 0.95, 0.09, 0xe9e1d0, x0 + (x1 - x0) * t, 0.475, z0 + (z1 - z0) * t);
    }
    stone.add(new T3.BoxGeometry(0.12, 0.06, len), 0xf1eadb, mat((x0 + x1) / 2, 0.97, (z0 + z1) / 2, 0, ry));
    stone.add(new T3.BoxGeometry(0.05, 0.05, len), 0xe3dac8, mat((x0 + x1) / 2, 0.5, (z0 + z1) / 2, 0, ry));
  }
}

const lathe = (pts, segs = 10, phi = 0) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs, phi);
const PW = 3.0;                                  // platform half-width
// kuthu vilakku: tall brass tiered lamp with five wicks (1.78 m)
const LAMP_GEO = lathe([[0, 0], [0.22, 0], [0.22, 0.03], [0.16, 0.06], [0.1, 0.1], [0.04, 0.16], [0.03, 0.4], [0.06, 0.43],
    [0.03, 0.46], [0.025, 0.85], [0.055, 0.88], [0.025, 0.92], [0.022, 1.3], [0.05, 1.33], [0.17, 1.38], [0.18, 1.43],
    [0.05, 1.42], [0.022, 1.46], [0.022, 1.62], [0.05, 1.66], [0.02, 1.72], [0, 1.78]], 12);

/* ---------- 2. platform, steps, pillars, gopuram canopy ---------- */
function buildMandap(stone, gold, runner) {
  // platform: cream plaster skirt with a gold band, red runner on top and on the steps
  stone.box(2 * PW, PH - 0.02, 2 * PW, 0xe8dcc4, MX, (PH - 0.02) / 2, 0);
  gold.box(2 * PW + 0.03, 0.06, 2 * PW + 0.03, 0xc9962e, MX, PH - 0.06, 0);
  stone.box(2 * PW + 0.04, 0.05, 2 * PW + 0.04, 0x7a1616, MX, 0.1, 0);                 // maroon plinth band
  const carpet = new THREE.PlaneGeometry(2 * PW - 0.1, 2 * PW - 0.1).rotateX(-Math.PI / 2).rotateY(Math.PI / 2);
  runner.add(carpet, 0xffffff, mat(MX, PH + 0.005, 0), 0);
  for (let k = 0; k < 3; k++) {                  // three steps down toward the road (+x)
    const h = PH * (3 - k) / 3 - 0.005, x = MX + PW + 0.16 + k * 0.32;
    runner.add(new THREE.BoxGeometry(0.32, h, 2.2), 0xffffff, mat(x, h / 2, 0), 0);
    gold.box(0.04, 0.03, 2.22, 0xd4a238, x + 0.16, h - 0.015, 0);
  }
  // four carved pillars: turned white shaft, gold rings, square gold capital (potika)
  const shaft = lathe([[0, 0], [0.2, 0], [0.2, 0.18], [0.15, 0.22], [0.13, 0.5], [0.16, 0.6], [0.13, 0.7],
    [0.11, 1.4], [0.15, 1.5], [0.17, 1.55], [0.15, 1.6], [0.11, 1.7], [0.1, 2.5], [0.14, 2.6], [0.12, 2.7],
    [0.16, 2.82], [0.2, 2.9], [0, 2.9]], 12);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = MX + sx * PIL, z = sz * PIL;
    stone.box(0.46, 0.22, 0.46, 0xf2ece0, x, PH + 0.11, z);
    stone.add(shaft, 0xf4efe6, mat(x, PH + 0.22, z), 0.02);
    for (const y of [0.3, 0.72, 1.55, 2.6]) gold.add(new THREE.CylinderGeometry(0.155, 0.155, 0.05, 12), 0xd7a53c, mat(x, PH + 0.22 + y, z));
    gold.box(0.5, 0.14, 0.5, 0xc99a33, x, PH + PIL_H - 0.02, z);
  }
  // canopy frame: gold beams, a maroon silk ceiling under them
  const Y0 = PH + PIL_H + 0.05, S = PIL + 0.35;
  for (const sz of [-1, 1]) { gold.box(2 * S, 0.32, 0.26, 0xc6952f, MX, Y0 + 0.16, sz * PIL); gold.box(0.26, 0.32, 2 * S, 0xc6952f, MX + sz * PIL, Y0 + 0.16, 0); }
  stone.box(2 * PIL, 0.03, 2 * PIL, 0x6d0d14, MX, Y0 + 0.02, 0);
  // gopuram: four receding tiers, each a band with a projecting cornice and a row of kalasha knobs
  let y = Y0 + 0.32, w = 2 * S + 0.3;
  const knob = lathe([[0, 0], [0.07, 0.04], [0.05, 0.12], [0.022, 0.17], [0, 0.23]], 6);
  for (let t = 0; t < 4; t++) {
    gold.box(w + 0.2, 0.07, w + 0.2, 0xc99a3a, MX, y + 0.035, 0);                        // cornice lip
    const bh = 0.36 - t * 0.03;
    gold.box(w - 0.1, bh, w - 0.1, t % 2 ? 0x8a6020 : 0xa27526, MX, y + 0.07 + bh / 2, 0);
    // little niches: darker recessed panels on each face
    for (let f = 0; f < 4; f++) {
      const ang = f * Math.PI / 2, nx = Math.cos(ang), nz = Math.sin(ang);
      const cnt = Math.max(1, 3 - t);
      for (let k = 0; k < cnt; k++) {
        const o = (k - (cnt - 1) / 2) * (w / (cnt + 0.6));
        gold.add(new THREE.BoxGeometry(0.02, bh * 0.62, 0.22), 0x7c5518,
          mat(MX + nx * (w / 2 - 0.04) - nz * o, y + 0.07 + bh / 2, nz * (w / 2 - 0.04) + nx * o, 0, -ang));
      }
    }
    const nk = Math.max(3, Math.round(w / 0.55));
    for (let k = 0; k <= nk; k++) for (let f = 0; f < 4; f++) {
      const o = -w / 2 - 0.05 + (w + 0.1) * k / nk, ang = f * Math.PI / 2;
      const px = Math.cos(ang) * (w / 2 + 0.05) - Math.sin(ang) * o, pz = Math.sin(ang) * (w / 2 + 0.05) + Math.cos(ang) * o;
      gold.add(knob, 0xcf9d3c, mat(MX + px, y + 0.07, pz), 0);
    }
    y += 0.07 + bh; w *= 0.72;
  }
  // square dome (4-sided lathe) and the kalasam finial
  const dome = lathe([[0.001, 0.62], [0.28, 0.58], [0.5, 0.45], [0.62, 0.25], [0.66, 0.08], [0.6, 0], [0, 0]], 4, Math.PI / 4);
  gold.add(dome, 0xc2903a, mat(MX, y, 0, 0, 0, 0, w / 1.2, 1, w / 1.2), 0);
  const fin = lathe([[0, 0], [0.13, 0.02], [0.17, 0.12], [0.15, 0.22], [0.07, 0.3], [0.1, 0.34], [0.05, 0.38],
    [0.07, 0.46], [0.03, 0.55], [0.012, 0.7], [0, 0.72]], 10);
  gold.add(fin, 0xf0c35a, mat(MX, y + 0.6, 0), 0);
  return y + 1.3;                                 // top of the finial
}

/* ---------- 3–4. agni kund, kalasham, seats, kuthu vilakku, diyas ---------- */
// fx entries: [kind, x, y, z, sx, sy, strength]; kind 0 flame, 1 halo, 2 floor pool
function buildRitual(stone, gold, leaf, fx, R) {
  // agni kund: three stepped brick tiers with brass rims, dark ash bed, a turmeric line
  const tiers = [0.98, 0.78, 0.58];
  tiers.forEach((w, i) => {
    stone.box(w, 0.12, w, i % 2 ? 0xa0452a : 0x8f3a22, MX, PH + 0.06 + i * 0.12, 0, 0, 0.12);
    gold.box(w + 0.02, 0.018, w + 0.02, 0xc79634, MX, PH + 0.12 + i * 0.12, 0);
  });
  stone.box(0.42, 0.03, 0.42, 0x1f1612, MX, PH + 0.37, 0);
  for (let k = 0; k < 7; k++) {                        // stacked samidha sticks in the fire
    const a = (k / 7) * Math.PI;
    stone.add(new THREE.CylinderGeometry(0.018, 0.018, 0.38, 5), 0x3a2416, mat(MX, PH + 0.42 + (k % 2) * 0.03, 0, Math.PI / 2, a, 0));
  }
  fx.push([0, MX, PH + 0.8, 0, 0.55, 0.95, 0.85], [0, MX + 0.1, PH + 0.68, 0.1, 0.42, 0.66, 0.7], [0, MX - 0.09, PH + 0.66, -0.09, 0.4, 0.6, 0.7]);
  fx.push([1, MX, PH + 0.8, 0, 2.4, 2.4, 0.4], [1, MX, PH + 0.45, 0, 0.9, 0.45, 0.9]);  // flame halo, ember glow
  fx.push([2, MX, PH + 0.02, 0, 6.5, 6.5, 0.7]);                                        // light pool over the platform
  // two low peetas for the couple, on the sea side of the fire, facing the guests
  for (const sz of [-1, 1]) {
    const x = MX - 1.05, z = sz * 0.42;
    stone.box(0.52, 0.1, 0.62, 0x7b3b1d, x, PH + 0.11, z);
    for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) gold.box(0.05, 0.06, 0.05, 0xc28f2e, x + dx * 0.21, PH + 0.03, z + dz * 0.26);
    stone.box(0.46, 0.07, 0.56, 0xa3121c, x, PH + 0.19, z);
    gold.box(0.48, 0.02, 0.58, 0xd8a63c, x, PH + 0.165, z);
  }
  // brass kalasham on a plate of rice, coconut on top, five mango leaves
  const kx = MX + 0.05, kz = -0.95;
  gold.add(new THREE.CylinderGeometry(0.24, 0.26, 0.03, 16), 0xc9973a, mat(kx, PH + 0.02, kz));
  stone.add(new THREE.SphereGeometry(0.2, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0xf1ead9, mat(kx, PH + 0.03, kz, 0, 0, 0, 1, 0.3, 1));
  gold.add(lathe([[0, 0], [0.08, 0], [0.15, 0.06], [0.17, 0.14], [0.14, 0.22], [0.07, 0.27], [0.065, 0.31], [0.1, 0.34], [0, 0.34]], 14), 0xd6a13e, mat(kx, PH + 0.08, kz), 0);
  stone.add(new THREE.SphereGeometry(0.1, 10, 8), 0x8a5a2b, mat(kx, PH + 0.47, kz, 0, 0, 0, 1, 1.15, 1));
  stone.add(new THREE.ConeGeometry(0.03, 0.08, 6), 0x6b4523, mat(kx, PH + 0.6, kz));
  for (let k = 0; k < 5; k++) leafBlade(leaf, 0x3f7a2a, kx, PH + 0.4, kz, (k / 5) * Math.PI * 2, 0.9, 0.24, 0.05);
  // kuthu vilakku: tall brass tiered lamps with five wicks and a bird finial
  const lamp = LAMP_GEO;
  for (const lp of LIT.uLamps.value) {
    gold.add(lamp, 0xd9a23c, mat(lp.x, PH, lp.z - MZ), 0);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3, fx0 = lp.x + Math.cos(a) * 0.165, fz0 = lp.z - MZ + Math.sin(a) * 0.165;
      fx.push([0, fx0, PH + 1.49, fz0, 0.075, 0.13, 1.1]);
    }
    fx.push([1, lp.x, PH + 1.5, lp.z - MZ, 0.85, 0.85, 0.75], [2, lp.x, PH + 0.02, lp.z - MZ, 2.0, 2.0, 0.45]);
  }
}
// a pointed leaf blade (mango / banana): a curved strip; yaw = direction it points, droop bends the tip down
function leafBlade(bag, hex, x, y, z, yaw, droop, len, wid, rise = 0.6, segs = 5) {
  const pos = [], idx = [];
  let r = 0, h = 0;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, w = wid * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)) * (1 - t * 0.3);
    if (i > 0) { const el = rise - droop * t; r += Math.cos(el) * len / segs; h += Math.sin(el) * len / segs; }
    pos.push(r, h, -w, r, h + w * 0.18, 0, r, h, w);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 3;
    idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  bag.add(g, hex, mat(x, y, z, 0, -yaw, 0), 0.12);
}

/* ---------- 2b. banana plants, mango-leaf toran, jasmine curtains, garlands ---------- */
const JAS = 0xfbf7ea, ROSE = 0xa5101c, MARI = 0xe9780e, MARY = 0xf3b21c, BUD = 0xe8e2c4;
// flowers: [x, y, z, hex, size]
function buildFlorals(leaf, stone, flowers, R, dens) {
  const Y0 = PH + PIL_H + 0.05;
  const put = (x, y, z, hex, sz = 0.024) => flowers.push([x, y, z, hex, sz]);
  // young banana plant at each pillar, on the outside face, trunk tied with red thread
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = MX + sx * PIL, z = sz * (PIL + 0.26);
    stone.add(new THREE.CylinderGeometry(0.05, 0.085, 2.5, 8), 0x86a24f, mat(x, PH + 1.25, z), 0.1);
    for (const y of [0.9, 1.9]) stone.add(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 8), 0xb3141f, mat(x, PH + y, z));
    for (let k = 0; k < 5; k++) {
      const yaw = (sz > 0 ? Math.PI / 2 : -Math.PI / 2) + (k - 2) * 0.62 + (R() - 0.5) * 0.3;
      leafBlade(leaf, k % 2 ? 0x4f8d2f : 0x5c9a36, x, PH + 2.2 + k * 0.08, z, yaw, 1.5 + R() * 0.5, 1.15 + R() * 0.3, 0.2, 1.25, 7);
    }
    leafBlade(leaf, 0x7fb24a, x, PH + 2.45, z, 0, 0.2, 0.7, 0.05, 1.45, 4);        // furled new leaf
  }
  // mango-leaf toran on the road-facing beam, marigold string above it
  const tx = MX + PIL + 0.15;
  for (let z = -PIL + 0.1; z <= PIL - 0.05; z += 0.115) {
    leafBlade(leaf, R() < 0.5 ? 0x2f6a24 : 0x3b7a2a, tx, Y0 + 0.02, z, 0, 0.15, 0.24, 0.045, -1.45, 3);
    put(tx + 0.02, Y0 + 0.04, z + 0.05, R() < 0.5 ? MARI : MARY, 0.035);
  }
  // jasmine strings hanging from the canopy edge: short scalloped valance at the front,
  // fuller curtains on the sides and back, and long tied-back drapes by each pillar
  const edge = (sx, sz, t) => [MX + sx, sz, t];
  const sides = [
    { n: [1, 0], spacing: 0.12, len: t => 0.32 + 0.38 * Math.abs(Math.sin(t * Math.PI * 3)) },
    { n: [0, 1], spacing: 0.2, len: t => 0.9 + 0.35 * Math.abs(Math.sin(t * Math.PI * 2)) },
    { n: [0, -1], spacing: 0.2, len: t => 0.9 + 0.35 * Math.abs(Math.sin(t * Math.PI * 2)) },
    { n: [-1, 0], spacing: 0.2, len: t => 1.4 }
  ];
  const beadStep = 0.068 / dens;
  for (const sd of sides) {
    const off = PIL + 0.2, cnt = Math.round((2 * PIL) / sd.spacing * dens);
    for (let k = 0; k <= cnt; k++) {
      const t = k / cnt, o = -PIL + 2 * PIL * t;
      const x = MX + (sd.n[0] ? sd.n[0] * off : o), z = sd.n[1] ? sd.n[1] * off : o;
      const L = sd.len(t);
      for (let y = 0; y < L; y += beadStep) put(x, Y0 - 0.02 - y, z, R() < 0.06 ? BUD : JAS);
      put(x, Y0 - L - 0.05, z, ROSE, 0.04);                                         // a rose at each tassel
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {            // tied-back drapes: gathered at 1.1 m
    for (let k = 0; k < Math.round(4 * dens); k++) {
      const spread = (k / 4) * 0.55, bx = MX + sx * (PIL + 0.2) - sx * (sx > 0 ? spread : 0), bz = sz * (PIL + 0.2) - sz * (sx > 0 ? 0 : spread);
      const tieY = PH + 1.15, px = MX + sx * (PIL + 0.22), pz = sz * (PIL + 0.22);
      for (let y = Y0 - 0.02; y > PH + 0.3; y -= beadStep) {
        const u = y > tieY ? (Y0 - y) / (Y0 - tieY) : 1 - (tieY - y) / (tieY - PH) * 0.6;
        const e = Math.sin(Math.min(1, u) * Math.PI / 2);
        put(bx + (px - bx) * e, y, bz + (pz - bz) * e, JAS);
      }
    }
  }
  // rose-and-jasmine swags between the pillar tops (a thick rope of three strands)
  const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (let c = 0; c < 4; c++) {
    const [ax, az] = corners[c], [bx, bz] = corners[(c + 1) % 4];
    const A = [MX + ax * (PIL + 0.12), az * (PIL + 0.12)], B = [MX + bx * (PIL + 0.12), bz * (PIL + 0.12)];
    const n = Math.round(2 * PIL / 0.055 * dens);
    for (let i = 0; i <= n; i++) {
      const t = i / n, y = Y0 - 0.18 - 0.62 * Math.sin(Math.PI * t);
      const band = Math.floor(t * 12) % 2 ? ROSE : JAS;
      for (let r = 0; r < 3; r++) {
        const a = r * 2.09 + i * 0.7;
        put(A[0] + (B[0] - A[0]) * t + Math.cos(a) * 0.045 * (az === bz ? 1 : 0), y + Math.sin(a) * 0.045, A[1] + (B[1] - A[1]) * t + Math.cos(a) * 0.045 * (az === bz ? 0 : 1), band, 0.036);
      }
    }
    for (let y = 0; y < 0.45; y += beadStep) put((A[0] + B[0]) / 2, Y0 - 0.82 - y, (A[1] + B[1]) / 2, JAS);   // centre tassel
    put((A[0] + B[0]) / 2, Y0 - 1.3, (A[1] + B[1]) / 2, ROSE, 0.05);
  }
  // a jasmine-and-marigold spiral climbing each pillar
  for (const [sx, sz] of corners) {
    const x = MX + sx * PIL, z = sz * PIL;
    for (let y = 0.3; y < PIL_H - 0.2; y += 0.022 / dens) {
      const a = y * 11;
      put(x + Math.cos(a) * 0.17, PH + y, z + Math.sin(a) * 0.17, Math.floor(y * 40) % 7 === 0 ? ROSE : JAS, 0.024);
    }
  }
}

/* ---------- 6. entrance arch at the deck's near end on the axis, facing the forecourt; runner ----------
 * cy = forecourt carpet top above the deck (local y) at d0 - 0.5; the 0.5 m gap is bridged by a stair
 * (or a flush threshold) on the axis, with low marigold planters either side. */
function buildEntrance(stone, gold, runner, leaf, flowers, fx, R, dens, cy, groundAt) {
  const zA = HALF_Z - 0.3, SW = 2 * AW + 1.0, GAP = 0.5;   // arch line on the deck; stair width
  const zc = HALF_Z + GAP, gy = Math.min(-0.4, groundAt(AX, HALF_Z + 0.25) - 0.2);
  const n = cy > 0.1 ? Math.min(3, Math.max(1, Math.round(cy / 0.15))) : 0, d = GAP / Math.max(1, n);
  if (n === 0) {                                           // flush: one granite threshold slab
    stone.box(SW, Math.max(cy, 0) - gy, GAP + 0.02, 0x34322f, AX, (Math.max(cy, 0) + gy) / 2 - 0.002, HALF_Z + GAP / 2, 0, 0.03);
    runner.add(new THREE.PlaneGeometry(1.3, GAP + 0.1).rotateX(-Math.PI / 2), 0xffffff, mat(AX, Math.max(cy, 0) + 0.002, HALF_Z + GAP / 2), 0);
  }
  for (let k = 0; k < n; k++) {
    const z1 = zc - k * d, t = cy * (n - k) / (n + 1);    // equal risers: court → treads → deck
    stone.box(SW, t - gy, d + 0.02, 0x34322f, AX, (t + gy) / 2, z1 - d / 2, 0, 0.03);
    stone.box(SW + 0.02, 0.03, 0.05, 0xb9b2a4, AX, t - 0.012, z1 - d + 0.03);
    runner.add(new THREE.PlaneGeometry(1.3, d).rotateX(-Math.PI / 2), 0xffffff, mat(AX, t + 0.004, z1 - d / 2), 0);
  }
  // low planters bridging the rest of the gap, clipped hedge with marigolds, mirrored about the axis
  const top = Math.max(cy, 0);
  for (const sx of [-1, 1]) {
    const a = sx * (SW / 2 + 0.05), b = sx * X_ROAD, w = Math.abs(b - a), xc = (a + b) / 2;
    stone.box(w, top + 0.22 - gy, GAP - 0.02, 0x2f2d2a, xc, (top + 0.22 + gy) / 2, HALF_Z + GAP / 2, 0, 0.03);
    leaf.box(w - 0.1, 0.16, GAP - 0.12, 0x2e5a22, xc, top + 0.3, HALF_Z + GAP / 2, 0, 0.2);
    for (let i = 0; i < w * 14 * dens; i++) flowers.push([xc + (R() - 0.5) * (w - 0.15), top + 0.39 + R() * 0.03, HALF_Z + GAP / 2 + (R() - 0.5) * 0.3, R() < 0.55 ? MARI : R() < 0.6 ? MARY : JAS, 0.045]);
  }
  // the red runner down the aisle, from the arch to the mandap steps
  const z0 = HALF_Z, z1 = MZ + PW + 0.95, len = z0 - z1;
  const lane = new THREE.PlaneGeometry(1.3, len).rotateX(-Math.PI / 2);
  const uv = lane.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len / 2.6);
  runner.add(lane, 0xffffff, mat(AX, 0.006, (z0 + z1) / 2), 0);
  // arch: gilded plinths, a thick garland tube (marigold core) studded with blooms, in the x-y plane
  for (const sx of [-1, 1]) gold.box(0.38, 0.3, 0.38, 0xb88a2c, AX + sx * AW, 0.15, zA);
  const cpts = [];
  for (let y = 0.25; y < AH; y += 0.25) cpts.push(new THREE.Vector3(0, y, -AW));
  for (let a = Math.PI; a >= 0; a -= Math.PI / 16) cpts.push(new THREE.Vector3(0, AH + Math.sin(a) * AW, Math.cos(a) * AW));
  for (let y = AH - 0.25; y >= 0.25; y -= 0.25) cpts.push(new THREE.Vector3(0, y, AW));
  const curve = new THREE.CatmullRomCurve3(cpts);
  // rotateY(+90°) maps the curve's z spread on to x
  stone.add(new THREE.TubeGeometry(curve, 60, 0.13, 7), 0xd8680c, mat(AX, 0, zA, 0, Math.PI / 2, 0), 0.25);
  const nPts = Math.round(curve.getLength() / (0.05 / dens)), P = new THREE.Vector3(), Tn = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i <= nPts; i++) {
    const t = i / nPts; curve.getPointAt(t, P); curve.getTangentAt(t, Tn);
    N.set(0, -Tn.z, Tn.y).normalize();
    const band = Math.floor(t * 18) % 3;
    for (let r = 0; r < 5; r++) {
      const a = (r / 5) * Math.PI * 2 + i * 1.3 + R() * 0.4, rr = 0.135;
      const od = Math.cos(a) * rr, oo = Math.sin(a) * rr;
      const hex = band === 2 ? (r % 2 ? JAS : ROSE) : r === 3 ? JAS : band ? MARI : MARY;
      flowers.push([AX + P.z + N.z * oo, P.y + N.y * oo, zA + od, hex, 0.038]);
    }
  }
  // jasmine strands hanging inside the arch head, a rose at each tassel (symmetric)
  for (let k = 1; k < 14; k++) {
    const px = -AW + 2 * AW * k / 14, yTop = AH + Math.sqrt(Math.max(0, AW * AW - px * px)) - 0.12;
    const L = 0.3 + 0.4 * Math.sin(Math.PI * k / 14);
    for (let y = 0; y < L; y += 0.05 / dens) flowers.push([AX + px, yTop - y, zA + 0.03, JAS, 0.022]);
    flowers.push([AX + px, yTop - L - 0.03, zA + 0.03, ROSE, 0.035]);
  }
  // rose-and-jasmine mounds at the foot of each post
  for (const sx of [-1, 1]) for (let k = 0; k < 28 * dens; k++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 0.32, h = R() * 0.38 * (1 - r / 0.32);
    flowers.push([AX + sx * AW + Math.cos(a) * r, 0.3 + h, zA + Math.sin(a) * r, R() < 0.6 ? ROSE : JAS, 0.045]);
  }
  fx.push([1, AX, AH + 0.5, zA + 0.3, 2.6, 2.6, 0.22]);
  // a pair of tall kuthu vilakku on granite pedestals at the head of the aisle, marigold at their feet
  const lz = HALF_Z - 2.6, lx = S.aisle / 2 + 0.45;
  for (const sx of [-1, 1]) {
    const x = AX + sx * lx;
    stone.box(0.42, 0.5, 0.42, 0x2a2826, x, 0.25, lz, 0, 0.03);
    stone.box(0.5, 0.05, 0.5, 0x6c665d, x, 0.525, lz);
    gold.add(LAMP_GEO, 0xd9a23c, mat(x, 0.55, lz), 0);
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 + 0.3; fx.push([0, x + Math.cos(a) * 0.165, 0.55 + 1.49, lz + Math.sin(a) * 0.165, 0.075, 0.13, 1.1]); }
    fx.push([1, x, 2.05, lz, 0.9, 0.9, 0.75], [2, x, 0.02, lz, 2.6, 2.6, 0.4]);
    for (let k = 0; k < 40 * dens; k++) {
      const a = R() * Math.PI * 2, r = 0.3 + R() * 0.12;
      flowers.push([x + Math.cos(a) * r, 0.04 + R() * 0.06, lz + Math.sin(a) * r, R() < 0.7 ? MARI : JAS, 0.045]);
    }
  }
}

/* ---------- 4b. clay diyas along the aisle, the deck edges and the platform front ---------- */
function buildDiyas(stone, fx, R, dens) {
  const cup = lathe([[0, 0], [0.045, 0], [0.062, 0.04], [0, 0.03]], 6);
  const put = (x, z, y = 0) => {
    stone.add(cup, 0x9c4d27, mat(x, y + 0.005, z, 0, R() * 3, 0), 0.15);
    fx.push([0, x, y + 0.085, z, 0.042, 0.075, 1.0], [1, x, y + 0.08, z, 0.34, 0.34, 0.5]);
  };
  const run = (x0, z0, x1, z1, step, y) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / (step / dens)));
    for (let i = 0; i <= n; i++) put(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n, y);
  };
  const zs = MZ + PW + 1.15;                                        // just short of the mandap steps
  for (const sx of [-1, 1]) {
    run(sx * 0.88, HALF_Z - 0.9, sx * 0.88, zs, 0.6);               // both sides of the aisle
    run(sx * (X_ROAD - 0.25), -HALF_Z + 0.3, sx * (X_ROAD - 0.25), HALF_Z - 0.4, 0.75);   // deck edges
    run(sx * (AW + 0.6), HALF_Z - 0.4, sx * (X_ROAD - 0.6), HALF_Z - 0.4, 0.75);          // near end, either side of the arch
    run(sx * 1.25, MZ + PW - 0.12, sx * (PW - 0.15), MZ + PW - 0.12, 0.4, PH);           // platform front edge
  }
  run(X_SEA + 0.3, -HALF_Z + 0.3, X_ROAD - 0.3, -HALF_Z + 0.3, 0.75);                      // far end
}

/* ---------- 5. guest chairs: ivory covers, maroon sash with a bow (instanced) ---------- */
function chairGeometry() {
  const b = new Bag();
  const IV = 0xe4dac8, MA = 0x6e0f1a;
  b.box(0.44, 0.44, 0.44, IV, 0, 0.22, 0);                          // covered seat, skirt to the floor
  b.box(0.45, 0.04, 0.45, 0xece4d4, 0, 0.46, 0);                    // cushion top
  b.add(new THREE.BoxGeometry(0.05, 0.56, 0.42), IV, mat(0.2, 0.74, 0, 0, 0, -0.1));  // covered back (at +x)
  b.add(new THREE.CylinderGeometry(0.21, 0.21, 0.05, 6, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2).scale(1, 0.35, 1), IV, mat(0.23, 1.02, 0, 0, 0, -0.1)); // rounded top
  b.add(new THREE.BoxGeometry(0.09, 0.12, 0.46), MA, mat(0.215, 0.66, 0, 0, 0, -0.08)); // sash band
  b.add(new THREE.BoxGeometry(0.03, 0.1, 0.13), MA, mat(0.27, 0.67, -0.07, 0.5, 0, 0));  // bow loops
  b.add(new THREE.BoxGeometry(0.03, 0.1, 0.13), MA, mat(0.27, 0.67, 0.07, -0.5, 0, 0));
  b.add(new THREE.BoxGeometry(0.02, 0.3, 0.05), MA, mat(0.27, 0.48, -0.03, 0.12, 0, 0)); // tails
  b.add(new THREE.BoxGeometry(0.02, 0.28, 0.05), MA, mat(0.27, 0.49, 0.04, -0.15, 0, 0));
  return b.merge();
}
function buildChairs(chairMat, dens) {
  // two mirrored blocks either side of the aisle, facing the mandap (-z); back rows toward the arch
  const spots = [], cols = 7, colStep = 0.56, rowStep = 0.95;
  const rows = Math.max(6, Math.round(12 * Math.min(1, dens + 0.2)));
  const z0 = MZ + PW + 1.9;                              // front row, clear of the steps
  for (let r = 0; r < rows; r++) for (const sx of [-1, 1]) for (let c = 0; c < cols; c++) {
    spots.push([sx * (S.aisle / 2 + 0.36 + c * colStep), z0 + r * rowStep]);
  }
  const mesh = new THREE.InstancedMesh(chairGeometry(), chairMat, spots.length);
  spots.forEach(([x, z], i) => mesh.setMatrixAt(i, mat(x, 0, z, 0, -Math.PI / 2)));
  mesh.name = 'muhurtham:chairs';
  return mesh;
}

/* ---------- 7. on the forecourt: the kolam on the drop-off, and the island centrepiece ----------
 * The compound (compound.js) builds the lawn, drive, carpet, walls and gates. Built from path
 * coordinates, taken into the deck frame (inv). Returns the kolam decals and the carpet height. */
function buildCourt(ctx, inv, stone, gold, leaf, flowers, fx, R, dens) {
  const { path } = ctx;
  const _p = new THREE.Vector3();
  const L = (s, lat, dy) => { path.toWorld(s, lat, _p); _p.y = path.roadY(s) + dy; return _p.applyMatrix4(inv).clone(); };
  const kolams = [];
  // the kolam on the drop-off, round the car
  const K = L(S.stop.s, S.stop.l, 0.039);
  kolams.push(new THREE.PlaneGeometry(3.6, 3.6).rotateX(-Math.PI / 2).translate(K.x, K.y, K.z));
  // island: a granite disc with a kolam inlaid, a brass kuthu vilakku, jasmine and marigold mounds (≤ 1.5 m)
  const I = S.island, rD = Math.min(1.35, I.rl - 0.45), C = L(I.s, I.l, 0.012), H = 0.1;
  stone.add(new THREE.CylinderGeometry(rD, rD + 0.04, H, 40), 0x2c2a28, mat(C.x, C.y + H / 2, C.z), 0.02);
  gold.add(new THREE.TorusGeometry(rD - 0.02, 0.018, 4, 48), 0xc99a3a, mat(C.x, C.y + H, C.z, Math.PI / 2, 0, 0), 0);
  kolams.push(new THREE.CircleGeometry(rD - 0.06, 40).rotateX(-Math.PI / 2).translate(C.x, C.y + H + 0.003, C.z));
  const ped = 0.1, sc = 0.7;                              // pedestal, lamp scale: top at ~1.47 m
  gold.add(new THREE.CylinderGeometry(0.2, 0.24, ped, 16), 0xb88a2c, mat(C.x, C.y + H + ped / 2, C.z));
  gold.add(LAMP_GEO, 0xd9a23c, mat(C.x, C.y + H + ped, C.z, 0, 0, 0, sc, sc, sc), 0);
  const fy = C.y + H + ped + 1.49 * sc;
  for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 + 0.3; fx.push([0, C.x + Math.cos(a) * 0.165 * sc, fy, C.z + Math.sin(a) * 0.165 * sc, 0.06, 0.1, 1.1]); }
  fx.push([1, C.x, fy, C.z, 0.8, 0.8, 0.7], [2, C.x, C.y + H + 0.01, C.z, 3.2, 3.2, 0.5]);
  // six flower mounds round the lamp, marigold and jasmine alternating; a rose ring at the lamp's foot
  for (let m = 0; m < 6; m++) {
    const a = m / 6 * Math.PI * 2, mx = C.x + Math.cos(a) * rD * 0.62, mz = C.z + Math.sin(a) * rD * 0.62;
    const hexA = m % 2 ? JAS : MARI, hexB = m % 2 ? BUD : MARY;
    for (let k = 0; k < 50 * dens; k++) {
      const b = R() * Math.PI * 2, r = Math.sqrt(R()) * 0.3, h = 0.26 * Math.sqrt(1 - (r / 0.3) ** 2) * (0.7 + R() * 0.3);
      flowers.push([mx + Math.cos(b) * r, C.y + H + 0.02 + h, mz + Math.sin(b) * r, R() < 0.8 ? hexA : hexB, 0.045]);
    }
    leafBlade(leaf, 0x3b7a2a, mx, C.y + H + 0.01, mz, a, 0.4, 0.42, 0.07, 0.15, 4);
  }
  for (let k = 0; k < 36 * dens; k++) { const a = k / (36 * dens) * Math.PI * 2; flowers.push([C.x + Math.cos(a) * 0.3, C.y + H + 0.03, C.z + Math.sin(a) * 0.3, ROSE, 0.04]); }
  // the carpet at the deck's edge (road + 0.03), on the axis
  return { kolam: mergeGeometries(kolams, false), cy: L(S.d0 - 0.5, S.ax, 0.03).y };
}

/* ---------- build ---------- */
export default {
  id: 'cove',
  build(ctx) {
    const { path, world, quality } = ctx;
    const t0 = performance.now();
    const R = ctx.rng ? ctx.rng('muhurtham') : Math.random;
    const dens = quality.tier === 'high' ? 1 : quality.tier === 'med' ? 0.7 : 0.45;
    const group = new THREE.Group();
    group.name = 'event-muhurtham';
    // a level deck, its top within road - 0.05 … road + 0.02 all along it (SITES.md rule 3)
    let rMin = 1e9, rMax = -1e9;
    for (let ds = -HALF_Z; ds <= HALF_Z; ds += 1) { const y = path.roadY(S_C + ds); rMin = Math.min(rMin, y); rMax = Math.max(rMax, y); }
    const deckY = Math.max(rMax - 0.05, Math.min(rMin + 0.02, path.roadY(S.d0) - 0.02));
    const c = path.toWorld(S_C, LAT_C);
    group.position.set(c.x, deckY, c.z);
    group.rotation.y = path.sample(S_C).heading;
    const groundAt = (x, z) => world.heightSL(S_C - z, LAT_C + x) - deckY;
    group.updateMatrix();
    const inv = group.matrix.clone().invert();

    const wood = new Bag(true), stone = new Bag(), gold = new Bag(), runner = new Bag(true), leaf = new Bag();
    const fx = [], flowers = [];
    buildDeck(ctx, wood, stone, groundAt);
    // the mandap, its florals and its fire are built in the mandap frame (front toward +x), then turned
    const bags = [stone, gold, runner, leaf];
    bags.forEach(b => { b.post = MFRAME; });
    const f0 = flowers.length, x0 = fx.length;
    buildMandap(stone, gold, runner);
    buildRitual(stone, gold, leaf, fx, R);
    buildFlorals(leaf, stone, flowers, R, dens);
    bags.forEach(b => { b.post = null; });
    for (let i = f0; i < flowers.length; i++) { const f = flowers[i]; [f[0], f[2]] = toDeck(f[0], f[2]); }
    for (let i = x0; i < fx.length; i++) { const f = fx[i]; [f[1], f[3]] = toDeck(f[1], f[3]); }
    const ct = buildCourt(ctx, inv, stone, gold, leaf, flowers, fx, R, dens);
    buildEntrance(stone, gold, runner, leaf, flowers, fx, R, dens, ct.cy, groundAt);
    buildDiyas(stone, fx, R, dens);

    const mats = {
      wood: litMat({ map: woodTex(R), vertexColors: true, roughness: 0.88 }, { amb: 0.05 }),
      stone: litMat({ vertexColors: true, roughness: 0.75 }, { amb: 0.05 }),
      gold: litMat({ vertexColors: true, roughness: 0.42, metalness: 0.55 }, { amb: 0.05 }),
      runner: litMat({ map: runnerTex(), vertexColors: true, roughness: 0.9 }, { amb: 0.3 }),
      leaf: litMat({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }, { amb: 0.05 }),
      flower: litMat({ roughness: 0.5 }, { amb: 0.1, self: 0.35 }),
      chair: litMat({ vertexColors: true, roughness: 0.85 }, { amb: 0.04 })
    };
    const add = (bag, m, name) => { const mesh = new THREE.Mesh(bag.merge(), m); mesh.name = 'muhurtham:' + name; group.add(mesh); return mesh; };
    add(wood, mats.wood, 'wood'); add(stone, mats.stone, 'stone'); add(gold, mats.gold, 'gold');
    add(runner, mats.runner, 'runner'); add(leaf, mats.leaf, 'leaf');
    group.add(buildChairs(mats.chair, dens));
    // the compound (lawn, granite drive and apron, road wall, gates, bollards): built in world
    // coordinates, so it is carried in the deck frame by the inverse of the group's transform
    const compound = buildCompound(ctx, 'muhurtham', {
      drive: { base: '#232221', joint: '#8f887c', accent: '#5a5650' },
      stone: 0xd9d1c1, cap: 0xb88a3a, glow: 0xffc27a, seaWall: true, carpet: '#8a1f22'   // continues the red aisle runner
    });
    compound.group.applyMatrix4(inv);
    group.add(compound.group);
    const kolamMat = litMat({ map: kolamTex(), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }, { amb: 0.18, self: 0.25 });
    const kolam = new THREE.Mesh(ct.kolam, kolamMat); kolam.name = 'muhurtham:kolam'; kolam.renderOrder = 2; group.add(kolam);

    // flowers: one instanced octahedron per bud
    const fg = new THREE.BufferGeometry();                              // 6-triangle bud (triangular bipyramid)
    fg.setAttribute('position', new THREE.Float32BufferAttribute([0, 1, 0, 0, -1, 0, 1, 0, 0, -0.5, 0, 0.87, -0.5, 0, -0.87], 3));
    fg.setIndex([0, 3, 2, 0, 4, 3, 0, 2, 4, 1, 2, 3, 1, 3, 4, 1, 4, 2]);
    fg.computeVertexNormals();
    const fl = new THREE.InstancedMesh(fg, mats.flower, flowers.length);
    const col = new THREE.Color();
    flowers.forEach(([x, y, z, hex, sz], i) => {
      fl.setMatrixAt(i, mat(x, y, z, R() * 3, R() * 3, 0, sz, sz * 1.25, sz));
      fl.setColorAt(i, col.set(hex).multiplyScalar(0.9 + R() * 0.2));
    });
    fl.name = 'muhurtham:flowers';
    group.add(fl);

    // fx: flames, halos, light pools
    const fxMat = fxMaterial();
    const fxm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), fxMat, fx.length);
    const aFx = new Float32Array(fx.length * 4);
    fx.forEach(([kind, x, y, z, sx, sy, str], i) => {
      fxm.setMatrixAt(i, kind === 2 ? mat(x, y, z, -Math.PI / 2, 0, 0, sx, sy, 1) : mat(x, y, z, 0, 0, 0, sx, sy, 1));
      aFx.set([kind, R(), str, 0], i * 4);
    });
    fxm.geometry.setAttribute('aFx', new THREE.InstancedBufferAttribute(aFx, 4));
    fxm.frustumCulled = false;
    fxm.renderOrder = 4;
    fxm.name = 'muhurtham:fx';
    group.add(fxm);

    if (ctx.buildTimes) ctx.buildTimes['muhurtham'] = Math.round(performance.now() - t0);
    let tris = 0;
    const per = {};
    group.traverse(o => { if (o.isMesh) { const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.count || 1); tris += n; per[o.name] = Math.round(n); } });
    group.userData.stats = { tris: Math.round(tris), calls: Object.keys(per).length, flowers: flowers.length, fx: fx.length, ms: Math.round(performance.now() - t0), per };
    window.__muh = group.userData.stats;   // debugging handle (tris, calls, build ms)

    return {
      group,
      update(dt, s, cam) {
        const t = world.U.uTime.value, d = world.U.uDusk.value;
        LIT.uGlow.value = 0.25 + 0.75 * d;
        LIT.uFlick.value = 0.88 + 0.08 * Math.sin(t * 9.3) + 0.05 * Math.sin(t * 14.1 + 1.7) + 0.03 * Math.sin(t * 23.0);
        fxMat.uniforms.uTime.value = t;
        fxMat.uniforms.uGlow.value = d;
        compound.update(d);
      }
    };
  }
};
