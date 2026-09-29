/* Ground height and the shared uniform bag.
 *
 * Height is defined in road space (s, lateral) because that is how the
 * terrain mesh is built and how biomes place things. Everyone who needs the
 * ground — terrain mesh, tree placement, camera clamp, water shoreline —
 * calls these, so they always agree.
 *
 * API (frozen):
 *   world.heightSL(s, lateral)   ground y at road coords
 *   world.heightAt(x, z)         ground y at world coords (slower: nearest-s search)
 *   world.waterAt(s)             water surface y of the zone at s, or null
 *   world.sideProfile(s, lateral)→ profile name dominating that spot ('sea', 'hill', …)
 *   world.VERGE                  metres from the road centre where terrain leaves road level
 *   world.U                      shared uniforms — reference these objects in your
 *                                ShaderMaterials (never clone); main.js/atmosphere
 *                                update them every frame:
 *     uTime f, uWind v2, uSunDir v3 (towards sun), uSunCol c, uSkyTop c, uSkyHor c,
 *     uFogCol c, uFogDensity f, uFogHeight f, uPathTex t, uPathLen f, uCamPos v3,
 *     uDusk f (0 day → 1 night: lanterns, windows, fireflies)
 */
import * as THREE from 'three';
import { path } from './path.js';
import { ZONES, weightsAt, zoneAt } from './zones.js';
import { fbm, smoothstep } from './noise.js';
import { SITES } from './timeline.js';

const VERGE = path.halfWidth + 2.2;

const PROFILES = {
  forest(d, b, s, lat) {
    return b + smoothstep(0, 70, d) * 7 * (0.6 + 0.4 * fbm(s * 0.01, lat * 0.02))
      + fbm(s * 0.03, lat * 0.03) * 2.2 * smoothstep(0, 20, d);
  },
  flat(d, b, s, lat) {
    return b - 0.25 + fbm(s * 0.02, lat * 0.02) * 0.8 * smoothstep(0, 15, d);
  },
  hill(d, b, s, lat) {
    return b + smoothstep(0, 130, d) * 34 * (0.7 + 0.3 * fbm(s * 0.006, lat * 0.01))
      + fbm(s * 0.025, lat * 0.025) * 4 * smoothstep(0, 25, d);
  },
  sea(d, b, s, lat, w) {
    w = w ?? 0;
    const floor = w - 7;
    return b - smoothstep(3, 55, d) * (b - floor) + fbm(s * 0.02, lat * 0.02) * 0.6;
  },
  drop(d, b, s, lat) {
    const floor = -16;
    return b - smoothstep(1, 22, d) * (b - floor) + fbm(s * 0.02, lat * 0.03) * 2.5 * smoothstep(18, 40, d);
  }
};

// distant ridge line so the horizon isn't a hard terrain edge (not over water)
function far(d, s, lat, prof) {
  if (prof === 'sea' || d <= 130) return 0;   // smoothstep(130, …) is 0 there: skip the fbm
  return smoothstep(130, 230, d) * 38 * (0.55 + 0.45 * fbm(s * 0.004 + (lat > 0 ? 50 : 0), 0.5));
}

function rawHeightSL(s, lateral) {
  const b = path.roadY(s) - 0.12;
  const d = Math.max(0, Math.abs(lateral) - VERGE);
  if (d === 0) return b;
  return rawOff(s, lateral, d, b, weightsAt(s));
}
// off-road part, with the per-s terms (road height b, zone weights w) passed in
function rawOff(s, lateral, d, b, w) {
  const side = lateral < 0 ? 'left' : 'right';
  let h = 0;
  for (let i = 0; i < ZONES.length; i++) {
    if (!w[i]) continue;
    const z = ZONES[i], prof = z.profile[side];
    h += w[i] * (PROFILES[prof](d, b, s, lateral, z.water) + far(d, s, lateral, prof));
  }
  return courtCap(s, lateral, b, h);
}

/* The beach venues' courts (core/timeline.js COURTS) are paved at road level,
 * with aprons 7 m either side where the car leaves and rejoins the road: the
 * ground there is held just under the paving, easing back to its own shape
 * over a few metres, so no terrain pokes through where the car drives. */
// the whole site: forecourt and deck (SITES), plus the aprons where the drive meets the road
const COURT_BOX = Object.values(SITES).map(S => ({ s0: S.a - 7, s1: S.d1 + 2, l0: S.lat[1] - 0.5, l1: -3.6 }));
function courtCap(s, lateral, b, h) {
  for (const c of COURT_BOX) {
    const ds = Math.max(0, c.s0 - s, s - c.s1), dl = Math.max(0, c.l0 - lateral, lateral - c.l1);
    if (ds > 8 || dl > 8) continue;
    const cap = b + 0.02 + Math.hypot(ds, dl) * 0.45;     // b is road − 0.12: 10 cm under the paving
    if (h > cap) h = cap;
  }
  return h;
}

/* Ground height is asked for at the same places over and over (terrain
 * vertices, grass recycling every frame, every planted instance, the camera
 * clamp), and each raw evaluation is several fbm calls plus zone weights. So
 * off the road it's served from a lazily filled grid — 1 m along s, 0.5 m
 * across — bilinearly interpolated, each corner computed once. On the road
 * (|lateral| ≤ VERGE) the exact value is cheap and returned directly. */
const GS = 1, GL = 0.5, GMAX = 300, GW = Math.round(2 * GMAX / GL) + 1;
// row i (s = i·GS): its corner heights, plus road height and zone weights shared by the row
const rows = [], rowB = new Float64Array(Math.ceil(path.length / GS) + 2), rowW = [];
function corner(i, j) {
  let r = rows[i];
  if (!r) { r = rows[i] = new Float32Array(GW).fill(NaN); rowB[i] = path.roadY(i * GS) - 0.12; rowW[i] = weightsAt(i * GS); }
  let v = r[j];
  if (v !== v) {
    const lateral = j * GL - GMAX, d = Math.max(0, Math.abs(lateral) - VERGE);
    v = r[j] = d === 0 ? rowB[i] : rawOff(i * GS, lateral, d, rowB[i], rowW[i]);
  }
  return v;
}
function heightSL(s, lateral) {
  if (Math.abs(lateral) <= VERGE) return path.roadY(Math.min(Math.max(s, 0), path.length)) - 0.12;
  if (Math.abs(lateral) >= GMAX - GL || s < 0 || s > path.length) return rawHeightSL(s, lateral);
  const fs = s / GS, fl = (lateral + GMAX) / GL;
  const i = Math.floor(fs), j = Math.floor(fl), ts = fs - i, tl = fl - j;
  // on a grid line (integer s: terrain rows, many placements) the far corners
  // get zero weight, so they aren't computed; the result is the same
  const a = corner(i, j), ab = tl ? a + (corner(i, j + 1) - a) * tl : a;
  if (!ts) return ab;
  const c = corner(i + 1, j), cd = tl ? c + (corner(i + 1, j + 1) - c) * tl : c;
  return ab * (1 - ts) + cd * ts;
}

function heightAt(x, z) {
  const n = path.nearest(x, z);
  return heightSL(n.s, n.lateral);
}

function waterAt(s) { return zoneAt(s).water; }

function sideProfile(s, lateral) { return zoneAt(s).profile[lateral < 0 ? 'left' : 'right']; }

const U = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0.6, 0.2) },
  uSunDir: { value: new THREE.Vector3(0, 0.4, -1).normalize() },
  uSunCol: { value: new THREE.Color(0xffe0b0) },
  uSkyTop: { value: new THREE.Color(0x6c9fd0) },
  uSkyHor: { value: new THREE.Color(0xf6e6c4) },
  uFogCol: { value: new THREE.Color(0xd9d2b8) },
  uFogDensity: { value: 0.0022 },
  uFogHeight: { value: 0.035 },
  uPathTex: { value: path.tex },
  uPathLen: { value: path.length },
  uCamPos: { value: new THREE.Vector3() },
  uDusk: { value: 0 }
};

export const world = { heightSL, heightAt, waterAt, sideProfile, VERGE, U };
