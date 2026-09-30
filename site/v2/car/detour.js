/* "Take me here": drive into the venue, open the sheet, and drive back out.
 *
 *   go(stop)  the page scroll locks and the car drives itself along the
 *             stop's route (core/timeline.js STOPS[].route): off the road,
 *             through the gate into the venue's court or forecourt, round to
 *             a stop at the entrance. Meanwhile the camera glides once to a
 *             raised, fixed viewpoint beside the entrance (stop.cam) and only
 *             pans, gently, to keep the car and the venue in frame; it never
 *             chases the car round the turns. The sheet opens. On close the
 *             car drives the out route back onto the road, and the camera
 *             glides back to the chase as it goes.
 *   Reduced motion: the sheet opens straight away.
 *
 * API: init(ctx), update(dt), go(stop) → Promise (resolves after the sheet
 *      closes and the car is back in lane), active (bool),
 *      carS / carLatExact / carYaw (the car's s, lateral and yaw off the road
 *      heading while the detour drives it, read by car.js), camShot
 *      ({pos, look, w} or null, read by camera.js).
 */
import * as THREE from 'three';
import { ui } from '../ui/index.js';
import { scroll } from '../core/scroll.js';
import { path } from '../core/path.js';
import { world } from '../core/world.js';
import { smoothstep, clamp, damp } from '../core/noise.js';
import { car } from './car.js';

const RM = matchMedia('(prefers-reduced-motion: reduce)');
const wait = ms => new Promise(r => setTimeout(r, ms));
const frames = n => new Promise(r => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });

const shot = { pos: new THREE.Vector3(), look: new THREE.Vector3(), w: 0 };
let p = 0, pTarget = 0, rate = 1;   // blend progress (linear), eased into shot.w
let busy = false, camObj = null;

function blendTo(target, seconds) {
  pTarget = target; rate = 1 / Math.max(0.01, seconds);
  return new Promise(r => {
    const chk = () => (Math.abs(p - pTarget) < 1e-3 ? r() : requestAnimationFrame(chk));
    chk();
  });
}

function animate(obj, key, to, seconds) {
  const from = obj[key], t0 = performance.now();
  return new Promise(res => {
    const f = now => { const u = clamp((now - t0) / 1000 / seconds, 0, 1); obj[key] = from + (to - from) * u; u < 1 ? requestAnimationFrame(f) : res(); };
    requestAnimationFrame(f);
  });
}

/* Route driving: a centripetal Catmull-Rom through [s, lateral] waypoints
 * (x = s, z = lateral), run by arc length with smootherstep timing (pulls
 * away gently, rolls to a stop). The car's yaw is the curve's own tangent,
 * so it steers through the turns instead of sliding. */
const routeCurve = pts => new THREE.CatmullRomCurve3(pts.map(([s, l]) => new THREE.Vector3(s, 0, l)), false, 'centripetal');
const RP = new THREE.Vector3(), RT = new THREE.Vector3(), RQ = new THREE.Vector3();
function driveRoute(curve, T) {
  return new Promise(res => {
    const t0 = performance.now();
    const step = now => {
      const u = clamp((now - t0) / 1000 / T, 0, 1);
      const e = u * u * u * (u * (u * 6 - 15) + 10);           // smootherstep
      curve.getPointAt(e, RP);
      // heading from a 3 m chord round the car, not the curve's exact tangent: the spline through
      // 1 m route points ripples between them, and the car's nose wiggled with it
      const L = curve.getLength(), d = Math.min(1.5 / L, 0.5);
      curve.getPointAt(Math.max(0, e - d), RT); RQ.copy(RT); curve.getPointAt(Math.min(1, e + d), RT); RT.sub(RQ);
      detour.carS = RP.x; detour.carLatExact = RP.z;
      detour.carYaw = -Math.atan2(RT.z, RT.x);
      u < 1 ? requestAnimationFrame(step) : res();
    };
    requestAnimationFrame(step);
  });
}

/* The crane: a raised viewpoint beside the venue's entrance. The shot starts
 * exactly where the chase camera is and glides (cur.u 0→1, eased) to the
 * crane while the car turns in; on the way out it glides to exactly where the
 * chase camera will be behind the car in its lane, so neither handover moves
 * anything. The aim is damped, between the car and the venue (lookK draws it
 * onto the venue once parked, outK onto the chase's own aim at the end): it
 * pans; nothing orbits. */
let cur = null;                         // { stop, lookK, outK, u, from, to, fresh }
const CAM = new THREE.Vector3(), FOC = new THREE.Vector3(), AIM = new THREE.Vector3(), CH = new THREE.Vector3();
const _smp = path.sample(0);
function aimCrane(st) {
  path.toWorld(st.cam.s, st.cam.lateral, CAM);
  CAM.y = Math.max(path.roadY(st.cam.s) + st.cam.h, world.heightAt(CAM.x, CAM.z) + 1.5);
  path.toWorld(st.focus.s, st.focus.lateral, FOC);
  FOC.y = path.roadY(st.focus.s) + st.focus.h;
}
/** where the chase camera sits (and looks) with the car in lane at s */
function chaseSpot(s, out, look) {
  path.sample(s, _smp);
  path.toWorld(s - 7.5, car.LANE - 1.5, out); out.y = path.roadY(s) + 2.7;
  if (look) { path.toWorld(s + 7, car.LANE, look); look.y = path.roadY(s) + 1.05; }
}
/* The camera path is planned in road coordinates {s, l, h} (along the road, lateral, height above it),
 * then placed with path.toWorld, which is continuous. Going in it glides from where the chase camera
 * was to the crane; coming out, from the crane to a point that follows the car (7.5 m behind it, just
 * road-side of it, chase height), ending exactly on the chase camera's own spot. Two rules shape it:
 *  - it stays at least 7.5 m behind the car along the road (eased in, never a hard stop);
 *  - alongside a beach venue's deck (stop.keepOut) it stays on the road side of the deck line, so it
 *    never sweeps through the tent, poles and lights (it did, straight-line gliding out: the "shake"). */
const RC = { s: 0, l: 0, h: 0 };
function crane(dt) {
  const A = cur.fromRC, st = cur.stop;
  if (!cur.out) {
    const e = smoothstep(0, 1, cur.u), B = cur.toRC;
    RC.s = A.s + (B.s - A.s) * e; RC.l = A.l + (B.l - A.l) * e;
    RC.h = A.h + (B.h - A.h) * e + Math.sin(Math.PI * e) * 2;   // a gentle arc over roadside trees mid-glide
  } else {
    // out: first rise and drift out over the road while still beside the drop-off (P1), then come
    // down behind the car along the road (B, which ends exactly on the chase camera's spot). The
    // camera never passes back over the venue, its canopy, poles or lights.
    const P1 = { s: A.s + 3, l: 1.2, h: 6.2 }, B = { s: car.s - 7.5, l: Math.min(car.lateral, car.LANE) - 1.5, h: 2.7 };
    const e1 = smoothstep(0, 0.45, cur.u), e2 = smoothstep(0.35, 1, cur.u);
    const s1 = A.s + (P1.s - A.s) * e1, l1 = A.l + (P1.l - A.l) * e1, h1 = A.h + (P1.h - A.h) * e1;
    RC.s = s1 + (B.s - s1) * e2; RC.l = l1 + (B.l - l1) * e2; RC.h = h1 + (B.h - h1) * e2;
  }
  const over = RC.s - (car.s - 7.5);
  if (over > -2) RC.s -= over > 0 ? over + 1 : (over + 2) * (over + 2) / 4;
  if (st.keepOut) {
    const w = smoothstep(st.keepOut.s0 - 8, st.keepOut.s0, RC.s);
    if (RC.l < st.keepOut.l) RC.l += (st.keepOut.l - RC.l) * w;
  }
  path.toWorld(RC.s, RC.l, shot.pos);
  shot.pos.y = Math.max(path.roadY(RC.s) + RC.h, world.heightAt(shot.pos.x, shot.pos.z) + 1.2);
  AIM.copy(car.pos); AIM.y += 1.2;
  AIM.lerp(FOC, 0.35 + 0.45 * smoothstep(0, 1, cur.lookK));
  if (cur.outK > 0) { chaseSpot(car.s, CH, FOC2); AIM.lerp(FOC2, smoothstep(0, 1, cur.outK)); }
  if (cur.fresh) { cur.fresh = false; } else shot.look.lerp(AIM, damp(2.4, dt));
}
/** a world position in road coordinates (used once per glide, never per frame) */
function toRC(v) { const n = path.nearest(v.x, v.z); return { s: n.s, l: n.lateral, h: v.y - path.roadY(n.s) }; }
const FOC2 = new THREE.Vector3();

async function go(stop) {
  if (busy || !stop) return;
  busy = true;
  detour.active = true;
  scroll.autoplay(false);
  try {
    if (RM.matches || !stop.route) {
      scroll.lock();
      try { await ui.openSheet(stop.sheet); } finally { scroll.unlock(); }
      return;
    }
    scroll.lock();
    const s0 = car.s, lat0 = car.lateral;
    const inPts = [[s0, lat0], ...stop.route.in.filter(([s]) => s > s0 + 3)];
    const cin = routeCurve(inPts), cout = routeCurve(stop.route.out);
    detour.carS = s0; detour.carLatExact = lat0; detour.carYaw = 0;
    detour.carGround = stop.ground || null;
    aimCrane(stop);
    // start the shot exactly on the chase camera, so taking over moves nothing
    cur = { stop, lookK: 0, outK: 0, u: 0, out: false, fresh: true,
      fromRC: toRC(camObj.position), toRC: { s: stop.cam.s, l: stop.cam.lateral, h: CAM.y - path.roadY(stop.cam.s) } };
    shot.look.copy(camObj.position).add(camObj.getWorldDirection(AIM).multiplyScalar(20));
    shot.pos.copy(camObj.position);
    p = pTarget = 1; shot.w = 1;
    detour.camShot = shot;

    // indicate and drive in; the camera glides up to the crane as the car goes
    car.indicate && car.indicate(stop.pullover.side);
    const Tin = clamp(cin.getLength() / 7, 5, 11);
    wait(Tin * 180).then(() => animate(cur, 'u', 1, Tin * 0.82));   // let the car pull away first
    wait(Tin * 600).then(() => animate(cur, 'lookK', 1, Tin * 0.4 + 1));
    await driveRoute(cin, Tin);
    car.indicate && car.indicate(null);
    await wait(900);

    await ui.openSheet(stop.sheet);

    // indicate, drive back out onto the road; hand back to the chase on the way
    car.indicate && car.indicate(stop.pullover.side === 'left' ? 'right' : 'left');
    await wait(400);
    const Tout = clamp(cout.getLength() / 6.5, 5, 9);
    const sOut = stop.route.out[stop.route.out.length - 1][0];
    // glide from the crane to the chase camera's own spot behind the car in its lane
    cur.fromRC = { ...cur.toRC }; cur.out = true; cur.u = 0;
    animate(cur, 'lookK', 0, Tout * 0.5);
    wait(Tout * 250).then(() => animate(cur, 'u', 1, Tout * 0.75));
    wait(Tout * 350).then(() => animate(cur, 'outK', 1, Tout * 0.65));
    wait(Tout * 700).then(() => car.indicate && car.indicate(null));
    await driveRoute(cout, Tout);
    scroll.place(sOut);
    detour.carYaw = 0;
    await wait(250);
    await blendTo(0, 0.9);
  } finally {
    cur = null;
    detour.camShot = null; shot.w = 0; p = pTarget = 0;
    detour.carS = null; detour.carLatExact = null; detour.carLateral = null; detour.carYaw = null; detour.carGround = null;
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
  if (cur) crane(dt);
}

export const detour = {
  active: false, carLateral: null, camShot: null, carS: null, carLatExact: null, carYaw: null, carGround: null,
  init(ctx) { camObj = ctx.camera; },
  update,
  go
};
