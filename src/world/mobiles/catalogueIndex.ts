// The catalogue's index: one lowercased string per entry for the find box, the ranking of what it
// finds, a name or id resolved to the one entry a person means, and the grouped tree the spawner
// shows. Pure: no three, no fetch, no clock, so the node tests run it over the real shapes.
//
// Rule for this file (it is run by node with type stripping): relative imports only as
// `import type`, no enum, no namespace, no constructor parameter properties.
import type { MobileEntry, MobileKind } from './types';

/** One entry and the text the find box matches against. */
export interface Indexed {
  entry: MobileEntry;
  text: string;
}

export interface SearchOpts {
  kind?: MobileKind;
  readyOnly?: boolean;
  limit?: number;
}

/** The spawner's tree: a category (a kind, or the extras taken out by flag) and its groups. */
export interface KindNode {
  key: string;
  label: string;
  total: number;
  groups: GroupNode[];
}

export interface GroupNode {
  key: string;
  label: string;
  /** A few words on how the group behaves, for the header. */
  note: string;
  entries: MobileEntry[];
}

/** The default number of hits a search returns. */
export const SEARCH_LIMIT = 200;

/**
 * The text an entry is found by: its id, name, subtitle, group, flags and tags, lowercased, and
 * the same again with `_` and `/` written as spaces. One string per entry and nothing else.
 */
export function entryText(e: MobileEntry): string {
  const raw = [e.id, e.name, e.subtitle ?? '', e.group, ...(e.flags ?? []), ...(e.stats?.tags ?? [])].join(' ').toLowerCase();
  return `${raw} ${raw.replace(/[_/]/g, ' ')}`;
}

export function buildIndex(entries: readonly MobileEntry[]): Indexed[] {
  const out: Indexed[] = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) out[i] = { entry: entries[i], text: entryText(entries[i]) };
  return out;
}

function tokensOf(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
}

/**
 * How well an entry answers a query: 0 an exact id or name, 1 an id or name that starts with the
 * query, 2 a word of the name that starts with the first token, 3 anything else that matched.
 */
export function scoreEntry(e: MobileEntry, query: string, first: string): number {
  const q = query.trim().toLowerCase();
  const qId = q.replace(/\s+/g, '_');
  const id = e.id.toLowerCase();
  const name = e.name.toLowerCase();
  if (id === q || id === qId || name === q) return 0;
  if (id.startsWith(q) || id.startsWith(qId) || name.startsWith(q)) return 1;
  // Split at the moment it is scored, not from a stored list: this runs only for the entries that already matched.
  for (const word of name.split(/[^a-z0-9]+/)) if (word && word.startsWith(first)) return 2;
  return 3;
}

/**
 * Entries whose text holds every whitespace-separated token of the query, best first: by score,
 * then ready before not ready, then by name, then by id. An empty query finds nothing.
 */
export function searchEntries(index: readonly Indexed[], query: string, opts: SearchOpts = {}): MobileEntry[] {
  const tokens = tokensOf(query);
  if (!tokens.length) return [];
  const limit = opts.limit ?? SEARCH_LIMIT;
  const hits: { e: MobileEntry; score: number }[] = [];
  for (const { entry, text } of index) {
    if (opts.kind && entry.kind !== opts.kind) continue;
    if (opts.readyOnly && !entry.ready) continue;
    let all = true;
    for (const t of tokens) {
      if (!text.includes(t)) {
        all = false;
        break;
      }
    }
    if (all) hits.push({ e: entry, score: scoreEntry(entry, query, tokens[0]) });
  }
  hits.sort((a, b) => a.score - b.score || Number(b.e.ready) - Number(a.e.ready) || a.e.name.localeCompare(b.e.name) || a.e.id.localeCompare(b.e.id));
  const out: MobileEntry[] = [];
  for (let i = 0; i < hits.length && i < limit; i++) out.push(hits[i].e);
  return out;
}

/** A display name as an id: "Lava Flea" is `lava_flea`. */
export function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Which folder wins when a base name is found in several: the root first, then `som`, `ep3`,
 * `npe`, anything else, and the holograms, the pets and the vendors last, so `rancor` is the
 * rancor and never its hologram.
 */
export const FOLDER_RANK: Record<string, number> = { '': 0, som: 1, ep3: 2, npe: 3, hologram: 9, beast_master: 9, vendor: 9 };
const OTHER_FOLDER = 4;

function folderRank(e: MobileEntry): number {
  const folder = e.folder ?? (e.id.includes('/') ? e.id.slice(0, e.id.lastIndexOf('/')) : '');
  return FOLDER_RANK[folder] ?? OTHER_FOLDER;
}

/**
 * The one entry a name or id means: the exact id; then the name normalised as an id; then an
 * entry whose id after the last `/` is that, the root folder first (see FOLDER_RANK); then an
 * exact display name, case aside. Undefined when nothing fits.
 */
export function resolveEntry(index: readonly Indexed[], nameOrId: string): MobileEntry | undefined {
  const raw = nameOrId.trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  for (const { entry } of index) if (entry.id === raw || entry.id === lower) return entry;
  const asId = normaliseName(raw);
  for (const { entry } of index) if (entry.id === asId) return entry;
  let best: MobileEntry | undefined;
  let bestRank = Infinity;
  for (const { entry } of index) {
    const base = entry.id.slice(entry.id.lastIndexOf('/') + 1);
    if (base !== asId && base !== lower) continue;
    const rank = folderRank(entry);
    if (rank < bestRank) {
      best = entry;
      bestRank = rank;
    }
  }
  if (best) return best;
  for (const { entry } of index) {
    const name = entry.name.toLowerCase();
    if (name !== lower) continue;
    const rank = folderRank(entry);
    if (rank < bestRank) {
      best = entry;
      bestRank = rank;
    }
  }
  return best;
}

/** The categories, in the order the spawner lists them. */
export const KIND_ORDER = ['creature', 'droid', 'npc', 'dressed', 'special', 'extras'] as const;
export const KIND_LABELS: Record<string, string> = {
  creature: 'Creatures',
  droid: 'Droids',
  npc: 'Humanoid NPCs',
  dressed: 'Dressed NPCs',
  special: 'Specials',
  extras: 'Holograms, pets, vendors and the tutorial',
};

/** The flags that take an entry out of its kind into the extras, in the order they are tried. */
export const EXTRA_FLAGS = ['hologram', 'pet', 'vendor', 'tutorial'] as const;
const EXTRA_LABELS: Record<string, [string, string]> = {
  hologram: ['Holograms', 'never provoked'],
  pet: ['Pets', 'the beast master’s tame ones'],
  vendor: ['Vendors', 'stand and wait'],
  tutorial: ['The tutorial', 'the new player’s island'],
};

const CREATURE_GROUPS: Record<string, [string, string]> = {
  predator: ['Creatures: predators', 'attack on sight'],
  herd: ['Creatures: herd animals', 'fight back when hurt'],
  critter: ['Creatures: critters', 'mostly run away'],
  flyer: ['Creatures: flyers', 'hover and swoop'],
};
const NPC_GROUPS: Record<string, [string, string]> = {
  hostile: ['Humanoid NPCs: hostile', 'attack on sight'],
  faction: ['Humanoid NPCs: Imperial and Rebel', 'fight the other side'],
  civilian: ['Humanoid NPCs: civilians', 'run from a fight'],
};
const DRESSED_KEYWORDS: Record<string, [string, string]> = {
  hostile: ['hostile', 'attack on sight'],
  faction: ['Imperial and Rebel', 'fight the other side'],
  civilian: ['civilians', 'run from a fight'],
  other: ['everyone else', 'fight back when hurt'],
};

/** The keyword group a dressed entry falls in, from the converter's tags. */
export function dressedKeyword(e: MobileEntry): 'hostile' | 'faction' | 'civilian' | 'other' {
  const tags = e.stats?.tags ?? [];
  if (tags.includes('hostile')) return 'hostile';
  if (tags.includes('faction')) return 'faction';
  if (tags.includes('civilian')) return 'civilian';
  return 'other';
}

function speciesLabel(species: string): string {
  const s = species.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Where one entry sits in the tree: its category, its group's key, label and note. */
export function placeOf(e: MobileEntry): { kind: string; key: string; label: string; note: string } {
  for (const flag of EXTRA_FLAGS) {
    if (e.flags?.includes(flag)) {
      const [label, note] = EXTRA_LABELS[flag];
      return { kind: 'extras', key: `extras/${flag}`, label, note };
    }
  }
  const tail = e.group.slice(e.group.indexOf('/') + 1);
  switch (e.kind) {
    case 'creature': {
      const known = CREATURE_GROUPS[tail];
      if (known) return { kind: 'creature', key: `creatures/${tail}`, label: known[0], note: known[1] };
      return { kind: 'creature', key: 'creatures/odd', label: 'Creatures: odd ones', note: 'every other kind of beast' };
    }
    case 'droid':
      return { kind: 'droid', key: 'droids', label: 'Droids', note: 'on their own clips' };
    case 'npc': {
      const known = NPC_GROUPS[tail];
      if (known) return { kind: 'npc', key: `npcs/${tail}`, label: known[0], note: known[1] };
      return { kind: 'npc', key: 'npcs/other', label: 'Humanoid NPCs: everyone else', note: 'fight back when hurt' };
    }
    case 'dressed': {
      const species = e.species ?? (tail || 'unknown');
      const kw = dressedKeyword(e);
      const [what, note] = DRESSED_KEYWORDS[kw];
      return { kind: 'dressed', key: `dressed/${species}/${kw}`, label: `Dressed NPCs: ${speciesLabel(species)}, ${what}`, note };
    }
    default:
      return { kind: 'special', key: 'specials', label: 'Specials', note: 'props and oddities' };
  }
}

/**
 * The spawner's tree, regrouped from `entry.group`: creatures by family, droids, humanoid NPCs by
 * side, dressed NPCs by species and keyword, the specials, and the holograms, pets, vendors and
 * the tutorial taken out of all of those by flag. Groups sorted by label, entries by name then id.
 */
export function groupTree(entries: readonly MobileEntry[]): KindNode[] {
  const kinds = new Map<string, KindNode>();
  const groups = new Map<string, GroupNode>();
  for (const k of KIND_ORDER) kinds.set(k, { key: k, label: KIND_LABELS[k], total: 0, groups: [] });
  for (const e of entries) {
    const p = placeOf(e);
    const kind = kinds.get(p.kind)!;
    let g = groups.get(p.key);
    if (!g) {
      g = { key: p.key, label: p.label, note: p.note, entries: [] };
      groups.set(p.key, g);
      kind.groups.push(g);
    }
    g.entries.push(e);
    kind.total++;
  }
  const out: KindNode[] = [];
  for (const k of KIND_ORDER) {
    const kind = kinds.get(k)!;
    if (!kind.total) continue;
    kind.groups.sort((a, b) => a.label.localeCompare(b.label));
    for (const g of kind.groups) g.entries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    out.push(kind);
  }
  return out;
}
