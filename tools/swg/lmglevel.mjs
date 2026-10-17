// Which detail level of a skinned mesh's level list (.lmg) the converter takes: the finest that has
// geometry. A handful of the game's own meshes are stripped at some levels (the level's file is
// there, with no triangles in it); taking the finest level that merely exists would drop a mesh
// stripped at its finest level alone, though its coarser levels draw.

/** How many triangles a parsed mesh generator (`parseMgn`) holds, over all its shaders. */
export function triangleCount(mgn) {
  let n = 0;
  for (const s of mgn?.shaders ?? []) n += Math.floor((s.triangles?.length ?? 0) / 3);
  return n;
}

/**
 * The file a skeletal appearance's mesh name is read from. A `.mgn` the archives lack, with a `.lmg` of the same stem
 * beside it, is read as that level list (its finest level with geometry, `finestLevelWithGeometry`); anything else is
 * the name as it is (a `.lmg`, a `.mgn` the archives hold, a name missing with no list beside it, which the caller
 * reports missing as it always has). Measured over every retail `.sat`: of the named mesh files the archives lack,
 * exactly two have a list beside them, both pods (Sebulba's, which nothing else in the game used, and Anakin's mesh
 * again under another name), so the rule changes nothing else the converter makes.
 */
export function satMeshFile(name, has) {
  if (typeof name !== 'string' || !/\.mgn$/i.test(name) || has(name)) return name;
  const list = name.replace(/\.mgn$/i, '.lmg');
  return has(list) ? list : name;
}

/**
 * The finest level with geometry. `levels` are the mesh files finest first (`parseLmg`); `has(file)`
 * says whether the archives hold one and `load(file)` parses it. Returns `{ file, mgn }`:
 * - the first level that exists, parsed, when it has triangles (exactly what was taken before);
 * - else the next finer-to-coarser level that has any;
 * - else, when no level has any, the first that exists as before, so the caller reports it as it
 *   always has; `mgn` is its parse, or null when it could not be parsed (the caller parses it
 *   again and reports the error itself, as before);
 * - `{ file: levels[0] ?? null, mgn: null }` when none exists.
 * A level that fails to parse is never passed over for a coarser one: only a level that parses and
 * holds no triangles is.
 */
export function finestLevelWithGeometry(levels, { has, load }) {
  let first = null;
  for (const file of levels ?? []) {
    if (!file || !has(file)) continue;
    let mgn = null;
    try {
      mgn = load(file);
    } catch {
      // Unreadable: kept as the answer when it is the first that exists, and never skipped.
      return first ?? { file, mgn: null };
    }
    if (triangleCount(mgn) > 0) return { file, mgn };
    first ??= { file, mgn };
  }
  return first ?? { file: levels?.[0] ?? null, mgn: null };
}
