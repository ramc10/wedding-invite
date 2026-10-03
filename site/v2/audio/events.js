/* The venues. Each stop (core/timeline.js STOPS) has its own ambience that
 * swells in over the last ~180 m of the approach, peaks at the venue and
 * trails off behind it, on the venue's side of the road. Reaching a stop
 * rings a small bell once; opening its sheet rings it again and lets the
 * venue carry over the scenery while the card is read.
 */
import { STOPS } from '../core/timeline.js';
import { smoothstep } from '../core/noise.js';
import { detour } from '../car/detour.js';
import { eng, loop, unload, shot } from './engine.js';

const FILES = { reception: 'reception', haldi: 'haldi', muhurtham: 'muhurtham', karimnagar: 'dawat' };
const VOL = { reception: 0.8, haldi: 0.85, muhurtham: 0.95, karimnagar: 0.75 };
const LEN = { reception: 62.0, haldi: 52.52, muhurtham: 36.48, karimnagar: 60.25 };   // manifest loop lengths
// full within IN of the stop..venue span, silent past OUT; venues closer than JOIN hand over at their midpoint
// over ±X (reception→haldi→muhurtham), so the music never drops out between them. Load 300 / drop 340.
const IN = 40, OUT = 130, JOIN = 320, X = 20, LOAD = 300, DROP = 340;

const live = new Map();        // stop id → voice
const rung = new Map();        // stop id → time it last rang
let focus = null;              // stop whose sheet is open
let lastS = null;              // s last frame, for the forward-crossing bell test

const venueS = st => st.venue ? st.venue.s : st.s;
const span = st => [Math.min(st.s, venueS(st)), Math.max(st.s, venueS(st))];
const ramp = (a, b, s) => Math.max(0, Math.min(1, (s - a) / (b - a)));

/* Each venue's share of the music at s: p (amplitude) per stop id, and P = sum of p^2 (<= 1). Equal power:
 * a venue fades against the bed (music.js plays sqrt(1-P)) or against its neighbour on sin/cos, so the total
 * holds steady and two musics overlap only across the handover. An open sheet gives its venue everything. */
export function venueMix(s) {
  const p = {}, SS = STOPS.filter(st => FILES[st.id]).sort((a, b) => a.s - b.s);
  let P = 0;
  SS.forEach((st, i) => {
    const [lo, hi] = span(st), a = SS[i - 1] && span(SS[i - 1])[1], b = SS[i + 1] && span(SS[i + 1])[0];
    const up = a != null && lo - a < JOIN ? ramp((a + lo) / 2 - X, (a + lo) / 2 + X, s) : ramp(lo - OUT, lo - IN, s);
    const dn = b != null && b - hi < JOIN ? 1 - ramp((hi + b) / 2 - X, (hi + b) / 2 + X, s) : 1 - ramp(hi + IN, hi + OUT, s);
    const x = focus ? +(focus === st.id) : Math.sin(Math.min(up, dn) * Math.PI / 2);
    p[st.id] = x; P += x * x;
  });
  return { p, P: Math.min(1, P), focus };
}
const panOf = st => Math.max(-0.6, Math.min(0.6, ((st.venue && st.venue.lateral) || 0) / 20));

export const events = {
  update(dt, s) {
    const now = performance.now();
    let duck = 0, ring = false;
    const mix = venueMix(s);
    for (const st of STOPS) {
      const f = FILES[st.id];
      if (!f) continue;
      // passing the stop: one bell, on a forward crossing (a fast fling can jump 30 m a frame); none during a
      // detour (the drive-out rejoins the road right at the stop) nor within 30 s of the open bell
      if (lastS != null && lastS < st.s && s >= st.s && !detour.active && now - (rung.get(st.id) || -1e9) > 30000) { rung.set(st.id, now); ring = true; }
      const d = Math.abs(s - venueS(st));
      let v = live.get(st.id);
      if (!v && d < LOAD) live.set(st.id, v = loop(`events/${f}.mp3`, 'events', { len: LEN[st.id], pan: 0 }));
      else if (v && d > DROP && focus !== st.id) { unload(v); live.delete(st.id); continue; }
      if (!v) continue;
      const x = mix.p[st.id] || 0;
      v.level(x * (VOL[st.id] || 0.8), focus ? 0.5 : 1.0);   // same taus as the bed's bus (music.js), so the sum holds
      // near centre far ahead (the camera looks toward the set on the approach), out to its side as you come level
      v.panTo(focus === st.id ? 0 : panOf(st) * (1 - smoothstep(20, 90, d)));
      duck = Math.max(duck, x);
    }
    lastS = s;
    if (ring) events.bell();
    // the venue takes over from the scenery as you arrive; both sit under the engine while the
    // car moves (about -6 dB scenery, -4 dB venue) and come back up when it stops or parks
    const drive = eng.drive, t = eng.ctx.currentTime;
    if (eng.bus.nature) eng.bus.nature.gain.setTargetAtTime(0.9 * (1 - 0.45 * duck) * (1 - 0.5 * drive), t, 0.8);
    if (eng.bus.events) eng.bus.events.gain.setTargetAtTime(0.8 * (1 - 0.12 * drive), t, 0.8);   // the car is quiet now (0.525): the music barely yields
    if (eng.bgEq) eng.bgEq.gain.setTargetAtTime(-4 * drive, t, 0.8);   // and clear a little of the engine's band (engine.js)
  },
  // on the un-ducked chime bus, ~9-10 dB over the venue swell (file is -28 LUFS, TP -6.6: gain 1.4 peaks ~-3.7 dBFS)
  bell(when = 0, gain = 1.2) { shot('events/arrive.mp3', 'chime', { gain, when }); },
  open(id) {
    const st = STOPS.find(x => x.sheet === id);
    focus = st ? st.id : null;
    if (st) rung.set(st.id, performance.now());
    events.bell(0.15, 1.4);
  },
  close() { focus = null; },
  debug: () => [...live].map(([k, v]) => `${k}:${v.ready ? v.target.toFixed(2) : 'loading'}`).join(' ') + (focus ? ` focus ${focus}` : '')
};
