// A pod racer's seat, and the clips that carry its cockpit.
//
// The game seats a rider at a vehicle's authored origin and lets the riding clip's root put the
// pelvis in the seat. On four of the six skinned pods that origin is nowhere near the cockpit, and
// on the three that carry clips the cockpit's joint (`body`, on a skeleton every skinned pod shares:
// root > lft_engine > lft_leg > left_foot > body) stands 2.6 m under its rest place in the idle and
// 1.4 m over it in the run. So a pod's seat names the pelvis outright, and hangs under the cockpit's
// joint as the idle's first frame stands it, so the pilot rides the cockpit through every clip.
//
// Where the pelvis goes, best first: the owner's own place for that pod (`POD_SEAT`); else the
// game's own `player` hardpoint, which every skinned pod's mesh carries on `body` and which the
// owner's hand-placed seats land within 0.12 to 0.21 m of, so it names the pelvis (a gallery
// converted before it was kept has none); else the `body` joint's own origin as the idle stands it,
// 0.45 to 0.59 m from that point on every skinned pod; else, for a pod with no such joint, the old
// guess from the mesh.
//
// No browser API and no value import but three, so the node test loads it.
import * as THREE from 'three';

export type Vec3 = [number, number, number];

/** Which rule placed a pod's pelvis: the owner's table, the game's `player` hardpoint, the cockpit joint, or the mesh guess. */
export type PodSeatRule = 'table' | 'hardpoint' | 'joint' | 'guess';

/** The cockpit's joint on every skinned pod. */
export const POD_COCKPIT_JOINT = 'body';

/**
 * Whether a garage vehicle is a pod racer, by what it is and never by the kind it is tried as from the
 * garage panel: a walker tried "as a pod racer" keeps its own clips and seat, and a pod tried as anything
 * else still seats its pilot in its cockpit. A creature named for one keeps its saddle. The rider's own
 * game and another player's picture both ask this, so the two screens never disagree about it.
 */
export function isPod(def: { readonly kind: string; readonly source: string }): boolean {
  return def.kind === 'podracer' && def.source !== 'creature';
}

/**
 * The owner's own pelvis per pod, by garage id: in the vehicle's frame (the model framed by the garage,
 * its box centred across and along and its underside at nought), as the idle's first frame stands it.
 * Each row is the seat and the riding clip's root that `__debug.seat` reported back, added, which is
 * exactly the line its `paste` writes. A row wins over the game's own point.
 *
 * pod_racer_one has no row: its numbers were read while its seat did not follow the cockpit, so the
 * game's point (or the joint) seats it until it is nudged again.
 */
export const POD_SEAT: Readonly<Record<string, Vec3>> = {
  // Seat (0, -0.28, -0.06) and root (0, 2.66, 3.01): a static pod, its own player point exactly the clip's root.
  fg_8t8_podracer: [0, 2.38, 2.95],
  // Seat (0, 3.13, -7.58) and root (0, 1.1, -0.03): it carries no clips, so nothing moved under the owner while they set it.
  pod_racer_ipg_longtail: [0, 4.23, -7.61],
};

/** What a pod's model offers to seat it by, in the vehicle's frame at the idle's first frame. */
export interface PodSeatFound {
  /** The game's own `player` hardpoint, or null when the pack has none. */
  hardpoint: Vec3 | null;
  /** The cockpit joint's own origin, or null for a pod with no skeleton. */
  joint: Vec3 | null;
  /** The old guess from the mesh, worked out only when nothing else answers. */
  guess: () => Vec3;
}

/** Where a pod's pilot's pelvis goes and which rule said so: the owner's row, the game's point, the joint, the guess. */
export function podSeatRule(id: string, found: PodSeatFound): { pelvis: Vec3; rule: PodSeatRule } {
  if (Object.hasOwn(POD_SEAT, id)) {
    const row = POD_SEAT[id];
    return { pelvis: [row[0], row[1], row[2]], rule: 'table' };
  }
  if (found.hardpoint) return { pelvis: [found.hardpoint[0], found.hardpoint[1], found.hardpoint[2]], rule: 'hardpoint' };
  if (found.joint) return { pelvis: [found.joint[0], found.joint[1], found.joint[2]], rule: 'joint' };
  return { pelvis: found.guess(), rule: 'guess' };
}

/** The bone a node rides: itself or the nearest bone above it, or null. */
export function boneOver(node: THREE.Object3D | null): THREE.Bone | null {
  for (let o = node; o; o = o.parent) if ((o as THREE.Bone).isBone) return o as THREE.Bone;
  return null;
}

/** A model's bone by name (the cockpit's `body`), or null. */
export function boneNamed(model: THREE.Object3D, name: string): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  model.traverse((o) => {
    if (!found && (o as THREE.Bone).isBone && o.name === name) found = o as THREE.Bone;
  });
  return found;
}

/** Where a node stands in `frame`'s space now, or null for no node. Spawn-time arithmetic. */
export function placeIn(frame: THREE.Object3D, node: THREE.Object3D | null): Vec3 | null {
  if (!node) return null;
  frame.updateWorldMatrix(true, false);
  node.updateWorldMatrix(true, false);
  const p = frame.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
  return [p.x, p.y, p.z];
}

/**
 * Hang a pod's seat under its cockpit joint where it names `pelvis` (in `frame`'s space: the vehicle's
 * group), turned as the vehicle is, so from here on it rides the joint through every clip and turns
 * only by what the clips turn the joint. The skeleton must already stand as the idle's first frame has
 * it. Added, not attached, with its place worked out through the joint's own place in `frame` at this
 * moment (its bind), which is handed back: a nudge or a reading in the vehicle's frame goes through it.
 * With no joint the seat stays on `frame` at the pelvis, and null is handed back.
 */
export function hangPodSeat(seat: THREE.Object3D, joint: THREE.Object3D | null, frame: THREE.Object3D, pelvis: Vec3): THREE.Matrix4 | null {
  if (!joint) {
    if (seat.parent !== frame) frame.add(seat);
    seat.position.set(pelvis[0], pelvis[1], pelvis[2]);
    seat.quaternion.identity();
    return null;
  }
  frame.updateWorldMatrix(true, false);
  joint.updateWorldMatrix(true, false);
  const bind = new THREE.Matrix4().copy(frame.matrixWorld).invert().multiply(joint.matrixWorld);
  const unbind = new THREE.Matrix4().copy(bind).invert();
  joint.add(seat);
  seat.position.set(pelvis[0], pelvis[1], pelvis[2]).applyMatrix4(unbind);
  // The joint's own turn at the bind taken off, so the seat stands as the vehicle does.
  const turn = new THREE.Quaternion();
  bind.decompose(new THREE.Vector3(), turn, new THREE.Vector3());
  seat.quaternion.copy(turn).invert();
  seat.updateMatrixWorld(true);
  return bind;
}

/** A seat's place in the vehicle's frame as the idle's first frame stands it: through its bind when it rides a joint, else its own place. */
export function seatInVehicle(seat: THREE.Object3D, bind: THREE.Matrix4 | null, out: THREE.Vector3): THREE.Vector3 {
  out.copy(seat.position);
  return bind ? out.applyMatrix4(bind) : out;
}

/**
 * Move a seat by metres in the vehicle's frame (right, up, forward), through its bind when it rides a
 * joint: a nudge in the joint's own frame would go sideways wherever the joint is turned. Console work.
 */
export function nudgeSeat(seat: THREE.Object3D, bind: THREE.Matrix4 | null, dx: number, dy: number, dz: number): void {
  if (!bind) {
    seat.position.x += dx;
    seat.position.y += dy;
    seat.position.z += dz;
    return;
  }
  const at = seatInVehicle(seat, bind, new THREE.Vector3());
  at.x += dx;
  at.y += dy;
  at.z += dz;
  seat.position.copy(at.applyMatrix4(new THREE.Matrix4().copy(bind).invert()));
}

/**
 * When a pod's own clips change over, all ours: the run once it goes faster than `run`, the idle again
 * only once it is slower than `idle` (m/s), so a pod hovering about one speed never flips between them
 * (the cockpit stands 4 m apart in the two); `fade` seconds across. Live through `__debug.seat({ run, idle })`.
 */
export const POD_GAIT = { run: 0.6, idle: 0.25, fade: 0.2 };

/** Whether a pod plays its run at this speed (m/s), given whether it played it before: anywhere in the band between the two it goes on as it was. */
export function podRuns(speed: number, running: boolean): boolean {
  return running ? speed >= POD_GAIT.idle : speed > POD_GAIT.run;
}

/** A pod's own clips on a mixer of their own, and which one plays. */
export interface PodGait {
  readonly mixer: THREE.AnimationMixer;
  readonly idle: THREE.AnimationAction | null;
  readonly run: THREE.AnimationAction | null;
  /** The run clip's own speed (m/s), which its time scale is measured against. */
  readonly natural: number;
  current: THREE.AnimationAction | null;
  running: boolean;
}

/**
 * A pod's idle and run on a mixer bound to its model, posed as the idle's first frame stands it (the
 * seat is measured there), or null when it has neither clip. `speeds` is the pack's clip speeds.
 */
export function podGait(model: THREE.Object3D, clips: readonly THREE.AnimationClip[], speeds?: Record<string, number>): PodGait | null {
  const named = (names: string[]) => names.map((n) => clips.find((c) => c.name === n)).find((c) => c) ?? null;
  const idleClip = named(['idle', 'loop_stand:speed0']);
  const runClip = named(['run', 'loop_stand:speed2', 'walk', 'loop_stand:speed1']);
  if (!idleClip && !runClip) return null;
  const mixer = new THREE.AnimationMixer(model);
  const action = (c: THREE.AnimationClip | null) => (c ? mixer.clipAction(c).setLoop(THREE.LoopRepeat, Infinity) : null);
  const g: PodGait = { mixer, idle: action(idleClip), run: action(runClip), natural: (runClip && speeds?.[runClip.name]) || 8, current: null, running: false };
  g.current = g.idle ?? g.run;
  g.current?.reset().setEffectiveWeight(1).play();
  mixer.update(0);
  return g;
}

/** A frame of a pod's clips at its speed (m/s): the run or the idle by `podRuns`, faded across, the run kept to the pace. Allocates nothing. */
export function stepPodGait(g: PodGait, dt: number, speed: number): void {
  g.running = podRuns(speed, g.running);
  const next = (g.running ? g.run : g.idle) ?? g.current;
  if (next && next !== g.current) {
    next.reset().setEffectiveWeight(1).fadeIn(POD_GAIT.fade).play();
    g.current?.fadeOut(POD_GAIT.fade);
    g.current = next;
  }
  if (g.current && g.current === g.run && g.running) g.current.timeScale = THREE.MathUtils.clamp(speed / g.natural, 0.5, 2.5);
  g.mixer.update(dt);
}

const nose = new THREE.Vector3();

/**
 * A pod's speed (m/s) as the rider's own game reads its `Vehicle.speed`: the velocity along the nose,
 * both taken level, so a slide sideways, a fall off a ramp or a bob on the springs is no speed at all.
 * For another player's picture, from its glided velocity and the turn it is drawn at. Allocates nothing.
 */
export function podSpeed(vel: THREE.Vector3, turn: THREE.Quaternion): number {
  nose.set(0, 0, 1).applyQuaternion(turn).setY(0);
  const n = nose.length();
  return n > 1e-6 ? (vel.x * nose.x + vel.z * nose.z) / n : 0;
}

/**
 * A frame of another player's pod picture: its own clips stepped by `podSpeed` of its glided velocity,
 * as the rider's own game steps them by its forward speed, so the two screens play the same clip and
 * the pilot that game seated in its cockpit sits in the cockpit drawn here. Nought while landed.
 */
export function stepPodPicture(g: PodGait, dt: number, vel: THREE.Vector3, turn: THREE.Quaternion, landed: boolean): void {
  stepPodGait(g, dt, landed ? 0 : Math.abs(podSpeed(vel, turn)));
}

/** A model's hardpoint node by name (the garage passes its own finder, which reads `hardpointName`). */
export type FindHardpoint = (root: THREE.Object3D, name: string) => THREE.Object3D | null;

/**
 * What a pod's seat is hung on: a Vehicle satisfies it structurally, and the node test passes a plain
 * object. `T` is what its update is handed as itself (the vehicle, whose `speed` is its forward speed).
 */
export interface PodSeatTarget<T extends { readonly speed: number }, D> {
  readonly seat: THREE.Object3D;
  readonly group: THREE.Object3D;
  onUpdate: ((dt: number, self: T, drive: D) => void) | null;
  seatBind: THREE.Matrix4 | null;
  seatPelvis: boolean;
  seatFollows: boolean;
  seatRule: PodSeatRule | null;
}

/** The pod being seated: its garage id (the owner's table's key), its framed model, its clips, and how to find a hardpoint and guess a cockpit. */
export interface PodModel {
  readonly id: string;
  /** The pod's model, framed under the target's group. */
  readonly model: THREE.Object3D;
  readonly clips: readonly THREE.AnimationClip[];
  /** The pack's clip speeds, the run's own pace among them. */
  readonly speeds?: Record<string, number>;
  readonly find: FindHardpoint;
  /** The old guess from the mesh, the last of the rules; worked out only when nothing else answers. */
  readonly guess: () => Vec3;
}

/**
 * Seat a pod's pilot, synchronously, once the vehicle exists (nothing is awaited after `new Vehicle`).
 * In this order, because each step stands on the one before: the pod's own clips are posed as the
 * idle's first frame stands them, and the update that steps them is chained after whatever update the
 * target already had (the engine glow's, which the old animation branch replaced, so the animated pods'
 * glows never moved); then the pelvis by `podSeatRule`, measured in that pose; then the seat hung under
 * the joint that carries the player point (else the cockpit joint), its bind taken in that same pose,
 * which is what `__debug.seat`'s `pelvis` and `paste` read through. Hung before the pose, the bind
 * would be the rest pose's and every paste 2.6 m off the cockpit. The seat names the pelvis, as a
 * saddle's does; with no joint it stays on the vehicle and does not follow anything.
 */
export function seatPod<T extends { readonly speed: number }, D>(target: PodSeatTarget<T, D>, pod: PodModel): { pelvis: Vec3; rule: PodSeatRule; joint: THREE.Object3D | null; gait: PodGait | null } {
  const gait = pod.clips.length ? podGait(pod.model, pod.clips, pod.speeds) : null;
  if (gait) {
    const before = target.onUpdate;
    target.onUpdate = (dt, self, drive) => {
      before?.(dt, self, drive);
      stepPodGait(gait, dt, Math.abs(self.speed));
    };
  }
  const hp = pod.find(pod.model, 'player');
  const body = boneNamed(pod.model, POD_COCKPIT_JOINT);
  const { pelvis, rule } = podSeatRule(pod.id, { hardpoint: placeIn(target.group, hp), joint: placeIn(target.group, body), guess: pod.guess });
  const joint = boneOver(hp) ?? body;
  target.seatBind = hangPodSeat(target.seat, joint, target.group, pelvis);
  target.seatPelvis = true;
  target.seatFollows = !!target.seatBind;
  target.seatRule = rule;
  return { pelvis, rule, joint: target.seatBind ? joint : null, gait };
}
