// The ultra-fast cruise: a straight run at kilometres a second, for the made-up system that is big
// enough to need it. It is not a jump. There is no tunnel and no teleport: the hull is simply moved
// along the nose it had when the run began, held and ghosted so nothing can hit it and nothing it
// passes through can hurt it, until the pilot lets go or it runs out of room.
//
// Why it is held rather than flown: the physics engine cuts a body's velocity at 400 m/s, and a
// velocity asked for past that is cut every step, which the hull's own hit test reads as a crash. So
// the run writes the pose itself through the hull's hold, which is kinematic and exact.
//
// Three things must be true at this speed, and each is done here rather than hoped for:
//  - nothing streams in. The streamer is held for the length of the run (`holdStream`), so no tier
//    is loaded or dropped while the ship crosses a region every few dozen milliseconds, and the
//    brake waits for what is around the stopping point before handing the ship back.
//  - nothing compiles. The only new thing drawn is the zone's own warp effect, which every space
//    zone prepares at load, and it is placed during the countdown, a second before the speed.
//  - nothing smears. The camera's reprojection is moved by the run's own step
//    (`setReprojectionCarry`), so the world does not turn into a grey wash; the streaks carry the
//    speed instead.
//
// No DOM and no world here: everything goes through the host, so the node test drives it against
// fakes. Imports three, the pack's types and the blur's carry.
import * as THREE from 'three';
import type { SpacePack } from './spaceData.ts';
import type { EffectHandle } from '../world/particles';
import { reprojectionCarry, setReprojectionCarry } from '../core/fx/velocityMath.ts';

/**
 * Every number the cruise is made of. All of them are ours: the game never flew anything like this.
 * The top speed and the 250 km edge are the owner's decisions; the rest is tuning, live through
 * `__debug.cruise({ ... })`.
 */
export const CRUISE_TUNE = {
  /** The run's top speed, m/s (the owner's 10 km/s). */
  top: 10000,
  /** Seconds between asking and the speed: a moment to see the streaks start and to change your mind. */
  countdown: 1,
  /** Seconds to reach the top speed, and seconds to come back down from it. */
  spinUp: 3,
  brake: 2,
  /** How far short of a planet's surface the run stops itself, in metres. */
  standOff: 2000,
  /** How far the system reaches from its middle, in metres; the run turns itself off at the edge. */
  edge: 250000,
  /** Seconds the brake waits for the streamer at the stopping point before handing the ship back. */
  settleWait: 6,
  /** How far along the nose the warp effect is placed, and how far it is turned about Y (degrees). */
  fxAhead: 0,
  fxTurn: 0,
  /**
   * Seconds between one placing of the warp streaks and the next while the speed holds. INVENTED,
   * and the one number here that is not free: the streaks are a transient effect that ends itself
   * after about four seconds, and a run to the far edge lasts about thirty, so without this the
   * picture is a still starfield for the rest of it with nothing to say how fast it is going. A
   * little under the effect's own life, so the next one is alight before the last one fades.
   */
  fxRepeat: 3.5,
};

/** Change the numbers live; each one is held inside a range that keeps the run finite and stoppable. */
export function tuneCruise(patch: Partial<typeof CRUISE_TUNE>): typeof CRUISE_TUNE {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  if (patch.top !== undefined) CRUISE_TUNE.top = clamp(patch.top, 100, 200000);
  if (patch.countdown !== undefined) CRUISE_TUNE.countdown = clamp(patch.countdown, 0, 10);
  if (patch.spinUp !== undefined) CRUISE_TUNE.spinUp = clamp(patch.spinUp, 0.1, 30);
  if (patch.brake !== undefined) CRUISE_TUNE.brake = clamp(patch.brake, 0.1, 30);
  if (patch.standOff !== undefined) CRUISE_TUNE.standOff = clamp(patch.standOff, 100, 100000);
  if (patch.edge !== undefined) CRUISE_TUNE.edge = clamp(patch.edge, 1000, 5000000);
  if (patch.settleWait !== undefined) CRUISE_TUNE.settleWait = clamp(patch.settleWait, 0, 60);
  if (patch.fxAhead !== undefined) CRUISE_TUNE.fxAhead = clamp(patch.fxAhead, -500, 500);
  if (patch.fxTurn !== undefined) CRUISE_TUNE.fxTurn = clamp(patch.fxTurn, -180, 180);
  if (patch.fxRepeat !== undefined) CRUISE_TUNE.fxRepeat = clamp(patch.fxRepeat, 0.25, 60);
  return CRUISE_TUNE;
}

/**
 * The key that starts and lets go of a run (KeyboardEvent.code). It has no rebindable action of its
 * own yet, so it is read straight from the key rather than through the bindings.
 */
export const CRUISE_KEY = 'KeyO';

export type CruisePhase = 'off' | 'countdown' | 'running' | 'braking';

/** A sphere the run must not enter: a planet's surface with its stand-off, or anything else in the way. */
export interface CruiseStop {
  x: number;
  y: number;
  z: number;
  /** Metres: the radius the run stops outside of. */
  r: number;
}

// --- the maths, pure so the test can drive it without a world ------------------------------------

/**
 * How far a run at `speed` still needs to come to a stop, in metres: the brake takes the speed down
 * evenly, so it is half the speed times the brake's seconds.
 */
export function brakingDistance(speed: number, brakeSeconds = CRUISE_TUNE.brake): number {
  return Math.max(0, speed) * Math.max(0, brakeSeconds) * 0.5;
}

/**
 * The speed a run is at after `dt`, easing toward `want` at the spin-up's or the brake's rate. Both
 * rates are the top speed over their own seconds, so they do not change with the speed reached.
 */
export function stepCruiseSpeed(speed: number, want: number, dt: number, tune = CRUISE_TUNE): number {
  const up = tune.top / Math.max(0.001, tune.spinUp);
  const down = tune.top / Math.max(0.001, tune.brake);
  if (want > speed) return Math.min(want, speed + up * Math.max(0, dt));
  return Math.max(want, speed - down * Math.max(0, dt));
}

/**
 * How far ahead the run must stop, in metres along `dir` from `from`: the nearest sphere it would
 * enter, or where it would cross the system's edge, whichever comes first; Infinity when neither is
 * ahead. `dir` must be a unit vector. A run that already stands inside a stop, or outside the edge,
 * gives 0: it has nowhere left to go that way.
 *
 * Pure, and the test's only way in: a ray against a sphere from outside gives the nearer root, and
 * the edge is the far root of the sphere the run is inside.
 */
export function stopAhead(from: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, stops: readonly CruiseStop[], edge: number): number {
  let best = Infinity;
  for (const s of stops) {
    const ox = from.x - s.x;
    const oy = from.y - s.y;
    const oz = from.z - s.z;
    const c = ox * ox + oy * oy + oz * oz - s.r * s.r;
    if (c <= 0) return 0;
    const b = ox * dir.x + oy * dir.y + oz * dir.z;
    // Heading away from it, or missing it: the nearer root is behind or there is none.
    if (b >= 0) continue;
    const disc = b * b - c;
    if (disc <= 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t >= 0 && t < best) best = t;
  }
  if (edge > 0) {
    const c = from.x * from.x + from.y * from.y + from.z * from.z - edge * edge;
    if (c >= 0) return 0;
    const b = from.x * dir.x + from.y * dir.y + from.z * dir.z;
    const t = -b + Math.sqrt(Math.max(0, b * b - c));
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

/**
 * The spheres a run in this zone must keep out of: every body the pack stands somewhere (`place:
 * 'world'`), grown by the stand-off. Filled into `out` so nothing is allocated while flying.
 */
export function cruiseStops(pack: SpacePack | null, out: CruiseStop[], standOff = CRUISE_TUNE.standOff): CruiseStop[] {
  out.length = 0;
  for (const p of pack?.planets ?? []) {
    if (p.place !== 'world' || !p.at) continue;
    out.push({ x: p.at[0], y: p.at[1], z: p.at[2], r: Math.max(0, p.radius ?? 0) + standOff });
  }
  return out;
}

// --- the run --------------------------------------------------------------------------------------

/** What the cruise touches on a hull; `Vehicle` satisfies it, and so does the test's fake. */
export interface CruiseHull {
  readonly group: THREE.Object3D;
  readonly pos: THREE.Vector3;
  readonly destroyed: boolean;
  readonly holding: boolean;
  cruise: number;
  jumpCruise: number | null;
  hold(frame: THREE.Matrix4 | null, pos: THREE.Vector3, quat: THREE.Quaternion): void;
  release(velocity?: THREE.Vector3 | null): void;
  setGhost(on: boolean): void;
  quaternion(out: THREE.Quaternion): THREE.Quaternion;
}

export interface CruiseHost {
  /** The zone flown now (`World.planet.id`). */
  zone(): string;
  /** Whether that zone allows a cruise at all: only a made-up system does (its pack says how far it reaches). */
  packHere(): SpacePack | null;
  /** The ship the player flies, or null. */
  ship(): CruiseHull | null;
  /** Whether that hull is still in the world (`World.vehicles.includes`). */
  alive(hull: CruiseHull): boolean;
  /** Whether a jump has the controls: a cruise never starts over one, and one starting stops a cruise. */
  jumping(): boolean;
  /**
   * Whether a jump has taken the hull itself (held it, ghosted it, put it in the tunnel), as against
   * merely counting down to one. A run that ends because of a jump hands the ship back only while
   * this is false; past it the jump owns the hold and the ghost and lets both go in its own time.
   * Absent means no, which is what a run against a fake hull wants.
   */
  jumpHasHull?(): boolean;
  /** Hold or free the streamer (`World.streamHold`). */
  holdStream(on: boolean): void;
  /** What is around the stopping point, awaited before the ship is handed back (`World.readyAround`). */
  readyAround(at: THREE.Vector3, ms: number): Promise<boolean>;
  /** The zone's warp effects (`World.hyperspaceEffects`). */
  effects(): { enter: string | null; exit: string | null };
  placeEffect(file: string, local: THREE.Matrix4, frame: THREE.Matrix4): EffectHandle | null;
  removeEffect(handle: EffectHandle): void;
  /** A line for the player; the host decides where it shows. */
  note?(text: string): void;
  /** How many shader programs the renderer holds, for the report: it must not change during a run. */
  programs?(): number;
}

const posTmp = new THREE.Vector3();
const quatTmp = new THREE.Quaternion();
const stepTmp = new THREE.Vector3();

export class Cruise {
  phase: CruisePhase = 'off';
  /** Metres a second now. */
  speed = 0;
  /** Metres run since the speed began. */
  travelled = 0;
  /** Seconds left of the countdown. */
  private wait = 0;
  private hull: CruiseHull | null = null;
  private fx: EffectHandle | null = null;
  private readonly stops: CruiseStop[] = [];
  private readonly at = new THREE.Vector3();
  private readonly along = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();
  private readonly local = new THREE.Matrix4();
  private readonly ahead = new THREE.Matrix4();
  /**
   * The renderer's program count at the moment the speed began and again at the moment the brake
   * reached a stop, so the report can separate the two halves of a run. Nothing may build a program
   * while the ship is moving; the settle afterwards asks for what stands round the stopping point and
   * builds whatever that needs, exactly as an arrival does, with the ship already still.
   */
  private programsAtStart = 0;
  private programsAtStop = 0;
  private programsFast = 0;
  private programsSettling = 0;
  /** Whether the speed ever began this run: before that there is nothing to count. */
  private began = false;
  /** Seconds left before the warp streaks are placed again; they end themselves after a few. */
  private fxLeft = 0;
  /** Why the run last stopped, for the prompt and the report. */
  note = '';
  /**
   * A brake that has come to a stop and is waiting on the streamer: whether the wait has begun (so
   * it is begun once and not once a frame) and how long is left of it. The wait ends early when
   * what stands round the stopping point is there.
   */
  private settleStarted = false;
  private settleLeft = 0;
  /** The zone the run began in: a travel or a jump under it ends the run rather than flying in the next one. */
  private zone = '';

  private readonly host: CruiseHost;

  constructor(host: CruiseHost) {
    this.host = host;
  }

  /** Whether the pilot may start a run here and now, and why not when they may not. */
  why(): string | null {
    const pack = this.host.packHere();
    if (!pack?.sandbox) return 'There is nowhere to run to in this system.';
    if (this.host.jumping()) return 'Not while a jump has the ship.';
    const hull = this.host.ship();
    if (!hull) return 'You are not flying a ship.';
    if (hull.destroyed) return 'The ship is in no state to run.';
    if (hull.holding && this.phase === 'off') return 'The ship is held: let it go first.';
    return null;
  }

  /**
   * The row the ship menu draws for it: what the button says, why it cannot be pressed, and a line
   * under it. The shape is the menu's `ShipCruise`, written out rather than imported so that
   * nothing here depends on the UI.
   */
  available(): { label: string; why: string | null; note: string | null } {
    if (this.phase !== 'off') return { label: 'Let go', why: null, note: this.phase === 'countdown' ? 'Running in a moment.' : `${Math.round(this.speed)} m/s, ${Math.round(this.travelled / 1000)} km` };
    const why = this.why();
    return { label: 'Ultra cruise', why, note: why ? null : this.note || 'Straight ahead, fast: no turning, and nothing can touch you.' };
  }

  /** Whether the run has the controls: the stick does nothing and the ship cannot be hit. */
  get running(): boolean {
    return this.phase !== 'off';
  }

  /** The key, the ship menu's row and the debug hook all come here: start a run, or end one. */
  toggle(): string {
    if (this.phase !== 'off') {
      this.brake('You let go.');
      return this.note;
    }
    const why = this.why();
    if (why) {
      this.note = why;
      this.host.note?.(why);
      return why;
    }
    const hull = this.host.ship();
    if (!hull) return 'You are not flying a ship.';
    this.hull = hull;
    this.zone = this.host.zone();
    this.phase = 'countdown';
    this.wait = CRUISE_TUNE.countdown;
    this.speed = 0;
    this.travelled = 0;
    this.settleStarted = false;
    this.settleLeft = 0;
    this.note = '';
    this.began = false;
    this.programsFast = 0;
    this.programsSettling = 0;
    cruiseStops(this.host.packHere(), this.stops);
    this.placeEffect(hull);
    this.host.note?.('Running.');
    return 'Running.';
  }

  /** Stop a run and hand the ship back, keeping whatever note says why. */
  brake(note: string): void {
    if (this.phase === 'off') return;
    this.note = note;
    if (this.phase === 'countdown') {
      this.finish();
      return;
    }
    this.phase = 'braking';
    this.host.note?.(note);
  }

  /** Everything the run holds goes, whatever state it is in: a travel, a death, a world unload, a jump. */
  abort(): void {
    if (this.phase === 'off') return;
    this.note = '';
    this.finish();
  }

  update(dt: number): void {
    if (this.phase === 'off') return;
    const hull = this.hull;
    if (!hull || !this.host.alive(hull) || hull.destroyed || this.host.jumping() || this.host.zone() !== this.zone) {
      this.abort();
      return;
    }
    if (this.phase === 'countdown') {
      this.wait -= dt;
      if (this.wait > 0) return;
      this.begin(hull);
      return;
    }
    this.fly(dt, hull);
  }

  /** The speed begins: the hull is held and ghosted, and the nose it has now is the line it runs. */
  private begin(hull: CruiseHull): void {
    this.phase = 'running';
    this.at.copy(hull.pos);
    hull.quaternion(this.turn);
    // The nose: the hull's own forward is -Z, as every ship's is.
    this.along.set(0, 0, -1).applyQuaternion(this.turn).normalize();
    hull.setGhost(true);
    hull.jumpCruise = null;
    hull.hold(null, this.at, this.turn);
    this.host.holdStream(true);
    this.began = true;
    this.fxLeft = CRUISE_TUNE.fxRepeat;
    this.programsAtStart = this.host.programs?.() ?? 0;
    this.programsAtStop = this.programsAtStart;
  }

  private fly(dt: number, hull: CruiseHull): void {
    const t = CRUISE_TUNE;
    const ahead = stopAhead(this.at, this.along, this.stops, t.edge);
    // Far enough from anything to keep going, or already braking: the brake begins as late as it can
    // and still stop short, and the run never overshoots because the step below is clamped as well.
    if (this.phase === 'running' && ahead <= brakingDistance(this.speed) + this.speed * dt) {
      this.phase = 'braking';
      this.note = ahead <= 0 ? 'There is no room that way.' : 'Something ahead: the run stops here.';
      this.host.note?.(this.note);
    }
    const want = this.phase === 'braking' ? 0 : t.top;
    this.speed = stepCruiseSpeed(this.speed, want, dt);
    const step = Math.min(this.speed * dt, Math.max(0, ahead));
    this.at.addScaledVector(this.along, step);
    this.travelled += step;
    stepTmp.copy(this.along).multiplyScalar(step);
    // The camera rides the hull, so the blur is told to take this step out of its reprojection:
    // at kilometres a frame every pixel would otherwise smear clean off the screen.
    setReprojectionCarry(stepTmp.x, stepTmp.y, stepTmp.z);
    posTmp.copy(this.at);
    quatTmp.copy(this.turn);
    hull.hold(null, posTmp, quatTmp);
    // The streaks are a transient effect and end themselves after a few seconds; a run lasts far
    // longer than that, so they are laid on again while the speed holds. Nothing new is built: it is
    // the same batch the zone prepared at load, and the run's own program count says so.
    if (this.phase === 'running') {
      this.fxLeft -= dt;
      if (this.fxLeft <= 0) {
        this.fxLeft = CRUISE_TUNE.fxRepeat;
        this.placeEffect(hull);
      }
    }
    if (this.phase === 'braking' && this.speed <= 0.01) {
      if (!this.settleStarted) {
        this.settleStarted = true;
        this.settleLeft = t.settleWait;
        // Stopped: everything built from here on belongs to the settle, not to the run.
        this.programsAtStop = this.host.programs?.() ?? 0;
        this.programsFast = Math.max(0, this.programsAtStop - this.programsAtStart);
        // The streamer was held for the whole run: what stands round the stopping point is asked for
        // now, and the ship is handed back once it is there (or once the wait runs out).
        this.host.holdStream(false);
        void this.host.readyAround(this.at, Math.round(t.settleWait * 1000)).then(() => {
          if (this.phase === 'braking') this.settleLeft = 0;
        });
      }
      this.settleLeft -= dt;
      if (this.settleLeft <= 0) this.finish();
    }
  }

  /** Hand the ship back: the hold goes, the ghost goes, the streamer runs and the blur smears again. */
  private finish(): void {
    const hull = this.hull;
    const stopped = this.settleStarted;
    this.phase = 'off';
    this.speed = 0;
    this.wait = 0;
    this.settleStarted = false;
    this.settleLeft = 0;
    this.fxLeft = 0;
    setReprojectionCarry(0, 0, 0);
    this.host.holdStream(false);
    if (this.fx) {
      this.host.removeEffect(this.fx);
      this.fx = null;
    }
    // The count for the report, whichever way the run ended: a run cut short never reached a stop,
    // so all of it counts as the fast half and the settle's figure stays at nothing.
    if (this.began) {
      const now = this.host.programs?.() ?? 0;
      if (stopped) this.programsSettling = Math.max(0, now - this.programsAtStop);
      else this.programsFast = Math.max(0, now - this.programsAtStart);
    } else {
      this.programsFast = 0;
      this.programsSettling = 0;
    }
    this.began = false;
    this.hull = null;
    if (!hull) return;
    // A hull the world has already disposed has no body: `alive` is what says so, and nothing is
    // asked of it after that (the lesson about a removed body and `unreachable`).
    if (!this.host.alive(hull)) return;
    // A jump that has taken the hull holds and ghosts it for itself, and lets both go in its own
    // abort. Stripping the ghost off a hull flying a tunnel at hundreds of metres a second would
    // trip its hit test on the first damping the step leaves, so a run that ends because a jump took
    // the ship simply lets go of it and touches nothing. A jump only counting down has not taken it
    // yet and would not release it if it were called off, so there the run still hands the ship back.
    if (this.host.jumpHasHull?.()) return;
    hull.jumpCruise = null;
    hull.release(null);
    hull.setGhost(false);
    hull.cruise = 0;
  }

  private placeEffect(hull: CruiseHull): void {
    const file = this.host.effects().enter;
    if (!file) return;
    this.local.makeRotationY(THREE.MathUtils.degToRad(CRUISE_TUNE.fxTurn));
    this.local.multiply(this.ahead.makeTranslation(0, 0, CRUISE_TUNE.fxAhead));
    hull.group.updateMatrixWorld(true);
    this.fx = this.host.placeEffect(file, this.local, hull.group.matrixWorld);
  }

  /** What `__debug.cruise()` prints: no game data, only the run's own numbers. */
  describe(): Record<string, unknown> {
    const n = (v: number) => Math.round(v * 100) / 100;
    const carry = reprojectionCarry();
    return {
      phase: this.phase,
      speed: Math.round(this.speed),
      travelled: Math.round(this.travelled),
      at: this.phase === 'off' ? null : this.at.toArray().map((v) => Math.round(v)),
      along: this.phase === 'off' ? null : this.along.toArray().map((v) => n(v)),
      stops: this.stops.length,
      note: this.note || null,
      /**
       * The two halves of the last run, as counts of shader programs the renderer built. Nothing may
       * be built while the ship is moving, so `programsWhileFast` must be 0; `programsWhileSettling`
       * is what the stopping point needed and is built with the ship already still, as an arrival's
       * are.
       */
      programsWhileFast: this.programsFast,
      programsWhileSettling: this.programsSettling,
      /** This frame's step taken out of the blur's reprojection, in metres (the camera rides the hull). */
      carry: [n(carry.x), n(carry.y), n(carry.z)],
      why: this.why(),
      tune: { ...CRUISE_TUNE },
      ours: 'nothing about this run is from the game: the speed, the ramp and the stand-off are ours',
    };
  }
}
