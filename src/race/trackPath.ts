// Where a world's track file lives under the build, and what a changed file there names.
//
// Its own file, with nothing imported, for the reason `src/story/placementPath.ts` is: the dev server's config reads
// it (its watcher and the GET it answers from the disk), and every module a config reads restarts the dev server when
// it is edited, while the rest of the tracks' rules (`trackFile.ts`) can change without that. Pure; node runs it with
// type stripping for the tests.

/**
 * The path a world's tracks are fetched from, under the build's own base (and under `public/` in a checkout). A world
 * is its pack id (`tatooine`, `kashyyyk_main`); a real-elevation world has no pack of its own, and its tracks are kept
 * under the planet's own id (`monument`), which is what the game's pack id for it is anyway.
 */
export function tracksPath(world: string): string {
  return `tracks/${world}.json`;
}

/**
 * Which world a changed file under `public/tracks/` names, from its path below that folder (`tatooine.json`), or
 * null: anything not a `.json` directly in the folder, and any path with a segment that begins with a dot (the
 * editor's temporary file, a hidden folder), names nothing. What the dev server's watcher says to the page.
 */
export function trackFileOf(rel: string): { world: string } | null {
  const parts = rel.split(/[\\/]+/).filter((p) => p.length > 0);
  if (parts.length !== 1 || parts[0].startsWith('.')) return null;
  const file = parts[0];
  if (!file.endsWith('.json')) return null;
  const world = file.slice(0, -'.json'.length);
  if (!/^[a-z0-9_]{1,40}$/.test(world)) return null;
  return { world };
}
