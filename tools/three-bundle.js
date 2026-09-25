/* Entry for site/vendor/three.min.js — a self-hosted, tree-shaken Three.js
 * r128 holding only what road.js and petals.js use, exposed on window.THREE
 * the same way the CDN's three.min.js + examples/js loaders were.
 *
 * Self-hosted rather than jsDelivr: one fewer origin to connect to on a phone,
 * and no third-party script between the guest and the car. Tree-shaken rather
 * than the full build: the full three.min.js is ~600KB of which the site used
 * well under half.
 *
 * Add a symbol here before using a new THREE.* anywhere on the site — anything
 * not listed is simply undefined at runtime. Rebuild with:
 *
 *   npm i --no-save three@0.128.0 esbuild
 *   npx esbuild tools/three-bundle.js --bundle --minify --format=iife \
 *     --target=es2017 --legal-comments=none --outfile=site/vendor/three.min.js
 *   cp node_modules/three/examples/js/libs/draco/draco_{decoder.wasm,wasm_wrapper.js} site/vendor/draco/
 */
import {
  ACESFilmicToneMapping, AmbientLight, Box3, CanvasTexture, DirectionalLight,
  DoubleSide, Float32BufferAttribute, Group, InstancedBufferAttribute,
  InstancedBufferGeometry, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial,
  MeshToonMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry,
  Raycaster, Scene, ShaderMaterial, SphereGeometry, sRGBEncoding, Vector3,
  WebGLRenderer
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

window.THREE = {
  ACESFilmicToneMapping, AmbientLight, Box3, CanvasTexture, DirectionalLight,
  DoubleSide, Float32BufferAttribute, Group, InstancedBufferAttribute,
  InstancedBufferGeometry, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial,
  MeshToonMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry,
  Raycaster, Scene, ShaderMaterial, SphereGeometry, sRGBEncoding, Vector3,
  WebGLRenderer, GLTFLoader, DRACOLoader
};
