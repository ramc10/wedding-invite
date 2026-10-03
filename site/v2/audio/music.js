/* The music bed: one slow Indian instrumental per stretch of the drive
 * (bansuri in the forest, veena in the garden, santoor over the cove and
 * hills, a bansuri reprise at the creek). Levels follow weightsAt(s) on an
 * equal-power curve, so a piece hands over where the scenery does with no dip.
 * The veena carries on down the garden-beach, between and around the venues.
 *
 * Music never stops: the bus plays sqrt(1-P) of events.js venueMix, the
 * complement of the venue music (equal power, silent at a venue and with its
 * sheet open, so two ragas never pile up), and -3 dB while the car moves.
 */
import { weightsAt, ZONES } from '../core/zones.js';
import { eng, loop, unload } from './engine.js';
import { venueMix } from './events.js';

// file → { vol, zones: {zoneId: level} }
const LAYERS = {
  opening: { vol: 0.8, zones: { forest: 1 } },
  garden:  { vol: 0.8, zones: { garden: 1, 'garden-beach': 1 } },   // the between-venues bed
  travel:  { vol: 0.8, zones: { cove: 1, hills: 1, dam: 1 } },   // the dawat music takes the last ~170 m of the dam
  closing: { vol: 0.8, zones: { creek: 1 } }
};
// loop lengths, s (site/audio/v2/music/manifest.json)
const LEN = { opening: 61.5, garden: 58.5, travel: 67.5, closing: 60.3 };
const LOAD_AHEAD = 300, KEEP = 330, BUS = 0.5;
const zoneIx = Object.fromEntries(ZONES.map((z, i) => [z.id, i]));

const live = new Map();   // name → voice
let venue = 0;

function reach(name, s) {
  let d = Infinity;
  for (const id of Object.keys(LAYERS[name].zones)) {
    const z = ZONES[zoneIx[id]];
    d = Math.min(d, Math.max(0, z.s0 - s, s - z.s1));
  }
  return d;
}

export const music = {
  update(dt, s) {
    const w = weightsAt(s);
    for (const [name, L] of Object.entries(LAYERS)) {
      const d = reach(name, s);
      let v = live.get(name);
      if (!v && d < LOAD_AHEAD) live.set(name, v = loop(`music/${name}.mp3`, 'music', { len: LEN[name] }));
      else if (v && d > KEEP) { unload(v); live.delete(name); continue; }
      if (!v) continue;
      let x = 0;
      for (const [id, lv] of Object.entries(L.zones)) x += w[zoneIx[id]] * lv;
      v.level(Math.sqrt(x) * L.vol, 2.5);   // weights sum to 1: sqrt keeps the power even across a join
    }
    // the venue's share of the music (events.js, sheet focus included); the bed takes the rest, equal power
    const m = venueMix(s);
    venue = m.P;
    const g = BUS * Math.sqrt(1 - venue) * (1 - 0.1 * eng.drive);   // and -1 dB on the move: the music is the thread
    // same taus as the venue voices (1 s, 0.5 s with a sheet open) so the crossfade stays even
    if (Math.abs(g - (music.g || 0)) > 0.002) eng.bus.music.gain.setTargetAtTime(music.g = g, eng.ctx.currentTime, m.focus ? 0.5 : 1);
  },
  open() {},    // venueMix sees the open sheet through events.js
  close() {},
  debug: () => [...live].map(([k, v]) => `${k}:${v.ready ? v.target.toFixed(2) : 'loading'}`).join(' ') + ` venue:${venue.toFixed(2)} bus:${(music.g || 0).toFixed(2)}`
};
