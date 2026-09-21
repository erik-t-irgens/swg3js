// Docking at a station: asking for a lane, flying it, resting at the dock while the station puts the
// ship right, and flying the lane back out.
//
// The lanes are the client's own, converted into the zone's pack from the hardpoints its station and
// capital-ship hulls carry; `dockingMath.ts` holds every rule read off them and every number we made
// up, and this file is only the plumbing: which hull is near enough to ask, where its lanes stand in
// the world, the drive handed to the flight code, the hold at the dock, the effects and the repair.
//
// Nothing about the flight itself is new: the autopilot fills the same drive an NPC pilot's brain
// does, so a lane is flown by the flight code that already flies every ship. While the ship is at the
// dock it is held (`Vehicle.hold`, from the landing) in the hull's own frame, so a hull that ever
// moves would carry it, and ghosted, so nothing rams a parked ship.
import * as THREE from 'three';
import type { PlacedObject } from '../world/layoutStream.ts';
import type { SpacePack } from './spaceData.ts';
import type { Physics } from '../core/physics.ts';
import type { DriveInput, Vehicle } from '../vehicles/vehicle.ts';
import { probeSurface, type WalkableRoom } from '../vehicles/surfaceRoom.ts';
import {
  CLAMP_TUNE,
  DOCK_FACE,
  DOCK_TUNE,
  LaneClaims,
  SPOT_TUNE,
  approachRun,
  atTheDoor,
  carrierEnough,
  clampClear,
  clampLocal,
  clampOnSkin,
  dockPose,
  exitRun,
  flownBy,
  laneCruise,
  laneDrive,
  lanesOf,
  leadPose,
  lowSide,
  newLaneDrive,
  reached,
  settleEase,
  type BoundsLike,
  type LanePlan,
  type LaneRun,
  type SpotKind,
} from './dockingMath.ts';

/**
 * Handed on so that whatever wires the server's answers to `spotAnswer` can name the kind without
 * reaching past this file into the maths: the kind is half the key a spot is held under and must
 * travel with the name the whole way.
 */
export type { SpotKind };

/** What a dock plays, by the part of docking it belongs to; the keys the pack's `dockEffects` uses. */
export type DockPart = 'harddock' | 'release' | 'reload' | 'repairGroup' | 'repair' | 'repairAlt';

/** What docking needs of the world. A narrow face of `World`, so nothing here reaches further into it. */
export interface DockWorld {
  readonly planet: { readonly space?: string };
  readonly spaceData: SpacePack | null;
  readonly placedObjects: readonly PlacedObject[];
  /** Every hull in this world: where a carrier to clamp onto is looked for. */
  readonly vehicles: readonly Vehicle[];
  /** The world's own physics, for the one ray that lowers a clamp spot onto a carrier's skin. */
  readonly physics: Physics;
  dockEffect(part: DockPart, x: number, y: number, z: number): boolean;
}

/** A hull in the zone that a ship can dock at: where it stands, and its lanes worked out. */
interface DockTarget {
  key: string;
  label: string;
  object: PlacedObject;
  lanes: LanePlan[];
  /** The hull's own frame in the world, which the lanes and the dock pose are read through. */
  frame: THREE.Matrix4;
  frameInverse: THREE.Matrix4;
}

export type DockPhase = 'idle' | 'approach' | 'settle' | 'repair' | 'docked' | 'launch';

/**
 * How a claim reaches the server, and the server's answer reaches back. The wiring hands one of these
 * over when there is a server holding the world; with none -- no address set, the relay that came
 * before, a line that has dropped -- it is null, nothing is ever sent, and every claim is this
 * browser's own exactly as it was before there was anything to ask.
 */
export interface SpotLink {
  /** Whether the server is holding the world just now. Asked at the moment of asking, never kept. */
  active(): boolean;
  /** Ask for a spot (`take`), or give one back. The answer comes back through `Docking.spotAnswer`. */
  send(kind: SpotKind, what: string, take: boolean): void;
}

/** How long the ship's own controls are ignored after a dock is asked for (s, INVENTED: see `Docking.grace`). */
const GRACE = 0.75;

const ONE = new THREE.Vector3(1, 1, 1);

export class Docking {
  /**
   * Who holds which lane, and which spot on a carrier's back. Playing alone it answers here and now,
   * as it always did; with a server it puts the question and holds the claim pending until the answer
   * comes (`spots`, below).
   */
  readonly claims = new LaneClaims();
  /** One ship carried on another's hull: the same row asks for it, and the same step writes its pose. */
  readonly clamp: ShipClamp;
  /**
   * The way to the server for a claim, when there is one. Set by the wiring and null everywhere else,
   * which is where docking is exactly what it was.
   */
  spotLink: SpotLink | null = null;
  /**
   * Something the player should read now rather than on the next press: losing the race for a dock is
   * the only thing docking has to say that a row nobody is looking at would swallow. The message line
   * takes it (the prompt is rewritten every frame and would never show it).
   */
  onNote: (text: string) => void = () => {};
  phase: DockPhase = 'idle';
  /** What the menu says under the row, and what a break-off left behind. */
  note = '';
  private ship: Vehicle | null = null;
  private target: DockTarget | null = null;
  private plan: LanePlan | null = null;
  private readonly run: LaneRun = { lane: '', points: [], out: false, blocked: false };
  private readonly probe: LaneRun = { lane: '', points: [], out: false, blocked: false };
  private index = 0;
  private settleLeft = 0;
  private repairLeft = 0;
  private grace = 0;
  private flown = 0;
  private claimed = '';
  private claimedBy = '';
  /**
   * What this owns of the hull it is flying, so a break-off gives back exactly that. The landing sets
   * a hold of its own down and the jump sets a ghost, and letting go of either one's would put a
   * grounded hull's gravity back or make a jumping one solid.
   */
  private heldByUs = false;
  private ghostedByUs = false;
  /** The candidates in this zone, worked out once per pack rather than per press. */
  private candidates: DockTarget[] = [];
  private candidatesFor: SpacePack | null = null;
  /** What the zone had placed when the candidates were worked out: a zone still streaming has none. */
  private candidatesAt = -1;
  /** The pose the settle eases from, in the hull's frame, and the one it eases to. */
  private readonly fromPos = new THREE.Vector3();
  private readonly fromTurn = new THREE.Quaternion();
  private readonly dockPos = new THREE.Vector3();
  private readonly dockTurn = new THREE.Quaternion();
  private readonly holdPos = new THREE.Vector3();
  private readonly holdTurn = new THREE.Quaternion();
  private readonly point = new THREE.Vector3();
  private readonly shipTurn = new THREE.Quaternion();
  private readonly frameTurn = new THREE.Quaternion();
  private readonly scratch = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3();
  private readonly drive = newLaneDrive();
  /** One name per hull that ever claims a lane, which is what a claim is made under. */
  private readonly owners = new WeakMap<Vehicle, string>();
  private ownerCount = 0;

  /** The world this docks in. A plain field rather than a parameter property: node's own type
   * stripping, which runs the tests straight from source, does not take those. */
  private readonly world: DockWorld;

  constructor(world: DockWorld) {
    this.world = world;
    this.clamp = new ShipClamp(world, this.claims);
    // The claims' three hooks, wired here so that nothing outside this file has to know there is a
    // server at all: the call sites go on calling `claim` and `release` exactly as they did.
    this.claims.ask = (kind, what) => {
      const link = this.spotLink;
      if (!link || !link.active()) return false;
      link.send(kind, what, true);
      return true;
    };
    this.claims.give = (kind, what) => {
      const link = this.spotLink;
      if (link && link.active()) link.send(kind, what, false);
    };
    this.claims.onLost = (what, by, why) => this.lostSpot(what, by, why);
  }

  /**
   * The server's answer to a claim. `what` is the key it was made under and `kind` the kind it was
   * made for, both of which came back with it: the server holds a spot under its world, its kind and
   * its name, so the kind is carried the whole way rather than thrown away here. Anything this
   * browser does not hold is ignored inside `LaneClaims`, so an answer for a zone since left or for a
   * dock already broken off moves nothing -- but one that is merely late still lands, because the
   * wait stops the waiting and not the hearing.
   */
  spotAnswer(what: string, granted: boolean, why = '', kind?: SpotKind): boolean {
    return this.claims.answer(what, granted, why, kind);
  }

  /**
   * A spot this browser had flown on turned out to be somebody else's. The dock is broken off where
   * the ship stands -- a hull must never sit in a lane it does not hold -- and the pilot is told in
   * words, because the row that carries the note may not be open and the press that would show it is
   * the one they have already made.
   */
  private lostSpot(what: string, by: string, why: string): void {
    if (this.claimed === what && this.claimedBy === by) {
      // The break-off writes its own note and gives back everything that claim owned; the lane
      // itself is already marked as theirs, so nothing gives back a claim that is not ours.
      this.breakOff(why);
      this.onNote(why);
      return;
    }
    if (this.clamp.spotLost(what, why)) this.onNote(why);
  }

  /** In a space zone: everything here is for space, and a planet's structures have no lanes. */
  private get inSpace(): boolean {
    return !!this.world.planet.space;
  }

  /** The ship docking, docked or flying a lane; null when nothing is. */
  get busy(): Vehicle | null {
    return this.phase === 'idle' ? null : this.ship;
  }

  /**
   * Whether this hull is held at a dock, or clamped onto another ship (the jump and the crossings ask,
   * and refuse). A carried hull is not its pilot's to take anywhere until it has let go.
   */
  docked(ship: Vehicle | null): boolean {
    // Both hulls of a clamp, not just the one being carried: a carrier flying off with a ship on its
    // back would take it through a zone change nothing carries it across, and the ship would simply
    // vanish when the old world's vehicles went. Carrying two ships across is its own piece of work.
    if (this.clamp.carrying(ship) || this.clamp.carries(ship)) return true;
    return !!ship && ship === this.ship && (this.phase === 'settle' || this.phase === 'repair' || this.phase === 'docked');
  }

  /** Whether the autopilot is flying this hull, so the pilot's own drive is set aside. */
  flying(ship: Vehicle | null): boolean {
    return !!ship && ship === this.ship && (this.phase === 'approach' || this.phase === 'launch');
  }

  /**
   * Every hull in this zone with lanes, worked out once per pack. The count of what the zone has
   * placed is part of the key: the world sets its pack while it loads and builds the streamer
   * afterwards, so a list asked for in that window would otherwise cache an empty answer against the
   * live pack and the zone would offer nothing to dock at for the rest of the session.
   */
  private list(): DockTarget[] {
    const pack = this.world.spaceData;
    const placed = this.world.placedObjects;
    if (this.candidatesFor === pack && this.candidatesAt === placed.length) return this.candidates;
    // A different pack is a different zone: whatever was being docked at is not here any more, and the
    // lanes of the zone left are nobody's. (`leave` is public as well, for a world that says so first.)
    if (this.candidatesFor && this.candidatesFor !== pack) this.leave();
    this.candidatesFor = pack;
    this.candidatesAt = placed.length;
    this.candidates = [];
    const lanes = pack?.lanes ?? {};
    for (const o of this.world.placedObjects) {
      const model = lanes[o.model];
      if (!model?.lanes?.length) continue;
      const plans = lanesOf(model.lanes);
      if (!plans.length) continue;
      const frame = new THREE.Matrix4().compose(new THREE.Vector3(o.x, o.y, o.z), o.q, ONE);
      this.candidates.push({
        key: `${o.model}@${Math.round(o.x)},${Math.round(o.y)},${Math.round(o.z)}`,
        label: this.labelFor(o),
        object: o,
        lanes: plans,
        frame,
        frameInverse: frame.clone().invert(),
      });
    }
    return this.candidates;
  }

  /** The station's own name from the pack, else the piece of scenery's, else its model's id in plain words. */
  private labelFor(o: PlacedObject): string {
    const pack = this.world.spaceData;
    for (const s of pack?.stations ?? []) if (s.model === o.model && Math.abs(-s.x - o.x) < 2 && Math.abs(s.z - o.z) < 2) return s.title || s.name;
    for (const s of pack?.scenery ?? []) if (s.model === o.model && Math.abs(-s.x - o.x) < 2 && Math.abs(s.z - o.z) < 2) return s.name;
    return o.model.replace(/_/g, ' ');
  }

  /** The hull with lanes nearest this point, within `ask` metres; null with none in reach. */
  private nearest(at: THREE.Vector3): { target: DockTarget; distance: number } | null {
    let best: DockTarget | null = null;
    let bestD = Infinity;
    for (const c of this.list()) {
      const d = Math.hypot(c.object.x - at.x, c.object.y - at.y, c.object.z - at.z) - c.object.radius;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best && bestD <= DOCK_TUNE.ask ? { target: best, distance: bestD } : null;
  }

  /**
   * The nearest hull with lanes and the best lane of it this ship can reach from where it stands: the
   * one whose entry point is nearest, among those that are not held by another ship and whose leg does
   * not cross the hull. `why` says what the row and the press should say when there is no lane.
   */
  private offer(ship: Vehicle): { target: DockTarget; lane: LanePlan | null; why: string | null } | null {
    const near = this.nearest(ship.pos);
    if (!near) return null;
    const target = near.target;
    this.point.copy(ship.pos).applyMatrix4(target.frameInverse);
    let best: LanePlan | null = null;
    let bestD = Infinity;
    let blocked = false;
    let taken = false;
    for (const lane of target.lanes) {
      if (!this.claims.free(LaneClaims.key(target.key, lane.lane), this.owner(ship))) {
        taken = true;
        continue;
      }
      approachRun(lane, this.point, this.probe);
      if (this.probe.blocked) {
        blocked = true;
        continue;
      }
      const first = this.probe.points[0];
      const d = Math.hypot(first.x - this.point.x, first.y - this.point.y, first.z - this.point.z);
      if (d >= bestD) continue;
      bestD = d;
      best = lane;
    }
    // A hull the size of the capital ship keeps every lane at its tail: off the nose there is no way in
    // that does not go through it, and the pilot is told to come round rather than flown into it.
    const why = best ? null : blocked ? `come round to the docks at ${target.label}` : taken ? `every lane at ${target.label} is taken` : `${target.label} has no lane to fly`;
    return { target, lane: best, why };
  }

  /** The row the ship menu shows: what the button says, why it cannot be pressed, and what is happening. */
  menuRow(ship: Vehicle | null, role: 'pilot' | 'passenger', inSpace: boolean): { label: string; why: string | null; note: string | null } {
    // A ship already carried on another's hull, or a request from another player: the clamp has the row,
    // since there is nothing about a station this pilot could do until the hull is theirs again. A
    // carrier merely standing near is offered further down, where a station's own lane always wins.
    const carried = this.clamp.row(ship, role);
    if (carried && (this.phase === 'idle' || ship !== this.ship)) return carried;
    if (this.phase !== 'idle' && ship === this.ship) {
      if (this.phase === 'approach') return { label: 'Break off', why: role === 'pilot' ? null : "the pilot's call", note: this.note };
      if (this.phase === 'settle') return { label: 'Launch', why: 'coming alongside', note: this.note };
      if (this.phase === 'repair') return { label: 'Launch', why: `being put right (${this.repairLeft.toFixed(1)} s)`, note: this.note };
      if (this.phase === 'launch') return { label: 'Break off', why: role === 'pilot' ? null : "the pilot's call", note: this.note };
      return { label: 'Launch', why: role === 'pilot' ? null : "the pilot's call", note: this.note };
    }
    if (!ship) return { label: 'Dock', why: 'not in a ship', note: null };
    if (!inSpace || !this.inSpace) return { label: 'Dock', why: 'only in space', note: null };
    if (role !== 'pilot') return { label: 'Dock', why: "the pilot's call", note: null };
    if (ship.held || ship.holding) return { label: 'Dock', why: 'the ship is not yours to fly just now', note: null };
    if (ship.landed) return { label: 'Dock', why: 'lift off first', note: null };
    // A carrier within reach: offered wherever a station has nothing, and in space alone. A hull
    // clamped onto another is held out of its own flight entirely, which over ground would mean no
    // crash, no wings and no landing, so a planet is not where one ship rides another.
    const onto = this.clamp.offerRow(ship, role);
    // Nothing in the zone to dock at is not the same as nothing near: a pack written before the lanes
    // were converted carries none at all, and two of the systems the game shipped have none either.
    if (!this.list().length) {
      if (onto) return onto;
      const old = (this.world.spaceData?.version ?? 0) < 3;
      return { label: 'Dock', why: old ? 'this system\'s pack is older than docking: convert it again' : 'nothing in this system has a dock', note: null };
    }
    const near = this.offer(ship);
    if (!near) return onto ?? { label: 'Dock', why: `no station within ${Math.round(DOCK_TUNE.ask)} m`, note: this.note || null };
    if (this.phase !== 'idle') return { label: 'Dock', why: 'another ship is on the lane', note: null };
    if (!near.lane) return onto ?? { label: 'Dock', why: near.why, note: this.note || null };
    return { label: `Dock at ${near.target.label}`, why: null, note: this.note || null };
  }

  /** The menu's Dock or Launch button: whichever this ship can do now. */
  act(ship: Vehicle | null): string {
    if (!ship) return 'not in a ship';
    // A clamp answers first where it has an answer: a request from another player, an undock, or a
    // carrier in reach. It returns null when the press is not its own. A station's own lane wins over a
    // carrier standing near, so the last of those is only offered where the station has nothing.
    const lane = this.phase === 'idle' && this.inSpace ? this.offer(ship)?.lane ?? null : null;
    // A clamp is only ever started in space, as its row is only offered there; an undock and an answer
    // to another player are not gated that way, so a hull carried into a planet's sky still lets go.
    const onto = this.clamp.act(this.phase === 'idle' || ship !== this.ship ? ship : null, this.inSpace && !lane);
    if (onto !== null) return onto;
    if (ship === this.ship && (this.phase === 'approach' || this.phase === 'launch')) {
      this.breakOff('broken off by the pilot');
      return this.note;
    }
    if (ship === this.ship && this.phase === 'docked') return this.launch();
    // The repair is the station's four seconds and the row says so: a launch during it would cancel
    // the free repair the pilot came for.
    if (ship === this.ship && this.phase === 'repair') return `being put right (${this.repairLeft.toFixed(1)} s)`;
    if (ship === this.ship && this.phase === 'settle') return 'coming alongside';
    return this.dock(ship);
  }

  /** Ask for a lane and start down it. The answer is a line for the menu and the console alike. */
  dock(ship: Vehicle): string {
    if (!this.inSpace) return (this.note = 'docking is for space');
    if (this.phase !== 'idle') return (this.note = 'already docking');
    // A hull something else has hold of is not ours to fly. The jump's flag, a hull set down on
    // something, and a hull in the middle of a set-down (which is holding before it is landed) each
    // read a pose of their own onto the body every step; a second one writing over them would be a
    // tug of war, and the break-off would give back a hold this never took.
    if (ship.held) return (this.note = 'the jump has the ship');
    if (ship.landed) return (this.note = 'lift off first');
    if (ship.holding) return (this.note = 'something else has the ship');
    const near = this.offer(ship);
    if (!near) return (this.note = `no station within ${Math.round(DOCK_TUNE.ask)} m`);
    const target = near.target;
    const best = near.lane;
    if (!best) return (this.note = near.why ?? `no lane at ${target.label}`);
    const key = LaneClaims.key(target.key, best.lane);
    const by = this.owner(ship);
    if (!this.claims.claim(key, by, 'dock')) return (this.note = `lane ${best.lane} is taken`);
    this.claimed = key;
    this.claimedBy = by;
    this.ship = ship;
    this.target = target;
    this.plan = best;
    // `offer` left the ship's place in the hull's frame in `point`, which is what the course is read from.
    approachRun(best, this.point, this.run);
    this.index = 0;
    this.grace = GRACE;
    this.flown = 0;
    this.phase = 'approach';
    // The lane is flown on the answer this browser gave itself while the server's own is still on its
    // way: the round trip is a fraction of a second and the approach is the better part of a minute,
    // so waiting for it would make every dock feel broken. The row says which of the two it is.
    this.note = this.claims.asking(key) ? `flying lane ${best.lane} into ${target.label} · asking for it` : `flying lane ${best.lane} into ${target.label}`;
    return this.note;
  }

  /** Leave the dock along the lane's way out; control comes back at its last point. */
  launch(): string {
    const ship = this.ship;
    const plan = this.plan;
    if (!ship || !plan || this.phase !== 'docked') return 'not docked';
    exitRun(plan, this.run);
    this.index = 0;
    this.grace = GRACE;
    this.flown = 0;
    this.phase = 'launch';
    this.repairLeft = 0;
    this.letGo(ship);
    this.play('release', ship);
    this.note = `leaving by lane ${plan.lane}`;
    return this.note;
  }

  /** Give back the hold this took, and only that one. */
  private letGo(ship: Vehicle): void {
    if (!this.heldByUs) return;
    this.heldByUs = false;
    if (!ship.disposed) ship.release(null);
  }

  /** Give the lane back and hand the ship to its pilot, wherever it stands. */
  breakOff(why: string): void {
    const ship = this.ship;
    if (ship && !ship.disposed) {
      this.letGo(ship);
      if (this.ghostedByUs) ship.setGhost(false);
    }
    this.heldByUs = false;
    this.ghostedByUs = false;
    // By the name the claim was made under, not the ship's: a ship already gone has no name to ask for.
    if (this.claimed && this.claimedBy) this.claims.release(this.claimedBy);
    this.claimed = '';
    this.claimedBy = '';
    this.phase = 'idle';
    this.ship = null;
    this.target = null;
    this.plan = null;
    this.index = 0;
    this.settleLeft = 0;
    this.repairLeft = 0;
    this.run.points.length = 0;
    this.run.blocked = false;
    this.flown = 0;
    this.note = why;
  }

  /**
   * A zone unloaded: nothing in it can be docked at any more. `list` calls this itself the moment the
   * world's pack changes under it, so a travel needs nothing of the world; a world that would rather
   * say so before it unloads may call it. A ship that simply goes (disposed, put back in the garage)
   * needs no call at all: the next step reads `disposed` and gives the lane back.
   */
  leave(): void {
    if (this.ship) this.breakOff('the zone was left');
    this.clamp.leave();
    this.claims.clear();
    this.candidates = [];
    this.candidatesFor = null;
    this.candidatesAt = -1;
  }

  private owner(ship: Vehicle | null): string {
    if (!ship) return 'nobody';
    let name = this.owners.get(ship);
    if (!name) {
      name = `ship${++this.ownerCount}`;
      this.owners.set(ship, name);
    }
    return name;
  }

  /** One of the dock's own effects, played where the ship is. */
  private play(part: DockPart, ship: Vehicle): void {
    this.world.dockEffect(part, ship.pos.x, ship.pos.y, ship.pos.z);
  }

  /**
   * The step: the drive the flying ship is given (the pilot's own whenever docking is not flying it).
   * `pilot` is the hull the player is at the controls of, or null. Called once a step from the game's
   * own vehicle pass, so `__debug.advance` steps a dock as the loop does.
   */
  step(pilot: Vehicle | null, dt: number, drive: DriveInput | null): DriveInput | null {
    // A clamped hull is written to its pose in the carrier's frame before anything has stepped, whether
    // or not a station dock is running, and the pilot's own drive is passed through untouched (the hold
    // is what stops the hull from flying, so nothing has to take the controls away).
    this.clamp.step(dt);
    // The claims' clock, on the step's own seconds like both of the clamp's: a claim waiting on the
    // server and a spot known to be somebody else's both run down here and nowhere else, so they
    // stop while a panel is open and `__debug.advance` steps them as the loop does. It walks an
    // empty table and returns whenever nothing is claimed, which is almost always.
    this.claims.tick(dt);
    if (this.phase === 'idle') return drive;
    // A different pack under a running dock is a travel: an identity compare, so this costs nothing a
    // frame, and the hull being flown belongs to the zone that has gone.
    if (this.candidatesFor && this.candidatesFor !== this.world.spaceData) {
      this.leave();
      return drive;
    }
    const ship = this.ship;
    const target = this.target;
    const plan = this.plan;
    if (!ship || ship.disposed || !target || !plan) {
      this.breakOff('the ship is gone');
      return drive;
    }
    this.grace = Math.max(0, this.grace - dt);
    if (this.phase === 'approach' || this.phase === 'launch') {
      if (pilot !== ship || this.handOn(drive)) {
        this.breakOff(pilot !== ship ? 'nobody is at the controls' : 'broken off by the pilot');
        return drive;
      }
      // A run that has gone on far longer than any lane takes has lost its way: hand the ship back and
      // say so, rather than leaving the autopilot turning at a point it cannot reach.
      this.flown += dt;
      if (this.flown > DOCK_TUNE.budget) {
        this.breakOff(`gave up on lane ${plan.lane} after ${Math.round(this.flown)} s`);
        return drive;
      }
    }
    switch (this.phase) {
      case 'approach':
      case 'launch':
        return this.fly(ship, target, plan, drive);
      case 'settle':
        this.settle(ship, target, dt);
        return drive;
      case 'repair':
        this.holdAt(ship, target, this.dockPos, this.dockTurn);
        this.repairLeft -= dt;
        if (this.repairLeft <= 0) {
          // One step at the end rather than a trickle: the ship's fight has one way back to full, and
          // half-restored shields with the parts still down would be a state nothing else here knows.
          ship.combat?.repair();
          this.phase = 'docked';
          this.note = `docked at ${target.label} · hull and components put right`;
        }
        return drive;
      case 'docked':
        this.holdAt(ship, target, this.dockPos, this.dockTurn);
        return drive;
      default:
        return drive;
    }
  }

  /** Whether the pilot has touched the controls hard enough to take the ship back. */
  private handOn(drive: DriveInput | null): boolean {
    if (!drive || this.grace > 0) return false;
    if (drive.throttle !== 0 || drive.steer !== 0 || drive.hop || drive.up || drive.down) return true;
    // The flight cursor keeps whatever it was left at, so only a good push on it counts as a hand on the stick.
    return Math.abs(drive.stickX ?? 0) > 0.5 || Math.abs(drive.stickY ?? 0) > 0.5;
  }

  /** Fly the course: onto the next point, at the cruise its distance asks for. */
  private fly(ship: Vehicle, target: DockTarget, plan: LanePlan, drive: DriveInput | null): DriveInput | null {
    const run = this.run;
    if (this.index >= run.points.length) {
      if (run.out) {
        // The way out is flown: the hull is the pilot's again.
        this.breakOff(`clear of ${target.label}`);
      } else this.startSettle(ship, target, plan);
      return drive;
    }
    const next = run.points[this.index];
    this.point.set(next.x, next.y, next.z).applyMatrix4(target.frame);
    const distance = ship.pos.distanceTo(this.point);
    const last = this.index === run.points.length - 1;
    const atDock = last && !run.out;
    ship.quaternion(this.shipTurn);
    // Reached, or flown past: a hull with inertia at lane speed turns in a circle far wider than the
    // arrival distance, and a point missed by a few metres would be circled instead of left behind.
    if (reached(distance, atDock, plan.radius) || (!atDock && flownBy(ship.pos, this.shipTurn, this.point, distance))) {
      this.index++;
      this.note = run.out ? `leaving by lane ${plan.lane} (${this.index} of ${run.points.length})` : `flying lane ${plan.lane} into ${target.label} (${this.index} of ${run.points.length})`;
      return this.fly(ship, target, plan, drive);
    }
    laneDrive(ship.pos, this.shipTurn, this.point, laneCruise(distance, atDock), this.drive);
    return this.drive;
  }

  /** The last leg is flown: ease the hull onto the dock's own pose and hold it there. */
  private startSettle(ship: Vehicle, target: DockTarget, plan: LanePlan): void {
    dockPose(plan, this.run, this.dockPos, this.dockTurn);
    // Where the ship stands now, in the hull's frame: the settle runs in that frame, so a hull that
    // moved would carry the ship through it.
    this.fromPos.copy(ship.pos).applyMatrix4(target.frameInverse);
    target.frame.decompose(this.scratch, this.frameTurn, this.scratchScale);
    ship.quaternion(this.shipTurn);
    this.fromTurn.copy(this.frameTurn).invert().multiply(this.shipTurn);
    this.settleLeft = DOCK_TUNE.settle;
    this.phase = 'settle';
    // Nothing may ram a ship that cannot move out of the way, and the hull it is resting against is
    // solid. A ghost this set is a ghost this gives back, and no other owner's.
    this.ghostedByUs = true;
    ship.setGhost(true);
    this.play('harddock', ship);
    this.note = `coming alongside ${target.label}`;
  }

  private settle(ship: Vehicle, target: DockTarget, dt: number): void {
    this.settleLeft = Math.max(0, this.settleLeft - dt);
    const k = settleEase(DOCK_TUNE.settle > 0 ? 1 - this.settleLeft / DOCK_TUNE.settle : 1);
    this.holdPos.lerpVectors(this.fromPos, this.dockPos, k);
    this.holdTurn.slerpQuaternions(this.fromTurn, this.dockTurn, k);
    this.holdAt(ship, target, this.holdPos, this.holdTurn);
    if (this.settleLeft > 0) return;
    this.phase = 'repair';
    this.repairLeft = DOCK_TUNE.repair;
    this.play('repair', ship);
    this.note = `at the dock of ${target.label} · being put right`;
  }

  /** Hold the hull at a pose in the hull's frame, written before every step as the landing's hold is. */
  private holdAt(ship: Vehicle, target: DockTarget, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    this.heldByUs = true;
    ship.hold(target.frame, pos, quat);
  }

  /** A point of the course in the world, for the report. */
  private worldPoint(target: DockTarget, i: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.run.points[i];
    return out.set(p.x, p.y, p.z).applyMatrix4(target.frame);
  }

  /**
   * Every invented number, live: `__debug.dock({ laneSpeed: 60 })`, `__debug.dock({ face: 'lane' })`,
   * `__debug.dock({ clamp: { gap: 3 } })`. A station's numbers and a clamp's share the one call, and the
   * clamp's are set under `clamp`, which is the one form to give the owner: two of the names are in both
   * (`ask`, `settle`), and only `clamp` says which is meant. A name that is the clamp's alone is taken at
   * the top level as well, so a console that reaches for `{ gap: 3 }` is not simply ignored.
   */
  tune(patch: Partial<typeof DOCK_TUNE> & { face?: typeof DOCK_FACE.rule; clamp?: Partial<typeof CLAMP_TUNE>; spots?: Partial<typeof SPOT_TUNE>; allow?: boolean } = {}): Record<string, unknown> {
    for (const k of Object.keys(SPOT_TUNE) as (keyof typeof SPOT_TUNE)[]) {
      const n = patch.spots?.[k];
      if (typeof n === 'number' && Number.isFinite(n)) SPOT_TUNE[k] = Math.max(0, n);
    }
    for (const k of Object.keys(DOCK_TUNE) as (keyof typeof DOCK_TUNE)[]) {
      const n = patch[k];
      if (typeof n === 'number' && Number.isFinite(n)) DOCK_TUNE[k] = n;
    }
    for (const k of Object.keys(CLAMP_TUNE) as (keyof typeof CLAMP_TUNE)[]) {
      const n = (patch.clamp?.[k] ?? (k in DOCK_TUNE ? undefined : (patch as Record<string, unknown>)[k])) as number | undefined;
      if (typeof n === 'number' && Number.isFinite(n)) CLAMP_TUNE[k] = n;
    }
    if (patch.face === 'auto' || patch.face === 'hardpoint' || patch.face === 'lane') DOCK_FACE.rule = patch.face;
    if (patch.allow !== undefined) this.clamp.answer(!!patch.allow);
    return this.report();
  }

  /** What is happening, for the console and for a headless check. */
  report(): Record<string, unknown> {
    const n2 = (n: number) => Number(n.toFixed(2));
    const target = this.target;
    return {
      phase: this.phase,
      note: this.note,
      ship: this.ship?.spec.id ?? null,
      at: target?.label ?? null,
      lane: this.plan?.lane ?? null,
      way: this.run.out ? 'out' : 'in',
      point: this.index,
      points: this.run.points.length,
      radius: this.plan ? n2(this.plan.radius) : null,
      toGo: this.ship && this.target && this.index < this.run.points.length ? n2(this.ship.pos.distanceTo(this.worldPoint(this.target, this.index, this.scratch))) : null,
      settling: n2(this.settleLeft),
      repairing: n2(this.repairLeft),
      flown: n2(this.flown),
      held: this.ship?.holding ?? false,
      ghosted: this.ship?.ghosted ?? false,
      ours: { held: this.heldByUs, ghosted: this.ghostedByUs },
      claims: this.claims.count,
      // Whether a claim is with the server at all, and what has become of the ones that were: with no
      // link every one of these is a local answer and `asked` stays 0, which is the one number that
      // says docking is running exactly as it does alone.
      spots: { link: this.spotLink && this.spotLink.active() ? 'server' : 'none', ...this.claims.stats(), tune: { ...SPOT_TUNE } },
      targets: this.list().map((c) => ({ at: c.label, model: c.object.model, lanes: c.lanes.map((l) => ({ lane: l.lane, in: l.in.map((w) => w.points.length), out: l.out.map((w) => w.points.length), radius: n2(l.radius), bare: l.bare })) })),
      face: DOCK_FACE.rule,
      tune: { ...DOCK_TUNE },
      clamp: this.clamp.report(),
    };
  }
}

// ---------------------------------------------------------------------------------------------------
// One ship clamped onto another
//
// A clamped ship is written to a pose in the carrier's frame before every step and ghosted. Nothing of
// it is simulated in that frame: the carrier's pilot flies both hulls because only one of them is
// flown at all, and the ship being carried answers nothing but Undock. The crew of either ship ride
// along untouched, because a ship's rooms are already drawn from its own live matrix, which for the
// carried hull is now the carrier's matrix times the clamp pose.
//
// The whole of it is ours: see the note at the foot of `dockingMath.ts`.

/** What a clamp calls the thing it is holding to: a hull in this world, or another player's ship. */
export type ClampOn = { kind: 'ship'; ship: Vehicle } | { kind: 'peer'; id: number };

/** The directed messages two browsers pass about a clamp. */
export type ClampWord = 'dock' | 'allow' | 'refuse' | 'undock';

/** What a clamp needs of the other players: where their ship stands, how big it is, and who they are. */
export interface ClampPeers {
  /** Every peer in this world who is on a ship, filled into `out` (which is cleared first). */
  shipPeers(out: number[]): number[];
  /** The pose and velocity of the ship peer `id` is on; false when they are on none, or are elsewhere. */
  vehiclePose(id: number, pos: THREE.Vector3, quat: THREE.Quaternion, vel: THREE.Vector3): boolean;
  /** That ship's name, box and bounding radius; null when the picture of it is not in yet. */
  vehicleOf(id: number): { label: string; bounds: BoundsLike; radius: number } | null;
  /** What to call the player, for the rows. */
  peerName(id: number): string;
}

/** How a clamp speaks to one other player. Local play leaves it null and nothing is ever sent. */
export interface ClampLink {
  /** This browser's own id on the relay; 0 while it is offline. */
  id(): number;
  send(to: number, word: ClampWord): void;
}

// ---------------------------------------------------------------------------------------------------
// A hull somebody else flies, as a place to stand in
//
// A peer's ship has always been a picture here: the model with its parts hung on it, moved between
// messages, its rooms hidden and no physics in it. Standing in one means building those rooms as a
// still room of their own -- the gravity-hull technique the game already uses for your own ship, with
// the picture's live matrix as the frame -- and that is a load, so it is asked for and waited on.
//
// Whoever builds them registers here (`setPeerRooms`). Nothing in this file builds anything: it only
// asks. With nobody registered every question below answers "no" and the game is exactly what it was,
// which is also what playing alone and what an older relay both look like.

/** A hull another player flies, once this browser can make a place to stand in of it. */
export interface PeerRooms {
  /** Their hull as a room, when it is already built and ready to walk in; null when it is not. */
  roomOf(id: number): WalkableRoom | null;
  /** Whose hull a room is: the relay id of the player who flies it, 0 for a room that is nobody's. */
  idOf(room: WalkableRoom | null | undefined): number;
  /**
   * Build that hull's rooms and make them ready -- prepared and compiled before anything is shown --
   * and answer the room. Null when that hull cannot be one (they have gone, it has no rooms, the
   * build failed); `why` says which. Asking for a hull already open answers with what is there.
   */
  open(id: number): Promise<WalkableRoom | null>;
  /**
   * Somebody has stepped into those rooms, or out of them: they are shown or hidden, and while
   * somebody is in them they are not taken down whatever else happens. It is not the same word as
   * `close`, which gives them back: a walker who steps out of a friend's hull and straight back in
   * should not wait for the whole thing to be built a second time.
   */
  aboard(id: number, yes: boolean): void;
  /**
   * Done with them: the rooms come down and the hull is a picture again. Safe for a hull never
   * opened, and for one still opening. Never asked for a room somebody is standing in.
   */
  close(id: number): void;
  /** Why that hull is not somewhere to stand, in words for a row; null when it is, or will be once asked. */
  why(id: number): string | null;
  /**
   * The nearest player whose hull's side is within `range` m of a point in the world, and whose hull
   * is one that could be stood in at all; 0 when none is. The action bar asks this every frame, so
   * it allocates nothing and builds nothing.
   */
  nearest(at: THREE.Vector3, range: number): number;
  /** What to call their ship, for the rows and the notes. */
  label(id: number): string;
  /**
   * That hull as it stands: its place and its motion in the world, filled in, and its bounding radius
   * returned. 0 when the hull is not here, and then nothing is filled. For standing a walker clear of
   * it on the way out; it allocates nothing.
   */
  hullAt(id: number, pos: THREE.Vector3, vel: THREE.Vector3): number;
}

/** Whoever builds peers' rooms, and whoever wants telling when one is about to go. One of each per page. */
let thePeerRooms: PeerRooms | null = null;
let hullGoneWatcher: ((id: number) => void) | null = null;

/** Register (or let go of) whatever makes a hull somebody else flies into a place to stand in. */
export function setPeerRooms(rooms: PeerRooms | null): void {
  thePeerRooms = rooms;
}

/** What can make a peer's hull boardable, or null when nothing can -- playing alone, or an older relay. */
export function peerRooms(): PeerRooms | null {
  return thePeerRooms;
}

/**
 * Whoever boards registers once here. The builder calls `peerHullGone(id)` *before* it frees a room's
 * physics, so a walker standing in it can be put somewhere in the world first: a body left in a freed
 * world is the one mistake this whole path cannot survive.
 */
export function onPeerHullGone(fn: ((id: number) => void) | null): void {
  hullGoneWatcher = fn;
}

/** Called by the builder before a peer's rooms are taken down. */
export function peerHullGone(id: number): void {
  hullGoneWatcher?.(id);
}

/**
 * INVENTED, both of them, and live through `__board({ ... })`:
 * - `reach`: how near the side of a hull somebody else flies you must stand for E to board it (m). The
 *   local one is 3.6 m from a vehicle's side; a parked ship is a bigger thing to walk up to and its
 *   picture's radius is measured from the model's origin, not its middle, so this is roomier.
 * - `wait`: how long boarding waits for their rooms to be built before it gives up and says so (s).
 *   Building them is a load and a compile: a second or two the first time, nothing after.
 */
export const BOARD_TUNE = {
  reach: 8,
  wait: 20,
};

/**
 * The live knob, on the window as `__board()`: whether anything in this browser can make a hull
 * somebody else flies into a place to stand in, whether anyone is listening for one going, and the
 * two numbers above, which it also sets. Reading it costs nothing and it never runs in a frame. A
 * script-driven tab is hidden, so this is the only way to see what boarding is set to.
 */
export function boardKnob(opts?: { reach?: number; wait?: number }): Record<string, unknown> {
  if (opts) {
    if (opts.reach !== undefined && Number.isFinite(opts.reach)) BOARD_TUNE.reach = Math.max(0, opts.reach);
    if (opts.wait !== undefined && Number.isFinite(opts.wait)) BOARD_TUNE.wait = Math.max(0, opts.wait);
  }
  return { builder: thePeerRooms ? 'registered' : 'none', watcher: hullGoneWatcher ? 'registered' : 'none', tune: { ...BOARD_TUNE } };
}

(globalThis as unknown as { __board?: typeof boardKnob }).__board = boardKnob;

/**
 * Which hull a crossing is from, or to: one in this world, or one another player flies. It is what a
 * clamp calls the thing it holds to, said again in the crossing's own words -- `pairOf` answers one
 * where the other is expected -- and the two are one name so they cannot drift apart.
 */
export type CrossSide = ClampOn;

/** Where a crossing goes, and what to call it. */
export type CrossTo = CrossSide & { label: string };

/** Whether two sides name the same hull. */
function sameSide(a: CrossSide, b: CrossSide): boolean {
  return a.kind === 'ship' ? b.kind === 'ship' && a.ship === b.ship : b.kind === 'peer' && a.id === b.id;
}

/** What the ship menu's Board row is told about where the walker stands; every field is already decided. */
export interface BoardState {
  /** The hull clamped to this one that the walker could cross into, by name; null when there is none. */
  across: string | null;
  /** Whether that hull is one another player flies, which is the only crossing this row is shown for. */
  theirs: boolean;
  /** Whether the walker stands at their own room's way in, which is the only place a crossing is offered. */
  atDoor: boolean;
  /** A crossing asked for and still being made ready, so the row waits rather than asking again. */
  opening: boolean;
  /** Why that hull cannot be crossed into just now (their rooms are not built, they have gone); null when it can. */
  why: string | null;
}

/**
 * What the ship menu's Board row says. Pure, so every case can be walked in a test with no DOM: the
 * words and the reasons are here, the gathering is the game's and the drawing is the menu's.
 *
 * Null where there is nothing to board, and the row is then not shown at all. The game only offers it
 * for a hull another player flies, because that is the crossing that can be waited on and refused;
 * between two hulls of this world E at the way in is instant and always works, and a row saying so
 * would be a change to a game played alone, where no hull is ever anyone else's.
 */
export function boardRow(state: BoardState | null): { label: string; why: string | null; note: string | null } | null {
  if (!state) return null;
  // The one row that is drawn before anything is known to be there: a crossing has been asked for and
  // the rooms are being made, which is the only way `opening` is ever set. It names the hull when the
  // game could name it, so the row is never a bare word about a ship nobody mentioned.
  if (state.opening) return { label: state.across ? `Crossing to the ${state.across}…` : 'Crossing…', why: 'their rooms are being built', note: 'once, the first time you board that hull' };
  if (!state.across || !state.theirs) return null;
  const why = state.why ?? (state.atDoor ? null : "stand at your own room's way in to cross");
  return { label: `Cross to the ${state.across}`, why, note: why === null ? 'E at the way in does the same' : null };
}

/** A hull being carried, and where it rests. */
interface Carried {
  ship: Vehicle;
  on: ClampOn;
  label: string;
  /** The clamp pose in the carrier's frame. */
  readonly local: THREE.Vector3;
  readonly quat: THREE.Quaternion;
  /** Where the settle eases from, in that same frame. */
  readonly fromPos: THREE.Vector3;
  readonly fromQuat: THREE.Quaternion;
  settleLeft: number;
}

const CLAMP_UP = new THREE.Vector3(0, 1, 0);
const CLAMP_ONE = new THREE.Vector3(1, 1, 1);
const STILL_V = new THREE.Vector3();

/**
 * The name a clamp's claims are made under. One browser clamps one ship at a time -- `dock` refuses
 * outright while anything is carried, letting go or waiting -- so there is one owner and it needs no
 * counter of its own, unlike the station's, which names the hull because a lane is claimed per ship.
 */
const CLAMP_OWNER = 'clamp';

/**
 * The spot on one hull's back, as the server keys it: the connection of whoever flies it. Every
 * browser but that pilot's own knows their ship by that number, and the pilot never asks for room on
 * their own hull, so the two sides of a race name the same spot without anything being sent about it.
 */
function carrierSpot(id: number): string {
  return LaneClaims.key('carrier', String(id));
}

export class ShipClamp {
  /** The other players, for a clamp onto their ship; null in a browser playing alone. */
  peers: ClampPeers | null = null;
  /** The way to one other player; null offline. */
  link: ClampLink | null = null;
  /** What the row says under itself, and what the last answer was. */
  note = '';
  private carried: Carried | null = null;
  /** A hull let go of, still ghosted until it is clear of the carrier it was on. */
  private letting: { ship: Vehicle; on: ClampOn } | null = null;
  /**
   * A request to another player's pilot, waiting for their answer, and the hull it was asked for.
   * While `asking` is set the word has **not** gone out yet: the spot on that hull's back is still
   * pending with the server, and the request waits for it (see `dock`). `label` is what to call the
   * hull in the row when it does go out.
   */
  private waiting: { to: number; left: number; ship: Vehicle; asking: boolean; label: string } | null = null;
  /** A request from another player, waiting for this pilot's answer, and the hull they asked for room on. */
  private asked: { from: number; name: string; left: number; ship: Vehicle } | null = null;
  /**
   * Each peer this pilot has let dock, and the hull they were let onto. It is the only thing this
   * browser knows of a peer's ship riding its own: their clamp is theirs, so the grant stands as the
   * record of it until they say they have let go, or they or the hull go away.
   */
  private readonly allowed = new Map<number, Vehicle>();
  /** Each pair of hulls' clamp spot, worked out once: the carrier's model and the carried one's. */
  private readonly spots = new Map<string, THREE.Vector3>();
  /** How many times the ray down a carrier's back found nothing, so the box's top was used and not kept. */
  private missed = 0;
  private readonly frame = new THREE.Matrix4();
  private readonly framePos = new THREE.Vector3();
  private readonly frameQ = new THREE.Quaternion();
  private readonly frameVel = new THREE.Vector3();
  private readonly leadPos = { x: 0, y: 0, z: 0 };
  private readonly leadQ = { x: 0, y: 0, z: 0, w: 1 };
  private readonly holdPos = new THREE.Vector3();
  private readonly holdQuat = new THREE.Quaternion();
  private readonly spot = new THREE.Vector3();
  private readonly world: DockWorld;
  private readonly peerIds: number[] = [];
  private readonly scratch = new THREE.Vector3();
  private readonly scratch2 = new THREE.Vector3();
  private readonly scratchQ = new THREE.Quaternion();
  private readonly scratchScale = new THREE.Vector3();
  /** Where a peer's ship stands, for the one test that asks whether it is really on this hull. Its own, so nothing nested can write over it. */
  private readonly pairPos = new THREE.Vector3();
  private readonly pairQ = new THREE.Quaternion();
  private readonly pairVel = new THREE.Vector3();
  private readonly inverse = new THREE.Matrix4();
  private readonly rel = new THREE.Matrix4();
  private readonly relPos = new THREE.Vector3();
  private readonly relQ = new THREE.Quaternion();
  /**
   * The same table the station's lanes are claimed in: one hull's back is a place two ships can want
   * at once exactly as a dock is, and one table means one answer. It is the docking's own, handed in
   * rather than made here, because the server answers both kinds through the one link.
   */
  private readonly claims: LaneClaims;

  constructor(world: DockWorld, claims: LaneClaims = new LaneClaims()) {
    this.world = world;
    this.claims = claims;
  }

  /** The hull being carried, or being let go of; null when nothing is. */
  get busy(): Vehicle | null {
    return this.carried?.ship ?? this.letting?.ship ?? null;
  }

  /** Whether this hull is clamped onto something: a jump, a crossing and a station dock all refuse while it is. */
  carrying(ship: Vehicle | null): boolean {
    return !!ship && this.carried?.ship === ship;
  }

  /**
   * Whether this hull has something clamped onto it: a hull in this world, or another player's ship
   * this pilot has let on (the grant is all this browser has of theirs). A carrier is refused the jump,
   * both crossings and the landing for the same reason the hull it carries is.
   */
  carries(ship: Vehicle | null): boolean {
    if (!ship) return false;
    const on = this.carried?.on;
    if (on && on.kind === 'ship' && on.ship === ship) return true;
    if (this.allowed.size) for (const v of this.allowed.values()) if (v === ship) return true;
    return false;
  }

  /**
   * The other ship a walker aboard `from` may cross into, when the two are clamped together, both are
   * places to stand in, and the walker stands at their own room's way in. `at` is in the frame of the
   * hull they are standing in, as `Player.pos` is aboard.
   *
   * Either side may be a hull another player flies: one of ours clamped onto theirs, or one of theirs
   * they were let onto. Their side is only ever a crossing once their rooms are actually built here,
   * which `peerRooms()` answers for; with nobody building them this is the local pair it always was.
   */
  crossing(from: CrossSide, at: THREE.Vector3): CrossTo | null {
    const other = this.crossPair(from);
    if (!other) return null;
    const entry = this.entryOf(from);
    return entry && atTheDoor(at, entry, CLAMP_TUNE) ? other : null;
  }

  /**
   * The same pair without the door test: the hull clamped to this one that is a place to stand in,
   * by name. It is what the menu's row is written from, so the row can say "stand at the way in"
   * rather than simply not appearing while the walker is at the far end of the cabin.
   */
  crossPair(from: CrossSide): CrossTo | null {
    const other = this.pairOf(from);
    if (!other) return null;
    const label = this.roomLabel(other);
    return label === null ? null : ({ ...other, label } as CrossTo);
  }

  /**
   * The hull clamped to this one, either way round and whoever flies it, or null. Our own clamp knows
   * its pair exactly and will not answer until the settle has run out; a peer's ship riding our hull
   * is known only by the grant we gave them (their clamp is theirs), so its own ease is theirs to
   * finish and the gate on that side is simply whether their rooms are here.
   */
  private pairOf(side: CrossSide): CrossSide | null {
    const c = this.carried;
    if (c && c.settleLeft <= 0) {
      if (side.kind === 'ship' && side.ship === c.ship) return c.on;
      if (sameSide(side, c.on)) return { kind: 'ship', ship: c.ship };
    }
    // One grant per pair of hulls, so the first that names this side is the pair -- but only while
    // they are really on it.
    for (const [id, v] of this.allowed) {
      const ours = side.kind === 'ship' && side.ship === v;
      const theirs = side.kind === 'peer' && side.id === id;
      if (!ours && !theirs) continue;
      if (!this.resting(id, v)) continue;
      return ours ? { kind: 'peer', id } : { kind: 'ship', ship: v };
    }
    return null;
  }

  /**
   * Whether the ship a peer was let onto this hull is really lying on it. The grant on its own says
   * nothing about that: it is written the moment this pilot says yes, which is before the asking ship
   * has flown a metre of an approach that reaches fifty of them, and it stands until they say they
   * have let go -- which a pilot whose own clamp never began never says. Their clamp is theirs and
   * this browser cannot see it, so the test is the one an undock already uses the other way round:
   * they are on the hull for as long as they are not clear of it.
   */
  private resting(id: number, carrier: Vehicle): boolean {
    const peers = this.peers;
    if (!peers || carrier.disposed) return false;
    const info = peers.vehicleOf(id);
    if (!info || !peers.vehiclePose(id, this.pairPos, this.pairQ, this.pairVel)) return false;
    return !clampClear(this.pairPos, carrier.pos, info.radius, carrier.radius, CLAMP_TUNE);
  }

  /** The way in of the room a walker is standing in, in that hull's own frame; null when it has none. */
  private entryOf(side: CrossSide): THREE.Vector3 | null {
    if (side.kind === 'ship') return side.ship.disposed ? null : side.ship.interior?.entry ?? null;
    return peerRooms()?.roomOf(side.id)?.entry ?? null;
  }

  /**
   * What to call the hull a crossing would go into, or null when there is nothing there to step into.
   *
   * For a hull another player flies that is "built, or buildable". A hull nothing in this browser can
   * make a place of answers `why` and is refused here; one that simply has not been asked for yet is
   * a crossing that waits while it is built, which is the whole point of the row and of the note the
   * walker gets. Gating this on the rooms being up already would mean the first crossing into a
   * friend's hull could never be started, since nothing else ever asks for them to be built.
   */
  private roomLabel(side: CrossSide): string | null {
    if (side.kind === 'ship') return !side.ship.disposed && side.ship.interior ? side.ship.spec.label : null;
    const rooms = peerRooms();
    if (!rooms) return null;
    return rooms.roomOf(side.id) || rooms.why(side.id) === null ? rooms.label(side.id) : null;
  }

  /**
   * The row while the clamp is doing something: carried, coming alongside, clearing the hull, waiting
   * for another player's answer, or asked by one. Null when it is doing none of those, and the station's
   * own lanes have the row.
   */
  row(ship: Vehicle | null, role: 'pilot' | 'passenger'): { label: string; why: string | null; note: string | null } | null {
    // A request from another player comes before anything about this pilot's own flight: it is theirs to answer.
    const asked = this.asked;
    if (asked && ship === asked.ship) return { label: `Let ${asked.name} dock`, why: role === 'pilot' ? null : "the pilot's call", note: `${Math.ceil(asked.left)} s of flying to answer · __debug.dock({ allow: false }) turns them away` };
    if (!ship) return null;
    const c = this.carried;
    if (c?.ship === ship) {
      if (c.settleLeft > 0) return { label: 'Undock', why: 'coming alongside', note: this.note || null };
      return { label: `Undock from ${c.label}`, why: role === 'pilot' ? null : "the pilot's call", note: this.note || null };
    }
    if (this.letting?.ship === ship) return { label: 'Dock', why: 'still clearing the hull', note: this.note || null };
    // Only for the hull the question was asked for: a pilot who stepped into another ship meanwhile is
    // not kept from a station's lane by a request that is not about the hull they are flying.
    if (this.waiting?.ship === ship) return { label: 'Dock', why: 'waiting for their answer', note: this.note || null };
    return null;
  }

  /**
   * The row where a carrier is within reach and nothing else is on offer. A station's own lane always
   * wins, so this is only ever asked once the station has said it has nothing.
   */
  offerRow(ship: Vehicle | null, role: 'pilot' | 'passenger'): { label: string; why: string | null; note: string | null } | null {
    if (!ship) return null;
    const near = this.offer(ship);
    if (!near) return null;
    if (role !== 'pilot') return { label: 'Dock', why: "the pilot's call", note: null };
    return { label: `Dock onto ${near.label}`, why: this.refusal(ship), note: this.note || null };
  }

  /**
   * The row pressed. Null when the clamp has nothing to do with this press, so the station's dock takes
   * it. `mayStart` is false where a station lane is on offer, which always wins over a carrier near by.
   */
  act(ship: Vehicle | null, mayStart = true): string | null {
    // A null ship is the caller saying the press is the station's, not the clamp's: nothing here may
    // answer it, or a Launch would grant a peer's request and leave the ship where it stood.
    if (!ship) return null;
    if (this.asked && this.asked.ship === ship) return this.answer(true);
    if (this.carried?.ship === ship) return this.undock();
    if (this.letting?.ship === ship) return (this.note = 'still clearing the hull');
    if (this.waiting?.ship === ship) return (this.note = 'waiting for their answer');
    return mayStart && this.offer(ship) ? this.dock(ship) : null;
  }

  /** Let the asking player dock, or turn them away. */
  answer(yes: boolean): string {
    const asked = this.asked;
    if (!asked) return (this.note = 'nobody has asked');
    this.asked = null;
    if (yes && asked.ship.disposed) {
      this.link?.send(asked.from, 'refuse');
      return (this.note = `the hull ${asked.name} asked for is gone`);
    }
    this.link?.send(asked.from, yes ? 'allow' : 'refuse');
    // The grant is the record: this browser never sees their clamp, so it is what says the hull is
    // carrying something until they let go, or they or the hull go away.
    if (yes) this.allowed.set(asked.from, asked.ship);
    return (this.note = yes ? `${asked.name} may dock` : `turned ${asked.name} away`);
  }

  /** Why this hull cannot be clamped onto anything just now; null when it can. */
  private refusal(ship: Vehicle): string | null {
    if (ship.disposed) return 'the ship is gone';
    if (ship.held) return 'the jump has the ship';
    if (ship.landed) return 'lift off first';
    if (ship.holding) return 'something else has the ship';
    if (Math.abs(ship.speed) > CLAMP_TUNE.slow) return `slow to ${Math.round(CLAMP_TUNE.slow)} m/s first`;
    return null;
  }

  /** Ask to be carried: onto a hull in this world at once, onto another player's ship by their leave. */
  dock(ship: Vehicle): string {
    if (this.carried || this.letting || this.waiting) return (this.note = 'already docking');
    const why = this.refusal(ship);
    if (why) return (this.note = why);
    const near = this.offer(ship);
    if (!near) return (this.note = `nothing within ${Math.round(CLAMP_TUNE.ask)} m big enough to carry this ship`);
    if (near.on.kind === 'peer') {
      const link = this.link;
      if (!link || !link.id()) return (this.note = 'their ship is not ours to dock onto while offline');
      // One ship to a hull's back, and **one** race for it. The spot is claimed first; the word to
      // their pilot waits until that claim has stopped being pending, because their pilot decides by
      // arrival order -- one request at a time, the next refused outright -- and a spot the server
      // gave to one ship while their pilot's single slot held the other would turn both away, each
      // refused by a different judge. Waiting here makes the server the only judge: whoever it grants
      // the spot to is the only one who asks at all. It costs at most `SPOT_TUNE.wait`, against a
      // request that stands for `CLAMP_TUNE.lapse`, and the clock below runs from the press either
      // way. Playing alone the claim is never pending, the word goes out in this same call, and this
      // is exactly the local answer it always was.
      if (!this.claims.claim(carrierSpot(near.on.id), CLAMP_OWNER, 'carrier')) return (this.note = `another ship is already coming aboard ${near.label}`);
      const asking = this.claims.asking(carrierSpot(near.on.id));
      this.waiting = { to: near.on.id, left: CLAMP_TUNE.lapse, ship, asking, label: near.label };
      if (asking) return (this.note = `asking for room on ${near.label}`);
      link.send(near.on.id, 'dock');
      return (this.note = `asked ${near.label} for room`);
    }
    return this.begin(ship, near.on, near.label);
  }

  /** The ease onto the clamp spot begins: from where the hull stands now, in the carrier's frame. */
  private begin(ship: Vehicle, on: ClampOn, label: string): string {
    if (!this.carrierFrame(on, 0, 0)) return (this.note = 'the ship to dock onto is gone');
    if (!this.spotFor(on, ship, this.spot)) return (this.note = 'nowhere on that hull to rest');
    this.inverse.copy(this.frame).invert();
    const c: Carried = {
      ship,
      on,
      label,
      local: this.spot.clone(),
      quat: new THREE.Quaternion(),
      fromPos: ship.pos.clone().applyMatrix4(this.inverse),
      fromQuat: new THREE.Quaternion(),
      settleLeft: CLAMP_TUNE.settle,
    };
    this.frame.decompose(this.scratch, this.scratchQ, this.scratchScale);
    ship.quaternion(this.holdQuat);
    c.fromQuat.copy(this.scratchQ).invert().multiply(this.holdQuat);
    this.carried = c;
    // Nothing may ram a hull that cannot move out of the way, and the hull it rides is solid.
    ship.setGhost(true);
    return (this.note = `docking onto ${label}`);
  }

  /** Let go: the carrier's own motion, plus a push along its up, and solid again once it is clear. */
  undock(): string {
    const c = this.carried;
    if (!c) return (this.note = 'not docked onto anything');
    this.carried = null;
    const ship = c.ship;
    // The spot goes back the moment this hull lets go of it, not when it is clear: what the next ship
    // needs to know is that nobody is being eased onto that back any more.
    this.claims.release(CLAMP_OWNER);
    if (c.on.kind === 'peer') this.link?.send(c.on.id, 'undock');
    if (ship.disposed) return (this.note = 'the ship is gone');
    // The carrier's own velocity is what the hull was travelling at, and the push is along the carrier's
    // up, so a ship let go of never drops through the hull it was riding. A carrier that has gone in the
    // meantime leaves nothing to read: the hull is simply let go where it stands, and made solid at once.
    if (!this.carrierFrame(c.on, 0, 0)) {
      ship.release(null);
      ship.setGhost(false);
      return (this.note = 'the ship it was docked onto is gone');
    }
    this.scratch.copy(CLAMP_UP).applyQuaternion(this.frameQ).multiplyScalar(CLAMP_TUNE.push).add(this.frameVel);
    ship.release(this.scratch);
    this.letting = { ship, on: c.on };
    return (this.note = `let go of ${c.label}`);
  }

  /**
   * The step. Called once a step from the game's own vehicle pass, before any hull has moved, which is
   * why the carrier's pose is read a step ahead (`leadPose`).
   */
  step(dt: number): void {
    // A grant outlives nothing: the peer who was let on has gone or has left this world, or the hull
    // they were let onto is not there any more. Otherwise a hull that was once ridden would be refused
    // the jump for the rest of the session. The set is empty almost always, and is not walked then.
    if (this.allowed.size) {
      for (const [id, v] of this.allowed) if (v.disposed || !this.peers?.vehicleOf(id)) this.allowed.delete(id);
    }
    // Both clocks run on the step's own seconds, not the wall's, so they stop while a panel is open --
    // which is the point: the ship menu is the only place a request can be answered, and the twenty
    // seconds must not run out while the pilot is reading the row. They run again the moment it is shut.
    const asked = this.asked;
    if (asked) {
      asked.left -= dt;
      if (asked.ship.disposed) {
        this.link?.send(asked.from, 'refuse');
        this.asked = null;
      } else if (asked.left <= 0) {
        this.asked = null;
        this.note = `${asked.name} waited long enough and was not answered`;
      }
    }
    const waiting = this.waiting;
    if (waiting) {
      waiting.left -= dt;
      // Either way the spot goes back: a hull nobody is coming aboard is a hull the next ship may ask
      // for, and a claim left standing on a request that lapsed would hold it for the rest of the zone.
      if (waiting.ship.disposed) {
        this.waiting = null;
        this.claims.release(CLAMP_OWNER);
      } else if (waiting.left <= 0) {
        this.waiting = null;
        this.claims.release(CLAMP_OWNER);
        this.note = 'no answer came';
      } else if (waiting.asking && !this.claims.asking(carrierSpot(waiting.to))) {
        // The spot is settled -- granted, or the wait ran out and this browser's own answer stands --
        // so their pilot can be asked now, and is the only one asking. A refusal never reaches here:
        // `spotLost` takes the request down before a word has gone anywhere.
        waiting.asking = false;
        this.link?.send(waiting.to, 'dock');
        this.note = `asked ${waiting.label} for room`;
      }
    }
    const letting = this.letting;
    if (letting) {
      const ship = letting.ship;
      if (ship.disposed) this.letting = null;
      else if (!this.carrierFrame(letting.on, 0, 0)) {
        ship.setGhost(false);
        this.letting = null;
      } else if (clampClear(ship.pos, this.framePos, ship.radius, this.carrierRadius(letting.on), CLAMP_TUNE)) {
        ship.setGhost(false);
        this.letting = null;
        this.note = 'clear of the hull';
      }
    }
    const c = this.carried;
    if (!c) return;
    const ship = c.ship;
    if (ship.disposed) {
      this.carried = null;
      this.claims.release(CLAMP_OWNER);
      this.note = 'the ship is gone';
      return;
    }
    // The hull being ridden has gone (blown up, put back in the garage, a zone left): let go before
    // anything reads a body that is not there any more, and let the hull fall free where it stood.
    if (!this.carrierFrame(c.on, dt, CLAMP_TUNE.lead)) {
      this.carried = null;
      this.claims.release(CLAMP_OWNER);
      ship.release(null);
      ship.setGhost(false);
      this.note = 'the ship it was docked onto is gone';
      return;
    }
    if (c.settleLeft > 0) {
      c.settleLeft = Math.max(0, c.settleLeft - dt);
      const k = settleEase(CLAMP_TUNE.settle > 0 ? 1 - c.settleLeft / CLAMP_TUNE.settle : 1);
      this.holdPos.lerpVectors(c.fromPos, c.local, k);
      this.holdQuat.slerpQuaternions(c.fromQuat, c.quat, k);
      if (c.settleLeft <= 0) this.note = `docked onto ${c.label}`;
    } else {
      this.holdPos.copy(c.local);
      this.holdQuat.copy(c.quat);
    }
    // Which frame the hold is written in. For a hull in this world it is that hull's own drawn matrix,
    // which every draw refreshes: the carried ship then rides it even on a frame this step does not run
    // (a panel open, the map up), instead of being pinned to wherever the carrier stood when it last
    // did. That matrix is a step behind the body, so the pose written in it is turned by the difference
    // between it and the step-ahead pose, which puts the hull exactly where it belongs on a frame this
    // does run. A peer's ship is a picture with no matrix of its own here, so that one keeps ours.
    let live: THREE.Matrix4 | null = null;
    if (c.on.kind === 'ship') {
      // Its own matrix worked out from where it stands, rather than waited for: a tab with no frames in
      // it (a driven one, `__debug.advance`) never draws, and the carried hull would ride a matrix left
      // over from the last drawn frame. Parents and self only, so none of the hull's parts is walked.
      c.on.ship.group.updateWorldMatrix(true, false);
      live = c.on.ship.group.matrixWorld;
    }
    if (live) {
      this.rel.copy(live).invert().multiply(this.frame);
      this.rel.decompose(this.relPos, this.relQ, this.scratchScale);
      this.holdPos.applyMatrix4(this.rel);
      this.holdQuat.premultiply(this.relQ);
      ship.hold(live, this.holdPos, this.holdQuat);
    } else ship.hold(this.frame, this.holdPos, this.holdQuat);
  }

  /**
   * The carrier's frame `lead` of a step on, into `this.frame` (and its pose and velocity into
   * `framePos`, `frameQ`, `frameVel`). False when there is no carrier there any more.
   */
  private carrierFrame(on: ClampOn, dt: number, lead: number): boolean {
    if (on.kind === 'ship') {
      const v = on.ship;
      if (v.disposed || !v.body.isValid()) return false;
      this.framePos.copy(v.pos);
      v.quaternion(this.frameQ);
      const lv = v.body.linvel();
      this.frameVel.set(lv.x, lv.y, lv.z);
      const av = v.body.angvel();
      this.scratch2.set(av.x, av.y, av.z);
    } else {
      const peers = this.peers;
      if (!peers || !peers.vehiclePose(on.id, this.framePos, this.frameQ, this.frameVel)) return false;
      // A peer's ship is a picture that glides between their messages: it has no turn rate of its own here.
      this.scratch2.set(0, 0, 0);
    }
    if (lead > 0 && dt > 0) {
      leadPose(this.framePos, this.frameQ, this.frameVel, this.scratch2, dt, lead, this.leadPos, this.leadQ);
      this.framePos.set(this.leadPos.x, this.leadPos.y, this.leadPos.z);
      this.frameQ.set(this.leadQ.x, this.leadQ.y, this.leadQ.z, this.leadQ.w);
    }
    this.frame.compose(this.framePos, this.frameQ, CLAMP_ONE);
    return true;
  }

  private carrierRadius(on: ClampOn): number {
    if (on.kind === 'ship') return on.ship.radius;
    return this.peers?.vehicleOf(on.id)?.radius ?? 0;
  }

  private carrierBounds(on: ClampOn): BoundsLike | null {
    if (on.kind === 'ship') return on.ship.spec.bounds;
    return this.peers?.vehicleOf(on.id)?.bounds ?? null;
  }

  /**
   * Where this ship rests on that carrier, in the carrier's frame, worked out once per pair of models.
   * The box's top is the spot before anything has looked at the hull; a ray straight down the carrier's
   * back then lowers it onto the skin, since a box's top is set by whatever stands highest on the hull
   * and a ship left up there would ride a bridge tower's height above the deck. A peer's ship is a
   * picture with no colliders, so that one keeps the box's top and says so.
   */
  private spotFor(on: ClampOn, ship: Vehicle, out: THREE.Vector3): boolean {
    const bounds = this.carrierBounds(on);
    if (!bounds) return false;
    const key = `${on.kind === 'ship' ? on.ship.spec.id : `peer:${this.peers?.vehicleOf(on.id)?.label ?? on.id}`}|${ship.spec.id}`;
    const kept = this.spots.get(key);
    if (kept) {
      out.copy(kept);
      return true;
    }
    clampLocal(bounds, ship.spec.bounds, out, CLAMP_TUNE);
    // A hull in this world is lowered onto its own skin, and the answer is only worth keeping when the
    // ray found that skin: anything standing in the way (another hull parked there, a station), or a
    // carrier whose colliders the query cannot see just then (ghosted in a jump), leaves the box's top,
    // and keeping that would pin this pair of hulls a mast's height apart for the rest of the session.
    // A peer's ship is a picture with no colliders here, so that one keeps the box's top and is kept.
    if (on.kind === 'ship' && !this.lowerOntoSkin(on.ship, ship, bounds, out)) {
      this.missed++;
      return true;
    }
    this.spots.set(key, out.clone());
    return true;
  }

  /** The ray down the carrier's back, in the world, and the hit brought back into the carrier's frame. */
  private lowerOntoSkin(carrier: Vehicle, ship: Vehicle, bounds: BoundsLike, out: THREE.Vector3): boolean {
    const physics = this.world.physics;
    if (!physics || !carrier.body.isValid()) return false;
    // The ray starts a metre over the spot and must reach the box's own floor: `out.y` carries the
    // carried hull's belly offset, so a reach measured as the carrier's height alone stops short for a
    // ship whose origin stands above its belly, and starts inside the carrier for one whose origin is
    // below it (where a solid cast answers at the ray's own start).
    const top = out.y + 1;
    const reach = top - lowSide(bounds, 1) + 1;
    this.scratch.set(out.x, top, out.z).applyMatrix4(this.frame);
    this.scratch2.copy(CLAMP_UP).applyQuaternion(this.frameQ).negate();
    const hit = probeSurface(physics, this.scratch, this.scratch2, reach, ship.body);
    if (!hit || hit.body !== carrier.body) return false;
    this.inverse.copy(this.frame).invert();
    this.scratch.copy(hit.point).applyMatrix4(this.inverse);
    out.y = clampOnSkin(this.scratch.y, ship.spec.bounds, CLAMP_TUNE);
    return true;
  }

  /** The nearest hull big enough to carry this one, with its clamp spot within reach. */
  private offer(ship: Vehicle): { on: ClampOn; label: string; distance: number } | null {
    if (!ship.spec.ship || ship.disposed) return null;
    let best: ClampOn | null = null;
    let bestLabel = '';
    let bestD = Infinity;
    for (const v of this.world.vehicles) {
      if (v === ship || v.disposed || v.autopilot || !v.spec.ship) continue;
      if (!carrierEnough(v.spec.bounds, ship.spec.bounds, CLAMP_TUNE)) continue;
      const d = ship.pos.distanceTo(v.pos) - v.radius;
      if (d >= bestD) continue;
      bestD = d;
      best = { kind: 'ship', ship: v };
      bestLabel = `the ${v.spec.label}`;
    }
    const peers = this.peers;
    if (peers) {
      for (const id of peers.shipPeers(this.peerIds)) {
        const info = peers.vehicleOf(id);
        if (!info || !carrierEnough(info.bounds, ship.spec.bounds, CLAMP_TUNE)) continue;
        if (!peers.vehiclePose(id, this.scratch, this.scratchQ, STILL_V)) continue;
        const d = ship.pos.distanceTo(this.scratch) - info.radius;
        if (d >= bestD) continue;
        bestD = d;
        best = { kind: 'peer', id };
        bestLabel = `${peers.peerName(id)}'s ${info.label}`;
      }
    }
    return best && bestD <= CLAMP_TUNE.ask ? { on: best, label: bestLabel, distance: bestD } : null;
  }

  /** A directed message from one other player. `ship` is the hull this browser is flying, or null. */
  heard(from: number, word: ClampWord, ship: Vehicle | null): void {
    if (word === 'dock') {
      const name = this.peers?.peerName(from) ?? 'other ship';
      // Turned away at once rather than left waiting: this pilot is in no ship, is being carried
      // themselves, has already been asked, is waiting on an answer of their own, or is already
      // carrying somebody. That last one matters most -- there is one clamp spot per pair of hulls,
      // so two peers granted at once would be drawn inside one another.
      if (!ship || this.carried || this.asked || this.waiting || this.allowed.size) {
        this.link?.send(from, 'refuse');
        return;
      }
      this.asked = { from, name, left: CLAMP_TUNE.lapse, ship };
      this.note = `${name} asks to dock`;
      return;
    }
    if (word === 'refuse') {
      if (this.waiting?.to === from) {
        this.waiting = null;
        this.claims.release(CLAMP_OWNER);
        this.note = 'they said no';
      }
      return;
    }
    if (word === 'allow') {
      const w = this.waiting;
      // Their answer may be twenty seconds old, and nothing about this hull was looked at again when it
      // was asked for. So everything the press itself checked is checked again here -- the ship is
      // still ours to clamp, it is still slow, and their hull is still the one within reach -- and an
      // answer that no longer fits is told at once that the clamp is off, or a ship would be eased on
      // from kilometres away at any speed it happened to be doing.
      if (!w || w.to !== from || !ship || w.ship !== ship) {
        this.link?.send(from, 'undock');
        return;
      }
      this.waiting = null;
      const why = this.refusal(ship);
      const near = this.offer(ship);
      if (why || !near || near.on.kind !== 'peer' || near.on.id !== from) {
        this.link?.send(from, 'undock');
        // Nothing is coming aboard after all, so the spot goes back with the word that says so.
        this.claims.release(CLAMP_OWNER);
        this.note = why ?? 'too far off their hull by the time they answered';
        return;
      }
      this.begin(ship, near.on, near.label);
      return;
    }
    // 'undock': the carrier's pilot has nothing to give back here; the ship that was on it lets itself go.
    this.allowed.delete(from);
    // It is also how a ship withdraws a request it has already made (the server gave that hull's back
    // to somebody else after the asking word had gone out). Answering a dead request would hold this
    // pilot's one slot against the ship that really has the spot.
    if (this.asked?.from === from) {
      this.asked = null;
      this.note = 'they did not need the room after all';
    }
    if (this.carried?.on.kind === 'peer' && this.carried.on.id === from) this.undock();
  }

  /**
   * What goes in the relay state while this hull is being carried: whose ship it is on, and the pose on
   * it. Only a hull carried on another player's ship is named: a hull carried on one standing in this
   * world alone is nobody's, and the others have no picture of it to hang this one from -- they are
   * sent where it is in the world, as they are for any ship, and that is where they draw it.
   */
  wire(ship: Vehicle | null): { to: number; p: [number, number, number]; q: [number, number, number, number] } | null {
    const c = this.carried;
    if (!c || c.ship !== ship || c.settleLeft > 0 || c.on.kind !== 'peer') return null;
    const n3 = (n: number) => Number(n.toFixed(3));
    return { to: c.on.id, p: [n3(c.local.x), n3(c.local.y), n3(c.local.z)], q: [n3(c.quat.x), n3(c.quat.y), n3(c.quat.z), n3(c.quat.w)] };
  }

  /**
   * A spot on a hull's back this browser had asked for, or was riding, turned out to be somebody
   * else's. True when it was one of ours, which is what says the pilot should be told in words.
   */
  spotLost(what: string, why: string): boolean {
    const c = this.carried;
    if (c && c.on.kind === 'peer' && carrierSpot(c.on.id) === what) {
      // Already aboard, and it was never ours to be aboard: let go, which tells their pilot too.
      this.undock();
      this.note = why;
      return true;
    }
    const w = this.waiting;
    if (w && carrierSpot(w.to) === what) {
      this.waiting = null;
      this.claims.release(CLAMP_OWNER);
      // A request still waiting on the spot has said nothing to anybody, so there is nothing to take
      // back. One that had already gone out -- the wait ran out, the word went, and the refusal came
      // in afterwards -- is withdrawn, or their pilot would answer a request that is already dead and
      // hold their own hull's back against the ship the server really gave it to.
      if (!w.asking) this.link?.send(w.to, 'undock');
      this.note = why;
      return true;
    }
    return false;
  }

  /** A zone left, or the game put down: whatever is held is let go and nothing is remembered. */
  leave(): void {
    if (this.carried) this.undock();
    const letting = this.letting;
    if (letting && !letting.ship.disposed) letting.ship.setGhost(false);
    this.letting = null;
    this.waiting = null;
    this.asked = null;
    this.allowed.clear();
    this.spots.clear();
    // Whatever spot this browser still held on somebody's back: the zone has gone and so has the
    // hull. `Docking.leave` clears the whole table after this, which tells the server about the rest.
    this.claims.release(CLAMP_OWNER);
  }

  report(): Record<string, unknown> {
    const n2 = (n: number) => Number(n.toFixed(2));
    const c = this.carried;
    return {
      note: this.note,
      carried: c ? { ship: c.ship.spec.id, on: c.on.kind, of: c.label, settling: n2(c.settleLeft), at: c.local.toArray().map(n2), held: c.ship.holding, ghosted: c.ship.ghosted } : null,
      letting: this.letting ? this.letting.ship.spec.id : null,
      // `asking` true means the word has not gone to their pilot yet: the spot on their hull's back
      // is still pending with the server, and the server decides who asks at all.
      waiting: this.waiting ? { to: this.waiting.to, left: n2(this.waiting.left), asking: this.waiting.asking } : null,
      asked: this.asked ? { from: this.asked.from, name: this.asked.name, left: n2(this.asked.left) } : null,
      allowed: [...this.allowed.keys()],
      carrying: [...this.allowed.values()].map((v) => v.spec.id),
      spots: this.spots.size,
      // The ray down a carrier's back that found nothing: the box's top was used and not kept, so the
      // next press tries again. A count that climbs is the spot to look at when a ship rides too high.
      missedSkin: this.missed,
      tune: { ...CLAMP_TUNE },
    };
  }
}
