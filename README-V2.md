# /v2/ — the immersive drive

`site/v2/` is a 3D, third-person version of the invite: the same drive, the
same seven legs and the same copy, but the camera rides behind the EcoSport
through a real scene instead of looking down on painted plates. The look
takes its cues from valley.mengto.here.now: low warm sun, height fog, a
single colour grade, petals. The root site (`site/index.html`, `road.js`, …)
is untouched by v2 work.

Run locally: `cd site && python3 -m http.server 8765`, open
`http://localhost:8765/v2/`. There's no build step. Three.js r170 is vendored
as an ES module (`site/v2/vendor/three.module.min.js`), mapped to `three`
by the importmap in `index.html`.

## Scroll → s

Everything is keyed off **s**, metres along the road (`core/path.js`,
~2.5 km). Native page scroll over a tall `#track` maps to a target s through
`PACING` (slower around stops, `core/timeline.js`), and the rendered s eases
toward it (`core/scroll.js`). The car sits at s; the chase camera follows the
car.

## Modules and owners

| Area | Files |
|---|---|
| Core (frozen API) | `core/path.js`, `core/world.js`, `core/zones.js`, `core/timeline.js`, `core/scroll.js`, `core/noise.js`, `main.js` |
| Perf | `core/quality.js` |
| Sky/fog/post/petals | `fx/atmosphere.js`, `fx/post.js`, `fx/petals.js` |
| Land | `biomes/terrain.js`, `biomes/flora.js`, `biomes/forest.js`, `biomes/hills.js`, `biomes/creek.js` |
| Coast | `biomes/water.js`, `biomes/garden.js`, `biomes/garden-beach.js`, `biomes/cove.js` |
| Dam | `biomes/dam.js` |
| Car | `car/car.js`, `car/camera.js`, `car/detour.js` |
| UI | `index.html`, `v2.css`, `ui/*` |

## Contracts

- **Road space.** `path.sample(s)` gives `{pos, fwd, right, heading, curvature}`.
  `path.toWorld(s, lateral)` gives a world point, with +lateral to the right
  of travel. `path.nearest(x, z)` gives `{s, lateral}`. The car drives on the
  left, at lateral `-1.8`.
- **Ground.** `world.heightSL(s, lateral)` and `world.heightAt(x, z)` are the
  only source of ground height, so plant on these. `world.waterAt(s)` gives
  the water level. `world.VERGE` is where the terrain leaves road level.
- **Zones.** `core/zones.js` owns each zone's extents, its ground profile per
  side and its time-of-day key. A biome module is
  `export default { id, build(ctx) → {group, update?(dt, s, camera), dispose?()} }`.
  `main.js` hides the group outside `[s0 − 320, s1 + 320]`. Build only
  within your zone's span ± `blend`.
- **Shared uniforms.** `world.U` holds uTime, uWind, uSunDir, uSunCol,
  uSkyTop, uSkyHor, uFogCol, uFogDensity, uFogHeight, uPathTex, uPathLen,
  uCamPos and uDusk. Pass the **same objects** into your ShaderMaterials;
  never clone them.
- **Fog.** Every material must take the scene fog. Built-in materials do by
  default. A custom `ShaderMaterial` sets `fog: true`, merges
  `THREE.UniformsLib.fog` and includes `fog_pars_vertex`, `fog_vertex`,
  `fog_pars_fragment` and `fog_fragment`. `fx/atmosphere.js` overrides those
  chunks globally with height fog. Nothing else may override ShaderChunk.
- **Stops.** `timeline.STOPS[i].venue = {s, lateral}` is where the venue
  building stands (built by the owning biome). `pullover` is where the car
  parks. `car/detour.js` frames the building from those positions.
- **Budgets per zone:** at most 25 draw calls (instancing counts as one) and
  at most 60k triangles visible. No external assets over 50 KB; generate
  textures and geometry in code. Read `ctx.quality.tier`
  (`low`/`med`/`high`) to scale instance counts.
- **Never** use `site/art/car.webp` (the old pink car) for anything,
  including as a placeholder.

## Checking your work

`node <scratchpad>/npm3/shot.mjs <outdir> <s,s,…|zones> [w] [h]` loads
`/v2/` in headless Chrome, jumps to each s, saves PNGs and prints console
errors. `window.__v2` exposes ctx (`scene`, `path`, `zones`, `scroll`, …).

## Credit

The car is "2012 Ford EcoSport" by tonielpro520, licensed CC-BY-4.0 (see
`site/models/ecosport/license.txt`). The credit line must stay visible on
the page.
