// What the permanent placements a build ships ask of the converted packs, for `status`: the rows in
// `public/placements/story/<world>.json` and `public/placements/world/<world>.json` (`src/story/placements.ts`)
// stand things out of the props pack, the gallery or a world's own pack, and a machine without that pack skips
// those rows (`noPack`) while everything else plays. So `status` says, one line per world and pack, which pack
// the rows need that this install has not got, and which of their things a pack it has does not hold, with the
// command that makes the pack.
//
// **Information only.** None of it is a reason to convert anything again: a row is somebody's file, not a
// conversion's product, and a pack already converted is whatever the archives gave. It is never put on the
// to-do list, so a launcher never runs a step for it.
//
// The rows are this checkout's own `public/placements/`, or, in a release (which carries the built game and no
// `public/`), the copy the build made of them in `dist/placements/`. Which of the two an install is, is whether
// it has a `public/` at all, never whether the placements folder is in it: a checkout's `dist/` is the last
// build's, and holds rows the editor has since taken out of `public/` (it takes the folder away with its last
// row). A folder that is not there is no rows, which today is every install: nothing is committed there until
// the owner places something.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { placementFileOf, readPlacementsFile } from '../../src/story/placements.ts';
import { SANDBOX_ZONE } from './sandbox.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Whether a folder is there. */
function isFolder(dir) {
  try {
    readdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * The folder holding `story/` and `world/`, or null for none: in a checkout (it has a `public/`) its own
 * `public/placements` and nothing else, in a release the build's copy in `dist/placements`.
 */
export function placementsFolder(root = ROOT) {
  const dir = isFolder(join(root, 'public')) ? join(root, 'public', 'placements') : join(root, 'dist', 'placements');
  return isFolder(dir) ? dir : null;
}

/**
 * The command that makes a world's own pack, with the folder it writes: a ground world's snapshot into
 * `<dir>/<world>` (the snapshot of one world writes into the folder it is given, as the rest of status names it),
 * a space zone's `space` command into `<dir>` (which writes `<dir>/<zone>` itself), and the made-up system's own
 * `sandbox` command.
 */
export function worldPackCommand(world, dir) {
  if (world === SANDBOX_ZONE) return `sandbox <swg-dir> ${dir} --retail-only`;
  if (world.startsWith('space_')) return `space <swg-dir> ${world} ${dir} --retail-only`;
  return `snapshot <swg-dir> ${world} ${join(dir, world)} --center=auto --radius=all --retail-only`;
}

/** Every row of both layers in a placements folder, read as the game reads them, with the world each is on. */
export function placementRows(dir) {
  const out = [];
  if (!dir) return out;
  for (const layer of ['story', 'world']) {
    let names = [];
    try {
      names = readdirSync(join(dir, layer)).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const word = placementFileOf(`${layer}/${name}`);
      if (!word) continue;
      let text;
      try {
        text = readFileSync(join(dir, layer, name), 'utf8');
      } catch {
        continue;
      }
      const read = readPlacementsFile(text, word.world, word.world.startsWith('space_') ? 'space' : 'ground');
      for (const row of read.rows) out.push({ world: word.world, layer, row });
    }
  }
  return out;
}

/**
 * The lines `status` prints for the rows (`rows`, as `placementRows` gives them) against the packs under `dir`:
 * one summary, then one line per world and pack a row needs that is missing, or whose things that pack does
 * not hold. `readJson` is the caller's own reader (a file that will not parse is taken as missing there).
 */
export function placementPackLines(rows, dir, readJson) {
  if (!rows.length) return ['  placements: none in this build (nothing stands for good beyond what the worlds place)'];
  const worlds = [...new Set(rows.map((r) => r.world))].sort();
  const lines = [`  placements: ${rows.length} permanent row${rows.length === 1 ? '' : 's'} over ${worlds.length} world${worlds.length === 1 ? '' : 's'} in this build's files`];
  const props = readJson(join(dir, 'props', 'manifest.json'));
  const things = props ? new Set((props.props ?? []).map((p) => p.id)) : null;
  // A pack's models are every category's, as the game looks a row's model up (`AssetPack.find` walks them all).
  const modelsIn = (m) => (m ? new Set(Object.values(m.categories ?? {}).flat().map((d) => d?.id).filter((id) => typeof id === 'string')) : null);
  const galleryModels = modelsIn(readJson(join(dir, 'gallery', 'manifest.json')));
  const worldModels = new Map();
  const modelsOf = (world) => {
    if (!worldModels.has(world)) worldModels.set(world, modelsIn(readJson(join(dir, world, 'manifest.json'))));
    return worldModels.get(world);
  };
  const some = (ids) => `${ids.slice(0, 3).join(', ')}${ids.length > 3 ? `, and ${ids.length - 3} more` : ''}`;
  for (const world of worlds) {
    const here = rows.filter((r) => r.world === world).map((r) => r.row);
    const want = (pack, has, ids, command) => {
      const rowsOf = here.filter((r) => r.pack === pack);
      if (!rowsOf.length) return;
      const n = `${rowsOf.length} row${rowsOf.length === 1 ? '' : 's'}`;
      if (!has) {
        lines.push(`  placements: the permanent placements on ${world} need the ${pack === 'world' ? `${world} pack` : `${pack} pack`} for ${n}, which this install has not got (npm run swg -- ${command}); they are skipped until it has`);
        return;
      }
      const lost = [...new Set(rowsOf.map((r) => r.thing ?? r.model).filter((id) => id && !ids.has(id)))];
      if (lost.length) lines.push(`  placements: the ${pack === 'world' ? `${world} pack` : `${pack} pack`} here has not got ${lost.length} of what the permanent placements on ${world} stand (${some(lost)}); those rows are skipped, which converting again does not change unless the archives hold them`);
    };
    want('props', !!things, things, `props <swg-dir> ${dir} --retail-only`);
    want('gallery', !!galleryModels, galleryModels, `gallery <swg-dir> ${dir} --retail-only`);
    const own = modelsOf(world);
    want('world', !!own, own, worldPackCommand(world, dir));
  }
  return lines;
}
