// The look of a hologram: the game's own holograms (a Jedi's message, a rancor on a projector) are
// the model drawn in a flat, additive blue that no light reaches. One material per hologram asset,
// never one shared by all of them: a material on an asset is disposed with that asset, and a
// shared one disposed once would take every hologram with it for the rest of the session.
import * as THREE from 'three';

/**
 * The look, never put on a mesh directly: every hologram asset takes a clone of it. Unlit
 * (`userData.unlit`), so `World.adoptMaterials` keeps it out of the shadow cascades: the
 * cascades' defines and hook are part of a program's key, and a material that can use neither
 * would only gain a second program and a place in the cascades' strong map.
 */
const HOLOGRAM_TEMPLATE = new THREE.MeshBasicMaterial({
  color: 0x6fc8ff,
  transparent: true,
  opacity: 0.42,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
  side: THREE.DoubleSide,
  name: 'hologram',
});
HOLOGRAM_TEMPLATE.userData.unlit = true;

/**
 * One fresh hologram material for this asset, on every mesh under `scene`, casting and receiving
 * nothing. Returned as the asset's materials, so disposing the asset frees this copy and nobody
 * else's. Skinning and morphs come with the mesh (a `SkinnedMesh` draws a basic material skinned).
 */
export function makeHologram(scene: THREE.Object3D): THREE.Material[] {
  const m = HOLOGRAM_TEMPLATE.clone();
  m.userData.unlit = true;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = m;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
  return [m];
}
