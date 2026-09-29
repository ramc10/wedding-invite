/* Palm Beach Hotel roadside board (right verge). Built into the 'garden-beach' zone's visibility window.
 * Placement: core/timeline.js EVENTS.board. PLACEHOLDER: replaced by the scene build. */
import * as THREE from 'three';

export default {
  id: 'garden-beach',
  build(ctx) {
    const group = new THREE.Group();
    group.name = 'event-board';
    return { group, update(dt, s, cam) {} };
  }
};
