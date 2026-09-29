// Streams a planet's world-snapshot objects around the player: the layout is bucketed into
// 256 m regions, each region loads its models and instances in size tiers (big buildings from
// far away, small props up close), and exact trimesh collision follows the player.

import * as THREE from 'three';
import { relativeRoot } from './packPath.ts';
import { cleanTrimesh, Group, groups, RAPIER as R, TRIMESH_FLAGS, type Physics } from '../core/physics';
import { splitTrimesh } from './trimeshPieces.ts';
import type { AssetPack, Layout, LoadedModel, PackEffect, PackModelDef } from './assetPack';
import { CHUNK_SIZE } from './terrain';
import type { Exclusion } from './props';
import { ACTOR_LAYER, INTERIOR_LAYER, crossing } from './portalRender';
import { INTERIOR_LEAD, PORTAL_RANGE, interiorBuildRange, interiorBuildRangeMax, isQuarantined, markNarrowRoot } from './portalVis.ts';
import { FURNITURE_ROLE, FURNITURE_TUNE, FurnitureIndex, HOST_FLAG, furnitureDraw, furnitureHosts, furnitureOn, markFurniture, splitCopies, type FurnitureDraw, type FurnitureGroup, type HostAnswer } from './furnitureHost.ts';
import { mirroredTransform, type EffectHandle, type ParticleEffects } from './particles';
import { castsShadow, drawsAfterWater, isBasinWater } from './surfaces';
import { marks } from './marks.ts';
import { floraClearRadius, modelReach } from './floraClear.ts';
import { boxDistance, gameX, gameZ, hostRadiusOf, hostReach, modelTier, PLACED_TIERS, PLACED_TUNE, REGION, regionCentre, regionIndex, regionRange, snapshotTier } from './placedTiers.ts';
// Which room a name picks is a rule of its own, with a node test over it; this file calls it rather
// than keeping a second copy.
import { namedCellIndex } from './cloning.ts';
import { buildingWithRoomIn } from './roomOf.ts';
import { LevelGroup } from './levelGroup.ts';
import { LOD_LEVEL_TUNE, sweepDue } from './lodLevels.ts';

/** The side of a streaming region, metres: one number with the tier arithmetic's (`placedTiers.ts`). */
export { REGION };

/**
 * Objects at least this big load out to this range (metres). The size is the model's own box, never the
 * snapshot's radius, unless `PLACED_TUNE.tierRule` said 'snapshot' when the world was read (step 6,
 * `placedTiers.ts`).
 */
const TIERS = PLACED_TIERS;
/** Metres out to which the biggest placed objects (a starport's buildings among them) load, at the game's own reach. */
export function nearTierRange(): number {
  return TIERS[0].range;
}
const UNLOAD_SLACK = 1.15;
/**
 * Interiors exist only this far from the building's edge (160 m). The portal renderer draws a room
 * only through a doorway within its range (120 m, farther for a big door: `interiorRange`) that
 * is actually on screen, so anything past this is scene-graph weight that can never be seen; the
 * 40 m between the two (`INTERIOR_LEAD`) is the walk the rooms' programs have to compile in before
 * a door can show them. Dropped a little farther out than it is built so walking a threshold does
 * not build and drop it every frame.
 */
const INTERIOR_RANGE = PORTAL_RANGE + INTERIOR_LEAD;
const INTERIOR_DROP = 220;
const COLLIDER_RANGE = 170;
const COLLIDER_MIN_RADIUS = 1.5;
/**
 * How near the furniture inside a building is made solid, metres. Invented.
 *
 * It is a rule of its own, and the reason is the trap this project has now paid for three times: a
 * snapshot's `radius` is a **load distance and not a size**. Out in the open that costs nothing,
 * because the test subtracts it and a thing loaded from far off is usually big; measured over every
 * converted world the smallest radius any contained object carries is 32 and the largest is over a
 * kilometre, so read the same way a crate in a cantina would be solid from half a mile away. Taken
 * as a plain distance to the thing itself and measured over every converted world, the worst spot
 * in the game is 360 colliders and 57,440 triangles (a town on the desert world; Corellia's worst is
 * 295 and 68,683). That is about 25 ms of building, and only when the whole lot arrives at once,
 * which happens behind a loading screen: the sweep runs when the player has moved twelve metres, so
 * walking into a town brings them in a few at a time.
 */
const COLLIDER_INDOOR_RANGE = 60;

/**
 * Whether an object is out of range of the collider sweep, by whichever rule it answers to.
 *
 * One function because the build and the drop must agree exactly: two copies of this arithmetic
 * that disagree by a metre build a collider and drop it again on every pass.
 */
function colliderFar(o: PlacedObject, px: number, pz: number, slack: number): boolean {
  const d = Math.hypot(o.x - px, o.z - pz);
  return o.contained ? d > COLLIDER_INDOOR_RANGE * slack : d - o.radius > COLLIDER_RANGE * slack;
}
/**
 * The widest radius the collider sweep reaches for. An object wider than this (the Star Destroyer,
 * whose radius counts from a model origin that is not its middle) is "huge": its collision is built
 * with its tier, whatever the player's distance, a piece at a time.
 */
const COLLIDER_RADIUS_CAP = 600;
/** A huge object's collision is built in pieces of at most this many triangles (about 2 ms each with TRIMESH_FLAGS). */
const HUGE_PIECE_TRIANGLES = 4000;
/** Milliseconds of huge-object pieces built per update (at least one piece a call). */
const HUGE_BUILD_MS = 3;

/** A huge object's collision being built: which primitive, its pieces once split, and the next piece. */
interface HugeJob {
  o: PlacedObject;
  prim: number;
  pieces: { vertices: Float32Array; indices: Uint32Array }[] | null;
  next: number;
}
/**
 * Model radius below which a placed object does not cast a shadow. Shadow casters are culled
 * against the light's frustum rather than the camera's, so every small prop in the cascades'
 * reach costs a draw call per cascade for a shadow the size of its own footprint.
 */
const SHADOW_MIN_RADIUS = 1.2;
const MAX_CONCURRENT_LOADS = 3;

export interface PlacedObject {
  model: string;
  template: string;
  x: number;
  y: number;
  z: number;
  q: THREE.Quaternion;
  radius: number;
  contained: boolean;
  /** The tier it is filed in, by the rule in force when the world was read (`LayoutStreamer.filing`). */
  tier: number;
  /** The tier each rule would file it in, for the console's counts (step 6): by its model's own size, and by the snapshot's radius. */
  sizeTier: number;
  snapTier: number;
  /** Given collision whatever its size: a thing put down in play, never a snapshot's own prop. */
  solid?: boolean;
  /** The object template whose client-data effects it carries, where `template` is a name of its own (a thing put down in play). */
  effectsOf?: string;
  /**
   * For a thing standing in a building's rooms: the placed building that holds it (`furnitureHost.ts`),
   * absent where no room box holds it or where it stands in a doorway, and the rooms it can be seen in.
   * It is drawn with that building's rooms, in that building's pass, and nowhere else.
   */
  host?: PlacedObject;
  roomsLo?: number;
  roomsHi?: number;
  /** `HOST_FLAG` bits. */
  hostFlags?: number;
  /** The snapshot's own word on where it stands (step 7): its building's index in the layout's objects, and its room. */
  hostIndex?: number;
  cell?: number;
}

/**
 * One object put into a world that is already streaming, in the **world's** own frame.
 *
 * The snapshot's objects arrive mirrored and centred on their layout, and the constructor undoes
 * both before it makes a `PlacedObject`; anything placed in play is already where it is going, so
 * this is what the constructor's loop produces rather than what it reads.
 */
export interface RuntimePlacement {
  model: string;
  template: string;
  x: number;
  y: number;
  z: number;
  q: THREE.Quaternion;
  /** Its load radius: which size tier it belongs to and how far off it is drawn. */
  radius: number;
  /** How much ground round it the procedural flora keeps off, metres. Zero leaves the flora alone. */
  clear?: number;
  /**
   * Solid whatever its size.
   *
   * The collider sweep has a floor under which nothing is given collision, because a snapshot places
   * tens of thousands of small props and a collider apiece is not worth it. A thing the game itself
   * puts down in play is not one of those: a travel terminal is 1.6 m across, well under the floor,
   * and it is the very thing a player walks up to and presses.
   */
  solid?: boolean;
  /**
   * Standing inside a building rather than out in the open.
   *
   * It changes two things and both matter: the mesh joins the actor layer, without which it is
   * stencilled out of the room's own pass and shows only through a doorway; and its collision takes
   * the indoor rule, so a walker indoors is stopped by it rather than filtering it out with the
   * building's shell. The place is still the world's, as it is for anything else placed in play.
   */
  inside?: boolean;
  /**
   * The object template whose client data says what hangs on it (a brazier's fire, a fountain's spray,
   * a torch's flame), looked up in the packs' object-effects tables. Apart from `template`, because a
   * thing put down in play is filed under a name of its own so a removal finds exactly it.
   */
  effectsOf?: string;
}

/** A placed portal building; the player's cell inside it is tracked by crossing its portals. */
export interface Building {
  model: LoadedModel;
  /** The object template the snapshot placed it under, which is what says what kind of place it is. */
  template: string;
  x: number;
  z: number;
  radius: number;
  matrix: THREE.Matrix4;
  inverse: THREE.Matrix4;
  /**
   * This building's own interior meshes, hidden until the portal renderer draws the building.
   * Empty until the player is close enough for a doorway to show anything: a building's inside
   * is the bulk of its geometry and is never visible from across the valley.
   */
  interior: THREE.Mesh[];
  /**
   * The room each of `interior`'s meshes belongs to, index for index, so the portal renderer can show
   * only the rooms the frame's visible set reached. Absent until the interior is built.
   */
  interiorCell?: Int16Array;
  /** Whether `interior` is currently built, so the sweep can tell "not yet" from "has none". */
  interiorBuilt: boolean;
  /**
   * The furniture standing in its rooms, one group per tier, model and piece (commit 2b): the portal
   * renderer shows each with the rooms it can be seen in, in this building's pass. The one list for this
   * placed building whatever tier its furniture loads in, so the building and its furniture may arrive in
   * either order. Optional only for a hand-built stand-in in a test.
   */
  furniture?: FurnitureGroup[];
  /**
   * The placed object this building was made from, which is the key its **collision** is held
   * under: a building's colliders come and go with the player's distance while the building
   * itself stays, so anything standing on its floors has to be able to ask whether there is one
   * (`cellsSolid`). Optional only so that a hand-built stand-in in a test need not carry one.
   */
  object?: PlacedObject;
}

interface LoadedTier {
  meshes: THREE.Object3D[];
  buildings: Building[];
  objects: PlacedObject[];
  /** Particle effects placed with this tier: effects of their own, and those attached to its models. */
  effects: EffectHandle[];
  /** The water standing in its fountains' and pools' basins, drawn by the world's water system. */
  waters: WaterSurfaceHandle[];
  /** Its furniture groups and the building each is filed under (null: one of a switch's pairs), so an unload takes each out of its list. */
  furniture: { g: FurnitureGroup; host: PlacedObject | null }[];
  /** Its models' outdoor copies drawn at the client's own detail levels (step 7), whose meshes are among `meshes`. */
  levels: LevelGroup[];
}

/**
 * A basin's water the world made for one placed copy: the mesh (so the tier can prepare it with its own
 * before it is shown), and how to take it away again.
 */
export interface WaterSurfaceHandle {
  mesh: THREE.Mesh;
  remove(): void;
}

interface Region {
  rx: number;
  rz: number;
  cx: number;
  cz: number;
  objects: PlacedObject[][];
  tiers: (LoadedTier | 'loading' | null)[];
  /**
   * Per tier, how far past its buildings' rooms' own range the furniture it holds may stand from the region's
   * box (`hostReach`), or -1 for a tier holding no building's furniture: the floor under the tier's range
   * that keeps a room drawn through a door from being drawn empty (`regionRange`, step 6).
   */
  indoor: number[];
}

/** A region with nothing in it yet. */
function newRegion(rx: number, rz: number): Region {
  return { rx, rz, cx: regionCentre(rx), cz: regionCentre(rz), objects: TIERS.map(() => []), tiers: TIERS.map(() => null), indoor: TIERS.map(() => -1) };
}

const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const localA = new THREE.Vector3();
const localB = new THREE.Vector3();
/** The padded box a cell-follow tests a point against: one scratch, since a ship is followed as often as the player. */
const tmpBox = new THREE.Box3();
/** Where a placed object's own model box sits once it is turned: `blockersNear`'s alone, so nothing it does can disturb a sweep. */
const blockCentre = new THREE.Vector3();

/**
 * Something to hide behind, as `blockersNear` hands it over: a disc over a placed object's
 * footprint and the world height of its top. Whoever asks may keep more fields on the objects it
 * passes in (the cover search keeps a gap on each); this writes these four and no others.
 */
export interface NearBlocker {
  x: number;
  z: number;
  /** Half the widest span of the model's own box: a disc that covers it, whatever way it is turned. */
  radius: number;
  /** The world height of its top. */
  topY: number;
}

/**
 * One placed object's standing shape, worked out **once** when its collision was built: the streamer
 * keeps a flat list of these and `blockersNear` walks that rather than the collider map.
 *
 * Why it is a list and not the map. The map is every object with collision within `COLLIDER_RANGE`
 * of the player, which on the owner's own worlds is a median of about 540 and as many as 1,424; the
 * map walk cost a model lookup, a quaternion turn and a `Math.hypot` each, the entry destructuring
 * allocated a pair an entry, and the early exit fires only once two dozen have been *accepted* --
 * so the fill ran the whole map exactly where cover matters most, which is a body standing in the
 * open with little near it. Measured in node at the real densities that walk was 28, 57 and 74
 * microseconds at 540, 1,081 and 1,424 objects, four times a step; this list with a squared distance
 * is 0.6, 1.0 and 1.4. The cost is at last flat in how crowded the world is, which is what the cover
 * wave claimed it was.
 */
interface BlockRec {
  /** Whose record this is, so a removal can put the list's last entry back in its place. */
  o: PlacedObject;
  x: number;
  z: number;
  radius: number;
  topY: number;
}

/** Where the player is: outside (cell 0 of no building) or in a cell of a building. */
export interface CellState {
  building: Building;
  cell: number;
}

/** The one empty effect list every object without any shares, so a lookup allocates nothing. */
const NO_EFFECTS: readonly PackEffect[] = [];

/** What one object placed in play brought with it, so taking it out again is exact. */
interface RuntimeRec {
  tier: LoadedTier;
  meshes: THREE.Object3D[];
  building: Building | null;
  effects: EffectHandle[];
  waters: WaterSurfaceHandle[];
  furniture: { g: FurnitureGroup; host: PlacedObject | null }[];
}

export class LayoutStreamer {
  readonly buildings = new Set<Building>();
  readonly objects: PlacedObject[] = [];
  private readonly regions = new Map<string, Region>();
  private readonly exclusionCells = new Map<string, Exclusion[]>();
  private readonly colliders = new Map<PlacedObject, R.Collider[]>();
  /**
   * Which object template each collider belongs to, so a ray that hits something can say what it is
   * made of (every template carries a surface type, and the planet's sound pack keeps the ones that
   * are not the default). Filled and emptied in the same two places the colliders themselves are.
   */
  private readonly colliderTemplate = new Map<number, string>();
  /**
   * What stands where, for whatever asks what a body could hide behind: one record per object with
   * collision, filled and emptied in the same two places the colliders themselves are, and kept as a
   * flat list with an index beside it so that a removal is a swap rather than a walk.
   */
  private readonly blockList: BlockRec[] = [];
  private readonly blockAt = new Map<PlacedObject, number>();
  /** Objects wider than COLLIDER_RADIUS_CAP. Must stay a field initialiser: the constructor's loop fills it. */
  private readonly huge = new Set<PlacedObject>();
  /**
   * What each object placed in play brought with it, so taking it out again is exact.
   *
   * A tier built the ordinary way shares one instanced mesh between every copy of a model in it, so
   * there is no such thing as taking one copy out; an object placed in play gets meshes of its own
   * (an instanced mesh of one, which is what the pack's materials and the portal renderer expect to
   * see) and this is where they are kept.
   */
  private readonly runtime = new Map<PlacedObject, RuntimeRec>();
  /**
   * What each object placed in play was filed under, which is its `template`: the runtime ones are
   * given a name of their own (a home carries the id the server gave it) and it is a name nothing
   * in a snapshot has, so a removal is one lookup and can never reach a snapshot object by accident.
   */
  private readonly placedByKey = new Map<string, PlacedObject>();
  /** Huge objects whose collision is still being built, a few pieces an update. A field initialiser, as `huge`. */
  private readonly hugeQueue: HugeJob[] = [];
  /**
   * The buildings that can host furniture, over the ground (`furnitureHost.ts`), by an index of their own:
   * the layout's objects at the places they were read in (`hostObjects`, a copy, since `objects` is spliced
   * when something put down in play is taken up), and a house put down in play after them. Field
   * initialisers, as `huge`: the constructor's own pass fills them.
   */
  private furnitureIndex = new FurnitureIndex(FURNITURE_TUNE);
  private readonly hostObjects: PlacedObject[] = [];
  private readonly hostIds = new Map<PlacedObject, number>();
  /** Each placed building's furniture groups, one list whatever tier they load in; the `Building` shares it. */
  private readonly furnitureByHost = new Map<PlacedObject, FurnitureGroup[]>();
  /** The meshes a furniture switch flip trades between (`FURNITURE_ROLE.whenOn`, `whenOff`), filed under no building. */
  private readonly furnitureSwaps = new Set<FurnitureGroup>();
  /** What `applyFurniture` works a group's drawing out into, kept. */
  private readonly furnitureNow: FurnitureDraw = { wait: true, routed: false, visible: false, rooms: false, castShadow: false };
  /** The group a tier's mesh is, so its reveal and the switch know it. */
  private readonly furnitureOfMesh = new WeakMap<THREE.Object3D, FurnitureGroup>();
  /** Whether the groups are drawn per building now (`syncFurniture`), as the switch stands when the world is read. */
  private furnitureRouted = furnitureOn();
  /** What hosting found when the layout was read, for the console. */
  furnitureStats = { contained: 0, hosted: 0, noBox: 0, twoHosts: 0, doorway: 0, hosts: 0, exact: 0 };
  private readonly hostAnswer: HostAnswer = { host: -1, lo: 0, hi: 0, flags: 0 };
  private loads = 0;
  private readonly failed = new Set<string>();
  /** The widest object's radius, which widens the region sweep for colliders. */
  private largestRadius = 0;
  private lastColliderX = Number.NaN;
  private lastColliderZ = Number.NaN;
  /** Where the last interior sweep ran, so a region loading in knows what is near. */
  private lastInteriorX = Number.NaN;
  private lastInteriorZ = Number.NaN;
  private lastInside: Building | null = null;
  private disposed = false;
  loadedModels = 0;
  loadedInstances = 0;
  /**
   * The rule this world's objects were filed by (`PLACED_TUNE.tierRule` when it was read, step 6): changed
   * only by `refile`, which drops every tier, so only ever under a loading screen.
   */
  private filingRule: 'model' | 'snapshot' = PLACED_TUNE.tierRule;

  /** The rule this world's objects are filed by. */
  get filing(): 'model' | 'snapshot' {
    return this.filingRule;
  }
  /** How far each size tier loads, in metres; a world can reach farther than a planet does. */
  private ranges: number[];
  /**
   * Build a tier's programs before it is drawn (the world sets it to its own paced queue). A tier
   * used to be added to the scene the moment its models had loaded, and whatever materials it
   * brought that nothing had built yet were built on the frame that first drew them: standing still
   * on a planet while this ran made thirteen programs and two frames of over a second. So with this
   * set the meshes go in hidden and are shown once their programs exist, which costs a moment's
   * more pop-in on a fast machine and takes a freeze off a slow one. Null puts the old behaviour
   * back exactly.
   */
  prepare: ((objects: THREE.Object3D[]) => Promise<void>) | null = null;

  /**
   * Makes a water body of a basin's water for one placed copy (`isBasinWater`): the world's, since the
   * water system is. The model's own piece is then not drawn for that copy. Null draws every basin as
   * the blended surface the model carries, which is what happened before.
   */
  waterSurface: ((geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, name: string) => WaterSurfaceHandle | null) | null = null;

  /** Hand a basin's water to the world for each of these copies, and say which the world would not take. */
  private basinWater(prim: { geometry: THREE.BufferGeometry }, copies: readonly PlacedObject[], name: string, into: WaterSurfaceHandle[]): PlacedObject[] {
    const refused: PlacedObject[] = [];
    for (const p of copies) {
      const h = this.waterSurface ? this.waterSurface(prim.geometry, new THREE.Matrix4().compose(tmpV.set(p.x, p.y, p.z), p.q, ONE), name) : null;
      if (!h) {
        refused.push(p);
        continue;
      }
      // Hidden until its programs exist, like every mesh the tier makes; the tier shows it after `prepare`.
      if (this.prepare) h.mesh.visible = false;
      into.push(h);
    }
    return refused;
  }

  /**
   * Other packs to look in for anything the planet's own does not carry.
   *
   * A house is not in the world it is built on: the snapshot packs hold what the game's own worlds
   * placed, and a player's house is in the gallery pack, which is loaded once and then stands behind
   * the planet's for the rest of the session. A prop a player puts down is the same thing out of the
   * props pack, which is why this is a list rather than the one slot it began as -- somebody with a
   * house up and a chair in it needs both behind the world at once. Nothing about a model changes
   * for being found in one: it is instanced, collided, walked and lit exactly as a snapshot object
   * is, so the whole of the difference is these three lookups.
   */
  private readonly guests: AssetPack[] = [];

  /** Stand another pack behind this world's own. Calling it again with the same pack does nothing. */
  useGuestPack(pack: AssetPack | null): void {
    if (pack && !this.guests.includes(pack)) this.guests.push(pack);
  }

  private defOf(id: string): PackModelDef | undefined {
    const mine = this.pack.find(id);
    if (mine) return mine;
    for (const g of this.guests) {
      const hit = g.find(id);
      if (hit) return hit;
    }
    return undefined;
  }

  private loadedOf(id: string): LoadedModel | null {
    const mine = this.pack.loaded(id);
    if (mine) return mine;
    for (const g of this.guests) {
      const hit = g.loaded(id);
      if (hit) return hit;
    }
    return null;
  }

  private modelOf(id: string): Promise<LoadedModel> {
    if (this.pack.find(id)) return this.pack.model(id);
    for (const g of this.guests) if (g.find(id)) return g.model(id);
    return this.pack.model(id);
  }

  /**
   * An effect file a model's entry names, as the effects loader must be handed it: that loader resolves
   * every file against this world's own pack. An entry out of a guest pack names its effects relative
   * to that pack, so the file is re-rooted there -- the gallery's garden fountains name
   * `particles/fx_pt_fountain_garden.json`, and when the gallery stood behind the world ahead of the
   * props pack (any world with a house on it) a fountain put down from the Props tab found the
   * gallery's entry and fetched its spray from the world's folder, where it is not. A file that already
   * climbs out of the world's pack (`../props/...`, which is how the props command writes them) is
   * left as it is.
   */
  /**
   * The effects one kind of placed object carries by its client data, out of this world's own table
   * first and then each pack standing behind it, whose files are re-rooted as `effectFile` does. Empty
   * for a template that hangs nothing, and for every template of a pack converted before the table.
   */
  private templateEffects(template: string | undefined): readonly PackEffect[] {
    if (!template) return NO_EFFECTS;
    const own = this.pack.objectEffects?.[template];
    if (own) return own;
    for (const g of this.guests) {
      const hit = g.objectEffects?.[template];
      if (!hit) continue;
      const root = relativeRoot(this.pack.root, g.root);
      return hit.map((e) => (e.file.startsWith('../') ? e : { ...e, file: root + e.file }));
    }
    return NO_EFFECTS;
  }

  private effectFile(def: PackModelDef, file: string): string {
    if (file.startsWith('../') || this.pack.find(def.id) === def) return file;
    for (const g of this.guests) if (g.find(def.id) === def) return relativeRoot(this.pack.root, g.root) + file;
    return file;
  }

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: Physics,
    private readonly pack: AssetPack,
    layout: Layout,
    private readonly effects: ParticleEffects | null = null,
    options: { reach?: number; hugeColliders?: boolean } = {},
  ) {
    this.ranges = TIERS.map((t) => t.range * (options.reach ?? 1));
    // Only a space pack's radii are the models' own (the space command measures them): a planet's
    // snapshot gives thousands of ordinary objects a radius of 1024 m or more, which must not all be
    // built tier-wide as huge.
    const hugeColliders = options.hugeColliders ?? false;
    // Each model's entry, by id: read for every object below (its own size, what it keeps flora off, and the
    // building each thing standing in a room belongs to). A lookup by id rather than `pack.find`, which walks
    // every entry and would be asked once for each of tens of thousands of objects.
    const defs = new Map<string, PackModelDef>();
    for (const list of Object.values(pack.manifest.categories)) for (const d of list) defs.set(d.id, d);
    for (const o of layout.objects) {
      // Snapshot space is mirrored in X and centred on the layout centre.
      const gx = gameX(o.x, layout.center.x);
      const gz = gameZ(o.z, layout.center.z);
      const def = defs.get(o.model);
      // Filed by the rule in force as the world is read: the model's own size, or the snapshot's radius as
      // before (step 6). Both answers are kept for the console's counts.
      const sizeTier = modelTier(o.radius, def?.bounds, !!def?.particle);
      const snapTier = snapshotTier(o.radius);
      const p: PlacedObject = { model: o.model, template: o.template, x: gx, y: o.y, z: gz, q: new THREE.Quaternion(o.q[1], -o.q[2], -o.q[3], o.q[0]), radius: o.radius, contained: !!o.contained, tier: this.filing === 'snapshot' ? snapTier : sizeTier, sizeTier, snapTier };
      // The building and the room the snapshot itself names (step 7): an index into this same list, which the
      // loop fills in the layout's own order.
      if (o.contained && typeof o.in === 'number' && typeof o.cell === 'number') {
        p.hostIndex = o.in;
        p.cell = o.cell;
      }
      this.objects.push(p);
      const region = this.regionFor(gx, gz);
      region.objects[p.tier].push(p);
      // What this object keeps flora off: its own model's reach, never the snapshot's radius, which
      // is a load distance and on some worlds is kilometres. See `floraClear.ts` -- read as the
      // snapshot's, it left eight of the eighteen worlds with no procedural flora at all.
      if (!p.contained) {
        const clear = floraClearRadius(o.radius, def?.bounds ?? null);
        if (clear > 0) this.addExclusion({ x: gx, z: gz, r: clear });
      }
      if (!p.contained) this.largestRadius = Math.max(this.largestRadius, Math.min(p.radius, COLLIDER_RADIUS_CAP));
      if (hugeColliders && !p.contained && p.radius > COLLIDER_RADIUS_CAP) this.huge.add(p);
    }
    // Which building each thing standing in a room belongs to (commit 2b): read once, from the manifest's
    // own room boxes, so no model need be loaded.
    const hosted = furnitureHosts(this.objects, (id) => defs.get(id), FURNITURE_TUNE);
    this.furnitureIndex = hosted.index;
    this.furnitureStats = hosted.stats;
    for (let i = 0; i < this.objects.length; i++) {
      const p = this.objects[i];
      this.hostObjects.push(p);
      if (!p.contained || hosted.host[i] < 0) continue;
      const f = hosted.flags[i];
      p.hostFlags = f;
      // A thing in a doorway stands partly outside: it keeps the old rule, drawn in every pass.
      if (f & HOST_FLAG.doorway) continue;
      p.host = this.objects[hosted.host[i]];
      p.roomsLo = hosted.rooms[i * 2];
      p.roomsHi = hosted.rooms[i * 2 + 1];
      this.noteIndoor(p, defs.get(p.host.model));
    }
  }

  /** The region a point of the game's frame falls in, made the first time anything is filed there. */
  private regionFor(x: number, z: number): Region {
    const rx = regionIndex(x);
    const rz = regionIndex(z);
    const key = `${rx},${rz}`;
    let region = this.regions.get(key);
    if (!region) {
      region = newRegion(rx, rz);
      this.regions.set(key, region);
    }
    return region;
  }

  /**
   * A thing filed under a building's rooms raises its region tier's furniture reach (`Region.indoor`) to how
   * far that building reaches past the region's box, so the tier loads whenever the building's rooms can be
   * built (`regionRange`). Read once, when it is filed; a house taken up later leaves the reach where it was,
   * which only loads that tier a little farther out than it needs.
   */
  private noteIndoor(p: PlacedObject, hostDef: PackModelDef | undefined): void {
    const host = p.host;
    if (!host) return;
    const region = this.regions.get(`${regionIndex(p.x)},${regionIndex(p.z)}`);
    if (!region) return;
    const reach = hostReach(host.x, host.z, hostRadiusOf(hostDef?.bounds), region.cx, region.cz);
    if (reach > region.indoor[p.tier]) region.indoor[p.tier] = reach;
  }

  /** A placed building's furniture list, made the first time anything asks for it. */
  private furnitureList(host: PlacedObject): FurnitureGroup[] {
    let list = this.furnitureByHost.get(host);
    if (!list) this.furnitureByHost.set(host, (list = []));
    return list;
  }

  /**
   * Draw one group as the switch now says, once its programs exist (`furnitureDraw`): a building's own,
   * per building, is on the rooms' layer alone, casts nothing and is shown only by the portal renderer,
   * with its building's rooms; with the switch off its twin, the old rule's one mesh of every indoor copy,
   * is drawn on the actor layer in its place (or, a thing put down in play, its own mesh of one is). Nothing
   * about it is in a program's key, and a room's furniture is compiled for both passes whatever layer it is
   * on (`markFurniture`). A group whose programs are still being built is left hidden and on the layers it
   * was built with. One the portal renderer hid for failing to draw is never shown again.
   */
  private applyFurniture(g: FurnitureGroup): void {
    const d = furnitureDraw(g, this.furnitureRouted, isQuarantined(g.mesh), this.furnitureNow);
    g.routed = d.routed;
    if (d.wait) return;
    const m = g.mesh;
    if (d.rooms) m.layers.set(INTERIOR_LAYER);
    else {
      m.layers.set(0);
      m.layers.enable(ACTOR_LAYER);
    }
    (m as THREE.Mesh).castShadow = d.castShadow;
    m.visible = d.visible;
  }

  /**
   * Draw the furniture per building or everywhere, as `on` says (`furnitureOn()`, asked every frame): only
   * a change walks the groups.
   */
  syncFurniture(on: boolean): void {
    if (on === this.furnitureRouted) return;
    this.furnitureRouted = on;
    for (const list of this.furnitureByHost.values()) for (const g of list) this.applyFurniture(g);
    for (const g of this.furnitureSwaps) this.applyFurniture(g);
  }

  /** A tier's mesh shown once its programs exist: a furniture group as the switch says, anything else plainly. */
  private reveal(mesh: THREE.Object3D): void {
    // A level's mesh is shown only while its level holds a copy (step 7).
    const lg = this.levelOfMesh.get(mesh);
    if (lg) {
      lg.setReady();
      return;
    }
    const g = this.furnitureOfMesh.get(mesh);
    if (!g) {
      mesh.visible = true;
      return;
    }
    g.ready = true;
    this.applyFurniture(g);
  }

  /**
   * What the furniture came to, for the console: hosting as read, and the meshes standing now -- per
   * building (`groups`, of which `ready` have their programs and `perBuilding` are drawn with their rooms),
   * the rest of the indoor copies drawn beside them with the switch on (`whenOn`), and the old rule's
   * meshes drawn in their place with it off (`whenOff`).
   */
  furnitureReport(): { routed: boolean; hosting: LayoutStreamer['furnitureStats']; buildings: number; groups: number; ready: number; perBuilding: number; standing: number; whenOn: number; whenOff: number } {
    let groups = 0;
    let ready = 0;
    let routedGroups = 0;
    let buildings = 0;
    for (const list of this.furnitureByHost.values()) {
      if (list.length) buildings++;
      for (const g of list) {
        groups++;
        if (g.ready) ready++;
        if (g.routed) routedGroups++;
      }
    }
    let whenOn = 0;
    let whenOff = 0;
    for (const g of this.furnitureSwaps) {
      if (g.role === FURNITURE_ROLE.whenOn) whenOn++;
      else if (g.role === FURNITURE_ROLE.whenOff) whenOff++;
    }
    let standing = 0;
    for (const b of this.buildings) if (b.furniture?.length) standing++;
    return { routed: this.furnitureRouted, hosting: this.furnitureStats, buildings, groups, ready, perBuilding: routedGroups, standing, whenOn, whenOff };
  }

  /**
   * Put one object into a world that is already streaming: a house somebody has just placed.
   *
   * It is the constructor's own loop done once, and it works because nothing downstream is ever
   * *told* that a building exists. The portal renderer keeps its meshes in a lazy map keyed on the
   * building itself, the interiors pass walks `this.buildings`, and a tier's object list is the very
   * array the region holds -- so an object pushed into a tier that is already loaded is seen by the
   * collider pass with nothing merged and nothing rebuilt.
   *
   * The coordinates here are the **world's**, not the snapshot's: a house is put where somebody is
   * standing, and they are standing in the world. Everything the constructor reads is already
   * mirrored by the time it makes a `PlacedObject`, so this skips that step rather than undoing it.
   *
   * Returns the building it made, or null for an object with no rooms (which is still placed, and
   * still drawn -- a garage has no cells and is scenery).
   */
  async place(p: RuntimePlacement): Promise<Building | null> {
    const def = this.defOf(p.model);
    // Filed by the rule the layout's own objects were (step 6).
    const sizeTier = modelTier(p.radius, def?.bounds, !!def?.particle);
    const snapTier = snapshotTier(p.radius);
    const placed: PlacedObject = {
      model: p.model,
      template: p.template,
      x: p.x,
      y: p.y,
      z: p.z,
      q: p.q,
      radius: p.radius,
      contained: !!p.inside,
      solid: !!p.solid,
      tier: this.filing === 'snapshot' ? snapTier : sizeTier,
      sizeTier,
      snapTier,
      ...(p.effectsOf ? { effectsOf: p.effectsOf } : {}),
    };
    this.objects.push(placed);
    this.placedByKey.set(p.template, placed);
    // A house can host what is put down in it, and a thing put down in a room is drawn with that room.
    if (!placed.contained) {
      const id = this.hostObjects.length;
      if (this.furnitureIndex.add(id, placed, def)) {
        this.hostObjects.push(placed);
        this.hostIds.set(placed, id);
      }
    } else {
      const a = this.furnitureIndex.assign(placed, def, this.hostAnswer);
      if (a.host >= 0) {
        placed.hostFlags = a.flags;
        if (!(a.flags & HOST_FLAG.doorway)) {
          placed.host = this.hostObjects[a.host];
          placed.roomsLo = a.lo;
          placed.roomsHi = a.hi;
        }
      }
    }
    const region = this.regionFor(p.x, p.z);
    region.objects[placed.tier].push(placed);
    // A thing put down in a house's rooms loads whenever those rooms can be built, as the layout's own furniture does.
    if (placed.host) this.noteIndoor(placed, this.defOf(placed.host.model));
    if (p.clear && p.clear > 0) this.addExclusion({ x: p.x, z: p.z, r: p.clear });
    this.largestRadius = Math.max(this.largestRadius, Math.min(placed.radius, COLLIDER_RADIUS_CAP));
    // The collider pass only re-sweeps once the player has moved twelve metres; a house put down at
    // their feet has to be solid before that, so the memory of where it last swept is thrown away.
    this.lastColliderX = NaN;
    const loaded = region.tiers[placed.tier];
    // Not loaded yet, or still loading: the ordinary pass will build it with everything else, which
    // is exactly right and needs nothing here.
    if (!loaded || loaded === 'loading') return null;
    return this.addToTier(loaded, placed);
  }

  /**
   * Take one back out again: what an undo, a pick-up, or a world going away wants. It is named by
   * the `template` it was placed under, which for anything put down in play is a name of its own
   * (a home carries the id the server gave it) and is a name nothing in a snapshot has -- so this
   * is one lookup and can never reach a snapshot object by accident.
   *
   * Two things it does not undo, both deliberately. The patch of ground it kept the procedural
   * flora off stays kept: the flora is drawn into a chunk when the chunk is built, so putting the
   * exclusion back would leave a bald patch on every chunk already standing and grow trees only on
   * the ones built after. And the widest radius the collider sweep reaches for is left where it is,
   * which only ever makes that sweep look a little further than it needs to.
   */
  unplace(template: string): boolean {
    const placed = this.placedByKey.get(template);
    if (!placed) return false;
    this.placedByKey.delete(template);
    const i = this.objects.indexOf(placed);
    if (i >= 0) this.objects.splice(i, 1);
    // A house taken up hosts nothing more, and what stood in it is drawn as it was before anything was
    // drawn with its rooms: its building is going, and only that building's pass ever showed it.
    const hostId = this.hostIds.get(placed);
    if (hostId !== undefined) {
      this.furnitureIndex.remove(hostId);
      this.hostIds.delete(placed);
      this.unhost(placed);
    }
    const region = this.regions.get(`${regionIndex(placed.x)},${regionIndex(placed.z)}`);
    if (region) {
      const list = region.objects[placed.tier];
      const k = list.indexOf(placed);
      if (k >= 0) list.splice(k, 1);
    }
    this.dropFromTier(placed);
    this.lastColliderX = NaN;
    return true;
  }

  /**
   * A building put down in play is being taken up: everything filed under it is let go of. Only things
   * put down in play can stand in such a building (the layout's own furniture was hosted when the world
   * was read, before any house was), so those are the ones walked. Each loses its host, so a mesh made for
   * it later is an ordinary one, and each mesh already standing becomes `plain` -- drawn on the actor layer
   * in every pass as the old rule drew it -- rather than waiting on a building's pass that will never come.
   * A house put down again is a new building, and what was left standing is not filed under it.
   */
  private unhost(house: PlacedObject): void {
    for (const p of this.placedByKey.values()) {
      if (p.host !== house) continue;
      p.host = undefined;
      p.roomsLo = undefined;
      p.roomsHi = undefined;
    }
    const list = this.furnitureByHost.get(house);
    if (!list) return;
    this.furnitureByHost.delete(house);
    for (const g of list) {
      g.role = FURNITURE_ROLE.plain;
      g.twinned = false;
      this.applyFurniture(g);
    }
  }

  /**
   * What the world already has standing within `reach` of a point: each one's place and its own
   * size on the ground.
   *
   * The size is the model's own box and **nothing else**. The snapshot's `radius` is not a size:
   * it is a load distance, kilometres on some worlds, and is the same trap `floraClear.ts` was
   * written for. Measured over the real packs, taking it as a fallback for a thing with no box
   * refused 100% of one world, and the commonest thing "in the way" on another was a cloud of
   * insects -- so an object with no box of its own is in the way of nothing: it is drawn as
   * nothing, and a particle effect is not a thing anybody can walk into whatever its box says.
   *
   * It walks the regions the circle touches rather than the whole world: a planet has tens of
   * thousands of these and this is asked on a keypress, not on a frame. Objects inside a building
   * are left out, since the building around them is standing in the same place and says so itself.
   */
  objectsNear(x: number, z: number, reach: number): { x: number; z: number; radius: number; template: string; model: string }[] {
    const out: { x: number; z: number; radius: number; template: string; model: string }[] = [];
    const span = reach + Math.min(this.largestRadius, COLLIDER_RADIUS_CAP);
    const rx0 = Math.floor((x - span) / REGION);
    const rx1 = Math.floor((x + span) / REGION);
    const rz0 = Math.floor((z - span) / REGION);
    const rz1 = Math.floor((z + span) / REGION);
    for (let rz = rz0; rz <= rz1; rz++) {
      for (let rx = rx0; rx <= rx1; rx++) {
        const region = this.regions.get(`${rx},${rz}`);
        if (!region) continue;
        for (const list of region.objects) {
          for (const o of list) {
            if (o.contained) continue;
            const def = this.defOf(o.model);
            if (def?.particle) continue;
            const radius = modelReach(def?.bounds);
            if (!(radius > 0)) continue;
            const want = radius + reach;
            if ((o.x - x) ** 2 + (o.z - z) ** 2 > want * want) continue;
            out.push({ x: o.x, z: o.z, radius, template: o.template, model: o.model });
          }
        }
      }
    }
    return out;
  }

  private addExclusion(e: Exclusion): void {
    const x0 = Math.floor((e.x - e.r) / CHUNK_SIZE);
    const x1 = Math.floor((e.x + e.r) / CHUNK_SIZE);
    const z0 = Math.floor((e.z - e.r) / CHUNK_SIZE);
    const z1 = Math.floor((e.z + e.r) / CHUNK_SIZE);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = `${cx},${cz}`;
        const list = this.exclusionCells.get(key);
        if (list) list.push(e);
        else this.exclusionCells.set(key, [e]);
      }
    }
  }

  /** Scatter exclusions touching a terrain chunk. */
  exclusionsFor(cx: number, cz: number): Exclusion[] {
    return this.exclusionCells.get(`${cx},${cz}`) ?? [];
  }

  /** Open ground near a point that no object's footprint covers, or null. */
  clearSpawn(spawn: THREE.Vector3, heightAt: (x: number, z: number) => number): THREE.Vector3 | null {
    const blockers = this.objects.filter((p) => !p.contained && p.radius >= 1 && Math.hypot(p.x - spawn.x, p.z - spawn.z) < 200);
    const clear = (x: number, z: number) => blockers.every((p) => Math.hypot(p.x - x, p.z - z) > p.radius + 1.5);
    for (let r = 0; r < 120; r += 4) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = spawn.x + Math.sin(a) * r;
        const z = spawn.z + Math.cos(a) * r;
        if (clear(x, z)) return new THREE.Vector3(x, heightAt(x, z), z);
        if (r === 0) break;
      }
    }
    return null;
  }

  /** Load what is in range, drop what is not, keep collision around the player. */
  /** What the layout places within `r` metres of a point, and whether each is drawable right now. */
  describeNear(x: number, z: number, r: number): { template: string; model: string; d: number; radius: number; size: string; tier: number; contained: boolean; inManifest: boolean; loaded: boolean; region: string; regionState: string }[] {
    const out = [];
    for (const o of this.objects) {
      const d = Math.hypot(o.x - x, o.z - z);
      if (d > r) continue;
      const rx = regionIndex(o.x);
      const rz = regionIndex(o.z);
      const region = this.regions.get(`${rx},${rz}`);
      const state = region?.tiers[o.tier];
      // The loaded model's real extent, from its geometry, beside the manifest's radius.
      const loaded = this.loadedOf(o.model);
      let size = '';
      if (loaded) {
        const box = new THREE.Box3();
        for (const p of loaded.primitives) {
          if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
          box.union(p.geometry.boundingBox!);
        }
        const v = box.getSize(new THREE.Vector3());
        size = `${v.x.toFixed(2)}x${v.y.toFixed(2)}x${v.z.toFixed(2)} (${loaded.primitives.length} prims)`;
      }
      out.push({ template: o.template, model: o.model, d: Math.round(d), radius: o.radius, size, tier: o.tier, contained: o.contained, inManifest: !!this.defOf(o.model), loaded: !!this.loadedOf(o.model), region: `${rx},${rz}`, regionState: state === null ? 'not loaded' : state === 'loading' ? 'loading' : state ? 'loaded' : 'no region' });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  update(playerPos: THREE.Vector3, inside: Building | null = null): void {
    if (this.disposed) return;
    const px = playerPos.x;
    const pz = playerPos.z;
    // 60 m of hysteresis between building and dropping, so this only needs to run as the
    // player moves, not every frame.
    if (Number.isNaN(this.lastInteriorX) || Math.hypot(px - this.lastInteriorX, pz - this.lastInteriorZ) > 8 || inside !== this.lastInside) {
      this.lastInside = inside;
      this.updateInteriors(px, pz, inside);
    }
    // Nearest regions first so the player's surroundings fill in before the horizon.
    const candidates: { region: Region; tier: number; d: number }[] = [];
    const room = this.roomRange();
    for (const region of this.regions.values()) {
      const d = boxDistance(px, pz, region.cx, region.cz);
      for (let t = 0; t < TIERS.length; t++) {
        const state = region.tiers[t];
        if (!region.objects[t].length) continue;
        const range = this.rangeOf(region, t, room);
        if (d <= range) {
          if (state === null) candidates.push({ region, tier: t, d });
        } else if (state && state !== 'loading' && d > range * UNLOAD_SLACK) {
          this.unloadTier(region, t);
        }
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    for (const c of candidates) {
      if (this.loads >= MAX_CONCURRENT_LOADS) break;
      void this.loadTier(c.region, c.tier);
    }
    if (Number.isNaN(this.lastColliderX) || Math.hypot(px - this.lastColliderX, pz - this.lastColliderZ) > 12) {
      this.lastColliderX = px;
      this.lastColliderZ = pz;
      this.updateColliders(px, pz);
    }
    this.buildHuge();
  }

  /** Scale the ranges the tiers load out to; what is now out of range drops on the next update, what is in loads. */
  setReach(scale: number): void {
    this.ranges = TIERS.map((t) => t.range * scale);
  }

  /**
   * The farthest any building's rooms are built from its edge (`interiorBuildRangeMax`): the widest door range
   * the doors' rule allows, plus the lead. Read live, since the door range is a console knob.
   */
  private roomRange(): number {
    return interiorBuildRangeMax();
  }

  /**
   * How far a region's tier loads now (`regionRange`): its own tier's range at the settings' reach, and under
   * the model rule, for a tier holding a building's furniture, at least as far as that building's rooms can
   * be built from (step 6). `room` is `roomRange()`, worked out once by a caller that asks for many.
   */
  private rangeOf(region: Region, t: number, room: number): number {
    return regionRange(this.ranges[t], region.indoor[t], room, this.filing);
  }

  /**
   * For the console (`__debug.placed()`): the rule the world was filed by and the rule asked for now, how many
   * objects each tier holds by the model's own size and by the snapshot's radius, the ranges, how many region
   * tiers are loaded or loading now and how many of them hold furniture whose rooms' range raised them.
   */
  tierReport(): { filing: string; wanted: string; byModel: number[]; bySnapshot: number[]; ranges: number[]; roomRange: number; regionTiers: { loaded: number; loading: number; wanted: number; raised: number }; loadedInstances: number; loadedModels: number } {
    const byModel = TIERS.map(() => 0);
    const bySnapshot = TIERS.map(() => 0);
    for (const o of this.objects) {
      byModel[o.sizeTier]++;
      bySnapshot[o.snapTier]++;
    }
    let loaded = 0;
    let loading = 0;
    let wanted = 0;
    let raised = 0;
    const room = this.roomRange();
    for (const region of this.regions.values()) {
      for (let t = 0; t < TIERS.length; t++) {
        if (!region.objects[t].length) continue;
        wanted++;
        const s = region.tiers[t];
        if (s === 'loading') loading++;
        else if (s) loaded++;
        if (this.rangeOf(region, t, room) > this.ranges[t]) raised++;
      }
    }
    return { filing: this.filing, wanted: PLACED_TUNE.tierRule, byModel, bySnapshot, ranges: this.ranges.slice(), roomRange: room, regionTiers: { loaded, loading, wanted, raised }, loadedInstances: this.loadedInstances, loadedModels: this.loadedModels };
  }

  /**
   * The models the old rule would have loaded within `range` of a point (every region whose box is that near,
   * every tier): each model's id, and whether any of its copies there stands in a building's rooms (drawn in
   * the rooms' pass as well, so warmed for both). Nearest region first, particles and portal rooms left out
   * (the rooms are built, and compiled, with their own building). What `World.warmPlaced` builds programs
   * for behind a loading screen; made on an arrival, never on a frame.
   */
  modelsWithin(px: number, pz: number, range: number): Map<string, boolean> {
    const near: { region: Region; d: number }[] = [];
    for (const region of this.regions.values()) {
      const d = boxDistance(px, pz, region.cx, region.cz);
      if (d <= range) near.push({ region, d });
    }
    near.sort((a, b) => a.d - b.d);
    const out = new Map<string, boolean>();
    // A model's entry is looked up once, not once a copy: `defOf` walks the pack's entries.
    const particles = new Set<string>();
    for (const { region } of near) {
      for (const list of region.objects) {
        for (const o of list) {
          if (particles.has(o.model)) continue;
          const was = out.get(o.model);
          if (was === undefined) {
            if (this.defOf(o.model)?.particle) particles.add(o.model);
            else out.set(o.model, o.contained);
          } else if (o.contained && !was) out.set(o.model, true);
        }
      }
    }
    return out;
  }

  /**
   * File every object again by another rule (step 6): every tier is dropped -- the buildings with their rooms
   * and their collision, the furniture, the effects, the water -- and the regions rebuilt, so the next update
   * loads what is in range by the new rule. A thing put down in play is filed again with the rest and goes back
   * into its tier when that loads, as it does on arrival. It takes the floor from under anyone standing on a
   * placed object and the room from under anyone inside one, so the world calls it only behind a loading
   * screen and puts the player back in their room after (`World.refilePlaced`). Answers whether it changed
   * anything.
   */
  refile(rule: 'model' | 'snapshot'): boolean {
    if (this.disposed || rule === this.filingRule) return false;
    for (const region of this.regions.values()) {
      for (let t = 0; t < TIERS.length; t++) {
        const s = region.tiers[t];
        if (s === 'loading') region.tiers[t] = null;
        else if (s) this.unloadTier(region, t);
      }
    }
    this.filingRule = rule;
    for (const region of this.regions.values()) {
      for (let t = 0; t < TIERS.length; t++) {
        region.objects[t] = [];
        region.indoor[t] = -1;
      }
    }
    for (const p of this.objects) {
      p.tier = rule === 'snapshot' ? p.snapTier : p.sizeTier;
      this.regionFor(p.x, p.z).objects[p.tier].push(p);
    }
    // Each host's entry looked up once: `defOf` walks the pack's entries.
    const hostDefs = new Map<string, PackModelDef | undefined>();
    for (const p of this.objects) {
      const host = p.host;
      if (!host) continue;
      if (!hostDefs.has(host.model)) hostDefs.set(host.model, this.defOf(host.model));
      this.noteIndoor(p, hostDefs.get(host.model));
    }
    // Everything is to be swept again from scratch: the rooms, the collision.
    this.lastInteriorX = Number.NaN;
    this.lastColliderX = Number.NaN;
    this.lastInside = null;
    return true;
  }

  /** A placed model, loaded (or the load already under way) through whichever pack carries it. */
  loadModel(id: string): Promise<LoadedModel> {
    return this.modelOf(id);
  }

  /** A placed model already loaded, or null. */
  loadedModel(id: string): LoadedModel | null {
    return this.loadedOf(id);
  }

  /**
   * Whether every tier that loads at a point (its region within the tier's own range) is loaded:
   * `update`'s own range test, with nothing loading or still to load. What a hyperspace arrival
   * waits for. Nothing allocated.
   */
  loadedAround(px: number, pz: number): boolean {
    if (this.disposed) return true;
    const room = this.roomRange();
    for (const region of this.regions.values()) {
      const d = boxDistance(px, pz, region.cx, region.cz);
      for (let t = 0; t < TIERS.length; t++) {
        if (!region.objects[t].length || d > this.rangeOf(region, t, room)) continue;
        const state = region.tiers[t];
        if (state === null || state === 'loading') return false;
      }
    }
    return true;
  }

  /** Huge objects' collider pieces still to build (what the loading screen and a jump wait for). */
  get collidersPending(): number {
    return this.hugeQueue.length;
  }

  /** A huge object's collision, to be built a piece at a time; marked as having colliders so nothing builds it twice. */
  private queueHuge(o: PlacedObject): void {
    this.colliders.set(o, []);
    this.noteBlocker(o);
    this.hugeQueue.push({ o, prim: 0, pieces: null, next: 0 });
  }

  /**
   * Build huge objects' collision for up to HUGE_BUILD_MS (at least one piece a call): each primitive
   * split once into pieces of HUGE_PIECE_TRIANGLES, each piece cleaned and built with TRIMESH_FLAGS
   * where the object stands, in the exterior group as `addColliders` does. An object whose model is
   * no longer loaded, or whose tier went (its colliders removed), is dropped from the queue. Called from
   * `update`; the world also calls it while it waits in a hidden tab, where no frame runs `update`.
   */
  buildHuge(): void {
    const queue = this.hugeQueue;
    if (!queue.length) return;
    const t0 = performance.now();
    let built = 0;
    while (queue.length && (built === 0 || performance.now() - t0 < HUGE_BUILD_MS)) {
      const job = queue[0];
      const o = job.o;
      const model = this.loadedOf(o.model);
      const cols = this.colliders.get(o);
      if (!model || !cols || job.prim >= model.primitives.length) {
        queue.shift();
        continue;
      }
      const prim = model.primitives[job.prim];
      if (!job.pieces) {
        const posAttr = prim.geometry.getAttribute('position');
        if (!posAttr || posAttr.count < 3 || posAttr.itemSize !== 3 || (posAttr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
          job.prim++;
          continue;
        }
        const idx = prim.geometry.getIndex();
        const indices = idx ? new Uint32Array(idx.array as ArrayLike<number>) : Uint32Array.from({ length: posAttr.count - (posAttr.count % 3) }, (_, i) => i);
        job.pieces = splitTrimesh(new Float32Array(posAttr.array as ArrayLike<number>), indices, HUGE_PIECE_TRIANGLES);
        job.next = 0;
        built++;
        continue;
      }
      if (job.next >= job.pieces.length) {
        job.prim++;
        job.pieces = null;
        continue;
      }
      const piece = job.pieces[job.next++];
      const clean = cleanTrimesh(piece.vertices, piece.indices);
      if (clean) {
        const desc = R.ColliderDesc.trimesh(clean.vertices, clean.indices, TRIMESH_FLAGS)
          .setTranslation(o.x, o.y, o.z)
          .setRotation({ x: o.q.x, y: o.q.y, z: o.q.z, w: o.q.w })
          .setFriction(0.8);
        if (prim.cell === 0) desc.setCollisionGroups(groups(Group.exterior, Group.all));
        else if (prim.cell > 0) desc.setCollisionGroups(groups(Group.interior, Group.all));
        const col = this.physics.world.createCollider(desc);
        cols.push(col);
        this.colliderTemplate.set(col.handle, o.template);
      }
      built++;
    }
  }

  /** How much of what `settled` waits for is in, 0 to 1 (1 with nothing to wait for). */
  progress(px: number, pz: number, within = 220): number {
    if (this.disposed) return 1;
    let need = 0;
    let have = 0;
    const room = this.roomRange();
    for (const region of this.regions.values()) {
      const d = boxDistance(px, pz, region.cx, region.cz);
      for (let t = 0; t < TIERS.length; t++) {
        if (!region.objects[t].length) continue;
        if (d > Math.min(this.rangeOf(region, t, room), within)) continue;
        need++;
        const state = region.tiers[t];
        if (state !== null && state !== 'loading') have++;
      }
    }
    return need ? have / need : 1;
  }

  /**
   * Whether every region a point can see out to `within` metres has its objects in: what a
   * loading screen waits for before the player is let go, so the ground and the buildings are
   * there to stand on and walk into rather than arriving under the feet.
   */
  settled(px: number, pz: number, within = 220): boolean {
    if (this.disposed) return true;
    const room = this.roomRange();
    for (const region of this.regions.values()) {
      const d = boxDistance(px, pz, region.cx, region.cz);
      for (let t = 0; t < TIERS.length; t++) {
        if (!region.objects[t].length) continue;
        if (d > Math.min(this.rangeOf(region, t, room), within)) continue;
        const state = region.tiers[t];
        if (state === null || state === 'loading') return false;
      }
    }
    return true;
  }

  /**
   * One region's tier: its models loaded, its instances made, and then -- with the loading slot
   * already given back -- its programs built before the meshes are shown.
   *
   * The slot is given back the moment the models are in and instanced, which is where it was given
   * back before there was anything to compile. Held across the compile as well, three tiers whose
   * materials were new would hold all three of `MAX_CONCURRENT_LOADS` for as many frames as they
   * had programs, and no fourth tier would start: a town would fill in behind the player's walk
   * because of a shader queue, which is the opposite of the point.
   */
  private async loadTier(region: Region, tier: number): Promise<void> {
    const loaded = await this.buildTier(region, tier);
    if (!loaded || !this.prepare || !loaded.meshes.length) return;
    // The meshes went in hidden: they are shown once their programs exist, so no frame is ever the
    // first to draw a material nothing had built. The tier is already recorded, so an unload while
    // this waits takes them out in the ordinary way and the guard below drops the reveal.
    try {
      await this.prepare(loaded.meshes);
    } catch (err) {
      console.warn('snapshot: a tier could not be compiled ahead of its first draw; shown anyway', err);
    }
    if (this.disposed || region.tiers[tier] !== loaded) return;
    for (const mesh of loaded.meshes) this.reveal(mesh);
  }

  /** The loading half of a tier, holding one of the streamer's slots for exactly as long as it loads. */
  private async buildTier(region: Region, tier: number): Promise<LoadedTier | null> {
    region.tiers[tier] = 'loading';
    this.loads++;
    try {
      const objects = region.objects[tier];
      const ids = [...new Set(objects.map((o) => o.model))];
      const models = new Map<string, LoadedModel>();
      for (const id of ids) {
        // Particle effects have no mesh to load; the effect player fetches their descriptions.
        if (this.defOf(id)?.particle) continue;
        try {
          models.set(id, await this.modelOf(id));
        } catch (err) {
          // Missing or broken model: its instances are skipped, once noted.
          if (!this.failed.has(id)) {
            this.failed.add(id);
            console.warn(`snapshot model ${id} failed to load: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (this.disposed) return null;
      }
      if (region.tiers[tier] !== 'loading') return null;
      // Anything a player put down is left out of the bulk build and added one at a time below.
      //
      // The bulk build makes **one instanced mesh per model for every copy of it**, and a copy cannot
      // be taken out of an instanced mesh -- which is the whole reason `addToTier` gives a runtime
      // placement meshes of its own and keeps a `runtime` record so a removal is exact. An object
      // placed before its tier had loaded went in with the bulk instead and had no such record, so
      // `unplace` took nothing out: picking a prop back up left it standing and putting it down again
      // made a second one. Every prop stood on arrival was in exactly that state, since a world is
      // arrived in long before its tiers are built.
      const runtimePlaced = objects.filter((o) => this.placedByKey.get(o.template) === o);
      const bulk = runtimePlaced.length ? objects.filter((o) => this.placedByKey.get(o.template) !== o) : objects;
      const loaded = this.instance(bulk, models);
      region.tiers[tier] = loaded;
      for (const o of runtimePlaced) await this.addToTier(loaded, o);
      if (region.tiers[tier] !== loaded) return null;
      // A huge object's collision comes with its tier, a few pieces an update, never keyed on the player's distance.
      for (const o of objects) if (this.huge.has(o) && !this.colliders.has(o)) this.queueHuge(o);
      // A region that arrives already under the player's nose needs its interiors now.
      for (const b of loaded.buildings) {
        if (Math.hypot(b.x - this.lastInteriorX, b.z - this.lastInteriorZ) - b.radius <= this.interiorRange(b)) this.buildInterior(b);
      }
      // Models that finished loading after the last collider pass get their collision next update.
      this.lastColliderX = Number.NaN;
      return loaded;
    } finally {
      this.loads--;
      if (region.tiers[tier] === 'loading') region.tiers[tier] = null;
    }
  }

  private instance(objects: PlacedObject[], models: Map<string, LoadedModel>): LoadedTier {
    const byModel = new Map<LoadedModel, PlacedObject[]>();
    for (const o of objects) {
      const m = models.get(o.model);
      if (m) (byModel.get(m) ?? byModel.set(m, []).get(m)!).push(o);
    }
    const meshes: THREE.Object3D[] = [];
    const buildings: Building[] = [];
    const effects: EffectHandle[] = [];
    const waters: WaterSurfaceHandle[] = [];
    const furniture: LoadedTier['furniture'] = [];
    const levels: LevelGroup[] = [];
    const localFx = new THREE.Matrix4();
    if (this.effects) {
      for (const o of objects) {
        const def = this.defOf(o.model);
        if (def?.particle) effects.push(this.effects.place(this.effectFile(def, def.file), tmpM.compose(tmpV.set(o.x, o.y, o.z), o.q, ONE), o.contained));
      }
    }
    for (const [model, list] of byModel) {
      // A model's attached effects (lamps, fountains, chimneys) play at every placed copy.
      if (this.effects && model.def.effects?.length) {
        for (const p of list) {
          tmpM.compose(tmpV.set(p.x, p.y, p.z), p.q, ONE);
          for (const fx of model.def.effects) effects.push(this.effects.place(this.effectFile(model.def, fx.file), localFx.multiplyMatrices(tmpM, mirroredTransform(fx.transform, localFx)), p.contained || (fx.cell ?? 0) > 0));
        }
      }
      // And what each placed copy's client data hangs on it, which differs between templates that
      // share this model (one streetlamp mesh carries four colours of lamp).
      if (this.effects) {
        for (const p of list) {
          const own = this.templateEffects(p.effectsOf ?? p.template);
          if (!own.length) continue;
          tmpM.compose(tmpV.set(p.x, p.y, p.z), p.q, ONE);
          for (const fx of own) effects.push(this.effects.place(fx.file, localFx.multiplyMatrices(tmpM, mirroredTransform(fx.transform, localFx)), p.contained));
        }
      }
      const isBuilding = model.interiorBoxes.length > 0;
      const built: (Building | null)[] = list.map((p) => {
        if (!isBuilding || p.contained) return null;
        const matrix = new THREE.Matrix4().compose(tmpV.set(p.x, p.y, p.z), p.q, ONE);
        const b: Building = { model, template: p.template, x: p.x, z: p.z, radius: model.radius, matrix, inverse: matrix.clone().invert(), interior: [], interiorBuilt: false, object: p, furniture: this.furnitureList(p) };
        buildings.push(b);
        this.buildings.add(b);
        return b;
      });
      // Step 7: a model whose pack carries the client's lower detail levels has its copies out in the open
      // drawn by a level group, every exterior piece at every level; its copies in a building's rooms keep
      // the finest, drawn with their rooms. A model holding a basin's water is left as it was: the water
      // system takes that piece copy by copy, which a level's shared store cannot follow.
      const levelled = this.levelled(model) ? list.filter((p) => !p.contained) : null;
      if (levelled && levelled.length) levels.push(this.levelGroup(model, levelled, meshes));
      for (const prim of model.primitives) {
        // Interiors of portal buildings are drawn per building and per cell by the portal renderer,
        // so each placed building gets its own meshes; a building without portal data draws normally.
        // Those meshes are made only once the player is near (see buildInterior).
        const perBuilding = prim.cell > 0 && model.portals.length > 0;
        let all = perBuilding ? list.filter((_, i) => !built[i]) : list;
        // The exterior's outdoor copies are the level group's.
        if (levelled && levelled.length && prim.cell <= 0) all = all.filter((p) => p.contained);
        if (!all.length) continue;
        // A fountain's or a pool's water standing out in the open is the water system's: a body per
        // copy, prepared with the tier's own meshes. One in a room stays the model's, since the room
        // pass draws what stands indoors and a world water body is not drawn there.
        if (this.waterSurface && prim.cell <= 0 && isBasinWater(prim.material)) {
          const before = waters.length;
          const refused = this.basinWater(prim, all.filter((p) => !p.contained), model.def.id, waters);
          for (let i = before; i < waters.length; i++) meshes.push(waters[i].mesh);
          all = [...all.filter((p) => p.contained), ...refused];
          if (!all.length) continue;
        }
        // Indoor and outdoor copies of one model go in **separate** meshes, because only the indoor
        // ones want the actor layer and a mesh wears its layers whole. One chair in a cantina used
        // to put every chair of that model on the street onto the actor layer as well, which outside
        // a building is drawn over the whole screen with no stencil -- so a chair behind a wall two
        // streets away was drawn through it. And the indoor copies go in one mesh per building that
        // holds them (commit 2b), so each building's furniture can be drawn with its own rooms, and those
        // in no room box, or in a doorway, in one more. The mesh of all of them together, exactly as the
        // old rule made it, is built beside those and drawn instead while the furniture switch is off
        // (`splitCopies`): it shares their geometry, their material and so their programs, and the old
        // way is one flip away rather than a third more meshes than it ever drew.
        for (const { list: instanced, role, host } of splitCopies<PlacedObject, PlacedObject>(all)) {
        const mesh = new THREE.InstancedMesh(prim.geometry, prim.material, instanced.length);
        instanced.forEach((p, i) => {
          tmpM.compose(tmpV.set(p.x, p.y, p.z), p.q, ONE);
          mesh.setMatrixAt(i, tmpM);
        });
        // Objects placed inside buildings draw in every pass, like actors, so they show with the room.
        if (instanced[0].contained) mesh.layers.enable(ACTOR_LAYER);
        mesh.castShadow = model.radius >= SHADOW_MIN_RADIUS && castsShadow(prim.material);
        // A translucent fall or screen draws after the terrain water, which follows the player and
        // so always sorts nearer than this mesh's centre of all its placements.
        if (drawsAfterWater(prim.material)) mesh.renderOrder = 3;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        // The mesh stands at the scene's origin with its copies' places in its instances, so its own
        // sphere is its sphere in the world: the world pass from inside may leave it out when it misses the exits.
        if (mesh.boundingSphere) markNarrowRoot(mesh, mesh.boundingSphere);
        // Hidden until its programs exist (loadTier shows it); with no `prepare` set it is shown at once, as it always was.
        if (this.prepare) mesh.visible = false;
        this.scene.add(mesh);
        meshes.push(mesh);
        if (role >= 0) furniture.push({ g: this.furnitureGroup(mesh, instanced, role, role === FURNITURE_ROLE.room, host), host });
        }
      }
    }
    this.loadedModels += byModel.size;
    this.loadedInstances += objects.length;
    return { meshes, buildings, objects, effects, waters, furniture, levels };
  }

  /** Whether a model's outdoor copies are drawn at its levels: it carries more than one, and no piece of it is a basin's water the water system takes. */
  private levelled(model: LoadedModel): boolean {
    if (!model.levels || model.levels.length < 2) return false;
    if (this.waterSurface) for (const prim of model.primitives) if (prim.cell <= 0 && isBasinWater(prim.material)) return false;
    return true;
  }

  /**
   * A level group for a model's outdoor copies (`levelGroup.ts`): a mesh per piece of every level, each made as
   * the streamer makes any tier mesh (its shadow by the model's size and the material, its order after the
   * water for a translucent surface, hidden until its programs exist), put in the tier's `meshes` so it is
   * prepared, revealed and unloaded with the rest, and offered to the exit narrowing with its own sphere,
   * which the group keeps to what it draws. Swept at once from the last eye, so a tier loading far off does
   * not draw its finest level for a frame.
   */
  private levelGroup(model: LoadedModel, copies: PlacedObject[], meshes: THREE.Object3D[]): LevelGroup {
    // Measured from what the levels draw: a portal building's levels are its shell cell's, and the whole
    // model's box takes in every room, which under a cave or a bunker runs a hundred metres and more below
    // the door -- measured from that middle, a cave mouth was at its lowest level with the player at it.
    const shell = model.def.cells?.find((c) => c.index === 0)?.bounds;
    const b = shell && shell.min.length >= 3 && shell.max.length >= 3 ? shell : model.def.bounds;
    const centre = new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    const radius = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
    const made: THREE.InstancedMesh[] = [];
    const g = new LevelGroup(
      copies,
      model.levels!,
      centre,
      radius,
      (prim, n) => {
        const mesh = new THREE.InstancedMesh(prim.geometry, prim.material, n);
        mesh.castShadow = model.radius >= SHADOW_MIN_RADIUS && castsShadow(prim.material);
        if (drawsAfterWater(prim.material)) mesh.renderOrder = 3;
        mesh.receiveShadow = true;
        mesh.name = `level:${model.def.id}`;
        if (this.prepare) mesh.visible = false;
        this.scene.add(mesh);
        meshes.push(mesh);
        made.push(mesh);
        return mesh;
      },
      !this.prepare,
    );
    g.broken = isQuarantined;
    for (const mesh of made) {
      this.levelOfMesh.set(mesh, g);
      if (mesh.boundingSphere) markNarrowRoot(mesh, mesh.boundingSphere);
    }
    this.levelGroups.push(g);
    if (this.levelMeasured) g.sweep(this.levelEyeX, this.levelEyeY, this.levelEyeZ, this.levelScale, this.levelCascadeFar);
    return g;
  }

  /** Every level group standing now (step 7), in a kept list the sweep walks by index (a set's iterator is an object a walk). */
  private readonly levelGroups: LevelGroup[] = [];
  /** The level group a tier mesh belongs to, so its reveal knows it. */
  private readonly levelOfMesh = new WeakMap<THREE.Object3D, LevelGroup>();
  /** Where the level sweep last measured from, with what scale, and its clock. */
  private levelEyeX = 0;
  private levelEyeY = 0;
  private levelEyeZ = 0;
  private levelScale = 1;
  private levelCascadeFar = Number.POSITIVE_INFINITY;
  private levelMeasured = false;
  private levelAge = 0;
  private levelForce = false;
  /** What the level sweeps did, for the console and the frame report. */
  readonly levelStats = { sweeps: 0, repacks: 0, ms: 0 };

  /**
   * Put every outdoor copy of every levelled model at the level the eye picks (step 7): when the eye has moved
   * `sweepMetres` or `sweepSeconds` has gone by, or at once after the switch or a tune moved. `scale` multiplies
   * the client's switch distances (the tune's bias over the ride's, step 8); `cascadeFar` is where the second
   * shadow cascade ends. Nothing allocated.
   */
  sweepLevels(eye: THREE.Vector3, dt: number, scale: number, cascadeFar: number): void {
    if (this.disposed) return;
    this.levelAge += dt;
    const dx = eye.x - this.levelEyeX;
    const dy = eye.y - this.levelEyeY;
    const dz = eye.z - this.levelEyeZ;
    const moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (this.levelMeasured && !this.levelForce && scale === this.levelScale && cascadeFar === this.levelCascadeFar && !sweepDue(this.levelAge, moved, LOD_LEVEL_TUNE)) return;
    const t0 = performance.now();
    this.levelEyeX = eye.x;
    this.levelEyeY = eye.y;
    this.levelEyeZ = eye.z;
    this.levelScale = scale;
    this.levelCascadeFar = cascadeFar;
    this.levelMeasured = true;
    this.levelForce = false;
    this.levelAge = 0;
    let repacks = 0;
    const groups = this.levelGroups;
    for (let i = 0; i < groups.length; i++) if (groups[i].sweep(eye.x, eye.y, eye.z, scale, cascadeFar)) repacks++;
    const st = this.levelStats;
    st.sweeps++;
    st.repacks += repacks;
    st.ms = performance.now() - t0;
  }

  /** The levels switch or a tune moved: the next sweep runs whatever the clock says. */
  refreshLevels(): void {
    this.levelForce = true;
  }

  /**
   * For the console (`__debug.lod()`): the level groups standing, their meshes, and the copies at each level
   * position (0 the finest; the last entry drawn at nothing), with what the sweeps have done.
   */
  levelReport(): { groups: number; meshes: number; drawing: number; copies: number; byLevel: number[]; nothing: number; sweeps: number; repacks: number; lastSweepMs: number } {
    const counts = [0, 0, 0, 0];
    let meshCount = 0;
    let drawing = 0;
    let copies = 0;
    for (const g of this.levelGroups) {
      g.countInto(counts);
      copies += g.n;
      for (const m of g.meshes) {
        meshCount++;
        if (m.visible) drawing++;
      }
    }
    return { groups: this.levelGroups.length, meshes: meshCount, drawing, copies, byLevel: counts.slice(0, 3), nothing: counts[3], sweeps: this.levelStats.sweeps, repacks: this.levelStats.repacks, lastSweepMs: Number(this.levelStats.ms.toFixed(3)) };
  }

  /**
   * A furniture mesh (`FURNITURE_ROLE`): one standing in one building's rooms is filed under that building
   * with the rooms its copies can be seen in, one of the pair a switch flip trades between is kept apart;
   * each keeps the shadow the old rule gave it and whether its programs exist yet (with no `prepare` they
   * need not wait). Drawn as the switch says from the moment it is ready.
   */
  private furnitureGroup(mesh: THREE.InstancedMesh, copies: readonly PlacedObject[], role: number, twinned: boolean, host: PlacedObject | null): FurnitureGroup {
    let lo = 0;
    let hi = 0;
    let any = false;
    for (const p of copies) {
      lo = (lo | (p.roomsLo ?? 0)) >>> 0;
      hi = (hi | (p.roomsHi ?? 0)) >>> 0;
      if ((p.hostFlags ?? 0) & HOST_FLAG.anyRoom) any = true;
    }
    const g: FurnitureGroup = { mesh, lo, hi, any, ready: !this.prepare, routed: false, cast: mesh.castShadow, role, twinned };
    this.furnitureOfMesh.set(mesh, g);
    if (host) this.furnitureList(host).push(g);
    else this.furnitureSwaps.add(g);
    // Its layers move with the switch: every sweep that compiles it builds both passes' programs.
    if (role === FURNITURE_ROLE.room) markFurniture(mesh);
    this.applyFurniture(g);
    return g;
  }

  /** A group taken out of its building's list (or the switch's pairs), its tier or its placement gone. */
  private dropFurniture(entries: readonly { g: FurnitureGroup; host: PlacedObject | null }[]): void {
    for (const e of entries) {
      if (!e.host) {
        this.furnitureSwaps.delete(e.g);
        continue;
      }
      const list = this.furnitureByHost.get(e.host);
      if (!list) continue;
      const i = list.indexOf(e.g);
      if (i >= 0) list.splice(i, 1);
    }
  }

  /**
   * One object into a tier that is already built: `instance` done for a single placement.
   *
   * The difference from `instance` is the one thing that matters here. A tier instances a model
   * once for every copy of it the region holds, and a copy cannot be taken out of an instanced mesh
   * without rewriting it; so a placement made in play gets its own meshes -- an instanced mesh of
   * one, because that is what the pack's materials, the shadow rules and the portal renderer all
   * already expect to be handed -- and `runtime` remembers them so that taking it away is exact.
   */
  private async addToTier(loaded: LoadedTier, p: PlacedObject): Promise<Building | null> {
    const rec: RuntimeRec = { tier: loaded, meshes: [], building: null, effects: [], waters: [], furniture: [] };
    this.runtime.set(p, rec);
    this.loadedInstances++;
    const def = this.defOf(p.model);
    if (def?.particle) {
      if (this.effects) {
        rec.effects.push(this.effects.place(this.effectFile(def, def.file), tmpM.compose(tmpV.set(p.x, p.y, p.z), p.q, ONE), false));
        loaded.effects.push(...rec.effects);
      }
      return null;
    }
    let model: LoadedModel;
    try {
      model = await this.modelOf(p.model);
    } catch (err) {
      if (!this.failed.has(p.model)) {
        this.failed.add(p.model);
        console.warn(`snapshot model ${p.model} failed to load: ${err instanceof Error ? err.message : String(err)}`);
      }
      return null;
    }
    // Taken away again, or its whole tier unloaded, while the model loaded.
    if (this.disposed || this.runtime.get(p) !== rec) return null;
    tmpM.compose(tmpV.set(p.x, p.y, p.z), p.q, ONE);
    if (this.effects && model.def.effects?.length) {
      const localFx = new THREE.Matrix4();
      for (const fx of model.def.effects) rec.effects.push(this.effects.place(this.effectFile(model.def, fx.file), localFx.multiplyMatrices(tmpM, mirroredTransform(fx.transform, localFx)), (fx.cell ?? 0) > 0));
    }
    // A thing put down in play carries what its own template's client data hangs on it: a brazier from
    // the Props tab burns, a server-placed torch among the fittings flames.
    const ownFx = this.effects ? this.templateEffects(p.effectsOf ?? p.template) : NO_EFFECTS;
    if (this.effects && ownFx.length) {
      const localFx = new THREE.Matrix4();
      for (const fx of ownFx) rec.effects.push(this.effects.place(fx.file, localFx.multiplyMatrices(tmpM, mirroredTransform(fx.transform, localFx)), p.contained));
    }
    loaded.effects.push(...rec.effects);
    let building: Building | null = null;
    if (model.interiorBoxes.length > 0) {
      const matrix = new THREE.Matrix4().compose(tmpV.set(p.x, p.y, p.z), p.q, ONE);
      building = { model, template: p.template, x: p.x, z: p.z, radius: model.radius, matrix, inverse: matrix.clone().invert(), interior: [], interiorBuilt: false, object: p, furniture: this.furnitureList(p) };
      loaded.buildings.push(building);
      this.buildings.add(building);
      rec.building = building;
    }
    for (const prim of model.primitives) {
      // A portal building's rooms are drawn per cell by the portal renderer, out of `buildInterior`.
      if (building && prim.cell > 0 && model.portals.length > 0) continue;
      // A basin put down out in the open holds the water system's water, as the world's own do.
      if (!p.contained && prim.cell <= 0 && isBasinWater(prim.material) && !this.basinWater(prim, [p], model.def.id, rec.waters).length) {
        const h = rec.waters[rec.waters.length - 1];
        loaded.waters.push(h);
        rec.meshes.push(h.mesh);
        continue;
      }
      const mesh = new THREE.InstancedMesh(prim.geometry, prim.material, 1);
      mesh.setMatrixAt(0, tmpM.compose(tmpV.set(p.x, p.y, p.z), p.q, ONE));
      mesh.castShadow = model.radius >= SHADOW_MIN_RADIUS && castsShadow(prim.material);
      if (drawsAfterWater(prim.material)) mesh.renderOrder = 3;
      // A thing standing in a room is drawn with the room, which is the actor layer -- the same line
      // the bulk path has. Without it an indoor placement is stencilled out of the room's own pass
      // and can only be seen through a doorway from outside, which is worse than not drawing it.
      if (p.contained) mesh.layers.enable(ACTOR_LAYER);
      mesh.receiveShadow = true;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      if (mesh.boundingSphere) markNarrowRoot(mesh, mesh.boundingSphere);
      if (this.prepare) mesh.visible = false;
      this.scene.add(mesh);
      rec.meshes.push(mesh);
      loaded.meshes.push(mesh);
      // Standing in a building's room: drawn with that building's rooms, as the layout's own furniture is.
      // Its own mesh of one is what the old rule drew it with too, so with the switch off it is drawn as that.
      if (p.contained && p.host) {
        const entry = { g: this.furnitureGroup(mesh, [p], FURNITURE_ROLE.room, false, p.host), host: p.host };
        rec.furniture.push(entry);
        loaded.furniture.push(entry);
      }
    }
    if (this.prepare && rec.meshes.length) {
      try {
        await this.prepare(rec.meshes);
      } catch (err) {
        console.warn('snapshot: an object placed in play could not be compiled ahead of its first draw; shown anyway', err);
      }
      if (this.disposed || this.runtime.get(p) !== rec) return building;
      for (const mesh of rec.meshes) this.reveal(mesh);
    }
    // A house is put down where somebody is standing, so its rooms are wanted now rather than at the
    // next sweep. NaN before the first sweep, which fails the test and leaves it to the sweep.
    if (building && Math.hypot(building.x - this.lastInteriorX, building.z - this.lastInteriorZ) - building.radius <= this.interiorRange(building)) this.buildInterior(building);
    this.lastColliderX = Number.NaN;
    return building;
  }

  /** Everything `addToTier` made for one placement, undone. */
  private dropFromTier(p: PlacedObject): void {
    const rec = this.runtime.get(p);
    this.runtime.delete(p);
    this.removeColliders(p);
    if (!rec) return;
    if (rec.building) {
      this.dropInterior(rec.building);
      this.buildings.delete(rec.building);
      const i = rec.tier.buildings.indexOf(rec.building);
      if (i >= 0) rec.tier.buildings.splice(i, 1);
      if (this.lastInside === rec.building) this.lastInside = null;
    }
    for (const mesh of rec.meshes) {
      this.scene.remove(mesh);
      const i = rec.tier.meshes.indexOf(mesh);
      if (i >= 0) rec.tier.meshes.splice(i, 1);
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
    }
    this.dropFurniture(rec.furniture);
    for (const e of rec.furniture) {
      const i = rec.tier.furniture.indexOf(e);
      if (i >= 0) rec.tier.furniture.splice(i, 1);
    }
    for (const w of rec.waters) {
      w.remove();
      const i = rec.tier.waters.indexOf(w);
      if (i >= 0) rec.tier.waters.splice(i, 1);
    }
    if (this.effects) {
      for (const h of rec.effects) {
        this.effects.remove(h);
        const i = rec.tier.effects.indexOf(h);
        if (i >= 0) rec.tier.effects.splice(i, 1);
      }
    }
    this.loadedInstances--;
  }

  /**
   * Make a building's interior meshes. Geometry and materials are shared with the model, so
   * this is a handful of Object3Ds, not a copy of the mesh; the portal renderer shows them.
   */
  private buildInterior(b: Building): void {
    if (b.interiorBuilt) return;
    b.interiorBuilt = true;
    if (!b.model.portals.length) return;
    const made: THREE.Mesh[] = [];
    const cells: number[] = [];
    for (const prim of b.model.primitives) {
      if (prim.cell <= 0) continue;
      cells.push(prim.cell);
      const mesh = new THREE.Mesh(prim.geometry, prim.material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(b.matrix);
      mesh.matrixWorld.copy(b.matrix);
      mesh.castShadow = castsShadow(prim.material);
      if (drawsAfterWater(prim.material)) mesh.renderOrder = 3;
      mesh.receiveShadow = true;
      mesh.visible = false;
      mesh.layers.set(INTERIOR_LAYER);
      b.interior.push(mesh);
      made.push(mesh);
    }
    b.interiorCell = Int16Array.from(cells);
    if (!made.length) return;
    // Into the scene now, hidden, as they always have been: the portal renderer writes `visible`
    // itself for the cells it draws.
    //
    // They were held out of the scene until their programs existed, and that was a hole rather than
    // a late reveal. A tier held back is a thing not yet drawn; a cell held back is a room that is
    // not there -- the colliders are built elsewhere and are already in, so a player who walked in
    // before the queue reached the cells walked into an invisible interior and looked out through
    // the doorway at the world. A tier's reveal is the streamer's to hold and a cell's is not.
    //
    // A room's own materials are its own (the pack clones them so the portal renderer can stencil
    // them apart), so the first building of a kind does bring new programs with it. The compile is
    // asked for anyway, and it has the walk to the door to finish in; if the player beats it, the
    // frame that draws the cell builds the program exactly as it did before any of this, and the
    // frame loop's shader line says so.
    for (const mesh of made) this.scene.add(mesh);
    if (!this.prepare) return;
    void this.prepare(made).catch((err) => {
      console.warn('snapshot: a buildingâ€™s rooms could not be compiled ahead of being drawn', err);
    });
  }

  /** Drop a building's interior meshes. Shared geometry and materials are left alone. */
  private dropInterior(b: Building): void {
    if (!b.interiorBuilt) return;
    for (const mesh of b.interior) this.scene.remove(mesh);
    b.interior.length = 0;
    b.interiorCell = undefined;
    b.interiorBuilt = false;
  }

  /**
   * How far from its edge a building's rooms are built: `INTERIOR_RANGE`, or farther for a building
   * whose widest door is drawn from farther away (the door range grows with a door's size, and a big
   * door drawn from 300 m with no rooms built behind it would show nothing through it). Either way
   * `INTERIOR_LEAD` past the door's own range, so the rooms and their programs are there first.
   */
  private interiorRange(b: Building): number {
    return interiorBuildRange(b);
  }

  /**
   * Keep interiors around the player. The building the player is inside always keeps its own,
   * however far its far wings reach, so walking a long hall never empties the room ahead.
   */
  private updateInteriors(px: number, pz: number, inside: Building | null): void {
    this.lastInteriorX = px;
    this.lastInteriorZ = pz;
    for (const b of this.buildings) {
      if (b === inside) {
        this.buildInterior(b);
        continue;
      }
      const edge = Math.hypot(b.x - px, b.z - pz) - b.radius;
      const range = this.interiorRange(b);
      if (edge <= range) this.buildInterior(b);
      else if (edge > range + INTERIOR_DROP - INTERIOR_RANGE) this.dropInterior(b);
    }
  }

  /** Buildings whose interiors are built right now, for the stats line. */
  get interiorCount(): number {
    let n = 0;
    for (const b of this.buildings) if (b.interiorBuilt) n++;
    return n;
  }

  /**
   * What lazy interiors save: meshes built now against the meshes every loaded building would
   * hold if each kept its interior the moment it streamed in. `force` builds them all, to see
   * the cost directly; the next sweep drops them again.
   */
  interiorStats(force = false): { buildings: number; built: number; meshes: number; eagerMeshes: number } {
    let buildings = 0;
    let built = 0;
    let meshes = 0;
    let eagerMeshes = 0;
    for (const b of this.buildings) {
      buildings++;
      if (force) this.buildInterior(b);
      if (b.interiorBuilt) {
        built++;
        meshes += b.interior.length;
      }
      eagerMeshes += b.model.portals.length ? b.model.primitives.filter((pr) => pr.cell > 0).length : 0;
    }
    return { buildings, built, meshes, eagerMeshes };
  }

  private unloadTier(region: Region, tier: number): void {
    const t = region.tiers[tier];
    if (!t || t === 'loading') return;
    for (const b of t.buildings) this.dropInterior(b);
    for (const mesh of t.meshes) {
      this.scene.remove(mesh);
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
    }
    // Its level groups out of the kept list (an unload, not a frame's work).
    if (t.levels.length) {
      const gone = new Set(t.levels);
      let k = 0;
      for (const g of this.levelGroups) if (!gone.has(g)) this.levelGroups[k++] = g;
      this.levelGroups.length = k;
    }
    this.dropFurniture(t.furniture);
    for (const b of t.buildings) this.buildings.delete(b);
    for (const o of t.objects) {
      this.removeColliders(o);
      // Anything placed in play that rode this tier goes with it, and its record with it, or a
      // later removal would take its meshes out twice and count its instance off twice.
      this.runtime.delete(o);
    }
    // A huge object whose pieces were still being built stops being built.
    if (this.hugeQueue.length) {
      let keep = 0;
      for (const job of this.hugeQueue) if (!t.objects.includes(job.o)) this.hugeQueue[keep++] = job;
      this.hugeQueue.length = keep;
    }
    if (this.effects) for (const h of t.effects) this.effects.remove(h);
    for (const w of t.waters) w.remove();
    this.loadedInstances -= t.objects.length;
    region.tiers[tier] = null;
  }

  /** Exact collision for the larger objects near the player; created and dropped as they move. */
  private updateColliders(px: number, pz: number): void {
    // Distances count from an object's edge, not its centre: a palace is wider than the range,
    // and its collision must stay while the player walks its far wings.
    // `keys()` and not the entries: the values are not read here, and destructuring an entry makes
    // a two-element array per object every pass over a map this long.
    for (const o of this.colliders.keys()) {
      // A huge object's collision comes and goes with its tier, not with the player's distance.
      if (this.huge.has(o)) continue;
      if (colliderFar(o, px, pz, UNLOAD_SLACK)) this.removeColliders(o);
    }
    const reach = COLLIDER_RANGE + this.largestRadius;
    const rx0 = Math.floor((px - reach) / REGION);
    const rx1 = Math.floor((px + reach) / REGION);
    const rz0 = Math.floor((pz - reach) / REGION);
    const rz1 = Math.floor((pz + reach) / REGION);
    for (let rz = rz0; rz <= rz1; rz++) {
      for (let rx = rx0; rx <= rx1; rx++) {
        const region = this.regions.get(`${rx},${rz}`);
        if (!region) continue;
        for (const t of region.tiers) {
          if (!t || t === 'loading') continue;
          for (const o of t.objects) {
            // The size floor is about the snapshot's tens of thousands of small props. A thing put
            // down in play is a handful of deliberate things, and the one the player walks up to and
            // presses -- a travel terminal, 0.78 m of radius -- is well under it.
            if ((o.radius < COLLIDER_MIN_RADIUS && !o.solid) || this.colliders.has(o) || this.huge.has(o)) continue;
            if (colliderFar(o, px, pz, 1)) continue;
            this.addColliders(o);
          }
        }
      }
    }
  }

  private addColliders(o: PlacedObject): void {
    const model = this.loadedOf(o.model);
    if (!model) return;
    const cols: R.Collider[] = [];
    for (const prim of model.primitives) {
      const posAttr = prim.geometry.getAttribute('position');
      if (!posAttr || posAttr.count < 3) continue;
      // A basin's water drawn by the water system is water and not a floor: every triangle of a model
      // is a collider here, so the fountains' surfaces were paving you stood on, and nothing you do on
      // paving ripples. Left out, you step into the basin and wade as you would anywhere.
      if (this.waterSurface && !o.contained && prim.cell <= 0 && isBasinWater(prim.material)) continue;
      const idx = prim.geometry.getIndex();
      const indices = idx ? new Uint32Array(idx.array as ArrayLike<number>) : Uint32Array.from({ length: posAttr.count - (posAttr.count % 3) }, (_, i) => i);
      // Cleaned and flagged, as every other trimesh in the game is. This was the one path that did
      // neither, which mattered less while it carried a few hundred big models and matters a great
      // deal now that it carries the thousands of small ones a town's rooms are furnished with: a
      // degenerate triangle under a character controller is an engine panic after which every call
      // fails. Measured on the worst spot this change reaches it costs about sixty per cent more to
      // build and makes the first step after insertion twenty-six times cheaper.
      const clean = cleanTrimesh(new Float32Array(posAttr.array as ArrayLike<number>), indices);
      // Nothing survived the clean: every triangle was degenerate. That is a mesh with no collision
      // to give rather than an error, and it is stepped over the way the huge path steps over one.
      if (!clean) continue;
      const desc = R.ColliderDesc.trimesh(clean.vertices, clean.indices, TRIMESH_FLAGS)
        .setTranslation(o.x, o.y, o.z)
        .setRotation({ x: o.q.x, y: o.q.y, z: o.q.z, w: o.q.w })
        .setFriction(0.8);
      // Building shells and interiors get their own collision groups so someone inside ignores the
      // shell. A thing standing **in** a room is the room's, whatever cell its own primitives claim:
      // a plain prop's are -1, which would leave it wearing the engine's default groups -- accepted
      // by the player, and also by the weather's roof grid and the outdoor ground test, neither of
      // which has any business finding a chair.
      if (o.contained || prim.cell > 0) desc.setCollisionGroups(groups(Group.interior, Group.all));
      else if (prim.cell === 0) desc.setCollisionGroups(groups(Group.exterior, Group.all));
      const col = this.physics.world.createCollider(desc);
      cols.push(col);
      this.colliderTemplate.set(col.handle, o.template);
    }
    this.colliders.set(o, cols);
    this.noteBlocker(o);
  }

  private removeColliders(o: PlacedObject): void {
    const cols = this.colliders.get(o);
    if (!cols) return;
    for (const c of cols) {
      this.colliderTemplate.delete(c.handle);
      // Anything burnt, scarred or trodden on this thing goes with it: the marks are in the world's
      // frame and a mark left behind would hang in the air where the prop was. It is free when
      // nothing is owned, which is every pass in which nobody has shot a crate.
      marks.forget(c.handle);
      this.physics.removeCollider(c);
    }
    this.colliders.delete(o);
    this.forgetBlocker(o);
  }

  /**
   * Something standing near a point that a body might hide behind: a disc over its footprint and
   * the height of its top, both in the world. It is deliberately the crudest shape that can aim a
   * candidate cover spot, and it is written as a plain shape rather than as the cover code's own
   * type so that nothing in the streamer has to know that cover exists.
   */
  blockersNear(x: number, z: number, reach: number, out: NearBlocker[], cap: number): number {
    const lim = Math.min(cap | 0, out.length);
    if (lim <= 0 || !(reach > 0)) return 0;
    let n = 0;
    const list = this.blockList;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      // Squared, with the blocker's own disc folded into the bound rather than subtracted from a
      // root: `Math.hypot` is a call and a square root apiece, and this list is walked up to four
      // times a step over as many as fourteen hundred records. `dist - radius > reach` and
      // `distÂ² > (reach + radius)Â²` are the same test for non-negative numbers.
      const dx = b.x - x;
      const dz = b.z - z;
      const far = reach + b.radius;
      if (dx * dx + dz * dz > far * far) continue;
      const e = out[n];
      e.x = b.x;
      e.z = b.z;
      e.radius = b.radius;
      e.topY = b.topY;
      if (++n >= lim) break;
    }
    return n;
  }

  /**
   * Note what a placed object stands like, the moment its collision is built. Only what really has
   * collision is ever offered: an object whose collision has not been built (too small, too far, or
   * placed inside a building) is not a wall to anything, and offering it would spend rays on a crate
   * that stops no bolts.
   */
  private noteBlocker(o: PlacedObject): void {
    if (o.contained || this.blockAt.has(o)) return;
    const box = this.loadedOf(o.model)?.bounds;
    if (!box) return;
    // **Extents and never corners.** A pack converted before the mesh reader took a BOX chunk's two
    // corners componentwise carries them the other way round -- seven models on one of the owner's
    // own worlds do -- so `box.max` is not reliably the larger end, and `max.y` read as the top
    // would put a rock's top at or below the feet of anything standing beside it and refuse it
    // silently, with no ray cast and nothing to show for it. The spans survive either way once the
    // sign is taken out, and the middle is a midpoint whichever corner is which.
    const hx = Math.abs(box.max.x - box.min.x) * 0.5;
    const hz = Math.abs(box.max.z - box.min.z) * 0.5;
    // The disc that covers the model's own box whatever way it is turned. It over-blocks -- a
    // square kilometre of town by four to twelve times -- and that does not matter, because a
    // blocker never claims cover: it only says where to put a candidate, and the rays decide.
    const radius = Math.hypot(hx, hz);
    if (!(radius > 0)) return;
    blockCentre.set((box.min.x + box.max.x) * 0.5, 0, (box.min.z + box.max.z) * 0.5).applyQuaternion(o.q);
    this.blockAt.set(o, this.blockList.length);
    // A placed object is turned about the world's up on every world in the game, so the model's own
    // highest point is still its highest point. Anything tipped on its side would read low here, and
    // the rays would refuse the spot it offered rather than believe it.
    this.blockList.push({ o, x: o.x + blockCentre.x, z: o.z + blockCentre.z, radius, topY: o.y + Math.max(box.min.y, box.max.y) });
  }

  /** And forget it when its collision goes: the last record is swapped into the hole it leaves. */
  private forgetBlocker(o: PlacedObject): void {
    const i = this.blockAt.get(o);
    if (i === undefined) return;
    this.blockAt.delete(o);
    const last = this.blockList.length - 1;
    if (i !== last) {
      const moved = this.blockList[last];
      this.blockList[i] = moved;
      this.blockAt.set(moved.o, i);
    }
    this.blockList.length = last;
  }

  /**
   * The object template a collider belongs to, or null for anything else the ray can find (the
   * ground, a building's interior shell, a body). The handle is the physics engine's own.
   */
  templateOfCollider(handle: number): string | null {
    return this.colliderTemplate.get(handle) ?? null;
  }

  get colliderCount(): number {
    return this.colliders.size;
  }

  /**
   * The nearest placed object of one of these templates, within `reach` metres, or null.
   *
   * Unlike `objectsNear` this **keeps the objects inside buildings**, because the things it is
   * asked about are almost always in one: the ship terminals the game places in its starports are
   * every last one of them `contained`, and a size-on-the-ground test is nothing to do with them
   * either -- it is asked whether somebody is standing at one, which is a distance in three.
   *
   * It walks the regions the circle touches, as `objectsNear` does, since a planet has tens of
   * thousands of placed objects and this is asked on a keypress rather than on a frame.
   */
  nearestPlaced(templates: ReadonlySet<string>, at: { x: number; y: number; z: number }, reach: number): PlacedObject | null {
    let best: PlacedObject | null = null;
    let bestD = reach;
    const rx0 = Math.floor((at.x - reach) / REGION);
    const rx1 = Math.floor((at.x + reach) / REGION);
    const rz0 = Math.floor((at.z - reach) / REGION);
    const rz1 = Math.floor((at.z + reach) / REGION);
    for (let rz = rz0; rz <= rz1; rz++) {
      for (let rx = rx0; rx <= rx1; rx++) {
        const region = this.regions.get(`${rx},${rz}`);
        if (!region) continue;
        for (const list of region.objects) {
          for (const o of list) {
            if (!templates.has(o.template)) continue;
            // The height counts as much as the ground distance: a starport stacks its floors and a
            // terminal on the one above is not one you are standing at.
            const d = Math.hypot(o.x - at.x, (o.y - at.y) * 1.5, o.z - at.z);
            if (d >= bestD) continue;
            bestD = d;
            best = o;
          }
        }
      }
    }
    return best;
  }

  /**
   * The placed objects standing inside buildings within `reach` metres of a point, flat, written into
   * `out` (emptied first); answers how many. A building's own furniture -- its chairs, its tables, its
   * counters -- is what the people of ours sit on and keep clear of (`src/world/ambient/`). It walks the
   * regions the circle touches, as `nearestPlaced` does, and is asked once a building, never a frame.
   */
  containedNear(x: number, z: number, reach: number, out: PlacedObject[]): number {
    out.length = 0;
    const rx0 = Math.floor((x - reach) / REGION);
    const rx1 = Math.floor((x + reach) / REGION);
    const rz0 = Math.floor((z - reach) / REGION);
    const rz1 = Math.floor((z + reach) / REGION);
    for (let rz = rz0; rz <= rz1; rz++) {
      for (let rx = rx0; rx <= rx1; rx++) {
        const region = this.regions.get(`${rx},${rz}`);
        if (!region) continue;
        for (const list of region.objects) {
          for (const o of list) {
            if (!o.contained) continue;
            if (Math.hypot(o.x - x, o.z - z) > reach) continue;
            out.push(o);
          }
        }
      }
    }
    return out.length;
  }

  /**
   * How many of those have a standing shape a body could get behind (`blockersNear`'s own list).
   *
   * It is the number to read before anything else about cover: nought here in a town is a wire that
   * was never connected, not a world without crates in it, and no counter downstream can tell the
   * two apart. It is smaller than `colliderCount` by whatever had no model loaded or no footprint.
   */
  get blockerCount(): number {
    return this.blockList.length;
  }

  /**
   * Whether the rooms of the building a body is standing in really have collision this instant.
   *
   * Which room a body is in is model data (`trackCell` reads boxes, portal polygons and a matrix)
   * and goes on answering for ever; the colliders those rooms are made of are built only within
   * `COLLIDER_RANGE` of the player and dropped again beyond it, and the whole tier can unload
   * under them as well. So for anything that stands on a floor rather than being drawn on one --
   * a fighter with a character controller under it -- "I am in cell 4" is not the same question as
   * "there is a floor under me", and asking the first for the second drops the body through it.
   *
   * Null (outdoors) is solid: the terrain answers there, and a fighter out of range of the
   * heightfield has its own floor in `settleFooting`.
   */
  cellsSolid(state: CellState | null): boolean {
    if (!state) return true;
    const b = state.building;
    if (!this.buildings.has(b)) return false;
    return !b.object || this.colliders.has(b.object);
  }

  /**
   * Follow the player through building portals, as the original client does: you are in the
   * world until your path crosses a portal into a cell, and in that cell until you cross one out.
   * `prev` and `pos` are the player's feet positions this frame and last.
   */
  trackCell(state: CellState | null, prev: THREE.Vector3, pos: THREE.Vector3): CellState | null {
    return this.followThrough(state, prev, pos, 0.9, 25);
  }

  /**
   * The same for a vehicle, from a point taken as it is given (a hull's middle, not a walker's chest):
   * a ship flies in and out of a hangar through the same doorways. It is followed on its own clock, so
   * the step between two samples can be longer than a walker's; `maxJump` is how far it may have gone
   * before the path is taken for a teleport.
   */
  trackVehicleCell(state: CellState | null, prev: THREE.Vector3, pos: THREE.Vector3, maxJump: number): CellState | null {
    return this.followThrough(state, prev, pos, 0, maxJump * maxJump);
  }

  private followThrough(state: CellState | null, prev: THREE.Vector3, pos: THREE.Vector3, lift: number, maxJumpSq: number): CellState | null {
    const jump = prev.distanceToSquared(pos);
    if (jump > maxJumpSq) return null; // teleport (noclip, travel): start over outside
    if (state) {
      const b = state.building;
      localA.copy(prev).setY(prev.y + lift).applyMatrix4(b.inverse);
      localB.copy(pos).setY(pos.y + lift).applyMatrix4(b.inverse);
      // Left the building entirely (fell out of a window, no-clipped): back outside.
      if (!tmpBox.copy(b.model.bounds).expandByScalar(3).containsPoint(localB)) return null;
      for (const portal of b.model.portals) {
        const link = portal.links.find((l) => l.from === state.cell) ?? portal.links.find((l) => l.to === state.cell);
        if (!link || !portal.passable) continue;
        if (crossing(portal, localA, localB) !== null) {
          const target = link.from === state.cell ? link.to : link.from;
          return target === 0 ? null : { building: b, cell: target };
        }
      }
      // Out of every room's box (a balcony past an outside door whose crossing was missed, a
      // window): outside, or the outside stays hidden while the player walks on it.
      if (!b.model.interiorBoxes.some((box) => tmpBox.copy(box).expandByScalar(1).containsPoint(localB))) return null;
      return state;
    }
    for (const b of this.buildings) {
      if (Math.abs(b.x - pos.x) > b.radius + 4 || Math.abs(b.z - pos.z) > b.radius + 4) continue;
      localA.copy(prev).setY(prev.y + lift).applyMatrix4(b.inverse);
      localB.copy(pos).setY(pos.y + lift).applyMatrix4(b.inverse);
      for (const portal of b.model.portals) {
        const link = portal.links.find((l) => l.from === 0) ?? portal.links.find((l) => l.to === 0);
        if (!link || !portal.passable) continue;
        if (crossing(portal, localA, localB) !== null) {
          const target = link.from === 0 ? link.to : link.from;
          if (target > 0) return { building: b, cell: target };
        }
      }
    }
    return null;
  }

  /** Elevator terminals within `range` of a point: 'up', 'down' or 'both' (plain elevator terminals). The lift shafts themselves are lifts.ts. */
  elevatorsNear(pos: THREE.Vector3, range: number): { kind: 'up' | 'down' | 'both'; d: number }[] {
    const out: { kind: 'up' | 'down' | 'both'; d: number }[] = [];
    for (const o of this.objects) {
      if (!o.template.includes('terminal_elevator')) continue;
      const d = Math.hypot(o.x - pos.x, o.z - pos.z);
      if (d > range || Math.abs(o.y - pos.y) > 3) continue;
      out.push({ kind: o.template.includes('_up') ? 'up' : o.template.includes('_down') ? 'down' : 'both', d });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  /**
   * A building with rooms beside a point (within its radius and a few metres) that has no way in
   * on foot at all: not one passable doorway between outside and any of its rooms. The dungeons
   * whose way in was a server object, the stations whose doors are up in the air. The nearest
   * such, or null.
   *
   * It used to ask a narrower question -- whether a passable outside doorway stood within a dozen
   * metres of the player and near their height -- which made the offer of a way in a thing that
   * came and went as you walked round a building that has perfectly good doors, at the back, on
   * the far side, or up its steps. A building with a door is now never offered one, wherever the
   * player is standing, and the owner keeps a list of the doors the game cannot find rather than
   * the game papering over them.
   */
  /**
   * The nearest building whose rooms are loaded, whatever its doors. For the console's own way in.
   *
   * It is not `doorlessNear` with the test taken off: that one also refuses while the player is
   * already inside something, which is the last thing a "put me in the next building" call wants.
   */
  nearestBuilding(pos: THREE.Vector3): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.buildings) {
      const d = Math.hypot(b.x - pos.x, b.z - pos.z);
      if (d >= bestD || !b.model.def.cells?.length) continue;
      bestD = d;
      best = b;
    }
    return best;
  }

  doorlessNear(pos: THREE.Vector3): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.buildings) {
      const d = Math.hypot(b.x - pos.x, b.z - pos.z);
      if (d > b.radius + 6 || !(b.model.def.cells?.length) || d >= bestD) continue;
      if (b.model.portals.some((p) => p.passable && p.links.some((l) => l.from === 0 || l.to === 0))) continue;
      bestD = d;
      best = b;
    }
    return best;
  }

  /**
   * The buildings around a point and why each does or does not count as doorless, for the console.
   * `outsideDoors` is the whole of the rule now: nought is a building the game offers a way into,
   * and any other number is one it expects you to walk into, so a building listed here with doors
   * that you cannot find on the ground is one for the owner's list.
   */
  describeDoorless(pos: THREE.Vector3): { model: string; d: number; radius: number; built: boolean; cells: number; portals: number; outsideDoors: number; doorless: boolean }[] {
    const out: { model: string; d: number; radius: number; built: boolean; cells: number; portals: number; outsideDoors: number; doorless: boolean }[] = [];
    for (const b of this.buildings) {
      const d = Math.hypot(b.x - pos.x, b.z - pos.z);
      if (d > b.radius + 30) continue;
      const outsideDoors = b.model.portals.filter((p) => p.passable && p.links.some((l) => l.from === 0 || l.to === 0)).length;
      out.push({ model: b.model.def.id, d: Math.round(d), radius: Math.round(b.radius), built: b.interiorBuilt, cells: b.model.def.cells?.length ?? 0, portals: b.model.portals.length, outsideDoors, doorless: outsideDoors === 0 && !!b.model.def.cells?.length });
    }
    return out;
  }

  /**
   * A way into a building for a player who cannot walk in: the room its outside doors open into
   * (even shut ones), else the lowest-numbered room, and a standing spot on that room's floor.
   */
  entryOf(b: Building): { cell: number; at: THREE.Vector3 } | null {
    this.buildInterior(b);
    const cells = (b.model.def.cells ?? []).filter((c) => c.index > 0);
    if (!cells.length) return null;
    const doorway = b.model.portals.find((p) => p.links.some((l) => l.from === 0 || l.to === 0));
    const link = doorway?.links.find((l) => l.from === 0 || l.to === 0);
    const index = link ? (link.from === 0 ? link.to : link.from) : cells[0].index;
    return this.standIn(b, cells.find((c) => c.index === index) ?? cells[0]);
  }

  /**
   * A standing spot inside a building's own named room, where it has one, and its way in otherwise.
   * The name is the caller's and is matched on the cell's own name; which name means what is the
   * caller's business too (`cloning.ts` says whose reading its own one is).
   */
  namedEntryOf(b: Building, name: string): { cell: number; at: THREE.Vector3 } | null {
    this.buildInterior(b);
    const cells = b.model.def.cells ?? [];
    // The pick itself is the rule in `cloning.ts`, which a node test runs: there is one of it, not a
    // copy here and a copy there that can drift apart.
    const index = namedCellIndex(cells, name);
    const cell = index > 0 ? cells.find((c) => c.index === index) : undefined;
    return cell ? this.standIn(b, cell) : this.entryOf(b);
  }

  /** A spot on the floor of one of a building's rooms, in the world. */
  private standIn(b: Building, cell: NonNullable<PackModelDef['cells']>[number]): { cell: number; at: THREE.Vector3 } {
    const [x0, y0, z0] = cell.bounds.min;
    const [x1, y1, z1] = cell.bounds.max;
    localA.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).applyMatrix4(b.matrix);
    // The room's lowest floor under its middle, in the world. The span searched is the room's own
    // height: a building is turned about the upright, which leaves a box's height alone, and the
    // corners are taken as an extent rather than as min and max, since the packs converted before
    // the box chunk was read properly carry the two the other way round.
    const half = Math.abs(y1 - y0) / 2 + 0.5;
    const floors = this.physics.floorsAt(localA.x, localA.z, localA.y + half, localA.y - half);
    const y = floors.length ? floors[floors.length - 1] + 0.15 : localA.y - half + 0.5;
    return { cell: cell.index, at: new THREE.Vector3(localA.x, y, localA.z) };
  }

  /**
   * The streamed building standing at a point, or null when its region has not loaded. Placed
   * buildings carry the very numbers the layout gave them, so this is an exact match within a metre
   * rather than a search for the nearest; with a template as well it is the one the caller meant
   * even where two buildings share an origin.
   */
  buildingPlacedAt(x: number, z: number, template?: string): Building | null {
    for (const b of this.buildings) {
      if (template !== undefined && b.template !== template) continue;
      if (Math.abs(b.x - x) < 1 && Math.abs(b.z - z) < 1) return b;
    }
    return null;
  }

  /** The building and cell holding a world point, for a player put there without walking in (a teleport), or null. */
  buildingAt(pos: THREE.Vector3): CellState | null {
    for (const b of this.buildings) {
      if (Math.abs(b.x - pos.x) > b.radius + 4 || Math.abs(b.z - pos.z) > b.radius + 4) continue;
      const cell = this.cellAt(b, pos);
      if (cell > 0) return { building: b, cell };
    }
    return null;
  }

  /**
   * The room a body stood where the data put it is in: room `room` of the streamed building near the
   * point that has such a room with the point in its box, or within `ROOM_SLACK` of it
   * (`buildingWithRoomIn`, which node tests). It is the data's answer, which `buildingAt` cannot give:
   * rooms overhang one another, and the smallest box that reaches over a person at a cantina's bar is
   * as often the corridor behind it. Null where no building near has that room, and the caller asks
   * `buildingAt` instead. Allocates its answer, like `buildingAt`: it is asked once, when a body is stood.
   */
  buildingWithRoom(pos: THREE.Vector3, room: number): CellState | null {
    const best = buildingWithRoomIn(this.buildings, pos, room);
    return best ? { building: best, cell: room } : null;
  }

  /**
   * Whether a world point stands in any streamed building's room: the same walk `buildingAt` makes,
   * asked as a yes or no. It is a method of its own and not a `!== null` on that one because
   * **`buildingAt` allocates** -- `{ building, cell }` is a fresh object on every hit -- and the
   * water rule in `World.footSurfaces.waterTop` is asked wherever a foot lands, a blade is lit or a
   * bolt stops. `cellAt` hands back a number and allocates nothing, so this walk is the prefilter's
   * two compares per streamed portal building, the cell boxes of whichever one holds the point, and
   * no garbage at all.
   */
  indoorsAt(pos: THREE.Vector3): boolean {
    for (const b of this.buildings) {
      if (Math.abs(b.x - pos.x) > b.radius + 4 || Math.abs(b.z - pos.z) > b.radius + 4) continue;
      if (this.cellAt(b, pos) > 0) return true;
    }
    return false;
  }

  /** The cell of a building whose bounds hold a world point (smallest first), or 0 for none. */
  cellAt(b: Building, pos: THREE.Vector3): number {
    localA.copy(pos).applyMatrix4(b.inverse);
    let best = 0;
    let bestVolume = Infinity;
    for (const c of b.model.def.cells ?? []) {
      if (c.index === 0) continue;
      const [x0, y0, z0] = c.bounds.min;
      const [x1, y1, z1] = c.bounds.max;
      if (localA.x < x0 - 0.5 || localA.x > x1 + 0.5 || localA.y < y0 - 0.5 || localA.y > y1 + 0.5 || localA.z < z0 - 0.5 || localA.z > z1 + 0.5) continue;
      const v = (x1 - x0) * (y1 - y0) * (z1 - z0);
      if (v < bestVolume) {
        bestVolume = v;
        best = c.index;
      }
    }
    return best;
  }

  get status(): string {
    return `${this.loadedInstances}/${this.objects.length} snapshot objects in view, ${this.loadedModels} models, ${this.colliders.size} exact colliders, ${this.interiorCount} interiors built`;
  }

  dispose(): void {
    this.disposed = true;
    for (const b of this.buildings) this.dropInterior(b);
    for (const region of this.regions.values()) for (let t = 0; t < TIERS.length; t++) this.unloadTier(region, t);
    for (const o of [...this.colliders.keys()]) this.removeColliders(o);
    this.hugeQueue.length = 0;
    this.buildings.clear();
    this.furnitureByHost.clear();
    this.furnitureSwaps.clear();
    this.levelGroups.length = 0;
  }
}
