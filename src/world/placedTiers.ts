// How far a placed object loads, by its own size (step 6 of the frame-time wave).
//
// The streamer files every placed object in a size tier -- big things from 1.7 km, middling ones from
// 750 m, small ones from 320 m -- and took the size from the snapshot's `radius`. That radius is not a
// size: it is a load distance, at least 4 m and usually 50 to 200, and the trap this project has now paid
// for four times (the flora, the colliders, the house test and this). Read as a size it put 99.9% of every
// world's objects in the first tier: Tatooine's 16,207 of 16,228 loaded to 1.7 km, a crate in a cantina
// among them.
//
// So the tier is the model's own: half the largest span of the box the manifest carries for it, over all
// three axes, its corners taken componentwise because a pack converted before the BOX chunk was understood
// has them the other way round. All three axes and not the ground plane alone, because a tall thin thing
// is seen from as far as it is tall: Theed's 30 m obelisks are a metre across and Tatooine's 66 m rock
// spires 19 m, and by their footprints they would come in at 320 m and 750 m. An object with no box of its
// own -- a particle effect, whose box says nothing of how far it is seen, or a model the pack does not
// carry -- keeps the snapshot's rule, which is what it had.
//
// A thing standing in a building's rooms is drawn only with those rooms (step 2b), and the rooms are built
// out to the building's widest door's range and a lead past it (`interiorBuildRange`, up to 360 m) whatever
// the Object reach setting says, so its own small tier's range -- 320 m at the default reach, 128 m at the
// menu's least -- could leave a room drawn through a big door with nothing in it. So a region's tier that
// holds such furniture loads at least as far as its buildings' rooms can be built from (`regionRange`): the
// widest room range the doors allow, plus how far the furthest of those buildings reaches past the region's
// box (`hostReach`). The old rule filed every indoor object in the first tier and needs none of it.
//
// `PLACED_TUNE.tierRule = 'snapshot'` is the old rule exactly: the streamer files each object by the
// snapshot's radius, as it did before any of this, so one region's objects load as the one or two tiers
// they always did. A world is filed when it is read, so the rule takes effect at the next world load (or at
// once through `__debug.placed({ rule, reload: true })`, under a loading screen): a filing cannot be swapped
// under a player without dropping the floor they stand on. The settings' object reach scales every range
// under both rules.
//
// And behind every loading screen, the models the old rule would have loaded around the arrival have their
// programs built from stand-ins (`PLACED_TUNE.warm`, `World.warmPlaced`), as the flora's are: the new rule
// loads a small thing later than the old did, and without this its programs were built in play when it came
// into range -- a starport's crates and lamps under a shuttle passenger coming down onto it.
//
// Pure: three is not imported, so the node test counts every converted world through the same arithmetic
// the streamer files and ranges with.

/** Objects at least this big (metres of half-span) load out to this range (metres). */
export const PLACED_TIERS: readonly { readonly minRadius: number; readonly range: number }[] = [
  { minRadius: 12, range: 1700 },
  { minRadius: 3, range: 750 },
  { minRadius: 0, range: 320 },
];

/** The side of a streaming region, metres. */
export const REGION = 256;

export interface PlacedTune {
  /**
   * 'model' files an object by its model's own box; 'snapshot' by the snapshot's radius, exactly as before.
   * Read when a world is read.
   */
  tierRule: 'model' | 'snapshot';
  /** Behind a loading screen, build the programs of every model the old rule would have loaded around the arrival. */
  warm: boolean;
  /**
   * The most a loading screen waits for those models to load before it compiles, in milliseconds. Ours, and 0:
   * measured on arrivals 1.5 km from Theed's starport, a 6 s wait held the screen up 5 to 7 s longer and still
   * had all 318 models in on one run of two, to save the two programs the approach otherwise builds in play.
   */
  warmWaitMs: number;
}

export const PLACED_TUNE: PlacedTune = { tierRule: 'model', warm: true, warmWaitMs: 0 };

/** A model's box as the manifest carries it: two corners, in either order. */
export interface PlacedBounds {
  min: number[];
  max: number[];
}

/**
 * Half the largest span of a model's box over its three axes, or NaN with no usable box. The corners are
 * taken componentwise (`Math.abs(max - min)`), never by which one is called `min`.
 */
export function modelSize(bounds: PlacedBounds | null | undefined): number {
  const min = bounds?.min;
  const max = bounds?.max;
  if (!min || !max || min.length < 3 || max.length < 3) return Number.NaN;
  const dx = Math.abs(max[0] - min[0]);
  const dy = Math.abs(max[1] - min[1]);
  const dz = Math.abs(max[2] - min[2]);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return Number.NaN;
  return Math.max(dx, dy, dz) / 2;
}

/** The tier a size falls in: the first whose floor it reaches, the last for anything under every floor (or NaN). */
export function tierOfSize(size: number): number {
  for (let t = 0; t < PLACED_TIERS.length; t++) if (size >= PLACED_TIERS[t].minRadius) return t;
  return PLACED_TIERS.length - 1;
}

/** The tier the snapshot's radius puts an object in: the old rule, `TIERS.findIndex(t => radius >= t.minRadius)` with none the last. */
export function snapshotTier(snapshotRadius: number): number {
  return tierOfSize(snapshotRadius);
}

/**
 * The tier an object is filed in by its model's own size, or by the snapshot's radius for a particle
 * effect or a model with no box.
 */
export function modelTier(snapshotRadius: number, bounds: PlacedBounds | null | undefined, particle = false): number {
  if (particle) return snapshotTier(snapshotRadius);
  const size = modelSize(bounds);
  return Number.isFinite(size) ? tierOfSize(size) : snapshotTier(snapshotRadius);
}

/** The tier an object is filed in under a rule. */
export function tierFor(rule: PlacedTune['tierRule'], snapshotRadius: number, bounds: PlacedBounds | null | undefined, particle = false): number {
  return rule === 'snapshot' ? snapshotTier(snapshotRadius) : modelTier(snapshotRadius, bounds, particle);
}

/** Which region a coordinate of the game's frame falls in, along one axis. */
export function regionIndex(v: number): number {
  return Math.floor(v / REGION);
}

/** The middle of a region along one axis. */
export function regionCentre(index: number): number {
  return (index + 0.5) * REGION;
}

/** How far a point is from a region's box on the ground (0 inside it): what every range test measures. */
export function boxDistance(px: number, pz: number, cx: number, cz: number): number {
  const dx = Math.max(0, Math.abs(px - cx) - REGION / 2);
  const dz = Math.max(0, Math.abs(pz - cz) - REGION / 2);
  return Math.hypot(dx, dz);
}

/**
 * A snapshot object's place in the game's frame: the snapshot is mirrored in X and centred on the layout's
 * own centre. Along X and along Z apart, so filing a world makes nothing per object.
 */
export function gameX(snapshotX: number, centreX: number): number {
  return -(snapshotX - centreX);
}
export function gameZ(snapshotZ: number, centreZ: number): number {
  return snapshotZ - centreZ;
}

/**
 * How far out from a building's middle its rooms are built from, past the widest door's range: the radius
 * the streamer's room sweep subtracts (`Building.radius`, the model's larger half-extent on the ground),
 * taken componentwise so a pack with its box's corners swapped is not read as a negative size.
 */
export function hostRadiusOf(bounds: PlacedBounds | null | undefined): number {
  const min = bounds?.min;
  const max = bounds?.max;
  if (!min || !max || min.length < 3 || max.length < 3) return 0;
  const r = Math.max(Math.abs(max[0] - min[0]), Math.abs(max[2] - min[2])) / 2;
  return Number.isFinite(r) ? r : 0;
}

/**
 * How much farther than a building's rooms are built from a region's box may be from the player while
 * those rooms stand: the building's own reach from its middle, and how far that middle is from the box.
 * Whenever the player is within R of a building's edge (its rooms built), the region's box is within
 * R plus this of the player.
 */
export function hostReach(hostX: number, hostZ: number, hostRadius: number, cx: number, cz: number): number {
  return hostRadius + boxDistance(hostX, hostZ, cx, cz);
}

/**
 * The range a region's tier loads to: its own tier's range, and under the model rule, for a tier holding a
 * building's furniture (`indoorReach` 0 or more), at least the rooms' range plus that reach, so the furniture
 * is in whenever its rooms can be built. `indoorReach` below 0 is a tier with no furniture.
 */
export function regionRange(ownRange: number, indoorReach: number, roomRange: number, rule: PlacedTune['tierRule']): number {
  if (rule !== 'model' || !(indoorReach >= 0)) return ownRange;
  const floor = roomRange + indoorReach;
  return floor > ownRange ? floor : ownRange;
}
