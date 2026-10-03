/* The glass event sheets (<dialog class="sheet"> in index.html), ported from
 * the root site's Sheets module (road.js). A native modal dialog gives focus
 * trapping, Esc and the top layer; on top of that:
 *   - the drive is frozen while one is open (scroll.lock), because every
 *     scroll px moves the car. Only a lock this module took is released:
 *     car/detour.js may already hold one for the whole detour.
 *   - close animates (Esc, ×, backdrop tap, swipe down on phones), then
 *     focus goes back to whatever opened the sheet.
 *   - a sakura branch blooms from two corners on every open.
 * open(id) → Promise resolving once that sheet has closed. */
import { scroll } from '../core/scroll.js';

const CLOSE_MS = 220;
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const state = new Map(); // dialog → {resolve[], opener, ownLock}

function setup() {
  document.querySelectorAll('dialog.sheet').forEach(d => {
    const a = d.querySelector('.sheet-directions');
    if (a && d.dataset.map) a.href = d.dataset.map;
    d.querySelector('.sheet-close')?.addEventListener('click', () => close(d));
    // a click whose target is the dialog itself landed on the backdrop; ignore
    // it just after opening, so the second click of a double-click on "Take me
    // here" (the sheet opens at once under reduced motion) doesn't shut it
    d.addEventListener('click', e => {
      if (e.target === d && performance.now() - (+d.dataset.openedAt || 0) > 500) close(d);
    });
    // Esc: run the same animated close instead of the instant native one
    d.addEventListener('cancel', e => { e.preventDefault(); close(d); });
    d.addEventListener('close', () => finish(d));
    swipe(d);
    d.insertAdjacentHTML('beforeend', bloom('tl') + bloom('br'));
  });
}

function open(id) {
  const d = document.getElementById(id);
  if (!d || typeof d.showModal !== 'function') return Promise.resolve();
  let st = state.get(d);
  if (d.open && st) return new Promise(r => st.resolve.push(r));
  st = { resolve: [], opener: document.activeElement, ownLock: false };
  state.set(d, st);
  if (!scroll.locked) { scroll.lock(); st.ownLock = true; }
  d.classList.remove('closing', 'dragged', 'dragging', 'settling');
  d.style.removeProperty('--drag');
  d.showModal();
  d.dataset.openedAt = String(performance.now());
  // start at the top and keep focus off the × so no ring flashes on a tap-open
  const body = d.querySelector('.sheet-body');
  if (body) body.scrollTop = 0;
  if (!matchMedia('(pointer: coarse)').matches) d.querySelector('.sheet-close')?.focus({ preventScroll: true });
  else { d.tabIndex = -1; d.focus({ preventScroll: true }); }
  return new Promise(r => st.resolve.push(r));
}

function close(d) {
  if (!d.open || d.classList.contains('closing')) return;
  if (RM.matches) { d.close(); return; }
  d.classList.add('closing');
  setTimeout(() => d.close(), CLOSE_MS);
}

function finish(d) {
  d.classList.remove('closing', 'dragged', 'dragging', 'settling');
  d.style.removeProperty('--drag');
  const st = state.get(d);
  if (!st) return;
  state.delete(d);
  if (st.ownLock) scroll.unlock();
  const o = st.opener;
  if (o && o !== document.body && o.isConnected && typeof o.focus === 'function') o.focus({ preventScroll: true });
  st.resolve.forEach(r => r());
}

/* Swipe the card down from the top of its content to dismiss. The card
 * follows the finger (resisting upward), snaps back under the threshold,
 * and a fast flick counts even if short. */
function swipe(d) {
  const body = d.querySelector('.sheet-body');
  let y0 = null, t0 = 0, dy = 0;
  d.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || (body && body.scrollTop > 0)) { y0 = null; return; }
    y0 = e.touches[0].clientY; t0 = performance.now(); dy = 0;
  }, { passive: true });
  d.addEventListener('touchmove', e => {
    if (y0 === null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0) { if (d.classList.contains('dragging')) d.style.setProperty('--drag', '0px'); return; }
    if (e.cancelable) e.preventDefault(); // the card moves, the body doesn't scroll
    d.classList.add('dragging');
    d.style.setProperty('--drag', dy.toFixed(1) + 'px');
  }, { passive: false });
  const end = () => {
    if (y0 === null) return;
    const v = dy / Math.max(1, performance.now() - t0); // px/ms
    y0 = null;
    if (!d.classList.contains('dragging')) return;
    if (dy > 110 || (dy > 40 && v > 0.6)) {
      d.classList.remove('dragging');
      d.classList.add('dragged');
      // pin the start of the sink transition at the finger's offset
      d.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => { d.style.transform = ''; close(d); });
    } else {
      d.classList.remove('dragging');
      d.classList.add('settling');
      setTimeout(() => d.classList.remove('settling'), 320);
    }
  };
  d.addEventListener('touchend', end);
  d.addEventListener('touchcancel', end);
}

/* A flowering sakura branch for one corner of the card — the same drawing as
 * road.js Sheets.bloom: one stem along the top edge, one down the left, twigs
 * off each, in a 220-unit box whose origin is the corner. The bottom-right
 * copy is turned 180deg by CSS and stops halfway so it clears the last
 * event's time. Each blossom's --d is when the creeping stem reaches it. */
function bloom(corner) {
  const PETAL = 'M0 0C-3.6-2.6-5.8-7.8-2.7-10.4L0-8.8 2.7-10.4C5.8-7.8 3.6-2.6 0 0Z';
  let STEMS = [
    ['M-6 8C40 4 70 22 110 16S165 24 208 15', 2.6, 0],
    ['M8-6C4 40 22 70 14 110S20 165 9 208', 2.4, .05],
    ['M56 15C63 22 70 28 79 33', 1.4, .4],
    ['M138 16C145 10 151 5 160 3', 1.3, .65],
    ['M15 56C22 63 28 68 38 72', 1.4, .4],
    ['M13 146C18 153 24 157 32 161', 1.2, .7]
  ];
  let BLOOMS = [
    [16, 14, 1.45], [38, 8, 1.15], [9, 38, 1.2], [30, 30, .9], [58, 21, .95],
    [81, 35, .9], [100, 15, 1.05], [126, 17, .82], [160, 4, .85], [185, 19, .75],
    [24, 57, .9], [40, 76, .95], [14, 99, 1], [10, 130, .8], [33, 163, .82],
    [16, 188, .7]
  ];
  let BUDS = [[207, 14], [8, 207], [69, 26], [146, 19], [6, 76], [22, 118], [112, 24], [26, 144]];
  const MAX_Y = corner === 'br' ? 112 : 220;
  if (corner === 'br') STEMS[1] = ['M8-6C4 40 22 70 14 110', 2.4, .05];
  const fits = p => p[1] <= MAX_Y;
  STEMS = STEMS.filter(s => !/^M13 146/.test(s[0]) || MAX_Y > 146);
  BLOOMS = BLOOMS.filter(fits);
  BUDS = BUDS.filter(fits);
  const at = (x, y) => (.45 + (x + y) / 240).toFixed(2) + 's';
  let svg = '<svg viewBox="0 0 220 220" aria-hidden="true" focusable="false">';
  STEMS.forEach(s => {
    svg += `<path class="stem" pathLength="1" d="${s[0]}" stroke-width="${s[1]}" style="--d:${(.15 + s[2]).toFixed(2)}s"/>`;
  });
  BLOOMS.forEach((b, i) => {
    let petals = '';
    for (let k = 0; k < 5; k++) {
      petals += `<path d="${PETAL}" transform="rotate(${k * 72})" fill="${k % 2 ? '#FAD9E2' : '#F6C4D2'}" stroke="#E597AE" stroke-width=".5"/>`;
    }
    let stamens = '';
    for (let m = 0; m < 5; m++) {
      const a = (m * 72 + 36) * Math.PI / 180;
      stamens += `<circle cx="${(Math.sin(a) * 3.6).toFixed(2)}" cy="${(-Math.cos(a) * 3.6).toFixed(2)}" r=".75" fill="#B8365C"/>`;
    }
    svg += `<g transform="translate(${b[0]} ${b[1]}) scale(${b[2]}) rotate(${i * 47 % 72})">` +
      `<g class="bl" style="--d:${at(b[0], b[1])}">${petals}<circle r="2.3" fill="#E0708F"/>${stamens}</g></g>`;
  });
  BUDS.forEach(b => {
    svg += `<g transform="translate(${b[0]} ${b[1]})"><g class="bl" style="--d:${at(b[0], b[1])}">` +
      '<ellipse rx="2.2" ry="3" fill="#E98AA7" stroke="#C9567A" stroke-width=".5"/></g></g>';
  });
  // loose petals drifting across the card — top-left only (the other branch is upside down)
  if (corner === 'tl') {
    [[40, 22, 2.2], [20, 70, 3.9], [100, 20, 5.4]].forEach(f => {
      svg += `<g transform="translate(${f[0]} ${f[1]}) scale(.6)"><path class="fall" d="${PETAL}" fill="#F6C4D2" style="--d:${f[2]}s"/></g>`;
    });
  }
  return `<div class="sheet-bloom sheet-bloom--${corner}" aria-hidden="true">${svg}</svg></div>`;
}

export const sheets = { setup, open, close };
