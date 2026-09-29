/* The camera, valley-style. Three authored rigs blended by s, all expressed
 * as the same few numbers around the car so blends orbit instead of cutting
 * through the bodywork:
 *   yaw   angle round the car from dead-behind (+ = towards its left side)
 *   dist  metres from the car, horizontally
 *   h     eye height above the car
 *   lookH / lookF  aim point: height above, metres ahead of the car
 *
 *   title  (s ≈ 0–40)   parked car, slow sway + push-in from the rear-left three-quarter
 *                        three-quarter, aimed high so the car sits in the
 *                        lower third and the title owns the top.
 *   chase                behind, left and high; pulls back and widens a
 *                        touch with speed, looks ahead into curves.
 *   ending (≈ END_S)     the car parks, the camera cranes up and back and
 *                        tilts to the dusk sky.
 *
 * Drag to look: mouse drags with pointer capture (yaw + pitch); touch only
 * steers yaw on horizontal drags (#scene is touch-action: pan-y, so vertical
 * swipes stay native page scroll). Eases back after a few idle seconds, with a
 * gentle idle drift. Never below world.heightAt + clearance.
 * detour.camShot {pos, look, w} blends in an authored shot (w 0→1).
 * scroll.cut snaps. prefers-reduced-motion: no orbit, drift or FOV breathing.
 *
 * API: init(ctx), update(dt). The car agent owns this file.
 */
import * as THREE from 'three';
import { car } from './car.js';
import { detour } from './detour.js';
import { world } from '../core/world.js';
import { path } from '../core/path.js';
import { END_S, STOPS } from '../core/timeline.js';
import { damp, clamp, smoothstep, lerp } from '../core/noise.js';
import { scroll } from '../core/scroll.js';

const RM = matchMedia('(prefers-reduced-motion: reduce)');

const CHASE = { yaw: 0.2, dist: 7.6, h: 2.7, lookH: 1.05, lookF: 7 };
// rear three-quarter, looking down the road ahead: the first frame is the
// car and the tree-lined road it's about to drive, never the empty ground
// behind where the road begins
const TITLE = { yaw: 0.38, dist: 12, h: 3.4, lookH: 1.3, lookF: 10 };
// crane up and back, but keep the parked car small in the lower frame with
// the road running on into the dusk above it
const END = { yaw: 0.45, dist: 18, h: 6, lookH: 2, lookF: 55 };
const FOV = 46;

let camera, first = true, time = 0;
const user = { yaw: 0, pitch: 0 };        // drag offsets (targets)
const userC = { yaw: 0, pitch: 0 };       // eased
let idle = 99, drag = null;

const eye = new THREE.Vector3(), lookC = new THREE.Vector3();
const want = new THREE.Vector3(), look = new THREE.Vector3();
const offE = new THREE.Vector3(), offL = new THREE.Vector3();
const back = new THREE.Vector3(), left = new THREE.Vector3(), tmp = new THREE.Vector3();
const S = path.sample(0), SA = path.sample(0);
let vS = 0, curvS = 0, pushIn = 0;
// Event focus: approaching a venue, the chase turns its head toward the set
// (a small shift to the far side of the car, and the aim drawn toward the
// set). The aim point always stays ahead of the car, sliding along the road
// with it, and the focus has faded out by the time the set is alongside, so
// the camera never swings round to look back as the car drives on.
let focusW = 0, focusLat = 0, focusVs = 0;
const focusV = new THREE.Vector3();
function focusAt(s) {
  let w = 0, st = null;
  for (const x of STOPS) {
    const vs = x.venue.s;
    const k = smoothstep(vs - 130, vs - 70, s) * (1 - smoothstep(vs - 25, vs + 5, s));
    if (k > w) { w = k; st = x; }
  }
  return { w, st };
}

/* Hold to look around. Mouse: press and drag, any direction, orbits the
 * car (nearly all the way round) and tilts. Touch: a quick swipe still
 * scrolls the drive; press and hold still for ~0.25 s first, and the drag
 * orbits instead (the page is kept from scrolling while it does). */
const HOLD_MS = 250, YAW_MAX = 2.8, P_MIN = -0.2, P_MAX = 0.85;
function lookBy(dx, dy) {
  const k = 1 / Math.max(320, innerWidth * 0.5);
  user.yaw = clamp(user.yaw - dx * k * 2.6, -YAW_MAX, YAW_MAX);
  user.pitch = clamp(user.pitch + dy * k * 1.4, P_MIN, P_MAX);
  idle = 0;
}
function init(ctx) {
  camera = ctx.camera;
  const el = ctx.renderer.domElement;
  el.classList.add('lookable');
  // mouse / pen: pointer capture, drag orbits straight away
  el.addEventListener('pointerdown', e => {
    if (detour.active || e.pointerType === 'touch' || e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    el.classList.add('looking');
  });
  el.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id || drag.touch) return;
    lookBy(e.clientX - drag.x, e.clientY - drag.y);
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const end = e => { if (drag && !drag.touch && e.pointerId === drag.id) { drag = null; idle = 0; el.classList.remove('looking'); } };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
  // touch: hold still, then drag to look; move first and it's an ordinary scroll
  let t = null;
  el.addEventListener('touchstart', e => {
    if (detour.active || e.touches.length !== 1) { t = null; return; }
    const p = e.touches[0];
    t = { x: p.clientX, y: p.clientY, x0: p.clientX, y0: p.clientY, t0: performance.now(), on: false };
    t.timer = setTimeout(() => { if (t) { t.on = true; drag = { touch: true }; idle = 0; if (navigator.vibrate) navigator.vibrate(8); } }, HOLD_MS);
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!t) return;
    const p = e.touches[0];
    if (!t.on) {
      if (Math.hypot(p.clientX - t.x0, p.clientY - t.y0) > 10) { clearTimeout(t.timer); t = null; }   // a swipe: let it scroll
      return;
    }
    e.preventDefault();                      // looking: keep the page (and so the car) still
    lookBy(p.clientX - t.x, p.clientY - t.y);
    t.x = p.clientX; t.y = p.clientY;
  }, { passive: false });
  const tend = () => { if (t) { clearTimeout(t.timer); if (t.on) { drag = null; idle = 0; } t = null; } };
  el.addEventListener('touchend', tend);
  el.addEventListener('touchcancel', tend);
}

// weights of the authored rigs at s
const titleW = s => 1 - smoothstep(12, 70, s);
const endW = s => smoothstep(END_S - 90, END_S - 4, s);

function update(dt) {
  if (!camera) return;
  const rm = RM.matches;
  time += dt;
  idle += dt;
  // where the car actually is: during a detour the page scroll is frozen
  // behind it, and following that jumped the view when the detour ended
  const s = detour.carS != null ? detour.carS : scroll.s;

  // drag offsets ease home after a few idle seconds
  if (!drag && idle > 5) {
    const k = damp(0.7, dt);
    user.yaw -= user.yaw * k; user.pitch -= user.pitch * k;
  }
  userC.yaw += (user.yaw - userC.yaw) * damp(5, dt);
  userC.pitch += (user.pitch - userC.pitch) * damp(5, dt);

  // speed and curvature, smoothed (they're noisy frame to frame)
  vS += (Math.abs(car.speed) - vS) * damp(2, dt);
  path.sample(clamp(s + 18, 0, path.length), SA);
  curvS += (SA.curvature - curvS) * damp(1.5, dt);
  const sp = clamp(vS / 30, 0, 1);

  const wT = titleW(s), wE = endW(s), wC = Math.max(0, 1 - wT - wE);
  // portrait phones: a fixed vertical FOV leaves ~22deg across and crops the
  // car, so widen and pull back as the viewport narrows (0 at aspect >= 1).
  // Chase only: the title shot already fits, and wider shows the sky's edge.
  const narrow = clamp((1 - camera.aspect) / 0.55, 0, 1) * (1 - wT);
  // the title push-in runs on the clock while parked; scrolling finishes it
  pushIn = rm ? 1 : Math.min(1, pushIn + dt / 14);
  const pe = 1 - Math.pow(1 - pushIn, 3);
  // bounded orbit: a slow sway round the three-quarter, never wandering off
  // into the trees however long the title sits
  const orbit = rm ? 0 : Math.sin(time * 0.045) * 0.15 + Math.sin(time * 0.017 + 1.1) * 0.05;
  // portrait phones: a narrow frame can't hold a wide three-quarter, so come
  // round closer to straight behind and stand further back
  const port = clamp((1 - camera.aspect) / 0.55, 0, 1);
  const tYaw = (TITLE.yaw + orbit - (1 - pe) * 0.35) * (1 - 0.6 * port);
  const tDist = lerp(TITLE.dist + 1.5, TITLE.dist, pe) * (1 + 0.45 * port);

  // focus weight eases in and out slowly; side and lateral are held from the
  // last venue so nothing flips while it fades
  const F = focusAt(s);
  if (F.st && F.w > 0.001) { focusLat = F.st.venue.lateral * 0.8; focusVs = F.st.venue.s; }
  focusW += (F.w - focusW) * damp(0.9, dt);
  const fk = focusW * wC * (rm ? 0.6 : 1);
  if (fk > 0.001) {
    const as = clamp(Math.max(focusVs, s + 24), 0, path.length);   // never behind the car
    path.toWorld(as, focusLat, focusV); focusV.y = path.roadY(as) + 1.6;
  }

  const drift = rm || idle < 5 ? 0 : Math.sin(time * 0.21) * 0.05;
  const driftH = rm || idle < 5 ? 0 : Math.sin(time * 0.17 + 1) * 0.12;

  // venue on the left → camera round to behind-right (negative yaw), and the mirror for the right
  const yaw = wT * tYaw + wC * (CHASE.yaw - curvS * 6 + drift) + wE * END.yaw + userC.yaw;
  const dist = (wT * tDist + wC * (CHASE.dist + sp * 1.4) + wE * END.dist) * (1 + narrow * 0.3) + fk * 0.6;
  let h = wT * TITLE.h + wC * (CHASE.h + sp * 0.3 + driftH) + wE * END.h;
  h += userC.pitch * dist * 0.9;
  // swung round to the side or front: a little higher, and (below) allowed a few metres further
  // off the road than the chase, so the car doesn't fill the frame
  const roundK = smoothstep(0.5, 1.6, Math.abs(userC.yaw));
  h += roundK * 0.9;
  const lookH = wT * TITLE.lookH + wC * CHASE.lookH + wE * END.lookH;
  const lookF = wT * TITLE.lookF + wC * (CHASE.lookF + sp * 3) + wE * END.lookF;

  // car frame: behind = -fwd, left = -right
  const f = car.fwd;
  back.copy(f).negate();
  left.set(f.z, 0, -f.x);          // -right, with right = (-f.z, 0, f.x)
  want.copy(car.pos)
    .addScaledVector(back, Math.cos(yaw) * dist)
    .addScaledVector(left, Math.sin(yaw) * dist);
  want.y = car.pos.y + h;

  // aim: ahead of the car, pulled toward where the road goes (curve look-ahead)
  look.copy(car.pos).addScaledVector(f, lookF);
  path.toWorld(clamp(s + 18, 0, path.length), car.lateral, tmp);
  look.x += (tmp.x - (car.pos.x + f.x * 18)) * 0.35 * wC;
  look.z += (tmp.z - (car.pos.z + f.z * 18)) * 0.35 * wC;
  look.y = car.pos.y + lookH;
  // aim across the car at the set: further on narrow screens, where less of it fits
  if (fk > 0.001) look.lerp(focusV, fk * (0.34 + 0.22 * port));
  // looking round from the side or the front: aim back at the car, not down the road ahead
  const round = smoothstep(0.5, 1.6, Math.abs(userC.yaw));
  if (round > 0) { tmp.copy(car.pos); tmp.y += 0.9; look.lerp(tmp, round); }

  // stay inside the cleared corridor (road + shoulder + verge) so the lens
  // never ends up inside a tree or a wall beside the road
  const nr = path.nearest(want.x, want.z);
  const lim = world.VERGE - 0.3 + roundK * 3.5;   // trees start at VERGE + 0.4; looking round may go a little past
  if (Math.abs(nr.lateral) > lim) {
    path.sample(nr.s, S);
    want.addScaledVector(S.right, -(nr.lateral - Math.sign(nr.lateral) * lim));
  }

  const shot = detour.camShot;
  if (shot && shot.w > 0) { want.lerp(shot.pos, shot.w); look.lerp(shot.look, shot.w); }

  // terrain clearance
  const g = world.heightAt(want.x, want.z) + 1.1;
  if (want.y < g) want.y = g;

  // ease in the car's frame, so a hard fling never leaves the camera behind
  want.sub(car.pos); look.sub(car.pos);
  // an authored shot fully in control is exact: easing it in the car's frame
  // would drag a fixed viewpoint along with the moving car
  if (first || scroll.cut || (shot && shot.w > 0.999)) { offE.copy(want); offL.copy(look); first = false; }
  const k = shot && shot.w > 0 ? 8 : 3;
  offE.lerp(want, damp(k, dt));
  offL.lerp(look, damp(k + 2, dt));
  eye.copy(car.pos).add(offE);
  lookC.copy(car.pos).add(offL);
  const gE = world.heightAt(eye.x, eye.z) + 0.9;
  if (eye.y < gE) eye.y = gE;
  camera.position.copy(eye);
  camera.lookAt(lookC);

  const fov = (rm ? FOV : FOV + sp * 4 * wC - wT * 4) + narrow * 14;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov += (fov - camera.fov) * damp(3, dt);
    camera.updateProjectionMatrix();
  }
}

export const cam = { init, update };
