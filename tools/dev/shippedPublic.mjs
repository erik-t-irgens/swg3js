// The public files a built game ships, as `virtual:shipped-public` hands them to the page (vite.config.ts): the tracked
// files of `public/tracks`, `public/placements` and `public/dem`, from git's own list of the checkout, which is what a
// release carries (tools/launcher/pack.mjs takes tracked public files and refuses any other). The page asks a world's
// tracks, its permanent placements and a real-elevation raster only when this list holds the file
// (`shippedAsk` in src/world/packFiles.ts), since a file the build does not carry can only be answered with a miss.
//
// It is made only for a build. The dev server hands the page no list at all, because a list is fixed in the page's
// loaded graph and the editors write these files while it runs: a list kept "current" there would either reload the
// whole page at the editor's first save of a world's file or tell the page not to fetch the file it had just written.
//
// A file git tracks that is gone from the working tree is not listed (the build has no copy of it), and a file that is
// on disk but not committed is not listed either: it would not reach a release, and the local build is the release's.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The folders under `public/` whose files are asked for by name, and so need a list. */
export const SHIPPED_DIRS = ['tracks', 'placements', 'dem'];

/** Every file under a folder, as paths relative to `under` with forward slashes. */
function walk(dir, prefix) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = `${prefix}/${name}`;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

/**
 * The list, as paths under `public/` (`tracks/tatooine.json`), sorted. From git's own list; where the folder is no git
 * checkout (a build from a copy of the source), every such file on disk, said once, since nothing else can say which
 * would ship.
 */
export function shippedPublic(root) {
  const r = spawnSync('git', ['ls-files', '-z', '--', ...SHIPPED_DIRS.map((d) => `public/${d}`)], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1048576 });
  if (r.status === 0) {
    return r.stdout
      .split('\0')
      .filter((p) => p.startsWith('public/') && existsSync(join(root, p)))
      .map((p) => p.slice('public/'.length))
      .sort();
  }
  console.warn(`shipped public files: ${root} is not a git checkout, so every tracks, placements and raster file on disk is listed (${(r.stderr || '').trim()})`);
  return SHIPPED_DIRS.flatMap((d) => walk(join(root, 'public', d), d)).sort();
}
