// What a world pack's manifest is allowed to hold, which the snapshot, `status` and the test of the packs share.
//
// **A world's manifest holds the categories the snapshot makes and nothing else.** The snapshot writes `layout`
// (every placed model) and `flora` (every model the terrain plants) and stamps `materialFormat` and `lodFormat`
// over the manifest as a whole. It used to read the manifest it found and keep every category in it, so the old
// `pack` command's `structures`, `rocks`, `debris` and `vaporators` rode along under a stamp that was never true
// of them: five models on Tatooine kept a look from before material format 6 for a whole conversion, because
// nothing that runs today writes those categories and nothing said they were stale. Nothing draws them either
// while a world has a layout (the outposts read them only without one, and the scatter only without flora, and
// every converted world has both), so a snapshot now writes only its own and `status` asks for it again while a
// world's manifest still carries any other.

/** The categories a world snapshot writes. */
export const SNAPSHOT_CATEGORIES = ['layout', 'flora'];

/** The categories in a world's manifest that no snapshot writes any more, sorted: what `status` asks the snapshot to take out. */
export function strayCategories(manifest) {
  const cats = manifest?.categories;
  if (!cats || typeof cats !== 'object') return [];
  return Object.keys(cats).filter((k) => !SNAPSHOT_CATEGORIES.includes(k)).sort();
}

/** The manifest's categories cut to what a snapshot writes, in its own order: the one place it decides what survives. */
export function snapshotCategories(categories) {
  const out = {};
  for (const k of SNAPSHOT_CATEGORIES) if (categories && Array.isArray(categories[k])) out[k] = categories[k];
  return out;
}

/** Every `.glb` file one manifest entry names, its own and its lower levels' alike, walked through every field. */
export function glbsNamed(entry, out = []) {
  if (typeof entry === 'string') {
    if (entry.toLowerCase().endsWith('.glb')) out.push(entry.replace(/\\/g, '/'));
  } else if (Array.isArray(entry)) {
    for (const v of entry) glbsNamed(v, out);
  } else if (entry && typeof entry === 'object') {
    for (const v of Object.values(entry)) glbsNamed(v, out);
  }
  return out;
}
