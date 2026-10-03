/* Text over the drive, keyed to s (core/timeline.js OVERLAYS): each block
 * fades in with a small rise and a blur that clears, and leaves the same way.
 * Written per frame from the damped s, so a slow scroll gives a slow fade and
 * nothing depends on CSS transitions catching up.
 *
 * Also here: the "Take me here" callouts (STOPS[].callout), the opening
 * scroll cue, the "move forward" hint shown back on the road after a detour,
 * and html.at-end (the credit steps forward at the ending).
 *
 * After a detour its callout stays down while the car is still within that
 * stop's callout span (it'd offer the same venue straight back); leaving the
 * span either way re-arms it. */
import { OVERLAYS, STOPS, END_S } from '../core/timeline.js';
import { smoothstep } from '../core/noise.js';

const RM = matchMedia('(prefers-reduced-motion: reduce)');
let rm = RM.matches;   // cached: reading .matches every frame can make the browser re-evaluate styles
RM.addEventListener('change', () => { rm = RM.matches; });
const RISE = 14;   // px the text travels while fading
const BLUR = 6;    // px of blur at zero opacity

const blocks = [];      // {el, last}
const callouts = [];    // {el, stop, on, done}
let cue = null, cueGone = false, atEnd = null, scroll = null, busy = false;
let cueNext = null, nextAt = null, nextOn = false;   // nextAt: s the car came back to the road at
let detourMod = null;

function init(ctx) {
  scroll = ctx && ctx.scroll;
  OVERLAYS.forEach(o => o.els.forEach(id => {
    const el = document.getElementById(id);
    if (el) blocks.push({ el, o, last: -1, vis: null, tf: null, fl: null });
  }));

  STOPS.forEach(stop => {
    const el = document.getElementById('callout-' + stop.id);
    if (!el) return;
    el.setAttribute('aria-label', 'Take me to ' + stop.label);
    const c = { el, stop, on: false, done: false };
    el.addEventListener('click', () => go(c));
    callouts.push(c);
  });

  cue = document.getElementById('cue');
  // tapping the hint shows what a scroll does: the car rolls off the title
  if (cue && scroll) cue.addEventListener('click', () => scroll.goTo(45));

  cueNext = document.getElementById('cueNext');
  if (cueNext && scroll) cueNext.addEventListener('click', () => scroll.goTo(scroll.sTarget + 40));
}

async function go(c) {
  const { stop, el } = c;
  if (busy) return;
  busy = true;
  window.track('take_me_here', { venue: stop.id });
  try {
    detourMod = detourMod || (await import('../car/detour.js')).detour;
    await detourMod.go(stop);
    c.done = true;                                // back on the road: don't offer it again here
    nextAt = scroll ? scroll.sTarget : null;
  } catch (e) {
    console.error('[v2] detour failed', e);
  } finally {
    busy = false;
    // the sheet hands focus back to its opener; if the detour hid the callout
    // meanwhile that focus fell to <body>, so put it back once the callout is up
    const a = document.activeElement;
    if (!a || a === document.body) {
      if (el.classList.contains('on')) el.focus({ preventScroll: true });
      else if (nextAt != null && cueNext) { cueNext.tabIndex = 0; cueNext.focus({ preventScroll: true }); }
    }
  }
}

function update(dt, s) {
  for (const b of blocks) {
    const o = b.o;
    const a = Math.min(smoothstep(o.from - o.fade, o.from, s), 1 - smoothstep(o.to, o.to + (o.fadeOut ?? o.fade), s));
    const q = Math.round(a * 500) / 500;          // skip style writes when nothing visible changes
    if (q === b.last) continue;
    b.last = q;
    const st = b.el.style;
    st.opacity = q.toFixed(3);
    // the other properties are written only when their strings change
    const vis = q > 0.002 ? 'visible' : 'hidden';
    if (vis !== b.vis) st.visibility = b.vis = vis;
    if (rm) continue;
    const k = 1 - q;
    // leaving (past `to`) drifts up, arriving rises from below — a sense of travel
    const dir = s > o.to ? -1 : 1;
    const tf = k > 0.002 ? `translate3d(0, ${(dir * k * RISE).toFixed(2)}px, 0)` : '';
    const fl = k > 0.02 ? `blur(${(k * k * BLUR).toFixed(2)}px)` : '';
    if (tf !== b.tf) st.transform = b.tf = tf;
    if (fl !== b.fl) st.filter = b.fl = fl;
  }

  const detourOn = !!(detourMod && detourMod.active);
  for (const c of callouts) {
    const inSpan = s > c.stop.callout[0] && s < c.stop.callout[1];
    if (!inSpan && !detourOn) c.done = false;
    const on = !detourOn && inSpan && !c.done;
    if (on === c.on) continue;
    c.on = on;
    c.el.classList.toggle('on', on);
    c.el.tabIndex = on ? 0 : -1;
    if (on) c.el.removeAttribute('aria-hidden'); else c.el.setAttribute('aria-hidden', 'true');
  }

  // the hint stays until the car moves on (or back), or a guided drive starts
  if (nextAt != null && !detourOn && (Math.abs(s - nextAt) > 4 || (scroll && scroll.gliding))) nextAt = null;
  const nOn = nextAt != null && !detourOn;
  if (cueNext && nOn !== nextOn) {
    nextOn = nOn;
    cueNext.classList.toggle('on', nOn);
    cueNext.tabIndex = nOn ? 0 : -1;
    if (nOn) cueNext.removeAttribute('aria-hidden'); else cueNext.setAttribute('aria-hidden', 'true');
  }

  if (cue && !cueGone && s > 6) {
    cueGone = true;
    cue.classList.add('gone');
  }

  const end = s > END_S - 260;
  if (end !== atEnd) { atEnd = end; document.documentElement.classList.toggle('at-end', end); }
}

export const overlays = { init, update };
