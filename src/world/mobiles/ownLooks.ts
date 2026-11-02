// The owner's own looks merged into the mobile catalogue (Map-maker II's thirteenth wave, DESIGN.md §2.13's "Dressing his
// people"): each row of `public/placements/looks/all.json` (`src/world/editFiles/looksFile.ts`) an entry `own:<id>` of kind
// `dressed`, in a group of its own (`OWN_LOOKS_GROUP`), standing on its species' body in its own outfit, colours and shape,
// with the size, move, stats, animation pack and flags of the dressed entry it names (`from`). So a placed person or a story
// cast member names it as a body (`own:<id>`) and is stood, shared and cached as every dressed body is: nothing new crosses
// the wire, since every browser reads the same file, and its look is cached under its own content's hash
// (`look:own:<id>@<hash8>`), so an edited look is never served from the cache.
//
// A look whose `from` this machine's catalogue lacks, or that is no dressed entry, is skipped and named once, and its wearer is
// skipped as any row with no body is; a look whose species pack is missing is skipped and named too, and its wearer stands in
// `from`'s body (`standIns`). With no looks at all the catalogue is the converter's own to the object: the merge hands back the
// very list it was given.
//
// Pure: no three, no fetch. Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no
// enum, no namespace, no constructor parameter properties.

import type { MobileEntry } from './types.ts';
import { lookHash, ownBodyOf, type OwnLookRow } from '../editFiles/looksFile.ts';

/** What the merge came to. */
export interface OwnLooksMerge {
  /** The catalogue's entries with the looks' after them, in the file's order: the very list handed in where there are none. */
  entries: readonly MobileEntry[];
  /** The looks' own entries, in the file's order. */
  own: MobileEntry[];
  /** A look skipped whose wearer stands in its `from`'s body instead, by the body it is worn as (`own:<id>`). */
  standIns: Map<string, MobileEntry>;
  /** The looks left out, each with why, in words. */
  skipped: { id: string; why: string }[];
}

/** A species pack's gender, as the catalogue writes a dressed entry's. */
function genderOf(species: string): 'm' | 'f' {
  return /_female$/.test(species) ? 'f' : 'm';
}

/** "twilek_male" reads "Twilek male". */
function speciesWords(species: string): string {
  const s = species.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * One look as a catalogue entry: kind `dressed`, its body the look's species, its shape, colours and outfit the look's (copied,
 * so nothing a reader of the catalogue does reaches the file's rows), and everything else -- its size, move, stats, animation
 * pack, flags and readiness -- its `from`'s.
 */
export function ownLookEntry(row: OwnLookRow, from: MobileEntry): MobileEntry {
  const e: MobileEntry = {
    id: ownBodyOf(row.id),
    kind: 'dressed',
    folder: '',
    group: 'dressed/own',
    own: { look: row.id, hash: lookHash(row), from: from.id },
    name: row.name || row.id.replace(/[-_]/g, ' '),
    subtitle: `${speciesWords(row.species)}, a look of your own`,
    flags: [...(from.flags ?? [])],
    gender: genderOf(row.species),
    appearance: null,
    species: row.species,
    pack: from.pack,
    variant: null,
    custom: { ...row.custom },
    morphs: { ...row.morphs },
    outfit: row.outfit.map((p) => ({ part: p.part, item: p.item, wardrobe: p.wardrobe, values: { ...p.values } })),
    size: from.size,
    move: from.move,
    stats: from.stats,
    ready: from.ready,
    outfitReady: true,
  };
  if (from.notReady) e.notReady = from.notReady;
  if (row.note) e.description = row.note;
  return e;
}

/**
 * The looks merged into a catalogue's entries: an entry each after the catalogue's own, in the file's order. `species`
 * answers whether this machine has a species pack (absent: every species is taken as there).
 */
export function mergeOwnLooks(entries: readonly MobileEntry[], rows: readonly OwnLookRow[], opts: { species?: (id: string) => boolean } = {}): OwnLooksMerge {
  const out: OwnLooksMerge = { entries, own: [], standIns: new Map(), skipped: [] };
  if (!rows.length) return out;
  const byId = new Map<string, MobileEntry>();
  for (const e of entries) byId.set(e.id, e);
  for (const row of rows) {
    const from = byId.get(row.from);
    if (!from) {
      out.skipped.push({ id: row.id, why: `its from, ${row.from}, is not in this machine's catalogue: nobody wearing it is stood` });
      continue;
    }
    if (from.kind !== 'dressed') {
      out.skipped.push({ id: row.id, why: `its from, ${row.from}, is no dressed entry: nobody wearing it is stood` });
      continue;
    }
    if (opts.species && !opts.species(row.species)) {
      out.skipped.push({ id: row.id, why: `its species pack, characters/${row.species}, is not converted here: whoever wears it stands in ${row.from}'s body` });
      out.standIns.set(ownBodyOf(row.id), from);
      continue;
    }
    out.own.push(ownLookEntry(row, from));
  }
  if (out.own.length) out.entries = [...entries, ...out.own];
  return out;
}

/**
 * What every body of the owner's own looks stands as, by body (`own:<id>`): a look in force by its content's hash, and one
 * left out for want of its species pack by the entry its wearer stands in (`>` and that entry's id). What a landing compares
 * before and after (`looksMoved`).
 */
export function ownBodies(own: readonly Pick<MobileEntry, 'id' | 'own'>[], standIns: ReadonlyMap<string, Pick<MobileEntry, 'id'>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of own) out.set(e.id, e.own?.hash ?? '');
  for (const [body, from] of standIns) out.set(body, `>${from.id}`);
  return out;
}

/**
 * The bodies whose look moved between two landings (`ownBodies` before and after): one added, one taken out, and one whose
 * content or stand-in changed; never one whose words alone moved (its name, its note), which dresses a body the same.
 */
export function looksMoved(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): Set<string> {
  const out = new Set<string>();
  for (const [body, h] of before) if (after.get(body) !== h) out.add(body);
  for (const [body, h] of after) if (before.get(body) !== h) out.add(body);
  return out;
}

/** The ids of those (a story's cast, a world's placed people) whose body is one of `bodies`. */
export function wearersIn(list: readonly { id: string; body: string }[], bodies: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const x of list) if (bodies.has(x.body)) out.add(x.id);
  return out;
}

/**
 * The key a look is cached under in the mobiles' asset cache: `look:<entry id>`, as it always was, and for a look of the
 * owner's own its content's hash after it (`look:own:<id>@<hash8>`), so a look edited is built afresh and never handed the
 * last version's prototype.
 */
export function lookCacheKey(entry: Pick<MobileEntry, 'id' | 'own'>): string {
  return entry.own ? `look:${entry.id}@${entry.own.hash}` : `look:${entry.id}`;
}
