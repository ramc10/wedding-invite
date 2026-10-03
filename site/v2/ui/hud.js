/* HUD: the guided drive ("Next: <event>") and the route indicator.
 *
 * Guide: one stop per event, in route order (core/timeline.js), each placed
 * where its caption is in and its "Take me here" is up, then the ending. The
 * button names the next one past the car; pressing it glides there
 * (scroll.glideTo). It carries data-guide so pressing it doesn't count as the
 * input that stops a glide. Past the ending it offers the start again.
 *
 * Route: one dot per leg (core/zones.js ZONES), placed along a hairline in
 * proportion to where each leg starts; the gold fill tracks s. A dot scrolls
 * the page to the start of its leg. */
import { ZONES, zoneAt } from '../core/zones.js';
import { STOP, SITES, END_S } from '../core/timeline.js';

const GUIDE = [
  { id: 'reception', name: 'Reception', to: 'the Reception', s: SITES.reception.a - 45 },
  { id: 'haldi', name: 'Haldi', to: 'the Haldi', s: SITES.haldi.a - 45 },
  { id: 'muhurtham', name: 'Muhurtham', to: 'the Muhurtham', s: SITES.muhurtham.a - 45 },
  { id: 'dawat', name: 'Dawat', to: 'the Dawat', s: STOP.karimnagar.s - 30 },
  { id: 'ending', name: 'The Beginning', to: 'the end', s: END_S }
];

const NAMES = {
  forest: 'Forest', garden: 'Garden', 'garden-beach': 'Beach', cove: 'Vizag',
  hills: 'Hills', dam: 'Karimnagar', creek: 'The creek'
};

let scroll = null, fill = null, dots = [], cur = -1, lastP = -1, total = 1;
let guideBtn = null, guideLabel = null, guideKey = '', target = null;

/** the first guide stop ahead of s (null past the ending) */
const nextStop = s => GUIDE.find(g => g.s > s + 8) || null;

function init(ctx) {
  scroll = ctx.scroll;

  guideBtn = document.getElementById('guideNext');
  if (guideBtn && scroll) {
    guideLabel = guideBtn.querySelector('span');
    guideBtn.addEventListener('click', () => {
      if (scroll.gliding) { scroll.stopGlide(); return; }
      const g = nextStop(scroll.sTarget);
      if (window.track) window.track('guide_next', { to: g ? g.id : 'start' });
      if (!g) { scroll.goTo(0, false); return; }        // past the ending: back to the start
      target = g;
      scroll.glideTo(g.s, () => { target = null; });
    });
    scroll.onGlide(on => { if (!on) target = null; guideKey = ''; });
  }

  const nav = document.getElementById('route');
  if (!nav || !scroll) return;
  total = ZONES[ZONES.length - 1].s1;
  const line = document.createElement('div');
  line.className = 'route-line';
  fill = document.createElement('div');
  fill.className = 'route-fill';
  line.appendChild(fill);
  nav.appendChild(line);
  dots = ZONES.map((z, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'route-dot';
    const name = NAMES[z.id] || z.id;
    b.setAttribute('aria-label', `Leg ${i + 1} of ${ZONES.length}: ${name}`);
    b.innerHTML = `<span aria-hidden="true">${name}</span>`;
    // 11px inset each end matches .route-line, so dot centres sit on the line
    b.style.left = `calc(11px + (100% - 22px) * ${(z.s0 / total).toFixed(4)})`;
    b.addEventListener('click', () => scroll.goTo(i === 0 ? 0 : z.s0 + 12));
    nav.appendChild(b);
    return b;
  });
}

function updateGuide(s) {
  if (!guideBtn) return;
  const g = target || nextStop(s), on = scroll.gliding, off = scroll.locked;
  const key = `${g ? g.id : '-'}|${on}|${off}`;
  if (key === guideKey) return;
  guideKey = key;
  const text = on ? `To ${g.to}…` : g ? `Next: ${g.name}` : 'Back to start';
  guideLabel.textContent = text;
  guideBtn.setAttribute('aria-label', on ? `Stop driving to ${g.to}` : g ? `Drive to ${g.to}` : 'Back to the start');
  guideBtn.setAttribute('aria-pressed', String(on));
  guideBtn.disabled = off;
}

function update(dt, s) {
  updateGuide(s);
  if (!fill) return;
  const p = Math.round(Math.max(0, Math.min(1, s / total)) * 1000) / 1000;
  if (p !== lastP) { lastP = p; fill.style.transform = `scaleX(${p})`; }
  const i = ZONES.indexOf(zoneAt(s));
  if (i === cur) return;
  cur = i;
  dots.forEach((d, k) => {
    d.classList.toggle('on', k === i);
    d.classList.toggle('past', k < i);
    if (k === i) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current');
  });
}

export const hud = { init, update };
