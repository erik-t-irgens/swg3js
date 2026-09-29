// A body's meshes culled one by one, against a sphere set once (commit 3c of the frame-time wave).
//
// A creature's, a person's and a fighter's meshes were never frustum-culled on their own: three works
// a skinned mesh's sphere out from its posed vertices the first time it needs one and keeps it for
// ever, so a sphere from whatever pose a body was first drawn in would cull it wrongly afterwards. The
// manager culled a mobile as one group instead, by setting its visibility, and within 35 m of the
// camera it drew the whole body whether it was on the screen or behind it -- in every pass, and in
// each of the three shadow cascades, which is where most of the shadow pass's skinned casters and all
// of its strays came from.
//
// Three reads a skinned mesh's `boundingSphere` in that mesh's own frame and computes one only while
// it is null (`Frustum.intersectsObject`, `SkinnedMesh`), so a sphere set by hand once is kept. Each
// skinned mesh is given the body's own cull sphere (the manager's `plan.cull`, or a fighter's from its
// height), grown by `SKELETON_TUNE.sphereScale` and put into the mesh's frame through the transforms
// between the mesh and the body's frame, which never change. Then three culls it per pass and per
// cascade: a mesh outside a pass's frustum is neither drawn nor has its skeleton worked out in it, and
// the shadow pass's probe, whose frustum holds nothing, no longer picks any of it up as a stray.
//
// A mesh hung under a bone is left alone (the transforms above it move with the pose), and a mesh
// that is not skinned keeps three's own sphere, its geometry's, which is right for a rigid mesh. The
// sphere is a standing body's, so anything that lays the body out along the ground turns the cull
// off for as long as it lies there (`cullsOneByOne`): a ragdoll, whose pieces leave the sphere; a
// body dead in its held death clip (every death on a world a server holds, and every one waiting in
// the ragdoll queue); a knockdown; a fighter prone; a body kneeling, prone, rolling or in the air on
// a jump (`low`, which a fighter and a person from the catalogue fight in); and an idle that is itself a body lying at full
// length (`LYING_IDLE`: the scene NPCs' dead poses, the restrained Wookiee), whose head lies about two
// metres from the feet and so outside a sphere centred at mid-height. The manager's own group cull
// and the portal renderer's routing still apply on top, since a hidden root hides everything under
// it. `SKELETON_TUNE.cullSphere` false is the old behaviour. Nothing here runs on a frame.
//
// Node tests run it (`skeletonShare.test.ts`), so value imports carry `.ts`.
import * as THREE from 'three';
import { SKELETON_TUNE } from '../core/skeletonOnce.ts';

const rel = new THREE.Matrix4();
const inv = new THREE.Matrix4();

/**
 * The transform from `mesh`'s frame into `frame`'s, composed from the local matrices between them (so
 * nothing needs to be in a scene or have its world matrix up to date). Null when `frame` is not above
 * the mesh, or a bone stands between them.
 */
export function frameOf(mesh: THREE.Object3D, frame: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 | null {
  out.identity();
  let o: THREE.Object3D | null = mesh;
  while (o && o !== frame) {
    if (o !== mesh && (o as THREE.Bone).isBone) return null;
    if (o.matrixAutoUpdate) o.updateMatrix();
    out.premultiply(o.matrix);
    o = o.parent;
  }
  return o === frame ? out : null;
}

/**
 * Give every skinned mesh under `root` the body's cull sphere -- a middle `cy` up the vertical axis of
 * `frame` and a radius `radius`, both in `frame`'s own units, grown by `scale` -- in its own frame, and
 * list in `out` every mesh the per-mesh cull may take: those skinned meshes, and every rigid mesh (which
 * keeps its geometry's sphere). Answers how many were listed. Made once, when the body is hung.
 */
export function fitCullSpheres(root: THREE.Object3D, frame: THREE.Object3D, cy: number, radius: number, out: THREE.Mesh[], scale = SKELETON_TUNE.sphereScale): number {
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    const skinned = mesh as unknown as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      if (!frameOf(mesh, frame, rel)) return;
      inv.copy(rel).invert();
      const s = (skinned.boundingSphere ??= new THREE.Sphere());
      s.center.set(0, cy, 0);
      s.radius = Math.max(1e-3, radius * scale);
      s.applyMatrix4(inv);
    }
    out.push(mesh);
    n++;
  });
  return n;
}

/** Turn the per-mesh cull on or off over a body's listed meshes. */
export function setBodyCulled(meshes: readonly THREE.Mesh[], on: boolean): void {
  for (let i = 0; i < meshes.length; i++) meshes[i].frustumCulled = on;
}

/**
 * Idles that pose a body at full length on the ground rather than on its feet or in a seat: the mood
 * branches the species rigs bake as `idle:npc_dead_01..03` and `idle:wookiee_lying_restrained`. A body
 * sitting (in a chair, at a table, on the ground) or meditating stays inside a standing body's sphere
 * and keeps its cull.
 */
export const LYING_IDLE = /lying|dead/;

/** What decides whether a body's meshes may be culled one by one: whatever lays it out off its feet. */
export interface BodyPose {
  /** Handed to the physics as a ragdoll. */
  ragdoll: boolean;
  /** Dead, in its held death clip or after it. */
  dead: boolean;
  /** Off its feet some other way: a knockdown's fall, lie and getting up, or a fighter prone. */
  down: boolean;
  /**
   * Down low or in the air for a moment on purpose: flat, tumbling through a roll or off the ground on
   * a jump. Each lays the body out or carries it by clips the standing sphere was never measured against
   * (a prone body's length, a roll's tumble, a jump's tuck and landing), so the cull is off for as long
   * as it lasts, which for all but prone is under a second. Left out, it is not.
   */
  low?: boolean;
  /**
   * On one knee, which is kept apart from `low` because it is the one low posture a body holds for a
   * long time in a fight, so what it costs is worth a switch of its own (`LOW_CULL.kneelWhole`).
   */
  kneel?: boolean;
  /** The idle it stands in, when an idle can itself lie a body down (a mood's); null for none. */
  idle: string | null;
}

/**
 * Whether a body on one knee is drawn whole rather than culled mesh by mesh. A kneel is lower than the
 * standing body and no wider than its bind pose's arm span, so it lies inside the standing sphere by
 * the sphere's own arithmetic, and culled it costs nothing; but it is the one low posture held for
 * seconds at a time, so which way it goes is measured rather than assumed (`__debug.perf({ ab: { key:
 * 'kneelWhole' } })`) and live here. Read when a body next asks the rule, which is every change of posture.
 */
export const LOW_CULL = { kneelWhole: true };

/**
 * Whether a body's meshes are culled one by one against the standing body's sphere: the switch on, and
 * the body on its feet. A body lying at full length reaches past the sphere (the fighters' own sphere
 * falls a tenth of a metre short of a 1.8 m body flat on the ground, and a creature's `plan.cull` about
 * half a metre short), so for as long as it lies there the cull is off and the body is drawn whole
 * whenever its group is.
 */
export function cullsOneByOne(pose: BodyPose, on: boolean = SKELETON_TUNE.cullSphere, kneelWhole: boolean = LOW_CULL.kneelWhole): boolean {
  if (!on || pose.ragdoll || pose.dead || pose.down || pose.low) return false;
  if (pose.kneel && kneelWhole) return false;
  return pose.idle === null || !LYING_IDLE.test(pose.idle);
}

/**
 * The shadow cascades' light boxes, refreshed from their lights where the cascades have just put them
 * (after `CSM.update`): each light's shadow camera placed and its frustum set exactly as three does
 * before drawing that cascade's map (`LightShadow.updateMatrices`), so doing it early changes nothing
 * three draws. Written into `out` in the lights' order and handed back; nothing is made.
 */
export function refreshCascadeBoxes(lights: readonly THREE.DirectionalLight[], out: THREE.Frustum[]): THREE.Frustum[] {
  for (let i = 0; i < lights.length; i++) {
    const l = lights[i];
    l.updateMatrixWorld();
    l.target.updateMatrixWorld();
    l.shadow.updateMatrices(l);
    // Written by index, so the list's store is kept from frame to frame (the lights never change in number).
    out[i] = l.shadow.getFrustum();
  }
  if (out.length !== lights.length) out.length = lights.length;
  return out;
}

/**
 * Whether a sphere reaches any of the cascades' light boxes: a caster three would draw into at least one
 * shadow map. This is the same test three makes per mesh and per cascade, so a body answered no here
 * throws no shadow that anything would have drawn; and it is the light's box and not a distance from
 * the camera, so a body at the side of the view, or one beyond the last cascade with the sun behind it
 * throwing its shadow back into view, is answered for exactly.
 */
export function reachesCascades(boxes: readonly THREE.Frustum[], sphere: THREE.Sphere): boolean {
  for (let i = 0; i < boxes.length; i++) if (boxes[i].intersectsSphere(sphere)) return true;
  return false;
}

/**
 * A fighter's cull sphere, in the frame of its group (at its feet, turned with it): the body's own
 * height `h` from its feet to the top of its head, and the rule the creatures' sphere is made by
 * (`planBody`: 0.62 of the diagonal of its box), with the arm span taken as its height and its depth
 * as the capsule's width.
 */
export function fighterCull(h: number, capsuleRadius: number, out: { y: number; radius: number }): { y: number; radius: number } {
  const height = Math.max(0.5, h);
  out.y = height / 2;
  out.radius = 0.62 * Math.hypot(height, height, 2 * capsuleRadius);
  return out;
}
