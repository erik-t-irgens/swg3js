// How a body on the ground gets out of the way: Jedi Academy's roll, and a jump of the height its
// kind has earned -- the pure half, with no three, no physics engine and no browser, so a node test
// drives the very functions a fighter and a person from the catalogue both run.
//
// **The dodge is the Jedi Academy roll and nothing else** (the owner's D9). SWG's own dodge was a
// miss the server rolled and a clip the defender played after it, which needs a hit-chance model this
// game does not have and a conversion besides; the roll is already in every species rig, where the
// player plays it, and costs a person from the catalogue nothing to borrow. So a body that is aimed at
// throws itself aside a tier's own share of the time, at Jedi Academy's own speed for Jedi Academy's
// own length of time, and the roll carries it on the low shell so the shot it was dodging passes over.
//
// **Who jumps is the kind of body it is** (the owner's D10). None of the game's creature packs has a
// jump, a leap or a pounce, so creatures and droids never leave the ground; a person from the third
// tier up hops Jedi Academy's own plain jump, and a lightsaber carrier Force-jumps to its first or
// second Force Jump level by tier, which is how Jedi Academy's own NPC files key jumping on the Force.
// A jump is used for one thing: to reach somebody stood on a ledge within its height. Nothing plans a
// jump into a path, and **a jump is not a dodge**: D9 is the roll only. A hop aside in place of a roll
// (and a blade carrier's leap at what it fights) is written and kept behind `EVADE_TUNE.hopShare`,
// which ships at nought, so it can be put beside the roll for the owner to judge
// (`__debug.mobileTune({ roll: { hopShare: 0.35 } })`) without being what the game does.
//
// The figures that are Jedi Academy's are copied here by value rather than imported, so that this
// module pulls in nothing (`src/player/jkaMove.ts` loads three), and the node test holds the two
// against each other: 220 units a second for 0.55 s of roll, and the heights 32, 96 and 192 units.
// **Every other number here is invented**, and all of it is live: `__debug.mobileTune({ roll, jump })`
// and `__debug.fighters({ roll, jump })` move the one pair of tables every body reads.
//
// Nothing here allocates: a caller keeps the structs it asks through and writes into them.

/** Metres to a Jedi Academy unit, as `jkaMove.ts` has it. */
const UNIT = 0.0254;

/** Which way a roll goes, relative to the way the body faces: Jedi Academy's own four clip suffixes. */
export type RollDir = 'F' | 'B' | 'L' | 'R';

/** What an evade is: the roll, or a hop aside for a body that can jump. */
export type EvadeKind = 'roll' | 'hop';

export interface EvadeTune {
  /**
   * The share a second a body throws itself aside while it is aimed at, indexed by tier 0 to 5. Tier
   * 0 is the flat fighter this game had before there were tiers and never evades; tier 1 is the least
   * of the ladder and does not either, so a body that has earned nothing stands and takes it.
   */
  share: number[];
  /** Seconds after one evade before the next may start, a roll and a hop alike. */
  cooldown: number;
  /** Jedi Academy's roll: `JKA.rollSpeed` in metres a second, and `JKA.rollTime`. */
  rollSpeed: number;
  rollTime: number;
  /** Nearer than this to what it is fighting, it rolls back rather than aside, metres. */
  backInside: number;
  /**
   * Of the evades a body that can jump makes, the share that are a hop rather than a roll. **Nought**,
   * because the owner's D9 is the roll only: the hop is kept for a comparison, not shipped.
   */
  hopShare: number;
  /**
   * A blade carrier farther than this from what it fights leaps toward it rather than aside, metres:
   * a blade has to close to do anything, the argument that keeps it out of cover too.
   */
  leapFrom: number;
  /**
   * What "aimed at" is. The player's aim line passes within `aimRadius` metres of the body's middle,
   * with the body no further out than `aimReach`; or the body was struck by something standing at
   * least `shotFrom` metres off within the last `shotFor` seconds, which is how one body knows another
   * is shooting at it when nothing says where anybody but the player is aiming.
   */
  aimRadius: number;
  aimReach: number;
  shotFrom: number;
  shotFor: number;
}

export const EVADE_TUNE: EvadeTune = {
  share: [0, 0, 0.1, 0.2, 0.3, 0.4],
  cooldown: 4,
  rollSpeed: 220 * UNIT,
  rollTime: 0.55,
  backInside: 4,
  hopShare: 0,
  leapFrom: 6,
  aimRadius: 1.2,
  aimReach: 60,
  shotFrom: 4,
  shotFor: 1.5,
};

export interface JumpTune {
  /**
   * How high each jump level reaches, metres: nothing at level 0, then Jedi Academy's plain jump and
   * its first two Force Jump levels (`JKA.forceJumpHeight` 32, 96 and 192 units).
   */
  heights: number[];
  /** The least tier a person with no blade hops at. */
  hopFrom: number;
  /** The tiers a lightsaber carrier takes its first and its second Force Jump level at. */
  saberFrom: number;
  saberHigh: number;
  /**
   * A ledge worth a jump: it rises more than `ledgeMin` over the body's feet (less than that the feet
   * climb on their own), it is no more than `ledgeReach` metres off across the ground, and the jump
   * clears its lip by `ledgeOver` without spending more than the level has.
   */
  ledgeMin: number;
  ledgeReach: number;
  ledgeOver: number;
  /** Seconds after one jump before a ledge may start another. */
  every: number;
  /** The fastest a jump carries a body across the ground, metres a second. */
  across: number;
}

export const JUMP_TUNE: JumpTune = {
  heights: [0, 32 * UNIT, 96 * UNIT, 192 * UNIT],
  hopFrom: 3,
  saberFrom: 2,
  saberHigh: 4,
  ledgeMin: 0.6,
  ledgeReach: 4,
  ledgeOver: 0.3,
  every: 2,
  across: 7,
};

/** Nothing may go negative; a share past one is a certainty and no more. */
const EVADE_FLOOR: Partial<Record<keyof EvadeTune, number>> = { cooldown: 0, rollSpeed: 0, rollTime: 0, backInside: 0, hopShare: 0, leapFrom: 0, aimRadius: 0, aimReach: 0, shotFrom: 0, shotFor: 0 };
const JUMP_FLOOR: Partial<Record<keyof JumpTune, number>> = { hopFrom: 0, saberFrom: 0, saberHigh: 0, ledgeMin: 0, ledgeReach: 0, ledgeOver: 0, every: 0, across: 0 };

/** Write the finite numbers of `from` over a table's own list, in place and no further than it runs. */
function tuneList(list: number[], from: unknown, lo: number, hi: number): void {
  if (!Array.isArray(from)) return;
  for (let i = 0; i < list.length && i < from.length; i++) {
    const v = from[i];
    if (typeof v === 'number' && Number.isFinite(v)) list[i] = Math.min(hi, Math.max(lo, v));
  }
}

/**
 * Move the evade's numbers live, and read back what is in force. The tables are written in place --
 * `share` a tier at a time -- so every body already standing hears the change, and anything that is
 * not a finite number is left alone.
 */
export function tuneEvade(opts?: Partial<EvadeTune> | null): EvadeTune {
  if (!opts) return EVADE_TUNE;
  tuneList(EVADE_TUNE.share, opts.share, 0, 1);
  const into = EVADE_TUNE as unknown as Record<string, number>;
  for (const key of Object.keys(EVADE_FLOOR) as (keyof EvadeTune)[]) {
    const v = opts[key];
    if (typeof v === 'number' && Number.isFinite(v)) into[key] = Math.max(EVADE_FLOOR[key] ?? 0, key === 'hopShare' ? Math.min(1, v) : v);
  }
  return EVADE_TUNE;
}

/** The same for the jump. */
export function tuneJump(opts?: Partial<JumpTune> | null): JumpTune {
  if (!opts) return JUMP_TUNE;
  tuneList(JUMP_TUNE.heights, opts.heights, 0, 50);
  const into = JUMP_TUNE as unknown as Record<string, number>;
  for (const key of Object.keys(JUMP_FLOOR) as (keyof JumpTune)[]) {
    const v = opts[key];
    if (typeof v === 'number' && Number.isFinite(v)) into[key] = Math.max(JUMP_FLOOR[key] ?? 0, v);
  }
  return JUMP_TUNE;
}

/** A tier's share a second, clamped to the table: a tier outside it takes the nearest end. */
export function evadeShare(tier: number, tune: EvadeTune = EVADE_TUNE): number {
  const list = tune.share;
  if (!list.length || !Number.isFinite(tier)) return 0;
  const t = Math.min(list.length - 1, Math.max(0, Math.round(tier)));
  return Math.max(0, Math.min(1, list[t]));
}

/**
 * The chance an evade starts within `dt` seconds for a body with this share a second, which is the
 * rate compounded rather than multiplied: `1 - (1 - share)^dt`. A body asked every tenth of a second
 * and one asked every half a second then evade equally often over the same fight, which a plain
 * `share * dt` would not quite give, and a share of one is a certainty however short the step.
 */
export function evadeChance(share: number, dt: number): number {
  if (!(share > 0) || !(dt > 0)) return 0;
  if (share >= 1) return 1;
  return 1 - Math.pow(1 - share, dt);
}

/** What the evade is decided from: primitives only, one kept per caller and written into. */
export interface EvadeAsk {
  /** The body's tier, 0 to 5. */
  tier: number;
  /** Whether it is aimed at this instant (`aimedAt`, or struck from afar within `shotFor`). */
  aimed: boolean;
  /** Seconds since its last evade. */
  since: number;
  /** Seconds since it was last asked, which is what the share a second is compounded over. */
  dt: number;
  /** Standing on something: nobody rolls or hops from the air. */
  grounded: boolean;
  /**
   * Free to throw itself about at all: not staggered, not held by the Force, not in a swing, not lying
   * prone, not already rolling or in the air, and on a detail tier that moves at all.
   */
  free: boolean;
  /** Whether its rig can be drawn rolling (Jedi Academy's four roll clips). */
  canRoll: boolean;
  /** Its jump level, 0 for a body that does not jump (`jumpLevelFor`). */
  jumpLevel: number;
}

/**
 * Whether to evade this step, and how. `r1` and `r2` are two numbers in 0..1 the caller draws;
 * nothing here holds a generator.
 *
 * The rule, in order: nothing that is not aimed at, not on its feet or not free; nothing inside the
 * cooldown; then its tier's share a second compounded over the step. The evade is the roll (D9), and a
 * body that cannot be drawn rolling does nothing; only with `hopShare` raised off its shipped nought
 * does a body that can jump hop that share of the time instead.
 */
export function evadeKind(o: EvadeAsk, r1: number, r2: number, tune: EvadeTune = EVADE_TUNE): EvadeKind | null {
  if (!o.aimed || !o.grounded || !o.free) return null;
  if (!(o.since >= tune.cooldown)) return null;
  const p = evadeChance(evadeShare(o.tier, tune), o.dt);
  if (!(r1 < p)) return null;
  if (o.jumpLevel > 0 && r2 < tune.hopShare) return 'hop';
  return o.canRoll ? 'roll' : null;
}

/**
 * Which way to roll: back when the thing it is fighting is within `backInside`, else aside on the
 * side it was given (`side` 1 is its own left, -1 its right). Nobody rolls toward what is shooting at it.
 */
export function rollDirection(side: number, gap: number, tune: EvadeTune = EVADE_TUNE): RollDir {
  if (gap < tune.backInside) return 'B';
  return side >= 0 ? 'L' : 'R';
}

/**
 * The ground direction of a roll or a hop for a body facing `facing` (radians, forward along
 * `(sin, cos)`), written into `out` as a unit vector. A turn to a body's left is positive in this game,
 * so its left is `(cos, -sin)` of its facing and its right the opposite.
 */
export function rollVector(dir: RollDir, facing: number, out: { x: number; z: number }): { x: number; z: number } {
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  if (dir === 'F') {
    out.x = s;
    out.z = c;
  } else if (dir === 'B') {
    out.x = -s;
    out.z = -c;
  } else if (dir === 'L') {
    out.x = c;
    out.z = -s;
  } else {
    out.x = -c;
    out.z = s;
  }
  return out;
}

/** What a body is, as far as jumping goes. */
export type JumperKind = 'person' | 'creature' | 'droid';

/**
 * A body's jump level, 0 to 3: nought for a creature, a droid and anything below the tier that earns
 * one, a plain hop for a person from `hopFrom` up, and a lightsaber carrier's first Force Jump level
 * from `saberFrom` and its second from `saberHigh`.
 */
export function jumpLevelFor(tier: number, kind: JumperKind, saber: boolean, tune: JumpTune = JUMP_TUNE): number {
  if (kind !== 'person' || !(tier > 0)) return 0;
  if (saber) {
    if (tier >= tune.saberHigh) return 3;
    if (tier >= tune.saberFrom) return 2;
  }
  return tier >= tune.hopFrom ? 1 : 0;
}

/** How high a jump level reaches, metres: nought for level 0 and anything the table has no row for. */
export function jumpHeight(level: number, tune: JumpTune = JUMP_TUNE): number {
  if (!(level > 0)) return 0;
  const h = tune.heights[Math.min(tune.heights.length - 1, Math.round(level))];
  return Number.isFinite(h) && h > 0 ? h : 0;
}

/** The speed upward that reaches `height` under `gravity` (metres a second squared), `sqrt(2 g h)`. */
export function jumpSpeed(height: number, gravity: number): number {
  if (!(height > 0) || !(gravity > 0)) return 0;
  return Math.sqrt(2 * gravity * height);
}

/** What a ledge jump is decided from; primitives only. */
export interface LedgeAsk {
  /** How far the feet of what it is chasing stand over its own, metres. */
  rise: number;
  /** How far off it is across the ground, metres. */
  flat: number;
  level: number;
  grounded: boolean;
  /** Chasing it, free (as `EvadeAsk.free`) and out of doors: a jump under a ceiling is a jump into it. */
  chasing: boolean;
  free: boolean;
  outdoors: boolean;
  /** Seconds since its last jump. */
  since: number;
}

/**
 * The height to jump to reach somebody stood on a ledge, or nought for no jump: the rise plus
 * `ledgeOver`, and only while that is within the body's own jump, the ledge is near enough across and
 * higher than a step the feet would climb anyway.
 */
export function ledgeJump(o: LedgeAsk, tune: JumpTune = JUMP_TUNE): number {
  if (!o.chasing || !o.free || !o.grounded || !o.outdoors) return 0;
  if (!(o.since >= tune.every)) return 0;
  const reach = jumpHeight(o.level, tune);
  if (!(reach > 0) || !(o.rise > tune.ledgeMin) || !(o.rise <= reach)) return 0;
  if (!(o.flat <= tune.ledgeReach)) return 0;
  return Math.min(reach, o.rise + tune.ledgeOver);
}

/**
 * How fast a jump to `height` should carry a body across `flat` metres, capped at `across`. Two marks,
 * two timings: `'top'` puts it over its mark as it tops out (`flat` over the time to the top, `v / g`),
 * which is right for a ledge, where it comes down onto the lip just past the top; `'land'` puts it down
 * on its mark on ground as high as it left from (`flat` over the whole flight, `2 v / g`), which is
 * right for a leap across level ground -- timed to the top, a leap lands twice as far as it meant to.
 */
export function jumpAcross(flat: number, height: number, gravity: number, mark: 'top' | 'land', tune: JumpTune = JUMP_TUNE): number {
  const up = jumpSpeed(height, gravity);
  if (!(up > 0) || !(flat > 0)) return 0;
  const flight = mark === 'land' ? (2 * up) / gravity : up / gravity;
  return Math.min(tune.across, flat / flight);
}

/**
 * The player's aim, as the game hands it over each frame: whether a gun is up at all, the eye it is
 * aimed from and the way it points (a unit vector). One kept record, written in place.
 */
export interface AimLine {
  on: boolean;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
}

/** Whether the aim line passes within `aimRadius` of a point in front of it and within `aimReach`. */
export function aimedAt(aim: AimLine | null | undefined, x: number, y: number, z: number, tune: EvadeTune = EVADE_TUNE): boolean {
  if (!aim || !aim.on) return false;
  const px = x - aim.x;
  const py = y - aim.y;
  const pz = z - aim.z;
  const along = px * aim.dx + py * aim.dy + pz * aim.dz;
  if (!(along > 0) || along > tune.aimReach) return false;
  const off2 = px * px + py * py + pz * pz - along * along;
  return off2 <= tune.aimRadius * tune.aimRadius;
}

/**
 * One body's evade and jump clocks, and a count of what it has done, for the console. Kept by a
 * fighter and by a person from the catalogue alike, written in place and never made again.
 */
export class EvadeClock {
  /** The simulated second of its last evade, its last jump, the last blow from afar and the last ask. */
  evadeAt = -Infinity;
  jumpAt = -Infinity;
  shotAt = -Infinity;
  askedAt = Number.NaN;
  rolls = 0;
  hops = 0;
  jumps = 0;
  /** What `due` asks through: one kept struct. */
  private readonly ask: EvadeAsk = { tier: 0, aimed: false, since: 0, dt: 0, grounded: true, free: true, canRoll: false, jumpLevel: 0 };

  /** Struck: whoever struck from `away` metres off counts as shooting at it for `shotFor` seconds. */
  struck(now: number, away: number, tune: EvadeTune = EVADE_TUNE): void {
    if (away >= tune.shotFrom) this.shotAt = now;
  }

  /** Whether a blow from afar still counts as being aimed at. */
  shotLately(now: number, tune: EvadeTune = EVADE_TUNE): boolean {
    return now - this.shotAt < tune.shotFor;
  }

  /**
   * Whether to evade now, and how, counted when it does: the step since the last ask is what the
   * tier's share is compounded over, so a body is asked as often as it thinks and no more.
   */
  due(now: number, tier: number, aimed: boolean, grounded: boolean, free: boolean, canRoll: boolean, jumpLevel: number, r1: number, r2: number): EvadeKind | null {
    const dt = Number.isFinite(this.askedAt) ? Math.max(0, now - this.askedAt) : 0;
    this.askedAt = now;
    const a = this.ask;
    a.tier = tier;
    a.aimed = aimed;
    a.since = now - this.evadeAt;
    a.dt = dt;
    a.grounded = grounded;
    a.free = free;
    a.canRoll = canRoll;
    a.jumpLevel = jumpLevel;
    const kind = evadeKind(a, r1, r2);
    if (kind) {
      this.evadeAt = now;
      if (kind === 'roll') this.rolls++;
      else this.hops++;
    }
    return kind;
  }

  /** A jump taken, of any kind: its clock, and a ledge counted apart from a hop. */
  jumped(now: number, ledge: boolean): void {
    this.jumpAt = now;
    if (ledge) this.jumps++;
  }

  /** A fresh life: the clocks back to nothing, the counts kept (they are the console's, over the session). */
  reset(): void {
    this.evadeAt = -Infinity;
    this.jumpAt = -Infinity;
    this.shotAt = -Infinity;
    this.askedAt = Number.NaN;
  }
}

/** Jedi Academy's four rolls by the way they go. */
export const ROLL_CLIPS: Readonly<Record<RollDir, string>> = { F: 'BOTH_ROLL_F', B: 'BOTH_ROLL_B', L: 'BOTH_ROLL_L', R: 'BOTH_ROLL_R' };

type JumpBase = 'JUMP' | 'INAIR' | 'LAND';

/**
 * The names a jump clip is asked for by, in the player's own order (`Player.jumpClip`), made once so
 * that asking allocates nothing: for a Force jump its own for the direction, its plain one, then the
 * plain jump's for the direction and the plain jump; for a plain jump only the last two.
 */
const JUMP_ORDER: Record<JumpBase, Record<RollDir, [string[], string[]]>> = (() => {
  const words: Record<RollDir, string> = { F: '', B: 'BACK', L: 'LEFT', R: 'RIGHT' };
  const out = {} as Record<JumpBase, Record<RollDir, [string[], string[]]>>;
  for (const base of ['JUMP', 'INAIR', 'LAND'] as JumpBase[]) {
    out[base] = {} as Record<RollDir, [string[], string[]]>;
    for (const dir of ['F', 'B', 'L', 'R'] as RollDir[]) {
      const s = words[dir];
      const plain = s ? [`BOTH_${base}${s}1`, `BOTH_${base}1`] : [`BOTH_${base}1`];
      const force = s ? [`BOTH_FORCE${base}${s}1`, `BOTH_FORCE${base}1`, ...plain] : [`BOTH_FORCE${base}1`, ...plain];
      out[base][dir] = [plain, force];
    }
  }
  return out;
})();

/**
 * Jedi Academy's jump clip for a base (`JUMP`, `INAIR` or `LAND`), a direction and whether it is a
 * Force jump: the first of its names the rig holds, or null.
 */
export function jumpClipName(base: JumpBase, dir: RollDir, force: boolean, rig: { has(name: string): boolean }): string | null {
  const names = JUMP_ORDER[base][dir][force ? 1 : 0];
  for (let i = 0; i < names.length; i++) if (rig.has(names[i])) return names[i];
  return null;
}

/** Every Jedi Academy clip a roll or a jump may ask for, which is what a person from the catalogue is lent. */
export const EVADE_CLIPS: readonly string[] = (() => {
  const out: string[] = Object.values(ROLL_CLIPS);
  for (const d of ['', 'BACK', 'LEFT', 'RIGHT']) for (const f of ['', 'FORCE']) out.push(`BOTH_${f}JUMP${d}1`, `BOTH_${f}INAIR${d}1`, `BOTH_${f}LAND${d}1`);
  return out;
})();
