// Who struck a body lately, kept apart from its brain.
//
// A body's grudges are its brain's: a passive creature keeps none, a fighter forgets them all the moment
// it dies, and either way they answer "whom do I turn on", which is not the question a death asks. A
// death names who struck in its last moments (the keeper's `dead` word carries them, so a later server
// can witness a kill), and that has to be read after the body has died -- which is exactly when the
// brain's memory has been cleared, or was never kept at all. So every blow that reaches a body notes its
// striker here as well, whatever the body's temper, and nothing but a fresh life empties it.
//
// A few fixed slots written in place: nothing is allocated by a blow, and the oldest is written over when
// they are full. Nothing in here is the game's; the number of slots is ours and is the most the wire's
// death word carries (eight).
//
// Dependency-free, and run as it is by tools/swg/tests/npcWire.test.ts.

/** How many strikers are remembered at once: the most a death names. */
export const STRIKER_SLOTS = 8;

export class Strikers {
  /** Each striker's living key (0 for an empty slot: no living key is ever 0), and when it last struck. */
  private readonly keys: number[] = new Array<number>(STRIKER_SLOTS).fill(0);
  private readonly at: number[] = new Array<number>(STRIKER_SLOTS).fill(-Infinity);

  /** A blow from that living key, at `now` on the body's own clock. The oldest slot gives way when all are taken. */
  note(key: number, now: number): void {
    if (!(key > 0)) return;
    let slot = -1;
    let oldest = 0;
    for (let i = 0; i < STRIKER_SLOTS; i++) {
      if (this.keys[i] === key) {
        slot = i;
        break;
      }
      if (this.at[i] < this.at[oldest]) oldest = i;
    }
    if (slot < 0) slot = oldest;
    this.keys[slot] = key;
    this.at[slot] = now;
  }

  /** Who struck within `seconds` of `now`, written into `out` (cleared first), each once. */
  within(now: number, seconds: number, out: number[]): void {
    out.length = 0;
    for (let i = 0; i < STRIKER_SLOTS; i++) {
      const key = this.keys[i];
      if (key > 0 && now - this.at[i] <= seconds && !out.includes(key)) out.push(key);
    }
  }

  /** A fresh life: nobody has struck it. */
  clear(): void {
    this.keys.fill(0);
    this.at.fill(-Infinity);
  }
}
