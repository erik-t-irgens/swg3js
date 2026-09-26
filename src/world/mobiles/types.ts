// The shapes the game reads from the `mobiles` pack: the catalogue (every creature, droid and
// person the game shipped, one entry per template) and each animation pack's JSON. Type-only, so
// the pure modules and the node tests can import it without pulling anything in.
//
// Only the fields listed are read; anything else in the files is ignored, so the converter may add
// more without touching the game. Paths are relative to `assets-private/`.
//
// Bounds are read as extents with `Math.abs(max - min)` and centres as `(min + max) / 2`: a pack
// converted before the box-corner fix carries its min and max the other way round.

export type MobileKind = 'creature' | 'droid' | 'npc' | 'dressed' | 'special';
export type SizeClass = 'tiny' | 'small' | 'medium' | 'large' | 'huge';
export type Vec3 = [number, number, number];
export type MobileAggression = 'aggressive' | 'defensive' | 'skittish' | 'passive';

/**
 * What a mobile is doing, as the brain and the body both read it.
 *
 * `cover` is the game's own word rather than one of ours: `Cover` is state 0 in the client's own
 * `state.iff`, beside Aiming and Alert, with 139 commands in `command_table.iff` gated on it. The
 * server that would have computed one never shipped, so what a body in it *does* is entirely ours
 * (`src/world/cover.ts`), but the word is the game's and it is a state and not a field for that
 * reason. Only a flagged fighter ever reaches it: no creature sets `BrainSelf.seeksCover`.
 *
 * This list is written out in four places that must agree -- here, `STATE_WORDS` in `mobile.ts`,
 * `ERRAND_STATES` in `../errand.ts` and `STATES` in `server/npcWire.mjs` -- and a word added here
 * and nowhere else is a word the wire quietly turns back into `idle`.
 */
export type MobileState = 'loading' | 'idle' | 'wander' | 'alert' | 'chase' | 'attack' | 'cover' | 'flee' | 'return' | 'knockdown' | 'dying' | 'dead';

export interface MobileCatalogueFile {
  /** 1; anything else is reported and refused. */
  format: number;
  counts: Record<string, number>;
  appearances: Record<string, MobileAppearance>;
  packs: Record<string, PackSummary>;
  wearables: Record<string, { dir: string; items: number; ready: boolean }>;
  wardrobes: Record<string, { references: number; present: boolean }>;
  entries: MobileEntry[];
  /** Models the archives could not give (a permanent gap, not an error): treated as missing. */
  failed?: { what: string; id: string; why: string }[];
}

export interface MobileEntry {
  id: string;
  kind: MobileKind;
  folder: string;
  group: string;
  name: string;
  subtitle: string | null;
  description?: string;
  /** hologram, pet, vendor, tutorial, static, flyer, swims, rideable. */
  flags: string[];
  gender: 'm' | 'f' | null;
  /** Key into `appearances`; null for a dressed entry, which is a player species wearing clothes. */
  appearance: string | null;
  /** A dressed entry's body: `characters/<species>`. */
  species: string | null;
  /** Key into `packs`. */
  pack: string | null;
  /** A colour variant of a plain model: a key into the appearance's `variants`. */
  variant: string | null;
  custom: Record<string, number>;
  morphs: Record<string, number>;
  outfit: { part: string; item: string; wardrobe: string; values: Record<string, number> }[];
  size: { collisionRadius: number; collisionLength: number; scale: [number, number]; cameraHeight: number; stepHeight: number; swimHeight: number };
  /** Metres a second and degrees a second, from the template. */
  move: { run: number; walk: number; turnRun: number; turnWalk: number; accel: [number, number] };
  stats: {
    source: string;
    sizeClass: SizeClass;
    level: number | null;
    hp: number;
    damage: number;
    reach: number;
    aggression: MobileAggression;
    ranged: { range: number; additive: boolean } | null;
    attackCooldown: number;
    tags: string[];
    /**
     * What the emulator's own row said, where the catalogue was built with a checkout. `pvp` is its
     * status bitmask and is the one thing in here that says whether a body may be attacked at all:
     * a vendor, a trainer and a quest-giver carry none of its bits.
     */
    core3?: { pvp?: string[]; faction?: string; socialGroup?: string; weapons?: string[] } | null;
  };
  ready: boolean;
  notReady?: string;
  outfitReady: boolean;
  outfitNotReady?: string;
}

export interface MobileAppearance {
  id: string;
  form: 'glb' | 'parts';
  /** The model GLB (form `glb`) or the parts manifest (form `parts`). */
  file: string;
  pack: string | null;
  joints: number;
  bounds: { min: Vec3; max: Vec3 };
  sizeClass: SizeClass;
  /** The colour variants that differ from the base, by the key an entry names. */
  variants?: Record<string, { file: string | null; same: boolean }>;
  riderPose: string | null;
  /** Bytes the converter wrote for it: what a first load will fetch. */
  bytes?: number;
  ready: boolean;
}

export interface PackSummary {
  id: string;
  file: string;
  json: string;
  hierarchy: string;
  set: string;
  clips: number;
  /** Bytes of the pack's GLB on disk. */
  bytes?: number;
  ready: boolean;
}

export interface PackClipInfo {
  name: string;
  loop: boolean;
  additive?: boolean;
  frames: number;
  fps: number;
  duration: number;
  /** Ground speed the clip was animated at (metres a second, at scale 1); 0 for a clip that stands. */
  speed: number;
  /** The logical names it serves. */
  names: string[];
  /** The joints an additive clip moves. */
  joints?: string[];
}

export interface AnimPack {
  id: string;
  file: string;
  hierarchy: string;
  set: 'full' | 'curated';
  joints: number;
  clips: PackClipInfo[];
  /** Logical name to its clips, slowest first. */
  logical: Record<string, string[]>;
  roles: Roles;
  /** Role to the logical name it came from. */
  roleSources?: Record<string, string>;
  /** Overlays by selector value, "gender:f". */
  variants: Record<string, Partial<Roles>>;
  /**
   * One row per weapon a body can hold, resolved in the converter (`ALLB_CARRIES` in
   * `tools/swg/mobiles.mjs`). Absent on every pack converted before it existed, and on every
   * hierarchy but the humanoid one, in which case the runtime falls back on the clip-name matching
   * it has always done (`armedRoles`).
   */
  carries?: Partial<Record<CarryWeapon, CarryRow>>;
  missing?: string[];
}

/**
 * Which weapon a carry row is for. `unarmed` is the row a body with empty hands stands in, which is
 * the pack's own combat stance and its punches: the row names what has always happened rather than
 * adding anything to it.
 */
export type CarryWeapon = 'pistol' | 'rifle' | 'sword' | 'polearm' | 'unarmed';

/**
 * How one weapon is carried: the stances, the gaits that hold it, and what it fires or swings.
 *
 * It exists because the alternative was the runtime reading clip **names**: `armedRoles` rewrote
 * six roles for a rifle carrier with regular expressions over the pack's clip list, did nothing at
 * all for a pistol, and could not express a blade's ready stance in any form. The knowledge of
 * which logical name is which weapon's stance belongs where the animation table is read, so it is
 * resolved there once per pack and the runtime picks a row.
 *
 * Every field may be null or empty: a row is written for a weapon the table says anything at all
 * about, and what it is silent on simply leaves the roles where they were.
 */
export interface CarryRow {
  /** The carry with the weapon down or shouldered: what it stands in out of a fight. */
  relaxed: string | null;
  /** The weapon-up carry: what it holds between blows and shots. */
  ready: string | null;
  /** The aimed loop a blaster settles into with something in front of it; null for a blade. */
  aimed: string | null;
  /** Walking and running with the weapon up, at the clips' own ground speeds, slowest first. */
  walk: string | null;
  run: string | null;
  gaits: Gait[];
  /**
   * Whole-body shots, in the table's own order; empty where the table has none. Only the first
   * carries any meaning -- it is the one `ranged` becomes, which is what a pack with a single shot
   * plays and what a shot the bake left out falls back to. The rest are drawn from evenly.
   */
  fires: string[];
  /** The one-frame additive recoil, which is all a pack with no whole-body shot has. */
  recoil: string | null;
  /**
   * Melee swings; empty for a blaster row. The order is read: they become `attacks`, whose first is
   * the light blow (seven times in ten), whose second is the heavy one and whose rest are the
   * specials one time in ten.
   */
  swings: string[];
  /** The way into the carry and the way out of it. */
  toCombat: string | null;
  fromCombat: string | null;
}

export interface Gait {
  clip: string;
  speed: number;
}

export interface Roles {
  idle: string | null;
  walk: string | null;
  run: string | null;
  gaits: Gait[];
  idleCombat: string | null;
  walkCombat: string | null;
  runCombat: string | null;
  gaitsCombat: Gait[];
  swimIdle: string | null;
  swim: string | null;
  gaitsSwim: Gait[];
  hoverIdle: string | null;
  hover: string | null;
  gaitsHover: Gait[];
  toCombat: string | null;
  fromCombat: string | null;
  turnLeft: string | null;
  turnRight: string | null;
  attacks: string[];
  hoverAttacks: string[];
  ranged: string | null;
  rangedAdditive: boolean;
  rangedStance: string | null;
  /**
   * The aimed loop, held while the body really has something in front of its gun. Optional: it is
   * written only from a carry row, so a pack converted before the rows existed has none and the
   * body stands in `rangedStance` exactly as it always did.
   */
  rangedAimed?: string | null;
  /**
   * Every whole-body shot the carry has, drawn from evenly so a gunner does not fire the same one
   * each time. Optional for the same reason as `rangedAimed`; `ranged` is the first of them where
   * there are any, which makes the first the default and the order otherwise meaningless.
   */
  rangedShots?: string[];
  hitLight: string | null;
  hitMedium: string | null;
  hitHeavy: string | null;
  hitWhileDown: string | null;
  down: string | null;
  downLoop: string | null;
  getUp: string | null;
  knockdown: string | null;
  knockdownLoop: string | null;
  knockdownGetUp: string | null;
  swimDown: string | null;
  swimDownLoop: string | null;
  hoverDown: string | null;
  emotes: Record<string, string>;
  /** The bind-pose clip the additive conversion takes as its reference. */
  bind: string | null;
}
