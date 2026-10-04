// Everything from the catalogue that is out on this planet: the spawns (a cap on how many, and on
// the bytes their models hold), what the world's data and its server stand, the lookup from a collider
// to its body, and the one loop that steps them all with the level of detail each has earned.
//
// A mobile is culled as a whole, against one sphere of its own, by setting its group's
// visibility: an invisible group is skipped by the renderer outright, so none of its meshes is
// drawn, none of its skeletons updated and none of its bone textures uploaded, in any of the
// portal renderer's passes. Within that, each mesh is culled on its own by three in every pass
// and shadow cascade (commit 3c, `bodyCull.ts`): a skinned mesh carries the same sphere, set once
// in its own frame when the body is hung, so it never walks its vertices for one. The manager owns
// three flags on every mesh from the moment it is attached: the group's visibility, the shadow
// casting (at 2 Hz, by size, screen and the cascades' light boxes), and `frustumCulled` (the switch,
// off while the body lies off its feet: dead, a ragdoll, knocked down, or in an idle lying at full length).
import * as THREE from 'three';
import { Group, groups, RAPIER, type Physics } from '../../core/physics';
import type { Terrain } from '../terrain';
import type { Bolts } from '../../combat/bolts';
import type { Effects } from '../../combat/effects';
import type { Hittable, Living } from '../../combat/kit';
import { GUNS, gunTypeFor } from '../../combat/guns';
import { Character } from '../../player/character';
import type { WeaponCatalogue } from '../../player/weapons';
import { Mobile, type MobileContext, type MobileEquipment, type MobileExtras, type MobileSpawn } from './mobile';
import { MOBILE_CACHE, MobileAssets, type ModelAsset, type PackAsset } from './assets';
import { armedRoles, carryWeaponFor, chooseWeapon, decideArms, forcedArmsRefusal, SABER_SWINGS, type OwnArms } from './arms';
import { withMood } from './moodIdle.ts';
import { applyDifficultyTo } from '../difficulty.ts';
import { isLook, lookKey } from './look';
import { lookBounds, permanentGap } from './spawning';
import type { PackSummary } from './types';
import { CATALOGUE_COMMAND, type MobileCatalogue } from './catalogue';
import { BRAIN_TUNE, type BrainTune } from './brain';
import { GAIT_LIMITS, moveSpeeds, type GaitLimits } from './gait';
import { LOD_TUNE, lodTier, type LodInput, type LodTier, type LodTune } from './lod';
import { reachesCascades } from '../bodyCull.ts';
import { STEP_STATS, STEP_TUNE, tuneStep, type StepTune } from './stepUp.ts';
import { describeRoles, rolesFor } from './packClips';
import type { BodyInput } from './shape';
import type { MobileEntry } from './types';
import type { CellState } from '../layoutStream';
import type { FighterGlow } from '../npcs';
import { keepNearestGlow } from '../../combat/bladeLights';
import { PendingSpawns, armsRng, decideStand, rollsFor, scaleFrom, type SpawnRecord } from '../spawnSeed.ts';
import { neverShared, npcNow, sharesOnWire, sharesSeen } from '../../net/npcNet.ts';
// A person fighting as a fighter does: the cover search's physics, the rolls and jumps it is lent,
// and the tables its tier, its posture, its roll and its jump are read from (`tactics.ts`, `evade.ts`).
import type { CoverDeps } from '../cover.ts';
import { outdoorNav } from '../nav/outdoorNav.ts';
import { EVADE_CLIPS, EVADE_TUNE, JUMP_TUNE, tuneEvade, tuneJump, type EvadeTune, type JumpTune } from '../evade.ts';
import { GROUND_TIERS, TIER_LEVELS } from '../groundSkill.ts';
import { POSTURE_TUNE, tunePosture, type Posture, type PostureTune } from '../fighterStance.ts';
import type { NearBlocker } from '../layoutStream';
import type { GroundTactics } from './tactics.ts';
// A lightsaber's moves (`npcSaber.ts`): every clip the move machine can ask for, to lend, and the style by seed.
import { NPC_SABER_CLIPS, styleOf } from '../npcSaber.ts';
// Where the people standing in a building are put when it comes down.
import { doorstepSpot } from '../myBuildings.ts';

export interface SpawnOpts {
  /** How it came to stand: always by somebody's hand or the world's data now that nothing roams in on its own. */
  origin?: 'spawned';
  scale?: number;
  inside?: boolean;
  overrides?: MobileSpawn['overrides'];
  heading?: number;
  /**
   * One number everything this spawn would otherwise roll is drawn from (src/world/spawnSeed.ts):
   * its size within its own range, the weapon it takes off the rack and the colour of a blade. With
   * none given it rolls as it always did, so nothing that stood a creature before this behaves
   * differently now.
   */
  seed?: number;
  /**
   * The name the world knows this one by, when it is one the world holds rather than one this
   * browser stood for itself. It is what `removeById` takes it down by, and it keeps the hand-spawn
   * cap and the NPC tab's clear off the body; a spawn without one is this browser's own business.
   */
  worldId?: string;
  /**
   * Whether it goes on the wire as one of the server's own records, to be kept by whichever browser the
   * server grants it to (`sharesOnWire`). Only a body stood from one of the server's own records asks
   * for that (`standRecord`). A lair's creature and a person at a post -- seeded from the same data in
   * every browser -- go on the wire another way, by saying they have been seen (`sharesSeen`), and only
   * while a server that speaks of them is answering and only when they may be struck at all; a ticket
   * collector and one of ours never do.
   */
  share?: boolean;
  /**
   * How long a seen body stays down once it dies before any browser stands it again, in seconds: its
   * own row's respawn (a lair's broken wait, a person's own seconds). What the server holds its death
   * for, so a browser walking up meanwhile does not stand a whole copy of something everybody saw die.
   */
  respawn?: number;
  /**
   * Part of the furniture: it stands where it is stood, takes no damage and never dies.
   *
   * The ticket collector, and everyone else the game had standing at a post. See `Mobile.essential`.
   */
  essential?: boolean;
  /**
   * Stood from one of the world's list's own records (`standRecord`), which is what that list may take
   * down again when it no longer names it (`fromList`, `sweptByList`). A body this browser stood under a
   * world name of its own -- a ticket collector, a lair's creature, a person standing about -- is not.
   */
  listed?: boolean;
  /**
   * A fixture the world cannot work without -- a ticket collector, without whom nobody boards a
   * shuttle -- which the model memory budget never refuses. The budget is there to keep a crowd from
   * growing without end, and a town's people fill it: a collector stood after them was refused for as
   * long as they stood, which was for as long as anybody was at the starport. There are a handful.
   */
  fixture?: boolean;
  /**
   * The room of its building it stands in, where the data says (a standing person's row): it seeds the
   * body's cell rather than the smallest room box that holds the point, since rooms overhang one another
   * and a person at the cantina's bar was otherwise put in whichever room's box reached over it.
   */
  room?: number;
  /**
   * The mood it was stood in (a town's row), whose idle is lent from a species rig that is already
   * parsed (`Character.parsedRigMood`); a mood with no branch there leaves it in its own idle.
   */
  mood?: string;
  /** The name it goes by in place of its entry's: a story's person, as the player knows them (`Mobile.rename` changes it later). */
  name?: string;
  /**
   * What its own creature fought with, first and second, as the emulator wrote them (a group's name, a
   * template or `unarmed`), and the groups those names stand for: it is armed from these before any
   * guess from its name (`ownWeapon` in arms.ts).
   */
  weapons?: readonly string[];
  weaponGroups?: Readonly<Record<string, readonly string[]>> | null;
  /**
   * A weapon the console chose for it, by the rack's template (`__debug.mobile(.., { weapon })`): held
   * over its own list, its name and its temper (`OwnArms.forcedTemplate`). This browser's own spawns,
   * and a body stood from one of the server's records that carries one (`SpawnRow.weapon`, the admin's
   * choice, which every browser stands alike); never a seeded body, which every browser arms from its
   * own seed and a choice made here would put a different weapon in its hand on this screen alone.
   */
  weaponTemplate?: string;
}

export interface MobileManagerDeps {
  physics: Physics;
  terrain: Terrain;
  bolts: Bolts;
  assets: MobileAssets;
  /** The effects, once they exist. */
  effects(): Effects | null;
  /**
   * The catalogue, or null while its fetch is still in flight. A getter, never a value: a manager
   * that captured null at a cold first load would be dead for the life of that planet.
   */
  catalogue(): MobileCatalogue | null;
  /** The list to fight over. */
  targets(): readonly Living[];
  /** The ground under a point, through the physics when inside a building. */
  groundAt(x: number, y: number, z: number, inside: boolean): number | null;
  /** The swell over a point whose flat surface the caller has, so a swimmer rides the waves. */
  seaSwellAt?(x: number, z: number, flat: number): number;
  /** What a physics collider belongs to, when a carried blade sweeps through it. */
  hittableAt?(handle: number): Hittable | undefined;
  /**
   * The room a mobile put down inside a building starts in (it walked through no portal to get
   * there): the smallest room box holding the point, or null. Never the player's room for want of a
   * better answer: a body stood a hundred metres off in a building that has not streamed in is not
   * in the room the player happens to be in. With `room`, the data's own room of the building that
   * holds the point, which is the answer wherever it has one (`SpawnOpts.room`).
   */
  cellAt(p: THREE.Vector3, room?: number): CellState | null;
  /**
   * Whether that room has collision under it this instant (`LayoutStreamer.cellsSolid`). With no
   * answer wired every room is solid, which is how the mobiles behaved before it existed.
   */
  cellSolid?(state: CellState | null): boolean;
  /**
   * Follow a body through a building's portals, as the player is followed (`trackCell`): outside
   * until its path crosses a portal into a room, in that room until it crosses one out. Not by
   * the rooms' bounds: rooms are often larger than the hull, and a body on the street beside one
   * would be taken to be inside it and lose the terrain from its colliders.
   */
  followCell(state: CellState | null, prev: THREE.Vector3, pos: THREE.Vector3): CellState | null;
  /** A clear standing spot `distance` ahead of a point, or null. */
  spawnSpot(from: THREE.Vector3, forward: THREE.Vector3, distance: number, inside: boolean): THREE.Vector3 | null;
  /** A sentence when nothing may be stood here at all (space), else null. */
  refuse(): string | null;
  /** Whether shadows are on at all. */
  shadows(): boolean;
  /**
   * The shadow cascades' light boxes where they last stood (`World.shadowBoxes`, refreshed after the
   * cascades move each frame, so a frame behind here): a body whose sphere reaches none of them throws no
   * shadow (commit 3c, `lodTier`'s `inCascades`). None wired, or none yet, no limit.
   */
  shadowBoxes?(): readonly THREE.Frustum[] | null;
  /**
   * The ground's height where the world already holds it, never made on the spot (`World.groundIfCached`),
   * and whether the ground under a point has its colliders (within the physics' reach of the player): a
   * body outdoors past that reach asks the first and never the terrain itself (commit 4b, `groundProbe.ts`).
   * None wired, every body asks the terrain as it always did.
   */
  groundIfCached?(x: number, z: number): number | null;
  groundSolid?(x: number, z: number): boolean;
  /**
   * How the portal renderer's last frame saw the rooms of the body under this root (its group): 0 unseen,
   * 1 seen, 2 one room past a seen one, -1 left to the frustum (the switch off, nothing drawn since, a body
   * that frame did not route, or one that counts outdoors). With no answer wired the frustum alone decides,
   * as it always did.
   */
  roomSeen?(root: THREE.Object3D): number;
  /** The weapons rack, once it has loaded (a person's gun or lightsaber comes off it); null until then, or without one. */
  weapons?(): WeaponCatalogue | null;
  /**
   * What stands near a point that a body could hide behind (`LayoutStreamer.blockersNear`), the one
   * thing the cover search is handed: every ray it casts it casts itself. The fighters' own wire,
   * given to the people as well; with none, a person finds no cover and walks into the open.
   */
  blockers?(x: number, z: number, reach: number, out: NearBlocker[], cap: number): number;
}

/** A person's fight counts added into a row of the report (`fightReport`). */
function addFight(row: Record<string, number>, tac: GroundTactics): void {
  const c = tac.counts;
  row.shots += c.shots;
  row.hits += c.hits;
  row.kneels += c.kneels;
  row.prones += c.prones;
  row.crouches += c.crouches;
  row.covers += c.covers;
  row.slides += c.slides;
  row.rolls += tac.evade.rolls;
  row.hops += tac.evade.hops;
  row.jumps += tac.evade.jumps;
}

/** Outside: everything, which is what the cover search's floor probe is filtered by, as a fighter's is. */
const OUTSIDE_FILTER = groups(Group.all, Group.all);
/** What a spot's floor may be: only what stands still, never a body that walks off. */
const staticOnly = (c: RAPIER.Collider): boolean => {
  const body = c.parent();
  return !body || body.isFixed();
};

/**
 * What the console moves about a person's fighting (`__debug.mobileTune`): the tier every person is
 * put on, or null for its own level's; the levels the ladder is climbed at; the postures' numbers and a
 * posture put on by hand; and the roll's and the jump's tables.
 */
export interface FightKnob {
  tier?: number | null;
  levels?: number[];
  postures?: Partial<PostureTune>;
  posture?: Posture | 'auto' | null;
  roll?: Partial<EvadeTune>;
  jump?: Partial<JumpTune>;
}

/** What a person is armed with and played with, worked out while the model loads. */
interface ArmsPlan {
  equipment: MobileEquipment | null;
  extras: MobileExtras | null;
}

/** The blade colours: a Sith's, a Dark Jedi's and an Inquisitor's red, anyone else's one of the Jedi's. */
const DARK_BLADE = 0xff2a1a;
const LIGHT_BLADES = [0x3aa0ff, 0x40e060, 0x3aa0ff, 0x8a5cff];

/** What a group-wide or console spawn reports. */
export interface SpawnResult {
  spawned: number;
  note: string;
  mobiles: Mobile[];
}

const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();
const sphere = new THREE.Sphere();
const tmp = new THREE.Vector3();
const ZERO = new THREE.Vector3();
/** The tier's input, filled per mobile every frame rather than made anew. */
const lodInput: LodInput = { dist: 0, onScreen: true, nearScreen: true, busy: false, sizeClass: 'small', shadows: false, playerDist: 0, animRange: LOD_TUNE.animRange, room: -1, inCascades: undefined };
/** How often (seconds) a mobile's inside-or-out is asked again, and its shadow flag set. */
const INSIDE_EVERY = 0.25;
/** A body that has gone this far since its room was last followed is followed now, whatever the clock (the tracker takes a jump over 5 m as a teleport). */
const FOLLOW_STEP = 2;
const SHADOW_EVERY = 0.5;

interface Held {
  model: ModelAsset | null;
  pack: PackAsset | null;
  loading: boolean;
  error: string | null;
  lastInside: number;
  lastShadow: number;
  cast: boolean | null;
  visible: boolean | null;
  loaded: Promise<void>;
  /** Its tier, refilled every frame (the mobile keeps a reference to it for the console). */
  tier: LodTier;
  /** The one number it rolls everything from, or undefined for one that rolls as it always did. */
  seed: number | undefined;
  /** The building room it is in, followed through the portals, or null outside. */
  cell: CellState | null;
  /** Where its feet were when the room was last followed. */
  readonly cellFrom: THREE.Vector3;
}

export class MobileManager {
  readonly group = new THREE.Group();
  readonly live: Mobile[] = [];
  readonly byCollider = new Map<number, Mobile>();
  /** Bumped on every spawn and removal, so the world's target list knows when to rebuild. */
  version = 0;
  /** How many spawned mobiles may be out (the `mobileCap` setting). */
  cap = 40;
  /** Past this the mixers hold still (the `mobileAnimRange` setting). */
  animRange = LOD_TUNE.animRange;
  /** The last refusal or failure, for the spawner's count line. */
  lastNote = '';
  /** How many the last step put off screen because their room was not seen, or one room past it (commit 2c). */
  walled = 0;
  private readonly held = new Map<Mobile, Held>();
  private readonly ragdollQueue: Mobile[] = [];
  private readonly warned = new Set<string>();
  private frame = 0;
  private disposed = false;
  private readonly camPos = new THREE.Vector3();

  constructor(private readonly deps: MobileManagerDeps) {
    this.group.name = 'mobiles';
  }

  get assets(): MobileAssets {
    return this.deps.assets;
  }

  /** The catalogue, when it has landed. */
  catalogue(): MobileCatalogue | null {
    return this.deps.catalogue();
  }

  /**
   * Why an entry cannot be stood now, in a sentence, or null when it can.
   *
   * The origin is what the cap is asked about. `spawned` is one this browser stood from the tab and
   * is what the cap counts; `world` is one the world holds, which the cap must never refuse -- it is a
   * local limit on what somebody may stand from the tab, and applied to the world's list every browser
   * would end up holding a different arbitrary subset of the creatures everyone else can see, with
   * nothing said anywhere.
   */
  whyNot(entry: MobileEntry, cat: MobileCatalogue, origin: 'spawned' | 'world' = 'spawned', budget = true): string | null {
    const where = this.deps.refuse();
    if (where) return where;
    // The one model the game's own archives cannot give: said as what it is, not as a fault.
    const gap = permanentGap(entry, cat.file.failed);
    if (gap) return `${entry.name} (${entry.id}) is ${gap}`;
    const ready = cat.ready(entry);
    if (!ready.ok) return `${entry.name} (${entry.id}) is not ready: ${ready.why}`;
    const app = cat.appearanceOf(entry);
    if (!app && entry.kind !== 'dressed') return `${entry.name} (${entry.id}) names no appearance in the catalogue`;
    if (entry.kind === 'dressed' && !entry.species) return `${entry.name} (${entry.id}) is a dressed NPC that names no species to dress`;
    const key = MobileAssets.modelKey(entry, cat);
    if (!key) return `${entry.name} (${entry.id}) has no model file`;
    const failed = this.deps.assets.failure(key);
    if (failed) return `${entry.name}: ${failed}`;
    if (origin === 'spawned' && this.spawnedCount() >= this.cap) return `${this.cap} are out already (Graphics, Distance and detail)`;
    const cost = budget ? this.deps.assets.wouldCost(entry, cat) : 0;
    if (cost > 0) {
      const room = MOBILE_CACHE.budget - this.deps.assets.referencedBytes();
      if (cost > room) {
        const mb = (n: number) => Math.round(n / 1e6);
        return `the creature and NPC models already out fill their memory budget (${mb(this.deps.assets.referencedBytes())} of ${mb(MOBILE_CACHE.budget)} MB); clear some, or raise it with __debug.mobileTune({ budget: ${Math.round((MOBILE_CACHE.budget * 1.5) / 1e7) * 1e7} })`;
      }
    }
    return null;
  }

  /**
   * How many bytes the model memory budget is short of standing `entry` now: nought when it fits. It is
   * the arithmetic `whyNot` refuses a spawn by, so a caller that means to make room knows how much.
   */
  budgetShort(entry: MobileEntry): number {
    const cat = this.deps.catalogue();
    if (!cat) return 0;
    const cost = this.deps.assets.wouldCost(entry, cat);
    if (cost <= 0) return 0;
    return Math.max(0, cost - (MOBILE_CACHE.budget - this.deps.assets.referencedBytes()));
  }

  /**
   * What putting a set of bodies down together would give back to that budget, counted as the set grows
   * (`FreeTally`, src/world/mobiles/lookShare.ts): `freeStart` begins a set, and `frees(m)` puts `m` in
   * it and answers what the whole set gives back so far -- each model and animation pack once nothing
   * standing outside the set holds it, and each piece people's looks share once no look outside the set
   * that is out holds it. Never a sum of what each would give back alone: a piece only the set shares
   * (one species' body, one look worn twice) is in none of those. A body still loading gives back
   * nothing yet. One set at a time.
   */
  freeStart(): void {
    this.deps.assets.freeTally.reset();
  }

  frees(m: Mobile): number {
    const tally = this.deps.assets.freeTally;
    const held = this.held.get(m);
    return held ? tally.add(held.model, held.pack) : tally.total;
  }

  /**
   * How many this browser stood by hand. A body with a world name is the world's -- a lair's creature,
   * a person standing about, a collector, one the server stood -- and is never counted, or forty people
   * standing in a town used up the whole of the NPC tab's allowance and it refused everything.
   */
  private spawnedCount(): number {
    let n = 0;
    for (const m of this.live) if (m.origin === 'spawned' && !this.worldIds.has(m)) n++;
    return n;
  }

  /** How many stood by hand are out (what the cap counts; nothing the world holds is). */
  get spawnedOut(): number {
    return this.spawnedCount();
  }

  /**
   * The mobiles' lit blades nearest `eye` within `maxDistance`, nearest first, each in its blade's
   * colour: where they want pooled light this frame, as `NpcManager.lightSpots`. Fills `out` (kept
   * entries, reordered in place) after the `n` already there (the fighters'), keeping the nearest
   * of them all, and returns how many.
   */
  lightSpots(out: FighterGlow[], eye: THREE.Vector3, maxDistance: number, n = 0): number {
    const max2 = maxDistance * maxDistance;
    for (const m of this.live) {
      if (!m.glowAt(tmp)) continue;
      const d2 = tmp.distanceToSquared(eye);
      if (d2 > max2) continue;
      n = keepNearestGlow(out, n, tmp, m.bladeColor, d2);
    }
    return n;
  }

  /** Every mobile's drawn blade core, for the depth of field's glow depth: fills `out` from `n`, returns the new count. */
  glowCores(out: THREE.Object3D[], n: number): number {
    for (const m of this.live) n = m.glowCore(out, n);
    return n;
  }

  /**
   * Stand one entry at a point (on the ground under it, or on the floor when inside). Returns the
   * mobile, whose model then loads behind it, or a sentence saying why not. The body exists at
   * once, so the cap and the counts are right before anything has downloaded.
   */
  spawn(entry: MobileEntry, at: { x: number; z: number; y?: number; heading?: number }, opts: SpawnOpts = {}): Mobile | string {
    if (this.disposed) return 'the world has gone';
    const cat = this.deps.catalogue();
    if (!cat) return `the creature and NPC catalogue has not loaded yet (or is not converted: ${CATALOGUE_COMMAND})`;
    const origin = opts.origin ?? 'spawned';
    // One the world holds is not this browser's own spawn, whatever it is stored as: it is asked
    // about as `world` so the hand-spawn cap never refuses it (see `whyNot`).
    const why = this.whyNot(entry, cat, opts.worldId ? 'world' : origin, !opts.fixture);
    if (why) {
      this.lastNote = why;
      return why;
    }
    // A dressed NPC has no appearance of its own: it is planned from a person's box at its species' height.
    const bounds = lookBounds(entry, cat.file.appearances);
    const pack = cat.packOf(entry);
    const inside = opts.inside ?? false;
    let y = at.y;
    if (y === undefined) {
      const ground = this.deps.groundAt(at.x, this.deps.terrain.heightAt(at.x, at.z) + 3, at.z, inside);
      if (ground === null) {
        if (inside) return (this.lastNote = 'there is no floor under that spot');
        y = this.deps.terrain.heightAt(at.x, at.z);
      } else y = ground;
    }
    const hierarchy: BodyInput['hierarchy'] = pack?.hierarchy === 'creature_base' || pack?.hierarchy === 'all_b' ? pack.hierarchy : 'other';
    // A seeded spawn rolls nothing: its heading and its size come out of the one number every browser
    // standing this record has, so the same creature stands the same way in all of them.
    const rolls = opts.seed !== undefined ? rollsFor(opts.seed) : null;
    const spawn: MobileSpawn = {
      entry,
      x: at.x,
      y,
      z: at.z,
      heading: at.heading ?? opts.heading ?? (rolls ? rolls.heading * Math.PI * 2 : Math.random() * Math.PI * 2),
      origin,
      inside,
      bounds,
      hierarchy,
      scale: opts.scale ?? (rolls ? scaleFrom(entry.size?.scale, rolls.scale) : undefined),
      overrides: opts.overrides,
      ...(opts.name ? { name: opts.name } : {}),
    };
    const m = new Mobile(spawn, {
      physics: this.deps.physics,
      terrain: this.deps.terrain,
      bolts: this.deps.bolts,
      effects: () => this.deps.effects(),
      alert: (self, attacker) => this.assist(self, attacker),
      groundAt: (x, gy, z, ins) => this.deps.groundAt(x, gy, z, ins),
      seaSwellAt: this.deps.seaSwellAt ? (x, z, flat) => this.deps.seaSwellAt!(x, z, flat) : undefined,
      hittableAt: (h) => this.deps.hittableAt?.(h),
      wantRagdoll: (self) => this.queueRagdoll(self),
      // A body gone down or got up again leaves the living list or joins it: the world builds that list anew
      // only when this number moves.
      onDowned: () => {
        this.version++;
      },
      groundIfCached: this.deps.groundIfCached ? this.groundCached : undefined,
      groundSolid: this.deps.groundSolid ? this.groundSolid : undefined,
      cover: this.deps.blockers ? this.coverDeps : null,
      forgetMaterials: this.forgetBlade,
    });
    this.live.push(m);
    for (const c of m.colliders) this.byCollider.set(c.handle, m);
    this.group.add(m.group);
    this.version++;
    const held: Held = {
      model: null,
      pack: null,
      loading: true,
      error: null,
      lastInside: -1,
      lastShadow: -1,
      cast: null,
      visible: null,
      loaded: Promise.resolve(),
      tier: { name: 'near', animEvery: 1, visible: true, castShadow: false, think: LOD_TUNE.think[0], move: true },
      seed: opts.seed,
      cell: null,
      cellFrom: m.pos.clone(),
    };
    if (inside) {
      held.cell = this.deps.cellAt(m.pos, opts.room);
      m.room = held.cell?.cell ?? 0;
      m.navCell = held.cell;
      // Where home is: the room it was stood in, which a walk home after a fight is sent to the door of.
      m.homeCell = held.cell;
    }
    this.held.set(m, held);
    m.essential = !!opts.essential;
    m.fixture = !!opts.fixture;
    if (opts.listed) this.listed.add(m);
    if (opts.worldId) {
      this.byWorldId.set(opts.worldId, m);
      this.worldIds.set(m, opts.worldId);
      // One the server stood: the wire is told, so whichever browser the server grants it to thinks
      // for it and every other one holds the same body with its brain switched off. With no server
      // this costs a map insert and nothing else, and every creature stays this browser's own.
      if (sharesOnWire(opts.worldId, opts.share)) {
        m.shareAs(opts.worldId);
        npcNow()?.add(m);
      } else this.shareSeen(m, opts.worldId, !!opts.essential, opts.respawn ?? 0);
    }
    held.loaded = this.load(m, held, entry, cat, opts);
    return m;
  }

  /**
   * Whether an entry's body is already built here or being built: a look already dressed costs nothing
   * more to stand again, which is what a crowd drawn from a dress group leans on (`PEOPLE_TUNE.reuseLook`).
   */
  holdsBody(entry: MobileEntry): boolean {
    const cat = this.deps.catalogue();
    return !!cat && this.deps.assets.holds(entry, cat);
  }

  /** The difficulty knob moved: every body out takes it (`Mobile.applyDifficulty`). */
  applyDifficulty(scale: number): void {
    applyDifficultyTo(this.live, scale);
  }

  // ---- the world's own spawns -----------------------------------------------------------------------
  //
  // Nothing appears in a world on its own any longer: what is out there was stood by an admin, and
  // what an admin stands belongs to the world. Such a spawn is a record (src/world/spawnSeed.ts)
  // rather than a call, so every browser stands the same creature from the same numbers and can take
  // the same one down again by name.

  /** The world's spawns by the name every browser knows them by. */
  private readonly byWorldId = new Map<string, Mobile>();
  /** The other way round, so a mobile met in a list can say what the world calls it. */
  private readonly worldIds = new WeakMap<Mobile, string>();
  /** The ones stood from the world's list's own records: the only ones that list may take down again. */
  private readonly listed = new WeakSet<Mobile>();
  /** How long each seeded body stays down once it dies (its row's respawn, seconds), kept for a server met after it was stood. */
  private readonly respawnOf = new WeakMap<Mobile, number>();

  /**
   * A body this browser seeded for itself put on the wire by saying it has been seen (`sharesSeen`):
   * one of the seeded kind, that may be struck, that is nobody's alone (`neverShared`), and only while a
   * server that speaks of the seen ones is answering. Every other is left exactly as it was: this
   * browser's own, as every such body was before.
   */
  private shareSeen(m: Mobile, worldId: string, essential: boolean, respawn: number): void {
    this.respawnOf.set(m, respawn);
    const net = npcNow();
    if (!net || !sharesSeen(worldId, essential, net.seedingNow) || neverShared(m)) return;
    m.shareAs(worldId);
    net.addSeen(m, m.pos, respawn);
  }

  /**
   * Every seeded body already standing put on the wire, now that a server that speaks of them is
   * answering: it came after they were stood (a line opened mid-session, or come back after a drop,
   * which clears the wire and leaves the bodies). A body already on it is left; one that may not be
   * shared is left too. Answers how many went on.
   */
  shareSeeded(): number {
    const net = npcNow();
    if (!net || !net.seedingNow) return 0;
    let n = 0;
    for (const m of this.live) {
      if (m.removed || m.dead) continue;
      const id = this.worldIds.get(m);
      if (!id || this.listed.has(m) || neverShared(m) || m.essential) continue;
      if (m.npcId && net.find(m.npcId) === m) continue;
      if (!sharesSeen(id, false, true)) continue;
      m.shareAs(id);
      net.addSeen(m, m.pos, this.respawnOf.get(m) ?? 0);
      n++;
    }
    return n;
  }

  /**
   * A body taken off the wire for good while it stands, because it has become this browser's alone (a
   * follower, `neverShared`). It must be one this browser keeps or one that was never on the wire: one
   * somebody else keeps is not this browser's to take, and the answer says so (false). Its name is let go
   * of here as well, so a body the world stands under the same name later is a new one, and so the world's
   * list never takes it down for not naming it.
   */
  unshare(m: Mobile): boolean {
    if (!this.mayUnshare(m)) return false;
    const id = m.npcId;
    if (id) {
      const net = npcNow();
      // On the wire and kept here: the keeper says it has walked off, and every other browser takes its
      // copy down. Off the wire already (no server), there is nothing to say.
      if (net?.find(id) === m && !net.leave(id) && net.active) return false;
      m.unshare();
    }
    const name = this.worldIds.get(m);
    if (name && this.byWorldId.get(name) === m) this.byWorldId.delete(name);
    this.listed.delete(m);
    return true;
  }

  /**
   * Whether `unshare` would take that body off the wire, asked before anything is done to it: a caller
   * that first takes the body off its own books (a lair's, a row's) must not do so for a body the wire
   * will then refuse to let go of, or the body is nobody's at all. Not one somebody else keeps; not one on
   * the wire that may not leave it (`NpcNet.mayLeave`: not kept here this instant, or a server that would
   * not hear it walk off). One off the wire, or with no server answering, always may.
   */
  mayUnshare(m: Mobile): boolean {
    if (m.isDriven) return false;
    const id = m.npcId;
    if (!id) return true;
    const net = npcNow();
    if (!net || net.find(id) !== m || !net.active) return true;
    return net.mayLeave(id);
  }

  /** The records that arrived before the catalogue did; stood the moment it lands. */
  private readonly pending = new PendingSpawns();

  /**
   * Stand one from a record: its place, its heading and everything it would otherwise roll, all out
   * of the record itself. The entry is resolved from the catalogue by the record's species key, so a
   * browser told about a spawn needs nothing but the record.
   *
   * `world` is the world this browser is standing in, and a record naming any other is refused: a
   * spawn word for the world just left can arrive during or after a trip, and stood here it would
   * put a creature at the old world's metres. The whole decision is `decideStand` in
   * `src/world/spawnSeed.ts`, which a node test drives branch by branch.
   *
   * Answers the mobile, or a sentence. A record that is already standing answers the one already
   * standing, since the same record arriving twice must never make two creatures; a record that
   * arrives before the catalogue has landed -- the ordinary case, since its one fetch is usually
   * still in flight when the first planet loads -- is kept and stood the moment it does, and the
   * sentence says so.
   */
  standRecord(rec: SpawnRecord, world: string): Mobile | string {
    const id = rec && typeof rec.id === 'string' ? rec.id : '';
    const already = id ? this.byWorldId.get(id) : undefined;
    const cat = this.deps.catalogue();
    const choice = decideStand(rec, {
      world,
      standing: !!already && !already.removed,
      catalogue: !!cat,
      known: !!cat && !!rec && !!cat.byId(rec.species),
    });
    if (choice.do === 'already') return already!;
    if (choice.do === 'refuse') {
      if (id) this.pending.drop(id);
      this.lastNote = choice.why;
      return choice.why;
    }
    if (choice.do === 'wait') {
      this.pending.add(rec, world);
      this.lastNote = choice.why;
      return choice.why;
    }
    const a = choice.args;
    this.pending.drop(a.id);
    const entry = cat!.byId(a.species)!;
    // The weapon the admin put in its hand rides in the record, so every browser arms it alike.
    const weapon = typeof rec.weapon === 'string' && rec.weapon ? { weaponTemplate: rec.weapon } : {};
    return this.spawn(entry, { x: a.x, y: a.y, z: a.z, heading: a.heading }, { origin: 'spawned', inside: a.inside, seed: a.seed, worldId: a.id, listed: true, share: true, ...weapon });
  }

  /**
   * The records that were waiting for the catalogue, stood now that it is here. Called from the
   * manager's own step, so nothing outside has to remember to ask and a browser that arrived before
   * the catalogue did still ends up with the world's creatures rather than with none of them.
   */
  private drainPending(): void {
    for (const p of this.pending.take()) this.standRecord(p.rec, p.world);
  }

  /** How many of the world's own spawns are waiting for the catalogue to land. */
  get waitingForCatalogue(): number {
    return this.pending.size;
  }

  /** The one the world calls `id`, or null. */
  mobileById(id: string): Mobile | null {
    const m = this.byWorldId.get(id);
    return m && !m.removed ? m : null;
  }

  /** What the world calls a mobile, or '' for one this browser stood for itself. */
  worldIdOf(m: Mobile): string {
    return this.worldIds.get(m) ?? '';
  }

  /** Whether a mobile was stood from one of the world's list's own records, which is what that list may take down. */
  fromList(m: Mobile): boolean {
    return this.listed.has(m);
  }

  /**
   * Take down the one the world calls `id`; false when there is no such one here. A record still
   * waiting for the catalogue is forgotten rather than stood a moment later, so a creature that died
   * before this browser had a catalogue never appears.
   */
  removeById(id: string): boolean {
    const waiting = this.pending.drop(id);
    const m = this.byWorldId.get(id);
    if (!m) return waiting;
    this.byWorldId.delete(id);
    if (!m.removed) this.remove(m);
    return true;
  }

  /** How many of the world's own spawns are standing here. */
  get worldSpawnCount(): number {
    let n = 0;
    for (const m of this.byWorldId.values()) if (!m.removed) n++;
    return n;
  }

  /** The model and the pack for a mobile, then the model hung on the body, unless it has gone meanwhile. */
  private async load(m: Mobile, held: Held, entry: MobileEntry, cat: MobileCatalogue, opts: SpawnOpts = {}): Promise<void> {
    const assets = this.deps.assets;
    // A plain model's file, or a person's look (a parts body dressed from the entry), built once per entry.
    const look = isLook(entry, cat);
    const file = look ? lookKey(entry) : cat.modelFile(entry)!;
    const bounds = lookBounds(entry, cat.file.appearances);
    const packInfo = cat.packOf(entry);
    const hologram = (entry.flags ?? []).includes('hologram');
    const before = assets.stats().models.length + assets.stats().packs.length;
    // Taken before the first await: a load in flight counts against the budget at its estimate from
    // this moment, so the next spawn in the same tick sees it (`referencedBytes`).
    const guess = assets.estimate(entry, cat);
    // The console's choice is laid on this browser's own spawn, and on a body stood from a record that
    // carries it (every browser stands that record alike); never on a seeded body, which every browser
    // arms from its own seed, nor on a record's body that carries none.
    const forced = opts.weaponTemplate && (!opts.worldId || opts.listed) ? opts.weaponTemplate : undefined;
    const own: OwnArms = { weapons: opts.weapons, groups: opts.weaponGroups, aggression: opts.overrides?.aggression, ranged: opts.overrides?.ranged, forcedTemplate: forced };
    const [model, pack, arms] = await Promise.allSettled([
      assets.acquireModel(file, { hologram, bounds, estimate: guess.model, look: look ? { entry, cat } : undefined }),
      packInfo ? assets.acquirePack(packInfo.id, packInfo.file, packInfo.json, guess.pack) : Promise.resolve(null),
      this.armsFor(entry, packInfo, held.seed, own),
    ]);
    held.loading = false;
    const gotModel = model.status === 'fulfilled' ? model.value : null;
    const gotPack = pack.status === 'fulfilled' ? pack.value : null;
    const plan = this.withEvade(entry, packInfo, arms.status === 'fulfilled' ? arms.value : null, hologram || !!opts.essential);
    if (arms.status === 'rejected') console.warn(`mobiles: ${entry.id} goes unarmed:`, arms.reason);
    const failure = model.status === 'rejected' ? model.reason : pack.status === 'rejected' ? pack.reason : null;
    if (failure || !gotModel) {
      if (gotModel) assets.release(gotModel);
      if (gotPack) assets.release(gotPack);
      held.error = String((failure as Error)?.message ?? failure);
      this.lastNote = `${entry.name}: ${held.error}`;
      console.warn(`mobiles: ${entry.id} could not be stood: ${held.error}`);
      if (!m.removed) this.remove(m);
      return;
    }
    if (m.removed || m.dead) {
      // Gone while it loaded (killed, cleared, the world unloaded): nothing is hung, everything goes back.
      assets.release(gotModel);
      if (gotPack) assets.release(gotPack);
      return;
    }
    const r = m.attach(gotModel, gotPack, withMood(plan?.extras ?? undefined, this.moodIdle(entry, packInfo, opts.mood, hologram)));
    if (!r.ok) {
      assets.release(gotModel);
      if (gotPack) assets.release(gotPack);
      return;
    }
    if (plan?.equipment && !m.equip(plan.equipment)) console.warn(`mobiles: ${entry.id} has no hand to hold ${plan.equipment.id}`);
    // Its tier, now that what is in its hand is known (a lightsaber jumps higher): its own level's, or
    // the one the console has put every person on.
    m.applyFightTier(this.fightTier);
    held.model = gotModel;
    held.pack = gotPack;
    // It is ready now: it joins the list of the living (a mobile still loading is left out of it).
    this.version++;
    if (r.warning && !this.warned.has(r.warning)) {
      this.warned.add(r.warning);
      console.warn(`mobiles: ${r.warning}; it plays what it can`);
    }
    // Something new came in: the cache may be over its budget with things nobody holds.
    const after = assets.stats().models.length + assets.stats().packs.length;
    if (after > before) assets.trim();
  }

  /**
   * A person's plan with Jedi Academy's rolls and jumps laid over it (`evadeClips`), which is what lets it
   * throw itself aside and jump as a fighter does: lent from a species rig already parsed, costing no
   * bytes, on the humanoid skeleton every person from the catalogue shares. Nothing for a creature, a
   * droid, a hologram or a body that is part of the furniture (`none`), which never fights at all, and
   * nothing before any rig is in, which leaves it a body that neither rolls nor jumps.
   */
  private withEvade(entry: MobileEntry, packInfo: PackSummary | null, plan: ArmsPlan | null, none: boolean): ArmsPlan | null {
    if (none || packInfo?.hierarchy !== 'all_b' || (entry.kind !== 'npc' && entry.kind !== 'dressed')) return plan;
    const lent = this.evadeClips(entry);
    if (!lent) return plan;
    const extras = plan?.extras ?? null;
    const clips = extras?.clips?.size ? new Map([...extras.clips, ...lent]) : lent;
    return { equipment: plan?.equipment ?? null, extras: { ...(extras ?? {}), clips } };
  }

  /**
   * Put a weapon off the rack in the hand of a body already standing, by the rack's template: the console's
   * `arm`, and the server's word that the admin did so on another browser. It is `armsFor` again with the
   * choice made (`OwnArms.forcedTemplate`), from the body's own seed where it has one so a lightsaber's
   * colour and style come out alike on every browser, the weapon prepared before it is handed over, and the
   * rolls and jumps a person fights with laid beside it as at its stand (`withEvade`). Answers null, or why
   * not in words: no such weapon on this browser's rack, a body with no hand, one still loading or gone.
   *
   * **The last word asked wins, and a word for what it already holds does nothing.** The server says the
   * weapon again to every browser that says `seen` for a body it has armed, which a driven body's browser
   * does every few seconds while its keeper is quiet, and re-arming the same weapon would put the blade out,
   * drop the aim and the burst and build it all again each time. And two arms asked close together finish
   * in whichever order their weapons were made ready in (one on the rack already, the other fetched and
   * prepared), so each is numbered as it is asked (`arming`) and one overtaken while it waited is dropped:
   * the body ends holding what was asked last, which is what the server's record says too.
   */
  async rearm(m: Mobile, template: string): Promise<string | null> {
    const turn = (this.arming.get(m) ?? 0) + 1;
    this.arming.set(m, turn);
    const overtaken = () => this.arming.get(m) !== turn;
    const cat = this.deps.catalogue();
    const held = this.held.get(m);
    if (!cat || !held || m.removed) return 'that body is not standing here';
    if (m.dead) return `${m.label} is dead`;
    await held.loaded;
    if (overtaken()) return `${m.label} was asked to hold something else meanwhile`;
    if (!m.ready || m.removed || m.dead) return `${m.label} has no body to arm`;
    const packInfo = cat.packOf(m.entry);
    const def = this.deps.weapons?.()?.weapons.find((w) => w.template === template) ?? null;
    if (!def) return `nothing on this browser's weapons rack is ${template}`;
    if (m.weapon === def.id) return null;
    const why = forcedArmsRefusal(m.entry.name, packInfo?.hierarchy, def);
    if (why) return why;
    const arms = await this.armsFor(m.entry, packInfo, held.seed, { forcedTemplate: template, ranged: m.ownRanged });
    const plan = this.withEvade(m.entry, packInfo, arms, m.hologram || m.essential);
    if (overtaken()) return `${m.label} was asked to hold something else meanwhile`;
    if (m.removed || m.dead) return `${m.label} went while the weapon was made ready`;
    if (!plan?.equipment) return `${def.id} could not be put in ${m.label}'s hand`;
    if (!m.rearm(plan.equipment, plan.extras)) return `${m.label} has no hand to hold ${def.id}`;
    // Its tier again, now that what is in its hand is known (a lightsaber jumps higher).
    m.applyFightTier(this.fightTier);
    return null;
  }

  /** How many times each body has been asked to re-arm, so an arm overtaken while it waited is dropped (`rearm`). */
  private readonly arming = new WeakMap<Mobile, number>();

  /** Weapon models already prepared (or being), by file: the rack's copies share their materials, so one preparation serves them all. */
  private readonly preparedWeapons = new Map<string, Promise<void>>();

  /**
   * What a person holds and plays with (arms.ts): a gun off the rack with its weapon's own carry
   * row out of the pack -- its ready stance, its aimed loop, the gaits that hold it and its
   * whole-body shots -- a blade, club or staff with its own row's stance and swings, or a lightsaber
   * with the blade's row under Jedi Academy's swings, which are lent from a species rig that has
   * already been parsed (the player's own always has; one is never fetched for this). Which weapon is
   * its own creature's first (`own`, the emulator's weapon groups) and the guess from its name only
   * where that names nothing on the rack. The weapon is prepared before it is handed over, so holding
   * it compiles nothing in play. Nothing for a creature, a droid or a hologram.
   *
   * A pack with no rows -- every pack converted before they existed -- falls back on the clip-name
   * matching `armedRoles` has always done, which is a rifle's port-arms carry and nothing else.
   *
   * `seed` is the one number a spawn the world holds rolls everything from: with one, the weapon off
   * the rack and the colour of a blade come out of it rather than out of the dice, so the same record
   * is armed the same way in every browser. Without one (everything stood before this, and everything
   * stood with no server) it rolls exactly as it did.
   */
  private async armsFor(entry: MobileEntry, packInfo: PackSummary | null, seed?: number, own?: OwnArms): Promise<ArmsPlan | null> {
    if (!packInfo || packInfo.hierarchy !== 'all_b') return null;
    const rand = seed !== undefined ? armsRng(seed) : Math.random;
    const json = await this.deps.assets.packJson(packInfo.id, packInfo.json);
    const roles = rolesFor(json, entry.gender);
    const rack = this.deps.weapons?.() ?? null;
    // Its own creature's weapons first: what the server armed that creature with, drawn from its group
    // as the server drew one for each body it stood. Empty hands when its list says so, or when it is
    // one that never fights; the guess from its name, judged on its own temper and gun, only where its
    // list names nothing on this rack. The whole decision is `decideArms`, which node tests.
    const decided = decideArms(entry, packInfo.hierarchy, roles, json.roleSources, own, rack?.weapons ?? null, rand);
    if (!decided) return null;
    const choice = decided.choice;
    const carry = carryWeaponFor(choice);
    // Whether the pack really carries a row for that weapon, as against the clip-name matching the
    // fallback does: it is what lets the body's stance choose the clip it stands in at all, so a
    // pack nobody has reconverted works its stance out and stands exactly where it always did.
    const carried = !!json.carries?.[carry];
    const over = armedRoles(json.clips ?? [], carry, json.carries);
    let extras: MobileExtras | null = Object.keys(over).length ? { roles: over, carry, carried } : { carry, carried };
    if (choice.kind === 'gun') {
      if (!Object.keys(over).length && choice.carry === 'rifle' && !this.warned.has(`rifle:${packInfo.id}`)) {
        // Said once a pack: the rifle is held in the pack's own (pistol) stance, which is the best it has.
        this.warned.add(`rifle:${packInfo.id}`);
        console.info(`mobiles: pack ${packInfo.id} has no rifle clips; ${entry.id} and the rest on it hold a rifle in its own stance`);
      }
    } else if (choice.kind === 'saber') {
      // A knife, a sword, an axe or a staff swings its own carry row's clips (`over`), which is the
      // game's own table; only a lightsaber is lent anything.
      // The blade's own ready stance and gaits come from the row where the pack has one; the swings
      // stay Jedi Academy's, lent from a rig that is already parsed, because they are the ones this
      // game's blade combat was built around and they cost no bytes. The ten one-hand swings are its
      // attacks below the second tier; from there up it swings the player's own move machine
      // (`npcSaber.ts`), whose every clip in every style it may swing is lent beside them.
      const lent = this.saberClips(entry);
      if (lent) {
        const attacks = SABER_SWINGS.filter((name) => lent.has(name));
        extras = { clips: lent, roles: { ...over, attacks }, carry, carried };
      }
    }
    // A gun its own list drew fires, whatever its numbers said of its group's name (`ArmsDecision.ranged`).
    if (decided.ranged) extras = { ...extras, ranged: decided.ranged };
    const def = decided.weapon ?? (rack ? chooseWeapon(choice, rack.weapons, rand) : null);
    // Nothing on the rack of the kind (or no rack yet): it holds nothing, so it carries nothing.
    // Kept apart from the empty overlay above because the overlay is the *weapon's* roles -- a ready
    // stance, a carry gait, a whole-body shot -- and a body with empty hands standing in a weapon's
    // carry is the same wrong pose from the other end. It falls back on the pack's own roles, which
    // is the unarmed guard, and `stepStance` leaves it relaxed.
    if (!rack || !def) return { equipment: null, extras: null };
    const model = await rack.model(def);
    // A thing with no model of its own (a dancer's prop that is a particle effect) has nothing to
    // prepare: the group is empty, and preparing an empty group would key the cache on null.
    if (def.file) {
      let ready = this.preparedWeapons.get(def.file);
      if (!ready) {
        ready = this.deps.assets.prepareRoot(model);
        this.preparedWeapons.set(def.file, ready);
      }
      await ready;
    }
    const b = def.bounds;
    const saber = decided.hold === 'saber';
    const color = saber ? (/sith|dark|inquisitor/.test(entry.id) ? DARK_BLADE : LIGHT_BLADES[Math.floor(rand() * LIGHT_BLADES.length)]) : 0xffffff;
    return {
      extras,
      equipment: {
        id: def.id,
        model,
        kind: decided.hold,
        gun: decided.hold === 'gun' ? (GUNS[gunTypeFor(def, def.class)] ?? null) : null,
        length: def.length || 0.6,
        hiltTop: b ? Math.abs(b.max[1] - b.min[1]) / 2 : 0.13,
        blade: saber && def.blade ? { length: def.blade.length, width: def.blade.width, open: def.blade.open, close: def.blade.close } : null,
        color,
        // The style it swings, drawn from the same seed after the colour (so a seed's colour is what it
        // always was), among those its hilt can swing: the style by seed every browser draws alike.
        saberStyle: saber ? styleOf(rand(), def.class) : undefined,
        weaponClass: def.class,
      },
    };
  }

  /**
   * The idle a mood lends a body (`moodIdle.ts`): a species rig's branch for it, for a person on the
   * humanoid skeleton, taken from a rig that is already parsed and never fetched. Null for a creature,
   * a hologram, a mood the rig has no branch for, or before any rig is in, which leaves the body in
   * its own pack's idle.
   */
  private moodIdle(entry: MobileEntry, packInfo: PackSummary | null, mood: string | undefined, hologram: boolean): THREE.AnimationClip | null {
    if (!mood || hologram || packInfo?.hierarchy !== 'all_b') return null;
    return Character.parsedRigMood(mood, entry.species ?? undefined);
  }

  /**
   * Stand `n` of an entry `distance` ahead of a point, on a ring when several, each facing back
   * at the point. Awaiting `loaded` on each says when they are up. `extra` is what else each is stood
   * with (the console's own level for them, `SpawnOpts.overrides`); where they stand is this call's.
   */
  spawnAhead(entry: MobileEntry, from: THREE.Vector3, forward: THREE.Vector3, n = 1, distance = 10, inside = false, extra: SpawnOpts = {}): SpawnResult {
    const mobiles: Mobile[] = [];
    let note = '';
    const spots = this.spotsAhead(entry, from, forward, n, distance, inside);
    if (spots.length < n) note = inside ? 'there is no floor under that spot' : 'no ground there';
    for (const spot of spots) {
      const heading = Math.atan2(from.x - spot.x, from.z - spot.z);
      const got = this.spawn(entry, { x: spot.x, y: spot.y, z: spot.z, heading }, { ...extra, inside });
      if (typeof got === 'string') {
        note = got;
        break;
      }
      mobiles.push(got);
    }
    if (!note) note = mobiles.length ? `${mobiles.length} ${entry.name} stood` : 'nothing stood';
    else if (mobiles.length) note = `${mobiles.length} stood; ${note}`;
    return { spawned: mobiles.length, note, mobiles };
  }

  /**
   * Where `n` of an entry would stand `distance` ahead of a point: the same ring `spawnAhead` puts
   * them on, and nothing stood. It is a method of its own so that a spawn asked for over the wire
   * picks its places exactly as one stood here would -- one call answering the same spot `n` times
   * would stack a whole group inside itself, since the world's own spot finder is one ray straight
   * down and gives the same answer to the same question. Spots that have no floor are left out, so
   * a caller wanting all of them compares the length with what it asked for.
   */
  spotsAhead(entry: MobileEntry, from: THREE.Vector3, forward: THREE.Vector3, n = 1, distance = 10, inside = false): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    const fwd = tmp.set(forward.x, 0, forward.z);
    if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, 1);
    fwd.normalize();
    const cx = from.x + fwd.x * distance;
    const cz = from.z + fwd.z * distance;
    const cat = this.deps.catalogue();
    const box = cat ? lookBounds(entry, cat.file.appearances) : null;
    const size = box ? Math.max(Math.abs(box.max[0] - box.min[0]), Math.abs(box.max[2] - box.min[2])) : 1;
    const ring = n > 1 ? Math.max(1.5, (size * n) / (2 * Math.PI) + size * 0.3) : 0;
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      const p = new THREE.Vector3(cx + Math.sin(a) * ring, from.y, cz + Math.cos(a) * ring);
      const spot = this.deps.spawnSpot(p, ZERO, 0, inside);
      if (spot) out.push(spot);
    }
    return out;
  }

  /** Take one away now: its colliders' handles go at the moment the body does, and its assets are released. */
  remove(m: Mobile): void {
    const i = this.live.indexOf(m);
    if (i >= 0) this.live.splice(i, 1);
    // A world spawn's name goes with the body, or the name would answer with a mobile that is gone
    // and nothing could ever stand that record again.
    const worldId = this.worldIds.get(m);
    if (worldId !== undefined) {
      if (this.byWorldId.get(worldId) === m) this.byWorldId.delete(worldId);
      this.worldIds.delete(m);
    }
    for (const c of m.colliders) if (this.byCollider.get(c.handle) === m) this.byCollider.delete(c.handle);
    // What it did in its fights goes into the planet's tally before it goes (`fightReport`).
    const tac = m.tactics;
    if (tac) {
      let spent = this.spentFights.get(tac.tier);
      if (!spent) {
        spent = { bodies: 0, low: 0, covered: 0, shots: 0, hits: 0, kneels: 0, prones: 0, crouches: 0, covers: 0, slides: 0, rolls: 0, hops: 0, jumps: 0 };
        this.spentFights.set(tac.tier, spent);
      }
      addFight(spent, tac);
    }
    this.group.remove(m.group);
    const q = this.ragdollQueue.indexOf(m);
    if (q >= 0) this.ragdollQueue.splice(q, 1);
    m.dispose();
    const held = this.held.get(m);
    if (held) {
      if (held.model) this.deps.assets.release(held.model);
      if (held.pack) this.deps.assets.release(held.pack);
      held.model = null;
      held.pack = null;
      this.held.delete(m);
    }
    this.version++;
  }

  /**
   * Take away every spawned mobile the filter picks (all spawned ones without one); everything the
   * world holds stays, the lairs' creatures among it. A body with a world name is never this call's:
   * the NPC tab's clear took the town's people and a lair's creatures down with the ones stood by
   * hand, and they came straight back on the world's next pass. Returns how many.
   */
  clear(filter?: (m: Mobile) => boolean): number {
    let n = 0;
    for (const m of [...this.live]) {
      if (m.origin !== 'spawned' || this.worldIds.has(m)) continue;
      if (filter && !filter(m)) continue;
      this.remove(m);
      n++;
    }
    return n;
  }

  /** Out and loading, by entry id. */
  counts(): Map<string, { out: number; loading: number }> {
    const out = new Map<string, { out: number; loading: number }>();
    for (const m of this.live) {
      const c = out.get(m.entry.id) ?? out.set(m.entry.id, { out: 0, loading: 0 }).get(m.entry.id)!;
      c.out++;
      if (!m.ready) c.loading++;
    }
    return out;
  }

  /** How many are out, of one entry or of all. */
  count(entryId?: string): number {
    if (!entryId) return this.live.length;
    let n = 0;
    for (const m of this.live) if (m.entry.id === entryId) n++;
    return n;
  }

  /** When a mobile's model is up (or failed). */
  loaded(m: Mobile): Promise<void> {
    return this.held.get(m)?.loaded ?? Promise.resolve();
  }

  /** Why a mobile's load failed, if it did. */
  loadError(m: Mobile): string | null {
    return this.held.get(m)?.error ?? null;
  }

  /** The pack turns together: everything of the same catalogue group within `assist` and not passive remembers the attacker too. */
  assist(self: Mobile, attacker: Living): void {
    for (const m of this.live) {
      if (m === self || m.dead || m.aggression === 'passive' || m.entry.group !== self.entry.group) continue;
      if (m.pos.distanceTo(self.pos) > BRAIN_TUNE.assist) continue;
      m.provoke(attacker);
    }
  }

  private queueRagdoll(m: Mobile): void {
    if (m.queued || m.ragdoll || m.removed) return;
    m.queued = true;
    this.ragdollQueue.push(m);
  }

  /** Step every mobile with the detail its distance and the screen allow; start a couple of queued ragdolls, nearest first. */
  update(dt: number, ctx: MobileContext): void {
    if (this.disposed) return;
    // The world's creatures that arrived before the catalogue did, stood now it is here. One map's
    // size read a frame while the queue is empty, which it is for the whole of an ordinary session.
    if (this.pending.size > 0 && this.deps.catalogue()) this.drainPending();
    // The world's creatures: what this browser keeps is said four times a second, and who keeps what
    // is asked of the server's last grant. It is here rather than on a timer so `__debug.advance`
    // drives it; with no server it returns on its first line.
    npcNow()?.step(dt);
    this.frame++;
    const camera = ctx.camera;
    if (camera) {
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      camera.getWorldPosition(this.camPos);
    } else this.camPos.copy(ctx.playerPos);
    const shadows = this.deps.shadows();
    this.shadowBoxes = shadows && this.deps.shadowBoxes ? this.deps.shadowBoxes() : null;
    const tune = LOD_TUNE;
    this.walled = 0;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const m = this.live[i];
      const held = this.held.get(m);
      if (!held) continue;
      // Spent: taken away. Whatever stood it -- a lair, a row, the console, the server's list -- stands
      // it again on its own clock if it comes back at all; nothing here recycles a body by distance.
      // The fallen-out-of-the-world floor never applies inside a building: dungeon rooms go far below it.
      if ((m.dead && m.deadTimer <= 0) || (!m.inside && m.pos.y < this.deps.terrain.floor - 20)) {
        this.remove(m);
        continue;
      }
      // Its room, followed through the portals four times a second (staggered), and sooner when it has gone a couple of metres.
      if (!m.dead && (ctx.now - held.lastInside >= INSIDE_EVERY || held.cellFrom.distanceToSquared(m.pos) > FOLLOW_STEP * FOLLOW_STEP)) {
        held.lastInside = ctx.now + ((m.key % 7) / 7) * INSIDE_EVERY * 0.5;
        held.cell = this.deps.followCell(held.cell, held.cellFrom, m.pos);
        held.cellFrom.copy(m.pos);
        m.room = held.cell?.cell ?? 0;
        // The same room the path is keyed on: the body throws its corners away when this changes.
        m.navCell = held.cell;
        m.setInside(held.cell !== null);
        // Under the ground outside (the planet's heights came in after it was stood): back on top.
        if (m.liftToGround()) held.cellFrom.copy(m.pos);
      }
      // Whether that room has collision under it this instant, asked every frame and not on the
      // follow's quarter-second, as the fighters ask it: it is two lookups, and a quarter of a second
      // of falling through a floor that has gone is half a metre nobody asked for.
      m.setAirless(held.cell !== null && !(this.deps.cellSolid?.(held.cell) ?? true));
      const tier = this.tierOf(m, camera, ctx.playerPos, shadows, tune, held.tier);
      // The whole cull: a group that is not visible is in no pass at all.
      const visible = tier.visible || !!m.ragdoll;
      if (held.visible !== visible) {
        m.group.visible = visible;
        held.visible = visible;
      }
      // A shadow is put on the step it is wanted and taken off on the half-second: a body the frustum or its
      // room has just brought into view throws its shadow on the frame it is first drawn, never half a second late.
      const cast = tier.castShadow && !m.hologram;
      if (ctx.now - held.lastShadow >= SHADOW_EVERY || held.cast === null || (cast && held.cast === false)) {
        held.lastShadow = ctx.now;
        const meshes = m.meshes;
        let differs = held.cast !== cast;
        for (let k = 0; !differs && k < meshes.length; k++) if (meshes[k].castShadow !== cast) differs = true;
        if (differs) {
          for (let k = 0; k < meshes.length; k++) meshes[k].castShadow = cast;
          held.cast = cast;
        }
      }
      m.update(dt, ctx, tier);
    }
    // The queue: a couple of ragdolls a frame, nearest the camera first; the rest hold their death pose.
    if (this.ragdollQueue.length) {
      this.ragdollQueue.sort((a, b) => a.pos.distanceToSquared(this.camPos) - b.pos.distanceToSquared(this.camPos));
      const n = Math.min(this.ragdollQueue.length, Math.max(1, tune.ragdollsPerFrame));
      for (const m of this.ragdollQueue.splice(0, n)) m.startRagdoll();
    }
  }

  /**
   * The tier for one mobile: its world sphere against the frustum as it is and grown by the shadow slack,
   * and its rooms as the portal renderer's last frame saw them (commit 2c).
   */
  private tierOf(m: Mobile, camera: THREE.Camera | null, playerPos: THREE.Vector3, shadows: boolean, tune: LodTune, out: LodTier): LodTier {
    const cull = m.plan.cull;
    const radius = (m.ragdoll ? 2 : 1) * cull.radius;
    sphere.center.set(m.pos.x, m.pos.y + cull.y, m.pos.z);
    sphere.radius = radius;
    const dist = sphere.center.distanceTo(this.camPos);
    let onScreen = true;
    let nearScreen = true;
    if (camera) {
      onScreen = frustum.intersectsSphere(sphere);
      if (!onScreen) {
        sphere.radius = radius + tune.shadowSlack;
        nearScreen = frustum.intersectsSphere(sphere);
      }
    }
    // Whether it reaches a cascade's light box at all, with the same slack the screen test gives a shadow:
    // the boxes are the ones the cascades last stood in, a frame behind (commit 3c).
    let inCascades: boolean | undefined;
    const boxes = this.shadowBoxes;
    if (boxes !== null && boxes.length > 0 && nearScreen) {
      sphere.radius = radius + tune.shadowSlack;
      inCascades = reachesCascades(boxes, sphere);
    }
    const i = lodInput;
    i.dist = dist;
    i.onScreen = onScreen;
    i.nearScreen = nearScreen;
    i.busy = m.busy;
    i.sizeClass = m.entry.stats?.sizeClass ?? 'small';
    i.shadows = shadows;
    i.playerDist = m.pos.distanceTo(playerPos);
    i.animRange = this.animRange;
    i.inCascades = inCascades;
    // A ragdoll is left to the frustum: its pieces leave the room it fell in.
    const room = this.deps.roomSeen && !m.ragdoll ? this.deps.roomSeen(m.group) : -1;
    i.room = room;
    if (room === 0 || room === 2) this.walled++;
    return lodTier(i, tune, out);
  }

  /** The shadow cascades' light boxes, read once at the top of `update` for every body's tier; null with shadows off or none wired. */
  private shadowBoxes: readonly THREE.Frustum[] | null = null;

  /**
   * How a body's own blade renderer lets its materials go before it is disposed, through the asset cache's
   * own hook (`MobileAssets.forget`, which the world sets to `World.forgetMaterials`): one closure for every body.
   */
  private readonly forgetBlade = (materials: readonly THREE.Material[]): void => {
    this.deps.assets.forget?.(materials);
  };

  /** The world's far ground readers, handed to every body as the same two closures (commit 4b). */
  private readonly groundCached =(x: number, z: number): number | null => this.deps.groundIfCached?.(x, z) ?? null;
  private readonly groundSolid = (x: number, z: number): boolean => this.deps.groundSolid?.(x, z) ?? true;

  /**
   * The physics a person's cover search casts through, made once and handed to every body, as the
   * fighters' manager hands its one to every fighter: the streamer's blockers, the first thing in the way
   * that stands still, the floor under a spot among what stands still, and the baked grid's regions.
   * Every answer is a primitive, so a search allocates nothing.
   */
  private readonly coverDeps: CoverDeps = {
    blockers: (x, z, reach, out, cap) => this.deps.blockers?.(x, z, reach, out as NearBlocker[], cap) ?? 0,
    hit: (ax, ay, az, bx, by, bz) => this.deps.physics.blockDistance(ax, ay, az, bx, by, bz),
    floor: (x, z, fromY, maxDrop) => this.deps.physics.topSurface(x, z, fromY, maxDrop, OUTSIDE_FILTER, staticOnly) ?? Number.NaN,
    sameGround: (ax, az, bx, bz) => outdoorNav.reachable(ax, az, bx, bz),
  };

  /**
   * The tier the console puts every person on (`__debug.mobileTune({ tier })`), or null for each one's
   * own level's. 0 is none of the fighting a fighter does, which is the mobile the game had before.
   */
  fightTier: number | null = null;

  /**
   * Jedi Academy's rolls and jumps out of a species rig that is already parsed, by the rig's own clip
   * list: made once per rig and shared by every person lent them, as the saber swings are lent.
   */
  private readonly evadeLent = new WeakMap<readonly THREE.AnimationClip[], ReadonlyMap<string, THREE.AnimationClip>>();

  /**
   * The lightsaber clips a person holding one is lent, out of a species rig already parsed: the ten
   * one-hand swings it has always swung, and every clip the move machine can ask for in every style a
   * body may swing (`NPC_SABER_CLIPS`), so a style put on from the console has its clips too. Made once
   * per rig and shared, as the rolls are; null before any rig is in, which leaves it holding the blade
   * unarmed of moves exactly as before.
   */
  private readonly saberLent = new WeakMap<readonly THREE.AnimationClip[], ReadonlyMap<string, THREE.AnimationClip>>();

  private saberClips(entry: MobileEntry): ReadonlyMap<string, THREE.AnimationClip> | null {
    const rig = Character.parsedRigClips(entry.species ?? undefined);
    if (!rig) return null;
    let lent = this.saberLent.get(rig);
    if (!lent) {
      const wanted = new Set([...SABER_SWINGS, ...NPC_SABER_CLIPS]);
      const m = new Map<string, THREE.AnimationClip>();
      for (const c of rig) if (wanted.has(c.name)) m.set(c.name, c);
      lent = m;
      this.saberLent.set(rig, lent);
    }
    return lent.size ? lent : null;
  }

  /**
   * A person who may have to fight from now on is handed the rolls and jumps it was never lent (one
   * stood as part of the furniture, asked to follow the player: `withEvade` leaves them off such a body)
   * and put on its tier again. Answers whether anything was lent: nothing for a creature, a droid, a
   * hologram, a body whose pack is not the humanoid one, or before any species rig is in.
   */
  lendFightClips(m: Mobile): boolean {
    const cat = this.deps.catalogue();
    const info = cat ? cat.packOf(m.entry) : null;
    const lent = m.humanoid && info?.hierarchy === 'all_b' ? this.evadeClips(m.entry) : null;
    if (lent) m.lendClips(lent);
    m.applyFightTier(this.fightTier);
    return !!lent;
  }

  /** The rolls and jumps a person is lent, or null before any species rig has been parsed. */
  private evadeClips(entry: MobileEntry): ReadonlyMap<string, THREE.AnimationClip> | null {
    const rig = Character.parsedRigClips(entry.species ?? undefined);
    if (!rig) return null;
    let lent = this.evadeLent.get(rig);
    if (!lent) {
      const wanted = new Set(EVADE_CLIPS);
      const m = new Map<string, THREE.AnimationClip>();
      for (const c of rig) if (wanted.has(c.name)) m.set(c.name, c);
      lent = m;
      this.evadeLent.set(rig, lent);
    }
    return lent.size ? lent : null;
  }

  /**
   * The per-mesh cull switched (`SKELETON_TUNE.cullSphere`, commit 3c): every body out takes it at once,
   * each but one lying off its feet (`cullsOneByOne`), which reaches past its sphere.
   */
  applyCullSphere(): void {
    for (const m of this.live) m.applyCull();
  }

  /** The spheres set again on every body hung (the console moved `SKELETON_TUNE.sphereScale`). */
  refitCull(): void {
    for (const m of this.live) m.refitCull();
  }

  /**
   * For `__debug.skeletons()`: the bodies hung, their skinned meshes and the skeletons those stand on, and
   * how many meshes the per-mesh cull takes now.
   */
  skeletonReport(): { bodies: number; skinned: number; skeletons: number; culled: number } {
    const skeletons = new Set<THREE.Skeleton>();
    let bodies = 0;
    let skinned = 0;
    let culled = 0;
    for (const m of this.live) {
      if (!m.model) continue;
      bodies++;
      for (const mesh of m.meshes) {
        if (mesh.frustumCulled) culled++;
        const s = mesh as THREE.SkinnedMesh;
        if (!s.isSkinnedMesh) continue;
        skinned++;
        if (s.skeleton) skeletons.add(s.skeleton);
      }
    }
    return { bodies, skinned, skeletons: skeletons.size, culled };
  }

  /** The skeleton share switched (`SKELETON_TUNE.share`, commit 3a): every body hung takes it now; answers the skeletons out. */
  reshare(share: boolean): number {
    let n = 0;
    for (const m of this.live) n += m.reshare(share);
    return n;
  }

  /** The building room a mobile is followed in (null out in the open), for the portal renderer's routing. */
  cellOf(m: Mobile): CellState | null {
    return this.held.get(m)?.cell ?? null;
  }

  /**
   * Where a mobile's feet were when its room was last followed, or null for one not held: how far it has
   * gone since is how far its room may be behind it (a quarter of a second or two metres while it lives,
   * everything since its death once it has fallen, since a dead body's room is no longer followed).
   */
  cellFromOf(m: Mobile): THREE.Vector3 | null {
    return this.held.get(m)?.cellFrom ?? null;
  }

  /**
   * A building put down in play is coming down: every body this browser keeps that is followed in one
   * of its rooms is stood on the ground round its doorstep (`doorstepSpot`, a step apart) and put
   * back outdoors before the rooms go, or it would be held in the air where a floor had been, walking
   * corners of a building that is not there. Answers how many were moved; `first` is the doorstep spot
   * the first of them takes, so the fighters stood out beside them can take the next ones.
   */
  standOutOf(building: object, door: { x: number; z: number }, first = 1): number {
    let n = 0;
    for (const m of this.live) {
      const held = this.held.get(m);
      if (!held || held.cell?.building !== building) continue;
      const spot = doorstepSpot(first + n, door);
      // A body another browser keeps is not moved (its keeper takes the same building down and stands
      // it out there), but its rooms here go all the same, or this browser would go on following it
      // through the portals of a building that is gone, held indoors and airless until something moved it.
      const moved = m.standOut(spot.x, this.deps.terrain.heightAt(spot.x, spot.z), spot.z);
      held.cell = null;
      held.cellFrom.copy(m.pos);
      m.room = 0;
      m.navCell = null;
      m.setInside(false);
      m.setAirless(false);
      if (moved) n++;
    }
    return n;
  }

  /** For `__debug.mobileCull`: every mobile's world sphere, whether it is on and near the screen, drawn, casting, and its tier. */
  cullReport(camera: THREE.Camera | null, playerPos: THREE.Vector3): Record<string, unknown>[] {
    if (camera) {
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      camera.getWorldPosition(this.camPos);
    }
    return this.live.map((m) => {
      const cull = m.plan.cull;
      const radius = (m.ragdoll ? 2 : 1) * cull.radius;
      sphere.center.set(m.pos.x, m.pos.y + cull.y, m.pos.z);
      sphere.radius = radius;
      const onScreen = camera ? frustum.intersectsSphere(sphere) : true;
      sphere.radius = radius + LOD_TUNE.shadowSlack;
      const nearScreen = camera ? frustum.intersectsSphere(sphere) : true;
      return {
        key: m.key,
        id: m.entry.id,
        centre: [m.pos.x, m.pos.y + cull.y, m.pos.z].map((n) => Number(n.toFixed(1))),
        radius: Number(radius.toFixed(2)),
        dist: Number(m.pos.distanceTo(this.camPos).toFixed(1)),
        playerDist: Number(m.pos.distanceTo(playerPos).toFixed(1)),
        onScreen,
        nearScreen,
        visible: m.group.visible,
        castShadow: m.meshes.some((x) => x.castShadow),
        tier: m.tier?.name ?? null,
        // Its rooms as the portal renderer last saw them: 0 unseen, 1 seen, 2 one room past a seen one, -1 left to the frustum.
        room: this.deps.roomSeen ? this.deps.roomSeen(m.group) : -1,
      };
    });
  }

  /** For `__debug.mobileRoles`: an entry's pack, its roles, the gait speeds, the template's, and what the game will move at. */
  async rolesReport(entry: MobileEntry): Promise<Record<string, unknown>> {
    const cat = this.deps.catalogue();
    if (!cat) return { error: `the catalogue has not loaded (or is not converted: ${CATALOGUE_COMMAND})` };
    const info = cat.packOf(entry);
    if (!info) return { entry: entry.id, error: 'no animation pack' };
    const json = await this.deps.assets.packJson(info.id, info.json);
    const roles = rolesFor(json, entry.gender);
    const app = cat.appearanceOf(entry);
    const [lo, hi] = entry.size?.scale ?? [1, 1];
    const scale = (lo + hi) / 2 || 1;
    const speeds = moveSpeeds(roles, scale, entry.move, GAIT_LIMITS);
    return {
      entry: entry.id,
      name: entry.name,
      pack: info.id,
      hierarchy: info.hierarchy,
      appearance: app?.id ?? null,
      joints: app?.joints ?? null,
      summary: describeRoles(roles),
      roles,
      gaits: roles.gaits,
      template: { walk: entry.move.walk, run: entry.move.run },
      scale,
      walk: Number(speeds.walk.toFixed(2)),
      run: Number(speeds.run.toFixed(2)),
      aggression: entry.stats?.aggression,
      ranged: roles.ranged && entry.stats?.ranged ? entry.stats.ranged.range : 0,
    };
  }

  /**
   * For `__debug.mobileTune`: read, or change live, the brain's, the tiers' and the gaits' numbers,
   * the step-up's (`step`, `stepUp.ts`) and the cache's budget; `cap` and `animRange` are this
   * planet's settings. Returns them all, with what the step-up's probes have found since the session
   * began and every walking body's stuck count summed.
   */
  tune(t?: { brain?: Partial<BrainTune>; lod?: Partial<Omit<LodTune, 'shadow'>> & { shadow?: Partial<LodTune['shadow']> }; gait?: Partial<GaitLimits>; step?: Partial<StepTune>; budget?: number; concurrency?: number; failFor?: number; cap?: number; animRange?: number } & FightKnob): Record<string, unknown> {
    if (t) {
      this.tuneFight(t);
      if (t.step) tuneStep(t.step);
      if (t.brain) Object.assign(BRAIN_TUNE, t.brain);
      if (t.lod) {
        const { shadow, ...rest } = t.lod;
        Object.assign(LOD_TUNE, rest);
        if (shadow) Object.assign(LOD_TUNE.shadow, shadow);
      }
      if (t.gait) Object.assign(GAIT_LIMITS, t.gait);
      if (t.budget !== undefined) MOBILE_CACHE.budget = t.budget;
      if (t.concurrency !== undefined) MOBILE_CACHE.concurrency = Math.max(1, Math.floor(t.concurrency));
      if (t.failFor !== undefined) MOBILE_CACHE.failFor = t.failFor;
      if (t.cap !== undefined) this.cap = t.cap;
      if (t.animRange !== undefined) this.animRange = t.animRange;
      if (t.budget !== undefined) this.deps.assets.trim();
    }
    let stuck = 0;
    for (const m of this.live) stuck += m.stuckEvents;
    return {
      brain: { ...BRAIN_TUNE },
      lod: { ...LOD_TUNE, shadow: { ...LOD_TUNE.shadow } },
      gait: { ...GAIT_LIMITS },
      step: { ...STEP_TUNE, found: { ...STEP_STATS }, stuck },
      cache: { ...MOBILE_CACHE },
      cap: this.cap,
      animRange: this.animRange,
      fight: this.fightReport(),
    };
  }

  /**
   * The console's knob on how a person fights: every person put on a tier, or handed back to its own
   * level's with `tier: null`; the levels the ladder is climbed at, written in place; the postures'
   * numbers (the fighters' own table, so it moves theirs too) and a posture put on by hand, `'auto'`
   * handing them back to the rule; and the roll's and the jump's tables, which the fighters share.
   */
  private tuneFight(t: FightKnob): void {
    if (t.postures) tunePosture(t.postures);
    if (t.roll) tuneEvade(t.roll);
    if (t.jump) tuneJump(t.jump);
    if (Array.isArray(t.levels)) for (let i = 0; i < TIER_LEVELS.length && i < t.levels.length; i++) if (Number.isFinite(t.levels[i])) TIER_LEVELS[i] = t.levels[i];
    let retier = Array.isArray(t.levels) || !!t.jump;
    if (t.tier !== undefined) {
      this.fightTier = t.tier === null || !Number.isFinite(t.tier) ? null : Math.max(0, Math.min(GROUND_TIERS, Math.round(t.tier)));
      retier = true;
    }
    for (const m of this.live) {
      if (retier) m.applyFightTier(this.fightTier);
      if (t.posture !== undefined) m.forcePosture(t.posture === 'auto' || t.posture === null ? null : t.posture);
    }
  }

  /**
   * How the people out are fighting, summed by tier: how many there are, and what they have done since
   * each was stood -- shots and hits, the times they went down on a knee, flat and into a crouch, the
   * spots they took, the slides, rolls, hops and ledge jumps -- with the tables in force. The measure
   * of a fight is the difference between two of these read either side of it.
   */
  fightReport(): Record<string, unknown> {
    const byTier: Record<number, Record<string, number>> = {};
    const rowOf = (tier: number): Record<string, number> => (byTier[tier] ??= { bodies: 0, low: 0, covered: 0, shots: 0, hits: 0, kneels: 0, prones: 0, crouches: 0, covers: 0, slides: 0, rolls: 0, hops: 0, jumps: 0 });
    let people = 0;
    for (const m of this.live) {
      const tac = m.tactics;
      if (!tac) continue;
      const row = rowOf(tac.tier);
      if (!m.dead) {
        people++;
        row.bodies++;
        if (m.posture !== 'stand') row.low++;
        if (tac.coverKind) row.covered++;
      }
      addFight(row, tac);
    }
    // And what the people already taken away did, so a fight's measure does not lose its dead.
    for (const [tier, spent] of this.spentFights) {
      const row = rowOf(tier);
      for (const k of Object.keys(spent)) row[k] += spent[k];
    }
    return { tier: this.fightTier, levels: [...TIER_LEVELS], people, byTier, postures: { ...POSTURE_TUNE }, roll: { ...EVADE_TUNE, share: [...EVADE_TUNE.share] }, jump: { ...JUMP_TUNE, heights: [...JUMP_TUNE.heights] } };
  }

  /** The fights of the people taken away, by tier, for `fightReport`: kept for the planet's life. */
  private readonly spentFights = new Map<number, Record<string, number>>();

  /** Every mobile and every queued load goes (the world is unloading). The assets are released, not disposed: the cache outlives the planet. */
  dispose(): void {
    this.disposed = true;
    for (const m of [...this.live]) this.remove(m);
    this.live.length = 0;
    this.byCollider.clear();
    this.ragdollQueue.length = 0;
    this.held.clear();
    this.pending.clear();
    this.version++;
  }
}
