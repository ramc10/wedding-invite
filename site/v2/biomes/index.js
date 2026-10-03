/* Biome registry, in route order. Each module's id matches a zone in core/zones.js. */
import forest from './forest.js';
import garden from './garden.js';
import gardenBeach from './garden-beach.js';
import cove from './cove.js';
import hills from './hills.js';
import dam from './dam.js';
import creek from './creek.js';
import board from './events/board.js';
import submarine from './events/submarine.js';
import reception from './events/reception.js';
import haldi from './events/haldi.js';
import muhurtham from './events/muhurtham.js';
import amr from './venue-amr.js';
import amrGrounds from './venue-amr-grounds.js';

// the Vizag events share their beach leg's visibility window (id = that zone)
export const BIOMES = [forest, garden, gardenBeach, board, submarine, reception, cove, haldi, muhurtham, hills, dam, amr, amrGrounds, creek];
