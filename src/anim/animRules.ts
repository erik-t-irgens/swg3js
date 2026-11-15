// Which imported clip the player's body plays when: the brief's "Generic" list as rules. Each answers with a clip's
// name, or null for "what the game played before", and never names a clip the rig has not got: a rig without the
// imported animations (no pack, the switch off, an older build's peer) is asked the same questions and gets null
// every time, which is today's game.
//
// Pure: the player's update calls these, and the node tests call the very same functions.

import type { AnimTune } from './animTune.ts';

/** The clips wave 1 plays, by the game's names. */
export const MX = {
  tread: 'mx_treading_water',
  adrift: 'mx_flying',
  thrown: 'mx_falling',
  impact: 'mx_falling_flat_impact',
  jump: 'mx_jumping_up',
  fall: 'mx_falling_idle',
  float: 'mx_floating',
  landSoft: 'mx_jumping_down',
  land: 'mx_falling_to_landing',
  landHard: 'mx_hard_landing',
} as const;

/** Whether a rig has a clip: `rig.has`, handed in. */
export type Has = (clip: string) => boolean;

/** A one-off and where it starts. */
export interface OneOff {
  clip: string;
  /** Seconds into the clip (its trim). */
  from: number;
  fade: number;
}

/**
 * The jump's start. A plain jump, in every class, is the imported one; with Jedi Academy's animations in charge
 * (blocking or attacking: its legs stay under a swing) the jump stays that game's own, direction and all.
 */
export function jumpStart(has: Has, jkaMode: boolean, tune: AnimTune): OneOff | null {
  if (jkaMode || !has(MX.jump)) return null;
  return { clip: MX.jump, from: tune.trim.jumping_up, fade: tune.jump.fade };
}

/**
 * The loop in the air. Thrown from a wreck: the long fall. With Jedi Academy's animations in charge (a swing, the
 * block held): that game's own. After a flip, a Force jump or a wall move (whose own clip plays first, as a one-off
 * over this): the float. Anything else (a plain jump, a hop, a step off a ledge): the falling loop. Null where the
 * answer is the game's own, or the rig has not got the one asked for: the caller plays what it always did.
 */
export function airLoop(has: Has, thrown: boolean, force: boolean, jka: boolean): string | null {
  if (!thrown && jka) return null;
  const clip = thrown ? MX.thrown : force ? MX.float : MX.fall;
  return has(clip) ? clip : null;
}

/**
 * Whether a landing clip that has played for `played` seconds gives way to the keys: a body the keys are moving does
 * not hold its landing to the end, since the feet would slide under it for as long as the clip had left to run.
 */
export function landingYields(played: number, moving: boolean, tune: AnimTune): boolean {
  return moving && played >= tune.land.moveCut;
}

/** What a landing was, as the movement step reports it. */
export interface Landing {
  /** How fast the body came down, m/s (positive). */
  speed: number;
  /** The fall's harm; 0 for none. */
  harm: number;
  /** The air time held a flip, a Force jump or a wall move. */
  force: boolean;
  /** The landing rolled out. */
  rolled: boolean;
  /** Jedi Academy's animations are in charge: a saber move under way, or the block held. */
  jka: boolean;
}

/** A landing too gentle for any clip: the body simply stands. */
export const NO_LANDING = 'nothing';

/**
 * The landing's clip. A roll and a landing with Jedi Academy's animations in charge (in the middle of a swing, behind
 * a block) are that game's own, as is a Force jump's that does no harm; a landing that harms is the hard one for every
 * class; and from the falling loop a slow landing is the short one and a faster one the longer, with none at all
 * under `land.min`. Null is "as before": the caller plays what it always played, by its own rule.
 */
export function landing(has: Has, l: Landing, tune: AnimTune): OneOff | typeof NO_LANDING | null {
  if (l.rolled || l.jka) return null;
  if (l.harm > 0) return has(MX.landHard) ? { clip: MX.landHard, from: tune.trim.hard_landing, fade: tune.land.fade } : null;
  if (l.force) return null;
  const clip = l.speed < tune.land.soft ? MX.landSoft : MX.land;
  if (!has(clip)) return null;
  if (l.speed < tune.land.min) return NO_LANDING;
  return { clip, from: clip === MX.landSoft ? tune.trim.jumping_down : tune.trim.falling_to_landing, fade: tune.land.fade };
}

/** The thrown fall's end: the impact from its trim, or null without it (the body goes straight to lying, as before). */
export function impact(has: Has, tune: AnimTune): OneOff | null {
  return has(MX.impact) ? { clip: MX.impact, from: tune.trim.falling_flat_impact, fade: tune.impact.fade } : null;
}

/** How long the keys are held after an impact that plays for `seconds`. */
export function impactHold(seconds: number, tune: AnimTune): number {
  return Math.max(0, seconds) * Math.min(1, Math.max(0, tune.impact.lock));
}

/** A landing's speed from the movement step's landing "delta" (the speed in its own units, squared, over ten thousand), m/s. */
export function landingSpeed(delta: number, unit: number): number {
  return Math.sqrt(Math.max(0, delta) * 10000) * unit;
}

/**
 * The actions held while an impact plays: moving, jumping, the postures, the fight, the six ability slots (a Force
 * jump from one launched the body out of the impact), the grapple's shot (which hauls it) and the four emote keys
 * (which would play over it). Muted by action for the rest of each frame the hold lasts (`Input.mute`), before
 * anything reads a key. Left alone on purpose: the use key (getting on something ends the hold), the saber's switch,
 * the class switch, the emote wheel and every panel's key, none of which moves a body lying where it fell.
 */
export const IMPACT_MUTES: readonly string[] = [
  'forward', 'back', 'left', 'right', 'jump', 'crouch', 'prone', 'kneel',
  'attack', 'altAttack', 'altFire', 'block', 'saberThrow',
  'slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6',
  'grappleFire', 'emote1', 'emote2', 'emote3', 'emote4',
];
