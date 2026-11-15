// Every number of feel the speed classes have (walking, jogging, running and sprinting on foot, standing), in one
// table. The owner decides these by hand: each is live through `__debug.loco({ tune: { ... } })` and a slider in the
// debug menu when `loco` is picked (`locoDials.ts`), and nothing here was chosen by measuring. A start is the brief's
// own number where it gave one, a clip's own measured speed where the clip decides, and otherwise the plainest thing
// that could be said for it, with the reason beside it.
//
// Pure: no three.js and nothing of the page, so the node tests move it as the console does.

export interface LocoTune {
  /**
   * The speed classes at all. Off, the body moves as it did before them: one run, Shift walks, and it turns the way
   * it runs. `localStorage['swg.loco'] = '0'` starts it off; `__debug.loco({ on })` flips it live.
   */
  on: boolean;
  /**
   * With a blaster up (ready or aimed), a diagonal plays its own jog clip at every class with the body square to the
   * view, where the brief's rule for a walked or run diagonal is the strafe (or the backward clip) with the body turned
   * 45 degrees. A default of ours, on: a body turned 45 degrees cannot also hold a barrel on the crosshair (the spine
   * has not got the turn), and the heading other players are sent would then disagree with the legs. Off is the
   * brief's rule with a blaster up too.
   */
  gunSquare: boolean;
  /**
   * What a fight's key does to a sprint (`SPRINT_ENDERS` in bodyLoco.ts: the attack, the other attack, a gun's other
   * trigger, the saber's throw, the block; never the six ability keys or the jump). 'ends', the owner's word of
   * 2026-11-15 ("maybe sprinting is interrupted if you attack like blocking does"): pressed or held while the class
   * asked is the sprint, it ends the sprint on that very frame and goes through, the body drops to the run (fighting
   * is capped at the run), and only a fresh double tap of Shift sprints again. 'muted' is the rule before it: the attack,
   * the other trigger and the throw do nothing while the body sprints, and a block or an aim caps the pace only while
   * held (let go with Shift still down, the sprint is back at once).
   */
  sprintFight: 'ends' | 'muted';
  /**
   * What each class moves the body at, metres a second, by the way it goes. Every start is the speed its clip's own
   * feet were measured at when the paces were made (the pack's index of 91e62d9), with two exceptions said below. The
   * importer's measure was mended since (2026-11-15) and every clip now reads 1.5 to 10% faster (the README's
   * "Walking, jogging, running and sprinting" puts each dial beside its clip's own speed now); the dials were left where
   * they started, which are the owner's, and the clips' playback rates moved instead.
   */
  speed: {
    forward: {
      /** `standard_walk`'s own 1.44. */
      walk: number;
      /** `slow_run`'s own 2.85: what forward is with nothing held. */
      jog: number;
      /** `drunk_run_forward`'s own 2.38: the jog while tired. */
      tired: number;
      /**
       * `running` and `fast_run` measure almost alike (5.47 and 5.54), and two classes at one speed are one class. So
       * the run starts under its clip's own, at 4.9, about midway between the jog and the sprint by ratio...
       */
      run: number;
      /** ...and the sprint at 6.35, the one run the game had before the classes, so nothing is faster than it was. */
      sprint: number;
    };
    /** `walking_backwards` 1.28, `jog_backward` 2.25, `running_backward` 2.93. */
    back: { walk: number; jog: number; run: number };
    /**
     * The walk is the slow strafe, `walk_strafe_left` and `_right`, at their own 0.59 (the owner's answer: the
     * brief's sideways "speed 0" is what walking sideways plays); `jog_strafe_left` 2.89; `left_strafe` 4.33.
     */
    side: { walk: number; jog: number; run: number };
    /**
     * Forward and to a side. The walk and the run are the strafes' clips with the body turned (the brief has no
     * clip of their own for them): the walk the strafe walks, which measure 1.70 to the left and 1.64 to the right
     * and are one class, so it starts at the two's mean, 1.67; the run `left_strafe`'s 4.33. The jog is
     * `jog_forward_diagonal`'s own 2.66.
     */
    forwardDiag: { walk: number; jog: number; run: number };
    /** Back and to a side: the backward walk and run with the body turned, at their speeds; `jog_backward_diagonal`'s own 2.18. */
    backDiag: { walk: number; jog: number; run: number };
  };
  /**
   * The band a clip's playback rate is held in while it follows the ground speed (ground speed over the speed the
   * clip's feet were made for). Started at 0.6 to 1.6: wide enough that a class's clip keeps its feet on the ground
   * from a little after it starts until Force Speed's first level, and no wider, since a walk played at three times
   * its rate is no walk. Under Force Speed the top is raised by the speed's own factor.
   */
  rate: {
    min: number;
    max: number;
    /**
     * How fast every clip's feet really go over the ground, as a share of what the pack's index says they do; raised
     * past 1, every clip plays that much slower for the same ground speed. The measure was mended (2026-11-15): the
     * index's speed is now read off each stance's settled middle (the heel and the toe both down and still) against the
     * ground the clip is carried on, never under the swaying hips or from a landing or lifting frame, and the fitted
     * stride is scaled by the legs' own lengths rather than the hips' height, so at 1 a planted foot keeps within 2% of
     * the ground on every clip of the table (the node test holds it). It stays for the eye.
     */
    feet: number;
  };
  shift: {
    /** How long after Shift is let go the class drops by one, and again by one each such time until the jog, seconds. The brief's "after a moment": half a second. */
    dropDelay: number;
    /**
     * Shift let go and pressed again within this raises the class by one over the class it was let go at, seconds
     * (the run to the sprint). Counted from the let-go and judged against the class held then, so it is its own
     * number whatever the drop's delay is.
     */
    tapWindow: number;
  };
  stamina: {
    /** The pool. 100, as health is. */
    pool: number;
    /** A second of each class forward, points (the brief: sprinting burns, running holds, jogging regains slower, walking at the standard rate). */
    sprint: number;
    run: number;
    jog: number;
    /** Walking forward, and standing: the standard rate. */
    walk: number;
    /** Backward at any class, the walk too: the brief's "normal stamina regen". */
    back: number;
    /** Sideways and the forward diagonals from the jog up: the brief's "does not deplete stamina, but won't allow for stamina regen". */
    side: number;
    /**
     * Sideways and the forward diagonals at the walk: the standard rate. The owner's answer of 2026-11-15, "walking
     * sideways should give stamina back yes" (the brief's "won't allow for stamina regen" holds from the jog up,
     * `side`). Nought is the brief's line read to the letter.
     */
    sideWalk: number;
    /**
     * The most the pool regains a second in the air and in the water (nought: neither gives any back). What a class
     * spends it spends in the air too, so a sprint kept up by hopping costs what the sprint costs.
     */
    air: number;
    /** Emptied, the body is tired until the pool is back to this share of itself (the brief's 30%). */
    tiredUntil: number;
    /** How long the bar stays up after the pool is full again, seconds. */
    linger: number;
  };
  fade: {
    /** Between two of the walking and running clips, seconds, with the feet kept in step. */
    loco: number;
    /** Standing to moving and back, seconds. */
    idle: number;
    /** Into and out of Jedi Academy's own legs (the block, a swing), seconds. */
    jka: number;
  };
  turn: {
    /**
     * How much of a turned body's angle the torso takes back toward the view (the head's look takes what it can of
     * the rest). Half: a diagonal's 45 degrees is then 22 at the spine, which is the turn Jedi Academy's own torso
     * takes over angled legs.
     */
    torso: number;
    /** How fast the body comes round to where a clip wants it, a second (the game's own 14 for a body turning the way it runs). */
    rate: number;
    /**
     * With a blaster up over the classes' legs: how far the spine turns to bring the barrel onto the crosshair before
     * the body's own facing takes the rest, degrees. The game's own gun carries stand side-on and its aimed poses were
     * made over those; an imported clip keeps the hips square, so the same pose needs about twice the turn (66 degrees
     * measured for the rifle, against the 34 the spine takes over the game's own legs). Started at the most the spine
     * is ever given (69), so the body stays square to its legs and they carry it the way it really goes; lower, the
     * body turns for the aim instead and the legs cross their own travel by what it turned.
     */
    aimSpine: number;
  };
  fight: {
    /**
     * Under a block or a swing the legs are Jedi Academy's own, at the class's speed: its saber walk where that speed
     * is under this share of the point at which its walk played fast and its run played slow are equally far from
     * their own rates (the geometric mean of the two clips' own speeds), its run from there up. Started at that point
     * itself, 1: below it the walk's feet can keep to the ground and the run's cannot (the run at the jog's pace would
     * play under the half rate the game holds a clip above). Nought is the run at every class above the walk.
     */
    walkUnder: number;
  };
  peer: {
    /** How long another player's class must have stood before their figure changes clip for it, seconds: a body gathering speed passes through the slower classes' speeds for a few messages. */
    settle: number;
    /**
     * How far past the halfway line between two clips' ways another player's travel must lie before their legs change
     * way, degrees: ground that deflects a body (a slope climbed across, a wall slid along) turns its travel from its
     * heading by a few degrees, which must not flick its legs between two clips. A real change of way is 45 degrees.
     */
    hold: number;
  };
}

export const LOCO_TUNE: LocoTune = {
  on: true,
  gunSquare: true,
  sprintFight: 'ends',
  speed: {
    forward: { walk: 1.44, jog: 2.85, tired: 2.38, run: 4.9, sprint: 6.35 },
    back: { walk: 1.28, jog: 2.25, run: 2.93 },
    side: { walk: 0.59, jog: 2.89, run: 4.33 },
    forwardDiag: { walk: 1.67, jog: 2.66, run: 4.33 },
    backDiag: { walk: 1.28, jog: 2.18, run: 2.93 },
  },
  rate: { min: 0.6, max: 1.6, feet: 1 },
  shift: { dropDelay: 0.5, tapWindow: 0.35 },
  stamina: { pool: 100, sprint: -12, run: 0, jog: 4, walk: 10, back: 10, side: 0, sideWalk: 10, air: 0, tiredUntil: 0.3, linger: 1.5 },
  fade: { loco: 0.2, idle: 0.2, jka: 0.2 },
  turn: { torso: 0.5, rate: 14, aimSpine: 69 },
  fight: { walkUnder: 1 },
  peer: { settle: 0.25, hold: 12 },
};

/** What the game shipped with: what a reset puts back. */
export const LOCO_TUNE_SHIPPED: LocoTune = JSON.parse(JSON.stringify(LOCO_TUNE)) as LocoTune;

/** Each number's range, by its path: what a typed value is held to, and a slider's ends. */
export const LOCO_RANGES: Record<string, { min: number; max: number }> = {
  'speed.forward.walk': { min: 0.3, max: 4 },
  'speed.forward.jog': { min: 0.5, max: 6 },
  'speed.forward.tired': { min: 0.5, max: 6 },
  'speed.forward.run': { min: 1, max: 10 },
  'speed.forward.sprint': { min: 1, max: 14 },
  'speed.back.walk': { min: 0.3, max: 4 },
  'speed.back.jog': { min: 0.5, max: 6 },
  'speed.back.run': { min: 1, max: 10 },
  'speed.side.walk': { min: 0.2, max: 4 },
  'speed.side.jog': { min: 0.5, max: 6 },
  'speed.side.run': { min: 1, max: 10 },
  'speed.forwardDiag.walk': { min: 0.3, max: 4 },
  'speed.forwardDiag.jog': { min: 0.5, max: 6 },
  'speed.forwardDiag.run': { min: 1, max: 10 },
  'speed.backDiag.walk': { min: 0.3, max: 4 },
  'speed.backDiag.jog': { min: 0.5, max: 6 },
  'speed.backDiag.run': { min: 1, max: 10 },
  'rate.min': { min: 0.2, max: 1 },
  'rate.max': { min: 1, max: 3 },
  'rate.feet': { min: 0.8, max: 1.25 },
  'shift.dropDelay': { min: 0.05, max: 3 },
  'shift.tapWindow': { min: 0, max: 1.5 },
  'stamina.pool': { min: 10, max: 500 },
  'stamina.sprint': { min: -60, max: 0 },
  'stamina.run': { min: -30, max: 30 },
  'stamina.jog': { min: -30, max: 30 },
  'stamina.walk': { min: 0, max: 60 },
  'stamina.back': { min: -30, max: 60 },
  'stamina.side': { min: -30, max: 30 },
  'stamina.sideWalk': { min: -30, max: 60 },
  'stamina.air': { min: -30, max: 30 },
  'stamina.tiredUntil': { min: 0.01, max: 1 },
  'stamina.linger': { min: 0, max: 10 },
  'fade.loco': { min: 0, max: 1 },
  'fade.idle': { min: 0, max: 1 },
  'fade.jka': { min: 0, max: 1 },
  'turn.torso': { min: 0, max: 1 },
  'turn.rate': { min: 1, max: 40 },
  'turn.aimSpine': { min: 34, max: 69 },
  'fight.walkUnder': { min: 0, max: 2 },
  'peer.settle': { min: 0, max: 1 },
  'peer.hold': { min: 0, max: 22 },
};

const SWITCHES: readonly string[] = ['on', 'gunSquare'];
/** The switches that take one of their words, and the words. */
export const LOCO_CHOICES: Readonly<Record<string, readonly string[]>> = { sprintFight: ['ends', 'muted'] };

/**
 * Set numbers of the table from a nested object (`{ speed: { forward: { run: 5.2 } }, shift: { dropDelay: 0.8 } }`),
 * each held to its range; the two switches take true or false, and a choice one of its words. Answers words for
 * anything held, refused or not known; nothing is saved.
 */
export function tuneLoco(patch: unknown): string[] {
  const words: string[] = [];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return ['tune takes an object: { speed: { forward: { run: 5.2 } } }'];
  const walk = (at: Record<string, unknown>, values: Record<string, unknown>, path: string): void => {
    for (const [key, raw] of Object.entries(values)) {
      const here = path ? `${path}.${key}` : key;
      if (key === '__proto__' || key === 'constructor' || key === 'prototype' || !Object.prototype.hasOwnProperty.call(at, key)) {
        words.push(`no ${here}`);
        continue;
      }
      const now = at[key];
      if (now && typeof now === 'object') {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) words.push(`${here} takes an object of its numbers`);
        else walk(now as Record<string, unknown>, raw as Record<string, unknown>, here);
        continue;
      }
      if (SWITCHES.includes(here)) {
        // True or false, or the words the debug menu's dial shows (so the line it copies out sets what it says).
        const want = raw === 'on' ? true : raw === 'off' ? false : raw;
        if (typeof want !== 'boolean') words.push(`${here} takes true or false`);
        else at[key] = want;
        continue;
      }
      const words2 = LOCO_CHOICES[here];
      if (words2) {
        if (typeof raw !== 'string' || !words2.includes(raw)) words.push(`${here} takes ${words2.map((w) => `'${w}'`).join(' or ')}`);
        else at[key] = raw;
        continue;
      }
      const range = LOCO_RANGES[here];
      if (!range) {
        words.push(`no ${here}`);
        continue;
      }
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        words.push(`${here} takes a number`);
        continue;
      }
      const v = Math.min(range.max, Math.max(range.min, raw));
      if (v !== raw) words.push(`${here} held to ${v} (${range.min} to ${range.max})`);
      at[key] = v;
    }
  };
  walk(LOCO_TUNE as unknown as Record<string, unknown>, patch as Record<string, unknown>, '');
  return words;
}

/** Whether the classes stood on at load: off only for a stored '0'. A page that refuses storage has them on. */
export function locoSwitchOn(read: () => string | null): boolean {
  try {
    return read() !== '0';
  } catch {
    return true;
  }
}

/** `localStorage` key: '0' starts the game with the speed classes off. */
export const LOCO_SWITCH = 'swg.loco';
