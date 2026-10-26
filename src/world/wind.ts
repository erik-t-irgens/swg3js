// The unified wind (the volumetrics' wave 7a, the design's §2.17): one wind every reader takes, updated by the weather.
// This module holds what the weather's one step reads besides its own lines: the hold the owner asked to use now
// (`WIND_HOLD`, which works with the master off), the wind's own tune tables (`WIND_TUNE`, `WIND_PROFILES`,
// `WIND_WORLDS`, live through `__debug.wind({ tune })` and the debug menu's dials), the arm's state (`WIND_STATE`,
// written from the settings when one moves, never read from them on a frame), the one uniform object every reader's
// program holds by reference (`WIND7_UNIFORMS`, made the first time anything of W7 asks for it and never with the master
// off), and the W7 step itself.
//
// **Loaded with the master off, it constructs nothing of W7 then**: the hold's record and the tables are plain objects,
// the world's pattern is made at the arm's first step, the uniform at the first ask. With the hold empty the weather's
// step is today's lines to the bit (`x ?? y` with `x` null is `y` itself).
//
// **Nothing about the wind is gameplay** (the design's rule 3): it pushes no player, body, machine, bolt or rope.
import {
  DEVIL_W,
  PACK_FLOATS,
  WIND_KINDS,
  WIND_KIND_COUNT,
  WORLD_KEYS,
  WindPattern,
  buildWindTable,
  defaultWindTable,
  gustFlat,
  newGustAt,
  newProfile,
  newWindAsk,
  newWindTableJob,
  oneMult,
  profileOf,
  stepWindTable,
  windKindIndex,
  worldWindOf,
  type DevilDay,
  type WindKind,
  type WindMathTune,
  type WindProfile,
  type WindRow,
  type WindTable,
  type WindTableJob,
  type WorldEntry,
  type WorldMult,
  type WorldWind,
} from './windMath.ts';

// ---------------------------------------------------------------------------------------------- the hold

/**
 * The hold (the owner's "a wind slider or changer I can use right now"): a speed in metres a second, a heading in radians
 * (0 = +Z turning toward +X) and a gust share (0 steady, 1 as the weather says, 2 twice), each null where the weather's
 * own stands. Read in the weather's one step whether or not the master is on, so it moves every reader at once: the
 * water's wind, the flora's sway, the rain sheets' lean and the sky's sheets' drift (`sky.sheetWind`). This browser's
 * alone; nothing of it is sent.
 */
export const WIND_HOLD: { speed: number | null; heading: number | null; gust: number | null } = { speed: null, heading: null, gust: null };

/** Hold any of the three (a field left out keeps what it holds; null lets that one go). Answers words for anything refused. */
export function holdWind(o: { speed?: number | null; heading?: number | null; gust?: number | null }): string[] {
  const words: string[] = [];
  if (o.speed !== undefined) {
    if (o.speed === null) WIND_HOLD.speed = null;
    else if (Number.isFinite(o.speed) && o.speed >= 0) WIND_HOLD.speed = o.speed;
    else words.push(`speed ${String(o.speed)} is not a speed (metres a second, nought or more)`);
  }
  if (o.heading !== undefined) {
    if (o.heading === null) WIND_HOLD.heading = null;
    else if (Number.isFinite(o.heading)) WIND_HOLD.heading = o.heading;
    else words.push(`heading ${String(o.heading)} is not a heading`);
  }
  if (o.gust !== undefined) {
    if (o.gust === null) WIND_HOLD.gust = null;
    else if (Number.isFinite(o.gust) && o.gust >= 0) WIND_HOLD.gust = o.gust;
    else words.push(`gust ${String(o.gust)} is not a share (nought or more)`);
  }
  return words;
}

/** Let go of all three: the weather's own wind back to every reader (under the W7 arm the shared pattern snaps back). */
export function releaseWind(): void {
  WIND_HOLD.speed = null;
  WIND_HOLD.heading = null;
  WIND_HOLD.gust = null;
}

/** Whether anything is held. */
export function windHeld(): boolean {
  return WIND_HOLD.speed !== null || WIND_HOLD.heading !== null || WIND_HOLD.gust !== null;
}

/** Today's pulse under the hold's gust share: the pulse itself while it is null, `1 + (g − 1) · gust` otherwise. */
export function gustOf(g: number): number {
  const h = WIND_HOLD.gust;
  return h === null ? g : 1 + (g - 1) * h;
}

// ---------------------------------------------------------------------------------------------- the tune

/**
 * The wind's own numbers (the design's §2.13), every one [ours] unless said, each a dial with its reason. Live through
 * `__debug.wind({ tune })`; the feel ones are sliders in the debug menu (`windDials.ts`). Every group well under 128 keys.
 */
export const WIND_TUNE = {
  heading: {
    /** Today's knot period of the shared walk [code: `weatherSchedule.ts`'s 1,200 s]: one world-wide number; longer turns the wind more slowly and still covers every direction. */
    wanderPeriod: 1200,
    /** The wobble's knots: between the gusts' 90 s cycle and the walk's 1,200 s, so a fair day's wind shifts every few minutes. Its size is each kind's `wander`. */
    wobblePeriod: 180,
  },
  aloft: {
    /** The low cloud deck's wind as a share of the ground's (W7b's). */
    low: 1.5,
    /** The bottom sheet's (1,500 m) and the top sheet's (2,300 m) wind as a share of the ground's: winds aloft a few times the surface's. */
    bottom: 2.5,
    top: 3.5,
    /** How far the top sheet's wind turns from the ground's, degrees: winds aloft turn with height, so the sky shears. */
    veerTop: 25,
    /** The least the sheets drift under the arm, m/s: winds aloft rarely fall under a few metres a second, so a calm day's sky still moves. Never under a hold. */
    floor: 4,
  },
  grass: {
    /** The demo's sheen [demo `land.html:1254`]: a leaning stalk's colour lifted toward its paler tone by `lean · level · this`. */
    sheen: 0.45,
    /** The paler tone: the tuft's own colour this far to its grey, and lifted by this (the game's tufts are green, not the demo's straw). */
    sheenGrey: 0.5,
    sheenLift: 1.3,
    /**
     * A far card's share of the grass's lean outside the air's window [ours]: a far card can stand for a whole tree in the
     * distance, and the wheat's lean at a tree's height would lay it over, so it leans this much of what a tuft would.
     */
    farLean: 0.15,
  },
  pulse: {
    /** Today's 0.8 to 1.2 over 37 s [code: `windAt`]: the pulse is `1 + (g − 1) · share / 0.4` of today's g. */
    share: 0.4,
    period: 37,
  },
  gusts: {
    /** A pattern lives a minute and a half before the other phase replaces it; one global number, or the restarts would not be shared. */
    cycle: 90,
    /** The travel's absolute step, seconds [ours, technical]. */
    step: 2,
    /** Lattice cells a period [ours, technical]. */
    lattice: 64,
    /** The second octave's share (the quantile table is made again in slices when it moves). */
    octave2: 0.35,
    /** A patch's edge, in noise units (the table again when it moves). */
    soft: 0.035,
    /** The patches never stall, m/s. */
    travelFloor: 1,
  },
  shed: {
    /** A gust patch sheds dust where the ground gives it, a second: a long gust settles toward a veil of 0.24, never a storm. */
    rate: 0.08,
    /** Laid low and rising a little, as a jet's spread lays its dust: its height, spread (m) and rise (m/s). */
    at: 0.2,
    sigma: 0.3,
    rise: 0.8,
  },
  devils: {
    /** A devil a cell an epoch at most: 256 m and 20 s [ours, technical]. */
    cell: 256,
    epoch: 20,
    /** How long one lives, seconds. */
    lifeMin: 30,
    lifeMax: 90,
    /** Its core's radius, m. */
    coreMin: 1.5,
    coreMax: 4,
    /** How fast it swirls at its core, m/s: past the sand's threshold, so sand blows in the core. */
    swirlMin: 6,
    swirlMax: 14,
    /** How far out it stirs, in cores. */
    reach: 4,
    /** How much air it draws in toward its core, a share of its swirl. */
    inflow: 0.15,
    /**
     * How hard its shoves drive the air toward its swirl [ours]: at 1 each step makes up what the air's own pull toward the
     * wind and its decay take off a steady swirl (`relax + dissipation` times the swirl), so the core turns at about its swirl.
     */
    spin: 1,
    /** Shoves round its core a step. */
    shoves: 8,
    /** The most handed to the air at once, nearest first. */
    inWindow: 3,
    /** Its column of dust: laid at these heights (m) with this spread (m), this much a second at its core. */
    h0: 0.5,
    h1: 3,
    h2: 7,
    h3: 12,
    sigma: 1.5,
    dust: 0.6,
    /** Born only by day. */
    byDay: true,
    /** The list's refresh, seconds. */
    every: 0.5,
    /** How far round the player the list reaches, m (the air's window from its middle, with room). */
    near: 160,
  },
};

export type WindTuneTable = typeof WIND_TUNE;

/**
 * One row a kind of weather (the design's §2.13), the kind being the row's own camera effect, blended by the sky's own
 * mix weights. Every number [ours] and a dial in "Wind by weather", `scale` 1 on every row (the game's own Wind Speed
 * Scale is the input: the only per-area, per-level wind the archives hold).
 */
export const WIND_PROFILES: Record<WindKind, WindProfile> = {
  // A fair day's light air (Beaufort 1 is 0.3 to 1.5 m/s): the gustiest against its own mean, a gust about twice the mean now
  // and then, its heading the least settled; the devils are the owner's "on a calm day ... kick up dirt".
  clear: profileOf({ floor: 1.0, scale: 1, gust: 1.2, cover: 0.15, size: 40, stretch: 2, veer: 0.35, wander: 0.5, devils: 40, trees: 0.35 }),
  // An autumn breeze: frequent, leafy gusts.
  leaves: profileOf({ floor: 1.2, scale: 1, gust: 1.0, cover: 0.22, size: 35, stretch: 2, veer: 0.3, wander: 0.4, devils: 0, trees: 0.4 }),
  // A front's wind is stronger and steadier against its mean and holds its heading; wet ground throws no devils.
  rain: profileOf({ floor: 1.5, scale: 1, gust: 0.6, cover: 0.25, size: 60, stretch: 2.5, veer: 0.2, wander: 0.2, devils: 0, trees: 0.3 }),
  // Keeps a storm's gusts where the first waves had them, at the demo's cells of 29 to 30 m; a storm blows from one side.
  dust: profileOf({ floor: 2.0, scale: 1, gust: 1.0, cover: 0.3, size: 30, stretch: 2.5, veer: 0.25, wander: 0.15, devils: 2, trees: 0.3 }),
  // The table's snow rows are 0.1 and fall straight; a little air keeps flakes drifting.
  snow: profileOf({ floor: 0.5, scale: 1, gust: 0.5, cover: 0.2, size: 50, stretch: 2, veer: 0.2, wander: 0.25, devils: 0, trees: 0.25 }),
  // Fog is still air, and still air has no settled heading.
  fog: profileOf({ floor: 0.3, scale: 1, gust: 0.15, cover: 0.1, size: 80, stretch: 1.5, veer: 0.1, wander: 0.6, devils: 0, trees: 0.1 }),
  // Mustafar's: ash devils off the flows.
  smoke: profileOf({ floor: 1.0, scale: 1, gust: 0.6, cover: 0.2, size: 40, stretch: 2, veer: 0.25, wander: 0.3, devils: 4, trees: 0.3 }),
  lightning: profileOf({ floor: 1.0, scale: 1, gust: 0.6, cover: 0.2, size: 40, stretch: 2, veer: 0.25, wander: 0.3, devils: 2, trees: 0.3 }),
};

/** The profiles in `WIND_KINDS`' order, by reference (the frame reads them by index: a keyed read by name made a number a read). */
const PROFILE_ROWS: readonly WindProfile[] = WIND_KINDS.map((k) => WIND_PROFILES[k]);

/** A world's entry at ones, with five levels' (0 to 4) at ones. */
function worldEntry(devils = 1): WorldEntry {
  // Built from `oneMult`'s record (every field a double from its first write), never a spread of it.
  const e = oneMult() as WorldEntry;
  e.byLevel = [oneMult(), oneMult(), oneMult(), oneMult(), oneMult()];
  e.devils = devils;
  return e;
}

/**
 * One entry a world (the planet's id), each a multiplier on its profiles' `floor`, `gust`, `cover`, `size`, `wander` and
 * `devils`, and `byLevel`, five more such sets, one for each weather level 0 to 4. Every entry 1 [ours] but `devils` 0
 * on the jungle and forest worlds, where open dry ground is rare and a devil would lift litter that gives a tenth of
 * sand's dust. A world not named is given an entry at ones the first time it is asked for.
 */
export const WIND_WORLDS: Record<string, WorldEntry> = {
  tatooine: worldEntry(),
  naboo: worldEntry(),
  corellia: worldEntry(),
  dantooine: worldEntry(),
  lok: worldEntry(),
  endor: worldEntry(0),
  dathomir: worldEntry(),
  yavin4: worldEntry(0),
  talus: worldEntry(),
  rori: worldEntry(),
  mustafar: worldEntry(),
  kashyyyk: worldEntry(0),
};

/** A world's entry, made at ones the first time an unnamed world is asked for. */
export function windWorldOf(id: string): WorldEntry {
  let e = WIND_WORLDS[id];
  if (!e) {
    e = worldEntry();
    WIND_WORLDS[id] = e;
  }
  return e;
}

// ---------------------------------------------------------------------------------------------- the state

/**
 * The arm and its switches, written by the game from the settings when one moves (`setWindArm`), never read from them
 * on a frame. `on` is the W7 arm: the master, `volWind` and `volArtWind` above nought; with it off the weather's step is
 * today's lines and no reader takes the W7 branch. `decks` is W7b's (the clouds' feed sets it while its pass is wanted).
 */
export const WIND_STATE = {
  /** The W7 arm. */
  on: false,
  master: false,
  wind: true,
  devils: true,
  trees: true,
  art: 1,
  /** The frame report's soft off (`perf({ ab: { key: 'volWind' } })`): the arm off, every setting left alone. */
  soft: false,
  /** W7b's: a cloud deck draws, so the sky's sheets take the world's wind aloft. */
  decks: false,
  /** Why the arm is off, in words, or ''. */
  why: 'the volumetrics master is off',
};

/** The arm from the settings' record (`VOL_TUNE` and its kin, handed in). */
export function setWindArm(o: { master: boolean; wind: boolean; devils: boolean; trees: boolean; art: number }): void {
  const S = WIND_STATE;
  S.master = o.master;
  S.wind = o.wind;
  S.devils = o.devils;
  S.trees = o.trees;
  S.art = Number.isFinite(o.art) && o.art > 0 ? o.art : 0;
  S.on = o.master && o.wind && S.art > 0 && !S.soft;
  S.why = !o.master ? 'the volumetrics master is off' : !o.wind ? "the unified wind's switch (volWind) is off" : !(S.art > 0) ? "the wind's art (volArtWind) is at nought" : S.soft ? 'held off by the frame report' : '';
  // The arm off: every reader's branch back on today's at once (the step that would write `on` no longer runs).
  if (!S.on && uniforms) uniforms.uWind7.value[27] = 0;
}

/** The day a devil's birth is gated on, written by the world each frame under the arm (`writeWindDay`). */
class WindDay implements DevilDay {
  now = 0.36;
  t = 0.5;
  length = 720.5;
  shared = false;
  constructor() {
    this.length = 720;
  }
}
export const WIND_DAY: DevilDay & { shared: boolean } = new WindDay();

/**
 * The day in force, written by the world each frame under the arm before the weather steps: the shared one with a server
 * (`shared`, its time of day), the visible one without (there is nobody to agree with, and the shared clock's arithmetic
 * would put the devils in the owner's night). The step reads it at its own clock (`WIND_DAY.t`, set as it lists).
 */
export function writeWindDay(visible: number, length: number, sharedCount: number): void {
  // `sharedCount` is the shared clock's continuous day (`SharedClock.dayCountIn`), NaN with no server: nothing crosses
  // the call but numbers handed in, and nothing comes back.
  const shared = Number.isFinite(sharedCount);
  WIND_DAY.shared = shared;
  WIND_DAY.now = shared ? sharedCount - Math.floor(sharedCount) : visible;
  WIND_DAY.length = length > 0 ? length : 720;
}

// ---------------------------------------------------------------------------------------------- the uniform

/** The one uniform object every reader's program holds by reference: `uniform vec4 uWind7[7]`, the pack. */
export interface Wind7Uniforms {
  uWind7: { value: Float32Array };
}

let uniforms: Wind7Uniforms | null = null;

/**
 * `WIND7_UNIFORMS`, made the first time anything of W7 asks for it (an arrival's compile or the warm's, before any program
 * that reads it is built) and never with the master off; the arm's step writes it in place. Off until the arm's first
 * step: its `on` is nought, so every reader's branch draws today's.
 */
export function wind7Uniforms(): Wind7Uniforms {
  if (!uniforms) {
    const v = new Float32Array(PACK_FLOATS);
    // The lattice's period and a turn the shader can read before the first step; `on` nought.
    v[4] = 0;
    v[5] = 1;
    v[6] = 0;
    v[7] = 1;
    v[8] = 1;
    v[11] = 0.035;
    v[12] = 1 / 80;
    v[13] = 1 / 40;
    v[14] = 1 / 80;
    v[15] = 1 / 40;
    v[24] = 64;
    uniforms = { uWind7: { value: v } };
  }
  return uniforms;
}

/** Whether the uniform has been made (the off-proof: never with the master off). */
export function wind7UniformsMade(): boolean {
  return uniforms !== null;
}

// ---------------------------------------------------------------------------------------------- the world

/** What the step reads of the sky: its mix's length, blocks and kept weights, and its blended lighting (`SwgSky`). */
export interface WindSky {
  readonly mixLength: number;
  mixBlock(i: number): { cameraEffect?: { kind?: string | null } | null } | null;
  /** The mix's weights as a kept array (`SwgSky.mixWeights`): an element read hands nothing across a call. */
  readonly mixWeights: ArrayLike<number>;
  readonly lighting: { windSpeedScale: number };
}

/** The world the weather attached (references only: nothing of W7 is made until the arm's first step). */
interface PendingWorld {
  packId: string;
  planetId: string;
  seed: number;
  weights: readonly number[];
  levels: number;
  rows: readonly WindRow[];
}

let pending: PendingWorld | null = null;
let pattern: WindPattern | null = null;
let worldTable: WorldWind | null = null;
/** The quantile table in force, and one being made in slices after `soft` or `octave2` moved. */
let table: WindTable = defaultWindTable();
let tableJob: WindTableJob | null = null;

/** The weather attached a world: kept as references; the pattern is made at the arm's first step. */
export function attachWind(packId: string, planetId: string, seed: number, weights: readonly number[], levels: number, rows: readonly WindRow[]): void {
  pending = { packId, planetId, seed, weights, levels, rows };
  pattern = null;
  worldTable = null;
}

/** The world let go (the weather detached). */
export function detachWind(): void {
  pending = null;
  pattern = null;
  worldTable = null;
}

/** The world's table, worked out once a world (pure: the same in every browser). */
function tableOfWorld(): WorldWind | null {
  if (!pending) return null;
  worldTable ??= worldWindOf(pending.rows, pending.levels);
  return worldTable;
}

/** A pattern for the world attached, writing into `out` (a fresh one for a fresh pack, or the session's uniform's). */
function makePattern(out: Float32Array): WindPattern | null {
  const w = tableOfWorld();
  if (!pending || !w) return null;
  return new WindPattern(pending.seed, pending.weights, w, WIND_PROFILES, windWorldOf(pending.planetId), WIND_TUNE as unknown as WindMathTune, out, table);
}

/** The arm's pattern, made the first time the arm steps. */
function patternNow(): WindPattern | null {
  if (!pattern) pattern = makePattern(wind7Uniforms().uWind7.value);
  return pattern;
}

// ---------------------------------------------------------------------------------------------- the step

/**
 * The weather's W7 step's numbers, a kept record: the weather writes the inputs, the step the outputs. Every field a
 * double from its first write.
 */
class WindFrame {
  // In.
  /** The shared clock's seconds (the weather's walked reading). */
  t = 0.5;
  /** The weather's continuous level, for the level's multipliers on the observer's profile. */
  level = 0.5;
  /** A level held for the travel (the console's or the settings' force, 0 with the Weather setting off), or null. */
  forced: number | null = null;
  /** The player's place (x, z). */
  px = 0.5;
  pz = 0.5;
  // Out.
  /** The heading (the shared one, or the held), the mean S, the wind at the player S·k, its veer, the gust factor and patch there. */
  heading = 0.5;
  mean = 0.5;
  speed = 0.5;
  veer = 0.5;
  k = 0.5;
  p = 0.5;
  /** The world's travel speed now, m/s (the sky's sheets take it times their aloft factors). */
  travel = 0.5;
}

/** A class of its own: written every frame, and a class keeps its doubles in place where an object literal's took them boxed. */
export const WIND_FRAME = new WindFrame();

/** The observer's blended profile (the sky's mix, the world's and its level's multipliers): kept. */
const observer: WindProfile = newProfile();
const ask = newWindAsk(observer);
const here = newGustAt();
/** The blend's scratch: each kind's summed weight. */
const kindWeight = new Float64Array(WIND_KIND_COUNT);

/**
 * The observer's profile, into `observer`: each blended row's kind's profile at the row's mix weight, times the world's
 * multipliers and its level's (`WIND_FRAME.level`). Every key written out by name and every weight read off the sky's kept
 * array: a keyed store of a number goes through the generic path, which made a number a key, and a number handed back by
 * an accessor the compiler leaves out is made at each call.
 */
function blendObserver(sky: WindSky, M: WorldEntry): void {
  for (let k = 0; k < WIND_KIND_COUNT; k++) kindWeight[k] = 0;
  let total = 0;
  const n = sky.mixLength;
  const ws = sky.mixWeights;
  for (let i = 0; i < n; i++) {
    const b = sky.mixBlock(i);
    const w = ws[i];
    if (!b || !(w > 0)) continue;
    kindWeight[windKindIndex(b.cameraEffect?.kind ?? null)] += w;
    total += w;
  }
  if (!(total > 0)) {
    kindWeight[0] = 1;
    total = 1;
  }
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
    const s = kindWeight[k];
    if (!(s > 0)) continue;
    const share = s / total;
    const p = PROFILE_ROWS[k];
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
  const level = WIND_FRAME.level;
  const lv = level < 0 ? 0 : level > 4 ? 4 : level;
  const lo = Math.floor(lv);
  const hi = lo + 1 <= 4 ? lo + 1 : lo;
  const f = lv - lo;
  // The level's multipliers between its two levels as `a + f · (b − a)`, so two equal multipliers are that number exactly
  // (at ones the blend is the kinds' own to the bit), written out rather than through a helper (a number handed back
  // from a call the compiler leaves out is a number made).
  const a = M.byLevel[lo];
  const b = M.byLevel[hi];
  const aF = a ? a.floor : 1;
  const aG = a ? a.gust : 1;
  const aC = a ? a.cover : 1;
  const aS = a ? a.size : 1;
  const aW = a ? a.wander : 1;
  const aD = a ? a.devils : 1;
  const o = observer;
  o.floor = floor * (M.floor * (aF + f * ((b ? b.floor : 1) - aF)));
  o.scale = scale;
  o.gust = gust * (M.gust * (aG + f * ((b ? b.gust : 1) - aG)));
  o.cover = cover * (M.cover * (aC + f * ((b ? b.cover : 1) - aC)));
  o.size = size * (M.size * (aS + f * ((b ? b.size : 1) - aS)));
  o.stretch = stretch;
  o.veer = veer;
  o.wander = wander * (M.wander * (aW + f * ((b ? b.wander : 1) - aW)));
  o.devils = devils * (M.devils * (aD + f * ((b ? b.devils : 1) - aD)));
  o.trees = trees;
}

/**
 * The W7 step, under the arm (`WIND_STATE.on`): the observer's profile blended from the sky's mix, the world's pattern
 * packed into `WIND7_UNIFORMS` for this moment, and the wind at the player into `WIND_FRAME` (the mean, its gust factor
 * and veer there, the shared heading, the travel's speed); the devils listed and moved. A held speed, heading or gust
 * takes its place, and the pattern travels at the held vector from the moment of the hold. Nothing allocated.
 */
export function stepWind7(sky: WindSky): void {
  const p = patternNow();
  const F = WIND_FRAME;
  if (!p || !pending) {
    F.heading = 0;
    F.mean = 0;
    F.speed = 0;
    F.veer = 0;
    F.k = 1;
    F.p = 0;
    F.travel = 0;
    return;
  }
  // A quantile table being made again (a dial moved): a slice a frame, the old one standing until the new is whole.
  if (tableJob) {
    if (stepWindTable(tableJob)) {
      table = { theta: tableJob.theta, cbar: tableJob.cbar, soft: tableJob.soft, octave2: tableJob.octave2 };
      p.table = table;
      tableJob = null;
    }
  }
  blendObserver(sky, p.worldMult);
  p.now = F.t;
  p.setForcedNow(F.forced);
  const H = WIND_HOLD;
  ask.t = F.t;
  ask.on = WIND_STATE.on;
  ask.rows = sky.lighting.windSpeedScale;
  ask.art = WIND_STATE.art;
  ask.holdSpeed = H.speed;
  ask.holdHeading = H.heading;
  ask.holdGust = H.gust;
  // The hold's travel: a held speed or heading moves the patterns at the held vector from now (a gust share alone does not).
  if (H.speed !== null || H.heading !== null) {
    p.headingNow();
    // The held numbers made numbers by arithmetic (`+ 0`), so both ways in are doubles where they meet (a tagged value and
    // a double meeting make the double a boxed one).
    const hh = H.heading;
    const h = hh !== null ? hh + 0 : p.hd;
    const hs = H.speed;
    let s = 0.5;
    if (hs !== null) s = hs + 0;
    else {
      // The pure travel's own speed now, along the held heading.
      p.travelWindNow();
      s = Math.sqrt(p.su.x * p.su.x + p.su.z * p.su.z);
    }
    p.hvx = Math.sin(h) * s;
    p.hvz = Math.cos(h) * s;
    p.setHoldTravelNow();
  } else if (p.held) {
    p.hvx = Number.NaN;
    p.hvz = Number.NaN;
    p.setHoldTravelNow();
  }
  p.pack(ask);
  here.x = F.px;
  here.z = F.pz;
  gustFlat(here, p.packOut);
  F.heading = p.heading;
  F.mean = p.mean;
  F.k = here.k;
  F.p = here.p;
  F.speed = p.mean * here.k;
  F.veer = here.a;
  F.travel = p.travelSpeed;
  if (WIND_STATE.devils) {
    WIND_DAY.t = F.t;
    p.qx = F.px;
    p.qz = F.pz;
    p.qr = WIND_TUNE.devils.near;
    p.qt = F.t;
    p.devilsNearNow(WIND_DAY, false);
  } else p.devilCount = 0;
}

/**
 * The world's travel speed alone, into `WIND_FRAME.travel`, for the sky's sheets while a deck of the next wave draws with
 * the arm off (`WIND_STATE.decks`, which W7b's feed sets: its decks read the pure travel whatever `volWind` is, and the
 * sheets go with them). The pattern's heading takes no wobble here (the arm is off) and nothing is packed: `uWind7`'s on
 * stays nought, so no reader of the ground takes the unified wind. Nothing allocated.
 */
export function stepWindAloft(): void {
  const F = WIND_FRAME;
  const p = patternNow();
  if (!p) {
    F.travel = 0;
    return;
  }
  p.arm = WIND_STATE.on;
  p.now = F.t;
  p.setForcedNow(F.forced);
  p.travelWindNow();
  F.travel = Math.sqrt(p.su.x * p.su.x + p.su.z * p.su.z);
}

// ---------------------------------------------------------------------------------------------- the clouds' decks

/**
 * The clouds' decks' read of the wind (the seventh wave's second half, the design's §2.18), a kept record the clouds' feed
 * writes: the shared second, and each pack's geometry -- its lattice this many times the world's gust size and its travel
 * this share of the pure travel (the deck's aloft factor). A class, its numbers doubles from the start.
 */
class DeckAsk {
  t = 0.5;
  highScale = 0.5;
  highShare = 0.5;
  lowScale = 0.5;
  lowShare = 0.5;
}
export const WIND_DECK_ASK = new DeckAsk();

/**
 * The two decks' packs of the very gust function (`WIND7_DECK` for the high slab, its own for the low deck), each bound to
 * a pass's `uWind7` in place of the ground's: the arrays the clouds' weather pass and low wind pass hold by reference.
 */
export const WIND_DECK_PACKS = { high: new Float32Array(PACK_FLOATS), low: new Float32Array(PACK_FLOATS) };

/**
 * Both decks' packs for `WIND_DECK_ASK.t`, whatever `volWind` is (a deck reads the pure travel and the world's gusts, the
 * design's decision 86): the world's pattern made if the arm has not made it, its phases frozen and travelled to that
 * second as `pack` would leave them, the observer's gust strength and veer (blended from `sky`'s mix where the arm has not
 * blended it this frame, the hold's gust share on the strength, never the art: the clouds' own smear dials are theirs).
 * False with no world. Nothing allocated.
 */
export function packDecks(sky: WindSky | null): boolean {
  const p = patternNow();
  if (!p || !pending) return false;
  if (!WIND_STATE.on && sky) blendObserver(sky, p.worldMult);
  const A = WIND_DECK_ASK;
  p.now = A.t;
  p.phasesNow();
  const hg = WIND_HOLD.gust;
  p.deckGust = observer.gust * (hg === null ? 1 : hg);
  p.deckVeer = observer.veer;
  p.deckScale = A.highScale;
  p.deckShare = A.highShare;
  p.packDeckNow(WIND_DECK_PACKS.high);
  p.deckScale = A.lowScale;
  p.deckShare = A.lowShare;
  p.packDeckNow(WIND_DECK_PACKS.low);
  return true;
}

/** The observer's blend by kind of weather as it was last worked out (the console's): each kind's share of the sky's mix. */
export function windBlendNow(): Record<string, number> {
  let total = 0;
  for (let k = 0; k < WIND_KIND_COUNT; k++) total += kindWeight[k];
  const out: Record<string, number> = {};
  if (!(total > 0)) return out;
  for (let k = 0; k < WIND_KIND_COUNT; k++) if (kindWeight[k] > 0) out[WIND_KINDS[k]] = Math.round((kindWeight[k] / total) * 1000) / 1000;
  return out;
}

/**
 * A devil of this browser's own (`__debug.wind({ devil: true })`): stood where asked for its seconds, a core and a swirl
 * in the middle of the tune's ranges, and handed to the air beside the world's (nearest first). Local: nobody else sees
 * it, and it drifts with nothing.
 */
class LocalDevil {
  x = 0.5;
  z = 0.5;
  born = 0.5;
  until = -Infinity;
  core = 0.5;
  swirl = 0.5;
}
export const WIND_LOCAL_DEVIL = new LocalDevil();

export function standLocalDevil(x: number, z: number, t: number, seconds: number): void {
  const D = WIND_TUNE.devils;
  WIND_LOCAL_DEVIL.x = x;
  WIND_LOCAL_DEVIL.z = z;
  WIND_LOCAL_DEVIL.born = t;
  WIND_LOCAL_DEVIL.until = t + seconds;
  WIND_LOCAL_DEVIL.core = 0.5 * (D.coreMin + D.coreMax);
  WIND_LOCAL_DEVIL.swirl = 0.5 * (D.swirlMin + D.swirlMax);
}

/** The arm's pattern (the air reads its devils and its mean; the console its phases), or null. */
export function windPattern(): WindPattern | null {
  return pattern;
}

/** The devils near now: how many, and their table (`DEVIL_W` numbers each: x, z, born, life, core, swirl, …, age, envelope). */
export function windDevils(): { count: number; table: Float64Array } | null {
  return pattern ? { count: pattern.devilCount, table: pattern.devils } : null;
}

export { DEVIL_W };

// ---------------------------------------------------------------------------------------------- the console's

/**
 * A pack built afresh for shared second `t` and the wind at a point from it (`wind({ at, t })`: what two tabs compare),
 * with the observer's profile as it stands and the level held as the drawn pattern holds it (two players with the same
 * force agree); never this browser's hold, which nobody else has. Null without a world.
 */
export function windAtPoint(x: number, z: number, t: number): { k: number; veer: number; patch: number; mean: number; speed: number; heading: number } | null {
  const p = windPackAt(t, new Float32Array(PACK_FLOATS));
  if (!p) return null;
  const g = newGustAt();
  g.x = x;
  g.z = z;
  gustFlat(g, p.packOut);
  return { k: g.k, veer: g.a, patch: g.p, mean: p.mean, speed: p.mean * g.k, heading: p.heading };
}

/** A fresh pattern of the world attached that holds the level the drawn one holds (its moment and ramps), or null. */
function freshPattern(out: Float32Array): WindPattern | null {
  const p = makePattern(out);
  if (!p) return null;
  // The drawn pattern's held level, where the arm has stepped one (never made here: with the master off nothing of W7 is).
  if (pattern) p.followForcedOf(pattern);
  return p;
}

/**
 * A pattern of the world attached, packed afresh into `out` for shared second `t` with the observer's profile as it
 * stands and the drawn pattern's held level (the console's points and the self test's moments): what any browser at that
 * moment packs. Null without a world.
 */
export function windPackAt(t: number, out: Float32Array, profile: WindProfile | null = null): WindPattern | null {
  const p = freshPattern(out);
  if (!p) return null;
  const a = newWindAsk({ ...(profile ?? observer) });
  a.t = t;
  a.on = true;
  a.rows = ask.rows;
  a.art = WIND_STATE.art > 0 ? WIND_STATE.art : 1;
  p.pack(a);
  return p;
}

/**
 * Gusts an hour and seconds a gust at a point over the next hour of the pure clock (the dials' read-outs): the pattern as
 * it is drawn, its held level (a forced one, or level 0 with the Weather setting off) and this browser's hold (a held
 * speed or heading moving the patches at the held vector, a held gust share on their strength) included. Worked out a
 * second at a time over the hour, a fresh pattern packed each time: some 6 ms a kind of weather on this machine, so it is
 * worked out when the console asks or a dial of that kind moves, and kept, never on a frame. Null without a world.
 */
export function windReadouts(x: number, z: number, profile: WindProfile | null = null): { perHour: number; secondsEach: number; share: number } | null {
  if (!pending) return null;
  const a = newWindAsk({ ...(profile ?? observer) });
  a.t = WIND_FRAME.t;
  a.on = true;
  a.rows = ask.rows;
  a.art = WIND_STATE.art > 0 ? WIND_STATE.art : 1;
  const H = WIND_HOLD;
  a.holdSpeed = H.speed;
  a.holdHeading = H.heading;
  a.holdGust = H.gust;
  let hold: { vx: number; vz: number } | null = null;
  if (H.speed !== null || H.heading !== null) {
    const live = pattern;
    let h = H.heading;
    let s = H.speed;
    if (live && (h === null || s === null)) {
      live.headingAtIn(WIND_FRAME.t);
      if (h === null) h = live.hd;
      if (s === null) {
        live.travelWindIn(WIND_FRAME.t);
        s = Math.sqrt(live.su.x * live.su.x + live.su.z * live.su.z);
      }
    }
    if (h !== null && s !== null) hold = { vx: Math.sin(h) * s, vz: Math.cos(h) * s };
  }
  return WindPattern.readouts(() => freshPattern(new Float32Array(PACK_FLOATS))!, a, x, z, 3600, 1, hold);
}

/** The observer's profile now (the console's). */
export function windObserver(): WindProfile {
  return observer;
}

/** The world's table, worked out if the arm has not stepped yet (the console's). */
export function windWorldTable(): WorldWind | null {
  return tableOfWorld();
}

/** The world attached, or null. */
export function windWorldId(): { packId: string; planetId: string } | null {
  return pending ? { packId: pending.packId, planetId: pending.planetId } : null;
}

/** The quantile table in force, and whether one is being made again. */
export function windTableState(): { soft: number; octave2: number; remaking: boolean } {
  return { soft: table.soft, octave2: table.octave2, remaking: tableJob !== null };
}

/** The table made whole at once (the tests', and the console's `wind({ tune: { gusts: { soft } }, now: true })`). */
export function remakeWindTableNow(): void {
  const t = buildWindTable(WIND_TUNE.gusts.soft, WIND_TUNE.gusts.octave2, WIND_TUNE.gusts.lattice);
  table = t;
  tableJob = null;
  if (pattern) pattern.table = t;
}

/** A number of a group moved: held to what cannot break anything, words for anything refused. */
function setNumber(group: Record<string, unknown>, key: string, v: unknown, min: number, max: number, path: string, words: string[]): boolean {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    words.push(`${path} ${String(v)} is not a number`);
    return false;
  }
  if (v < min || v > max) words.push(`${path} ${v} held to ${Math.min(max, Math.max(min, v))}`);
  group[key] = Math.min(max, Math.max(min, v));
  return true;
}

/** The ends a tune number is held to (what cannot break anything; the dials' own ranges are narrower). */
const TUNE_ENDS: Record<string, Record<string, [number, number]>> = {
  heading: { wanderPeriod: [30, 36000], wobblePeriod: [10, 3600] },
  aloft: { low: [0, 10], bottom: [0, 10], top: [0, 10], veerTop: [-180, 180], floor: [0, 50] },
  grass: { sheen: [0, 2], sheenGrey: [0, 1], sheenLift: [0, 3], farLean: [0, 1] },
  pulse: { share: [0, 2], period: [5, 600] },
  gusts: { cycle: [10, 1800], step: [0.25, 30], lattice: [16, 256], octave2: [0, 1], soft: [0.005, 0.3], travelFloor: [0, 20] },
  shed: { rate: [0, 5], at: [0, 10], sigma: [0.05, 5], rise: [0, 10] },
  devils: { cell: [32, 2048], epoch: [1, 600], lifeMin: [1, 600], lifeMax: [1, 1200], coreMin: [0.2, 30], coreMax: [0.2, 40], swirlMin: [0, 60], swirlMax: [0, 80], reach: [1, 12], inflow: [0, 1], spin: [0, 5], shoves: [2, 16], inWindow: [0, 3], h0: [0, 40], h1: [0, 40], h2: [0, 40], h3: [0, 40], sigma: [0.2, 10], dust: [0, 10], every: [0.1, 10], near: [50, 600] },
};

/** The profile fields' ends. */
const PROFILE_ENDS: Record<string, [number, number]> = { floor: [0, 30], scale: [0, 5], gust: [0, 5], cover: [0, 1], size: [2, 1000], stretch: [0.2, 10], veer: [0, Math.PI], wander: [0, Math.PI * 2], devils: [0, 1000], trees: [0, 2] };

/**
 * `__debug.wind({ tune })`: moves `WIND_TUNE` (by group), `WIND_PROFILES` (`profiles: { clear: { gust } }`) and
 * `WIND_WORLDS` (`worlds: { tatooine: { gust, byLevel: { 4: { gust } } } }`). A moved `soft` or `octave2` starts the
 * quantile table again in slices, the old one standing until the new is whole. Answers words for anything held or refused.
 */
export function tuneWind(o: Record<string, unknown>): { notes: string[] } {
  const words: string[] = [];
  const T = WIND_TUNE as unknown as Record<string, Record<string, unknown>>;
  let remake = false;
  for (const [g, vals] of Object.entries(o)) {
    if (g === 'profiles' || g === 'worlds') continue;
    const group = T[g];
    const ends = TUNE_ENDS[g];
    if (!group || !ends || !vals || typeof vals !== 'object') {
      words.push(`no group "${g}" in the wind's tune`);
      continue;
    }
    for (const [k, v] of Object.entries(vals as Record<string, unknown>)) {
      if (k === 'byDay') {
        if (typeof v === 'boolean') group[k] = v;
        else words.push('devils.byDay is on or off');
        continue;
      }
      const e = ends[k];
      if (!e) {
        words.push(`no number "${g}.${k}" in the wind's tune`);
        continue;
      }
      if (setNumber(group, k, v, e[0], e[1], `${g}.${k}`, words) && g === 'gusts' && (k === 'soft' || k === 'octave2' || k === 'lattice')) remake = true;
    }
  }
  const prof = o.profiles as Record<string, Record<string, unknown>> | undefined;
  if (prof && typeof prof === 'object') {
    for (const [kind, vals] of Object.entries(prof)) {
      const row = (WIND_PROFILES as unknown as Record<string, Record<string, unknown>>)[kind];
      if (!row || !vals || typeof vals !== 'object') {
        words.push(`no kind of weather "${kind}" (${WIND_KINDS.join(', ')})`);
        continue;
      }
      for (const [k, v] of Object.entries(vals)) {
        const e = PROFILE_ENDS[k];
        if (!e) words.push(`no number "${k}" in a kind's wind`);
        else setNumber(row, k, v, e[0], e[1], `profiles.${kind}.${k}`, words);
      }
    }
  }
  const worlds = o.worlds as Record<string, Record<string, unknown>> | undefined;
  if (worlds && typeof worlds === 'object') {
    for (const [id, vals] of Object.entries(worlds)) {
      if (!vals || typeof vals !== 'object' || id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
      const e = windWorldOf(id);
      for (const [k, v] of Object.entries(vals)) {
        if (k === 'byLevel') {
          if (!v || typeof v !== 'object') continue;
          for (const [lv, lvals] of Object.entries(v as Record<string, Record<string, unknown>>)) {
            const l = Number(lv);
            if (!(l >= 0 && l <= 4 && Number.isInteger(l)) || !lvals || typeof lvals !== 'object') {
              words.push(`worlds.${id}.byLevel.${lv}: a level is 0 to 4`);
              continue;
            }
            for (const [kk, vv] of Object.entries(lvals)) {
              if (!(WORLD_KEYS as readonly string[]).includes(kk)) words.push(`no multiplier "${kk}" (${WORLD_KEYS.join(', ')})`);
              else setNumber(e.byLevel[l] as unknown as Record<string, unknown>, kk, vv, 0, 20, `worlds.${id}.byLevel.${l}.${kk}`, words);
            }
          }
          continue;
        }
        if (!(WORLD_KEYS as readonly string[]).includes(k)) words.push(`no multiplier "${k}" (${WORLD_KEYS.join(', ')})`);
        else setNumber(e as unknown as Record<string, unknown>, k, v, 0, 20, `worlds.${id}.${k}`, words);
      }
    }
  }
  if (WIND_TUNE.devils.lifeMax < WIND_TUNE.devils.lifeMin) WIND_TUNE.devils.lifeMax = WIND_TUNE.devils.lifeMin;
  if (WIND_TUNE.devils.coreMax < WIND_TUNE.devils.coreMin) WIND_TUNE.devils.coreMax = WIND_TUNE.devils.coreMin;
  if (WIND_TUNE.devils.swirlMax < WIND_TUNE.devils.swirlMin) WIND_TUNE.devils.swirlMax = WIND_TUNE.devils.swirlMin;
  WIND_TUNE.gusts.lattice = Math.round(WIND_TUNE.gusts.lattice);
  WIND_TUNE.devils.inWindow = Math.round(WIND_TUNE.devils.inWindow);
  WIND_TUNE.devils.shoves = Math.round(WIND_TUNE.devils.shoves);
  if (remake) {
    const g = WIND_TUNE.gusts;
    if (g.soft === table.soft && g.octave2 === table.octave2 && g.lattice === 64 && !tableJob) {
      // Back at the table in force.
    } else {
      tableJob = newWindTableJob(g.soft, g.octave2, g.lattice);
      words.push(`the gust patches' table is being made again for soft ${g.soft} and octave2 ${g.octave2} (a few frames, about ${Math.ceil(20000 / 2000) + 10} of them); the old one stands until it is whole`);
    }
  }
  // A world's table (its rows) is the world's own; nothing else here is cached past a phase's next restart.
  return { notes: words };
}

/** Every tune table as plain numbers (the console's report, and what the dials read). */
export function windTuneNow(): { tune: WindTuneTable; profiles: Record<WindKind, WindProfile>; worlds: Record<string, WorldEntry> } {
  return { tune: WIND_TUNE, profiles: WIND_PROFILES, worlds: WIND_WORLDS };
}

/** The world's share of its rows by kind at a level, in words (the console's). */
export function worldKindsAt(level: number): Record<string, number> {
  const w = tableOfWorld();
  const out: Record<string, number> = {};
  if (!w) return out;
  const l = Math.min(w.levels - 1, Math.max(0, Math.round(level)));
  for (let k = 0; k < WIND_KIND_COUNT; k++) {
    const s = w.shares[l * WIND_KIND_COUNT + k];
    if (s > 0) out[WIND_KINDS[k]] = Number(s.toFixed(3));
  }
  return out;
}

export type { WorldMult };
