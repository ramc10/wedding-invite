/* Device tier + adaptive resolution. tier: 'low' | 'med' | 'high'.
 * Modules read quality.tier to size instance counts; quality.dpr is the
 * pixel ratio, set once at boot. tick() nudges the render scale from frame
 * time (valley's scheme: average 60 frames, step down fast, recover slowly).
 * The scale never touches the canvas or the render targets: fx/post.js draws
 * the scene into a scale-sized viewport of fixed-size targets and stretches
 * it in the composite, so a step costs nothing (resizing the targets
 * reallocated every one of them, a visible hitch at each step).
 * The perf pass (P6) owns this file. */
const UA = navigator.userAgent;
const mobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/.test(UA);
const cores = navigator.hardwareConcurrency || 4;

/* Phones are tiered by their GPU, not their core count (iPhones report few
 * cores however fast they are). iOS only says "Apple GPU": iOS 15+ (A12 or
 * newer in practice) is 'med'. Android names the GPU: recent Adreno (6xx
 * from 640 up, 7xx, 8xx), Mali-G7x/G710+ and Xclipse are 'med'; unknown
 * GPUs fall back to memory and cores. ?tier=low|med|high forces one (QA). */
function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl ? gl.getParameter(gl.RENDERER) : '');
    gl && gl.getExtension('WEBGL_lose_context')?.loseContext();
    return String(name || '');
  } catch (e) { return ''; }
}
function phoneTier(gpu) {
  const ios = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
  if (ios) { const v = +(UA.match(/OS (\d+)_/) || [])[1] || 0; return v >= 15 || /Apple GPU/.test(gpu) && v === 0 ? 'med' : 'low'; }
  const adreno = +(gpu.match(/Adreno[^\d]*(\d{3})/) || [])[1] || 0;
  if (adreno) return adreno >= 640 ? 'med' : 'low';
  if (/Mali-G(7[1-9]\d|[89]\d{2}|7[6-9])|Immortalis|Xclipse/.test(gpu)) return 'med';
  const mem = navigator.deviceMemory || 0;
  return (mem >= 6 || cores >= 8) ? 'med' : 'low';
}
const forced = new URLSearchParams(location.search).get('tier');
const gpu = mobile ? gpuName() : '';
const tier = ['low', 'med', 'high'].includes(forced) ? forced : mobile ? phoneTier(gpu) : 'high';
// sharper on phones than before (they were capped at 1.5x of a 3x screen)
const maxDpr = tier === 'low' ? 1.5 : 2;
const dpr = Math.min(devicePixelRatio || 1, maxDpr);

let acc = 0, frames = 0, scale = 1, fps = 0;
function tick(dt) {
  acc += dt; frames++;
  if (frames < 60) return;
  const ms = (acc / frames) * 1000; acc = 0; frames = 0;
  let next = scale;
  // step down only when frames are clearly slow (under ~35 fps), never below 75%
  if (ms > 45) next *= 0.88; else if (ms > 28.5) next *= 0.94; else if (ms < 20) next += 0.05;
  scale = Math.max(0.75, Math.min(1, next));
  fps = Math.round(1000 / ms);
}

export const quality = { tier, mobile, dpr, gpu, tick, get scale() { return scale; }, get fps() { return fps; } };
