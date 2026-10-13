// What a blow, a fall or the player's own blast does to their health, as one pure rule `Player.takeDamage` asks,
// so a node test can ask it too. Before progress it was one line -- god mode refuses, else health less the blow
// times what is taken -- and with nothing earned it is still exactly that line, to the bit.
//
// What progress adds, both off until earned: **a roll's first moments dodge a blow** (`roll.iframes`, seconds;
// Acrobatics), refusing a blow from something -- never a fall, never the player's own blast or cloud, never the
// surroundings, never the console's kill -- which is said as a dodge of whatever struck; and **last stand**
// (Fortitude 75), armed by the encounter as a fight opens, which leaves one point of health under a blow, a fall or
// the surroundings that would have killed, once. God mode answers first, as it always did.
//
// **The surroundings are a kind of their own** (`env`): what reaches the player's record with nothing that struck
// and nowhere it came from -- the lava's heat, the water's drowning, a fire's tick -- and a crash, which is a fall
// at speed. A roll does not dodge the lava, and standing in it in a fight buys no Fortitude (`Encounters.hurt`
// counts a `blow` alone): read as a blow, a roll timed to each second's tick crossed a flow unhurt.
//
// `takeHarm` is the whole of what `Player.takeDamage` does past god mode, over a body that is only the fields it
// reads and writes, so the node test runs the glue itself with the real movement and the real stats.

/** What a loss of health is: a blow from something, a fall, the player's own blast or cloud, or the surroundings. */
export type HarmKind = 'blow' | 'fall' | 'self' | 'env';

/** What the rule is asked. */
export interface HarmAsk {
  hp: number;
  amount: number;
  /** What hurts the player counts for (Force Protect lowers it). */
  taken: number;
  /** The console's own kill, which nothing refuses. */
  force: boolean;
  kind: HarmKind;
  god: boolean;
  /** Seconds since the roll under way began, Infinity when not rolling. */
  rollElapsed: number;
  /** Seconds of a roll's start that dodge a blow (`roll.iframes`, nought until earned). */
  iframes: number;
  /** Last stand is armed. */
  lastStand: boolean;
}

/** What the rule answers, written into a kept struct. */
export interface HarmAnswer {
  /** Why the blow did nothing: god mode, or a roll dodged it; null when it landed. */
  refused: 'god' | 'dodge' | null;
  /** Health after it. */
  hp: number;
  /** Health really lost. */
  lost: number;
  /** Last stand was spent on it. */
  stood: boolean;
}

export function newHarm(): HarmAnswer {
  return { refused: null, hp: 0, lost: 0, stood: false };
}

export function newHarmAsk(): HarmAsk {
  return { hp: 0, amount: 0, taken: 1, force: false, kind: 'blow', god: false, rollElapsed: Infinity, iframes: 0, lastStand: false };
}

/** The rule, answered into `out` (allocating nothing). */
export function harmOf(a: HarmAsk, out: HarmAnswer): HarmAnswer {
  out.refused = null;
  out.stood = false;
  out.hp = a.hp;
  out.lost = 0;
  if (a.god && !a.force) {
    out.refused = 'god';
    return out;
  }
  if (!a.force && a.kind === 'blow' && a.iframes > 0 && a.rollElapsed < a.iframes) {
    out.refused = 'dodge';
    return out;
  }
  let hp = Math.max(0, a.hp - a.amount * a.taken);
  if (hp <= 0 && a.lastStand && !a.force && a.kind !== 'self' && a.hp > 0) {
    hp = Math.min(a.hp, 1);
    out.stood = true;
  }
  out.hp = hp;
  out.lost = Math.max(0, a.hp - hp);
  return out;
}

/**
 * What a loss through the player's own record (`World.playerTarget.damage`) is: a blow when something struck or
 * it came from somewhere, else the surroundings'. The lava, the water and a fire's tick hand the record neither.
 */
export function recordHarmKind(source: unknown, from: unknown): HarmKind {
  return source || from ? 'blow' : 'env';
}

/** The fields of a body `takeHarm` reads and writes: `Player` satisfies it as it stands. */
export interface HarmBody {
  hp: number;
  lastStand: boolean;
  readonly god: boolean;
  readonly damageTaken: number;
  readonly jka: { readonly rollElapsed: number };
  readonly stats: { readonly rollIframes: number };
  onHarm: ((lost: number, kind: HarmKind) => void) | null;
  onDodge: ((source: unknown) => void) | null;
}

/**
 * A blow on a body, past god mode: the rule asked with the body's own health, roll and last stand, and its answer
 * applied -- a dodge said with whatever struck, health written, last stand spent, a real loss told with its kind.
 * True when it landed (the caller then holds regeneration off); false when a dodge or god mode refused it.
 * `ask` and `answer` are the caller's kept structs, so a blow a frame (a held flame) makes nothing.
 */
export function takeHarm(b: HarmBody, amount: number, force: boolean, kind: HarmKind, source: unknown, ask: HarmAsk, answer: HarmAnswer): boolean {
  ask.hp = b.hp;
  ask.amount = amount;
  ask.taken = b.damageTaken;
  ask.force = force;
  ask.kind = kind;
  ask.god = b.god;
  ask.rollElapsed = b.jka.rollElapsed;
  ask.iframes = b.stats.rollIframes;
  ask.lastStand = b.lastStand;
  const r = harmOf(ask, answer);
  if (r.refused === 'god') return false;
  if (r.refused === 'dodge') {
    b.onDodge?.(source);
    return false;
  }
  b.hp = r.hp;
  if (r.stood) b.lastStand = false;
  if (r.lost > 0) b.onHarm?.(r.lost, kind);
  return true;
}
