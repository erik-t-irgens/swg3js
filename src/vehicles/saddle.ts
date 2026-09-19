// A mount's saddle and its rider's seat, from the game's own hardpoints.
//
// The game stands a rider at the saddle's origin (the creature's `saddle` hardpoint, which rides a
// joint) and the saddle poses' clip root lifts the pelvis to the saddle's own `player` point: every
// retail saddle's `player` is (0.0002, 0.164, -0.060) and every saddle pose's root (0, 0.165, -0.057).
// So the seat hangs on the saddle's `player` node and names the pelvis, and the saddle and rider
// ride the joint in its own frame, whatever the creature's rest pose was. A creature the game never
// saddled wears its table's saddle on its back as the idle stands it, and a wild one with no saddle
// keeps a bare seat on the back as before.
//
// No browser API and no value import but three, so the node tests load it; the hardpoint finder is
// passed in (the garage's reads hardpointName).
import * as THREE from 'three';

/** How a creature's rider is seated: the game's saddle hardpoint, the creature's own rider point, a saddle where the back is guessed, or the back alone. */
export type SeatFrom = 'saddle' | 'rider' | 'guess' | 'back';

/** A mount's saddle as the creatures pack describes it (the manifest entry, paths made fetchable). */
export interface SaddleDef {
  file: string | null;
  joint: string | null;
  player: [number, number, number] | null;
}

export interface SeatPlan {
  from: SeatFrom;
  /** The saddle model to hang, or null. */
  saddleFile: string | null;
  /** The seat in the frame it hangs from when the saddle model has no player point of its own. */
  offset: [number, number, number];
  /** The seat names where the pelvis goes (the riding clip's root comes off). */
  pelvis: boolean;
}

/** What a seat is hung on: a Vehicle satisfies it structurally; the node test passes a plain object. */
export interface SeatTarget {
  readonly seat: THREE.Object3D;
  seatPelvis: boolean;
  seatFollows: boolean;
  saddle: THREE.Object3D | null;
  seatFrom: SeatFrom | null;
}

/** A model's hardpoint node by name (the garage passes its findHardpoint, which reads hardpointName). */
export type FindHardpoint = (root: THREE.Object3D, name: string) => THREE.Object3D | null;

/** Every retail saddle's player point (X mirrored), which is also the saddle poses' clip root to 3 mm. */
export const SADDLE_PLAYER: [number, number, number] = [-0.0002, 0.1639, -0.0596];

/** How a creature is seated, from the hardpoint names its model carries and its manifest saddle. */
export function planSeat(hardpoints: readonly string[], saddle: SaddleDef | null | undefined): SeatPlan {
  const names = new Set(hardpoints.map((h) => h.toLowerCase()));
  const player = (): [number, number, number] => (saddle?.player ? [saddle.player[0], saddle.player[1], saddle.player[2]] : [SADDLE_PLAYER[0], SADDLE_PLAYER[1], SADDLE_PLAYER[2]]);
  if (names.has('saddle')) return { from: 'saddle', saddleFile: saddle?.file ?? null, offset: player(), pelvis: true };
  if (names.has('player')) return { from: 'rider', saddleFile: null, offset: [0, 0, 0], pelvis: true };
  if (saddle) return { from: 'guess', saddleFile: saddle.file, offset: player(), pelvis: true };
  return { from: 'back', saddleFile: null, offset: [0, 0, 0], pelvis: false };
}

/**
 * The top of the body as it stands now (posed, skinned vertices) over the middle of its posed
 * length, in `frame`'s space: the highest vertex within a strip round the posed box's centre line
 * (half-width 12% of the box's width, half-length 8% of its length, at least 0.1 m each, the
 * constants `backHeight` uses). Null when the model has no vertices. Computed once, at spawn.
 */
export function posedBack(model: THREE.Object3D, frame: THREE.Object3D): THREE.Vector3 | null {
  // The frame's ancestors, then everything under it (the model and its bones), not the whole scene;
  // updateMatrixWorld on the way down, so a skinned mesh's bindMatrixInverse follows its matrixWorld.
  frame.updateWorldMatrix(true, false);
  frame.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert();
  const meshes: THREE.Mesh[] = [];
  let count = 0;
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    const pos = m.isMesh ? m.geometry?.getAttribute('position') : undefined;
    if (!pos) return;
    meshes.push(m);
    count += pos.count;
  });
  if (!count) return null;
  // Skinned vertices through the bones as they stand (getVertexPosition applies the bone matrices
  // and any morphs, in the mesh's own space), then into the frame's space.
  const points = new Float32Array(count * 3);
  const toFrame = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const box = new THREE.Box3();
  let k = 0;
  for (const m of meshes) {
    toFrame.multiplyMatrices(inv, m.matrixWorld);
    const n = m.geometry.getAttribute('position').count;
    for (let i = 0; i < n; i++) {
      m.getVertexPosition(i, p).applyMatrix4(toFrame);
      points[k++] = p.x;
      points[k++] = p.y;
      points[k++] = p.z;
      box.expandByPoint(p);
    }
  }
  const halfW = Math.max(0.1, (box.max.x - box.min.x) * 0.12);
  const halfL = Math.max(0.1, (box.max.z - box.min.z) * 0.08);
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  let top = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    if (Math.abs(points[i] - cx) <= halfW && Math.abs(points[i + 2] - cz) <= halfL && points[i + 1] > top) top = points[i + 1];
  }
  // Nothing in the strip (a body hollow down its middle): most of the way up the box, as the old guess did.
  if (!Number.isFinite(top)) top = box.min.y + (box.max.y - box.min.y) * 0.92;
  return new THREE.Vector3(cx, top, cz);
}

/** The head, tail and limbs are never the back. */
const NOT_BACK = /head|neck|jaw|tail|leg|foot|toe|knee|thigh|calf|shin|ankle|ear|eye|tongue|wing|arm|hand|finger/;
/** Bones named for the body's middle are preferred over a nearer one by name. */
const BACK = /spine|back|pelvis|hip|body|torso|chest/;

/**
 * Hang a node on the bone of the model's skeleton nearest it (a spine bone preferred; the head,
 * tail and limbs never; the root allowed, as the game's own saddles use it on the kaadu, tauntaun,
 * cu pa and lava flea, and for some skeletons it is the body's only central bone), keeping where
 * it is. Null, and the node left alone, when the model has no skeleton.
 *
 * A bone is the head's, a tail's or a limb's when its own name says so or any bone above it does:
 * a name alone let the ronto's and bolle bol's back ride an ear flap (`LFlapBase`, under `Head`)
 * and the kliknik's and merek's a pincer (`lPinch`, under `head2`).
 */
export function hangOnBack(model: THREE.Object3D, node: THREE.Object3D): { bone: THREE.Bone; distance: number } | null {
  model.updateWorldMatrix(true, false);
  model.updateMatrixWorld(true);
  node.updateWorldMatrix(true, false);
  const want = node.getWorldPosition(new THREE.Vector3());
  let best: THREE.Bone | null = null;
  let bestD = Infinity;
  let bestDistance = Infinity;
  const at = new THREE.Vector3();
  model.traverse((o) => {
    const bone = o as THREE.Bone;
    if (!bone.isBone) return;
    const name = bone.name.toLowerCase();
    if (NOT_BACK.test(name)) return;
    for (let up = bone.parent; up && up !== model; up = up.parent) if ((up as THREE.Bone).isBone && NOT_BACK.test(up.name.toLowerCase())) return;
    bone.getWorldPosition(at);
    const distance = at.distanceTo(want);
    const d = distance * (BACK.test(name) ? 0.7 : 1);
    if (d < bestD) {
      bestD = d;
      bestDistance = distance;
      best = bone;
    }
  });
  if (!best) return null;
  (best as THREE.Bone).attach(node);
  return { bone: best, distance: bestDistance };
}

/**
 * Hang a mount's saddle and seat (synchronous; the skeleton must already be in the idle's first
 * pose). Returns the node the saddle hangs from and what the seat was found from, or null for the
 * 'back' plan. `frame` is what the seat's place is measured in (the vehicle's group, or the relay
 * picture's holder); `target` is the vehicle whose seat is hung, or null for a picture only.
 */
export function hangSaddle(model: THREE.Object3D, plan: SeatPlan, saddle: THREE.Object3D | null, find: FindHardpoint, frame: THREE.Object3D, target: SeatTarget | null = null): { node: THREE.Object3D; from: SeatFrom } | null {
  if (plan.from === 'back') {
    if (target) {
      const p = posedBack(model, frame);
      if (p) target.seat.position.copy(p);
      const hung = hangOnBack(model, target.seat);
      target.saddle = null;
      target.seatFollows = !!hung;
      target.seatPelvis = false;
      target.seatFrom = 'back';
    }
    return null;
  }
  let node = plan.from === 'saddle' ? find(model, 'saddle') : plan.from === 'rider' ? find(model, 'player') : null;
  let from: SeatFrom = plan.from;
  if (!node) {
    // A saddle where the game put none: on the top of the back as the idle stands it, upright and
    // facing the nose (the frame's own turn, which attach keeps), riding the nearest back bone.
    const p = posedBack(model, frame);
    node = new THREE.Object3D();
    node.name = 'saddle-guess';
    frame.add(node);
    if (p) node.position.copy(p);
    hangOnBack(model, node);
    from = 'guess';
  }
  if (saddle) {
    node.add(saddle);
    saddle.userData.saddle = true;
  }
  if (target) {
    const pp = saddle ? find(saddle, 'player') : null;
    const parent = pp ?? node;
    const offset = pp ? [0, 0, 0] : plan.offset;
    // Added, not attached: the seat lives in that frame and rides the joint with the saddle.
    parent.add(target.seat);
    target.seat.position.set(offset[0], offset[1], offset[2]);
    target.seat.quaternion.identity();
    target.saddle = saddle;
    target.seatPelvis = plan.pelvis;
    target.seatFollows = true;
    target.seatFrom = from;
  }
  return { node, from };
}
