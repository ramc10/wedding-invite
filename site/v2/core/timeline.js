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
/** Each beach event has a paved forecourt (court) at road level just before
 *  its deck, where "Take me here" drives the car in (car/detour.js): off the
 *  road at s0, round to a stop facing the deck, and back out onto the road
 *  before the deck. The deck's entrance faces the court from the deck's near
 *  end (s = deck start). lat: road-relative, negative = sea side. */
export const COURTS = {};
for (const k of ['reception', 'haldi', 'muhurtham']) {
  const e = EVENTS[k], d0 = e.s - e.len / 2;
  COURTS[k] = { s0: d0 - 25, s1: d0 - 1, lat: [-5.9, -16.5] };
}

/** metres from (s, lateral) to the nearest event deck or court footprint (0 inside) */
export function eventDist(s, lateral) {
  let d = Infinity;
  for (const k of ['reception', 'haldi', 'muhurtham']) {
    const e = EVENTS[k];
    const ds = Math.max(0, Math.abs(s - e.s) - e.len / 2), dl = Math.max(0, lateral - e.lat[0], e.lat[1] - lateral);
    d = Math.min(d, Math.hypot(ds, dl));
    const c = COURTS[k];                                   // its forecourt counts too
    const cs = Math.max(0, c.s0 - s, s - c.s1), cl = Math.max(0, lateral - c.lat[0], c.lat[1] - lateral);
    d = Math.min(d, Math.hypot(cs, cl));
  }
  return d;
}
/** true if (s, lateral) falls on an event's footprint, grown by pad metres */
export function onEventSite(s, lateral, pad = 2) {
  for (const k of ['reception', 'haldi', 'muhurtham']) {
    const e = EVENTS[k];
    if (Math.abs(s - e.s) < e.len / 2 + pad && lateral < e.lat[0] + pad && lateral > e.lat[1] - pad) return true;
    const c = COURTS[k];
    if (s > c.s0 - pad && s < c.s1 + pad && lateral < c.lat[0] + pad && lateral > c.lat[1] - pad) return true;
  }
  const b = EVENTS.board;
  return Math.abs(s - b.s) < 4 + pad && Math.abs(lateral - b.lateral) < 3 + pad;
}

// AMR Unnati stands at road level just past the far end of the dam crest
// (not down in the valley under it), so the car can pull up beside it.
const karimS = Z.dam.s1 - 25;

/* "Take me here" routes, as [s, lateral] waypoints (car/detour.js runs a
 * smooth curve through them, starting from wherever the car is). in: from
 * the lane into the compound, ending at the stop. out: from the stop back to
 * the lane. cam: the raised, fixed viewpoint the camera glides to while the
 * car drives in and out ({s, lateral, h} above the road), aimed between the
 * car and focus (the venue). The callout ends before the route's first point. */
const eventStop = (id, label, sheet) => {
  const e = EVENTS[id], c = COURTS[id].s0, d0 = e.s - e.len / 2;
  return { id, s: e.s, slow: [c - 110, e.s + 20], callout: [c - 95, c - 20], sheet, label,
    venue: { s: e.s + 3, lateral: (e.lat[0] + e.lat[1]) / 2 }, pullover: { side: 'left', lateral: -4.9 },
    route: {
      in: [[c - 14, -1.8], [c - 4, -2.4], [c + 3, -6.6], [c + 8, -9.9], [c + 14, -10.8]],
      out: [[c + 14, -10.8], [c + 18.5, -10.2], [c + 21.5, -7.6], [c + 24.5, -4.4], [c + 31, -2.2], [c + 40, -1.8]]
    },
    cam: { s: c - 7, lateral: 4.2, h: 6.2 }, focus: { s: d0 + 6, lateral: -12.5, h: 1.8 } };
};

export const STOPS = [
  eventStop('reception', 'the Reception', 'sheetReception'),
  eventStop('haldi', 'the Haldi', 'sheetHaldi'),
  eventStop('muhurtham', 'the Muhurtham', 'sheetMuhurtham'),
  // AMR Unnati: in through the gate (s G, dam.js), round to the drop-off under the
  // hall's canopy, out through the exit gate further along (s G + 29)
  { id: 'karimnagar', s: karimS, slow: [karimS - 90, karimS + 50], callout: [karimS - 60, karimS + 26],
    sheet: 'sheetDam', label: 'AMR Unnati Convention',
    venue: { s: karimS + 68, lateral: 36 }, pullover: { side: 'right', lateral: 4.9 },
    park: { s: karimS + 40 },
    exitGate: { s: karimS + 48 + 29 },
    route: (G => ({
      // stops at the portal steps (portal centre ≈ G + 2.5), nose +s
      in: [[G - 16, -1.8], [G - 8, -0.6], [G - 4, 3.5], [G - 1.5, 8.5], [G - 0.3, 13], [G + 2, 17.2], [G + 6, 18.8]],
      out: [[G + 6, 18.8], [G + 13, 19.2], [G + 17, 19.6], [G + 23, 18], [G + 27, 14.5], [G + 29, 10.6], [G + 31, 6], [G + 35, 1.2], [G + 44, -1.8]]
    }))(karimS + 48),
    cam: { s: karimS + 48 - 8, lateral: -4.6, h: 6.8 }, focus: { s: karimS + 60, lateral: 26, h: 3.5 } }
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
