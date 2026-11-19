// A skeleton handed back to its clips after something posed its bones directly (a ragdoll, above all): every bone put
// back on its rest, and the mixer told that this is what the bones now hold.
//
// The owner, 2026-11-17: "when dying, respawning is off since the animation changes. Sometimes my eyes and mouth will be
// coming out the back of my head, or my arms will be messed up." A ragdoll poses every bone it has a body for and is then
// thrown away, and nothing put the bones back. The game's own clips drove every joint and moved it every frame, so their
// next frames overwrote what the ragdoll left; the Mixamo clips drive only the joints their map names (the face and the
// game skeleton's extra forearm joints are not among them), and three's mixer writes a joint only when its clip's value
// moved since the last frame it wrote (`PropertyMixer.apply`), so a joint no clip drives, or one its clip holds still,
// kept the ragdoll's turn for good. And a binding made while the bones stood in such a pose keeps that pose as its
// "original" (`saveOriginalState`), which three blends back in wherever a clip's weight is under one and writes back when
// the last action using the binding stops.
//
// Pure apart from three: node runs it with three's own mixer (tools/swg/tests/poseReset.test.ts).
import type * as THREE from 'three';

/** Every bone on its rest: the turn, place and size the rig recorded when it was made. Answers how many it put back. */
export function poseAtRest(
  bones: Iterable<THREE.Bone>,
  restQ: ReadonlyMap<THREE.Bone, THREE.Quaternion>,
  restP: ReadonlyMap<THREE.Bone, THREE.Vector3>,
  restS: ReadonlyMap<THREE.Bone, THREE.Vector3>,
): number {
  let n = 0;
  for (const b of bones) {
    const q = restQ.get(b);
    const p = restP.get(b);
    const s = restS.get(b);
    if (q) b.quaternion.copy(q);
    if (p) b.position.copy(p);
    if (s) b.scale.copy(s);
    if (q || p || s) n++;
  }
  return n;
}

/** What this reads of three's `PropertyMixer`: `saveOriginalState` takes the property's value as it stands as both its original and the last value written. */
interface MixerBinding {
  saveOriginalState(): void;
}

/**
 * Every binding the mixer holds (active or not) takes the bones' values as they stand now as its original and as the
 * last value it wrote. Called right after `poseAtRest`, so a clip's next frame writes every joint whose value differs
 * from rest, a joint it holds at rest is rest already, and a clip fading or stopped blends toward rest, never toward a
 * pose a ragdoll left. Reaches under three (`_bindings`, three's own list); answers how many bindings, or -1 where the
 * mixer has no such list (then nothing was done).
 */
export function forgetMixerWrites(mixer: THREE.AnimationMixer): number {
  const bindings = (mixer as unknown as { _bindings?: MixerBinding[] })._bindings;
  if (!Array.isArray(bindings)) return -1;
  for (const b of bindings) b.saveOriginalState();
  return bindings.length;
}
