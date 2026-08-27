/* Wedding Road — section 1, modelled.
 *
 * The painted build's scroll model, unchanged: the section owns its scroll length and
 * its stretch of road, the drive is a cubic ease-out over the first 55% and the rest
 * is a dead-still arrival hold, and the camera framing is pinned to rows-per-screen so
 * a phone and a desktop compose identically.
 *
 * What is different is underneath. The first pass at this was a flat plane with blobs
 * scattered on it and it read as exactly that. The reference is rolling hills with a
 * road cut through them, and hills are most of why it reads as terrain rather than as
 * carpet — so the ground is displaced, the road is a flattened corridor through it, and
 * everything else is planted on the surface and lit by one sun.
 */
import * as THREE from './lib/three.min.js';

const FRAME = 694;      // world units across the frame, as in the painted build
const ROWS  = 1504;     // world units down one screen — the framing both devices share
const ROAD  = 94;
const LEN   = 6400;     // length of this stretch of road
const DRIVE = 0.55;     // share of the section spent moving
const CAR_LINE = 0.56;

const pal = await fetch('kit/palette.json').then(r => r.json());
const C = k => new THREE.Color(pal[k]);

let seed = 20260826;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const rng = (a, b) => a + rnd() * (b - a);

/* ------------------------------------------------------------------ terrain */

const ROAD_FLAT = ROAD * 0.62;     // the cutting is level out to here
const ROAD_FALL = 105;             // then the hills climb away over this distance

/** Rolling ground, flattened into a corridor where the road runs. */
function height(x, z) {
  let h = 34 * Math.sin(z / 210 + x / 340)
        + 19 * Math.sin(z / 96 - x / 170)
        + 9  * Math.sin(x / 78 + z / 47)
        + 4  * Math.sin(z / 23 + x / 31);
  const d = Math.abs(x);
  const cut = d < ROAD_FLAT ? 0 : Math.min(1, (d - ROAD_FLAT) / ROAD_FALL);
  return h * cut * cut * (3 - 2 * cut);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color('#141b12');

const SEG_X = 96, SEG_Z = 420;
const groundGeo = new THREE.PlaneGeometry(FRAME * 1.45, LEN, SEG_X, SEG_Z);
groundGeo.rotateX(-Math.PI / 2);
{
  const p = groundGeo.attributes.position;
  const col = new Float32Array(p.count * 3);
  const lo = C('groundMid'), hi = C('groundLight').clone().offsetHSL(0, .02, .10),
        c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i) + LEN / 2;
    const y = height(x, z);
    p.setY(i, y);
    // a slow wash of tone across the ground, so the tiling texture is not the only variation
    const t = Math.min(1, Math.max(0, (y + 38) / 76)) * 0.7
            + 0.3 * (0.5 + 0.5 * Math.sin(x / 260 + z / 520));
    c.copy(lo).lerp(hi, t);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  groundGeo.computeVertexNormals();
}

const tex = new THREE.TextureLoader();
function tiled(src, rx, ry) {
  const t = tex.load(src);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({
  map: tiled('kit/ground.webp', 4, LEN / 300), vertexColors: true,
}));
ground.position.z = LEN / 2;
scene.add(ground);

const road = new THREE.Mesh(
  new THREE.PlaneGeometry(ROAD * 1.9, LEN),
  new THREE.MeshLambertMaterial({ map: tiled('kit/road.webp', 1, LEN / 210) })
);
road.rotation.x = -Math.PI / 2;
road.position.set(0, 0.7, LEN / 2);
scene.add(road);

/* ------------------------------------------------------------------ species */

function merge(list) {
  let n = 0;
  for (const g of list) n += (g.index ? g.toNonIndexed() : g).attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    g.computeVertexNormals();
    const gi = g.index ? g.toNonIndexed() : g;
    const p = gi.attributes.position, m = gi.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos[o * 3] = p.getX(i); pos[o * 3 + 1] = p.getY(i); pos[o * 3 + 2] = p.getZ(i);
      nor[o * 3] = m.getX(i); nor[o * 3 + 1] = m.getY(i); nor[o * 3 + 2] = m.getZ(i);
      o++;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

/** A canopy: overlapping domes, wider than tall, so from above it is a rounded mass. */
function canopy() {
  const parts = [];
  const n = 4 + ((rnd() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const r = rng(7, 12);
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.scale(1, rng(0.42, 0.62), 1);
    g.translate(rng(-6, 6), rng(1, 5), rng(-6, 6));
    parts.push(g);
  }
  return merge(parts);
}

/** A conifer from directly above is a dark rosette, not a cone — a cone shows only its
 *  sides at a grazing angle from here and renders as a black hole. */
function conifer() {
  const parts = [];
  const blades = 7 + ((rnd() * 3) | 0);
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + rng(-0.2, 0.2);
    const r = rng(7, 11);
    const g = new THREE.IcosahedronGeometry(rng(3.4, 5), 0);
    g.scale(1.25, 0.4, 1.25);
    g.translate(Math.cos(a) * r * 0.55, rng(2, 5), Math.sin(a) * r * 0.55);
    parts.push(g);
  }
  const crown = new THREE.IcosahedronGeometry(rng(4.5, 6), 0);
  crown.scale(1, 0.5, 1);
  crown.translate(0, 7, 0);
  parts.push(crown);
  return merge(parts);
}

function rock() {
  const g = new THREE.IcosahedronGeometry(rng(4, 8), 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++)
    p.setXYZ(i, p.getX(i) * rng(.7, 1.3), p.getY(i) * rng(.35, .7), p.getZ(i) * rng(.7, 1.3));
  g.computeVertexNormals();
  return g;
}

function blossom() {
  const g = new THREE.IcosahedronGeometry(rng(2.4, 3.8), 0);
  g.scale(1, 0.4, 1);
  return g;
}

/* --------------------------------------------------------------- scattering */

const HALF = ROAD * 0.74;

/** Clustered, not uniform. Growth clumps and leaves clearings; an even spread is what
 *  made the first attempt read as carpet. */
function sites(count, keepOut) {
  const out = [];
  const clusters = Math.max(8, (count / 26) | 0);
  for (let c = 0; c < clusters; c++) {
    const cx = rng(-FRAME * 0.66, FRAME * 0.66);
    const cz = rng(0, LEN);
    const spread = rng(45, 150);
    const n = Math.ceil(count / clusters * rng(0.4, 1.7));
    for (let i = 0; i < n && out.length < count; i++) {
      const x = cx + rng(-spread, spread), z = cz + rng(-spread, spread);
      if (Math.abs(x) < keepOut || Math.abs(x) > FRAME * 0.72 || z < 0 || z > LEN) continue;
      out.push([x, z]);
    }
  }
  return out;
}

const meshes = [];
function plant(count, geomFn, colours, scale, keepOut) {
  const pts = sites(count, keepOut);
  const mesh = new THREE.InstancedMesh(
    geomFn(), new THREE.MeshLambertMaterial({ flatShading: true }), pts.length);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(pts.length * 3), 3);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
        v = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
  pts.forEach(([x, z], i) => {
    // a size hierarchy: a few big masses, many small — an even size is the other half
    // of why a scatter reads as carpet
    const big = rnd() < 0.14;
    const sc = big ? rng(scale[1], scale[1] * 1.7) : rng(scale[0], scale[1]);
    v.set(x, height(x, z) - 2, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
    m.compose(v, q, s.set(sc, sc, sc));
    mesh.setMatrixAt(i, m);
    col.copy(colours[(rnd() * colours.length) | 0]).offsetHSL(rng(-.02, .02), rng(-.05, .05), rng(-.07, .07));
    mesh.setColorAt(i, col);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  meshes.push(mesh);
  return pts.length;
}

const counts = {
  canopy:   plant(2400, canopy,   [C('groundMid'), C('groundLight'),
                                   C('groundDark').clone().offsetHSL(0, 0, .07)],      [0.75, 1.5], HALF),
  conifers: plant(420,  conifer,  [C('conifer').clone().offsetHSL(0, -.05, .13),
                                   C('groundDark').clone().offsetHSL(0, 0, .10)],      [0.85, 1.5], HALF + 16),
  rocks:    plant(260,  rock,     [C('rock')],                                         [0.8, 1.8],  HALF + 6),
  blossom:  plant(1400, blossom,  [C('blossomPink'), C('blossomWhite')],               [0.85, 1.6], HALF),
};

/* contact shadows — a real shadow map for thousands of instances is far too expensive
 * on a phone, and from directly above a soft disc offset along the sun reads the same */
{
  let total = 0;
  const src = meshes.filter(m => m.count > 300);
  for (const s of src) total += s.count;
  const geo = new THREE.CircleGeometry(1, 10); geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
    color: 0x24331a, transparent: true, opacity: 0.22, depthWrite: false }), total);
  const m = new THREE.Matrix4(), a = new THREE.Matrix4(),
        v = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let i = 0;
  for (const sm of src) for (let k = 0; k < sm.count; k++) {
    sm.getMatrixAt(k, a); a.decompose(v, q, s);
    v.x += 8 * s.x; v.z += 6 * s.x; v.y += 1.2;
    m.compose(v, new THREE.Quaternion(), new THREE.Vector3(s.x * 11, 1, s.x * 9));
    mesh.setMatrixAt(i++, m);
  }
  mesh.count = i; mesh.instanceMatrix.needsUpdate = true; mesh.renderOrder = -1;
  scene.add(mesh);
  counts.shadows = i;
}

/* -------------------------------------------------------------------- light */

scene.add(new THREE.HemisphereLight(0xf2fbe8, 0x5c6a4e, 3.1));
const sun = new THREE.DirectionalLight(0xfff6dc, 1.55);
sun.position.set(-300, 430, -210);          // upper left, as in the paintings
scene.add(sun);

/* ---------------------------------------------------------------- car + cam */

const carTex = tex.load('art/car.webp');
carTex.colorSpace = THREE.SRGBColorSpace;
const car = new THREE.Mesh(
  new THREE.PlaneGeometry(ROAD * 0.78, ROAD * 0.78 * (438 / 240)),
  new THREE.MeshBasicMaterial({ map: carTex, transparent: true }));
car.rotation.set(-Math.PI / 2, 0, Math.PI);
car.position.y = 16;
scene.add(car);

const cam = new THREE.OrthographicCamera(-FRAME / 2, FRAME / 2, ROWS / 2, -ROWS / 2, 1, 4000);
cam.position.y = 900;
cam.up.set(0, 0, -1);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));   // capping DPR is most of the mobile budget
document.body.appendChild(renderer.domElement);

/* ------------------------------------------------------- the section's scroll */

const SECTION = { scrollVh: 150, from: 0, to: LEN - ROWS * 1.15 };
let travel = 0;

function layout() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  /* fit width on a portrait phone, letterbox anything wider — either way the same
     amount of ground fills the screen */
  const scale = Math.min(w / FRAME, h / ROWS);
  const vw = w / scale, vh = h / scale;
  cam.left = -vw / 2; cam.right = vw / 2; cam.top = vh / 2; cam.bottom = -vh / 2;
  cam.updateProjectionMatrix();
  document.getElementById('spacer').style.height = (innerHeight * SECTION.scrollVh / 100) + 'px';
}
addEventListener('resize', layout);
layout();

function onScroll() {
  const px = innerHeight * SECTION.scrollVh / 100;
  const t = Math.min(1, Math.max(0, scrollY / px));
  const u = Math.min(1, t / DRIVE);
  const p = 1 - Math.pow(1 - u, 3);          // fast, then decelerating, then still
  travel = SECTION.from + (SECTION.to - SECTION.from) * p;
}
addEventListener('scroll', onScroll, { passive: true });
onScroll();

renderer.setAnimationLoop(() => {
  const z = travel + ROWS / 2;
  cam.position.z = z;
  cam.lookAt(0, 0, z);
  car.position.z = z + ROWS * (CAR_LINE - 0.5);
  renderer.render(scene, cam);
});

window.__stats = { ...counts, draws: () => renderer.info.render.calls,
                   tris: () => renderer.info.render.triangles };
