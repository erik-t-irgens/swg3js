// A lightsaber in somebody else's hands: which keys a fighter or a person from the catalogue presses
// into the very move machine the player swings with (`src/combat/saber.ts`, Jedi Academy's styles,
// chains, specials and katas), and whether its blade turns a bolt away (`src/combat/deflect.ts`, the
// player's own blocking maths). The brain says fight; this says how, one frame at a time.
//
// **It is written fresh.** The move machine and the blocking maths are reused whole -- they are the
// player's, derived from OpenJK and carried under its licence (`LICENSES/OpenJK-GPL-2.0.txt`) -- and
// nothing here is taken from Jedi Academy's own NPC code, which was never read: the decisions below
// (when to hold attack, how long a chain runs, when to leap, when to kata, how often a bolt is turned)
// are this game's own and every number of them is invented.
//
// **What a tier earns** (the owner's gates, wave W9). Tiers 0 and 1 keep the random one-hand swings
// every bladed body has always had, and this does nothing for them at all. Tiers 2 and 3 swing the
// move machine within their one style: a wind-up, a chain of swings each starting where the last one
// ended, arcs between them and a return, held as long as the foe is in reach and in front, and let go
// after the tier's own count with a breath before the next. Tiers 4 and 5 add what the machine calls
// specials -- a leap at a foe a few metres off (the fast style's crouched lunge, the medium flip, the
// strong leap, the staff's butterfly), the back attack on somebody behind, the staff's kicks -- and
// the style's kata. How often a bolt is turned away is a chance by tier and not a gate, so the two
// middle rungs block now and then and the top ones often; how well it is sent back is the defence
// rank `deflect.ts` already reads, the top one sending it at whatever the blocker is fighting and
// blocking in the middle of a swing.
//
// **Which style is by seed**: a body's style comes out of the draw that armed it, among the styles its
// hilt can swing -- the player's own list (`Player.allowedStyles`): the three single styles for a
// one-bladed saber, the medium and the strong for a two-handed one, the staff for a double-bladed
// one, and never the dual style, since nobody but the player holds two.
//
// **How hard a chain hits is still the body's own.** A chain throws several swings where the old
// swings threw one a cooldown, and every one of them landing a whole blow would have made a bladed
// body two or three times as deadly as its own numbers say. So each swing of the machine's takes off
// a share of the body's own blow, measured from when its last one landed against its own cooldown
// between blows (`blowShare`): a swing a whole cooldown after the last lands all of it, one hard on
// its heels lands that much less, and over any stretch of a fight a body lands no more than one blow a
// cooldown, however many it swings. A miss spends nothing.
//
// **Left and right are the game's own**: a body facing `f` looks along `(sin f, cos f)` and its right
// is `(-cos f, sin f)`, as the player's camera and `evade.ts`'s rolls have them (`rightOf`).
//
// **No saber move while rolling or in the air**, unless it is a leap the style has: a roll or a jump
// of the body's own (`evade.ts`) presses nothing and tells the machine it is in a special jump, which
// ends a chain where it stands, while a leap the machine itself started is a special and plays out.
//
// Pure apart from the move machine: no rapier, no browser, no scene. A node test drives it
// (`tools/swg/tests/npcSaber.test.ts`), so every value import carries its extension. Nothing here
// allocates on a frame: the input is one kept struct, the foe-behind question is the owner's own
// closure made once, and the move machine hands back one kept record.
import type * as THREE from 'three';
import { ALT_ATTACK_POWER, MOVES, STANCE_ANIM, SaberCombat, animForStyle, animOf, type Dir, type SaberInput, type SaberPlay, type SaberStyle, type SaberVoice } from '../combat/saber.ts';
import { canBlock, inFront, parryClip, parryZone, reflectDirection, type ParryZone } from '../combat/deflect.ts';
import { evadeChance } from './evade.ts';

/** Metres to a Jedi Academy unit, which a move's leap is written in. */
export const JKA_UNIT = 0.0254;
/** How far behind a body somebody may stand for the back attack: Jedi Academy's 128 units. */
export const BACK_REACH = 128 * JKA_UNIT;
/** Where a body's eyes are over its feet, which a bolt it blocks is judged from: the player's own 1.55 m. */
export const BLOCK_EYE = 1.55;
/**
 * Seconds a move's push along the ground (the fast style's lunge) lasts, eased out to nothing; ours. A
 * leap's push and a move's own script stop once the body is within `closeTo` of what it fights, so a
 * leap chosen for a foe six metres off never lands it on the far side of that foe.
 */
export const LUNGE_PUSH = 0.45;

/** Every number the NPC half of the sabers has, all of them ours. */
export interface NpcSaberTune {
  /** The first tier whose bodies swing through the move machine at all; below it, the random swings every bladed body had. */
  chainFrom: number;
  /** The first tier that adds the specials, the katas and the leaps. */
  specialFrom: number;
  /** The chance a bolt reaching a lit blade is turned away, by tier 0 to 5. */
  deflect: number[];
  /** How well a turned bolt is sent back, by tier: `deflect.ts`'s defence rank (3 sends it at what the blocker fights, and blocks mid-swing). */
  rank: number[];
  /** The most swings a chain runs before the body lets go of attack, by tier. */
  chainMax: number[];
  /** Seconds it breathes after a chain before the next, by tier, and the share either way that is spread by. */
  rest: number[];
  restSpread: number;
  /** The Force its specials and katas are paid from, and what comes back of it a second. */
  force: number;
  forceRegen: number;
  /**
   * The share of its chains a tier with specials opens with its style's kata instead of a swing, when it
   * has the Force for one; and the share a staff opens with a kick. A draw per chain and not a rate a
   * second: a body in a fight stands at the ready for one frame between a breath and its next chain,
   * so a rate a second would all but never come up.
   */
  kataShare: number;
  kickShare: number;
  /** The share a second it leaps at a foe it is closing on, and the gap it leaps across, metres of air between the two bodies. */
  leapShare: number;
  leapFrom: number;
  leapTo: number;
  /** The same gap for the fast style's crouched lunge, which covers less ground. */
  lungeFrom: number;
  lungeTo: number;
  /** The share of fresh swings thrown in a direction (left, right or ahead) rather than from where the last one ended. */
  swingDirs: number;
  /** How far off its nose a foe may stand and still be swung at, radians: the fighters' own swing cone. */
  cone: number;
  /**
   * Metres of air between the two bodies at which a body swinging the machine stops closing and strikes,
   * and how far off its foe may drift before a chain under way is let go of. Arm and blade reach about
   * a metre past a body's own skin; the old swings opened at 1.9, where a swept blade could never land,
   * and a duel of two blades at that distance swung for a minute and cut nothing. Both ours.
   */
  closeTo: number;
  keepTo: number;
  /**
   * How many of its body's own blows a cooldown's worth of swinging may land (`blowShare`): 1 is the
   * rate the old swings landed them at, one a cooldown, which is the body's own number; a large one
   * lets every swing of a chain land a whole blow, for a comparison. Ours.
   */
  blowRate: number;
  /** Put every NPC blade on one tier (null: each body's own), and one style (null: each body's own): `__debug.blades({ tier, style })`. */
  tier: number | null;
  style: SaberStyle | null;
}

export const NPC_SABER_TUNE: NpcSaberTune = {
  chainFrom: 2,
  specialFrom: 4,
  deflect: [0, 0, 0.1, 0.25, 0.4, 0.6],
  rank: [0, 0, 1, 2, 2, 3],
  chainMax: [1, 1, 2, 3, 4, 5],
  rest: [1.3, 1.3, 1.4, 1.2, 1.0, 0.8],
  restSpread: 0.3,
  force: 100,
  forceRegen: 12,
  kataShare: 0.15,
  kickShare: 0.25,
  leapShare: 0.6,
  leapFrom: 3,
  leapTo: 6.5,
  lungeFrom: 1.2,
  lungeTo: 3.5,
  swingDirs: 0.5,
  cone: 0.5,
  closeTo: 1.0,
  keepTo: 1.6,
  blowRate: 1,
  tier: null,
  style: null,
};

/** Nothing may go negative. */
const TUNE_FLOOR: Partial<Record<keyof NpcSaberTune, number>> = { chainFrom: 0, specialFrom: 0, restSpread: 0, force: 0, forceRegen: 0, kataShare: 0, kickShare: 0, leapShare: 0, leapFrom: 0, leapTo: 0, lungeFrom: 0, lungeTo: 0, swingDirs: 0, cone: 0, closeTo: 0.1, keepTo: 0.1, blowRate: 0 };

/** The styles a body may swing: never the dual style, which takes a saber in each hand. */
const SINGLE_STYLES: readonly SaberStyle[] = ['fast', 'medium', 'strong'];
/** A two-handed hilt: the player's own rule (`Player.allowedStyles`), which has no fast style for it. */
const TWO_HANDED_STYLES: readonly SaberStyle[] = ['medium', 'strong'];
const STAFF_STYLES: readonly SaberStyle[] = ['staff'];
const ALL_STYLES: readonly SaberStyle[] = ['fast', 'medium', 'strong', 'staff'];

/** Write the finite numbers of `from` over a list in place, no further than it runs. */
function tuneList(list: number[], from: unknown, lo: number, hi: number): void {
  if (!Array.isArray(from)) return;
  for (let i = 0; i < list.length && i < from.length; i++) {
    const v = from[i];
    if (typeof v === 'number' && Number.isFinite(v)) list[i] = Math.min(hi, Math.max(lo, v));
  }
}

/**
 * Move the numbers live, and read back what is in force. The tables are written in place so every
 * body already standing hears the change; `tier` and `style` take null to hand each body back its own.
 */
export function tuneNpcSaber(opts?: Partial<NpcSaberTune> | null): NpcSaberTune {
  if (!opts) return NPC_SABER_TUNE;
  tuneList(NPC_SABER_TUNE.deflect, opts.deflect, 0, 1);
  tuneList(NPC_SABER_TUNE.rank, opts.rank, 0, 3);
  tuneList(NPC_SABER_TUNE.chainMax, opts.chainMax, 1, 32);
  tuneList(NPC_SABER_TUNE.rest, opts.rest, 0, 60);
  const into = NPC_SABER_TUNE as unknown as Record<string, number>;
  for (const key of Object.keys(TUNE_FLOOR) as (keyof NpcSaberTune)[]) {
    const v = opts[key];
    if (typeof v === 'number' && Number.isFinite(v)) into[key] = Math.max(TUNE_FLOOR[key] ?? 0, v);
  }
  if (opts.tier === null) NPC_SABER_TUNE.tier = null;
  else if (typeof opts.tier === 'number' && Number.isFinite(opts.tier)) NPC_SABER_TUNE.tier = Math.max(0, Math.min(5, Math.round(opts.tier)));
  if (opts.style === null) NPC_SABER_TUNE.style = null;
  else if (typeof opts.style === 'string' && (ALL_STYLES as readonly string[]).includes(opts.style)) NPC_SABER_TUNE.style = opts.style;
  return NPC_SABER_TUNE;
}

/** A tier's entry in one of the tables, the nearest end for a tier outside it. */
function byTier(list: readonly number[], tier: number): number {
  if (!list.length || !Number.isFinite(tier)) return 0;
  return list[Math.min(list.length - 1, Math.max(0, Math.round(tier)))];
}

/** Whether a tier swings through the move machine at all. */
export function chainsAt(tier: number, tune: NpcSaberTune = NPC_SABER_TUNE): boolean {
  return Number.isFinite(tier) && tier >= tune.chainFrom;
}

/** Whether a tier has the specials, the katas and the leaps. */
export function specialsAt(tier: number, tune: NpcSaberTune = NPC_SABER_TUNE): boolean {
  return chainsAt(tier, tune) && tier >= tune.specialFrom;
}

/** The chance a bolt reaching a lit blade at this tier is turned away. */
export function deflectChance(tier: number, tune: NpcSaberTune = NPC_SABER_TUNE): number {
  return Math.max(0, Math.min(1, byTier(tune.deflect, tier)));
}

/** The defence rank a turned bolt is sent back with at this tier. */
export function defenceRank(tier: number, tune: NpcSaberTune = NPC_SABER_TUNE): number {
  return Math.max(0, Math.min(3, Math.round(byTier(tune.rank, tier))));
}

/** The styles a hilt of this class can swing: the player's own list for the same hilt (`Player.allowedStyles`). */
export function stylesFor(weaponClass: string | null | undefined): readonly SaberStyle[] {
  return weaponClass === 'lightsaberStaff' ? STAFF_STYLES : weaponClass === 'lightsaber2h' ? TWO_HANDED_STYLES : SINGLE_STYLES;
}

/**
 * The share of a body's own blow a swing of the machine's takes off, `since` seconds after its last
 * blow landed, against the body's own `cooldown` between blows: all of it once a cooldown has passed
 * (at `rate` 1), and that much less for a swing on the heels of the last. Summed over a fight, a body
 * lands no more than `rate` blows a cooldown plus the first, however many swings its chains throw --
 * which is its own number, as the old one-swing-a-cooldown clock had it. A body with no cooldown of
 * its own lands every swing whole.
 */
export function blowShare(since: number, cooldown: number, rate: number = NPC_SABER_TUNE.blowRate): number {
  if (!(cooldown > 0)) return 1;
  if (!(rate > 0) || !(since > 0)) return 0;
  return Math.min(1, (since * rate) / cooldown);
}

/**
 * A body's right on the ground, for a body facing `facing` (forward along `(sin, cos)`): `(-cos, sin)`,
 * which is the player's camera's own right and `evade.ts`'s roll to the right.
 */
export function rightOf(facing: number, out: { x: number; z: number }): { x: number; z: number } {
  out.x = -Math.cos(facing);
  out.z = Math.sin(facing);
  return out;
}

/**
 * A push `forward` along a body's facing and `right` to its right, as a ground vector written into
 * `out`: what a move's leap, a lunge and a move's own scripted steps carry the body by.
 */
export function alongFacing(facing: number, forward: number, right: number, out: { x: number; z: number }): { x: number; z: number } {
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  out.x = s * forward - c * right;
  out.z = c * forward + s * right;
  return out;
}

/**
 * The frame a bolt meeting a body's blade is judged in, written into `a`: its eye `eyeHeight` over its
 * feet at (`x`, `y`, `z`), the way it faces and its right, both on the ground plane. One function for a
 * fighter and a person from the catalogue alike, so the two can never disagree about which side is which.
 */
export function blockFrame(a: BlockAsk, x: number, y: number, z: number, facing: number, eyeHeight: number): BlockAsk {
  a.eye.set(x, y + eyeHeight, z);
  a.forward.set(Math.sin(facing), 0, Math.cos(facing));
  a.right.set(-Math.cos(facing), 0, Math.sin(facing));
  return a;
}

/** A body's own style out of its draw (0 to 1), among those its hilt can swing: the style by seed. */
export function styleOf(r01: number, weaponClass: string | null | undefined): SaberStyle {
  const list = stylesFor(weaponClass);
  const r = Number.isFinite(r01) ? Math.min(0.999999, Math.max(0, r01)) : 0;
  return list[Math.floor(r * list.length)];
}

/**
 * Every clip the move machine can ask for in a style -- the attacks, their wind-ups and returns, the
 * arcs between, the specials, the stance -- and the style's parries. What a person from the catalogue
 * is lent from a species rig that is already parsed, as the ten one-hand swings always were.
 */
export function styleClipNames(style: SaberStyle): string[] {
  const out = new Set<string>();
  for (const move of MOVES.values()) {
    if (move.kind === 'none') continue;
    out.add(animForStyle(move, style));
  }
  out.add(STANCE_ANIM[style]);
  // The parries are named by `parryClip` itself, asked with a lookup that has nothing and writes down
  // every name it tries -- the style's own and the single styles' it falls back on -- so this list can
  // never drift from the names the parry is really played by.
  const note = (clip: string): boolean => {
    out.add(clip);
    return false;
  };
  for (const zone of PARRY_ZONES) parryClip(style, zone, note);
  return [...out];
}

/** Every place on a body a bolt can be parried at. */
export const PARRY_ZONES: readonly ParryZone[] = ['top', 'upperRight', 'upperLeft', 'lowerRight', 'lowerLeft'];

/** The three moves a style cannot swing a chain without: its overhead, that overhead's wind-up and its return. */
const CHAIN_CORE = ['A_T2B', 'S_T2B', 'R_T2B'];

/**
 * Whether a body can draw a style's moves at all, by whether it has that style's overhead, its wind-up
 * and its return: a person from the catalogue before a species rig has lent it anything has none, and
 * is left to swing as it always did rather than run a machine it cannot draw.
 */
export function canSwing(style: SaberStyle, has: (clip: string) => boolean): boolean {
  for (const name of CHAIN_CORE) {
    const move = MOVES.get(name);
    if (!move || !has(animOf(move, style))) return false;
  }
  return true;
}

/** The clips of every style a body may swing, once: what the manager lends, so a style put on from the console has its clips too. */
export const NPC_SABER_CLIPS: readonly string[] = (() => {
  const out = new Set<string>();
  for (const style of ALL_STYLES) for (const name of styleClipNames(style)) out.add(name);
  return [...out];
})();

/**
 * Whether a point lies in a direction from a body facing `heading`, within `radius`: ahead of it along
 * that direction, within 0.8 m of the line and 2 m of its height -- the player's own test for somebody
 * standing behind (`Player.enemyNear`), for a body's own foe-behind question.
 */
export function liesToward(dir: Dir, radius: number, heading: number, x: number, y: number, z: number, px: number, py: number, pz: number): boolean {
  const sx = Math.sin(heading);
  const sz = Math.cos(heading);
  // Ahead is (sin, cos) and its right (-cos, sin) (`rightOf`); behind and its left the opposites.
  const dx = dir === 'F' ? sx : dir === 'B' ? -sx : dir === 'R' ? -sz : sz;
  const dz = dir === 'F' ? sz : dir === 'B' ? -sz : dir === 'R' ? sx : -sx;
  const ox = px - x;
  const oz = pz - z;
  const along = ox * dx + oz * dz;
  const across = Math.abs(ox * dz - oz * dx);
  return along > 0 && along < radius + 0.5 && across < 0.8 && Math.abs(py - y) < 2;
}

/** What a body tells its blade each frame: primitives only, one kept per body and written into. */
export interface BladeAsk {
  /** Seconds of the world's simulated clock, and this step's length. */
  now: number;
  dt: number;
  /** The blade out and in the hand: a body not fighting has it put away, and its moves go with it. */
  lit: boolean;
  /** Something alive to fight. */
  hasTarget: boolean;
  /** The brain says strike it now, with the blade: the attack state, in reach, nothing between. */
  attackState: boolean;
  /** The brain says close on it, with nothing between: where a leap is worth it. */
  chasing: boolean;
  /** Metres of air between the two bodies, and how near counts as in reach. */
  gap: number;
  reach: number;
  /** How far off its nose the foe stands, radians. */
  offNose: number;
  /** On the ground; its vertical speed, metres a second; and how far over the ground it is, metres. */
  grounded: boolean;
  vy: number;
  above: number;
  /** Rolling, or in the air on a jump of its own (not a leap of the blade's). */
  tumbling: boolean;
  /** Staggered or held: it presses nothing. */
  stunned: boolean;
}

/** What a bolt meeting the blade is judged from, one kept per body and written into. */
export interface BlockAsk {
  /** The blade out and in the hand. */
  lit: boolean;
  /** Rolling or in the air on a jump of its own. */
  tumbling: boolean;
  /** The bolt's heading, and where it struck. */
  dir: THREE.Vector3;
  hit: THREE.Vector3;
  /** The body's eye, the way it faces and its right, on the ground plane. */
  eye: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  /** Where a bolt sent back at the top rank goes: at what it is fighting, else where it faces. */
  look: THREE.Vector3;
}

/** A body's own record of what its blade did, and the sum over every body since the console last cleared it. */
export interface NpcSaberCounts {
  /** Attack moves swung, chains that ran (a wind-up to a return), and the specials among the swings. */
  swings: number;
  chains: number;
  specials: number;
  katas: number;
  leaps: number;
  lunges: number;
  kicks: number;
  backs: number;
  /** Bolts that reached the blade lit, those it was placed to block, and those it turned away. */
  reached: number;
  could: number;
  blocks: number;
}

const zeroCounts = (): NpcSaberCounts => ({ swings: 0, chains: 0, specials: 0, katas: 0, leaps: 0, lunges: 0, kicks: 0, backs: 0, reached: 0, could: 0, blocks: 0 });

/** Every NPC blade's counts together, and the simulated second they were last cleared: `__debug.blades()`. */
export const NPC_SABER_STATS: NpcSaberCounts & { since: number } = { ...zeroCounts(), since: 0 };

/** Clear the totals, from `now` (seconds of the world's simulated clock). */
export function clearNpcSaberStats(now: number): void {
  Object.assign(NPC_SABER_STATS, zeroCounts());
  NPC_SABER_STATS.since = now;
}

/** One count up, on the body and in the totals together. */
function count(own: NpcSaberCounts, key: keyof NpcSaberCounts): void {
  own[key]++;
  NPC_SABER_STATS[key]++;
}

const LEAPS = new Set(['A_FLIP_SLASH', 'A_JUMP_T2B', 'JUMPATTACK_STAFF_RIGHT', 'JUMPATTACK_STAFF_LEFT', 'JUMPATTACK_DUAL']);
const BACKS = new Set(['A_BACKSTAB', 'A_BACK', 'A_BACK_CR']);

/**
 * One body's lightsaber: the move machine, the keys it is pressed with, the Force it pays for its
 * specials out of, and the breath it takes between chains. Made when a lightsaber goes into the hand
 * and kept for as long as it is held; `step` once a frame, whatever the body is doing, so a move under
 * way always ends and a blade put away always lets its move go.
 */
export class NpcSaber {
  readonly combat = new SaberCombat();
  /** Its own style, drawn when it was armed; the console's (`NPC_SABER_TUNE.style`) goes over it where the hilt can swing that. */
  own: SaberStyle = 'medium';
  /** The class of the hilt in its hand, which decides which styles it may swing at all. */
  weaponClass: string | null = null;
  /** The tier its body fights at; the console's (`NPC_SABER_TUNE.tier`) goes over it. */
  tier = 0;
  /** The Force its specials are paid out of. */
  force = NPC_SABER_TUNE.force;
  /** Where its dice come from: the dice, unless a test hands in its own. */
  rand: () => number = Math.random;
  /** Whether a foe stands within a radius in a direction off its nose: the body's own closure, made once. */
  enemyNear: ((dir: Dir, radius: number) => boolean) | null;
  readonly counts: NpcSaberCounts = zeroCounts();
  /** What it presses this frame, written in place: the move machine reads it and keeps nothing. */
  private readonly input: SaberInput = {
    attack: false,
    attackPressed: false,
    altAttack: false,
    altAttackPressed: false,
    fmove: 0,
    smove: 0,
    grounded: true,
    vy: 0,
    aboveGround: 0,
    jumpHeld: false,
    crouch: false,
    force: 100,
    jumpPressed: false,
    enemyNear: undefined,
    rollEnding: false,
    inSpecialJump: false,
  };
  /** Until when it breathes after a chain, pressing nothing. */
  private restUntil = -Infinity;
  /** Swings since the chain began, and whether it has let go of attack to end the chain. */
  private inChain = 0;
  private letGo = false;
  /** The direction its next swing is thrown in, drawn as the last one began. */
  private dirF = 0;
  private dirS = 0;
  /** How the chain it is about to open opens, drawn once at the ready and forgotten as any move begins; null before the draw. */
  private opening: 'swing' | 'kata' | 'kick' | null = null;
  /** A spread of -1 to 1 for the bolt a top-rank block sends back, out of its own dice; made once. */
  private readonly spread = (): number => this.rand() * 2 - 1;
  /** The simulated second its blade last landed a blow on anything, which the next swing's share is measured from. */
  private landedAt = -Infinity;

  constructor(voice: SaberVoice | null = null, enemyNear: ((dir: Dir, radius: number) => boolean) | null = null) {
    if (voice) this.combat.voice = voice;
    this.enemyNear = enemyNear;
  }

  /** The tier its blade is judged at: the console's, else its body's. */
  get bladeTier(): number {
    return NPC_SABER_TUNE.tier ?? this.tier;
  }

  /** Whether it swings the move machine at all this instant (tier 2 up); below that its body swings as it always did. */
  get active(): boolean {
    return chainsAt(this.bladeTier);
  }

  /** Whether it has the specials, the katas and the leaps (tier 4 up). */
  get specials(): boolean {
    return specialsAt(this.bladeTier);
  }

  /** The style it swings: the console's where its hilt can swing it, else its own. */
  get style(): SaberStyle {
    const forced = NPC_SABER_TUNE.style;
    return forced && stylesFor(this.weaponClass).includes(forced) ? forced : this.own;
  }

  /** A move other than the ready stance is under way: the body stands for it. */
  get busy(): boolean {
    return this.combat.busy;
  }

  /** A move that cuts is under way: the blade sweeps, and `attackId` says which swing it is. */
  get attacking(): boolean {
    return this.combat.attacking;
  }

  /** A whole-body special is under way (a leap, a kata, a kick): the body is carried by its clip and drawn whole. */
  get special(): boolean {
    return this.combat.current.kind === 'special';
  }

  /**
   * One frame: the keys this body would press, handed to the move machine, and what it answers -- the
   * move to play when one begins, else null. `clipLength` answers how long an animation this body can
   * play lasts, or null. Below tier 2, or with the blade put away, the machine is let go of and
   * nothing is pressed.
   */
  step(a: BladeAsk, clipLength: (anim: string) => number | null): SaberPlay | null {
    const t = NPC_SABER_TUNE;
    const c = this.combat;
    const on = a.lit && this.active;
    this.force = Math.min(t.force, this.force + t.forceRegen * Math.max(0, a.dt));
    // A change of style is taken at the next move, which is when the machine next reads it: the move
    // under way was chosen, and is being played, in the style it began in.
    c.style = this.style;
    const inp = this.input;
    inp.attack = false;
    inp.attackPressed = false;
    inp.altAttack = false;
    inp.altAttackPressed = false;
    inp.jumpPressed = false;
    inp.jumpHeld = false;
    inp.crouch = false;
    inp.fmove = 0;
    inp.smove = 0;
    inp.grounded = a.grounded;
    inp.vy = a.vy;
    inp.aboveGround = a.grounded ? 0 : Math.max(0, a.above);
    inp.force = this.force;
    inp.rollEnding = false;
    // Rolling or in the air on a jump of its own: the machine ends a chain where it stands, and a leap
    // the machine began itself (a special) plays out.
    inp.inSpecialJump = a.tumbling;
    // Somebody behind is the back attack, a special: only the tiers that have them are told.
    inp.enemyNear = this.specials && this.enemyNear ? this.enemyNear : undefined;
    if (on && a.hasTarget && !a.stunned && !a.tumbling && a.now >= this.restUntil && !this.letGo) this.press(a);
    const play = c.update(a.dt, on, inp, clipLength);
    if (play) this.took(play, a.now);
    return play;
  }

  /** Which keys it presses this frame, given it is free to press any. */
  private press(a: BladeAsk): void {
    // Off the ground -- up on a leap of the machine's own, or thrown -- it presses nothing: the leap plays
    // out, and a chain begun on the ground ends where it stands rather than swinging on in the air.
    if (!a.grounded) return;
    const t = NPC_SABER_TUNE;
    const c = this.combat;
    const inp = this.input;
    const facing = Math.abs(a.offNose) <= t.cone;
    const ready = c.current.kind === 'ready';
    const specials = this.specials;
    if (a.attackState && a.gap <= a.reach && facing) {
      inp.attack = true;
      inp.attackPressed = ready;
      inp.fmove = this.dirF;
      inp.smove = this.dirS;
      if (specials && ready) {
        // Standing in reach at the ready, about to open a chain: one draw for how it opens -- now and then
        // the style's kata, paid for out of the Force, and a staff now and then with a kick. A draw that
        // no longer fits is drawn again rather than pressed for ever -- a kick for a style with no kick
        // would stand at the ready pressing a key that starts nothing. The draw and the machine read the
        // same style and Force in the same frame, so nothing reaches that today; it is kept that way.
        if ((this.opening === 'kick' && c.style !== 'staff') || (this.opening === 'kata' && this.force < ALT_ATTACK_POWER.kata)) this.opening = null;
        if (this.opening === null) {
          const r = this.rand();
          this.opening = r < t.kataShare && this.force >= ALT_ATTACK_POWER.kata ? 'kata' : c.style === 'staff' && r < t.kataShare + t.kickShare ? 'kick' : 'swing';
        }
        if (this.opening === 'kata') {
          inp.altAttack = true;
          inp.fmove = 0;
          inp.smove = 0;
          return;
        }
        if (this.opening === 'kick') {
          // Straight ahead, at the foe standing there: the kick's way is read off the direction keys
          // (`kickForMovement`), and the last swing's sideways draw would kick the air beside it.
          inp.attack = false;
          inp.attackPressed = false;
          inp.altAttackPressed = true;
          inp.fmove = 0;
          inp.smove = 0;
          return;
        }
      }
      // Somebody hostile behind it as the next swing is chosen: the back attack.
      if (specials && (ready || c.timer <= a.dt) && this.enemyNear?.('B', BACK_REACH)) {
        inp.fmove = -1;
        inp.smove = 0;
      }
      return;
    }
    // Closing on a foe a few metres off, on the ground at the ready and pointed at it: the leap.
    if (!specials || !a.chasing || !ready || !a.grounded || !facing) return;
    const style = c.style;
    const lunge = style === 'fast';
    const from = lunge ? t.lungeFrom : t.leapFrom;
    const to = lunge ? t.lungeTo : t.leapTo;
    if (!(a.gap >= from && a.gap <= to)) return;
    if (this.force < ALT_ATTACK_POWER.forwardBack || !(this.rand() < evadeChance(t.leapShare, a.dt))) return;
    inp.attack = true;
    inp.fmove = 1;
    // The fast style has no forward leap; its closing special is the crouched lunge, from the ready.
    if (lunge) {
      inp.attackPressed = true;
      inp.crouch = true;
    } else {
      inp.jumpPressed = true;
      inp.jumpHeld = true;
    }
  }

  /** A move began: pay for it, count it, and decide how the chain goes on. */
  private took(play: SaberPlay, now: number): void {
    const t = NPC_SABER_TUNE;
    if (play.forceCost > 0) this.force = Math.max(0, this.force - play.forceCost);
    const move = play.move;
    // The next time it stands at the ready to open a chain, it draws again.
    this.opening = null;
    if (move.kind === 'attack' || move.kind === 'special') {
      this.inChain++;
      if (move.kind === 'attack') count(this.counts, 'swings');
      else {
        count(this.counts, 'specials');
        if (move.kata) count(this.counts, 'katas');
        else if (move.kick) count(this.counts, 'kicks');
        else if (move.name === 'A_LUNGE') count(this.counts, 'lunges');
        else if (LEAPS.has(move.name)) count(this.counts, 'leaps');
        else if (BACKS.has(move.name)) count(this.counts, 'backs');
      }
      // The next swing's direction, drawn as this one begins: most from where this one ends (the
      // machine's own walk round the quadrants), the rest thrown left, right or ahead.
      const r = this.rand();
      if (r >= t.swingDirs) {
        this.dirF = 0;
        this.dirS = 0;
      } else {
        const k = Math.floor((r / Math.max(1e-6, t.swingDirs)) * 3);
        this.dirF = k === 2 ? 1 : 0;
        this.dirS = k === 0 ? 1 : k === 1 ? -1 : 0;
      }
      // A kata and a kick end a chain of themselves, and a chain run to the tier's count lets go. A leap
      // does not: it lands in reach, and a body that has just leapt in swings on from where it came down.
      if (move.kata || move.kick || this.inChain >= byTier(t.chainMax, this.bladeTier)) this.letGo = true;
    } else if (move.kind === 'ready') {
      if (this.inChain > 0) {
        count(this.counts, 'chains');
        const base = byTier(t.rest, this.bladeTier);
        this.restUntil = now + Math.max(0, base * (1 + (this.rand() * 2 - 1) * t.restSpread));
      }
      this.inChain = 0;
      this.letGo = false;
    }
  }

  /**
   * A bolt reached the body: whether the blade turns it away, writing where to `out` and answering the
   * parry for where it struck, or null to let it strike. It must be lit and in front of the body, not
   * in a special or a roll, and not mid-swing below the top rank (`canBlock`, the player's own rule),
   * and then the tier's own chance says whether it is.
   */
  block(a: BlockAsk, out: THREE.Vector3): ParryZone | null {
    const tier = this.bladeTier;
    const chance = deflectChance(tier);
    if (!a.lit || !(chance > 0)) return null;
    count(this.counts, 'reached');
    const c = this.combat;
    const rank = defenceRank(tier);
    if (!canBlock({ blocking: true, saberOn: true, inHand: true, attacking: c.attacking, special: a.tumbling || c.current.kind === 'special', rank })) return null;
    if (!inFront(a.hit, a.eye, a.forward)) return null;
    count(this.counts, 'could');
    if (!(this.rand() < chance)) return null;
    reflectDirection(rank, a.dir, a.look, out, this.spread);
    count(this.counts, 'blocks');
    return parryZone(a.hit, a.eye, a.right);
  }

  /** Put away, thrown about or gone: the move let go of, its whooshes still to come with it, and a fresh breath. */
  holster(): void {
    if (this.combat.move !== 'NONE') this.combat.holster();
    this.inChain = 0;
    this.letGo = false;
    this.opening = null;
    this.restUntil = -Infinity;
  }

  /** A fresh life: the whole of its Force back, and its first blow a whole one. */
  refill(): void {
    this.force = NPC_SABER_TUNE.force;
    this.landedAt = -Infinity;
  }

  /**
   * The share of its body's own blow a swing (or a kick) opening at `now` takes off, against the body's
   * own `cooldown` between blows (`blowShare`): what the body multiplies its blow by for everything
   * that swing lands. Asked once as each swing opens; nothing here moves until one lands.
   */
  shareOf(now: number, cooldown: number): number {
    return blowShare(now - this.landedAt, cooldown);
  }

  /** Its swing landed on something at `now`: the next one's share is measured from here. A miss never comes here, and spends nothing. */
  landed(now: number): void {
    this.landedAt = now;
  }

  /** For the console: its tier and style, what it is swinging, what is left of its Force and what it has done. */
  status(now: number): Record<string, unknown> {
    const c = this.combat;
    return {
      tier: this.bladeTier,
      active: this.active,
      specials: this.specials,
      style: this.style,
      own: this.own,
      move: c.move,
      chain: this.inChain,
      restsFor: Number(Math.max(0, this.restUntil - now).toFixed(2)),
      force: Number(this.force.toFixed(0)),
      sinceBlow: Number.isFinite(this.landedAt) ? Number((now - this.landedAt).toFixed(2)) : null,
      deflect: deflectChance(this.bladeTier),
      counts: { ...this.counts },
    };
  }
}

/**
 * The half of `__debug.blades()` this file answers: every NPC blade's totals since they were cleared,
 * the same per minute of the world's clock, and the tuning. `tier` and `style` put every NPC blade on
 * one rung and one style (null hands each its own back); `tune` moves the numbers; `reset` clears the
 * totals from `now`. Console only, so it may allocate.
 */
export function npcSaberReport(now: number, opts?: { tier?: number | null; style?: SaberStyle | null; tune?: Partial<NpcSaberTune> | null; reset?: boolean } | null): Record<string, unknown> {
  if (opts) {
    if (opts.tune) tuneNpcSaber(opts.tune);
    if (opts.tier !== undefined) tuneNpcSaber({ tier: opts.tier });
    if (opts.style !== undefined) tuneNpcSaber({ style: opts.style });
    if (opts.reset) clearNpcSaberStats(now);
  }
  const s = NPC_SABER_STATS;
  const minutes = Math.max(1e-6, (now - s.since) / 60);
  const per = (n: number): number => Number((n / minutes).toFixed(2));
  return {
    since: Number(s.since.toFixed(1)),
    minutes: Number(minutes.toFixed(2)),
    total: { swings: s.swings, chains: s.chains, specials: s.specials, katas: s.katas, leaps: s.leaps, lunges: s.lunges, kicks: s.kicks, backs: s.backs, reached: s.reached, could: s.could, blocks: s.blocks },
    perMinute: { swings: per(s.swings), chains: per(s.chains), specials: per(s.specials), katas: per(s.katas), leaps: per(s.leaps), blocks: per(s.blocks) },
    tune: { ...NPC_SABER_TUNE, deflect: [...NPC_SABER_TUNE.deflect], rank: [...NPC_SABER_TUNE.rank], chainMax: [...NPC_SABER_TUNE.chainMax], rest: [...NPC_SABER_TUNE.rest] },
  };
}
