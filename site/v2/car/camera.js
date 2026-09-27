/* The camera, valley-style. Three authored rigs blended by s, all expressed
 * as the same few numbers around the car so blends orbit instead of cutting
 * through the bodywork:
 *   yaw   angle round the car from dead-behind (+ = towards its left side)
 *   dist  metres from the car, horizontally
 *   h     eye height above the car
 *   lookH / lookF  aim point: height above, metres ahead of the car
 *
 *   title  (s ≈ 0–40)   parked car, slow orbit + push-in from the front-left
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
import { END_S } from '../core/timeline.js';
import { damp, clamp, smoothstep, lerp } from '../core/noise.js';
import { scroll } from '../core/scroll.js';

const RM = matchMedia('(prefers-reduced-motion: reduce)');

const CHASE = { yaw: 0.2, dist: 7.6, h: 2.7, lookH: 1.05, lookF: 7 };
const TITLE = { yaw: 2.6, dist: 8.6, h: 1.25, lookH: 2.35, lookF: 0 };
const END = { yaw: 0.55, dist: 15, h: 13, lookH: 26, lookF: 60 };
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

function init(ctx) {
  camera = ctx.camera;
  const el = ctx.renderer.domElement;
  el.addEventListener('pointerdown', e => {
    if (detour.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' };
    if (!drag.touch) { try { el.setPointerCapture(e.pointerId); } catch (_) {} }
  });
  el.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    const k = 1 / Math.max(320, innerWidth * 0.5);
    user.yaw = clamp(user.yaw - dx * k * 2.2, -1.5, 1.5);
    if (!drag.touch) user.pitch = clamp(user.pitch + dy * k * 1.2, -0.25, 0.5);
    idle = 0;
  });
  const end = e => { if (drag && e.pointerId === drag.id) { drag = null; idle = 0; } };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);   // touch turned into a native vertical scroll
  el.addEventListener('lostpointercapture', end);
}

// weights of the authored rigs at s
const titleW = s => 1 - smoothstep(12, 70, s);
const endW = s => smoothstep(END_S - 90, END_S - 4, s);

function update(dt) {
  if (!camera) return;
  const rm = RM.matches;
  time += dt;
  idle += dt;
  const s = scroll.s;

  // drag offsets ease home after a few idle seconds
  if (!drag && idle > 3.5) {
    const k = damp(0.9, dt);
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
  const orbit = rm ? 0 : Math.sin(time * 0.045) * 0.3 + Math.sin(time * 0.017 + 1.1) * 0.08;
  const tYaw = TITLE.yaw + orbit - (1 - pe) * 0.35;
  const tDist = lerp(TITLE.dist + 3.4, TITLE.dist, pe);

  const drift = rm || idle < 3.5 ? 0 : Math.sin(time * 0.21) * 0.05;
  const driftH = rm || idle < 3.5 ? 0 : Math.sin(time * 0.17 + 1) * 0.12;

  const yaw = wT * tYaw + wC * (CHASE.yaw - curvS * 6 + drift) + wE * END.yaw + userC.yaw;
  const dist = (wT * tDist + wC * (CHASE.dist + sp * 1.4) + wE * END.dist) * (1 + narrow * 0.3);
  let h = wT * TITLE.h + wC * (CHASE.h + sp * 0.3 + driftH) + wE * END.h;
  h += userC.pitch * dist * 0.9;
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

  // stay inside the cleared corridor (road + shoulder + verge) so the lens
  // never ends up inside a tree or a wall beside the road
  const nr = path.nearest(want.x, want.z);
  const lim = world.VERGE - 0.3;       // trees start at VERGE + 0.4
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
  if (first || scroll.cut) { offE.copy(want); offL.copy(look); first = false; }
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
