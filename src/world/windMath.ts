// The unified wind's arithmetic (the volumetrics' wave 7a, the design's §2.17): where a gust is, how it travels, how the
// heading wanders, the dust devils, and the one function the programs and the processor both run. Pure: no three, no
// page, so the node tests run exactly what the game runs.
//
// **Where a gust is, is the world's and the shared clock's alone.** The heading (today's shared walk and, under the W7
// arm, a wobble whose size is the world's level profile's), the pattern's travel (a sum over fixed absolute steps of the
// shared clock at the world's level speed, never the observer's area), the lattice's size, stretch and cover (the world's
// level profile, frozen at each phase's start), the phases' restarts (one global cycle) and the devils' births: each a
// pure function of the world's converted table and the shared clock, so two players see the same gust in the same place
// with nothing sent. How strong a gust is (its strength, the veer, the trees' share) follows the observer's area, which
// two players standing together share.
//
// **One function, two copies.** `WIND7_GLSL` is the shader's (`w7Gust(xz)`: the speed factor `k`, the veer and the
// patch), and `gustFlat` its processor's copy, the same single-precision arithmetic written flat in one function so no
// number crosses a call the compiler may not build in (CLAUDE.md's boxing lesson; a mirror of small functions made 187
// collections over two million calls in the research, the flat one none). The card fuses a product added to another into
// one rounding, and the copy does the same (rounding each product apart left it 1e-3 off `k` 8 km out); measured through
// the game's own program on Direct3D 11 and Vulkan the two agree within 6e-6 on `k` (the self test holds 1e-3).
//
// **The hash is the weather's own** (`weatherSchedule.ts`'s chained `mixInt`), ported to GLSL exactly (`Math.imul` is
// `uint` multiplication) and answering `(h >> 8) / 2²⁴`, which is exact in a float: one hash for the lattice and the
// devils.
//
// **Nothing on a frame's path allocates**: every answer goes into a kept record or typed array, the travel is memoised
// by step, the quantile table is read by interpolation into fields at a phase's restart, never by a key, and `windAt`'s
// walk is asked for a phase's heading once a cycle.
import { rand3, ANCHOR_STEPS, BRIDGE_STEPS, LEVEL_RATE, MOVE_CHANCE, STEP_SECONDS } from './weatherSchedule.ts';

const fr = Math.fround;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------- kinds of weather

/** The kinds a profile is kept for: the row's own camera effect, a row with none (or `other`) being `clear`. */
export const WIND_KINDS = ['clear', 'leaves', 'rain', 'dust', 'snow', 'fog', 'smoke', 'lightning'] as const;
export type WindKind = (typeof WIND_KINDS)[number];
export const WIND_KIND_COUNT = WIND_KINDS.length;

/** A row's kind as an index into `WIND_KINDS`: its camera effect's kind, `clear` for none, `other` or one not listed. */
export function windKindIndex(kind: string | null | undefined): number {
  if (!kind) return 0;
  for (let i = 1; i < WIND_KIND_COUNT; i++) if (WIND_KINDS[i] === kind) return i;
  return 0;
}

/** A kind of weather's wind (one row of `WIND_PROFILES`, `wind.ts`). */
export interface WindProfile {
  /** The calm floor, m/s: the mean never falls under it. */
  floor: number;
  /** A multiplier on the game's Wind Speed Scale (1: the game's own). */
  scale: number;
  /** How much stronger a gust is than the mean (its peak is `1 + gust` times it). */
  gust: number;
  /** The share of the ground under a gust at any moment. */
  cover: number;
  /** A gust patch's size across the wind, metres, and its stretch along it. */
  size: number;
  stretch: number;
  /** The most a gust turns the wind, radians. */
  veer: number;
  /** How far the heading wanders either side of the shared walk under the W7 arm, radians. */
  wander: number;
  /** Dust devils born a km² an hour. */
  devils: number;
  /** The share of a tree's sway a gust adds. */
  trees: number;
}

export const PROFILE_KEYS = ['floor', 'scale', 'gust', 'cover', 'size', 'stretch', 'veer', 'wander', 'devils', 'trees'] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];

/** The six numbers a world, and a world's level, multiplies (`WIND_WORLDS`, `wind.ts`). */
export const WORLD_KEYS = ['floor', 'gust', 'cover', 'size', 'wander', 'devils'] as const;
export type WorldKey = (typeof WORLD_KEYS)[number];
export type WorldMult = Record<WorldKey, number>;
export interface WorldEntry extends WorldMult {
  /** One more set a weather level, 0 to 4. */
  byLevel: WorldMult[];
}

/**
 * A profile record of a class of its own, every field a double from its first write: a record made from an object
 * literal took its numbers as boxed values here (measured: every write of the world profile's blend made a number), where
 * a class's fields hold their doubles in place, as `three`'s vectors do.
 */
class ProfileRecord implements WindProfile {
  floor = 0.5;
  scale = 0.5;
  gust = 0.5;
  cover = 0.5;
  size = 0.5;
  stretch = 0.5;
  veer = 0.5;
  wander = 0.5;
  devils = 0.5;
  trees = 0.5;
}

/** A blended profile in a kept record (every number a double from its first write). */
export function newProfile(): WindProfile {
  return new ProfileRecord();
}

/**
 * A profile made from a row's numbers with every field a double from its first write: a literal's whole numbers are
 * small integers, so rows written as literals would hold some fields as integers and some as doubles, and a read over
 * rows of two such shapes hands back a number made at each read (every profile and multiplier record goes through here).
 */
export function profileOf(r: WindProfile): WindProfile {
  const p = newProfile();
  p.floor = r.floor;
  p.scale = r.scale;
  p.gust = r.gust;
  p.cover = r.cover;
  p.size = r.size;
  p.stretch = r.stretch;
  p.veer = r.veer;
  p.wander = r.wander;
  p.devils = r.devils;
  p.trees = r.trees;
  return p;
}

/** A world's multipliers at ones, every field a double from its first write. */
export function oneMult(): WorldMult {
  const m = { floor: 0.5, gust: 0.5, cover: 0.5, size: 0.5, wander: 0.5, devils: 0.5 };
  m.floor = 1;
  m.gust = 1;
  m.cover = 1;
  m.size = 1;
  m.wander = 1;
  m.devils = 1;
  return m;
}

// ---------------------------------------------------------------------------------------------- the hash and the 1-D noise

/** One round of the weather's integer mix (`weatherSchedule.ts`'s `mixInt`, which is not exported). */
function mixInt(h: number, v: number): number {
  h = Math.imul(h ^ (v | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h;
}

/** A float in [0, 1) from three integers, the weather's chain of mixes, `(h >> 8) / 2²⁴`: exact in a float, and `w7Hash`'s answer. */
export function windHash(a: number, b: number, c: number): number {
  const h = mixInt(mixInt(mixInt(0x9e3779b9, a), b), c);
  return (h >>> 8) / 16777216;
}

/**
 * The hash's input and answer, kept: the frame's paths write the three integers into `HQ`, call `hashQ` or `rand3Q` with
 * nothing, and read `HR[0]`, so no number crosses a call whether or not the compiler builds the call in (a number handed
 * to or back from a call it leaves out is boxed: CLAUDE.md's boxing lesson).
 */
const HQ = new Int32Array(3);
const HR = new Float64Array(1);

/** `windHash(HQ[0], HQ[1], HQ[2])` into `HR[0]`: the weather's chained mix written out. */
function hashQ(): void {
  let h = Math.imul(0x9e3779b9 ^ HQ[0], 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h ^ HQ[1], 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h ^ HQ[2], 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  HR[0] = (h >>> 8) / 16777216;
}

/** `rand3(HQ[0], HQ[1], HQ[2])` (the weather's own, `weatherSchedule.ts`) into `HR[0]`, the same mix with all 32 bits. */
function rand3Q(): void {
  let h = Math.imul(0x9e3779b9 ^ HQ[0], 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h ^ HQ[1], 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h ^ HQ[2], 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  HR[0] = (h >>> 0) / 4294967296;
}

/** The weather's 1-D value noise (`weatherSchedule.ts`'s `valueNoise`, ported line for line). */
export function valueNoise1(seed: number, salt: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const t = f * f * (3 - 2 * f);
  const a = rand3(seed, i, salt);
  const b = rand3(seed, i + 1, salt);
  return a + (b - a) * t;
}

/** The shared heading's walk at a period of knots (today's `windAt` at 1,200 s, to the bit). */
export function headingWalk(seed: number, t: number, period: number): number {
  return valueNoise1(seed, 11, t / period) * Math.PI * 4;
}

/** Today's global pulse at a period (`windAt`'s gust at 37 s, to the bit): 0.8 to 1.2. */
export function pulseRaw(seed: number, t: number, period: number): number {
  return 0.8 + 0.4 * valueNoise1(seed, 13, t / period);
}

/** The heading's wobble about the walk under the W7 arm: −1 to 1, knots every `period` seconds (salt 17, ours). */
export function headingWobble(seed: number, t: number, period: number): number {
  return 2 * valueNoise1(seed, 17, t / period) - 1;
}

// ---------------------------------------------------------------------------------------------- the world's table

/**
 * A world's wind by level, worked out once a world from its `sky.json` rows (pure: every browser loads the same table):
 * the median Wind Speed Scale of the world's rows at each level (the upper median), and the share of those rows carrying
 * each kind. A level with no row takes the nearest level below it that has one (else above, else 1 m/s and clear).
 */
export interface WorldWind {
  levels: number;
  speeds: Float64Array;
  /** `levels × WIND_KIND_COUNT`. */
  shares: Float64Array;
}

export interface WindRow {
  weatherIndex: number;
  windSpeedScale: number;
  cameraEffect?: { kind?: string | null } | null;
}

export function worldWindOf(rows: readonly WindRow[], levelsIn: number): WorldWind {
  const levels = Math.max(1, Math.floor(levelsIn));
  const speeds = new Float64Array(levels);
  const shares = new Float64Array(levels * WIND_KIND_COUNT);
  const have = new Uint8Array(levels);
  for (let l = 0; l < levels; l++) {
    const v: number[] = [];
    const counts = new Float64Array(WIND_KIND_COUNT);
    for (const r of rows) {
      if (r.weatherIndex !== l) continue;
      v.push(Number.isFinite(r.windSpeedScale) ? r.windSpeedScale : 1);
      counts[windKindIndex(r.cameraEffect?.kind ?? null)] += 1;
    }
    if (!v.length) continue;
    v.sort((a, b) => a - b);
    speeds[l] = v[Math.floor(v.length / 2)];
    for (let k = 0; k < WIND_KIND_COUNT; k++) shares[l * WIND_KIND_COUNT + k] = counts[k] / v.length;
    have[l] = 1;
  }
  for (let l = 0; l < levels; l++) {
    if (have[l]) continue;
    let from = -1;
    for (let m = l - 1; m >= 0 && from < 0; m--) if (have[m]) from = m;
    for (let m = l + 1; m < levels && from < 0; m++) if (have[m]) from = m;
    if (from < 0) {
      speeds[l] = 1;
      shares[l * WIND_KIND_COUNT] = 1;
      continue;
    }
    speeds[l] = speeds[from];
    for (let k = 0; k < WIND_KIND_COUNT; k++) shares[l * WIND_KIND_COUNT + k] = shares[from * WIND_KIND_COUNT + k];
  }
  return { levels, speeds, shares };
}

// ---------------------------------------------------------------------------------------------- the noise's own table

/** The covers the quantile table is kept at: 65, from 0 to 1. */
export const TABLE_COVERS = 65;
/** The samples a table is made from, and how many a frame while one is remade in play. */
export const TABLE_SAMPLES = 20000;
export const TABLE_SLICE = 2000;

/**
 * The noise's own quantile θ for each of the 65 covers and the mean patch c̄ there, at the default `soft` (0.035) and
 * `octave2` (0.35): our arithmetic on our own noise (`buildWindTable`), committed so nothing is built at load (this module
 * loads with the master off). `windMath.test.ts` holds them equal to a table made afresh.
 */
export const DEFAULT_TABLE_SOFT = 0.035;
export const DEFAULT_TABLE_OCTAVE2 = 0.35;
// prettier-ignore
export const DEFAULT_THETA: readonly number[] = [1.009486248254082, 0.8270364937982734, 0.7879405191348957, 0.7618816713539145, 0.7409910993868039, 0.7237352897861773, 0.7094343960663448, 0.6962284831090071, 0.6844834899345484, 0.6743137692779139, 0.6645503040386194, 0.655079887545608, 0.6462084562773104, 0.6372172071186735, 0.6287293146552353, 0.6205290771667716, 0.6129870663200405, 0.6055851421400765, 0.5982701132927265, 0.5904445638314362, 0.5826563863048879, 0.5755959951789742, 0.5684845104906256, 0.5615501468842113, 0.5547567556972417, 0.5476484708526672, 0.5407422947971433, 0.5340845610149789, 0.5272127506519666, 0.5197967046421408, 0.5128676392557866, 0.5060755841925426, 0.4991588667283614, 0.49209829476639005, 0.4858184237082964, 0.4794476113478525, 0.47266403141979835, 0.46541948513854037, 0.45857590408053983, 0.4518399930320267, 0.44499528077961764, 0.43841492173881047, 0.43132272367497115, 0.4242986829541195, 0.4169468409768704, 0.4099171100873096, 0.4026596935140979, 0.39489395615975215, 0.38662201213432434, 0.3787165315976556, 0.37013598218831845, 0.36120769725446567, 0.35273137139619126, 0.3439972318572013, 0.3347319950862978, 0.32437240845047477, 0.3137023525736153, 0.3023813435560481, 0.28947976347924925, 0.2762072945546862, 0.25988817527742947, 0.23925549641736063, 0.21473842357690232, 0.17283508886602114, 0.005763282712674983];
// prettier-ignore
export const DEFAULT_CBAR: readonly number[] = [0.00007044690405157951, 0.015993316084887122, 0.03192119146504007, 0.047569104371233746, 0.0634502478620464, 0.07940298221025642, 0.09479484937352642, 0.11096707848936826, 0.12694113017998543, 0.1419304503136919, 0.15727483447777113, 0.17292089782048436, 0.18817594511362307, 0.20424309943558883, 0.22002588954587046, 0.2357844840033151, 0.25065110941598395, 0.26557660693038804, 0.28062754893406716, 0.2970125749879225, 0.3135807979580814, 0.32879472759498, 0.3443010238549221, 0.3596285202488105, 0.37481017963329305, 0.3907655827510656, 0.40628746908228025, 0.4212927704313741, 0.4367836100931715, 0.45349686847688825, 0.4691889294406381, 0.4846688597133401, 0.5005114277770192, 0.5167487462267187, 0.5312460310310855, 0.5459761878280891, 0.5616433969682988, 0.5783612955302387, 0.5941345425365487, 0.6095651029516564, 0.6251241679537533, 0.6399916447439047, 0.6559042610483273, 0.6714807848131702, 0.687481151676372, 0.7024446866279782, 0.7175042412304665, 0.7331933482157801, 0.7494389581735103, 0.7645511797361262, 0.7805316022493128, 0.7967494373154745, 0.8117675464295872, 0.8267426493039198, 0.8419975221194607, 0.8582017254524762, 0.8738103776748414, 0.8892196877820426, 0.9053351442105959, 0.9201584136714726, 0.935892374968564, 0.952271307714083, 0.9674080871362974, 0.9838821216653203, 0.9998653299552396];

/** A table: θ and c̄ at the 65 covers, and the dials it was made at. */
export interface WindTable {
  theta: Float64Array;
  cbar: Float64Array;
  soft: number;
  octave2: number;
}

export function defaultWindTable(): WindTable {
  return { theta: Float64Array.from(DEFAULT_THETA), cbar: Float64Array.from(DEFAULT_CBAR), soft: DEFAULT_TABLE_SOFT, octave2: DEFAULT_TABLE_OCTAVE2 };
}

/** Value noise on an integer lattice of period `n` at `q` in [0, n), in double (the table's own reading of the noise). */
function latticeNoise(qx: number, qz: number, n: number, s: number): number {
  let ix = Math.floor(qx);
  let iz = Math.floor(qz);
  const fx = qx - ix;
  const fz = qz - iz;
  if (ix >= n) ix -= n;
  if (iz >= n) iz -= n;
  const ix1 = ix + 1 >= n ? 0 : ix + 1;
  const iz1 = iz + 1 >= n ? 0 : iz + 1;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = windHash(ix, iz, s);
  const b = windHash(ix1, iz, s);
  const c = windHash(ix, iz1, s);
  const d = windHash(ix1, iz1, s);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return ab + (cd - ab) * uz;
}

/**
 * A table being made, in slices (`stepWindTable`): the samples first (`TABLE_SLICE` a call), sorted in one call, then
 * the covers a few a call. Every browser at the same dials makes the same table: the samples are a fixed sequence.
 * Each sample is the blended noise at the two ends of what a frame sees, one phase whole and both halves.
 */
export interface WindTableJob {
  soft: number;
  octave2: number;
  lattice: number;
  values: Float64Array;
  made: number;
  sorted: boolean;
  cover: number;
  rng: number;
  theta: Float64Array;
  cbar: Float64Array;
  done: boolean;
}

export function newWindTableJob(soft: number, octave2: number, lattice = 64): WindTableJob {
  return { soft, octave2, lattice, values: new Float64Array(TABLE_SAMPLES * 2), made: 0, sorted: false, cover: 0, rng: 12345, theta: new Float64Array(TABLE_COVERS), cbar: new Float64Array(TABLE_COVERS), done: false };
}

/** One slice of a table's making; answers whether it is whole. */
export function stepWindTable(job: WindTableJob, slice = TABLE_SLICE): boolean {
  if (job.done) return true;
  const L = job.lattice;
  const o2 = job.octave2;
  if (job.made < TABLE_SAMPLES) {
    const end = Math.min(TABLE_SAMPLES, job.made + slice);
    let s = job.rng;
    for (let i = job.made; i < end; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const qa = (s / 4294967296) * L;
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const qc = (s / 4294967296) * L;
      let whole = 0;
      let halves = 0;
      for (let ph = 0; ph < 2; ph++) {
        const ax = (qa + ph * 17.3) % L;
        const cx = (qc + ph * 31.7) % L;
        const n1 = latticeNoise(ax, cx, L, ph + 1);
        const n2 = latticeNoise((2 * ax) % (2 * L), (2 * cx) % (2 * L), 2 * L, ph + 3);
        const n = (1 - o2) * n1 + o2 * n2 - 0.5;
        if (ph === 0) whole += n;
        halves += Math.SQRT1_2 * n;
      }
      job.values[i * 2] = whole + 0.5;
      job.values[i * 2 + 1] = halves + 0.5;
    }
    job.rng = s;
    job.made = end;
    return false;
  }
  if (!job.sorted) {
    // The two halves of the samples apart: one phase whole in the even slots, both halves in the odd.
    const a = new Float64Array(TABLE_SAMPLES);
    const b = new Float64Array(TABLE_SAMPLES);
    for (let i = 0; i < TABLE_SAMPLES; i++) {
      a[i] = job.values[i * 2];
      b[i] = job.values[i * 2 + 1];
    }
    a.sort();
    b.sort();
    job.values.set(a, 0);
    job.values.set(b, TABLE_SAMPLES);
    job.sorted = true;
    return false;
  }
  const per = Math.max(1, Math.round((slice / TABLE_SAMPLES) * 8));
  const end = Math.min(TABLE_COVERS, job.cover + per);
  const soft = job.soft;
  for (let c = job.cover; c < end; c++) {
    const cover = c / (TABLE_COVERS - 1);
    const at = Math.min(TABLE_SAMPLES - 1, Math.floor((1 - cover) * TABLE_SAMPLES));
    const theta = 0.5 * (job.values[at] + job.values[TABLE_SAMPLES + at]);
    let m = 0;
    for (let i = 0; i < TABLE_SAMPLES * 2; i++) {
      let t = (job.values[i] - (theta - soft)) / (2 * soft);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      m += t * t * (3 - 2 * t);
    }
    job.theta[c] = theta;
    job.cbar[c] = m / (TABLE_SAMPLES * 2);
  }
  job.cover = end;
  if (end >= TABLE_COVERS) job.done = true;
  return job.done;
}

/** A table made whole in one go (the tests', and the committed constants' source). */
export function buildWindTable(soft = DEFAULT_TABLE_SOFT, octave2 = DEFAULT_TABLE_OCTAVE2, lattice = 64): WindTable {
  const job = newWindTableJob(soft, octave2, lattice);
  while (!stepWindTable(job, TABLE_SAMPLES)) {
    /* whole */
  }
  return { theta: job.theta, cbar: job.cbar, soft, octave2 };
}

/** θ and c̄ for a cover, read off a table by linear interpolation into `out` (no key, no string, no map). */
export function tableAt(table: WindTable, cover: number, out: { theta: number; cbar: number }): void {
  const q = { cover, theta: 0.5, cbar: 0.5 };
  tableAtQ(table, q);
  out.theta = q.theta;
  out.cbar = q.cbar;
}

/** `tableAt` with the cover read off the record it answers into (the frame's form: no number crosses the call). */
export function tableAtQ(table: WindTable, out: { cover: number; theta: number; cbar: number }): void {
  const cover = out.cover;
  const c = cover < 0 ? 0 : cover > 1 ? 1 : cover;
  const x = c * (TABLE_COVERS - 1);
  const i = Math.min(TABLE_COVERS - 2, Math.floor(x));
  const f = x - i;
  out.theta = table.theta[i] + (table.theta[i + 1] - table.theta[i]) * f;
  out.cbar = table.cbar[i] + (table.cbar[i + 1] - table.cbar[i]) * f;
}

// ---------------------------------------------------------------------------------------------- the tune windMath reads

/** What the arithmetic reads of `WIND_TUNE` (`wind.ts`), by reference so a dial reaches it at once. */
export interface WindMathTune {
  heading: { wanderPeriod: number; wobblePeriod: number };
  pulse: { share: number; period: number };
  gusts: { cycle: number; step: number; lattice: number; octave2: number; soft: number; travelFloor: number };
  devils: {
    cell: number;
    epoch: number;
    lifeMin: number;
    lifeMax: number;
    coreMin: number;
    coreMax: number;
    swirlMin: number;
    swirlMax: number;
    reach: number;
    byDay: boolean;
    every: number;
  };
}

/** What the observer's area asks of the pattern each frame, a kept record the caller writes. */
export interface WindAsk {
  /** The shared clock's seconds (the weather's walked reading). */
  t: number;
  /** The W7 arm: the master, `volWind`, and the art above nought. */
  on: boolean;
  /** The observer's blended profile (the sky's mix, the world's and its level's multipliers). */
  profile: WindProfile;
  /** The game's blended Wind Speed Scale (the sky's last frame's). */
  rows: number;
  /** `volArtWind`: the gusts', the veer's and the trees' share. */
  art: number;
  /** The hold (`WIND_HOLD`), each null where the weather's own stands. */
  holdSpeed: number | null;
  holdHeading: number | null;
  holdGust: number | null;
}

/** The ask as a class of its own (the frame writes its numbers every frame: a class keeps its doubles in place). */
class AskRecord implements WindAsk {
  t = 0.5;
  on = false;
  profile: WindProfile;
  rows = 0.5;
  art = 0.5;
  holdSpeed: number | null = null;
  holdHeading: number | null = null;
  holdGust: number | null = null;
  constructor(profile: WindProfile) {
    this.profile = profile;
    this.art = 1;
  }
}

export function newWindAsk(profile: WindProfile): WindAsk {
  return new AskRecord(profile);
}

/** A gust at a point, from `gustFlat`. */
export interface GustAt {
  x: number;
  z: number;
  k: number;
  a: number;
  p: number;
}

/** A gust record as a class of its own (written every frame: a class keeps its doubles in place). */
class GustRecord implements GustAt {
  x = 0.5;
  z = 0.5;
  k = 0.5;
  a = 0.5;
  p = 0.5;
}

export function newGustAt(): GustAt {
  return new GustRecord();
}

/** A pair of doubles written on the frame's path (the travel's wind and answer). */
class XZ {
  x = 0.5;
  z = 0.5;
}

/** A cover and the table's answer there. */
class TableQ {
  cover = 0.5;
  theta = 0.5;
  cbar = 0.5;
}

/** The pack's length: seven `vec4`. */
export const PACK_FLOATS = 28;

/** The most devils the list keeps at once, and the numbers a devil. */
export const DEVIL_MAX = 16;
/** [x, z, born, life, core, swirl (signed by its sense), cell i, cell j, epoch, travel memo k, memo x, memo z, age share, envelope]. */
export const DEVIL_W = 14;
/** A listing's candidate: [distance², cell i, cell j, epoch, born, life]. */
const SEL_W = 6;

/** What a devil's day is read from: the day now (the shared day with a server, the visible day without) and its length. */
export interface DevilDay {
  /** The day now, 0 to 1 (0 midnight), on the clock the birth moments are counted on. */
  now: number;
  /** The shared seconds the day was read at. */
  t: number;
  /** Seconds a day. */
  length: number;
}

// ---------------------------------------------------------------------------------------------- the pattern

/**
 * One world's travelling gusts and dust devils: the level and heading functions, the travel with its memo, the two
 * phases frozen at their starts, the pack the programs read, and the devils' list. Made once a world by `wind.ts` (with
 * the master on only); `pack` once a frame.
 *
 * **Every answer on the frame's path goes into a field** (`lv`, `hd`, `nz`, `su`, `to`, `worldProfile`): a number handed
 * back from a call the compiler did not build in is a number made, and the methods here are too big to be built in.
 */
export class WindPattern {
  readonly seed: number;
  readonly weights: readonly number[];
  readonly world: WorldWind;
  readonly profiles: Readonly<Record<WindKind, WindProfile>>;
  readonly tune: WindMathTune;
  /** The world's multipliers and its levels' (by reference: a dial reaches them). */
  readonly worldMult: WorldEntry;
  table: WindTable;
  /** The seven `vec4`, as floats, written in place: the uniform object's own array (`wind.ts` hands it in). */
  readonly packOut: Float32Array;

  /** A level held (forced from the console or the settings, or the Weather setting off at 0), from `since`, ramped from `from`. */
  private forced: number | null = null;
  private forcedSince = 0.5;
  private forcedFrom = 0.5;
  /** The last held level let go of, at `releasedAt`, ramped back to the schedule's from `releasedFrom`. */
  private releasedAt = -Infinity;
  private releasedFrom = 0.5;
  /** The arm, as the heading reads it (the wobble is added only under it). */
  arm = false;
  /** The schedule's levels at two steps (memoised: `levelAtStep` walks up to 24 steps). */
  private levelStep = Number.NaN;
  private levelHere = 0;
  private levelBefore = 0;

  /** The fields the methods answer in: a level, a heading (and the walk alone under it, `hd` less the wobble), a noise. */
  lv = 0.5;
  hd = 0.5;
  hw = 0.5;
  private nz = 0.5;
  /**
   * And the fields they read their numbers from: a fractional number handed to a call the compiler does not build in is
   * boxed, and these methods are too big to be built in, so the frame's paths write a field and call with nothing (the
   * public forms with arguments are the tests' and the console's). `now` the moment of a hold, a forced level or the
   * travel's wind; `hvx`, `hvz` a held vector; `qx`, `qz`, `qr`, `qt` the devils' query.
   */
  private nX = 0.5;
  private hT = 0.5;
  private lT = 0.5;
  private wL = 0.5;
  private bFrom = 0.5;
  private bT = 0.5;
  private pT = 0.5;
  now = 0.5;
  hvx = 0.5;
  hvz = 0.5;
  qx = 0.5;
  qz = 0.5;
  qr = 0.5;
  qt = 0.5;
  /** The seed as an int32, for the devils' salts (a typed array, so it is read untagged), and an epoch's salt base. */
  private readonly seedI = new Int32Array(1);
  private readonly saltBase = new Int32Array(1);
  /** The step `stepWind` works out (a whole number of steps, written where it is known). */
  private kS = 0.5;
  /** The schedule's level at a step: the step asked, the answer, a pick's answer, and the last four kept. */
  private lsStep = 0.5;
  private ls = 0;
  private lp = 0;
  private readonly lsKeys = new Float64Array([Number.NaN, Number.NaN, Number.NaN, Number.NaN]);
  private readonly lsLevels = new Int32Array(4);
  private lsNext = 0;

  /** The travel's memo, a slot each: [from, k, x, z] (the sum from `from` up to step k's start). */
  private readonly memo = new Float64Array(4 * 4);
  /** The step's wind (`stepWind`), and the travel's answer (`between`). */
  readonly su = new XZ();
  readonly to = new XZ();
  /** The world's level profile at a moment (`worldProfileAt`). */
  readonly worldProfile: WindProfile = newProfile();
  private readonly tq = new TableQ();
  /** Each phase frozen at its start: [cycle, sin h, cos h, 1 / (size · stretch), 1 / size, θ, c̄, rA, rC, b2a, b2c, start]. */
  readonly phase = new Float64Array(2 * 12);
  /** The phases' weights this frame. */
  private readonly weight = new Float64Array(2);
  /** The hold's own travel: [phase cycle, base x, base z, base at] a phase slot, and the vector it moves at. */
  private readonly hold = new Float64Array(2 * 4);
  private holdVX = 0.5;
  private holdVZ = 0.5;
  private holding = false;
  /** The held heading while a hold stands (a restart under the hold takes it as its lattice's heading). */
  holdHeading: number | null = null;

  /** The frame's numbers, read by `wind.ts` after `pack`: the shared heading, the travel's speed now, the mean `S`, the strengths. */
  heading = 0.5;
  travelSpeed = 0.5;
  mean = 0.5;
  gustStrength = 0.5;
  veer = 0.5;
  trees = 0.5;
  /** The phases' ages, seconds, and their frozen covers (for the console). */
  readonly ages = new Float64Array(2);
  readonly covers = new Float64Array(2);
  /** The steps of the travel's wind worked out since the console last asked. */
  stepsWorked = 0;

  /** The devils near (`DEVIL_W` numbers each), how many, and the shared second they were last listed at. */
  readonly devils = new Float64Array(DEVIL_MAX * DEVIL_W);
  devilCount = 0;
  private devilsAt = -Infinity;
  /** Birth tests made at the last listing, and how many of them a devil was born at (whatever its day, its life or its reach): the console's and the tests'. */
  devilTests = 0;
  devilBirths = 0;
  /** The devils' rate at the last listing (a km² an hour, the world's at the level in force, times the world's multipliers). */
  devilRate = 0.5;
  /** The rows listed before, set aside while a listing writes the table again. */
  private readonly oldDevils = new Float64Array(DEVIL_MAX * DEVIL_W);
  /** A listing's nearest births: [distance², cell i, cell j, epoch, born, life] a row. */
  private readonly sel = new Float64Array(DEVIL_MAX * SEL_W);
  /** The shared travel's running sums over a listing's steps (`travelSums`): grown only when the tune asks for more. */
  private trav = new Float64Array(4 * 128);

  constructor(seed: number, weights: readonly number[], world: WorldWind, profiles: Readonly<Record<WindKind, WindProfile>>, worldMult: WorldEntry, tune: WindMathTune, packOut: Float32Array, table: WindTable = defaultWindTable()) {
    this.seed = seed;
    this.weights = weights;
    this.world = world;
    this.profiles = profiles;
    this.worldMult = worldMult;
    this.tune = tune;
    this.packOut = packOut;
    this.table = table;
    for (let s = 0; s < 4; s++) this.memo[s * 4] = Number.NaN;
    this.phase[0] = Number.NaN;
    this.phase[12] = Number.NaN;
    this.seedI[0] = seed;
    this.kindRows = WIND_KINDS.map((k) => profiles[k]);
  }

  /**
   * The kinds' profiles in `WIND_KINDS`' order, by reference (a dial moves a row in place): read by index on the frame's
   * path, since a keyed read of the table by a kind's name went through the generic path and made a number a read.
   */
  private readonly kindRows: WindProfile[];

  // ------------------------------------------------------------------- the 1-D noise into a field

  /** The weather's 1-D value noise (`valueNoise1`) at `nX` into `nz`: `rand3` written out through the kept hash record. */
  private noise(salt: number): void {
    const x = this.nX;
    const i = Math.floor(x);
    const f = x - i;
    const t = f * f * (3 - 2 * f);
    HQ[0] = this.seedI[0];
    HQ[1] = i;
    HQ[2] = salt;
    rand3Q();
    const a = HR[0];
    HQ[1] = i + 1;
    rand3Q();
    const b = HR[0];
    this.nz = a + (b - a) * t;
  }

  /** A devil's salt (`devilSalt` with this world's seed, its epoch's base in `saltBase`) into the hash record's third slot. */
  private saltQ(which: number): void {
    HQ[2] = (this.saltBase[0] + which) | 0;
  }

  // ------------------------------------------------------------------- levels

  /** The schedule's continuous level at shared second τ into `lv` (the console's and the tests' form). */
  scheduledLevelIn(tau: number): void {
    this.lT = tau;
    this.scheduledLevel();
  }

  /** The schedule's continuous level at `lT` into `lv`: last step's, ramped toward this step's at the weather's own rate (a closed form, since a step moves one level at most). */
  private scheduledLevel(): void {
    const tau = this.lT;
    const step = Math.floor(tau / STEP_SECONDS);
    if (step !== this.levelStep) {
      this.levelStep = step;
      // The kept steps looked up here, in the hot function itself (a lookup in a function called only now and then runs
      // unoptimised, and every number it works out is made): only a step not kept is worked out.
      const keys = this.lsKeys;
      let here = -1;
      let before = -1;
      for (let i = 0; i < 4; i++) {
        if (keys[i] === step) here = this.lsLevels[i];
        else if (keys[i] === step - 1) before = this.lsLevels[i];
      }
      if (here < 0) {
        this.lsStep = step;
        this.levelAtCached();
        here = this.ls;
      }
      if (before < 0) {
        this.lsStep = step - 1;
        this.levelAtCached();
        before = this.ls;
      }
      this.levelHere = here;
      this.levelBefore = before;
    }
    let f = (tau - step * STEP_SECONDS) * LEVEL_RATE;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    this.lv = this.levelBefore + f * (this.levelHere - this.levelBefore);
  }

  /** The schedule's level at a step of `lsStep`, into `ls`: the last four asked kept (the steps a frame reads lie within two). */
  private levelAtCached(): void {
    const step = this.lsStep;
    const keys = this.lsKeys;
    for (let i = 0; i < 4; i++) {
      if (keys[i] === step) {
        this.ls = this.lsLevels[i];
        return;
      }
    }
    this.levelAtStepQ();
    const at = this.lsNext;
    keys[at] = step;
    this.lsLevels[at] = this.ls;
    this.lsNext = (at + 1) & 3;
  }

  /**
   * The step after the one `t` is in, worked out into the kept four every frame (`pack`): so the walk is hot and
   * optimised (one worked out only when a step turns, every 300 s, ran unoptimised and made its numbers), and the next
   * step's level is kept before it is asked for.
   */
  private levelAhead(): void {
    const step = Math.floor(this.pT / STEP_SECONDS) + 1;
    this.lsStep = step;
    this.levelAtStepQ();
    const keys = this.lsKeys;
    for (let i = 0; i < 4; i++) {
      if (keys[i] === step) {
        this.lsLevels[i] = this.ls;
        return;
      }
    }
    const at = this.lsNext;
    keys[at] = step;
    this.lsLevels[at] = this.ls;
    this.lsNext = (at + 1) & 3;
  }

  /** The schedule's level at a step (the tests' form: held to the weather's own `levelAtStep`). */
  levelAtStepOf(step: number): number {
    this.lsStep = step;
    this.levelAtStepQ();
    return this.ls;
  }

  /**
   * `levelAtStep(seed, weights, lsStep)` (the weather's own, `weatherSchedule.ts`) into `ls`, written out through the kept
   * hash record: the weather's own hands its hash's numbers across calls, which the frame's path may not.
   */
  private levelAtStepQ(): void {
    const step = this.lsStep;
    const W = this.weights;
    const a = Math.floor(step / ANCHOR_STEPS);
    HQ[0] = this.seedI[0];
    HQ[1] = a;
    HQ[2] = 1;
    rand3Q();
    this.pickQ();
    let level = this.lp;
    HQ[1] = a + 1;
    rand3Q();
    this.pickQ();
    const next = this.lp;
    const steps = step - a * ANCHOR_STEPS;
    for (let k = 1; k <= steps; k++) {
      const s = a * ANCHOR_STEPS + k;
      const left = ANCHOR_STEPS - k;
      const dist = next - level;
      if (Math.abs(dist) > left || (k > ANCHOR_STEPS - BRIDGE_STEPS && dist !== 0)) {
        level += Math.sign(dist);
        continue;
      }
      HQ[1] = s;
      HQ[2] = 2;
      rand3Q();
      const r = HR[0];
      if (r >= MOVE_CHANCE) continue;
      const cand = level + (r < MOVE_CHANCE / 2 ? 1 : -1);
      if (cand < 0 || cand >= W.length || Math.abs(next - cand) > left) continue;
      const wOld = W[level];
      const accept = wOld > 0 ? Math.min(1, W[cand] / wOld) : 1;
      HQ[2] = 3;
      rand3Q();
      if (HR[0] < accept) level = cand;
    }
    this.ls = level;
  }

  /** The weather's `pick` of a level from the weights by the number in `HR[0]`, into `lp`. */
  private pickQ(): void {
    const W = this.weights;
    let total = 0;
    for (let i = 0; i < W.length; i++) total += W[i];
    let x = HR[0] * total;
    let out = W.length - 1;
    for (let i = 0; i < W.length; i++) {
      x -= W[i];
      if (x < 0) {
        out = i;
        break;
      }
    }
    this.lp = out;
  }

  /** The level the travel and the world's profile read at τ, into `lv` (the console's and the tests' form). */
  levelAtIn(tau: number): void {
    this.lT = tau;
    this.levelAt();
  }

  /** The level at `lT` into `lv`: the schedule's, or a held one ramped in over the weather's 40 s. */
  private levelAt(): void {
    const tau = this.lT;
    const ramp = 1 / LEVEL_RATE;
    if (this.forced !== null && tau >= this.forcedSince) {
      let f = (tau - this.forcedSince) / ramp;
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      this.lv = this.forcedFrom + f * (this.forced - this.forcedFrom);
      return;
    }
    this.scheduledLevel();
    if (tau >= this.releasedAt && tau < this.releasedAt + ramp) {
      const f = (tau - this.releasedAt) / ramp;
      this.lv = this.releasedFrom + f * (this.lv - this.releasedFrom);
    }
  }

  /** A level held from `now` (the console's or the settings' force, the Weather setting off), or null to follow the schedule. */
  setForced(level: number | null, now: number): void {
    this.now = now;
    this.setForcedNow(level);
  }

  /** `setForced` at the moment in `now` (the frame's form). */
  setForcedNow(level: number | null): void {
    const want = level === null || !Number.isFinite(level) ? null : Math.min(this.world.levels - 1, Math.max(0, Math.round(level)));
    if (want === this.forced) return;
    const now = this.now;
    this.lT = now;
    this.levelAt();
    const from = this.lv;
    if (want === null) {
      this.releasedAt = now;
      this.releasedFrom = from;
    } else {
      this.forcedFrom = from;
      this.forcedSince = now;
    }
    // The travel's past is kept (its memo holds the steps already summed); its next steps take the new level.
    this.forced = want;
  }

  /** The level held now, or null (the console's). */
  get forcedLevel(): number | null {
    return this.forced;
  }

  /**
   * The held level as another pattern of the same world holds it, its moment and its ramps with it (the console's and the
   * dials' fresh patterns: a read-out or a point worked out afresh describes the pattern drawn, a forced level and the
   * Weather setting off included, never the bare schedule's).
   */
  followForcedOf(other: WindPattern): void {
    this.forced = other.forced;
    this.forcedSince = other.forcedSince;
    this.forcedFrom = other.forcedFrom;
    this.releasedAt = other.releasedAt;
    this.releasedFrom = other.releasedFrom;
  }

  /** The world's level profile at continuous level L, into `worldProfile` (the console's and the tests' form). */
  worldProfileAt(L: number): WindProfile {
    this.wL = L;
    this.worldProfileNow();
    return this.worldProfile;
  }

  /**
   * The world's level profile at `wL` (each kind's numbers by its share of the world's rows there, times the world's and
   * its level's multipliers), into `worldProfile`. Every key written out by name: a keyed store of a number into a
   * record goes through the generic path, which made a number a key.
   */
  private worldProfileNow(): void {
    const L = this.wL;
    const w = this.world;
    const lv = L < 0 ? 0 : L > w.levels - 1 ? w.levels - 1 : L;
    const lo = Math.floor(lv);
    const hi = lo + 1 < w.levels ? lo + 1 : lo;
    const f = lv - lo;
    const out = this.worldProfile;
    const P = this.kindRows;
    const M = this.worldMult;
    let floor = 0;
    let scale = 0;
    let gust = 0;
    let cover = 0;
    let size = 0;
    let stretch = 0;
    let veer = 0;
    let wander = 0;
    let devils = 0;
    let trees = 0;
    for (let k = 0; k < WIND_KIND_COUNT; k++) {
      const share = (1 - f) * w.shares[lo * WIND_KIND_COUNT + k] + f * w.shares[hi * WIND_KIND_COUNT + k];
      if (!(share > 0)) continue;
      const p = P[k];
      floor += share * p.floor;
      scale += share * p.scale;
      gust += share * p.gust;
      cover += share * p.cover;
      size += share * p.size;
      stretch += share * p.stretch;
      veer += share * p.veer;
      wander += share * p.wander;
      devils += share * p.devils;
      trees += share * p.trees;
    }
    // The level's multipliers between its two levels as `a + f · (b − a)`, so two equal multipliers are that number exactly
    // (at ones the profile is the kinds' own to the bit, which the test holds by `Object.is`).
    // Written out, never through a helper: a number handed back from a call the compiler leaves out is a number made.
    const a = M.byLevel[lo];
    const b = M.byLevel[hi];
    const aF = a ? a.floor : 1;
    const aG = a ? a.gust : 1;
    const aC = a ? a.cover : 1;
    const aS = a ? a.size : 1;
    const aW = a ? a.wander : 1;
    const aD = a ? a.devils : 1;
    out.floor = floor * (M.floor * (aF + f * ((b ? b.floor : 1) - aF)));
    out.scale = scale;
    out.gust = gust * (M.gust * (aG + f * ((b ? b.gust : 1) - aG)));
    out.cover = cover * (M.cover * (aC + f * ((b ? b.cover : 1) - aC)));
    out.size = size * (M.size * (aS + f * ((b ? b.size : 1) - aS)));
    out.stretch = stretch;
    out.veer = veer;
    out.wander = wander * (M.wander * (aW + f * ((b ? b.wander : 1) - aW)));
    out.devils = devils * (M.devils * (aD + f * ((b ? b.devils : 1) - aD)));
    out.trees = trees;
  }

  // ------------------------------------------------------------------- the heading

  /** The shared heading at τ into `hd` (the console's and the tests' form). */
  headingAtIn(tau: number): void {
    this.hT = tau;
    this.headingAt();
  }

  /** The shared heading at `now` into `hd` (the frame's form). */
  headingNow(): void {
    this.hT = this.now;
    this.headingAt();
  }

  /** The shared heading at `hT` into `hd`: the walk, and under the arm its wobble by the world's level `wander`, ramped as the level is. */
  private headingAt(): void {
    const T = this.tune.heading;
    const tau = this.hT;
    this.nX = tau / T.wanderPeriod;
    this.noise(11);
    const walk = this.nz * Math.PI * 4;
    this.hw = walk;
    if (!this.arm) {
      this.hd = walk;
      return;
    }
    this.lT = tau;
    this.levelAt();
    this.wL = this.lv;
    this.worldProfileNow();
    const A = this.worldProfile.wander;
    if (!(A !== 0)) {
      this.hd = walk;
      return;
    }
    this.nX = tau / T.wobblePeriod;
    this.noise(17);
    this.hd = walk + A * (2 * this.nz - 1);
  }

  // ------------------------------------------------------------------- the travel

  /** The travel's wind at step k's start (the world's level speed, floored, along the shared heading) into `su`. */
  private stepWind(): void {
    const tau = this.kS * this.tune.gusts.step;
    this.hT = tau;
    this.headingAt();
    const h = this.hd;
    this.lT = tau;
    this.levelAt();
    const L = this.lv;
    const w = this.world;
    const lv = L < 0 ? 0 : L > w.levels - 1 ? w.levels - 1 : L;
    const lo = Math.floor(lv);
    const hi = lo + 1 < w.levels ? lo + 1 : lo;
    const f = lv - lo;
    this.wL = L;
    this.worldProfileNow();
    const wp = this.worldProfile;
    // Floored by `Math.max`, never a conditional write: a tune's number written into a local the code then uses makes the
    // local a boxed value and every write a number made (CLAUDE.md's W3 lesson, measured here again).
    const s = Math.max(wp.scale * ((1 - f) * w.speeds[lo] + f * w.speeds[hi]), wp.floor, this.tune.gusts.travelFloor);
    this.su.x = Math.sin(h) * s;
    this.su.z = Math.cos(h) * s;
    this.stepsWorked++;
  }

  /** The travel's wind at shared second τ (the step it falls in), m/s along x and z, into `su` (the tests' form). */
  travelWindIn(tau: number): void {
    this.kS = Math.floor(tau / this.tune.gusts.step);
    this.stepWind();
  }

  /** The travel's wind at `now` into `su` (the frame's form). */
  travelWindNow(): void {
    this.kS = Math.floor(this.now / this.tune.gusts.step);
    this.stepWind();
  }

  /** The pure travel from `from` to `t`, metres, into `to` (the tests' form; slot: which memo). */
  between(slot: number, from: number, t: number): void {
    this.bFrom = from;
    this.bT = t;
    this.betweenNow(slot);
  }

  /**
   * The pure travel from `bFrom` to `bT`, metres, into `to` (slot: which memo). A sum over fixed absolute steps of the
   * shared clock, each step's wind taken at its start, partial at both ends; the memo never changes an answer.
   */
  private betweenNow(slot: number): void {
    const from = this.bFrom;
    const t = this.bT;
    const E = this.tune.gusts.step;
    const m = this.memo;
    const o = slot * 4;
    const k0 = Math.floor(from / E);
    const kt = Math.floor(t / E);
    if (!(m[o] === from) || m[o + 1] > kt || m[o + 1] < k0) {
      m[o] = from;
      m[o + 1] = k0;
      m[o + 2] = 0;
      m[o + 3] = 0;
    }
    while (m[o + 1] < kt) {
      const k = m[o + 1];
      this.kS = k;
      this.stepWind();
      const a = k === k0 ? from : k * E;
      const d = (k + 1) * E - a;
      m[o + 2] += this.su.x * d;
      m[o + 3] += this.su.z * d;
      m[o + 1] = k + 1;
    }
    this.kS = kt;
    this.stepWind();
    const a = kt === k0 ? from : kt * E;
    const d = t - a;
    this.to.x = m[o + 2] + this.su.x * d;
    this.to.z = m[o + 3] + this.su.z * d;
  }

  // ------------------------------------------------------------------- the hold's travel

  /** The hold's vector (m/s along x, z) from `now` (the tests' form). */
  setHoldTravel(vx: number, vz: number, now: number): void {
    this.hvx = vx;
    this.hvz = vz;
    this.now = now;
    this.setHoldTravelNow();
  }

  /** The hold's vector (`hvx`, `hvz`) from `now`: each phase's travel carried on from where it stands. A non-finite one lets go (the shared pattern back at once). */
  setHoldTravelNow(): void {
    const vx = this.hvx;
    const vz = this.hvz;
    const now = this.now;
    if (!Number.isFinite(vx) || !Number.isFinite(vz)) {
      this.holding = false;
      return;
    }
    if (this.holding && vx === this.holdVX && vz === this.holdVZ) return;
    // Every phase rebased where it stands now, under the rule in force until now.
    for (let ph = 0; ph < 2; ph++) {
      const p = ph * 12;
      const cyc = this.phase[p];
      if (!Number.isFinite(cyc)) continue;
      this.pT = now;
      this.phaseTravel(ph);
      const h = ph * 4;
      this.hold[h] = cyc;
      this.hold[h + 1] = this.to.x;
      this.hold[h + 2] = this.to.z;
      this.hold[h + 3] = now;
    }
    this.holdVX = vx;
    this.holdVZ = vz;
    this.holding = true;
  }

  /** Whether the hold's travel stands. */
  get held(): boolean {
    return this.holding;
  }

  /** A phase's travel from its start to `pT` into `to`: the pure travel, or under a hold its base carried on at the held vector. */
  private phaseTravel(ph: number): void {
    const t = this.pT;
    const p = ph * 12;
    const start = this.phase[p + 11];
    if (this.holding) {
      const h = ph * 4;
      if (this.hold[h] !== this.phase[p]) {
        // A phase that restarted under the hold starts from nothing at its own start.
        this.hold[h] = this.phase[p];
        this.hold[h + 1] = 0;
        this.hold[h + 2] = 0;
        this.hold[h + 3] = start;
      }
      const dt = t - this.hold[h + 3];
      this.to.x = this.hold[h + 1] + this.holdVX * dt;
      this.to.z = this.hold[h + 2] + this.holdVZ * dt;
      return;
    }
    this.bFrom = start;
    this.bT = t;
    this.betweenNow(ph);
  }

  // ------------------------------------------------------------------- the phases and the pack

  /**
   * Phase `ph` frozen at the start of cycle `cyc` into `pend` (its heading, its lattice's scales and cover, the world's,
   * its offsets), which `pack` copies into the phase's slot at its restart. Worked out every frame for the cycle in force
   * (a pure function of the cycle and the hold, so the same numbers as at the restart), never only at a restart: a
   * function the frame calls only twice in ninety seconds runs unoptimised, and every number it works out is made.
   */
  private freeze(ph: number, cyc: number): void {
    const T = this.tune.gusts.cycle > 1 ? this.tune.gusts.cycle : 1;
    const start = (cyc - ph * 0.5) * T;
    const hh = this.holdHeading;
    let h = 0.5;
    if (this.holding && hh !== null) h = hh + 0;
    else {
      this.hT = start;
      this.headingAt();
      h = this.hd;
    }
    this.lT = start;
    this.levelAt();
    this.wL = this.lv;
    this.worldProfileNow();
    const wp = this.worldProfile;
    const size = wp.size > 1e-3 ? wp.size : 1e-3;
    const stretch = wp.stretch > 1e-3 ? wp.stretch : 1e-3;
    this.tq.cover = wp.cover;
    tableAtQ(this.table, this.tq);
    const L = this.tune.gusts.lattice;
    const q = this.pend;
    q[0] = cyc;
    q[1] = Math.sin(h);
    q[2] = Math.cos(h);
    q[3] = 1 / (size * stretch);
    q[4] = 1 / size;
    q[5] = this.tq.theta;
    q[6] = this.tq.cbar;
    // The offsets: `windHash(cyc, ph + n, seed | 0)`, through the kept hash record.
    HQ[0] = cyc;
    HQ[2] = this.seedI[0];
    HQ[1] = ph;
    hashQ();
    q[7] = HR[0] * L;
    HQ[1] = ph + 7;
    hashQ();
    q[8] = HR[0] * L;
    HQ[1] = ph + 13;
    hashQ();
    q[9] = HR[0] * 2 * L;
    HQ[1] = ph + 17;
    hashQ();
    q[10] = HR[0] * 2 * L;
    q[11] = start;
    q[12] = wp.cover;
  }

  /** `freeze`'s answer: a phase's twelve numbers and its cover. */
  private readonly pend = new Float64Array(13);
  /** Each phase's slot frozen while a heading was held (1), to be taken again from the shared heading once it is let go. */
  private readonly heldFrozen = new Uint8Array(2);


  /**
   * The frame's pack: the observer's mean, gust strength, veer and trees' share, the shared heading and the travel's
   * speed, and the seven `vec4` into `packOut`:
   *   0 the phases' offsets in lattice units (folded at the lattice): (along₀, across₀, along₁, across₁)
   *   1 their headings: (sin h₀, cos h₀, sin h₁, cos h₁)
   *   2 the weights over their norm, θ and the soft edge: (w₀ / n, w₁ / n, θ, soft)
   *   3 each phase's own lattice scales: (1 / (size₀ · stretch₀), 1 / size₀, 1 / (size₁ · stretch₁), 1 / size₁)
   *   4 the second octave's offsets: (along₀, across₀, along₁, across₁)
   *   5 (gust, c̄, veer, the second octave's share)
   *   6 (the lattice's period, the mean S, the trees' share, on)
   * The second octave's period is twice the first's. θ and c̄ are the two phases' own, blended by their weights.
   */
  pack(ask: WindAsk): void {
    const t = ask.t;
    this.arm = ask.on;
    this.holdHeading = ask.holdHeading;
    const T = this.tune.gusts.cycle > 1 ? this.tune.gusts.cycle : 1;
    const out = this.packOut;
    const L = this.tune.gusts.lattice;
    const headingHeld = this.holding && this.holdHeading !== null;
    for (let ph = 0; ph < 2; ph++) {
      const shifted = t / T + ph * 0.5;
      const cyc = Math.floor(shifted);
      const f = shifted - cyc;
      const p = ph * 12;
      // Worked out every frame (kept hot), taken at the restart; and taken again by a phase frozen under a held heading the
      // moment that heading is let go, since a held heading is this browser's alone and the release gives every player's
      // pattern back (the freeze is a pure function of the cycle and the hold, so it is that phase's shared numbers).
      this.freeze(ph, cyc);
      if (this.phase[p] !== cyc || (this.heldFrozen[ph] === 1 && !headingHeld)) {
        const q = this.pend;
        for (let c = 0; c < 12; c++) this.phase[p + c] = q[c];
        this.covers[ph] = q[12];
        this.heldFrozen[ph] = headingHeld ? 1 : 0;
      }
      this.pT = t;
      this.phaseTravel(ph);
      const sh = this.phase[p + 1];
      const ch = this.phase[p + 2];
      const along = (this.to.x * sh + this.to.z * ch) * this.phase[p + 3] + this.phase[p + 7];
      const across = (this.to.x * ch - this.to.z * sh) * this.phase[p + 4] + this.phase[p + 8];
      out[ph * 2] = along - L * Math.floor(along / L);
      out[ph * 2 + 1] = across - L * Math.floor(across / L);
      out[4 + ph * 2] = sh;
      out[5 + ph * 2] = ch;
      out[12 + ph * 2] = this.phase[p + 3];
      out[13 + ph * 2] = this.phase[p + 4];
      out[16 + ph * 2] = this.phase[p + 9];
      out[17 + ph * 2] = this.phase[p + 10];
      const s = Math.sin(Math.PI * f);
      this.weight[ph] = s * s;
      this.ages[ph] = t - this.phase[p + 11];
    }
    // The next step's level kept ahead of its turn (`pT` is `t`, as the loop above left it).
    this.levelAhead();
    const w0 = this.weight[0];
    const w1 = this.weight[1];
    const sum = w0 + w1 > 1e-9 ? w0 + w1 : 1;
    const norm = Math.sqrt(w0 * w0 + w1 * w1);
    const n = norm > 1e-9 ? norm : 1;
    out[8] = w0 / n;
    out[9] = w1 / n;
    out[10] = (w0 * this.phase[5] + w1 * this.phase[17]) / sum;
    out[11] = this.tune.gusts.soft;
    // The observer's: the mean (its floor over the game's own scale, the pulse, or a held speed), the strengths.
    const P = ask.profile;
    this.nX = t / this.tune.pulse.period;
    this.noise(13);
    const g = 0.8 + 0.4 * this.nz;
    const pulse = 1 + ((g - 1) * this.tune.pulse.share) / 0.4;
    const hg = ask.holdGust;
    const gustOf = hg === null ? 1 : hg;
    const pulseHeld = hg === null ? pulse : 1 + (pulse - 1) * hg;
    // A held speed made a number by arithmetic (`+ 0`), so both ways in are doubles and nothing is boxed where they meet.
    const hs = ask.holdSpeed;
    const S = hs !== null ? hs + 0 : Math.max(P.scale * ask.rows, P.floor) * pulseHeld;
    const art = ask.art > 0 ? ask.art : 0;
    this.mean = S;
    this.gustStrength = P.gust * art * gustOf;
    this.veer = P.veer * art;
    this.trees = P.trees * art;
    out[20] = this.gustStrength;
    out[21] = (w0 * this.phase[6] + w1 * this.phase[18]) / sum;
    out[22] = this.veer;
    out[23] = this.tune.gusts.octave2;
    out[24] = L;
    out[25] = S;
    out[26] = this.trees;
    out[27] = ask.on ? 1 : 0;
    if (ask.holdHeading !== null) this.heading = ask.holdHeading;
    else {
      this.hT = t;
      this.headingAt();
      this.heading = this.hd;
    }
    if (this.holding) this.travelSpeed = Math.sqrt(this.holdVX * this.holdVX + this.holdVZ * this.holdVZ);
    else {
      this.kS = Math.floor(t / this.tune.gusts.step);
      this.stepWind();
      this.travelSpeed = Math.sqrt(this.su.x * this.su.x + this.su.z * this.su.z);
    }
  }

  // ------------------------------------------------------------------- devils

  /**
   * The devils whose path can reach within `radius` of (x, z), listed every `devils.every` seconds into the kept table,
   * the survivors moved every frame by the pure travel from their birth (each with a memo of its own). Every browser lists
   * the same devils at the same moment; only the day each one's birth is gated on is the observer's (the shared day with a
   * server, the visible day without: `day`).
   */
  devilsNear(x: number, z: number, radius: number, t: number, day: DevilDay, list: boolean): void {
    this.qx = x;
    this.qz = z;
    this.qr = radius;
    this.qt = t;
    this.devilsNearNow(day, list);
  }

  /** `devilsNear` at the query in `qx`, `qz`, `qr`, `qt` (the frame's form). */
  devilsNearNow(day: DevilDay, list: boolean): void {
    const t = this.qt;
    const D = this.tune.devils;
    if (list || t - this.devilsAt >= D.every || t < this.devilsAt) this.listDevils(day);
    const E = this.tune.gusts.step;
    const cell = D.cell > 1 ? D.cell : 1;
    const tab = this.devils;
    let w = 0;
    for (let i = 0; i < this.devilCount; i++) {
      const o = i * DEVIL_W;
      const born = tab[o + 2];
      const life = tab[o + 3];
      if (!(t >= born && t < born + life)) continue;
      if (w !== i) for (let c = 0; c < DEVIL_W; c++) tab[w * DEVIL_W + c] = tab[o + c];
      const q = w * DEVIL_W;
      // Its memo carried on to now's step, then the partial step: the pure travel from its birth.
      const kt = Math.floor(t / E);
      const k0 = Math.floor(born / E);
      if (tab[q + 9] > kt || tab[q + 9] < k0) {
        tab[q + 9] = k0;
        tab[q + 10] = 0;
        tab[q + 11] = 0;
      }
      while (tab[q + 9] < kt) {
        const k = tab[q + 9];
        this.kS = k;
        this.stepWind();
        const a = k === k0 ? born : k * E;
        const d = (k + 1) * E - a;
        tab[q + 10] += this.su.x * d;
        tab[q + 11] += this.su.z * d;
        tab[q + 9] = k + 1;
      }
      this.kS = kt;
      this.stepWind();
      const a = kt === k0 ? born : kt * E;
      const d = t - a;
      const ci = tab[q + 6];
      const cj = tab[q + 7];
      const e = tab[q + 8];
      this.saltBase[0] = Math.imul(this.seedI[0] ^ Math.imul(e | 0, 0x9e3779b1), 0x27d4eb2d);
      HQ[0] = ci;
      HQ[1] = cj;
      this.saltQ(3);
      hashQ();
      tab[q] = (ci + HR[0]) * cell + tab[q + 10] + this.su.x * d;
      this.saltQ(4);
      hashQ();
      tab[q + 1] = (cj + HR[0]) * cell + tab[q + 11] + this.su.z * d;
      const age = (t - born) / life;
      tab[q + 12] = age;
      let env = age / 0.15;
      const late = (1 - age) / 0.25;
      if (late < env) env = late;
      tab[q + 13] = env > 1 ? 1 : env < 0 ? 0 : env;
      w++;
    }
    this.devilCount = w;
  }

  /** Every birth in reach of the query now, into the table (a devil already listed keeps its memo). */
  private listDevils(day: DevilDay): void {
    const x = this.qx;
    const z = this.qz;
    const radius = this.qr;
    const t = this.qt;
    const D = this.tune.devils;
    this.devilsAt = t;
    const cell = D.cell > 1 ? D.cell : 1;
    const epoch = D.epoch > 0.1 ? D.epoch : 0.1;
    this.lT = t;
    this.levelAt();
    this.wL = this.lv;
    this.worldProfileNow();
    const wp = this.worldProfile;
    const rate = wp.devils;
    this.devilRate = rate;
    this.devilTests = 0;
    this.devilBirths = 0;
    if (!(rate > 0)) {
      this.devilCount = 0;
      return;
    }
    const pBirth = rate * ((cell * cell) / 1e6) * (epoch / 3600);
    const w = this.world;
    let vmax = Math.max(wp.floor, this.tune.gusts.travelFloor);
    const sc = Math.max(wp.scale, 1);
    for (let l = 0; l < w.levels; l++) vmax = Math.max(vmax, w.speeds[l] * sc);
    const R = radius + D.reach * D.coreMax + vmax * D.lifeMax;
    const i0 = Math.floor((x - R) / cell);
    const i1 = Math.floor((x + R) / cell);
    const j0 = Math.floor((z - R) / cell);
    const j1 = Math.floor((z + R) / cell);
    const e0 = Math.floor((t - D.lifeMax) / epoch);
    const e1 = Math.floor(t / epoch);
    // The shared travel summed once a listing over every step a devil alive now can have drifted through (every devil drifts
    // by the same pure travel from its birth, the world's wind and nowhere's): where each one stands now is its birth place
    // and the difference of two of these sums, which is what it is ranked by.
    const E = this.tune.gusts.step;
    const kLo = Math.floor((e0 * epoch) / E);
    const kt = Math.floor(t / E);
    this.travelSums(kLo, kt);
    const tr = this.trav;
    const nt = (kt - kLo) * 4;
    const nowX = tr[nt] + tr[nt + 2] * (t - kt * E);
    const nowZ = tr[nt + 1] + tr[nt + 3] * (t - kt * E);
    const sel = this.sel;
    let n = 0;
    const dayLen = day.length > 0 ? day.length : 1;
    for (let e = e0; e <= e1; e++) {
      this.saltBase[0] = Math.imul(this.seedI[0] ^ Math.imul(e | 0, 0x9e3779b1), 0x27d4eb2d);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          this.devilTests++;
          HQ[0] = i;
          HQ[1] = j;
          this.saltQ(0);
          hashQ();
          if (HR[0] >= pBirth) continue;
          this.devilBirths++;
          this.saltQ(1);
          hashQ();
          const born = (e + HR[0]) * epoch;
          this.saltQ(2);
          hashQ();
          const life = D.lifeMin + HR[0] * (D.lifeMax - D.lifeMin);
          if (!(t >= born && t < born + life)) continue;
          if (D.byDay) {
            // `devilInDay(day, born)` written out: the client's day from 06:00, its first seventy per cent light.
            let dd = day.now - (day.t - born) / dayLen;
            dd -= Math.floor(dd);
            let rr = dd - 0.25;
            rr -= Math.floor(rr);
            if (!(rr < 0.7)) continue;
          }
          // Where it stands now: its birth place (the hash `devilsNearNow` reads too) and the shared travel since its birth.
          const kb = Math.floor(born / E);
          const nb = (kb - kLo) * 4;
          this.saltQ(3);
          hashQ();
          const cx = (i + HR[0]) * cell + nowX - (tr[nb] + tr[nb + 2] * (born - kb * E));
          this.saltQ(4);
          hashQ();
          const cz = (j + HR[0]) * cell + nowZ - (tr[nb + 1] + tr[nb + 3] * (born - kb * E));
          const dx = cx - x;
          const dz = cz - z;
          const d2 = dx * dx + dz * dz;
          // Only a devil that can still reach the query in the life it has left.
          const left = radius + D.reach * D.coreMax + vmax * (born + life - t);
          if (d2 > left * left) continue;
          // The nearest `DEVIL_MAX` kept, whatever order the cells are walked in: a farther one gives its place to a nearer.
          let slot = n;
          if (n < DEVIL_MAX) n++;
          else {
            let worst = 0;
            for (let s = 1; s < DEVIL_MAX; s++) if (sel[s * SEL_W] > sel[worst * SEL_W]) worst = s;
            if (!(d2 < sel[worst * SEL_W])) continue;
            slot = worst;
          }
          const so = slot * SEL_W;
          sel[so] = d2;
          sel[so + 1] = i;
          sel[so + 2] = j;
          sel[so + 3] = e;
          sel[so + 4] = born;
          sel[so + 5] = life;
        }
      }
    }
    // Nearest first (a few rows, swapped in place; equal distances keep the order they were taken in).
    for (let a = 1; a < n; a++) {
      for (let b = a; b > 0 && sel[b * SEL_W] < sel[(b - 1) * SEL_W]; b--) {
        for (let c = 0; c < SEL_W; c++) {
          const v = sel[b * SEL_W + c];
          sel[b * SEL_W + c] = sel[(b - 1) * SEL_W + c];
          sel[(b - 1) * SEL_W + c] = v;
        }
      }
    }
    // The table: the rows listed before set aside, the chosen written, a devil already listed keeping its memo.
    const before = this.devilCount;
    const tab = this.devils;
    const old = this.oldDevils;
    for (let c = 0; c < before * DEVIL_W; c++) old[c] = tab[c];
    for (let s = 0; s < n; s++) {
      const so = s * SEL_W;
      const i = sel[so + 1];
      const j = sel[so + 2];
      const e = sel[so + 3];
      const o = s * DEVIL_W;
      let found = -1;
      for (let q = 0; q < before; q++) {
        const r = q * DEVIL_W;
        if (old[r + 6] === i && old[r + 7] === j && old[r + 8] === e) {
          found = r;
          break;
        }
      }
      if (found >= 0) {
        for (let c = 0; c < DEVIL_W; c++) tab[o + c] = old[found + c];
        continue;
      }
      this.saltBase[0] = Math.imul(this.seedI[0] ^ Math.imul(e | 0, 0x9e3779b1), 0x27d4eb2d);
      HQ[0] = i;
      HQ[1] = j;
      const born = sel[so + 4];
      tab[o + 2] = born;
      tab[o + 3] = sel[so + 5];
      this.saltQ(5);
      hashQ();
      tab[o + 4] = D.coreMin + HR[0] * (D.coreMax - D.coreMin);
      this.saltQ(6);
      hashQ();
      const sw = D.swirlMin + HR[0] * (D.swirlMax - D.swirlMin);
      this.saltQ(7);
      hashQ();
      tab[o + 5] = HR[0] < 0.5 ? -sw : sw;
      tab[o + 6] = i;
      tab[o + 7] = j;
      tab[o + 8] = e;
      tab[o + 9] = Math.floor(born / E);
      tab[o + 10] = 0;
      tab[o + 11] = 0;
    }
    this.devilCount = n;
  }

  /**
   * The pure travel's running sum at the start of every step from `kLo` to `kt` into `trav` (four numbers a step: the sum
   * to its start along x and z, and the step's wind along x and z). Grown only when the devils' tune asks for more steps
   * than it holds (a console line), never on a steady frame.
   */
  private travelSums(kLo: number, kt: number): void {
    const E = this.tune.gusts.step;
    const steps = kt - kLo + 1;
    if (this.trav.length < steps * 4) this.trav = new Float64Array(steps * 8);
    const tr = this.trav;
    let sx = 0;
    let sz = 0;
    for (let s = 0; s < steps; s++) {
      this.kS = kLo + s;
      this.stepWind();
      const o = s * 4;
      tr[o] = sx;
      tr[o + 1] = sz;
      tr[o + 2] = this.su.x;
      tr[o + 3] = this.su.z;
      sx += this.su.x * E;
      sz += this.su.z * E;
    }
  }

  // ------------------------------------------------------------------- read-outs

  /**
   * Gusts an hour and seconds a gust at (x, z) over the next `seconds` of the pure clock: the pattern evaluated at the
   * point a second at a time (3,600 evaluations), a gust being the patch past a half. Worked out when a dial moves or the
   * console asks, never in a frame, on a pattern of its own (`make`) so this one's memos and phases are untouched.
   */
  static readouts(make: () => WindPattern, ask: WindAsk, x: number, z: number, seconds = 3600, every = 1, hold: { vx: number; vz: number } | null = null): { perHour: number; secondsEach: number; share: number } {
    const p = make();
    const r = newGustAt();
    r.x = x;
    r.z = z;
    const t0 = ask.t;
    // A held speed or heading: the patterns travel at the held vector from now, as the drawn one does under the hold.
    if (hold) {
      p.pack(ask);
      p.setHoldTravel(hold.vx, hold.vz, t0);
    }
    let inside = false;
    let gusts = 0;
    let insideTime = 0;
    const n = Math.max(1, Math.round(seconds / every));
    for (let s = 0; s < n; s++) {
      ask.t = t0 + s * every;
      p.pack(ask);
      gustFlat(r, p.packOut);
      if (r.p > 0.5) {
        insideTime += every;
        if (!inside) gusts++;
        inside = true;
      } else inside = false;
    }
    ask.t = t0;
    return { perHour: (gusts * 3600) / seconds, secondsEach: gusts ? insideTime / gusts : 0, share: insideTime / seconds };
  }
}

/** A devil's hash salt: the world, the epoch and which number of it. */
export function devilSalt(seed: number, epoch: number, which: number): number {
  return (Math.imul((seed | 0) ^ Math.imul(epoch | 0, 0x9e3779b1), 0x27d4eb2d) + which) | 0;
}

/** Whether a birth at shared second `born` is in daylight: the client's day runs 06:00 to 06:00 with its first 70% light. */
export function devilInDay(day: DevilDay, born: number): boolean {
  const len = day.length > 0 ? day.length : 1;
  let d = day.now - (day.t - born) / len;
  d -= Math.floor(d);
  let r = d - 0.25;
  r -= Math.floor(r);
  return r < 0.7;
}

// ---------------------------------------------------------------------------------------------- the processor's copy

/** Scratch for `gustFlat`'s octaves. */
const FLAT = new Float64Array(4);

/**
 * The gust at (r.x, r.z) from a pack (`WIND7_GLSL`'s `w7Gust`), into `r.k` (the speed factor), `r.a` (the veer) and `r.p`
 * (the patch): single precision op for op as the shader runs it, written flat with its corners in a kept array, so it
 * makes nothing.
 */
export function gustFlat(r: GustAt, U: Float32Array): void {
  const x = fr(r.x);
  const z = fr(r.z);
  const N = U[24];
  const N2 = fr(2 * N);
  const o2 = U[23];
  let nb = 0;
  let n2b = 0;
  for (let ph = 0; ph < 2; ph++) {
    const sh = U[4 + ph * 2];
    const ch = U[5 + ph * 2];
    // A product added to another is one rounding on the card (it fuses them, `fma`), so the copy rounds once there too:
    // a float32 product is exact in a double, and rounding each product apart left the copy up to 1e-3 off `k` 8 km out.
    const along = fr(x * sh + fr(z * ch));
    const across = fr(x * ch - fr(z * sh));
    for (let oct = 0; oct < 2; oct++) {
      const n = oct === 0 ? N : N2;
      let qa: number;
      let qc: number;
      if (oct === 0) {
        qa = fr(along * U[12 + ph * 2] - U[ph * 2]);
        qc = fr(across * U[13 + ph * 2] - U[ph * 2 + 1]);
      } else {
        qa = fr(fr(2 * FLAT[0]) + U[16 + ph * 2]);
        qc = fr(fr(2 * FLAT[1]) + U[17 + ph * 2]);
      }
      qa = fr(qa - fr(n * Math.floor(fr(qa / n))));
      qc = fr(qc - fr(n * Math.floor(fr(qc / n))));
      if (oct === 0) {
        FLAT[0] = qa;
        FLAT[1] = qc;
      }
      let ix = Math.floor(qa);
      let iz = Math.floor(qc);
      const fx = fr(qa - ix);
      const fz = fr(qc - iz);
      if (ix < 0) ix += n;
      if (iz < 0) iz += n;
      if (ix >= n) ix -= n;
      if (iz >= n) iz -= n;
      const ix1 = ix + 1 >= n ? 0 : ix + 1;
      const iz1 = iz + 1 >= n ? 0 : iz + 1;
      const ux = fr(fr(fx * fx) * fr(3 - fr(2 * fx)));
      const uz = fr(fr(fz * fz) * fr(3 - fr(2 * fz)));
      HQ[2] = ph + 1 + oct * 2;
      HQ[0] = ix;
      HQ[1] = iz;
      hashQ();
      const a = HR[0];
      HQ[0] = ix1;
      hashQ();
      const b = HR[0];
      HQ[0] = ix;
      HQ[1] = iz1;
      hashQ();
      const c = HR[0];
      HQ[0] = ix1;
      hashQ();
      const d = HR[0];
      const ab = fr(a + fr(fr(b - a) * ux));
      const cd = fr(c + fr(fr(d - c) * ux));
      FLAT[2 + oct] = fr(ab + fr(fr(cd - ab) * uz));
    }
    const nv = fr(fr(fr(1 - o2) * FLAT[2]) + fr(o2 * FLAT[3]));
    const w = U[8 + ph];
    nb = fr(nb + fr(w * fr(nv - 0.5)));
    n2b = fr(n2b + fr(w * fr(FLAT[3] - 0.5)));
  }
  nb = fr(nb + 0.5);
  const th = U[10];
  const soft = U[11];
  let tt = fr(fr(nb - fr(th - soft)) / fr(2 * soft));
  tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
  const p = fr(fr(tt * tt) * fr(3 - fr(2 * tt)));
  let k = fr(1 + fr(U[20] * fr(fr(p - U[21]) / fr(1 - U[21]))));
  if (k < 0) k = 0;
  r.k = k;
  r.a = fr(U[22] * fr(2 * n2b));
  r.p = p;
}

// ---------------------------------------------------------------------------------------------- the GLSL

/**
 * The shader's half: `w7Gust(xz)` answers (k, the veer, the patch) from `uWind7[7]`, the pack above. Integer hash (the
 * weather's own mix), so the processor's copy is exact there. No size is written in: the lattice's period is the pack's.
 */
export const WIND7_GLSL = /* glsl */ `
uniform vec4 uWind7[7];
uint w7Mix(uint h, uint v) {
  h = (h ^ v) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = h * 0xc2b2ae35u;
  return h ^ (h >> 16u);
}
float w7Hash(uint a, uint b, uint c) {
  uint h = w7Mix(w7Mix(w7Mix(0x9e3779b9u, a), b), c);
  return float(h >> 8u) * (1.0 / 16777216.0);
}
// The rest is written by its components (no vector arithmetic), so the tests run this very text as script (glslRun.ts),
// the hash above read by its shape.
float w7Noise(float qx, float qz, float n, uint s) {
  float ix0 = floor(qx);
  float iz0 = floor(qz);
  float fx = qx - ix0;
  float fz = qz - iz0;
  // A wrap rounded either way (a quotient one step off puts q a hair under nought or onto n): the cell wrapped back.
  int ni = int(n);
  int jx = int(ix0);
  int jz = int(iz0);
  if (jx < 0) jx += ni;
  if (jz < 0) jz += ni;
  if (jx >= ni) jx -= ni;
  if (jz >= ni) jz -= ni;
  uint nn = uint(ni);
  uint ix = uint(jx);
  uint iz = uint(jz);
  uint ix1 = ix + 1u >= nn ? 0u : ix + 1u;
  uint iz1 = iz + 1u >= nn ? 0u : iz + 1u;
  float ux = (fx * fx) * (3.0 - 2.0 * fx);
  float uz = (fz * fz) * (3.0 - 2.0 * fz);
  float a = w7Hash(ix, iz, s);
  float b = w7Hash(ix1, iz, s);
  float c = w7Hash(ix, iz1, s);
  float d = w7Hash(ix1, iz1, s);
  float ab = a + (b - a) * ux;
  float cd = c + (d - c) * ux;
  return ab + (cd - ab) * uz;
}
// The unified wind's gust at a world point (x, z): x the speed factor k (the mean wind times it), y the veer (radians),
// z the patch (0 between gusts, 1 inside one). windMath.ts's gustFlat is its mirror.
vec3 w7Gust(vec2 xz) {
  float N = uWind7[6].x;
  float N2 = 2.0 * N;
  float o2 = uWind7[5].w;
  float nb = 0.0;
  float n2b = 0.0;
  for (int ph = 0; ph < 2; ph++) {
    float sh = ph == 0 ? uWind7[1].x : uWind7[1].z;
    float ch = ph == 0 ? uWind7[1].y : uWind7[1].w;
    float oa = ph == 0 ? uWind7[0].x : uWind7[0].z;
    float oc = ph == 0 ? uWind7[0].y : uWind7[0].w;
    float la = ph == 0 ? uWind7[3].x : uWind7[3].z;
    float lc = ph == 0 ? uWind7[3].y : uWind7[3].w;
    float ooa = ph == 0 ? uWind7[4].x : uWind7[4].z;
    float ooc = ph == 0 ? uWind7[4].y : uWind7[4].w;
    float along = xz.x * sh + xz.y * ch;
    float across = xz.x * ch - xz.y * sh;
    float qa = mod(along * la - oa, N);
    float qc = mod(across * lc - oc, N);
    float n1 = w7Noise(qa, qc, N, uint(ph + 1));
    float n2 = w7Noise(mod(2.0 * qa + ooa, N2), mod(2.0 * qc + ooc, N2), N2, uint(ph + 3));
    float n = (1.0 - o2) * n1 + o2 * n2;
    float w = ph == 0 ? uWind7[2].x : uWind7[2].y;
    nb += w * (n - 0.5);
    n2b += w * (n2 - 0.5);
  }
  nb += 0.5;
  float th = uWind7[2].z;
  float soft = uWind7[2].w;
  float t = clamp((nb - (th - soft)) / (2.0 * soft), 0.0, 1.0);
  float p = t * t * (3.0 - 2.0 * t);
  float k = max(0.0, 1.0 + uWind7[5].x * ((p - uWind7[5].y) / (1.0 - uWind7[5].y)));
  return vec3(k, uWind7[5].z * (2.0 * n2b), p);
}
// The unified wind is on (the W7 arm): the readers' uniform branch.
bool w7On() { return uWind7[6].w > 0.5; }
// A wind vector (x, z) as the unified wind at a world point: turned by the gust's veer there and times its k.
vec2 w7Target(vec2 xz, vec2 wind) {
  vec3 g = w7Gust(xz);
  float c = cos(g.y);
  float s = sin(g.y);
  return vec2((wind.x * c + wind.y * s) * g.x, (wind.y * c - wind.x * s) * g.x);
}
// The mean wind S, m/s.
float w7Mean() { return uWind7[6].y; }
`;

/** A heading (radians, 0 = +Z turning toward +X) turned by a veer: (sin, cos) of their sum into `out`. */
export function veered(h: number, a: number, out: { x: number; z: number }): void {
  out.x = Math.sin(h + a);
  out.z = Math.cos(h + a);
}

export { TAU };
