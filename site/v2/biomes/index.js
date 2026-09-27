/* Biome registry, in route order. Each module's id matches a zone in core/zones.js. */
import forest from './forest.js';
import garden from './garden.js';
import gardenBeach from './garden-beach.js';
import cove from './cove.js';
import hills from './hills.js';
import dam from './dam.js';
import creek from './creek.js';

export const BIOMES = [forest, garden, gardenBeach, cove, hills, dam, creek];
