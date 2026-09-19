// The characters kept in this browser: up to five, each with its species, class, look, outfit
// and where it last stood, so logging back in puts it back there. Stored in localStorage.
import type { ClassId } from '../combat/kit';
import type { OwnedItem } from './inventory';

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

export function newCharacterId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** "twilek_female" reads as "Twi'lek female"; "human_male" as "Human male". */
export function prettySpecies(id: string): string {
  const s = id.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
