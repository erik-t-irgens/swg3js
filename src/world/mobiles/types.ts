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

/** What a mobile is doing, as the brain and the body both read it. */
export type MobileState = 'loading' | 'idle' | 'wander' | 'alert' | 'chase' | 'attack' | 'flee' | 'return' | 'knockdown' | 'dying' | 'dead';

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
  missing?: string[];
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
