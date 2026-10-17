// The engines of a vehicle raced as a pod or a bike (the design's §7.1): a pod has two engines of three parts each, a
// bike one engine of three, by the kind it was spawned as. A part takes damage from a scrape on its side and from a hard
// landing, catches fire when the engines overheat, burns on until it is repaired or burnt out, and a burnt-out part
// stays out; the pod itself is never blown up by a fire. Damaged parts pull the stick toward their own side, a part out
// or burning refuses the boost, every part out takes a share off the top, and a side with every part out holds the
// pod to a limp. Holding the repair key mends the worst part, at the cost of the same limp while it is held.
//
// The shape of it -- six parts, three a side, the pull, the repair costing speed -- is the shape Star Wars: Racer's
// pods have, described in our own words; every number is ours, in `ENGINE_TUNE`, each with the feel it was chosen for.
//
// Pure: no three, no page, no physics, so node runs it as it stands (`tools/swg/tests/drivetrain.test.ts`), and the
// race drive (`raceDrive.ts`) is the only thing in the game that steps it. A step makes nothing: everything it is
// handed and everything it answers is a field of the set itself.

/** Every number of the engines: all ours, each with what it is for. */
export const ENGINE_TUNE = {
  /** A scrape damages one part of the struck side by this much a m/s past the hit threshold: a light graze marks a part, a hard glance at full speed burns one out. */
  scrapePart: 0.006,
  /** A hard landing damages a random part by this much a m/s past the strike's hurt, never more than `strikeMost`: a bad landing is felt in the engines, never ruinous. */
  strikePart: 0.004,
  strikeMost: 0.05,
  /** The hull takes this share of what a scrape cost it before the engines had parts: the parts take the rest. */
  hullShare: 1 / 3,
  /** A burning part burns out in about eight seconds from whole, long enough to reach for the repair. */
  fireRate: 0.12,
  /** A part pulls once it is more than half gone, each such part this much of the stick toward its own side: one turns the pod at about a twentieth of its rate with the stick centred, three on a side at about two-fifths, which full opposite lock still beats. */
  pullAt: 0.6,
  pullPart: 0.22,
  /** While a side is repaired the stick is pulled this much toward it: the repair is felt in the hands. */
  repairPull: 0.1,
  /** The repair key held this long before it starts: a tap does nothing. */
  repairHold: 0.4,
  /** A side with every part out, or a repair under way, holds the pod under this share of its plain top: a crippled pod limps home at three-fifths of its speed. */
  limp: 0.6,
  /** Each part out takes this share of the top: the same share of a whole engine set on a pod's six parts and a bike's three. */
  outTopPod: 0.06,
  outTopBike: 0.12,
  /** The damage bands a side's worst part shows at its rear point: light smoke, burning (or any part on fire), heavy smoke. */
  smokeLight: 0.25,
  burnAt: 0.5,
  smokeHeavy: 0.75,
  /** Over a flow the engines lose this much of their coolness a second (of 100): a few seconds of lava overheats them. */
  lavaHeat: 25,
  /** A pod's glows stand on every engine point within this many metres of its side's rearmost (`racerThrusters`). */
  rearTolerance: 2,
};

export type EngineTune = typeof ENGINE_TUNE;

/** One part: its damage 0 (whole) to 1 (gone), the seconds it has been burning (0: not on fire), and whether it is out. */
export interface EnginePart {
  d: number;
  fire: number;
  out: boolean;
}

/**
 * A vehicle's engine parts and what they answer each step, all of it kept here. Parts 0 to 2 are the left engine and 3
 * to 5 the right on a pod (left is the pilot's left, +x in the vehicle's frame), and 0 to 2 the one engine of a bike;
 * within an engine the part's index is top, middle and bottom.
 */
export interface EngineSet {
  /** Two engines (a pod) or one (a bike). */
  readonly sides: 1 | 2;
  readonly parts: EnginePart[];
  // --- what a step is handed -----------------------------------------------------------------------------------------
  /** The step's seconds, whether the repair key is held, and the repair rate (a part's damage a second). */
  dt: number;
  wantRepair: boolean;
  rate: number;
  // --- what a step answers -------------------------------------------------------------------------------------------
  /** Seconds the repair key has been held, and the part being repaired now (-1: none). */
  held: number;
  repairing: number;
  /** The stick's offset this step: below nought toward the left, above it toward the right. */
  pull: number;
  /** The share of the plain top the parts allow now (1 whole), and whether it is held at the limp. */
  top: number;
  limp: boolean;
  /** Whether the boost may run: no part out or burning, and no repair under way. */
  boostOk: boolean;
  /** Each engine's thrust, the mean of (1 - damage) over its parts, nought for a part out: what its glows scale with. */
  readonly thrust: Float64Array;
  /** A bit per part out and per part burning, and the mean damage over every part. */
  outBits: number;
  burnBits: number;
  mean: number;
}

/**
 * A whole engine set for a vehicle raced as a pod (two engines) or a bike (one). Every number starts as a fraction and
 * is then set, so each field holds a number of its own from the first and a step writes it in place.
 */
export function newEngineSet(kind: 'pod' | 'bike'): EngineSet {
  const sides = kind === 'pod' ? 2 : 1;
  const parts: EnginePart[] = [];
  for (let i = 0; i < sides * 3; i++) {
    const p: EnginePart = { d: 0.5, fire: 0.5, out: false };
    p.d = 0;
    p.fire = 0;
    parts.push(p);
  }
  const set: EngineSet = { sides, parts, dt: 0.5, wantRepair: false, rate: 0.5, held: 0.5, repairing: -1, pull: 0.5, top: 1.5, limp: false, boostOk: true, thrust: new Float64Array(2), outBits: 0, burnBits: 0, mean: 0.5 };
  set.dt = 0;
  set.rate = 0;
  set.held = 0;
  set.pull = 0;
  set.top = 1;
  set.mean = 0;
  set.thrust[0] = 1;
  set.thrust[1] = 1;
  return set;
}

/** Which engine a part is on: 0 the left (or a bike's one), 1 the right. */
export function partSide(set: EngineSet, i: number): number {
  return set.sides === 1 || i < 3 ? 0 : 1;
}

/**
 * The side a lost velocity struck: `l` the velocity a step lost (commanded less what was left, pointing into what was
 * struck), `right` the pilot's right. 1 the right engine, 0 the left; met square on, a coin decides.
 */
export function hitSide(lx: number, lz: number, rightX: number, rightZ: number, rand: () => number): number {
  const along = lx * rightX + lz * rightZ;
  if (Math.abs(along) < 1e-6) return rand() < 0.5 ? 0 : 1;
  return along > 0 ? 1 : 0;
}

/** A part taking damage: burnt out at 1, its fire out with it. */
function hurt(p: EnginePart, amount: number): void {
  if (p.out || !(amount > 0)) return;
  p.d = Math.min(1, p.d + amount);
  if (p.d >= 1) {
    p.d = 1;
    p.out = true;
    p.fire = 0;
  }
}

/** Damage on one random part of a side that is not out (a bike's one engine whatever the side); the part's index, or -1 when every part there is out. */
export function damagePart(set: EngineSet, side: number, amount: number, rand: () => number): number {
  const from = set.sides === 1 ? 0 : side === 1 ? 3 : 0;
  let live = 0;
  for (let i = from; i < from + 3; i++) if (!set.parts[i].out) live++;
  if (!live) return -1;
  let pick = Math.min(live - 1, Math.floor(rand() * live));
  for (let i = from; i < from + 3; i++) {
    if (set.parts[i].out) continue;
    if (pick-- === 0) {
      hurt(set.parts[i], amount);
      return i;
    }
  }
  return -1;
}

/** Damage on one random part of the whole set that is not out (a hard landing); its index, or -1. */
export function damageAny(set: EngineSet, amount: number, rand: () => number): number {
  let live = 0;
  for (const p of set.parts) if (!p.out) live++;
  if (!live) return -1;
  let pick = Math.min(live - 1, Math.floor(rand() * live));
  for (let i = 0; i < set.parts.length; i++) {
    if (set.parts[i].out) continue;
    if (pick-- === 0) {
      hurt(set.parts[i], amount);
      return i;
    }
  }
  return -1;
}

/**
 * The engines overheated: one part set on fire, chosen uniformly among the parts that can catch (not out, not already
 * burning). Its index, or -1 when none can.
 */
export function overheat(set: EngineSet, rand: () => number): number {
  let live = 0;
  for (const p of set.parts) if (!p.out && p.fire <= 0) live++;
  if (!live) return -1;
  let pick = Math.min(live - 1, Math.floor(rand() * live));
  for (let i = 0; i < set.parts.length; i++) {
    const p = set.parts[i];
    if (p.out || p.fire > 0) continue;
    if (pick-- === 0) {
      // Burning from this moment: the clock is a hair over nought, so "on fire" reads true on the very step it caught.
      p.fire = 1e-6;
      return i;
    }
  }
  return -1;
}

/** Every burning part burns on for the step's seconds (`set.dt`), out at whole damage and its fire with it; a fire never does anything more. */
export function burn(set: EngineSet, tune: EngineTune = ENGINE_TUNE): void {
  const dt = set.dt;
  for (const p of set.parts) {
    if (p.fire <= 0 || p.out) continue;
    p.fire += dt;
    p.d = Math.min(1, p.d + tune.fireRate * dt);
    if (p.d >= 1) {
      p.d = 1;
      p.out = true;
      p.fire = 0;
    }
  }
}

/**
 * The repair key over the step (`set.wantRepair`, `set.dt`, `set.rate`): held past `repairHold`, the worst part (the
 * most damage, the first on a tie) is mended at the rate, its fire put out at once, and an out part brought back the
 * moment its damage is under whole. Let go, it starts again from nought. Nothing to mend, nothing is repaired.
 */
export function repairStep(set: EngineSet, tune: EngineTune = ENGINE_TUNE): void {
  if (!set.wantRepair) {
    set.held = 0;
    set.repairing = -1;
    return;
  }
  set.held += set.dt;
  set.repairing = -1;
  if (set.held < tune.repairHold) return;
  let worst = -1;
  let most = 0;
  for (let i = 0; i < set.parts.length; i++) {
    const p = set.parts[i];
    const d = p.out ? 1 : p.d;
    if (d > most || (p.fire > 0 && worst < 0)) {
      if (d > most) most = d;
      worst = i;
    }
  }
  if (worst < 0) return;
  const p = set.parts[worst];
  set.repairing = worst;
  p.fire = 0;
  p.d = Math.max(0, p.d - set.rate * set.dt);
  if (p.out && p.d < 1) p.out = false;
}

/**
 * The stick's pull from the parts (`set.pull`): each part at `pullAt` or worse adds `pullPart` toward its own side (a
 * side losing thrust yaws toward itself), the same either way round, and a side under repair adds `repairPull` toward
 * it. A bike's one engine has no side to pull to.
 */
export function pullOf(set: EngineSet, tune: EngineTune = ENGINE_TUNE): void {
  if (set.sides === 1) {
    set.pull = 0;
    return;
  }
  let left = 0;
  let right = 0;
  for (let i = 0; i < 6; i++) {
    const p = set.parts[i];
    if (!p.out && p.d < tune.pullAt) continue;
    if (i < 3) left++;
    else right++;
  }
  let pull = tune.pullPart * (right - left);
  if (set.repairing >= 0) pull += partSide(set, set.repairing) === 1 ? tune.repairPull : -tune.repairPull;
  set.pull = pull;
}

/** The share of the plain top the parts out leave, before any limp: `outTop` off for each. */
export function outShare(set: EngineSet, tune: EngineTune = ENGINE_TUNE): number {
  let out = 0;
  for (const p of set.parts) if (p.out) out++;
  return 1 - (set.sides === 2 ? tune.outTopPod : tune.outTopBike) * out;
}

/** The cap a limp puts on the plain top: `limp` while an engine has every part out or a repair is under way, else 1. */
export function throttleCap(set: EngineSet, tune: EngineTune = ENGINE_TUNE): number {
  return limping(set) ? tune.limp : 1;
}

/** Whether an engine has every part out, or a part is being repaired. */
function limping(set: EngineSet): boolean {
  if (set.repairing >= 0) return true;
  for (let side = 0; side < set.sides; side++) {
    const from = side * 3;
    if (set.parts[from].out && set.parts[from + 1].out && set.parts[from + 2].out) return true;
  }
  return false;
}

/** Whether the boost may run: no part out or burning, and no repair under way. */
export function boostAllowed(set: EngineSet): boolean {
  if (set.repairing >= 0) return false;
  for (const p of set.parts) if (p.out || p.fire > 0) return false;
  return true;
}

/**
 * One step of the engines, everything handed in and answered through the set: the repair, the fires, then the pull,
 * the top's share and the limp, whether the boost may run, each engine's thrust, the bits and the mean damage.
 */
export function stepEngines(set: EngineSet, tune: EngineTune = ENGINE_TUNE): void {
  repairStep(set, tune);
  burn(set, tune);
  pullOf(set, tune);
  let out = 0;
  let outBits = 0;
  let burnBits = 0;
  let sum = 0;
  let boostOk = set.repairing < 0;
  set.thrust[0] = 0;
  set.thrust[1] = 0;
  for (let i = 0; i < set.parts.length; i++) {
    const p = set.parts[i];
    sum += p.out ? 1 : p.d;
    if (p.out) {
      out++;
      outBits |= 1 << i;
      boostOk = false;
    } else set.thrust[set.sides === 1 || i < 3 ? 0 : 1] += 1 - p.d;
    if (p.fire > 0) {
      burnBits |= 1 << i;
      boostOk = false;
    }
  }
  set.thrust[0] /= 3;
  set.thrust[1] = set.sides === 1 ? set.thrust[0] : set.thrust[1] / 3;
  set.outBits = outBits;
  set.burnBits = burnBits;
  set.mean = sum / set.parts.length;
  set.boostOk = boostOk;
  const limp = limping(set);
  set.limp = limp;
  const share = 1 - (set.sides === 2 ? tune.outTopPod : tune.outTopBike) * out;
  set.top = limp && tune.limp < share ? tune.limp : share;
}

/**
 * The damage band a side's rear point shows, by its worst part: 0 none, 1 light smoke from `smokeLight`, 2 burning from
 * `burnAt` or while any of its parts is on fire, 3 heavy smoke from `smokeHeavy` (a part out among them).
 */
export function sideBand(set: EngineSet, side: number, tune: EngineTune = ENGINE_TUNE): number {
  const from = set.sides === 1 ? 0 : side * 3;
  let worst = 0;
  let fire = false;
  for (let i = from; i < from + 3; i++) {
    const p = set.parts[i];
    const d = p.out ? 1 : p.d;
    if (d > worst) worst = d;
    if (p.fire > 0) fire = true;
  }
  if (worst >= tune.smokeHeavy) return 3;
  if (worst >= tune.burnAt || fire) return 2;
  if (worst >= tune.smokeLight) return 1;
  return 0;
}

/** The numbers held to a range of their own; every other one finite and not below nought. */
const ENGINE_RANGES: Partial<Record<keyof EngineTune, [number, number]>> = { hullShare: [0, 1], pullAt: [0, 1], limp: [0.05, 1], outTopPod: [0, 1 / 6], outTopBike: [0, 1 / 3], smokeLight: [0, 1], burnAt: [0, 1], smokeHeavy: [0, 1] };

/** Any number of the engines moved live (`__debug.engines({ tune })`), each held to what makes sense; words for anything refused. */
export function tuneEngines(patch: Partial<Record<keyof EngineTune, unknown>>): string[] {
  const words: string[] = [];
  const t = ENGINE_TUNE as unknown as Record<string, number>;
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(ENGINE_TUNE, key)) {
      words.push(`no engine number called ${key}`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      words.push(`${key} takes a number`);
      continue;
    }
    const range = ENGINE_RANGES[key as keyof EngineTune];
    t[key] = range ? Math.min(range[1], Math.max(range[0], value)) : Math.max(0, value);
  }
  return words;
}

/** Every part whole again, nothing burning, the repair let go (a fresh spawn, the console). */
export function mendEngines(set: EngineSet): void {
  for (const p of set.parts) {
    p.d = 0;
    p.fire = 0;
    p.out = false;
  }
  set.held = 0;
  set.repairing = -1;
}
