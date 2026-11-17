import * as THREE from 'three';

/**
 * A planet's sun, moons and other sky pictures, drawn as flat quads rather than THREE.Sprites.
 *
 * A sprite is always upright on the screen, so a body high in the sky spun against the sky as the
 * view turned under it (the owner could flip a moon round by looking up and turning). A quad here
 * faces the camera (the sky group's origin, which follows the camera's place and never turns) and
 * stands upright to the horizon: its picture's top points along the sky toward the zenith, worked
 * out from where the body hangs and never from the camera. Looked at straight on, with the view
 * level, it is exactly what the sprite drew; the day still carries it across the sky.
 *
 * Within a hair of the zenith "toward the zenith" has no direction, and the quad's right falls back
 * to +X. No body the converted skies hang reaches it: the sun and moon's arc peaks at 67.5 degrees
 * (`SWG_LIGHT_ELEVATION`), and the few pictures that circle (one test world's) are the only ones that
 * ever pass overhead, where a body upright to the horizon turns half round as it crosses.
 */
export type SkyBody = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

/** A sky picture as a quad of side `width` (metres at the sky's radius), blended as its sprite was. */
export function makeSkyBody(map: THREE.Texture, width: number, additive: boolean): SkyBody {
  const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  // Unlit: kept out of the shadow cascades (whose defines are in a program's key) and the wetness, as
  // a space zone's star quads are.
  mat.userData.unlit = true;
  const body: SkyBody = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  body.scale.set(width, width, 1);
  return body;
}

const bx = new THREE.Vector3();
const by = new THREE.Vector3();
const bz = new THREE.Vector3();
const basis = new THREE.Matrix4();

/**
 * Turn a sky body hanging along `dir` (unit length, from the camera) to face the camera, upright to
 * the horizon: +Z back toward the camera, +X the viewer's right (dir x up), +Y the rest. Allocates
 * nothing; `out` is the body's quaternion, set once.
 */
export function turnSkyBody(dir: { x: number; y: number; z: number }, out: THREE.Quaternion): THREE.Quaternion {
  // z = -dir; x = up x z = (z.z, 0, -z.x) = (-dir.z, 0, dir.x).
  bz.set(-dir.x, -dir.y, -dir.z);
  const h = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
  if (h > 1e-6) bx.set(-dir.z / h, 0, dir.x / h);
  else bx.set(1, 0, 0);
  by.crossVectors(bz, bx);
  basis.makeBasis(bx, by, bz);
  return out.setFromRotationMatrix(basis);
}
