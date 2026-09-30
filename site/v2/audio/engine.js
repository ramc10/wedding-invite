/* The sound engine: one AudioContext, four buses into a gentle master
 * compressor, buffer loading, seamless loops and one-shots.
 *
 *   buses: nature (terrain beds), car (engine, road, indicators, doors),
 *          events (venue ambiences, chime), each with its own gain; the
 *          nature and events buses duck under the car while it moves
 *   loop(url, bus, {len, pan})  → voice {gain, src, pan, rate(r), level(v, tau)}
 *                                  starts silent; level() eases it
 *   shot(url, bus, {gain, pan, when})  plays a one-shot (buffers cached)
 *   unload(voice)                      stops a loop and drops its buffer
 *
 * Every loop file is the loop (len s) plus its first 0.5 s again
 * (tools/audio/mkloop.py): MP3 decoders may or may not strip the encoder's
 * lead-in, so the loop point is found by matching the repeat.
 * Nothing is created until the first tap on ♪ (browsers require a gesture).
 */
import { quality } from '../core/quality.js';

export const BASE = new URL('../../audio/v2/', import.meta.url).href;

// drive: 0 parked … 1 on the move (car.js); events.js ducks the scenery and venues by it
export const eng = { ctx: null, master: null, bus: {}, on: false, drive: 0 };
const buffers = new Map();   // url → Promise<AudioBuffer>

export function start() {
  const AC = window.AudioContext || window.webkitAudioContext;
  // phones: decode at 32 kHz — a minute of stereo is 15 MB instead of 21 MB
  const ctx = eng.ctx = new AC(quality.mobile ? { sampleRate: 32000 } : undefined);
  // iOS: play through the ring/silent switch like a video would
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 3;
  comp.attack.value = 0.02; comp.release.value = 0.4;
  eng.master = ctx.createGain();
  eng.master.gain.value = 0;
  eng.master.connect(comp).connect(ctx.destination);
  // the engine and tyres are mostly under 300 Hz, which phone speakers barely play, and the
  // scenery (wind, surf, birds) sits right where they do. So the car bus trades boom for body
  // (shelf down at 120 Hz, a lift around 500 Hz), and the scenery and venues share one EQ that
  // carves the same band out while the car moves (bgEq.gain, set by events.js from drive).
  const shelf = ctx.createBiquadFilter(), body = ctx.createBiquadFilter();
  shelf.type = 'lowshelf'; shelf.frequency.value = 120; shelf.gain.value = -6;
  body.type = 'peaking'; body.frequency.value = 500; body.Q.value = 0.8; body.gain.value = 8;
  shelf.connect(body).connect(eng.master);
  eng.carOut = body;   // (QA taps the two sides here)
  const bgEq = eng.bgEq = ctx.createBiquadFilter();
  bgEq.type = 'peaking'; bgEq.frequency.value = 550; bgEq.Q.value = 0.7; bgEq.gain.value = 0;
  bgEq.connect(eng.master);
  for (const [k, v] of Object.entries({ nature: 0.9, car: 1, events: 0.8 })) {
    const g = eng.bus[k] = ctx.createGain();
    g.gain.value = v;
    g.connect(k === 'car' ? shelf : bgEq);
  }
}

export function load(url) {
  if (!buffers.has(url)) {
    const p = fetch(BASE + url)
      .then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.arrayBuffer(); })
      .then(b => new Promise((ok, no) => eng.ctx.decodeAudioData(b, ok, no)));
    p.catch(() => buffers.delete(url));
    buffers.set(url, p);
  }
  return buffers.get(url);
}

function loopStart(buf, len) {
  const ch = buf.getChannelData(0), n = Math.round(len * buf.sampleRate), N = 1024;
  let d = 0, best = Infinity;
  for (let o = 0; o < Math.min(Math.round(0.1 * buf.sampleRate), ch.length - n - N); o++) {
    let e = 0;
    for (let i = 0; i < N; i += 2) { const q = ch[o + i] - ch[o + n + i]; e += q * q; }
    if (e < best) { best = e; d = o; }
  }
  return d / buf.sampleRate;
}

/** A looping voice. It exists (silent) at once and starts sounding when its buffer is in. */
export function loop(url, bus, { len, pan = 0 } = {}) {
  const ctx = eng.ctx;
  const v = { url, gain: ctx.createGain(), pan: ctx.createStereoPanner(), src: null, ready: false, dead: false, target: 0, r: 1 };
  v.gain.gain.value = 0;
  v.pan.pan.value = pan;
  v.gain.connect(v.pan).connect(eng.bus[bus]);
  v.level = (x, tau = 0.6) => {
    if (Math.abs(x - v.target) < 0.004) return;
    v.target = x;
    v.gain.gain.setTargetAtTime(x, ctx.currentTime, tau);
  };
  v.rate = (r, tau = 0.12) => {
    if (Math.abs(r - v.r) < 0.003) return;
    v.r = r;
    if (v.src) v.src.playbackRate.setTargetAtTime(r, ctx.currentTime, tau);
  };
  v.panTo = (p, tau = 0.8) => v.pan.pan.setTargetAtTime(p, ctx.currentTime, tau);
  load(url).then(buf => {
    if (v.dead) return;
    const src = v.src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const L = len || buf.duration - 0.5, d = loopStart(buf, L);
    src.loopStart = d; src.loopEnd = d + L;
    src.playbackRate.value = v.r;
    src.connect(v.gain);
    // start at a random point so layers sharing a length never phase together
    src.start(0, d + Math.random() * L);
    v.ready = true;
  }).catch(e => console.warn('[sound]', url, e.message));
  return v;
}

export function unload(v) {
  v.dead = true;
  try { v.src && v.src.stop(); } catch (e) {}
  v.gain.disconnect();
  buffers.delete(v.url);
}

/** One-shot. when: seconds from now. */
export function shot(url, bus, { gain = 1, pan = 0, when = 0, rate = 1 } = {}) {
  if (!eng.ctx || !eng.on) return;
  const ctx = eng.ctx;
  load(url).then(buf => {
    const src = ctx.createBufferSource(), g = ctx.createGain(), p = ctx.createStereoPanner();
    src.buffer = buf; src.playbackRate.value = rate;
    g.gain.value = gain; p.pan.value = pan;
    src.connect(g).connect(p).connect(eng.bus[bus]);
    src.start(ctx.currentTime + Math.max(0, when));
  }).catch(e => console.warn('[sound]', url, e.message));
}

/** Filtered-noise loop (wind), synthesised: no file to fetch. */
export function noiseLoop(bus, { type = 'bandpass', freq = 700, q = 0.7 } = {}) {
  const ctx = eng.ctx, n = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let b = 0;
    for (let i = 0; i < n; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 3; }   // soft brown-ish noise
  }
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = buf; src.loop = true;
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.value = 0;
  src.connect(f).connect(g).connect(eng.bus[bus]);
  src.start();
  const v = { gain: g, filter: f, target: 0 };
  v.level = (x, tau = 0.3) => {
    if (Math.abs(x - v.target) < 0.004) return;
    v.target = x; g.gain.setTargetAtTime(x, ctx.currentTime, tau);
  };
  return v;
}
