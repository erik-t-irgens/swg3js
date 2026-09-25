// Where a house may stand: the patch of ground it asks for, the test on that ground, and the spot
// ahead of somebody to try first.
//
// **The ground under a house cannot be moved.** Every building the game's own worlds place sits on
// terrain that was authored to receive it -- a town's ground is flattened by the building's own
// terrain layer, baked into the planet before it was converted -- and nothing in this game can add
// such a layer to a world that is already generated. So a house put down in play meets the ground
// as it finds it, and the only honest answer is to refuse a spot the ground is too rough for.
//
// What a structure asks for is measured two ways. The client authored a `.sfp` footprint per
// structure -- a grid of cells with the building's own origin marked on it, which is what its
// placement tool drew and what the lot rules counted -- and the converter does not read it yet. So
// for now the patch comes from the model's own box, which is a fair and slightly generous stand-in
// (it counts a porch, a yard wall and a flagpole as part of the house), and `patchOfFootprint` is
// here so that the day the `.sfp` is read nothing downstream changes. Every other number is ours.
//
// Pure: no three, no fetch. Rule for this file (node runs it with type stripping for the tests):
// relative imports only as `import type`, no enum, no namespace, no constructor parameter properties.

/** A structure's own footprint, as the client draws it on its placement grid. Nothing writes one yet. */
export interface Footprint {
  /** Cells across and along. */
  width: number;
  height: number;
  /** Which cell the building's own origin sits on. */
  pivotX: number;
  pivotZ: number;
  /** How big one cell is, in metres. It is not always eight: a merchant tent's is four. */
  cellWidth: number;
  cellHeight: number;
}

/**
 * The patch of ground a structure asks for, in its own frame: half the span each way and where the
 * middle of that span sits relative to the building's own origin.
 *
 * The offset is not decoration. A house's origin is its doorstep rather than its middle -- one of
 * the medium houses reaches 16 m one way down its own z and 10 m the other -- so a patch centred on
 * the origin would test the wrong ground by six metres.
 */
export interface Patch {
  hx: number;
  hz: number;
  cx: number;
  cz: number;
}

/**
 * Every invented number of putting a house down. Live through `__debug.house`.
 */
export const HOUSE_TUNE = {
  /**
   * How far the ground may **rise** above the doorstep across the patch, metres.
   *
   * This is the tight one, and the reason the two are not one number. A house is stood at the
   * ground under its own origin, and every one of these buildings carries a foundation sixteen
   * metres deep, so ground that falls away under a corner shows nothing at all -- it is what the
   * foundation is modelled for. Ground that rises laps up the wall and buries a window, and no
   * amount of foundation helps with that.
   */
  rise: 2.5,
  /**
   * How far the ground may **fall** below the doorstep across the patch, metres. Generous, because
   * the foundation reaches far further down than this and the only real cost is the look of a house
   * standing proud of a slope, which is what half the ones in the game did.
   */
  sink: 6,
  /**
   * How steep the ground under it may be, in degrees, measured between every pair of probes.
   *
   * It is not the same question as the rise and the fall, which are measured against one point:
   * this catches a step between two corners that are both near the doorstep's height, and the
   * tilt of a long even ramp that never gets far from it.
   */
  slope: 15,
  /** A margin round the patch that is tested with it, metres. */
  margin: 2,
  /** How far ahead of the player a house is put when no spot is given. */
  ahead: 14,
  /** How far above the ground the building's own origin is stood. */
  lift: 0,
};

/**
 * The patch a model's own box asks for. `min` and `max` are taken componentwise: a mesh's BOX
 * chunk holds the larger corner first and the packs written before that was noticed carry the swap.
 */
export function patchOfBounds(b: { min: number[]; max: number[] }): Patch {
  const lo = (k: number) => Math.min(b.min[k], b.max[k]);
  const hi = (k: number) => Math.max(b.min[k], b.max[k]);
  return { hx: (hi(0) - lo(0)) / 2, hz: (hi(2) - lo(2)) / 2, cx: (hi(0) + lo(0)) / 2, cz: (hi(2) + lo(2)) / 2 };
}

/** The patch a client footprint asks for, for the day the converter reads one. */
export function patchOfFootprint(f: Footprint): Patch {
  const x = f.width * f.cellWidth;
  const z = f.height * f.cellHeight;
  // The pivot names a cell; the origin stands at that cell's middle.
  return { hx: x / 2, hz: z / 2, cx: x / 2 - (f.pivotX + 0.5) * f.cellWidth, cz: z / 2 - (f.pivotZ + 0.5) * f.cellHeight };
}

/** The metres a patch covers, across and along. */
export function patchSize(p: Patch): { x: number; z: number } {
  return { x: p.hx * 2, z: p.hz * 2 };
}

/**
 * The ground a patch covers, in the world, for a building at `at` turned by `yaw`: four corners,
 * the middle, and **the building's own origin last**, which is the point the whole verdict is
 * measured against. Six points are enough to know whether a patch is level without walking it.
 *
 * The origin is where the client's own footprint puts the pivot, and it is as near the doorstep as
 * anything this game knows -- nothing in the archives says which way a house's door faces. It is
 * last rather than first so that `groundVerdict` can take it by name without the corners' loop
 * having to skip an index.
 */
export function patchProbes(p: Patch, at: { x: number; z: number }, yaw: number, margin = HOUSE_TUNE.margin): { x: number; z: number }[] {
  const hx = p.hx + margin;
  const hz = p.hz + margin;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const at_ = (dx: number, dz: number) => {
    const x = p.cx + dx;
    const z = p.cz + dz;
    return { x: at.x + x * cos - z * sin, z: at.z + x * sin + z * cos };
  };
  return [at_(-hx, -hz), at_(hx, -hz), at_(-hx, hz), at_(hx, hz), at_(0, 0), { x: at.x, z: at.z }];
}

/**
 * Whether the ground at these heights will take a house, and what height to stand it at.
 *
 * **The house is stood at the ground under its own origin**, which is the last probe, and every
 * other probe is then asked how far it stands from that. This is the one choice here worth arguing
 * about, and it was argued from the buildings themselves: every player house in the pack has a box
 * whose bottom is sixteen metres below its origin, which is a foundation modelled to be buried. So
 * ground falling away under a corner costs nothing and is allowed a long way (`sink`), while ground
 * rising over the doorstep laps up a wall and is allowed very little (`rise`). The earlier rule --
 * stand it at the highest corner, refuse past one number of metres out of level -- was measured
 * over four real worlds and refused nine spots in ten, every single one of them for the level test
 * and never once for the slope, which is what a single symmetric cap on a patch of fixed size comes
 * to: a slope test in disguise, tighter than the slope test standing next to it.
 *
 * The slope is still its own test, over every pair of probes, because neither of the other two sees
 * a step between two corners that both happen to sit near the doorstep's height.
 */
export function groundVerdict(
  probes: readonly { x: number; z: number }[],
  heights: readonly number[],
  tune = HOUSE_TUNE,
): { ok: boolean; y: number; rise: number; sink: number; slope: number; why: string | null } {
  const good = heights.filter((h) => Number.isFinite(h));
  if (good.length < probes.length || good.length < 3) {
    return { ok: false, y: 0, rise: 0, sink: 0, slope: 0, why: 'the ground there is not known yet' };
  }
  // The doorstep: the last probe, which `patchProbes` puts at the building's own origin. A caller
  // that hands over corners alone gets the middle of them, which is the fairest thing left to do.
  const door = heights[heights.length - 1];
  let rise = 0;
  let sink = 0;
  for (const h of good) {
    if (h - door > rise) rise = h - door;
    if (door - h > sink) sink = door - h;
  }
  let steepest = 0;
  for (let i = 0; i < probes.length; i++) {
    for (let k = i + 1; k < probes.length; k++) {
      const run = Math.hypot(probes[i].x - probes[k].x, probes[i].z - probes[k].z);
      if (run < 0.5) continue;
      const drop = Math.abs(heights[i] - heights[k]);
      const deg = (Math.atan2(drop, run) * 180) / Math.PI;
      if (deg > steepest) steepest = deg;
    }
  }
  const y = door + tune.lift;
  if (rise > tune.rise) return { ok: false, y, rise, sink, slope: steepest, why: `the ground stands ${rise.toFixed(1)} m over the doorstep, and ${tune.rise} is the most a house will take` };
  if (sink > tune.sink) return { ok: false, y, rise, sink, slope: steepest, why: `the ground falls ${sink.toFixed(1)} m away under it, and ${tune.sink} is the most` };
  if (steepest > tune.slope) return { ok: false, y, rise, sink, slope: steepest, why: `the ground slopes ${steepest.toFixed(0)} degrees under it, and ${tune.slope} is the most` };
  return { ok: true, y, rise, sink, slope: steepest, why: null };
}

/**
 * A spot ahead of somebody, on the ground, far enough out that the house is not built on their head.
 *
 * Far enough is the patch's own half-diagonal plus the margin: a small tent may be put down almost
 * at your feet and a guild hall cannot. The patch's own offset is taken off, so what ends up that
 * far away is the middle of the building rather than its doorstep.
 */
export function spotAhead(from: { x: number; z: number }, yaw: number, p: Patch, tune = HOUSE_TUNE): { x: number; z: number } {
  const reach = Math.max(tune.ahead, Math.hypot(p.hx, p.hz) + tune.margin + 2);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  // The camera's forward is (-sin yaw, 0, -cos yaw), and the patch offset turns with the building.
  return { x: from.x - sin * reach - (p.cx * cos - p.cz * sin), z: from.z - cos * reach - (p.cx * sin + p.cz * cos) };
}

/** How far from a house nothing else may stand: its own patch, plus the margin. */
export function clearRadius(p: Patch, tune = HOUSE_TUNE): number {
  return Math.hypot(p.hx, p.hz) + tune.margin;
}
