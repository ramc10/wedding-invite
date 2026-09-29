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
 * (fx/atmosphere.js). Pairs of equal keys hold a look across a scene.
 * Owned by the atmosphere/night work (fx/atmosphere.js). */
import { EVENTS } from './timeline.js';

const R = EVENTS.reception.s, H = EVENTS.haldi.s, M = EVENTS.muhurtham.s;

export const BEACH_KEYS = [
  { s: 560, sun: [30, -60], exposure: 1.0 },          // afternoon on Beach Road, past the hotel board
  { s: R - 95, sun: [4, 70], exposure: 0.95 },        // sunset behind the city
  { s: R - 45, sun: [-14, -40], exposure: 1.0 },      // night falls
  { s: R + 45, sun: [-14, -40], exposure: 1.0 },      // Reception: night
  { s: H - 80, sun: [-7, -95], exposure: 1.0 },       // first light over the sea
  { s: H - 45, sun: [3, -92], exposure: 0.98 },       // sunrise out of the bay
  { s: H - 15, sun: [16, -85], exposure: 1.0 },       // Haldi: bright morning
  { s: H + 40, sun: [18, -85], exposure: 1.0 },
  { s: M - 95, sun: [5, 80], exposure: 0.95 },        // the day goes by: evening
  { s: M - 45, sun: [-14, -40], exposure: 1.0 },      // night again
  { s: M + 45, sun: [-14, -40], exposure: 1.0 }       // Muhurtham: night
];
