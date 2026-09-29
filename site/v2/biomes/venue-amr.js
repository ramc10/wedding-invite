/* AMR Unnati Convention hall: facade, entrance portal, canopy, name. Built into the 'dam' zone's visibility window.
 * Layout: AMR from biomes/dam.js. PLACEHOLDER: replaced by the build. */
import * as THREE from 'three';

export default {
  id: 'dam',
  build(ctx) {
    const group = new THREE.Group();
    group.name = 'venue-amr';
    return { group, update(dt, s, cam) {} };
  }
};
