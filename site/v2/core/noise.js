/* Deterministic noise + seeded RNG shared by every module that places or
 * shapes things. Same inputs → same world on every device and every reload,
 * so terrain height sampled by the terrain mesh, a biome planting trees and
 * the camera's ground clamp all agree. */

export function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = t => t * t * (3 - 2 * t);

/** Value noise in [0,1). */
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = fade(x - xi), yf = fade(y - yi);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

/** Fractal noise in roughly [-1,1]. */
export function fbm(x, y, oct = 4) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    v += (noise2(x * f, y * f) * 2 - 1) * amp;
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return v / norm;
}

/** mulberry32 — seeded RNG, returns () => [0,1). */
export function rng(seed) {
  let a = typeof seed === 'string'
    ? [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)
    : seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Frame-rate independent damping factor: x += (target-x) * damp(k, dt). */
export const damp = (k, dt) => 1 - Math.exp(-k * dt);
