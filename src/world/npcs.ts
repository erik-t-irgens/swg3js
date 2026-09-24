// Fighters: humanoid NPCs stood on demand to fight the player and each other. Each is a character
// rig of a random species with a random look, a weapon off the rack (a lightsaber, a sword or a
// gun) in its hand, and a body the blades and bolts can hurt. Its clothes come off its species'
// wardrobe (a Wookiee's from the Wookiee pieces alone).
//
// The mind is **the creatures' own** (`mobiles/brain.ts`), not a temper of this file's: a fighter
// fills a `BrainSelf` a few times a second, the same pure function the wildlife thinks with
// answers, and the body acts on that answer every frame between. What that brings that a fighter
// never had: giving up on a target it cannot reach in height, leashing home, remembering and
// forgetting who hurt it, wandering when there is nothing to do, and a nerve that breaks. What it
// does not bring is paths -- the answer is a goal and a pace, and a fighter still walks at it in a
// straight line, because navigation is a later pass.
//
// What it **does** have now is a body and a stance. The body is the player's own character
// controller and the player's own capsule (`src/world/fighterStance.ts`, whose numbers are lifted
// from `Player.makeBody` unchanged): a fighter is stopped by a wall, climbs a step of half a metre
// and a slope of 55 degrees, and takes its floor from the controller rather than from a ray cast
// half a metre over its feet -- so it no longer walks through the walls it has always walked
// through, and `checkStuck`, which is documented below as never firing, now fires. It is stopped
// by exactly what stops the player and no more: the collision capsule is the player's 1.6 m and
// not the 1.8 m the aim point implies, or a clearance you can walk under would be a wall to it.
// Two floors of last resort under all of that, and they are not the same one. Outdoors the
// planet's own ground, because the heightfield colliders only exist within a few chunks of the
// player and a fighter that has wandered off has nothing under it. Indoors the height it last
// really had, because a building's colliders are dropped when the player walks away while the room
// a body is in goes on answering -- so without it a fighter left behind falls through a floor that
// is no longer there and is finally teleported onto the terrain when it drops out of the
// building's box, which for a dungeon is hundreds of metres.
// The stance is the player's three-way carry -- relaxed, combat, aimed -- picked from what it has
// to fight instead of from a mouse button, with the barrel measured against where the next bolt is
// going and the difference folded into the spine exactly as `Player.correctAim` folds it. Both are
// only how a fighter stands, aims and is stopped: nothing here decides anything.
import * as THREE from 'three';
import { combatSounds } from '../audio/combatSounds';
import { Group, groups, RAPIER, type Physics } from '../core/physics';
import { CharacterRig, loadPlayerRig, type RigState } from '../player/rig';
import { applyLook } from '../player/look';
import { FIGHTS, gunKindOf, isSaber, type WeaponCatalogue, type WeaponDef } from '../player/weapons';
import { SaberBlade } from '../combat/saberBlade';
import { CLASH } from '../combat/clash.ts';
import { keepNearestGlow } from '../combat/bladeLights';
import { Ragdoll } from '../combat/ragdoll';
import { GUNS, gunTypeFor, type GunProfile } from '../combat/guns';
import { scarFamilyOf } from '../combat/scars.ts';
import type { Bolts } from '../combat/bolts';
import type { Effects } from '../combat/effects';
import { nextLivingKey, type Aggression, type Hittable, type Living, type Side } from '../combat/kit';
import { PLAYER_KEY, hostileSides } from '../combat/targets';
import type { Terrain } from './terrain';
import { markActor } from './portalRender';
import { slotOf } from '../ui/wardrobeUi';
import type { CellState } from './layoutStream';
import { NavAgent } from './nav/navAgent.ts';
import { worldNav } from './nav/nav.ts';
// A long walk's order and its account (`src/world/errand.ts`). The order is three writes -- the
// body's home moved onto the destination and the body held on the way home, which together are the
// two clauses of the creatures' brain's own first rule -- and everything else in that file is the
// evidence: a fighter is the body it is given to, and nothing here knows how the account is kept.
import { Errand, type ErrandBody, type ErrandProbe, type ErrandWorld } from './errand.ts';
import { BLADE_SWING, SABER_SWINGS, bladeSwingReport, borrowSwingFigures, noteBladeLookup, noteBladeSwing, noteTimerBlow, returnSwingFigures, weaponFarPoint, type BladeSwingTune } from './mobiles/arms';
// The creatures' mind, unchanged and shared: a pure function of plain numbers, so a fighter is one
// more body filling the same struct rather than a second set of rules that has to be kept in step.
import { BRAIN_TUNE, decide, type BrainSelf, type BrainTarget, type Decision } from './mobiles/brain.ts';
import type { MobileState } from './mobiles/types';
// How it stands, aims and is held up: the pure half, which a node test drives with a real physics
// world rather than a mirror. Every number of the controller's is the player's own.
import { FIGHTER_BODY, STANCE_TUNE, aimMode, applyBody, bodyShare, capsuleDrop, easeAngle, fallSpeed, fighterPush, settleFooting, spineShare, stanceFor, stepAimFix, tuneFighterBody, tuneStance, wrapAngle, type AimWhen, type FighterBody, type Footing, type Stance, type StanceInput, type StanceTune } from './fighterStance.ts';
// A fighter's blade hurts what it passed through since the last frame by exactly the machinery the
// player's does, never by a rule of its own: `BladePath` steps the same capsule along the ground the
// blade covered, and a `Striker` of this fighter's own is what puts it behind the blow.
import { BLADE_RADIUS, BladePath, type Striker } from '../combat/sweep';

/** What a fighter carries, and so how it fights. */
type Arm = 'saber' | 'melee' | 'gun';

/** Jedi Academy's one-hand swings (the same list a lightsaber-armed person from the catalogue swings). */
const SWINGS = SABER_SWINGS;

/**
 * Which style a swing is swung in, for its whoosh. Jedi Academy names its three styles' attacks
 * `BOTH_A1`, `BOTH_A2` and `BOTH_A3`, which is exactly the list above, so the clip says it.
 */
function swingStyle(clip: string): 'fast' | 'medium' | 'strong' {
  if (clip.startsWith('BOTH_A1')) return 'fast';
  if (clip.startsWith('BOTH_A3')) return 'strong';
  return 'medium';
}
const SPECIES_FALLBACK = ['human_male', 'human_female', 'twilek_male', 'twilek_female', 'zabrak_male', 'zabrak_female', 'rodian_male', 'bothan_male', 'trandoshan_male', 'moncal_female', 'sullustan_male', 'wookiee_male'];
const HP = 160;

/**
 * Everything a fighter's body does that is not the brain's to decide, and every number of it is
 * invented. How far it sees, how long it remembers, how far it chases before it goes home and
 * when it gives a target up are **not** here: those are the creatures' own (`BRAIN_TUNE` in
 * `mobiles/brain.ts`), because a fighter thinks with the same function the wildlife does.
 */
export interface FighterTune {
  /** How fast it runs and how fast it wanders, metres a second. */
  run: number;
  walk: number;
  /** Seconds between thoughts, and the share either way the next one is spread by. */
  think: number;
  thinkJitter: number;
  /**
   * A blade's or a club's reach past both bodies, in metres: with two people's own radii (0.35
   * each) this is the 2.6 m a fighter's swing has always opened at.
   */
  reach: number;
  /** How far a gun-armed one shoots from, and how wide of the nose it will shoot or swing (radians). */
  gunRange: number;
  aimCone: number;
  /** The scatter on its aim, and the least seconds between shots. */
  aimSpread: number;
  gunEvery: number;
  /** The spread on top of a shot's cooldown, so a line of them does not fire as one volley. */
  gunSpread: number;
  /** Seconds between swings, and the spread on top. */
  swingEvery: number;
  swingSpread: number;
  /**
   * Inside a building, the share of the indoor leash a wander may reach. The brain's own wander
   * (8 to 30 m from home) is drawn for the open ground and is farther than the leash it keeps
   * indoors (25 m), so a goal past that would trip the leash the moment the fighter crossed it:
   * it would turn round, run home and set off again, pacing instead of idling. The goal is pulled
   * back inside here rather than in `brain.ts`, whose wander numbers are the wildlife's too.
   */
  wanderInsideShare: number;
  /** How fast it turns toward what it faces: the share of the error taken a second. */
  turn: number;
  /** How near a goal counts as arrived, metres. */
  arrive: number;
  /**
   * Its nerve breaks below this share of its health: it thinks as a skittish thing until it is
   * healed, which is to say it runs from whoever hurt it and from the player rather than fighting.
   * Nothing heals a fighter, so a broken nerve is for the rest of its life -- deliberately: a
   * badly hurt one wanders off and bolts if you come near it.
   */
  fleeUnder: number;
  /** The window the stuck check measures over, and the share of the ground commanded that counts as moving. */
  stuckWindow: number;
  stuckShare: number;
}

export const FIGHTER_TUNE: FighterTune = {
  run: 5.2,
  walk: 1.8,
  think: 0.4,
  thinkJitter: 0.25,
  reach: 1.9,
  gunRange: 22,
  aimCone: 0.5,
  aimSpread: 0.03,
  gunEvery: 0.35,
  gunSpread: 0.3,
  swingEvery: 1.1,
  swingSpread: 0.4,
  wanderInsideShare: 0.8,
  turn: 6,
  arrive: 0.5,
  fleeUnder: 0.25,
  stuckWindow: 1.5,
  stuckShare: 0.2,
};

/**
 * What `__debug.fighters({ ... })` takes: the body's own numbers as before, plus `stance` for how
 * a fighter stands and aims and `body` for the capsule and the character controller under it
 * (`src/world/fighterStance.ts`). The mind's numbers are the creatures' and move through
 * `__debug.mobileTune({ brain: { ... } })`, as they always have.
 */
export type FighterKnob = Partial<FighterTune> & { stance?: Partial<StanceTune>; body?: Partial<FighterBody> };

/** The wearables a Wookiee wears, and nobody else: the Kashyyykian pieces, and the ones marked _wke. */
const WOOKIEE_ONLY = /kashyyyk|(^|_)wke(_|$)/i;
/** Pieces that are not clothes to be seen in: quest props, the new-player set. */
const NOT_STREET = /_quest$|_npe$|_noob$|prison|slave/i;

/**
 * An outfit for a fighter off its species' wardrobe: something on the chest, the legs and the
 * feet always, a hat, gloves or a back piece now and then, each a random piece of the slot for
 * the species' gender. A Wookiee wears only the pieces made for Wookiees, and no one else wears those.
 */
export function pickOutfit(items: { id: string; kind: string; gender: string; parts?: unknown[] }[], species: string): string[] {
  const wookiee = /^wookiee/i.test(species);
  const gender = /female/.test(species) ? 'f' : 'm';
  // A worn-unseen entry (no meshes: the Ithorians' :hide items) dresses nothing, so it is never picked.
  const pool = items.filter((i) => i.kind !== 'hair' && i.gender === gender && (i.parts?.length ?? 1) > 0 && WOOKIEE_ONLY.test(i.id) === wookiee && !NOT_STREET.test(i.id));
  const bySlot = new Map<string, string[]>();
  for (const i of pool) (bySlot.get(slotOf(i.id)) ?? bySlot.set(slotOf(i.id), []).get(slotOf(i.id))!).push(i.id);
  const pick = (slot: string, chance: number) => {
    const list = bySlot.get(slot);
    if (!list?.length || Math.random() > chance) return null;
    return list[Math.floor(Math.random() * list.length)];
  };
  return [pick('chest', 1), pick('legs', 1), pick('feet', 1), pick('head', 0.3), pick('hands', 0.3), pick('back', 0.2), pick('waist', 0.4)].filter((s): s is string => !!s);
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
/** The third the aim needs (the grip, against the muzzle): written, never made, never kept. */
const tmp3 = new THREE.Vector3();
/** What a blade faces while no camera is given (a dead fighter's retracting blade, a headless step). */
const IDLE_CAMERA = new THREE.PerspectiveCamera();
const spot = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const tmpQ = new THREE.Quaternion();
/** The two ends of a line-of-sight test, written rather than made: one ray a thought, no objects. */
const LINE_FROM = { x: 0, y: 0, z: 0 };
const LINE_TO = { x: 0, y: 0, z: 0 };
/**
 * The four things a frame asks for, per fighter, kept and written into rather than built. Nothing
 * here is read across a call, so one of each serves every fighter in the world: `stanceAsk` and
 * `aimAsk` are filled and handed straight to a pure function, and `moveAsk`/`moveGot` are the
 * vectors the character controller is given and answers into (its `computedMovement()` makes one
 * every call unless it is handed somewhere to write).
 */
const stanceAsk: StanceInput = { gun: false, combat: false, hasTarget: false, gap: 0, range: 0, offNose: 0 };
const aimAsk: AimWhen = { aiming: false, sinceShot: 0, stunned: false };
const moveAsk = { x: 0, y: 0, z: 0 };
const moveGot = { x: 0, y: 0, z: 0 };

/** A fighter's lit blade wanting a pooled light this frame: where, in its colour, and how far from the eye (squared). */
export interface FighterGlow {
  readonly pos: THREE.Vector3;
  color: number;
  d2: number;
}

export interface NpcDeps {
  weapons: WeaponCatalogue | null;
  effects: Effects | null;
  /**
   * What a physics collider belongs to, if it is something a blade can hurt: the same lookup the
   * bolts are given, with the player's own capsule answering for the player, who is in no
   * manager's collider map. Without it a fighter's swing finds nothing and hurts nobody.
   */
  hittableAt?: (handle: number) => Hittable | undefined;
  /** The species the character packs hold, by id; the fallback list when none is known. */
  species: string[];
  /** Compile an object's shaders in the background, resolving when it can be drawn without a stall. */
  compile?: (objects: THREE.Object3D[]) => Promise<void>;
  /** The room a fighter put down inside a building starts in. */
  cellAt?: (p: THREE.Vector3) => CellState | null;
  /** Follow a body through a building's portals, as the player is followed. */
  followCell?: (state: CellState | null, prev: THREE.Vector3, pos: THREE.Vector3) => CellState | null;
  /**
   * Whether that room's colliders are built this instant. A building's collision comes and goes
   * with the player's distance while the room a body is in goes on answering from model data, so
   * without this a fighter left behind in a building falls through a floor that is no longer
   * there. With no answer wired the fighters take "solid", which is exactly how they behaved
   * before it existed.
   */
  cellSolid?: (state: CellState | null) => boolean;
}

/** How often (seconds of sim time) a fighter's room is followed, and how far it may go between. */
const FOLLOW_EVERY = 0.25;
const FOLLOW_STEP = 2;
/** Inside a building: neither the terrain under it nor the building's outer shell, as the player walks. */
const INSIDE_FILTER = groups(Group.all, Group.all & ~(Group.terrain | Group.exterior));
/** Outside: everything. */
const OUTSIDE_FILTER = groups(Group.all, Group.all);
/**
 * What stops a fighter walking: only what stands still. A collider with no body at all (a room's,
 * a building's) or a fixed one (the ground, a placed object) is a wall; everything that moves on
 * its own passes through, which is another fighter, a creature, a mobile, a vehicle, the player,
 * another player's body (kinematic and a sensor besides) and a corpse (dynamic). That is not the
 * player's predicate, which stops the player on a creature: it is deliberately narrower, because a
 * crowd of fighters that jam on one another would report itself stuck and give up the fight.
 */
const staticOnly = (c: RAPIER.Collider): boolean => {
  const body = c.parent();
  return !body || body.isFixed();
};
/** The lookup a fighter has before the game hands it one: a blade then finds nothing at all. */
const NOTHING_AT = (): undefined => undefined;
/**
 * Said once, the first time a swing opens with no lookup behind it. Without one a swept blade can
 * find nobody, which would leave every bladed fighter in the game harmless and look exactly like a
 * tuning problem -- so the swing falls back on the blow the timer used to land and this says why.
 */
let warnedBlind = false;
/** Said once, the first time the floor of last resort has to lift a body a whole height (see `move`). */
let warnedLift = false;

// `ErrandBody` is here rather than only in `errand.ts` so the compiler is what says a fighter can be
// given a long walk: its home is writable, it has a key and a label, and it can say what it is doing
// without allocating. Nothing else in the game answers to it.
export class Npc implements Living, ErrandBody {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  /**
   * The player's own character controller, on the player's own numbers: what stops this body at a
   * wall, climbs it up a step and a ramp, and answers whether it is standing on anything. A
   * fighter's place is still written straight into a kinematic body -- what changed is that the
   * place written is the one the controller allowed.
   */
  readonly controller: RAPIER.KinematicCharacterController;
  readonly halfHeight = FIGHTER_BODY.halfHeight;
  /** Its place in the one list of living things, for as long as it lives. */
  readonly key = nextLivingKey();
  readonly side: Side = 'fighter';
  readonly aggression: Aggression = 'aggressive';
  /** Standing on the ground: a fighter is, except while the Force has it off it. */
  grounded = true;
  hp = HP;
  /** What it started with, so a readout can show its health as a share of it. */
  readonly maxHp = HP;
  dead = false;
  deadTimer = 0;
  heading = Math.random() * Math.PI * 2;
  rig: CharacterRig | null = null;
  arm: Arm = 'saber';
  weapon: WeaponDef | null = null;
  gun: GunProfile | null = null;
  /** The pieces it dressed in, by catalogue id. */
  outfit: string[] = [];
  private holder: THREE.Group | null = null;
  private hiltTop = 0.13;
  private blade: SaberBlade | null = null;
  /**
   * This fighter's blade emitter and full-length tip this frame, world space. Each fighter keeps
   * its own: they were once shared by every fighter, and every glow sat at the last one's blade.
   */
  private readonly bladeBase = new THREE.Vector3();
  private readonly bladeTip = new THREE.Vector3();
  readonly color = new THREE.Color().setHSL(Math.random(), 0.9, 0.55);
  private target: Living | null = null;
  private attackCd = 1 + Math.random();
  /**
   * The brain's own state, kept between thoughts and handed back to it: what it is doing, whom it
   * is after, where it is going, when an alert or a flight ends, since when its target has been out
   * of reach in height, and the target it has given up on. All of it is the creatures' vocabulary,
   * so `mobiles/brain.ts` reads a fighter and a bantha out of the same struct.
   */
  state: MobileState = 'idle';
  private targetKey: number | null = null;
  private decision: Decision | null = null;
  private thinkAt = 0;
  private wanderAt = -1;
  private goal: { x: number; z: number } | null = null;
  private until = 0;
  private blockedSince: number | null = null;
  private forgetKey: number | null = null;
  private forgetUntil = 0;
  /** Whoever hurt it and when (simulated seconds); the brain turns it on the most recent of them. */
  private readonly memory = new Map<number, { who: Living; at: number }>();
  /** The brain's view of the world this thought, and the objects it is filled into: one set for the fighter's life. */
  private readonly brainTargets: BrainTarget[] = [];
  private readonly brainPool: BrainTarget[] = [];
  /** The point it is facing this frame (the target moves between thoughts): written, never made. */
  private readonly faceAt = { x: 0, z: 0 };
  /** The pace the last thought asked for, so the rig plays the walk the brain wandered at. */
  private pace: 'stand' | 'walk' | 'run' = 'stand';
  /**
   * The ground this frame's step asked for, before anything was allowed to stop it: `act` writes
   * it and `update` hands it to the character controller. One vector for the fighter's life.
   */
  private readonly wish = new THREE.Vector3();
  /** The vertical, read and written in place by `settleFooting`; `y` is copied back onto `pos`. */
  private readonly footing: Footing = { y: 0, fallVy: Number.NaN, grounded: true };
  /** How far along the ground it really went this frame, against how far it asked for: the readout's `held`. */
  private moved = 0;
  /**
   * Seconds since it last had something alive to fight. The combat carry lasts `STANCE_TUNE.ready`
   * seconds past that, exactly as the player's blaster stays up for five seconds after a shot, so
   * a fighter that has just killed somebody does not snap its blade off on the same frame.
   */
  private sinceFought = Infinity;
  /** Which carry it stands in this frame: relaxed, combat, or aimed at something. */
  stance: Stance = 'relaxed';
  /**
   * The aim's measured correction, this fighter's own: the barrel against where the next bolt is
   * going, folded in a frame at a time. The spine takes `spineShare` of the yaw and the drawn body
   * takes what is left (`aimTurn`), which is the player's own division of it.
   */
  private readonly aimFix = { yaw: 0, pitch: 0 };
  private aimTurn = 0;
  /** Seconds since it last fired, so the recoil is not chased (the player does not chase it either). */
  private sinceShot = Infinity;
  /**
   * The blaster poses this rig has for the gun in its hand, found once when the weapon goes on:
   * which carries its speed set is, the aimed pose held on the upper body and the hip-fire one.
   * Resolved to clip names rather than kept as patterns, because a pattern is re-matched against
   * every one of the rig's twelve hundred clips on every `setState`, which is every frame.
   */
  private gunPose: { kind: 'pistol' | 'rifle'; aim: string | null; ready: string | null } | null = null;
  /**
   * The far end of a gun in the holder's own frame: the extreme of the model's **longest** axis,
   * which is the barrel, read by the same rule the player's own hand reads a rack weapon with
   * (`weaponFarPoint`, and the player's hidden `far` marker). Read along anything else the aim
   * would line the wrong axis up with the target, which is the mistake that once turned the guns
   * ninety degrees.
   */
  private readonly barrelFar = new THREE.Vector3();
  /** How often in a row it has been found going nowhere while it asked to move, and the window's measure. */
  private stuck = 0;
  private stuckClock = 0;
  private stuckCommanded = 0;
  private readonly stuckFrom = new THREE.Vector3();
  /**
   * A swing under way: seconds of it left. While it runs the blade sweeps the ground it covers
   * every frame, so the blow lands where the blade passed rather than on whoever happened to
   * stand within reach when a timer ran out.
   */
  private swingLeft = -1;
  /**
   * Where this fighter's blade was when it was last drawn. Its own, never at module scope: one
   * path there would be every fighter's path at once, which is the mistake the blade ends above
   * were already made to stop making.
   */
  private readonly bladePath = new BladePath();
  /** What this swing has already bitten: one bite per body per swing, as the player's blade takes. */
  private readonly hitThisSwing = new Set<Hittable>();
  /** This fighter behind its own blow rather than the player: one struct, written, never made. */
  private readonly strike: Striker;
  /** Whether this swing's blade has been swept at all: with no lookup it never is. */
  private swingSwept = false;
  /** Whether this swing has already been heard landing: one contact sound a swing, as the timer gave. */
  private swingSounded = false;
  /** Who this swing was aimed at, for the blow the timer used to land when nothing can be swept. */
  private swingTarget: Living | null = null;
  /** What the game hands it to name colliders with this frame; `NOTHING_AT` until it is wired. */
  private lookup: (handle: number) => Hittable | undefined = NOTHING_AT;
  /**
   * What this fighter's blade is allowed to find. The sweep hands back colliders and the game's
   * own lookup names the turrets, the vehicles and another player's hull as well as the living,
   * while the blow this replaced could only ever reach a `Living` it had picked out of the world's
   * list of them -- so a swing beside a parked speeder must not take the speeder down, and a
   * fighter standing over a body that is already out must not go on cutting it.
   */
  private readonly findLiving = (handle: number): Hittable | undefined => {
    const c = this.lookup(handle);
    // A `Living` has a key; a turret, a vehicle or a peer's hull can merely be hurt and has none.
    if (!c || c.dead || typeof (c as Partial<Living>).key !== 'number') return undefined;
    return c;
  };
  /** A sword's or a club's far end in the holder's own frame (a lightsaber's blade is measured from its hilt). */
  private readonly reachFar = new THREE.Vector3();
  private stunned = 0;
  private slowed = 0;
  private dotDps = 0;
  private dotLeft = 0;
  private readonly push = new THREE.Vector3();
  private moving = false;
  readonly name: string;
  /** The building room it is in, followed through the portals by the manager; null outside. */
  cell: CellState | null = null;
  /**
   * Whether that room has collision under it this instant, refreshed on the same pass the room is
   * followed on. True outdoors and true with nothing wired to ask, which is what it always was.
   */
  cellSolid = true;
  /** How often the floor of last resort has had to lift this body, and by how much the last time. */
  private lifted = 0;
  private liftedBy = 0;
  /** Its own path: the corners still to walk, and the clock that says when to ask for fresh ones. */
  readonly navAgent = new NavAgent();
  /** Where it stood when its room was last followed, and when (sim time). */
  readonly cellFrom = new THREE.Vector3();
  followAt = -Infinity;
  /**
   * Where it was stood. The brain leashes it back here when a chase runs long, which is the one
   * thing a fighter has never done: before this it followed whatever it was after until one of
   * them died.
   *
   * Not readonly, and that is most of the waypoint order: `decide`'s first rule is "past the leash,
   * run home, take no target, answer nobody, until you are within two metres of home", so **moving
   * these two is the order** and `brain.ts` never has to know an order exists. Only
   * `src/world/errand.ts` writes them, and it writes them every step so nothing can quietly lift an
   * order half way. The rest of the order is `holdReturn` below, which is what carries it over the
   * stretch where the leash cannot.
   */
  homeX: number;
  homeZ: number;
  /**
   * The long walk this fighter is on, if any: the order, the track of how it went and the verdict
   * (`src/world/errand.ts`). Null for every fighter in an ordinary fight, and nothing in the fight
   * reads it.
   */
  errand: Errand | null = null;

  constructor(readonly species: string, private readonly physics: Physics, x: number, y: number, z: number) {
    this.name = `${species.replace(/_/g, ' ')} fighter`;
    this.homeX = x;
    this.homeZ = z;
    this.pos.set(x, y, z);
    this.group.position.copy(this.pos);
    markActor(this.group);
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + this.halfHeight, z));
    // The collision capsule is the **player's**, not the drawn body's: the same radius and the same
    // straight part, dropped so its feet are this body's feet. The two were one number and a
    // clearance between the player's 1.6 m and the fighter's 1.8 m was therefore open for the
    // player and a wall for a fighter -- a lintel, a pipe, a low doorway -- which is the "stuck
    // where it used to walk through" the controller was given to avoid rather than to cause.
    // `halfHeight` is untouched: it is the aim point the rest of the game shoots at.
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(FIGHTER_BODY.standHalf, FIGHTER_BODY.radius).setTranslation(0, capsuleDrop(), 0), this.body);
    // The controller is made with the body and set to the fighters' numbers, which are the
    // player's. It never pushes what it walks into: the engine's push works the contact against
    // the other body's own shape, and with a hull's triangles as that shape it panics and every
    // call into the engine fails afterwards -- the lesson `Player.pushBodies` is off for.
    this.controller = physics.world.createCharacterController(FIGHTER_BODY.offset);
    applyBody(this.controller);
    // Who is swinging. `from` is this fighter's own place object, so the shove a blow gives is
    // measured from where it stands this frame with nothing copied; nothing is spared and there is
    // no matrix, since a fighter never fights in a hull's frame.
    this.strike = { physics, hittableAt: this.findLiving, effects: null, source: this, from: this.pos, exclude: this.body, spare: null, radius: BLADE_RADIUS, damage: BLADE_SWING.fighterSaber, push: BLADE_SWING.fighterPush, color: 0xffffff, now: 0 };
  }

  /** What to call it in the console and on a target reticle. */
  get label(): string {
    return this.name;
  }

  /**
   * Whether it has something alive it means to fight. Read by what gives it a voice: a fighter
   * standing about with nothing to fight calls out at nothing. One wandering, fleeing or going
   * home has no target at all, so it falls silent of its own accord.
   */
  get hunting(): boolean {
    return !this.dead && !!this.target && !this.target.dead;
  }

  /** A person is a circle from above: the capsule's own radius, whichever way you come at it. */
  radiusToward(): number {
    return FIGHTER_BODY.radius;
  }

  /** Where the world's simulated clock stood at this fighter's last step: the hold's grace keys off it. */
  private now = 0;
  /**
   * Whether the world's clock has reached it yet. Until the first step `now` is 0, which is not a
   * time: a blow struck between being stood and that step would stamp a grudge at 0 and the first
   * thought would find it twenty seconds old and throw it away, so a fighter shot as it appeared
   * would not turn on whoever shot it. Those grudges are dated from the first step instead.
   */
  private stepped = false;
  /** Where the Force is holding it, and until when (seconds of that clock); null when free. */
  private heldAt: THREE.Vector3 | null = null;
  private heldUntil = 0;
  /**
   * Vertical speed while it is in the air after a throw or a knock; NaN while it is on the ground.
   * Without it the ground clamp in `update` would drag a gripped fighter back down every frame
   * and a thrown one would slide along the ground, so the powers would appear to do nothing.
   */
  private fallVy = Number.NaN;

  /** Hold it at a point in the air this frame (the Force grip). */
  holdAt(point: THREE.Vector3, dt: number): void {
    if (this.dead) return;
    (this.heldAt ??= new THREE.Vector3()).copy(point);
    // A frame or two of grace, as the creatures use: the power sets this every frame it is held.
    this.heldUntil = this.now + Math.max(0.05, dt * 3);
    this.fallVy = 0;
    this.grounded = false;
    // Stunned while it hangs, as a held creature is: without it the chase step below keeps running
    // and walks the body out of the hold while the lerp drags it back, which reads as a shiver.
    this.stunned = Math.max(this.stunned, 0.3);
  }

  /** Let it go, thrown along `dir`: the push carries it out and the fall brings it down. */
  release(dir: THREE.Vector3, power: number): void {
    this.heldAt = null;
    this.push.addScaledVector(dir, power);
    this.fallVy = Math.max(this.fallVy || 0, power * 0.35);
  }

  /** The rig of its species with a random look, and its weapon in hand; the placeholder is nothing meanwhile. */
  async dress(baseUrl: string, deps: NpcDeps): Promise<void> {
    let rig: CharacterRig | null = null;
    for (const id of [this.species, 'human_male']) {
      try {
        rig = await loadPlayerRig(baseUrl, id);
        break;
      } catch {
        rig = null;
      }
    }
    if (!rig || this.dead) return;
    rig.root.scale.setScalar(rig.scale);
    // Hidden until its clothes are on and their shaders compiled, so the first sight of it is not a stall.
    rig.root.visible = false;
    this.group.add(rig.root);
    markActor(rig.root);
    this.rig = rig;
    rig.setState('idle');
    // A random look: the height, and every colour and choice the pack lets vary, thrown; and
    // clothes off the species' wardrobe.
    const c = rig.character;
    if (c) {
      const values: Record<string, number> = {};
      for (const [name] of Object.entries(c.variableValues())) if (c.canCustomize(name)) values[name] = Math.floor(Math.random() * 12);
      let outfit: string[] = [];
      try {
        outfit = pickOutfit((await c.catalogue(baseUrl)).items, this.species);
      } catch {
        outfit = [];
      }
      this.outfit = outfit;
      try {
        await applyLook(c, { morphs: {}, values, height: 0.25 + Math.random() * 0.5, outfit }, baseUrl);
      } catch {
        // A look that will not go on is no loss.
      }
    }
    await this.armUp(deps);
    if (this.dead || !this.rig) return;
    rig.root.updateMatrixWorld(true);
    if (deps.compile) await deps.compile([rig.root]);
    rig.root.visible = true;
  }

  /** A weapon off the rack: a lightsaber most often, else a sword or a gun, hung on the hand as the game hangs it. */
  private async armUp(deps: NpcDeps): Promise<void> {
    const rig = this.rig;
    const cat = deps.weapons;
    if (!rig || !cat) return;
    const r = Math.random();
    const pool = cat.weapons.filter((w) => (r < 0.5 ? w.class === 'lightsaber' : r < 0.7 ? w.class === 'sword1h' || w.class === 'sword2h' || w.class === 'polearm' : FIGHTS[w.class] === 'gun') && !/_static$|_npe$|_noob$/.test(w.id));
    const def = pool[Math.floor(Math.random() * pool.length)];
    if (!def) return;
    const hand = rig.boneFor('rightHand');
    if (!hand) return;
    let model: THREE.Group;
    try {
      model = await cat.model(def);
    } catch {
      return;
    }
    if (this.dead || !this.rig) return;
    const holder = new THREE.Group();
    holder.name = `npc weapon:${def.id}`;
    holder.add(model);
    holder.scale.setScalar(1 / Math.max(hand.getWorldScale(tmp).x, 1e-6));
    hand.add(holder);
    markActor(holder);
    this.holder = holder;
    this.weapon = def;
    this.arm = isSaber(def.class) ? 'saber' : FIGHTS[def.class] === 'gun' ? 'gun' : 'melee';
    if (this.arm === 'saber') {
      // The hilt along the character's forward, as the game's clips hold it; the blade from its top.
      rig.root.updateWorldMatrix(true, true);
      tmp.set(0, 0, 1).applyQuaternion(rig.root.getWorldQuaternion(tmpQ));
      tmp.applyQuaternion(hand.getWorldQuaternion(tmpQ).invert()).normalize();
      holder.quaternion.setFromUnitVectors(Y, tmp);
      const b = def.bounds;
      this.hiltTop = b ? Math.abs(b.max[1] - b.min[1]) / 2 : 0.13;
      this.blade = new SaberBlade();
      this.blade.setColor(this.color.getHex());
      if (def.blade) this.blade.spec = { length: def.blade.length, width: def.blade.width, open: def.blade.open, close: def.blade.close };
      this.group.parent?.add(this.blade.group);
      if (this.blade.group.parent) markActor(this.blade.group);
    } else if (this.arm === 'gun') {
      this.gun = GUNS[gunTypeFor(def, def.class)];
      this.findGunPoses(rig, def);
    } else {
      // A sword, an axe or a club: its reach is the far end of the model's longest extent, which is
      // the rule the player's own hand reads a rack weapon with, so both swing the same steel.
      const far = weaponFarPoint(def.bounds, def.length);
      this.reachFar.set(0, 0, 0).setComponent(far.axis, far.distance);
    }
  }

  /**
   * The blaster carries this rig has for the gun that has just gone into its hand, found once and
   * kept: the relaxed set (a pistol at the side, a rifle across the chest), which is the legs and
   * the arms for every carry, and the two poses that ride the upper body over it -- the aimed one
   * and the hip-fire one. They are the player's own choices (`Player.animateRig`), read the same
   * way: the table's own aimed loop where the species has one, else the transition into the aimed
   * pose held at its end, which `CharacterRig` already knows to hold because its name ends in
   * `_aimed` or `_ready`.
   *
   * Every one is resolved to a clip **name** here rather than left as a pattern for `prefer`,
   * because a pattern is matched against every clip the rig holds on every `setState`, and a
   * species rig holds twelve hundred of them. A rig without the game's blaster clips comes out of
   * this with nulls and the state table's own fallbacks carry it, which is what a fighter has
   * always played.
   */
  private findGunPoses(rig: CharacterRig, def: WeaponDef): void {
    const far = weaponFarPoint(def.bounds, def.length);
    this.barrelFar.set(0, 0, 0).setComponent(far.axis, far.distance);
    const kind = gunKindOf(def.class);
    const base = kind === 'pistol' ? 'loop_pistol_standing' : 'loop_rifle';
    // The relaxed carry's speed set under every carry, so the legs never sway an aimed pose.
    for (const [suffix, n] of [['Idle', 0], ['Walk', 1], ['Run', 2]] as const) {
      const relaxed = rig.clipMatching(new RegExp(`^${base}:speed${n}`)) ?? null;
      rig.prefer(`gun${suffix}` as RigState, relaxed);
      rig.prefer(`gunReady${suffix}` as RigState, relaxed);
      rig.prefer(`gunAim${suffix}` as RigState, relaxed);
    }
    const aim = rig.firstOf(...rig.clipsMatching(new RegExp(`^loop_${kind}(_a)?_combat_standing_aimed(:speed0)?$`)), kind === 'pistol' ? 'trn_pistol_combat_to_pistol_combat_aimed' : 'trn_rifle_a_standing_ready_to_aimed');
    const ready = kind === 'pistol'
      ? rig.firstOf('loop_pistol_riding', ...rig.clipsMatching(/^loop_pistol_combat_standing_aimed/))
      : rig.firstOf('trn_rifle_a_standing_hold_to_ready', 'loop_rifle_riding');
    this.gunPose = { kind, aim, ready };
  }

  /** Whoever struck, remembered from now: the brain turns it on the most recent of them. */
  private remember(source: Living): void {
    if (source.key === this.key) return;
    const g = this.memory.get(source.key);
    if (g) {
      g.at = this.now;
      g.who = source;
    } else this.memory.set(source.key, { who: source, at: this.now });
  }

  damage(amount: number, from?: THREE.Vector3, push = 0, source?: Living | null): void {
    if (this.dead) return;
    // Allies do not hurt each other, exactly as a mobile's do not: a shot or a swing from its own
    // side, from one that would never pick a fight with it, passes it by. Two fighters are hostile
    // to each other by `hostileSides`, so this lets a brawl between them stand and only stops the
    // blow that could never have been aimed here.
    if (source && source.key !== this.key && source.side === this.side && !hostileSides(source, this)) return;
    if (source && source.key !== this.key && source.aggression !== 'passive') this.remember(source);
    this.hp -= amount;
    this.stunned = Math.max(this.stunned, 0.2);
    if (from && push > 0) {
      tmp.copy(this.pos).sub(from).setY(0).normalize();
      this.knock(tmp, push);
    }
    if (this.hp <= 0) this.die();
  }

  knock(dir: THREE.Vector3, power: number): void {
    if (this.dead) return;
    this.push.addScaledVector(dir, power * 0.6);
    this.stunned = Math.max(this.stunned, 0.5);
    // A real blow takes it off its feet: it rises and falls where it lands, rather than sliding
    // along the ground. A bolt's or a blade's little shove (under six) leaves it standing.
    if (power >= 6) {
      this.fallVy = Math.max(Number.isNaN(this.fallVy) ? 0 : this.fallVy, Math.max(power * 0.35, 2));
      this.grounded = false;
    }
  }

  afflict(dps: number, seconds: number): void {
    if (this.dead) return;
    if (dps * seconds >= this.dotDps * this.dotLeft) {
      this.dotDps = dps;
      this.dotLeft = seconds;
    }
  }

  stun(seconds: number): void {
    this.stunned = Math.max(this.stunned, seconds);
  }

  slow(seconds: number): void {
    this.slowed = Math.max(this.slowed, seconds);
  }

  /** The manager's collider map, so the entry goes at the moment the collider does (see `die`). */
  byCollider: Map<number, Npc> | null = null;

  private die(): void {
    this.dead = true;
    this.deadTimer = 9;
    this.swingLeft = -1;
    this.swingTarget = null;
    this.hitThisSwing.clear();
    this.bladePath.reset();
    this.navAgent.clear();
    this.heldAt = null;
    this.memory.clear();
    this.target = null;
    this.targetKey = null;
    this.decision = null;
    this.state = 'dead';
    const rig = this.rig;
    // The death clip plays out, then the body falls to the physics from its last frame.
    this.ragdollIn = 0.6;
    if (rig) {
      const clip = rig.firstOf('trn_stand_to_incapacitated', 'BOTH_DEATH1', 'BOTH_DEATH4', 'BOTH_DEAD1');
      if (clip) {
        rig.play(clip, { fadeIn: 0.08, hold: true });
        this.ragdollIn = Math.min(3, (rig.clipDuration(clip) ?? 1) - 0.05);
      }
    }
    // The handle goes out of the lookup at the moment the collider goes, not ten seconds later
    // when the fighter is disposed: rapier recycles handles, so a fresh body landing on this one
    // in the meantime would otherwise be found as this corpse.
    this.byCollider?.delete(this.collider.handle);
    this.physics.world.removeCollider(this.collider, false);
  }

  /** The body left to the physics once the death clip has played; the fighter is cleared ten seconds later. */
  ragdoll: Ragdoll | null = null;
  private ragdollIn = -1;

  private startRagdoll(): void {
    if (this.ragdoll || !this.rig) return;
    this.group.updateMatrixWorld(true);
    this.ragdoll = new Ragdoll(this.physics, this.rig.root, { velocity: this.push.clone() });
    this.deadTimer = 10;
    if (this.blade) this.blade.group.visible = false;
  }

  /** Where a gun's muzzle is: the far end of the model's long axis, as the rack reads it. */
  private muzzle(out: THREE.Vector3): THREE.Vector3 {
    const h = this.holder;
    if (!h) {
      out.copy(this.pos);
      out.y += 1.3;
      return out;
    }
    const len = this.weapon?.length ?? 0.6;
    h.updateWorldMatrix(true, false);
    return h.localToWorld(out.set(0, 0, len * 0.55));
  }

  /**
   * Whether a shot from here would reach a target's middle: one ray against what stands still,
   * cast at a thought and never at a frame. Inside a building it ignores the terrain and the
   * outer shells, as everything else of a body indoors does.
   */
  private lineTo(t: Living): boolean {
    this.muzzle(tmp);
    LINE_FROM.x = tmp.x;
    LINE_FROM.y = tmp.y;
    LINE_FROM.z = tmp.z;
    LINE_TO.x = t.pos.x;
    LINE_TO.y = t.pos.y + t.halfHeight;
    LINE_TO.z = t.pos.z;
    return !this.physics.segmentBlocked(LINE_FROM, LINE_TO, !!this.cell);
  }

  /**
   * Its nerve, which is what the brain is told its temper is. Whole, it is the aggressive thing it
   * has always been; below `fleeUnder` of its health it thinks as a skittish one, which in the
   * creatures' brain means running from whoever hurt it and from the player rather than fighting.
   * Its `aggression` itself never moves, because that is what the rest of the game reads to decide
   * who picks a fight with it, and a wounded fighter is still worth fighting.
   */
  private get nerve(): Aggression {
    return this.hp < this.maxHp * FIGHTER_TUNE.fleeUnder ? 'skittish' : this.aggression;
  }

  /**
   * A wander goal pulled back inside the indoor leash, in place. The brain's wander reaches 8 to
   * 30 m from home in any direction, which is drawn for the open ground; indoors it leashes at 25,
   * so a goal past that radius makes the leash fire the moment the fighter crosses it and the
   * fighter churns out and back for as long as it is left alone. Nothing of the brain's is changed
   * for it: its wander is the wildlife's as much as the fighters', and this is one fighter pulling
   * its own goal in. `FIGHTER_TUNE.wanderInsideShare` is how much of the leash it may use.
   */
  private clampWanderInside(d: Decision): void {
    const g = d.goal;
    if (!g) return;
    const max = BRAIN_TUNE.leashInside * FIGHTER_TUNE.wanderInsideShare;
    const dx = g.x - this.homeX;
    const dz = g.z - this.homeZ;
    const far = Math.hypot(dx, dz);
    if (far <= max || far < 1e-6) return;
    const k = max / far;
    g.x = this.homeX + dx * k;
    g.z = this.homeZ + dz * k;
    // The brain hands one object back as the goal, as where it walks and as what it faces; the
    // other two are written from it all the same, so that this stays right if that ever changes.
    if (d.moveTo && d.moveTo !== g) {
      d.moveTo.x = g.x;
      d.moveTo.z = g.z;
    }
    if (d.face && d.face !== g) {
      d.face.x = g.x;
      d.face.z = g.z;
    }
  }

  /**
   * One thought. The world's living things are filled into pooled structs, the fighter itself into
   * a `BrainSelf`, and the creatures' own `decide` answers; everything it hands back is kept for
   * the next thought and read by the frames in between. The list is cut to what could matter --
   * anything it holds a grudge against or is already fighting, and everything else within the
   * farthest the brain's own numbers can reach.
   */
  private think(foes: readonly Living[], now: number): void {
    if (this.wanderAt < 0) this.wanderAt = now + 1 + Math.random() * 4;
    // Grudges past the brain's memory, and the dead, are dropped.
    for (const [k, g] of this.memory) if (now - g.at > BRAIN_TUNE.memory || g.who.dead) this.memory.delete(k);
    const list = this.brainTargets;
    list.length = 0;
    let current: Living | null = null;
    const reachOut = Math.max(BRAIN_TUNE.aggroBig, BRAIN_TUNE.leash) + 30;
    const ranged = this.arm === 'gun' && this.gun ? FIGHTER_TUNE.gunRange : 0;
    for (const t of foes) {
      if (t.key === this.key) continue;
      const dx = t.pos.x - this.pos.x;
      const dz = t.pos.z - this.pos.z;
      const grudge = this.memory.get(t.key);
      const isCurrent = t.key === this.targetKey;
      if (!grudge && !isCurrent && dx * dx + dz * dz > reachOut * reachOut) continue;
      if (isCurrent) current = t;
      // Filled into a pooled object: the brain copies what it keeps and never holds on to these.
      let b = this.brainPool[list.length];
      if (!b) {
        b = { key: 0, x: 0, y: 0, z: 0, halfHeight: 0, radius: 0, side: t.side, aggression: t.aggression, dead: false, attackedMeAt: -Infinity, hasLine: false };
        this.brainPool.push(b);
      }
      b.key = t.key;
      b.x = t.pos.x;
      b.y = t.pos.y;
      b.z = t.pos.z;
      b.halfHeight = t.halfHeight;
      b.radius = t.radiusToward(this.pos) + this.radiusToward();
      b.side = t.side;
      b.aggression = t.aggression;
      b.dead = t.dead;
      b.attackedMeAt = grudge ? grudge.at : -Infinity;
      // One ray a thought, and only along the one it is already after: a fresh target is chased or
      // stared at for a tick before it is shot at, which is the rule the creatures fight by too.
      b.hasLine = isCurrent && ranged > 0 && !t.dead ? this.lineTo(t) : false;
      list.push(b);
    }
    const self: BrainSelf = {
      key: this.key,
      x: this.pos.x,
      y: this.pos.y,
      z: this.pos.z,
      heading: this.heading,
      homeX: this.homeX,
      homeZ: this.homeZ,
      side: this.side,
      aggression: this.nerve,
      inside: !!this.cell,
      // A person is never a big body: the far sight is a bantha's and a rancor's.
      big: false,
      reach: FIGHTER_TUNE.reach,
      ranged,
      melee: this.arm !== 'gun',
      halfHeight: this.halfHeight,
      hpRatio: this.hp / this.maxHp,
      state: this.state,
      targetKey: this.targetKey,
      stuck: this.stuck,
      now,
      wanderAt: this.wanderAt,
      goal: this.goal,
      until: this.until,
      blockedSince: this.blockedSince,
      forgetKey: this.forgetKey,
      forgetUntil: this.forgetUntil,
    };
    const d = decide(self, list);
    // A wander indoors is pulled back inside the indoor leash before it is kept: see
    // `wanderInsideShare`. Only a wander, and only inside -- a flight is meant to be short and to
    // end where it ends, and outdoors the brain's farthest wander is half the leash already.
    if (d.state === 'wander' && this.cell) this.clampWanderInside(d);
    if (d.clearMemory) this.memory.clear();
    if (d.targetKey !== this.targetKey) {
      this.stuck = 0;
      this.stuckClock = 0;
      // And the metres asked for in the part-window being thrown away with it: left standing, a
      // fighter that finished a run at the run speed and then stood still to attack a new target
      // carried that speed into `avg` over a clock starting at nothing, and counted a stuck it
      // had not earned.
      this.stuckCommanded = 0;
    }
    this.targetKey = d.targetKey;
    // The body behind the key: the one already in hand when it has not changed, else looked up once.
    let next: Living | null = d.targetKey === null ? null : d.targetKey === current?.key ? current : null;
    if (d.targetKey !== null && !next) {
      for (const t of foes) {
        if (t.key !== d.targetKey) continue;
        next = t;
        break;
      }
    }
    this.target = next;
    this.wanderAt = d.wanderAt;
    this.goal = d.goal;
    this.until = d.until;
    this.blockedSince = d.blockedSince;
    this.forgetKey = d.forgetKey;
    this.forgetUntil = d.forgetUntil;
    if (d.state === 'return' && this.state !== 'return') this.goal = null;
    this.state = d.state;
    this.decision = d;
  }

  /**
   * One frame of what the last thought decided: the brain gives a goal, a pace and something to
   * face, and the fighter walks at it in a straight line, because paths are a later pass's. The
   * attack is the one the brain chose, on the fighter's own cooldown and only once its nose is
   * within `aimCone` of what it is fighting, which is the gate its swing has always had.
   */
  private act(sdt: number, bolts: Bolts, effects: Effects | null, hittableAt: ((handle: number) => Hittable | undefined) | null): void {
    const d = this.decision;
    if (this.target?.dead) this.target = null;
    const t = this.target;
    let moveTo = d?.moveTo ?? null;
    let face = d?.face ?? null;
    let pace: 'stand' | 'walk' | 'run' = d?.pace ?? 'stand';
    // The target moves between thoughts: the chase and the aim follow it every frame.
    if (t && d && (d.state === 'chase' || d.state === 'attack' || d.state === 'alert')) {
      this.faceAt.x = t.pos.x;
      this.faceAt.z = t.pos.z;
      face = this.faceAt;
      if (d.state === 'chase') {
        moveTo = this.faceAt;
        // Close enough to strike: stop rather than run on until the next thought. A gun keeps
        // closing, because a chase is what the brain answers when the shot is out of range *or*
        // when there is a wall in the way, and standing off at the gun's range with nothing to
        // shoot through would leave it there for good.
        const gap = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) - t.radiusToward(this.pos) - this.radiusToward();
        if (this.arm !== 'gun' && gap <= FIGHTER_TUNE.reach) pace = 'stand';
      }
    }
    // Stunned, or with a blade already on its way through a swing, it stands where it is.
    if (this.stunned > 0 || this.swingLeft >= 0) pace = 'stand';
    // The way out of the room (src/world/nav/). Indoors, the building's own floors say which corner
    // to walk at next; only what it *faces* is taken from the path, so the arrival test further
    // down still measures the real goal. Never while it is attacking: `diff` below is also the gate
    // its swing is held behind, and a nose turned at a corner is a nose off what it is fighting.
    // Outdoors, and in a room the pack has no floor for with the goal in that same room, `corner`
    // is null and every line below is the line it was.
    if (moveTo && pace !== 'stand' && this.cell && d && d.state !== 'attack') {
      const goalY = t && (d.state === 'chase' || d.state === 'alert') ? t.pos.y : this.pos.y;
      const corner = worldNav.corner(this.navAgent, this.cell, this.pos.x, this.pos.y, this.pos.z, moveTo.x, goalY, moveTo.z, this.radiusToward(), this.now);
      if (corner) face = corner;
    }
    let diff = 0;
    if (face && this.stunned <= 0) {
      const want = Math.atan2(face.x - this.pos.x, face.z - this.pos.z);
      diff = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading));
      this.heading += diff * Math.min(1, sdt * FIGHTER_TUNE.turn);
    }
    const speed = pace === 'run' ? FIGHTER_TUNE.run : pace === 'walk' ? FIGHTER_TUNE.walk : 0;
    this.pace = pace;
    this.moving = false;
    // The ground it is asking for, not the ground it will get: `update` hands this to the
    // character controller, and a wall, a slope or a step may let it have less or none of it.
    // That difference is exactly what `checkStuck` below measures.
    this.wish.set(0, 0, 0);
    if (moveTo && speed > 0) {
      const gap = Math.hypot(moveTo.x - this.pos.x, moveTo.z - this.pos.z);
      if (gap > FIGHTER_TUNE.arrive) {
        const step = Math.min(gap, speed * sdt);
        this.wish.x = Math.sin(this.heading) * step;
        this.wish.z = Math.cos(this.heading) * step;
        this.moving = true;
      }
    }
    this.checkStuck(sdt, this.moving ? speed : 0);
    // Stunned it neither moves nor strikes, which is what being stunned has always meant here.
    if (!t || !d || this.stunned > 0 || d.state !== 'attack' || this.attackCd > 0 || Math.abs(diff) >= FIGHTER_TUNE.aimCone) return;
    if (d.attack === 'ranged' && this.arm === 'gun' && this.gun) this.shoot(t, bolts, effects);
    else if (d.attack === 'melee' && this.arm !== 'gun') this.swing(t, hittableAt);
  }

  /**
   * The ground covered against the speed asked for, over a window: far under it and the brain is
   * told it is stuck, and gives the target up after a few of them. It used never to fire, because
   * a fighter's place was written straight in and it walked through whatever was in the way; with
   * the character controller under it there is now something to be held by, so this is live. It is
   * the one thing a fighter *decides* that the body changed, and it is the thing the counter was
   * always wired to: a fighter pressed into a wall gives its target up rather than leaning on it.
   */
  private checkStuck(dt: number, commanded: number): void {
    if (this.stuckClock === 0) this.stuckFrom.copy(this.pos);
    this.stuckClock += dt;
    this.stuckCommanded += commanded * dt;
    if (this.stuckClock < FIGHTER_TUNE.stuckWindow) return;
    const avg = this.stuckCommanded / this.stuckClock;
    const covered = Math.hypot(this.pos.x - this.stuckFrom.x, this.pos.z - this.stuckFrom.z);
    if (avg > 1 && covered < FIGHTER_TUNE.stuckShare * avg * this.stuckClock) this.stuck++;
    this.stuckClock = 0;
    this.stuckCommanded = 0;
  }

  /** A bolt at the foe's middle, out of its own gun off the rack. */
  private shoot(t: Living, bolts: Bolts, effects: Effects | null): void {
    const g = this.gun;
    const rig = this.rig;
    if (!g) return;
    this.attackCd = Math.max(FIGHTER_TUNE.gunEvery, g.primary.fireTime * 2.5) + Math.random() * FIGHTER_TUNE.gunSpread;
    // The recoil is not chased: the aim's correction sits still for a moment after a shot, as the
    // player's does, or it would fight the fire clip's own kick and wag the barrel.
    this.sinceShot = 0;
    this.muzzle(tmp2);
    tmp.copy(t.pos).y += t.halfHeight * 0.9;
    tmp.sub(tmp2).normalize();
    // A fighter's aim scatters a little more than the player's.
    const s = FIGHTER_TUNE.aimSpread;
    tmp.x += (Math.random() - 0.5) * s;
    tmp.y += (Math.random() - 0.5) * s;
    tmp.z += (Math.random() - 0.5) * s;
    tmp.normalize();
    // Its own gun off the rack, so an enemy's shot sounds like the weapon in its hands.
    bolts.fire(tmp2, tmp, { owner: 'enemy', damage: Math.max(6, g.primary.damage * 0.6), speed: g.primary.speed || 2300, color: g.primary.color, size: g.primary.size, push: g.primary.push, exclude: this.body, life: 6, source: this, sound: combatSounds.gunOf(this.weapon), scar: scarFamilyOf(g.type, this.weapon?.fx?.id) });
    effects?.flash(tmp2, g.primary.color, 6, 5, 0.06);
    rig?.playUpper(rig.firstOf('rifle_combat_standing_fire_1', 'add_rifle_fire_1', 'pistol_combat_standing_fire_1') ?? '', 0.04);
  }

  /** A swing: the window during which the blade cuts whatever it passes through. */
  private swing(t: Living, hittableAt: ((handle: number) => Hittable | undefined) | null): void {
    const rig = this.rig;
    this.attackCd = FIGHTER_TUNE.swingEvery + Math.random() * FIGHTER_TUNE.swingSpread;
    // The swing opens a window rather than setting the moment a blow lands: for as long as it
    // runs the blade cuts what it passes through, once each, and it can now miss altogether.
    // The path is not reset here: the blade was drawn on the frame before and wrote its ends
    // down, so the first cut of the swing steps from where the blade really stood.
    this.swingLeft = BLADE_SWING.window;
    this.hitThisSwing.clear();
    this.swingSwept = false;
    this.swingSounded = false;
    // Kept for the one case the sweep cannot cover, below: nothing was ever wired to say what
    // a collider belongs to, so the blade can find nobody however well it is swung.
    this.swingTarget = t;
    noteBladeSwing(!hittableAt);
    if (!hittableAt && !warnedBlind) {
      warnedBlind = true;
      console.warn('fighters: nothing was wired to say what a collider belongs to (npcDeps.hittableAt), so a swung blade can find nobody; the blow it replaced stands in. __debug.blades() counts it.');
    }
    const swing = SWINGS[Math.floor(Math.random() * SWINGS.length)];
    if (rig?.has(swing)) rig.play(swing, { fadeIn: 0.06 });
    // A blade's own whoosh is the sabers' to make (the clip it plays may mark its own); a
    // sword or a club takes the melee table's row for what it is.
    // Jedi Academy's three styles are its A1, A2 and A3 swings, which is the list above.
    // A blade is heard along the blade, not at the hips: the middle of the blade as it was
    // last drawn, which is where its own light is read from too. Before the first frame that
    // drew it there is no blade to speak of, and the body stands in.
    if (this.arm === 'saber') {
      const drawn = this.bladeTip.lengthSq() > 1e-6;
      const bx = drawn ? (this.bladeBase.x + this.bladeTip.x) * 0.5 : this.pos.x;
      const by = drawn ? (this.bladeBase.y + this.bladeTip.y) * 0.5 : this.pos.y + 1.2;
      const bz = drawn ? (this.bladeBase.z + this.bladeTip.z) * 0.5 : this.pos.z;
      combatSounds.saberSwing(swingStyle(swing), bx, by, bz, swing);
    } else combatSounds.melee(this.weapon, false, this.pos.x, this.pos.y + 1.2, this.pos.z);
  }

  /**
   * The same numbers `status()` prints, written into a struct the caller already has instead of
   * built into a fresh object with every field rounded for the console. A long walk reads this on
   * every frame for a quarter of an hour -- about fifty thousand of them -- and nothing in this
   * file may allocate on a frame, which is the whole reason the two are not one method.
   *
   * `held` is the share of the ground this frame asked for that the character controller actually
   * allowed, and `asking` is whether it asked for any: a body standing still reads 1 and must never
   * be mistaken for one leaning on a wall.
   */
  /**
   * Put it on the way home, which is the half of the waypoint order the moved home cannot do on its
   * own. `decide`'s first rule has two clauses and the order needs both: `fromHome > leash` carries
   * a body whose destination is further off than 60 m outdoors or 25 m inside, and
   * `state === 'return' && fromHome > home` carries it the rest of the way in. Since the home **is**
   * the destination, the first clause never fires at all on an order to somewhere in sight, and
   * without this write such an order left the body wandering its new neighbourhood -- an order that
   * silently did nothing. It is also what the last stretch of every long walk has always depended
   * on, and until now only by luck: nothing in the game moves a fighter's state out of `return`, so
   * it held, but nothing said so and a change here would have broken arrivals quietly.
   *
   * A dead body is left alone: `die` writes `dead` and the walk ends on the same step, and putting a
   * state back on a corpse would take its death clip off it.
   */
  holdReturn(): void {
    if (this.dead) return;
    this.state = 'return';
  }

  probe(out: ErrandProbe): void {
    out.x = this.pos.x;
    out.y = this.pos.y;
    out.z = this.pos.z;
    out.heading = this.heading;
    out.state = this.state;
    out.asking = this.wish.lengthSq() > 1e-12;
    out.held = out.asking ? Math.min(1, this.moved / Math.max(1e-6, Math.hypot(this.wish.x, this.wish.z))) : 1;
    out.stuck = this.stuck;
    out.lifted = this.lifted;
    out.liftedBy = this.liftedBy;
    out.grounded = this.grounded;
    out.inside = !!this.cell;
    out.hp = this.hp;
    out.dead = this.dead;
    out.plans = this.navAgent.plans;
    out.failures = this.navAgent.failures;
  }

  /** What it is thinking, in one line, for `__debug.fighters()`. */
  status(): Record<string, unknown> {
    return {
      name: this.name,
      arm: this.arm,
      state: this.state,
      target: this.targetKey === PLAYER_KEY ? 'you' : (this.target?.label ?? this.targetKey),
      hp: Number(this.hp.toFixed(0)),
      nerve: this.nerve,
      fromHome: Number(Math.hypot(this.pos.x - this.homeX, this.pos.z - this.homeZ).toFixed(1)),
      // Under a long walk its home *is* the destination, so `fromHome` is how far it still has to
      // go and this says which walk that is. `__debug.send()` is the whole account.
      errand: this.errand ? (this.errand.done ? `${this.errand.verdict}` : `walking to ${this.errand.place ?? `${Math.round(this.errand.toX)}, ${Math.round(this.errand.toZ)}`}`) : null,
      inside: !!this.cell,
      remembers: this.memory.size,
      stuck: this.stuck,
      // How it stands and how much of the way it is to the ground it asked for: with a body that
      // can be stopped, `held` under one is a fighter leaning on something.
      stance: this.stance,
      grounded: this.grounded,
      // Metres a second downward, 0 standing: `held` reads 1 for an unobstructed fall, so without
      // this nothing on the readout told a body dropping through the world from one walking.
      fall: Number((Number.isNaN(this.fallVy) ? 0 : -this.fallVy).toFixed(2)),
      // Whether the room it is in has collision under it at all (outdoors, always).
      solid: !this.cell || this.cellSolid,
      // How often the floor of last resort has had to lift it a whole body's height, and by how
      // much the last time: both should stay 0.
      lifted: this.lifted,
      liftedBy: Number(this.liftedBy.toFixed(1)),
      held: Number(this.wish.lengthSq() > 1e-12 ? Math.min(1, this.moved / Math.max(1e-6, Math.hypot(this.wish.x, this.wish.z))).toFixed(2) : 1),
      // The aim's correction in degrees, and the share of it the spine could not take.
      aim: { yaw: Number(((this.aimFix.yaw * 180) / Math.PI).toFixed(1)), pitch: Number(((this.aimFix.pitch * 180) / Math.PI).toFixed(1)), body: Number(((this.aimTurn * 180) / Math.PI).toFixed(1)) },
      poses: this.gunPose ? { kind: this.gunPose.kind, aim: this.gunPose.aim, ready: this.gunPose.ready } : null,
    };
  }

  /**
   * `now` is the world's simulated clock (`World.simTime`), so `__debug.advance` exercises the
   * hold. `hittableAt` is what a swinging blade names the colliders it touches with; with none
   * nothing can be swept at all and the swing falls back on the blow the timer used to land.
   */
  update(dt: number, terrain: Terrain, foes: readonly Living[], bolts: Bolts, effects: Effects | null, camera: THREE.Camera | null, now: number, hittableAt: ((handle: number) => Hittable | undefined) | null = null): void {
    if (!this.stepped) {
      this.stepped = true;
      // Whatever was struck before this fighter had a clock is dated from here (see `stepped`).
      for (const g of this.memory.values()) g.at = now;
    }
    this.now = now;
    // Slowed, everything of its own runs at a crawl; a burn eats in real time.
    this.slowed = Math.max(0, this.slowed - dt);
    const own = this.slowed > 0 ? 0.12 : 1;
    if (this.dotLeft > 0 && !this.dead) {
      const step = Math.min(this.dotLeft, dt);
      this.dotLeft -= step;
      this.hp -= this.dotDps * step;
      if (this.hp <= 0) this.die();
    }
    const rig = this.rig;
    if (this.dead) {
      this.deadTimer -= dt;
      if (this.ragdoll) {
        this.ragdoll.update(dt);
        this.ragdoll.centre(this.pos);
        return;
      }
      rig?.update(dt);
      this.ragdollIn -= dt;
      if (this.ragdollIn <= 0 && this.ragdollIn > -100) {
        this.ragdollIn = -1000;
        this.startRagdoll();
      }
      this.blade?.update(dt, this.bladeBase, this.bladeTip, false, camera ?? IDLE_CAMERA, 0, true);
      return;
    }
    this.lookup = hittableAt ?? NOTHING_AT;
    const sdt = dt * own;
    this.stunned = Math.max(0, this.stunned - sdt);
    this.attackCd = Math.max(0, this.attackCd - sdt);
    // The window runs on the real step, never the slowed one. Slowed, `sdt` is a eighth of `dt`,
    // and an instant blow only arrived late for it; a *live blade* on that clock stays out and
    // sweeping for nearly three seconds, so slowing a fighter would make standing near it more
    // dangerous rather than less. How often it swings is still its own slowed clock (`attackCd`).
    let closed = false;
    if (this.swingLeft >= 0) {
      this.swingLeft -= dt;
      closed = this.swingLeft < 0;
    }
    // The mind: a thought a few times a second, and the body acting on the last one every frame
    // between. Both run on the world's simulated clock, so `__debug.advance` exercises the leash,
    // the memory and the give-up exactly as a real minute does.
    if (now >= this.thinkAt) {
      this.thinkAt = now + FIGHTER_TUNE.think * (1 + (Math.random() * 2 - 1) * FIGHTER_TUNE.thinkJitter);
      this.think(foes, now);
    }
    this.act(sdt, bolts, effects, hittableAt);
    // What it is fighting, for the stance it stands in and for whether its blade is held ready:
    // the brain drops it while it flees or goes home, so both go quiet with it.
    const t = this.target;
    // A shove from a blow or a blast, spent over a moment. It goes through the controller with
    // everything else, so a body knocked into a wall stops at the wall instead of through it.
    if (this.push.lengthSq() > 1e-4) {
      this.wish.addScaledVector(this.push, sdt);
      this.push.multiplyScalar(Math.max(0, 1 - sdt * 4));
    }
    this.sinceShot += dt;
    // Which carry it stands in, and for how long after the fight: one number, read by the rig, the
    // aim and whether a blade is lit.
    if (t && !t.dead) this.sinceFought = 0;
    else this.sinceFought += dt;
    const combat = this.sinceFought < STANCE_TUNE.ready;
    // Where the target is from the nose, for the carry and for the aim. One angle, written.
    const offNose = t ? wrapAngle(Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z) - this.heading) : 0;
    // Written into the kept struct rather than built: one literal here is one allocation per
    // fighter per frame, which is the rule this file is held to.
    stanceAsk.gun = this.arm === 'gun';
    stanceAsk.combat = combat;
    stanceAsk.hasTarget = !!t && !t.dead;
    stanceAsk.gap = t ? Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) : Infinity;
    stanceAsk.range = FIGHTER_TUNE.gunRange;
    stanceAsk.offNose = offNose;
    this.stance = stanceFor(stanceAsk);
    this.move(sdt, terrain);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + this.halfHeight, z: this.pos.z });
    this.group.position.copy(this.pos);
    // The drawn body also carries whatever share of the aim's turn the spine could not take, which
    // is the player's own `aimBodyTurn`. It is never given to `heading`: the heading is the brain's
    // facing, which is the direction the body walks in and the cone a shot is gated on, and a
    // visual correction has no business moving either.
    this.group.quaternion.setFromAxisAngle(UP, this.heading + this.aimTurn);
    if (rig) {
      if (!rig.overriding) this.poseRig(rig, own);
      rig.update(sdt);
      this.group.updateMatrixWorld(true);
      // After the pose and after the matrices, exactly as the player's is: the spine takes its
      // share of the correction and the barrel is then measured where the pose and the turn left it.
      this.aimPose(sdt, t);
    }
    // Where the weapon lies this frame, and what it cuts. A lightsaber's blade runs up from the
    // hilt's top; a sword's or a club's steel is the model's own longest extent out of the grip.
    // The sweep is here, after the body has been posed and the holder's matrix is this frame's, so
    // the blade never cuts from where it was standing a frame ago.
    const swinging = this.swingLeft >= 0;
    if (this.holder && this.arm !== 'gun') {
      this.holder.updateWorldMatrix(true, false);
      if (this.blade) {
        this.holder.localToWorld(this.bladeBase.set(0, this.hiltTop, 0));
        this.holder.localToWorld(this.bladeTip.set(0, this.hiltTop + this.blade.spec.length, 0));
        // Whose blade this is when it meets another, and what it weighs (src/combat/clash.ts): the
        // fighter's own living key, its swing window, and the medium style, which is what its
        // one-hand swings are. Without this the blade owns nobody, and a blade that owns nobody
        // never clashes with another that owns nobody either -- which is every other fighter.
        this.blade.owner = this.key;
        this.blade.attacking = swinging;
        this.blade.clashWeight = CLASH.weights.medium;
        // Lit while it is fighting, and for the few seconds of the combat carry after: it used to
        // snap off on the very frame its target died, which is the one place the stance changes
        // what is *seen* of a blade rather than only of a body.
        this.blade.update(dt, this.bladeBase, this.bladeTip, combat, camera ?? IDLE_CAMERA, swinging ? 1 : this.moving ? 0.3 : 0);
      } else {
        this.holder.localToWorld(this.bladeBase.set(0, 0, 0));
        this.holder.localToWorld(this.bladeTip.copy(this.reachFar));
      }
      // Swinging, the blade cuts what it has passed through; standing, it only writes down where it
      // is, so the first cut of the next swing steps from the blade and not from the last swing.
      if (swinging && hittableAt) this.sweepBlade(effects, now);
      else this.bladePath.mark(this.bladeBase, this.bladeTip, now);
    }
    // The window has just shut on a swing that was never swept at all -- no lookup was wired to
    // name what the blade touched, or the weapon had not finished loading into the hand. The blow
    // the timer used to land stands in, so a wave one line short of its wiring leaves the fight
    // exactly what it was rather than harmless. A swing that *was* swept never comes through here,
    // whether it cut anybody or missed, so nothing is ever hurt twice.
    if (closed) {
      if (!this.swingSwept) this.timerBlow(effects);
      this.swingTarget = null;
    }
  }

  /**
   * One frame of the body: the ground `act` asked for and the vertical, handed to the character
   * controller, and what it allowed written back onto `pos`.
   *
   * Three things are not the controller's.
   *
   * The **Force's hold** is a teleport and stays one: a gripped fighter is lerped to where the
   * power is holding it and the body written straight, because that is what a grip is and what
   * every power in the game already does to a creature. Nothing may stop it.
   *
   * The **ground outdoors** is the planet's own, not the controller's. The heightfield colliders
   * only exist within a few chunks of the player (`PHYSICS_RADIUS` in `world.ts`), so a fighter
   * that has wandered any distance is over nothing at all and the controller would let it fall out
   * of the world. The terrain is therefore a floor it may never go below -- and only a floor:
   * above it the controller's answer stands, which is what lets a fighter climb a ramp, a step or
   * a rock rather than being pinned to the ground under them. Inside a building there is no such
   * floor, deliberately: a dungeon's rooms go far below the terrain and a clamp to it would drag a
   * body up through the floor it is standing on.
   *
   * The **room whose collision has been dropped** is the indoor half of that same problem, and it
   * is why the branch above is not simply "no floor indoors". A building's colliders are built
   * only within a couple of hundred metres of the player; the room a body is in is model data and
   * goes on answering whatever became of them. So a fighter left in a building the player has
   * walked away from stands in a room with nothing under it at all, falls at 18 m/s², and keeps
   * falling until it drops out of the building's own box -- at which point its room goes null and
   * the terrain clamp fires in a single frame, which for a dungeon is a teleport of hundreds of
   * metres to the open surface. `cellSolid` is the guard: with no floor built, the body keeps the
   * height the last real frame gave it and is standing on its own floor again the moment the
   * colliders come back.
   *
   * And the **first frame**, before the world has stepped at all: a scene query sees nothing then,
   * so the step is taken whole rather than through a controller that would report open ground.
   */
  private move(sdt: number, terrain: Terrain): void {
    this.moved = 0;
    if (this.heldAt && this.now < this.heldUntil) {
      this.pos.lerp(this.heldAt, Math.min(1, sdt * 12));
      this.fallVy = 0;
      this.grounded = false;
      return;
    }
    this.heldAt = null;
    const f = this.footing;
    f.fallVy = this.fallVy;
    // Inside a building whose rooms have no collision this instant: nothing to stand on and
    // nothing to fall past, so the height is held rather than integrated (see above).
    const airless = !!this.cell && !this.cellSolid;
    const holdY = this.pos.y;
    // One frame of gravity, whether it is falling or standing: standing that is a few millimetres,
    // which holds it on the floor without the controller reading a step as a wall.
    const dy = airless ? 0 : fallSpeed(f, sdt);
    if (this.physics.steps > 0) {
      moveAsk.x = this.wish.x;
      moveAsk.y = this.wish.y + dy;
      moveAsk.z = this.wish.z;
      this.controller.computeColliderMovement(this.collider, moveAsk, undefined, this.cell ? INSIDE_FILTER : OUTSIDE_FILTER, staticOnly);
      // Written into a vector of ours: with nowhere to write, rapier makes one every call, which
      // is one object per fighter per frame.
      const mv = this.controller.computedMovement(moveGot);
      this.pos.x += mv.x;
      this.pos.y += mv.y;
      this.pos.z += mv.z;
      this.moved = Math.hypot(mv.x, mv.z);
      f.grounded = this.controller.computedGrounded();
    } else {
      this.pos.x += this.wish.x;
      this.pos.y += this.wish.y + dy;
      this.pos.z += this.wish.z;
      this.moved = Math.hypot(this.wish.x, this.wish.z);
      f.grounded = false;
    }
    f.y = this.pos.y;
    const lift = settleFooting(f, this.cell ? null : terrain.heightAt(this.pos.x, this.pos.z), airless ? holdY : null);
    // A floor of last resort that has to lift a body by more than its own height is not a body
    // walking down a dune: it is one that was somewhere it could not stand. Counted for the
    // readout rather than hidden, and said once, because there is nothing else on the screen that
    // tells a fall from a walk.
    if (lift > this.halfHeight * 2) {
      this.lifted++;
      this.liftedBy = lift;
      if (!warnedLift) {
        warnedLift = true;
        console.warn(`fighters: a body was ${lift.toFixed(1)} m under the ground and was put back on it; __debug.fighters() counts it as lifted.`);
      }
    }
    this.pos.y = f.y;
    this.fallVy = f.fallVy;
    this.grounded = f.grounded;
  }

  /**
   * What it is standing in this frame, in the rig's own states. This is the whole of the owner's
   * "a combat/non combat state like players have": the states are the player's own and the rule
   * that picks between them is `stanceFor`.
   *
   * With a gun: the relaxed carry with the weapon down, the combat carry once there is something
   * to fight, and the aimed pose held on the upper body once that something is in front of it and
   * within reach of the gun -- each with its own idle, walk and run, as the player's are. Before
   * this a gun-armed fighter stood in one pose for ever and ran with the plain run, holding its
   * blaster as if it were a handbag.
   *
   * With a blade: the plain walk and run out of a fight, Jedi Academy's saber walk and run in one,
   * and the style's stance standing -- again the player's, who moves that way with a blade lit.
   */
  private poseRig(rig: CharacterRig, own: number): void {
    const moving = this.moving;
    const walking = this.pace === 'walk';
    const speed = (walking ? FIGHTER_TUNE.walk : FIGHTER_TUNE.run) * own;
    if (this.arm === 'gun') {
      const carry = this.stance === 'aim' ? 'gunAim' : this.stance === 'ready' ? 'gunReady' : 'gun';
      const state = `${carry}${moving ? (walking ? 'Walk' : 'Run') : 'Idle'}` as RigState;
      // The pose that rides the upper body over those legs: the aimed one, or the hip-fire one.
      // Relaxed there is none, so the carry's own clip has the whole body.
      const pose = this.gunPose;
      const upper = this.stance === 'aim' ? (pose?.aim ?? null) : this.stance === 'ready' ? (pose?.ready ?? null) : null;
      rig.setState(state, moving ? speed : 0, upper);
      return;
    }
    if (moving) {
      // A lit blade moves the way the player's does with one out; a club or a sword is carried at
      // the plain walk and run, which is what the game's own clips give it.
      const saber = this.arm === 'saber' && this.stance !== 'relaxed';
      rig.setState(saber ? (walking ? 'walkSaber' : 'runSaber') : walking ? 'walk' : 'run', speed);
      return;
    }
    if (this.stance !== 'relaxed' && rig.hasState('stance')) rig.setState('stance');
    else rig.setState('idle');
  }

  /**
   * The aim, once the pose is on and the matrices are this frame's. The barrel is measured where
   * that pose and last frame's turn left it, the difference to where the next bolt is going is
   * folded in, the spine takes what it can of the yaw and the drawn body eases onto the rest --
   * which is `Player.correctAim` and `Player.aimBodyTurn`, on the player's own numbers, with the
   * crosshair replaced by the point `shoot` aims at.
   *
   * Only a gun. A blade is swung by clips that pose the whole arm and a twisted spine would move
   * where the blade cuts, which is a decision and not a look.
   *
   * Three modes, not two, and the difference matters more than it looks: with nothing to aim at
   * the correction **eases** back to nothing as the player's does with the gun down, but in the
   * third of a second after a shot, and while a blow has it staggered, it is **held** exactly
   * where it stands -- the player's own early return out of the recoil. Easing there instead
   * would throw away 95 per cent of a settled aim between one shot and the next and spend most of
   * the gun's cooldown winning it back, so the barrel would swing off the target and on again with
   * every shot for as long as the fight lasted.
   */
  private aimPose(dt: number, t: Living | null): void {
    if (this.arm !== 'gun') return;
    const rig = this.rig;
    if (!rig) return;
    const holder = this.holder;
    aimAsk.aiming = !!t && !t.dead && !!holder && this.stance !== 'relaxed';
    aimAsk.sinceShot = this.sinceShot;
    aimAsk.stunned = this.stunned > 0;
    const mode = aimMode(aimAsk);
    if (mode === 'chase' && holder && t) {
      // Where the shot is going: the same point `shoot` aims at, from the same muzzle.
      this.muzzle(tmp2);
      tmp.copy(t.pos);
      tmp.y += t.halfHeight * 0.9;
      tmp.sub(tmp2);
      const len = tmp.length();
      // And where the barrel is pointing: the grip to the far end of the model's longest axis.
      holder.updateWorldMatrix(true, false);
      holder.getWorldPosition(tmp3);
      holder.localToWorld(tmp2.copy(this.barrelFar));
      tmp2.sub(tmp3);
      const barrel = tmp2.length();
      if (len > 1e-4 && barrel > 1e-6) {
        tmp.divideScalar(len);
        tmp2.divideScalar(barrel);
        stepAimFix(this.aimFix, Math.atan2(tmp.x, tmp.z), Math.asin(Math.max(-1, Math.min(1, tmp.y))), Math.atan2(tmp2.x, tmp2.z), Math.asin(Math.max(-1, Math.min(1, tmp2.y))), dt, 'chase');
      }
      // A barrel of no length or a target on top of the muzzle leaves the correction alone, which
      // is the player's own `if (barrelB.lengthSq() < 1e-6) return;` and is a hold, not an ease.
    } else if (mode === 'ease') stepAimFix(this.aimFix, 0, 0, 0, 0, dt, 'ease');
    // 'hold' does nothing at all, which is the whole of it.
    rig.twistTorso(spineShare(this.aimFix.yaw), this.aimFix.pitch);
    this.aimTurn = easeAngle(this.aimTurn, bodyShare(this.aimFix.yaw), STANCE_TUNE.bodyTurn, dt);
  }

  /**
   * The blow the timer landed before the blade was swept: whatever it was aimed at, if it is still
   * alive and still within reach, takes the same damage, the same shove, the same sound and the
   * same burst it always did. It runs only where a swing could sweep nothing (`__debug.blades()`
   * counts it as `fellBack`), never beside the sweep, so nothing is ever hurt twice.
   */
  private timerBlow(effects: Effects | null): void {
    const t = this.swingTarget;
    if (!t || t.dead) return;
    tmp.copy(t.pos).sub(this.pos);
    if (tmp.length() >= BLADE_SWING.timerReach) return;
    const saber = this.arm === 'saber';
    t.damage(saber ? BLADE_SWING.fighterSaber : BLADE_SWING.fighterMelee, this.pos, BLADE_SWING.fighterPush, this);
    tmp2.copy(t.pos).y += t.halfHeight;
    if (saber) combatSounds.saberContact('body', tmp2.x, tmp2.y, tmp2.z);
    else combatSounds.melee(this.weapon, true, tmp2.x, tmp2.y, tmp2.z);
    effects?.burst(tmp2, saber ? this.color.getHex() : BLADE_SWING.meleeSpark, 1, 0.2);
    noteTimerBlow();
  }

  /**
   * One frame of a swing: the blade cuts the ground it has covered since the last frame, through
   * the same swept path the player's own blade takes, and whatever it passes through is hurt once
   * however many of the path's steps touched it. **One sound a swing**, not one a frame: a swing
   * that catches three bodies over three of its frames is one blow landing, exactly as the timer
   * it replaced was, and a brawl of several fighters would otherwise be a good deal noisier than
   * it was before. The burst and the borrowed flash are the sweep's own, per body.
   */
  private sweepBlade(effects: Effects | null, now: number): void {
    const strike = this.strike;
    const saber = this.arm === 'saber';
    strike.effects = effects;
    strike.now = now;
    strike.damage = saber ? BLADE_SWING.fighterSaber : BLADE_SWING.fighterMelee;
    strike.color = saber ? this.color.getHex() : BLADE_SWING.meleeSpark;
    this.swingSwept = true;
    // The player's readout is one shared record and this blade is swept at a different simulated
    // second of the same drawn frame, so it is borrowed rather than written into: see
    // `borrowSwingFigures`. The `finally` is what keeps a throw inside the query from leaving the
    // player's own figures holding a fighter's swing.
    let hits = 0;
    borrowSwingFigures(now);
    try {
      hits = this.bladePath.sweep(strike, this.bladeBase, this.bladeTip, this.hitThisSwing);
    } finally {
      returnSwingFigures(now);
    }
    if (hits <= 0 || this.swingSounded) return;
    this.swingSounded = true;
    tmp2.copy(this.bladeBase).lerp(this.bladeTip, 0.5);
    if (saber) combatSounds.saberContact('body', tmp2.x, tmp2.y, tmp2.z);
    else combatSounds.melee(this.weapon, true, tmp2.x, tmp2.y, tmp2.z);
  }

  /** The blade renderer when the weapon is a lightsaber: the light it throws is read from it. */
  get saber(): SaberBlade | null {
    return this.blade;
  }

  /** The middle of the lit blade, when there is one out this frame (igniting, lit or retracting). */
  glowAt(out: THREE.Vector3): boolean {
    const b = this.blade;
    if (this.dead || !b?.glowing) return false;
    out.copy(b.drawnBase).lerp(b.drawnTip, 0.5);
    return true;
  }

  /** The blade's white core while it is drawn, for the depth of field's glow depth; returns the new count. */
  glowCore(out: THREE.Object3D[], n: number): number {
    return this.blade ? this.blade.glowCore(out, n) : n;
  }

  dispose(scene: THREE.Scene): void {
    this.ragdoll?.dispose();
    this.ragdoll = null;
    // Anything still holding this one reads it as dead from here on.
    if (!this.dead) this.byCollider?.delete(this.collider.handle);
    this.memory.clear();
    this.target = null;
    this.targetKey = null;
    this.decision = null;
    if (!this.dead) this.physics.world.removeCollider(this.collider, false);
    this.dead = true;
    this.physics.world.removeRigidBody(this.body);
    // The controller is the engine's, not the body's: removing the body leaves it behind, and a
    // world that has stood a thousand fighters would keep a thousand of them.
    this.physics.world.removeCharacterController(this.controller);
    scene.remove(this.group);
    if (this.blade) {
      scene.remove(this.blade.group);
      this.blade.dispose();
    }
  }
}

export class NpcManager {
  readonly npcs: Npc[] = [];
  readonly byCollider = new Map<number, Npc>();
  /** Bumped on every spawn and every removal, so the world's target list knows when to rebuild. */
  version = 0;
  private deps: NpcDeps = { weapons: null, effects: null, species: [] };
  private disposed = false;
  /**
   * How many long walks are running. A frame with none scans nothing at all: the player's place has
   * to be picked out of the world's list of the living to measure against, and that is a loop over
   * every body in the world which nobody should pay for when no walk is being watched.
   */
  private errands = 0;
  /** The last walk that ended, kept so its account can still be read after the body has wandered off. */
  private lastErrand: Errand | null = null;
  /** The world's simulated clock at the last step, so an order given from the console has a time. */
  private lastNow = 0;
  /**
   * What a walk reads of the world each step: one object, written into, with one closure made here
   * and never again. `waterOver` is asked at most once a second and only while a walk is running.
   */
  private readonly errandWorld: ErrandWorld = {
    playerX: 0,
    playerZ: 0,
    playerKnown: false,
    syncGrids: 0,
    waterOver: (x: number, y: number, z: number): number => this.terrain.waterHeightAt(x, z) - y,
  };

  constructor(private readonly scene: THREE.Scene, private readonly physics: Physics, private readonly terrain: Terrain, private readonly baseUrl: string) {}

  /** What the fighters need from the game: the rack, the effects, the species there are. */
  attach(deps: Partial<NpcDeps>): void {
    this.deps = { ...this.deps, ...deps };
  }

  /**
   * Stand one at a point on the ground, of a random species; it dresses and arms itself as its rig
   * loads. `at.y` and `at.inside` put it on a building's floor, in the room the point is in.
   */
  spawnAt(x: number, z: number, wanted?: string, at: { y?: number; inside?: boolean } = {}): Npc {
    const species = this.deps.species.length ? this.deps.species : SPECIES_FALLBACK;
    const id = (wanted && species.find((s) => s.includes(wanted))) ?? species[Math.floor(Math.random() * species.length)];
    const npc = new Npc(id, this.physics, x, at.y ?? this.terrain.heightAt(x, z), z);
    npc.cellFrom.copy(npc.pos);
    if (at.inside) npc.cell = this.deps.cellAt?.(npc.pos) ?? null;
    npc.cellSolid = this.deps.cellSolid?.(npc.cell) ?? true;
    this.scene.add(npc.group);
    this.npcs.push(npc);
    this.byCollider.set(npc.collider.handle, npc);
    npc.byCollider = this.byCollider;
    this.version++;
    void npc.dress(this.baseUrl, this.deps).catch((err) => console.warn(`fighter ${id}: no rig`, err));
    return npc;
  }

  /**
   * Whether the fighters' controllers push the dynamic bodies they walk into, which is the
   * player's own `__debug.pushBodies` and is off for the same reason. It reaches the fighters
   * already out as well as the ones stood after, or the knob that exists to re-check the engine's
   * trimesh panic would quietly have covered one body in the world.
   */
  setPushBodies(on: boolean): void {
    fighterPush(on);
    for (const n of this.npcs) applyBody(n.controller);
  }

  /**
   * Send a fighter to a point and hold it to it until it arrives, stops making ground or the clock
   * runs out: `src/world/errand.ts` is the order and the account of it. A body already under orders
   * has the old one closed off first, so one fighter is never walking to two places.
   *
   * It is a **fighter** and never a creature, and the reason is the account rather than the walk: a
   * creature going home heals a third of its health a second, which would make the walk unkillable
   * and hide the one failure this report most needs to be able to name, and a creature can be handed
   * to another browser half way, which drops the brain's state with the hand-over.
   */
  send(npc: Npc, x: number, z: number, place: string | null = null, player?: { x: number; z: number }): Errand {
    if (npc.errand && !npc.errand.done) {
      npc.errand.finish('stopped', this.lastNow);
      this.errands--;
      this.lastErrand = npc.errand;
    }
    // The walk's own first row is taken by `begin`, so the world it is measured against is filled
    // here rather than waiting for the next frame: the caller has the player, and without it that
    // one row would read "no player" on every walk ever given.
    const w = this.errandWorld;
    w.syncGrids = this.terrain.swg?.syncGenerations ?? 0;
    if (player) {
      w.playerX = player.x;
      w.playerZ = player.z;
      w.playerKnown = true;
    }
    const e = new Errand(npc, { x, z, place }, this.lastNow, FIGHTER_TUNE.run);
    e.begin(w);
    npc.errand = e;
    this.errands++;
    return e;
  }

  /**
   * Close off a body's order because the body itself is going. A walk whose body has been disposed
   * can never step again, so one left running would hold `errands` above zero and keep the world's
   * fill alive in every frame for the rest of the session -- and, worse, would print a verdict on a
   * walk that stopped for a reason nothing in the account names. A walk that has already ended (it
   * arrived, or it died and said so on its own step) is left exactly as it is.
   */
  private closeErrand(npc: Npc): void {
    const e = npc.errand;
    if (!e || e.done) return;
    e.finish('gone', this.lastNow);
    this.lastErrand = e;
    this.errands--;
  }

  /** Every walk this world has seen, the ones still running first; the newest finished one last. */
  errandList(): Errand[] {
    const out: Errand[] = [];
    for (const n of this.npcs) if (n.errand) out.push(n.errand);
    if (this.lastErrand && !out.includes(this.lastErrand)) out.push(this.lastErrand);
    return out;
  }

  /** Call every running order off. Each body's home is left where it stands, so none of them runs back. */
  stopErrands(): number {
    let n = 0;
    for (const npc of this.npcs) {
      if (!npc.errand || npc.errand.done) continue;
      npc.errand.finish('stopped', this.lastNow);
      this.lastErrand = npc.errand;
      this.errands--;
      n++;
    }
    return n;
  }

  removeAll(): number {
    const n = this.npcs.length;
    for (const npc of this.npcs) {
      this.closeErrand(npc);
      npc.dispose(this.scene);
    }
    this.npcs.length = 0;
    this.byCollider.clear();
    this.version++;
    return n;
  }

  /**
   * The fighters' lit blades nearest `eye` within `maxDistance`, nearest first, each in its fighter's
   * colour: where they want pooled light this frame. Fills `out` (kept entries, reordered in place)
   * and returns how many.
   */
  lightSpots(out: FighterGlow[], eye: THREE.Vector3, maxDistance: number): number {
    const max2 = maxDistance * maxDistance;
    let n = 0;
    for (const npc of this.npcs) {
      if (!npc.glowAt(spot)) continue;
      const d2 = spot.distanceToSquared(eye);
      if (d2 > max2) continue;
      n = keepNearestGlow(out, n, spot, npc.color.getHex(), d2);
    }
    return n;
  }

  /** Every fighter's drawn blade core, for the depth of field's glow depth: fills `out` from `n`, returns the new count. */
  glowCores(out: THREE.Object3D[], n: number): number {
    for (const npc of this.npcs) n = npc.glowCore(out, n);
    return n;
  }

  /**
   * `targets` is the world's one list of living things (the player, the creatures, the fighters).
   * `playerPos` is the player in the world's own frame and is read by nothing but a fighter under a
   * long walk; with none given such a walk records that it had nobody to measure against, which it
   * reads as the worst case rather than as a pass.
   */
  update(dt: number, targets: readonly Living[], bolts: Bolts, camera: THREE.Camera | null, now: number, playerPos?: THREE.Vector3): void {
    if (this.disposed) return;
    this.expose();
    noteBladeLookup(!!this.deps.hittableAt);
    this.lastNow = now;
    const follow = this.deps.followCell;
    const solid = this.deps.cellSolid;
    // The world a long walk is measured against, filled once for every walk running and not at all
    // when none is.
    const walking = this.errands > 0;
    if (walking) {
      const w = this.errandWorld;
      w.playerKnown = !!playerPos;
      if (playerPos) {
        w.playerX = playerPos.x;
        w.playerZ = playerPos.z;
      }
      w.syncGrids = this.terrain.swg?.syncGenerations ?? 0;
    }
    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const npc = this.npcs[i];
      // Its room, followed through the portals four times a second, and sooner when it has gone a couple of metres.
      if (follow && !npc.dead && (now - npc.followAt >= FOLLOW_EVERY || npc.cellFrom.distanceToSquared(npc.pos) > FOLLOW_STEP * FOLLOW_STEP)) {
        npc.followAt = now;
        npc.cell = follow(npc.cell, npc.cellFrom, npc.pos);
        npc.cellFrom.copy(npc.pos);
      }
      // Whether that room still has collision under it, asked every frame and not on the follow's
      // own quarter-second: it is two lookups, and a quarter of a second of falling through a
      // floor that has gone is half a metre nobody asked for.
      if (solid && !npc.dead) npc.cellSolid = solid(npc.cell);
      npc.update(dt, this.terrain, targets, bolts, this.deps.effects, camera, now, this.deps.hittableAt ?? null);
      // The walk, after the body has taken its step: what it records is what really happened this
      // frame, never what was asked for. A walk that ends here takes the count down with it.
      const e = npc.errand;
      if (walking && e && !e.done) {
        e.step(now, this.errandWorld);
        if (e.done) {
          this.errands--;
          this.lastErrand = e;
        }
      }
      if (npc.dead && npc.deadTimer <= 0) {
        this.closeErrand(npc);
        // The collider handle went out of the lookup in `die`, at the moment the collider itself
        // went. Deleting it again here would unregister whichever live body rapier has since
        // given that recycled handle to, and that body would stop taking damage.
        npc.dispose(this.scene);
        this.npcs.splice(i, 1);
        this.version++;
      }
    }
  }

  /** Which `__debug` object the knob below was hung on, so it is hung once and not once a frame. */
  private exposedOn: unknown = null;

  /**
   * `__debug.blades()` reports and `__debug.blades({ window: 0.2 })` retunes, hung here rather than
   * in the game's own console block so that nothing outside these two files has to know that
   * everybody else's blades have a tuning object at all (`clash.ts` and `nebulae.ts` hang theirs
   * the same way). It is what says whether the wiring is in: `lookup` reads `none` while nothing
   * has been given to name a collider with, which is the one way this wave can quietly do nothing.
   */
  private expose(): void {
    if (typeof window === 'undefined') return;
    const dbg = (window as unknown as { __debug?: Record<string, unknown> }).__debug;
    if (!dbg || dbg === this.exposedOn) return;
    this.exposedOn = dbg;
    dbg.blades = (opts?: Partial<BladeSwingTune>) => bladeSwingReport(opts);
    dbg.fighters = (opts?: FighterKnob) => this.report(opts);
  }

  /**
   * `__debug.fighters()` says what every fighter out is thinking and what it is thinking it with;
   * `__debug.fighters({ run: 3 })` retunes the body's own numbers live. The **mind's** numbers are
   * the creatures' and are not this object's: how far one sees, how long it remembers, how far it
   * chases before it goes home and when it gives a target up all move through
   * `__debug.mobileTune({ brain: { ... } })`, and are printed here so that both are in one place.
   */
  private report(opts?: FighterKnob): Record<string, unknown> {
    if (opts) {
      const { stance, body, ...own } = opts;
      Object.assign(FIGHTER_TUNE, own);
      if (stance) tuneStance(stance);
      if (body) {
        tuneFighterBody(body);
        // The controller's numbers go on to every fighter already out; the capsule's are read when
        // a body is made and only reach the ones stood after.
        for (const n of this.npcs) applyBody(n.controller);
      }
    }
    return { tune: { ...FIGHTER_TUNE }, stance: { ...STANCE_TUNE }, body: { ...FIGHTER_BODY }, brain: { ...BRAIN_TUNE }, out: this.npcs.length, fighters: this.npcs.map((n) => n.status()) };
  }

  dispose(): void {
    this.disposed = true;
    this.removeAll();
  }
}
