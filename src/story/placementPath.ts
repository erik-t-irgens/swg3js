// Where the permanent placements' two files live under the build, and what a changed file there names.
//
// Its own file, with nothing imported, because the dev server's config reads it (`vite.config.ts`'s watcher)
// and every module a config reads restarts the dev server when it is edited: the rest of the placements'
// rules (`placements.ts`) can change without that. Pure; node runs it with type stripping for the tests.

/** The two files a world's permanent placements are kept in. */
export type PlacementLayer = 'story' | 'world';

/** The path a layer's file for a world is fetched from, under the build's own base (and under `public/` in a checkout). */
export function placementsPath(layer: PlacementLayer, world: string): string {
  return `placements/${layer}/${world}.json`;
}

/**
 * Which layer and world a changed file under `public/placements/` names, from its path below that folder
 * (`story/tatooine.json`), or null: anything not a `.json` directly in one of the two layer folders, and any
 * path with a segment that begins with a dot (a temporary file, a hidden folder), names nothing. What the dev
 * server's watcher says to the page.
 */
export function placementFileOf(rel: string): { layer: PlacementLayer; world: string } | null {
  const parts = rel.split(/[\\/]+/).filter((p) => p.length > 0);
  if (parts.length !== 2 || parts.some((p) => p.startsWith('.'))) return null;
  const [layer, file] = parts;
  if (layer !== 'story' && layer !== 'world') return null;
  if (!file.endsWith('.json')) return null;
  const world = file.slice(0, -'.json'.length);
  if (!/^[a-z0-9_]{1,40}$/.test(world)) return null;
  return { layer, world };
}
