// The story's dice: every roll is a hash of who rolls, in which quest, on which attempt, at which place in
// the file, so the server and the browser draw the same number for the same roll and a reload cannot
// roll again. Nothing in a story can be wound back, and a roll a reload could repeat would be a way to.
//
// Pure. The hash is the game's own SHA-256 (`src/net/hash.ts`), which runs on a page that is not a secure
// context, where `crypto.subtle` does not exist.

import { sha256, utf8 } from '../net/hash.ts';

/** A number in [0, 1) drawn for one roll: `hash(char, quest, run, site)`. */
export function seedRoll(char: string, quest: string, run: number, site: string): number {
  const h = sha256(utf8(`${char}\u0000${quest}\u0000${run}\u0000${site}`));
  return (((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0) / 4294967296;
}

/** Whether a roll with chance `p` comes up: `p` 1 always does and 0 never. */
export function seedChance(p: number, char: string, quest: string, run: number, site: string): boolean {
  if (p >= 1) return true;
  if (p <= 0) return false;
  return seedRoll(char, quest, run, site) < p;
}
