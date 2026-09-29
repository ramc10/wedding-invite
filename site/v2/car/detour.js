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
 *  Distance follows smootherstep (pulls away gently, rolls to a stop — no
 *  lurch from a standstill); the lane change happens in the back half of the
 *  run. The car's yaw is the analytic slope of that planned track, so the
 *  nose turns onto the shoulder and back smoothly instead of jittering with
 *  frame timing. */
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const dss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return 6 * t * (1 - t) / (b - a); };
function drive(sA, sB, latA, latB, T, mode) {
  const [la, lb] = mode === 'in' ? [0.3, 0.95] : [0.05, 0.7];
  return new Promise(res => {
    const t0 = performance.now();
    const step = now => {
      const u = clamp((now - t0) / 1000 / T, 0, 1);
      const e = u * u * u * (u * (u * 6 - 15) + 10);           // smootherstep
      detour.carS = sA + (sB - sA) * e;
      detour.carLatExact = latA + (latB - latA) * ss(la, lb, e);
      const dLatDs = (latB - latA) * dss(la, lb, e) / Math.max(1e-3, sB - sA);
      detour.carYaw = -Math.atan(dLatDs);
      if (u < 1) requestAnimationFrame(step); else { detour.carYaw = 0; res(); }
    };
    requestAnimationFrame(step);
  });
}

/* The detour camera follows the car the whole time, from behind and set in
 * toward the road centre (the normal chase sits behind-left, which on a
 * left-hand pull-over put it inside the hedge and compound wall). As the car
 * slows, its aim drifts from the road ahead to the venue, so arrival reads as
 * one continuous move rather than a swing. */
let cur = null;                         // { stop, lookK }
const A = new THREE.Vector3(), L = new THREE.Vector3();
function follow() {
  const st = cur.stop, s = car.s, S = path.sample(s);
  const inward = -Math.sign(st.pullover.lateral) || 1;
  // pulling away (cur.out 0→1) the shot drifts onto the chase camera's own
  // spot, behind and a little left, so handing back to it moves nothing
  const o = smoothstep(0, 1, cur.out);
  shot.pos.copy(car.pos).addScaledVector(S.fwd, -10.5 + 2.9 * o).addScaledVector(S.right, inward * 4.4 * (1 - o) - 1.5 * o);
  shot.pos.y = path.roadY(s) + 3.3 - 0.6 * o;
  const g = world.heightAt(shot.pos.x, shot.pos.z) + 1.3;
  if (shot.pos.y < g) shot.pos.y = g;
  A.copy(car.pos).addScaledVector(S.fwd, 12); A.y = path.roadY(s) + 1.4;
  path.toWorld(st.venue.s, st.venue.lateral, V);
  V.y = world.heightSL(st.venue.s, st.venue.lateral);
  L.copy(car.pos).lerp(V, 0.3); L.y = path.roadY(s) + clamp(1.6 + (V.y - path.roadY(s)) * 0.5, 1.2, 6);
  shot.look.copy(A).lerp(L, smoothstep(0, 1, cur.lookK));
}
function animate(obj, key, to, seconds) {
  const from = obj[key], t0 = performance.now();
  return new Promise(res => {
    const f = now => { const u = clamp((now - t0) / 1000 / seconds, 0, 1); obj[key] = from + (to - from) * u; u < 1 ? requestAnimationFrame(f) : res(); };
    requestAnimationFrame(f);
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
    cur = { stop, lookK: 0, out: 0 };
    follow();
    detour.camShot = shot;

    // indicate, roll on and pull onto the shoulder, stop — camera eases onto
    // the follow line at once and turns toward the venue as the car slows
    car.indicate && car.indicate(stop.pullover.side);
    const T = clamp((sPark - s0) / 6, 4, 7);
    blendTo(1, 1.1);
    wait(T * 450).then(() => animate(cur, 'lookK', 1, T * 0.55 + 0.8));
    await drive(s0, sPark, lat0, latPark, T, 'in');
    await wait(900);
    car.indicate && car.indicate(null);

    await ui.openSheet(stop.sheet);

    // indicate back, pull away into the lane, hand back to the chase camera
    car.indicate && car.indicate(stop.pullover.side === 'left' ? 'right' : 'left');
    await wait(400);
    const sOut = Math.max(sPark + 30, stop.callout[1] + 4);   // rejoin past the callout, so it doesn't pop back up
    animate(cur, 'lookK', 0, 2.4);
    animate(cur, 'out', 1, 4.2);
    wait(1800).then(() => blendTo(0, 3.2));                 // hand back gradually, during the pull-away
    await drive(sPark, sOut, latPark, car.LANE, 4.2, 'out');
    car.indicate && car.indicate(null);
    scroll.place(sOut);
    await blendTo(0, 3.2);
  } finally {
    cur = null;
    detour.camShot = null; shot.w = 0; p = pTarget = 0;
    detour.carS = null; detour.carLatExact = null; detour.carLateral = null; detour.carYaw = null;
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
  if (cur) follow();
}

export const detour = {
  active: false, carLateral: null, camShot: null, carS: null, carLatExact: null, carYaw: null,
  init() {},
  update,
  go
};
