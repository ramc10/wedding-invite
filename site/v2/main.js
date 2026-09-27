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

async function boot() {
  atmosphere.init(ctx); progress(0.08);
  terrain.init(ctx); progress(0.2);

  const n = BIOMES.length;
  for (let i = 0; i < n; i++) {
    const b = BIOMES[i];
    const z = zones.byId[b.id];
    try {
      const built = await b.build(ctx);
      if (built && built.group) {
        scene.add(built.group);
        zoneGroups.push({ zone: z, ...built });
      }
    } catch (e) { console.error('[v2] biome ' + b.id + ' failed', e); }
    progress(0.2 + 0.4 * (i + 1) / n);
    await new Promise(r => setTimeout(r)); // let the loader paint
  }

  await car.init(ctx); progress(0.8);
  cam.init(ctx);
  detour.init(ctx);
  petals.init(ctx);
  post.init(ctx);
  ui.init(ctx);
  progress(0.9);

  try { await renderer.compileAsync(scene, camera); } catch (e) { /* older drivers: compile lazily */ }
  await warmUp();
  progress(1);
  dispatchEvent(new CustomEvent('v2:ready'));
  requestAnimationFrame(frame);
}

/* compileAsync only covers what the start camera can see. Everything else —
 * shader variants, instance buffers, textures — would otherwise upload the
 * first time its zone comes into view, freezing the drive for up to a second
 * at each new leg. So, behind the loader, stand the camera in every zone once
 * and draw a frame there, then put it back. */
async function warmUp() {
  const S = path.sample(0), look = new THREE.Vector3();
  const home = camera.position.clone(), homeQ = camera.quaternion.clone();
  const n = zones.ZONES.length;
  for (let i = 0; i < n; i++) {
    const z = zones.ZONES[i];
    for (const u of [0.25, 0.75]) {
      const s = z.s0 + (z.s1 - z.s0) * u;
      path.sample(s, S);
      camera.position.copy(S.pos).addScaledVector(S.fwd, -8); camera.position.y += 3.5;
      look.copy(S.pos).addScaledVector(S.fwd, 20);
      camera.lookAt(look);
      terrain.update(0, s, camera);
      for (const g of zoneGroups) { g.group.visible = zones.visible(g.zone, s); if (g.group.visible && g.update) g.update(0, s, camera); }
      post.render(renderer, scene, camera, 0);
    }
    progress(0.9 + 0.1 * (i + 1) / n);
    await new Promise(r => setTimeout(r));
  }
  camera.position.copy(home); camera.quaternion.copy(homeQ);
  terrain.update(0, 0, camera);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  post.resize(w, h);
}
addEventListener('resize', resize);

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) { last = now; return; }
  const dt = Math.min(0.05, (now - last) / 1000); last = now;

  world.U.uTime.value += dt;
  scroll.update(dt);
  const s = scroll.s;

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
  ui.update(dt, s);

  post.render(renderer, scene, camera, dt);
  quality.tick(dt, renderer, post);
}

boot().catch(e => {
  console.error('[v2] boot failed', e);
  dispatchEvent(new CustomEvent('v2:error', { detail: e }));
});
