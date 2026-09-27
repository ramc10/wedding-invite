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
  if (prof === 'sea') return 0;
  return smoothstep(130, 230, d) * 38 * (0.55 + 0.45 * fbm(s * 0.004 + (lat > 0 ? 50 : 0), 0.5));
}

function heightSL(s, lateral) {
  const b = path.roadY(s) - 0.12;
  const d = Math.max(0, Math.abs(lateral) - VERGE);
  if (d === 0) return b;
  const side = lateral < 0 ? 'left' : 'right';
  const w = weightsAt(s);
  let h = 0;
  for (let i = 0; i < ZONES.length; i++) {
    if (!w[i]) continue;
    const z = ZONES[i], prof = z.profile[side];
    h += w[i] * (PROFILES[prof](d, b, s, lateral, z.water) + far(d, s, lateral, prof));
  }
  return h;
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
