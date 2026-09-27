/* HUD: the "Drive for me" toggle and the route indicator.
 *
 * Autoplay: the button drives scroll.autoplay(); state comes back through
 * scroll.onAutoplay, since any wheel/touch/key stops autoplay from inside
 * scroll.js. The button carries data-autoplay so pressing it doesn't count
 * as that interrupting input.
 *
 * Route: one dot per leg (core/zones.js ZONES), placed along a hairline in
 * proportion to where each leg starts; the gold fill tracks s. A dot scrolls
 * the page to the start of its leg. */
import { ZONES, zoneAt } from '../core/zones.js';

const NAMES = {
  forest: 'Forest', garden: 'Garden', 'garden-beach': 'Beach', cove: 'Vizag',
  hills: 'Hills', dam: 'Karimnagar', creek: 'The creek'
};

let scroll = null, fill = null, dots = [], cur = -1, lastP = -1, total = 1;

function init(ctx) {
  scroll = ctx.scroll;

  const btn = document.getElementById('autoplay');
  if (btn && scroll) {
    const label = btn.querySelector('span');
    const reflect = on => {
      btn.setAttribute('aria-pressed', String(on));
      if (label) label.textContent = on ? 'Driving…' : 'Drive for me';
      btn.setAttribute('aria-label', on ? 'Stop driving' : 'Drive for me');
    };
    btn.addEventListener('click', () => {
      const on = !scroll.autoplaying;
      // from the very end, start the drive over
      if (on && scroll.progress > 0.985) scroll.goTo(0, false);
      scroll.autoplay(on);
    });
    scroll.onAutoplay(reflect);
    reflect(scroll.autoplaying);
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
    b.addEventListener('click', () => {
      scroll.autoplay(false);
      scroll.goTo(i === 0 ? 0 : z.s0 + 12);
    });
    nav.appendChild(b);
    return b;
  });
}

function update(dt, s) {
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
