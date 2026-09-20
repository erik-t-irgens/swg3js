// The other players as things you can hit.
//
// A peer has been a picture until now: a rig, a name over its head and, when they ride, a model of
// the ride. Nothing of it was in the physics world at all, so a bolt went straight through another
// player, a blade swept past them, the Tab reticle never found them and you walked through them.
// This gives each peer on this world a body -- a capsule where the figure stands, and a box round
// the hull they ride -- and puts them in the one list of living things and in the one map from a
// collider to what it belongs to, so the bolts, the blades, the sweeps, the powers, the turrets and
// the creatures' brains find them by walking what they already walk.
//
// The hard part is that a peer must be findable without becoming solid. Their place comes off the
// wire ten times a second and is glided between messages, so the body teleports: made solid it would
// shove a ship it drifted into, climb the player, and trip the character controller. Three things
// keep that from happening, and the first two were measured against the physics engine rather than
// assumed:
//
//  1. Every peer collider is a **sensor**. A sensor is in the broad and narrow phases but never in
//     the solver, so it can never push or be pushed. Measured: a kinematic sensor swept through a
//     resting dynamic box left the box where it lay (2.500), where the same collider not a sensor
//     carried it away (4.030).
//  2. Every peer collider is in a collision group of its own (`Group.peer`) that collides with
//     **nothing** -- membership the peer bit, filter zero. The engine's rule is that a query sees a
//     collider only when the query's own filter accepts the collider's membership *and* the
//     collider's filter accepts the query's membership; with a filter of zero the second half is
//     never true, so every query that passes an interaction group misses a peer, while a query that
//     passes none is not group-tested at all and finds it. Measured on that exact collider: the
//     bolts' ray (no groups, its own `passable` predicate) finds it, a capsule sweep finds it, an
//     aiming ray finds it, and the character controller's filter, the weather's roof grid, a ship's
//     set-down probe and the camera's block ray all miss it.
//  3. The character controller is told to pass over a peer by name as well (`Physics.isPeer`,
//     used the way the ragdolls already are). Point 2 alone is enough today; this is what keeps it
//     true if a call site ever widens its filter, and it is what the design asked for.
//
// `Physics.groundDistance` is the one query that filters nothing *and whose answer is a surface to
// stand on* -- a vehicle's springs, the player's own ground checks -- and that is why it now skips
// peers itself: a peer standing under a speeder must not be its road. The other queries that pass no
// group are, almost all of them, the ones that are meant to find a body: a blade's sweep, an aim
// line, a hitscan, a flame cone. Two are not, and both want one word added where they are written:
// the turrets' line of sight (src/combat/turrets.ts) and the probe that looks for somewhere to set a
// vehicle down (`World.clearGround`) should each pass `groups(Group.all, Group.all)`, which is what
// every query of their kind already passes and costs less than a predicate. Until they do, a player
// standing between a turret and what it is shooting at quiets the turret, and one standing where a
// ship would be set down moves the landing spot along.
//
// Nothing here hurts anybody. A blow struck against a peer is handed to `onBlow` and nothing else
// happens: the shooter's browser is the one that decides a hit, and the health of the player who was
// shot only moves when their own browser says so. With nothing wired to `onBlow` -- no server, an
// older relay, or friendly fire switched off -- a blow simply goes nowhere, which is the game as it
// is today with one more thing for a bolt to stop against.
//
// That last point decides one more thing. A peer is always something a bolt, a blade and a sweep can
// find (`byCollider`), because a body is a body and stopping a shot costs nothing. But the one list
// of the living is what the creatures, the fighters and the Force powers pick a fight out of, and
// nothing on this browser can ever finish a peer: their health moves only on their own screen. So a
// peer joins that list only while a blow struck here could really reach the browser that would
// subtract it -- `onBlow` wired, and `mayHurt` (the server's damage switch, or a duel) saying yes.
// Otherwise the local wildlife would abandon the player and mob the picture of their friend for ever.
//
// Nothing is allocated per frame: the bodies are made when a peer arrives and taken down when they
// go, the poses are written through kept scratch objects, and the one blow record is refilled.
import * as THREE from 'three';
import { Group, RAPIER, groups, type Physics } from '../core/physics.ts';
import { nextLivingKey, type Aggression, type Hittable, type Living, type Side } from '../combat/kit.ts';
import type { PeerView, PeerWatcher } from './remotePlayers.ts';

/** A box in the frame of the thing it measures: half its extents, and where its middle sits. */
export interface PeerBox {
  half: [number, number, number];
  mid: [number, number, number];
}

/**
 * A blow struck here against another player. Handed to `RemoteBodies.onBlow` and nothing else: it is
 * the whole of what this browser does about it. The record is refilled on every blow, so read it in
 * the call and keep what is wanted rather than the object.
 */
export interface PeerBlow {
  /** Their relay id. */
  id: number;
  /** What was struck: the figure, or the hull they ride. */
  what: 'body' | 'ship';
  amount: number;
  /** Where the blow came from in the world, or null when whatever struck did not say. */
  from: THREE.Vector3 | null;
  /** Who struck, as this browser names them (the player's own target for anything the player did). */
  source: Living | null;
}

/**
 * The numbers, all live through `__peers()`.
 *
 * The capsule is the player's own (`src/player/player.ts`: a half height of 0.45 and a radius of
 * 0.35, standing 0.80 over the feet), so being shot at as a peer is being shot at on the same shape
 * you are shot at on your own screen. `hitHeight` is the player's own too -- it is exactly
 * `PlayerTarget.halfHeight` in `src/world/world.ts` -- so a peer's middle, the point a nameplate
 * hangs over and a burst is placed at, is where yours is. The test pins all three against their
 * sources so they cannot drift apart. Only `shipPad`, `on` and `fight` are ours outright.
 */
export const PEER_BODY_TUNE = {
  /** The figure's capsule, the player's own; INVENTED only in that it is held fixed for every species. */
  halfHeight: 0.45,
  radius: 0.35,
  /** The middle of the figure over its feet: the player's own (`PlayerTarget.halfHeight`), not invented. */
  hitHeight: 0.9,
  /** INVENTED: metres the box round a peer's hull is grown past the picture's own. 0 is the picture. */
  shipPad: 0,
  /** INVENTED: 0 takes every peer body down and makes none, for a baseline with them gone. */
  on: 1,
  /** INVENTED: 0 keeps every peer off the one list of the living while leaving their bodies up. */
  fight: 1,
};

/**
 * The smallest capsule the knob will make. Measured on the engine in use: a radius or a half height
 * of zero does not throw, it hands back a collider whose handle is a denormal -- not a handle at all
 * -- which would then go into the lookup, into the physics world's peer set and into `hittableAt`.
 */
const SHAPE_FLOOR = 0.01;

/** Membership the peer bit, filter nothing: see the note at the head of this file. */
const PEER_GROUPS = groups(Group.peer, 0);

/** The figure of another player: something a bolt, a blade or a power can find, that hurts nobody here. */
class PeerBody implements Living {
  readonly key = nextLivingKey();
  /** Their name, as their hello gives it; kept in step when they rename. */
  label: string;
  /** Their own side: the player's, or a duel's while one is on (the shots package sets it). */
  side: Side = 'player';
  /** As the player's own is: the creatures pick on another player exactly as they pick on you. */
  readonly aggression: Aggression = 'aggressive';
  readonly pos = new THREE.Vector3();
  readonly halfHeight = PEER_BODY_TUNE.hitHeight;
  /** Down: their own browser said so. A blow is refused and the brains and the reticle pass over them. */
  dead = false;
  /** Their health as their own browser last said it; nothing here ever subtracts from it. */
  hp = 100;
  maxHp = 100;
  body: RAPIER.RigidBody | null = null;
  collider: RAPIER.Collider | null = null;
  /** On the one list of the living right now: see the note at the head of this file. */
  listed = false;
  /** Their relay id. */
  readonly id: number;
  private readonly owner: RemoteBodies;

  // Written out rather than taken off the constructor's own parameters: this file is run straight by
  // node in its test, and node strips types without rewriting anything.
  constructor(id: number, label: string, owner: RemoteBodies) {
    this.id = id;
    this.label = label;
    this.owner = owner;
  }

  radiusToward(): number {
    return PEER_BODY_TUNE.radius;
  }

  /**
   * A blow struck against them here. Nothing is subtracted: the shooter's browser decides the hit
   * and the player who was shot is the only one who takes the number off, so this hands the blow on
   * and stops. A peer who is down refuses it, as every body in this game refuses one on its first
   * line.
   */
  damage(amount: number, from?: THREE.Vector3, _push?: number, source?: Living | null): void {
    if (this.dead) return;
    this.owner.blow(this.id, 'body', amount, from ?? null, source ?? null);
  }
}

/** The hull another player rides, as a box: it stops a bolt and hands the blow on, and nothing else. */
class PeerShip implements Hittable {
  readonly pos = new THREE.Vector3();
  halfHeight = 1;
  dead = false;
  body: RAPIER.RigidBody | null = null;
  collider: RAPIER.Collider | null = null;
  /** The box the collider was made from, so a ride that changes is measured again rather than kept. */
  half: [number, number, number] = [0, 0, 0];
  mid: [number, number, number] = [0, 0, 0];
  readonly id: number;
  private readonly owner: RemoteBodies;

  constructor(id: number, owner: RemoteBodies) {
    this.id = id;
    this.owner = owner;
  }

  damage(amount: number, from?: THREE.Vector3, _push?: number, source?: Living | null): void {
    this.owner.blow(this.id, 'ship', amount, from ?? null, source ?? null);
  }
}

/** Everything kept for one peer. */
interface Held {
  figure: PeerBody;
  ship: PeerShip | null;
}

/** What the world asks of the peers: the one list, the one map, and a counter that says when they changed. */
export interface PeerHittables {
  readonly byCollider: ReadonlyMap<number, Hittable>;
  readonly living: readonly Living[];
  readonly version: number;
}

/**
 * The peers' bodies. One for the page: the world binds it to the physics world and reads it, the
 * peers feed it, and with no relay it holds nothing and costs a map lookup that misses.
 */
export class RemoteBodies implements PeerWatcher, PeerHittables {
  private physics: Physics | null = null;
  /** Both a figure's collider and a hull's, so `World.hittableAt` answers for either. */
  readonly byCollider = new Map<number, Hittable>();
  /**
   * The figures the brains and the powers may pick a fight with: the ones a blow struck here could
   * reach (see the head of this file). A hull is never on it -- it is a thing to be hit, not a thing
   * that is alive, exactly as the game's own vehicles are.
   */
  private readonly livingList: Living[] = [];

  get living(): readonly Living[] {
    return this.livingList;
  }

  /** Bumped whenever a body comes or goes, or joins or leaves the list, so the world builds again. */
  version = 0;
  /** Told of every blow struck here against a peer; null (no server, an old relay, no friendly fire) means it goes nowhere. */
  onBlow: ((blow: PeerBlow) => void) | null = null;
  /**
   * Whether a blow struck here against that peer could take anything off them at all: the server's
   * damage switch, or a duel the two of them agreed to. Null means "assume it could", which is what a
   * page that wires `onBlow` and nothing else gets. It is asked once per peer per frame and may not
   * throw the frame away, so a hook that throws is read as no.
   */
  mayHurt: ((id: number) => boolean) | null = null;

  private readonly peers = new Map<number, Held>();
  /** Refilled, never made: a blow can come several times a frame from one burst. */
  private readonly theBlow: PeerBlow = { id: 0, what: 'body', amount: 0, from: null, source: null };
  /** Scratch for writing a pose into the engine; the engine copies out of them at the call. */
  private readonly at = { x: 0, y: 0, z: 0 };
  private readonly turn = { x: 0, y: 0, z: 0, w: 1 };
  private readonly up = new THREE.Vector3();

  /** The physics world the bodies live in. Called again with the same world does nothing. */
  bind(physics: Physics): this {
    if (this.physics === physics) return this;
    // A body belongs to the world it was made in and must leave it before that world is let go.
    this.clear();
    this.physics = physics;
    return this;
  }

  // --- what the peers tell it (the create/move/remove interface) -------------------------------

  peerAdded(p: PeerView): void {
    this.peerRemoved(p.id);
    this.peers.set(p.id, { figure: new PeerBody(p.id, p.name, this), ship: null });
    // No collider yet: one is made on the first frame they are shown, which is also the first frame
    // anything knows where they stand. A body made at the origin would be shot at there.
  }

  /**
   * Once a frame, after the peer's figure and the picture of their ride have been put where they are
   * drawn. It makes, moves or takes down the bodies; nothing is allocated.
   */
  peerMoved(p: PeerView): void {
    const held = this.peers.get(p.id);
    const w = this.physics;
    if (!held || !w) return;
    held.figure.label = p.name;
    held.figure.dead = p.down;
    held.figure.hp = p.hp;
    held.figure.maxHp = p.maxHp;
    const wanted = p.shown && PEER_BODY_TUNE.on > 0;
    if (!wanted) {
      this.dropFigure(held);
      this.dropShip(held);
      return;
    }
    this.moveFigure(w, held.figure, p);
    // Whether anything here may pick a fight with them is asked every frame, because it changes
    // without a message of its own: a duel begins, a duel ends, a world's damage switch arrives in
    // the welcome. It is one call and a comparison, and the list is touched only when it changes.
    this.list(held.figure, this.fightable(p.id));
    if (p.ship && p.shipBox) this.moveShip(w, held, p.ship, p.shipBox);
    else this.dropShip(held);
  }

  /** Whether a blow struck here against that peer could reach the browser that would subtract it. */
  private fightable(id: number): boolean {
    if (!(PEER_BODY_TUNE.fight > 0) || !this.onBlow) return false;
    const may = this.mayHurt;
    if (!may) return true;
    try {
      return may(id);
    } catch {
      // A hook that throws loses its own peer and nothing else: this runs inside the frame loop.
      return false;
    }
  }

  /** On or off the one list of the living, bumping the version only when it really changed. */
  private list(f: PeerBody, want: boolean): void {
    if (f.listed === want) return;
    f.listed = want;
    if (want) this.livingList.push(f);
    else {
      const i = this.livingList.indexOf(f);
      if (i >= 0) this.livingList.splice(i, 1);
    }
    this.version++;
  }

  peerRemoved(id: number): void {
    const held = this.peers.get(id);
    if (!held) return;
    this.dropFigure(held);
    this.dropShip(held);
    this.peers.delete(id);
  }

  // --- the bodies themselves --------------------------------------------------------------------

  private moveFigure(w: Physics, f: PeerBody, p: PeerView): void {
    const g = p.group;
    f.pos.copy(g.position);
    // The capsule stands along the figure's own up, not the world's: a peer aboard a banked hull or
    // adrift in space is not upright, and their whole turn is what the relay carries for them.
    this.up.set(0, PEER_BODY_TUNE.radius + PEER_BODY_TUNE.halfHeight, 0).applyQuaternion(g.quaternion);
    this.at.x = g.position.x + this.up.x;
    this.at.y = g.position.y + this.up.y;
    this.at.z = g.position.z + this.up.z;
    this.turn.x = g.quaternion.x;
    this.turn.y = g.quaternion.y;
    this.turn.z = g.quaternion.z;
    this.turn.w = g.quaternion.w;
    if (!f.body) {
      f.body = w.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.at.x, this.at.y, this.at.z).setRotation(this.turn));
      // The floor is the knob's, not a guess: a capsule of zero comes back with a handle that is not
      // a handle. A shape changed by hand shows on the bodies made after it, never on the ones up.
      f.collider = w.world.createCollider(RAPIER.ColliderDesc.capsule(Math.max(SHAPE_FLOOR, PEER_BODY_TUNE.halfHeight), Math.max(SHAPE_FLOOR, PEER_BODY_TUNE.radius)).setSensor(true), f.body);
      f.collider.setCollisionGroups(PEER_GROUPS);
      w.markPeer(f.collider);
      this.byCollider.set(f.collider.handle, f);
      this.version++;
      // A scene query sees nothing the world has not stepped over yet: this body is found from the
      // next step, not this frame. Nothing here depends on it being found sooner.
      return;
    }
    f.body.setNextKinematicTranslation(this.at);
    f.body.setNextKinematicRotation(this.turn);
  }

  private moveShip(w: Physics, held: Held, obj: THREE.Object3D, box: PeerBox): void {
    let s = held.ship;
    const pad = PEER_BODY_TUNE.shipPad;
    // The picture changed for another (they climbed onto something else, or a refit moved its box):
    // the old box is taken down and a new one made, rather than a box that is the wrong ship's.
    if (s && (s.half[0] !== box.half[0] + pad || s.half[1] !== box.half[1] + pad || s.half[2] !== box.half[2] + pad || s.mid[0] !== box.mid[0] || s.mid[1] !== box.mid[1] || s.mid[2] !== box.mid[2])) {
      this.dropShip(held);
      s = null;
    }
    // Where the box's middle sits in the world: the picture's pose times the middle in its own frame.
    this.up.set(box.mid[0], box.mid[1], box.mid[2]).applyQuaternion(obj.quaternion);
    this.at.x = obj.position.x + this.up.x;
    this.at.y = obj.position.y + this.up.y;
    this.at.z = obj.position.z + this.up.z;
    this.turn.x = obj.quaternion.x;
    this.turn.y = obj.quaternion.y;
    this.turn.z = obj.quaternion.z;
    this.turn.w = obj.quaternion.w;
    if (!s) {
      s = new PeerShip(held.figure.id, this);
      s.half = [box.half[0] + pad, box.half[1] + pad, box.half[2] + pad];
      s.mid = [box.mid[0], box.mid[1], box.mid[2]];
      s.halfHeight = s.half[1];
      s.body = w.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.at.x, this.at.y, this.at.z).setRotation(this.turn));
      s.collider = w.world.createCollider(RAPIER.ColliderDesc.cuboid(Math.max(0.05, s.half[0]), Math.max(0.05, s.half[1]), Math.max(0.05, s.half[2])).setSensor(true), s.body);
      s.collider.setCollisionGroups(PEER_GROUPS);
      w.markPeer(s.collider);
      this.byCollider.set(s.collider.handle, s);
      held.ship = s;
      this.version++;
    } else {
      s.body!.setNextKinematicTranslation(this.at);
      s.body!.setNextKinematicRotation(this.turn);
    }
    s.pos.set(this.at.x, this.at.y - s.half[1], this.at.z);
  }

  private dropFigure(held: Held): void {
    const f = held.figure;
    const w = this.physics;
    // Off the list whatever else happens: a peer with no body is nothing to pick a fight with.
    this.list(f, false);
    if (!f.body || !w) return;
    // The handle leaves the lookup at the moment the collider does, never later: the engine hands a
    // recycled handle to the next body made, and an entry left behind would answer for that one.
    if (f.collider) {
      this.byCollider.delete(f.collider.handle);
      w.unmarkPeer(f.collider);
    }
    w.world.removeRigidBody(f.body);
    f.body = null;
    f.collider = null;
    this.version++;
  }

  private dropShip(held: Held): void {
    const s = held.ship;
    const w = this.physics;
    if (!s || !w) return;
    if (s.collider) {
      this.byCollider.delete(s.collider.handle);
      w.unmarkPeer(s.collider);
    }
    if (s.body) w.world.removeRigidBody(s.body);
    held.ship = null;
    this.version++;
  }

  /** A blow struck here against a peer, handed on and no more. */
  blow(id: number, what: 'body' | 'ship', amount: number, from: THREE.Vector3 | null, source: Living | null): void {
    const hand = this.onBlow;
    if (!hand || !(amount > 0)) return;
    const b = this.theBlow;
    b.id = id;
    b.what = what;
    b.amount = amount;
    b.from = from;
    b.source = source;
    hand(b);
  }

  /** Their health and whether they are down, as their own browser said: set by whoever reads the wire. */
  setHealth(id: number, hp: number, maxHp: number): void {
    const f = this.peers.get(id)?.figure;
    if (!f || !Number.isFinite(hp) || !Number.isFinite(maxHp)) return;
    f.hp = Math.max(0, hp);
    f.maxHp = Math.max(1, maxHp);
  }

  /** Whose side they are on: the player's, or a duel's while one is on. */
  setSide(id: number, side: Side): void {
    const f = this.peers.get(id)?.figure;
    if (f) f.side = side;
  }

  /** The living key a peer's figure holds here, so a blow or a retaliation can be named; 0 when they have none. */
  keyOf(id: number): number {
    return this.peers.get(id)?.figure.key ?? 0;
  }

  /** Which peer a living key belongs to, for reading a blow back the other way; 0 when it is nobody's. */
  peerOfKey(key: number): number {
    for (const [id, held] of this.peers) if (held.figure.key === key) return id;
    return 0;
  }

  /** Every body taken down and every entry dropped; the peers themselves are kept. */
  private clear(): void {
    for (const held of this.peers.values()) {
      this.dropFigure(held);
      this.dropShip(held);
    }
  }

  /** For the page going away, or a physics world being let go: nothing of this may outlive it. */
  dispose(): void {
    this.clear();
    this.peers.clear();
    this.physics = null;
    this.onBlow = null;
    this.mayHurt = null;
    this.version++;
  }

  /**
   * What it is holding, in numbers: the tab a script drives is hidden and draws nothing, so the only
   * way to see whether a peer has a body is to ask.
   */
  status(): Record<string, unknown> {
    const rows: { id: number; name: string; key: number; body: boolean; ship: boolean; fights: boolean; hp: number; down: boolean; at: number[] }[] = [];
    for (const [id, held] of this.peers) {
      const f = held.figure;
      rows.push({ id, name: f.label, key: f.key, body: !!f.body, ship: !!held.ship, fights: f.listed, hp: Math.round(f.hp), down: f.dead, at: f.pos.toArray().map((n) => Number(n.toFixed(2))) });
    }
    return { bound: !!this.physics, peers: rows.length, bodies: this.byCollider.size, living: this.livingList.length, version: this.version, hurts: !!this.onBlow, switched: !this.mayHurt ? 'nothing asked' : 'asked', rows, tune: { ...PEER_BODY_TUNE } };
  }
}

/** The one set for the page: the world binds it, the peers feed it, everything else reads it. */
const theBodies = new RemoteBodies();

/** The peers' bodies. Every caller shares one; `bind` gives it the physics world to live in. */
export function peerBodies(): RemoteBodies {
  return theBodies;
}

/**
 * The picture's box in its own frame, the drawn meshes only. A hull that is a portal building
 * carries its rooms as cells beside the shell and they are hidden (and larger than the shell around
 * them), so a box over everything would be a box over rooms nobody can see. Called once, when a
 * peer's ride comes in, never in a frame.
 */
export function measureBox(obj: THREE.Object3D): PeerBox | null {
  obj.updateMatrixWorld(true);
  // In the picture's own frame, wherever the picture itself stands: a box measured in the world
  // would be right only while the ship sat at the origin facing down the axis.
  const toLocal = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const local = new THREE.Matrix4();
  const box = new THREE.Box3();
  const one = new THREE.Box3();
  const walk = (o: THREE.Object3D): void => {
    if (!o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox;
      if (b) box.union(one.copy(b).applyMatrix4(local.multiplyMatrices(toLocal, m.matrixWorld)));
    }
    for (const c of o.children) walk(c);
  };
  walk(obj);
  if (box.isEmpty()) return null;
  const half: [number, number, number] = [(box.max.x - box.min.x) / 2, (box.max.y - box.min.y) / 2, (box.max.z - box.min.z) / 2];
  const mid: [number, number, number] = [(box.max.x + box.min.x) / 2, (box.max.y + box.min.y) / 2, (box.max.z + box.min.z) / 2];
  if (!half.every(Number.isFinite) || !mid.every(Number.isFinite)) return null;
  return { half, mid };
}

/**
 * The live knob, on the window as `__peers()`: what bodies the other players have here, and the
 * numbers above. `__peers({ on: 0 })` takes every one of them down again, which is the baseline to
 * compare a frame against; `__peers({ fight: 0 })` leaves the bodies up and takes the peers off the
 * one list of the living, so nothing here picks a fight with them; `__peers({ shipPad: 1 })` grows
 * the box round a hull. Reading it costs nothing and it never runs in a frame. A change to the two
 * shape numbers shows on bodies made after it: an existing capsule is not rebuilt.
 */
export function peerBodyKnob(opts?: Partial<typeof PEER_BODY_TUNE>): Record<string, unknown> {
  if (opts) {
    for (const key of ['halfHeight', 'radius', 'hitHeight', 'shipPad', 'on', 'fight'] as const) {
      const v = opts[key];
      if (v === undefined || !Number.isFinite(v)) continue;
      // A shape may not be zero (see SHAPE_FLOOR); everything else may.
      PEER_BODY_TUNE[key] = key === 'halfHeight' || key === 'radius' ? Math.max(SHAPE_FLOOR, v) : Math.max(0, v);
    }
  }
  return theBodies.status();
}

// Reachable wherever there is a console: this has no panel of its own, and a browser driven by a
// script is hidden, so the only way to see what it decided is to ask it in numbers.
(globalThis as unknown as { __peers?: typeof peerBodyKnob }).__peers = peerBodyKnob;
