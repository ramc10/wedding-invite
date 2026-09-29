/* Post-processing: HDR composite.
 *
 * Elements:
 *   1. Scene → HalfFloat target (linear HDR, MSAA x4 on 'high') with a depth
 *      texture. three skips tone mapping/sRGB when drawing into a target, so
 *      everything is tone-mapped exactly once, here.
 *   2. Ambient occlusion ('high'/'med'): half-res depth-only SAO (10 spiral
 *      taps, ~0.9 m world radius, normals from depth), faded out by 70 m so
 *      the fogged distance is untouched; blurred with a 5-tap cross in the
 *      composite. Gives contact darkening under the car, at trunk bases and
 *      in the grass.
 *   3. Bloom ('high'/'med'): subtle. Half-res soft-knee prefilter with a
 *      Karis-style firefly clamp, 3 downsamples, tent upsamples.
 *   4. Composite: AO · bloom · a faint sun veil when the sun is on screen ·
 *      exposure (atmosphere's) · ACES · sRGB · grade by time of day (neutral
 *      by day; warm highlights only at golden hour; cool blue shadows at dusk)
 *      · gentle S-curve and saturation · soft vignette · fine grain.
 *   5. Dither: triangular ±1 LSB noise on the 8-bit output (no sky banding).
 *   6. FXAA when the scene target isn't multisampled.
 * renderer.toneMapping is forced to NoToneMapping so nothing tone-maps twice.
 * quality 'low': no bloom, no AO; grade and dither kept.
 * Adaptive resolution (quality.scale): the scene and AO are drawn into a
 * viewport of that size inside fixed targets; the passes that read them
 * scale their uvs (uScale), so a scale step never reallocates a target.
 *
 * API: init(ctx), resize(w, h), render(renderer, scene, camera, dt)
 */
import * as THREE from 'three';
import { world } from '../core/world.js';
import { atmosphere } from './atmosphere.js';

let R, Q = null, tier = 'high', bloomOn = true, aoOn = true, msaa = 0;
let rtScene, rtLDR, rtAO, bloomRT = [];
const size = new THREE.Vector2(), cur = new THREE.Vector2(-1, -1), drawn = new THREE.Vector2();
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quadGeo = new THREE.BufferGeometry();
quadGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
quadGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const quad = new THREE.Mesh(quadGeo);
quad.frustumCulled = false;

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function pass(frag, uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: frag, uniforms,
    depthTest: false, depthWrite: false, toneMapped: false
  });
}

// ---- bloom ----------------------------------------------------------------
const PREFILTER = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel, uScale; uniform float uThresh, uExposure;
varying vec2 vUv;
vec3 tap(vec2 o) {
  vec3 c = texture2D(tSrc, min(vUv * uScale + o * uTexel, uScale - 0.5 * uTexel)).rgb;
  return c / (1.0 + max(c.r, max(c.g, c.b)) * uExposure * 0.25); // Karis-style: tame fireflies
}
void main() {
  vec3 c = (tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0))) * 0.25;
  float br = max(c.r, max(c.g, c.b)) * uExposure;   // threshold on exposed colour, output unexposed
  float knee = uThresh * 0.5;
  float soft = clamp(br - uThresh + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, br - uThresh) / max(br, 1e-4);
  gl_FragColor = vec4(c * w, 1.0);
}`;
const DOWN = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  c += texture2D(tSrc, vUv + vec2(1.0, -1.0) * uTexel).rgb;
  c += texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel).rgb;
  c += texture2D(tSrc, vUv + vec2(1.0, 1.0) * uTexel).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}`;
const UP = /* glsl */`
uniform sampler2D tSrc, tCur; uniform vec2 uTexel; uniform float uScatter;
varying vec2 vUv;
void main() {
  vec2 t = uTexel;
  vec3 c = texture2D(tSrc, vUv + vec2(-2.0, 0.0) * t).rgb + texture2D(tSrc, vUv + vec2(2.0, 0.0) * t).rgb
         + texture2D(tSrc, vUv + vec2(0.0, -2.0) * t).rgb + texture2D(tSrc, vUv + vec2(0.0, 2.0) * t).rgb;
  c += (texture2D(tSrc, vUv + vec2(-1.0, -1.0) * t).rgb + texture2D(tSrc, vUv + vec2(1.0, -1.0) * t).rgb
      + texture2D(tSrc, vUv + vec2(-1.0, 1.0) * t).rgb + texture2D(tSrc, vUv + vec2(1.0, 1.0) * t).rgb) * 2.0;
  gl_FragColor = vec4(texture2D(tCur, vUv).rgb + c / 12.0 * uScatter, 1.0);
}`;

// ---- ambient occlusion (half res, depth only) ------------------------------
const SAO = /* glsl */`
uniform sampler2D tDepth; uniform mat4 uProjInv; uniform vec2 uTexel, uScale; uniform float uPx, uRadius;
varying vec2 vUv;
// uv is in the drawn image's space; depth lives in the lower-left uScale of its texture
vec3 vpos(vec2 uv) {
  uv = clamp(uv, 0.5 * uTexel, 1.0 - 0.5 * uTexel);
  // Rebuild at the centre of the depth texel actually read. Half-res pixel
  // centres sit on full-res texel corners, and on the road at a grazing angle
  // that half-texel mismatch read as self-occlusion: dark bands across it.
  uv = (floor(uv / uTexel - 0.25) + 0.5) * uTexel;
  float d = texture2D(tDepth, uv * uScale).r;
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
void main() {
  float d0 = texture2D(tDepth, vUv * uScale).r;
  if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = vpos(vUv);
  float dist = -P.z;
  float fade = 1.0 - smoothstep(35.0, 70.0, dist);
  if (fade <= 0.0) { gl_FragColor = vec4(1.0); return; }
  // normal from the flatter of each neighbour pair (no halos at silhouettes)
  vec3 px1 = vpos(vUv + vec2(uTexel.x, 0.0)) - P, px0 = P - vpos(vUv - vec2(uTexel.x, 0.0));
  vec3 py1 = vpos(vUv + vec2(0.0, uTexel.y)) - P, py0 = P - vpos(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(px1.z) < abs(px0.z) ? px1 : px0;
  vec3 dy = abs(py1.z) < abs(py0.z) ? py1 : py0;
  vec3 N = normalize(cross(dx, dy));
  float rPx = min(uRadius * uPx / dist, 120.0);            // world radius → pixels
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float ao = 0.0, r2 = uRadius * uRadius;
  for (int i = 0; i < 10; i++) {
    float fi = (float(i) + ign) / 10.0;
    float ang = fi * 17.0 + ign * 6.2832;
    vec2 off = vec2(cos(ang), sin(ang)) * rPx * (0.15 + 0.85 * fi) * uTexel;
    vec3 v = vpos(vUv + off) - P;
    float vv = dot(v, v), vn = dot(v, N);
    float f = max(r2 - vv, 0.0);
    ao += f * f * f * max((vn - 0.015 * dist * 0.1 - 0.01) / (vv + 0.02), 0.0);
  }
  ao = ao / (r2 * r2 * r2) * (5.0 / 10.0);
  gl_FragColor = vec4(vec3(1.0 - clamp(ao, 0.0, 1.0) * fade), 1.0);
}`;

// ---- composite ------------------------------------------------------------
const GRAIN = /* glsl */`
float pHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 grain(vec3 c, vec2 px, float t) {
  float n = pHash(px + fract(t * 7.13) * 431.0) + pHash(px * 1.37 + fract(t * 3.71) * 97.0) - 1.0;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return c + n * 0.009 * (1.0 - l * 0.7);
}
vec3 dither(vec3 c, vec2 px) {   // TPDF, +-1 LSB of 8-bit
  float n = pHash(px + 0.37) + pHash(px.yx * 1.13 + 17.1) - 1.0;
  return c + n / 255.0;
}`;
const COMPOSITE = /* glsl */`
uniform sampler2D tScene, tBloom, tAO;
uniform float uExposure, uBloom, uTime, uAspect, uGrain, uGolden, uRose, uDusk, uAoAmt;
uniform vec2 uAoTexel, uAoScale, uScale, uSceneTexel;
uniform vec2 uRes;
uniform vec3 uSun, uSunCol;
varying vec2 vUv;
${GRAIN}
// three's ACES fit (RRT+ODT), same as ACESFilmicToneMapping
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color) {
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= 1.0 / 0.6;
  color = OUT * RRTAndODTFit(IN * color);
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666)) - 0.055, step(0.0031308, c)); }
// the scene and AO fill the lower-left uScale / uAoScale of their targets
float aoAt(vec2 o) { return texture2D(tAO, min(vUv * uAoScale + o, uAoScale - 0.5 * uAoTexel)).r; }
void main() {
  vec3 col = texture2D(tScene, min(vUv * uScale, uScale - 0.5 * uSceneTexel)).rgb;
  #ifdef AO
  vec2 at = uAoTexel * 1.5;
  float ao = aoAt(vec2(0.0)) * 0.4 + (aoAt(vec2(at.x, 0.0)) + aoAt(vec2(-at.x, 0.0))
           + aoAt(vec2(0.0, at.y)) + aoAt(vec2(0.0, -at.y))) * 0.15;
  col *= mix(1.0, ao, uAoAmt);
  #endif
  #ifdef BLOOM
  col += texture2D(tBloom, vUv).rgb * uBloom;
  #endif
  // faint veil when the sun is on screen (lens glare)
  vec2 d = vUv * 2.0 - 1.0 - uSun.xy; d.x *= uAspect;
  float r = length(d);
  col += uSunCol * uSun.z * (exp(-r * r * 6.0) * 0.08 + exp(-r * 2.2) * 0.03);
  col = aces(col * uExposure);
  col = toSRGB(col);
  // grade: neutral by day, warm highlights only at golden hour, cool dusk shadows
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float sh = 1.0 - smoothstep(0.0, 0.5, l), hi = smoothstep(0.45, 1.0, l);
  col += vec3(0.026, 0.010, -0.022) * hi * uGolden;
  col += vec3(0.024, -0.004, 0.006) * (hi + 0.4 * sh) * uRose;           // rose sunset
  col += vec3(-0.022, -0.004, 0.032) * sh * uDusk;
  col = clamp(col, 0.0, 1.0);
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.26);
  l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(l), col, 1.06 - 0.08 * uDusk), 0.0);
  // vignette
  vec2 v = (vUv - 0.5) * vec2(uAspect, 1.0) / sqrt(uAspect * uAspect + 1.0) * 2.0;
  col *= mix(0.84, 1.0, smoothstep(1.1, 0.4, length(v)));
  if (uGrain > 0.5) col = grain(col, vUv * uRes, uTime);
  col = dither(col, vUv * uRes);
  gl_FragColor = vec4(col, dot(col, vec3(0.299, 0.587, 0.114)));
}`;
const FXAA = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel, uRes; uniform float uTime;
varying vec2 vUv;
${GRAIN}
void main() {
  vec4 M = texture2D(tSrc, vUv);
  float lNW = texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).a;
  float lNE = texture2D(tSrc, vUv + vec2(1.0, -1.0) * uTexel).a;
  float lSW = texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel).a;
  float lSE = texture2D(tSrc, vUv + vec2(1.0, 1.0) * uTexel).a;
  float lMin = min(M.a, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(M.a, max(max(lNW, lNE), max(lSW, lSE)));
  vec3 col = M.rgb;
  if (lMax - lMin > max(0.0312, lMax * 0.125)) {
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
    dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), -8.0, 8.0) * uTexel;
    vec3 a = 0.5 * (texture2D(tSrc, vUv - dir / 6.0).rgb + texture2D(tSrc, vUv + dir / 6.0).rgb);
    vec3 b = a * 0.5 + 0.25 * (texture2D(tSrc, vUv - dir * 0.5).rgb + texture2D(tSrc, vUv + dir * 0.5).rgb);
    float lb = dot(b, vec3(0.299, 0.587, 0.114));
    col = (lb < lMin || lb > lMax) ? a : b;
  }
  gl_FragColor = vec4(grain(col, vUv * uRes, uTime), 1.0);
}`;

// ---- targets + passes -----------------------------------------------------
const M = {};
const LEVELS = 4; // 1/2, 1/4, 1/8, 1/16
const rt = (w, h, o = {}) => new THREE.WebGLRenderTarget(w, h, {
  type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, ...o
});

function init(ctx) {
  R = ctx.renderer;
  Q = ctx.quality;
  tier = ctx.quality.tier;
  bloomOn = tier !== 'low';
  aoOn = tier !== 'low';
  msaa = tier === 'high' ? 4 : tier === 'med' ? 2 : 0;   // capable phones get edge smoothing too
  R.toneMapping = THREE.NoToneMapping; // ACES happens in the composite, once
  R.getDrawingBufferSize(size);
  const depthTexture = aoOn ? new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType) : null;
  rtScene = rt(size.x, size.y, { depthBuffer: true, samples: msaa, depthTexture });
  if (aoOn) rtAO = rt(8, 8, { type: THREE.UnsignedByteType });
  rtLDR = rt(size.x, size.y, { type: THREE.UnsignedByteType });
  if (bloomOn) for (let i = 0; i < LEVELS * 2 - 1; i++) bloomRT.push(rt(8, 8));

  const texel = () => ({ value: new THREE.Vector2() });
  M.pre = pass(PREFILTER, { tSrc: { value: null }, uTexel: texel(), uScale: { value: new THREE.Vector2(1, 1) }, uThresh: { value: 1.3 }, uExposure: { value: 1 } });
  M.down = pass(DOWN, { tSrc: { value: null }, uTexel: texel() });
  M.up = pass(UP, { tSrc: { value: null }, tCur: { value: null }, uTexel: texel(), uScatter: { value: 0.85 } });
  if (aoOn) M.ao = pass(SAO, {
    tDepth: { value: rtScene.depthTexture }, uProjInv: { value: new THREE.Matrix4() },
    uTexel: texel(), uScale: { value: new THREE.Vector2(1, 1) }, uPx: { value: 400 }, uRadius: { value: 0.9 }
  });
  M.comp = pass(COMPOSITE, {
    tScene: { value: rtScene.texture }, tBloom: { value: null },
    tAO: { value: aoOn ? rtAO.texture : null }, uAoTexel: texel(), uAoScale: { value: new THREE.Vector2(1, 1) },
    uScale: { value: new THREE.Vector2(1, 1) }, uSceneTexel: texel(), uAoAmt: { value: 0.75 },
    uGolden: { value: 0 }, uRose: { value: 0 }, uDusk: world.U.uDusk,
    uExposure: { value: 1 }, uBloom: { value: 0.1 }, uTime: world.U.uTime,
    uAspect: { value: 1 }, uGrain: { value: msaa ? 1 : 0 }, uRes: { value: new THREE.Vector2() },
    uSun: { value: atmosphere.sunScreen }, uSunCol: world.U.uSunCol
  });
  if (bloomOn) M.comp.defines.BLOOM = '';
  if (aoOn) M.comp.defines.AO = '';
  M.fxaa = pass(FXAA, { tSrc: { value: rtLDR.texture }, uTexel: texel(), uRes: { value: new THREE.Vector2() }, uTime: world.U.uTime });
  cur.set(-1, -1);
  sync();
}

// follow the drawing buffer (window resizes only; quality.scale is applied
// per frame as a viewport inside these targets, see scaled())
function sync() {
  R.getDrawingBufferSize(size);
  if (size.equals(cur)) return;
  cur.copy(size);
  drawn.set(-1, -1);   // setSize resets the viewports scaled() sets
  const w = size.x, h = size.y;
  rtScene.setSize(w, h);
  rtLDR.setSize(w, h);
  if (aoOn) {
    const aw = Math.max(1, w >> 1), ah = Math.max(1, h >> 1);
    rtAO.setSize(aw, ah);
    M.comp.uniforms.uAoTexel.value.set(1 / aw, 1 / ah);
  }
  let bw = w, bh = h;
  for (let i = 0; i < LEVELS; i++) {
    bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
    if (bloomOn) {
      bloomRT[i].setSize(bw, bh);                                  // down chain
      if (i < LEVELS - 1) bloomRT[LEVELS + i].setSize(bw, bh);     // up chain
    }
  }
  M.comp.uniforms.uSceneTexel.value.set(1 / w, 1 / h);
  M.comp.uniforms.uAspect.value = w / h;
  M.comp.uniforms.uRes.value.set(w, h);
  M.fxaa.uniforms.uRes.value.set(w, h);
  M.fxaa.uniforms.uTexel.value.set(1 / w, 1 / h);
}

function resize() { if (R) sync(); }

/* Adaptive resolution: draw the scene (and AO) into the lower-left
 * quality.scale of the full-size targets, and let every reader scale its
 * uvs to match. Changing the scale is a uniform write, never a reallocation. */
function scaled() {
  const k = Q ? Q.scale : 1;
  const w = cur.x, h = cur.y;
  const sw = Math.max(1, Math.round(w * k)), sh = Math.max(1, Math.round(h * k));
  if (sw === drawn.x && sh === drawn.y && rtScene.viewport.z === sw && rtScene.viewport.w === sh) return;
  drawn.set(sw, sh);
  rtScene.viewport.set(0, 0, sw, sh);
  const u = M.comp.uniforms;
  u.uScale.value.set(sw / w, sh / h);
  M.pre.uniforms.uScale.value.set(sw / w, sh / h);
  if (aoOn) {
    const aw = Math.max(1, sw >> 1), ah = Math.max(1, sh >> 1);
    rtAO.viewport.set(0, 0, aw, ah);
    M.ao.uniforms.uTexel.value.set(1 / sw, 1 / sh);
    M.ao.uniforms.uScale.value.set(sw / w, sh / h);
    u.uAoScale.value.set(aw / rtAO.width, ah / rtAO.height);
  }
}

function draw(mat, target) {
  quad.material = mat;
  R.setRenderTarget(target);
  R.render(quad, quadCam);
}

function bloom() {
  const d = i => bloomRT[i], u = i => bloomRT[LEVELS + i];
  M.pre.uniforms.tSrc.value = rtScene.texture;
  M.pre.uniforms.uTexel.value.set(1 / cur.x, 1 / cur.y);
  draw(M.pre, d(0));
  for (let i = 1; i < LEVELS; i++) {
    const src = d(i - 1);
    M.down.uniforms.tSrc.value = src.texture;
    M.down.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
    draw(M.down, d(i));
  }
  // up: u(i) = d(i) + tent(u(i+1)), starting from the smallest down level
  for (let i = LEVELS - 2; i >= 0; i--) {
    const src = i === LEVELS - 2 ? d(LEVELS - 1) : u(i + 1);
    M.up.uniforms.tSrc.value = src.texture;
    M.up.uniforms.tCur.value = d(i).texture;
    M.up.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
    draw(M.up, u(i));
  }
  return u(0).texture;
}

function render(renderer, scene, camera) {
  if (!R) { renderer.render(scene, camera); return; }
  sync();
  scaled();
  const exposure = renderer.toneMappingExposure;
  renderer.setRenderTarget(rtScene);
  renderer.render(scene, camera);
  if (aoOn) {
    M.ao.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
    M.ao.uniforms.uPx.value = camera.projectionMatrix.elements[5] * 0.5 * drawn.y; // metres at 1 m → pixels
    draw(M.ao, rtAO);
  }
  M.comp.uniforms.uGolden.value = atmosphere.day.golden || 0;
  M.comp.uniforms.uRose.value = atmosphere.day.rose || 0;
  if (bloomOn) {
    M.pre.uniforms.uExposure.value = exposure;
    M.comp.uniforms.tBloom.value = bloom();
  }
  M.comp.uniforms.uExposure.value = exposure;
  if (msaa) draw(M.comp, null);
  else { draw(M.comp, rtLDR); draw(M.fxaa, null); }
}

export const post = { init, resize, render };
