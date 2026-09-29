/* Sound for /v2/: terrain (nature.js), the car (car.js) and the venues
 * (events.js) on one engine (engine.js). Owns the ♪ toggle; off until the
 * guest taps it. main.js calls sound.update(dt, s) every frame.
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

let btn, wasOn = false;

function setOn(on) {
  eng.on = on;
  btn.textContent = on ? '❚❚' : '♪';
  btn.setAttribute('aria-label', on ? 'Mute sound' : 'Play sound');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  const ctx = eng.ctx;
  if (on) {
    ctx.resume().catch(() => {});
    eng.master.gain.setTargetAtTime(1, ctx.currentTime, 0.5);
  } else {
    eng.master.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
    setTimeout(() => { if (!eng.on) ctx.suspend(); }, 600);
  }
}

btn = document.getElementById('musicToggle');
if (btn) {
  btn.addEventListener('click', () => {
    if (!eng.ctx) start();
    setOn(!eng.on);
  });
  document.addEventListener('visibilitychange', () => {
    if (!eng.ctx) return;
    if (document.hidden) { wasOn = eng.on; if (eng.on) setOn(false); }
    else if (wasOn) { wasOn = false; setOn(true); }
  });
}

const open0 = ui.openSheet;
ui.openSheet = async id => {
  const drove = detour.active;
  events.open(id);
  if (drove) carSound.park();
  try { return await open0(id); }
  finally {
    events.close();
    if (drove) carSound.unpark();
  }
};

export const sound = {
  update(dt, s) {
    if (!eng.on) return;
    nature.update(dt, s);
    carSound.update(dt);
    events.update(dt, s);
  },
  debug: () => ({ state: eng.ctx && eng.ctx.state, on: eng.on, nature: nature.debug(), car: carSound.debug(), events: events.debug() })
};
window.__v2sound = sound;
