/* /v2/ — the drive, in 3D. Boot, render loop, and the ctx every module gets.
 *
 * Module contract (see README-V2.md at the repo root):
 *   biomes/<id>.js   export default { id, build(ctx) → {group, update?(dt, s, cam), dispose?()} }
 *                    id must match a zone in core/zones.js; main shows the group only
 *                    inside that zone's visibility window.
 *   ctx = { THREE, scene, renderer, camera, path, world, zones, quality, rng, noise,
 *           loadGLTF(url), clock }
 * Everything else talks through the modules' exported objects (scroll, car, cam, …).
 */
import * as THREE from 'three';
import { path } from './core/path.js';
import { world } from './core/world.js';
import * as zones from './core/zones.js';
import * as noise from './core/noise.js';
import { scroll } from './core/scroll.js';
import { atmosphere } from './fx/atmosphere.js';
import { post } from './fx/post.js';
import { terrain } from './biomes/terrain.js';
import { BIOMES } from './biomes/index.js';
import { car } from './car/car.js';
import { cam } from './car/camera.js';
import { detour } from './car/detour.js';
import { fx as petals } from './fx/petals.js';
import { ambience } from './fx/ambience.js';
import { ui } from './ui/index.js';
import { quality } from './core/quality.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from './vendor/addons/loaders/DRACOLoader.js';

const progress = p => dispatchEvent(new CustomEvent('v2:progress', { detail: p }));
progress(0.02);

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.tier !== 'low', powerPreference: 'high-performance' });
renderer.setPixelRatio(quality.dpr);
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.3, 3000);

const draco = new DRACOLoader().setDecoderPath(new URL('./vendor/draco/', import.meta.url).href);
const gltf = new GLTFLoader().setDRACOLoader(draco);
const loadGLTF = url => gltf.loadAsync(url);

const ctx = {
  THREE, scene, renderer, camera, path, world, zones, quality, noise,
  rng: noise.rng, loadGLTF, clock: new THREE.Clock(), scroll
};
window.__v2 = ctx; // debugging handle

const zoneGroups = [];
const buildTimes = {};   // ms per module, for profiling boot (window.__v2.buildTimes)
ctx.buildTimes = buildTimes;

// ?legs=forest,dam builds only those legs (QA: iterate on one leg in seconds)
const LEGS = new URLSearchParams(location.search).get('legs');
const PLAN = LEGS ? BIOMES.filter(b => LEGS.split(',').includes(b.id)) : BIOMES;
const tick = () => new Promise(r => setTimeout(r));

/* Everything is built, compiled and drawn once behind the loader, and only
 * then is the drive handed over. Building the later legs after ready froze
 * the page for 4-15 s at a time while guests were already scrolling; a longer
 * loader with a drive that answers straight away is the better trade. */
async function boot() {
  let tb = performance.now();
  // the car's .glb downloads and Draco-decodes (in a worker) while the
  // terrain and legs are generated on the main thread
  const carReady = car.init(ctx);
  await zones.dayReady;   // the beach's time-of-day keys (core/daykeys.js)
  atmosphere.init(ctx); progress(0.04);
  buildTimes.atmosphere = Math.round(performance.now() - tb); tb = performance.now();
  terrain.init(ctx); progress(0.08);
  buildTimes.terrain = Math.round(performance.now() - tb);
  tb = performance.now();
  await terrain.initRest(ctx);
  buildTimes.terrainRest = Math.round(performance.now() - tb);
  progress(0.12);

  for (let i = 0; i < PLAN.length; i++) {
    await tick();
    await buildBiome(PLAN[i]);
    progress(0.12 + 0.63 * (i + 1) / PLAN.length);
  }

  tb = performance.now();
  await terrain.ready();
  buildTimes.roadTex = Math.round(performance.now() - tb);
  tb = performance.now();
  await carReady;
  buildTimes.car = Math.round(performance.now() - tb);
  tb = performance.now();
  car.prepareEnv();
  buildTimes.carEnv = Math.round(performance.now() - tb);
  progress(0.8);
  cam.init(ctx);
  detour.init(ctx);
  petals.init(ctx);
  post.init(ctx);
  ui.init(ctx);
  progress(0.82);

  tb = performance.now();
  // compile every leg's programs, not just what the start camera can see
  for (const g of zoneGroups) g.group.visible = true;
  try { await renderer.compileAsync(scene, camera); } catch (e) { /* older drivers: compile lazily */ }
  for (const g of zoneGroups) g.group.visible = false;
  buildTimes.compile = Math.round(performance.now() - tb);
  tb = performance.now();
  await warmUp();
  buildTimes.warmUp = Math.round(performance.now() - tb);
  progress(1);
  dispatchEvent(new CustomEvent('v2:ready'));
  requestAnimationFrame(frame);
  dispatchEvent(new CustomEvent('v2:complete'));
}

async function buildBiome(b) {
  const z = zones.byId[b.id];
  const tb = performance.now();
  try {
    const built = await b.build(ctx);
    if (built && built.group) {
      built.group.visible = false;
      scene.add(built.group);
      zoneGroups.push({ zone: z, ...built });
      return built.group;
    }
  } catch (e) { console.error('[v2] biome ' + b.id + ' failed', e); }
  finally { buildTimes[b.id] = Math.round(performance.now() - tb); }
  return null;
}

/* compileAsync only covers what the start camera can see. Everything else —
 * shader variants, instance buffers, textures — would otherwise upload the
 * first time its zone comes into view, freezing the drive for up to a second
 * at each new leg. So, behind the loader, stand the camera in every zone once
 * and draw a frame there, then put it back. */
async function warmUp() {
  const S = path.sample(0), look = new THREE.Vector3();
  const home = camera.position.clone(), homeQ = camera.quaternion.clone();
  const built = zones.ZONES.filter(z => zoneGroups.some(g => g.zone === z));
  const n = built.length;
  for (let i = 0; i < n; i++) {
    const z = built[i];
    for (const u of [0.25]) {   // one frame per built zone: uploads + shadow/post programs
      const s = z.s0 + (z.s1 - z.s0) * u;
      path.sample(s, S);
      camera.position.copy(S.pos).addScaledVector(S.fwd, -8); camera.position.y += 3.5;
      look.copy(S.pos).addScaledVector(S.fwd, 20);
      camera.lookAt(look);
      terrain.update(0, s, camera);
      for (const g of zoneGroups) { g.group.visible = zones.visible(g.zone, s); if (g.group.visible && g.update) g.update(0, s, camera); }
      // draw everything in the visible legs, not just what this one pose
      // sees: with culling off, every mesh's buffers upload and its main and
      // shadow-depth programs link here instead of on first sight mid-drive
      const unculled = [];
      for (const g of zoneGroups) if (g.group.visible) g.group.traverse(o => { if (o.frustumCulled) { o.frustumCulled = false; unculled.push(o); } });
      const tr = performance.now();
      post.render(renderer, scene, camera, 0);
      for (const o of unculled) o.frustumCulled = true;
      buildTimes['warm' + u] = Math.round(performance.now() - tr);
    }
    progress(0.82 + 0.18 * (i + 1) / n);
    await new Promise(r => setTimeout(r));
  }
  camera.position.copy(home); camera.quaternion.copy(homeQ);
  terrain.update(0, 0, camera);
  // Then the real frame at the title pose, a few times: car, camera, sky,
  // petals and the DOM overlays all run their first update here, and whatever
  // only the title shot sees uploads now. A 1-pixel read makes the GPU finish
  // all of it (ANGLE builds pipelines at first draw) before the loader lifts.
  const px = new Uint8Array(4), gl = renderer.getContext();
  for (let k = 0; k < 3; k++) {
    const tr = performance.now();
    step(1 / 60);
    renderer.setRenderTarget(null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    buildTimes['warmHome' + k] = Math.round(performance.now() - tr);
    await new Promise(r => setTimeout(r));
  }
}

function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  post.resize(w, h);
}
addEventListener('resize', resize);

// ?debug: what this device got (tier, pixel ratio, render scale, fps, GPU), for testing on phones
const DBG = new URLSearchParams(location.search).has('debug') ? document.body.appendChild(Object.assign(document.createElement('div'), {
  style: 'position:fixed;left:8px;top:64px;z-index:30;padding:6px 9px;border-radius:8px;background:rgba(0,0,0,.6);color:#fff;font:11px/1.4 ui-monospace,monospace;pointer-events:none;white-space:pre'
})) : null;
let dbgT = 0;

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) { last = now; return; }
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  step(dt);
  quality.tick(dt);
  if (DBG && (dbgT += dt) > 0.5) {
    dbgT = 0;
    DBG.textContent = `tier ${quality.tier}  dpr ${quality.dpr}  scale ${quality.scale.toFixed(2)}\nfps ${quality.fps}  ${innerWidth}x${innerHeight}\n${(quality.gpu || 'gpu n/a').slice(0, 40)}`;
  }
}

// one frame of the drive (also run behind the loader by warmUp)
function step(dt) {
  world.U.uTime.value += dt;
  scroll.update(dt);
  // during a detour the page scroll is frozen: the world (sky, legs, captions) follows the car
  const s = detour.carS != null ? detour.carS : scroll.s;

  car.update(dt, s);
  detour.update(dt);
  cam.update(dt);
  world.U.uCamPos.value.copy(camera.position);
  atmosphere.update(dt, s);
  terrain.update(dt, s, camera);
  for (const g of zoneGroups) {
    const vis = zones.visible(g.zone, s);
    g.group.visible = vis;
    if (vis && g.update) g.update(dt, s, camera);
  }
  petals.update(dt, s);
  ambience.update(dt, s);
  ui.update(dt, s);

  post.render(renderer, scene, camera, dt);
}

boot().catch(e => {
  console.error('[v2] boot failed', e);
  dispatchEvent(new CustomEvent('v2:error', { detail: e }));
});
