// The appearance page as the game's own creator laid it out, worked out from its table.
//
// The converter's `customization` command writes `characters/customization.json` from the client's
// creator tables (tools/swg/customization.mjs says what each column is): per species the tabs in their
// order, the rows on each in theirs, the words, which colours follow which, which colours also set
// others, whether the species may go bald and the hairstyles it was offered, and per creator palette how
// many of its colours the creator showed and in how many columns. This file turns one species' rows
// and one character's live variables into what the page draws: groups of rows, each row carrying the
// customizer keys it writes. Every rule about which key a row means lives in `creatorView` and nowhere
// else, so the page only draws and the node test reads the real packs through exactly what the page uses.
//
// Pure, with no DOM and no three, so a node test can run it.
import { paletteStem, plainLabel, variableLabel } from './variableLabel.ts';

/** The newest file this code can read; a newer one is left alone and the page falls back. */
export const CUSTOMIZATION_FORMAT = 1;

/** A tab of the creator. */
export interface CreatorGroup {
  id: string;
  label: string | null;
  /** The tab holding the species' hair (hair, lekku, horns and hair, ridges, frills). */
  hair?: boolean;
  marking?: boolean;
}

/** One row of the creator, as the converter wrote it. */
export interface CreatorRow {
  name: string;
  label: string | null;
  group: string;
  /** Other tabs the same row came in; it is shown once, in its first. */
  alsoIn?: string[];
  type: 'scale' | 'slider' | 'choice' | 'color';
  variables: string[];
  reverse?: boolean;
  discrete?: boolean;
  /** The variable lives on the hair object, not the body. */
  onHair?: boolean;
  /** The variable this colour follows. */
  follows?: string;
  /** The variables this colour also sets, with the same index. */
  sets?: string[];
  yaw?: number;
  random?: boolean | number;
}

export interface CreatorHair {
  template: string;
  id: string;
  inArchives: boolean;
  creation: boolean;
  skill: number;
}

export interface CreatorSpecies {
  bald?: boolean;
  groups: CreatorGroup[];
  rows: CreatorRow[];
  hair?: CreatorHair[];
}

/** How the creator offered one palette: so many colours at creation, in so many columns. */
export interface CreatorPalette {
  creation: number;
  columns: number;
  master: number;
  /** A creator palette's own colours, written for every `pc_*` palette. */
  colors?: number[][];
}

export interface CreatorTable {
  format: number;
  source: string;
  species: Record<string, CreatorSpecies>;
  palettes: Record<string, CreatorPalette>;
}

/** Every number and switch here is ours. */
export const CREATOR_TUNE = {
  /** A colour also sets the colours the table links to it (a female's skin, her lips and eye shadow). */
  linkSelf: true,
  /** Columns for a palette whose creation block has none of its own (the Rodian eyes'). */
  fallbackColumns: 8,
  /** Columns for the colours past the creation block, and for a palette the table says nothing about. */
  moreColumns: 16,
  /** The pack's sliders no row names stand in a group of their own at the bottom; off, they are hidden. */
  untabledGroup: true,
};

export function tuneCreator(o: Partial<typeof CREATOR_TUNE>): typeof CREATOR_TUNE {
  if (typeof o.linkSelf === 'boolean') CREATOR_TUNE.linkSelf = o.linkSelf;
  if (typeof o.untabledGroup === 'boolean') CREATOR_TUNE.untabledGroup = o.untabledGroup;
  if (typeof o.fallbackColumns === 'number' && Number.isFinite(o.fallbackColumns)) CREATOR_TUNE.fallbackColumns = Math.max(1, Math.min(32, Math.round(o.fallbackColumns)));
  if (typeof o.moreColumns === 'number' && Number.isFinite(o.moreColumns)) CREATOR_TUNE.moreColumns = Math.max(1, Math.min(32, Math.round(o.moreColumns)));
  return CREATOR_TUNE;
}

const tables = new Map<string, Promise<CreatorTable | null>>();
const settled = new Map<string, CreatorTable | null>();

/** Whether a parsed file is one this code can read. */
export function readableTable(t: unknown): t is CreatorTable {
  const o = t as Partial<CreatorTable> | null;
  return !!o && typeof o.format === 'number' && o.format >= 1 && o.format <= CUSTOMIZATION_FORMAT && !!o.species && typeof o.species === 'object' && !!o.palettes && typeof o.palettes === 'object';
}

/** The creator's table, fetched once a session; null when it is not converted or is newer than this code. */
export function loadCreatorTable(baseUrl: string): Promise<CreatorTable | null> {
  let p = tables.get(baseUrl);
  if (!p) {
    p = fetch(`${baseUrl}assets-private/characters/customization.json`)
      .then(async (res) => {
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
        const t = (await res.json()) as unknown;
        return readableTable(t) ? t : null;
      })
      .catch(() => null)
      .then((t) => {
        settled.set(baseUrl, t);
        return t;
      });
    tables.set(baseUrl, p);
  }
  return p;
}

/** The table if it has already arrived (null when it will not), undefined while it is on its way or not asked for. */
export function creatorTableNow(baseUrl: string): CreatorTable | null | undefined {
  return settled.get(baseUrl);
}

/** A customization variable as the customizer lists it (`Customizer.variables()`). */
export interface CreatorVariable {
  key: string;
  name: string;
  private: boolean;
  mesh: string;
  default: number;
  kind: 'palette' | 'index';
  palette?: string;
  tag?: string;
  count?: number;
  colors?: number[][];
}

/** What the page knows of the character the view is for. */
export interface CreatorState {
  /** Every shape slider and where it sits (`Character.morphValues()`). */
  morphs: Record<string, number>;
  /**
   * The morphs the body itself carries. A garment brings fit morphs of its own (a jacket's belt, a robe's
   * bandolier) that the game set and never offered, so only the body's untabled ones get a slider; all of
   * them when left out.
   */
  bodyMorphs?: Iterable<string>;
  /** The customizer's live variables. */
  variables: readonly CreatorVariable[];
  /** The body's meshes (the species pack's own body and head, hands and arms), as the recipes name them. */
  bodyMeshes: Iterable<string>;
  /** The worn hair's meshes, likewise; empty when bald. */
  hairMeshes: Iterable<string>;
  /** Whether the species has hairstyles at all (so its hair tab holds the style picker). */
  hasHairObjects: boolean;
}

/** One row as the page draws it. */
export interface ViewRow {
  /** The table's row name, or `untabled:<name>` for one of ours. */
  name: string;
  label: string;
  type: 'scale' | 'slider' | 'choice' | 'color';
  /** The customizer keys a pick writes, the shared key first. */
  keys: string[];
  /** A slider's morphs: the low end of a pair, and the high end (or the one morph). */
  lo?: string;
  hi?: string;
  reverse?: boolean;
  discrete?: boolean;
  /** The variable whose palette or choices the row shows (its first live key's). */
  shows?: CreatorVariable;
  /** Keys a pick also writes with the same value: the rows that follow this one. */
  followers: string[];
  /** Keys a pick also writes with the same index while `linkSelf` is on. */
  sets: string[];
  /** A row of ours, not the game's. */
  ours?: boolean;
}

export interface ViewGroup {
  id: string;
  label: string;
  hair: boolean;
  ours?: boolean;
  rows: ViewRow[];
}

export interface CreatorView {
  groups: ViewGroup[];
  /** Rows whose variables found nothing on this character. */
  unresolved: string[];
  /** Live variables the page leaves out on purpose, and why. */
  hidden: { key: string; why: string }[];
  /** Rows not shown because the row they follow is, with the variable they follow. */
  following: { row: string; follows: string }[];
  /** Rows dropped as a second copy of an earlier row's variables. */
  duplicates: string[];
  /** Every key a row or a rule took, so the page shows the rest (a garment's own colours) as before. */
  taken: Set<string>;
  /** The body's meshes the view was worked out for, which `ownSection` tells a garment's colours from. */
  body: ReadonlySet<string>;
}

/** The ours-only group at the bottom. */
export const UNTABLED_GROUP = 'untabled';

/** The palette the wardrobe's dye of ours reads (tools/swg/dye.mjs writes it into customize.json). */
export const DYE_PALETTE = 'swg3js/dye';

/** A variable's name without its mesh or its path: `hum_m_head_l0|/private/index_color_2` is `index_color_2`. */
export function bareName(name: string): string {
  return name.replace(/^.*\|/, '').replace(/^.*\//, '');
}

/** Whether every colour of a palette is the same one, so it offers no choice (white.pal is two of one grey). */
export function oneColour(colors: readonly number[][] | undefined): boolean {
  if (!colors?.length) return false;
  const [r, g, b] = colors[0];
  return colors.every((c) => c[0] === r && c[1] === g && c[2] === b);
}

/**
 * One species' rows for one character. Null with no species row (the page then draws itself as it did
 * before the table). Every rule about which customizer key a row writes is here:
 *
 * - a body colour or choice writes every body mesh's key of that bare name, and the shared key where
 *   there is one (the Rodian's nose is private on both the hands and the head);
 * - a row whose variable lives on the hair writes the worn hair's keys of that name (and a shared one,
 *   which is how lekku, ridges and frills already follow the skin), and the remembered key
 *   `hair|<name>`; with no worn hair carrying it, it does not show;
 * - a row that follows another is not shown while that row is, and its keys go with the other's; with
 *   no such row showing it is shown on its own (the Twi'lek female's eyebrows follow a colour no lekku
 *   carries);
 * - a row that writes exactly what an earlier row writes -- the same kind of row, the same variables, on
 *   the same object -- is dropped (the males' torso slider is their muscle one); a colour on the hair
 *   that shares a bare name with one on the body is not a copy of it (a Zabrak's horns and his eyes are
 *   both `index_color_2`, one on the horns and one on the head);
 * - a row in several tabs shows in its first;
 * - a live body variable no row names is hidden when its palette offers one colour, and stands in a group
 *   of ours at the bottom otherwise, as does a pack morph no row names;
 * - a group with nothing to show is left out, except the hair tab of a species with hairstyles, which
 *   holds the style picker.
 */
export function creatorView(entry: CreatorSpecies | null | undefined, state: CreatorState, tune: typeof CREATOR_TUNE = CREATOR_TUNE): CreatorView | null {
  if (!entry) return null;
  const body = new Set(state.bodyMeshes);
  const hair = new Set(state.hairMeshes);
  const vars = state.variables;
  const morphs = state.morphs;
  const hidden: CreatorView['hidden'] = [];
  const following: CreatorView['following'] = [];
  const duplicates: string[] = [];
  const unresolved: string[] = [];
  const taken = new Set<string>();

  /** The live variables a row's variable means: the shared one first, then the private copies it reaches. */
  const liveFor = (v: string, onHair: boolean): CreatorVariable[] => {
    const shared = vars.filter((x) => !x.private && bareName(x.name) === v);
    const own = vars.filter((x) => x.private && bareName(x.name) === v && (onHair ? hair.has(x.mesh) : body.has(x.mesh)));
    return [...shared, ...own];
  };

  // The table's rows, a second copy of one row dropped: keyed on what the row writes, so the object it
  // lives on and its kind count as well as its variables' names.
  const seenVariables = new Set<string>();
  const rows: CreatorRow[] = [];
  for (const r of entry.rows) {
    const sig = r.variables.length ? `${r.onHair ? 'hair' : 'body'}:${r.type}:${r.variables.join(',')}` : '';
    if (sig && seenVariables.has(sig)) {
      duplicates.push(r.name);
      continue;
    }
    if (sig) seenVariables.add(sig);
    rows.push(r);
  }

  // Each row resolved against the character, or not.
  const resolved = new Map<CreatorRow, ViewRow>();
  for (const r of rows) {
    const label = r.label ?? plainLabel(r.name);
    const base = { name: r.name, label, type: r.type, followers: [] as string[], sets: [] as string[], ...(r.reverse ? { reverse: true } : {}), ...(r.discrete ? { discrete: true } : {}) };
    if (r.type === 'scale') {
      resolved.set(r, { ...base, keys: [] });
      continue;
    }
    if (r.type === 'slider') {
      if (!r.variables.length || !r.variables.every((v) => v in morphs)) {
        unresolved.push(r.name);
        continue;
      }
      const pair = r.variables.length >= 2;
      resolved.set(r, { ...base, keys: [], ...(pair ? { lo: r.variables[0], hi: r.variables[1] } : { hi: r.variables[0] }) });
      continue;
    }
    const live: CreatorVariable[] = [];
    let onHairKeys = false;
    for (const v of r.variables) {
      const found = liveFor(v, !!r.onHair);
      if (r.onHair && found.some((x) => x.private)) onHairKeys = true;
      for (const x of found) if (!live.includes(x)) live.push(x);
    }
    if (!live.length) {
      unresolved.push(r.name);
      continue;
    }
    const keys = live.map((x) => x.key);
    // The hair's colour is remembered apart from the style that wears it, so the next style can take it.
    if (onHairKeys) for (const v of r.variables) keys.push(`hair|${v}`);
    const shows = live.find((x) => (x.kind === 'palette' ? !!x.colors?.length : (x.count ?? 0) > 1)) ?? live[0];
    resolved.set(r, { ...base, keys, shows });
  }

  // Followers: a row following one that shows rides on it.
  const shown = new Set<CreatorRow>(resolved.keys());
  for (const r of rows) {
    if (!r.follows || !resolved.has(r)) continue;
    const source = rows.find((s) => s !== r && s.variables.includes(r.follows!) && resolved.has(s));
    if (!source) continue;
    shown.delete(r);
    resolved.get(source)!.followers.push(...resolved.get(r)!.keys);
    following.push({ row: r.name, follows: r.follows });
  }
  // What a colour also sets.
  for (const r of rows) {
    const view = resolved.get(r);
    if (!view || !r.sets?.length) continue;
    for (const t of r.sets) for (const x of liveFor(t, false)) if (!view.sets.includes(x.key)) view.sets.push(x.key);
  }
  for (const view of resolved.values()) for (const k of view.keys) taken.add(k);

  // What the pack has that no row names.
  const tabled = new Set(rows.flatMap((r) => r.variables));
  for (const r of entry.rows) for (const v of r.variables) tabled.add(v);
  const ours: ViewRow[] = [];
  const morphNames = Object.keys(morphs);
  const morphSet = new Set(morphNames);
  const bodyMorphs = state.bodyMorphs ? new Set(state.bodyMorphs) : morphSet;
  const loose: string[] = [];
  for (const m of morphNames.sort()) {
    if (tabled.has(m)) continue;
    if (bodyMorphs.has(m)) loose.push(m);
    else hidden.push({ key: m, why: "a garment's own fit, which the game set itself" });
  }
  for (const s of packSliders(loose)) ours.push({ name: `untabled:${s.name}`, label: plainLabel(s.name), type: 'slider', keys: [], ...(s.lo ? { lo: s.lo } : {}), hi: s.hi, followers: [], sets: [], ours: true });
  const byBare = new Map<string, CreatorVariable[]>();
  for (const x of vars) {
    if (x.private && !body.has(x.mesh)) continue;
    const b = bareName(x.name);
    // A variable a shape slider drives is the slider's (the game's fat blueprint follows its morph).
    if (tabled.has(b) || morphSet.has(b)) continue;
    (byBare.get(b) ?? byBare.set(b, []).get(b)!).push(x);
  }
  for (const [b, list] of byBare) {
    const shows = list.find((x) => !x.private) ?? list[0];
    const keys = list.map((x) => x.key);
    for (const k of keys) taken.add(k);
    if (shows.kind === 'palette' && oneColour(shows.colors)) {
      for (const k of keys) hidden.push({ key: k, why: 'its palette offers one colour' });
      continue;
    }
    if (shows.kind === 'palette' ? !shows.colors?.length : (shows.count ?? 0) < 2) {
      for (const k of keys) hidden.push({ key: k, why: 'nothing to choose' });
      continue;
    }
    ours.push({ name: `untabled:${b}`, label: shows.kind === 'palette' ? variableLabel({ name: shows.name, palette: shows.palette, tag: shows.tag }) : plainLabel(b), type: shows.kind === 'palette' ? 'color' : 'choice', keys, shows, followers: [], sets: [], ours: true });
  }

  // The groups, in the table's order, each row in its first.
  const groups: ViewGroup[] = [];
  for (const g of entry.groups) {
    const list = rows.filter((r) => r.group === g.id && shown.has(r)).map((r) => resolved.get(r)!);
    const holdsPicker = !!g.hair && state.hasHairObjects;
    if (!list.length && !holdsPicker) continue;
    groups.push({ id: g.id, label: g.label ?? plainLabel(g.id), hair: !!g.hair, rows: list });
  }
  // A row whose first tab the table never listed still shows, at the end of the game's tabs.
  const placed = new Set(entry.groups.map((g) => g.id));
  for (const r of rows) {
    if (placed.has(r.group) || !shown.has(r)) continue;
    let g = groups.find((x) => x.id === r.group);
    if (!g) groups.push((g = { id: r.group, label: plainLabel(r.group), hair: false, rows: [] }));
    g.rows.push(resolved.get(r)!);
  }
  if (ours.length) {
    if (tune.untabledGroup) groups.push({ id: UNTABLED_GROUP, label: "Not in the game's creator", hair: false, ours: true, rows: ours });
    else for (const r of ours) hidden.push({ key: r.keys[0] ?? r.hi ?? r.name, why: 'the group of ours is switched off' });
  }
  return { groups, unresolved, hidden, following, duplicates, taken, body };
}

/**
 * Every key a pick on a table row writes, in the order it writes them: the row's own keys, then the keys
 * of the rows that follow it, with the same value, then (while `linkSelf` is on) the colours it also sets,
 * with the same index. A follower goes before a linked colour, so a colour that is both is left as the
 * link says.
 */
export function pickWrites(row: Pick<ViewRow, 'keys' | 'followers' | 'sets'>, tune: typeof CREATOR_TUNE = CREATOR_TUNE): string[] {
  return [...row.keys, ...row.followers, ...(tune.linkSelf ? row.sets : [])];
}

/**
 * Whether a live colour is left to its own mesh's section after the table's groups: a private colour of
 * something that is not the body (a worn garment, or a hairstyle's colour no row names) that no row or
 * rule of the view took. The body's own are the view's whether it shows them or hides them.
 */
export function ownSection(view: Pick<CreatorView, 'taken' | 'body'>, v: { key: string; private: boolean; mesh: string }): boolean {
  return v.private && !view.body.has(v.mesh) && !view.taken.has(v.key);
}

/**
 * Whether the style picker offers no hair at all (the table's bald rule): `offer` where the species may go
 * bald or the table says nothing (no table, no row for it, or no hairstyles to pick between); `shown` where
 * it may not but nothing is worn, so the picker says none without offering it (an existing character is
 * left as it is); `left out` where it may not and a style is on.
 */
export function hairNone(entry: Pick<CreatorSpecies, 'bald'> | null | undefined, hasHairObjects: boolean, wearing: boolean): 'offer' | 'shown' | 'left out' {
  if (entry?.bald !== false || !hasHairObjects) return 'offer';
  return wearing ? 'left out' : 'shown';
}

// ---- the page without the table ----------------------------------------------------------------

/**
 * A pack's shape sliders, as the page has always drawn them: sorted by name, an `_0`/`_1` pair one slider
 * from its low end to its high end, anything else one running from nought to one. The group of ours uses
 * the same pairing for the morphs no row of the table names.
 */
export function packSliders(names: Iterable<string>): { name: string; lo?: string; hi: string }[] {
  const all = [...names].sort();
  const have = new Set(all);
  const done = new Set<string>();
  const out: { name: string; lo?: string; hi: string }[] = [];
  for (const n of all) {
    if (done.has(n)) continue;
    const pair = /^(.*)_0$/.exec(n);
    const other = pair ? `${pair[1]}_1` : null;
    // Sorted, so a pair's low end comes first and takes its high end with it.
    if (pair && other && have.has(other)) {
      done.add(n).add(other);
      out.push({ name: pair[1], lo: n, hi: other });
    } else {
      done.add(n);
      out.push({ name: n, hi: n });
    }
  }
  return out;
}

/** A colour or choice as the page without the table draws it. */
export interface PackColour {
  key: string;
  name: string;
  private: boolean;
  mesh: string;
  kind: 'palette' | 'index';
  colors?: number[][];
  count?: number;
  default: number;
  /** A live recipe reads it; otherwise it is the manifest's, shown dimmed with the bake command behind it. */
  live: boolean;
  palette?: string;
  tag?: string;
}

/** A variable as the parts manifest lists it (the fallback for a pack converted before live recipes). */
export interface PackManifestVariable {
  name: string;
  private: boolean;
  kind: 'palette' | 'index';
  default: number;
  colors?: number[][];
  palette?: string;
  count?: number;
  meshes?: string[];
}

/**
 * The page's colours and choices without the table, in its two kinds of section: the owner's own (skin,
 * hair, eyes and the like), then each worn piece's own. Live variables come from the customizer, each
 * private one scoped to its own mesh and shown only while that mesh is worn, a private copy of a shared
 * colour never shown on its own; what the manifest lists that no recipe reads still shows, dimmed. A
 * shared variable a shape slider already drives (the fat blueprint is the fat morph) is left to the
 * slider. `only` keeps a subset, which is how the table's page shows what its rows did not take.
 */
export function packColours(input: { live: readonly CreatorVariable[]; manifest: readonly PackManifestVariable[]; worn: ReadonlySet<string>; isLinked: (key: string) => boolean; morphs: Iterable<string>; only?: (v: PackColour) => boolean }): { rows: PackColour[]; shared: PackColour[]; byMesh: Map<string, PackColour[]> } {
  const short = (n: string) => n.replace(/^.*\//, '');
  // A garment's dye of ours reads a palette whose one entry dyes nothing: only a colour carried whole does,
  // which no swatch here can give, so its row waits for the picker that can.
  const live = input.live.filter((v) => (!v.private || input.worn.has(v.mesh)) && !input.isLinked(v.key) && v.palette !== DYE_PALETTE);
  const rows: PackColour[] = [];
  // The palette and the slot it tints go with each row, because they are what names it: the live row's
  // are the customizer's own, read off that mesh's recipe, and the manifest's merged list is the fallback
  // (it can name the wrong palette for a private variable another mesh shares a name with).
  for (const v of live) {
    const m = input.manifest.find((mv) => short(mv.name) === short(v.name) && mv.private === v.private);
    rows.push({ key: v.key, name: v.name, private: v.private, mesh: v.mesh, kind: v.kind, colors: v.colors ?? m?.colors, count: v.count ?? m?.count, default: v.default, live: true, palette: v.palette ?? m?.palette, tag: v.tag });
  }
  for (const v of input.manifest) {
    for (const mesh of v.private && v.meshes?.length ? v.meshes : ['']) {
      if (v.private && live.length && !input.worn.has(mesh)) continue;
      if (rows.some((r) => r.private === v.private && short(r.name) === short(v.name) && (!v.private || r.mesh === mesh))) continue;
      if (v.private && live.length && input.isLinked(`${mesh}|${v.name}`)) continue;
      rows.push({ key: v.private ? `${mesh}|${v.name}` : v.name, name: v.name, private: v.private, mesh, kind: v.kind, colors: v.colors, count: v.count, default: v.default, live: false, palette: v.palette });
    }
  }
  const kept = input.only ? rows.filter(input.only) : rows;
  const driven = new Set([...input.morphs].map((m) => m.replace(/_[01]$/, '')));
  const shared = kept.filter((v) => !v.private && !driven.has(short(v.name)));
  const byMesh = new Map<string, PackColour[]>();
  for (const v of kept) if (v.private) (byMesh.get(v.mesh) ?? byMesh.set(v.mesh, []).get(v.mesh)!).push(v);
  return { rows: kept, shared, byMesh };
}

/** How a palette's swatches are laid out: the creation block in its own columns, then the rest. */
export interface SwatchLayout {
  /** How many colours the creation block holds (the first ones). */
  creation: number;
  /** Its columns. */
  columns: number;
  /** How many colours follow it. */
  more: number;
  /** Their columns. */
  moreColumns: number;
}

/**
 * The game's own ramps first: the colours the creator offered, in its own column count, then every other
 * colour of the palette. A palette the table says nothing about is one block in `moreColumns`.
 */
export function swatchLayout(palette: string | undefined, count: number, table: CreatorTable | null | undefined, tune: typeof CREATOR_TUNE = CREATOR_TUNE): SwatchLayout {
  const meta = table?.palettes[paletteStem(palette)];
  if (!meta || !(meta.creation > 0)) return { creation: count, columns: tune.moreColumns, more: 0, moreColumns: tune.moreColumns };
  const creation = Math.min(count, Math.max(0, Math.round(meta.creation)));
  return { creation, columns: meta.columns > 0 ? meta.columns : tune.fallbackColumns, more: count - creation, moreColumns: tune.moreColumns };
}
