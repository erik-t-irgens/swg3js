// The converter's one spelling of a portal cell's node, read back. A cell's node is named
// cell:<index>:<name>, and GLTFLoader strips the colons, so "cell:2:hall" arrives as "cell2hall".
// It lives apart from the rooms (`interior.ts`) so that the hull, which only asks which cell a mesh
// belongs to, can be loaded without the rooms' loaders: `vehicle.ts` is driven by a node test.
import type * as THREE from 'three';

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
  const m = o ? /^cell[:_]?(\d+)/.exec(o.name) : null;
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

/** The cell's name from its node, "cell:2:hall" arriving as "cell2hall". */
export function cellNameOf(o: THREE.Object3D | null): string {
  for (let n = o; n; n = n.parent) {
    const m = /^cell[:_]?\d+[:_]?(.*)$/.exec(n.name);
    if (m) return m[1];
  }
  return '';
}
