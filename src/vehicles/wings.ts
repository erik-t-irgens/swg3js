// A ship's wings that open: each one a pivot group the garage hangs the wing's model under, turned
// about its own Z by the wing's angle, each on its own clock, and the rules for when a ship wants
// them open. Plain three, no Rapier or DOM, so the node tests can load it.
import * as THREE from 'three';

/** One wing that opens: the pivot turned about its own Z, how far (radians, in three's mirrored frame), how long, and how open now (0..1, linear). */
export interface Wing {
  readonly pivot: THREE.Object3D;
  readonly angle: number;
  readonly time: number;
  open: number;
  readonly label: string;
}

/** How the chassis's wing_open_speed_factor is read. Mutable so __debug.wings('threshold') can flip it live. */
export type WingSpeedRule = 'multiplier' | 'threshold';
export const WING_RULE: { speed: WingSpeedRule } = { speed: 'multiplier' };
/** Threshold reading only: speed either side of the limit (m/s) within which the wings stay as they are. */
export const WING_HYSTERESIS = 0.5;
/** Metres of air a wing's lowest point keeps over the ground when the wings may stand open: clearance = drop + this. */
export const WING_TIP_ROOM = 0.5;
/** Extra height (m) above the clearance before closed wings open; below the clearance open ones close. Stops a flutter at the edge. */
export const WING_ROOM_BAND = 1;
/** A wing reaching less than this below the closed belly needs no room at all (metres). */
export const WING_DROP_MIN = 0.3;

const Z = new THREE.Vector3(0, 0, 1);

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** The eased share open (smoothstep) of a linear share. */
export function easeWing(open: number): number {
  const t = clamp01(open);
  return t * t * (3 - 2 * t);
}

/** Pose one wing at a share of open, eased: the pivot's quaternion only. */
export function poseWing(w: Wing, open: number): void {
  w.open = clamp01(open);
  w.pivot.quaternion.setFromAxisAngle(Z, w.angle * easeWing(w.open));
}

/** A ship's wings, stepped together, each at its own pace. */
export class WingSet {
  readonly list: Wing[] = [];
  /** The last answer of the flight rule, or of the pilot's choice while there is one (true: open), kept for the rule's hysteresis. Never the forced value. */
  want = false;
  /** Held by the console: 'open', 'closed', or null for the flight rule. */
  force: 'open' | 'closed' | null = null;
  /**
   * The pilot's own choice from the wings key (true: open, false: closed), or null: the flight rule decides. Held until the
   * key is pressed again or the pilot leaves the seat; an open choice still waits for room under a wing that swings below
   * the belly (`pilotWings`), so landing folds it.
   */
  pilot: boolean | null = null;
  /** The goal of the last step, and whether every wing stood at it then (nothing to do until the goal changes). */
  private goal = 0;
  private settled = true;
  private reachNow = 0;

  /** Where the wings are going: the forced value when forced, else `want`. What the relay sends and a peer's picture follows. */
  get target(): boolean {
    return this.force ? this.force === 'open' : this.want;
  }

  get length(): number {
    return this.list.length;
  }

  /**
   * The wings key: the pilot's choice flips. With a choice already made it flips that choice, not where the wings are now:
   * an open chosen on the ground under a B-wing waits for room with `target` still closed, and a second press must take
   * it back. With none (or the console holding the wings), it becomes the opposite of where the wings are going. Returns
   * the choice.
   */
  toggle(): boolean {
    this.pilot = this.force ? !this.target : !(this.pilot ?? this.target);
    return this.pilot;
  }

  /** What the pilot has chosen, as the wings key shows it: the console's hold when held, else the choice, else where the rule has them going. */
  get chosen(): boolean {
    return this.force ? this.target : (this.pilot ?? this.target);
  }

  /** Mean linear share open, for the console and the top-speed factor. */
  get progress(): number {
    const n = this.list.length;
    if (!n) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.list[i].open;
    return sum / n;
  }

  /** The largest eased share open over the wings (0..1): how far the lowest-hanging wing has swung, for the ground tests. */
  get reach(): number {
    return this.reachNow;
  }

  add(w: Wing): void {
    this.list.push(w);
    poseWing(w, 0);
    this.settled = false;
    this.updateReach();
  }

  /** Each wing toward `target` by its own time; true when any moved this step (the colliders then follow). Allocation-free; false at once when settled. */
  step(dt: number): boolean {
    const goal = this.target ? 1 : 0;
    if (goal !== this.goal) {
      this.goal = goal;
      this.settled = false;
    }
    if (this.settled) return false;
    let moved = false;
    for (let i = 0; i < this.list.length; i++) {
      const w = this.list[i];
      if (w.open === goal) continue;
      const rate = dt / Math.max(0.1, w.time);
      let next = goal > w.open ? Math.min(goal, w.open + rate) : Math.max(goal, w.open - rate);
      // A sum of small steps lands a hair short of the end; the last step finishes it.
      if (Math.abs(goal - next) < 1e-9) next = goal;
      poseWing(w, next);
      moved = true;
    }
    if (moved) this.updateReach();
    else this.settled = true;
    return moved;
  }

  /** Every wing straight to open or closed, and `want` with it (arriving in flight; a peer's ship first seen; measuring the open pose at spawn). */
  snap(open: boolean): void {
    this.want = open;
    for (let i = 0; i < this.list.length; i++) poseWing(this.list[i], open ? 1 : 0);
    this.settled = false;
    this.updateReach();
  }

  private updateReach(): void {
    let r = 0;
    for (let i = 0; i < this.list.length; i++) {
      const e = easeWing(this.list[i].open);
      if (e > r) r = e;
    }
    this.reachNow = r;
  }
}

/**
 * Whether a ship's wings should stand open (the flight rule; positional so a per-frame call allocates nothing).
 * Not airborne: false. On a planet with a clearance: room needed, with a band (wasOpen ? aboveGround >= clearance :
 * aboveGround > clearance + WING_ROOM_BAND). Then 'multiplier': true. 'threshold': limit = factor * top;
 * wasOpen ? speed <= limit + H : speed < limit - H.
 */
export function wingsWanted(airborne: boolean, space: boolean, aboveGround: number, clearance: number, speed: number, top: number, factor: number, wasOpen: boolean): boolean {
  if (!airborne) return false;
  if (!space && clearance > 0) {
    const room = wasOpen ? aboveGround >= clearance : aboveGround > clearance + WING_ROOM_BAND;
    if (!room) return false;
  }
  if (WING_RULE.speed === 'multiplier') return true;
  const limit = factor * top;
  return wasOpen ? speed <= limit + WING_HYSTERESIS : speed < limit - WING_HYSTERESIS;
}

/**
 * Whether a ship's wings stand open on the pilot's choice (positional, allocation-free). Closed stays closed. Open is
 * open at any speed, in the air or on the ground, except on a planet when a wing swings below the belly (a clearance):
 * then only airborne with the flight rule's room and band, so landing still folds that wing (the B-wing's) and it opens
 * again once there is room.
 */
export function pilotWings(open: boolean, airborne: boolean, space: boolean, aboveGround: number, clearance: number, wasOpen: boolean): boolean {
  if (!open) return false;
  if (space || clearance <= 0) return true;
  if (!airborne) return false;
  return wasOpen ? aboveGround >= clearance : aboveGround > clearance + WING_ROOM_BAND;
}

/** The key that opens and closes the wings of the ship flown (KeyboardEvent.code): U, bound to nothing else. */
export const WINGS_KEY = 'KeyU';

/**
 * The pilot's choice lasts only while they fly that ship: every set but the flown ship's goes back to the flight rule
 * (a pilot who left the seat, a ship nobody flies). Allocation-free, run each frame the keys are read.
 */
export function dropPilotChoices(list: readonly { readonly wings: WingSet }[], flown: unknown): void {
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o !== flown && o.wings.pilot !== null) o.wings.pilot = null;
  }
}

/** The share of top speed the ship may fly at now: 'multiplier' eases from 1 to factor as the wings open; 'threshold' is always 1. */
export function wingTopFactor(factor: number, progress: number): number {
  return WING_RULE.speed === 'multiplier' ? 1 - (1 - factor) * clamp01(progress) : 1;
}
