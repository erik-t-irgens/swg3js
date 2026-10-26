// Where the permanent placements' files live under the build, and what a changed file there names: the two layers of
// rows, and every other kind of file the world editor writes beside them (`editFileOf`).
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
  const f = editFileOf(rel);
  return f && (f.kind === 'story' || f.kind === 'world') ? { layer: f.kind, world: f.world } : null;
}

/**
 * Every kind of file the world editor writes under `public/placements/`: the two layers of rows, and from its fifth wave
 * the things taken away (`removed`) and the people placed (`people`). Map-maker II grows this list by a name a kind.
 */
export type EditFileKind = PlacementLayer | 'removed' | 'people';
export const EDIT_FILE_KINDS: readonly EditFileKind[] = ['story', 'world', 'removed', 'people'];

/**
 * Which kind of file and which world a path below `public/placements/` names (`world/tatooine.json`), or null: anything
 * not a `.json` directly in one of the kinds' folders, and any path with a segment that begins with a dot (a temporary
 * file, a hidden folder), names nothing. What the dev server's watcher and its answer for a file read; the two layers'
 * own `placementFileOf` is this one narrowed to them, so every reader of the rows reads exactly what it read.
 */
export function editFileOf(rel: string): { kind: EditFileKind; world: string } | null {
  const parts = rel.split(/[\\/]+/).filter((p) => p.length > 0);
  if (parts.length !== 2 || parts.some((p) => p.startsWith('.'))) return null;
  const [kind, file] = parts;
  if (!(EDIT_FILE_KINDS as readonly string[]).includes(kind)) return null;
  if (!file.endsWith('.json')) return null;
  const world = file.slice(0, -'.json'.length);
  if (!/^[a-z0-9_]{1,40}$/.test(world)) return null;
  return { kind: kind as EditFileKind, world };
}

/** The path a kind's file for a world is fetched from, under the build's own base. */
export function editFilePath(kind: EditFileKind, world: string): string {
  return `placements/${kind}/${world}.json`;
}
