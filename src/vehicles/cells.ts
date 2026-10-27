// The converter's one spelling of a portal cell's node, read back. A cell's node is named
// cell:<index>:<name>, and GLTFLoader strips the colons, so "cell:2:hall" arrives as "cell2hall".
// It lives apart from the rooms (`interior.ts`) so that the hull, which only asks which cell a mesh
// belongs to, can be loaded without the rooms' loaders: `vehicle.ts` is driven by a node test.
//
// **The original name first** (Map-maker II's groundwork): GLTFLoader keeps a node's own name in `userData.name` before it
// strips the colons, and a stripped name cannot be read back when the cell's own name begins with a digit --
// "cell:17:4way_intersect1" arrives as "cell174way_intersect1", cell 174. So a cell is read from the nearest object (the
// object itself first) that carries an original, and from the stripped names only where nothing above carries one (a
// model built in a test). The original is on the node only: a cell whose mesh is several primitives (several materials) is a
// group, the node, whose child meshes carry only the stripped mesh name, so a child mesh is no cell's own node and is read
// through its group.
import type * as THREE from 'three';

/**
 * A cell's node as the converter names it, read off the original name GLTFLoader keeps: its index and its own name, the
 * index ending at the separator (a colon, or an underscore where a name was written so), so a name beginning with a digit
 * is never read into the index.
 */
const CELL_ORIGINAL = /^cell[:_](\d+)(?:[:_](.*))?$/;
/** The same read off a stripped name (the colons gone, or written as underscores): today's rule, for a node with no original. */
const CELL_STRIPPED = /^cell[:_]?(\d+)/;

/** A cell's index off an original name: by its separator, else (a name written with none, which only the old rule can read) as before; -1 for none. */
function originalIndex(orig: string): number {
  const m = CELL_ORIGINAL.exec(orig) ?? CELL_STRIPPED.exec(orig);
  return m ? Number(m[1]) : -1;
}

/** The original name an object carries (`userData.name`), or null. */
function originalOf(o: THREE.Object3D | null): string | null {
  const n = o?.userData?.name;
  return typeof n === 'string' ? n : null;
}

/** Whether an object or anything above it carries an original name (only then is a stripped name never read). */
function anyOriginal(o: THREE.Object3D | null): boolean {
  for (let n = o; n; n = n.parent) if (originalOf(n) !== null) return true;
  return false;
}

/**
 * Which portal cell a node *is*, from its own name and nothing else. -1 for anything that is not a
 * cell's own node.
 *
 * This is the question to ask when a room is being shown, hidden or lifted out whole, because the
 * meshes under a cell are not rooms and must not be turned on one by one (that is what would show a
 * window's invisible pane). `cellIndexOf` below asks the other question, "which cell is this part
 * of", and both are written here so there is one spelling of the converter's naming.
 */
export function ownCellIndex(o: THREE.Object3D | null): number {
  if (!o) return -1;
  const orig = originalOf(o);
  if (orig !== null) return originalIndex(orig);
  // A node GLTFLoader kept no original for: a child mesh of a cell of several primitives (no cell's own node, its group
  // is), or a model nobody named through GLTFLoader at all, which only the stripped names can tell.
  if (anyOriginal(o.parent)) return -1;
  const m = CELL_STRIPPED.exec(o.name);
  return m ? Number(m[1]) : -1;
}

/**
 * Which portal cell a mesh of a placed model is drawn in (`AssetPack.model`): the nearest object, the mesh itself first,
 * that carries an original name, read by its separator; with no original anywhere above, today's rule on the stripped
 * names of the mesh and its parent. -1 for a mesh of no cell.
 */
export function meshCellOf(o: THREE.Object3D): number {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    const orig = originalOf(n);
    if (orig !== null) return originalIndex(orig);
  }
  const m = CELL_STRIPPED.exec(o.name) ?? CELL_STRIPPED.exec(o.parent?.name ?? '');
  return m ? Number(m[1]) : -1;
}

/**
 * Which portal cell a node belongs to, from its own or an ancestor's name. -1 for a node of a
 * plain model.
 */
export function cellIndexOf(o: THREE.Object3D | null): number {
  for (let n = o; n; n = n.parent) {
    const i = ownCellIndex(n);
    if (i >= 0) return i;
  }
  return -1;
}

/** The cell's name from its node, "cell:2:hall" arriving as "cell2hall" (read off the original where one is kept: "4way_intersect1"). */
export function cellNameOf(o: THREE.Object3D | null): string {
  const kept = anyOriginal(o);
  for (let n = o; n; n = n.parent) {
    const orig = originalOf(n);
    if (orig !== null) {
      const m = CELL_ORIGINAL.exec(orig);
      if (m) return m[2] ?? '';
      const s = /^cell[:_]?\d+[:_]?(.*)$/.exec(orig);
      if (s) return s[1];
      continue;
    }
    if (kept) continue;
    const m = /^cell[:_]?\d+[:_]?(.*)$/.exec(n.name);
    if (m) return m[1];
  }
  return '';
}
