/* Device tier + adaptive resolution. tier: 'low' | 'med' | 'high'.
 * Modules read quality.tier to size instance counts; quality.dpr is the
 * starting pixel ratio. tick() nudges the render scale from frame time
 * (valley's scheme: average 60 frames, step down fast, recover slowly).
 * The perf pass (P6) owns this file. */
const mobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/.test(navigator.userAgent);
const cores = navigator.hardwareConcurrency || 4;
const tier = mobile ? (cores >= 8 ? 'med' : 'low') : 'high';
const maxDpr = tier === 'high' ? 2 : 1.5;
const dpr = Math.min(devicePixelRatio || 1, maxDpr);

let acc = 0, frames = 0, scale = 1;
function tick(dt, renderer) {
  acc += dt; frames++;
  if (frames < 60) return;
  const ms = (acc / frames) * 1000; acc = 0; frames = 0;
  let next = scale;
  if (ms > 45) next *= 0.84; else if (ms > 23.5) next *= 0.92; else if (ms < 17.6) next += 0.05;
  next = Math.max(0.6, Math.min(1, next));
  if (Math.abs(next - scale) > 0.01) { scale = next; renderer.setPixelRatio(dpr * scale); }
}

export const quality = { tier, mobile, dpr, tick, get scale() { return scale; } };
