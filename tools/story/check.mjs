// `npm run story:check [folder...]`: read a story set and say, before anybody plays it, everything the
// checker finds wrong with it (`src/story/check.ts`): every link exists, every awaited signal has
// something that raises it, no step can be reached and never finish, Trust moves only on choices marked
// as under pressure, and the rest of the design's fourteen rules. Each problem is printed as
// `file:line: error: ... (rule n)`, and the command fails when there is an error, so it can stand in
// front of anything that should not run on a broken set.
//
// With no folder named it checks the owner's own `story-private/` beside the checkout, when there is one,
// and then the committed test set (`src/story/testSet/`). Worlds are checked against the game's own list
// of planets, zones and space zones; kill targets and cast bodies against the creature catalogue in
// `assets-private/` when this machine has one, and a conversation's gesture clips against the player's own
// body's clip list there (warnings only: both are the converted packs', not the story's).
//
// A story object may name a permanent placement (`"template": "place/<id>"`), and those rows are read from
// **this checkout's own** `public/placements/story/*.json` and `public/placements/world/*.json`, the two
// files every build ships, whatever `--root` names: `--root` says where `story-private/` and
// `assets-private/` are (another checkout's, in the node test), while the placements a quest names are the
// ones the build it will be played in carries, which is this one's. `--placements=<dir>` names another folder
// holding `story/` and `world/` in their place (the node test's, and a smoke's). A folder that is not there
// is no placements at all, which checks nothing against them; an id both files hold on one world is an error
// once, and a row a file cannot read, a file refused whole and a row the game never stands (a world it has
// not got, the dungeons' world of copies, a building in a space zone) are each a warning naming it.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStorySet } from '../../server/storySet.mjs';
import { loadSet } from '../../src/story/set.ts';
import { checkPlacements, checkSet, issueLine } from '../../src/story/check.ts';
import { placementFileOf, readPlacementsFile } from '../../src/story/placements.ts';
import { PLANETS, packIdOf } from '../../src/data/planets.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** This checkout's own permanent placements: the folder that holds `story/` and `world/`. */
export const PLACEMENTS_DIR = join(ROOT, 'public', 'placements');

/**
 * Every world a place may name, by pack id, with what kind of world it is for the permanent placements: each
 * planet and each zone of one (`copies` for the dungeons' world of copies, `ground` otherwise) and each space
 * zone (`space`). The game's own rule (`App.worldKindOf`, which the editor's endpoint repeats): the permanent
 * layer stands nothing in the world of copies and no building in a space zone.
 */
export function worldKinds() {
  const out = new Map();
  for (const p of PLANETS) {
    const kind = p.instances ? 'copies' : p.space ? 'space' : 'ground';
    out.set(p.id, kind);
    for (const z of p.zones ?? []) out.set(packIdOf(p, z.id), kind);
  }
  return out;
}

/** Every world a place may name: each planet, each zone of one, and each space zone. */
export function worldIds() {
  return [...worldKinds().keys()];
}

/** The creature catalogue's ids, groups, social groups and tags, or null when this machine has none. */
export function catalogueOf(root = ROOT) {
  const file = join(root, 'assets-private', 'mobiles', 'catalogue.json');
  if (!existsSync(file)) return null;
  try {
    const c = JSON.parse(readFileSync(file, 'utf8'));
    const ids = new Set();
    const groups = new Set();
    const socials = new Set();
    const tags = new Set();
    for (const e of c.entries ?? []) {
      if (typeof e.id === 'string') ids.add(e.id);
      if (typeof e.group === 'string') groups.add(e.group);
      const social = e.stats?.core3?.socialGroup;
      if (typeof social === 'string') socials.add(social);
      for (const t of e.stats?.tags ?? []) if (typeof t === 'string') tags.add(t);
    }
    return { ids, groups, socials, tags };
  } catch {
    return null;
  }
}

/**
 * The clips the player's own body has (the human male rig's list, which every humanoid species shares), or
 * null when this machine has no species converted: a conversation's gesture clip is checked against it.
 */
export function clipsOf(root = ROOT) {
  const file = join(root, 'assets-private', 'characters', 'human_male', 'parts.json');
  if (!existsSync(file)) return null;
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(j.clips) ? new Set(j.clips.filter((c) => typeof c === 'string')) : null;
  } catch {
    return null;
  }
}

/**
 * What the converted packs say each permanent row stands, by the object template a story would name it by:
 * a props row's thing (the props catalogue's own template) and a building's deed (the building it makes, as a
 * snapshot spells it, `shared_` in front of its file). Empty without the packs: the warning it feeds is then
 * not given.
 */
export function placedTemplatesOf(root = ROOT) {
  const things = new Map();
  const deeds = new Map();
  try {
    const props = JSON.parse(readFileSync(join(root, 'assets-private', 'props', 'manifest.json'), 'utf8'));
    for (const p of props.props ?? []) if (typeof p.id === 'string' && typeof p.template === 'string') things.set(p.id, p.template);
  } catch {
    // No props pack on this machine.
  }
  try {
    const pack = JSON.parse(readFileSync(join(root, 'assets-private', 'deeds.json'), 'utf8'));
    for (const d of pack.deeds ?? []) if (typeof d.id === 'string' && typeof d.makes === 'string') deeds.set(d.id, d.makes.replace(/(^|\/)(?!shared_)([^/]+)$/, '$1shared_$2'));
  } catch {
    // No deeds on this machine.
  }
  return { things, deeds };
}

/**
 * The permanent placements in a folder holding `story/` and `world/` (this checkout's `public/placements/`
 * unless told otherwise), read exactly as the game reads them (`readPlacementsFile`), as the checker takes
 * them: by world, then by id, each id with every layer that holds it, and each row the game never stands
 * marked so with why (`never`: a world it has not got, the dungeons' world of copies, a building in a space
 * zone), so a story naming one is told that rather than that no row is there. `notes` are what the files
 * themselves said (a row skipped, a file refused whole, a file for a world that stands none of its rows, a
 * building in a space zone), as warnings to print. `standing` counts what the game stands (an id two layers
 * hold once) and `worlds` the worlds it stands anything on; a world all of whose rows were skipped holds none.
 * A folder that is not there is none, and says nothing.
 */
export function placementsOf(dir = PLACEMENTS_DIR, { root = ROOT, kinds = worldKinds(), templates = placedTemplatesOf(root) } = {}) {
  const placements = new Map();
  const notes = [];
  let rows = 0;
  let neverRows = 0;
  let files = 0;
  const shownDir = (relative(ROOT, dir) && !relative(ROOT, dir).startsWith('..') ? relative(ROOT, dir) : dir).split(sep).join('/');
  for (const layer of ['story', 'world']) {
    const folder = join(dir, layer);
    let names = [];
    try {
      names = readdirSync(folder).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const word = placementFileOf(`${layer}/${name}`);
      if (!word) continue;
      const shown = `${shownDir}/${layer}/${name}`;
      let text;
      try {
        text = readFileSync(join(folder, name), 'utf8');
      } catch (err) {
        notes.push(`${shown}: warning: it cannot be read (${err.message})`);
        continue;
      }
      files++;
      const kind = kinds.get(word.world) ?? null;
      // Why no row of this file ever stands, whatever the row: the world itself.
      const worldNever = !kind ? `${word.world} is not a world this game has` : kind === 'copies' ? `${word.world} is the dungeons' world of copies, where no permanent row stands` : null;
      if (worldNever) notes.push(`${shown}: warning: ${worldNever}, so nothing stands its rows`);
      const read = readPlacementsFile(text, word.world, (kind ?? (word.world.startsWith('space_') ? 'space' : 'ground')) === 'space' ? 'space' : 'ground');
      if (read.problem) {
        notes.push(`${shown}: warning: the whole file is refused, so none of its rows stands: ${read.problem}`);
        continue;
      }
      const lines = text.split(/\r?\n/);
      const lineOf = (id) => {
        const at = lines.findIndex((l) => new RegExp(`"id"\\s*:\\s*"${id}"`).test(l));
        return at >= 0 ? at + 1 : 1;
      };
      for (const s of read.skipped) notes.push(`${shown}:${s.id.startsWith('#') ? 1 : lineOf(s.id)}: warning: row ${s.id} is skipped: ${s.why}`);
      for (const r of read.rows) {
        rows++;
        const template = r.pack === 'props' ? (templates.things.get(r.thing) ?? null) : r.deed ? (templates.deeds.get(r.deed) ?? null) : null;
        const never = worldNever ?? (kind === 'space' && r.kind === 'building' ? 'a space zone stands no building' : null);
        if (never) neverRows++;
        if (never && !worldNever) notes.push(`${shown}:${lineOf(r.id)}: warning: row ${r.id} is never stood: ${never}`);
        const ref = { at: [r.x, r.z], layer, file: shown, line: lineOf(r.id), template, never };
        if (!placements.has(word.world)) placements.set(word.world, new Map());
        const ids = placements.get(word.world);
        if (!ids.has(r.id)) ids.set(r.id, []);
        ids.get(r.id).push(ref);
      }
    }
  }
  // What the game stands: one row an id (the world edit's where both layers hold it), on a world that stands it.
  let standing = 0;
  let worlds = 0;
  for (const ids of placements.values()) {
    let here = 0;
    for (const refs of ids.values()) if (!(refs.find((r) => r.layer === 'world') ?? refs[0]).never) here++;
    standing += here;
    if (here) worlds++;
  }
  return { placements, notes, rows, standing, never: neverRows, files, worlds, dir: shownDir };
}

/** `n thing` or `n things`. */
const many = (n, one, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;

/**
 * The folders checked when none is named: the owner's `story-private/` beside the checkout when there is
 * one, then the committed test set.
 */
export function defaultFolders(root = ROOT) {
  const own = join(root, 'story-private');
  return [...(existsSync(own) ? [own] : []), join(root, 'src', 'story', 'testSet')];
}

/**
 * Check one folder; answers how many errors it has. Only the committed test set is read as the test set,
 * whatever any folder's own `story.jsonc` says (`test` is that folder, or what the caller says).
 */
export function checkFolder(dir, { worlds = worldIds(), catalogue = catalogueOf(), clips = clipsOf(), placements = null, print = console.log, root = ROOT, test = resolve(dir) === resolve(join(root, 'src', 'story', 'testSet')) } = {}) {
  const shown = (relative(root, dir) || dir).split(sep).join('/');
  const { files, refused } = readStorySet(dir);
  const load = loadSet(files, { test: test === true });
  const r = checkSet(load, { worlds, catalogue, clips, placements });
  for (const why of refused) print(`${shown}: error: ${why}`);
  for (const i of r.errors) print(issueLine(i, shown));
  for (const i of r.warnings) print(issueLine(i, shown));
  const c = r.counts;
  const errors = r.errors.length + refused.length;
  print(
    `${shown}: ${load.set.prefix ? `the ${load.set.prefix} set` : 'no set'} (${load.hash.slice(0, 12)}): ${many(c.quests, 'quest')}, ${many(c.steps, 'step')}, ${many(c.areas, 'area')}, ${many(c.objects, 'object')}${c.placed ? ` (${c.placed} naming a permanent placement${placements ? '' : ', not checked: no placements were read'})` : ''}, ${many(c.talks, 'conversation')} (${many(c.nodes, 'node')}), ${many(c.cast, 'cast member')}, ${many(c.docs, 'document')}, ${many(c.signals, 'signal')} waited on; ` +
      `${many(errors, 'error')}, ${many(r.warnings.length, 'warning')}` +
      `${c.unresolved ? `, ${many(c.unresolved, 'unresolved escape')}` : ''}${c.later ? `, ${many(c.later, 'thing')} a later wave reads` : ''}${catalogue ? '' : ' (no creature catalogue on this machine, so kill targets went unchecked)'}`,
  );
  return errors;
}

const main = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (main) {
  // `--root=<dir>` reads another checkout's story-private and assets-private in place of this one's (the
  // node test uses it); `--placements=<dir>` another folder of permanent placements in place of this
  // checkout's own `public/placements/`, which `--root` never moves.
  const rootArg = process.argv.slice(2).find((a) => a.startsWith('--root='));
  const root = rootArg ? resolve(rootArg.slice(7)) : ROOT;
  const placeArg = process.argv.slice(2).find((a) => a.startsWith('--placements='));
  const named = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const dirs = named.length ? named.map((d) => resolve(d)) : defaultFolders(root);
  if (!named.length && !existsSync(join(root, 'story-private'))) console.log('story-private/ is not there yet, so only the test set is checked (make the folder beside the checkout to write your own).');
  let errors = 0;
  // The permanent placements a story object may name, read once for every folder: what the files say of
  // themselves and an id both hold are said here once, the second an error.
  const placed = placementsOf(placeArg ? resolve(placeArg.slice('--placements='.length)) : PLACEMENTS_DIR, { root });
  for (const line of placed.notes) console.log(line);
  for (const i of checkPlacements(placed.placements)) {
    console.log(issueLine(i));
    errors++;
  }
  console.log(
    placed.files
      ? `${placed.dir}: ${many(placed.standing, 'permanent placement')} the game stands over ${many(placed.worlds, 'world')}, in ${many(placed.files, 'file')}${placed.never ? ` (and ${many(placed.never, 'row')} it never stands)` : ''}`
      : `${placed.dir}: no permanent placements, so an object naming one names nothing`,
  );
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      console.log(`${dir}: no such folder`);
      errors++;
      continue;
    }
    errors += checkFolder(dir, { root, catalogue: catalogueOf(root), clips: clipsOf(root), placements: placed.placements });
  }
  process.exitCode = errors ? 1 : 0;
}
