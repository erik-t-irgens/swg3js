// Which of a parts pack's meshes a character is stood up with, before anything is put on.
//
// A pack's own meshes come in two kinds, and the converter says which: `body` is a mesh of the
// appearance itself (the species' skin, an NPC's own head and hands), and the rest are pieces it was
// converted wearing. The client draws every mesh of the appearance, so every body mesh is loaded,
// whatever its occlusion layer, along with anything at layer 0 or below and whatever the caller asks
// to have on. Read by layer alone, as it once was, the head-and-hands mesh most of the game's named
// people keep at layer -1 never loaded (fifteen of them stood with no head and no hands), and the
// Selonians and one Gungan, whose whole body is that one mesh, had nothing to show at all.
//
// No imports, so the node test can read every pack on disk against the very rule the game uses.

/** What the rule reads of one of a pack's meshes. */
export interface ShownPart {
  name: string;
  occlusionLayer: number;
  body?: boolean;
}

/** The meshes a character loads with `dress` on: every body mesh, everything at layer 0 or under, and the dress itself. */
export function partsToLoad<T extends ShownPart>(parts: readonly T[], dress: ReadonlySet<string>): T[] {
  return parts.filter((def) => def.body === true || def.occlusionLayer <= 0 || dress.has(def.name));
}
