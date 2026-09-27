/* A few falling blossom petals, forest and garden only.
 *
 * Elements: one instanced draw of small cupped petal cards (≈1.5 × 2.5 cm,
 * real cherry-blossom size), pale pink with a deeper base, lit by sun + sky
 * with a back-scatter term so petals against the sun glow. Motion is a real
 * falling leaf/petal: ~0.7 m/s descent, a pendulum side-to-side swing with
 * the tilt following the swing, slow tumbling, and a light ride on the shared
 * wind. They wrap inside a small box ahead of the camera and shrink to
 * nothing at its faces and near the lens, so none ever pops. The layer fades
 * out entirely past the garden (s ≈ 560–610) and is hidden elsewhere.
 * fog:true with the shared height-fog chunks. prefers-reduced-motion removes
 * the layer.
 *
 * API: init(ctx), update(dt, s)
 */
import * as THREE from 'three';
import { world } from '../core/world.js';

const U = world.U;
const BOX = new THREE.Vector3(16, 8, 22);
const COUNT = { high: 70, med: 45, low: 24 };
const S_FADE0 = 560, S_FADE1 = 610;   // garden ends at 597
let mesh = null, cam = null;
const amount = { value: 1 };
const center = new THREE.Vector3(), fwd = new THREE.Vector3();

/* notched, heart-ended petal silhouette (alpha only; colour is in the shader) */
function petalTexture() {
  const S = 64, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.translate(S / 2, S * 0.06);
  const len = S * 0.9, w = S * 0.46;
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(w * 0.9, len * 0.2, w * 1.05, len * 0.75, w * 0.32, len * 0.98);
  g.lineTo(0, len * 0.86);
  g.lineTo(-w * 0.32, len * 0.98);
  g.bezierCurveTo(-w * 1.05, len * 0.75, -w * 0.9, len * 0.2, 0, 0);
  g.closePath();
  g.fillStyle = '#fff';
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/* 2 columns x 3 rows, widest two-thirds up, cupped across and bowed along */
function petalGeometry() {
  const pos = [], uv = [], idx = [];
  for (let o = 0; o <= 2; o++) {
    for (let a = 0; a <= 1; a++) {
      const l = a, c = o / 2;
      const x = (l - 0.5) * 0.6 * (0.55 + 0.45 * Math.sin(c * Math.PI * 0.9 + 0.2));
      const y = c - 0.5;
      const z = -Math.pow(l - 0.5, 2) * 0.35 + Math.pow(c - 0.5, 2) * 0.12;
      pos.push(x, y, z); uv.push(l, c);
    }
  }
  for (let r = 0; r < 2; r++) {
    const i0 = r * 2, i1 = i0 + 1, i2 = i0 + 2, i3 = i2 + 1;
    idx.push(i0, i1, i2, i1, i3, i2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

const VERT = /* glsl */`
uniform float uTime, uSize, uDusk, uAmount;
uniform vec2 uWind;
uniform vec3 uBox, uCenter;
attribute vec4 aSeed, aAxis;
varying vec2 vUv;
varying vec3 vNrm, vWP;
varying float vTone, vKind;
#include <fog_pars_vertex>
mat3 rotAxis(vec3 a, float ang) {
  float s = sin(ang), c = cos(ang), oc = 1.0 - c;
  return mat3(oc*a.x*a.x + c, oc*a.x*a.y + a.z*s, oc*a.z*a.x - a.y*s,
              oc*a.x*a.y - a.z*s, oc*a.y*a.y + c, oc*a.y*a.z + a.x*s,
              oc*a.z*a.x + a.y*s, oc*a.y*a.z - a.x*s, oc*a.z*a.z + c);
}
void main() {
  float t = uTime * aAxis.w + aSeed.w * 40.0;
  vec3 p = aSeed.xyz * uBox * 3.0;
  // light ride on the shared wind (petals are draggy: ~half the air speed)
  p += vec3(uWind.x, 0.0, uWind.y) * uTime * (0.4 + aSeed.w * 0.3);
  // steady descent ~0.55-0.9 m/s
  p.y -= uTime * (0.55 + aSeed.w * 0.35);
  // pendulum swing: side-to-side glide, the petal tilting with the swing
  float ph = t * (3.2 + aSeed.x * 1.4);
  vec2 sdir = normalize(vec2(aAxis.x, aAxis.z) + 1e-3);
  float sw = sin(ph);
  p.xz += sdir * sw * (0.18 + aSeed.y * 0.12);
  p.y += (1.0 - cos(2.0 * ph)) * 0.04;          // brief lift at each end of the swing
  // wrap into the box around uCenter; shrink to nothing near its faces and the lens
  vec3 lo = uCenter - uBox * 0.5;
  vec3 w = mod(p - lo, uBox) + lo;
  vec3 rel = abs(w - uCenter) / (uBox * 0.5);
  float edge = 1.0 - smoothstep(0.7, 1.0, max(rel.x, max(rel.y, rel.z)));
  edge *= smoothstep(1.4, 3.0, distance(w, cameraPosition)) * uAmount;
  // orientation: mostly flat-ish, rocking with the swing, plus a slow tumble
  mat3 R = rotAxis(vec3(-sdir.y, 0.0, sdir.x), 1.35 + sw * 0.7)
         * rotAxis(normalize(aAxis.xyz), t * 0.9 + aSeed.w * 6.28);
  vec3 wp = w + R * (position * uSize * (0.8 + aSeed.w * 0.45) * edge);
  vWP = wp; vUv = uv; vNrm = R * vec3(0.0, 0.0, 1.0);
  vTone = 0.9 + aSeed.w * 0.15;
  vKind = 0.0;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform sampler2D tPetal;
uniform vec3 uSunDir, uSunCol, uSkyHor, uSkyTop;
uniform float uDusk;
varying vec2 vUv;
varying vec3 vNrm, vWP;
varying float vTone, vKind;
#include <fog_pars_fragment>
void main() {
  float a = texture2D(tPetal, vec2(vUv.x, 1.0 - vUv.y)).a;
  if (a < 0.5) discard;
  vec3 N = normalize(vNrm);
  vec3 V = normalize(cameraPosition - vWP);
  if (dot(N, V) < 0.0) N = -N;
  // blossom: deep pink base → near-white tip; marigold: saffron → gold
  float k = vUv.y;
  vec3 alb = mix(vec3(0.78, 0.42, 0.50), vec3(0.93, 0.80, 0.83), smoothstep(0.0, 0.7, k)) * vTone;
  float ndl = abs(dot(N, uSunDir));
  float back = pow(max(dot(-V, uSunDir), 0.0), 5.0);
  vec3 amb = mix(uSkyHor, uSkyTop, N.y * 0.5 + 0.5) * 0.55;
  vec3 col = alb * (amb + uSunCol * (ndl * 0.55 + back * 0.9 + 0.05) * (1.0 - 0.7 * uDusk));
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

function init(ctx) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  cam = ctx.camera;
  const n = COUNT[ctx.quality.tier] ?? COUNT.med;
  const geo = petalGeometry();
  const seed = new Float32Array(n * 4), axis = new Float32Array(n * 4);
  const v = new THREE.Vector3(), rnd = ctx.rng ? ctx.rng('petals') : Math.random;
  const r = typeof rnd === 'function' ? rnd : Math.random;
  for (let i = 0; i < n; i++) {
    seed.set([r(), r(), r(), r()], i * 4);
    v.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
    axis.set([v.x, v.y, v.z, 0.6 + r() * 0.8], i * 4);
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.setAttribute('aAxis', new THREE.InstancedBufferAttribute(axis, 4));
  geo.instanceCount = n;

  const mat = new THREE.ShaderMaterial({
    fog: true,
    side: THREE.DoubleSide,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: U.uTime, uWind: U.uWind, uSunDir: U.uSunDir, uSunCol: U.uSunCol,
      uSkyHor: U.uSkyHor, uSkyTop: U.uSkyTop, uDusk: U.uDusk,
      uBox: { value: BOX }, uCenter: { value: center }, uSize: { value: 0.03 }, uAmount: amount,
      tPetal: { value: petalTexture() }
    },
    vertexShader: VERT,
    fragmentShader: FRAG
  });
  mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'petals';
  mesh.frustumCulled = false;
  ctx.scene.add(mesh);
}

function update(dt, s) {
  if (!mesh) return;
  const k = 1 - THREE.MathUtils.smoothstep(s, S_FADE0, S_FADE1);
  amount.value = k;
  mesh.visible = k > 0.001;
  if (!mesh.visible) return;
  // the box sits mostly ahead of the camera, around the car
  cam.getWorldDirection(fwd);
  center.copy(cam.position).addScaledVector(fwd, BOX.z * 0.4);
  center.y = cam.position.y + 0.5;
}

export const fx = { init, update };
