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
// Pure: no three, nothing of the page; the node tests drive the very class the game does.
import { AIR_TUNE } from './airTune.ts';
import { blastGrains, DENT_KIND, slabWeight } from './airMath.ts';
import type { FluidWindow } from './fluidWindow.ts';
import { MEDIUM_BYTE, type AirRaster } from './airRaster.ts';
import type { AirDents } from './airDents.ts';

/** One-shot velocity shoves a step can be owed: [x, z, radius, height over the ground, dvx, dvz, reach]. */
const ONE_MAX = 256;
const ONE_W = 7;
/** Engines a frame: [x, y, z, dx, dy, dz, exit, vx, vz, key]. */
export const ENGINE_MAX = 64;
const ENG_W = 10;
/** One-shot dust a frame can be owed: [x, z, radius, amount]. */
const DUST_MAX = 64;
const DUST_W = 4;
/** The splat batches' sizes: the shaders' loop bounds, compiled into the programs. */
export const SPLAT_BATCH = 128;
export const DUST_BATCH = 32;

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
}

const freshCounts = (): ForceCounts => ({ engines: 0, oneShots: 0, dust: 0, droppedSplats: 0, droppedDust: 0, offWindow: 0, notFinite: 0, blasts: 0, forces: 0 });

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
  /** The frame's dust batch: (u, v, 1 / r², amount). */
  readonly dustBatch = new Float32Array(DUST_BATCH * 4);
  dustBatchCount = 0;

  /** An engine handed over: x, y, z, the exhaust's way dx, dy, dz, its exit m/s, the hull's vx, vz, and its source key (`engineArgs`). */
  readonly arg = new Float64Array(10);
  /** The step's `dt` for `buildStepBatch` and the frame's for `buildDustBatch`, set by the field before each. */
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
  /** A dust splat for `putDust`: x, z, radius, amount. */
  private readonly sd = new Float64Array(4);

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
   * the direction is nought (the repulse). One-shot: twelve shoves through the cone (dot ≥ 0.35), or sixteen in a ring.
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
    const F = AIR_TUNE.force;
    const cell = this.window ? this.window.cell : 1.5;
    const col = F.column;
    const len = Math.sqrt(dx * dx + dz * dz);
    const so = this.so;
    const sd = this.sd;
    this.counts.forces++;
    if (len < 1e-6) {
      // The repulse: a ring of sixteen shoves outward, at a third and two thirds of its reach.
      const s = F.repulse * power;
      const r = reach * 0.25;
      for (let k = 0; k < 16; k++) {
        const b = (k / 16) * Math.PI * 2;
        const c = Math.cos(b);
        const n = Math.sin(b);
        const at = reach * (k & 1 ? 0.66 : 0.33);
        const fall = 1 - at / (reach * 1.2);
        so[0] = x + c * at;
        so[1] = z + n * at;
        so[2] = cell > r ? cell : r;
        so[3] = col * 0.5;
        so[4] = c * s * fall;
        so[5] = n * s * fall;
        so[6] = col;
        this.shove();
      }
      const rd = reach * 0.5;
      sd[0] = x;
      sd[1] = z;
      sd[2] = cell > rd ? cell : rd;
      sd[3] = F.dustShare * AIR_TUNE.blast.dust * (reach / AIR_TUNE.blast.radiusRef);
      this.dustOneShot();
      return;
    }
    const fx = dx / len;
    const fz = dz / len;
    const s = (sign > 0 ? F.push : F.pull) * power;
    const r = reach * 0.18;
    // Twelve shoves through the cone: four bearings across it (the cone is dot ≥ 0.35, about ±69°, kept to ±50° here
    // so the edge shoves still point ahead) at a quarter, a half and three quarters of the reach.
    for (let k = 0; k < 12; k++) {
      const a = (-0.5 + (k % 4) / 3) * 1.75;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const bx = fx * ca - fz * sa;
      const bz = fx * sa + fz * ca;
      const at = reach * (0.25 + 0.25 * Math.floor(k / 4));
      const fall = 1 - at / (reach * 1.1);
      const v = sign > 0 ? s * fall : -s * fall;
      so[0] = x + bx * at;
      so[1] = z + bz * at;
      so[2] = cell > r ? cell : r;
      so[3] = col * 0.5;
      so[4] = bx * v;
      so[5] = bz * v;
      so[6] = col;
      this.shove();
    }
    const rd = reach * 0.4;
    sd[0] = x + fx * rd;
    sd[1] = z + fz * rd;
    sd[2] = cell > rd ? cell : rd;
    sd[3] = F.dustShare * AIR_TUNE.blast.dust * (reach / AIR_TUNE.blast.radiusRef);
    this.dustOneShot();
  }

  /** A blast: the gadget's own radius and push. One-shot: a ring of shoves outward, dust, the grains. `smoke` is the third wave's. */
  blast(x: number, y: number, z: number, radius: number, push: number, _smoke: number): void {
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
    this.dustOneShot();
    const grains = this.onGrains;
    q[0] = x;
    q[1] = z;
    if (grains && this.dust && this.mediumHere() === MEDIUM_BYTE.land) grains(x, y, z, blastGrains(radius), 8 + 16 * Math.min(2, scale));
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
   * The step's velocity batch: the one-shots owed first, then every engine of this frame's table by strength over
   * distance, its rates times the step's `dt`. Answers how many splats the batch holds. The one-shots stay owed until
   * `consumeOneShots`, which the field calls after the first step of a frame has drawn them.
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
   * The frame's dust batch: the one-shot dust owed, then each engine's dust at its impact or under its nozzle, a rate
   * times the frame's `dt` (the dust is laid every frame). The response's dust and the slope's gate are the shader's,
   * per texel. Answers how many it holds; the one-shot dust is spent.
   */
  buildDustBatch(dt?: number): number {
    if (dt !== undefined) this.frameDt = dt;
    const w = this.window;
    if (!w || !w.placed || !this.dust) {
      this.dustCount = 0;
      this.dustBatchCount = 0;
      return 0;
    }
    const fdt = this.frameDt;
    const sd = this.sd;
    let n = 0;
    const d = this.dustOne;
    for (let i = 0; i < this.dustCount; i++) {
      if (n >= DUST_BATCH) {
        this.counts.droppedDust += this.dustCount - i;
        break;
      }
      const k = i * DUST_W;
      for (let c = 0; c < 4; c++) sd[c] = d[k + c];
      n = this.putDust(n);
    }
    this.dustCount = 0;
    const E = AIR_TUNE.engine;
    const cap = AIR_TUNE.solver.cap * E.capShare;
    const e = this.engines;
    for (let i = 0; i < this.engineCount; i++) {
      if (n >= DUST_BATCH) {
        this.counts.droppedDust++;
        continue;
      }
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
        // `nozzleRadius` and the jet's widening to the ground.
        const r = E.nozzleBase + E.nozzlePerSpeed * exit + groundT * E.widen + 0.8;
        sd[0] = x + dx * groundT;
        sd[1] = z + dz * groundT;
        sd[2] = r * 1.2;
        sd[3] = fromImpact * fdt;
      } else {
        // Behind the machine, as the demo's speeder throws it.
        const bx = speed > 0.1 ? -vx / speed : 0;
        const bz = speed > 0.1 ? -vz / speed : 0;
        sd[0] = x + bx * 2;
        sd[1] = z + bz * 2;
        sd[2] = 2.2;
        sd[3] = fromSpread * fdt;
      }
      // Only where the ground under the splat gives dust: over water, lava, mud or wet sand the dust pass lays nothing,
      // and a splat counted there would hold `hasAir` up with nothing airborne.
      this.q[0] = sd[0];
      this.q[1] = sd[1];
      if (!this.givesDustHere()) continue;
      n = this.putDust(n);
    }
    this.dustBatchCount = n;
    return n;
  }

  /** The dust splat in `sd` (a world point) into the batch at `n`; answers the next free place. */
  private putDust(n: number): number {
    const w = this.window!;
    const sd = this.sd;
    const r = sd[2] > w.cell ? sd[2] : w.cell;
    const rr = r / w.size;
    const k = n * 4;
    const out = this.dustBatch;
    out[k] = (sd[0] - w.ox) / w.size;
    out[k + 1] = (sd[1] - w.oz) / w.size;
    out[k + 2] = 1 / (rr * rr);
    out[k + 3] = sd[3];
    return n + 1;
  }

  /**
   * Drop the one-shots owed and the one-shot dust (the field calls it on a frame that steps nothing: nothing reads the
   * air, or the air does nothing here). A one-shot is kept only until the next step takes it, and when there is no step
   * to come it must not wait for one that may come minutes on, where its blast is long gone; nor fill its queue and
   * count the drops meanwhile.
   */
  dropOwed(): void {
    this.oneCount = 0;
    this.dustCount = 0;
  }

  /** Drop everything owed (a jump, a new world, the air turned off). */
  clear(): void {
    this.oneCount = 0;
    this.engineCount = 0;
    this.dustCount = 0;
    this.splatCount = 0;
    this.dustBatchCount = 0;
  }
}

/** A slab's weight for a splat at `height` over the ground with this `reach`: the shader's rule, for the tests. */
export function splatSlabWeight(slabCentre: number, height: number, reach: number): number {
  return slabWeight(slabCentre, height, reach * AIR_TUNE.slabs.reach);
}
