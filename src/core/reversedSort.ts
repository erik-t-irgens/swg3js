// The draw order under reversed depth (`?revz`).
//
// Three sorts its lists as always and then, when depth is reversed, reverses each whole list
// (WebGLRenderLists.sort: `opaque.reverse()`), meaning to turn nearest-first into farthest-first
// within a group. Reversing the whole list also turns `renderOrder` and `groupOrder` round: the sky's
// dome, ordered first at -10 and drawn without a depth test, was drawn last and covered the world.
// So under reversed depth the renderer is given comparators that sort into the exact reverse of the
// order wanted, and three's own reversal brings it out right: renderOrder rising, opaque things
// nearest first, see-through things farthest first -- what three gives with ordinary depth.
//
// Reversed depth makes a nearer thing's projected z larger. Pure: no three, so node can test it.

/** The fields of three's render item these read. */
export interface SortItem {
  id: number;
  groupOrder: number;
  renderOrder: number;
  z: number;
  material: { id: number };
  materialVariant?: number;
}

/** Opaque: sorts into the reverse of (groupOrder, renderOrder, material, nearest first, id). */
export function reversedOpaqueSort(a: SortItem, b: SortItem): number {
  return (b.groupOrder - a.groupOrder) || (b.renderOrder - a.renderOrder) || (b.material.id - a.material.id)
    || ((b.materialVariant ?? 0) - (a.materialVariant ?? 0)) || (a.z - b.z) || (b.id - a.id);
}

/** See-through: sorts into the reverse of (groupOrder, renderOrder, farthest first, id). */
export function reversedTransparentSort(a: SortItem, b: SortItem): number {
  return (b.groupOrder - a.groupOrder) || (b.renderOrder - a.renderOrder) || (b.z - a.z) || (b.id - a.id);
}
