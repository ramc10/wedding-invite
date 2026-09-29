/* What happens where along the drive. Positions are in s (metres); they are
 * derived from zone extents so that re-shaping the path keeps copy on the
 * right leg.
 *
 * overlay: DOM elements (by id) faded in over [from, to], `fade` metres each end.
 * stop:    an event venue. The road slows over `slow` (see scroll.js), a
 *          "Take me here" callout shows over `callout`, and tapping it runs
 *          the detour (car/detour.js) and opens `sheet`.
 *          venue: where the landmark building stands, in road coords
 *                 {s, lateral} — biomes build it there, the camera frames it.
 *          pullover: the shoulder the car parks on; park.s: where along the road it stops
 *                 (the detour drives there from wherever the car is when tapped).
 */
import { byId } from './zones.js';
import { path } from './path.js';

const Z = byId;
const at = (id, u) => Z[id].s0 + (Z[id].s1 - Z[id].s0) * u;

// The Vizag leg is a journey along Beach Road: the Palm Beach Hotel board on
// the right, then the three events on the sand to the left, in order.
// Each scene stands on a level deck spanning `lat` (road-relative metres,
// negative = left/sea side) and s ± len/2. biomes/events/*.js build them,
// and the beach legs keep their palms, grass and props off these footprints.
export const EVENTS = {
  board:     { s: 572, lateral: 9.5 },
  reception: { s: 730, lat: [-7.4, -21], len: 30 },
  haldi:     { s: 990, lat: [-7.4, -21], len: 26 },
  muhurtham: { s: 1200, lat: [-7.4, -21], len: 28 }
};
/** metres from (s, lateral) to the nearest event deck footprint (0 inside) */
export function eventDist(s, lateral) {
  let d = Infinity;
  for (const k of ['reception', 'haldi', 'muhurtham']) {
    const e = EVENTS[k];
    const ds = Math.max(0, Math.abs(s - e.s) - e.len / 2), dl = Math.max(0, lateral - e.lat[0], e.lat[1] - lateral);
    d = Math.min(d, Math.hypot(ds, dl));
  }
  return d;
}
/** true if (s, lateral) falls on an event's footprint, grown by pad metres */
export function onEventSite(s, lateral, pad = 2) {
  for (const k of ['reception', 'haldi', 'muhurtham']) {
    const e = EVENTS[k];
    if (Math.abs(s - e.s) < e.len / 2 + pad && lateral < e.lat[0] + pad && lateral > e.lat[1] - pad) return true;
  }
  const b = EVENTS.board;
  return Math.abs(s - b.s) < 4 + pad && Math.abs(lateral - b.lateral) < 3 + pad;
}

// AMR Unnati stands at road level just past the far end of the dam crest
// (not down in the valley under it), so the car can pull up beside it.
const karimS = Z.dam.s1 - 25;

const eventStop = (id, label, sheet) => {
  const e = EVENTS[id];
  return { id, s: e.s, slow: [e.s - 90, e.s + 50], callout: [e.s - 60, e.s + 30], sheet, label,
    venue: { s: e.s + 3, lateral: (e.lat[0] + e.lat[1]) / 2 }, pullover: { side: 'left', lateral: -4.9 },
    park: { s: e.s - 8 } };
};

export const STOPS = [
  eventStop('reception', 'the Reception', 'sheetReception'),
  eventStop('haldi', 'the Haldi', 'sheetHaldi'),
  eventStop('muhurtham', 'the Muhurtham', 'sheetMuhurtham'),
  { id: 'karimnagar', s: karimS, slow: [karimS - 90, karimS + 50], callout: [karimS - 60, karimS + 30],
    sheet: 'sheetDam', label: 'AMR Unnati Convention',
    venue: { s: karimS + 68, lateral: 36 }, pullover: { side: 'right', lateral: 4.9 },
    park: { s: karimS + 40 } }
];
export const STOP = Object.fromEntries(STOPS.map(s => [s.id, s]));

const cap = (id, els) => ({ id, els, from: EVENTS[id].s - 55, to: EVENTS[id].s + 45, fade: 30 });
export const OVERLAYS = [
  { id: 'title', els: ['title', 'titleVenue'], from: -1e9, to: at('garden', 0.3), fade: 40 },   // gone before the garden opens up
  { id: 'vizag', els: ['venue'], from: EVENTS.board.s - 10, to: EVENTS.muhurtham.s + 70, fade: 40 },  // the hotel, the whole way along the beach
  cap('reception', ['capReception']),
  cap('haldi', ['capHaldi']),
  cap('muhurtham', ['capMuhurtham']),
  { id: 'karimnagar', els: ['damCaption', 'damVenue'], from: at('dam', 0.12), to: at('creek', 0.18), fade: 40 },
  { id: 'ending', els: ['ending', 'endingVenue'], from: at('creek', 0.3), to: 1e9, fade: 60 }
];

/** Scroll pacing knots: extra scroll distance per metre inside these spans. */
export const PACING = [
  { from: 0, to: 40, weight: 4 },                      // linger on the title
  ...STOPS.map(st => ({ from: st.slow[0], to: st.slow[1], weight: 3.2 })),
  { from: path.length - 60, to: path.length, weight: 3 } // settle into the ending
];

export const END_S = path.length - 8;
