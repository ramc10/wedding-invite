/* Terrain beds. Each zone (core/zones.js) is a mix of layers with a level
 * and a stereo side (the camera looks down the road, so the sea on the
 * beach legs is on the left, the spillway drop at the dam on the right).
 * Levels follow weightsAt(s), so the sound cross-fades where the scenery
 * does. Birds thin out and crickets come up with dusk (world.U.uDusk).
 *
 * Layers load when their zones come within LOAD_AHEAD metres and are
 * dropped once well behind or ahead, so a phone holds a handful at a time.
 */
import { weightsAt, ZONES } from '../core/zones.js';
import { world } from '../core/world.js';
import { smoothstep } from '../core/noise.js';
import { loop, unload } from './engine.js';

// file → { vol, pan, zones: {zoneId: level} }
const LAYERS = {
  'forest-birds': { vol: 0.8, pan: 0.15, bird: true, zones: { forest: 1, hills: 0.35, creek: 0.25 } },
  'garden-birds': { vol: 0.8, pan: 0.25, bird: true, zones: { garden: 1, 'garden-beach': 0.3 } },
  shore:          { vol: 0.9, pan: -0.6, zones: { 'garden-beach': 1, cove: 0.45, dam: 0.12 } },
  'sea-wind':     { vol: 0.6, pan: -0.3, zones: { 'garden-beach': 0.6, cove: 0.7 } },
  'cove-rocks':   { vol: 0.85, pan: -0.55, zones: { cove: 1 } },
  'hills-wind':   { vol: 0.7, pan: 0.2, zones: { hills: 1, cove: 0.25, dam: 0.35 } },
  'water-rush':   { vol: 0.75, pan: 0.5, zones: { dam: 1 } },
  stream:         { vol: 0.8, pan: -0.35, zones: { creek: 1, forest: 0.2 } },
  crickets:       { vol: 0.7, pan: 0, night: true, zones: { creek: 1, dam: 0 } }
};
const LOAD_AHEAD = 260, KEEP = 420;
const zoneIx = Object.fromEntries(ZONES.map((z, i) => [z.id, i]));

const live = new Map();   // name → voice

function reach(name, s) {
  let d = Infinity;
  for (const id of Object.keys(LAYERS[name].zones)) {
    const z = ZONES[zoneIx[id]];
    d = Math.min(d, Math.max(0, z.s0 - s, s - z.s1));
  }
  return d;
}

export const nature = {
  update(dt, s) {
    const w = weightsAt(s), dusk = world.U.uDusk.value;
    for (const [name, L] of Object.entries(LAYERS)) {
      const d = reach(name, s);
      let v = live.get(name);
      if (!v && d < LOAD_AHEAD) live.set(name, v = loop(`nature/${name}.mp3`, 'nature', { len: 60, pan: L.pan }));
      else if (v && d > KEEP) { unload(v); live.delete(name); continue; }
      if (!v) continue;
      let x = 0;
      for (const [id, lv] of Object.entries(L.zones)) x += w[zoneIx[id]] * lv;
      if (L.bird) x *= 1 - 0.75 * smoothstep(0.45, 0.9, dusk);
      if (L.night) x = Math.max(x, 0.8 * smoothstep(0.4, 0.85, dusk));
      v.level(x * L.vol, 1.2);
    }
  },
  debug: () => [...live].map(([k, v]) => `${k}:${v.ready ? v.target.toFixed(2) : 'loading'}`).join(' ')
};
