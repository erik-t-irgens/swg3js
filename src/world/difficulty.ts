// How hard the world's own people and creatures are, as one number the player turns.
//
// Every body the world stands takes its own numbers now -- a town's guard its own level's health and
// blow, a level-116 Tusken nearly seventeen hundred health and fifty-odd a blow -- and those are the
// emulator's, which were tuned for a character with a whole profession behind it. The owner's answer
// is to keep them faithful and put one knob over them: a scale on the health and the blow of
// everything the world stands (the people, the lairs and their nests, what an admin stood, the
// fighters), and never on the player or on another player, who are nobody's to scale.
//
// The scale is ours, it starts at one (the data as it is), it is kept in this browser with the rest of
// the settings, and it moves live: a body already standing keeps the share of its health it had, so
// turning it down in the middle of a fight takes the same fraction off everybody's bar and nothing
// jumps. Nothing crosses the wire: a creature another browser keeps has its health said as a share,
// and the blow it lands is its keeper's to scale.
//
// Pure: no three, no storage, no document, so a node test runs it exactly as it is.

/** The ends the knob may be set to; the menu's slider and `__debug.difficulty` both clamp to them. Ours. */
export const DIFFICULTY_RANGE = { min: 0.1, max: 2 } as const;

/** The scale in force: read by every body when it is stood and by every blow when it lands. */
export const DIFFICULTY = { scale: 1 };

/** A value the knob may hold: a finite number inside the range, anything else the data as it is. */
export function clampDifficulty(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(DIFFICULTY_RANGE.max, Math.max(DIFFICULTY_RANGE.min, n));
}

/** Put the knob somewhere, clamped; answers where it went. */
export function setDifficulty(v: unknown): number {
  DIFFICULTY.scale = clampDifficulty(v);
  return DIFFICULTY.scale;
}

/** A body's whole, or its blow, at the scale in force: the data's own number times the knob. */
export function scaledByDifficulty(base: number): number {
  return base * DIFFICULTY.scale;
}

/**
 * A body's health once its whole has moved from `oldMax` to `newMax`: the same share of the whole it
 * had, so the knob moving takes the same fraction off every bar and a body half dead stays half dead.
 * A body with no whole to speak of is given the new one outright.
 */
export function rescaledHealth(hp: number, oldMax: number, newMax: number): number {
  if (!(oldMax > 0) || !Number.isFinite(hp)) return newMax;
  const share = Math.min(1, Math.max(0, hp / oldMax));
  return share * newMax;
}

/** A body's health as the knob moves it: what it has, its whole, and whether it is already dead. */
export interface ScaledHealth {
  hp: number;
  maxHp: number;
  readonly dead: boolean;
}

/**
 * The knob moved: a body's whole set again from its own `base` number at `scale`, and its health kept at
 * the share of the whole it had (`rescaledHealth`), so a body half dead in the middle of a fight is
 * still half dead after it. A dead body stays at whatever it has. Every kind of body the world stands
 * does this one thing (a person or a lair's creature, a fighter, a nest, the old wildlife), so it is
 * written once, here, where node runs it.
 */
export function rescaleBody(b: ScaledHealth, base: number, scale: number): void {
  const max = base * scale;
  if (!b.dead) b.hp = rescaledHealth(b.hp, b.maxHp, max);
  b.maxHp = max;
}

/**
 * Anything the knob reaches that is already standing: its whole and its blow set again from its own
 * base numbers at the scale in force. The managers walk their bodies with it when the knob moves
 * (`applyDifficultyTo`).
 */
export interface Scaled {
  applyDifficulty(scale: number): void;
}

/** The knob moved: every body in a manager's list takes it. Written once, so no manager can walk its list and forget to tell anyone. */
export function applyDifficultyTo(bodies: Iterable<Scaled | null | undefined>, scale: number): void {
  for (const b of bodies) b?.applyDifficulty(scale);
}
