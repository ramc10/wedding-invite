/* Terrain beds. Each zone (core/zones.js) is a mix of layers with a level
 * and a stereo side (the camera looks down the road, so the sea on the
 * beach legs is on the left, the spillway drop at the dam on the right).
 * Levels follow weightsAt(s), so the sound cross-fades where the scenery
 * does. Birds go quiet at night (not at sunrise) and crickets come up with
 * dusk (world.U.uDusk).
 *
 * Layers load when their zones come within LOAD_AHEAD metres and are
 * dropped once well behind or ahead, so a phone holds a handful at a time.
 */
import { weightsAt, dayAt, ZONES } from '../core/zones.js';
import { world } from '../core/world.js';
import { smoothstep } from '../core/noise.js';
import { eng, loop, unload } from './engine.js';

// file → { vol, pan, lp (Hz, own lowpass), zones: {zoneId: level} }
// the noise-like beds sit 4-6 dB under the birds and darker, so they read as a warm wash, not hiss
const LAYERS = {
  'forest-birds': { vol: 0.8, pan: 0.15, bird: true, zones: { forest: 1, hills: 0.35, dam: 0.3, creek: 0.4 } },   // birds, not the roar, fill the dam approach
  'garden-birds': { vol: 0.95, pan: 0.25, bird: true, zones: { garden: 1, 'garden-beach': 0.3 } },
  shore:          { vol: 0.55, pan: -0.6, lp: 2200, zones: { 'garden-beach': 1, cove: 0.3, dam: 0.12 } },   // a soft wash of waves
  'sea-wind':     { vol: 0.36, pan: -0.3, lp: 1500, zones: { 'garden-beach': 0.6, cove: 0.5 } },
  'cove-rocks':   { vol: 0.5, pan: -0.55, lp: 1800, zones: { cove: 1 } },
  'hills-wind':   { vol: 0.62, pan: 0.2, lp: 1400, zones: { hills: 1, cove: 0.25, dam: 0.35, creek: 0.2 } },   // a faint breeze gives the creek some width
  // the roar comes from the open spillway bays (biomes/dam.js SP.c, right side), not the whole dam; -6 dB and dark: far off
  'water-rush':   { vol: 0.38, pan: 0.5, lp: 1100, at: 1910, zones: { dam: 1 } },
  // no stream layer: forest.js has no water, and the owner wants the creek dry
  // creek is low so the night term carries them and they fade with the sunrise ending
  crickets:       { vol: 0.7, pan: 0, night: true, zones: { creek: 0.25, dam: 0 } }
};
const LOAD_AHEAD = 300, KEEP = 330;   // audible 30 m inside a zone edge; a phone can't hold every bed
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
    // dusk is sun height, so a sunrise reads as dusk: the day keys' dawn flag tells them apart
    const k = dayAt(s), dawn = (k.a.dawn || 0) + ((k.b.dawn || 0) - (k.a.dawn || 0)) * k.t;
    for (const [name, L] of Object.entries(LAYERS)) {
      const d = reach(name, s);
      let v = live.get(name);
      if (!v && d < LOAD_AHEAD) {
        live.set(name, v = loop(`nature/${name}.mp3`, 'nature', { len: 60, pan: L.pan }));
        if (L.lp) {   // pan → own lowpass → nature bus (as car.js does for the engine)
          const f = v.lp = eng.ctx.createBiquadFilter();
          f.type = 'lowpass'; f.frequency.value = L.lp; f.Q.value = 0.5;
          v.pan.disconnect(); v.pan.connect(f).connect(eng.bus.nature);
        }
      } else if (v && d > KEEP) { unload(v); v.lp && v.lp.disconnect(); live.delete(name); continue; }
      if (!v) continue;
      let x = 0;
      for (const [id, lv] of Object.entries(L.zones)) x += w[zoneIx[id]] * lv;
      if (L.bird) x *= (1 - smoothstep(0.45, 0.95, dusk) * (1 - dawn)) * (1 + 1.2 * dawn);   // silent at night, a chorus at first light
      if (L.at) {   // level and side from the distance to the source: ahead-right, hard right abeam, then behind
        const d = s - L.at, p = d < 0 ? 0.2 + 0.5 * (1 - smoothstep(0, 150, -d)) : 0.4 + 0.3 * (1 - smoothstep(0, 100, d));
        x *= 0.4 + 0.6 * (1 - smoothstep(40, 220, Math.abs(d)));
        if (Math.abs(p - (v.p ?? L.pan)) > 0.02) v.panTo(v.p = p);
      }
      if (L.night) x = Math.max(x, 0.8 * smoothstep(0.4, 0.85, dusk));
      v.level(x * L.vol, 1.2);
    }
  },
  debug: () => [...live].map(([k, v]) => `${k}:${v.ready ? v.target.toFixed(2) : 'loading'}`).join(' ')
};
