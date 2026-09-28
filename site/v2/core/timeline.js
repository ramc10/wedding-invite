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

const vizagS = at('cove', 0.5);
// AMR Unnati stands at road level just past the far end of the dam crest
// (not down in the valley under it), so the car can pull up beside it.
const karimS = Z.dam.s1 - 25;

export const STOPS = [
  { id: 'vizag', s: vizagS, slow: [vizagS - 90, vizagS + 50], callout: [vizagS - 60, vizagS + 30],
    sheet: 'sheetBeach', label: 'Palm Beach Hotel',
    venue: { s: vizagS + 25, lateral: -46 }, pullover: { side: 'left', lateral: -4.9 },
    park: { s: vizagS + 12 } },
  { id: 'karimnagar', s: karimS, slow: [karimS - 90, karimS + 50], callout: [karimS - 60, karimS + 30],
    sheet: 'sheetDam', label: 'AMR Unnati Convention',
    venue: { s: karimS + 68, lateral: 36 }, pullover: { side: 'right', lateral: 4.9 },
    park: { s: karimS + 40 } }
];

export const OVERLAYS = [
  { id: 'title', els: ['title', 'titleVenue'], from: -1e9, to: at('garden', 0.3), fade: 40 },   // gone before the garden opens up
  { id: 'vizag', els: ['details', 'venue'], from: at('cove', 0.12), to: at('cove', 0.92), fade: 40 },    // leaves with the coast
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
