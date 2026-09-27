/* The loader: an ensō brushed round as boot reports progress, then a fade
 * into the scene. Runs at import time, because main.js starts dispatching
 * 'v2:progress' before ui.init() is ever called.
 *
 * Events (window): 'v2:progress' {detail: 0..1}, 'v2:ready', 'v2:error'.
 * html.ready is the one switch the CSS keys on: loader out, canvas in from
 * black, HUD up. */
const root = document.documentElement;
const loader = document.getElementById('loader');
const reveal = loader && loader.querySelector('.enso-reveal');
const status = document.getElementById('loaderStatus');
// failures ('v2:error', a module that fails to link, no WebGL) are handled by
// the inline script in index.html, which runs even when this module can't

let shown = 0;
// The stroke only ever moves forward: progress can arrive out of order from
// async biome builds, and a brush doesn't un-paint.
function onProgress(e) {
  const p = Math.max(0, Math.min(1, +e.detail || 0));
  if (p <= shown) return;
  shown = p;
  // keep a sliver of stroke even at 0 so the first frame shows a brush touch
  if (reveal) reveal.style.strokeDashoffset = String(1 - (0.03 + 0.97 * p));
  if (status) status.textContent = p < 0.25 ? 'Setting out…' : p < 0.8 ? 'Planting the road…' : 'Almost there…';
}

function onReady() {
  if (reveal) reveal.style.strokeDashoffset = '0';
  // let the brush close its last few degrees before the fade starts
  setTimeout(() => {
    root.classList.add('ready');
    if (loader) loader.setAttribute('aria-hidden', 'true');
    setTimeout(() => loader && loader.remove(), 1800);
  }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450);
}

addEventListener('v2:progress', onProgress);
addEventListener('v2:ready', onReady, { once: true });
