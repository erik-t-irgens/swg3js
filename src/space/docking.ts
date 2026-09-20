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
import type { DriveInput, Vehicle } from '../vehicles/vehicle.ts';
import {
  DOCK_FACE,
  DOCK_TUNE,
  LaneClaims,
  approachRun,
  dockPose,
  exitRun,
  flownBy,
  laneCruise,
  laneDrive,
  lanesOf,
  newLaneDrive,
  reached,
  settleEase,
  type LanePlan,
  type LaneRun,
} from './dockingMath.ts';

/** What a dock plays, by the part of docking it belongs to; the keys the pack's `dockEffects` uses. */
export type DockPart = 'harddock' | 'release' | 'reload' | 'repairGroup' | 'repair' | 'repairAlt';

/** What docking needs of the world. A narrow face of `World`, so nothing here reaches further into it. */
export interface DockWorld {
  readonly planet: { readonly space?: string };
  readonly spaceData: SpacePack | null;
  readonly placedObjects: readonly PlacedObject[];
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

/** How long the ship's own controls are ignored after a dock is asked for (s, INVENTED: see `Docking.grace`). */
const GRACE = 0.75;

const ONE = new THREE.Vector3(1, 1, 1);

export class Docking {
  /** Who holds which lane. Local today, a server's answer later; the shape does not change. */
  readonly claims = new LaneClaims();
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
  }

  /** In a space zone: everything here is for space, and a planet's structures have no lanes. */
  private get inSpace(): boolean {
    return !!this.world.planet.space;
  }

  /** The ship docking, docked or flying a lane; null when nothing is. */
  get busy(): Vehicle | null {
    return this.phase === 'idle' ? null : this.ship;
  }

  /** Whether this hull is held at a dock (the jump and the crossings ask, and refuse). */
  docked(ship: Vehicle | null): boolean {
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
    // Nothing in the zone to dock at is not the same as nothing near: a pack written before the lanes
    // were converted carries none at all, and two of the systems the game shipped have none either.
    if (!this.list().length) {
      const old = (this.world.spaceData?.version ?? 0) < 3;
      return { label: 'Dock', why: old ? 'this system\'s pack is older than docking: convert it again' : 'nothing in this system has a dock', note: null };
    }
    const near = this.offer(ship);
    if (!near) return { label: 'Dock', why: `no station within ${Math.round(DOCK_TUNE.ask)} m`, note: this.note || null };
    if (this.phase !== 'idle') return { label: 'Dock', why: 'another ship is on the lane', note: null };
    if (!near.lane) return { label: 'Dock', why: near.why, note: this.note || null };
    return { label: `Dock at ${near.target.label}`, why: null, note: this.note || null };
  }

  /** The menu's Dock or Launch button: whichever this ship can do now. */
  act(ship: Vehicle | null): string {
    if (!ship) return 'not in a ship';
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
    if (!this.claims.claim(key, by)) return (this.note = `lane ${best.lane} is taken`);
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
    this.note = `flying lane ${best.lane} into ${target.label}`;
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

  /** Every invented number, live: `__debug.dock({ laneSpeed: 60 })`, `__debug.dock({ face: 'lane' })`. */
  tune(patch: Partial<typeof DOCK_TUNE> & { face?: typeof DOCK_FACE.rule } = {}): Record<string, unknown> {
    for (const k of Object.keys(DOCK_TUNE) as (keyof typeof DOCK_TUNE)[]) {
      const n = patch[k];
      if (typeof n === 'number' && Number.isFinite(n)) DOCK_TUNE[k] = n;
    }
    if (patch.face === 'auto' || patch.face === 'hardpoint' || patch.face === 'lane') DOCK_FACE.rule = patch.face;
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
      targets: this.list().map((c) => ({ at: c.label, model: c.object.model, lanes: c.lanes.map((l) => ({ lane: l.lane, in: l.in.map((w) => w.points.length), out: l.out.map((w) => w.points.length), radius: n2(l.radius), bare: l.bare })) })),
      face: DOCK_FACE.rule,
      tune: { ...DOCK_TUNE },
    };
  }
}
