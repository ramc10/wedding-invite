/* Zone 'garden-beach' — the garden opens onto sand and a turquoise sea on
 * the left: coconut palms along the shore, dune grass, a few beach umbrellas
 * and rocks at the tide line; the garden's lawns and flowers carry on to the
 * right. The sea itself is biomes/water.js (kind 'sea').
 *
 * Exports helpers the cove reuses: duneGrass(ctx, opts), coastRocks(ctx, opts).
 */
import * as THREE from 'three';
import { makeWater } from './water.js';
import { plant, band } from './flora.js';
import { fbm, smoothstep } from '../core/noise.js';

const TIER = { low: 0.45, med: 0.7, high: 1 };
export const tierK = ctx => TIER[ctx.quality.tier] ?? 1;

/* Dune grass: instanced tufts of thin bent blades, straw to sage. */
let tuftGeo = null;
function tuftGeometry() {
  if (tuftGeo) return tuftGeo;
  const pos = [], col = [];
  const base = new THREE.Color(0x6f7440), tip = new THREE.Color(0xd8c98c), _mid = new THREE.Color(0x9fa060);
  // spinifex: a hummock of stiff, spiky blades radiating out and arching over
  const N = 16;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2 + ((k * 37) % 11) * 0.21, lean = 0.35 + 0.45 * ((k * 53) % 7) / 7;
    const h = 0.4 + 0.35 * ((k * 29) % 5) / 5, w = 0.028;
    const dx = Math.cos(a), dz = Math.sin(a);
    const px = -dz * w, pz = dx * w;
    // two segments: rise then arch outward/down
    const mx = dx * lean * 0.5, mz = dz * lean * 0.5, my = h;
    const tx = dx * lean * 1.1, tz = dz * lean * 1.1, ty = h * 0.72;
    pos.push(px, 0, pz, -px, 0, -pz, mx + px * 0.6, my, mz + pz * 0.6);
    pos.push(-px, 0, -pz, mx - px * 0.6, my, mz - pz * 0.6, mx + px * 0.6, my, mz + pz * 0.6);
    pos.push(mx + px * 0.6, my, mz + pz * 0.6, mx - px * 0.6, my, mz - pz * 0.6, tx, ty, tz);
    for (const c of [base, base, _mid, base, _mid, _mid, _mid, _mid, tip]) col.push(c.r, c.g, c.b);
  }
  tuftGeo = new THREE.BufferGeometry();
  tuftGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tuftGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  tuftGeo.computeVertexNormals();
  // blades read better lit from above
  const n = tuftGeo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3);
  return tuftGeo;
}

let grassMat = null;
function grassMaterial(ctx) {
  if (grassMat) return grassMat;
  const U = ctx.world.U;
  grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  grassMat.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          float k = transformed.y * transformed.y;
          transformed.x += sin(uTime * 2.2 + ip.x * 0.4 + ip.z * 0.3) * 0.12 * k;
          transformed.z += cos(uTime * 1.7 + ip.z * 0.5) * 0.08 * k;
        }`);
  };
  grassMat.customProgramCacheKey = () => 'coast-grass';
  return grassMat;
}

/** Instanced dune grass on dry sand/ground: place(rng) → {s, lateral} | null. */
export function duneGrass(ctx, { count, place, seed = 7, minY = 0.35, maxY = 4, yAt = null }) {
  const { path, world, rng } = ctx;
  const R = rng(seed);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  const mats = [], cols = [];
  for (let i = 0; i < count; i++) {
    const at = place(R, i);
    if (!at || Math.abs(at.lateral) < world.VERGE + 0.5) continue;
    const y = yAt ? yAt(at.s, at.lateral) : world.heightSL(at.s, at.lateral);
    const w = world.waterAt(at.s) ?? -1e9;
    if (y < w + minY || y > w + maxY + 10) continue;
    path.toWorld(at.s, at.lateral, p); p.y = y - 0.05;
    q.setFromAxisAngle(up, R() * 6.283);
    const k = 0.7 + R() * 0.9;
    sc.set(k, k * (0.8 + R() * 0.5), k);
    mats.push(m.compose(p, q, sc).clone());
    cols.push(c.setHSL(0.13 + R() * 0.06, 0.25 + R() * 0.2, 0.55 + R() * 0.2).clone());
  }
  const mesh = new THREE.InstancedMesh(tuftGeometry(), grassMaterial(ctx), Math.max(1, mats.length));
  mesh.count = mats.length;
  mats.forEach((mm, i) => { mesh.setMatrixAt(i, mm); mesh.setColorAt(i, cols[i]); });
  if (!mats.length) mesh.setColorAt(0, c.set(1, 1, 1));
  mesh.computeBoundingSphere();
  mesh.name = 'dune-grass';
  return mesh;
}

/** Wet dark rocks at the tide line. */
export function coastRocks(ctx, { s0, s1, count, seed = 'rocks' }) {
  return plant(ctx, {
    kind: 'boulder', count, seed, scale: [0.6, 2.4], allowRoad: false,
    colors: [0x8d8375, 0x7a7266, 0xa49886, 0x6e675d],
    place: (R) => {
      const s = s0 + R() * (s1 - s0);
      // find roughly where the ground meets the water and scatter around it
      let lat = -12;
      for (; lat > -80; lat -= 2) if (ctx.world.heightSL(s, lat) < 0.6) break;
      return { s, lateral: lat + (R() - 0.3) * 6 };
    }
  });
}

/** Striped beach umbrellas + a towel under each (one draw call). */
export function umbrellas(ctx, spots) {
  const { path, world } = ctx;
  const parts = [];
  const pole = new THREE.CylinderGeometry(0.035, 0.035, 2.3, 5).translate(0, 1.15, 0);
  const tint = (g, hex) => {
    const c = new THREE.Color(hex), n = g.attributes.position.count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3));
    return g.index ? g.toNonIndexed() : g;
  };
  parts.push(tint(pole, 0xf2efe8));
  const canopy = new THREE.ConeGeometry(1.35, 0.55, 12, 1, true).toNonIndexed();
  canopy.translate(0, 2.25, 0);
  {
    const n = canopy.attributes.position.count, col = new Float32Array(n * 3);
    const a = new THREE.Color(0xffffff), b = new THREE.Color(0xe8574a);
    for (let i = 0; i < n; i++) { const c = Math.floor(i / 3) % 2 ? a : b; col.set([c.r, c.g, c.b], i * 3); }
    canopy.setAttribute('color', new THREE.BufferAttribute(col, 3));
    canopy.deleteAttribute('uv');
  }
  parts.push(canopy);
  const towel = tint(new THREE.PlaneGeometry(0.8, 1.8).rotateX(-Math.PI / 2).translate(0.9, 0.04, 0.3), 0xf6d16a);
  parts.push(towel);
  for (const g of parts) { g.deleteAttribute('uv'); g.computeVertexNormals(); }
  const geo = mergeSimple(parts);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const cols = [0xffffff, 0x9fd8ff, 0xfff0a0, 0xffc0d0, 0xb0f0c0];
  spots.forEach((sp, i) => {
    path.toWorld(sp.s, sp.lateral, p); p.y = world.heightSL(sp.s, sp.lateral) - 0.05;
    q.setFromAxisAngle(up, sp.yaw ?? i * 1.3);
    mesh.setMatrixAt(i, m.compose(p, q, new THREE.Vector3(1, 1, 1)));
    mesh.setColorAt(i, new THREE.Color(cols[i % cols.length]));
  });
  mesh.computeBoundingSphere();
  mesh.name = 'umbrellas';
  return mesh;
}

/** Concatenate non-indexed geometries with position/normal/color. */
export function mergeSimple(list) {
  const out = new THREE.BufferGeometry();
  for (const [name, k] of [['position', 3], ['normal', 3], ['color', 3]]) {
    let n = 0; for (const g of list) n += g.attributes[name].array.length;
    const a = new Float32Array(n); let o = 0;
    for (const g of list) { a.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(a, k));
  }
  return out;
}

/** Find the lateral (left side) where ground meets water level + off. */
export function shoreLat(ctx, s, off = 0.4) {
  const w = ctx.world.waterAt(s) ?? 0;
  let lat = -ctx.world.VERGE;
  for (; lat > -120; lat -= 1) if (ctx.world.heightSL(s, lat) < w + off) break;
  return lat;
}

/* ---- sand overlay: a skin over the terrain from the sea wall down under the
 * surf, with wind ripples, swash-wet band, shell grit and low dunes. It sits a
 * few cm above the terrain everywhere (never below), its ends and inner edge
 * are dissolved with dithered noise so no mesh edge reads. ---- */
function duneH(s, lat, wall, shore) {
  // dunes live between the wall toe and ~6 m above the swash line
  const t = (lat - shore) / Math.max(1, wall - shore);          // 0 at shore … 1 at wall
  const band = smoothstep(0.35, 0.6, t) * smoothstep(1.02, 0.8, t);
  const n = fbm(s * 0.045 + 3.1, lat * 0.11, 3);
  return band * Math.max(0, 0.25 + n) * 1.25;
}

export function sandBeach(ctx, { s0, s1, wallLat, fadeIn = 24, fadeOut = 24 }) {
  const { path, world } = ctx;
  const DS = 1.5;
  const rows = Math.ceil((s1 - s0) / DS) + 1;
  const pos = [], fade = [], idx = [];
  const p = new THREE.Vector3();
  const cols = 56;
  for (let r = 0; r < rows; r++) {
    const s = Math.min(s1, s0 + r * DS);
    const w = world.waterAt(s) ?? 0;
    const shore = shoreLat(ctx, s, 0);
    const fs = Math.min(smoothstep(s0, s0 + fadeIn, s), smoothstep(s1, s1 - fadeOut, s));
    for (let c = 0; c < cols; c++) {
      // columns spread from the wall to 7.5 m under the surf, denser inshore
      const l = wallLat + (shore - 7.5 - wallLat) * Math.pow(c / (cols - 1), 1.15);
      path.toWorld(s, l, p);
      const h = world.heightSL(s, l);
      const dune = h > w + 0.9 ? duneH(s, l, wallLat, shore) : 0;
      pos.push(p.x, h + 0.1 + dune, p.z);            // clear of the coarser terrain triangles
      fade.push(fs);
    }
  }
  for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) {
    const a = (r - 1) * cols + c - 1, b = a + 1, d = r * cols + c - 1, e = d + 1;
    idx.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // winding check: normals must face up
  if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
  const mesh = new THREE.Mesh(g, sandMaterial(ctx));
  mesh.receiveShadow = true;
  mesh.name = 'beach-sand';
  return mesh;
}

function sandMaterial(ctx) {
  const U = ctx.world.U;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uWater = { value: 0 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uWater;
        varying float vFade;
        varying vec3 vWP;
        float sh21(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
        float sn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(sh21(i), sh21(i + vec2(1, 0)), f.x), mix(sh21(i + vec2(0, 1)), sh21(i + vec2(1, 1)), f.x), f.y); }
        float sfbm(vec2 p) { return sn(p) * 0.5 + sn(p * 2.03 + 7.1) * 0.27 + sn(p * 4.1 + 3.3) * 0.15 + sn(p * 8.3) * 0.08; }
        // wind ripples: wavy crests ~0.35 m apart, broken up by noise
        float ripple(vec2 p) {
          float warp = sfbm(p * 0.35) * 3.0;
          float ph = dot(p, vec2(0.93, 0.36)) * 18.0 + warp * 4.0;
          return (0.5 + 0.5 * sin(ph)) * smoothstep(0.25, 0.6, sfbm(p * 0.5 + 11.0));
        }
        float wetAt(vec3 wp) {
          // swash reach breathes with the surf (~9 s)
          float reach = 0.55 + 0.18 * sin(uTime * 0.7 + wp.z * 0.05) + 0.12 * (sn(wp.xz * 0.15) - 0.5);
          return smoothstep(uWater + reach + 0.35, uWater + reach - 0.05, wp.y);
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // dissolve the ends / inner edge with dithered noise
          float dn = sfbm(vWP.xz * 0.6) * 0.8 + sh21(gl_FragCoord.xy) * 0.2;
          if (dn > vFade * 1.1) discard;
          float g = sfbm(vWP.xz * 1.7);
          float grit = sh21(floor(vWP.xz * 60.0));
          vec3 dry = mix(vec3(0.64, 0.51, 0.35), vec3(0.74, 0.61, 0.43), g);
          dry = mix(dry, vec3(0.62, 0.55, 0.45), smoothstep(0.93, 1.0, grit) * 0.6);   // dark grains
          dry = mix(dry, vec3(0.96, 0.93, 0.86), smoothstep(0.975, 1.0, sh21(floor(vWP.xz * 23.0) + 3.0)) * 0.7); // shell bits
          float wet = wetAt(vWP);
          float seaweed = smoothstep(0.72, 0.8, sfbm(vWP.xz * vec2(0.3, 2.2))) * smoothstep(0.1, 0.0, abs(vWP.y - uWater - 0.75));
          vec3 col = mix(dry, dry * vec3(0.55, 0.52, 0.5), wet);
          col = mix(col, vec3(0.25, 0.22, 0.14), seaweed * 0.6);
          col *= 0.92 + 0.12 * ripple(vWP.xz) * (1.0 - wet);
          diffuseColor.rgb = col;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.95, 0.18, wetAt(vWP));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float camD = length(vWP - cameraPosition);
          float fadeR = 1.0 - smoothstep(12.0, 45.0, camD);
          float e = 0.03;
          float r0 = ripple(vWP.xz), rx = ripple(vWP.xz + vec2(e, 0.0)), rz = ripple(vWP.xz + vec2(0.0, e));
          vec2 gr = vec2(rx - r0, rz - r0) / e * 0.012 * fadeR * (1.0 - wetAt(vWP));
          normal = normalize(normal - (viewMatrix * vec4(gr.x, 0.0, gr.y, 0.0)).xyz);
        }`);
  };
  m.customProgramCacheKey = () => 'gb-sand';
  return m;
}

/* ---- helpers for small merged props (vertex colour, non-indexed) ---- */
function paint(g, hex, jitter = 0, R = Math.random) {
  if (g.attributes.uv) g.deleteAttribute('uv');
  g.computeVertexNormals();                      // smooth while still indexed
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count, a = new Float32Array(n * 3), c = new THREE.Color(hex);
  for (let i = 0; i < n; i += 3) {
    const k = 1 + (R() - 0.5) * jitter;
    for (let j = 0; j < 3 && i + j < n; j++) a.set([c.r * k, c.g * k, c.b * k], (i + j) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/* Beach Road sea wall: a low whitewashed concrete parapet with coping, pipe
 * railing on posts, and a gap with steps down every ~110 m. One draw call. */
export function seaWall(ctx, { s0, s1, lat, seed = 5 }) {
  const { path, world, rng } = ctx;
  const R = rng(seed);
  const parts = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const put = (g, s, l, y, yaw) => {
    path.toWorld(s, l, p); p.y = y;
    q.setFromAxisAngle(up, yaw);
    parts.push(g.applyMatrix4(m.compose(p, q, sc)));
  };
  const SEG = 2.4, H = 0.62, T = 0.32;
  let s = s0;
  while (s < s1) {
    const gap = ((s - s0) % 110) > 104;
    const sm = s + SEG / 2, smp = path.sample(sm);
    const yaw = Math.atan2(smp.fwd.x, smp.fwd.z);
    const top = path.roadY(sm) + H;
    const bot = Math.min(world.heightSL(sm, lat - 0.5), world.heightSL(sm, lat + 0.3)) - 0.25;
    if (!gap) {
      const hh = top - bot;
      put(paint(new THREE.BoxGeometry(T, hh, SEG + 0.01), 0xd8d2c4, 0.08, R), sm, lat, bot + hh / 2, yaw);
      put(paint(new THREE.BoxGeometry(T + 0.1, 0.08, SEG + 0.01), 0xe8e3d8, 0.04, R), sm, lat, top + 0.04, yaw);
      put(paint(new THREE.BoxGeometry(T + 0.02, 0.18, SEG + 0.01), 0x9a9486, 0.1, R), sm, lat, bot + 0.2, yaw); // grimy foot
      // railing post + two pipe rails
      put(paint(new THREE.CylinderGeometry(0.035, 0.035, 0.62, 6), 0x2f5e78, 0.05, R), s, lat, top + 0.39, yaw);
      for (const hy of [0.4, 0.68]) {
        const rail = new THREE.CylinderGeometry(0.028, 0.028, SEG, 6).rotateX(Math.PI / 2);
        put(paint(rail, 0x2f5e78, 0.05, R), sm, lat, top + hy, yaw);
      }
    } else {
      // steps down through the gap
      for (let k = 0; k < 4; k++) {
        const l = lat - 0.4 - k * 0.45, y0 = world.heightSL(sm, l) - 0.3, y1 = path.roadY(sm) - 0.18 - k * 0.3;
        if (y1 <= y0) break;
        put(paint(new THREE.BoxGeometry(0.5, y1 - y0, SEG - 0.2), 0xcfc8b8, 0.08, R), sm, l, (y0 + y1) / 2, yaw);
      }
    }
    s += SEG;
  }
  const geo = mergeSimple(parts);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 }));
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.name = 'sea-wall';
  return mesh;
}

/* Bleached driftwood logs with a stub branch, half sunk in the sand. */
function driftGeo() {
  const log = new THREE.CylinderGeometry(0.11, 0.16, 3.2, 7, 4).rotateZ(Math.PI / 2);
  const pa = log.attributes.position;
  for (let i = 0; i < pa.count; i++) pa.setY(i, pa.getY(i) + Math.sin(pa.getX(i) * 1.3) * 0.06);
  const br = new THREE.CylinderGeometry(0.04, 0.08, 1.0, 5).rotateZ(-0.9).translate(0.7, 0.35, 0.05);
  const rt = new THREE.CylinderGeometry(0.05, 0.14, 0.5, 5).rotateZ(0.3).translate(-1.75, 0.05, 0);
  return mergeSimple([paint(log, 0xb8ad9c, 0.25), paint(br, 0xa89e8e, 0.2), paint(rt, 0x8c8272, 0.2)]);
}

/* Beached kattumaram-style fishing catamarans: lashed log hulls with a
 * sweeping bow, a thwart, a mast laid along it and a heap of net. */
function catGeo() {
  const parts = [];
  const hull = (z, len, r, col) => {
    const g = new THREE.CylinderGeometry(r, r * 0.8, len, 8, 10).rotateZ(Math.PI / 2);
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), b = Math.max(0, x - len * 0.18);
      pa.setY(i, pa.getY(i) + b * b * 0.16);                  // bow sweeps up
    }
    parts.push(paint(g.translate(0, r, z), col, 0.12));
  };
  hull(-0.55, 6.2, 0.2, 0x5b4636); hull(-0.2, 6.8, 0.22, 0x4f3d2f);
  hull(0.2, 6.8, 0.22, 0x55412f); hull(0.55, 6.2, 0.2, 0x5b4636);
  for (const x of [-1.8, 0.2, 1.9]) parts.push(paint(new THREE.BoxGeometry(0.12, 0.08, 1.6).translate(x, 0.46, 0), 0x3c2f25, 0.1));
  parts.push(paint(new THREE.CylinderGeometry(0.05, 0.06, 5.4, 6).rotateZ(Math.PI / 2 - 0.04).translate(-0.4, 0.58, 0.32), 0x8a7458, 0.1));
  parts.push(paint(new THREE.BoxGeometry(0.5, 0.3, 0.7).translate(0.6, 0.62, -0.1), 0x7d3a3a, 0.1));   // rolled sail
  const net = new THREE.IcosahedronGeometry(0.45, 1).scale(1.4, 0.45, 1).translate(-1.2, 0.58, -0.1);
  parts.push(paint(net, 0x2e4a52, 0.3));
  return mergeSimple(parts);
}

/** Instanced props on the beach: spots [{s, lateral, yaw, scale?}] */
function scatterProps(ctx, geo, spots, rough, name, sink = 0.05) {
  const { path, world } = ctx;
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough }), Math.max(1, spots.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  spots.forEach((sp, i) => {
    path.toWorld(sp.s, sp.lateral, p); p.y = world.heightSL(sp.s, sp.lateral) - sink;
    const r = path.sample(sp.s).right;                 // local +x → offshore (−right), then sp.yaw
    q.setFromAxisAngle(up, Math.atan2(r.z, -r.x) + (sp.yaw ?? 0));
    const k = sp.scale ?? 1;
    mesh.setMatrixAt(i, m.compose(p, q, new THREE.Vector3(k, k, k)));
  });
  mesh.count = spots.length;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  mesh.name = name;
  return mesh;
}

/** Top of the sand skin (terrain + dune) — plant beach props on this. */
export function beachY(ctx, s, lat, wallLat) {
  const h = ctx.world.heightSL(s, lat), w = ctx.world.waterAt(s) ?? 0;
  return h > w + 0.9 ? h + duneH(s, lat, wallLat, shoreLat(ctx, s, 0)) : h;
}

export default {
  id: 'garden-beach',
  build(ctx) {
    const { zones, world, rng } = ctx;
    const z = zones.byId['garden-beach'];
    const K = tierK(ctx);
    const group = new THREE.Group();
    group.name = 'garden-beach';
    const s0 = z.s0, s1 = z.s1;
    const WALL = -(world.VERGE + 0.35);
    const R = rng('gb-layout');

    // the sea: from under the verge out to the horizon; the cove continues it from s1
    group.add(makeWater(ctx, { s0: s0 - 40, s1, lateral0: -world.VERGE, lateral1: -460, y: world.waterAt(s0 + 1) ?? 0, kind: 'sea', extend: [700, 0] }));

    // sand skin from the wall toe down under the surf, dissolving into the neighbours
    group.add(sandBeach(ctx, { s0: s0 - 25, s1: s1 + 20, wallLat: WALL - 0.2, fadeIn: 30, fadeOut: 25 }));
    // Beach Road parapet + railing
    group.add(seaWall(ctx, { s0: s0 + 8, s1: s1 + 10, lat: WALL }));

    // coconut palms in loose clumps on the dunes, leaning seaward; a grove on the right
    const clumps = [];
    for (let s = s0 + 5; s < s1; s += 26 + R() * 30) clumps.push(s);
    group.add(plant(ctx, {
      kind: 'palm', count: Math.round(34 * K), seed: 'gb-palms', scale: [1.0, 1.45],
      place: (Rp, i) => {
        const s = clumps[i % clumps.length] + (Rp() - 0.5) * 9;
        const sh = shoreLat(ctx, s, 0);
        const lat = WALL - 2.5 - Rp() * Math.max(1, (WALL - sh) * -0.55);
        return { s, lateral: lat, yaw: Math.PI + (Rp() - 0.5) * 1.2 + ctx.path.sample(s).heading };
      }
    }));
    group.add(plant(ctx, { kind: 'palm', count: Math.round(34 * K), seed: 'gb-grove', scale: [0.9, 1.4], place: band(s0, s1, 10, 60, 'right') }));

    // garden spilling on to the right
    group.add(plant(ctx, { kind: 'flowers', count: Math.round(260 * K), seed: 'gb-fl', place: band(s0 - 30, s0 + (s1 - s0) * 0.55, 7, 30, 'right') }));
    group.add(plant(ctx, { kind: 'bush', count: Math.round(60 * K), seed: 'gb-bush', place: band(s0, s1, 8, 45, 'right') }));
    group.add(plant(ctx, { kind: 'blossom', count: Math.round(14 * K), seed: 'gb-blos', place: band(s0 - 30, s0 + 150, 16, 50, 'right') }));

    // spinifex on the dunes (clumped), sparse near the wall
    group.add(duneGrass(ctx, {
      count: Math.round(1100 * K), seed: 11, minY: 0.9,
      yAt: (s, l) => beachY(ctx, s, l, WALL - 0.2),
      place: (Rg) => {
        const s = s0 - 10 + Rg() * (s1 - s0 + 10);
        const l = WALL - 0.6 - Rg() * 15;
        const d = fbm(s * 0.045 + 3.1, l * 0.11, 3);             // same field as the dunes
        return d > -0.05 || Rg() < 0.15 ? { s, lateral: l } : null;
      }
    }));
    group.add(duneGrass(ctx, { count: Math.round(400 * K), seed: 12, place: band(s0, s1, 6, 40, 'right') }));

    // rocks at the tide line, clustered in a couple of reefs
    group.add(coastRocks(ctx, { s0: s0 + 40, s1: s1 - 20, count: Math.round(36 * K), seed: 'gb-rocks' }));

    // driftwood above the swash line
    const drift = [];
    for (let i = 0; i < Math.round(14 * K); i++) {
      const s = s0 + 20 + R() * (s1 - s0 - 30), sh = shoreLat(ctx, s, 0);
      drift.push({ s, lateral: sh + 2.2 + R() * 4, yaw: R() * 6.28, scale: 0.7 + R() * 0.6 });
    }
    group.add(scatterProps(ctx, driftGeo(), drift, 0.95, 'driftwood', 0.08));

    // a few beached fishing catamarans, bows toward the sea
    const cats = [];
    for (const f of [0.18, 0.22, 0.52, 0.57, 0.86]) {
      const s = s0 + f * (s1 - s0) + R() * 4, sh = shoreLat(ctx, s, 0);
      cats.push({ s, lateral: sh + 4.2 + R() * 1.5, yaw: (R() - 0.5) * 0.35 + (R() < 0.5 ? 1.5 : -1.5) });
    }
    group.add(scatterProps(ctx, catGeo(), cats, 0.8, 'catamarans', 0.12));

    const spots = [];
    for (let i = 0; i < 4; i++) {
      const s = s0 + 110 + i * ((s1 - s0 - 170) / 3) + (i % 2) * 12;
      spots.push({ s, lateral: shoreLat(ctx, s, 1.0) + 3.5 + (i % 3) * 1.5 });
    }
    group.add(umbrellas(ctx, spots));

    return { group };
  }
};
