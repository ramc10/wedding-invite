/* The venues. Each stop (core/timeline.js STOPS) has its own ambience that
 * swells in over the last ~180 m of the approach, peaks at the venue and
 * trails off behind it, on the venue's side of the road. Reaching a stop
 * rings a small bell once; opening its sheet rings it again and lets the
 * venue carry over the scenery while the card is read.
 */
import { STOPS } from '../core/timeline.js';
import { smoothstep } from '../core/noise.js';
import { eng, loop, unload, shot } from './engine.js';

const FILES = { reception: 'reception', haldi: 'haldi', muhurtham: 'muhurtham', karimnagar: 'dawat' };
const VOL = { reception: 0.8, haldi: 0.85, muhurtham: 0.95, karimnagar: 0.75 };
const NEAR = 30, FAR = 190, LOAD = 420;

const live = new Map();        // stop id → voice
const rung = new Map();        // stop id → time it last rang
let focus = null;              // stop whose sheet is open

const venueS = st => st.venue ? st.venue.s : st.s;
const panOf = st => Math.max(-0.6, Math.min(0.6, ((st.venue && st.venue.lateral) || 0) / 20));

export const events = {
  update(dt, s) {
    const now = performance.now();
    let duck = 0;
    for (const st of STOPS) {
      const f = FILES[st.id];
      if (!f) continue;
      const d = Math.abs(s - venueS(st));
      let v = live.get(st.id);
      if (!v && d < LOAD) live.set(st.id, v = loop(`events/${f}.mp3`, 'events', { pan: panOf(st) }));
      else if (v && d > LOAD + 100 && focus !== st.id) { unload(v); live.delete(st.id); continue; }
      if (!v) continue;
      const x = focus === st.id ? 1 : 1 - smoothstep(NEAR, FAR, d);
      v.level(x * (VOL[st.id] || 0.8), focus === st.id ? 0.5 : 1.0);
      v.panTo(focus === st.id ? 0 : panOf(st) * smoothstep(0, 60, d));
      duck = Math.max(duck, x);
      // passing the stop: one bell
      if (Math.abs(s - st.s) < 10 && now - (rung.get(st.id) || -1e9) > 30000) { rung.set(st.id, now); events.bell(); }
    }
    // the venue takes over from the scenery as you arrive; both sit under the engine while the
    // car moves (about -6 dB scenery, -4 dB venue) and come back up when it stops or parks
    const drive = eng.drive, t = eng.ctx.currentTime;
    if (eng.bus.nature) eng.bus.nature.gain.setTargetAtTime(0.9 * (1 - 0.45 * duck) * (1 - 0.5 * drive), t, 0.8);
    if (eng.bus.events) eng.bus.events.gain.setTargetAtTime(0.8 * (1 - 0.4 * drive), t, 0.8);
    if (eng.bgEq) eng.bgEq.gain.setTargetAtTime(-9 * drive, t, 0.8);   // and clear the engine's band (engine.js)
  },
  bell(when = 0) { shot('events/arrive.mp3', 'events', { gain: 0.6, when }); },
  open(id) {
    const st = STOPS.find(x => x.sheet === id);
    focus = st ? st.id : null;
    events.bell(0.15);
  },
  close() { focus = null; },
  debug: () => [...live].map(([k, v]) => `${k}:${v.ready ? v.target.toFixed(2) : 'loading'}`).join(' ') + (focus ? ` focus ${focus}` : '')
};
