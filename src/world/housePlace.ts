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
  /**
   * How far the door may stand off the ground before getting in or out takes a jump, metres. Not
   * ours: it is the step the player's own character controller climbs without one (`player.ts`'s
   * `enableAutostep`), which the node test reads out of that call. Past it the bar says so; it never
   * refuses anything, because how high a house stands is the player's to choose.
   */
  doorStep: 0.5,
  /**
   * How far the door may stand off the ground before a plain jump cannot reach it, metres. Not ours
   * either: it is `JUMP_APEX`, the walk's own jump, which the node test holds it to. A note too and
   * never a refusal -- a Jedi's leap clears eleven metres, and the house is the owner's.
   */
  doorMost: 0.8,
};

/**
 * A point in a building's own frame carried round by its turn, **the way three turns it**: local
 * `(x, z)` goes to `(x cos + z sin, -x sin + z cos)`, which is what `rotation.set(0, yaw, 0)` does to
 * the ghost (`placeGhost.ts`, `PlacementGhost.place`) and `setFromAxisAngle(up, yaw)` to the house
 * that stands (`world.ts`, `placeBuilding`). Every probe, middle and grid height about a house is
 * turned through here and through nothing else.
 *
 * The ground tests once turned the other way, which agrees with the drawn house only at 0 and 180
 * degrees: at a quarter turn the ground a house was judged on, the middle what was in the way was
 * measured from and the heights its grid was drawn at were all the mirror image of where it stood.
 *
 * It writes into `out` and hands it back, so a frame that turns forty corners makes nothing.
 */
export function turnLocal(lx: number, lz: number, yaw: number, out: { x: number; z: number }): { x: number; z: number } {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  out.x = lx * cos + lz * sin;
  out.z = -lx * sin + lz * cos;
  return out;
}

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
 *
 * `out` is a list to write them into, kept by a caller that asks every frame (the ghost): its six
 * records are made the first time and written over after that. Without one a new list is made.
 */
export function patchProbes(p: Patch, at: { x: number; z: number }, yaw: number, margin = HOUSE_TUNE.margin, out: { x: number; z: number }[] = []): { x: number; z: number }[] {
  const hx = p.hx + margin;
  const hz = p.hz + margin;
  probeAt(out, 0, p, at, yaw, -hx, -hz);
  probeAt(out, 1, p, at, yaw, hx, -hz);
  probeAt(out, 2, p, at, yaw, -hx, hz);
  probeAt(out, 3, p, at, yaw, hx, hz);
  probeAt(out, 4, p, at, yaw, 0, 0);
  const door = out[5] ?? (out[5] = { x: 0, z: 0 });
  door.x = at.x;
  door.z = at.z;
  out.length = 6;
  return out;
}

/** One probe of `patchProbes`: a point of the patch's own frame, turned and carried into the world. */
function probeAt(out: { x: number; z: number }[], i: number, p: Patch, at: { x: number; z: number }, yaw: number, dx: number, dz: number): void {
  const q = turnLocal(p.cx + dx, p.cz + dz, yaw, out[i] ?? (out[i] = { x: 0, z: 0 }));
  q.x += at.x;
  q.z += at.z;
}

/**
 * The middle of a building's patch in the world, for a building at `at` turned by `yaw`: where what
 * is in the way is measured from, and so where the world must be asked what is standing, which is
 * not the spot the building was asked for -- a medium house's origin stands metres off its middle.
 * Written into `out`.
 */
export function patchMiddle(p: Patch, at: { x: number; z: number }, yaw: number, out: { x: number; z: number }): { x: number; z: number } {
  turnLocal(p.cx, p.cz, yaw, out);
  out.x += at.x;
  out.z += at.z;
  return out;
}

/** What `groundVerdict` says about a patch of ground. */
export interface GroundVerdict {
  ok: boolean;
  /** Where to stand the building's origin: the floor, the player's lift in it. */
  y: number;
  rise: number;
  sink: number;
  slope: number;
  /** Why not, in words, or null. */
  why: string | null;
  /** What the door's height off the ground will mean, or null; never a refusal. */
  note: string | null;
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
 *
 * **`lift` is the player's own raise or drop, and the rise and the fall are measured from the floor
 * it leaves**, `door + lift`, not from the ground under the doorstep. So lifting a doorstep the
 * ground laps over clears the rise -- which is what the nudge was always for -- lowering one adds to
 * it, and a house lifted high over level ground is refused in the fall's own words, because a floor
 * six metres up has ground falling six metres away under it whatever the ground itself is doing.
 * The slope does not move with the lift and neither does anything else.
 *
 * **How far the door then stands off the ground is a `note`, never a refusal**: past `doorStep` the
 * player will have to jump to get in (or out, lowered), past `doorMost` a plain jump will not reach.
 * Both numbers are the player's own; how high a house stands is the player's to choose.
 *
 * `out` is a record to write the answer into, kept by a caller that asks every frame; without one a
 * new record is made.
 */
export function groundVerdict(probes: readonly { x: number; z: number }[], heights: readonly number[], tune = HOUSE_TUNE, lift = 0, out?: GroundVerdict): GroundVerdict {
  const v: GroundVerdict = out ?? { ok: false, y: 0, rise: 0, sink: 0, slope: 0, why: null, note: null };
  v.note = doorNote(lift, tune);
  let known = 0;
  for (let i = 0; i < heights.length; i++) if (Number.isFinite(heights[i])) known++;
  if (known < probes.length || known < 3) return verdict(v, false, 0, 0, 0, 0, 'the ground there is not known yet');
  // The doorstep: the last probe, which `patchProbes` puts at the building's own origin. A caller
  // that hands over corners alone gets the middle of them, which is the fairest thing left to do.
  const door = heights[heights.length - 1];
  // The floor, where the house really stands once the player has lifted or dropped it.
  const floor = door + lift;
  let rise = 0;
  let sink = 0;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    if (!Number.isFinite(h)) continue;
    if (h - floor > rise) rise = h - floor;
    if (floor - h > sink) sink = floor - h;
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
  const y = floor + tune.lift;
  if (rise > tune.rise) return verdict(v, false, y, rise, sink, steepest, `the ground stands ${rise.toFixed(1)} m over the doorstep, and ${tune.rise} is the most a house will take`);
  if (sink > tune.sink) return verdict(v, false, y, rise, sink, steepest, `the ground falls ${sink.toFixed(1)} m away under it, and ${tune.sink} is the most`);
  if (steepest > tune.slope) return verdict(v, false, y, rise, sink, steepest, `the ground slopes ${steepest.toFixed(0)} degrees under it, and ${tune.slope} is the most`);
  return verdict(v, true, y, rise, sink, steepest, null);
}

/** `groundVerdict`'s answer written into its record, the note already in it. */
function verdict(v: GroundVerdict, ok: boolean, y: number, rise: number, sink: number, slope: number, why: string | null): GroundVerdict {
  v.ok = ok;
  v.y = y;
  v.rise = rise;
  v.sink = sink;
  v.slope = slope;
  v.why = why;
  return v;
}

/**
 * The last door note written and what it was written for. A lift is held for frames at a time and
 * the ground test asks every one of them, so the words are written once and handed back while the
 * lift and the plain jump they are measured against stay as they were. (The step only decides
 * whether there are any words, which is asked before this.)
 */
const DOOR_SAID: { lift: number; most: number; text: string } = { lift: Number.NaN, most: Number.NaN, text: '' };

/**
 * What the door's height off the ground means to whoever has to walk in, or null when it means
 * nothing: a step the feet climb on their own. The doorstep's own ground is what the lift is
 * measured from, so a lift is exactly how far the sill stands over it, or under it.
 */
export function doorNote(lift: number, tune = HOUSE_TUNE): string | null {
  const off = Math.abs(lift);
  if (!(off > tune.doorStep)) return null;
  if (lift === DOOR_SAID.lift && tune.doorMost === DOOR_SAID.most) return DOOR_SAID.text;
  DOOR_SAID.lift = lift;
  DOOR_SAID.most = tune.doorMost;
  DOOR_SAID.text = doorWords(lift, off, tune);
  return DOOR_SAID.text;
}

/** The words themselves, for a door past the step. */
function doorWords(lift: number, off: number, tune: typeof HOUSE_TUNE): string {
  const m = off.toFixed(2);
  if (off > tune.doorMost) {
    return lift > 0 ? `the door will stand ${m} m over the ground, out of reach of a plain jump` : `the ground will stand ${m} m over the doorstep, out of reach of a plain jump`;
  }
  return lift > 0 ? `the door will stand ${m} m over the ground: you will have to jump to get in` : `the ground will stand ${m} m over the doorstep: you will have to jump to get out`;
}

/**
 * A spot ahead of somebody, on the ground, far enough out that the house is not built on their head.
 *
 * Far enough is the patch's own half-diagonal plus the margin: a small tent may be put down almost
 * at your feet and a guild hall cannot. The patch's own offset is taken off, so what ends up that
 * far away is the middle of the building rather than its doorstep.
 *
 * **The yaw is a body's heading, whose forward is `(sin yaw, cos yaw)`**, which is what every
 * caller has in hand; the camera's own yaw is the exact opposite of it, and reading one as the
 * other puts the building behind the player rather than in front.
 */
export function spotAhead(from: { x: number; z: number }, yaw: number, p: Patch, tune = HOUSE_TUNE): { x: number; z: number } {
  const reach = Math.max(tune.ahead, Math.hypot(p.hx, p.hz) + tune.margin + 2);
  // The patch offset turns with the building, so it is taken off in the building's own frame. The
  // body's forward is the building's own +z turned the same way, which is why the two agree.
  const off = turnLocal(p.cx, p.cz, yaw, { x: 0, z: 0 });
  return { x: from.x + Math.sin(yaw) * reach - off.x, z: from.z + Math.cos(yaw) * reach - off.z };
}

/** `blockedBy`'s middle, kept: it is read into two numbers before anything else is asked. */
const MIDDLE = { x: 0, z: 0 };

/** How far from a house nothing else may stand: its own patch, plus the margin. */
export function clearRadius(p: Patch, tune = HOUSE_TUNE): number {
  return Math.hypot(p.hx, p.hz) + tune.margin;
}

/** Something the world already has standing: where it is and how big it is on the ground. */
export interface Standing {
  x: number;
  z: number;
  radius: number;
  /** What it is, so a refusal can say what is in the way rather than only that something is. */
  template?: string;
}

/**
 * Whatever the world already has standing in the way of a patch, or null.
 *
 * It is the two discs and nothing cleverer: the patch's own circle against each object's. A patch
 * is a rectangle and an object is a box, so two discs refuse a little more ground than a true test
 * would -- which is the right way to be wrong here, because the cost of refusing a spot is a step
 * to one side and the cost of taking one is a house through a cantina wall.
 *
 * The **nearest** is answered rather than the first found, so the refusal names the thing a player
 * can actually see themselves standing next to.
 */
export function blockedBy(p: Patch, at: { x: number; z: number }, yaw: number, standing: readonly Standing[], tune = HOUSE_TUNE): Standing | null {
  const reach = clearRadius(p, tune);
  // The patch's own middle, which is not the spot the building was asked for.
  const mid = patchMiddle(p, at, yaw, MIDDLE);
  const mx = mid.x;
  const mz = mid.z;
  let best: Standing | null = null;
  let bestGap = Infinity;
  for (const s of standing) {
    if (!(s.radius > 0)) continue;
    const d = Math.hypot(s.x - mx, s.z - mz);
    const gap = d - (s.radius + reach);
    if (gap >= 0) continue;
    if (gap < bestGap) {
      bestGap = gap;
      best = s;
    }
  }
  return best;
}

/**
 * What to call a thing that is in the way, out of the template the snapshot placed it under.
 *
 * Templates are paths (`object/building/general/shared_cantina.iff`), so this is the last part of
 * one with its wrapping taken off and its underscores turned back into spaces. It is for a line of
 * words a player reads and for nothing else; nothing is ever keyed on it.
 */
export function blockerName(template: string | undefined): string {
  const leaf = String(template ?? '')
    .split('/')
    .pop();
  if (!leaf) return 'something';
  const bare = leaf
    .replace(/\.iff$/i, '')
    .replace(/^shared_/, '')
    .replace(/_/g, ' ')
    .trim();
  return bare || 'something';
}
