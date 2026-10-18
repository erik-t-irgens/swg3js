// A run of a track: the countdown, the gates in order, the laps and their splits, a crash and the put-back after it,
// on a clock of the run's own.
//
// **The clock is the body's.** It is advanced only on frames play is simulated, by the fixed steps the physics is about
// to move the hull through (`advanceSteps`, from `stepVehicles`: `Physics.stepsAhead(dt)` sixtieths of a second), never by
// the frame's own time, so a lap is timed on the physics' own steps and stands still with a panel, the map or the
// Escape menu exactly as the hull is held (`RACE_CLOCK.live`). It is not `World.simTime`, which runs on behind every
// panel.
//
// **The crossing is tested inside the race drive's step** (the drive calls `cross` as its step begins, `DriveWatch` in
// `raceDrive.ts`), from the place its last test left to the place the body stands now, and only against the next gate;
// its instant is the clock at the mark plus the share of the way through the segment it crossed at, so every metre the
// body moved is tested once whatever the frame loop or the accumulator did between, and a crossing found over the
// travel a frame's steps made is timed within them. A paused hull does not move and crosses nothing.
//
// What happened goes into a ring of events the game reads after the vehicles have stepped (`eventCount`, `eventAt`),
// so the drive's step allocates nothing for it: the watch writes numbers into typed arrays and kept fields only.
//
// Pure: no page, no physics, no three; node runs it (`tools/swg/tests/raceTrack.test.ts`).

import { CROSS_BACKWARD, CROSS_FORWARD, GATE_STRIDE, bakeGate, crossGate, headingTo, newSegment } from './gates.ts';
import { RACE_KINDS, type GameGate, type RaceKind, type TrackDef } from './trackFile.ts';
import { TRACK_TUNE } from './trackTune.ts';

export type RunPhase = 'countdown' | 'racing' | 'down' | 'finished' | 'ended';

/** What the watch reads off the hull it is handed: its body's place (a `Vehicle` is one). */
export interface WatchedHull {
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
}

/** What happened in a run, as the ring keeps it. */
export const RUN_EVENT = {
  /** The countdown ran out. */
  go: 1,
  /** A gate crossed in order (its index, the split into the lap, and against the best lap's split there). */
  gate: 2,
  /** A lap done (its number, its time, against the best lap). */
  lap: 3,
  /** The last gate of a sprint or the last lap of a circuit (the total). */
  finish: 4,
  /** The next gate crossed backward. */
  wrongWay: 5,
} as const;

const RING = 64;

/** The physics' fixed step (`FIXED_DT` in `src/core/physics.ts`, which this file does not import: `raceTrack.test.ts` holds the two equal). */
export const RUN_STEP = 1 / 60;

/** The best a character has done on a track raced as one kind: the best lap, the best total, and the best lap's splits and levels. */
export interface RaceBest {
  /** Seconds. */
  lap: number;
  total?: number;
  /** When the best lap was set, milliseconds since the epoch. */
  at: number;
  /** The upgrade levels it was set at, since upgrades decide the time. */
  levels: Record<string, number>;
  /** The best lap's time into the lap at each gate (a circuit's gate 0 holds the lap itself; a sprint's are from go). */
  splits?: number[];
}

/** Every best a character keeps, by `<world>/<track id>` and then by the kind raced as. */
export type RaceBestBook = Record<string, Partial<Record<RaceKind, RaceBest>>>;

/** The key a track's bests are kept under: its world and its id, since two worlds' files may each have a track of one id. */
export function raceBestKey(world: string, track: string): string {
  return `${world}/${track}`;
}

/** A kept best, or null (read through `hasOwn`: a book is a plain record from storage). */
export function bestOf(book: RaceBestBook | null | undefined, key: string, kind: RaceKind): RaceBest | null {
  if (!book || !Object.hasOwn(book, key)) return null;
  const k = book[key];
  return k && Object.hasOwn(k, kind) ? (k[kind] ?? null) : null;
}

/**
 * A best laid into a book by minimum: a lap and its splits, levels and moment kept only when it is faster than the one
 * kept, a total only when it is lower. A best only ever falls. Answers the book (a new object when anything fell, the
 * one handed over otherwise) and what fell.
 */
export function mergeBest(book: RaceBestBook | null | undefined, key: string, kind: RaceKind, got: { lap?: number; total?: number; at: number; levels: Record<string, number>; splits?: readonly number[] }): { book: RaceBestBook; lap: boolean; total: boolean } {
  const was = bestOf(book, key, kind);
  const lapFell = typeof got.lap === 'number' && Number.isFinite(got.lap) && got.lap > 0 && (!was || !(was.lap <= got.lap));
  const totalFell = typeof got.total === 'number' && Number.isFinite(got.total) && got.total > 0 && (!was || !(typeof was.total === 'number' && was.total <= got.total));
  if (!lapFell && !totalFell) return { book: book ?? {}, lap: false, total: false };
  const next: RaceBest = was ? { ...was } : { lap: Infinity, at: got.at, levels: {} };
  if (lapFell) {
    next.lap = got.lap as number;
    next.at = got.at;
    next.levels = { ...got.levels };
    if (got.splits) next.splits = [...got.splits];
    else delete next.splits;
  }
  if (totalFell) next.total = got.total as number;
  // A total with no lap yet (a sprint is its own lap, so this is a circuit's run whose laps were all slower than a kept one).
  if (!Number.isFinite(next.lap)) next.lap = got.lap && got.lap > 0 ? got.lap : (got.total ?? 0);
  const out: RaceBestBook = { ...(book ?? {}) };
  out[key] = { ...(book && Object.hasOwn(book, key) ? book[key] : {}), [kind]: next };
  return { book: out, lap: lapFell, total: totalFell };
}

/** A time as the race block says it: `m:ss.t` (tenths), or `s.t` under a minute. */
export function raceTime(s: number): string {
  if (!Number.isFinite(s)) return '–';
  const t = Math.max(0, s);
  const tenths = Math.floor(t * 10 + 1e-9);
  const m = Math.floor(tenths / 600);
  const rest = tenths - m * 600;
  const sec = Math.floor(rest / 10);
  const d = rest % 10;
  return m > 0 ? `${m}:${String(sec).padStart(2, '0')}.${d}` : `${sec}.${d}`;
}

/** A difference against a best: `+1.3` or `-0.4` (tenths), or '' when there is nothing to set it against. */
export function raceDelta(s: number): string {
  if (!Number.isFinite(s)) return '';
  const t = Math.round(s * 10) / 10;
  return `${t > 0 ? '+' : t < 0 ? '-' : '±'}${Math.abs(t).toFixed(1)}`;
}

export class RaceRun {
  readonly track: TrackDef;
  readonly world: string;
  /** The kind the vehicle was spawned as (its put-back comes back as it), and the garage id it is. */
  readonly kind: RaceKind;
  readonly defId: string;
  /** Every gate baked in the game's frame (`GATE_STRIDE` numbers a gate). */
  readonly gates: Float64Array;
  readonly n: number;
  readonly laps: number;
  readonly circuit: boolean;
  /** The grid in the game's frame, and the heading it faces. */
  readonly grid: { x: number; y: number; z: number; heading: number };
  /** How far over its body's place the hull's middle stands, which is the point the gates are tested with. */
  readonly midY: number;
  phase: RunPhase = 'countdown';
  /** The run's own seconds: below nought counting down, nought at go. */
  clock = 0.5;
  /** The gate to cross next, how many have been crossed in all, the lap now, and when it began. */
  next = 0;
  seq = 0;
  lap = 1;
  lapStart = 0.5;
  /** The last gate crossed, or -1 before the first: where a put-back stands the hull. */
  lastGate = -1;
  /** This lap's time into the lap at each gate (NaN where not crossed yet). */
  readonly splits: Float64Array;
  /** Each lap's time, as done. */
  readonly lapTimes: number[] = [];
  /** The time from go to the finish, once there. */
  total = Number.NaN;
  /** The best this character kept for this track and kind when the run began, as it falls during the run. */
  bestLap = Infinity;
  bestTotal = Infinity;
  bestSplits: number[] | null = null;
  /** A gate crossed the wrong way and not yet said; cleared by the next one crossed the right way. */
  wrongWay = false;
  /** When the hull went down (a crash), on the run's clock. */
  downAt = Number.NaN;
  /** Why it ended, once it has. */
  endedWhy = '';
  /** The start's window: whether W was down before it opened, and whether the start boost has been earned. */
  private heldEarly = false;
  startEarned = false;
  /** Whether the earned start boost has been put on the drive (once go has come: `runInput`). */
  startApplied = false;
  // The watch's mark: where the body stood when it was last tested, and the clock then.
  private readonly seg = newSegment();
  private mt = 0.5;
  private marked = false;
  // The numbers a crossing hands its parts, in fields: a number handed across a call the compiler did not build in is a
  // number made, and these are reached from inside the drive's step.
  private ct = 0.5;
  private pt = 0.5;
  private pd = 0.5;
  // The ring of what happened.
  private readonly evKind = new Int8Array(RING);
  private readonly evGate = new Int16Array(RING);
  private readonly evLap = new Int16Array(RING);
  private readonly evTime = new Float64Array(RING);
  private readonly evDelta = new Float64Array(RING);
  private evN = 0;
  /** Events lost to a full ring (never in practice: the game reads them every frame). */
  lostEvents = 0;

  constructor(track: TrackDef, world: string, kind: RaceKind, defId: string, grid: { x: number; y: number; z: number; q: readonly number[] }, gates: readonly GameGate[], midY: number, best: RaceBest | null) {
    this.track = track;
    this.world = world;
    this.kind = kind;
    this.defId = defId;
    this.n = gates.length;
    this.circuit = track.kind === 'circuit';
    this.laps = this.circuit ? Math.max(1, track.laps) : 1;
    this.gates = new Float64Array(this.n * GATE_STRIDE);
    for (let i = 0; i < this.n; i++) bakeGate(gates[i], this.gates, i);
    const fx = 2 * (grid.q[0] * grid.q[2] + grid.q[3] * grid.q[1]);
    const fz = 1 - 2 * (grid.q[0] * grid.q[0] + grid.q[1] * grid.q[1]);
    this.grid = { x: grid.x, y: grid.y, z: grid.z, heading: Math.atan2(fx, fz) };
    this.midY = midY;
    this.splits = new Float64Array(this.n).fill(Number.NaN);
    if (best) {
      this.bestLap = best.lap > 0 ? best.lap : Infinity;
      this.bestTotal = typeof best.total === 'number' && best.total > 0 ? best.total : Infinity;
      this.bestSplits = best.splits && best.splits.length === this.n ? [...best.splits] : null;
    }
    this.clock = -Math.max(0, TRACK_TUNE.countdown);
    this.lapStart = 0;
    this.mt = this.clock;
    if (this.clock >= 0) this.phase = 'racing';
  }

  /** Whether the run is still going (counting down, racing, or waiting to be put back). */
  get live(): boolean {
    return this.phase === 'countdown' || this.phase === 'racing' || this.phase === 'down';
  }

  /** The gate's place in the game's frame at row `i`. */
  gateAt(i: number): { x: number; y: number; z: number } {
    const o = i * GATE_STRIDE;
    return { x: this.gates[o], y: this.gates[o + 1], z: this.gates[o + 2] };
  }

  /**
   * The run's clock moved on by the seconds the physics is about to move the hull through, on a frame play is
   * simulated. The countdown ends at nought (a `go` event, which the start's boost hangs on).
   */
  advance(seconds: number): void {
    if (!this.live || !(seconds > 0)) return;
    this.clock += seconds;
    this.advanced();
  }

  /**
   * The game's form of `advance`: the clock moved on by `n` of the physics' fixed steps (`RUN_STEP`). A whole count is
   * handed over rather than the seconds, since a fraction handed to a call the compiler did not build in is a number
   * made, once a frame for as long as a run stands.
   */
  advanceSteps(n: number): void {
    if (!this.live || !(n > 0)) return;
    this.clock += n * RUN_STEP;
    this.advanced();
  }

  private advanced(): void {
    // Sixtieths summed from a whole countdown land a hair under nought (-3 plus 180 of them is -1e-15), which held the
    // go back a whole step: within a microsecond of nought is nought.
    if (this.phase === 'countdown' && this.clock > -1e-6 && this.clock < 0) this.clock = 0;
    if (this.phase === 'countdown' && this.clock >= 0) {
      this.phase = 'racing';
      this.pt = 0;
      this.pd = Number.NaN;
      this.push(RUN_EVENT.go, -1, 0);
    }
    // A watch handed nothing yet keeps its mark's clock with the run's, so the first segment it tests is timed from now.
    if (!this.marked) this.mt = this.clock;
  }

  /**
   * The throttle seen this frame, before the drive steps: earns the start boost when it goes down within
   * `startWindow` of go and was not held from before the window opened. Answers whether the boost was earned now.
   */
  throttle(held: boolean): boolean {
    if (this.startEarned || this.phase === 'down' || !this.live) return false;
    const w = TRACK_TUNE.startWindow;
    if (this.clock < -w) {
      this.heldEarly = held;
      return false;
    }
    if (this.clock > w) return false;
    if (!held) {
      this.heldEarly = false;
      return false;
    }
    if (this.heldEarly) return false;
    this.startEarned = true;
    return true;
  }

  /** The hull stood somewhere on purpose (the grid, a put-back): nothing is crossed from where it was. */
  standing(x: number, y: number, z: number): void {
    const s = this.seg;
    s.x0 = x;
    s.y0 = y + this.midY;
    s.z0 = z;
    this.mt = this.clock;
    this.marked = true;
  }

  /**
   * The watch: the race drive's step hands over its hull as it begins (`DriveWatch`), and the segment from the last
   * mark to where the body stands now is tested against the next gate. Allocates nothing.
   */
  cross(v: WatchedHull): void {
    const s = this.seg;
    const p = v.pos;
    if (!this.marked) {
      s.x0 = p.x;
      s.y0 = p.y + this.midY;
      s.z0 = p.z;
      this.mt = this.clock;
      this.marked = true;
      return;
    }
    s.x1 = p.x;
    s.y1 = p.y + this.midY;
    s.z1 = p.z;
    if (this.phase === 'racing') {
      const dir = crossGate(this.gates, this.next, s);
      if (dir === CROSS_FORWARD) {
        this.ct = this.mt + s.t * (this.clock - this.mt);
        this.crossed();
      } else if (dir === CROSS_BACKWARD && !this.wrongWay) {
        this.wrongWay = true;
        this.pt = this.mt + s.t * (this.clock - this.mt);
        this.pd = Number.NaN;
        this.push(RUN_EVENT.wrongWay, this.next, this.lap);
      }
    }
    s.x0 = s.x1;
    s.y0 = s.y1;
    s.z0 = s.z1;
    this.mt = this.clock;
  }

  /** The next gate crossed the right way, at `ct` on the run's clock. */
  private crossed(): void {
    const t = this.ct;
    const i = this.next;
    this.wrongWay = false;
    this.seq++;
    this.lastGate = i;
    if (!this.circuit) {
      // A sprint: every gate's split is from go, and the last gate is the finish.
      this.splits[i] = t;
      this.pt = t;
      this.pd = this.bestSplits ? t - this.bestSplits[i] : Number.NaN;
      this.push(RUN_EVENT.gate, i, 1);
      if (i === this.n - 1) {
        this.lapTimes.push(t);
        this.finish();
        return;
      }
      this.next = i + 1;
      return;
    }
    if (i !== 0) {
      const split = t - this.lapStart;
      this.splits[i] = split;
      this.pt = split;
      this.pd = this.bestSplits ? split - this.bestSplits[i] : Number.NaN;
      this.push(RUN_EVENT.gate, i, this.lap);
      this.next = (i + 1) % this.n;
      return;
    }
    // Gate 0: the first time it opens lap 1 (which runs from go); every time after, it closes a lap.
    if (this.seq === 1) {
      this.pt = t;
      this.pd = Number.NaN;
      this.push(RUN_EVENT.gate, 0, 1);
      this.next = this.n > 1 ? 1 : 0;
      return;
    }
    const lapTime = t - this.lapStart;
    this.splits[0] = lapTime;
    this.lapTimes.push(lapTime);
    this.pt = lapTime;
    this.pd = lapTime - this.bestLap;
    this.push(RUN_EVENT.lap, 0, this.lap);
    if (lapTime < this.bestLap) {
      this.bestLap = lapTime;
      this.bestSplits = Array.from(this.splits);
    }
    if (this.lap >= this.laps) {
      this.finish();
      return;
    }
    this.lap++;
    this.lapStart = t;
    this.splits.fill(Number.NaN);
    this.next = this.n > 1 ? 1 : 0;
  }

  /** The finish, at `ct`: the total, and against the best total. */
  private finish(): void {
    const t = this.ct;
    this.total = t;
    this.phase = 'finished';
    if (!this.circuit && t < this.bestLap) {
      this.bestLap = t;
      this.bestSplits = Array.from(this.splits);
    }
    this.pt = t;
    this.pd = t - this.bestTotal;
    this.push(RUN_EVENT.finish, this.n - 1, this.lap);
    if (t < this.bestTotal) this.bestTotal = t;
  }

  /** The hull was wrecked: the run waits `putBack` seconds of its own clock, still running, to put it back. */
  goDown(): void {
    if (this.phase !== 'racing' && this.phase !== 'countdown') return;
    this.phase = 'down';
    this.downAt = this.clock;
    this.marked = false;
  }

  /** Whether the put-back is due: down, and `putBack` seconds gone on the run's clock. */
  get putBackDue(): boolean {
    return this.phase === 'down' && this.clock >= this.downAt + TRACK_TUNE.putBack;
  }

  /**
   * Where a put-back stands the hull's body: at the last gate crossed (the grid before the first), facing the next
   * gate, in the game's frame. A gate stands at a hull's middle and the grid at its body (`App.trackBegin`), so the
   * body under a gate is the hull's middle lower and the grid's height is the body's as it stands; read as a middle,
   * the grid's height put a hull back that much under where its countdown stood it.
   */
  putBackPlace(): { x: number; y: number; z: number; heading: number } {
    const atGate = this.lastGate >= 0;
    const from = atGate ? this.gateAt(this.lastGate) : { x: this.grid.x, y: this.grid.y, z: this.grid.z };
    const to = this.gateAt(this.next);
    const same = Math.hypot(to.x - from.x, to.z - from.z) < 1e-6;
    return { x: from.x, y: atGate ? from.y - this.midY : from.y, z: from.z, heading: same ? this.grid.heading : headingTo(from.x, from.z, to.x, to.z) };
  }

  /** Back on a whole hull at the put-back's place: racing again, nothing crossed from where the wreck was. */
  backUp(x: number, y: number, z: number): void {
    if (this.phase !== 'down') return;
    this.phase = this.clock >= 0 ? 'racing' : 'countdown';
    this.downAt = Number.NaN;
    this.standing(x, y, z);
  }

  /** The run given up (the rider dead, gone, off the vehicle, a travel, the console). */
  end(why: string): void {
    if (!this.live) return;
    this.phase = 'ended';
    this.endedWhy = why;
  }

  /** An event into the ring, its time and its difference from the best read from `pt` and `pd`. */
  private push(kind: number, gate: number, lap: number): void {
    if (this.evN >= RING) {
      this.lostEvents++;
      return;
    }
    const k = this.evN++;
    this.evKind[k] = kind;
    this.evGate[k] = gate;
    this.evLap[k] = lap;
    this.evTime[k] = this.pt;
    this.evDelta[k] = this.pd;
  }

  /** How many events wait to be read. */
  get eventCount(): number {
    return this.evN;
  }

  /** The `k`th event waiting (`RUN_EVENT`'s kind, the gate, the lap, its time and its difference from the best there). */
  eventAt(k: number): { kind: number; gate: number; lap: number; time: number; delta: number } {
    return { kind: this.evKind[k], gate: this.evGate[k], lap: this.evLap[k], time: this.evTime[k], delta: this.evDelta[k] };
  }

  /** Every event read: the ring empty again. */
  clearEvents(): void {
    this.evN = 0;
  }

  /** The run in numbers, for the console. */
  report(): Record<string, unknown> {
    const r3 = (n: number) => (Number.isFinite(n) ? Number(n.toFixed(3)) : null);
    return {
      track: this.track.id,
      world: this.world,
      kind: this.kind,
      vehicle: this.defId,
      phase: this.phase,
      clock: r3(this.clock),
      lap: `${Math.min(this.lap, this.laps)}/${this.laps}`,
      next: this.next,
      nextAt: this.live ? [this.gates[this.next * GATE_STRIDE], this.gates[this.next * GATE_STRIDE + 1], this.gates[this.next * GATE_STRIDE + 2]].map((n) => Number(n.toFixed(1))) : null,
      lastGate: this.lastGate,
      crossed: this.seq,
      laps: this.lapTimes.map((t) => r3(t)),
      splits: Array.from(this.splits).map((t) => r3(t)),
      total: r3(this.total),
      best: { lap: r3(this.bestLap), total: r3(this.bestTotal) },
      startBoost: this.startEarned,
      wrongWay: this.wrongWay,
      downAt: r3(this.downAt),
      ...(this.endedWhy ? { ended: this.endedWhy } : {}),
    };
  }
}

// ---- the game's half of a run, as rules ------------------------------------------------------------------------------
//
// What the game decides about a run every frame, written here as pure rules so the node test runs the very lines the
// game runs (`App.startRun`, `runInput`, `stepRun`, `putBack`, `keepRaceBest` call them and do only the side effects).

/** How far over the floor a hull stood on a course is put at least (m): off the ground, never in it. The drive's own rise takes it to its ride. */
export const STAND_LIFT = 0.3;

/**
 * The kind a run is raced as, which is the kind the vehicle was spawned as (`spec.kind`) and never what it is: a Koro-2
 * spawned as a bike runs a track for bikes, and comes back a bike after a crash. Null, with the words, for a kind no
 * track is raced as, or one this track is not raced as.
 */
export function runKindFor(t: Pick<TrackDef, 'name' | 'for'>, spawnedAs: string): { kind: RaceKind | null; why: string } {
  if (!RACE_KINDS.includes(spawnedAs as RaceKind)) return { kind: null, why: `${t.name} is raced on a pod or a speeder bike, and this is spawned as a ${spawnedAs}` };
  const kind = spawnedAs as RaceKind;
  if (!t.for.includes(kind)) return { kind: null, why: `${t.name} is raced as ${t.for.join(' or ')}, and this was spawned as a ${kind}` };
  return { kind, why: '' };
}

/** Where a put-back spawns the run's vehicle, and as what: the body's place (`putBackPlace`) never under the floor, and the run's own kind. */
export function putBackSpawn(run: RaceRun, floor: number): { x: number; y: number; z: number; heading: number; kind: RaceKind } {
  const at = run.putBackPlace();
  const y = Number.isFinite(floor) ? Math.max(floor + STAND_LIFT, at.y) : at.y;
  return { x: at.x, y, z: at.z, heading: at.heading, kind: run.kind };
}

/** A lap or a total laid into a character's bests, under the run's world, track and the kind it was raced as (`mergeBest`). */
export function runBestOf(book: RaceBestBook | null | undefined, run: Pick<RaceRun, 'world' | 'track' | 'kind'>, got: { lap?: number; total?: number; splits?: readonly number[] }, levels: Record<string, number>, at: number): ReturnType<typeof mergeBest> {
  return mergeBest(book, raceBestKey(run.world, run.track.id), run.kind, { ...got, at, levels });
}

/** What a run reads and writes of the drive's input (the game's `DriveInput` is one). */
export interface RunDrive {
  throttle: number;
  steer: number;
  heading?: number | null;
  boost: boolean;
  slide?: boolean;
  lean?: number;
}

/** What a run writes on the drive it races: the start boost (`RaceDrive.startBoost`, `startCap`). */
export interface RunBoost {
  startBoost: number;
  startCap: number;
}

/**
 * The drive's input while a run stands, once a frame before the drive steps: the throttle seen for the start's window
 * (`throttle`); held still through the countdown and a put-back's wait; and the start boost, once earned, put on the
 * drive only when the clock has reached go (handed over earlier, the countdown's own mask, throttle nought, ended it on
 * the drive's next step). The repair key is left alone: mending a part on the grid costs a run nothing. Allocates nothing.
 */
export function runInput(run: RaceRun, drive: RunDrive, boost: RunBoost | null): void {
  run.throttle(drive.throttle > 0);
  if (run.phase === 'countdown' || run.phase === 'down') {
    drive.throttle = 0;
    drive.steer = 0;
    drive.heading = null;
    drive.boost = false;
    drive.slide = false;
    drive.lean = 0;
  }
  if (boost && run.startEarned && !run.startApplied && run.clock >= 0) {
    run.startApplied = true;
    boost.startBoost = TRACK_TUNE.startBoost;
    boost.startCap = TRACK_TUNE.startCap;
  }
}

/** What the game tells a run's step about the world, written into one kept record each frame (`newRunWorld`). */
export interface RunWorld {
  /** Play is simulated this frame, and the fixed steps the physics is about to take (`Physics.stepsAhead`). */
  simulate: boolean;
  steps: number;
  /** The rider is dead or dying. */
  riderDown: boolean;
  /** The run has a hull now (none while it is down), and whether it was wrecked, taken away, is ridden by the rider and races (a pod, or a bike in racing mode). */
  hull: boolean;
  destroyed: boolean;
  disposed: boolean;
  mounted: boolean;
  racing: boolean;
  /** A put-back is being spawned. */
  placing: boolean;
}

export function newRunWorld(): RunWorld {
  return { simulate: false, steps: 0, riderDown: false, hull: false, destroyed: false, disposed: false, mounted: false, racing: false, placing: false };
}

/** What `runStep` asks the game to do. */
export const RUN_ACT = {
  none: 0,
  /** The hull was wrecked: the run is down, its watch let go of, a put-back to come. */
  wrecked: 1,
  /** The put-back is due: spawn it. */
  putBack: 2,
  /** The run ends: the rider died, got off, the bike left racing mode, or the hull was taken away without a wreck. */
  died: 3,
  gotOff: 4,
  leftRacing: 5,
  gone: 6,
  /** A run over (finished or ended) whose rider is off its hull: taken off the screen. */
  clear: 7,
} as const;

/**
 * A run's step, after the hulls have stepped: its clock moved on by the fixed steps the physics is about to take, only
 * while play is simulated; then what the game must do, in order -- a rider who died ends it; a hull wrecked puts it down
 * (a crash is put back), a hull taken away without a wreck ends it (a garage's clear is not a crash), a rider off it or a
 * bike out of racing mode ends it; a put-back due is asked for while none is being spawned; and a run over is cleared
 * once its rider is off its hull. Allocates nothing.
 */
export function runStep(run: RaceRun, w: RunWorld): number {
  if (w.simulate) run.advanceSteps(w.steps);
  if (run.live) {
    if (w.riderDown) return RUN_ACT.died;
    if (run.phase !== 'down' && w.hull) {
      if (w.destroyed) {
        run.goDown();
        return RUN_ACT.wrecked;
      }
      if (w.disposed) return RUN_ACT.gone;
      if (!w.mounted) return RUN_ACT.gotOff;
      if (!w.racing) return RUN_ACT.leftRacing;
    }
    return run.putBackDue && !w.placing ? RUN_ACT.putBack : RUN_ACT.none;
  }
  if ((run.phase === 'finished' || run.phase === 'ended') && (!w.hull || !w.mounted || w.disposed)) return RUN_ACT.clear;
  return RUN_ACT.none;
}
