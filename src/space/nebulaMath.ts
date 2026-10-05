// A nebula as arithmetic: where its sheets stand, how deep the camera is inside one, when its
// lightning strikes, whom a strike touches and how hard it hits, and what being inside one does to a
// ship's systems. Nothing here imports three or touches the DOM, so
// `tools/swg/tests/nebulaMath.test.ts` runs exactly the code the game runs.
//
// What comes from the client's own table (through the pack) is each nebula's place, size, density,
// the share of its sheets that face the camera, its two colour pairs, its camera shake, which of
// the two sheet looks it wears, how often it strikes, how long a strike lasts, the damage band a
// strike draws from and the three system effects (zero on every retail row). What comes from the
// game's own rule for lightning, studied in its server and restated here in our own words, is
// marked READ: the chance a nebula strikes in a moment, the cube its two ends fall in, the band its
// life is drawn from, that a strike touches every ship it passes and drains only the shield on the
// side it passed, the two seconds a ship rests between strikes, and how the system effects are
// summed, held and applied. Everything else is OURS and is marked so: how many sheets a nebula
// gets, how big they are and how they are spread, how a sheet fades near the camera and as it fills
// the screen, how far out a nebula is pulled in toward the camera, how deep "inside" counts, how
// often the clock is asked, how near a bolt must pass, the share of the table's damage a strike
// really does, and how strong the system effects are where the table leaves them at zero. Every one
// of them sits in NEBULA_TUNE or NEBULA_SYSTEMS, which `__debug.nebulae({...})` moves live so the
// owner can say "twice as thick" and have the number set from what they saw.
//
// The clock. A strike is not decided by a frame, as the game decided it: the time line is cut into
// ticks of `strikeTick` seconds, and tick n strikes when a hash of the nebula's name and n falls
// under the game's own chance for a moment that long. The time line is the clock the weather reads
// (the server's while one answers, walked rather than stepped when it is put right, this machine's
// wall clock with no server set), so two browsers see the same strikes at the same moments with
// nothing sent between them, exactly as `weatherSchedule.ts` keeps the weather the same for
// everyone. Whom a strike touches is each browser's own question, asked of its own ships.
import type { Nebula, NebulaColour } from './spaceData.ts';

/** A sheet's colour: red, green, blue, alpha (the table stores alpha first; this is drawing order). */
export type SheetColour = [number, number, number, number];

/**
 * Every number in a nebula that the client's files do not give. INVENTED unless it says READ (the
 * game's own lightning rule, restated), and all live through `__debug.nebulae({ ... })`.
 */
export const NEBULA_TUNE = {
  /** An overall multiplier on every nebula's sheet count: the "twice as thick" knob. */
  density: 1,
  /** An overall multiplier on every sheet's own alpha: the "too solid" knob, which costs nothing to move. */
  alpha: 1,
  /** count = density x (radius / 500)^1.5 x this, before the clamps. */
  sheetsPer500m: 24,
  sheetsMin: 6,
  sheetsMax: 96,
  /** The most sheets one zone may draw, shared out in proportion when the rows ask for more. */
  zoneSheets: 1500,
  /** A sheet's width across, as a share of its nebula's radius. */
  sizeMin: 0.35,
  sizeMax: 0.7,
  /**
   * How the sheets are spread inside the sphere: a sheet's distance from the middle is the radius
   * times a uniform number to this power. 1/3 would spread them evenly through the volume, so
   * anything under that crowds them toward the middle.
   */
  centrePower: 0.7,
  /** A nebula whose middle is farther than this (metres) is pulled in to it, and scaled by the same ratio. */
  pullFrom: 6000,
  /** A sheet fades out over this band of view depth (metres), so nothing is cut by the far plane. */
  farFadeFrom: 7200,
  farFadeTo: 8700,
  /** A sheet fades out as the camera comes within this band of its own width across. */
  nearFadeFrom: 0.1,
  nearFadeTo: 0.4,
  /** A sheet fades out as it grows past this share of the screen's height; gone by the second. */
  screenFadeFrom: 0.6,
  screenFadeTo: 1.3,
  /** How far into a nebula (as a share of its radius) counts as all the way inside. */
  insideOver: 0.6,
  /** The near shell: how solid it may get, how far out it stands (metres), and how fast its cloud drifts. */
  shellAlpha: 0.5,
  shellRadius: 30,
  shellDrift: 0.004,
  /** How large the haze's cloud is drawn across the view: smaller is a broader, softer cloud. */
  shellScale: 1.3,
  /**
   * The least of `shellAlpha` the haze keeps where its picture is at its thinnest, so the haze is a
   * fog rather than a set of holes. The rest of it follows the picture.
   */
  shellFloor: 0.45,
  /** The mist is re-ordered no oftener than this (seconds) and at least this often while the camera stands still. */
  sortLeast: 0.1,
  sortEvery: 0.25,
  /** Or as soon as the camera has moved this far (metres) since the last order, subject to `sortLeast`. */
  sortMoved: 50,
  /** How much of the lens flare and of the god rays being deep inside a nebula takes away. */
  dimFlare: 0.85,
  dimRays: 0.8,
  /** The camera shake at the table's full jitter and full depth: radians of turn, metres of shift, and its rate. */
  shakeTurn: 0.012,
  shakeShift: 0.04,
  shakeHz: 8.5,
  /**
   * How near a nebula's edge must be before its strikes are worked out at all (metres), when no ship
   * is inside it: a nebula holding any ship that may be struck is always asked, however far off.
   */
  strikeReach: 1800,
  /**
   * The length of one tick of the strike clock (seconds). OURS: the game asked once a frame; a tick
   * on the clock everyone shares is what lets two browsers agree. At a tenth of a second the game's cap on the
   * chance (below) never binds, since no retail row strikes more than once a second.
   */
  strikeTick: 0.1,
  /** READ: a nebula strikes in a moment of `dt` seconds with chance dt x its rate, but never more than this. */
  strikeChanceCap: 0.5,
  /** READ: both ends of a bolt fall anywhere in the cube this share of the radius either side of the middle, each axis on its own. */
  strikeCube: 0.3,
  /** READ: a strike's life is the row's longest times this, plus up to this band more: half to all of it. */
  strikeLifeMin: 0.5,
  strikeLifeSpan: 0.5,
  /** The longest gap (seconds: a paused tab, a loading screen) whose strikes are caught up with; a longer one is taken from its end. OURS. */
  catchUpSeconds: 0.5,
  /**
   * READ: the least seconds between two strikes on the same ship. Each ship keeps its own, so a
   * ship sitting under a long bolt is struck again only once this has passed.
   */
  hitEvery: 2,
  /**
   * How near a bolt must pass a ship's middle to touch it, as a share of the ship's bounding radius.
   * OURS: the game swept a thin sphere along the bolt against the hull's own collision; ours asks the
   * hull's sphere instead, which is a little generous on a long thin hull and costs nothing.
   */
  hitShare: 1,
  /**
   * The fewest strike records a zone is given, apart from the bolts drawn. A zone whose own rows can
   * keep more standing at once is given that many (`strikeRecords`), so a strike is not lost for want
   * of a record. OURS. Next zone load.
   */
  liveStrikes: 8,
  /**
   * How far past its rows' average the record pool reaches, in square roots of that average (how far
   * a count drawn at random strays from its mean), and as many records again in spare. OURS. Next zone load.
   */
  liveSpread: 4,
  /** The most strike records any zone is given, whatever its rows say. OURS. Next zone load. */
  liveMost: 256,
  /**
   * OURS, and off: 0 is the game's own rule, under which a bolt touches whatever it happens to pass
   * and almost never a ship. Above 0 a strike whose far end falls within this many metres of the
   * player's ship (and the ship inside that nebula) ends on the ship instead, which is how this game
   * aimed lightning before it took the game's rule, and is the way back to how often that hit.
   */
  bendWithin: 0,
  /** How far off a strike may be and still be drawn (metres); past this nothing is shown for it, though it still strikes. */
  drawWithin: 3600,
  /** The most bolts alive at once; a strike that comes while they are all busy is skipped. Next zone load. */
  beams: 2,
  /** Segments along a bolt, and how many points its shaping curves are sampled at. Next zone load. */
  beamSegments: 24,
  /** A bolt at its widest (metres) and how far it wanders off the straight line (metres). */
  beamWidth: 7,
  beamWander: 40,
  /**
   * How the bolt wanders along its length: two rates each on the two axes across it, and how much of
   * the faster one is mixed into the slower. Sums of sines, so the wander is smooth and repeatable
   * and costs nothing; rates that do not divide into one another, so it never reads as a wave.
   */
  beamWaveSlowA: 11,
  beamWaveFastA: 27,
  beamWaveSlowB: 9,
  beamWaveFastB: 23,
  beamWaveMix: 0.6,
  /** How long a bolt takes to come up, as a share of its life, and how much of its life it holds full. */
  beamRise: 0.12,
  beamHold: 0.45,
  /**
   * Where each thing a nebula draws sits in three's see-through order: the mist, the glow over it,
   * then the haze and the bolts over both, all of them before everything else the zone draws.
   */
  orderMist: -2,
  orderGlow: -1,
  orderHaze: 1,
  orderBeam: 2,
  /** The pooled light a strike borrows. */
  flashIntensity: 9,
  flashDistance: 900,
  flashSeconds: 0.14,
  /**
   * The share of the table's damage band a strike really does. The tables were written for the
   * game's own hit points and ours are smaller, so the full numbers would take a fighter's shields
   * and most of its armour in one strike. A quarter is the owner's decision, not a reading of the
   * files, and the switch in the settings turns damage off altogether.
   */
  damageShare: 0.25,
  /**
   * Read the second waveform as how bright the bolt is along its length rather than as how far it
   * wanders off the straight line (see `beamCurves`). With it on the wander is the same all the way
   * along instead. It is spent when the bolt pool is made, so it takes effect at the next zone load.
   */
  waveAlpha: false,
};

/** The knobs that are spent when a zone's nebulae are built: moving one takes effect at the next zone load. */
export const BUILD_ONLY_KEYS: readonly string[] = ['beams', 'beamSegments', 'waveAlpha', 'liveStrikes', 'liveSpread', 'liveMost'];

export type NebulaTune = typeof NEBULA_TUNE;

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/**
 * What one unit of a nebula's density does to a ship inside it, for a row whose own effect is zero,
 * which is every retail row: the game had the rule and no table ever used it. OURS, every number,
 * and live through `__debug.nebulae({ systems: { ... } })`. Each is an effect in the game's own
 * sense (added to the system's efficiency, so -0.1 is a tenth off), not a factor. It is taken once,
 * from the densest row holding the ship, and never summed over the rows (see `nebulaSystemsAt`).
 */
export const NEBULA_SYSTEMS = { engine: -0.1, reactor: -0.2, shields: -0.5 };

/**
 * READ: how far the summed effects of every nebula holding a ship may go, and how far a system's
 * efficiency may go once its effect is added to it.
 */
export const SYSTEM_CLAMPS = { engine: [-0.5, 1], reactor: [-0.5, 1], shields: [-2, 1], efficiency: [0.1, 10] } as const;

/** The summed system effects where a ship stands, and how many nebulae hold it. Filled in place: one per ship, kept. */
export interface NebulaSystems {
  engine: number;
  reactor: number;
  shields: number;
  inside: number;
}

/** A ship's three factors inside the nebulae: engines, reactor power and shield recharge, each 1 outside them all. */
export interface SystemFactors {
  engine: number;
  reactor: number;
  shields: number;
}

export function newNebulaSystems(): NebulaSystems {
  return { engine: 0, reactor: 0, shields: 0, inside: 0 };
}

/** A row's own effect in one column, or 0 where the table left it at nothing (every retail row). */
function ownEffect(own: number | string | null | undefined): number {
  return typeof own === 'number' && Number.isFinite(own) ? own : 0;
}

/**
 * The system effects at a point. Every nebula whose sphere holds it adds its own effect, where the
 * table set one, and the sums are held as the game held them (READ). Where a row left a column at
 * nothing, ours stands in for it, and ours is counted ONCE, from the densest such row holding the
 * point, never once a row (OURS): the game builds one cloud out of several rows about the same middle
 * (a core, a main body and an outer shell), so 210 of the 250 retail rows' middles lie inside two or
 * more rows, and summing a strength per row left the middle of a typical cloud a thirtieth of its
 * shields' recharge and 94 of those middles none at all, for no more reason than how many sheets of
 * gas a designer layered. Written into `out`, which is returned; nothing is made.
 */
export function nebulaSystemsAt(
  rows: readonly Pick<Nebula, 'at' | 'radius' | 'density' | 'unused'>[],
  x: number,
  y: number,
  z: number,
  out: NebulaSystems,
  systems: typeof NEBULA_SYSTEMS = NEBULA_SYSTEMS,
): NebulaSystems {
  let engine = 0;
  let reactor = 0;
  let shields = 0;
  // The densest row holding the point that left each column at nothing (-1: none did).
  let engineDense = -1;
  let reactorDense = -1;
  let shieldsDense = -1;
  let inside = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const dx = r.at[0] - x;
    const dy = r.at[1] - y;
    const dz = r.at[2] - z;
    if (!(r.radius > 0) || dx * dx + dy * dy + dz * dz >= r.radius * r.radius) continue;
    inside++;
    const d = Math.max(0, r.density);
    const e = ownEffect(r.unused?.effectEngine);
    const p = ownEffect(r.unused?.effectReactor);
    const s = ownEffect(r.unused?.effectShields);
    if (e !== 0) engine += e;
    else if (d > engineDense) engineDense = d;
    if (p !== 0) reactor += p;
    else if (d > reactorDense) reactorDense = d;
    if (s !== 0) shields += s;
    else if (d > shieldsDense) shieldsDense = d;
  }
  if (engineDense > 0) engine += systems.engine * engineDense;
  if (reactorDense > 0) reactor += systems.reactor * reactorDense;
  if (shieldsDense > 0) shields += systems.shields * shieldsDense;
  out.engine = clamp(engine, SYSTEM_CLAMPS.engine[0], SYSTEM_CLAMPS.engine[1]);
  out.reactor = clamp(reactor, SYSTEM_CLAMPS.reactor[0], SYSTEM_CLAMPS.reactor[1]);
  out.shields = clamp(shields, SYSTEM_CLAMPS.shields[0], SYSTEM_CLAMPS.shields[1]);
  out.inside = inside;
  return out;
}

/**
 * The three factors a ship's numbers are multiplied by, from the summed effects. The engine's is its
 * efficiency with the effect added (READ). Reactor power and shield recharge were scaled by that
 * efficiency and again by one plus the effect (READ); the reactor's is then held to [0, 1] (OURS),
 * because this game's ships have no power to spare and a reactor over its rating would only ever
 * be a faster gun. Written into `out`.
 */
export function systemFactors(effects: Pick<NebulaSystems, 'engine' | 'reactor' | 'shields'>, out: SystemFactors): SystemFactors {
  const lo = SYSTEM_CLAMPS.efficiency[0];
  const hi = SYSTEM_CLAMPS.efficiency[1];
  out.engine = clamp(1 + effects.engine, lo, hi);
  out.reactor = clamp(clamp(1 + effects.reactor, lo, hi) * (1 + effects.reactor), 0, 1);
  out.shields = clamp(1 + effects.shields, lo, hi) * Math.max(0, 1 + effects.shields);
  return out;
}

/**
 * The message line's words as a ship comes into a nebula: its factors as shares. The shield recharge
 * named is the rate the shields really come back at, which the reactor's share slows as well as the
 * shields' own. Our words, made once per entry.
 */
export function nebulaNotice(f: SystemFactors): string {
  const pc = (v: number): string => `${Math.round(v * 100)}%`;
  return `The nebula weighs on the ship: engines at ${pc(f.engine)}, reactor at ${pc(f.reactor)}, shield recharge at ${pc(f.reactor * f.shields)}.`;
}

/** A hull as the nebulae weigh on it: whether it is in a jump or held where it is, and where it stands. */
export interface NebulaHull {
  readonly ghosted: boolean;
  readonly held: boolean;
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * The system effects on one ship this step, into its own record: those of the nebulae where it
 * stands (`nebulaSystemsAt`), or nothing at all for a hull in a jump (ghosted) or held where it is,
 * so a jump through a nebula does nothing to the ship and nothing weighs on a hull while a pause
 * holds it. Nothing is made.
 */
export function shipSystemsAt(
  rows: readonly Pick<Nebula, 'at' | 'radius' | 'density' | 'unused'>[],
  hull: NebulaHull,
  out: NebulaSystems,
  systems: typeof NEBULA_SYSTEMS = NEBULA_SYSTEMS,
): NebulaSystems {
  if (!rows.length || hull.ghosted || hull.held) {
    out.engine = out.reactor = out.shields = 0;
    out.inside = 0;
    return out;
  }
  return nebulaSystemsAt(rows, hull.pos.x, hull.pos.y, hull.pos.z, out, systems);
}

/** Whether a ship's factors weigh on it at all: any of the three off one. */
export function weakened(f: SystemFactors): boolean {
  return f.engine !== 1 || f.reactor !== 1 || f.shields !== 1;
}

/**
 * The message line's one word as the player's ship flies into a nebula that weighs on it, kept by
 * the ship contacts for the life of a world. It is said on the way in and not again for as long as
 * the ship stays in, and nothing is said on the way out (OURS: the speed arc's top tick coming back
 * up says that). A step in which the player flew no ship forgets it, so the next ship flown into a
 * nebula says so again.
 */
export class NebulaNote {
  /** The player's ship was weighed on at its last step. */
  inside = false;
  /** The player flew a ship this step. */
  private flown = false;

  /** The player's ship's factors this step: the words to say, or null when there is nothing to say. */
  player(f: SystemFactors): string | null {
    this.flown = true;
    const touched = weakened(f);
    const say = touched && !this.inside;
    this.inside = touched;
    return say ? nebulaNotice(f) : null;
  }

  /** The end of a step: out of the seat, the next nebula flown into is news again. */
  endStep(): void {
    if (!this.flown) this.inside = false;
    this.flown = false;
  }

  /** A world unload. */
  clear(): void {
    this.inside = false;
    this.flown = false;
  }
}

/** A 32-bit mix, so a seed and a counter give the same numbers in every browser and in node. */
export function hash32(a: number): number {
  let x = a | 0;
  x = (x ^ 61) ^ (x >>> 16);
  x = (x + (x << 3)) | 0;
  x = x ^ (x >>> 4);
  x = Math.imul(x, 0x27d4eb2d);
  x = x ^ (x >>> 15);
  return x >>> 0;
}

/** A number in [0, 1) from a seed and a counter. */
export function rand01(seed: number, n: number): number {
  return hash32(Math.imul(seed, 0x9e3779b1) + Math.imul(n, 0x85ebca6b)) / 4294967296;
}

/** A nebula's own seed: its name, so the same nebula makes the same sheets and the same strikes everywhere. */
export function seedOfName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** How many sheets a nebula asks for, before the zone's cap shares them out. OURS. */
export function sheetCount(radius: number, density: number, tune: NebulaTune = NEBULA_TUNE): number {
  const want = Math.round(Math.max(0, density) * tune.density * Math.pow(Math.max(1, radius) / 500, 1.5) * tune.sheetsPer500m);
  return clamp(want, tune.sheetsMin, tune.sheetsMax);
}

/**
 * The zone's sheets shared out: what each nebula asked for, scaled down in proportion when the zone
 * wants more than the cap. Every nebula keeps at least three sheets, so none of them vanishes.
 */
export function shareSheets(wanted: readonly number[], cap: number): number[] {
  const total = wanted.reduce((a, b) => a + b, 0);
  if (total <= cap || total === 0) return wanted.slice();
  const scale = cap / total;
  return wanted.map((w) => Math.max(3, Math.round(w * scale)));
}

/** The table's (alpha, red, green, blue) as drawing's (red, green, blue, alpha). */
export function sheetColour(c: NebulaColour): SheetColour {
  return [c[1], c[2], c[3], c[0]];
}

/** A sheet's colour at `t` of the way from the middle to the edge: the row's colour toward its ramp colour. */
export function rampAt(colour: NebulaColour, ramp: NebulaColour, t: number): SheetColour {
  const k = clamp(t, 0, 1);
  const a = sheetColour(colour);
  const b = sheetColour(ramp);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
}

/** One sheet, in the game's frame. */
export interface NebulaSheet {
  x: number;
  y: number;
  z: number;
  /** Its width across, metres. */
  size: number;
  /** It turns to face the camera; otherwise `right` and `up` are the turn it keeps. */
  facing: boolean;
  right: [number, number, number];
  up: [number, number, number];
  colour: SheetColour;
  /** Which nebula it belongs to (its index in the zone's list). */
  nebula: number;
}

/**
 * A nebula's sheets, the same every time for the same name and count: placed inside the sphere and
 * crowded toward the middle, `facingShare` of them turning to face the camera and the rest keeping a
 * fixed turn, each coloured by how far out it sits. OURS, every part of it.
 */
export function buildSheets(row: Pick<Nebula, 'name' | 'at' | 'radius' | 'facingShare' | 'facing' | 'oriented'>, index: number, count: number, tune: NebulaTune = NEBULA_TUNE): NebulaSheet[] {
  const seed = seedOfName(row.name);
  const out: NebulaSheet[] = [];
  for (let i = 0; i < count; i++) {
    const n = i * 8;
    // A direction on the sphere, and a distance from the middle crowded inward.
    const z = rand01(seed, n) * 2 - 1;
    const phi = rand01(seed, n + 1) * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const t = Math.pow(rand01(seed, n + 2), tune.centrePower);
    const d = row.radius * t;
    const x = row.at[0] + Math.cos(phi) * r * d;
    const y = row.at[1] + z * d;
    const zz = row.at[2] + Math.sin(phi) * r * d;
    const facing = rand01(seed, n + 3) < row.facingShare;
    const size = row.radius * (tune.sizeMin + (tune.sizeMax - tune.sizeMin) * rand01(seed, n + 4));
    const pair = facing ? row.facing : row.oriented;
    // A turn for the sheets that keep one: a direction to face, and a roll about it.
    const az = rand01(seed, n + 5) * Math.PI * 2;
    const el = rand01(seed, n + 6) * Math.PI - Math.PI / 2;
    const roll = rand01(seed, n + 7) * Math.PI * 2;
    const normal: [number, number, number] = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    const { right, up } = basisAbout(normal, roll);
    out.push({ x, y, z: zz, size, facing, right, up, colour: rampAt(pair.colour, pair.ramp, t), nebula: index });
  }
  return out;
}

/** Two unit vectors across a plane whose normal is `normal`, rolled about it: a fixed sheet's turn. */
export function basisAbout(normal: readonly [number, number, number], roll: number): { right: [number, number, number]; up: [number, number, number] } {
  // Any vector not along the normal will do to start from.
  const helper: [number, number, number] = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const a = norm(cross(helper, normal));
  const b = norm(cross(normal, a));
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  return {
    right: [a[0] * c + b[0] * s, a[1] * c + b[1] * s, a[2] * c + b[2] * s],
    up: [b[0] * c - a[0] * s, b[1] * c - a[1] * s, b[2] * c - a[2] * s],
  };
}

const cross = (a: readonly number[], b: readonly number[]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const norm = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * How near a nebula is pulled: the farthest nebula edges in the zones sit well past the 9 km far
 * plane, so a nebula whose middle is beyond `pullFrom` is scaled toward the camera by this ratio.
 * Scaling a whole nebula about the camera keeps its picture exactly: every sheet's apparent size and
 * place are what they were, only nearer. OURS, and our reading of the client's "far appearance".
 */
export function pullScale(distance: number, tune: NebulaTune = NEBULA_TUNE): number {
  return tune.pullFrom > 0 && distance > tune.pullFrom ? tune.pullFrom / distance : 1;
}

/** How big a sheet looks: its width across over its distance. The pull must not change this. */
export function apparentSize(size: number, distance: number): number {
  return size / Math.max(1e-6, distance);
}

/** How deep inside a nebula the camera is, 0 at the edge and 1 once it is `insideOver` of the radius in. OURS. */
export function insideDepth(distance: number, radius: number, tune: NebulaTune = NEBULA_TUNE): number {
  if (radius <= 0) return 0;
  return clamp((radius - distance) / (radius * Math.max(0.05, tune.insideOver)), 0, 1);
}

/** Where the camera stands in the nebulae: which one it is deepest inside (-1 for none) and how deep. */
export interface InsideAt {
  index: number;
  depth: number;
}

/**
 * Which nebula the camera is deepest inside (by depth times the row's density), and how deep, written
 * into `out` and returned. It is asked once a frame, so it takes the object to fill rather than
 * making one; a caller with none of its own gets a shared one, which is only safe because the answer
 * is read straight away.
 */
const insideShared: InsideAt = { index: -1, depth: 0 };

export function deepestInside(
  rows: readonly { at: readonly [number, number, number]; radius: number; density: number }[],
  cx: number,
  cy: number,
  cz: number,
  tune: NebulaTune = NEBULA_TUNE,
  out: InsideAt = insideShared,
): InsideAt {
  let index = -1;
  let best = 0;
  let depth = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const d = insideDepth(Math.hypot(r.at[0] - cx, r.at[1] - cy, r.at[2] - cz), r.radius, tune);
    if (d <= 0) continue;
    const score = d * Math.max(0.05, r.density);
    if (score > best) {
      best = score;
      index = i;
      depth = d;
    }
  }
  out.index = index;
  out.depth = depth;
  return out;
}

/**
 * `order[0..count)` sorted so that `keys[order[i]]` runs from largest to smallest: the sheets far to
 * near. A merge sort down a scratch buffer made once, because `%TypedArray%.sort` with a comparator
 * allocates both the comparator's closure and a working copy of the array on every call, and this
 * runs while the player is flying.
 */
export function sortFarToNear(order: Int32Array, keys: Float32Array, count: number, scratch: Int32Array): void {
  if (count < 2) return;
  let src = order;
  let dst = scratch;
  for (let width = 1; width < count; width *= 2) {
    for (let lo = 0; lo < count; lo += width * 2) {
      const mid = Math.min(lo + width, count);
      const hi = Math.min(lo + width * 2, count);
      let a = lo;
      let b = mid;
      for (let i = lo; i < hi; i++) {
        // Largest key first; equal keys keep the order they came in, so the picture never flickers.
        if (a < mid && (b >= hi || keys[src[a]] >= keys[src[b]])) dst[i] = src[a++];
        else dst[i] = src[b++];
      }
    }
    const swap = src;
    src = dst;
    dst = swap;
  }
  // An odd number of passes leaves the answer in the scratch buffer; copy it back by hand, since
  // `set` would want a view of it and a view is an object made on the spot.
  if (src !== order) for (let i = 0; i < count; i++) order[i] = src[i];
}

/** A waveform point as the particle reader gives it: [percent, value, randomMin, randomMax]. */
export type WavePoint = readonly number[];

/** A waveform read at `t` (0 to 1), straight between its points; 0 without any. */
export function waveAt(points: readonly WavePoint[], t: number): number {
  if (!points.length) return 0;
  const k = clamp(t, 0, 1);
  if (k <= points[0][0]) return points[0][1] ?? 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (k <= b[0]) {
      const span = b[0] - a[0];
      const f = span > 1e-6 ? (k - a[0]) / span : 0;
      return (a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) * f;
    }
  }
  return points[points.length - 1][1] ?? 0;
}

/**
 * A waveform sampled into `n` points and scaled so its largest value is 1: what a shader reads to
 * shape a bolt. The curves in the one lightning appearance the zones name both end at their
 * maximum, which is why neither is read as the bolt's alpha in time unless `waveAlpha` asks for it:
 * a bolt at its brightest in the instant it vanishes is not what a strike looks like. Read along the
 * bolt instead, the first curve widens it from its start and the second says how far it wanders;
 * with `waveAlpha` on, the second is how bright it is along its length and the wander is even.
 *
 * The scaling to 1 throws the curve's own magnitudes away (the one appearance's curves rise to 8
 * with a plateau at 3), because what those numbers are in is not known: `beamWidth` and
 * `beamWander`, both ours, put them back in metres. If they turn out to be metres already, the
 * scaling here is what to take out.
 */
export function beamCurves(points: readonly WavePoint[], n: number): number[] {
  const out: number[] = [];
  let max = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, waveAt(points, n > 1 ? i / (n - 1) : 0));
    out.push(v);
    if (v > max) max = v;
  }
  if (max > 0) for (let i = 0; i < n; i++) out[i] /= max;
  else for (let i = 0; i < n; i++) out[i] = 1;
  return out;
}

/** One strike of one nebula: when it began, how long it lasts, its two ends (offsets from the middle) and its damage roll. */
export interface NebulaStrike {
  /** Milliseconds on the strike clock (the clock the weather reads). */
  at: number;
  seconds: number;
  from: [number, number, number];
  to: [number, number, number];
  /** 0 to 1 across the row's damage band. */
  roll: number;
  /** The tick it came from, so the same strike is never started twice. */
  tick: number;
}

/** A strike record to fill. */
export function newStrike(): NebulaStrike {
  return { at: 0, seconds: 0, from: [0, 0, 0], to: [0, 0, 0], roll: 0, tick: 0 };
}

/**
 * One tick of the strike clock, in whole milliseconds, so every browser cuts the clock at the same
 * places whatever `strikeTick` is set to.
 */
export function tickMs(tune: NebulaTune = NEBULA_TUNE): number {
  return Math.max(1, Math.round(tune.strikeTick * 1000));
}

/** Which tick a wall-clock moment falls in. */
export function tickOf(ms: number, tune: NebulaTune = NEBULA_TUNE): number {
  return Math.floor(ms / tickMs(tune));
}

/**
 * Whether tick `tick` of one nebula strikes, and the strike when it does, written into `out`. The
 * chance is the game's for a moment one tick long (READ: the tick times the row's rate, never more
 * than `strikeChanceCap`), drawn from a hash of the nebula's seed and the tick rather than a random
 * number, so it is the same in every browser. Both ends fall anywhere in the cube `strikeCube` of
 * the radius either side of the middle, each axis on its own, and the life is half to all of the
 * row's longest (both READ). The moment is the tick's start. Nothing is made. `force` takes the
 * tick's strike whether or not the chance fell for it: the console's, which will not wait.
 */
export function strikeOfTick(seed: number, tick: number, every: number, maxSeconds: number, radius: number, tune: NebulaTune, out: NebulaStrike, force = false): boolean {
  if (!(every > 0)) return false;
  const n = tick * 16;
  const chance = Math.min(tune.strikeChanceCap, tune.strikeTick * every);
  if (!force && !(rand01(seed, n) < chance)) return false;
  const h = radius * tune.strikeCube;
  out.at = tick * tickMs(tune);
  // A floor of a twentieth of a second (OURS), so a row that names no length still shows a flicker.
  out.seconds = Math.max(0.05, maxSeconds * (tune.strikeLifeMin + tune.strikeLifeSpan * rand01(seed, n + 1)));
  out.from[0] = (rand01(seed, n + 2) * 2 - 1) * h;
  out.from[1] = (rand01(seed, n + 3) * 2 - 1) * h;
  out.from[2] = (rand01(seed, n + 4) * 2 - 1) * h;
  out.to[0] = (rand01(seed, n + 5) * 2 - 1) * h;
  out.to[1] = (rand01(seed, n + 6) * 2 - 1) * h;
  out.to[2] = (rand01(seed, n + 7) * 2 - 1) * h;
  out.roll = rand01(seed, n + 8);
  out.tick = tick;
  return true;
}

/** The record `strikesBetween` tries each tick into, so a tick that does not strike makes nothing. */
const tickScratch = newStrike();

/**
 * Every strike of one nebula that began in (`fromMs`, `toMs`], oldest first, pushed into `out`.
 * Nothing is allocated when nothing struck. A gap longer than `catchUpSeconds` (a paused tab, a
 * loading screen) is taken from its end, so nothing ever catches up with a burst.
 */
export function strikesBetween(seed: number, every: number, maxSeconds: number, radius: number, fromMs: number, toMs: number, out: NebulaStrike[], tune: NebulaTune = NEBULA_TUNE, catchUpSeconds = tune.catchUpSeconds): NebulaStrike[] {
  out.length = 0;
  if (!(every > 0) || !(toMs > fromMs)) return out;
  const step = tickMs(tune);
  // A tick belongs to the window its start falls in: after `fromMs`, up to and including `toMs`.
  const last = Math.floor(toMs / step);
  let first = Math.floor(fromMs / step) + 1;
  const most = Math.max(1, Math.floor((Math.max(0, catchUpSeconds) * 1000) / step));
  if (last - first + 1 > most) first = last - most + 1;
  for (let tick = first; tick <= last; tick++) {
    if (!strikeOfTick(seed, tick, every, maxSeconds, radius, tune, tickScratch)) continue;
    const s = newStrike();
    s.at = tickScratch.at;
    s.seconds = tickScratch.seconds;
    s.from[0] = tickScratch.from[0];
    s.from[1] = tickScratch.from[1];
    s.from[2] = tickScratch.from[2];
    s.to[0] = tickScratch.to[0];
    s.to[1] = tickScratch.to[1];
    s.to[2] = tickScratch.to[2];
    s.roll = tickScratch.roll;
    s.tick = tick;
    out.push(s);
  }
  return out;
}

/** READ: a nebula strikes only when it names a lightning appearance, strikes at some rate, and has some density at all. */
export function rowStrikes(row: Pick<Nebula, 'lightning' | 'density'>): boolean {
  return !!row.lightning && row.lightning.every > 0 && row.density > 0;
}

/**
 * How many strike records a zone's nebulae are given, worked out once from the zone's own rows when
 * they are built: enough for all of its striking rows at once, so a strike is not lost for want of a
 * record however near the camera the busiest of them are. A row strikes at most its rate a second
 * (never over the game's cap on a tick) and a strike stands at most the row's longest life, so a
 * row holds on average no more than the two multiplied standing at any moment. Rows that share a
 * name share a seed and strike on the same ticks, so a group of them is one storm whose every strike
 * stands in each of its rows at once: three of Corellia's names stand for nine rows. The zone is
 * given its rows' sum, then `liveSpread` times how far such a count strays from its mean (the square
 * root of the sum, each group's share counted as many times over as it has rows), then `liveSpread`
 * of its largest group's strikes in spare, never fewer than `liveStrikes` and never more than
 * `liveMost`. OURS, all of it. Kessel's, the busiest retail zone, comes to about fifty.
 */
export function strikeRecords(rows: readonly Pick<Nebula, 'name' | 'lightning' | 'density'>[], tune: NebulaTune = NEBULA_TUNE): number {
  const most = Math.max(1, tune.strikeChanceCap / Math.max(1e-3, tune.strikeTick));
  // Made when the zone is built, never in a frame.
  const groups = new Map<string, { load: number; rows: number }>();
  for (const r of rows) {
    if (!rowStrikes(r)) continue;
    const bolt = r.lightning!;
    const load = Math.min(bolt.every, most) * Math.max(0.05, Number.isFinite(bolt.maxSeconds) ? bolt.maxSeconds : 0);
    const g = groups.get(r.name);
    if (g) {
      g.load += load;
      g.rows++;
    } else groups.set(r.name, { load, rows: 1 });
  }
  let load = 0;
  let strays = 0;
  let batch = 1;
  for (const g of groups.values()) {
    load += g.load;
    strays += g.rows * g.load;
    batch = Math.max(batch, g.rows);
  }
  const spread = Math.max(0, tune.liveSpread);
  const want = Math.ceil(load + spread * Math.sqrt(strays) + spread * batch);
  const floor = Math.max(1, Math.round(tune.liveStrikes));
  return Math.max(floor, Math.min(Math.max(floor, Math.round(tune.liveMost)), want));
}

/** The nearest point on a segment to a point: where it is, how far along (0 to 1), and how far off. */
export interface SegmentReach {
  x: number;
  y: number;
  z: number;
  t: number;
  distance: number;
}

/**
 * The nearest point on the segment from (ax, ay, az) to (bx, by, bz) to the point (px, py, pz),
 * written into `out`, and its distance returned. A segment of no length is its one point.
 */
export function segmentReach(ax: number, ay: number, az: number, bx: number, by: number, bz: number, px: number, py: number, pz: number, out: SegmentReach): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  const t = len2 > 1e-12 ? clamp(((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / len2, 0, 1) : 0;
  out.x = ax + dx * t;
  out.y = ay + dy * t;
  out.z = az + dz * t;
  out.t = t;
  out.distance = Math.hypot(px - out.x, py - out.y, pz - out.z);
  return out.distance;
}

/** What a strike does to a ship: the table's band at the roll, times the share the owner chose (0 with damage off). */
export function strikeDamage(band: readonly [number, number], roll: number, enabled: boolean, tune: NebulaTune = NEBULA_TUNE): number {
  if (!enabled) return 0;
  const lo = Math.min(band[0], band[1]);
  const hi = Math.max(band[0], band[1]);
  return (lo + (hi - lo) * clamp(roll, 0, 1)) * tune.damageShare;
}

/** How bright a bolt is through its life: up quickly, held, then out. OURS; see `beamCurves`. */
export function beamEnvelope(age: number, seconds: number, tune: NebulaTune = NEBULA_TUNE): number {
  if (seconds <= 0) return 0;
  const t = age / seconds;
  if (t < 0 || t > 1) return 0;
  const rise = Math.max(0.01, tune.beamRise);
  const hold = clamp(tune.beamHold, 0, 1 - rise);
  if (t < rise) return t / rise;
  if (t < rise + hold) return 1;
  const left = 1 - rise - hold;
  return left > 1e-6 ? 1 - (t - rise - hold) / left : 0;
}

/** The camera shake inside a nebula: turn in radians and a shift in metres, from the row's jitter and how deep in you are. */
export interface ViewShake {
  yaw: number;
  pitch: number;
  roll: number;
  x: number;
  y: number;
}

/**
 * The shake at a moment. Sums of sines rather than random numbers, so it is smooth, repeatable and
 * costs nothing; three rates that do not divide into one another, so it never reads as a loop.
 */
export function shakeAt(seconds: number, amount: number, out: ViewShake, tune: NebulaTune = NEBULA_TUNE): ViewShake {
  const a = clamp(amount, 0, 1);
  if (a <= 0) {
    out.yaw = out.pitch = out.roll = out.x = out.y = 0;
    return out;
  }
  const w = seconds * tune.shakeHz * Math.PI * 2;
  const turn = tune.shakeTurn * a;
  const shift = tune.shakeShift * a;
  out.yaw = Math.sin(w) * turn;
  out.pitch = Math.sin(w * 1.37 + 1.1) * turn * 0.8;
  out.roll = Math.sin(w * 0.79 + 2.3) * turn * 0.6;
  out.x = Math.sin(w * 1.11 + 0.7) * shift;
  out.y = Math.sin(w * 1.53 + 2.9) * shift;
  return out;
}

/** How much of the lens flare (or of the god rays) is left at this depth inside a nebula. OURS. */
export function dimInside(depth: number, share: number): number {
  return clamp(1 - clamp(depth, 0, 1) * clamp(share, 0, 1), 0, 1);
}

/** The player's Nebula opacity as the nebulae read it: 0 to 1, and 1 for anything that is not a number. */
export function clampOpacity(opacity: number): number {
  return Number.isFinite(opacity) ? clamp(opacity, 0, 1) : 1;
}

/**
 * How deep in a nebula the flare and the god rays are dimmed as if the camera were, with its sheets
 * and its haze thinned to `opacity`: a nebula drawn at half its strength takes half as much off the
 * sun as it would, and one drawn at nothing takes nothing. Fed to `dimInside` in the depth's place.
 */
export function seenDepth(depth: number, opacity: number): number {
  return clamp(depth, 0, 1) * clampOpacity(opacity);
}
