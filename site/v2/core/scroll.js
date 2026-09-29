/* Native page scroll → s (metres along the road).
 *
 * A tall #track element gives the page its height, so wheel, touch, keys,
 * scrollbar and screen readers all keep working. Scroll px map to s through
 * PACING (slower around stops), then the rendered s eases toward that target
 * so a hard fling reads as a drive rather than a teleport.
 *
 * API (frozen):
 *   scroll.s          rendered (damped) metres        scroll.sTarget  target metres
 *   scroll.v          rendered speed, m/s              scroll.progress s / END_S
 *   scroll.update(dt)
 *   scroll.lock() / scroll.unlock()   freeze page scroll (open sheets)
 *   scroll.goTo(s, smooth=true)       scroll the page to where s lives
 *   scroll.place(s)                   jump car + page to s at once (no easing back)
 *   scroll.cut        true for one frame after s jumped (camera snaps)
 *   scroll.autoplay(on)               drive by itself; any user input stops it
 *   scroll.onAutoplay(fn)             fn(on) when autoplay starts/stops
 */
import { PACING, END_S, STOPS } from './timeline.js';
import { damp, clamp } from './noise.js';

const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const track = document.getElementById('track');
const root = document.documentElement;

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

// piecewise-linear table of (s, px) — px per metre = base * weight
const KN = [];
function buildTable(base) {
  const edges = new Set([0, END_S]);
  PACING.forEach(p => { edges.add(clamp(p.from, 0, END_S)); edges.add(clamp(p.to, 0, END_S)); });
  const xs = [...edges].sort((a, b) => a - b);
  KN.length = 0;
  let px = 0;
  KN.push([0, 0]);
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1], b = xs[i], m = (a + b) / 2;
    const w = PACING.reduce((acc, p) => (m >= p.from && m < p.to ? Math.max(acc, p.weight) : acc), 1);
    px += (b - a) * base * w;
    KN.push([b, px]);
  }
}
const pxToS = px => {
  for (let i = 1; i < KN.length; i++) if (px <= KN[i][1]) {
    const [s0, p0] = KN[i - 1], [s1, p1] = KN[i];
    return s0 + (s1 - s0) * ((px - p0) / (p1 - p0 || 1));
  }
  return END_S;
};
const sToPx = s => {
  for (let i = 1; i < KN.length; i++) if (s <= KN[i][0]) {
    const [s0, p0] = KN[i - 1], [s1, p1] = KN[i];
    return p0 + (p1 - p0) * ((s - s0) / (s1 - s0 || 1));
  }
  return KN[KN.length - 1][1];
};

// Size against the large viewport height so the mobile address bar showing
// and hiding doesn't rescale the whole drive (same reason as road.js's lvh probe).
let vh = 0;
function measure() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;height:100lvh;width:0;visibility:hidden';
  document.body.appendChild(probe);
  const h = probe.offsetHeight || innerHeight;
  probe.remove();
  return h;
}
function layout() {
  const h = measure();
  // ignore toolbar-sized changes (mobile URL bar), re-layout on real resizes
  if (vh && Math.abs(h - vh) < 120 && Math.abs(h - vh) / vh < 0.2) return;
  const keep = state.sTarget;
  vh = h;
  buildTable(vh / 230);           // ~230 m of road per screen of scroll
  track.style.height = (KN[KN.length - 1][1] + vh) + 'px';
  if (keep > 0) scrollTo(0, sToPx(keep));
}

const state = { s: 0, sTarget: 0, v: 0, progress: 0, cut: false };
let locked = false, lockY = 0, auto = false, autoFns = [], autoPause = 0;
let lastY = 0;

// The scroll event only marks the position stale; scrollY is read once, at
// the top of the next frame (scroll.update runs before anything writes
// styles, so layout is still clean and the read is free). Reading it inside
// the event forced a synchronous layout on every scroll. While autoplaying,
// the position is the one stepAutoplay just set, so it isn't read at all.
let curY = 0, stale = false;
addEventListener('scroll', () => { stale = true; }, { passive: true });
function readTarget() {
  if (stale && !auto) curY = scrollY;
  stale = false;
  state.sTarget = pxToS(Math.max(0, curY));
}

function update(dt) {
  if (!locked) readTarget();
  if (auto) stepAutoplay(dt);
  const prev = state.s;
  // a jump too far to drive (scrollbar drag, restore, goTo(…, false)): cut, don't race
  state.cut = Math.abs(state.sTarget - state.s) > 350;
  if (state.cut) state.s = state.sTarget;
  state.s = RM ? state.sTarget : state.s + (state.sTarget - state.s) * damp(3, dt);
  if (Math.abs(state.sTarget - state.s) < 0.001) state.s = state.sTarget;
  state.v = dt > 0 ? (state.s - prev) / dt : 0;
  state.progress = state.s / END_S;
}

function lock() {
  if (locked) return;
  locked = true; lockY = scrollY;
  root.classList.add('scroll-locked');
  document.body.style.top = -lockY + 'px';
}
function unlock() {
  if (!locked) return;
  locked = false;
  root.classList.remove('scroll-locked');
  document.body.style.top = '';
  scrollTo(0, lockY);
}

/** Put the drive at s immediately: rendered s, target and page position all
 *  agree, so nothing eases back afterwards. Works while locked (the page
 *  lands there on unlock). */
function place(s) {
  s = clamp(s, 0, END_S);
  state.s = state.sTarget = s;
  const y = sToPx(s);
  curY = y;
  if (locked) { lockY = y; document.body.style.top = -y + 'px'; } else scrollTo(0, y);
}

function goTo(s, smooth = true) {
  scrollTo({ top: sToPx(clamp(s, 0, END_S)), behavior: smooth && !RM ? 'smooth' : 'auto' });
}

// Autoplay: advance the page scroll at cruising speed, pause at each stop.
// s follows curY every frame; the page itself is scrolled there ~10 times a
// second (and at stops, and when autoplay ends): scrollTo every frame made
// the browser lay out and dispatch a scroll event each frame.
const CRUISE = 22; // m/s
let syncT = 0, pageY = 0;
function syncPage() { syncT = 0; if (Math.abs(pageY - curY) > 0.5) { pageY = curY; scrollTo(0, curY); } }
function stepAutoplay(dt) {
  if (autoPause > 0) { autoPause -= dt; return; }
  const s = state.sTarget;
  const stop = STOPS.find(st => s < st.s && s + CRUISE * dt >= st.s);
  const next = Math.min(END_S, s + CRUISE * dt * (PACING.some(p => s >= p.from && s < p.to) ? 0.45 : 1));
  lastY = sToPx(stop ? stop.s : next);
  curY = lastY;
  syncT += dt;
  if (stop || syncT > 0.1) syncPage();
  if (stop) autoPause = 4;
  if (next >= END_S) autoplay(false);
}
function autoplay(on) {
  if (auto === !!on) return;
  auto = !!on; autoPause = 0;
  if (auto) { curY = pageY = scrollY; stale = false; syncT = 0; }   // start from where the page is
  else syncPage();                                           // leave the page where the car is
  autoFns.forEach(f => f(auto));
}
['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(ev =>
  addEventListener(ev, e => {
    if (!auto) return;
    if (e.target.closest && e.target.closest('[data-autoplay]')) return;
    autoplay(false);
  }, { passive: true }));

addEventListener('resize', layout);
layout();
scrollTo(0, 0);

export const scroll = {
  get s() { return state.s; },
  get sTarget() { return state.sTarget; },
  get v() { return state.v; },
  get progress() { return state.progress; },
  get locked() { return locked; },
  get cut() { return state.cut; },   // true on the frame s jumped instead of easing
  get autoplaying() { return auto; },
  update, lock, unlock, goTo, place, autoplay,
  onAutoplay(fn) { autoFns.push(fn); },
  sToPx, pxToS
};
