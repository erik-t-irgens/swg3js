// How far the small plants stand from the eye (step 5 of the frame-time wave).
//
// The client drew its static non-collidable flora -- grass tufts, shrubs, small rocks -- only out to the
// distance the terrain file gives that tiling (`TerrainTemplate.flora.nonCollidable.maximumDistance`: 50 m
// on Tatooine, Naboo and Corellia, 64 to 150 m on most other worlds) and filled the view beyond with a
// far layer of sprite cards this game does not draw. This game drew every plant of every chunk in its
// thirteen-by-thirteen window, out to about 416 m, and at the Theed starport's front that was 2,111 of the
// world pass's 3,375 draws. Non-collidable plants are 77 to 96% of a window's instances, and only 1 to 13%
// of those lie within twice the client's own distance.
//
// So each chunk's plants are a group of their own beside its trees, and a sweep a few times a second shows
// or hides that group whole by how far the chunk's middle is from the eye: inside the reach it shows, past
// the reach and a band of hysteresis it hides, and in between it stays as it was, so a walker standing on
// the line does not flicker it. The reach is a multiple of the client's own distance with a floor under it
// (ours, both: the client's own distance alone would show a chunk only when the eye is nearly in it, since
// a chunk is 64 m across). Trees are left alone unless `treeReach` is set.
//
// The distance is from the eye to the chunk's middle on its ground, in three dimensions (ours): detail
// comes in at the same distance from the eye, so the same size on the screen, whether the eye is walking or
// flying. Above about the reach no chunk's plants are drawn at all, and coming down onto the ground they
// come in square by square as each chunk's middle comes within it, exactly as they do walking. `planar`
// measures along the ground instead, which keeps a ring of plants under a flying eye however high it is
// (and draws plants two hundred metres below a ship that nobody can see).
//
// This changes the look, and is the owner's call: `FLORA_TUNE.on` false shows every plant as before, and
// the frame report's `floraReach` switch compares the two. The captured places of the creation and
// selection screens keep every plant whatever the switch says (`World.sceneOnly`): their views were chosen
// as they stood.
//
// Pure: three is not imported, so the node test reads the real terrain files through it and drives the
// sweep itself with stand-in chunks.

/** The plant reach and the sweep that applies it. Every number is ours. */
export interface FloraReachTune {
  /** False shows every plant at every distance, as before. */
  on: boolean;
  /** The reach is this many times the terrain file's own non-collidable flora distance... */
  plantReachFactor: number;
  /** ...but never under this, in metres. */
  plantReachMin: number;
  /** A reach in metres put in place of that rule (the console's `flora({ reach: 150 })`); 0 keeps the rule. */
  fixedReach: number;
  /** How far the trees (collidable flora) stand; Infinity leaves them as they were. */
  treeReach: number;
  /** Metres past the reach before a shown group is hidden again. */
  hysteresis: number;
  /** Sweeps a second. */
  sweepHz: number;
  /** Measure along the ground (x and z) rather than from the eye in three dimensions. */
  planar: boolean;
}

/** The reach as shipped: what `flora({ reach: true })` puts back. */
export const FLORA_DEFAULTS: Readonly<FloraReachTune> = Object.freeze({ on: true, plantReachFactor: 2, plantReachMin: 64, fixedReach: 0, treeReach: Number.POSITIVE_INFINITY, hysteresis: 8, sweepHz: 4, planar: false });

export const FLORA_TUNE: FloraReachTune = { ...FLORA_DEFAULTS };

/** The part of a terrain template this reads: its non-collidable flora tiling's far distance. */
export interface FloraDistances {
  flora?: { nonCollidable?: { maximumDistance?: number } | null } | null;
}

/** The terrain file's own non-collidable flora distance in metres, or 0 when it gives none. */
export function clientPlantDistance(template: FloraDistances | null | undefined): number {
  const d = template?.flora?.nonCollidable?.maximumDistance;
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : 0;
}

/**
 * How far from the eye a chunk's plants are shown, in metres: `fixedReach` when it is set, else
 * `max(plantReachMin, plantReachFactor × the client's distance)`. A template with no distance of its own
 * takes the floor.
 */
export function plantReachOf(template: FloraDistances | null | undefined, tune: FloraReachTune = FLORA_TUNE): number {
  if (Number.isFinite(tune.fixedReach) && tune.fixedReach > 0) return tune.fixedReach;
  const factor = Number.isFinite(tune.plantReachFactor) ? Math.max(0, tune.plantReachFactor) : 0;
  const least = Number.isFinite(tune.plantReachMin) ? Math.max(0, tune.plantReachMin) : 0;
  return Math.max(least, factor * clientPlantDistance(template));
}

/**
 * Whether a group is shown at distance `d` from the eye, given whether it was shown before: it comes on
 * inside `reach` and goes off only past `reach + hysteresis`, so a distance walked back and forth across
 * the line changes nothing until it has crossed the whole band. An infinite (or NaN) reach always shows.
 */
export function shownAt(d: number, reach: number, hysteresis: number, prev: boolean): boolean {
  if (!(reach < Number.POSITIVE_INFINITY)) return true;
  const band = hysteresis > 0 ? hysteresis : 0;
  return prev ? d <= reach + band : d <= reach;
}

/** What the console may say about the reach (`__debug.flora({ reach })`). */
export type ReachOption = boolean | number | Partial<FloraReachTune>;

/**
 * Apply the console's word to a tune: `false` shows every plant, `true` puts the reach back exactly as
 * shipped (`FLORA_DEFAULTS`, a reach typed in metres and every number moved included), a number is the
 * reach in metres (on, in place of the rule until `true`), and an object moves any of the fields. A value
 * that is not a usable number is ignored. Answers whether the reach is on afterwards.
 */
export function applyReachOption(tune: FloraReachTune, opt: ReachOption | null | undefined): boolean {
  if (opt === false) tune.on = false;
  else if (opt === true) Object.assign(tune, FLORA_DEFAULTS);
  else if (typeof opt === 'number') {
    if (Number.isFinite(opt) && opt > 0) {
      tune.fixedReach = opt;
      tune.on = true;
    }
  } else if (opt && typeof opt === 'object') {
    for (const k of ['plantReachFactor', 'plantReachMin', 'fixedReach', 'treeReach', 'hysteresis', 'sweepHz'] as const) {
      const v = opt[k];
      if (typeof v === 'number' && !Number.isNaN(v) && v >= 0) tune[k] = v;
    }
    if (typeof opt.planar === 'boolean') tune.planar = opt.planar;
    if (typeof opt.on === 'boolean') tune.on = opt.on;
  }
  return tune.on;
}

/** The part of a group the sweep writes and counts: a chunk's `trees` or `plants`. */
export interface FloraGroupLike {
  visible: boolean;
  readonly children: readonly unknown[];
}

/** The part of a chunk the sweep reads: its middle on its ground, and its two groups (null for a chunk of procedural props). */
export interface FloraChunk {
  readonly mx: number;
  readonly my: number;
  readonly mz: number;
  readonly trees: FloraGroupLike | null;
  readonly plants: FloraGroupLike | null;
}

/** The copies the instanced meshes directly under a group hold between them. */
export function instancesUnder(g: FloraGroupLike): number {
  let n = 0;
  const kids = g.children;
  for (let i = 0; i < kids.length; i++) {
    const m = kids[i] as { isInstancedMesh?: boolean; count?: number };
    if (m.isInstancedMesh) n += m.count ?? 0;
  }
  return n;
}

/**
 * The sweep: where it last measured from, with what reach, whether it measures at all, its clock, and what
 * it left. The world owns one, begins a sweep a few times a second and hands it each chunk (`visit`), and
 * hands it a chunk the moment it is made (`show`), so a chunk made far off never shows its plants for the
 * quarter second until the next sweep. Before any sweep has measured, and while it is not active (the reach
 * off, no flora of the planet's own, a captured place on the screen), everything is shown as it always was.
 * Only a change of `visible` is written. Nothing is allocated.
 */
export class PlantSweep {
  eyeX = 0;
  eyeY = 0;
  eyeZ = 0;
  /** The plants' reach in force since the last `begin`; Infinity while not active. */
  reach = Number.POSITIVE_INFINITY;
  /** Whether the last `begin` hides anything at all. */
  active = false;
  /** Whether a sweep has measured since the world was made or last let go. */
  measured = false;
  /** Seconds since the last sweep began. */
  age = 0;
  /** What the last sweep left: plant groups shown and hidden, the plants in each, and sweeps since the session began. */
  readonly stats = { shown: 0, hidden: 0, shownInstances: 0, hiddenInstances: 0, sweeps: 0 };

  /** Whether a sweep is due, with the clock moved on by `dt`: always before the first, when forced, and `sweepHz` times a second after. */
  due(dt: number, tune: FloraReachTune = FLORA_TUNE, force = false): boolean {
    this.age += dt;
    if (force || !this.measured) return true;
    const hz = tune.sweepHz > 0 ? tune.sweepHz : 4;
    return this.age >= 1 / hz;
  }

  /** A sweep starts from an eye with a reach (`active` false shows every plant); the counts start again. */
  begin(x: number, y: number, z: number, reach: number, active: boolean): void {
    this.eyeX = x;
    this.eyeY = y;
    this.eyeZ = z;
    this.reach = active ? reach : Number.POSITIVE_INFINITY;
    this.active = active;
    this.measured = true;
    this.age = 0;
    const s = this.stats;
    s.shown = 0;
    s.hidden = 0;
    s.shownInstances = 0;
    s.hiddenInstances = 0;
    s.sweeps++;
  }

  /** A world let go: nothing is measured until the next world's first sweep. */
  reset(): void {
    this.measured = false;
    this.active = false;
    this.reach = Number.POSITIVE_INFINITY;
    this.age = 0;
  }

  /** One chunk's plants and trees shown or hidden by the last sweep's eye and reach, with the band of hysteresis. */
  show(c: FloraChunk, tune: FloraReachTune = FLORA_TUNE): void {
    const p = c.plants;
    const t = c.trees;
    if (!p && !t) return;
    const on = this.active && this.measured;
    let d = 0;
    if (on) {
      const dx = c.mx - this.eyeX;
      const dz = c.mz - this.eyeZ;
      const dy = tune.planar ? 0 : c.my - this.eyeY;
      d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const band = tune.hysteresis;
    if (p) {
      const v = on ? shownAt(d, this.reach, band, p.visible) : true;
      if (p.visible !== v) p.visible = v;
    }
    if (t) {
      const v = on ? shownAt(d, tune.treeReach, band, t.visible) : true;
      if (t.visible !== v) t.visible = v;
    }
  }

  /** `show`, and the chunk's plants counted into the sweep's stats: what the sweep hands every chunk. */
  visit(c: FloraChunk, tune: FloraReachTune = FLORA_TUNE): void {
    this.show(c, tune);
    const p = c.plants;
    if (!p) return;
    const n = instancesUnder(p);
    const s = this.stats;
    if (p.visible) {
      s.shown++;
      s.shownInstances += n;
    } else {
      s.hidden++;
      s.hiddenInstances += n;
    }
  }
}
