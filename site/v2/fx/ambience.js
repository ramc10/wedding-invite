/* Sound of the drive: seamless nature loops (audio/amb/*.mp3) mixed by where
 * the car is, plus the old music loop as a faint bed under them. Replaces the
 * root site's audio.js on /v2/ and owns the same ♪ toggle.
 *
 * Nothing is fetched until the first tap on the toggle (no autoplay, no weight
 * on first load). Each layer's level is a weighted sum over core/zones.js
 * weightsAt(s), so layers cross-fade exactly where the scenery does.
 */
import { weightsAt, ZONES } from '../core/zones.js';

const BASE = new URL('../../audio/', import.meta.url).href;

// per-layer level in each zone (zone ids from core/zones.js; missing = 0)
const LAYERS = {
  waves: { src: 'amb/waves.mp3', len: 60, vol: 0.55, zones: { 'garden-beach': 1, cove: 1, dam: 0.15 } },
  birds: { src: 'amb/birds.mp3', len: 60, vol: 0.45, zones: { forest: 1, garden: 1, 'garden-beach': 0.3, cove: 0.25, hills: 0.9, dam: 0.6, creek: 0.5 } }
};
const MUSIC_VOL = 0.05;   // the old loop, well under the nature sound; 0 = nature only
const TAU = 0.8;          // seconds: how slowly levels follow the car

let ctx, master, music, musicGain, isOn = false, started = false, wasOn = false;
const layers = [];

function levelAt(layer, w) {
  let v = 0;
  ZONES.forEach((z, i) => { v += w[i] * (layer.zones[z.id] || 0); });
  return v * layer.vol;
}

async function loadLayer(key) {
  const L = LAYERS[key];
  const buf = await fetch(BASE + L.src).then(r => r.arrayBuffer()).then(b => new Promise((ok, no) => ctx.decodeAudioData(b, ok, no)));
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(master);
  // Each file is the loop (len s) plus its first 0.5 s again. MP3 decoders may
  // or may not strip the encoder's lead-in silence, so find where the loop
  // really starts: the offset d whose samples repeat len s later.
  const ch = buf.getChannelData(0), n = Math.round(L.len * buf.sampleRate), N = 1024;
  let d = 0, best = Infinity;
  for (let o = 0; o < Math.min(4096, ch.length - n - N); o++) {
    let e = 0;
    for (let i = 0; i < N; i += 2) { const q = ch[o + i] - ch[o + n + i]; e += q * q; }
    if (e < best) { best = e; d = o; }
  }
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  src.loopStart = d / buf.sampleRate;
  src.loopEnd = (d + n) / buf.sampleRate;
  src.connect(gain);
  src.start(0, src.loopStart);
  layers.push({ ...L, gain, last: -1 });
}

function start() {
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  music = document.getElementById('bg-audio');
  if (music && MUSIC_VOL > 0) {
    musicGain = ctx.createGain();
    musicGain.gain.value = MUSIC_VOL;
    ctx.createMediaElementSource(music).connect(musicGain).connect(master);
  }
  Object.keys(LAYERS).forEach(k => loadLayer(k).catch(e => console.warn('[ambience]', k, e)));
  started = true;
}

async function setOn(on) {
  isOn = on;
  updateButton();
  if (on) {
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} }
    if (musicGain) music.play().catch(() => {});
    master.gain.setTargetAtTime(1, ctx.currentTime, 0.6);
  } else {
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    setTimeout(() => {
      if (isOn) return;
      if (musicGain) music.pause();
      ctx.suspend();
    }, 500);
  }
}

let btn;
function updateButton() {
  btn.textContent = isOn ? '❚❚' : '♪';
  btn.setAttribute('aria-label', isOn ? 'Pause sound' : 'Play sound');
  btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
}

function init() {
  btn = document.getElementById('musicToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!started) start();
    setOn(!isOn);
  });
  document.addEventListener('visibilitychange', () => {
    if (!started) return;
    if (document.hidden) { wasOn = isOn; if (isOn) setOn(false); }
    else if (wasOn) { wasOn = false; setOn(true); }
  });
}
init();

export const ambience = {
  update(dt, s) {
    if (!started || !isOn) return;
    const w = weightsAt(s);
    for (const l of layers) {
      const v = levelAt(l, w);
      if (Math.abs(v - l.last) < 0.005) continue;
      l.last = v;
      l.gain.gain.setTargetAtTime(v, ctx.currentTime, TAU);
    }
  }
};
