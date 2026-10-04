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

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStorySet } from '../../server/storySet.mjs';
import { loadSet } from '../../src/story/set.ts';
import { checkSet, issueLine } from '../../src/story/check.ts';
import { PLANETS, packIdOf } from '../../src/data/planets.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every world a place may name: each planet, each zone of one, and each space zone. */
export function worldIds() {
  const out = new Set();
  for (const p of PLANETS) {
    out.add(p.id);
    for (const z of p.zones ?? []) out.add(packIdOf(p, z.id));
  }
  return [...out];
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
export function checkFolder(dir, { worlds = worldIds(), catalogue = catalogueOf(), clips = clipsOf(), print = console.log, root = ROOT, test = resolve(dir) === resolve(join(root, 'src', 'story', 'testSet')) } = {}) {
  const shown = (relative(root, dir) || dir).split(sep).join('/');
  const { files, refused } = readStorySet(dir);
  const load = loadSet(files, { test: test === true });
  const r = checkSet(load, { worlds, catalogue, clips });
  for (const why of refused) print(`${shown}: error: ${why}`);
  for (const i of r.errors) print(issueLine(i, shown));
  for (const i of r.warnings) print(issueLine(i, shown));
  const c = r.counts;
  const errors = r.errors.length + refused.length;
  print(
    `${shown}: ${load.set.prefix ? `the ${load.set.prefix} set` : 'no set'} (${load.hash.slice(0, 12)}): ${many(c.quests, 'quest')}, ${many(c.steps, 'step')}, ${many(c.areas, 'area')}, ${many(c.objects, 'object')}, ${many(c.talks, 'conversation')} (${many(c.nodes, 'node')}), ${many(c.cast, 'cast member')}, ${many(c.signals, 'signal')} waited on; ` +
      `${many(errors, 'error')}, ${many(r.warnings.length, 'warning')}` +
      `${c.unresolved ? `, ${many(c.unresolved, 'unresolved escape')}` : ''}${c.later ? `, ${many(c.later, 'thing')} a later wave reads` : ''}${catalogue ? '' : ' (no creature catalogue on this machine, so kill targets went unchecked)'}`,
  );
  return errors;
}

const main = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (main) {
  // `--root=<dir>` reads another checkout's folders in place of this one's (the node test uses it).
  const rootArg = process.argv.slice(2).find((a) => a.startsWith('--root='));
  const root = rootArg ? resolve(rootArg.slice(7)) : ROOT;
  const named = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const dirs = named.length ? named.map((d) => resolve(d)) : defaultFolders(root);
  if (!named.length && !existsSync(join(root, 'story-private'))) console.log('story-private/ is not there yet, so only the test set is checked (make the folder beside the checkout to write your own).');
  let errors = 0;
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      console.log(`${dir}: no such folder`);
      errors++;
      continue;
    }
    errors += checkFolder(dir, { root, catalogue: catalogueOf(root), clips: clipsOf(root) });
  }
  process.exitCode = errors ? 1 : 0;
}
