// The window: one square of the air that follows the camera on a planet, snapped to whole cells of the air's own
// grid, and the one uv convention every field of the pass is addressed by (the design's §2.2).
//
// **uv runs with world +X and +Z**: `uv = (p.xz - origin) / size`, so a velocity in m/s is a uv velocity `v / size`
// with no sign flip. The ripples' window runs v against world Z (their overhead camera made it so); the one place the
// two meet is `rippleUvToAir`, held to `waterSim.ts`'s own arithmetic by a test.
//
// **Snapped to whole cells**: `origin = round((cam - size/2) / cell) · cell`, the ripples' rule. Every finer field is
// a whole multiple of the air's grid, so a move is a whole number of texels for every field and nothing is resampled;
// what a field still owes of a move (its pending scroll, in uv) is carried by the first pass that reads it after the
// move. A move of more than `jump` of the window in one frame is a jump: every field starts again at its inflow.
//
// Pure: no three, so the node tests drive exactly what the field drives.

/** The window as the field keeps it: where it stands, how big, and what the last placing did. */
export interface FluidWindow {
  /** World x and z of uv (0, 0). */
  ox: number;
  oz: number;
  /** Metres across. */
  size: number;
  /** Air cells across. */
  cells: number;
  /** Metres a cell. */
  cell: number;
  /** Whether it has been placed since it was made or reset. */
  placed: boolean;
  /** The last placing's move, in whole cells (0 on a jump or the first). */
  moveX: number;
  moveZ: number;
  /** Jumps and first placings since it was made. */
  resets: number;
}

export function newWindow(): FluidWindow {
  return { ox: 0, oz: 0, size: 192, cells: 128, cell: 1.5, placed: false, moveX: 0, moveZ: 0, resets: 0 };
}

/** What placing the window did. */
export const PLACE = { still: 0, moved: 1, jump: 2, first: 3 } as const;

/** The snapped origin for a camera coordinate. */
export function snapOrigin(cam: number, size: number, cell: number): number {
  return Math.round((cam - size / 2) / cell) * cell;
}

/**
 * Put the window on this frame's camera: its size and cells (a change of either is a jump, since the fields are made
 * again at the new size), the snapped origin, and the move in whole cells. Answers a `PLACE` code; writes into `w`.
 */
export function placeWindow(w: FluidWindow, camX: number, camZ: number, size: number, cells: number, jumpShare: number): number {
  return placeWindowIn(w, { camX, camZ, size, cells, jump: jumpShare });
}

/** Where the window is asked to stand, as a kept record (the field's frame hands no number across a call). */
export interface WindowPlace {
  camX: number;
  camZ: number;
  size: number;
  cells: number;
  jump: number;
}

/** `placeWindow` over a kept record. */
export function placeWindowIn(w: FluidWindow, p: WindowPlace): number {
  const camX = p.camX;
  const camZ = p.camZ;
  const size = p.size;
  const cells = p.cells;
  const jumpShare = p.jump;
  const cell = size / cells;
  // `snapOrigin`, written out so no number crosses a call.
  const nx = Math.round((camX - size / 2) / cell) * cell;
  const nz = Math.round((camZ - size / 2) / cell) * cell;
  if (!w.placed || w.size !== size || w.cells !== cells) {
    const first = !w.placed;
    w.size = size;
    w.cells = cells;
    w.cell = cell;
    w.ox = nx;
    w.oz = nz;
    w.placed = true;
    w.moveX = 0;
    w.moveZ = 0;
    w.resets++;
    return first ? PLACE.first : PLACE.jump;
  }
  const dx = Math.round((nx - w.ox) / cell);
  const dz = Math.round((nz - w.oz) / cell);
  w.ox = nx;
  w.oz = nz;
  if (Math.abs(dx) > cells * jumpShare || Math.abs(dz) > cells * jumpShare) {
    w.moveX = 0;
    w.moveZ = 0;
    w.resets++;
    return PLACE.jump;
  }
  w.moveX = dx;
  w.moveZ = dz;
  return dx !== 0 || dz !== 0 ? PLACE.moved : PLACE.still;
}

/** A point's uv in the window, into `out` (outside it lies outside 0..1). */
export function fluidUv(w: FluidWindow, x: number, z: number, out: { x: number; y: number }): { x: number; y: number } {
  out.x = (x - w.ox) / w.size;
  out.y = (z - w.oz) / w.size;
  return out;
}

/** The world point at a uv of the window, into `out`. */
export function fluidWorld(w: FluidWindow, u: number, v: number, out: { x: number; y: number }): { x: number; y: number } {
  out.x = w.ox + u * w.size;
  out.y = w.oz + v * w.size;
  return out;
}

/** Whether a point is inside the window. */
export function inWindow(w: FluidWindow, x: number, z: number): boolean {
  return w.placed && x >= w.ox && z >= w.oz && x <= w.ox + w.size && z <= w.oz + w.size;
}

/**
 * The ripples' uv (`waterSim.ts`: u with world X from its origin, v **against** world Z) as the air's uv, into `out`.
 * The one place the two conventions meet (the fourth wave's ripple carry).
 */
export function rippleUvToAir(u: number, v: number, rippleOriginX: number, rippleOriginZ: number, rippleWindow: number, w: FluidWindow, out: { x: number; y: number }): { x: number; y: number } {
  const x = rippleOriginX + u * rippleWindow;
  const z = rippleOriginZ + (1 - v) * rippleWindow;
  return fluidUv(w, x, z, out);
}

/** The fade a field's look takes across the window's edge band: 0 at the edge, 1 a band's width inside. */
export function edgeFade(u: number, v: number, band: number): number {
  const d = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v));
  if (!(d > 0)) return 0;
  if (d >= band) return 1;
  const t = d / band;
  return t * t * (3 - 2 * t);
}
