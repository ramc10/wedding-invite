/* The road. One Catmull-Rom spline through hand-placed points, resampled by
 * arc length into a lookup table at STEP metres, so `s` (metres driven) is
 * the one coordinate every module shares: scroll produces s, the car sits at
 * s, zones span [s0,s1], the timeline fires at s.
 *
 * The road runs broadly toward -Z. Curves are kept wide (radius well over
 * the terrain ribbon's half-width) so the terrain mesh, which is built in
 * (s, lateral) space, never folds over itself on the inside of a bend.
 *
 * API (frozen — biomes, camera, terrain and shaders depend on it):
 *   path.length                      metres
 *   path.halfWidth                   road half-width, metres (asphalt edge)
 *   path.sample(s, out?)             → out {pos, fwd, right, heading, curvature}
 *                                      pos/fwd/right are THREE.Vector3; fwd, right
 *                                      horizontal unit vectors; right = fwd × up
 *   path.toWorld(s, lateral, out?)   → Vector3 on the road's horizontal plane
 *                                      (y = road height at s); +lateral = right
 *   path.roadY(s)                    road surface height at s
 *   path.nearest(x, z)               → {s, lateral}
 *   path.tex                         DataTexture TEX_W×1 RGBA float:
 *                                      (x, roadY, z, heading) at s = u*length
 */
import * as THREE from 'three';
import { clamp } from './noise.js';

// [x, y, z] — y is road height. Hills leg climbs, dam leg rides the crest.
const PTS = [
  [0, 2.2, 60], [0, 2.2, 0], [8, 2.6, -120], [-10, 3.0, -240],        // forest
  [-24, 2.2, -360], [-8, 2.0, -480], [14, 2.0, -600],                // garden
  [26, 2.8, -720], [12, 3.2, -840],                                  // garden → beach
  [-14, 3.2, -960], [-30, 3.0, -1080], [-18, 3.4, -1200], [6, 4.5, -1300], // cove
  // pine hills: the same bends, 25% closer together (the leg was cut from ~420 m to ~315 m)
  [22, 9, -1372], [16, 15, -1444], [-6, 17, -1516], [-20, 12, -1588],
  [-12, 6.5, -1688], [0, 6.0, -1788], [10, 6.0, -1888], [4, 5.0, -1988], // dam crest
  [-14, 3.0, -2088], [-20, 2.4, -2188], [-10, 2.2, -2308], [0, 2.2, -2408] // creek
];

const STEP = 0.5;
const TEX_W = 2048;

const curve = new THREE.CatmullRomCurve3(PTS.map(p => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
// Drop the lead-in point's span from s: s=0 sits at [0,*,0] so the title shot
// has road behind the car.
const fullLen = curve.getLength();
const lead = (() => { const l = curve.getLengths(4000); const u0 = 1 / (PTS.length - 1); return l[Math.round(u0 * 4000)]; })();

const N = Math.ceil((fullLen - lead) / STEP) + 1;
const LX = new Float32Array(N), LY = new Float32Array(N), LZ = new Float32Array(N), LH = new Float32Array(N);
{
  const tmp = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const d = Math.min(lead + i * STEP, fullLen);
    curve.getPointAt(d / fullLen, tmp);
    LX[i] = tmp.x; LY[i] = tmp.y; LZ[i] = tmp.z;
  }
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 2), b = Math.min(N - 1, i + 2);
    // heading: angle of fwd in XZ, 0 = -Z, positive turns toward -X (right-hand about +Y)
    LH[i] = Math.atan2(-(LX[b] - LX[a]), -(LZ[b] - LZ[a]));
  }
}

const length = (N - 1) * STEP;

function idx(s) {
  const f = clamp(s, 0, length) / STEP;
  const i = Math.min(N - 2, Math.floor(f));
  return [i, f - i];
}

function roadY(s) { const [i, t] = idx(s); return LY[i] + (LY[i + 1] - LY[i]) * t; }

function headingAt(s) {
  const [i, t] = idx(s);
  let a = LH[i], b = LH[i + 1];
  if (b - a > Math.PI) b -= 2 * Math.PI; else if (a - b > Math.PI) b += 2 * Math.PI;
  return a + (b - a) * t;
}

function sample(s, out = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(), heading: 0, curvature: 0 }) {
  const [i, t] = idx(s);
  out.pos.set(LX[i] + (LX[i + 1] - LX[i]) * t, LY[i] + (LY[i + 1] - LY[i]) * t, LZ[i] + (LZ[i + 1] - LZ[i]) * t);
  const h = headingAt(s);
  out.heading = h;
  out.fwd.set(-Math.sin(h), 0, -Math.cos(h));
  out.right.set(Math.cos(h), 0, -Math.sin(h));
  let h2 = headingAt(s + 4), h1 = headingAt(s - 4);
  let dh = h2 - h1; if (dh > Math.PI) dh -= 2 * Math.PI; else if (dh < -Math.PI) dh += 2 * Math.PI;
  out.curvature = dh / 8; // rad per metre; + = turning left
  return out;
}

function toWorld(s, lateral, out = new THREE.Vector3()) {
  const [i, t] = idx(s);
  const h = headingAt(s);
  out.set(
    LX[i] + (LX[i + 1] - LX[i]) * t + Math.cos(h) * lateral,
    LY[i] + (LY[i + 1] - LY[i]) * t,
    LZ[i] + (LZ[i + 1] - LZ[i]) * t - Math.sin(h) * lateral
  );
  return out;
}

function nearest(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < N; i += 16) {
    const dx = LX[i] - x, dz = LZ[i] - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  const a = Math.max(0, best - 16), b = Math.min(N - 1, best + 16);
  for (let i = a; i <= b; i++) {
    const dx = LX[i] - x, dz = LZ[i] - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  const h = LH[best];
  const lateral = (x - LX[best]) * Math.cos(h) - (z - LZ[best]) * Math.sin(h);
  return { s: best * STEP, lateral };
}

const texData = new Float32Array(TEX_W * 4);
for (let i = 0; i < TEX_W; i++) {
  const s = (i / (TEX_W - 1)) * length;
  const [j, t] = idx(s);
  texData[i * 4] = LX[j] + (LX[j + 1] - LX[j]) * t;
  texData[i * 4 + 1] = LY[j] + (LY[j + 1] - LY[j]) * t;
  texData[i * 4 + 2] = LZ[j] + (LZ[j + 1] - LZ[j]) * t;
  texData[i * 4 + 3] = headingAt(s);
}
const tex = new THREE.DataTexture(texData, TEX_W, 1, THREE.RGBAFormat, THREE.FloatType);
tex.magFilter = tex.minFilter = THREE.LinearFilter; // needs OES_texture_float_linear; fine on WebGL2 desktop, sample at texel centres on mobile
tex.needsUpdate = true;

export const path = { length, halfWidth: 3.6, sample, toWorld, roadY, nearest, tex, STEP };
