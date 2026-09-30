/* Time of day along the beach: the three Vizag events happen at night
 * (Reception, Nov 17 7 PM), in the morning (Haldi, Nov 18 8 AM) and at
 * night again (Muhurtham, Nov 18 8 PM), so the sky runs night → sunrise →
 * morning → night along one stretch of coast. These keys replace the
 * 'garden-beach' and 'cove' zone keyframes; every other leg keeps its
 * zone-centre key (core/zones.js dayAt merges the two lists).
 *
 * Key: { s, sun: [elevation°, azimuth° from road-forward, clockwise], exposure }.
 * Azimuth −90 is the sea side (left): Vizag faces east over the Bay of
 * Bengal, so the sun rises out of the sea. Below about −6° it is night
 * (fx/atmosphere.js). dawn: 1 swaps the rose-dusk palette for a sunrise one
 * (peach toward the sun, cool blue above and opposite). Pairs of equal keys hold a look across a scene.
 * Owned by the atmosphere/night work (fx/atmosphere.js). */
import { EVENTS } from './timeline.js';
import { byId } from './zones.js';

const R = EVENTS.reception.s, H = EVENTS.haldi.s, M = EVENTS.muhurtham.s;

// Azimuths are unwrapped (−400 ≡ −40) so that the sun always swings round
// BEHIND the camera or below the horizon, never across the frame: afternoon
// (left) → round the back → sunset behind the city (right) → below the
// horizon to the sea side for the night → rises out of the sea ahead-left.
// The one full-turn wrap back to plain degrees sits in deep night (−14°),
// where every direction-dependent term is off (fx/atmosphere.js).
export const BEACH_KEYS = [
  { s: 430, sun: [30, -60], exposure: 1.0 },          // afternoon on Beach Road, past the hotel board
  { s: R - 95, sun: [4, -290], exposure: 0.95 },      // sunset behind the city (right), reached round the back
  { s: R - 72, sun: [-5, -292], exposure: 0.95 },     // sets where it stands; afterglow
  { s: R - 45, sun: [-14, -390], exposure: 1.0 },     // night falls (swings below the horizon)
  { s: R + 45, sun: [-14, -390], exposure: 1.0 },     // Reception: night
  { s: H - 105, sun: [-6.5, -382], exposure: 0.9, dawn: 1 },   // first light over the sea
  { s: H - 70, sun: [1.8, -382], exposure: 0.8, dawn: 1 },     // sunrise: the disc clears the bay, ahead-left
  { s: H - 45, sun: [5, -385], exposure: 0.85, dawn: 1 },
  { s: H - 12, sun: [15, -408], exposure: 1.0, dawn: 1 },       // Haldi: bright morning
  { s: H + 40, sun: [20, -425], exposure: 1.0 },
  { s: M - 95, sun: [5, -640], exposure: 0.95 },      // the day goes by (sun round the back): evening
  { s: M - 72, sun: [-5, -642], exposure: 0.95 },
  { s: M - 45, sun: [-14, -760], exposure: 1.0 },     // night again
  { s: M + 44, sun: [-14, -760], exposure: 1.0 },     // Muhurtham: night
  { s: M + 45, sun: [-14, -40], exposure: 1.0 }       // same direction, plain degrees again (invisible at night)
];

/* The ending ("The Beginning", the creek): after the Dawat at dusk by the dam, a short night, then the
 * very first light and an early sunrise ahead-left down the road: low, soft golden light on the meadow
 * and the stream. The sun only moves while it's below the horizon, then rises in place. These keys
 * replace the creek's zone-centre key. */
const DAM = byId.dam, CRK = byId.creek, cl = CRK.s1 - CRK.s0;
export const ENDING_KEYS = [
  { s: DAM.s1 + 20, sun: [-4, -95], exposure: 0.95 },                   // afterglow past AMR Unnati
  { s: CRK.s0 + cl * 0.22, sun: [-9, -60], exposure: 1.0 },             // the small hours
  { s: CRK.s0 + cl * 0.45, sun: [-5, -42], exposure: 0.92, dawn: 1 },   // first light
  { s: CRK.s0 + cl * 0.63, sun: [0.8, -40], exposure: 0.84, dawn: 1 },  // the disc at the horizon, ahead-left
  { s: CRK.s0 + cl * 0.82, sun: [4.5, -40], exposure: 0.88, dawn: 1 },
  { s: CRK.s1, sun: [8.5, -40], exposure: 0.92, dawn: 1 }               // early golden sunrise over the ending: past ~8° the rose tint gives way to gold
];
