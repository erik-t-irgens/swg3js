// Other worlds' ground families lent to a world (Map-maker II's third wave, DESIGN.md §2.5 "Families of other worlds" and
// §6): a palette entry naming another pack's family, or a pack the paint file's world row names in `packs`.
//
// **Not "just an id".** A family's id means a family only in its own world's group, and its pictures are in its own pack,
// so a lent family is copied into this world's group under a fresh id (`ShaderGroup.lend`, on both threads, in the
// palette's order) and its children's pictures are assembled into this world's one ground array beside its own
// (`TerrainTextures.load`'s `lent`), all at the arrival behind the loading screen; one added in play is lent behind the
// editor's short curtain. A family is always its pack and its name: twenty of the fifty-three names two worlds share draw
// different pictures.
//
// What a lent world is read for, and nothing more: its terrain's family table (`terrain.trn`, parsed for its group) and its
// ground pictures' list (`terrain/shaders.json`), never its manifest, its layout or its bitmaps; read once a session, by
// the pack files' rules (`packFiles.ts`), and never for a pack no ground world gives (`groundPacksOf`).
//
// **Laid only while drawn**: a family lent whose pictures never reached the arrays (a picture that did not decode, a load
// that failed and left the arrays of before) would draw some other family's layer in its cells, so it is taken out of the
// lending after every load (`undrawnLent`) and lays nothing, said; the world's own family shows there.
//
// The world's decisions about lending are functions here (`lentAnswer`, `familyOfKey`, `arrivalAsks`, `baseFamilyId`,
// `packOfFamily`), which `foreignFamilies.test.ts` runs and whose every call site in the game it pins whole.
//
// **Only on the ground's tile program**: on the program of before a family id past its count is a new program, so a world
// drawn that way lends nothing, and its painted cells of another world's families show the world's own.
//
// **What it fits**: the arrays hold at most `GROUND_LAYERS_MOST` layers (a tile names a layer by a byte); this world's own
// come first, then the lent in order -- the palette's first, then the world row's packs whole, and one added in play after
// them all -- and a family that would not fit is left out whole and said.
//
// Pure but for `loadLentTable`'s fetch, which a test hands its own. Rule for this file (node runs it with type stripping):
// every import with its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import { PLANETS, type PlanetDef } from '../data/planets.ts';
import { parseTerrainTemplate } from '../swg/terrain/trn.ts';
import { lentFamilyKey, type ShaderFamily, type ShaderGroup } from '../swg/terrain/generator.ts';
import type { PaintPaletteEntry } from '../swg/terrain/groundPaint.ts';
import { GROUND_LAYERS_MOST, tileEntries, type LentPictures, type ShaderFamilyDef, type ShadersFile } from './terrainTextures.ts';

/** A lent world's ground, as much as lending reads: its family table and its ground pictures' list, and where its files are. */
export interface LentTable {
  pack: string;
  /** Its families as its own terrain's group holds them (its own ids). */
  group: ShaderGroup;
  /** Its ground pictures as its `terrain/shaders.json` lists them, in that order, by the family's name in lower case. */
  defs: Map<string, ShaderFamilyDef>;
  /** Its files' address, from the site's root. */
  base: string;
}

/**
 * Every pack a world's ground could lend from, in the planet list's order: each ground world's own pack, or each of its
 * zones' (Kashyyyk's); never a space zone, the world of copies (its ground is the client's empty punch-out), the gallery, or
 * a world that declares no pack (the real-elevation worlds lend from a converted pack, and have none to lend). Whether a
 * pack is installed is its `terrain/shaders.json`'s to say.
 */
export function groundPacksOf(planets: readonly PlanetDef[] = PLANETS): string[] {
  const out: string[] = [];
  for (const p of planets) {
    if (p.space || p.instances || p.pack === false || p.dem || p.id === 'gallery') continue;
    for (const id of p.zones?.length ? p.zones.map((z) => z.pack) : [p.id]) if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Whether a pack's `terrain/shaders.json` is the tile program's: terrain shaders version 4, its three masks, children. */
export function shadersTiled(file: ShadersFile | null | undefined): boolean {
  const b = file?.blend;
  return !!file && (file.version ?? 0) >= 4 && !!b?.quarter && !!b.half && !!b.threequarter && Array.isArray(file.families) && file.families.some((f) => f.children?.length);
}

/**
 * A lent world's table from its two files (its terrain's bytes and its `terrain/shaders.json` read), or why it lends
 * nothing, in words.
 */
export function readLentTable(pack: string, base: string, trn: Uint8Array | null, shaders: unknown): LentTable | string {
  const file = shaders as ShadersFile | null;
  if (!file || typeof file !== 'object' || !Array.isArray(file.families)) return `${pack} has no ground pictures (no terrain/shaders.json: is it converted?)`;
  if (!shadersTiled(file)) return `${pack}'s ground pictures are from before terrain shaders version 4 (convert its terrain again)`;
  if (!trn) return `${pack} carries no terrain`;
  let group: ShaderGroup;
  try {
    group = parseTerrainTemplate(trn).generator.shaderGroup;
  } catch (err) {
    return `${pack}'s terrain does not read (${err instanceof Error ? err.message : String(err)})`;
  }
  const defs = new Map<string, ShaderFamilyDef>();
  for (const f of file.families) if (f && typeof f.name === 'string' && !defs.has(f.name.toLowerCase())) defs.set(f.name.toLowerCase(), f);
  return { pack, group, defs, base };
}

/**
 * What `loadLentTable` asks of the site, by a pack and one of its files: a JSON file read, or a file's bytes, or null where
 * it gave none; and whether a file that gave none is known not to be there for the session (a 404, which is kept) rather
 * than a moment's failure (asked again). The game's reads go through `packFiles.ts` (`packJson`, `packBytes`,
 * `knownAbsent`), so every ask is in `__debug.files()` and a pack no world gives is never asked; a test hands its own.
 */
export interface LentFetch {
  json(pack: string, file: string): Promise<unknown | null>;
  bytes(pack: string, file: string): Promise<Uint8Array | null>;
  absent(pack: string, file: string): boolean;
}

/** Where a pack's files are, from the site's root: what a lent family's pictures are read from (`LentTable.base`). */
export function lentPackDir(base: string, pack: string): string {
  return `${base}assets-private/${pack}/`;
}

/** Why a pack no ground world gives lends nothing (a space zone, the copies, the gallery, a real-elevation world, or none). */
export function notGroundPack(pack: string): string {
  return `${pack} is not a ground world's pack (a space zone, the copies, the gallery, a real-elevation world or no world at all): it has no ground to lend`;
}

/** The tables read this session, by the site's base and the pack: read once, a lent pack's families never change. */
const tables = new Map<string, Promise<LentTable | string>>();

/**
 * A lent world's table, read once a session (`readLentTable` over its two files). A pack no ground world gives
 * (`groundPacksOf`) is asked for nothing and answered in words. An answer that is the pack's own word (not converted,
 * nothing to lend: a file that answered 404) is kept; one that failed (a page, no answer at all) is asked again next time.
 */
export function loadLentTable(pack: string, base: string, fetcher: LentFetch, ground: readonly string[] = groundPacksOf()): Promise<LentTable | string> {
  if (!ground.includes(pack)) return Promise.resolve(notGroundPack(pack));
  const key = `${base}|${pack}`;
  let p = tables.get(key);
  if (p) return p;
  const dir = lentPackDir(base, pack);
  const own = (async (): Promise<LentTable | string> => {
    const shaders = await fetcher.json(pack, 'terrain/shaders.json');
    if (shaders === null) {
      if (fetcher.absent(pack, 'terrain/shaders.json')) return `${pack} is not installed (no ground pictures)`;
      tables.delete(key);
      return `${pack}'s ground pictures did not load`;
    }
    const trn = await fetcher.bytes(pack, 'terrain.trn');
    if (!trn && !fetcher.absent(pack, 'terrain.trn')) tables.delete(key);
    return readLentTable(pack, dir, trn, shaders);
  })();
  p = own;
  tables.set(key, own);
  return own;
}

/** The session's tables let go (a test's). */
export function forgetLentTables(): void {
  tables.clear();
}

/**
 * What one arrival asks to lend (`World.prepareLending`): the palette's entries, and (a real-elevation world) the world
 * row's base family where its pack is not the one borrowed (a ruled world whose rules borrow one pack and whose base names
 * another), as one more entry after them, never twice; the packs to read (`lentPacksOf`); and the world row's packs, lent
 * whole. With no base of another pack the palette's own list, by identity: an arrival naming none is the second wave's.
 */
export function arrivalAsks(entries: readonly PaintPaletteEntry[], rowPacks: readonly string[] | undefined, base: { pack: string; name: string } | null | undefined, own: string): { asks: readonly PaintPaletteEntry[]; read: string[]; whole: readonly string[] } {
  const named = !!base && base.pack !== own && !entries.some((e) => e.pack === base.pack && e.name.toLowerCase() === base.name.toLowerCase());
  const asks = named ? [...entries, { pack: base!.pack, name: base!.name }] : entries;
  return { asks, read: lentPacksOf(asks, rowPacks, own), whole: rowPacks ?? [] };
}

/**
 * The packs a world lends from, in order: each pack the palette names that is not the world's own, in the palette's order,
 * then each pack the world row's `packs` names; never the world's own, never one twice. (A pack no ground world gives is
 * read as words by `loadLentTable`, never fetched.)
 */
export function lentPacksOf(entries: readonly PaintPaletteEntry[], packs: readonly string[] | undefined, own: string): string[] {
  const out: string[] = [];
  const add = (p: string): void => {
    if (p && p !== own && !out.includes(p)) out.push(p);
  };
  for (const e of entries) add(e.pack);
  for (const p of packs ?? []) add(p);
  return out;
}

/** One family lent: its pack, its name as its pack's group has it, the family, and its pictures' entry in its pack's list. */
export interface LendFamily {
  pack: string;
  name: string;
  family: ShaderFamily;
  def: ShaderFamilyDef;
  /** How many layers of the arrays its pictures take. */
  layers: number;
}

/** What a world lends: the families, in order, and each family it was asked for and lends not, by key, in words. */
export interface LendPlan {
  families: LendFamily[];
  why: Map<string, string>;
  /** This world's own layers, and the arrays' with the lent. */
  own: number;
  layers: number;
}

/**
 * Which families of other worlds a world lends at its arrival, and why not where it does not: the palette's entries of
 * other packs first (in the palette's order), then every family of each pack the world row names (in that pack's own
 * list's order), each family once. A family lends when its pack's table was read, its group holds a family of that name,
 * its pack has pictures for it, and its layers fit beside this world's own and those lent before it
 * (`GROUND_LAYERS_MOST`); otherwise its key (`lentFamilyKey`) is named with why. One lent in play is `appendLending`'s.
 */
export function planLending(ownDefs: readonly ShaderFamilyDef[], entries: readonly PaintPaletteEntry[], packs: readonly string[] | undefined, own: string, tables: ReadonlyMap<string, LentTable | string>, firstOnly: boolean, most = GROUND_LAYERS_MOST): LendPlan {
  const ownLayers = tileEntries(ownDefs.filter((f) => f.children?.length), firstOnly).length;
  let used = ownLayers;
  const families: LendFamily[] = [];
  const why = new Map<string, string>();
  const seen = new Set<string>();
  const ask = (pack: string, name: string, quiet: boolean): void => {
    const key = lentFamilyKey(pack, name);
    if (seen.has(key)) return;
    seen.add(key);
    const t = tables.get(pack);
    if (t === undefined) {
      why.set(key, `${pack} was not read`);
      return;
    }
    if (typeof t === 'string') {
      why.set(key, t);
      return;
    }
    const family = t.group.byName(name);
    if (!family) {
      why.set(key, `${pack} has no family of that name`);
      return;
    }
    const def = t.defs.get(family.name.toLowerCase());
    const n = def ? tileEntries([def], firstOnly).length : 0;
    if (!def || n === 0) {
      if (!quiet) why.set(key, `${pack} has no ground pictures for it`);
      return;
    }
    if (used + n > most) {
      why.set(key, `the ground's ${most} picture layers are full (this world's own take ${ownLayers}): lend fewer packs`);
      return;
    }
    used += n;
    families.push({ pack, name: family.name, family, def, layers: n });
  };
  for (const e of entries) if (e.pack !== own) ask(e.pack, e.name, false);
  for (const p of packs ?? []) {
    if (p === own) continue;
    const t = tables.get(p);
    if (!t || typeof t === 'string') continue;
    // The pack's every family in its own list's order; one with no pictures (a family only a building's layer names) is
    // passed over quietly, since nobody asked for it by name.
    for (const def of t.defs.values()) ask(p, def.name, true);
  }
  return { families, why, own: ownLayers, layers: used };
}

/**
 * A plan's families as `TerrainTextures.load` takes them (`LentPictures`): in the order their ids were lent (`idOf`, the
 * id this world's group lent each under), one run a pack, a family the group has not lent left out. By the ids and never
 * by the plan: a family lent in play takes the next id, so the arrays made again for it keep every layer of before where it
 * was and the chunks standing need not be built again.
 */
export function lentPicturesOf(plan: LendPlan, tablesBy: ReadonlyMap<string, LentTable | string>, idOf: (pack: string, name: string) => number): LentPictures[] {
  const out: LentPictures[] = [];
  const lent = plan.families.map((f) => ({ f, id: idOf(f.pack, f.name) })).filter((x) => x.id > 0).sort((a, b) => a.id - b.id);
  for (const { f, id } of lent) {
    let last = out[out.length - 1];
    if (!last || last.pack !== f.pack) {
      const t = tablesBy.get(f.pack);
      const base = t && typeof t !== 'string' ? t.base : '';
      last = { pack: f.pack, url: (file: string) => base + file, families: [] };
      out.push(last);
    }
    (last.families as { id: number; def: ShaderFamilyDef }[]).push({ id, def: f.def });
  }
  return out;
}

/**
 * One family lent in play (the editor's, behind its curtain) added to a plan as it stands, after every family already in
 * it, or why not, in words: nothing already lent moves and nothing is left out, so the arrays made again keep every layer
 * of before where it was. Answers null once added (or already there).
 */
export function appendLending(plan: LendPlan, table: LentTable | string, pack: string, name: string, firstOnly: boolean, most = GROUND_LAYERS_MOST): string | null {
  if (typeof table === 'string') return table;
  const key = lentFamilyKey(pack, name);
  if (plan.families.some((f) => lentFamilyKey(f.pack, f.name) === key)) return null;
  const family = table.group.byName(name);
  if (!family) return `${pack} has no family of that name`;
  const def = table.defs.get(family.name.toLowerCase());
  const n = def ? tileEntries([def], firstOnly).length : 0;
  if (!def || n === 0) return `${pack} has no ground pictures for it`;
  if (plan.layers + n > most) return `the ground's ${most} picture layers are full (${plan.layers} taken): lend fewer packs`;
  plan.layers += n;
  plan.families.push({ pack, name: family.name, family, def, layers: n });
  plan.why.delete(key);
  return null;
}

/** Every family of a plan lent into a group (in the plan's order), and answers how many were lent for the first time. */
export function lendInto(group: ShaderGroup, plan: LendPlan): number {
  let fresh = 0;
  for (const f of plan.families) {
    if (group.lentId(f.pack, f.name) > 0) continue;
    group.lend(f.pack, f.family);
    fresh++;
  }
  return fresh;
}

// ---------------------------------------------------------------- the decisions the world makes, pure so a test runs them

/** What a world lends now, as the decisions below read it (`World.lending`): its plan, and why it lends none at all. */
export interface LendingState {
  plan: LendPlan;
  off: string | null;
}

/** What a palette entry of another world lays when nothing was lent for it at this arrival and nothing said why. */
export const NOT_LENT_YET = 'not lent at this arrival: drawn from the next one (the editor lends it at once)';

/**
 * Why a family lent this visit lays nothing after all: its pictures never reached the ground's arrays (a picture that did
 * not decode, a load that failed), so a cell painted with it would draw some other family's layer. Its cells show the
 * world's own; it lends again at the next arrival (lent again in play, its layers would stand before those of every family
 * lent after it and move theirs under the chunks standing).
 */
export const PICTURES_NOT_LOADED = "its pictures did not load into the ground's arrays: its cells show the world's own family, and it is lent again at the next arrival";

/**
 * What a palette entry of another world lays (the lending's hook, `GroundPaint.resolve`'s `lend`): the id the family was
 * lent under, or why not, in words: the world lends nothing at all (`off`), the family was asked for and not lent, or was
 * lent and its pictures never reached the arrays (`why`), or nothing named it at this arrival (`NOT_LENT_YET`). `lentId` is
 * the group's (`ShaderGroup.lentId`), `key` the family's (`lentFamilyKey`).
 */
export function lentAnswer(state: LendingState | null, lentId: number, key: string): number | string {
  if (state?.off) return state.off;
  const no = state?.plan.why.get(key);
  if (no !== undefined) return no;
  return lentId > 0 ? lentId : NOT_LENT_YET;
}

/**
 * The plan's families whose pictures never reached the arrays (`drawn` false for the id each was lent under), taken out of
 * the plan with their layers and given `PICTURES_NOT_LOADED` as why, so the lending's answer lays nothing for them; their
 * keys, in the plan's order. A family the group never lent (no id) is left as it stands.
 */
export function undrawnLent(plan: LendPlan, idOf: (pack: string, name: string) => number, drawn: (id: number) => boolean): string[] {
  const lost: string[] = [];
  plan.families = plan.families.filter((f) => {
    const id = idOf(f.pack, f.name);
    if (id <= 0 || drawn(id)) return true;
    const key = lentFamilyKey(f.pack, f.name);
    plan.why.set(key, PICTURES_NOT_LOADED);
    plan.layers -= f.layers;
    lost.push(key);
    return false;
  });
  return lost;
}

/**
 * The family a world row's weights key names (`<pack>:<name>`): this world's own by its name, another world's by the id it
 * was lent under (none where it was not lent).
 */
export function familyOfKey(group: ShaderGroup, own: string, key: string): ShaderFamily | undefined {
  const colon = key.indexOf(':');
  const pack = key.slice(0, colon);
  const name = key.slice(colon + 1);
  return pack === own ? group.byName(name) : group.families.get(group.lentId(pack, name));
}

/**
 * A real-elevation world's base family's id (the world row's `base`, `DemShader.baseId`): the borrowed pack's own family of
 * that name; another pack's lent at the arrival (`arrivalAsks`) by the id it was lent under and only while it lays (its
 * pictures in the arrays); -1 for none, the rules' own fallback then drawing.
 */
export function baseFamilyId(base: { pack: string; name: string } | null | undefined, borrowed: string | null | undefined, group: ShaderGroup | null | undefined, state: LendingState | null): number {
  if (!base || !group) return -1;
  if (base.pack === borrowed) return group.byName(base.name)?.id ?? -1;
  const a = lentAnswer(state, group.lentId(base.pack, base.name), lentFamilyKey(base.pack, base.name));
  return typeof a === 'number' ? a : -1;
}

/** The pack a family of a world's group is from: the world's own, or the pack another world lent it from. */
export function packOfFamily(group: ShaderGroup | null | undefined, id: number, own: string): string {
  return group?.lent.get(id)?.pack ?? own;
}
