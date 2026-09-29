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
  board:     { s: 442, lateral: 9.5 },
  reception: { s: 600, lat: [-6.8, -20.2], len: 30 },
  haldi:     { s: 860, lat: [-6.8, -20.2], len: 26 },
  muhurtham: { s: 1070, lat: [-6.8, -20.2], len: 28 }
};/** Each beach event has a paved forecourt (court) at road level just before
 *  its deck, where "Take me here" drives the car in (car/detour.js): off the
 *  road at s0, round to a stop facing the deck, and back out onto the road
 *  before the deck. The deck's entrance faces the court from the deck's near
 *  end (s = deck start). lat: road-relative, negative = sea side. */
/* SITES: each beach venue is one site laid out on a single procession
 * axis along the road, at lateral AX. From the road: a 30 m arrival forecourt
 * (a looped drive round a planted island, drop-off on the axis), then the
 * entrance arch at the deck's edge, the aisle down the deck, and the stage
 * at the far end, the sea on the left. Every module builds from these numbers
 * (road coords: s along the road, lateral negative = sea side):
 *   ax        axis lateral
 *   a, d0, d1 arrival start, deck start (arch line), deck end
 *   gateIn, gateOut  gate centres (s) in the road wall at lateral WALL
 *   stop      drop-off, on the axis (the car's nose points at the arch, 16 m on)
 *   island    {s, l, rs, rl}: the planted oval inside the loop (road side of the axis)
 *   garden    {s0, s1, l0, l1}: welcome garden, sea side of the drive
 *   stage     {s, depth}: stage / mandap centre on the axis and its depth along s
 *   aisle     width of the aisle on the axis */
/** A drivable route from straights and circular arcs, as dense [s, lateral] points (every ~1 m),
 *  starting at (s, l) heading along the road (+s). ops: ['S', metres] straight, ['A', radius, degrees]
 *  an arc (positive degrees turn toward +lateral, the right). A real car's turning circle is ~5.3 m. */
export function arcRoute(s, l, ops) {
  const pts = [[s, l]]; let h = 0;
  for (const op of ops) {
    if (op[0] === 'S') { const n = Math.max(1, Math.round(op[1])); for (let i = 0; i < n; i++) { s += Math.cos(h) * op[1] / n; l += Math.sin(h) * op[1] / n; pts.push([s, l]); } }
    else { const [, R, deg] = op, th = deg * Math.PI / 180, n = Math.max(2, Math.round(Math.abs(th) * R)); for (let i = 0; i < n; i++) { h += th / n; s += Math.cos(h) * Math.abs(th) * R / n; l += Math.sin(h) * Math.abs(th) * R / n; pts.push([s, l]); } }
  }
  return pts;
}
// an S-bend of two equal arcs, radius R, moving the car D metres sideways (sign = direction) while
// keeping its heading: returns the ops and its length along the road
function sBend(D, R) {
  const th = Math.acos(1 - Math.abs(D) / (2 * R)), deg = th * 180 / Math.PI * Math.sign(D);
  return { ops: [['A', R, deg], ['A', R, -deg]], len: 2 * R * Math.sin(th) };
}

export const SITE_WALL = -5.75;
export const SITES = {};
for (const k of ['reception', 'haldi', 'muhurtham']) {
  const e = EVENTS[k], d0 = e.s - e.len / 2, a = d0 - 30, ax = (e.lat[0] + e.lat[1]) / 2;
  // in: an S-bend off the lane (R 7.5 m) onto the axis, straight to the drop-off; out: straight on, an
  // S-bend back to the lane. Gates stand where each bend crosses the wall line (from the arc geometry).
  const R = 7.5, bend = sBend(ax + 1.8, R), sIn = a - 0.6, sOut = a + 17;
  const cross = D => R * Math.sin(Math.acos(1 - Math.abs(D) / R));        // along-road distance into a bend to lateral D
  const gIn = sIn + cross(SITE_WALL + 1.8), gOut = sOut + bend.len - cross(SITE_WALL + 1.8);
  SITES[k] = { ax, a, d0, d1: d0 + e.len, lat: e.lat,
    gateIn: gIn, gateOut: gOut, stop: { s: a + 16, l: ax },
    island: { s: (gIn + gOut) / 2, l: -8.3, rs: (gOut - gIn) / 2 - 3.2, rl: 2 },
    garden: { s0: a + 1, s1: d0 - 1, l0: ax - 2.6, l1: e.lat[1] },
    route: {
      in: arcRoute(a - 14, -1.8, [['S', sIn - (a - 14)], ...bend.ops, ['S', a + 16 - (sIn + bend.len)]]),
      out: arcRoute(a + 16, ax, [['S', sOut - (a + 16)], ...sBend(-(ax + 1.8), R).ops, ['S', 16]])
    },
    stage: { s: d0 + e.len - 4.2, depth: 6 }, aisle: 2.2 };
}
/** the arrival forecourt of each beach venue (its drive, island and garden): s0 … s1, lat */
export const COURTS = {};
for (const k of Object.keys(SITES)) {
  const S = SITES[k];
  COURTS[k] = { s0: S.a, s1: S.d0 - 0.5, lat: [-3.7, S.lat[1]] };
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
  if (s > karimS + 20 && s < karimS + 106 && lateral > 3.4 && lateral < 64) return true;   // AMR Unnati's lot and apron
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
  const e = EVENTS[id], S = SITES[id], a = S.a, ax = S.ax, W = SITE_WALL;
  return { id, s: e.s, slow: [a - 110, e.s + 20], callout: [a - 95, a - 20], sheet, label,
    venue: { s: e.s + 3, lateral: ax }, pullover: { side: 'left', lateral: -4.9 },
    // in: off the lane through the first gate onto the axis, straight to the drop-off (parks square);
    // out: straight on, through the second gate, and a straight run in the lane (no snap at hand-back)
    route: S.route,
    // the crane ends raised behind the drop-off, just road-side of the axis, looking straight down it:
    // car → carpet → arch → aisle → stage
    cam: { s: S.stop.s - 11, lateral: ax + 2.5, h: 4.8 }, focus: { s: S.d0 + 4, lateral: ax, h: 1.8 },
    // surface the car drives on (car/car.js): the compound drive (biomes/events/compound.js) is road + 0.03
    ground: (s, l) => path.roadY(s) + (l < -3.35 ? 0.031 : 0.02) };
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
      // (both legs meet square to the road at the stop: no snap when the car pulls away)
      in: (() => {   // lane → R 7 m to 70° → straight through the gate → R 7 m back → straight to the stop
        const R = 7, th = 70, rise = 2 * R * (1 - Math.cos(th * Math.PI / 180)), run = (18.8 + 1.8 - rise) / Math.sin(th * Math.PI / 180);
        const fwd = 2 * R * Math.sin(th * Math.PI / 180) + run * Math.cos(th * Math.PI / 180), s0 = G + 7 - 2.5 - fwd;
        return arcRoute(G - 22, -1.8, [['S', s0 - (G - 22)], ['A', R, th], ['S', run], ['A', R, -th], ['S', 2.5]]);
      })(),
      out: [[G + 7, 18.8], [G + 10, 18.8], [G + 13, 19.2], [G + 17, 19.6], [G + 23, 18], [G + 27, 14.5], [G + 29, 10.6], [G + 31, 6], [G + 35, 1.4], [G + 41, -1.2], [G + 49, -1.8], [G + 58, -1.8]]
    }))(karimS + 48),
    cam: { s: karimS + 48 - 8, lateral: -4.6, h: 6.8 }, focus: { s: karimS + 60, lateral: 26, h: 3.5 },
    // surface the car drives on: road, then dam.js's apron ramping up to the lot's pad level across
    // lateral 3.45 … 10.6 (the wall line), then venue-amr-grounds.js's drive at pad + 0.045. The pad is
    // level at road height by the hall, so where the road falls away the drive stands well above it.
    ground: (s, l) => {
      const Yr = path.roadY(s), PY = path.roadY(karimS + 58) + 0.02;
      if (l <= 3.45) return Yr + 0.02;
      if (l < 10.6) { const k = Math.min(1, (l - 3.45) / (10.6 - 3.45)), e = k * k * (3 - 2 * k); return Yr + 0.025 + (PY - Yr - 0.005) * e; }
      return PY + 0.046;
    } }
];
export const STOP = Object.fromEntries(STOPS.map(s => [s.id, s]));

const cap = (id, els) => ({ id, els, from: EVENTS[id].s - 55, to: EVENTS[id].s + 45, fade: 30 });
export const OVERLAYS = [
  // the names wait for the first scroll: hidden at rest, written in over the first few metres
  { id: 'title', els: ['title'], from: 9, to: at('garden', 0.3), fade: 8, fadeOut: 40 },
  { id: 'titleVenue', els: ['titleVenue'], from: -1e9, to: at('garden', 0.3), fade: 40 },   // gone before the garden opens up
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
