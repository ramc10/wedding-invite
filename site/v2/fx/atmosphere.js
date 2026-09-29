/* Sky, sun, height fog and time of day.
 *
 * Elements owned here (every one is driven by sun elevation, so the look is
 * physically consistent from noon-ish forest to the dusk creek):
 *   1. Sun colour + intensity: sunlight through the atmosphere (Kasten-Young
 *      air mass, Rayleigh + aerosol optical depth per RGB channel), so it is
 *      near-white high up, golden only near the horizon and gone below it.
 *   2. Sky dome: analytic single-scattering gradient: deep Rayleigh blue at
 *      the zenith, pale hazy horizon, Mie forward-scatter halo round the sun,
 *      warm twilight wedge toward the sun and a cool earth-shadow/Belt of Venus
 *      opposite it at dusk. Stars late in dusk.
 *   3. Sun disc with limb darkening (HDR, so post blooms it softly).
 *   4. Clouds: a cumulus deck with a 3-tap light march toward the sun (Beer +
 *      powder), grey shadowed undersides, silver lining near the sun, fading
 *      into horizon haze; plus a faint high cirrus layer.
 *   5. Height fog / aerial perspective (the four fog chunks are overridden
 *      globally at import time): exponential height fog + chromatic distance
 *      haze (blue extinguished first) + drifting ground mist, in-scattering
 *      the sun. Fog colour is the sky's horizon colour in that direction, so
 *      distant terrain melts into the sky.
 *   6. Lights: DirectionalLight sun + HemisphereLight sky/bounce with a
 *      real-world sun:sky ratio (≈3.5:1 on flat ground by day, softer at dusk).
 *   7. Shadows ('high' = desktop): one 4K sun shadow map fitted ahead of the
 *      camera to cover the car and the nearby verge, texel-snapped, tight
 *      near/far so the bias stays sub-2 cm (no acne, no peter-panning).
 *   8. sunScreen: sun position on screen for post's glare.
 *
 * World position comes from mvPosition (every fog_vertex user already has it),
 * so it works for built-ins, InstancedMesh, BatchedMesh and ShaderMaterials.
 * Fog uniforms are vectors whose clone() returns themselves, so the copies
 * three makes per material stay live. GLSL names are prefixed hf*.
 * scene.fog stays a FogExp2 so three keeps USE_FOG defined.
 *
 * API: init(ctx), update(dt, s), sun (DirectionalLight), hemi (HemisphereLight),
 *      day (current look: {sky, hor, fog, sunCol, sunDir, exposure, dusk, sunI,
 *      golden}), sunScreen (Vector3: sun in NDC xy, z = visibility 0..1)
 */
import * as THREE from 'three';
import { world } from '../core/world.js';
import { dayAt } from '../core/zones.js';
import { path } from '../core/path.js';

const U = world.U;

// ---- live (never-cloned) fog uniforms -------------------------------------
function live(v) { v.clone = function () { return this; }; return v; }
const HF = {
  hfA: { value: live(new THREE.Vector4(0.0022, 0.035, 0, 0)) },   // density, height falloff, base y, time
  hfB: { value: live(new THREE.Vector4(0.0002, 0.6, 0, 0)) },     // haze/m, mist amount, dusk, -
  hfSun: { value: live(new THREE.Vector3(0, 0.4, -1)) },
  hfSunCol: { value: live(new THREE.Color(1, 0.85, 0.6)) },
  hfCol: { value: live(new THREE.Color(0.8, 0.75, 0.6)) },         // horizon toward the sun
  hfCool: { value: live(new THREE.Color(0.6, 0.66, 0.72)) },       // horizon away from it
  hfZen: { value: live(new THREE.Color(0.2, 0.35, 0.7)) }          // zenith
};

// shared GLSL: sky radiance by direction + the transmittance/in-scatter model
const FOGLIB = /* glsl */`
uniform vec4 hfA, hfB;
uniform vec3 hfSun, hfSunCol, hfCol, hfCool, hfZen;
float hfHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float hfNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hfHash(i), hfHash(i + vec2(1.0, 0.0)), f.x), mix(hfHash(i + vec2(0.0, 1.0)), hfHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// horizon colour: cool (anti-sun) to warm (toward the sun) with a Mie glow
vec3 hfFogColor(vec3 rd) {
  float sd = dot(rd, hfSun);
  float w = pow(clamp(sd * 0.5 + 0.5, 0.0, 1.0), 2.5);
  vec3 c = mix(hfCool, hfCol, w);
  float up = smoothstep(-0.12, 0.05, hfSun.y);
  float f = max(sd, 0.0);
  c += hfSunCol * (pow(f, 8.0) * 0.22 + pow(f, 48.0) * 0.35) * up;
  return c;
}
vec3 hfApply(vec3 col, vec3 wp) {
  vec3 ro = cameraPosition;
  vec3 dv = wp - ro;
  float dist = length(dv);
  vec3 rd = dv / max(dist, 1e-3);
  float fall = hfA.y;
  float k = fall * max(dv.y, -12.0);            // don't let a view down into a valley fill it with fog
  float fh = hfA.x * exp(-fall * (ro.y - hfA.z)) * dist * (abs(k) > 1e-3 ? (1.0 - exp(-k)) / k : 1.0);
  // ground mist: a thin layer over the valley floor breaking into drifting banks
  float yb = wp.y - hfA.z;
  float my = clamp(1.0 - (yb + 1.5) / 7.0, 0.0, 1.0) * smoothstep(-7.0, -2.0, yb); // a band at road level, not the whole valley
  vec2 mp = wp.xz * 0.03 + vec2(hfA.w * 0.05, hfA.w * 0.035);
  float mn = hfNoise(mp) * 0.8 + hfNoise(mp * 2.7 + 7.0) * 0.5 - 0.45;
  float mist = hfB.y * my * my * max(mn, 0.0) * smoothstep(8.0, 60.0, dist) * min(dist, 220.0) * 0.004;
  // aerial perspective: blue is scattered out (and in) first
  vec3 tau = (fh + hfB.x * dist) * vec3(0.78, 0.97, 1.3) + mist;
  vec3 T = exp(-tau);
  vec3 fc = hfFogColor(normalize(vec3(rd.x, max(rd.y, -0.02) * 0.6, rd.z)));
  fc += hfSunCol * 0.18 * mist * pow(max(dot(rd, hfSun), 0.0), 3.0);
  return col * T + fc * (1.0 - T);
}
`;

// ---- chunk overrides (import time) ----------------------------------------
const SC = THREE.ShaderChunk;
SC.fog_pars_vertex = '#ifdef USE_FOG\n varying vec3 vHfWP;\n#endif';
// world position from view space: viewMatrix is rigid, so its inverse is R^T(p - t)
SC.fog_vertex = `#ifdef USE_FOG
  vHfWP = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif`;
SC.fog_pars_fragment = '#ifdef USE_FOG\n varying vec3 vHfWP;\n' + FOGLIB + '\n#endif';
SC.fog_fragment = `#ifdef USE_FOG
  gl_FragColor.rgb = hfApply(gl_FragColor.rgb, vHfWP);
#endif`;
Object.assign(THREE.UniformsLib.fog, HF);
for (const k in THREE.ShaderLib) {
  const u = THREE.ShaderLib[k].uniforms;
  if (u && u.fogDensity) Object.assign(u, HF);
}

// ---- sky dome -------------------------------------------------------------
const SKY_FRAG = /* glsl */`
uniform float uDusk, uTime, uCloud, uSunI, uNight, uDawn;
uniform vec3 uMoon;
varying vec3 vDir;
${FOGLIB}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * hfNoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}
float fbm3(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * hfNoise(p); p = p * 2.1 + vec2(3.1, 1.3); a *= 0.5; }
  return s;
}
float cloudD(vec2 p) {
  vec2 q = p + vec2(fbm3(p * 0.7), fbm3(p * 0.7 + 5.2)) * 0.45;   // domain warp: billowy, not blobby
  return smoothstep(uCloud, uCloud + 0.32, fbm(q));
}
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  float sd = dot(d, hfSun);
  float up = smoothstep(-0.1, 0.03, hfSun.y);
  // single-scatter gradient: horizon colour by azimuth → zenith Rayleigh blue
  // (a sunrise keeps its warmth in a tighter glow round the sun and clear blue above it)
  vec3 horC = mix(hfCool, hfCol, pow(clamp(sd * 0.5 + 0.5, 0.0, 1.0), 2.5 + 4.5 * uDawn));
  vec3 col = mix(horC, hfZen, 1.0 - exp(-h * (5.5 + 6.0 * uDawn)));  // haze hugs the horizon; clear blue above
  col *= 0.92 + 0.12 * sd * sd;                                       // Rayleigh phase
  col += hfSunCol * up * (hg(sd, 0.78) * 0.12 + hg(sd, 0.35) * 0.18) * (0.35 + 0.65 * exp(-h * 3.0)); // Mie halo
  // dusk: Belt of Venus (pink band) above the earth's shadow, opposite the sun
  float anti = clamp(-sd * 0.5 + 0.5, 0.0, 1.0);
  col += vec3(0.30, 0.16, 0.20) * uDusk * (1.0 - uDusk * 0.5) * (1.0 - uNight) * (1.0 - 0.6 * uDawn) * anti * exp(-pow((h - 0.13) / 0.07, 2.0));
  // night: the sky brightens softly round the moon (aureole + wide glow)
  float md = dot(d, uMoon);
  float mang = sqrt(max(2.0 * (1.0 - md), 0.0));
  col += vec3(0.55, 0.66, 0.9) * uNight * (exp(-mang * 5.0) * 0.035 + exp(-mang * 22.0) * 0.06);
  // stars: tiny, sparse, upper sky only, once dusk is well along; at night
  // denser, down to the horizon haze, dimmed near the moon
  float sk = max(smoothstep(0.55, 0.95, uDusk) * smoothstep(0.45, 0.8, h), uNight * smoothstep(0.015, 0.2, h) * smoothstep(0.08, 0.35, mang));
  if (sk > 0.001) {
    vec2 sp = d.xz / (d.y + 0.25) * 140.0;
    vec2 cell = floor(sp);
    float r = hfHash(cell);
    vec2 off = vec2(hfHash(cell + 3.1), hfHash(cell + 7.7)) - 0.5;
    float st = step(0.992 - 0.01 * uNight, r) * smoothstep(0.1, 0.02, length(fract(sp) - 0.5 - off * 0.6));
    st *= 0.65 + 0.35 * sin(uTime * (1.5 + r * 3.0) + r * 40.0);
    st *= 1.0 + uNight * (hfHash(cell + 1.7) * 1.6 - 0.35);                         // magnitudes vary
    col += mix(vec3(0.9, 0.93, 1.0), vec3(1.0, 0.9, 0.78), step(0.7, hfHash(cell + 5.3)) * uNight) * st * sk * 0.9;
  }
  // high cirrus: faint streaks well above the cumulus
  float occ = 0.0;
  if (d.y > 0.0) {
    float pd = 1.0 / (d.y + 0.06);
    vec2 cu = d.xz * pd;
    vec2 ci = mat2(0.8, 0.6, -0.6, 0.8) * cu * vec2(0.18, 1.1) + vec2(uTime * 0.002, 0.0);
    float cir = smoothstep(0.52, 0.85, fbm3(ci * 1.3)) * smoothstep(0.0, 0.25, d.y) * 0.32;
    col = mix(col, horC * 0.9 + hfSunCol * 0.35 * up + hfZen * 0.2, cir);
    // cumulus deck, lit by a 3-tap march toward the sun
    vec2 uv = cu * 0.55 + vec2(uTime * 0.005, uTime * 0.002);
    float c = cloudD(uv);
    if (c > 0.001) {
      vec2 ts = normalize(hfSun.xz + 1e-4) * 0.07;
      float od = cloudD(uv + ts) + cloudD(uv + ts * 2.0) * 0.8 + cloudD(uv + ts * 3.5) * 0.6;
      float Tl = exp(-od * 1.3 - c * 0.6);
      float powder = 1.0 - exp(-c * 3.0);
      vec3 amb = mix(horC, hfZen, 0.35) * (1.05 - 0.45 * c);          // thick = darker underside
      vec3 sunl = hfSunCol * uSunI * 0.34 * up * (Tl * powder * 1.3 + hg(sd, 0.6) * (1.0 - c) * 1.6);
      vec3 cc = amb * 0.9 + sunl;
      // moonlit: thin edges near the moon glow silver
      cc += vec3(0.5, 0.6, 0.8) * uNight * (1.0 - c) * (exp(-mang * 6.0) * 0.25 + 0.02);
      // aerial perspective: distant clouds melt into the horizon haze
      cc = mix(cc, horC, smoothstep(3.0, 15.0, pd) * 0.75);
      float a = c * smoothstep(0.0, 0.12, d.y);
      col = mix(col, cc, a);
      occ = a;
    }
  }
  // sun disc with limb darkening (HDR; blooms in post)
  float ang = sqrt(max(2.0 * (1.0 - sd), 0.0));
  float rr = ang / 0.0085;
  if (rr < 1.2) {
    float mu = sqrt(max(1.0 - rr * rr, 0.0));
    float limb = 1.0 - 0.62 * (1.0 - mu) - 0.2 * (1.0 - mu * mu);
    col += hfSunCol * limb * smoothstep(1.02, 0.94, rr) * 60.0 * up * (1.0 - occ * 0.97) * (1.0 - 0.88 * uDawn); // a low dawn sun keeps its colour
  }
  // the moon: a pale disc with faint maria, limb-darkened, behind thin cloud
  if (uNight > 0.001 && mang < 0.022) {
    vec3 t1 = normalize(cross(uMoon, vec3(0.0, 1.0, 0.0)));
    vec3 t2 = cross(t1, uMoon);
    vec2 mu = vec2(dot(d, t1), dot(d, t2)) / 0.012;
    float mr = length(mu);
    float maria = hfNoise(mu * 1.7 + 4.0) * 0.6 + hfNoise(mu * 4.1 + 9.0) * 0.4;
    float mlimb = 0.8 + 0.2 * sqrt(max(1.0 - mr * mr, 0.0));
    vec3 mcol = vec3(1.0, 0.97, 0.9) * (1.0 - 0.34 * smoothstep(0.42, 0.72, maria)) * mlimb;
    col = mix(col, mcol * 1.3, smoothstep(1.03, 0.97, mr) * uNight * (1.0 - occ * 0.85));
  }
  // below the horizon the dome shows the haze
  col = mix(col, hfFogColor(normalize(vec3(d.x, 0.0, d.z))) * 0.9, smoothstep(0.0, -0.05, d.y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---- the physical model (JS side) -----------------------------------------
// Rayleigh optical depth at ~(650, 550, 450) nm + a hazy aerosol load.
const TAU = [0.05 + 0.13, 0.11 + 0.13, 0.25 + 0.13];
const LUM = [0.2126, 0.7152, 0.0722];
const V3 = (r, g, b) => new THREE.Color(r, g, b);
const ZEN = { day: V3(0.085, 0.21, 0.56), gold: V3(0.10, 0.19, 0.42), dusk: V3(0.03, 0.045, 0.12) };
const ROSE = { zen: V3(0.06, 0.085, 0.25), sun: V3(1.08, 0.56, 0.46), anti: V3(0.54, 0.42, 0.56) };
const HSUN = { day: V3(0.80, 0.87, 0.98), gold: V3(1.05, 0.72, 0.44), dusk: V3(0.62, 0.32, 0.20) };
const HANTI = { day: V3(0.50, 0.64, 0.86), gold: V3(0.50, 0.57, 0.72), dusk: V3(0.15, 0.16, 0.29) };
const smooth = THREE.MathUtils.smoothstep;
function airMass(elDeg) {
  const e = Math.max(elDeg, 0);
  return 1 / (Math.sin(THREE.MathUtils.degToRad(e)) + 0.50572 * Math.pow(e + 6.07995, -1.6364));
}
/* sunlight relative to an overhead sun: {col (max = 1), lum} */
function sunlight(elDeg, out) {
  const m = airMass(elDeg) - 1;
  const t = TAU.map(k => Math.exp(-k * m));
  const mx = Math.max(...t);
  out.setRGB(t[0] / mx, t[1] / mx, t[2] / mx);
  return t[0] * LUM[0] + t[1] * LUM[1] + t[2] * LUM[2];
}
// real night (sun below ≈ −4°, full by −12°): a clear coastal night: navy
// sky a little lighter at the horizon, stars, and the moon over the sea as
// the key light. Only the beach keys go that low; the creek (−2°) is untouched.
const NIGHT = { zen: V3(0.0065, 0.013, 0.036), hor: V3(0.026, 0.038, 0.066), fog: V3(0.030, 0.040, 0.060) };
const MOON = { col: V3(0.58, 0.70, 1.0), az: -19, el: 8, I: 0.62 };
const moonDir = new THREE.Vector3();
// sunrise (keys with dawn: 1): clean morning air: peach and rose toward the
// sun, cool blue opposite and above, where a sunset is lilac all round
const DAWN = { zen: V3(0.045, 0.105, 0.34), sun: V3(1.25, 0.60, 0.38), anti: V3(0.28, 0.39, 0.64) };
let rose = 0;
function pick(out, set, g, dk, r) { return out.copy(set.day).lerp(set.gold, g).lerp(r, rose).lerp(set.dusk, dk); }

let ctx, sky, sun, hemi;
const day = {
  sky: new THREE.Color(), hor: new THREE.Color(), fog: new THREE.Color(),
  sunCol: new THREE.Color(), sunDir: new THREE.Vector3(), exposure: 1, dusk: 0, sunI: 3, golden: 0
};
const sunScreen = new THREE.Vector3();
const tmp = new THREE.Vector3(), c1 = new THREE.Color(), c2 = new THREE.Color();
const S = path.sample(0);
const skyU = { uSunI: { value: 3 }, uCloud: { value: 0.56 }, uNight: { value: 0 }, uDawn: { value: 0 }, uMoon: { value: new THREE.Vector3(0, 0.3, -1) } };
let shadows = false, SH = 40, SMAP = 4096;   // ±40 m box: the car plus ~60 m ahead

function makeSky() {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(2500, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { ...HF, ...skyU, uDusk: U.uDusk, uTime: U.uTime },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: SKY_FRAG
    })
  );
  m.frustumCulled = false;
  m.renderOrder = -1;
  return m;
}
function init(c) {
  ctx = c;
  const { scene, renderer, quality } = ctx;
  // kept so three defines USE_FOG; the chunks above ignore its values
  scene.fog = new THREE.FogExp2(0xd9d2b8, 0.0022);
  sky = makeSky();
  scene.add(sky);

  hemi = new THREE.HemisphereLight(0x9fb8e0, 0x4a4330, 0.9);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xfff4e0, 3);
  scene.add(sun, sun.target);

  // desktop: one sun shadow map fitted ahead of the camera over the car and verge
  shadows = quality.tier === 'high';
  if (shadows) {
    SMAP = Math.min(4096, renderer.capabilities.maxTextureSize);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sun.castShadow = true;
    sun.shadow.mapSize.set(SMAP, SMAP);
    const sc = sun.shadow.camera;
    sc.left = -SH; sc.right = SH; sc.top = SH; sc.bottom = -SH;
    sc.near = 40; sc.far = 280;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.00008;         // ≈2 cm over the 240 m depth range
    sun.shadow.radius = 2;
    sun.shadow.normalBias = 0.03;
  }
  atmosphere.sun = sun; atmosphere.hemi = hemi;
}

const fwd = new THREE.Vector3(), lq = new THREE.Quaternion(), lm = new THREE.Matrix4();
const tdir = new THREE.Vector3(), ORIGIN = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function update(dt, s) {
  const { a, b, t } = dayAt(s);
  const elDeg = a.sun[0] + (b.sun[0] - a.sun[0]) * t;
  const az = THREE.MathUtils.degToRad(a.sun[1] + (b.sun[1] - a.sun[1]) * t);
  const zoneExpo = a.exposure + (b.exposure - a.exposure) * t;
  const dawnK = (a.dawn || 0) + ((b.dawn || 0) - (a.dawn || 0)) * t;
  // time-of-day weights: golden below ~18°, dusk once the sun is near/below the horizon
  // (the late-afternoon hills at ~24° already take a warm, low-sun cast)
  const g = 1 - smooth(elDeg, 6, 32);
  const dk = 1 - smooth(elDeg, -3, 3);
  rose = (1 - smooth(elDeg, 3, 10)) * (1 - dk);   // sun just above the horizon: rose sunset
  day.golden = g * (1 - dk) * (1 - rose);
  day.rose = rose;   // (post's rose grade; a sunrise gets less of it, below)
  day.dusk = THREE.MathUtils.clamp(1 - elDeg / 10, 0, 1);   // legacy key other modules use
  const nt = 1 - smooth(elDeg, -12, -4);
  day.night = nt;

  // sunlight through the air; below the horizon the bright western sky
  // stands in as a weak, warm, low fill from the same side
  const lum = sunlight(elDeg, day.sunCol);
  const above = smooth(elDeg, -1, 2.5);
  const phys = 3.4 * Math.pow(lum, 0.45) * above;
  const glow = 0.55 * dk;
  if (glow > phys) day.sunCol.copy(HSUN.dusk).multiplyScalar(1 / 0.62);
  day.sunI = Math.max(phys, glow);
  const el = THREE.MathUtils.degToRad(Math.max(elDeg, phys > glow ? elDeg : 4));
  path.sample(s, S);
  const h = S.heading - az;                     // azimuth is relative to the road's heading
  day.sunDir.set(-Math.sin(h) * Math.cos(el), Math.sin(el), -Math.cos(h) * Math.cos(el)).normalize();
  if (nt > 0) {
    // the moon takes over as the key light: cool, dim, from over the sea
    const mh = S.heading - THREE.MathUtils.degToRad(MOON.az), me = THREE.MathUtils.degToRad(MOON.el);
    moonDir.set(-Math.sin(mh) * Math.cos(me), Math.sin(me), -Math.cos(mh) * Math.cos(me));
    day.sunDir.lerp(moonDir, nt).normalize();
    day.sunCol.lerp(MOON.col, nt);
    day.sunI += (MOON.I - day.sunI) * nt;
  }
  const trueDir = tdir.set(-Math.sin(h) * Math.cos(THREE.MathUtils.degToRad(elDeg)), Math.sin(THREE.MathUtils.degToRad(elDeg)), -Math.cos(h) * Math.cos(THREE.MathUtils.degToRad(elDeg))).normalize();

  // sky colours
  pick(day.sky, ZEN, g, dk, ROSE.zen);
  pick(c1, HSUN, g, dk, ROSE.sun);
  pick(c2, HANTI, g, dk, ROSE.anti);
  const dw = dawnK * (1 - nt) * (1 - smooth(elDeg, 5, 14));
  day.rose *= 1 - 0.7 * dw;
  if (dw > 0) { day.sky.lerp(DAWN.zen, dw); c1.lerp(DAWN.sun, dw); c2.lerp(DAWN.anti, dw); }
  if (nt > 0) { day.sky.lerp(NIGHT.zen, nt); c1.lerp(NIGHT.hor, nt); c2.lerp(NIGHT.hor, nt); }
  day.hor.copy(c1).lerp(c2, 0.6);
  day.fog.copy(day.hor).multiplyScalar(0.95);
  if (nt > 0) day.fog.lerp(NIGHT.fog, nt);
  U.uSkyTop.value.copy(day.sky);
  U.uSkyHor.value.copy(day.hor);
  U.uFogCol.value.copy(day.fog);
  U.uSunCol.value.copy(day.sunCol);
  U.uSunDir.value.copy(day.sunDir);
  U.uDusk.value = day.dusk;

  // fog: clear-ish by day so the mid-distance keeps its contrast, thicker at dusk
  HF.hfA.value.set(U.uFogDensity.value * (0.38 + 0.6 * day.dusk), U.uFogHeight.value, path.roadY(s) - 0.5, U.uTime.value);
  HF.hfB.value.set(0.0002 + 0.00012 * day.dusk, 0.45 + 0.7 * day.dusk, day.dusk, 0);
  HF.hfSun.value.copy(trueDir);
  HF.hfSunCol.value.copy(day.sunCol).multiplyScalar((1 - 0.55 * day.dusk) * (0.5 + 0.5 * Math.min(1, lum * 1.3 + dk)));
  HF.hfCol.value.copy(c1).multiplyScalar(0.96);
  HF.hfCool.value.copy(c2).multiplyScalar(0.96);
  HF.hfZen.value.copy(day.sky);
  skyU.uSunI.value = Math.max(day.sunI, 1.2);
  skyU.uCloud.value = 0.5 - 0.04 * g + 0.1 * nt + 0.12 * dw;   // a clear night, a clean morning
  skyU.uDawn.value = dw * (1 - smooth(elDeg, 3, 9));
  skyU.uNight.value = nt;
  skyU.uMoon.value.copy(moonDir);

  ctx.scene.fog.color.copy(day.fog);
  ctx.scene.fog.density = U.uFogDensity.value;

  // lights: sun + sky/bounce hemisphere at a real-world ratio
  sun.color.copy(day.sunCol);
  sun.intensity = day.sunI;
  hemi.color.copy(day.sky).multiplyScalar(0.45).add(c1.copy(day.hor).multiplyScalar(0.55));
  const skyE = hemi.color.r * LUM[0] + hemi.color.g * LUM[1] + hemi.color.b * LUM[2];
  const sunE = day.sunI * Math.max(day.sunDir.y, 0.05);   // = sin(el) by day; the moon's height at night
  hemi.groundColor.setRGB(0.24, 0.22, 0.16).multiplyScalar(0.25 + 0.5 * Math.min(1, (sunE + skyE) / 2));
  hemi.intensity = 1.0 + 0.4 * nt;   // moonlit sky fill: dim and cool, but the road still reads
  // mild auto-exposure around the zone's key, capped so dusk still reads as dusk
  const E = sunE + skyE;
  day.exposure = zoneExpo * THREE.MathUtils.clamp(Math.pow(1.9 / Math.max(E, 0.05), 0.5), 0.85, 1.45 + 0.45 * nt);
  ctx.renderer.toneMappingExposure = day.exposure;   // post.js applies it

  const cam = ctx.camera, c = cam.position;
  cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  if (shadows) {
    // centre the frustum ~24 m ahead (the car sits ~8 m ahead of the camera),
    // snapped to shadow texels in light space so edges don't crawl
    tmp.copy(c).addScaledVector(fwd, SH * 0.6);
    tmp.y = path.roadY(s);
    lm.lookAt(day.sunDir, ORIGIN, UP); lq.setFromRotationMatrix(lm);
    const texel = (2 * SH) / SMAP;
    tmp.applyQuaternion(lq.invert());
    tmp.x = Math.round(tmp.x / texel) * texel; tmp.y = Math.round(tmp.y / texel) * texel;
    tmp.applyQuaternion(lq.invert());
    sun.target.position.copy(tmp);
    sun.position.copy(tmp).addScaledVector(day.sunDir, 150);
    // castShadow stays on: flipping it changes every lit material's program
    // (a recompile hitch when the sun sets). Fade the shadow and stop
    // redrawing its map instead.
    sun.shadow.intensity = Math.max(smooth(elDeg, 0.5, 1.5), 0.6 * smooth(nt, 0.6, 0.95));   // soft moon shadows
    sun.shadow.autoUpdate = elDeg > 0.5 || nt > 0.6;
  } else {
    sun.position.copy(c).addScaledVector(day.sunDir, 200);
    sun.target.position.copy(c);
  }
  sky.position.copy(c);

  // sun on screen, for post's glare
  tmp.copy(c).addScaledVector(trueDir, 1000).project(cam);
  const onScreen = tmp.z < 1 && Math.abs(tmp.x) < 1.3 && Math.abs(tmp.y) < 1.3;
  sunScreen.set(tmp.x, tmp.y, onScreen ? smooth(trueDir.y, -0.05, 0.05) : 0);
}

export const atmosphere = { init, update, day, sun: null, hemi: null, sunScreen, fogUniforms: HF };
