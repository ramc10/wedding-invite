/* DOM layer over the 3D drive. main.js calls init(ctx) once after boot and
 * update(dt, s) every frame; car/detour.js calls openSheet(id).
 *   ui/loader.js    ensō loader, runs at import (before boot reports progress)
 *   ui/overlays.js  text keyed to s, "Take me here" callouts, scroll cue
 *   ui/hud.js       guided drive ("Next: <event>"), route indicator
 *   ui/sheets.js    glass event sheets
 * API (frozen): init(ctx), update(dt, s), openSheet(id) → Promise (resolves on close) */
import './loader.js';
import { overlays } from './overlays.js';
import { hud } from './hud.js';
import { sheets } from './sheets.js';

let ready = false;

function init(ctx) {
  sheets.setup();
  overlays.init(ctx);
  hud.init(ctx);
  ready = true;
}

function update(dt, s) {
  if (!ready) return;
  overlays.update(dt, s);
  hud.update(dt, s);
}

const openSheet = id => sheets.open(id);

export const ui = { init, update, openSheet };
