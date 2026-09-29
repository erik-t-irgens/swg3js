// Which of the client's own detail levels a pack carries, and the ranges the game switches between
// them at (step 7 of the frame-time wave).
//
// A static appearance's `.lod` lists its levels with the distance each takes over at (`detailLevels`
// in appearance.mjs), finest first, and every file carries its own. The converter used to take the
// finest and nothing else. A pack now carries the finest (the model's own nodes, exactly as before),
// the lowest, and on a chain of four or more the middle one, as `lod:<n>` nodes in a second glTF
// scene named `lods` -- which every loader but the placed-object pack reads straight past, so a
// vehicle, a thumbnail or a scene backdrop built from the same file sees exactly what it always saw.
//
// Measured over the retail archives, two levels (the finest and the lowest) take almost the whole of
// the gain -- the same draw counts, and triangles within 1.0 to 1.3 of the client's full set on seven
// of eight sites -- and the middle one is what keeps a long chain's first step from being a cliff.
//
// Pure: nothing is imported, so the node test reads it directly.

/**
 * The stamp a pack carries once its placed and flora models carry their detail levels; `status` asks
 * for the snapshot (and the gallery) again while a pack's is lower. 2: a level that can never be drawn
 * (its switch not beyond the finer one's) and a level standing somewhere else than the finest (a temple's
 * entrance authored 15 m further along at every level, a capital ship's lowest level a one-metre cube) are
 * no longer carried, and no primitive sits under a detail map with no second coordinate set for it.
 */
export const LOD_FORMAT = 2;

/**
 * How far a lower level may stand from the finest before it is taken for a level authored somewhere else and
 * not carried: its box's middle within `shift` of the finest's diagonal (or `minShift` metres, for small
 * things), and its diagonal at least `minSize` of the finest's. Measured over the packs converted before this
 * rule, every lower level stood within a quarter of its finest's diagonal but three -- a temple on Yavin 4
 * whose every level was authored 15 m further along than the one before (two carried), and a capital ship
 * whose lowest level is a one-metre cube at its origin -- and only two were under a tenth of the finest's
 * size, that ship's and a collision shell's (the next smallest was four tenths). All three numbers are ours.
 */
export const LOD_PLACE = Object.freeze({ shift: 0.25, minShift: 1, minSize: 0.1 });

/** The box of a list of shader groups' positions (x, y, z a vertex), or null for none. */
export function groupsBox(groups) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const g of groups) {
    for (const p of g.primitives) {
      const pos = p.positions;
      if (!pos) continue;
      for (let i = 0; i + 2 < pos.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const v = pos[i + k];
          if (v < min[k]) min[k] = v;
          if (v > max[k]) max[k] = v;
        }
      }
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

/**
 * Whether a lower level's box stands where the finest's does (`LOD_PLACE`): true with either box unknown (a
 * level with nothing in it is drawn as nothing, wherever it is).
 */
export function levelInPlace(finest, lower, place = LOD_PLACE) {
  if (!finest || !lower) return true;
  const diag = (b) => Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  const fd = diag(finest);
  const shift = Math.hypot(...[0, 1, 2].map((k) => (finest.min[k] + finest.max[k]) / 2 - (lower.min[k] + lower.max[k]) / 2));
  if (shift > place.shift * fd && shift > place.minShift) return false;
  return !(fd > 0 && diag(lower) < place.minSize * fd);
}

/**
 * Of the levels a pick might switch to (ascending, the finest's 0 left out), the ones it can ever draw:
 * the game takes the last level whose switch distance a copy has reached, so a level whose switch is not
 * strictly beyond the finer one kept before it and strictly short of the coarser one kept after it is never
 * drawn, and a switch at the eye (0) replaces the finest everywhere. Walked from the lowest up, keeping the
 * coarser of two that clash (the one the game draws there already). A chain whose every switch is at 0 --
 * one gallery hull's, whose "lowest" level is five times the finest's triangles -- keeps none.
 */
export function risingLevels(order, nearOf) {
  const kept = [];
  let next = Infinity;
  for (let i = order.length - 1; i >= 0; i--) {
    const n = nearOf(order[i]);
    if (n > 0 && n < next) {
      kept.push(order[i]);
      next = n;
    }
  }
  return kept.reverse();
}

/** The name of the glTF scene that holds a model's lower levels. */
export const LOD_SCENE = 'lods';

/** A lower level's node name: `lod:<the client's level number>`. GLTFLoader strips the colon and keeps the original in `userData.name`. */
export function lodNodeName(level) {
  return `lod:${level}`;
}

/** The client's level number a node name carries, or -1. */
export function lodLevelOfName(name) {
  const m = /^lod:(\d+)$/.exec(name ?? '');
  return m ? Number(m[1]) : -1;
}

/**
 * The levels of a chain of `count` a pack carries: the finest (0), the lowest (count - 1), and the
 * middle one (`round((count - 1) / 2)`) on a chain of four or more. Ascending.
 */
export function carriedLevels(count) {
  if (!(count >= 2)) return [0];
  const out = [0];
  if (count >= 4) out.push(Math.round((count - 1) / 2));
  out.push(count - 1);
  return out;
}

const round2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v);

/**
 * The manifest's `lods` for the levels actually carried: one row per carried level, the finest first,
 * each with the client's level number, where it takes over (its own `near`), where the next carried
 * level takes over (`far`; the chain's own last far on the lowest, which is the client's draw limit),
 * and what it came to (`tris`, `prims`; nought on a level the artists left empty). Contiguous by
 * construction: a level dropped between two carried ones is drawn by the finer of the two, never by
 * the coarser, so nothing is shown in less detail than the client showed it.
 *
 * `levels` is `detailLevels`'s answer ([{ near, far }], finest first); `carried` is ascending with 0
 * first; `stats[i]` is carried level i's { tris, prims }.
 */
export function lodRanges(levels, carried, stats) {
  const out = [];
  for (let i = 0; i < carried.length; i++) {
    const n = carried[i];
    const own = levels[n] ?? { near: 0, far: Infinity };
    const near = i === 0 ? 0 : own.near;
    const next = carried[i + 1];
    const far = next !== undefined ? (levels[next]?.near ?? own.far) : own.far;
    out.push({ level: n, near: round2(near), far: round2(Number.isFinite(far) ? far : 1e9), tris: stats[i]?.tris ?? 0, prims: stats[i]?.prims ?? 0 });
  }
  return out;
}

/**
 * Whether a chain's own ranges are contiguous: every level's near is the previous level's far (within
 * a centimetre). True on 5,949 of the 5,959 retail files.
 */
export function chainContiguous(levels) {
  for (let i = 1; i < levels.length; i++) if (Math.abs(levels[i].near - levels[i - 1].far) > 0.01) return false;
  return true;
}

/** Triangles and primitives (one glTF primitive, so one draw, each) of a list of shader groups. */
export function groupStats(groups) {
  let tris = 0;
  let prims = 0;
  for (const g of groups) {
    for (const p of g.primitives) {
      tris += p.indices.length / 3;
      prims++;
    }
  }
  return { tris: Math.round(tris), prims };
}

/**
 * A model's lower detail levels: the levels `carriedLevels` names of the chain its exterior switches
 * between (`exteriorAppearance`: a portal building's shell cell, never its rooms), each as a mesh named
 * `lod:<n>` for the GLB's `lods` scene, and the manifest's `lods` ranges. The lowest level is the last
 * that resolves -- four flora chains end in a `.spr`, which this converter does not read, and take the
 * level before it, as does one standing somewhere else than the finest (`levelInPlace`) -- a middle level
 * that fails or reaches past the lowest is dropped, so is a level the game's pick could never draw
 * (`risingLevels`: its switch not beyond the finer one's, or at the eye), and a level whose parts are
 * exactly the finer level's before it is not carried at all (a switch between two copies of one mesh is a
 * draw for nothing). A level the artists left empty (`no_render`) is carried as a range
 * with no mesh: nothing is drawn there, which is how the client made small things vanish in the
 * distance. Null when there is nothing but the finest to carry.
 *
 * `finestGroups` is what the model's own nodes draw of the exterior, for the finest row's counts. The
 * archive readers come in `deps` (`exteriorAppearance`, `detailLevels`, `resolveParts`, and
 * `meshGroups(part)`: one resolved part's shader groups, parsed and put in the part's frame), so this
 * file imports nothing and the node test can hand it the retail archives.
 */
export function lodMeshesFor(vfs, source, finestGroups, deps) {
  const ext = deps.exteriorAppearance(vfs, source);
  if (!ext) return null;
  let levels;
  try {
    levels = deps.detailLevels(vfs, ext);
  } catch {
    return null;
  }
  if (levels.length < 2) return null;
  const cache = new Map();
  const partsAt = (n) => {
    if (cache.has(n)) return cache.get(n);
    let parts = null;
    try {
      parts = deps.resolveParts(vfs, ext, 0, n).filter((p) => p.mesh && !(p.cell > 0));
      // A level naming a mesh the archives do not hold (a few retail chains do) is a level that does not read.
      if (vfs && parts.some((p) => !vfs.has(p.mesh))) parts = null;
    } catch {
      parts = null;
    }
    cache.set(n, parts);
    return parts;
  };
  // A level's meshes, read once; null for a level standing somewhere else than the finest (`levelInPlace`),
  // which is a level that does not read either.
  const finestBox = groupsBox(finestGroups);
  const groupCache = new Map();
  const groupsAt = (n) => {
    if (groupCache.has(n)) return groupCache.get(n);
    const parts = partsAt(n);
    let groups = null;
    if (parts) {
      groups = [];
      for (const part of parts) groups.push(...deps.meshGroups(part));
      if (!levelInPlace(finestBox, groupsBox(groups))) groups = null;
    }
    groupCache.set(n, groups);
    return groups;
  };
  const wanted = carriedLevels(levels.length);
  let lowest = -1;
  for (let n = levels.length - 1; n >= 1; n--) {
    if (groupsAt(n)) {
      lowest = n;
      break;
    }
  }
  if (lowest < 1) return null;
  const candidates = [];
  const mid = wanted.length === 3 ? wanted[1] : -1;
  if (mid > 0 && mid < lowest && groupsAt(mid)) candidates.push(mid);
  candidates.push(lowest);
  // Only what the game's pick can ever draw: switches that rise, none at the eye.
  const order = risingLevels(candidates, (n) => levels[n]?.near ?? 0);
  const keyOf = (parts) => JSON.stringify((parts ?? []).map((p) => [p.mesh, p.transform]));
  let prevKey = keyOf(partsAt(0));
  const kept = [0];
  const stats = [groupStats(finestGroups)];
  const meshes = [];
  for (const n of order) {
    const parts = partsAt(n);
    const key = keyOf(parts);
    if (key === prevKey) continue;
    prevKey = key;
    const groups = groupsAt(n);
    kept.push(n);
    stats.push(groupStats(groups));
    if (groups.length) meshes.push({ name: lodNodeName(n), groups, hardpoints: [] });
  }
  if (kept.length < 2) return null;
  return { lods: lodRanges(levels, kept, stats), meshes };
}
