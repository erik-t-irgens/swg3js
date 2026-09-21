// Two lit blades meeting. A clash is not a collider: blades have none, and giving each one a body
// would put a pair of them in the solver with contacts against everything in the world. It is the
// nearest approach between two line segments, which is a dozen lines of arithmetic a node test can
// run, so `closestSegments` below is the whole of the geometry and the shader of it, so to speak,
// is the pair ring that keeps two blades resting against one another from sparking sixty times a
// second.
//
// What is the game's and what is ours: the styles and their speeds are Jedi Academy's, and nothing
// in the client's files describes two blades meeting at all, so **every number in `CLASH` is ours**,
// including the style weights, the random band, the reach and the whole idea of who gives way.
//
// Nothing here crosses the wire. Both browsers draw both blades from poses they both have, so both
// work out the same nearest approach within the glide's small error, and nothing is subtracted: the
// worst a disagreement costs is a spark on one screen and not the other.
//
// Rule for this file: the arithmetic allocates nothing and is exported on its own, and the step
// keeps its scratch at module scope, as the rest of the combat code does.
import * as THREE from 'three';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** The five styles a blade is swung in, as the clash weighs them. */
export type ClashStyle = 'fast' | 'medium' | 'strong' | 'dual' | 'staff';

/** Who may take a pooled flash light for the sparks. See `CLASH.flashBorrow`. */
export type ClashBorrow = 'free' | 'always' | 'never';

export interface ClashTune {
  /** Metres: how near two blade segments come before it is a clash. */
  reach: number;
  /** A blade less lit than this (still igniting, or retracting) never clashes. */
  minIgnition: number;
  /**
   * Metres a second of drawn tip speed at which a blade nobody has flagged counts as a swing. The
   * flag (`attacking`) is what its holder declares; this is what the blade itself measures, and
   * either one is a swing, so a holder that never learned to set the flag still clashes.
   */
  swingSpeed: number;
  /**
   * Metres a lit tip may move in one step and still be read as a swing. Above it the step was a
   * gap rather than a movement -- a hidden tab coming back, a stall, a panel closing, a travel --
   * and the frame loop clamps its own `dt`, so a large movement over a small `dt` would otherwise
   * read as a very fast swing on the first frame back. A real swing at the loop's slowest clamped
   * step (a twentieth of a second) moves its tip well under this.
   */
  tipJump: number;
  /** The style weights: a strong swing beats a fast one. */
  weights: Record<ClashStyle, number>;
  /** The random band on a weight, either way: a clash is never a lookup table. */
  band: number;
  /** Within this share of the larger roll the two are a bind and both are thrown back. */
  bind: number;
  /** Seconds before the same pair of blades may clash again. */
  again: number;
  /** Pairs remembered for `again`. Read when the ring is built: a build-only number (see below). */
  pairs: number;
  /** Blades weighed against one another in one step, and clashes reported from one step. Build-only. */
  maxBlades: number;
  maxEvents: number;
  /**
   * The shove a blade takes, 0 to 1: the loser's, the winner's, and each side of a bind, which is
   * between the two -- neither blade gave way, so neither keeps its swing and neither is thrown
   * off it. `recoilFor` is the one place these three are chosen between, and the test sweeps it.
   */
  recoilLoser: number;
  recoilWinner: number;
  recoilBind: number;
  /** Seconds the shove takes to spring out again, and the share of its lit length the blade gives. */
  recoilTime: number;
  recoilDip: number;
  /** The sparks: their colour, and whether the winning blade's own glow is used in its place. */
  sparkColor: number;
  sparkFromBlade: boolean;
  burstSize: number;
  burstLife: number;
  /**
   * The borrowed flash. The pool is four lights for the whole game and every one of them is
   * somebody's: the ship's room lights, a fighter's glow, the player's own blade and, last in the
   * frame, another player's. 'free' takes only a light standing dark, so nothing that asked
   * earlier in the frame ever loses one and a clash in a lit cabin simply sparks without a light
   * of its own; 'always' asks whatever the pool is doing, which evicts somebody (it is there to
   * compare by eye, not to run with); 'never' leaves the sparks unlit. At `flashIntensity` 0 no
   * flash is asked for at all.
   */
  flashBorrow: ClashBorrow;
  flashIntensity: number;
  flashRange: number;
  flashLife: number;
}

/**
 * The tuning, live: `__debug.clash({ reach: 0.3 })` writes here and the next frame reads it.
 * `reach: 0` is the switch that makes the game exactly what it was before clashes existed.
 */
export const CLASH: ClashTune = {
  reach: 0.18,
  minIgnition: 0.35,
  swingSpeed: 4,
  tipJump: 1.5,
  weights: { fast: 1, medium: 1.25, strong: 1.6, dual: 1.15, staff: 1.3 },
  band: 0.25,
  bind: 0.1,
  again: 0.35,
  pairs: 24,
  maxBlades: 16,
  maxEvents: 8,
  recoilLoser: 1,
  recoilWinner: 0.45,
  recoilBind: 0.85,
  recoilTime: 0.22,
  recoilDip: 0.3,
  sparkColor: 0xfff0c8,
  sparkFromBlade: false,
  burstSize: 0.9,
  burstLife: 0.18,
  flashBorrow: 'free',
  flashIntensity: 14,
  flashRange: 7,
  flashLife: 0.14,
};

/**
 * The three numbers of `CLASH` that are spent when the one `Clashes` is built and are never read
 * again, so moving them from the console would report a change that did not happen: the knob
 * refuses them by name and `status().buildOnly` says what is really in force.
 */
export const CLASH_BUILD_ONLY: readonly string[] = ['pairs', 'maxBlades', 'maxEvents'];

/** A blade as the clashes read it: `SaberBlade` answers all of it, and so would anything else that draws one. */
export interface ClashBlade {
  /** One number per blade renderer ever made, so a pair of blades has a key with no object in it. */
  readonly id: number;
  /**
   * Whoever holds it. Two blades that share an owner never clash (a staff's two halves are one
   * hand's, and so are the dual style's), and 0 is "nobody said": two of those never clash either,
   * since the commonest pair of unnamed blades is exactly that staff. **A holder that never sets
   * this cannot clash with another holder that never sets it either** -- see `status().unnamed`,
   * which counts the lit blades nobody has named, and `snippets.md`, which names each holder.
   */
  readonly owner: number;
  /** Lit and drawn this frame, with every parent visible up to a scene. */
  readonly glowing: boolean;
  /** How far out the blade is, 0 to 1. */
  readonly ignition: number;
  /** World space, as drawn this frame: the emitter and the end of the lit part. */
  readonly drawnBase: Vec3Like;
  readonly drawnTip: Vec3Like;
  /** Its holder's swing that can hurt (the player's `bladeActive`, a fighter's swing window). */
  readonly attacking: boolean;
  /** Metres a second the drawn tip is moving, as the renderer measured it. */
  readonly tipSpeed: number;
  /** The style's weight in a clash; 1 when nobody named a style. */
  readonly clashWeight: number;
  /** The glow's colour, for the sparks when the tune asks for the blade's own. */
  readonly clashColor: number;
  /** Thrown back: the renderer's own give, and whatever its holder hung on it. */
  clashed(loser: boolean, bind: boolean): void;
}

/** Anything that may be holding one blade: a fighter, a person from the catalogue, another player's hand. */
export interface ClashHolder {
  readonly saber: ClashBlade | null;
}

/**
 * What the sparks are drawn with: `Effects`, which pools its meshes and its lights. `lightPool` is
 * how many of the four are standing dark, which is what keeps a clash from taking one away from
 * the room lights, a fighter's glow or another player's blade.
 */
export interface ClashEffects {
  readonly lightPool: readonly { readonly intensity: number }[];
  burst(pos: THREE.Vector3, color: number, size: number, life: number): void;
  flash(pos: THREE.Vector3, color: number, intensity: number, distance: number, life: number): void;
}

/** What the sparks are heard with: the saber sounds' own contact, whose bank already carries the ring. */
export interface ClashSound {
  contact(kind: 'clash', at?: Vec3Like): void;
}

/** Where two blades met, kept between steps and rewritten in place. */
export interface ClashEvent {
  /** World space: the middle of the nearest pair of points on the two blades. */
  readonly at: THREE.Vector3;
  color: number;
  /** Neither gave way: both were thrown back. */
  bind: boolean;
  /** The two blades' ids, the first being the winner unless it was a bind. */
  a: number;
  b: number;
}

/** The nearest points of two segments: where they are on each, and where the pair's middle is. */
export interface NearestPair {
  /** 0..1 along the first segment and along the second. */
  s: number;
  t: number;
  /** The middle of the two nearest points. */
  x: number;
  y: number;
  z: number;
}

const EPS = 1e-9;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The squared distance between segments p1-q1 and p2-q2, with `out` filled with where on each the
 * nearest points lie and the middle of them. Allocation-free, and correct for every configuration
 * the blades get into: crossing, passing, parallel, end to end, and either segment a point.
 */
export function closestSegments(p1: Vec3Like, q1: Vec3Like, p2: Vec3Like, q2: Vec3Like, out: NearestPair): number {
  const d1x = q1.x - p1.x;
  const d1y = q1.y - p1.y;
  const d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x;
  const d2y = q2.y - p2.y;
  const d2z = q2.z - p2.z;
  const rx = p1.x - p2.x;
  const ry = p1.y - p2.y;
  const rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0;
  let t = 0;
  if (a <= EPS && e <= EPS) {
    // Both are points.
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      // Parallel (denom 0): any s does, so take the start and let t below find the overlap.
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const c1x = p1.x + d1x * s;
  const c1y = p1.y + d1y * s;
  const c1z = p1.z + d1z * s;
  const c2x = p2.x + d2x * t;
  const c2y = p2.y + d2y * t;
  const c2z = p2.z + d2z * t;
  out.s = s;
  out.t = t;
  out.x = (c1x + c2x) * 0.5;
  out.y = (c1y + c2y) * 0.5;
  out.z = (c1z + c2z) * 0.5;
  const dx = c1x - c2x;
  const dy = c1y - c2y;
  const dz = c1z - c2z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Who gives way: each blade's weight times its own roll in the band, and within `CLASH.bind` of one
 * another neither does. Returns 1 when the first wins, -1 when the second does, 0 for a bind. The
 * rolls are 0..1 and come from the caller, so a test pins the answer without pinning the dice.
 */
export function clashOutcome(weightA: number, weightB: number, rollA: number, rollB: number): number {
  const sa = Math.max(0, weightA) * (1 + CLASH.band * (rollA * 2 - 1));
  const sb = Math.max(0, weightB) * (1 + CLASH.band * (rollB * 2 - 1));
  const most = Math.max(sa, sb, EPS);
  if (Math.abs(sa - sb) <= CLASH.bind * most) return 0;
  return sa > sb ? 1 : -1;
}

/**
 * The give a blade takes from a clash, 0 to 1. Three outcomes and three numbers: the blade that
 * gave way takes `recoilLoser`, the one that kept its swing `recoilWinner`, and in a bind -- where
 * neither gave way -- both take `recoilBind`, which sits between the two. This is the one place
 * the three are chosen between, so the test sweeps it rather than a renderer.
 */
export function recoilFor(loser: boolean, bind: boolean): number {
  const v = bind ? CLASH.recoilBind : loser ? CLASH.recoilLoser : CLASH.recoilWinner;
  return clamp01(v);
}

/** The give left after `dt` seconds: it springs out again over `CLASH.recoilTime`. */
export function recoilAfter(recoil: number, dt: number): number {
  if (!(recoil > 0)) return 0;
  const v = recoil - dt / Math.max(0.01, CLASH.recoilTime);
  return v > 0 ? v : 0;
}

/**
 * The length a blade draws with that give in it: `full` is its reach, `lit` how far out it is, and
 * at the moment of a full clash it is short by `CLASH.recoilDip` of itself. Purely the drawn
 * blade: the hit sweep reads the player's own segments and cuts its whole length whatever this says.
 */
export function recoilReach(full: number, lit: number, recoil: number): number {
  return full * lit * (1 - CLASH.recoilDip * clamp01(recoil));
}

/**
 * Metres a second a tip that moved `moved` metres over `dt` is going, or 0 when that step was a gap
 * rather than a movement (`CLASH.tipJump`). The frame loop clamps `dt`, so without this the first
 * frame after a hidden tab, a stall or a panel divides a whole room's worth of tip movement by a
 * twentieth of a second and a blade merely carried reads as a swing.
 */
export function tipSpeedOf(moved: number, dt: number): number {
  if (!(dt > 1e-5) || !(moved > 0)) return 0;
  return moved > CLASH.tipJump ? 0 : moved / dt;
}

/**
 * The pairs of blades that have clashed lately, so two blades lying against one another spark once
 * rather than every frame. A fixed ring: `size` entries made with it, written round and never
 * grown, and an entry older than the delay is simply free ground.
 */
export class ClashRing {
  private readonly lo: Int32Array;
  private readonly hi: Int32Array;
  private readonly when: Float64Array;
  private next = 0;

  constructor(size: number) {
    const n = Math.max(1, Math.floor(size));
    this.lo = new Int32Array(n);
    this.hi = new Int32Array(n);
    this.when = new Float64Array(n).fill(-Infinity);
  }

  /** How many pairs it holds. */
  get size(): number {
    return this.lo.length;
  }

  /** Every pair forgotten: a world unload, a travel, the select screen. */
  clear(): void {
    this.lo.fill(0);
    this.hi.fill(0);
    this.when.fill(-Infinity);
    this.next = 0;
  }

  /**
   * True when blades `a` and `b` may clash at `now`, which also remembers that they did. False while
   * `CLASH.again` has not passed since their last one. The two ids are a pair whichever way round
   * they come.
   */
  take(a: number, b: number, now: number): boolean {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    let free = -1;
    for (let i = 0; i < this.lo.length; i++) {
      if (this.lo[i] === lo && this.hi[i] === hi) {
        if (this.waiting(i, now)) return false;
        this.when[i] = now;
        return true;
      }
      if (free < 0 && !this.waiting(i, now)) free = i;
    }
    // Every entry is a pair that clashed a moment ago: the oldest written gives way.
    const slot = free >= 0 ? free : this.next;
    this.next = (slot + 1) % this.lo.length;
    this.lo[slot] = lo;
    this.hi[slot] = hi;
    this.when[slot] = now;
    return true;
  }

  /** For the console: how many pairs are still inside their delay at `now`. */
  held(now: number): number {
    let n = 0;
    for (let i = 0; i < this.when.length; i++) if (this.waiting(i, now)) n++;
    return n;
  }

  /**
   * Whether entry `i` is still inside its delay. A clock that has gone *backwards* -- the world's
   * simulated time starts again at nought on every world load -- is a fresh start and not a pair
   * that must wait for ever, which two blades that live as long as the page (the player's) would
   * otherwise do. `Clashes.update` clears the ring outright on such a step; this is the belt under
   * that brace, for a ring used on its own.
   */
  private waiting(i: number, now: number): boolean {
    const age = now - this.when[i];
    return age >= 0 && age < CLASH.again;
  }
}

/** The gathered blades and the nearest-pair scratch, kept for the life of the page. */
const near: NearestPair = { s: 0, t: 0, x: 0, y: 0, z: 0 };

/**
 * The clashes of one frame. One of these exists for the life of the page (`clashes` below): it
 * holds a fixed ring of pairs and a fixed list of events and nothing else, so it costs nothing at
 * all when nobody has a blade out.
 */
export class Clashes {
  private readonly ring = new ClashRing(CLASH.pairs);
  /**
   * The blades weighed against one another in the step now running. It is emptied before `update`
   * returns, so nothing here ever holds a renderer between steps: a fighter disposed after a world
   * unload is not kept alive by this list whether anything calls `clear` or not.
   */
  private readonly list: (ClashBlade | null)[] = [];
  private readonly store: ClashEvent[] = [];
  /** How many of `events` the last step filled. */
  count = 0;
  /** The dice, so a test can pin a clash without pinning the game. */
  rand: () => number = Math.random;
  /** For the console: the last step's numbers, and the running total. */
  bladesSeen = 0;
  pairsTested = 0;
  /** Lit blades last step whose holder never named them: those can never clash with one another. */
  unnamed = 0;
  /** Flashes the last `place` really borrowed, which is 0 in a cabin whose lights hold the pool. */
  flashesPlaced = 0;
  total = 0;
  /** The clock of the last step, for the console's "pairs held" and for spotting a world reload. */
  private lastNow = 0;
  private exposedOn: object | null = null;

  constructor() {
    for (let i = 0; i < CLASH.maxBlades; i++) this.list.push(null);
    for (let i = 0; i < CLASH.maxEvents; i++) this.store.push({ at: new THREE.Vector3(), color: CLASH.sparkColor, bind: false, a: 0, b: 0 });
  }

  /** Where blades met this step, `count` of them, kept between steps and rewritten in place. */
  get events(): readonly ClashEvent[] {
    return this.store;
  }

  /**
   * How many blades the step list still points at, which is 0 everywhere outside `update`. It is
   * here so that "nothing is held between steps" is a thing the test can read rather than a thing
   * the comments claim: a renderer held here would outlive the world its fighter was disposed with.
   */
  get holding(): number {
    let n = 0;
    for (let i = 0; i < this.list.length; i++) if (this.list[i]) n++;
    return n;
  }

  /**
   * Everything forgotten: a world unload, a travel, the select screen. `update` clears the ring by
   * itself whenever the clock goes backwards, which is what a world load does to `World.simTime`,
   * so this is for whoever wants to say it outright rather than rely on that.
   */
  clear(): void {
    this.ring.clear();
    this.count = 0;
    this.bladesSeen = 0;
    this.pairsTested = 0;
    this.unnamed = 0;
    this.flashesPlaced = 0;
    this.lastNow = 0;
    for (let i = 0; i < this.list.length; i++) this.list[i] = null;
  }

  /**
   * Weigh every lit blade in the frame against every other, once, and throw back the pairs that
   * met. `now` is the world's simulated time, so `__debug.advance` drives the pair ring exactly as
   * it drives everything else with a clock. `own` is the player's blades; `fighters` and `more` are
   * the same holder lists the blade glow is given, which is every fighter, every person from the
   * catalogue and every other player. Returns how many clashes there were, which are in `events`.
   */
  update(now: number, own: readonly ClashBlade[], fighters: readonly ClashHolder[], more: readonly ClashHolder[]): number {
    this.expose();
    // A world load starts `World.simTime` again at nought, and the player's own blades outlive the
    // world: a pair remembered at the end of one world would otherwise sit in the ring for ever.
    if (now < this.lastNow) this.ring.clear();
    this.lastNow = now;
    this.count = 0;
    this.pairsTested = 0;
    const n = this.gather(own, fighters, more);
    this.bladesSeen = n;
    if (CLASH.reach > 0 && n >= 2) {
      const reach2 = CLASH.reach * CLASH.reach;
      for (let i = 0; i < n; i++) {
        const a = this.list[i]!;
        for (let j = i + 1; j < n; j++) {
          const b = this.list[j]!;
          // One hand's two blades are never a clash, and neither are two nobody named (which is the
          // same case: a staff whose holder has not said whose it is).
          if (a.owner === b.owner) continue;
          if (!swinging(a) && !swinging(b)) continue;
          this.pairsTested++;
          if (closestSegments(a.drawnBase, a.drawnTip, b.drawnBase, b.drawnTip, near) > reach2) continue;
          if (!this.ring.take(a.id, b.id, now)) continue;
          this.strike(a, b);
        }
      }
    }
    // Nothing is held past the step it was weighed in: the events carry ids and places, not blades.
    for (let i = 0; i < n; i++) this.list[i] = null;
    return this.count;
  }

  /** Both blades thrown back, and the sparks written into the events. */
  private strike(a: ClashBlade, b: ClashBlade): void {
    const won = clashOutcome(a.clashWeight, b.clashWeight, this.rand(), this.rand());
    const bind = won === 0;
    // In a bind neither is the loser and neither is the winner: both take `CLASH.recoilBind`.
    a.clashed(won < 0, bind);
    b.clashed(won > 0, bind);
    this.total++;
    if (this.count >= this.store.length) return;
    const e = this.store[this.count++];
    e.at.set(near.x, near.y, near.z);
    e.bind = bind;
    e.a = won < 0 ? b.id : a.id;
    e.b = won < 0 ? a.id : b.id;
    e.color = CLASH.sparkFromBlade ? (won < 0 ? b.clashColor : a.clashColor) : CLASH.sparkColor;
  }

  /** The lit blades of this frame into the kept list; returns how many, never more than the list holds. */
  private gather(own: readonly ClashBlade[], fighters: readonly ClashHolder[], more: readonly ClashHolder[]): number {
    let n = 0;
    this.unnamed = 0;
    for (let i = 0; i < own.length && n < this.list.length; i++) if (lit(own[i])) this.list[n++] = own[i];
    for (let i = 0; i < fighters.length && n < this.list.length; i++) {
      const s = fighters[i].saber;
      if (s && lit(s)) this.list[n++] = s;
    }
    for (let i = 0; i < more.length && n < this.list.length; i++) {
      const s = more[i].saber;
      if (s && lit(s)) this.list[n++] = s;
    }
    for (let i = 0; i < n; i++) if (this.list[i]!.owner === 0) this.unnamed++;
    // Nothing kept from this step: a disposed fighter's renderer is never held past it.
    for (let i = n; i < this.list.length; i++) this.list[i] = null;
    return n;
  }

  /**
   * The sparks for the clashes of this step: a pooled burst, the bank's own ring off the hilt, and
   * a flash **only from a light standing dark** (`CLASH.flashBorrow`), never a light of its own and
   * never one taken from the room lights, a fighter's glow or another player's blade. Apart from
   * `update` so that a tab with no picture and no ear can still work the clashes out.
   */
  place(effects: ClashEffects, sound: ClashSound | null = null): void {
    this.flashesPlaced = 0;
    let room = 0;
    if (CLASH.flashIntensity > 0 && CLASH.flashBorrow !== 'never') {
      if (CLASH.flashBorrow === 'always') room = this.count;
      else {
        const pool = effects.lightPool;
        for (let i = 0; i < pool.length; i++) if (pool[i].intensity <= 0) room++;
      }
    }
    for (let i = 0; i < this.count; i++) {
      const e = this.store[i];
      effects.burst(e.at, e.color, CLASH.burstSize, CLASH.burstLife);
      if (this.flashesPlaced < room) {
        effects.flash(e.at, e.color, CLASH.flashIntensity, CLASH.flashRange, CLASH.flashLife);
        this.flashesPlaced++;
      }
      if (sound) sound.contact('clash', e.at);
    }
  }

  /** What a tab that cannot see the sparks reads instead. */
  status(): Record<string, unknown> {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const last: Record<string, unknown>[] = [];
    for (let i = 0; i < this.count; i++) {
      const e = this.store[i];
      last.push({ blades: [e.a, e.b], bind: e.bind, at: [r2(e.at.x), r2(e.at.y), r2(e.at.z)] });
    }
    return {
      blades: this.bladesSeen,
      // Lit blades whose holder never named them. Two of those can never clash with one another,
      // so a number above 1 here with no clashes is a holder that wants its `owner` wiring.
      unnamed: this.unnamed,
      pairsTested: this.pairsTested,
      clashes: this.count,
      flashesPlaced: this.flashesPlaced,
      total: this.total,
      last,
      pairsHeld: this.ring.held(this.lastNow),
      ring: this.ring.size,
      tune: { ...CLASH, weights: { ...CLASH.weights } },
      // Spent when this was built and never read again: what `tune` says of these three is only
      // what was typed, so the live values are reported apart and the knob refuses to write them.
      buildOnly: { pairs: this.ring.size, maxBlades: this.list.length, maxEvents: this.store.length },
    };
  }

  /**
   * `__debug.clash()` reports and `__debug.clash({ reach: 0.3 })` retunes, hung here rather than in
   * the game's own console block so that nothing outside this file has to know a clash exists. The
   * three build-only numbers are refused by name and come back in `refused`, rather than being
   * written where nothing would read them again.
   */
  private expose(): void {
    if (typeof window === 'undefined') return;
    const dbg = (window as unknown as { __debug?: Record<string, unknown> }).__debug;
    if (!dbg || dbg === this.exposedOn) return;
    this.exposedOn = dbg;
    dbg.clash = (opts: Record<string, unknown> = {}) => {
      const refused: string[] = [];
      for (const [k, v] of Object.entries(opts)) {
        if (k === 'weights' && v && typeof v === 'object') {
          for (const [style, w] of Object.entries(v as Record<string, unknown>)) {
            if (typeof w === 'number' && Number.isFinite(w) && style in CLASH.weights) CLASH.weights[style as ClashStyle] = w;
          }
          continue;
        }
        if (!(k in CLASH)) continue;
        if (CLASH_BUILD_ONLY.indexOf(k) >= 0) {
          refused.push(k);
          continue;
        }
        if (k === 'flashBorrow') {
          if (v === 'free' || v === 'always' || v === 'never') CLASH.flashBorrow = v;
          continue;
        }
        if (typeof v === 'boolean') {
          (CLASH as unknown as Record<string, unknown>)[k] = v;
          continue;
        }
        if (typeof v === 'number' && Number.isFinite(v)) (CLASH as unknown as Record<string, unknown>)[k] = v;
      }
      const s = this.status();
      if (refused.length) s.refused = { keys: refused, why: 'spent when the clashes were built; they take effect only on a new Clashes' };
      return s;
    };
  }
}

/** Lit enough, drawn this frame, and long enough to have a segment at all. */
function lit(b: ClashBlade): boolean {
  return b.glowing && b.ignition >= CLASH.minIgnition;
}

/** Its holder says it is swinging, or the blade itself measured a swing. */
function swinging(b: ClashBlade): boolean {
  return b.attacking || b.tipSpeed >= CLASH.swingSpeed;
}

/** The one set of clashes, as `sabers` is the one set of blade sounds. */
export const clashes = new Clashes();
