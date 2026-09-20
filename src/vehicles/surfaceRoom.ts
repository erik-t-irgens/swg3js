// Standing on a surface out where there is no gravity: boots that hold the figure to whatever is under it,
// with "up" the face of the thing it stands on. It is the ship rooms' own trick, one step further on.
//
// A ship's rooms are a still copy of the hull with physics of their own: whoever is aboard walks in that
// still world and is drawn wherever the hull's transform carries them, so the hull can loop and nobody
// inside feels it. A surface is the same thing with the model outside instead of the rooms inside: a patch
// of whatever is under the feet is copied into a little world of its own, turned so that the surface's
// normal is that world's up, and the figure walks there. What holds the two together is one transform,
// read from the source's live pose every step, so a rock that never moves, a hull that flies and a wreck
// that tumbles all work the same way, with nothing special written for any of them.
//
// Walking takes the figure round the curve, so the room's up is eased onto the face under the feet each
// step, turning about the feet themselves: the world rolls under the walker and the picture stays upright.
// Rising clear of the face lets go, and the figure is adrift again, which is the whole of the way out.
// Nothing here is drawn: the surface walked on is the world's own model, in the world's own place; only
// its collision is copied.
import * as THREE from 'three';
import { RAPIER, Group, cleanTrimesh, groups, Physics, TRIMESH_FLAGS } from '../core/physics.ts';
import { JKA, UNIT } from '../player/jkaMove.ts';
import type { RoomLight } from './interior';
import type { LiftStop } from '../world/lifts';
import type { Vehicle } from './vehicle';

/**
 * How high a plain jump reaches (m): the walk is Jedi Academy's, so it is that jump's own arithmetic,
 * `jumpVelocity² / 2·gravity` in engine units at `UNIT` metres a unit. Not invented — it is read from the
 * movement's own numbers — and it is the ceiling everything about letting go has to stay under, since a
 * Bounty Hunter (and a Jedi with no force left) has no higher jump than this.
 */
export const JUMP_APEX = ((JKA.jumpVelocity * JKA.jumpVelocity) / (2 * JKA.gravity)) * UNIT;

/**
 * The boots' invented numbers, all of them ours: the game never let anyone stand on a rock. Every one is
 * live through `__debug.boots({ ... })`; the four marked "next take" are read when the boots take hold, so
 * they bite on the next pair rather than on the one being worn.
 * - `patch`: how much of the surface round the spot is copied into the room (m); further off there is nothing. (next take)
 * - `reach`: how far a look for something to stand on carries when the boots are switched on (m).
 * - `feel`: how far over the feet the look for the face under them starts (m).
 * - `release`: how far over that face the figure has to rise before the boots let go (m). It must stay under
 *   `JUMP_APEX` (0.80 m) or no plain jump can ever shake them off, and over the controller's own snap to the
 *   ground (0.35 m) or walking over a lip would let go.
 * - `rise`: how fast the figure has to be going up for that to count as leaving rather than falling (m/s).
 * - `turn`: how quickly the room's up eases onto the face under the feet (degrees a second).
 * - `stray`: how far from where the boots took hold the figure may walk before they let go (m).
 * - `edge`: the share of `stray` at which the prompt starts saying the surface underfoot is running out.
 * - `spare`: how far past the release height the look under the feet still carries (m), so a step off a ledge is seen.
 * - `waist`: how far off the figure a look for something to stand on starts (m), so a ray never starts inside the face.
 * - `triangles`: the most triangles a patch is built from, so a station's hull cannot cost a second to stand on. (next take)
 * - `lift`: how far over the surface the figure is set down when the boots take hold (m). (next take)
 * - `zoom`: how far in the camera is pulled when the boots take hold, as the third-person distance counts it. (next take)
 * - `note`: how long a refusal ("nothing within reach") stays in the prompt (s).
 * - `gravity`: the pull toward the surface (m/s²), the walk's own so that a corpse falls to the face the
 *   walker stood on; the zone's own out here is none at all. 0 takes the zone's. (next take)
 */
export const SURFACE_ROOM = {
  patch: 150,
  reach: 40,
  feel: 1.2,
  release: 0.45,
  rise: 0.1,
  turn: 90,
  stray: 130,
  edge: 0.7,
  spare: 2,
  waist: 0.9,
  triangles: 30000,
  lift: 0.12,
  zoom: 5,
  note: 4,
  gravity: JKA.gravity * UNIT,
};

/**
 * A room a player can stand in, with physics of its own in a frame that is not the world's: a ship's rooms
 * and a surface out in space. Everything the aboard path asks of a room is here, so the two are one kind to
 * it; what only one of them has (a frame of its own, a step of its own) is optional and asked for by name.
 */
export interface WalkableRoom {
  /** The room's own physics world; the player's body lives in it while they are in the room. */
  readonly physics: Physics;
  /**
   * The hull the room belongs to: the ship whose rooms these are, or, for a surface, the ship the walker
   * came out of (or the nearest). A surface belongs to no ship at all and only names one because everything
   * outside the aboard path reads this and would not compile against a nullable one; see `isSurfaceRoom`,
   * which is how those readers tell the two apart.
   */
  readonly vehicle: Vehicle;
  /** Where someone entering stands, in the room's frame. */
  readonly entry: THREE.Vector3;
  /** Where the pilot takes the controls, in the room's frame; null when there is nowhere to fly it from. */
  pilotSpot: THREE.Vector3 | null;
  reveal(aboard: boolean): void;
  roomLights(near: THREE.Vector3, count: number, out?: RoomLight[]): RoomLight[];
  contains(local: THREE.Vector3): boolean;
  liftHere(local: THREE.Vector3): { stops: LiftStop[]; current: number; title: string } | null;
  rideLift(stop: LiftStop): THREE.Vector3;
  toLocal(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3;
  toWorld(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3;
  cameraBlock(from: THREE.Vector3, to: THREE.Vector3): number | null;
  dispose(): void;
  /** A room whose frame is its own rather than the hull's; the hull's is used when this is absent. */
  frame?(): THREE.Matrix4;
  /** The same frame's turn, for the camera. */
  frameTurn?(): THREE.Quaternion;
  /** A room with something to do each step of its own (the surface's ease onto the face under the feet). */
  step?(dt: number, who: RoomWalker): void;
  /** Marks a surface apart from a ship's rooms, for the few places that say something different about it. */
  readonly surface?: boolean;
}

/** What a room's own step needs of whoever stands in it: where they are, how they move, whether they are on the floor. */
export interface RoomWalker {
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  readonly grounded: boolean;
}

/**
 * The frame a room is drawn and flown in: its own when it has one, else the hull's, brought up to date the
 * way the aboard path has always brought it up to date. The matrix belongs to the room; callers read it.
 */
export function roomFrame(room: WalkableRoom): THREE.Matrix4 {
  if (room.frame) return room.frame();
  room.vehicle.group.updateMatrixWorld(true);
  return room.vehicle.group.matrixWorld;
}

/** The same frame's turn: what the camera is upright in while someone is in the room. */
export function roomTurn(room: WalkableRoom): THREE.Quaternion {
  return room.frameTurn ? room.frameTurn() : room.vehicle.group.quaternion;
}

/** Whether a room is a surface the boots hold someone to, rather than a ship's rooms. */
export function isSurfaceRoom(room: WalkableRoom | null | undefined): room is SurfaceRoom {
  return !!room && room.surface === true;
}

const IDENTITY = new THREE.Quaternion();
const swingTmp = new THREE.Quaternion();
const unitA = new THREE.Vector3();
const unitB = new THREE.Vector3();

/**
 * The turn that brings `from` onto `to`, taken no further than `maxStep` radians in one go: the shortest way
 * round, with no twist of its own about either direction, so a walker's facing is left as it was. Returns the
 * angle actually taken, 0 when there was nothing to do.
 */
export function swingTo(from: THREE.Vector3, to: THREE.Vector3, maxStep: number, out: THREE.Quaternion): number {
  if (from.lengthSq() < 1e-9 || to.lengthSq() < 1e-9 || maxStep <= 0) {
    out.identity();
    return 0;
  }
  swingTmp.setFromUnitVectors(unitA.copy(from).normalize(), unitB.copy(to).normalize());
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(swingTmp.w), -1, 1));
  if (angle < 1e-5) {
    out.identity();
    return 0;
  }
  if (angle <= maxStep) {
    out.copy(swingTmp);
    return angle;
  }
  out.copy(IDENTITY).slerp(swingTmp, maxStep / angle);
  return maxStep;
}

const pivotA = new THREE.Matrix4();
const pivotB = new THREE.Matrix4();

/**
 * A transform turned about a point: `m` becomes `translate(pivot) · q · translate(−pivot) · m`. The room's
 * surface is turned about the walker's own feet, which is why the walker never moves when it does.
 */
export function turnAbout(q: THREE.Quaternion, pivot: THREE.Vector3, m: THREE.Matrix4): THREE.Matrix4 {
  pivotA.makeRotationFromQuaternion(q);
  pivotB.makeTranslation(pivot.x, pivot.y, pivot.z);
  pivotA.premultiply(pivotB);
  pivotB.makeTranslation(-pivot.x, -pivot.y, -pivot.z);
  pivotA.multiply(pivotB);
  return m.premultiply(pivotA);
}

/** What a look for something to stand on found: where, which way is up there, and what it belongs to. */
export interface SurfaceFound {
  readonly point: THREE.Vector3;
  readonly normal: THREE.Vector3;
  body: RAPIER.RigidBody | null;
  distance: number;
}

const probeRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
const probePoint = new THREE.Vector3();
const probeNormal = new THREE.Vector3();
const probeFound: SurfaceFound = { point: probePoint, normal: probeNormal, body: null, distance: 0 };

/**
 * What lies along a direction from a point in a physics world: the first thing that is neither the caller's
 * own body nor a corpse. The answer is one object re-used by every call, so nothing is allocated per frame;
 * copy out of it what you keep. Null when nothing is within reach.
 */
export function probeSurface(physics: Physics, from: THREE.Vector3, dir: THREE.Vector3, reach: number, exclude?: RAPIER.RigidBody | null): SurfaceFound | null {
  if (dir.lengthSq() < 1e-9) return null;
  unitA.copy(dir).normalize();
  probeRay.origin.x = from.x;
  probeRay.origin.y = from.y;
  probeRay.origin.z = from.z;
  probeRay.dir.x = unitA.x;
  probeRay.dir.y = unitA.y;
  probeRay.dir.z = unitA.z;
  const hit = physics.world.castRayAndGetNormal(probeRay, reach, true, undefined, groups(Group.all, Group.all), undefined, exclude ?? undefined, (c) => !physics.isRagdoll(c.handle));
  if (!hit) return null;
  const t = hit.timeOfImpact;
  probePoint.set(from.x + unitA.x * t, from.y + unitA.y * t, from.z + unitA.z * t);
  probeNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
  // A ray that starts inside a shape is given no normal at all: the way it came is the best guess there.
  if (probeNormal.lengthSq() < 1e-6) probeNormal.copy(unitA).negate();
  if (probeNormal.dot(unitA) > 0) probeNormal.negate();
  probeFound.body = hit.collider.parent();
  probeFound.distance = t;
  return probeFound;
}

const mSource = new THREE.Matrix4();
const mSourceInv = new THREE.Matrix4();
const mPiece = new THREE.Matrix4();
const mRel = new THREE.Matrix4();
const vTmp = new THREE.Vector3();
const vTmp2 = new THREE.Vector3();
const qTmp = new THREE.Quaternion();
const scaleTmp = new THREE.Vector3();
const sOne = new THREE.Vector3(1, 1, 1);
const ROOM_UP = new THREE.Vector3(0, 1, 0);

/** A rigid body's own frame in the world, read live; the world's own frame for a collider with no body. */
function bodyFrame(body: RAPIER.RigidBody | null, out: THREE.Matrix4): THREE.Matrix4 {
  if (!body || !body.isValid()) return out.identity();
  const t = body.translation();
  const r = body.rotation();
  return out.compose(vTmp.set(t.x, t.y, t.z), qTmp.set(r.x, r.y, r.z, r.w), sOne);
}

/** One copied piece of surface: the triangles as the room holds them, and the body whose pose they follow. */
interface Patch {
  body: RAPIER.RigidBody;
  /** What they were copied from, whose live pose the piece follows; null for the world's own still colliders. */
  source: RAPIER.RigidBody | null;
}

export class SurfaceRoom implements WalkableRoom {
  readonly surface = true;
  readonly physics: Physics;
  readonly entry = new THREE.Vector3();
  readonly pilotSpot: THREE.Vector3 | null = null;
  /** The source's frame into the room's: the room's up is the face the boots took hold on. */
  private readonly toRoom = new THREE.Matrix4();
  private readonly fromRoom = new THREE.Matrix4();
  private readonly frameM = new THREE.Matrix4();
  private readonly frameQ = new THREE.Quaternion();
  private readonly framePos = new THREE.Vector3();
  private readonly patches: Patch[] = [];
  /** The room's own colliders, so the look under the feet never finds the walker's own body. */
  private readonly mine = new Set<number>();
  private readonly onlyMine = (c: RAPIER.Collider): boolean => this.mine.has(c.handle);
  /** How far the feet stand over the face under them, and which way that face looks, as the last step read them. */
  private gap = 0;
  private readonly faceUp = new THREE.Vector3(0, 1, 0);
  private hasFace = false;
  /** The boots have let go: the walker is on their way out, and the aboard path takes them out on its next look. */
  private letGo = false;
  private freed = false;
  /** What was copied, for the console. */
  readonly built = { triangles: 0, pieces: 0, on: 'the world' as string };

  /** The hull the room is named by: the ship walked out of, or the nearest one when the boots were put on. */
  get vehicle(): Vehicle {
    return this.named;
  }
  private named: Vehicle;
  /** What the room is held to: a rock is nothing (the world itself), a hull or a wreck is its body, read live. */
  private readonly source: RAPIER.RigidBody | null;

  private constructor(vehicle: Vehicle, source: RAPIER.RigidBody | null, gravity: number) {
    this.named = vehicle;
    this.source = source;
    this.physics = Physics.local(gravity);
  }

  /**
   * Take hold of a surface: the patch round `at` is copied into a room of its own, turned so that `up` is
   * that room's up, with the spot itself at its middle. `carry` is another body to copy in as well (the
   * hull stepped out of), so it can be walked round and climbed back into. Null when there was nothing
   * there to copy, which the caller shows as a refusal.
   */
  static take(main: Physics, at: THREE.Vector3, up: THREE.Vector3, source: RAPIER.RigidBody | null, vehicle: Vehicle, gravity: number, carry?: RAPIER.RigidBody | null): SurfaceRoom | null {
    const room = new SurfaceRoom(vehicle, source, SURFACE_ROOM.gravity > 0 ? SURFACE_ROOM.gravity : gravity);
    const sourceFrame = bodyFrame(source, new THREE.Matrix4());
    const sourceInv = sourceFrame.clone().invert();
    const anchor = at.clone().applyMatrix4(sourceInv);
    const upLocal = up.clone().transformDirection(sourceInv).normalize();
    const turn = new THREE.Quaternion().setFromUnitVectors(upLocal, ROOM_UP);
    room.toRoom.makeRotationFromQuaternion(turn);
    room.toRoom.setPosition(anchor.clone().applyQuaternion(turn).negate());
    room.fromRoom.copy(room.toRoom).invert();
    if (!room.copyPatch(main, source, anchor, SURFACE_ROOM.patch)) {
      room.dispose();
      return null;
    }
    room.built.on = source ? 'something that can move' : 'the world';
    if (carry && carry !== source && carry.isValid()) {
      const centre = new THREE.Vector3().setFromMatrixPosition(bodyFrame(carry, new THREE.Matrix4()));
      room.copyPatch(main, carry, new THREE.Vector3(), SURFACE_ROOM.patch, centre);
    }
    // The engine sees nothing until the world has stepped: every look cast here would find nothing otherwise.
    room.physics.world.step();
    room.entry.set(0, SURFACE_ROOM.lift, 0);
    room.readFrame();
    console.info(`gravity boots: ${room.built.triangles} triangles in ${room.built.pieces} pieces, holding to ${room.built.on}`);
    return room;
  }

  /**
   * Copy into the room every triangle mesh of one body (or, with none, of the world's own still colliders)
   * whose triangles come within `reach` of a point in that body's own frame. One piece is one body's, so a
   * hull that flies away never takes the rock with it. Returns whether anything was copied.
   */
  private copyPatch(main: Physics, from: RAPIER.RigidBody | null, centre: THREE.Vector3, reach: number, around?: THREE.Vector3): boolean {
    const frame = bodyFrame(from, new THREE.Matrix4());
    const frameInv = frame.clone().invert();
    const world = main.world;
    const box = around ? around.clone() : centre.clone().applyMatrix4(frame);
    const verts: number[] = [];
    const tris: number[] = [];
    const corner = new THREE.Vector3();
    const rel = new THREE.Matrix4();
    const at = new THREE.Vector3();
    const q = new THREE.Quaternion();
    let taken = 0;
    const wanted = SURFACE_ROOM.triangles;
    const reach2 = reach * reach;
    world.collidersWithAabbIntersectingAabb({ x: box.x, y: box.y, z: box.z }, { x: reach, y: reach, z: reach }, (c) => {
      if (taken >= wanted) return false;
      const owner = c.parent();
      if (from) {
        if (!owner || owner.handle !== from.handle) return true;
      } else if (owner && !owner.isFixed()) return true;
      const shape = c.shape;
      if (shape.type !== RAPIER.ShapeType.TriMesh) return true;
      const mesh = shape as RAPIER.TriMesh;
      const t = c.translation();
      const r = c.rotation();
      rel.compose(at.set(t.x, t.y, t.z), q.set(r.x, r.y, r.z, r.w), sOne).premultiply(frameInv);
      const v = mesh.vertices;
      const idx = mesh.indices;
      const map = new Int32Array(v.length / 3).fill(-1);
      for (let i = 0; i + 2 < idx.length && taken < wanted; i += 3) {
        let near = false;
        for (let k = 0; k < 3 && !near; k++) {
          const p = idx[i + k] * 3;
          corner.set(v[p], v[p + 1], v[p + 2]).applyMatrix4(rel);
          if (corner.distanceToSquared(centre) <= reach2) near = true;
        }
        if (!near) continue;
        for (let k = 0; k < 3; k++) {
          const which = idx[i + k];
          if (map[which] < 0) {
            const p = which * 3;
            corner.set(v[p], v[p + 1], v[p + 2]).applyMatrix4(rel);
            map[which] = verts.length / 3;
            verts.push(corner.x, corner.y, corner.z);
          }
          tris.push(map[which]);
        }
        taken++;
      }
      return true;
    });
    if (!tris.length) return false;
    const clean = cleanTrimesh(new Float32Array(verts), new Uint32Array(tris));
    if (!clean) return false;
    const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const desc = RAPIER.ColliderDesc.trimesh(clean.vertices, clean.indices, TRIMESH_FLAGS).setFriction(0.9).setCollisionGroups(groups(Group.interior, Group.all));
    const collider = this.physics.world.createCollider(desc, body);
    this.mine.add(collider.handle);
    const patch: Patch = { body, source: from };
    this.patches.push(patch);
    this.built.triangles += clean.indices.length / 3;
    this.built.pieces++;
    this.placePatch(patch);
    return true;
  }

  /** Where a piece stands in the room now: its own body's live pose, brought through the room's transform. */
  private placePatch(p: Patch): void {
    if (p.source && !p.source.isValid()) return;
    bodyFrame(this.source, mSource);
    mSourceInv.copy(mSource).invert();
    bodyFrame(p.source, mPiece);
    // room = toRoom · (source⁻¹ · piece): the patch the room was cut from lands on the transform itself.
    mRel.multiplyMatrices(mSourceInv, mPiece).premultiply(this.toRoom);
    mRel.decompose(vTmp2, qTmp, scaleTmp);
    p.body.setTranslation({ x: vTmp2.x, y: vTmp2.y, z: vTmp2.z }, false);
    p.body.setRotation({ x: qTmp.x, y: qTmp.y, z: qTmp.z, w: qTmp.w }, false);
  }

  /**
   * The room's frame in the world as the last step read it. Every reader within one frame -- the figure, the
   * camera, anything thrown -- is handed this same matrix rather than reading the source again, because the
   * world's own physics steps between the figure being placed and the camera being moved: read live, the two
   * would sit a step apart, which on something moving fast is a metre of jitter against the drawn hull.
   */
  private follow(): THREE.Matrix4 {
    return this.frameM;
  }

  /** Read the source's live pose again: the room's frame is that pose, times the way out of the room. */
  private readFrame(): THREE.Matrix4 {
    bodyFrame(this.source, mSource);
    this.frameM.multiplyMatrices(mSource, this.fromRoom);
    this.frameM.decompose(this.framePos, this.frameQ, scaleTmp);
    return this.frameM;
  }

  frame(): THREE.Matrix4 {
    return this.follow();
  }

  frameTurn(): THREE.Quaternion {
    this.follow();
    return this.frameQ;
  }

  /**
   * One step of the room: the frame follows what is stood on, the face under the feet is read, the room's up
   * is eased onto it about the walker's own feet, and every piece is put where its body now is. A walker who
   * has risen clear of the face, or gone beyond the patch, is let go.
   */
  step(dt: number, who: RoomWalker): void {
    if (this.freed || this.letGo) return;
    if (this.source && !this.source.isValid()) {
      // What was held to is gone (a hull removed): there is nothing left to stand on.
      this.letGo = true;
      return;
    }
    this.readFace(who);
    this.align(dt, who);
    // After the ease, so the frame handed out this step is the one the walker was turned into.
    this.readFrame();
    for (const p of this.patches) if (p.source !== this.source) this.placePatch(p);
    this.physics.step(dt);
    this.strayed = who.pos.length();
    if (this.strayed > SURFACE_ROOM.stray) this.letGo = true;
    // Off the face and going up: a jump. The feet leaving the ground is what says it, not a height -- the
    // walk's plain jump only reaches JUMP_APEX, so any height near it would hold a jumper to the rock. A
    // walker whose feet are down never lets go however the face is read, and falling never lets go either.
    else if (!who.grounded && this.gap > SURFACE_ROOM.release && (who.vel.y > SURFACE_ROOM.rise || !this.hasFace)) this.letGo = true;
  }

  private readonly faceRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  /** The face under the walker's feet: how far below, and which way it looks. Only the room's own pieces count. */
  private readFace(who: RoomWalker): void {
    const o = this.faceRay.origin;
    o.x = who.pos.x;
    o.y = who.pos.y + SURFACE_ROOM.feel;
    o.z = who.pos.z;
    const reach = SURFACE_ROOM.feel + SURFACE_ROOM.release + SURFACE_ROOM.spare;
    const hit = this.physics.world.castRayAndGetNormal(this.faceRay, reach, true, undefined, undefined, undefined, undefined, this.onlyMine);
    if (!hit) {
      this.hasFace = false;
      this.gap = reach;
      return;
    }
    this.hasFace = true;
    this.gap = Math.max(0, hit.timeOfImpact - SURFACE_ROOM.feel);
    vTmp.set(hit.normal.x, hit.normal.y, hit.normal.z);
    if (vTmp.lengthSq() < 1e-6) vTmp.set(0, 1, 0);
    // The face looked at from above: the side the walker is on is the side that is up.
    if (vTmp.y < 0) vTmp.negate();
    this.faceUp.copy(vTmp).normalize();
  }

  /** The room's up eased onto the face under the feet, turning about the feet, so the walker stays put while it turns. */
  private align(dt: number, who: RoomWalker): void {
    // Only while the feet are on it: in the air the face means nothing, and the room would roll under a jump.
    // Feet down counts whatever the ray measured, so stepping over a lip does not stop the ease for a moment.
    if (!this.hasFace || (!who.grounded && this.gap > SURFACE_ROOM.release)) return;
    const step = THREE.MathUtils.degToRad(SURFACE_ROOM.turn) * dt;
    if (swingTo(this.faceUp, ROOM_UP, step, qTmp) <= 0) return;
    turnAbout(qTmp, who.pos, this.toRoom);
    this.fromRoom.copy(this.toRoom).invert();
    who.vel.applyQuaternion(qTmp);
    this.faceUp.applyQuaternion(qTmp);
    for (const p of this.patches) this.placePatch(p);
  }

  /** Nothing is shown or hidden for a surface: what the walker stands on is the world's own model. */
  reveal(_aboard: boolean): void {}

  /** No room lights out here: the zone's own star is what lights the surface. */
  roomLights(_near: THREE.Vector3, _count: number, out: RoomLight[] = []): RoomLight[] {
    out.length = 0;
    return out;
  }

  /** Whether the boots still hold: the aboard path takes the walker out the moment this is false. */
  contains(_local: THREE.Vector3): boolean {
    return !this.letGo && !this.freed;
  }

  /** The boots let go from here on (a step out): the walker is adrift again on the aboard path's next look. */
  release(): void {
    this.letGo = true;
  }

  /** How the boots stand now, for the prompt and the console. */
  report(): Record<string, unknown> {
    const n2 = (n: number) => Number(n.toFixed(2));
    return {
      held: !this.letGo && !this.freed,
      gap: n2(this.gap),
      face: this.hasFace,
      walked: n2(this.strayed),
      atEdge: this.atEdge,
      jumpApex: n2(JUMP_APEX),
      built: { ...this.built },
      tune: { ...SURFACE_ROOM },
    };
  }

  /** There are no lifts on a rock. */
  liftHere(_local: THREE.Vector3): { stops: LiftStop[]; current: number; title: string } | null {
    return null;
  }

  rideLift(stop: LiftStop): THREE.Vector3 {
    return stop.at.clone();
  }

  toLocal(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    this.follow();
    mRel.copy(this.frameM).invert();
    return out.copy(world).applyMatrix4(mRel);
  }

  toWorld(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(local).applyMatrix4(this.follow());
  }

  private readonly camRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  /**
   * The camera's block test, run in the room: world points in, how far along the room blocks, or null. It is
   * cast here rather than through `Physics.cameraBlock`, whose predicate keeps only what is fixed or has no
   * body at all: the copied patches hang on kinematic bodies, so that test passes straight through them and
   * the view would sink into the rock the walker is standing on. Only the room's own pieces count, which also
   * keeps the walker's own capsule out of it.
   */
  cameraBlock(from: THREE.Vector3, to: THREE.Vector3): number | null {
    this.toLocal(from, vTmp);
    this.toLocal(to, vTmp2);
    const dx = vTmp2.x - vTmp.x;
    const dy = vTmp2.y - vTmp.y;
    const dz = vTmp2.z - vTmp.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return null;
    const o = this.camRay.origin;
    o.x = vTmp.x;
    o.y = vTmp.y;
    o.z = vTmp.z;
    const d = this.camRay.dir;
    d.x = dx / len;
    d.y = dy / len;
    d.z = dz / len;
    const hit = this.physics.world.castRay(this.camRay, len, true, undefined, undefined, undefined, undefined, this.onlyMine);
    return hit ? hit.timeOfImpact : null;
  }

  /** Whether the room was cut out of this body: a hull the boots stand on, rather than one merely beside it. */
  standsOn(body: RAPIER.RigidBody | null): boolean {
    return !!body && !!this.source && body.handle === this.source.handle;
  }

  /**
   * Name the room by another hull. A surface belongs to no ship and only carries one because everything
   * outside the aboard path reads `vehicle`; when that ship goes, the room is pointed at a live one rather
   * than left holding a disposed hull.
   */
  renameTo(v: Vehicle | null): void {
    if (v) this.named = v;
  }

  /** Whether the walker has come near the end of what was copied, so the prompt can say the surface runs out. */
  get atEdge(): boolean {
    return this.strayed > SURFACE_ROOM.stray * SURFACE_ROOM.edge;
  }

  /** How far the walker was from where the boots took hold, as the last step read it. */
  private strayed = 0;

  /** The velocity a walker leaves with, in the world: their own in the room, turned by the frame, plus what they stood on was doing. */
  worldVelocity(vel: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    this.follow();
    out.copy(vel).applyQuaternion(this.frameQ);
    const b = this.source;
    if (b && b.isValid()) {
      const lv = b.linvel();
      out.x += lv.x;
      out.y += lv.y;
      out.z += lv.z;
    }
    return out;
  }

  /**
   * Give the room up. The Rapier world goes with it, so anything else that was put in it -- a corpse's
   * pieces, above all: dying in the boots builds the ragdoll in this world -- has to be out first, or the
   * next frame reads bodies in a world that no longer exists. Whoever lets go ends those before disposing;
   * if any are still here the world is left alone and said so, because a world leaked is a stall and a world
   * freed under a live body is a crash.
   */
  dispose(): void {
    if (this.freed) return;
    this.freed = true;
    const mine = this.patches.length;
    const all = this.physics.world.bodies.len();
    this.patches.length = 0;
    this.mine.clear();
    if (all > mine) {
      console.warn(`gravity boots: the surface still holds ${all - mine} bodies that are not its own, so its world is left alone rather than freed under them`);
      return;
    }
    this.physics.world.free();
  }
}
