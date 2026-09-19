// The lines NPC pilots call out, from the game's own taunt tables (string/en/space/taunts). When a
// line is said and how often is INVENTED: the chances and the gaps below.
//
// Pure: no three, no rapier; node's tests import it straight from source.

export type TauntEvent = 'entercombat' | 'gothit' | 'hityou' | 'death';

/** The chance each event raises a line (invented). */
export const TAUNT_CHANCE: Record<TauntEvent, number> = { entercombat: 0.8, gothit: 0.25, hityou: 0.2, death: 0.6 };
/** Seconds between two lines from one ship. */
export const TAUNT_SHIP_GAP = 8;
/** Seconds between any two lines. */
export const TAUNT_ANY_GAP = 2.5;

/** `%TU` and `%NU` (both the player) filled with the name; an empty name reads "pilot". */
export function fillTaunt(text: string, name: string): string {
  const who = name.trim() || 'pilot';
  return text.replace(/%TU|%NU/g, who);
}

/** Who may speak now: one ship not twice within TAUNT_SHIP_GAP, nobody within TAUNT_ANY_GAP of the last line, and each event's chance. */
export class TauntGate {
  private readonly rng: () => number;
  private readonly lastBy = new Map<number, number>();
  private lastAny = -Infinity;

  constructor(rng: () => number) {
    this.rng = rng;
  }

  /** Whether `shipKey` says a line for `event` at `now` (seconds); true records it. */
  want(shipKey: number, event: TauntEvent, now: number): boolean {
    if (now - this.lastAny < TAUNT_ANY_GAP) return false;
    if (now - (this.lastBy.get(shipKey) ?? -Infinity) < TAUNT_SHIP_GAP) return false;
    if (this.rng() >= TAUNT_CHANCE[event]) return false;
    this.lastAny = now;
    this.lastBy.set(shipKey, now);
    return true;
  }

  /** Forget every ship (a world unload). */
  clear(): void {
    this.lastBy.clear();
    this.lastAny = -Infinity;
  }
}

/** One of the lines, or null when there are none. */
export function pickLine(lines: readonly string[], rng: () => number): string | null {
  if (!lines.length) return null;
  return lines[Math.min(lines.length - 1, Math.floor(rng() * lines.length))] ?? null;
}
