/* The seven legs of the drive, as spans of s, in route order — the same
 * narrative as the painted site (ribbon-v3/standin.json). The table here is
 * the single source for zone extents, ground profiles and time of day; biome
 * modules only supply build().
 *
 * profile: ground shape either side of the road, one of
 *   'forest'  rolling ground, gentle rise
 *   'flat'    open, near road level (garden, meadow)
 *   'hill'    climbs away from the road (pine hills)
 *   'sea'     slopes down under water level (beach, cove, reservoir)
 *   'drop'    falls steeply to a valley floor (downstream face of the dam)
 * water: the zone's water surface height (world y), or null.
 * day:   look keyframe at the zone's centre; neighbours blend across `blend`.
 *        sky/hor/fog are sRGB hex, sun = [elevation°, azimuth° from road-forward
 *        clockwise], sunCol hex, sunI intensity, exposure.
 */
import { clamp, smoothstep } from './noise.js';
import { path } from './path.js';

const L = path.length;
const f = [0, 0.115, 0.235, 0.35, 0.52, 0.685, 0.855, 1].map(v => v * L);

export const ZONES = [
  { id: 'forest', s0: f[0], s1: f[1], profile: { left: 'forest', right: 'forest' }, water: null,
    day: { sky: 0x7fa7c9, hor: 0xf3dcb2, fog: 0xcfc3a4, sun: [22, -40], sunCol: 0xffd9a0, sunI: 2.6, exposure: 0.95 } },
  { id: 'garden', s0: f[1], s1: f[2], profile: { left: 'flat', right: 'flat' }, water: null,
    day: { sky: 0x6c9fd0, hor: 0xf6e6c4, fog: 0xd9d2b8, sun: [34, -30], sunCol: 0xfff0d0, sunI: 3.0, exposure: 1.0 } },
  { id: 'garden-beach', s0: f[2], s1: f[3], profile: { left: 'sea', right: 'flat' }, water: 0,
    day: { sky: 0x5f9ad2, hor: 0xf1ead8, fog: 0xd6dcd6, sun: [38, -60], sunCol: 0xfff3dc, sunI: 3.1, exposure: 1.0 } },
  { id: 'cove', s0: f[3], s1: f[4], profile: { left: 'sea', right: 'hill' }, water: 0,
    day: { sky: 0x6a98c8, hor: 0xf7dfb4, fog: 0xe0d2b4, sun: [24, -80], sunCol: 0xffe0a8, sunI: 3.0, exposure: 0.98 } },
  { id: 'hills', s0: f[4], s1: f[5], profile: { left: 'hill', right: 'hill' }, water: null,
    day: { sky: 0x7a8fb8, hor: 0xf4c890, fog: 0xd8b48a, sun: [12, -70], sunCol: 0xffc27a, sunI: 3.2, exposure: 0.95 } },
  { id: 'dam', s0: f[5], s1: f[6], profile: { left: 'sea', right: 'drop' }, water: 2.0,
    day: { sky: 0x6a6f9e, hor: 0xf2a86c, fog: 0xc99a7c, sun: [5, -95], sunCol: 0xff9a55, sunI: 3.0, exposure: 0.92 } },
  { id: 'creek', s0: f[6], s1: f[7], profile: { left: 'forest', right: 'flat' }, water: null,
    day: { sky: 0x2e3563, hor: 0xc98a78, fog: 0x6e6378, sun: [-2, -110], sunCol: 0xff8a60, sunI: 1.4, exposure: 0.9 } }
];
ZONES.forEach(z => { z.blend = 60; z.mid = (z.s0 + z.s1) / 2; });

export const byId = Object.fromEntries(ZONES.map(z => [z.id, z]));

export function zoneAt(s) {
  for (const z of ZONES) if (s < z.s1) return z;
  return ZONES[ZONES.length - 1];
}

/** Weights of each zone at s, summing to 1: cross-fade across ±blend/2 of each join. */
export function weightsAt(s) {
  const w = ZONES.map(() => 0);
  const i = ZONES.indexOf(zoneAt(s));
  w[i] = 1;
  const z = ZONES[i];
  if (i > 0 && s < z.s0 + z.blend / 2) {
    const t = smoothstep(z.s0 - z.blend / 2, z.s0 + z.blend / 2, s);
    w[i] = t; w[i - 1] = 1 - t;
  } else if (i < ZONES.length - 1 && s > z.s1 - z.blend / 2) {
    const t = smoothstep(z.s1 - z.blend / 2, z.s1 + z.blend / 2, s);
    w[i] = 1 - t; w[i + 1] = t;
  }
  return w;
}

/** Visibility window a zone's group should be shown in (camera s). */
export const VIS_MARGIN = 320;
export const visible = (z, s) => s > z.s0 - VIS_MARGIN && s < z.s1 + VIS_MARGIN;

/** Time-of-day keyframes sit at zone centres; this interpolates between them. */
export function dayAt(s) {
  s = clamp(s, ZONES[0].mid, ZONES[ZONES.length - 1].mid);
  let i = 0;
  while (i < ZONES.length - 2 && s > ZONES[i + 1].mid) i++;
  const a = ZONES[i], b = ZONES[i + 1];
  const t = smoothstep(a.mid, b.mid, s);
  return { a: a.day, b: b.day, t };
}
