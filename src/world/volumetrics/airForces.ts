// The force API (the design's §2.10, the handoff's `air-forces.md`): every disturbance of the air -- an engine, a
// Force power, a blast -- is a call here, and the caller never decides air, water or lava: the cell's medium does.
// Every call writes into kept arrays and returns; the field flushes them into its splat batches.
//
// **What a queue holds between steps** (§2.4). The solver steps at a fixed rate and most frames at 144 Hz take no
// step, so a **one-shot** force (a blast's shoves, a push, a repulse) stays in its queue until the next step consumes
// it, and none is lost on a frame that takes no step; a **continuous** source (an engine) is not appended each frame:
// the engine table is written afresh each frame with the latest place and strength of every running engine, and each
// step applies it once scaled by that step's `dt`, so a source's push a second is the same at every frame rate. The
// velocity batch holds `forces.splats` splats: one-shots first, then the engines by strength over distance to the
// camera, the strongest `engineFull` taking their whole 16 splats and the rest 8; what does not fit is dropped and
// counted. The dust is laid every frame, so its sources are rates times the frame's own `dt`.
//
// **No number crosses a call on the frame's path** (the design's rule 4, CLAUDE.md's allocation lessons): a number
// handed to or back from a call the compiler did not build in is a number made, and the engines' and the batches' code
// is too big for the compiler to build its helpers into. So an engine is handed over in a kept array (`arg`, then
// `engineArgs()`), a splat is written into a kept scratch before `put`, the step's and the frame's `dt` are fields, and
// the jet's arithmetic is written out where it is used -- the same lines as `airMath.ts`'s `engineReach`,
// `engineSpeed`, `nozzleRadius`, `jetSpeedAt`, `jetRadiusAt`, `impactSpeed` and `spreadBite`, which `airMath.test.ts`
// holds this class's batches to. The one-shots (a blast, a push) are events, not frames, and take plain arguments.
//
// **From wave 2b each dust splat carries the shape it is laid with** (the design's §2.14): beside its amount a
// second `vec4`, `(μ₀, σ₀, w₀, —)`, the height it is laid at, its spread and its rise, by source -- a jet skimming the
// ground lays it low and throws it up behind the machine, a jet meeting the ground lays a low ring, a blast throws it
// high, a Force front lays it low with a gentle rise. And **a Force power is a front** (§2.15): a row of a kept table,
// its band swept on each fixed step for the air and on each frame for the dust, so both are the same at every frame
// rate. **The sources' frame walk** (`frameSources`) runs every frame the field runs, the dust on or off: it ages the
// fronts and works out each engine's ground point, impact and spread, which the dust's batch then reads.
//
// Pure: no three, nothing of the page; the node tests drive the very class the game does.
import { AIR_TUNE } from './airTune.ts';
import { blastGrains, DENT_KIND, FRONT_KIND, frontRadiusIn, HALF_NORMAL, liftPeakIn, newFrontAt, newLiftPeak, slabWeight } from './airMath.ts';
import type { FluidWindow } from './fluidWindow.ts';
import { MEDIUM_BYTE, type AirRaster } from './airRaster.ts';
import type { AirDents } from './airDents.ts';
import { FORCE_WAVE, FORCE_WAVE_SPEED } from '../../combat/forceWaveTune.ts';

/** One-shot velocity shoves a step can be owed: [x, z, radius, height over the ground, dvx, dvz, reach]. */
const ONE_MAX = 256;
const ONE_W = 7;
/** Engines a frame: [x, y, z, dx, dy, dz, exit, vx, vz, key]. */
export const ENGINE_MAX = 64;
const ENG_W = 10;
/** Each engine's dust as the frame walk works it out: [x, z, radius, rate a second, μ₀, σ₀, w₀, 1 where it lays any]. */
const ENG_DUST_W = 8;
/** One-shot dust a frame can be owed: [x, z, radius, amount, μ₀, σ₀, w₀]. */
const DUST_MAX = 64;
const DUST_W = 7;
/** The splat batches' sizes: the shaders' loop bounds, compiled into the programs. */
export const SPLAT_BATCH = 128;
export const DUST_BATCH = 32;
/** The smoke's batch a frame (the third wave): three `vec4`s a splat, 96 of D3D11's 1024 fragment vectors. */
export const SMOKE_BATCH = 32;
/**
 * Smoke sources (the third wave): [x, z, radius, amount, share of slab 0, 1, 2, r, g, b, seconds left, seconds held]. A
 * frame's own table (a gas cloud, a burning part: handed in every frame, laid at its rate times the frame's `dt`), and a
 * held one (a blast's and a wreck's feed, fading over their hold), and the one-shots owed to the next frame (a blast's
 * first puff, laid whole).
 */
const SMOKE_W = 12;
const SMOKE_FRAME_MAX = 32;
const SMOKE_HELD_MAX = 32;
const SMOKE_ONE_MAX = 32;
/**
 * The Force's fronts (`AIR_TUNE.forces.fronts`, read once as the table is made): [kind, x, z, y, aim x, aim z, reach,
 * power, step age, frame age, frame turn, step turn, this frame's radius from, to, share of its way from, to].
 */
const FRONT_W = 16;

/** What the forces counted, since the field last read them. */
export interface ForceCounts {
  engines: number;
  oneShots: number;
  dust: number;
  droppedSplats: number;
  droppedDust: number;
  offWindow: number;
  notFinite: number;
  blasts: number;
  forces: number;
  /** Fronts begun, and fronts dropped for a full table (a ninth at once). */
  fronts: number;
  droppedFronts: number;
  /** Smoke sources handed in (a frame's, held and one-shot), and dropped for a full table or batch. */
  smoke: number;
  droppedSmoke: number;
}

const freshCounts = (): ForceCounts => ({ engines: 0, oneShots: 0, dust: 0, droppedSplats: 0, droppedDust: 0, offWindow: 0, notFinite: 0, blasts: 0, forces: 0, fronts: 0, droppedFronts: 0, smoke: 0, droppedSmoke: 0 });

/** The golden angle as a share of a turn: a front's bearings turn by it each step and each frame, so a sparse ring fills. */
const GOLDEN = (3 - Math.sqrt(5)) / 2;

/** The grains a blast throws, handed to whoever keeps the dust pool (`World`). */
export type GrainThrow = (x: number, y: number, z: number, count: number, speed: number) => void;

export class AirForces {
  /** Off: every call answers before touching anything (the master off, the air off, indoors, in space). */
  active = false;
  fromEngines = true;
  fromForce = true;
  fromBlasts = true;
  /** The dust carried at all (`volDust`): with it off no dust is laid. */
  dust = true;
  /** The grains a blast throws, while the kick-up is on; null for none. */
  onGrains: GrainThrow | null = null;
  /**
   * The dents (the second wave): a blast's crater, the console's and the feet's prints, and the scour pits and ruts the
   * engines gather (`gatherDents`); null while the prints are off, the ground keeps no marks here, or this browser
   * cannot blend into a float target.
   */
  dents: AirDents | null = null;
  /** Where the window stands and the ground under it: set by the field. */
  window: FluidWindow | null = null;
  raster: AirRaster | null = null;
  /** The camera, for the engines' order. */
  camX = 0;
  camZ = 0;

  readonly counts: ForceCounts = freshCounts();
  readonly oneShots = new Float32Array(ONE_MAX * ONE_W);
  oneCount = 0;
  readonly engines = new Float32Array(ENGINE_MAX * ENG_W);
  /** Each engine's source (its hull's group id times 64 and its own index; -1 for the console's): what a rut's or a pit's depth is gathered under between ticks. */
  readonly engineKeys = new Float64Array(ENGINE_MAX);
  engineCount = 0;
  readonly dustOne = new Float32Array(DUST_MAX * DUST_W);
  dustCount = 0;

  /** The step's velocity batch: (u, v, 1 / r², height over ground) and (dvx, dvz, reach, 0) in window uv and m/s. */
  readonly splatA = new Float32Array(SPLAT_BATCH * 4);
  readonly splatB = new Float32Array(SPLAT_BATCH * 4);
  splatCount = 0;
  /** The frame's dust batch: (u, v, 1 / r², amount), and each splat's shape beside it (μ₀, σ₀, w₀, 0). */
  readonly dustBatch = new Float32Array(DUST_BATCH * 4);
  readonly dustShapeBatch = new Float32Array(DUST_BATCH * 4);
  dustBatchCount = 0;
  /**
   * The highest a lift laid this frame will stand, metres over the ground (`liftPeakIn`'s top: its peak and
   * `bandSigmas` of its spread then), nought for none: what the field keeps the march's band by.
   */
  liftTop = 0.5;

  /** Smoke carried at all (`volSmoke`): with it off no smoke source is taken. */
  smokeOn = true;
  /** The smoke sources of this frame, held ones, and one-shots owed (`SMOKE_W` numbers a row). */
  readonly smokeFrame = new Float64Array(SMOKE_FRAME_MAX * SMOKE_W);
  smokeFrameCount = 0;
  readonly smokeHeld = new Float64Array(SMOKE_HELD_MAX * SMOKE_W);
  smokeHeldCount = 0;
  readonly smokeOne = new Float64Array(SMOKE_ONE_MAX * SMOKE_W);
  smokeOneCount = 0;
  /** The frame's smoke batch: (u, v, 1 / r², amount), each slab's share, and its colour (linear). */
  readonly smokeBatch = new Float32Array(SMOKE_BATCH * 4);
  readonly smokeShare = new Float32Array(SMOKE_BATCH * 4);
  readonly smokeColour = new Float32Array(SMOKE_BATCH * 4);
  smokeBatchCount = 0;
  /**
   * This frame's own smoke sources (a gas cloud's, a burning part's) a full table refused since the last batch, and how
   * many the last batch saw refused: while any was, the field answers that it draws no cloud's smoke, so every gas cloud's
   * puffs are drawn (`AirField.drawsSmokeAt`). Laid first and the table no longer than the batch, a source the table took
   * is always laid.
   */
  frameSmokeLost = 0;
  frameSmokeLostLast = 0;
  /** A smoke source handed over: x, y, z, radius, rate, colour (0xRRGGBB, sRGB), seconds held (0 for the frame's), one-shot amount (`smokeArgs`). */
  readonly smokeArg = new Float64Array(8);

  /** The Force's fronts alive (`FRONT_W` numbers a row), sized once from the tune. */
  readonly fronts = new Float64Array(Math.max(1, Math.floor(AIR_TUNE.forces.fronts)) * FRONT_W);
  frontCount = 0;
  /** Each engine of this frame's table, its dust as the frame walk worked it out (`frameSources`). */
  readonly engineDust = new Float64Array(ENGINE_MAX * ENG_DUST_W);
  /** The dust's own texel, metres (the field's dust grid over the window): the floor the fronts' dust is laid at. */
  dustTexel = 0.375;
  /** The floor `putDust` lays its next splat at, metres, set by its caller (a fraction from the start, so never boxed). */
  private dustFloor = 0.375;

  /** An engine handed over: x, y, z, the exhaust's way dx, dy, dz, its exit m/s, the hull's vx, vz, and its source key (`engineArgs`). */
  readonly arg = new Float64Array(10);
  /** The step's `dt` for `buildStepBatch` and the frame's for `buildDustBatch` and `frameSources`, set by the field before each. */
  stepDt = 1 / 60;
  frameDt = 1 / 60;

  private readonly order = new Int16Array(ENGINE_MAX);
  private readonly g = { h: 0.5 };
  /** A point asked of the ground or the window (`groundHere`, `mediumHere`, `nearHere`): x, z, and the margin. */
  private readonly q = new Float64Array(3);
  /** A one-shot shove for `shove`: x, z, radius, height over the ground, dvx, dvz, reach. */
  private readonly so = new Float64Array(7);
  /** A splat for `put`: x, z, radius, height over the ground, dvx, dvz, reach. */
  private readonly sp = new Float64Array(7);
  /** A dust splat for `putDust`: x, z, radius, amount, and the shape it is laid with, μ₀, σ₀, w₀. */
  private readonly sd = new Float64Array(DUST_W);
  /** Where a front is (`frontRadiusIn`) and where a lift peaks (`liftPeakIn`): kept records, so no number crosses a call. */
  private readonly fa = newFrontAt();
  private readonly lp = newLiftPeak();

  /** The counts as they stand, and starts them again. */
  takeCounts(out: ForceCounts): ForceCounts {
    Object.assign(out, this.counts);
    Object.assign(this.counts, freshCounts());
    return out;
  }

  /** The engine table is written afresh each frame (`airEngines.ts`). */
  beginFrame(): void {
    this.engineCount = 0;
  }

  /** Whether the point in `q` is near enough the window to touch it: inside, or within `q[2]` metres of it. */
  private nearHere(): boolean {
    const w = this.window;
    if (!w || !w.placed) return false;
    const q = this.q;
    const m = q[2];
    return q[0] >= w.ox - m && q[1] >= w.oz - m && q[0] <= w.ox + w.size + m && q[1] <= w.oz + w.size + m;
  }

  /** The medium under the point in `q`: the raster's byte, nought where it is outside or unknown. */
  private mediumHere(): number {
    const w = this.window;
    const r = this.raster;
    if (!w || !r) return 0;
    const i = Math.floor((this.q[0] - w.ox) / w.cell);
    const j = Math.floor((this.q[1] - w.oz) / w.cell);
    const n = r.n;
    if (i < 0 || j < 0 || i >= n || j >= n) return 0;
    return r.colour[(j * n + i) * 4 + 3];
  }

  /**
   * Whether the ground under the point in `q` gives dust: known land whose response sheds any. Never water or lava,
   * and never mud or wet sand, whose response sheds none: the dust pass would lay nothing there, and a splat that lays
   * nothing must not count as dust lifted, or `hasAir` would keep the volume marching empty air for as long as a speeder
   * idles at a lake's edge.
   */
  private givesDustHere(): boolean {
    const w = this.window;
    const r = this.raster;
    if (!w || !r) return false;
    const i = Math.floor((this.q[0] - w.ox) / w.cell);
    const j = Math.floor((this.q[1] - w.oz) / w.cell);
    const n = r.n;
    if (i < 0 || j < 0 || i >= n || j >= n) return false;
    const k = (j * n + i) * 4;
    return r.colour[k + 3] === MEDIUM_BYTE.land && r.response[k + 3] > 0;
  }

  /** The ground's height under the point in `q` into `this.g.h`, or false (outside the window, or not known yet). */
  private groundHere(): boolean {
    const w = this.window;
    const r = this.raster;
    if (!w || !r) return false;
    const i = Math.floor((this.q[0] - w.ox) / w.cell);
    const j = Math.floor((this.q[1] - w.oz) / w.cell);
    const n = r.n;
    if (i < 0 || j < 0 || i >= n || j >= n) return false;
    const k = j * n + i;
    if (r.known[k] !== 1) return false;
    this.g.h = r.height[k];
    return true;
  }

  /**
   * One engine: its nozzle in the world, the way its exhaust leaves, its exit speed (m/s), and the hull's own velocity
   * in XZ. Continuous: written into this frame's table, applied once a step scaled by the step. The console's and the
   * tests' way in; the frame's is `arg` and `engineArgs`.
   */
  engine(x: number, y: number, z: number, dx: number, dy: number, dz: number, exit: number, vx: number, vz: number, key = -1): void {
    const a = this.arg;
    a[0] = x;
    a[1] = y;
    a[2] = z;
    a[3] = dx;
    a[4] = dy;
    a[5] = dz;
    a[6] = exit;
    a[7] = vx;
    a[8] = vz;
    a[9] = key;
    this.engineArgs();
  }

  /** The engine in `arg` into this frame's table (`engine`'s rule, with no number handed across a call). */
  engineArgs(): void {
    if (!this.active || !this.fromEngines) return;
    const a = this.arg;
    for (let i = 0; i < 9; i++) {
      if (!Number.isFinite(a[i])) {
        this.counts.notFinite++;
        return;
      }
    }
    const exit = a[6];
    if (!(exit > 0.5)) return;
    const E = AIR_TUNE.engine;
    // The free jet's reach, `engineReach`.
    const m = (E.reachBase + E.reachPerSpeed * exit) * 1.5;
    const w = this.window;
    if (!w || !w.placed || a[0] < w.ox - m || a[2] < w.oz - m || a[0] > w.ox + w.size + m || a[2] > w.oz + w.size + m) {
      this.counts.offWindow++;
      return;
    }
    if (this.engineCount >= ENGINE_MAX) {
      this.counts.droppedSplats += 16;
      return;
    }
    const dx = a[3];
    const dy = a[4];
    const dz = a[5];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const k = this.engineCount * ENG_W;
    const e = this.engines;
    e[k] = a[0];
    e[k + 1] = a[1];
    e[k + 2] = a[2];
    e[k + 3] = len > 1e-6 ? dx / len : 0;
    e[k + 4] = len > 1e-6 ? dy / len : -1;
    e[k + 5] = len > 1e-6 ? dz / len : 0;
    e[k + 6] = exit;
    e[k + 7] = a[7];
    e[k + 8] = a[8];
    this.engineKeys[this.engineCount] = Number.isFinite(a[9]) ? a[9] : -1;
    const cx = a[0] - this.camX;
    const cz = a[2] - this.camZ;
    const d = Math.sqrt(cx * cx + cz * cz);
    // The jet's speed, `engineSpeed`, over the distance to the camera: the order the batch takes them in.
    const cap = AIR_TUNE.solver.cap * E.capShare;
    e[k + 9] = (exit < cap ? exit : cap) / (d > 1 ? d : 1);
    this.engineCount++;
    this.counts.engines++;
  }

  /** The one-shot shove in `so` (x, z, radius, height over the ground, dvx, dvz, reach) into the queue owed the next step. */
  private shove(): void {
    if (this.oneCount >= ONE_MAX) {
      this.counts.droppedSplats++;
      return;
    }
    const k = this.oneCount * ONE_W;
    const o = this.oneShots;
    const so = this.so;
    for (let c = 0; c < ONE_W; c++) o[k + c] = so[c];
    this.oneCount++;
    this.counts.oneShots++;
  }

  /** The one-shot dust in `sd` (x, z, its e-folding radius, the density at its middle) into the frame's queue, on ground that gives dust only. */
  private dustOneShot(): void {
    const sd = this.sd;
    if (!this.dust || !(sd[3] > 0)) return;
    this.q[0] = sd[0];
    this.q[1] = sd[1];
    if (!this.givesDustHere()) return;
    if (this.dustCount >= DUST_MAX) {
      this.counts.droppedDust++;
      return;
    }
    const k = this.dustCount * DUST_W;
    const d = this.dustOne;
    for (let c = 0; c < DUST_W; c++) d[k + c] = sd[c];
    this.dustCount++;
    this.counts.dust++;
  }

  /**
   * A Force push (`sign` +1) or pull (-1) from a point along a direction in XZ, out to `reach` metres; or all round when
   * the direction is nought (the repulse). From wave 2b a **front** (the design's §2.15): a row of the kept table,
   * its air laid on each fixed step and its dust on each frame by the band the front crossed (`stepFronts`,
   * `dustFronts`), so a push's wave runs out over about a second, a pull's rolls in from its reach and a repulse's ring
   * opens with its middle clear. The checks and the count are the first wave's; a ninth at once is dropped and counted.
   */
  force(x: number, y: number, z: number, dx: number, dz: number, power: number, sign: number, reach: number): void {
    if (!this.active || !this.fromForce) return;
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && Number.isFinite(dx) && Number.isFinite(dz) && Number.isFinite(power) && Number.isFinite(reach))) {
      this.counts.notFinite++;
      return;
    }
    const q = this.q;
    q[0] = x;
    q[1] = z;
    q[2] = reach;
    if (!this.nearHere()) {
      this.counts.offWindow++;
      return;
    }
    this.counts.forces++;
    const rows = this.fronts.length / FRONT_W;
    if (this.frontCount >= rows) {
      this.counts.droppedFronts++;
      return;
    }
    const len = Math.sqrt(dx * dx + dz * dz);
    const t = this.fronts;
    const k = this.frontCount * FRONT_W;
    t[k] = len < 1e-6 ? FRONT_KIND.repulse : sign > 0 ? FRONT_KIND.push : FRONT_KIND.pull;
    t[k + 1] = x;
    t[k + 2] = z;
    t[k + 3] = y;
    t[k + 4] = len < 1e-6 ? 1 : dx / len;
    t[k + 5] = len < 1e-6 ? 0 : dz / len;
    t[k + 6] = reach;
    t[k + 7] = power;
    for (let c = 8; c < FRONT_W; c++) t[k + c] = 0;
    this.frontCount++;
    this.counts.fronts++;
  }

  /**
   * The sources' frame walk (the design's §2.4), every frame the field runs, the dust on or off and before the dust's
   * batch: each front's frame age moves on by the frame's `dt` and the band it crosses this frame is kept on its row (a
   * front whose step age and frame age have both passed its time is let go first, so its last band has been laid), and
   * each engine's dust -- where its jet meets the ground or bites under its nozzle, how much a second, and the shape it is
   * laid with -- is worked out into `engineDust`, which the dust's batch reads with the dust on. `frameDt` set by the field.
   */
  frameSources(): void {
    const dt = this.frameDt > 0 && Number.isFinite(this.frameDt) ? this.frameDt : 0;
    const t = this.fronts;
    // Let go of the fronts finished on both clocks (moved down over: a table, not a list).
    let w = 0;
    const F = AIR_TUNE.force;
    // The wave's one speed, which the knock reads too (`FORCE_WAVE`, the Gameplay page's).
    const sp = FORCE_WAVE.speed > FORCE_WAVE_SPEED.min ? FORCE_WAVE.speed : FORCE_WAVE_SPEED.min;
    for (let i = 0; i < this.frontCount; i++) {
      const k = i * FRONT_W;
      // `frontTime` written out (a number handed back across a call is a number made, every front every frame).
      const T0 = (t[k] === FRONT_KIND.push ? F.pushTime : t[k] === FRONT_KIND.pull ? F.pullTime : F.repulseTime) / sp;
      const T = T0 > 1e-3 ? T0 : 1e-3;
      if (t[k + 8] >= T && t[k + 9] >= T) continue;
      if (w !== i) for (let c = 0; c < FRONT_W; c++) t[w * FRONT_W + c] = t[k + c];
      w++;
    }
    this.frontCount = w;
    const fa = this.fa;
    for (let i = 0; i < this.frontCount; i++) {
      const k = i * FRONT_W;
      const a0 = t[k + 9];
      const a1 = a0 + dt;
      t[k + 9] = a1;
      fa.kind = t[k];
      fa.reach = t[k + 6];
      fa.age = a0;
      frontRadiusIn(fa);
      t[k + 12] = fa.r;
      t[k + 14] = fa.s;
      fa.age = a1;
      frontRadiusIn(fa);
      t[k + 13] = fa.r;
      t[k + 15] = fa.s;
    }
    this.engineSources();
  }

  /** Each engine's dust for the frame walk, into `engineDust`: the jet's impact or its spread, whichever lays more. */
  private engineSources(): void {
    const E = AIR_TUNE.engine;
    const cap = AIR_TUNE.solver.cap * E.capShare;
    const e = this.engines;
    const out = this.engineDust;
    for (let i = 0; i < this.engineCount; i++) {
      const k = i * ENG_W;
      const o = i * ENG_DUST_W;
      out[o + 7] = 0;
      const x = e[k];
      const y = e[k + 1];
      const z = e[k + 2];
      const dx = e[k + 3];
      const dy = e[k + 4];
      const dz = e[k + 5];
      const exit = e[k + 6];
      this.q[0] = x;
      this.q[1] = z;
      if (!this.groundHere()) continue;
      const h = y - this.g.h;
      // `engineReach`, `engineSpeed`, `impactSpeed` within its reach, `spreadBite`: as `expandEngine` has them.
      const reach = E.reachBase + E.reachPerSpeed * exit;
      const vEff = exit < cap ? exit : cap;
      const groundT = dy < -0.02 ? h / -dy : Infinity;
      const imp = groundT < reach * E.impactReach && dy < 0 ? (vEff / (1 + groundT / (0.3 * reach))) * Math.sqrt(-dy) : 0;
      const vx = e[k + 7];
      const vz = e[k + 8];
      const speed = Math.sqrt(vx * vx + vz * vz);
      let ge = 1 - (h - E.spreadLow) / E.spreadSpan;
      ge = ge > 0 ? (ge < 1 ? ge : 1) : 0;
      const bite = ge * (E.spreadBase + speed / E.spreadSpeed);
      const fromImpact = imp * E.impactDust;
      const fromSpread = bite * E.spreadDust;
      if (fromImpact <= 0 && fromSpread <= 0) continue;
      if (fromImpact >= fromSpread) {
        // `nozzleRadius` and the jet's widening to the ground; laid low in a ring that rises as the wall jet slows.
        const r = E.nozzleBase + E.nozzlePerSpeed * exit + groundT * E.widen + 0.8;
        out[o] = x + dx * groundT;
        out[o + 1] = z + dz * groundT;
        out[o + 2] = r * 1.2;
        out[o + 3] = fromImpact;
        out[o + 4] = E.impactAt;
        out[o + 5] = E.impactSigma;
        out[o + 6] = E.impactRise * imp;
      } else {
        // Behind the machine, as the demo's speeder throws it: low, and up at its grains' throw, held at the demo's top speed.
        const bx = speed > 0.1 ? -vx / speed : 0;
        const bz = speed > 0.1 ? -vz / speed : 0;
        const held = speed < E.spreadRiseSpeed ? speed : E.spreadRiseSpeed;
        out[o] = x + bx * 2;
        out[o + 1] = z + bz * 2;
        out[o + 2] = 2.2;
        out[o + 3] = fromSpread;
        out[o + 4] = E.spreadAt;
        out[o + 5] = E.spreadSigma;
        out[o + 6] = E.spreadRise * (1.7 + 0.24 * held) * (bite < 1 ? bite : 1);
      }
      out[o + 7] = 1;
    }
  }

  /**
   * Every front's shoves for this step, into the velocity batch at `n` (after the one-shots, before the engines): the band
   * the front crosses this step, `m` shoves along its arc at its middle radius, each worth `shove · fall · dr · spacing /
   * (π ρ²)`, so a parcel the whole front passes is given `shove · fall` in all whatever the step, the speed or the
   * spacing; the bearings turned by the golden angle each step. The step age moves on here. Answers the next free place.
   */
  private stepFronts(n: number): number {
    const t = this.fronts;
    const F = AIR_TUNE.force;
    const most = AIR_TUNE.forces.frontShoves;
    const dt = this.stepDt;
    const cell = this.window ? this.window.cell : 1.5;
    const fa = this.fa;
    const sp = this.sp;
    for (let i = 0; i < this.frontCount; i++) {
      const k = i * FRONT_W;
      const kind = t[k];
      const a0 = t[k + 8];
      const a1 = a0 + dt;
      t[k + 8] = a1;
      fa.kind = kind;
      fa.reach = t[k + 6];
      fa.age = a0;
      frontRadiusIn(fa);
      const r0 = fa.r;
      fa.age = a1;
      frontRadiusIn(fa);
      const r1 = fa.r;
      const dr = r1 > r0 ? r1 - r0 : r0 - r1;
      if (!(dr > 0)) continue;
      const reach = t[k + 6];
      const r = 0.5 * (r0 + r1);
      const rho0 = F.shoveShare * reach;
      const rho = rho0 > cell ? rho0 : cell;
      // `frontHalfArc` written out, as `frontTime` is in the walk.
      const half = kind === FRONT_KIND.repulse ? Math.PI : (F.arc * Math.PI) / 180;
      const arcLen = 2 * half * r;
      let m = Math.ceil(arcLen / (1.2 * rho));
      m = m < 2 ? 2 : m > most ? most : m;
      const spacing = arcLen / m;
      const fall0 = 1 - r / (reach * (kind === FRONT_KIND.repulse ? 1.2 : 1.1));
      const fall = fall0 > 0 ? fall0 : 0;
      const strength = (kind === FRONT_KIND.push ? F.push : kind === FRONT_KIND.pull ? F.pull : F.repulse) * t[k + 7] * fall;
      const dv = (strength * dr * spacing) / (Math.PI * rho * rho);
      const turn = (t[k + 11] * GOLDEN) % 1;
      t[k + 11] += 1;
      const fx = t[k + 4];
      const fz = t[k + 5];
      const sgn = kind === FRONT_KIND.pull ? -1 : 1;
      const col = F.column;
      for (let j = 0; j < m; j++) {
        if (n >= SPLAT_BATCH) {
          this.counts.droppedSplats += m - j;
          break;
        }
        const b = -half + ((j + turn) / m) * 2 * half;
        const c = Math.cos(b);
        const s = Math.sin(b);
        const bx = fx * c - fz * s;
        const bz = fx * s + fz * c;
        sp[0] = t[k + 1] + bx * r;
        sp[1] = t[k + 2] + bz * r;
        sp[2] = rho;
        sp[3] = col * 0.5;
        sp[4] = bx * dv * sgn;
        sp[5] = bz * dv * sgn;
        sp[6] = col;
        n = this.put(n);
      }
    }
    return n;
  }

  /**
   * Every front's dust for this frame, into the dust batch at `n` (after the one-shot dust, before the engines): the band
   * the frame walk kept, `m` splats on its arc at its middle radius (turned by the golden angle each frame), each worth
   * `dust · power · sin(π s)^shape · dr · spacing / (π ρ_d²)`, so none is laid at the start, most halfway and none at the
   * end; the band `ρ_d` starts at `dustWidth` and grows with the metres travelled, floored at the dust's own texel and
   * not the air's cell, or it could not start small. Only where the ground gives dust. Answers the next free place.
   */
  private dustFronts(n: number): number {
    const t = this.fronts;
    const F = AIR_TUNE.force;
    const most = AIR_TUNE.forces.frontDust;
    const sd = this.sd;
    const floor = this.dustTexel;
    for (let i = 0; i < this.frontCount; i++) {
      const k = i * FRONT_W;
      const kind = t[k];
      const r0 = t[k + 12];
      const r1 = t[k + 13];
      const dr = r1 > r0 ? r1 - r0 : r0 - r1;
      if (!(dr > 0)) continue;
      const reach = t[k + 6];
      const r = 0.5 * (r0 + r1);
      // `frontFrom` and `frontHalfArc` written out, as in the step's shoves.
      const from = kind === FRONT_KIND.push ? F.pushFrom : kind === FRONT_KIND.pull ? reach * F.pullFrom : F.repulseFrom;
      const travelled = r > from ? r - from : from - r;
      const rd0 = F.dustWidth + F.dustGrow * travelled;
      const rho = rd0 > floor ? rd0 : floor;
      const half = kind === FRONT_KIND.repulse ? Math.PI : (F.arc * Math.PI) / 180;
      const arcLen = 2 * half * r;
      let m = Math.ceil(arcLen / (1.2 * rho));
      m = m < 1 ? 1 : m > most ? most : m;
      const spacing = arcLen / m;
      const sm = 0.5 * (t[k + 14] + t[k + 15]);
      const sine = Math.sin(Math.PI * sm);
      const shape = Math.pow(sine > 0 ? sine : 0, F.dustShape);
      const amount = (F.dust * t[k + 7] * shape * dr * spacing) / (Math.PI * rho * rho);
      const turn = (t[k + 10] * GOLDEN) % 1;
      t[k + 10] += 1;
      if (!(amount > 0)) continue;
      const fx = t[k + 4];
      const fz = t[k + 5];
      const repulse = kind === FRONT_KIND.repulse;
      for (let j = 0; j < m; j++) {
        if (n >= DUST_BATCH) {
          this.counts.droppedDust += m - j;
          break;
        }
        const b = -half + ((j + turn) / m) * 2 * half;
        const c = Math.cos(b);
        const s = Math.sin(b);
        sd[0] = t[k + 1] + (fx * c - fz * s) * r;
        sd[1] = t[k + 2] + (fx * s + fz * c) * r;
        sd[2] = rho;
        sd[3] = amount;
        sd[4] = F.dustLow;
        sd[5] = repulse ? F.repulseSpread : F.dustSpread;
        sd[6] = repulse ? F.repulseKick : F.dustKick;
        this.q[0] = sd[0];
        this.q[1] = sd[1];
        if (!this.givesDustHere()) continue;
        this.dustFloor = floor;
        n = this.putDust(n);
      }
    }
    return n;
  }

  /**
   * Smoke held at a point (the force API's `smoke`, the third wave): a gas cloud's or a burning part's, handed in every
   * frame it lasts and laid at `rate` a second over that frame, in its colour (`0xRRGGBB`, sRGB), shared into the slabs by
   * its height over the ground (`slabWeight`'s rule at a reach of `smokeReach`). Answers at once with the field off, the
   * smoke off, the point not a number or off the window.
   */
  smoke(x: number, y: number, z: number, radius: number, rate: number, colour: number): void {
    const a = this.smokeArg;
    a[0] = x;
    a[1] = y;
    a[2] = z;
    a[3] = radius;
    a[4] = rate;
    a[5] = colour;
    a[6] = 0;
    a[7] = 0;
    this.smokeArgs();
  }

  /** Smoke held at a point for `seconds`, fading over them (a source that outlives the frame: the console's). */
  heldSmoke(x: number, y: number, z: number, radius: number, rate: number, colour: number, seconds: number): void {
    const a = this.smokeArg;
    a[0] = x;
    a[1] = y;
    a[2] = z;
    a[3] = radius;
    a[4] = rate;
    a[5] = colour;
    a[6] = seconds > 0 ? seconds : 0;
    a[7] = 0;
    this.smokeArgs();
  }

  /**
   * The smoke source in `smokeArg` (`smoke`'s rule, no number handed across a call): `[6]` seconds held (nought: this
   * frame's alone, else a held source fading over them), `[7]` a one-shot amount laid whole at the next frame (nought for
   * none). A full table drops the source and counts it.
   */
  smokeArgs(): void {
    if (!this.active || !this.smokeOn) return;
    const a = this.smokeArg;
    for (let i = 0; i < 8; i++) {
      if (!Number.isFinite(a[i])) {
        this.counts.notFinite++;
        return;
      }
    }
    const q = this.q;
    q[0] = a[0];
    q[1] = a[2];
    q[2] = a[3];
    if (!this.nearHere()) {
      this.counts.offWindow++;
      return;
    }
    const held = a[6];
    const one = a[7];
    let table: Float64Array;
    let k: number;
    if (one > 0) {
      if (this.smokeOneCount >= SMOKE_ONE_MAX) {
        this.counts.droppedSmoke++;
        return;
      }
      table = this.smokeOne;
      k = this.smokeOneCount++ * SMOKE_W;
    } else if (held > 0) {
      if (this.smokeHeldCount >= SMOKE_HELD_MAX) {
        this.counts.droppedSmoke++;
        return;
      }
      table = this.smokeHeld;
      k = this.smokeHeldCount++ * SMOKE_W;
    } else {
      if (this.smokeFrameCount >= SMOKE_FRAME_MAX) {
        this.counts.droppedSmoke++;
        // A danger's smoke (a gas cloud's) not taken: the puffs are drawn for every cloud until a batch takes them all.
        this.frameSmokeLost++;
        return;
      }
      table = this.smokeFrame;
      k = this.smokeFrameCount++ * SMOKE_W;
    }
    // Its height over the ground there, shared into the slabs by their middles (unknown ground: a metre up).
    const h = this.groundHere() ? a[1] - this.g.h : 1;
    const S = AIR_TUNE.slabs;
    const r = AIR_TUNE.smoke.reach > 0.1 ? AIR_TUNE.smoke.reach : 0.1;
    const d0 = (S.centre - h) / r;
    const d1 = (S.centre1 - h) / r;
    const d2 = (S.centre2 - h) / r;
    let w0 = Math.exp(-d0 * d0);
    let w1 = Math.exp(-d1 * d1);
    let w2 = Math.exp(-d2 * d2);
    const ws = w0 + w1 + w2;
    if (ws > 1e-6) {
      w0 /= ws;
      w1 /= ws;
      w2 /= ws;
    } else if (h > S.centre2) {
      w0 = 0;
      w1 = 0;
      w2 = 1;
    } else {
      w0 = 1;
      w1 = 0;
      w2 = 0;
    }
    const c = a[5] > 0 ? a[5] : 0;
    table[k] = a[0];
    table[k + 1] = a[2];
    table[k + 2] = a[3];
    table[k + 3] = one > 0 ? one : a[4];
    table[k + 4] = w0;
    table[k + 5] = w1;
    table[k + 6] = w2;
    table[k + 7] = SRGB_BYTE[(c >> 16) & 255];
    table[k + 8] = SRGB_BYTE[(c >> 8) & 255];
    table[k + 9] = SRGB_BYTE[c & 255];
    table[k + 10] = held;
    table[k + 11] = held;
    this.counts.smoke++;
  }

  /**
   * The frame's smoke batch (`frameDt` set by the field): this frame's own sources first, at their rates times the frame's
   * `dt` (the gas clouds' and the burning parts': a danger's smoke is never the one a full batch drops, and the frame's
   * table is no longer than the batch, so whatever the table took is laid), then the one-shots owed laid whole, then each
   * held source at its rate fading over its hold (and aged; one past its hold let go); the frame's table and the one-shots
   * spent. Answers how many splats the batch holds. Whether any frame source was lost since the last batch, to a full
   * table, is kept for the puffs (`frameSmokeLostLast`).
   */
  buildSmokeBatch(): number {
    const w = this.window;
    const dt = this.frameDt > 0 && Number.isFinite(this.frameDt) ? this.frameDt : 0;
    let n = 0;
    this.frameSmokeLostLast = this.frameSmokeLost;
    this.frameSmokeLost = 0;
    if (w && w.placed && this.smokeOn) {
      for (let i = 0; i < this.smokeFrameCount; i++) n = this.putSmoke(this.smokeFrame, i * SMOKE_W, dt, n);
      for (let i = 0; i < this.smokeOneCount; i++) n = this.putSmoke(this.smokeOne, i * SMOKE_W, 1, n);
      let keep = 0;
      for (let i = 0; i < this.smokeHeldCount; i++) {
        const k = i * SMOKE_W;
        const t = this.smokeHeld;
        const left = t[k + 10];
        const hold = t[k + 11] > 1e-6 ? t[k + 11] : 1e-6;
        // Fading over its hold, the demo's (1 - t / hold) [demo `land.html:1776`], at the middle of the frame.
        const f0 = (left - 0.5 * dt) / hold;
        const f = f0 > 0 ? (f0 < 1 ? f0 : 1) : 0;
        n = this.putSmoke(t, k, f * dt, n);
        t[k + 10] = left - dt;
        if (t[k + 10] > 0) {
          if (keep !== i) for (let c = 0; c < SMOKE_W; c++) t[keep * SMOKE_W + c] = t[k + c];
          keep++;
        }
      }
      this.smokeHeldCount = keep;
    }
    this.smokeOneCount = 0;
    this.smokeFrameCount = 0;
    this.smokeBatchCount = n;
    return n;
  }

  /** One smoke source of `table` at `k` into the batch at `n`, its amount times `scale`; answers the next free place. */
  private putSmoke(table: Float64Array, k: number, scale: number, n: number): number {
    const w = this.window!;
    const amount = table[k + 3] * scale;
    if (!(amount > 0)) return n;
    if (n >= SMOKE_BATCH) {
      this.counts.droppedSmoke++;
      return n;
    }
    const r0 = table[k + 2];
    const r = r0 > w.cell ? r0 : w.cell;
    const rr = r / w.size;
    const o = n * 4;
    this.smokeBatch[o] = (table[k] - w.ox) / w.size;
    this.smokeBatch[o + 1] = (table[k + 1] - w.oz) / w.size;
    this.smokeBatch[o + 2] = 1 / (rr * rr);
    this.smokeBatch[o + 3] = amount;
    this.smokeShare[o] = table[k + 4];
    this.smokeShare[o + 1] = table[k + 5];
    this.smokeShare[o + 2] = table[k + 6];
    this.smokeShare[o + 3] = 0;
    this.smokeColour[o] = table[k + 7];
    this.smokeColour[o + 1] = table[k + 8];
    this.smokeColour[o + 2] = table[k + 9];
    this.smokeColour[o + 3] = 0;
    return n + 1;
  }

  /** A blast: the gadget's own radius and push. One-shot: a ring of shoves outward, dust, the grains, and (the third wave) `smoke` seconds of smoke after. */
  blast(x: number, y: number, z: number, radius: number, push: number, smoke: number): void {
    if (!this.active || !this.fromBlasts) return;
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && Number.isFinite(radius) && Number.isFinite(push))) {
      this.counts.notFinite++;
      return;
    }
    const q = this.q;
    q[0] = x;
    q[1] = z;
    q[2] = radius;
    if (!this.nearHere()) {
      this.counts.offWindow++;
      return;
    }
    const B = AIR_TUNE.blast;
    const cell = this.window ? this.window.cell : 1.5;
    const rr = B.ringShare * radius;
    const ring = B.ring > rr ? B.ring : rr;
    const s = B.shove * (push / B.pushRef);
    const so = this.so;
    this.counts.blasts++;
    for (let k = 0; k < B.shoves; k++) {
      const b = (k / B.shoves) * Math.PI * 2;
      const c = Math.cos(b);
      const n = Math.sin(b);
      so[0] = x + c * ring;
      so[1] = z + n * ring;
      so[2] = cell > 1.3 ? cell : 1.3;
      so[3] = 1;
      so[4] = c * s;
      so[5] = n * s;
      so[6] = 7;
      this.shove();
    }
    const scale = radius / B.radiusRef;
    const sd = this.sd;
    const rd = 0.7 * radius;
    sd[0] = x;
    sd[1] = z;
    sd[2] = cell > rd ? cell : rd;
    sd[3] = B.dust * scale;
    // Thrown high: laid half a metre up and rising fast, both by the blast's radius over a thermal detonator's.
    sd[4] = B.liftAt;
    sd[5] = B.liftSigma * scale;
    sd[6] = B.liftRise * scale;
    this.dustOneShot();
    const grains = this.onGrains;
    q[0] = x;
    q[1] = z;
    if (grains && this.dust && this.mediumHere() === MEDIUM_BYTE.land) grains(x, y, z, blastGrains(radius), 8 + 16 * Math.min(2, scale));
    // Its smoke (the third wave): a puff into slab 0 and slab 1 at once, and slab 0 fed as it burns for `smoke` seconds,
    // fading [demo `land.html:1601-1602`, `:1774-1779`], each by the blast's radius over a thermal detonator's.
    if (smoke > 0 && Number.isFinite(smoke) && this.smokeOn) {
      const Sm = AIR_TUNE.smoke;
      const total = (Sm.blast0 + Sm.blast1) * scale;
      if (total > 0 && this.smokeOneCount < SMOKE_ONE_MAX) {
        const k = this.smokeOneCount++ * SMOKE_W;
        const t = this.smokeOne;
        t[k] = x;
        t[k + 1] = z;
        t[k + 2] = 0.5 * radius;
        t[k + 3] = total;
        t[k + 4] = (Sm.blast0 * scale) / total;
        t[k + 5] = (Sm.blast1 * scale) / total;
        t[k + 6] = 0;
        t[k + 7] = Sm.greyR;
        t[k + 8] = Sm.greyG;
        t[k + 9] = Sm.greyB;
        t[k + 10] = 0;
        t[k + 11] = 0;
        this.counts.smoke++;
      } else if (total > 0) this.counts.droppedSmoke++;
      if (Sm.blastFeed > 0 && this.smokeHeldCount < SMOKE_HELD_MAX) {
        const k = this.smokeHeldCount++ * SMOKE_W;
        const t = this.smokeHeld;
        t[k] = x;
        t[k + 1] = z;
        t[k + 2] = 0.4 * radius;
        t[k + 3] = Sm.blastFeed * scale;
        t[k + 4] = 1;
        t[k + 5] = 0;
        t[k + 6] = 0;
        t[k + 7] = Sm.greyR;
        t[k + 8] = Sm.greyG;
        t[k + 9] = Sm.greyB;
        t[k + 10] = smoke;
        t[k + 11] = smoke;
        this.counts.smoke++;
      } else if (Sm.blastFeed > 0) this.counts.droppedSmoke++;
    }
    // A crater, by the blast's own radius: the demo's 3.4 m bowl 1.15 m deep at a thermal detonator's 7 [ours scaling],
    // taken by how far the ground there gives (none in rock) -- and only by a blast near enough the ground to press it:
    // full at the ground, shallower the higher it went off, none past `craterReach` of its radius over the ground under
    // it, nor where that ground is not read yet. A ship destroyed in flight, or a splash on a wall metres up, digs
    // nothing in the sand below.
    const P = AIR_TUNE.prints;
    const across = P.craterAcross * radius;
    const dents = this.dents;
    q[0] = x;
    q[1] = z;
    if (dents && across > 0 && this.groundHere()) {
      const over = y - this.g.h;
      const reach = P.craterReach * radius;
      const near = over <= 0 ? 1 : reach > 0 ? 1 - over / reach : 0;
      if (near > 0) {
        const o = dents.oq;
        o[0] = x;
        o[1] = z;
        o[2] = across;
        o[3] = across;
        o[4] = 1;
        o[5] = 0;
        o[6] = P.craterDepth * radius * near;
        o[7] = DENT_KIND.bowl;
        dents.oneShotArgs();
      }
    }
  }

  /**
   * A mark in the ground (the force API's `dent`, §2.10): its middle, its half extents along and across (metres), the
   * way "along" points (radians from world +x toward +z), its depth (metres, before the ground's give) and its kind
   * (`DENT_KIND`). One-shot: drawn by this frame's step. Answers whether it was laid -- false off the dent square, on
   * ground that gives nothing, with the prints off, or with the field off here.
   */
  dent(x: number, z: number, along: number, across: number, angle: number, depth: number, kind: number): boolean {
    const d = this.dents;
    if (!this.active || !d) return false;
    if (!(Number.isFinite(angle) && Number.isFinite(kind))) {
      this.counts.notFinite++;
      return false;
    }
    return d.oneShot(x, z, along, across, Math.cos(angle), Math.sin(angle), depth, kind > 0.5 ? DENT_KIND.foot : DENT_KIND.bowl);
  }

  /**
   * Every engine of this frame's table into the dents (the second wave): where its jet meets the ground, a scour pit
   * (`prints.scour` metres a second at an impact of 1 m/s, its radius the nozzle's plus the jet's widening to the
   * ground [demo `land.html:1498`]); where a low nozzle's spread bites instead, a rut under it (`prints.rut` a second at
   * a bite of 1, `prints.bowl` across [demo `land.html:1730`]) -- whichever pushes harder, as `expandEngine` chooses.
   * The depth is this frame's (`frameDt`, set by the field), gathered per source and laid on the next tick
   * (`AirDents.gatherArgs`).
   */
  gatherDents(): void {
    const d = this.dents;
    const dt = this.frameDt;
    if (!d || !this.active || !this.fromEngines || !(dt > 0)) return;
    const E = AIR_TUNE.engine;
    const P = AIR_TUNE.prints;
    const cap = AIR_TUNE.solver.cap * E.capShare;
    const e = this.engines;
    const gq = d.gq;
    for (let i = 0; i < this.engineCount; i++) {
      const k = i * ENG_W;
      const x = e[k];
      const y = e[k + 1];
      const z = e[k + 2];
      const dx = e[k + 3];
      const dy = e[k + 4];
      const dz = e[k + 5];
      const exit = e[k + 6];
      this.q[0] = x;
      this.q[1] = z;
      if (!this.groundHere()) continue;
      const h = y - this.g.h;
      // `engineReach`, `engineSpeed`, `nozzleRadius`, `impactSpeed` within its reach, `spreadBite`: as `expandEngine` has them.
      const reach = E.reachBase + E.reachPerSpeed * exit;
      const vEff = exit < cap ? exit : cap;
      const r0 = E.nozzleBase + E.nozzlePerSpeed * exit;
      const groundT = dy < -0.02 ? h / -dy : Infinity;
      const imp = groundT < reach * E.impactReach && dy < 0 ? (vEff / (1 + groundT / (0.3 * reach))) * Math.sqrt(-dy) : 0;
      const vx = e[k + 7];
      const vz = e[k + 8];
      const speed = Math.sqrt(vx * vx + vz * vz);
      let ge = 1 - (h - E.spreadLow) / E.spreadSpan;
      ge = ge > 0 ? (ge < 1 ? ge : 1) : 0;
      const bite = ge * (E.spreadBase + speed / E.spreadSpeed);
      const impPush = imp * E.impactPush;
      const spreadPush = bite * E.spreadPush;
      if (impPush < 0.15 && spreadPush < 0.15) continue;
      gq[0] = this.engineKeys[i];
      if (impPush >= spreadPush) {
        gq[1] = x + dx * groundT;
        gq[2] = z + dz * groundT;
        gq[3] = r0 + groundT * P.scourWiden + P.scourAdd;
        gq[4] = P.scour * imp * dt;
      } else {
        gq[1] = x;
        gq[2] = z;
        gq[3] = P.bowl;
        gq[4] = P.rut * bite * dt;
      }
      gq[5] = DENT_KIND.bowl;
      d.gatherArgs();
    }
  }

  /**
   * The step's velocity batch: the one-shots owed first, then the Force's fronts (their step ages moved on), then every
   * engine of this frame's table by strength over distance, its rates times the step's `dt`. Answers how many splats the
   * batch holds. The one-shots stay owed until `consumeOneShots`, which the field calls after the first step of a frame
   * has drawn them.
   */
  buildStepBatch(dt?: number): number {
    if (dt !== undefined) this.stepDt = dt;
    const w = this.window;
    if (!w || !w.placed) {
      this.splatCount = 0;
      return 0;
    }
    let n = 0;
    const o = this.oneShots;
    const sp = this.sp;
    for (let i = 0; i < this.oneCount; i++) {
      if (n >= SPLAT_BATCH) {
        this.counts.droppedSplats += this.oneCount - i;
        break;
      }
      const k = i * ONE_W;
      for (let c = 0; c < 7; c++) sp[c] = o[k + c];
      n = this.put(n);
    }
    // A short event before the engines: what does not fit is dropped and counted.
    n = this.stepFronts(n);
    // The engines, strongest over distance first.
    const count = this.engineCount;
    const e = this.engines;
    const ord = this.order;
    for (let i = 0; i < count; i++) ord[i] = i;
    for (let i = 1; i < count; i++) {
      const v = ord[i];
      const key = e[v * ENG_W + 9];
      let j = i - 1;
      while (j >= 0 && e[ord[j] * ENG_W + 9] < key) {
        ord[j + 1] = ord[j];
        j--;
      }
      ord[j + 1] = v;
    }
    const full = AIR_TUNE.forces.engineFull;
    for (let r = 0; r < count; r++) {
      const per = r < full ? 8 : 4;
      if (n + per * 2 > SPLAT_BATCH) {
        this.counts.droppedSplats += per * 2;
        continue;
      }
      n = this.expandEngine(ord[r] * ENG_W, per, n);
    }
    this.splatCount = n;
    return n;
  }

  /** The one-shots owed have been drawn by a step: none is owed any more. */
  consumeOneShots(): void {
    this.oneCount = 0;
  }

  /** The splat in `sp` (a world point) into the batch at `n`; answers the next free place. */
  private put(n: number): number {
    const w = this.window!;
    const sp = this.sp;
    const r = sp[2] > w.cell ? sp[2] : w.cell;
    const rr = r / w.size;
    const a = this.splatA;
    const b = this.splatB;
    const k = n * 4;
    a[k] = (sp[0] - w.ox) / w.size;
    a[k + 1] = (sp[1] - w.oz) / w.size;
    a[k + 2] = 1 / (rr * rr);
    a[k + 3] = sp[3];
    b[k] = sp[4];
    b[k + 1] = sp[5];
    b[k + 2] = sp[6];
    b[k + 3] = 0;
    return n + 1;
  }

  /**
   * One engine's splats for a step [demo `land.html:1426-1511`, `:1715-1743`]: the free jet in `per` samples along the
   * exhaust, and where its axis meets the ground the impact or the spread under the nozzle, whichever is stronger, in
   * `per` radial shoves biased the way the jet heads. Rates, times the step's `dt`.
   */
  private expandEngine(k: number, per: number, n: number): number {
    const e = this.engines;
    const E = AIR_TUNE.engine;
    const dt = this.stepDt;
    const sp = this.sp;
    const x = e[k];
    const y = e[k + 1];
    const z = e[k + 2];
    const dx = e[k + 3];
    const dy = e[k + 4];
    const dz = e[k + 5];
    const exit = e[k + 6];
    const vx = e[k + 7];
    const vz = e[k + 8];
    // `engineReach`, `engineSpeed`, `nozzleRadius`.
    const reach = E.reachBase + E.reachPerSpeed * exit;
    const cap = AIR_TUNE.solver.cap * E.capShare;
    const vEff = exit < cap ? exit : cap;
    const r0 = E.nozzleBase + E.nozzlePerSpeed * exit;
    const hz = Math.sqrt(dx * dx + dz * dz);
    this.q[0] = x;
    this.q[1] = z;
    const known = this.groundHere();
    const g0 = this.g.h;
    const h = known ? y - g0 : Infinity;
    const groundT = known && dy < -0.02 ? h / -dy : Infinity;
    // 1. The free jet: momentum along its axis into the air it passes through.
    if (hz > 0.05) {
      for (let i = 1; i <= per; i++) {
        const d = (reach * i) / per;
        if (d > groundT) break;
        // `jetSpeedAt`, `jetRadiusAt`.
        const u = vEff / (1 + d / (0.3 * reach));
        const r = r0 + E.widen * d;
        sp[0] = x + dx * d;
        sp[1] = z + dz * d;
        sp[2] = r;
        sp[3] = known ? y + dy * d - g0 : 1;
        sp[4] = dx * u * E.jetPush * dt;
        sp[5] = dz * u * E.jetPush * dt;
        sp[6] = r + 1.5;
        n = this.put(n);
      }
    }
    // 2. Where it meets the ground: the impact of a jet pointed down, or the spread under a nozzle near the ground.
    if (!known) return n;
    // `impactSpeed` within its reach, `spreadBite`.
    const imp = groundT < reach * E.impactReach && dy < 0 ? (vEff / (1 + groundT / (0.3 * reach))) * Math.sqrt(-dy) : 0;
    const speed = Math.sqrt(vx * vx + vz * vz);
    let ge = 1 - (h - E.spreadLow) / E.spreadSpan;
    ge = ge > 0 ? (ge < 1 ? ge : 1) : 0;
    const bite = ge * (E.spreadBase + speed / E.spreadSpeed);
    const impPush = imp * E.impactPush;
    const spreadPush = bite * E.spreadPush;
    if (impPush < 0.15 && spreadPush < 0.15) return n;
    const atImpact = impPush >= spreadPush;
    const gx = atImpact ? x + dx * groundT : x;
    const gz = atImpact ? z + dz * groundT : z;
    const push = atImpact ? impPush : spreadPush;
    const ri = atImpact ? r0 + groundT * E.widen + 0.8 : 1.5;
    for (let i = 0; i < per; i++) {
      const b = (i / per) * Math.PI * 2;
      const c = Math.cos(b);
      const s = Math.sin(b);
      // A slanted jet throws more air forward than back.
      const bias = hz > 0.05 ? 1 + E.impactBias * ((c * dx + s * dz) / hz) : 1;
      sp[0] = gx + c * E.impactRing;
      sp[1] = gz + s * E.impactRing;
      sp[2] = ri;
      sp[3] = 0.8;
      sp[4] = c * push * bias * dt;
      sp[5] = s * push * bias * dt;
      sp[6] = 2.2;
      n = this.put(n);
    }
    return n;
  }

  /**
   * The frame's dust batch: the one-shot dust owed, then the Force's fronts' bands this frame, then each engine's dust as
   * the frame walk worked it out (at its impact or under its nozzle, a rate times the frame's `dt`: the dust is laid
   * every frame), each splat with the shape it is laid with. The response's dust and the slope's gate are the shader's,
   * per texel. Answers how many it holds; the one-shot dust is spent. `frameSources` runs first, every frame the field
   * runs.
   */
  buildDustBatch(dt?: number): number {
    if (dt !== undefined) this.frameDt = dt;
    this.liftTop = 0;
    const w = this.window;
    if (!w || !w.placed || !this.dust) {
      this.dustCount = 0;
      this.dustBatchCount = 0;
      return 0;
    }
    const fdt = this.frameDt;
    const sd = this.sd;
    const cell = w.cell;
    let n = 0;
    const d = this.dustOne;
    for (let i = 0; i < this.dustCount; i++) {
      if (n >= DUST_BATCH) {
        this.counts.droppedDust += this.dustCount - i;
        break;
      }
      const k = i * DUST_W;
      for (let c = 0; c < DUST_W; c++) sd[c] = d[k + c];
      this.dustFloor = cell;
      n = this.putDust(n);
    }
    this.dustCount = 0;
    n = this.dustFronts(n);
    const ed = this.engineDust;
    for (let i = 0; i < this.engineCount; i++) {
      const o = i * ENG_DUST_W;
      if (ed[o + 7] !== 1) continue;
      if (n >= DUST_BATCH) {
        this.counts.droppedDust++;
        continue;
      }
      sd[0] = ed[o];
      sd[1] = ed[o + 1];
      sd[2] = ed[o + 2];
      sd[3] = ed[o + 3] * fdt;
      sd[4] = ed[o + 4];
      sd[5] = ed[o + 5];
      sd[6] = ed[o + 6];
      // Only where the ground under the splat gives dust: over water, lava, mud or wet sand the dust pass lays nothing,
      // and a splat counted there would hold `hasAir` up with nothing airborne.
      this.q[0] = sd[0];
      this.q[1] = sd[1];
      if (!this.givesDustHere()) continue;
      this.dustFloor = cell;
      n = this.putDust(n);
    }
    this.dustBatchCount = n;
    return n;
  }

  /**
   * The dust splat in `sd` (a world point, its amount and its shape) into the batch at `n`, its radius never under
   * `floor` metres -- the air's cell for the engines', the blasts' and the one-shots' (as the first wave laid them), the
   * dust's own texel for the fronts' bands (or a band could not start small) -- with its shape beside it (each source's
   * own lift, moved toward the storm's at `dust.lift` under one), and the highest it will stand kept for the march's
   * band. The floor is `dustFloor`, set by the caller: a metre count handed across the call was a number made at every
   * splat. Answers the next free place.
   */
  private putDust(n: number): number {
    const w = this.window!;
    const sd = this.sd;
    const floor = this.dustFloor;
    const r = sd[2] > floor ? sd[2] : floor;
    const rr = r / w.size;
    const k = n * 4;
    const out = this.dustBatch;
    out[k] = (sd[0] - w.ox) / w.size;
    out[k + 1] = (sd[1] - w.oz) / w.size;
    out[k + 2] = 1 / (rr * rr);
    out[k + 3] = sd[3];
    const D = AIR_TUNE.dust;
    const lift = D.lift > 0 ? (D.lift < 1 ? D.lift : 1) : 0;
    const restSigma = HALF_NORMAL * D.height;
    const mu0 = sd[4] * lift;
    const sigma0 = sd[5] * lift + restSigma * (1 - lift);
    const w0 = sd[6] * lift;
    const shape = this.dustShapeBatch;
    shape[k] = mu0;
    shape[k + 1] = sigma0;
    shape[k + 2] = w0;
    shape[k + 3] = 0;
    const lp = this.lp;
    lp.mu0 = mu0;
    lp.sigma0 = sigma0;
    lp.w0 = w0;
    liftPeakIn(lp);
    if (lp.top > this.liftTop) this.liftTop = lp.top;
    return n + 1;
  }

  /**
   * Drop the one-shots owed, the one-shot dust and the Force's fronts (the field calls it on a frame that steps nothing:
   * nothing reads the air, or the air does nothing here). A one-shot is kept only until the next step takes it, and when
   * there is no step to come it must not wait for one that may come minutes on, where its blast is long gone; nor fill
   * its queue and count the drops meanwhile. A front is a second long and must not resume minutes later either.
   */
  dropOwed(): void {
    this.oneCount = 0;
    this.dustCount = 0;
    this.frontCount = 0;
    this.smokeOneCount = 0;
    this.smokeHeldCount = 0;
    this.smokeFrameCount = 0;
  }

  /** Drop everything owed (a jump, a new world, the air turned off), the fronts and the smoke with it. */
  clear(): void {
    this.oneCount = 0;
    this.engineCount = 0;
    this.dustCount = 0;
    this.splatCount = 0;
    this.dustBatchCount = 0;
    this.frontCount = 0;
    this.smokeOneCount = 0;
    this.smokeHeldCount = 0;
    this.smokeFrameCount = 0;
    this.smokeBatchCount = 0;
    this.frameSmokeLost = 0;
    this.frameSmokeLostLast = 0;
  }
}

/** sRGB bytes into linear light, made once (the smoke's colour, handed in as `0xRRGGBB`): a table read, so a source handed in every frame makes no number. */
const SRGB_BYTE = ((): Float64Array => {
  const t = new Float64Array(256);
  for (let b = 0; b < 256; b++) {
    const c = b / 255;
    t[b] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

/** A slab's weight for a splat at `height` over the ground with this `reach`: the shader's rule, for the tests. */
export function splatSlabWeight(slabCentre: number, height: number, reach: number): number {
  return slabWeight(slabCentre, height, reach * AIR_TUNE.slabs.reach);
}
