/* Ethereal one-shots on the sfx bus (engine.js), in site/audio/v2/sfx/:
 * start (first tap on ♪), whoosh (the landscape changes), rise → bloom
 * (arriving at a venue), bloom (an event card opens), ending (the final view).
 * PLACEHOLDER audio cut from the Osmosis wedding pack's YouTube demo: not
 * licensed yet, kept out of git (.git/info/exclude); swap in the bought files.
 * All forward-only, never during a "Take me here" detour, and kept about
 * 6 dB under the venue music at their peaks.
 */
import { weightsAt, ZONES } from '../core/zones.js';
import { STOPS, END_S } from '../core/timeline.js';
import { detour } from '../car/detour.js';
import { load, shot } from './engine.js';

const NAMES = ['start', 'whoosh', 'rise', 'bloom', 'ending'];
const GAIN = { start: 0.55, whoosh: 0.4, rise: 0.45, bloom: 0.5, ending: 0.55 };
const play = (n, o = {}) => shot(`sfx/${n}.mp3`, 'sfx', { ...o, gain: (o.gain || 1) * GAIN[n] });

const RISE_T = 4, WHOOSH_GAP = 8000, STOP_GAP = 60000, BELL_LAG = 0.3;
const END_AT = END_S - 60;
const BEACH = ZONES.findIndex(z => z.id === 'garden-beach');

let lastS = null, zone = -1, lastWhoosh = -1e9, speed = 0, ended = false, preloaded = false, started = false;
const risen = new Map(), bloomed = new Map();   // stop id → time

const dominant = s => { const w = weightsAt(s); let i = 0; w.forEach((x, k) => { if (x > w[i]) i = k; }); return i; };

export const sfx = {
  update(dt, s) {
    const now = performance.now();
    if (!preloaded) { preloaded = true; for (const n of NAMES) load(`sfx/${n}.mp3`).catch(() => {}); }
    if (lastS == null) { lastS = s; zone = dominant(s); ended = s >= END_AT; return; }
    const ds = s - lastS, fwd = ds > 0, jump = Math.abs(ds) > 80;   // a jump (rewind home, roll-back): no sounds
    // speed: |ds/dt| eased over ~0.3 s (scroll steps arrive unevenly)
    if (dt > 0) speed += (Math.abs(ds) / dt - speed) * Math.min(1, dt / 0.3);
    const ok = fwd && !jump && !detour.active;

    // rise ~4 s before the stop at the current speed; bloom on reaching it, 0.3 s after events.js's bell
    for (const st of STOPS) {
      const d = st.s - s;
      if (ok && d > 0 && speed > 2 && d < RISE_T * speed && d > 0.6 * speed && now - (risen.get(st.id) || -1e9) > STOP_GAP) {
        risen.set(st.id, now); play('rise');
      }
      if (ok && lastS < st.s && s >= st.s && now - (bloomed.get(st.id) || -1e9) > STOP_GAP) {
        bloomed.set(st.id, now); play('bloom', { when: BELL_LAG });
      }
    }

    // whoosh when the dominant landscape changes; not into/out of the beach when a venue rise is near
    const z = dominant(s);
    if (z !== zone) {
      const beach = z === BEACH || zone === BEACH;
      const near = STOPS.some(st => st.s - s > 0 && st.s - s < 150) || [...risen.values()].some(t => now - t < RISE_T * 1000);
      if (ok && now - lastWhoosh > WHOOSH_GAP && !(beach && near)) { lastWhoosh = now; play('whoosh'); }
      zone = z;
    }

    // ending: once on the forward pass; re-armed only well back up the road
    if (ok && !ended && lastS < END_AT && s >= END_AT) { ended = true; play('ending'); }
    else if (ended && s < END_AT - 200) ended = false;
    lastS = s;
  },
  start() { if (started) return; started = true; play('start', { when: 0.35 }); },   // the master is still fading up
  open() { play('bloom', { when: 0.15 + BELL_LAG, gain: 0.7 }); },   // the bell rings at 0.15 s too
  debug: () => `speed:${speed.toFixed(1)} zone:${zone} ended:${ended}`
};
