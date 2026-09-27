/* "Take me here": pull over, frame the venue, open the sheet — and back.
 *
 *   go(stop)  the drive rolls on to stop.s and the page scroll locks; the
 *             indicator blinks toward the shoulder while the car eases onto
 *             it (carLateral = stop.pullover.lateral) and stops; the camera
 *             blends (camShot.w 0→1) to a composed shot — the car large in
 *             the foreground, the venue building standing behind it; the
 *             sheet opens. On close everything runs backwards, the car
 *             indicates back into its lane and the scroll unlocks.
 *   Reduced motion: the sheet opens straight away.
 *
 * API: init(ctx), update(dt), go(stop) → Promise (resolves after the sheet
 *      closes and the car is back in lane), active (bool),
 *      carS / carLatExact (the car's s and lateral while the detour drives it,
 *      read by car.js), carLateral (eased lateral target), camShot ({pos, look, w} or null,
 *      read by camera.js).
 */
import * as THREE from 'three';
import { ui } from '../ui/index.js';
import { scroll } from '../core/scroll.js';
import { path } from '../core/path.js';
import { world } from '../core/world.js';
import { smoothstep, clamp } from '../core/noise.js';
import { car } from './car.js';

const RM = matchMedia('(prefers-reduced-motion: reduce)');
const wait = ms => new Promise(r => setTimeout(r, ms));
const frames = n => new Promise(r => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });

const shot = { pos: new THREE.Vector3(), look: new THREE.Vector3(), w: 0 };
let p = 0, pTarget = 0, rate = 1;   // blend progress (linear), eased into shot.w
let busy = false;

const C = new THREE.Vector3(), V = new THREE.Vector3(), d = new THREE.Vector3(), side = new THREE.Vector3();

/** Compose the shot: raised three-quarter view from behind the parked car,
 *  set in toward the road centre, looking past the car to the venue — the
 *  car reads large in the foreground and the building stands beyond it. */
function compose(stop, s) {
  const S = path.sample(s);
  path.toWorld(s, stop.pullover.lateral, C);
  C.y = path.roadY(s);
  path.toWorld(stop.venue.s, stop.venue.lateral, V);
  V.y = world.heightSL(stop.venue.s, stop.venue.lateral);
  const inward = -Math.sign(stop.pullover.lateral) || 1;     // toward the road centre
  shot.pos.copy(C).addScaledVector(S.fwd, -10.5).addScaledVector(S.right, inward * 4.6);
  shot.pos.y = C.y + 3.4;
  const g = world.heightAt(shot.pos.x, shot.pos.z) + 1.3;
  if (shot.pos.y < g) shot.pos.y = g;
  shot.look.copy(C).lerp(V, 0.3);
  shot.look.y = C.y + clamp(1.6 + (V.y - C.y) * 0.5, 1.2, 6);
}

function blendTo(target, seconds) {
  pTarget = target; rate = 1 / Math.max(0.01, seconds);
  return new Promise(r => {
    const chk = () => (Math.abs(p - pTarget) < 1e-3 ? r() : requestAnimationFrame(chk));
    chk();
  });
}

/** Drive the car itself from (sA, latA) to (sB, latB) over T seconds.
 *  mode 'in' decelerates to a stop, 'out' pulls away from rest. The lateral
 *  move happens in the middle of the run, so the car.js steering turns the
 *  nose onto the shoulder and back rather than sliding it. */
function drive(sA, sB, latA, latB, T, mode) {
  return new Promise(res => {
    const t0 = performance.now();
    const step = now => {
      const u = clamp((now - t0) / 1000 / T, 0, 1);
      const e = mode === 'in' ? 1 - (1 - u) * (1 - u) : u * u;
      detour.carS = sA + (sB - sA) * e;
      detour.carLatExact = latA + (latB - latA) * smoothstep(0.2, 0.85, e);
      if (u < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
}

async function go(stop) {
  if (busy || !stop) return;
  busy = true;
  detour.active = true;
  scroll.autoplay(false);
  try {
    if (RM.matches) {
      scroll.lock();
      try { await ui.openSheet(stop.sheet); } finally { scroll.unlock(); }
      return;
    }
    scroll.lock();
    const s0 = car.s, lat0 = car.lateral;
    const sPark = Math.max(stop.park ? stop.park.s : stop.s, s0 + 28);
    const latPark = stop.pullover.lateral;
    detour.carS = s0; detour.carLatExact = lat0;

    // indicate, roll on and pull onto the shoulder, stop
    car.indicate && car.indicate(stop.pullover.side);
    compose(stop, sPark);
    detour.camShot = shot;
    const T = clamp((sPark - s0) / 8, 3, 6);
    await Promise.all([drive(s0, sPark, lat0, latPark, T, 'in'), wait(T * 550).then(() => blendTo(1, T * 0.65))]);
    await blendTo(1, 0.5);
    car.indicate && car.indicate(null);

    await ui.openSheet(stop.sheet);

    // indicate back, pull away into the lane
    car.indicate && car.indicate(stop.pullover.side === 'left' ? 'right' : 'left');
    await wait(400);
    const sOut = sPark + 30;
    await Promise.all([blendTo(0, 2.2), drive(sPark, sOut, latPark, car.LANE, 3.4, 'out')]);
    car.indicate && car.indicate(null);
    scroll.place(sOut);
  } finally {
    detour.camShot = null; shot.w = 0; p = pTarget = 0;
    detour.carS = null; detour.carLatExact = null; detour.carLateral = null;
    scroll.unlock();
    detour.active = false;
    busy = false;
  }
}

function update(dt) {
  if (p !== pTarget) {
    const step = rate * dt;
    p = Math.abs(pTarget - p) <= step ? pTarget : p + Math.sign(pTarget - p) * step;
  }
  shot.w = smoothstep(0, 1, p);
}

export const detour = {
  active: false, carLateral: null, camShot: null, carS: null, carLatExact: null,
  init() {},
  update,
  go
};
