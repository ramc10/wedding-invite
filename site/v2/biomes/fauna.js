/* Wildlife on the country legs: small herds of deer grazing back from the
 * road in the forest, the hills and by the creek, and rabbits along the
 * verges. Not a zone biome (it spans three zones): main.js calls
 * init(ctx) once and update(dt, s) every frame.
 *
 *   deer    ../models/animals/deer.glb and stag.glb (Quaternius, CC0), skinned
 *           and animated: graze (Eating, Idle_Headlow) ↔ look up (Idle,
 *           Idle_2), now and then a short Walk; when the car comes near they
 *           lift their heads and turn to watch it pass
 *   rabbits ../models/animals/rabbit.glb (Poly by Google, CC-BY 3.0), a
 *           static mesh hopped procedurally: sniff, a run of short hops, sit;
 *           a close car sends them bounding away from the road
 * Herds are placed on gentle, dry ground off the verge (away from the creek's
 * stream, the AMR grounds and the event sites) and only animate while their
 * zone is on screen.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from '../vendor/addons/utils/SkeletonUtils.js';
import { byId, visible } from '../core/zones.js';
import { onEventSite, STOP } from '../core/timeline.js';
import { rng as makeRng, smoothstep } from '../core/noise.js';

const URL_OF = f => new URL(`../../models/animals/${f}`, import.meta.url).href;

// herds: zone, near s, side (-1 left, 1 right), lateral band, how many does/stags
// Close to the road on purpose: just past the verge (VERGE is 5.8 m), so they read on a phone too.
const HERDS = [
  // forest: shrubs start 8 m out (forest.js), so the deer stand on the grass verge in front of them,
  // on the right, inside the bend, where the chase camera looks
  { zone: 'forest', s: 100, side: 1, only: true, lat: [6.3, 7.4], min: 6.2, does: 2, stags: 1 },
  { zone: 'forest', s: 160, side: 1, only: true, lat: [6.3, 7.4], min: 6.2, does: 1, stags: 1 },
  { zone: 'hills', s: 1400, side: -1, lat: [6.6, 8.5], does: 2, stags: 0 },
  { zone: 'hills', s: 1545, side: -1, lat: [6.6, 8.5], does: 2, stags: 1 },
  { zone: 'creek', s: 2180, side: -1, lat: [6.6, 8.5], does: 2, stags: 1 },
  { zone: 'creek', s: 2330, side: -1, lat: [6.6, 8.5], does: 2, stags: 0 }
];
// rabbits: zone, s range, count
const WARRENS = [
  { zone: 'forest', s0: 20, s1: 170, n: 5 },
  { zone: 'hills', s0: 1340, s1: 1620, n: 4 },
  { zone: 'creek', s0: 2170, s1: 2410, n: 6 }
];
const DOE_H = 1.45, STAG_H = 1.8, RABBIT_L = 0.5;   // metres: doe to the ears, stag to the antler tips, rabbit nose–tail
// Headings: yaw is the way an animal faces in road coords, (ds, dl) = (cos yaw, sin yaw), 0 = up the
// road. FRONT turns a model whose nose points down its local +Z (π) or -Z (0) onto that.
const FRONT = { deer: Math.PI, rabbit: Math.PI };
const faceTo = (h, yaw, front) => h + front - yaw;

const VEN = STOP.karimnagar.venue;
const creekLat = s => 16 + 3.2 * Math.sin(s * 0.021) + 1.2 * Math.sin(s * 0.057 + 1.3);   // biomes/creek.js

let ctx, group, ready = false;
const deer = [], rabbits = [];
const _v = new THREE.Vector3(), _smp = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(), heading: 0, curvature: 0 };

/** Dry, gentle, off-road ground at (s, lat)? Deer stay off the verge; rabbits may sit on it. */
const DEER_MIN = 6.6, RABBIT_MIN = 4.5;   // lateral metres from the centre line (asphalt edge 3.6)
function goodSpot(s, lat, min = DEER_MIN) {
  const { world } = ctx, a = Math.abs(lat);
  if (a < min) return false;
  if (onEventSite(s, lat, 6)) return false;
  if (lat > 0 && Math.abs(s - VEN.s) < 70) return false;                                   // AMR grounds
  if (byId.creek && s > byId.creek.s0 - 10 && lat > 0 && Math.abs(lat - creekLat(s)) < 5.5) return false;   // the stream
  const y = world.heightSL(s, lat), w = world.waterAt(s);
  if (w != null && y < w + 0.5) return false;
  const dx = world.heightSL(s + 1.5, lat) - world.heightSL(s - 1.5, lat);
  const dl = world.heightSL(s, lat + 1.5) - world.heightSL(s, lat - 1.5);
  return Math.hypot(dx, dl) / 3 < 0.32;                                                   // under ~18°
}

const taken = [];   // spots already used, so no two animals stand in one another
/* Will a guest see it? The chase camera on a portrait phone has only ~22° across, so a spot beside
 * a bend can sit outside the frame the whole way past. Test the spot from the chase camera
 * (8 m behind the car in the left lane, aimed ~14 m ahead of it) with the car 20–38 m short of it:
 * it must fall inside ±9.5° at least twice, and stand at road level (not up a cut or down a drop). */
const _c = new THREE.Vector3(), _l = new THREE.Vector3(), _a = new THREE.Vector3();
function seenFromRoad(s, lat) {
  if (Math.abs(ctx.world.heightSL(s, lat) - ctx.path.roadY(s)) > 1.6) return false;
  let n = 0;
  for (const D of [20, 26, 32, 38]) {
    const cs = s - D;
    if (cs < 8) continue;
    ctx.path.toWorld(cs - 8, -1.8, _c); ctx.path.toWorld(cs + 14, -1.8, _l); ctx.path.toWorld(s, lat, _a);
    const f = Math.atan2(_l.x - _c.x, _l.z - _c.z), g = Math.atan2(_a.x - _c.x, _a.z - _c.z);
    if (Math.abs(Math.atan2(Math.sin(g - f), Math.cos(g - f))) < 0.166) n++;
  }
  return n >= 2;
}

function findSpot(R, s, side, [l0, l1], spread = 12, gap = 3, min = DEER_MIN, only = false) {
  for (let t = 0; t < 160; t++) {
    const sd = only || t % 2 ? side : -side;           // either side of the road, whichever is in view
    const ss = s + (R() - 0.5) * 2 * spread, lat = sd * (l0 + R() * (l1 - l0));
    // (an `only` herd's side was chosen by eye from the renders: the view test can't see foliage)
    if (!goodSpot(ss, lat, min) || (!only && !seenFromRoad(ss, lat)) || taken.some(q => Math.hypot(q.s - ss, q.lat - lat) < gap)) continue;
    const spot = { s: ss, lat };
    taken.push(spot);
    return spot;
  }
  return null;
}

// road coords → world position on the ground, and the road's heading there
function ground(s, lat, out) {
  ctx.path.toWorld(s, lat, out);
  out.y = ctx.world.heightSL(s, lat);
  return ctx.path.sample(s, _smp).heading;
}

function fitHeight(obj, h) {
  const b = new THREE.Box3().setFromObject(obj), size = b.getSize(new THREE.Vector3());
  return h / size.y;
}

/* ---------- deer ---------- */

const GRAZE = ['Eating', 'Idle_Headlow', 'Eating'], LOOK = ['Idle', 'Idle_2'];

function makeDeer(gltf, h, herd, spot, R) {
  const o = cloneSkinned(gltf.scene);
  o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; } });
  const k = fitHeight(gltf.scene, h) * (0.92 + R() * 0.14);
  o.scale.setScalar(k);
  const root = new THREE.Group(); root.add(o); group.add(root);
  const mixer = new THREE.AnimationMixer(o);
  const acts = Object.fromEntries(gltf.animations.map(c => [c.name, mixer.clipAction(c)]));
  const d = { kind: 'deer', root, mixer, acts, cur: null, t: 0, zone: byId[herd.zone], s: spot.s, lat: spot.lat, home: { ...spot },
    yaw: R() * Math.PI * 2, want: 0, walk: 0, run: 0, alert: false, R, k };
  d.want = d.yaw;
  play(d, GRAZE[(R() * GRAZE.length) | 0], 0);
  d.cur && (d.cur.time = R() * d.cur.getClip().duration);
  d.t = 2 + R() * 6;
  place(d);
  return d;
}

function play(d, name, fade = 0.5) {
  const a = d.acts[name];
  if (!a || a === d.cur) return;
  a.reset().setEffectiveWeight(1).play();
  if (d.cur) a.crossFadeFrom(d.cur, fade, false);
  d.cur = a; d.clip = name;
}

function place(d) {
  const h = ground(d.s, d.lat, d.root.position);
  d.root.rotation.y = faceTo(h, d.yaw, FRONT.deer);
}

function stepDeer(d, dt, carS) {
  // the car closing in (behind the deer, within 30 m): most bolt, galloping on ahead along the road and
  // angling away from it, so they stay in frame a moment; the rest lift their heads and watch it pass
  const coming = carS < d.s && d.s - carS < 30;
  if (coming && !d.alert && !d.run) {
    if (d.R() < 0.65) {
      d.run = 2.5 + d.R() * 1.8; d.walk = 0; play(d, 'Gallop', 0.25);
      d.want = Math.atan2(Math.sign(d.lat) * (0.35 + d.R() * 0.3), 1);
    } else { d.alert = true; d.walk = 0; play(d, 'Idle', 0.35); d.t = 3 + d.R() * 3; }
  } else if (d.alert && Math.abs(carS - d.s) > 38) { d.alert = false; d.t = 0; }

  if (d.run) {
    if ((d.run -= dt) <= 0) { d.run = 0; play(d, 'Idle', 0.6); d.t = 1.5 + d.R() * 2; d.home = { s: d.s, lat: d.lat }; }
    else if (Math.abs(d.lat) > 18) d.want = 0;                  // far enough out: run on parallel to the road
  } else if (d.alert) {
    d.want = Math.atan2(-1.8 - d.lat, carS - d.s);            // turn to face the car in its lane
  } else if ((d.t -= dt) <= 0) {
    const r = d.R();
    if (d.walk > 0) { d.walk = 0; play(d, GRAZE[(r * 3) | 0]); d.t = 2.5 + d.R() * 4; }
    else if (r < 0.5) {                                        // wander a few metres, then graze again
      const away = Math.hypot(d.s - d.home.s, d.lat - d.home.lat) > 3.5 || Math.abs(d.lat) > 9.5;   // stay by the road
      d.want = away ? Math.atan2(d.home.lat - d.lat, d.home.s - d.s) : d.yaw + (d.R() - 0.5) * 2.4;
      d.walk = 1; play(d, 'Walk'); d.t = 3 + d.R() * 4;
    } else if (r < 0.7) { play(d, LOOK[(d.R() * 2) | 0]); d.t = 1.5 + d.R() * 2.5; }
    else { play(d, GRAZE[(d.R() * 3) | 0]); d.t = 2.5 + d.R() * 4; }
  }
  // ease the heading, and move along it (walk ~1.1 m/s, gallop ~7 m/s)
  let dy = d.want - d.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  d.yaw += dy * Math.min(1, dt * (d.run ? 3 : d.walk ? 1.6 : 1.1));
  if (d.walk || d.run) {
    const v = (d.run ? 7 : 1.1) * dt, ns = d.s + Math.cos(d.yaw) * v, nl = d.lat + Math.sin(d.yaw) * v;
    if (goodSpot(ns, nl, 6.2) && Math.abs(nl) < (d.run ? 24 : 12)) { d.s = ns; d.lat = nl; }
    else d.want = d.run ? d.yaw - Math.sign(d.lat) * 0.8 : d.yaw + Math.PI * 0.6;
  }
  d.mixer.update(dt);
  place(d);
}

/* ---------- rabbits ---------- */

function makeRabbit(gltf, spot, R, zone) {
  const o = gltf.scene.clone(true);
  o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  const b = new THREE.Box3().setFromObject(gltf.scene), size = b.getSize(new THREE.Vector3());
  const k = RABBIT_L / Math.max(size.x, size.z) * (0.85 + R() * 0.3);
  o.scale.setScalar(k);
  o.position.y = -b.min.y * k;                          // feet on the ground
  const body = new THREE.Group(); body.add(o);
  const root = new THREE.Group(); root.add(body); group.add(root);
  const yaw = R() * Math.PI * 2;
  const r = { root, body, zone, s: spot.s, lat: spot.lat, yaw, want: yaw, R,
    mode: 'sit', t: R() * 3, hops: 0, hopT: 0, from: null, to: null, flee: false };
  ground(r.s, r.lat, root.position);
  return r;
}

const HOP = 0.32;   // seconds per hop
function stepRabbit(r, dt, carS) {
  const scared = Math.abs(carS - r.s) < 22 && Math.abs(r.lat) < 16;
  if (scared && !r.flee) { r.flee = true; r.mode = 'hop'; r.hops = 5 + (r.R() * 3 | 0); r.hopT = 0; aim(r, true); }
  if (!scared && r.flee && r.mode === 'sit') r.flee = false;

  if (r.mode === 'sit') {
    // sniff: a small nose bob
    r.body.position.y = 0.006 * Math.max(0, Math.sin(ctx.world.U.uTime.value * 9 + r.s));
    if ((r.t -= dt) <= 0) { r.mode = 'hop'; r.hops = 1 + (r.R() * 4 | 0); r.hopT = 0; aim(r, false); }
  } else {
    const dur = r.flee ? HOP * 0.8 : HOP;
    r.hopT += dt / dur;
    const u = Math.min(1, r.hopT);
    r.s = r.from.s + (r.to.s - r.from.s) * u; r.lat = r.from.lat + (r.to.lat - r.from.lat) * u;
    const arc = Math.sin(u * Math.PI);
    r.body.position.y = arc * (r.flee ? 0.26 : 0.16);
    r.body.rotation.x = -0.35 * Math.cos(u * Math.PI) * arc;            // nose up on take-off, down on landing
    r.body.scale.set(1, 1 - 0.12 * Math.sin(u * Math.PI * 2) * (1 - arc), 1);
    if (u >= 1) {
      if (--r.hops > 0) { r.hopT = 0; aim(r, r.flee); }
      else { r.mode = 'sit'; r.t = 0.5 + r.R() * 2; r.body.rotation.x = 0; r.body.scale.set(1, 1, 1); }
    }
  }
  let dy = r.want - r.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  r.yaw += dy * Math.min(1, dt * 10);
  const h = ground(r.s, r.lat, r.root.position);
  r.root.rotation.y = faceTo(h, r.yaw, FRONT.rabbit);
}

function aim(r, flee) {
  // away from the road when fleeing, anywhere otherwise; never onto bad ground
  let ds, dl;
  const len = flee ? 0.95 : 0.45 + r.R() * 0.3;
  for (let t = 0; t < 8; t++) {
    const drift = Math.abs(r.lat) > 8.5;                // wandered off: drift back toward the verge
    const ang = flee ? Math.atan2(Math.sign(r.lat), (r.R() - 0.5) * 0.8)
      : drift ? Math.atan2(-Math.sign(r.lat), (r.R() - 0.5) * 1.6) : r.R() * Math.PI * 2;
    ds = Math.cos(ang) * len; dl = Math.sin(ang) * len;
    if (goodSpot(r.s + ds, r.lat + dl, RABBIT_MIN) || t === 7) { r.want = ang; break; }
  }
  if (!goodSpot(r.s + ds, r.lat + dl, RABBIT_MIN)) { ds = 0; dl = 0; }
  r.from = { s: r.s, lat: r.lat }; r.to = { s: r.s + ds, lat: r.lat + dl };
}

/* ---------- module ---------- */

async function init(c) {
  ctx = c;
  group = new THREE.Group(); group.name = 'fauna';
  ctx.scene.add(group);
  const zones = Object.keys(byId);
  const [doe, stag, bun] = await Promise.all(['deer.glb', 'stag.glb', 'rabbit.glb'].map(f => ctx.loadGLTF(URL_OF(f))));
  const n = { low: 0.5, med: 0.75, high: 1 }[ctx.quality.tier] ?? 0.75;
  let hi = 0;
  for (const herd of HERDS) {
    if (!zones.includes(herd.zone)) continue;
    const R = makeRng('herd' + hi++);
    const count = Math.max(1, Math.round((herd.does + herd.stags) * n));
    for (let i = 0; i < count; i++) {
      const spot = findSpot(R, herd.s, herd.side, herd.lat, 16, 3, herd.min ?? DEER_MIN, herd.only);
      if (!spot) continue;
      const isStag = i >= count - herd.stags && herd.stags > 0;
      deer.push(makeDeer(isStag ? stag : doe, isStag ? STAG_H : DOE_H, herd, spot, R));
    }
  }
  let wi = 0;
  for (const w of WARRENS) {
    const R = makeRng('warren' + wi++);
    for (let i = 0; i < Math.round(w.n * n); i++) {
      const s = w.s0 + R() * (w.s1 - w.s0), side = R() < 0.5 ? -1 : 1;
      const spot = findSpot(R, s, side, [RABBIT_MIN + 0.1, 7], 10, 1.5, RABBIT_MIN);
      if (spot) rabbits.push(makeRabbit(bun, spot, R, byId[w.zone]));
    }
  }
  ready = true;
}

function update(dt, s) {
  if (!ready) return;
  for (const d of deer) {
    const on = visible(d.zone, s) && Math.abs(s - d.s) < 260;
    d.root.visible = on;
    if (on) stepDeer(d, dt, s);
  }
  for (const r of rabbits) {
    const on = visible(r.zone, s) && Math.abs(s - r.s) < 120;
    r.root.visible = on;
    if (on) stepRabbit(r, dt, s);
  }
}

export const fauna = {
  init(c) { init(c).catch(e => console.warn('[fauna]', e)); },
  update,
  get deer() { return deer; }, get rabbits() { return rabbits; }
};
