/* Shared water surface for the sea, reservoir and creek. Owned by the coast
 * agent; dam and creek only call it.
 *
 * API: makeWater(ctx, {s0, s1, lateral0, lateral1, y, kind:'sea'|'lake'|'creek',
 *                      extend?: [before, after]}) → Mesh
 *   A ribbon of water along the road between two lateral offsets (negative =
 *   left). lateral0 is the shore side (it may sit under the land: the ribbon
 *   is always started under the ground so no water edge ever shows). For kind
 *   'sea' the outer (lateral1) edge is carried on toward world -X for a few
 *   kilometres so the sea reaches the horizon; `extend` (metres, default
 *   [0, 0]) also runs that far skirt past s0 / s1. Two sea ribbons that meet at
 *   the same s with the same lateral0/lateral1 share their seam row exactly.
 *
 * Objects / layers in the one mesh (one draw call per call):
 *   1. Ribbon grid in road space, 1 m lateral steps near the shore growing
 *      with distance, plus the far horizon skirt (sea only).
 *   2. Per-vertex attributes: aDepth (water y − ground y), aUV (along-shore s,
 *      offshore metres from the waterline) and aFrame (world along/offshore
 *      axes), so waves run parallel to the real shoreline.
 *   3. Vertex: layered Gerstner swell travelling onshore (deep-water
 *      dispersion ω = √(g k)), shoaling and steepening in the shallows, dying
 *      on the sand; the waterline therefore swashes up and down the beach.
 *      Lake: small wind chop; creek: flat, flowing along the road.
 *   4. Fragment: analytic swell normals + fine capillary normals (flattened
 *      with distance), Schlick Fresnel sky reflection, depth-based absorption
 *      (sand-turquoise → teal → deep blue), turquoise subsurface glow through
 *      crests facing the sun, sun specular + glitter, breaker foam lines on
 *      crests in the surf zone, lacy trailing foam, swash foam at the
 *      waterline, creek riffles over stones and white water in the shallows,
 *      dusk tint, alpha fading to clear at the waterline.
 */
import * as THREE from 'three';

const LOOK = {
  sea:   { kind: 0, deep: 0x0a3550, mid: 0x0f6f84, shallow: 0x3fd1c4, foam: 1.0, amp: 1.0, scale: 1.0, flow: 0.0, alphaShallow: 0.45 },
  lake:  { kind: 1, deep: 0x0f3346, mid: 0x1f5a62, shallow: 0x5c9a8a, foam: 0.3, amp: 0.35, scale: 1.3, flow: 0.0, alphaShallow: 0.6 },
  creek: { kind: 2, deep: 0x1a3a40, mid: 0x2e5a55, shallow: 0x6f9a86, foam: 0.6, amp: 0.4, scale: 2.2, flow: 1.0, alphaShallow: 0.5 }
};

function lateralSteps(a, b, fine) {
  const out = [a];
  const dir = Math.sign(b - a) || 1;
  const span = Math.abs(b - a);
  const minStep = Math.min(fine, span / 6);
  let l = a;
  while (true) {
    const step = Math.max(minStep, Math.abs(l) * 0.07);
    l += dir * step;
    if ((b - l) * dir <= minStep * 0.5) break;
    out.push(l);
  }
  out.push(b);
  return out;
}

export function makeWater(ctx, { s0, s1, lateral0, lateral1, y = 0, kind = 'sea', extend = [0, 0] }) {
  const { path, world } = ctx;
  const look = LOOK[kind] || LOOK.sea;
  const lats = lateralSteps(lateral0, lateral1, kind === 'creek' ? 1.0 : 1.0);
  const DS = kind === 'creek' ? 2 : 3;
  const rows = Math.max(2, Math.ceil((s1 - s0) / DS) + 1);
  const skirt = kind === 'sea';
  const cols = lats.length + (skirt ? 1 : 0);
  const pos = [], depth = [], uv = [], frame = [], idx = [];
  const tmp = new THREE.Vector3();
  const FAR = 3200;
  const outSign = Math.sign(lateral1 - lateral0) || -1;   // lateral direction heading offshore

  const tri = (base) => {
    for (let r = 1; r < rows; r++) {
      for (let c = 1; c < cols; c++) {
        const a = base + (r - 1) * cols + c - 1, b = a + 1, d = base + r * cols + c - 1, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
  };

  const outer = [];
  const hs = new Float32Array(lats.length);
  for (let r = 0; r < rows; r++) {
    const s = Math.min(s1, s0 + r * DS);
    const smp = path.sample(s);
    const fx = smp.fwd.x, fz = smp.fwd.z;
    const ox = smp.right.x * outSign, oz = smp.right.z * outSign;
    // waterline on this row: last crossing from dry to wet going offshore
    for (let c = 0; c < lats.length; c++) hs[c] = world.heightSL(s, lats[c]);
    let shore = lats[0];
    for (let c = 1; c < lats.length; c++) {
      if (hs[c - 1] >= y && hs[c] < y) {
        const t = (hs[c - 1] - y) / Math.max(1e-4, hs[c - 1] - hs[c]);
        shore = lats[c - 1] + (lats[c] - lats[c - 1]) * t;
      }
    }
    if (kind === 'creek') shore = (lateral0 + lateral1) / 2;
    for (let c = 0; c < lats.length; c++) {
      path.toWorld(s, lats[c], tmp);
      pos.push(tmp.x, y, tmp.z);
      depth.push(y - hs[c]);
      uv.push(s, (lats[c] - shore) * outSign);
      frame.push(fx, fz, ox, oz);
    }
    if (skirt) {
      path.toWorld(s, lats[lats.length - 1], tmp);
      outer.push(tmp.clone());
      pos.push(tmp.x - FAR, y, tmp.z);
      depth.push(30);
      uv.push(s, FAR);
      frame.push(fx, fz, ox, oz);
    }
  }
  tri(0);

  // far skirts beyond the ends (sea only): a flat quad in world ±Z
  if (skirt) {
    const cap = (edge, dz) => {
      const b = pos.length / 3;
      const nx = [edge.x, edge.x - FAR];
      pos.push(nx[0], y, edge.z, nx[1], y, edge.z, nx[0], y, edge.z + dz, nx[1], y, edge.z + dz);
      for (let k = 0; k < 4; k++) { depth.push(30); uv.push(0, FAR); frame.push(0, 1, -1, 0); }
      if (dz > 0) idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      else idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    };
    if (extend[0] > 0) cap(outer[0], extend[0]);
    if (extend[1] > 0) cap(outer[outer.length - 1], -extend[1]);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFrame', new THREE.Float32BufferAttribute(frame, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  g.boundingBox.min.y -= 1; g.boundingBox.max.y += 1;
  g.boundingSphere.radius += 1;

  const mat = new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    side: THREE.DoubleSide,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: world.U.uTime, uSunDir: world.U.uSunDir, uSunCol: world.U.uSunCol,
      uSkyTop: world.U.uSkyTop, uSkyHor: world.U.uSkyHor, uCamPos: world.U.uCamPos,
      uDusk: world.U.uDusk, uFogCol: world.U.uFogCol,
      uDeep: { value: new THREE.Color(look.deep) },
      uMid: { value: new THREE.Color(look.mid) },
      uShallow: { value: new THREE.Color(look.shallow) },
      uFoam: { value: look.foam }, uAmp: { value: look.amp }, uScale: { value: look.scale },
      uFlow: { value: look.flow }, uAlphaShallow: { value: look.alphaShallow },
      uKind: { value: look.kind }
    },
    vertexShader: VERT,
    fragmentShader: FRAG
  });
  const m = new THREE.Mesh(g, mat);
  m.name = 'water-' + kind;
  m.renderOrder = 1;
  return m;
}

const VERT = /* glsl */`
attribute float aDepth;
attribute vec2 aUV;
attribute vec4 aFrame;
uniform float uTime, uAmp, uKind;
varying vec3 vWorld, vN;
varying vec2 vUV;
varying float vDepth, vCrest, vSurf;
#include <fog_pars_vertex>

// one Gerstner wave in shore space u = (along, offshore); d is its unit direction
void gw(vec2 u, float ang, float L, float A, float Q, float t, inout vec3 disp, inout vec2 grad, inout float crest) {
  vec2 d = vec2(sin(ang), -cos(ang));            // -offshore = travelling onshore
  float k = 6.2831853 / L;
  float th = k * dot(d, u) - sqrt(9.81 * k) * t;
  float s = sin(th), c = cos(th);
  disp.xz += Q * A * d * c;
  disp.y += A * s;
  grad += A * k * d * c;
  crest += A * s;
}

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec2 u = aUV;
  float t = uTime;
  vec3 disp = vec3(0.0); vec2 grad = vec2(0.0); float crest = 0.0, amax = 1.0;
  float dep = aDepth;
  if (uKind < 0.5) {
    // sea: long swell, shoaling in the shallows, swashing up the sand
    float shoal = 1.0 + 0.7 * exp(-max(dep, 0.0) * 0.45);
    float att = mix(0.32, 1.0, smoothstep(-0.2, 2.2, dep)) * shoal * (1.0 - smoothstep(260.0, 700.0, u.y));
    float A = uAmp * att;
    gw(u, 0.10, 41.0, 0.19 * A, 0.7, t, disp, grad, crest);
    gw(u, -0.28, 23.0, 0.11 * A, 0.7, t, disp, grad, crest);
    gw(u, 0.38, 13.0, 0.05 * A, 0.6, t, disp, grad, crest);
    gw(u, -0.55, 8.5, 0.025 * A * (1.0 - smoothstep(20.0, 60.0, u.y)), 0.5, t, disp, grad, crest);
    amax = 0.375 * max(A, 1e-3);
  } else if (uKind < 1.5) {
    // lake: short wind chop, not tied to the shore
    float A = uAmp * smoothstep(-0.2, 1.5, dep) * (1.0 - smoothstep(200.0, 500.0, u.y));
    gw(u, 1.2, 11.0, 0.05 * A, 0.3, t, disp, grad, crest);
    gw(u, 2.4, 6.5, 0.03 * A, 0.3, t, disp, grad, crest);
    amax = 0.08 * max(A, 1e-3);
  }
  vec2 F = aFrame.xy, O = aFrame.zw;
  worldPosition.xz += disp.x * F + disp.z * O;
  worldPosition.y += disp.y;
  vN = normalize(vec3(0.0, 1.0, 0.0) - grad.x * vec3(F.x, 0.0, F.y) - grad.y * vec3(O.x, 0.0, O.y));
  vCrest = crest / amax;                          // −1 trough … +1 crest
  vDepth = aDepth + disp.y;
  vSurf = smoothstep(2.6, 1.1, aDepth) * smoothstep(0.05, 0.45, aDepth);   // surf (breaking) zone
  vUV = u;
  vWorld = worldPosition.xyz;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform float uTime, uDusk, uFoam, uAmp, uScale, uFlow, uAlphaShallow, uKind;
uniform vec3 uSunDir, uSunCol, uSkyTop, uSkyHor, uCamPos, uDeep, uMid, uShallow;
varying vec3 vWorld, vN;
varying vec2 vUV;
varying float vDepth, vCrest, vSurf;
#include <fog_pars_fragment>

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
// fine chop / capillary height field
float chop(vec2 p, float t, vec2 fl) {
  float h = 0.0;
  h += sin(dot(p, vec2(0.62, 0.78)) * 1.1 + t * 1.9) * 0.22;
  h += sin(dot(p, vec2(-0.83, 0.55)) * 1.7 + t * 2.4) * 0.14;
  h += sin(dot(p, vec2(0.25, -0.97)) * 2.9 + t * 3.1) * 0.08;
  h += sin(dot(p, vec2(-0.45, -0.89)) * 4.6 + t * 4.0) * 0.045;
  vec2 q = p * 1.3 - fl * t;
  h += (vnoise(q) - 0.5) * 0.35 + (vnoise(q * 2.7 + t * 0.4) - 0.5) * 0.16 + (vnoise(q * 6.1 - t * 0.6) - 0.5) * 0.07;
  return h;
}

void main() {
  float t = uTime;
  float isCreek = step(1.5, uKind), isSea = 1.0 - step(0.5, uKind);
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 L = normalize(uSunDir);
  float d = max(vDepth, 0.0);

  // creeks run along the road: pattern space = (across, along) advected downstream
  vec2 pw = vWorld.xz * uScale;
  vec2 pc = vec2(vUV.y, vUV.x) * uScale;
  vec2 p = mix(pw, pc, isCreek);
  vec2 fl = vec2(0.0, 1.6 * uFlow);
  // creek riffles: standing bumps over stones in the shallows
  float stones = smoothstep(0.55, 0.85, vnoise(vec2(vUV.y * 0.9, vUV.x * 0.45))) * (1.0 - smoothstep(0.15, 0.7, d)) * isCreek;
  float e = 0.18;
  float h0 = chop(p, t, fl), hx = chop(p + vec2(e, 0.0), t, fl), hz = chop(p + vec2(0.0, e), t, fl);
  float str = (0.28 + 0.9 * stones) * uAmp / (1.0 + dist * 0.035);
  vec2 g = vec2(hx - h0, hz - h0) / e * str;
  vec3 N = normalize(vN + mix(vec3(-g.x, 0.0, -g.y), vec3(-g.x, 0.0, -g.y), isCreek));
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(150.0, 900.0, dist) * 0.8));

  // Fresnel sky reflection
  float cosV = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 sky = mix(uSkyHor, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.45));
  sky += uSunCol * pow(max(dot(R, L), 0.0), 6.0) * 0.18;

  // body colour by depth (absorption), lit by the sun
  vec3 body = mix(uShallow, uMid, smoothstep(0.25, 3.5, d));
  body = mix(body, uDeep, smoothstep(3.0, 14.0, d) * mix(1.0, 0.9, isCreek));
  float sunUp = clamp(L.y * 2.0 + 0.2, 0.0, 1.0);
  body *= (0.4 + 0.75 * sunUp) * mix(vec3(1.0), uSunCol, 0.3);
  // subsurface: light through crests, strongest looking toward the sun
  float back = pow(clamp(dot(-V, L) * 0.5 + 0.5, 0.0, 1.0), 2.0);
  float sss = smoothstep(0.1, 1.0, vCrest) * (0.35 + 0.9 * back) * (1.0 - smoothstep(6.0, 30.0, d) * 0.5);
  body += uShallow * sss * 0.32 * sunUp * isSea;
  body += uShallow * 0.12 * max(dot(N.xz, L.xz), 0.0) * sunUp;

  vec3 col = mix(body, sky, fres);

  // sun specular + glitter
  float sd = max(dot(R, L), 0.0);
  float spec = pow(sd, 900.0) * 16.0 + pow(sd, 110.0) * 0.55;
  float sparkle = step(0.9, vnoise(p * 9.0 + t * 2.5)) * pow(sd, 22.0) * 3.0 / (1.0 + dist * 0.01);
  col += uSunCol * (spec + sparkle) * (1.0 - uDusk * 0.75) * smoothstep(-0.02, 0.08, L.y);

  // foam
  vec2 fp = vWorld.xz * 0.9;
  float lace = vnoise(fp * 1.1 + vec2(t * 0.12, -t * 0.08)) * 0.6 + vnoise(fp * 3.3 - vec2(t * 0.2, t * 0.1)) * 0.4;
  float lace2 = smoothstep(0.35, 0.75, lace);
  // breaker lines: crests curling over in the surf zone, with a lacy trail
  float brk = smoothstep(0.5, 0.92, vCrest) * vSurf * (0.55 + 0.7 * lace);
  float trail = vSurf * smoothstep(-0.2, 0.5, vCrest) * smoothstep(0.55, 0.8, lace) * 0.6;
  // swash: white edge at the moving waterline, bubbles thinning seaward
  float edge = 1.0 - smoothstep(0.0, 0.07 + 0.25 * lace, d);
  float swash = edge * (0.55 + 0.45 * lace2) + (1.0 - smoothstep(0.05, 0.5, d)) * smoothstep(0.5, 0.8, lace) * 0.5;
  float foam = (brk + trail) * isSea + swash;
  // creek: white water over the stones and along the banks
  float streak = vnoise(vec2(vUV.y * 3.0, vUV.x * 0.7 - t * 1.8));
  foam += isCreek * (stones * smoothstep(0.35, 0.75, streak) * 1.3 + (1.0 - smoothstep(0.0, 0.18, d)) * 0.4);
  foam = clamp(foam * uFoam, 0.0, 0.95);
  vec3 foamCol = vec3(0.95, 0.97, 0.96) * (0.5 + 0.5 * sunUp) * mix(vec3(1.0), uSunCol, 0.15);
  col = mix(col, foamCol, foam);

  // dusk: water picks up the evening sky
  col = mix(col, col * 0.55 + sky * 0.25, uDusk * 0.6);

  float alpha = mix(uAlphaShallow, 1.0, smoothstep(0.25, 2.5, d));
  alpha = mix(alpha, 1.0, max(fres, smoothstep(60.0, 300.0, dist)));
  alpha *= smoothstep(0.0, 0.06, d);
  alpha = max(alpha, foam * smoothstep(-0.05, 0.02, vDepth));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
