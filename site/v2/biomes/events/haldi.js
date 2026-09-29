/* Haldi (morning). Built into the 'cove' zone's visibility window.
 * Placement: core/timeline.js EVENTS.haldi. PLACEHOLDER: replaced by the scene build. */
import * as THREE from 'three';

export default {
  id: 'cove',
  build(ctx) {
    const group = new THREE.Group();
    group.name = 'event-haldi';
    return { group, update(dt, s, cam) {} };
  }
};
