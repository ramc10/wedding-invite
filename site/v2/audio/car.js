/* The EcoSport. The camera rides just behind it, so it is always audible
 * under the scenery:
 *   engine  an idle loop and a constant-RPM cruise loop, cross-faded by
 *           speed; the cruise loop's pitch follows a notional rev (speed
 *           plus throttle, like a CVT: no gear steps), and a low-pass opens
 *           with load, so pulling away sounds strained and coasting soft
 *   road    a quiet, dark tyre roar rising with speed; a faint low wind
 *           breath on top only when the car is really moving
 *   ticks   the indicator relay, on the exact 0.8 s cycle car.js blinks its
 *           lamps on (lamp on at 0, off at 0.42 of every period)
 *   doors   "Take me here": the engine switches off when the car parks and
 *           a door shuts; closing the sheet shuts it again and starts up
 * car.indicate is wrapped (car/detour.js calls it through the object); the
 * ticks read car.blinkT, the lamps' own clock.
 */
import { car } from '../car/car.js';
import { clamp, smoothstep } from '../core/noise.js';
import { eng, load, loop, shot, noiseLoop } from './engine.js';

const PERIOD = 0.8, ON = 0.42;   // car.js updateLamps
let idle, cruise, road, roadLp, wind, lp, ready = false;
let blink = null, blinkT = 0, seenT = 0, engineOn = true, rev = 0.8, warm = 1, startT = 0;
const qa = { ticks: 0, tocks: 0 };   // counts, for debug()

// wrap the indicator: same reset car.js does, so both clocks start together
const indicate0 = car.indicate;
car.indicate = side => {
  indicate0(side);
  blink = side || null; blinkT = seenT = 0;
  if (blink && eng.on) tick(true, 0);
};

const PANS = { left: -0.35, right: 0.35, both: 0 };
// files are 3 kHz low-passed, 90 ms: a soft rounded relay, ~-4 dB on the old click
function tick(on, when) {
  qa[on ? 'ticks' : 'tocks']++;
  // the relay is a signal, not noise: original crisp clicks at their original level (0.55 / 0.4 on a
  // full car bus), compensated for the car bus now sitting at 0.525
  shot(on ? 'car/tick.mp3' : 'car/tock.mp3', 'car', { gain: on ? 1.05 : 0.76, pan: PANS[blink] || 0, when });
}

// engine-start is ~99% below 300 Hz, where a phone speaker has nothing: take the boom
// down and lift the catch and rattle, so it reads over the venue (peak stays ~-4 dBFS)
function startUp(when) {
  const ctx = eng.ctx;
  load('car/engine-start.mp3').then(buf => {
    if (!eng.on) return;
    const src = ctx.createBufferSource(), g = ctx.createGain(), lo = ctx.createBiquadFilter(), mid = ctx.createBiquadFilter();
    lo.type = 'lowshelf'; lo.frequency.value = 200; lo.gain.value = -6;
    mid.type = 'peaking'; mid.frequency.value = 900; mid.Q.value = 0.8; mid.gain.value = 6;
    src.buffer = buf; g.gain.value = 1.1;   // ~-2 dB: a start, not a bang
    src.connect(lo).connect(mid).connect(g).connect(eng.bus.car);
    src.start(ctx.currentTime + when);
  }).catch(e => console.warn('[sound] engine-start', e && e.message));
}

function init() {
  const ctx = eng.ctx;
  lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 1000; lp.Q.value = 0.5;
  lp.connect(eng.bus.car);
  // manifest lengths: a decoder that keeps the MP3 padding must not stretch the loop
  idle = loop('car/engine-idle.mp3', 'car', { len: 10 });
  cruise = loop('car/engine-cruise.mp3', 'car', { len: 9 });
  // engine through the load filter
  for (const v of [idle, cruise]) { v.pan.disconnect(); v.pan.connect(lp); }
  road = loop('car/road.mp3', 'car', { len: 20 });
  // road through its own dark low-pass: tyre roar is broadband hiss on a phone
  roadLp = ctx.createBiquadFilter(); roadLp.type = 'lowpass'; roadLp.frequency.value = 1200; roadLp.Q.value = 0.5;
  roadLp.connect(eng.bus.car); road.pan.disconnect(); road.pan.connect(roadLp);
  // wind: only a soft low breath at real speed
  wind = noiseLoop('car', { type: 'lowpass', freq: 380, q: 0.5 });
  // preload the one-shots so the first tick is on time
  for (const f of ['tick', 'tock', 'door-close', 'engine-start', 'engine-off']) load(`car/${f}.mp3`).catch(() => {});
  ready = true;
}

export const carSound = {
  update(dt) {
    if (!eng.on) return;
    if (!ready) init();
    // the late-tap roll-back reverses ~56 m in 1.3 s: that is a scroll, not a drive, so it
    // sounds like a reverse crawl (low rev, soft road, no wind), never like fast cruise
    const back = Math.max(0, -car.speed), fwd = Math.max(0, car.speed);
    const v = fwd + Math.min(back, 3), a = back > 0.3 ? 0 : car.accel;

    // indicator relay: edges of car.js's lamp clock (it runs while muted) since the last update
    if (blink) {
      blinkT = car.blinkT;
      const t0 = seenT; seenT = blinkT;
      const p0 = t0 % PERIOD, p1 = seenT % PERIOD;
      if (seenT - t0 < 0.2) {                                         // a longer gap is an unmute: just pick up the phase
        if (p1 < p0) tick(true, 0);                                   // into a new period: lamp on
        else if (p0 < ON && p1 >= ON) tick(false, 0);                // lamp off
      }
    }

    const load = clamp(a / 4, -1, 1);
    // soft rev swing (0.78-1.2): a smooth hum, not a whine
    const target = 0.78 + 0.32 * smoothstep(0, 28, v) + 0.06 * Math.max(0, load) + 0.1 * smoothstep(30, 60, v);
    rev += (target - rev) * Math.min(1, dt * 2);
    const move = smoothstep(0.3, 3, v);
    // driving off at the end, the camera stays behind: the car fades into the distance
    const near = 1 - smoothstep(12, 260, car.away);
    eng.drive = engineOn ? move * near : 0;   // the scenery and venues duck under a moving car (events.js)
    // after a start-up the engine comes in under the start sample as idle, then opens into cruise
    warm = Math.min(1, warm + dt / 2.2);
    const mv = move * smoothstep(0.35, 1, warm);
    if (engineOn) {
      // parked it's a soft idle; on the move the engine carries the car and grows with speed and throttle
      idle.level(0.5 * (1 - mv) * smoothstep(0, 0.35, warm) * near, 0.25);
      cruise.level((0.7 + 0.45 * smoothstep(3, 30, v) + 0.2 * Math.max(0, load)) * mv * near, 0.4);
    } else { idle.level(0, 0.15); cruise.level(0, 0.15); }
    cruise.rate(rev);
    idle.rate(0.95 + 0.1 * move);
    // load filter tops out ~2 kHz (was 3.7): throttle opens it warmly, never into growl
    lp.frequency.setTargetAtTime(1000 + 1000 * clamp(0.3 * move + 0.7 * Math.max(0, load) + 0.3 * smoothstep(10, 40, v), 0, 1), eng.ctx.currentTime, 0.15);
    road.level((0.15 * smoothstep(1, 22, fwd) + 0.05 * smoothstep(0.5, 8, back)) * near, 0.3);
    road.rate(0.85 + 0.2 * smoothstep(5, 40, fwd));
    wind.level(0.04 * smoothstep(15, 45, fwd) ** 1.5 * near * near, 0.5);
  },

  /** parked at a venue: engine off, door shuts */
  park() {
    clearTimeout(startT);   // a start still pending from a quick unpark must not restart it
    const was = engineOn; engineOn = false;
    if (!eng.on || !was) return;
    // soft and a little away: engine-off -2 dB, door a 2.5 kHz low-passed thunk ~-5 dB
    shot('car/engine-off.mp3', 'car', { gain: 0.8 });
    shot('car/door-close.mp3', 'car', { gain: 0.68, pan: -0.25, when: 1.1 });
  },
  /** leaving: door shuts, engine starts */
  unpark() {
    clearTimeout(startT);
    if (engineOn) return;   // already running (♪ came on while parked): no start over it
    if (!eng.on) { engineOn = true; warm = 1; return; }
    shot('car/door-close.mp3', 'car', { gain: 0.68, pan: -0.25 });
    startUp(0.5);
    // the car rolls out ~0.9 s later: the engine is on from the moment it catches
    startT = setTimeout(() => { engineOn = true; warm = 0; }, 500);
  },
  debug: () => ready ? `rev ${rev.toFixed(2)} idle ${idle.target.toFixed(2)} cruise ${cruise.target.toFixed(2)} road ${road.target.toFixed(2)} wind ${wind.target.toFixed(2)} blink ${blink} on ${engineOn} ticks ${qa.ticks}/${qa.tocks} blinkT ${blinkT.toFixed(2)}` : 'not started'
};
