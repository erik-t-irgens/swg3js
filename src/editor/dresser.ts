// The world editor's dresser, its rules (Map-maker II's thirteenth wave, DESIGN.md §2.13's "Dressing his people"): what a
// look being made is, read off the dresser's own figure as the player's own pages read the player (`lookFromFigure`), what
// it starts from (`recordFromEntry`, `fromFor`), and the species' own rules the player's pages keep -- the appearance table's
// `block` refused in words (`wearRefusal`, `lookRules`), its `hide` a piece that takes its slots and draws nothing (so it is
// no piece of the look), the species pack's own pieces worn as themselves (`packOwn`), a garment's colour its own by bare
// name as `tintValues` keys a thing's, and a colour carried whole. The window and the figure are `src/ui/dresserUi.ts`, and
// every rule it hands its figure to is here, over a figure-shaped interface a node test stands in for: the wardrobe items by
// the folder each worn piece came out of (`DresserItems`), what is read off the figure (`figureStateOf`), where its sliders
// stood bare (`dressFigure`), a pick on the Clothes page (`wearPick`, `pickRefusal`) and a save (`saveLook`).
//
// Pure: no three, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no
// enum, no namespace, no constructor parameter properties. The dev server's alone: reached only through the editor's own
// dynamic import.

import { bareVariable, chooseArrangement, fitFor, tintFromValues, type ItemFit } from '../core/inventory.ts';
import { lookMorph, lookValue, mintLookId, ownBodyOf, readLookRow, type LookRules, type OwnLookPiece, type OwnLookRow } from '../world/editFiles/looksFile.ts';

/**
 * The dresser's numbers of feel (ours, the owner's to move: `__debug.ownLooks({ tune })` and the debug menu's `ownLooks`
 * sliders). None is chosen by measuring.
 */
export const DRESSER_TUNE = {
  /**
   * The Looks tab's doll's turn as it frames a figure afresh, radians off the front: a little round, so a coat's depth and a
   * sleeve read where a figure square on shows only its front.
   */
  yaw: 0.45,
  /** Its tilt, radians: a little from above, as every doll starts. */
  pitch: 0.05,
  /** Its lights, a share of their own strength: 1, as every doll is lit. */
  light: 1,
  /** Its height on the tab, pixels: tall enough for a figure head to toe beside the tab's own fields. */
  dollHeight: 300,
  /** How many catalogue entries a "start from" find offers: a short list a click takes one of. */
  startHits: 12,
  /** The species a look begins as when nothing is started from (the creator's own first body). */
  species: 'human_male',
};

/** Move any of the dresser's numbers at once, held to sense, in place; the words for what moved. */
export function tuneDresser(o: unknown): string[] {
  const said: string[] = [];
  if (!o || typeof o !== 'object') return said;
  const t = o as Record<string, unknown>;
  const num = (k: 'yaw' | 'pitch' | 'light' | 'dollHeight' | 'startHits', lo: number, hi: number, whole = false): void => {
    const v = t[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    const c = Math.min(hi, Math.max(lo, whole ? Math.round(v) : v));
    DRESSER_TUNE[k] = c;
    said.push(`${k} ${c}`);
  };
  num('yaw', -Math.PI, Math.PI);
  num('pitch', -0.5, 0.7);
  num('light', 0, 4);
  num('dollHeight', 120, 900, true);
  num('startHits', 1, 60, true);
  if (typeof t.species === 'string' && /^[a-z0-9_]{1,40}$/.test(t.species)) {
    DRESSER_TUNE.species = t.species;
    said.push(`species ${t.species}`);
  }
  return said;
}

/**
 * A wardrobe item as the dresser reads one: its id, its game name, its parts (the meshes it is drawn with), its fit, and the
 * folder it came out of under `assets-private/` where that is not the figure's own wardrobe (an NPC's wearable a look was
 * started from: `mobiles/wearables/<folder>`).
 */
export interface DresserItem {
  id: string;
  name?: string | null;
  parts: readonly { name: string }[];
  fit?: ItemFit | null;
  wardrobe?: string;
  /** The body slots it takes: the game's arrangements, alternatives each a list of slots (null for none). */
  slots?: readonly (readonly string[])[] | null;
}

/**
 * What putting a piece on takes off, as the player's own equipment decides it: the game's arrangement rule
 * (`chooseArrangement`), each piece worn now holding the slots of its first free arrangement in the order they are worn, and
 * the new piece taking its first free one or displacing what holds its first. So a jacket goes on over a shirt (the shirt is
 * `chest1`, the jacket `chest2`) where the Clothes page's own rule, with no equipment behind it, takes off whatever its group
 * holds. Answers the worn parts' names to take off.
 */
export function displacedBy(id: string, worn: readonly { part: string; id: string }[], itemOf: (id: string) => DresserItem | null): string[] {
  const occupied = new Map<string, string>();
  for (const w of worn) {
    if (w.id === id) continue;
    for (const s of chooseArrangement(itemOf(w.id)?.slots ?? null, occupied, w.id).slots) occupied.set(s, w.id);
  }
  const { displaced } = chooseArrangement(itemOf(id)?.slots ?? null, occupied, id);
  return worn.filter((w) => displaced.includes(w.id)).map((w) => w.part);
}

/**
 * Why a piece may not go on the dresser's figure, in words, or null: the appearance table's `block` for the species, as the
 * player's own equipment refuses it (a piece the species pack itself carries is the pack's own and always goes on). A piece
 * the table hides goes on: it takes its slots and draws nothing, as on the player.
 */
export function wearRefusal(item: DresserItem, species: string, packOwn = false): string | null {
  if (fitFor(item.fit ?? undefined, species, packOwn) !== 'block') return null;
  return `${item.name || item.id} is a piece ${speciesWords(species)} cannot wear (the appearance table blocks it)`;
}

/** "wookiee_male" reads "a Wookiee male". */
export function speciesWords(species: string): string {
  const s = species.replace(/_/g, ' ');
  return `a ${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}

/** The cleaner's rules for a look of a species (`readLookRow`): a piece its own wardrobe blocks for it is refused in words. */
export function lookRules(species: string, itemOf: (wardrobe: string, item: string) => DresserItem | null, packOwn: (item: string) => boolean = () => false): LookRules {
  return {
    fitOf: (wardrobe, id) => {
      const item = itemOf(wardrobe, id);
      return item ? fitFor(item.fit ?? undefined, species, packOwn(id)) : null;
    },
  };
}

/** A wardrobe folder's place under `assets-private/` (`wardrobe/human_male`) from the full URL a character settled on, or null. */
export function wardrobeRel(dirUrl: string | null, baseUrl: string): string | null {
  if (!dirUrl) return null;
  const head = `${baseUrl}assets-private/`;
  const rest = dirUrl.startsWith(head) ? dirUrl.slice(head.length) : dirUrl.replace(/^.*assets-private\//, '');
  const rel = rest.replace(/\/+$/, '');
  return /^(wardrobe|mobiles\/wearables)\/[a-z0-9_]{1,40}$/.test(rel) ? rel : null;
}

/** The dresser's figure as `lookFromFigure` reads it: everything the look is worked out of, read off the figure at once. */
export interface FigureState {
  species: string;
  /** Every shape slider now, and where each stood on the bare body as it loaded. */
  morphs: Readonly<Record<string, number>>;
  rest: Readonly<Record<string, number>>;
  /** Every colour value held now (`variableValues`), the pack's own (`manifest.values`), and a shared key's resting value. */
  values: Readonly<Record<string, number>>;
  packValues: Readonly<Record<string, number>>;
  restOf: (key: string) => number | undefined;
  /** The parts on the figure (`status`), worn or not, the body's among them. */
  parts: readonly { name: string; worn: boolean; body: boolean; meshNames: readonly string[] }[];
  /** A worn part's wardrobe item, by the id it is worn under, or null for a pack piece of the body's own. */
  itemOf: (id: string) => DresserItem | null;
  /** The wardrobe folder the figure dresses from, under `assets-private/`. */
  wardrobe: string;
  /** Whether a private key follows one of the body's own colours (the customizer's link by name), and so is the body's. */
  follows: (key: string) => boolean;
  /**
   * Every variable the recipes read on some meshes (`Customizer.variables()`, filtered to them): what a piece's colours are
   * filled out from where nothing is held (absent: only what is held is written).
   */
  defsOf?: (meshes: readonly string[]) => readonly { key: string; name: string; private: boolean; default: number }[];
}

/** What a look is, worked out of its figure: the parts of a row the figure decides. */
export type FigureLook = Pick<OwnLookRow, 'species' | 'morphs' | 'custom' | 'outfit'>;

/**
 * The look the figure wears, as a row of the looks file reads it: the shape sliders that moved off the bare body; the shared
 * colours that differ from the pack's own, each by its bare name (the full spelling winning, as a render reads it first);
 * and an outfit piece for every mesh of every worn piece that draws (a piece the table hides draws nothing and is left out),
 * each with the piece's own colours by bare name over every mesh of it (`tintFromValues`: a key that follows the body's
 * colour is the body's), which is how the player's page writes one colour over every mesh of a piece. What `buildLook` reads
 * back dresses a fresh body exactly so (`dressLook`).
 */
export function lookFromFigure(s: FigureState): FigureLook {
  const morphs: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.morphs)) {
    if (!Number.isFinite(v)) continue;
    if (v !== (s.rest[k] ?? 0)) morphs[k] = lookMorph(v);
  }
  // The shared colours by bare name, the full spelling first (it is what a render reads first).
  const custom: Record<string, number> = {};
  const fromFull = new Set<string>();
  for (const [k, v] of Object.entries(s.values)) {
    if (k.includes('|') || !Number.isFinite(v)) continue;
    const bare = bareVariable(k);
    const full = k.includes('/');
    if (Object.prototype.hasOwnProperty.call(custom, bare) && (fromFull.has(bare) || !full)) continue;
    custom[bare] = v;
    if (full) fromFull.add(bare);
  }
  for (const [bare, v] of Object.entries(custom)) {
    const rest = s.packValues[bare] ?? s.restOf(bare);
    if (rest !== undefined && rest === v) delete custom[bare];
    else custom[bare] = lookValue(v);
  }
  // The body's own colours that no shared colour carries (the eyes, the lips, the age, a beard's colour, the eyeshadow, a
  // tattoo's: a creator row writes them on the body's meshes alone), by bare name, over a bare value of the same name the
  // look started from: `dressLook`'s shared write reaches every body mesh's private copy of that name, so the stale bare
  // value would dress the world's body otherwise than the doll shows it. One at its resting value on every body mesh is no
  // colour of the look, and takes the stale bare value with it.
  for (const [bare, v] of bodyColours(s)) {
    if (v === null) delete custom[bare];
    else custom[bare] = lookValue(v);
  }
  const outfit: OwnLookPiece[] = [];
  for (const p of s.parts) {
    if (p.body || !p.worn || !p.meshNames.length) continue;
    const item = s.itemOf(p.name);
    if (!item || !item.parts.length) continue;
    const meshes = item.parts.map((x) => x.name);
    const tint = tintFromValues(s.values, meshes, s.follows) ?? {};
    const values: Record<string, number> = {};
    for (const [k, v] of Object.entries(tint)) values[k] = lookValue(v);
    // Every colour the piece's recipes read and nothing holds, at its own resting value: `dressLook` lays the look's shared
    // colours over every private copy of the same name first (the head's skin follows the body's), so a piece left silent
    // there would take a shared colour of the same name in the world (the eyes' `index_color_2` onto a jacket's) where the
    // dresser's doll showed its own. Written whole, the world dresses the piece as the doll showed it.
    for (const d of s.defsOf?.(meshes) ?? []) {
      if (!d.private || s.follows(d.key)) continue;
      const bare = bareVariable(d.name);
      if (!Object.prototype.hasOwnProperty.call(values, bare)) values[bare] = lookValue(d.default);
    }
    for (const m of meshes) outfit.push({ part: m, item: item.id, wardrobe: item.wardrobe ?? s.wardrobe, values: { ...values } });
  }
  return { species: s.species, morphs, custom, outfit };
}

/** A key's value held under either spelling (the full one first, as a render reads it), or undefined. */
function heldValue(values: Readonly<Record<string, number>>, key: string): number | undefined {
  const v = values[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const bar = key.indexOf('|');
  const short = bar >= 0 ? `${key.slice(0, bar + 1)}${bareVariable(key)}` : bareVariable(key);
  const w = values[short];
  return typeof w === 'number' && Number.isFinite(w) ? w : undefined;
}

/**
 * The body's own colours by bare name: every private variable the body's meshes' recipes read that follows no shared colour,
 * at the value it is held at (else its resting value). The first body mesh off its resting value speaks for the name; a name
 * at rest on every body mesh is null.
 */
function bodyColours(s: FigureState): Map<string, number | null> {
  const out = new Map<string, number | null>();
  if (!s.defsOf) return out;
  // A mesh with several materials loads as several meshes, the second onwards suffixed; the recipes name the first.
  const meshes = new Set<string>();
  for (const p of s.parts) {
    if (!p.body) continue;
    meshes.add(p.name);
    for (const m of p.meshNames) {
      meshes.add(m);
      meshes.add(m.replace(/_\d+$/, ''));
    }
  }
  if (!meshes.size) return out;
  for (const d of s.defsOf([...meshes])) {
    if (!d.private || s.follows(d.key)) continue;
    const bare = bareVariable(d.name);
    const rest = s.packValues[d.key] ?? s.packValues[bare] ?? d.default;
    const v = heldValue(s.values, d.key) ?? rest;
    if (v !== rest) {
      if (out.get(bare) == null) out.set(bare, v);
    } else if (!out.has(bare)) out.set(bare, null);
  }
  return out;
}

/**
 * The wardrobe items a dresser's figure dresses from, by folder: its own wardrobe's, and the folders a look it was started
 * from names (an NPC's wearables, or another species' wardrobe: a dressed entry may wear the human female's robe on a man).
 * Two folders may hold one id with other meshes (the robe's cut for each gender), and the figure keeps a piece under its id
 * (`Character.wearItemFrom`, `wearItem`), the first one loaded under that id standing for good; so which folder a worn id
 * came out of is noted as it goes on (`notePiece`, `noteOwn`), and a worn id is read as that folder's item (`itemOf`), never
 * the own wardrobe's of the same id, whose part names and colours are another cut's.
 */
export class DresserItems {
  /** The figure's own wardrobe folder under `assets-private/` (`wardrobe/human_male`). */
  readonly own: string;
  private readonly byFolder = new Map<string, Map<string, DresserItem>>();
  /** The folder each worn id's piece was first put on from. */
  private readonly from = new Map<string, string>();

  constructor(own: string, items: readonly DresserItemSource[]) {
    this.own = own;
    this.addFolder(own, items);
  }

  /** A folder's items, read once (a folder already read keeps what it holds). */
  addFolder(folder: string, items: readonly DresserItemSource[]): void {
    if (this.byFolder.has(folder)) return;
    const m = new Map<string, DresserItem>();
    for (const i of items) m.set(i.id, { id: i.id, name: i.name, parts: i.parts, fit: i.fit ?? null, slots: i.slots ?? null, wardrobe: folder });
    this.byFolder.set(folder, m);
  }

  /** Whether a folder has been read. */
  hasFolder(folder: string): boolean {
    return this.byFolder.has(folder);
  }

  /** An item of a folder by its id (the looks file's cleaner asks so), or null. */
  inFolder(folder: string, id: string): DresserItem | null {
    return this.byFolder.get(folder)?.get(id) ?? null;
  }

  /**
   * A look's piece put on (`dressLook`'s `wearItemFrom`, which keeps it under the id it finds, else the id of the item whose
   * parts name its part): its folder noted under that id, unless a piece already stands under it.
   */
  notePiece(p: { item: string; part: string; wardrobe: string }): void {
    const items = this.byFolder.get(p.wardrobe);
    const found = items?.get(p.item) ?? (items ? [...items.values()].find((i) => i.parts.some((x) => x.name === p.part)) : undefined);
    const key = found?.id ?? p.item;
    if (!this.from.has(key)) this.from.set(key, p.wardrobe);
  }

  /** A piece the Clothes page put on (out of the figure's own wardrobe): noted as the own folder's, unless one already stands under its id. */
  noteOwn(id: string): void {
    if (!this.from.has(id)) this.from.set(id, this.own);
  }

  /** The folder a worn id's piece came out of (the own wardrobe where nothing was noted). */
  folderOf(id: string): string {
    return this.from.get(id) ?? this.own;
  }

  /** The item a figure's part (by the id it is worn under) is: its noted folder's, else the own wardrobe's, else null. */
  itemOf(id: string): DresserItem | null {
    const folder = this.folderOf(id);
    return this.byFolder.get(folder)?.get(id) ?? (folder === this.own ? null : (this.byFolder.get(this.own)?.get(id) ?? null));
  }
}

/** A wardrobe catalogue's item as `DresserItems` reads one. */
export interface DresserItemSource {
  id: string;
  name?: string | null;
  parts: readonly { name: string }[];
  fit?: ItemFit | null;
  slots?: readonly (readonly string[])[] | null;
}

/** The pieces a figure wears (not its body), each with the item id it is (a pack part by its name less its suffix). */
export function wornPiecesOf(status: readonly { name: string; worn: boolean; body: boolean }[], items: Pick<DresserItems, 'itemOf'>): { part: string; id: string }[] {
  const out: { part: string; id: string }[] = [];
  for (const p of status) {
    if (p.body || !p.worn) continue;
    const stripped = p.name.replace(/_[fm]_l\d+$/, '');
    out.push({ part: p.name, id: items.itemOf(p.name) ? p.name : items.itemOf(stripped) ? stripped : p.name });
  }
  return out;
}

/** Why a worn id may not go on the figure (the item that would go on: its noted folder's, else the own), or null. */
export function pickRefusal(items: Pick<DresserItems, 'itemOf'>, species: string, id: string, packOwn: boolean): string | null {
  const item = items.itemOf(id);
  return item ? wearRefusal(item, species, packOwn) : null;
}

/** What the dresser's Clothes page puts a piece on through (the figure's own part of it). */
export interface PickFigure {
  readonly manifest: { readonly id: string };
  status(): readonly { name: string; worn: boolean; body: boolean }[];
  packPartOf(id: string): string | null;
  remove(key: string): boolean;
  wear(name: string): Promise<boolean>;
  wearItem(id: string, baseUrl: string): Promise<boolean>;
}

/**
 * A pick on the dresser's Clothes page (its `onWear`): refused in words where the species may not wear it, else what it
 * displaces taken off by the game's own arrangement rule (a jacket goes on over a shirt) and the piece put on, its folder
 * noted. Answers whether it went on.
 */
export async function wearPick(fig: PickFigure, items: DresserItems, id: string, baseUrl: string, say: (why: string) => void): Promise<boolean> {
  const why = pickRefusal(items, fig.manifest.id, id, fig.packPartOf(id) !== null);
  if (why) {
    say(why);
    return false;
  }
  for (const part of displacedBy(id, wornPiecesOf(fig.status(), items), (x) => items.itemOf(x))) fig.remove(part);
  const on = (await fig.wear(id)) || (await fig.wearItem(id, baseUrl).catch(() => false));
  if (on) items.noteOwn(id);
  return on;
}

/** What `figureStateOf` reads of a figure (a `Character`, or a test's stand-in). */
export interface StateFigure {
  readonly manifest: { readonly id: string; readonly values?: Readonly<Record<string, number>> };
  readonly customizer?: {
    variables(): readonly { key: string; name: string; private: boolean; mesh: string; default: number }[];
    isLinked(key: string): boolean;
  } | null;
  morphValues(): Record<string, number>;
  variableValues(): Record<string, number>;
  status(): readonly { name: string; worn: boolean; body: boolean; meshNames: readonly string[] }[];
}

/**
 * Everything a look is worked out of, read off the figure at once: its sliders and where each stood bare (`rest`), every
 * colour held, the pack's own values, a shared colour's resting value, the parts on it, each worn id's item (its noted
 * folder's), whether a private key follows the body's colour (the customizer's link by name), and every private variable
 * the recipes of some meshes read.
 */
export function figureStateOf(c: StateFigure, rest: Readonly<Record<string, number>>, items: Pick<DresserItems, 'itemOf' | 'own'>): FigureState {
  const cz = c.customizer ?? null;
  const vars = cz?.variables() ?? [];
  const sharedRest = new Map<string, number>();
  for (const v of vars) if (!v.private && !sharedRest.has(bareVariable(v.name))) sharedRest.set(bareVariable(v.name), v.default);
  return {
    species: c.manifest.id,
    morphs: c.morphValues(),
    rest,
    values: c.variableValues(),
    packValues: c.manifest.values ?? {},
    restOf: (bare) => sharedRest.get(bare),
    parts: c.status(),
    itemOf: (id) => items.itemOf(id),
    wardrobe: items.own,
    follows: (k) => !!cz?.isLinked(k),
    defsOf: (meshes) => vars.filter((v) => v.private && meshes.includes(v.mesh)),
  };
}

/**
 * A figure dressed: where every slider stood on the bare body is read first (what a moved slider is told from, so a look
 * started from an entry with sliders of its own keeps them), then the look put on (`dress`), or with none every colour of
 * the bare body drawn. Answers the rest and the pieces that would not go on.
 */
export async function dressFigure<C extends { morphValues(): Record<string, number>; readonly customizer?: { settled(): Promise<void> } | null }>(
  c: C,
  look: unknown,
  dress: (c: C) => Promise<string[]>,
): Promise<{ rest: Record<string, number>; missing: string[] }> {
  const rest = c.morphValues();
  if (!look) {
    await c.customizer?.settled();
    return { rest, missing: [] };
  }
  return { rest, missing: await dress(c) };
}

/** What Save is asked to write: whether as a new look, the look opened (its id, its from), its words and what the figure wears. */
export interface SaveAsk {
  asNew: boolean;
  record: { id: string | null; from: string | null; name: string; note: string };
  look: FigureLook;
  /** The ids the looks file holds now. */
  taken: ReadonlySet<string>;
  /** The dressed entry a look of a species takes its numbers from where the record names none (`fromFor`). */
  fromOf: (species: string) => string | null;
  /** The species' own rules the row is cleaned by (`lookRules`): a piece it may not wear refuses the save in words. */
  rules: LookRules;
}

/**
 * What a Save writes, or why it writes nothing: over the look it was opened from while that is still in the file, else (or
 * `asNew`) as a fresh id minted from its words; the row cleaned by the species' own rules first.
 */
export function saveLook(o: SaveAsk): { id: string; keep: boolean; from: string; row: Record<string, unknown> } | string {
  const from = o.record.from || o.fromOf(o.look.species);
  if (!from) return `no dressed entry of ${o.look.species.replace(/_/g, ' ')} to take its size, moves and numbers from`;
  const keep = !o.asNew && o.record.id !== null && o.taken.has(o.record.id);
  const id = keep ? o.record.id! : mintLookId(o.record.name || o.look.species, o.taken);
  const row = lookRow(id, from, o.look, o.record.name, o.record.note);
  const clean = readLookRow({ ...row }, [], o.rules);
  if (typeof clean === 'string') return `not saved: ${clean}`;
  return { id, keep, from, row };
}

/** A dressed catalogue entry as the dresser reads one: its id, species, look and whether it is one of the owner's own looks. */
export interface DresserEntry {
  id: string;
  kind: string;
  species: string | null;
  ready?: boolean;
  morphs?: Record<string, number>;
  custom?: Record<string, number>;
  outfit?: { part: string; item: string; wardrobe: string; values: Record<string, number> }[];
  own?: { look: string; from: string };
}

/**
 * A look started from a catalogue entry ("Start from"): the entry's species, sliders, colours and outfit copied, and the
 * entry itself as `from` (or, for one of the owner's own looks, the entry that look took its numbers from). Null for an
 * entry that is no dressed person.
 */
export function recordFromEntry(e: DresserEntry): (FigureLook & { from: string }) | null {
  if (e.kind !== 'dressed' || !e.species) return null;
  return {
    from: e.own?.from ?? e.id,
    species: e.species,
    morphs: { ...(e.morphs ?? {}) },
    custom: { ...(e.custom ?? {}) },
    outfit: (e.outfit ?? []).map((p) => ({ part: p.part, item: p.item, wardrobe: p.wardrobe, values: { ...p.values } })),
  };
}

/**
 * The dressed entry a look of `species` takes its size, move, stats, animation pack and flags from: the one it has while that
 * is a dressed person of the same species (the animation pack is the species' gender's), else the first ready dressed entry
 * of the species in the catalogue's own order, never one of the owner's own looks; else the one it has; else null.
 */
export function fromFor(species: string, current: string | null, entries: readonly DresserEntry[]): string | null {
  const byId = current ? entries.find((e) => e.id === current) : undefined;
  if (byId && byId.kind === 'dressed' && byId.species === species && !byId.own) return byId.id;
  const first = entries.find((e) => e.kind === 'dressed' && e.species === species && e.ready !== false && !e.own);
  return first?.id ?? current ?? null;
}

/** A look as the row the dresser saves: its id, what the figure wears, and its own words. */
export function lookRow(id: string, from: string, look: FigureLook, name: string, note: string): Record<string, unknown> {
  const row: Record<string, unknown> = { id, from, species: look.species, morphs: look.morphs, custom: look.custom, outfit: look.outfit };
  if (name.trim()) row.name = name.trim();
  if (note.trim()) row.note = note.trim();
  return row;
}

/** Two looks that dress a body the same (the dresser's "unsaved" word): the same body, sliders, colours and pieces. */
export function sameLook(a: FigureLook & { from: string }, b: FigureLook & { from: string }): boolean {
  const sorted = (r: Record<string, number>) => JSON.stringify(Object.entries(r).sort((x, y) => (x[0] < y[0] ? -1 : 1)));
  if (a.from !== b.from || a.species !== b.species || sorted(a.morphs) !== sorted(b.morphs) || sorted(a.custom) !== sorted(b.custom) || a.outfit.length !== b.outfit.length) return false;
  for (let i = 0; i < a.outfit.length; i++) {
    const x = a.outfit[i];
    const y = b.outfit[i];
    if (x.part !== y.part || x.item !== y.item || x.wardrobe !== y.wardrobe || sorted(x.values) !== sorted(y.values)) return false;
  }
  return true;
}

/** Who wears each look of the owner's own: a placed person's row of this world, and a story cast member, by the body each names. */
export function wearersOf(look: string, people: readonly { id: string; body: string; name?: string }[], cast: readonly { id: string; body: string }[]): string[] {
  const body = ownBodyOf(look);
  return [...people.filter((p) => p.body === body).map((p) => `${p.name || p.id} (placed here)`), ...cast.filter((c) => c.body === body).map((c) => `${c.id} (the story's cast)`)];
}
