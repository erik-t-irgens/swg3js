// A hull somebody else flies, as a place you can stand in.
//
// Until now another player's ship has been a picture: the model with its parts hung on it, moved
// between the relay's messages, its rooms turned off and no physics in it at all. Two comments in
// the tree said so in as many words -- `Garage.visual` ("its rooms hidden, with no physics") and
// `Docking.crossing` ("another player's rooms are not simulated here, so there is nothing to step
// into"). This is what makes the second of those false: on demand, and never for a ship merely in
// view, the picture is given real rooms -- their own little physics world in the hull's frame, their
// own lights, their portal cells -- built, prepared and compiled before anybody is shown them.
//
// Four things decided the shape of it.
//
//  1. **The rooms hang under the picture.** The picture is the only thing on this browser carrying
//     that hull's pose off the wire, so anything that must ride the hull has to hang from it. It also
//     means `RemotePlayers.hullCarrier` answers for a player standing in these rooms with nothing
//     more wired up: it walks a node's parents looking for a peer's picture, and finds one.
//
//  2. **The hull is a stand-in `Vehicle`.** Everything outside a ship's rooms reads
//     `room.vehicle` as a Vehicle -- the prompt line, the bolts' frame, the camera's block test, the
//     room air, the motion blur, the thrown-out path -- at some thirty places across five files.
//     Narrowing every one of them is a change for another day, so instead the picture is given a
//     real Vehicle that does nothing: no model, no colliders, held, weightless, ghosted, never
//     stepped, its body written from the picture's pose each frame so that `pos` and `quaternion()`
//     answer. `InteriorHost` in `src/vehicles/interior.ts` is the interface those rooms really need,
//     and is what makes it possible to drop the stand-in later in one place.
//
//  3. **The rooms of a hull that is itself a portal building are a copy.** Those cells are inside
//     the picture's own model and are turned off there. Moving them out would shift them by the
//     re-centring the garage did to that model and would change the box a bolt stops against, so
//     `Garage.visualRooms` clones them instead: the clone shares its geometry and its materials with
//     the picture, so it uploads nothing, compiles nothing and weighs only its nodes.
//
//  4. **Nothing is built in a frame.** Building a room is an awaited job with the same preparation a
//     spawned vehicle gets (`World.prepareVehicle`, which adopts the materials and then builds their
//     programs a drawable at a time with a breath between), and the rooms stay out of sight until it
//     has finished. No light is ever made: a room's lamps are the flash pool's, borrowed by the same
//     line of the frame that borrows a spawned ship's, so the number of lights in the scene does not
//     move. The game's own modules are reached through a dynamic import at that moment rather than at
//     the top of this file, which keeps this file loadable where three's loaders and the vehicle are
//     not -- that is what its test drives.
//
// Nothing here puts a player anywhere. Making the step into these rooms, and the step across between
// two clamped hulls, is the boarding path's business in `src/main.ts` and `src/space/docking.ts`;
// this file makes the place and takes it down again.
import * as THREE from 'three';
import { measureBox } from './remoteBodies.ts';
import type { Physics } from '../core/physics.ts';
import type { Garage, VehicleDef } from '../vehicles/garage.ts';
import type { ShipInterior } from '../vehicles/interior.ts';
import type { Vehicle, VehicleSpec } from '../vehicles/vehicle.ts';
import type { PeerView, PeerWatcher } from './remotePlayers.ts';

/**
 * What building a peer's rooms needs of the world. The world hands one over
 * (`World.remoteRooms()`); with none, nothing is ever built and this costs one map lookup that
 * misses, which is the game with no server.
 */
export interface RoomDeps {
  /** The world's physics: the stand-in hull's body lives in it. The rooms' own world is their own. */
  physics: Physics;
  /** The scene the stand-in is made in before it is hung under the picture. */
  scene: THREE.Scene;
  /** The planet's or the zone's pull, for the rooms' own little world. */
  gravity(): number;
  garage(): Promise<Garage>;
  /** `World.prepareVehicle`: the materials join the world's schemes and the programs are built, a drawable at a time. */
  prepare(roots: THREE.Object3D[]): Promise<void>;
  /** `World.forgetMaterials`: the portal renderer's set and the cascades' map are both strong holds. */
  forget(materials: THREE.Material[]): void;
  /** `watchPeers`: how this hears that a peer moved, or went. */
  watch(w: PeerWatcher): () => void;
}

/**
 * How a hull and its rooms are really made. There is one of these in play and the test has its own:
 * the live one reaches for the game's own `Vehicle` and `ShipInterior` at the moment a room is asked
 * for, which is an awaited job anyway, and so keeps this file free of three's loaders at load time.
 */
export interface RoomParts {
  /** The stand-in hull: a Vehicle that does nothing, in the world's physics and scene. */
  hull(def: VehicleDef, bounds: VehicleSpec['bounds'], physics: Physics, scene: THREE.Scene): Promise<Vehicle>;
  /** Its rooms, hung under that hull and out of sight, prepared before they come back; null when the hull has none. */
  rooms(hull: Vehicle, def: VehicleDef, garage: Garage, picture: THREE.Object3D, gravity: number, prepare: (roots: THREE.Object3D[]) => Promise<void>): Promise<ShipInterior | null>;
}

/**
 * The numbers, all ours, all live through `__rooms()`.
 *
 * `keepSeconds` is the only one that decides anything on its own: how long a room is kept after the
 * hull it belongs to stops being drawn (its player jumped, travelled, or went) before it is taken
 * down. It is a few seconds because the hull comes back from a jump within one, and rebuilding a room
 * costs a preparation; it is not longer because a room nobody can see is a physics world stepping for
 * nothing.
 */
export const REMOTE_ROOM_TUNE = {
  /** INVENTED: 0 refuses to build any room at all, and takes down the ones that are up. */
  on: 1,
  /** INVENTED: 0 stops stepping the rooms' own physics, for a baseline with them standing still. */
  step: 1,
  /** INVENTED: seconds a room is kept after its hull stops being drawn. */
  keepSeconds: 5,
  /** INVENTED: the longest step the rooms' own physics is given in one go (s), so a stalled tab does not fling anybody through a wall. */
  maxStep: 0.1,
  /**
   * INVENTED: the shortest gap between two sweeps of the rooms (s). The sweep is called once a frame
   * by the game and again once per other player by the peers' own pass, and every one of those is the
   * same frame; two closer together than this do the work once, so nobody's rooms are stepped twice
   * and everybody in one walks at the speed they should. 2 ms is under any frame this game draws.
   */
  minStep: 1 / 500,
};

/** A hull somebody else flies, with rooms in it. */
export interface RemoteRoom {
  /** Their relay id. */
  readonly id: number;
  /** The picture the rooms hang under: the peer's own ship, as the peers built it. */
  readonly picture: THREE.Object3D;
  /** The stand-in hull, which is what `room.vehicle` is for everything outside these rooms. */
  readonly hull: Vehicle;
  /** The rooms themselves: a `WalkableRoom`, the same kind the ship you fly has. */
  readonly interior: ShipInterior;
  readonly label: string;
  /** Somebody is standing in it: it is not taken down under them, whatever else happens. */
  held: boolean;
  /** The hull has gone and somebody is still inside: the rooms stand where the hull last was. */
  adrift: boolean;
}

/** What is kept for one of them; `RemoteRoom` is this seen from outside. */
interface Held extends RemoteRoom {
  hull: Vehicle;
  interior: ShipInterior;
  held: boolean;
  adrift: boolean;
  /** Seconds the hull has not been drawn for; 0 while it is. */
  away: number;
  /** The world's physics it was built in: a travel makes a new one and nothing of the old may be touched. */
  builtIn: Physics;
}

/** What the last frame said about a peer, so a room can be asked for by id alone. Refilled, never made. */
interface Seen {
  ship: THREE.Object3D | null;
  shown: boolean;
  name: string;
}

/** Scratch for writing the stand-in's pose; nothing is allocated per frame. */
const syncPos = new THREE.Vector3();
const syncQuat = new THREE.Quaternion();
const syncScale = new THREE.Vector3();
const bodyAt = { x: 0, y: 0, z: 0 };
const bodyTurn = { x: 0, y: 0, z: 0, w: 1 };

export class RemoteInteriors implements PeerWatcher {
  private deps: RoomDeps | null = null;
  private unwatch: (() => void) | null = null;
  private readonly rooms = new Map<number, Held>();
  private readonly building = new Map<number, Promise<RemoteRoom | null>>();
  private readonly seen = new Map<number, Seen>();
  /** How a hull and its rooms are made; the live one unless a test puts its own in. */
  parts: RoomParts = liveParts;
  /**
   * Told when a room somebody is standing in is about to be taken down (their ship has gone, the
   * world is changing, the knob turned it off). Whoever put the player in it takes them out here: a
   * body left in a physics world that is then freed is the one mistake this whole area punishes. If
   * the room is still held when this returns, it is **not** freed -- it is left standing where the
   * hull last was until it is let go.
   */
  onMustLeave: ((id: number, room: RemoteRoom) => void) | null = null;

  /** The world's physics these rooms' hulls are in; null before anything bound one. */
  get physics(): Physics | null {
    return this.deps?.physics ?? null;
  }

  /**
   * Bind to a world. Called again with the same physics does nothing; called with another world's
   * (a travel) lets go of everything first, without touching the old world, which has been freed.
   * The new world is put in place *before* that letting go, so every room is given back down the one
   * path there is (`release`, then `free`, which sees a physics that is not the one the room was
   * built in and so leaves the old world's bodies alone) and a room somebody is standing in is still
   * not freed under them.
   */
  bind(deps: RoomDeps): this {
    const before = this.deps;
    this.deps = deps;
    if (before && before.physics !== deps.physics) {
      this.releaseAll();
      this.building.clear();
    }
    this.unwatch ??= deps.watch(this);
    return this;
  }

  // --- what the peers tell it ---------------------------------------------------------------------

  peerAdded(p: PeerView): void {
    this.note(p);
  }

  /**
   * Once a frame per peer, after their figure and the picture of their ride have been put where they
   * are drawn. The stand-in is put back on the picture here, at the instant the picture itself was
   * moved: read a frame later it would be a frame behind the hull it rides. Nothing is allocated.
   */
  peerMoved(p: PeerView): void {
    const seen = this.note(p);
    const room = this.rooms.get(p.id);
    if (room && !room.adrift && seen.shown && seen.ship === room.picture) this.sync(room);
    this.step();
  }

  peerRemoved(id: number): void {
    this.release(id);
    this.seen.delete(id);
  }

  /** The clock at the last sweep, so two calls in one frame do the work once. */
  private sweptAt = 0;

  /**
   * Every room kept: its own little physics world stepped, and a room whose hull is no longer drawn
   * aged towards being taken down.
   *
   * This is deliberately not hung off the peers. A room outlives the player it belongs to -- somebody
   * standing in a hull whose pilot has just dropped off the line is standing in a room that must go on
   * being a room -- and the peers' pass says nothing at all about a player who is gone. So it is a
   * sweep of what is held, safe to call from the frame loop and from the peers' pass alike: the
   * second call in a frame is closer than `minStep` to the first and returns at once.
   */
  step(): void {
    if (!this.deps) return;
    const now = performance.now();
    const gap = (now - this.sweptAt) / 1000;
    if (gap < REMOTE_ROOM_TUNE.minStep) return;
    this.sweptAt = now;
    if (!this.rooms.size) return;
    const dt = Math.min(REMOTE_ROOM_TUNE.maxStep, Math.max(0, gap));
    const off = REMOTE_ROOM_TUNE.on <= 0;
    // Deleting the entry being looked at is what a Map's iteration is defined to allow, and `release`
    // is the only thing in here that deletes one.
    for (const [id, room] of this.rooms) {
      if (off) {
        this.release(id);
        continue;
      }
      // A room cut loose from a hull that has gone is put back on nothing and counted down to
      // nothing: it stands where the hull was until whoever is in it steps out. Whoever was asked to
      // take them out is asked again now and then, in case the first asking came at a moment they
      // could not answer. Either way it goes on being stepped, or the floor under the person in it
      // has stopped.
      if (room.adrift) {
        room.away += dt;
        if (room.away > REMOTE_ROOM_TUNE.keepSeconds) {
          room.away = 0;
          this.onMustLeave?.(id, room);
          if (!room.held) {
            this.release(id);
            continue;
          }
        }
      } else {
        const seen = this.seen.get(id);
        // The hull is not being drawn, or they have climbed onto something else: kept for a moment
        // (a jump is back within a second) and then taken down.
        if (seen && seen.shown && seen.ship === room.picture) room.away = 0;
        else {
          room.away += dt;
          if (room.away > REMOTE_ROOM_TUNE.keepSeconds) {
            this.release(id);
            continue;
          }
        }
      }
      if (REMOTE_ROOM_TUNE.step > 0) room.interior.physics.step(dt);
    }
  }

  /** What this frame says about a peer, kept so a room can be asked for by id alone. */
  private note(p: PeerView): Seen {
    let s = this.seen.get(p.id);
    if (!s) {
      s = { ship: null, shown: false, name: '' };
      this.seen.set(p.id, s);
    }
    s.ship = p.ship;
    s.shown = p.shown;
    s.name = p.name;
    return s;
  }

  /**
   * The stand-in hull put where the picture is. Its group is a child of the picture and sits at its
   * origin, so the rooms are drawn exactly on the hull with nothing copied; only `pos` and the body
   * have to be written, and they are written from the picture's own live matrix.
   */
  private sync(room: Held): void {
    const picture = room.picture;
    picture.updateWorldMatrix(true, false);
    picture.matrixWorld.decompose(syncPos, syncQuat, syncScale);
    room.hull.pos.copy(syncPos);
    const body = room.hull.body;
    if (!body.isValid()) return;
    bodyAt.x = syncPos.x;
    bodyAt.y = syncPos.y;
    bodyAt.z = syncPos.z;
    bodyTurn.x = syncQuat.x;
    bodyTurn.y = syncQuat.y;
    bodyTurn.z = syncQuat.z;
    bodyTurn.w = syncQuat.w;
    // It has no colliders and nothing to wake: this is read, never simulated.
    body.setTranslation(bodyAt, false);
    body.setRotation(bodyTurn, false);
  }

  // --- building and taking down ------------------------------------------------------------------

  /**
   * The rooms of that peer's hull, if they are up and still theirs; null otherwise. Costs one map
   * lookup.
   *
   * Rooms cut loose from a hull that has gone are not answered for. They stand where that hull was
   * and follow nothing, so nobody new may be shown into one, and the relay hands its numbers out
   * again, so the id may by now be somebody else flying somewhere else. Whoever is already standing
   * in one still steps out of it (that goes through `enter`, and the boarding path holds the room
   * itself, not its number), and `status()` still shows it.
   */
  roomOf(id: number): RemoteRoom | null {
    const room = this.rooms.get(id);
    return room && !room.adrift ? room : null;
  }

  /**
   * Build that peer's hull as a place, or hand back the one already built. It is a load: the model of
   * an interior of its own is fetched, the materials join the world's schemes and every program is
   * built before it comes back, so the caller waits a moment and then shows a room that compiles
   * nothing. Two calls while one is running share it. Null when there is no such peer here, when
   * their ride is not a hull with rooms, or when nothing has bound a world.
   */
  board(id: number): Promise<RemoteRoom | null> {
    const deps = this.deps;
    if (!deps || !(REMOTE_ROOM_TUNE.on > 0)) return Promise.resolve(null);
    const have = this.rooms.get(id);
    // Rooms cut loose from a hull that has gone are somewhere to stand, not somewhere to board:
    // they stand where that hull was and follow nothing, and the relay hands its numbers out again,
    // so this may already be a different player flying somewhere else entirely.
    if (have?.adrift) return Promise.resolve(null);
    if (have) return Promise.resolve(have);
    const running = this.building.get(id);
    if (running) return running;
    const job = this.build(id, deps)
      .catch((err) => {
        console.warn(`remote rooms: ${id}: their hull could not be made a place`, err);
        return null;
      })
      .finally(() => {
        this.building.delete(id);
      });
    this.building.set(id, job);
    return job;
  }

  private async build(id: number, deps: RoomDeps): Promise<RemoteRoom | null> {
    const seen = this.seen.get(id);
    const picture = seen?.ship ?? null;
    if (!picture) return null;
    const vehicleId = typeof picture.userData.vehicleId === 'string' ? (picture.userData.vehicleId as string) : '';
    if (!vehicleId) {
      console.warn(`remote rooms: ${seen?.name ?? id}: their ship's picture does not say which vehicle it is`);
      return null;
    }
    const garage = await deps.garage();
    const def = garage.find(vehicleId);
    if (!def) return null;
    if (!def.interior && !(def.cells ?? []).some((c) => c.index > 0)) return null;
    // Gone while the garage was loading.
    if (this.deps !== deps || this.seen.get(id)?.ship !== picture) return null;
    // How big the hull is, for the places outside the rooms that measure a hull from its box (where
    // somebody stepping out is stood beside it). The pack's own bounds first, as a spawned hull uses;
    // the picture's drawn meshes when a pack was converted without them.
    const measured = def.bounds ?? boundsOf(picture);
    if (!measured) return null;
    const hull = await this.parts.hull(def, measured, deps.physics, deps.scene);
    let interior: ShipInterior | null = null;
    try {
      if (this.deps !== deps || this.seen.get(id)?.ship !== picture) throw new Error('the hull went while its rooms were being built');
      // Under the picture at its origin: the rooms then ride the hull's pose with nothing copied, and
      // whoever stands in them is reported as standing in that player's hull.
      picture.add(hull.group);
      hull.group.position.set(0, 0, 0);
      hull.group.quaternion.identity();
      hull.group.scale.set(1, 1, 1);
      interior = await this.parts.rooms(hull, def, garage, picture, deps.gravity(), (roots) => deps.prepare(roots));
      if (!interior) throw new Error('no rooms were found in it');
      if (this.deps !== deps || this.seen.get(id)?.ship !== picture) throw new Error('the hull went while its rooms were being built');
    } catch (err) {
      hull.group.removeFromParent();
      interior?.dispose();
      hull.interior = null;
      try {
        hull.dispose(deps.physics, deps.scene);
      } catch {
        // The world went under it; its body belongs to a world that has been freed and is gone with it.
      }
      throw err;
    }
    hull.interior = interior;
    const room: Held = {
      id,
      picture,
      hull,
      interior,
      label: def.label,
      held: false,
      adrift: false,
      away: 0,
      builtIn: deps.physics,
    };
    this.rooms.set(id, room);
    this.sync(room);
    console.info(`remote rooms: ${seen?.name ?? id}'s ${def.label}: ${interior.cells} cells, ${interior.lights.length} lights, entry ${interior.entry.toArray().map((n) => n.toFixed(1)).join(',')}`);
    return room;
  }

  /**
   * Show or hide the rooms and say that somebody is in them. Both together, because they are the same
   * fact: the game's rooms are bigger than the hull around them and are only ever meant to be seen
   * from inside, and a room nobody is in is a room that may be taken down.
   */
  enter(id: number, aboard: boolean): void {
    const room = this.rooms.get(id);
    if (!room) return;
    room.held = aboard;
    room.interior.reveal(aboard);
    // Rooms of its own are a model hung inside the hull rather than cells of it, and `reveal` says
    // nothing about those: they are shown and hidden here.
    if (room.interior.group !== room.hull.group) room.interior.group.visible = aboard;
    if (aboard) room.away = 0;
    // Let go of after its hull had already gone: nothing holds it now.
    if (!aboard && room.adrift) this.release(id);
  }

  /**
   * Take a peer's rooms down. A room somebody is standing in is not freed: whoever put them there is
   * told (`onMustLeave`) and, if they are still in it afterwards, the rooms are cut loose from the
   * picture and left standing exactly where the hull last was until they step out. A physics world
   * freed under a body is what this is guarding against.
   */
  release(id: number): void {
    const room = this.rooms.get(id);
    if (!room) return;
    if (room.held) {
      // Only on the way in to being cut loose. Told again every frame, a room past its keeping time
      // would call back into the game for as long as somebody stayed in a hull that had gone.
      if (!room.adrift) this.onMustLeave?.(id, room);
      if (room.held) {
        if (!room.adrift) this.cutLoose(room);
        return;
      }
    }
    this.rooms.delete(id);
    this.free(room);
  }

  /**
   * The rooms taken off the picture and left standing exactly where the hull last was, because
   * somebody is in them and a physics world freed under a body is what this whole file is written
   * around. The world matrix is kept, so nobody inside moves a millimetre.
   */
  private cutLoose(room: Held): void {
    room.adrift = true;
    room.hull.group.updateWorldMatrix(true, false);
    room.hull.group.matrixWorld.decompose(syncPos, syncQuat, syncScale);
    room.hull.group.removeFromParent();
    this.deps?.scene.add(room.hull.group);
    room.hull.group.position.copy(syncPos);
    room.hull.group.quaternion.copy(syncQuat);
    room.hull.group.scale.copy(syncScale);
    room.hull.pos.copy(syncPos);
    console.warn(`remote rooms: ${room.label}: its hull has gone with somebody still inside; the rooms stand where it was until they step out`);
  }

  /** Everything a room holds, given back. The rooms' own physics world is freed; the world's is only touched when it is still the one it was built in. */
  private free(room: Held): void {
    const deps = this.deps;
    const materials = room.interior.ownMaterials;
    room.hull.group.removeFromParent();
    if (deps && room.builtIn === deps.physics) {
      // `Vehicle.dispose` frees the rooms with the hull, and leaves the clone's geometry alone
      // because every mesh of it is marked shared.
      try {
        room.hull.dispose(deps.physics, deps.scene);
      } catch (err) {
        console.warn(`remote rooms: ${room.label}: its stand-in hull did not go quietly`, err);
      }
    } else {
      // The world it was built in has been freed: its body went with it, and only the rooms' own
      // world, which is theirs alone, is ours to free.
      room.hull.interior = null;
      room.interior.dispose();
    }
    // The materials of an interior model of its own are this room's alone: out of the world's sets
    // (both strong) and gone. A hull's own cells share the picture's materials and are neither.
    if (materials.length) {
      deps?.forget(materials);
      for (const m of materials) m.dispose();
      materials.length = 0;
    }
  }

  /**
   * Every room taken down, as a world unload should: the hulls they belong to are on the world that
   * has just gone. A room somebody is standing in is still not freed under them -- `onMustLeave` is
   * told and it is cut loose if they stay -- because that is the one rule this file will not break.
   */
  releaseAll(): void {
    for (const id of [...this.rooms.keys()]) this.release(id);
  }

  /**
   * For the page going away. Every room is given back down the one path there is, and a room
   * somebody is standing in is not freed under them even here: it is cut loose and left, exactly as
   * it would be at any other time, and goes with the page.
   */
  dispose(): void {
    this.releaseAll();
    for (const room of this.rooms.values()) console.warn(`remote rooms: ${room.label}: somebody is still standing in it as this goes; its rooms are left where they are`);
    this.building.clear();
    this.seen.clear();
    this.unwatch?.();
    this.unwatch = null;
    this.deps = null;
  }

  /**
   * What it is holding, in numbers: the tab a script drives is hidden and draws nothing, so the only
   * way to see whether a friend's hull is a place is to ask. Reading it never runs in a frame and
   * allocates freely.
   */
  status(): Record<string, unknown> {
    const rows: Record<string, unknown>[] = [];
    for (const [id, room] of this.rooms) {
      const size = room.interior.bounds.getSize(new THREE.Vector3());
      rows.push({
        id,
        who: this.seen.get(id)?.name ?? '',
        ship: room.label,
        cells: room.interior.cells,
        lights: room.interior.lights.length,
        ownModel: room.interior.group !== room.hull.group,
        held: room.held,
        adrift: room.adrift,
        drawn: this.seen.get(id)?.shown ?? false,
        awaySeconds: Number(room.away.toFixed(1)),
        entry: room.interior.entry.toArray().map((n) => Number(n.toFixed(2))),
        pilotSpot: room.interior.pilotSpot ? room.interior.pilotSpot.toArray().map((n) => Number(n.toFixed(2))) : null,
        roomSize: size.toArray().map((n) => Number(n.toFixed(1))),
        at: room.hull.pos.toArray().map((n) => Number(n.toFixed(1))),
      });
    }
    const peers: Record<string, unknown>[] = [];
    for (const [id, s] of this.seen) peers.push({ id, name: s.name, drawn: s.shown, ship: !!s.ship, boardable: !!s.ship && typeof s.ship.userData.vehicleId === 'string' });
    // How long ago the rooms were last swept: the one number that says they are being stepped at all,
    // which in a tab a script drives (no frames, no drawing) is the only way to tell.
    const sweptMsAgo = this.sweptAt > 0 ? Number((performance.now() - this.sweptAt).toFixed(1)) : null;
    return { bound: !!this.deps, rooms: rows.length, building: [...this.building.keys()], sweptMsAgo, rows, peers, tune: { ...REMOTE_ROOM_TUNE } };
  }
}

/** The picture's own box, as the peers already measure it for the body a bolt stops against. */
function boundsOf(picture: THREE.Object3D): VehicleSpec['bounds'] | null {
  const box = measureBox(picture);
  if (!box) return null;
  return {
    min: [box.mid[0] - box.half[0], box.mid[1] - box.half[1], box.mid[2] - box.half[2]],
    max: [box.mid[0] + box.half[0], box.mid[1] + box.half[1], box.mid[2] + box.half[2]],
  };
}

/**
 * How it is really made. The game's own modules are reached here, at the moment a room is asked for,
 * rather than at the top of the file: building a room is an awaited job either way, the chunks are
 * already in the bundle because the game imports them, and this way the rest of this file loads where
 * three's loaders and the vehicle cannot -- which is what its test runs.
 */
const liveParts: RoomParts = {
  async hull(def, bounds, physics, scene) {
    const { Vehicle, specFor } = await import('../vehicles/vehicle.ts');
    const spec = specFor('ship', def.id, def.label, bounds);
    // No model: this hull is never drawn, never flown and never met. What it is for is to be the
    // thing everything outside the rooms reads as `room.vehicle`.
    const hull = new Vehicle(spec, new THREE.Group(), physics, scene, 0, 0, 0, 0);
    // What hangs here is rooms, and the game's rooms are larger than the hull around them. The box a
    // bolt stops against is measured over a peer's picture and is re-measured whenever their wings
    // settle, so this subtree is marked out of that measurement: with somebody aboard and the rooms
    // shown, their ship would otherwise grow to the size of its own cabins.
    hull.group.userData.noBox = true;
    // Its one stand-in collider taken away again. The picture already has a box a bolt stops against
    // (the peers' own bodies), and a second one here would take the bolt instead and belong to
    // nothing the world could name, so the shot would count against nobody. The handles stay on the
    // vehicle's own list, so that disposing it still takes them out of the map from a collider to the
    // hull it belongs to; an entry left there for a handle the engine hands out again is read once, by
    // a contact test that checks the collider's body as well and so refuses it.
    const body = hull.body;
    for (let i = body.numColliders() - 1; i >= 0; i--) physics.world.removeCollider(body.collider(i), false);
    // Held, weightless and ghosted: nothing steps it, nothing pulls on it, and the little it does
    // carry (its pose) is written from the picture each frame.
    hull.held = true;
    hull.setGhost(true);
    body.setGravityScale(0, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    return hull;
  },
  async rooms(hull, def, garage, picture, gravity, prepare) {
    const { ShipInterior } = await import('../vehicles/interior.ts');
    // A model of its own: loaded out of sight and prepared before it is measured, so no frame ever
    // draws a mesh whose program is not built.
    if (def.interior) {
      try {
        return await ShipInterior.load(hull, `${import.meta.env.BASE_URL}${def.interior.file}`, def.interior.def, gravity, { hidden: true, prepare });
      } catch (err) {
        console.warn(`remote rooms: ${def.id}: its interior model did not load`, err);
      }
    }
    // A hull that is itself a portal building: a copy of the picture's own cells, sharing its
    // geometry and its materials, under a frame that stands where the picture's model stands. It
    // comes back turned off and stays off through everything below, because everything below yields
    // to the frame loop: hung under a picture that is in the scene and drawn, a friend's cabins
    // would stand through the outside of their ship for every frame of the preparation.
    const copy = garage.visualRooms(picture);
    if (!copy) return null;
    hull.group.add(copy);
    // Its materials are the picture's and are already in the world's sets with their programs built;
    // this is what says so for certain, and costs a lookup a drawable when they are.
    await prepare([copy]);
    const rooms = ShipInterior.fromHull(hull, gravity, { cells: def.cells, portals: def.portals });
    if (!rooms) {
      copy.removeFromParent();
      return null;
    }
    // Safe now: `fromHull` ends by hiding every cell of it and the window panes it found are off for
    // good, so what shows of the copy from here is exactly what `reveal` shows.
    copy.visible = true;
    return rooms;
  },
};

/** The one set for the page: the world binds it, the peers feed it, whoever boards asks it. */
const theRooms = new RemoteInteriors();

/** A hull somebody else flies, as a place. Every caller shares one; `bind` gives it a world to build in. */
export function remoteInteriors(): RemoteInteriors {
  return theRooms;
}

/**
 * The live knob, on the window as `__rooms()`: which of the other players' hulls are places you could
 * stand in, which are up, and the numbers above. `__rooms({ board: 3 })` builds the rooms of the peer
 * with that relay id and reports what it found on the next call; `__rooms({ drop: 3 })` takes them
 * down again; `__rooms({ on: 0 })` takes every one of them down and refuses to build more, which is
 * the baseline to compare a frame against.
 */
export function remoteRoomKnob(opts?: Partial<typeof REMOTE_ROOM_TUNE> & { board?: number; drop?: number }): Record<string, unknown> {
  if (opts) {
    for (const key of ['on', 'step', 'keepSeconds', 'maxStep', 'minStep'] as const) {
      const v = opts[key];
      if (v === undefined || !Number.isFinite(v)) continue;
      REMOTE_ROOM_TUNE[key] = key === 'maxStep' ? Math.max(1 / 240, v) : Math.max(0, v);
    }
    // Turning them off takes down the ones that are up, here and now rather than as each player's
    // next message comes in, so that the frame after this call is the baseline to compare against.
    if (REMOTE_ROOM_TUNE.on <= 0) theRooms.releaseAll();
    if (opts.board !== undefined && Number.isFinite(opts.board)) void theRooms.board(Math.round(opts.board));
    if (opts.drop !== undefined && Number.isFinite(opts.drop)) theRooms.release(Math.round(opts.drop));
  }
  return theRooms.status();
}

// Reachable wherever there is a console: this has no panel of its own, and a browser driven by a
// script is hidden, so the only way to see what it decided is to ask it in numbers.
(globalThis as unknown as { __rooms?: typeof remoteRoomKnob }).__rooms = remoteRoomKnob;
