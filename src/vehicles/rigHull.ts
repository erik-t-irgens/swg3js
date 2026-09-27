// A shuttle's travel rig built as a hull that can fly: the same skeleton, pieces and clips the clock
// rig at a starport is drawn with (`src/world/shuttleRigs.ts`), made into a model a Vehicle can carry.
//
// The trick is the hull joint (the joint carrying the rig's biggest piece). On the clock rig the clips
// move it, and the whole ship with it, from kilometres out down onto its pad. On a Vehicle the body is
// the thing that moves, so the hull joint is pinned at the model's origin by a carrier that undoes its
// rest pose, and the clips that pose the limbs have the hull joint's chain taken out of them: three
// then never binds those joints, they stay where they were bound, and the carrier cancels them
// exactly. The struts fold and the door opens on their own tracks, relative to the hull, just as they
// do on the clock rig. Where the vehicle stands is then the hull joint's pose carried onto the pad
// (`src/world/rigPath.ts`), and the two draw every vertex in the same place.
//
// It is never offered anywhere a player picks a ship: a rig's def is made when it is wanted and is
// never in the garage's list. Node loads this file (`tools/swg/tests/rigHull.test.ts`): three, and
// `.ts` value imports only.

import * as THREE from 'three';
import { chainPose, landingJoin, poseRigAction, rigPathOf, takeoffCut, type ChainLink, type RigActions, type RigMoment, type RigPath } from '../world/rigPath.ts';
import type { RigClips, RigPose, TravelRig } from '../world/travelTerminal.ts';
import type { VehicleDef } from './garage';

/**
 * How a shuttle handles once it flies on its own rather than on its clips. Every number is ours; one
 * handling serves both rigs. Live through `__debug.rigHull({ tune })`, taken at the next spawn.
 */
export const RIG_HULL_TUNE = {
  /** Metres a second over a planet: the median hop of 7.9 km takes about 53 s, and it is above every speed a landing clip takes a hull back at (85 to 91). */
  maxSpeed: 150,
  /** The most it is ever handed as its clip lets go of it (the calm take-off's cut is 199.9); the ride never boosts. */
  boostSpeed: 200,
  /** Metres a second squared: 200 down to 150 in about two seconds after the take-off, 150 down to 91 in 2.4 before a landing. */
  accel: 20,
  brake: 25,
  /** Radians a second: a 375 m plan radius at cruise, between a big ship's 0.5 and a fighter's 1.1. */
  turnRate: 0.6,
  /** Seconds for a turn to build or die away: a big ship's 1.4 overshoots a lane, a fighter's 0.55 is twitchy for a 43 m hull. */
  inertia: 1.2,
};

/**
 * The branch a hull flown from a rig lands with. Every pad a shuttle can be flown to plays the calm
 * branch where a rig has one (Theed's hangar is never a destination: no port stands near it), so a
 * transport out of Theed lands as every other transport does; a rig with no calm branch, the shuttle's
 * one unnamed branch, lands with its own.
 */
export function landingMood(moods: Record<string, RigClips> | null | undefined, mood: string): string {
  return moods && moods.calm ? 'calm' : mood;
}

/** A hull's clips flown as paths for one branch: the take-off and where it lets go, the landing and where it takes back, and the branch it lands with. */
export interface RigPaths {
  lift: RigPath;
  cut: RigMoment | null;
  land: RigPath;
  join: RigMoment | null;
  liftMood: string;
  landMood: string;
}

/** A box's volume from a pack's bounds, whichever corner it wrote first. */
function boundsVolume(b: { min: number[]; max: number[] } | undefined): number {
  if (!b || b.min.length < 3 || b.max.length < 3) return 0;
  return Math.abs(b.max[0] - b.min[0]) * Math.abs(b.max[1] - b.min[1]) * Math.abs(b.max[2] - b.min[2]);
}

/**
 * The joint that carries a rig's hull: the one its biggest piece hangs on, by the pack's own bounds,
 * and by `measured` (volumes per joint, from the loaded pieces) for a piece the pack gives none. On
 * the retail rigs that is the shuttle's `root` and the transport's `hold_transport`.
 */
export function hullJointOf(rig: TravelRig, measured?: Map<string, number>): string {
  let best = '';
  let most = -1;
  for (const p of rig.parts) {
    const v = p.bounds ? boundsVolume(p.bounds) : (measured?.get(p.joint) ?? 0);
    if (v > most) {
      most = v;
      best = p.joint;
    }
  }
  return best || 'root';
}

/** Each loaded piece's own volume, by the joint it rides: what decides the hull joint when a pack gives no bounds. */
export function pieceVolumes(pieces: readonly { joint: string; model: THREE.Object3D }[]): Map<string, number> {
  const out = new Map<string, number>();
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  for (const p of pieces) {
    box.setFromObject(p.model).getSize(size);
    out.set(p.joint, Math.max(out.get(p.joint) ?? 0, size.x * size.y * size.z));
  }
  return out;
}

/**
 * A shuttle as a vehicle the garage can build: a ship whose model is its travel rig. The rig's block
 * is carried whole, by value, so the def is plain data that survives being copied into a crossing
 * and rebuilt in the next world, whose pack may not have this rig in it at all.
 */
export function rigDef(name: string, rig: TravelRig, mood: string): VehicleDef {
  return {
    id: `rig:${name}:${mood || 'default'}`,
    label: name.replace(/_/g, ' '),
    kind: 'ship',
    inferred: true,
    source: 'rig',
    file: `assets-private/${rig.file}`,
    rig: { name, rig, mood, hull: hullJointOf(rig) },
  };
}

/** A rig assembled for a hull: its model, the carrier that pins the hull joint, and the clips that pose its limbs. */
export interface RigModel {
  /** What the vehicle carries: the carrier, and under it the skeleton with every piece hung on its joint. */
  model: THREE.Group;
  /** Fixed at the inverse of the hull joint's rest pose, so that joint stands at the model's origin with no turn. */
  carrier: THREE.Object3D;
  /** The skeleton, which the limbs' mixer poses. */
  joints: THREE.Object3D;
  /** The hull joint's name. */
  hull: string;
  /** The hull joint and every joint above it, top first, with their rest poses. */
  chain: ChainLink[];
  /** Every clip with the chain's own tracks taken out: what poses the limbs. */
  limbClips: Map<string, THREE.AnimationClip>;
  /** Every clip whole, as the clock rig plays it. */
  fullClips: Map<string, THREE.AnimationClip>;
  /** The hull joint at the ground pose, in the rig's own frame. */
  ground: { pos: THREE.Vector3; quat: THREE.Quaternion };
  /** Each piece as it was hung, with the joint it rides. */
  pieces: { joint: string; model: THREE.Object3D }[];
}

/**
 * Hang a rig's pieces on its joints and pin its hull joint at the model's origin.
 *
 * `skeleton.scene` is taken over (hand in a clone) and each piece is hung on the joint of its name, as
 * the clock rig hangs them. The clips are split in two: the whole ones, kept for whatever needs the
 * hull joint's own path, and the limbs' ones, which leave the hull joint's chain where it was bound
 * so the carrier cancels it for good. `clips` names the branch whose ground pose `ground` is (its
 * ground clip at its start, or the landing's last instant, as the clock rig parks); left out, the rest pose.
 */
export function assembleRigModel(skeleton: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }, pieces: { joint: string; model: THREE.Object3D }[], hull: string, clips: RigClips | null = null): RigModel {
  const joints = skeleton.scene;
  joints.removeFromParent();
  const hung: RigModel['pieces'] = [];
  for (const p of pieces) {
    const joint = joints.getObjectByName(p.joint);
    if (!joint) continue;
    joint.add(p.model);
    hung.push(p);
  }
  const top = joints.getObjectByName(hull);
  if (!top) throw new Error(`the rig has no joint ${hull}`);
  const chain: ChainLink[] = [];
  for (let o: THREE.Object3D | null = top; o && o !== joints; o = o.parent) chain.unshift({ name: o.name, position: o.position.clone(), quaternion: o.quaternion.clone() });
  joints.updateMatrixWorld(true);
  const carrier = new THREE.Object3D();
  carrier.name = 'rig carrier';
  carrier.matrixAutoUpdate = false;
  carrier.matrix.copy(top.matrixWorld).invert();
  carrier.matrixWorldNeedsUpdate = true;
  carrier.add(joints);
  const model = new THREE.Group();
  model.name = 'rig hull';
  model.add(carrier);
  const inChain = new Set(chain.map((c) => c.name));
  const fullClips = new Map(skeleton.animations.map((a) => [a.name, a] as const));
  const limbClips = new Map<string, THREE.AnimationClip>();
  for (const a of skeleton.animations) limbClips.set(a.name, new THREE.AnimationClip(a.name, a.duration, a.tracks.filter((t) => !inChain.has(t.name.slice(0, t.name.lastIndexOf('.'))))));
  const ground = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  const parked = clips?.ground ? fullClips.get(clips.ground) : undefined;
  const landed = clips ? fullClips.get(clips.land) : undefined;
  if (parked) chainPose(chain, parked, 0, ground.pos, ground.quat);
  else if (landed) chainPose(chain, landed, landed.duration, ground.pos, ground.quat);
  else chainPose(chain, null, 0, ground.pos, ground.quat);
  model.updateMatrixWorld(true);
  return { model, carrier, joints, hull, chain, limbClips, fullClips, ground, pieces: hung };
}

/**
 * The foot of a hull's ramp in the model's frame, as it stands now: the lowest point of the piece on a
 * door joint, and of the points within five centimetres of that the one farthest out from the hull's
 * long axis, which is the ramp's far edge on the ground. Null for a rig with no door.
 */
function rampFootOf(model: THREE.Object3D, pieces: readonly { joint: string; model: THREE.Object3D }[]): THREE.Vector3 | null {
  model.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const points: THREE.Vector3[] = [];
  for (const p of pieces) {
    if (!/door/i.test(p.joint)) continue;
    p.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const pos = mesh.isMesh ? mesh.geometry.getAttribute('position') : undefined;
      if (!pos) return;
      m.multiplyMatrices(toModel, mesh.matrixWorld);
      for (let i = 0; i < pos.count; i++) points.push(v.fromBufferAttribute(pos, i).applyMatrix4(m).clone());
    });
  }
  if (!points.length) return null;
  let low = Infinity;
  for (const p of points) low = Math.min(low, p.y);
  let best: THREE.Vector3 | null = null;
  for (const p of points) if (p.y - low < 0.05 && (!best || Math.abs(p.x) > Math.abs(best.x))) best = p;
  return best;
}

/** A box as the garage frames a machine on it: its middle across and along, its underside, its height, half its width and length, and its reach. */
export interface RigExtents {
  cx: number;
  cz: number;
  minY: number;
  h: number;
  halfW: number;
  halfL: number;
  reach: number;
}

/**
 * The box a rig's hull is framed on, in the shape `frameExtents` (shipAssembly.ts) gives every other
 * machine's, but measured on the pieces' real vertices as they stand posed. The other measures each
 * mesh's own box turned into the frame, which for a piece hung turned on its joint -- the transport's
 * struts and its open door -- stands the box three quarters of a metre under the feet it rests on.
 * In the model's parent's frame, or the model's own with none. Null with no vertices at all.
 */
export function rigExtents(model: THREE.Object3D): RigExtents | null {
  model.updateMatrixWorld(true);
  const toFrame = model.parent ? new THREE.Matrix4().copy(model.parent.matrixWorld).invert() : new THREE.Matrix4();
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const box = new THREE.Box3();
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const pos = mesh.isMesh ? mesh.geometry.getAttribute('position') : undefined;
    if (!pos) return;
    m.multiplyMatrices(toFrame, mesh.matrixWorld);
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
  });
  if (box.isEmpty()) return null;
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  return { cx, cz, minY: box.min.y, h: box.max.y - box.min.y, halfW: (box.max.x - box.min.x) / 2, halfL: (box.max.z - box.min.z) / 2, reach: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 };
}

/**
 * A shuttle's hull as a vehicle carries it: the assembled rig, its limbs posed from the clip a role
 * plays (the same helper the clock rig is posed with), and what the garage measured of it.
 */
export class RigHull {
  /** What the vehicle carries; `frame` places it, at the hull joint's place in the vehicle, which is minus `offset`. */
  readonly model: THREE.Group;
  /** The skeleton whose limbs the clips pose. */
  readonly joints: THREE.Object3D;
  /** The hull joint's name. */
  readonly hull: string;
  /**
   * Where the vehicle's origin stands in the hull joint's frame, so it turns with the joint:
   * `P = Pad × J × T(offset)`. The hull joint stands at minus this in the vehicle (the transport's
   * offset is 0, -4.00, 0.83: its hull joint is four metres over the underside of its box).
   */
  readonly offset = new THREE.Vector3();
  /** The foot of its ramp in the vehicle's frame at the ground pose, once framed; null for a hull with no door. */
  rampFoot: THREE.Vector3 | null = null;
  /** The hull joint at the ground pose, in the rig's own frame. */
  readonly ground: { pos: THREE.Vector3; quat: THREE.Quaternion };
  private readonly state: RigActions;
  /** The actions of the branch it was built for, and of any other branch it has been asked to pose, by branch. */
  private readonly own: RigActions['actions'];
  private readonly byMood = new Map<string, RigActions['actions']>();
  /** Every branch of its rig by name (its own alone when it was given no others), and each branch's clips flown as paths once asked for. */
  private readonly moods: Record<string, RigClips>;
  private readonly clips: RigClips;
  private readonly chain: ChainLink[];
  private readonly fullClips: Map<string, THREE.AnimationClip>;
  private readonly limbClips: Map<string, THREE.AnimationClip>;
  private readonly pathsByMood = new Map<string, RigPaths | null>();
  /** The ramp's foot in the model's own frame, where the framing has not yet been taken into account. */
  private readonly rampInModel: THREE.Vector3 | null;

  /**
   * `clips` is the branch it is built for; `moods`, every branch of its rig, lets it pose and fly the
   * others too (a hull out of Theed's hangar lands with the calm branch's clip).
   */
  constructor(assembled: RigModel, clips: RigClips, moods: Record<string, RigClips> | null = null) {
    this.model = assembled.model;
    this.joints = assembled.joints;
    this.hull = assembled.hull;
    this.ground = assembled.ground;
    this.clips = clips;
    this.moods = moods ?? {};
    this.chain = assembled.chain;
    this.fullClips = assembled.fullClips;
    this.limbClips = assembled.limbClips;
    const mixer = new THREE.AnimationMixer(assembled.joints);
    this.own = this.actionsOf(mixer, clips);
    this.state = { mixer, actions: this.own, current: null };
    this.pose('ground', 0);
    this.rampInModel = rampFootOf(this.model, assembled.pieces);
  }

  /** One branch's limb clips as actions on the mixer, a role apiece. */
  private actionsOf(mixer: THREE.AnimationMixer, clips: RigClips): RigActions['actions'] {
    const actions: RigActions['actions'] = {};
    for (const role of ['land', 'lift', 'ground', 'sky'] as const) {
      const name = clips[role];
      const clip = name ? this.limbClips.get(name) : undefined;
      if (!clip) continue;
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      actions[role] = a;
    }
    return actions;
  }

  /** The clips of a branch, or its own where it knows no such branch. */
  private clipsOf(mood: string): RigClips {
    return this.moods[mood] ?? this.clips;
  }

  /**
   * The limbs where a role's clip has them at `seconds`: struts and door, relative to the pinned hull.
   * `mood` poses another branch's clip (a landing flown with the calm branch); left out, its own.
   * Allocates nothing once each branch has been posed once.
   */
  pose(role: RigPose['role'], seconds: number, mood?: string): void {
    const clips = mood === undefined ? this.clips : this.clipsOf(mood);
    let actions = this.own;
    if (clips !== this.clips) {
      let a = this.byMood.get(mood!);
      if (!a) {
        a = this.actionsOf(this.state.mixer, clips);
        this.byMood.set(mood!, a);
      }
      actions = a;
    }
    this.state.actions = actions;
    poseRigAction(this.state, role, seconds);
  }

  /**
   * One branch's take-off and landing flown as paths, with where the take-off lets go of the hull (its
   * cut, no faster than the hull's boost) and where the landing takes it back (its join, no faster than
   * its cruise), from the whole clips; the landing is the branch it lands with (`landingMood`). Made
   * the first time a branch is asked for and kept, with the paths themselves kept per clip for the
   * session (`rigPathOf`), so a hull built again after a crossing works nothing out twice; a retune of
   * `RIG_PATH_TUNE` or `RIG_HULL_TUNE` is taken by the next hull built. Null for a branch with no
   * take-off or landing clip.
   */
  paths(mood: string): RigPaths | null {
    if (this.pathsByMood.has(mood)) return this.pathsByMood.get(mood) ?? null;
    const landMood = landingMood(this.moods, mood);
    const liftClip = this.fullClips.get(this.clipsOf(mood).lift);
    const landClip = this.fullClips.get(this.clipsOf(landMood).land);
    let out: RigPaths | null = null;
    if (liftClip && landClip) {
      const lift = rigPathOf(liftClip, this.chain);
      const land = rigPathOf(landClip, this.chain);
      out = { lift, cut: takeoffCut(lift, RIG_HULL_TUNE.boostSpeed), land, join: landingJoin(land, RIG_HULL_TUNE.maxSpeed), liftMood: mood, landMood };
    }
    this.pathsByMood.set(mood, out);
    return out;
  }

  /**
   * The hull posed on the ground and framed as the garage frames every machine, on its pieces' real
   * vertices (`rigExtents`): the model moved so its box is centred across and along on the vehicle's
   * origin and stands on its underside, and the offset and the ramp's foot worked out from where it
   * then stands. The garage and the node test both frame a rig through this one call, so the offset the
   * test pins is the one the game flies with. Returns the box it was framed on, or null with no
   * vertices, when the model stays where it was and the offset follows from that.
   */
  frame(): RigExtents | null {
    this.pose('ground', 0);
    const f = rigExtents(this.model);
    if (f) {
      this.model.position.x -= f.cx;
      this.model.position.y -= f.minY;
      this.model.position.z -= f.cz;
      this.model.updateMatrixWorld(true);
    }
    this.offset.copy(this.model.position).negate();
    this.rampFoot = this.rampInModel ? this.rampInModel.clone().add(this.model.position) : null;
    return f;
  }

  /** Its mixer let go of, with the vehicle. The pieces' geometry and materials are the garage's and stay. */
  dispose(): void {
    this.state.mixer.stopAllAction();
    this.state.mixer.uncacheRoot(this.joints);
  }
}
