// The character select screen's rules, apart from the page: what the five places in the list are,
// which entry a key moves to, what a key asks for, what a name may be, and how a record's place and
// times are put into words. Everything here is a plain function of plain values, so the node test
// (`tools/swg/tests/selectModel.test.ts`) drives the whole of it with made-up records and no page.
//
// Nothing here reads the game's files or invents anything about a character: every word it makes is
// made from a field the saved record really carries.

import type { SavedCharacter } from '../core/characters.ts';

/** The creator's own rule for a name: at most this many characters (its `maxlength`), and not empty once trimmed. */
export const NAME_MAX = 24;

/** A name as it would be kept, or null when there is nothing left of it. The creator trims and nothing more; so does this. */
export function cleanName(raw: string): string | null {
  const s = String(raw ?? '').trim().slice(0, NAME_MAX).trim();
  return s ? s : null;
}

/** One of the places in the list: a character, or room for one. */
export type Slot = { kind: 'char'; c: SavedCharacter } | { kind: 'empty'; first: boolean };

/**
 * The list as the screen shows it: every character in the order it is kept, then an empty place for
 * each one still free, the first of which is where Create sits. A list longer than the cap (a store
 * written by hand) shows every character and no empty place, rather than hiding one.
 */
export function slotsFor(list: readonly SavedCharacter[], max: number): Slot[] {
  const out: Slot[] = list.map((c) => ({ kind: 'char' as const, c }));
  for (let i = list.length; i < max; i++) out.push({ kind: 'empty', first: i === list.length });
  return out;
}

/**
 * Which place is chosen when the screen opens: the one chosen last time if it is still there, else
 * the character played most recently, else the first character, else the first empty place.
 */
export function initialIndex(slots: readonly Slot[], preferredId: string | null): number {
  if (preferredId) {
    const i = slots.findIndex((s) => s.kind === 'char' && s.c.id === preferredId);
    if (i >= 0) return i;
  }
  let best = -1;
  let when = -1;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s.kind !== 'char') continue;
    const t = Number.isFinite(s.c.played) ? s.c.played : 0;
    if (t > when) {
      when = t;
      best = i;
    }
  }
  if (best >= 0) return best;
  return slots.length ? 0 : -1;
}

/** One step through the list, stopping at either end rather than wrapping (a held key must not spin round). */
export function stepIndex(i: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  const j = (i < 0 ? 0 : i) + delta;
  return Math.max(0, Math.min(count - 1, j));
}

/** What a key asks the screen for. */
export type SelectAction = 'up' | 'down' | 'first' | 'last' | 'play' | 'create' | 'delete' | 'rename' | null;

/**
 * A key on the screen, by its `code`. Up and W go up, Down and S go down, Home and End to the ends,
 * Enter plays the chosen character (or makes one, on an empty place), Delete asks to delete and F2
 * renames. A key held down repeats the moves and nothing else, so a held Enter can never go on to
 * play the entry the list lands on next.
 */
export function keyAction(code: string, onEmpty: boolean, repeat: boolean): SelectAction {
  switch (code) {
    case 'ArrowUp':
    case 'KeyW':
      return 'up';
    case 'ArrowDown':
    case 'KeyS':
      return 'down';
    case 'Home':
      return repeat ? null : 'first';
    case 'End':
      return repeat ? null : 'last';
    case 'Enter':
    case 'NumpadEnter':
      if (repeat) return null;
      return onEmpty ? 'create' : 'play';
    case 'Delete':
      return repeat || onEmpty ? null : 'delete';
    case 'F2':
      return repeat || onEmpty ? null : 'rename';
    default:
      return null;
  }
}

/** A class in words. */
export function classWords(cls: string): string {
  return cls === 'jedi' ? 'Jedi' : cls === 'bounty_hunter' ? 'Bounty Hunter' : cls ? cls.replace(/_/g, ' ') : 'no class';
}

/**
 * The mark a class wears in the list, from the interface's own sheet: the lightsaber for a Jedi and
 * the blaster for a Bounty Hunter, the two things each class is known by.
 */
export function classGlyph(cls: string): string {
  return cls === 'jedi' ? 'ic-saber' : cls === 'bounty_hunter' ? 'ic-blaster' : 'ic-system';
}

/** How long ago, in the fewest words that still read: the list's line under a name. */
export function agoWords(t: number, now: number): string {
  if (!Number.isFinite(t) || t <= 0) return 'never played';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** Just enough of a planet to say where a character is. */
export interface PlaceDef {
  id: string;
  name: string;
  /** Set on a space zone: the planet's id when it is that planet's orbit, a system's name otherwise. */
  space?: string;
  zones?: { id: string; name: string }[];
}

/** Where a record says its character is. */
export interface PlaceWords {
  /** The world, in its own name: "Tatooine", "Kashyyyk", "Kessel". */
  world: string;
  /** The zone of a many-zoned planet, "in orbit" above a planet, "in space" in a system of its own, or ''. */
  within: string;
  /** Never placed: made and not yet played, so it will start at the world's own spawn. */
  fresh: boolean;
  /** The two together, for the list's one line. */
  line: string;
}

export function placeWords(c: Pick<SavedCharacter, 'planet' | 'zone' | 'pos'>, planets: readonly PlaceDef[]): PlaceWords {
  const p = planets.find((x) => x.id === c.planet);
  let world = p ? p.name : c.planet || 'somewhere unknown';
  let within = '';
  if (p?.space) {
    // A planet's orbit is named for the planet under it; a system with nothing below is itself.
    const below = planets.find((x) => x.id === p.space && !x.space);
    if (below) {
      world = below.name;
      within = 'in orbit';
    } else within = 'in space';
  } else if (p && c.zone && p.zones?.length) {
    within = p.zones.find((z) => z.id === c.zone)?.name ?? c.zone;
  }
  const fresh = !c.pos;
  const line = within ? `${world} · ${within}` : world;
  return { world, within, fresh, line };
}

/** A saber colour the page may put in a style attribute: a hex colour and nothing else. */
export function safeColour(hex: unknown): string | null {
  return typeof hex === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(hex) ? hex : null;
}
