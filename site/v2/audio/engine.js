/* The sound engine: one AudioContext, four buses into a gentle master
 * compressor, buffer loading, seamless loops and one-shots.
 *
 *   buses: nature (terrain beds), car (engine, road, indicators, doors),
 *          events (venue ambiences, chime), music (the bed), sfx (one-shots), each with its own gain; the
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
  // iOS: play through the ring/silent switch like a video would (set before the context exists)
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  // phones: decode at 32 kHz — a minute of stereo is 15 MB instead of 21 MB
  let ctx;
  try { ctx = new AC(quality.mobile ? { sampleRate: 32000 } : undefined); } catch (e) { ctx = new AC(); }
  eng.ctx = ctx;
  // master: a -2 dB air shelf at 6 kHz, a gentle glue compressor (2:1, slow release so it breathes
  // rather than pumps), then a fast 20:1 catch at -3 dB so nothing spikes
  const air = ctx.createBiquadFilter();
  air.type = 'highshelf'; air.frequency.value = 6000; air.gain.value = -2;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.knee.value = 18; comp.ratio.value = 2;
  comp.attack.value = 0.02; comp.release.value = 0.6;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20;
  lim.attack.value = 0.002; lim.release.value = 0.1;
  eng.master = ctx.createGain();
  eng.master.gain.value = 0;
  eng.master.connect(air).connect(comp).connect(lim).connect(ctx.destination);
  // a shared soft room: music, venues and the bell send into it (not the car or the terrain,
  // which would only smear). Pre-delay 20 ms keeps the dry attack clear; the IR is built once.
  const pre = ctx.createDelay(0.1), verb = ctx.createConvolver();
  pre.delayTime.value = 0.02;
  verb.buffer = roomIR(ctx, 1.8);
  pre.connect(verb).connect(eng.master);
  const send = (node, amt) => { const g = ctx.createGain(); g.gain.value = amt; node.connect(g).connect(pre); };
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
  // the terrain beds (birds, crickets, surf hiss) are bright: shelve off the top so they sit back
  const hiShelf = ctx.createBiquadFilter(), hiCut = ctx.createBiquadFilter();
  hiShelf.type = 'highshelf'; hiShelf.frequency.value = 3500; hiShelf.gain.value = -6;
  hiCut.type = 'lowpass'; hiCut.frequency.value = 9000; hiCut.Q.value = 0.5;
  hiShelf.connect(hiCut).connect(bgEq);
  // car at 0.525: the owner took it 25% down, then 30% more (2026-10-01); it kept covering the music
  for (const [k, v] of Object.entries({ nature: 0.9, car: 0.525, events: 0.8 })) {
    const g = eng.bus[k] = ctx.createGain();
    g.gain.value = v;
    g.connect(k === 'car' ? shelf : k === 'nature' ? hiShelf : bgEq);
  }
  // the music bed (music.js): its own soft top, straight to the master so neither the engine-band
  // carve nor the terrain treble cut touch it
  const mLp = ctx.createBiquadFilter();
  mLp.type = 'lowpass'; mLp.frequency.value = 7000; mLp.Q.value = 0.5;
  mLp.connect(eng.master);
  eng.bus.music = ctx.createGain();
  eng.bus.music.gain.value = 0.6;
  eng.bus.music.connect(mLp);
  // the venue bell: straight to the master, never ducked or carved
  eng.bus.chime = ctx.createGain();
  eng.bus.chime.connect(eng.master);
  // reverb sends (normalised IR): music a touch wetter than the venues; events sends pre-duck-EQ
  send(mLp, 0.2); send(eng.bus.events, 0.15); send(eng.bus.chime, 0.18);
  // the ethereal one-shots (sfx.js): straight to the master, never ducked or carved, a little room
  eng.bus.sfx = ctx.createGain();
  eng.bus.sfx.gain.value = 0.35;   // measured: at 0.7 the bloom landed level with Muhurtham; -6 dB keeps them under the music
  eng.bus.sfx.connect(eng.master);
  send(eng.bus.sfx, 0.12);
}

// stereo decaying noise, -60 dB at len s; a one-pole lowpass closes over the tail so it goes dark
function roomIR(ctx, len) {
  const sr = ctx.sampleRate, n = Math.round(len * sr), buf = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, a = Math.min(0.6, 2 * Math.PI * (5000 - 3800 * t / len) / sr);
      y += a * ((Math.random() * 2 - 1) - y);
      d[i] = y * Math.exp(-6.9 * t / len) * Math.min(1, i / (0.005 * sr));
    }
  }
  return buf;
}

// iOS < 14.1 has no StereoPannerNode: fall back to a plain gain (no pan) so voices still play
function panner(ctx) {
  if (ctx.createStereoPanner) return ctx.createStereoPanner();
  const g = ctx.createGain(); g.pan = { value: 0, setTargetAtTime() {} }; return g;
}

export function load(url) {
  if (!buffers.has(url)) {
    const p = fetch(BASE + url)
      .then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.arrayBuffer(); })
      .then(b => new Promise((ok, no) => eng.ctx.decodeAudioData(b, ok, no)));
    // a stale failure (after unload + reload) must not evict the newer promise
    p.catch(() => { if (buffers.get(url) === p) buffers.delete(url); });
    buffers.set(url, p);
  }
  return buffers.get(url);
}

// loop offsets survive buffers.delete, so a layer that streams back in skips the search
const seams = new Map();   // url|len → seconds
function loopStart(buf, len, url) {
  const key = url + '|' + len;
  if (seams.has(key)) return seams.get(key);
  const ch = buf.getChannelData(0), n = Math.round(len * buf.sampleRate), N = 1024;
  let d = 0, best = Infinity;
  for (let o = 0; o < Math.min(Math.round(0.1 * buf.sampleRate), ch.length - n - N); o++) {
    let e = 0;
    for (let i = 0; i < N; i += 2) { const q = ch[o + i] - ch[o + n + i]; e += q * q; }
    if (e < best) { best = e; d = o; }
  }
  seams.set(key, d / buf.sampleRate);
  return d / buf.sampleRate;
}

/** A looping voice. It exists (silent) at once and starts sounding when its buffer is in. */
export function loop(url, bus, { len, pan = 0 } = {}) {
  const ctx = eng.ctx;
  const v = { url, gain: ctx.createGain(), pan: panner(ctx), src: null, ready: false, dead: false, target: 0, r: 1, p: pan };
  v.gain.gain.value = 0;
  v.pan.pan.value = pan;
  v.gain.connect(v.pan).connect(eng.bus[bus]);
  v.level = (x, tau = 0.6) => {
    if (Math.abs(x - v.target) < 0.004) return;
    v.target = x;
    if (v.ready) v.gain.gain.setTargetAtTime(x, ctx.currentTime, tau);
  };
  v.rate = (r, tau = 0.12) => {
    if (Math.abs(r - v.r) < 0.003) return;
    v.r = r;
    if (v.src) v.src.playbackRate.setTargetAtTime(r, ctx.currentTime, tau);
  };
  v.panTo = (p, tau = 0.8) => {
    if (Math.abs(p - v.p) < 0.01) return;
    v.p = p; v.pan.pan.setTargetAtTime(p, ctx.currentTime, tau);
  };
  load(url).then(buf => {
    if (v.dead) return;
    const src = v.src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const L = len || buf.duration - 0.5, d = loopStart(buf, L, url);
    src.loopStart = d; src.loopEnd = d + L;
    src.playbackRate.value = v.r;
    src.connect(v.gain);
    // start at a random point so layers sharing a length never phase together
    src.start(0, d + Math.random() * L);
    v.ready = true;
    // a late buffer fades in from 0 to wherever level() has got to meanwhile (no hard onset)
    const g = v.gain.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(0, t); g.setTargetAtTime(v.target, t, 0.6);
  }).catch(e => console.warn('[sound]', url, e && e.message));
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
    const src = ctx.createBufferSource(), g = ctx.createGain(), p = panner(ctx);
    src.buffer = buf; src.playbackRate.value = rate;
    g.gain.value = gain; p.pan.value = pan;
    src.connect(g).connect(p).connect(eng.bus[bus]);
    src.start(ctx.currentTime + Math.max(0, when));
  }).catch(e => console.warn('[sound]', url, e && e.message));
}

/** Filtered-noise loop (wind), synthesised: no file to fetch. */
export function noiseLoop(bus, { type = 'bandpass', freq = 700, q = 0.7 } = {}) {
  const ctx = eng.ctx, n = ctx.sampleRate * 8, m = 4096;
  const buf = ctx.createBuffer(2, n, ctx.sampleRate), x = new Float32Array(n + m);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let b = 0;
    // soft brown-ish noise; the filter warms up first so it doesn't start from 0
    for (let i = -2000; i < n + m; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); if (i >= 0) x[i] = b * 3; }
    // seamless wrap: the extra m samples past the end crossfade into the head (equal power)
    for (let i = 0; i < n; i++) {
      if (i < m) { const a = (i + 0.5) / m; d[i] = x[i] * Math.sin(a * Math.PI / 2) + x[n + i] * Math.cos(a * Math.PI / 2); }
      else d[i] = x[i];
    }
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
