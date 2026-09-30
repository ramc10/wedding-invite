/* The EcoSport. The camera rides just behind it, so it is always audible
 * under the scenery:
 *   engine  an idle loop and a constant-RPM cruise loop, cross-faded by
 *           speed; the cruise loop's pitch follows a notional rev (speed
 *           plus throttle, like a CVT: no gear steps), and a low-pass opens
 *           with load, so pulling away sounds strained and coasting soft
 *   road    tyre roar rising with speed; wind (synthesised noise) on top
 *           only when the car is really moving
 *   ticks   the indicator relay, on the exact 0.8 s cycle car.js blinks its
 *           lamps on (lamp on at 0, off at 0.42 of every period)
 *   doors   "Take me here": the engine switches off when the car parks and
 *           a door shuts; closing the sheet shuts it again and starts up
 * car.indicate is wrapped (car/detour.js calls it through the object), so
 * car.js itself is untouched.
 */
import { car } from '../car/car.js';
import { clamp, smoothstep } from '../core/noise.js';
import { eng, load, loop, shot, noiseLoop } from './engine.js';

const PERIOD = 0.8, ON = 0.42;   // car.js updateLamps
let idle, cruise, road, wind, lp, ready = false;
let blink = null, blinkT = 0, engineOn = true, rev = 0.8;
const qa = { ticks: 0, tocks: 0 };   // counts, for debug()

// wrap the indicator: same reset car.js does, so both clocks start together
const indicate0 = car.indicate;
car.indicate = side => {
  indicate0(side);
  blink = side || null; blinkT = 0;
  if (blink) tick(true, 0);
};

const PANS = { left: -0.35, right: 0.35, both: 0 };
function tick(on, when) {
  qa[on ? 'ticks' : 'tocks']++;
  shot(on ? 'car/tick.mp3' : 'car/tock.mp3', 'car', { gain: on ? 0.55 : 0.4, pan: PANS[blink] || 0, when });
}

function init() {
  const ctx = eng.ctx;
  lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.5;
  lp.connect(eng.bus.car);
  idle = loop('car/engine-idle.mp3', 'car');
  cruise = loop('car/engine-cruise.mp3', 'car');
  // engine through the load filter
  for (const v of [idle, cruise]) { v.pan.disconnect(); v.pan.connect(lp); }
  road = loop('car/road.mp3', 'car');
  wind = noiseLoop('car', { type: 'bandpass', freq: 520, q: 0.6 });
  // preload the one-shots so the first tick is on time
  for (const f of ['tick', 'tock', 'door-close', 'engine-start', 'engine-off']) load(`car/${f}.mp3`).catch(() => {});
  ready = true;
}

export const carSound = {
  update(dt) {
    if (!eng.on) return;
    if (!ready) init();
    const v = Math.abs(car.speed), a = car.accel;

    // indicator relay, stepped with the same dt car.js blinks with
    if (blink) {
      const t0 = blinkT; blinkT += dt;
      const p0 = t0 % PERIOD, p1 = blinkT % PERIOD;
      if (p1 < p0) tick(true, 0);                                     // into a new period: lamp on
      else if (p0 < ON && p1 >= ON) tick(false, 0);                   // lamp off
    }

    const load = clamp(a / 4, -1, 1);
    const target = 0.72 + 0.5 * smoothstep(0, 28, v) + 0.12 * Math.max(0, load) + 0.25 * smoothstep(30, 60, v);
    rev += (target - rev) * Math.min(1, dt * 3);
    const move = smoothstep(0.3, 3, v);
    eng.drive = engineOn ? move : 0;   // the scenery and venues duck under a moving car (events.js)
    if (engineOn) {
      // parked it's a soft idle; on the move the engine carries the car and grows with speed and throttle
      idle.level(0.5 * (1 - move), 0.25);
      cruise.level((0.7 + 0.55 * smoothstep(3, 30, v) + 0.45 * Math.max(0, load)) * move, 0.2);
    } else { idle.level(0, 0.15); cruise.level(0, 0.15); }
    cruise.rate(rev);
    idle.rate(0.95 + 0.1 * move);
    lp.frequency.setTargetAtTime(1100 + 2600 * clamp(0.3 * move + 0.7 * Math.max(0, load) + 0.3 * smoothstep(10, 40, v), 0, 1), eng.ctx.currentTime, 0.15);
    road.level(0.4 * smoothstep(1, 22, v), 0.2);
    road.rate(0.85 + 0.3 * smoothstep(5, 40, v));
    wind.level(0.18 * smoothstep(12, 45, v) ** 1.5, 0.3);
  },

  /** parked at a venue: engine off, door shuts */
  park() {
    if (!eng.on) return;
    engineOn = false;
    shot('car/engine-off.mp3', 'car', { gain: 0.6 });
    shot('car/door-close.mp3', 'car', { gain: 0.7, pan: -0.2, when: 1.1 });
  },
  /** leaving: door shuts, engine starts */
  unpark() {
    if (!eng.on) { engineOn = true; return; }
    shot('car/door-close.mp3', 'car', { gain: 0.7, pan: -0.2 });
    shot('car/engine-start.mp3', 'car', { gain: 0.65, when: 0.5 });
    setTimeout(() => { engineOn = true; }, 1600);
  },
  debug: () => ready ? `rev ${rev.toFixed(2)} idle ${idle.target.toFixed(2)} cruise ${cruise.target.toFixed(2)} road ${road.target.toFixed(2)} wind ${wind.target.toFixed(2)} blink ${blink} on ${engineOn} ticks ${qa.ticks}/${qa.tocks} blinkT ${blinkT.toFixed(2)}` : 'not started'
};
