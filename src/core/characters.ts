// The characters kept in this browser: up to five, each with its species, class, look, outfit
// and where it last stood, so logging back in puts it back there. Stored in localStorage.
import type { ClassId } from '../combat/kit';
import type { OwnedItem } from './inventory';
import type { ShipFit } from '../vehicles/shipFit';

export const MAX_CHARACTERS = 5;
const KEY = 'swg.characters';

export interface Appearance {
  morphs: Record<string, number>;
  values: Record<string, number>;
  height: number;
}

export interface SavedCharacter {
  id: string;
  name: string;
  /** The parts pack the character is built from: human_male, twilek_female, ... */
  species: string;
  class: ClassId;
  appearance: Appearance;
  /** The worn pieces by the names the character wears them under (catalogue ids, or the pack's part names). */
  outfit: string[];
  /** The lightsaber's blade colour, as hex; absent means the default blue. */
  saber?: { color: string };
  /** The Force powers in the number slots, by id; absent means the default four. */
  powers?: string[];
  /** The Bounty Hunter's gadgets in the number slots, by id; absent means the default set. */
  gadgets?: string[];
  /**
   * The mood this character is in, by name (`src/player/moods.ts`): how it stands and walks when the
   * pack has a branch for the name, and what marks what it says either way. Absent, or empty, means
   * no mood at all, which is every record from before there were any.
   */
  mood?: string;
  planet: string;
  zone?: string;
  /** Where it last stood, and which way it faced; absent until it has been played. */
  pos?: [number, number, number];
  heading?: number;
  created: number;
  played: number;
  /** Everything the character owns, worn and held included, by catalogue id. Absent on a record from before the backpack. */
  items?: OwnedItem[];
  /** The weapons in hand when last played, by weapon id. */
  held?: { right?: string; left?: string };
  /** 1 once the record has been given its items (migrateInventory). */
  inv?: 1;
  /** The ships' fits by garage id (a component per chassis slot, paint values, the droid); a ship absent is stock. */
  ships?: Record<string, ShipFit>;
  /**
   * 1 once a server has taken this character's items down, which makes everything under `items` here
   * a cache of the server's own list rather than the only copy there is. It is absent for every
   * character that has only ever been played alone, and that is what keeps a game with no server
   * exactly the game it was: nothing reads this unless there is a server to read it against.
   *
   * It is also what a browser says when it first hands its list up -- "I believe you already hold
   * this one" -- so that a browser whose storage was cleared (which has no mark, and no items) is
   * told everything back rather than taken for a character that has just lost everything it owned.
   */
  known?: 1;
  /**
   * The change counter the server last settled this character at (the counter itself lives beside the
   * player's key, in `swg.charrev`, because it counts changes made with nobody watching). It is kept
   * here as well so that what the record says about itself and what the server was told cannot drift
   * apart when one of the two stores is cleared and the other is not.
   */
  rev?: number;
}

export function loadCharacters(): SavedCharacter[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as SavedCharacter[];
    return Array.isArray(list) ? list.filter((c) => c && typeof c.id === 'string' && typeof c.species === 'string') : [];
  } catch {
    return [];
  }
}

export function saveCharacters(list: SavedCharacter[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_CHARACTERS)));
    return true;
  } catch {
    return false;
  }
}

/** Put one character's record in the list (by id), adding it when it is new. */
export function upsertCharacter(c: SavedCharacter): boolean {
  const list = loadCharacters();
  const i = list.findIndex((x) => x.id === c.id);
  if (i >= 0) list[i] = c;
  else if (list.length >= MAX_CHARACTERS) return false;
  else list.push(c);
  return saveCharacters(list);
}

export function deleteCharacter(id: string): void {
  saveCharacters(loadCharacters().filter((c) => c.id !== id));
}

/**
 * Whether a server holds this character's items, which is what makes the list in it a cache. A
 * record from before any of this, and every character that has only ever been played alone, answers
 * false, and everything that reads it then goes on exactly as it did.
 */
export function knownToServer(c: SavedCharacter | null | undefined): boolean {
  return !!c && c.known === 1;
}

/**
 * The server has taken this character down: mark the record and keep the counter it settled at. The
 * record passed in is written as well as the copy in storage, because the game plays the object it
 * holds and a mark only in storage would be lost the next time anything saved.
 *
 * The counter never goes backwards here: a message that arrives out of order must not make a
 * character look older than it is, which is what the whole settling rests on.
 */
export function markKnownToServer(c: SavedCharacter, rev: number): boolean {
  const n = Number.isFinite(rev) && rev > 0 ? Math.round(rev) : 0;
  const was = c.known === 1 && (c.rev ?? 0) >= n;
  c.known = 1;
  if (n > (c.rev ?? 0)) c.rev = n;
  if (was) return false;
  upsertCharacter(c);
  return true;
}

export function newCharacterId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** "twilek_female" reads as "Twi'lek female"; "human_male" as "Human male". */
export function prettySpecies(id: string): string {
  const s = id.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
