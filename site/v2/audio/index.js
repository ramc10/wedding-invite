/* Sound for /v2/: terrain (nature.js), the car (car.js), the venues
 * (events.js), the music bed (music.js) and ethereal one-shots (sfx.js) on one engine (engine.js). Owns
 * the ♪ toggle; off until the guest taps it. main.js calls sound.update(dt, s) every frame.
 *
 * Sheets: ui.openSheet is wrapped (detour.js calls it through the object),
 * so opening an event card rings the bell and, after "Take me here", parks
 * the car (engine off, door) and starts it again when the card closes.
 *
 * QA: window.__v2sound.debug() → what is loaded and at what level.
 */
import { ui } from '../ui/index.js';
import { detour } from '../car/detour.js';
import { eng, start } from './engine.js';
import { nature } from './nature.js';
import { carSound } from './car.js';
import { events } from './events.js';
import { music } from './music.js';
import { sfx } from './sfx.js';

let btn, wasOn = false, offT, armed = false, failed = false;

// iOS leaves the context 'interrupted' (call, Siri, lock) or suspended, and resume() outside a
// gesture can fail silently: retry on the guest's next touch while sound is meant to be on
function armResume() {
  if (armed) return;
  armed = true;
  const go = () => {
    armed = false;
    removeEventListener('pointerdown', go, true); removeEventListener('touchend', go, true);
    if (eng.on && eng.ctx.state !== 'running') eng.ctx.resume().catch(armResume);
  };
  addEventListener('pointerdown', go, true); addEventListener('touchend', go, true);
}

function setOn(on) {
  eng.on = on;
  btn.textContent = on ? '❚❚' : '♪';
  btn.setAttribute('aria-label', on ? 'Mute sound' : 'Play sound');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  const ctx = eng.ctx;
  clearTimeout(offT);   // a stale suspend from an earlier off must not cut a later fade
  if (on) {
    ctx.resume().catch(armResume);
    eng.master.gain.setTargetAtTime(1, ctx.currentTime, 0.9);   // a slow, soft start
  } else {
    eng.master.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
    offT = setTimeout(() => { if (!eng.on) ctx.suspend(); }, 600);
  }
}

btn = document.getElementById('musicToggle');
if (btn) {
  btn.addEventListener('click', () => {
    if (!eng.ctx) {
      start();
      eng.ctx.onstatechange = () => { if (eng.on && eng.ctx.state !== 'running') armResume(); };
    }
    setOn(!eng.on);
    if (eng.on) sfx.start();   // the first unmute only (sfx.js keeps the flag)
  });
  document.addEventListener('visibilitychange', () => {
    if (!eng.ctx) return;
    // only record while on: a second hidden event must not overwrite wasOn with false
    if (document.hidden) { if (eng.on) { wasOn = true; setOn(false); } }
    else if (wasOn) { wasOn = false; setOn(true); }
  });
}

const open0 = ui.openSheet;
ui.openSheet = async id => {
  // carS is only set on the route path: reduced motion / no route opens the sheet without a drive
  const drove = detour.active && detour.carS != null;
  events.open(id); music.open(id); sfx.open();
  if (drove) carSound.park();
  try { return await open0(id); }
  finally {
    events.close(); music.close();
    if (drove) carSound.unpark();
  }
};

export const sound = {
  update(dt, s) {
    if (!eng.on) return;
    // an audio error must never throw into main.js's frame (the picture would freeze): log once, go quiet
    try { nature.update(dt, s); carSound.update(dt); events.update(dt, s); music.update(dt, s); sfx.update(dt, s); }
    catch (e) { if (!failed) console.warn('[sound] off', e); failed = true; setOn(false); btn.hidden = true; }
  },
  debug: () => ({ state: eng.ctx && eng.ctx.state, on: eng.on, nature: nature.debug(), car: carSound.debug(), events: events.debug(), music: music.debug(), sfx: sfx.debug() })
};
window.__v2sound = sound;
