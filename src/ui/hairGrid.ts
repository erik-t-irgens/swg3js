// The hairstyles as a grid of pictures, in the backpack's own cells, worked out from the creator's table
// and the wardrobe.
//
// The client's creator offered each species and gender its own styles and no others: its hair table
// (`hair_assets_skill_mods.iff`, carried in `customization.json` as each species' `hair`) is a row per
// style per player template, never crossing a gender or a species, saying whether the style was offered
// at creation or only later through the image designer. So the grid is three groups. This species and
// gender's styles come first, in the table's order with the creation styles ahead of the image designer's.
// Then the same species' other gender's, which is ours: the game never let a man wear a woman's style.
// Then whatever the wardrobe converted that no row names, "Not in the game's creator": one Bothan male
// style, four Trandoshan female ones, and the Sullustan's eighteen, which the game never offered at all
// (each of those is two templates, `_f` and `_m`, wearing one mesh a wardrobe folder, so a style whose
// meshes another cell already shows is not offered twice). A cell for no hair leads wherever the species
// has hairstyles at all, the species the game kept from going bald included: the owner's call, since
// taking the hair off leaves no hole in any base head (`hairNone`).
//
// Every hair template's own name is just "hair" (or "lekku", "ridges", "frills"), so a cell reads "Style N"
// from the `_sNN` its id ends in, with the id and the template behind it in the tooltip. The pictures are
// the converter's, drawn into the wardrobe folder and shown as `<img>`: a live 3D cell would compile a
// program per material on the main thread.
//
// Also here, because they are the same question asked of the same two files: which style a new character
// of a species that may not go bald starts in (`defaultHair`), the colour a new style takes from the one it
// replaces (`carryHairColour`, gathered from the character and its customizer by `hairCarryFor`), and the
// Sullustan's hair tab of ours (`withOursHair`).
//
// Pure, with no DOM and no three, so a node test can run it over the real wardrobe and table.
import { hairOfSpecies, type HairEntry } from '../core/inventory.ts';
import { bareName, hairNone, type CreatorGroup, type CreatorHair, type CreatorRow, type CreatorSpecies, type CreatorTable } from './creatorModel.ts';
import { initialsOf, type GiveCell } from './giveModel.ts';

/**
 * Every number of the grid's, all ours. `cell` is a cell's width in pixels, which `style.css` states again
 * (`#appearance .cat-grid`, `--hair-cell`) and the node test holds the two together: the backpack's own.
 * `recarryRounds` is how many times a style still loading waits for a hair colour picked meanwhile to
 * settle before it is shown anyway (`App.wearHairPrepared`).
 */
export const HAIR_TUNE = {
  cell: 76,
  recarryRounds: 3,
};

/** As much of a wardrobe entry as the grid reads. */
export interface HairItem extends HairEntry {
  icon?: string | null;
  parts?: readonly { file?: string; name?: string }[];
}

/** The grid's groups: own gender, other gender, not in the table, or (with no table) the one list of before. */
export type HairGroupId = 'own' | 'other' | 'untabled' | 'styles';

export interface HairGroup {
  id: HairGroupId;
  label: string;
  /** The words beside the group's count. */
  note: string;
  cells: GiveCell[];
}

export interface HairGrid {
  groups: HairGroup[];
  /** Whether a cell for no hair leads the first group. */
  none: boolean;
  /** The style worn now, by catalogue id, or null. */
  worn: string | null;
  /** How many styles are offered, the cell for none left out. */
  styles: number;
  /** Laid out from the creator's table, rather than as the one list of before. */
  fromTable: boolean;
}

/** The id the cell for no hair carries. */
export const NO_HAIR = '';

/** Whose a style was made for, by its id: `hair_<species>_female_s01`, or the Sullustan's `sul_hair_s01_f`. */
export function hairGender(id: string): 'female' | 'male' | null {
  if (/_female_/.test(id) || /_f$/.test(id)) return 'female';
  if (/_male_/.test(id) || /_m$/.test(id)) return 'male';
  return null;
}

/** A style's number, out of the `_sNN` its id ends in (the Sullustan's carry their gender after it), or null. */
export function hairStyleNumber(id: string): number | null {
  const m = /_s(\d+)(?:_[fm])?$/.exec(id);
  return m ? Number(m[1]) : null;
}

/** What a style's cell reads: "Style N", or the id's own words when it carries no number. */
export function styleLabel(id: string): string {
  const n = hairStyleNumber(id);
  return n !== null ? `Style ${n}` : id.replace(/_/g, ' ');
}

const GENDER_WORDS = { female: "Women's styles", male: "Men's styles" } as const;

/** The table's rows for a species and gender, creation styles first, each kept only where the wardrobe has it. */
function tableStyles(entry: CreatorSpecies | undefined, have: ReadonlyMap<string, HairItem>): { row: CreatorHair; item: HairItem }[] {
  const rows = (entry?.hair ?? []).filter((h) => h.inArchives !== false && have.has(h.id));
  return [...rows.filter((h) => h.creation), ...rows.filter((h) => !h.creation)].map((row) => ({ row, item: have.get(row.id)! }));
}

/** A style's meshes as one key, so two templates wearing one mesh are seen to be one style. */
function meshKey(item: HairItem): string {
  return (item.parts ?? [])
    .map((p) => p.file ?? p.name ?? '')
    .sort()
    .join(',');
}

/**
 * The grid for one character: its species (`twilek`) and gender, the hairstyle it wears (null for none),
 * the creator's table (null without one) and the wardrobe's entries; `dir` is the wardrobe folder the
 * pictures are relative to. Without a table, or with no row for the species, it is the one list of before
 * (the style picker's: both genders, by their ids' words) with no hair leading. With no styles for the
 * species at all there is no grid.
 */
export function hairCells(table: CreatorTable | null | undefined, items: readonly HairItem[], species: string, gender: 'female' | 'male', worn: string | null, dir: string | null = null): HairGrid {
  const sp = species.toLowerCase();
  const all = hairOfSpecies(items, sp);
  const entry = table?.species[`${sp}_${gender}`];
  const cell = (item: HairItem | null, group: HairGroupId, name: string, row?: CreatorHair): GiveCell => {
    const on = item ? worn === item.id : !worn;
    const icon = item?.icon && dir ? `${dir}${item.icon}` : null;
    const n = item ? hairStyleNumber(item.id) : null;
    const note = !item ? 'no hair' : row ? (row.creation ? 'offered at creation' : `the image designer's${row.skill ? ` (skill level ${row.skill})` : ''}`) : group === 'untabled' ? "converted, but never in the game's creator" : '';
    return {
      id: item?.id ?? NO_HAIR,
      name,
      label: name,
      mark: '',
      tag: on ? 'worn' : '',
      icon,
      picture: icon ? 'icon' : 'blank',
      initials: !item ? '–' : n !== null ? String(n) : initialsOf(name),
      on,
      unseen: false,
      fit: 'ok',
      other: group === 'other',
      group,
      title: [item?.id ?? 'no hair', item?.template ?? '', note].filter(Boolean).join('\n'),
      note,
      description: '',
    };
  };
  if (!all.length) return { groups: [], none: false, worn, styles: 0, fromTable: !!entry };

  const groups: HairGroup[] = [];
  if (!table || !entry) {
    // The list of before: every style of the species, either gender's, named by its id's words.
    const list = all.map((item) => ({ item, label: item.id.replace(/^hair_[a-z]+_(male|female)_?/, '').replace(/_/g, ' ') || item.id })).sort((a, b) => a.label.localeCompare(b.label));
    groups.push({ id: 'styles', label: 'Styles', note: 'for this species', cells: [cell(null, 'styles', 'None'), ...list.map((s) => cell(s.item, 'styles', s.label))] });
    return { groups, none: true, worn, styles: list.length, fromTable: false };
  }

  const have = new Map(all.map((i) => [i.id, i]));
  const other = gender === 'female' ? 'male' : 'female';
  const otherEntry = table.species[`${sp}_${other}`];
  const offered = new Set<string>();
  const own = tableStyles(entry, have);
  for (const s of own) offered.add(s.item.id);
  const theirs = tableStyles(otherEntry, have).filter((s) => !offered.has(s.item.id));
  for (const s of theirs) offered.add(s.item.id);
  // What no row of either gender names, this gender's first, a style whose meshes are already shown left out.
  const tabled = new Set([...(entry.hair ?? []), ...(otherEntry?.hair ?? [])].map((h) => h.id));
  const shown = new Set([...own, ...theirs].map((s) => meshKey(s.item)));
  const loose: HairItem[] = [];
  const rest = all.filter((i) => !tabled.has(i.id) && !offered.has(i.id));
  const rank = (i: HairItem) => (hairGender(i.id) === gender ? 0 : 1);
  rest.sort((a, b) => rank(a) - rank(b) || (hairStyleNumber(a.id) ?? 0) - (hairStyleNumber(b.id) ?? 0) || a.id.localeCompare(b.id));
  for (const i of rest) {
    const k = meshKey(i);
    if (k && shown.has(k)) continue;
    if (k) shown.add(k);
    loose.push(i);
  }
  const creation = own.filter((s) => s.row.creation).length;
  if (own.length) groups.push({ id: 'own', label: GENDER_WORDS[gender], note: `the game's own: ${creation} at creation${own.length > creation ? `, ${own.length - creation} through the image designer` : ''}`, cells: own.map((s) => cell(s.item, 'own', styleLabel(s.item.id), s.row)) });
  if (theirs.length) groups.push({ id: 'other', label: GENDER_WORDS[other], note: 'ours: the game kept each gender to its own', cells: theirs.map((s) => cell(s.item, 'other', styleLabel(s.item.id), s.row)) });
  if (loose.length) groups.push({ id: 'untabled', label: "Not in the game's creator", note: 'ours: converted, never offered', cells: loose.map((i) => cell(i, 'untabled', styleLabel(i.id))) });
  const none = hairNone(entry, true).offer && groups.length > 0;
  if (none) groups[0].cells.unshift(cell(null, groups[0].id, 'None'));
  return { groups, none, worn, styles: own.length + theirs.length + loose.length, fromTable: true };
}

/**
 * Which style a new character starts in: the table's first creation style for a species the game kept from
 * going bald (a Twi'lek always had lekku, a Zabrak horns, a Trandoshan ridges), where the wardrobe has it;
 * null for every species it let go bald, and without a table. Only the start: no hair is offered to every
 * species all the same (`hairNone`).
 */
export function defaultHair(table: CreatorTable | null | undefined, items: readonly HairItem[], species: string, gender: 'female' | 'male'): string | null {
  const sp = species.toLowerCase();
  const entry = table?.species[`${sp}_${gender}`];
  if (entry?.bald !== false) return null;
  const have = new Set(hairOfSpecies(items, sp).map((i) => i.id));
  return entry.hair?.find((h) => h.creation && h.inArchives !== false && have.has(h.id))?.id ?? null;
}

/**
 * The colour a new style takes before it is shown: each of its own colours (`newDefs`, its private palette
 * variables by key and name) from the remembered `hair|<name>` first, which is the hair colour last picked
 * whether or not any style wore it since (a bald man's beard keeps it), else from the old style's own key of
 * the same bare name (`oldValues`, the old style's keys and values), else nothing, which leaves the new
 * style's default. Copied by bare name, so `hum_m_hair_s01_l0|index_color_1` reaches
 * `hum_m_hair_s04_l0|index_color_1`.
 */
export function carryHairColour(oldValues: Readonly<Record<string, number>>, newDefs: readonly { key: string; name: string }[], remembered: Readonly<Record<string, number>>): Record<string, number> {
  const old = new Map<string, number>();
  for (const [k, v] of Object.entries(oldValues)) if (Number.isFinite(v)) old.set(bareName(k), v);
  const out: Record<string, number> = {};
  for (const d of newDefs) {
    const b = bareName(d.name);
    const kept = remembered[`hair|${b}`];
    const v = Number.isFinite(kept) ? kept : old.get(b);
    if (v !== undefined) out[d.key] = v;
  }
  return out;
}

/** As much of a part of the character as the carry reads (`Character.status`). */
export interface HairCarryPart {
  name: string;
  meshNames: readonly string[];
}

/** As much of a live customizer variable as the carry reads (`Customizer.variables`). */
export interface HairCarryVariable {
  key: string;
  name: string;
  mesh: string;
  private: boolean;
  kind: string;
}

/**
 * The colours a style loaded hidden takes before it is shown, gathered from the character as the game
 * holds it and handed to `carryHairColour`: `parts` its parts with their meshes' names, `worn` the
 * hairstyles on now, `id` the style going on, `values` the customizer's values by key and `variables` its
 * live variables. The remembered colours are the `hair|<name>` values; the old style's are every value
 * scoped to one of the worn styles' meshes; the new style's own colours are its meshes' private palette
 * variables. A mesh with several materials loads as several meshes, the second onwards suffixed (`_1`,
 * `_2`) while the recipes name the first, so a part's meshes stand under both spellings.
 */
export function hairCarryFor(parts: readonly HairCarryPart[], worn: readonly string[], id: string, values: Iterable<readonly [string, number]>, variables: readonly HairCarryVariable[]): Record<string, number> {
  const meshesOf = (keys: readonly string[]): Set<string> => {
    const out = new Set<string>();
    for (const p of parts) {
      if (!keys.includes(p.name)) continue;
      for (const n of p.meshNames) {
        out.add(n);
        out.add(n.replace(/_\d+$/, ''));
      }
    }
    return out;
  };
  const oldMeshes = meshesOf(worn.filter((k) => k !== id));
  const newMeshes = meshesOf([id]);
  const oldValues: Record<string, number> = {};
  const remembered: Record<string, number> = {};
  for (const [k, v] of values) {
    const bar = k.indexOf('|');
    if (bar < 0) continue;
    const scope = k.slice(0, bar);
    if (scope === 'hair') remembered[k] = v;
    else if (oldMeshes.has(scope)) oldValues[k] = v;
  }
  const defs = variables.filter((v) => v.private && v.kind === 'palette' && newMeshes.has(v.mesh));
  return carryHairColour(oldValues, defs, remembered);
}

/**
 * The hair tab of ours, for a species whose converted hair the game's creator never offered: the
 * Sullustan's styles, and a colour row over the one variable they carry (`index_color_hair`, read through
 * the styles' own palette, `pc_hair_sul`). Keyed by species, since it is one invented thing and not a rule.
 */
const OURS_HAIR: Record<string, { variables: string[] }> = {
  sullustan: { variables: ['index_color_hair'] },
};

/**
 * A species' table row with its hair tab of ours added (`OURS_HAIR`), or as it is: only for a species the
 * table gives no hair tab, and only while it has styles. Its words are the game's own, borrowed from the
 * first species whose table has a hair tab and a `color_hair` row.
 */
export function withOursHair(table: CreatorTable | null | undefined, entry: CreatorSpecies | null | undefined, species: string, hasHairObjects: boolean): CreatorSpecies | null | undefined {
  const ours = OURS_HAIR[species.toLowerCase()];
  if (!entry || !ours || !hasHairObjects || entry.groups.some((g) => g.hair)) return entry;
  let groupLabel: string | null = null;
  let rowLabel: string | null = null;
  for (const s of Object.values(table?.species ?? {})) {
    const g = s.groups.find((x) => x.hair && x.id === 'hair');
    const r = s.rows.find((x) => x.name === 'color_hair' && x.label);
    if (g?.label && r?.label) {
      groupLabel = g.label;
      rowLabel = r.label;
      break;
    }
  }
  const group: CreatorGroup = { id: 'hair', label: groupLabel ?? 'Hair', hair: true, ours: true };
  const row: CreatorRow = { name: 'ours:color_hair', label: rowLabel ?? 'Hair colour', group: 'hair', type: 'color', variables: [...ours.variables], onHair: true, ours: true };
  return { ...entry, groups: [...entry.groups, group], rows: [...entry.rows, row] };
}
