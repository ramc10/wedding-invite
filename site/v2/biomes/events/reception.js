/* Reception by the Shore (night). Built into the 'garden-beach' zone's visibility window.
 * Placement: core/timeline.js EVENTS.reception. PLACEHOLDER: replaced by the scene build. */
import * as THREE from 'three';

export default {
  id: 'garden-beach',
  build(ctx) {
    const group = new THREE.Group();
    group.name = 'event-reception';
    return { group, update(dt, s, cam) {} };
  }
};
