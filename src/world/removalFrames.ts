// Where the world editor's hand on the world's own and the console carry a point, a facing and one of the world's own objects
// into the raw frame the removal, people and placements files are written in (Map-maker II's twelfth wave), pure so a node
// test runs the very arithmetic the game does. A converted world's raw frame is its layout's own, which the game's frame
// mirrors about the layout's centre (`LayoutStreamer`'s constructor: x to `c.x - x`, z less `c.z`, a turn (w, x, y, z) as
// three's (x, -y, -z, w)); a space zone's is the game's own.
//
// Pure, and imports nothing. Rule for this file (node runs it with type stripping): no enum, no namespace, no constructor
// parameter properties.

/** A point of the game's frame in the file's raw frame, about the frame `c` the world's rows are written in; null with none. */
export function rawOfGame(c: { x: number; z: number } | null | undefined, x: number, z: number): { x: number; z: number } | null {
  return c ? { x: c.x - x, z: z + c.z } : null;
}

/**
 * The eye's facing as a heading of the raw frame, degrees (what a placed person's row is written with): the game's facing of
 * a camera whose yaw is `yaw` (its forward `(-sin yaw, -cos yaw)`, a body facing `(sin h, cos h)`), turned through the
 * mirror on the ground (a heading to its negative) and left as it is in space.
 */
export function headingRawOf(yaw: number, space: boolean): number {
  const g = Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
  return space ? (g * 180) / Math.PI : (-g * 180) / Math.PI;
}

/** One of the layout's own objects as the layout writes it (its raw place and turn `[w, x, y, z]`, its model and template). */
export interface LayoutThing {
  model: string;
  template: string;
  x: number;
  y: number;
  z: number;
  q: readonly number[];
  contained?: boolean;
}

/**
 * A row of the world's own placements file standing exactly where the layout stands one of its own objects (Move and Copy as
 * row): its model and template at its very place and turn, which are the layout's raw frame already, to the millimetre and
 * the millionth; a building, or a thing in a room (`inside`).
 */
export function rowOfLayoutThing(x: LayoutThing, id: string, building: boolean): Record<string, unknown> {
  const round = (v: number, k: number): number => Math.round(v * k) / k;
  return { id, kind: building ? 'building' : 'prop', pack: 'world', model: x.model, x: round(x.x, 1000), y: round(x.y, 1000), z: round(x.z, 1000), q: x.q.map((v) => round(v, 1e6)), template: x.template, ...(x.contained ? { inside: true } : {}) };
}
