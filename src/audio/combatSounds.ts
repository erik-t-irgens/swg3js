/**
 * What the guns sound like: the shot each one makes, what its bolt strikes, a bolt going past the
 * ear, the blows of a brawl, the grenades and the blasts.
 *
 * Everything here is the game's own, joined up in three steps. A gun names a weapon effect family
 * and an index (`weaponEffect`, `weaponEffectIndex`), which is a row of `datatables/weapon/weapon.iff`
 * naming a client effect for the shot, one for each surface it may hit, and one for each surface it
 * may miss; the converter turns those into the weapons pack's `fx.sounds`. Beside them
 * `datatables/weapon/combat_effects_ranged.iff` names a muzzle sound and a hit sound per gun
 * template (271 rows, 129 of them with a hit), with four rows for the plain kinds, and
 * `combat_effects_melee.iff` does the same for the blades and bare hands. The per-gun table wins,
 * because it is the one the game keyed on the weapon itself.
 *
 * The rules of the house this keeps:
 *  - **Nothing is allocated per shot.** A gun's set is built once and kept against the weapon's own
 *    record; firing hands over that set and four numbers.
 *  - **One path.** Every bolt in the game carries its set, and the shot sounds inside `Bolts.fire`,
 *    so a caller that forgets is silent rather than wrong, and nothing has two ways to be heard.
 *  - **Nothing can be heard from a driven tab**, so every event is counted and the last few are kept
 *    with what decided them (`__debug.gunSounds()`).
 */
import type { SoundSpace } from './distance.ts';
import type { LoopHost } from './emitters.ts';
import { surfaceWord, type SurfaceSource } from './footsteps.ts';

/**
 * What the world can say about a collider, over and above what it can say about a point. A foot
 * lands on whatever a short ray down from it finds; a bolt is told by the ray it was stopped by
 * exactly which collider it struck, and a mark on a wall is metres above anything a ray down from
 * it could name. Optional, because the world may not have the map yet.
 */
export interface ColliderSurfaces {
  templateOfCollider?(handle: number): string | null;
}

/** The five surfaces the weapon table has a hit for, and the three ways a shot comes to nothing. */
export type HitSurface = 'creature' | 'metal' | 'stone' | 'wood' | 'other';
export type MissKind = 'water' | 'terrain' | 'nothing';

/**
 * One gun's sounds, built once and carried by every bolt it fires. Null anywhere means "the game's
 * data named nothing here", and the generic set below stands in.
 */
export interface GunSound {
  /** What it was built from, for the report: the weapon's id, or the projectile row's index. */
  key: string;
  fire: string | null;
  hit: Record<HitSurface, string | null>;
  miss: Record<MissKind, string | null>;
  ricochet: string | null;
  /** A ship's gun: its bolt whines past the ear rather than cracking past it. */
  ship: boolean;
}

/** A row of `combat_effects_ranged.iff` as the converter writes it into `sounds/sources.json`. */
export interface RangedRow {
  weapon: string;
  muzzle: string | null;
  hit: string | null;
  nothing: string | null;
  ricochet: string | null;
}

/** A row of `combat_effects_melee.iff`, the same way. */
export interface MeleeRow {
  weapon: string;
  attack: string | null;
  attackPitch: number;
  hit: string | null;
  hitPitch: number;
}

/** The two tables this reads out of `sounds/sources.json`; the rest of that file is other people's. */
export interface CombatTables {
  ranged?: RangedRow[];
  melee?: MeleeRow[];
  surfaces?: Record<string, { type?: string }>;
}

/** The projectile table beside the ships (`ships/projectiles.json`), which is where a ship gun's sounds are. */
interface ProjectileRow {
  index: number;
  effect?: string;
  sounds?: { fire?: string | null; hitMetal?: string | null; hitOther?: string | null };
}

/**
 * What the weapons pack writes under a gun's `fx.sounds`. Two shapes are accepted: the one the pack
 * held before this work (one fire sound and one hit sound, both strings) and the one the weapons
 * command writes now (every sound of each effect, and the miss set). A pack converted either way
 * plays; an old one simply has no misses.
 */
type SoundList = string | string[] | null | undefined;
interface GunFxSounds {
  fire?: SoundList;
  hit?: SoundList | Partial<Record<HitSurface, SoundList>>;
  miss?: Partial<Record<MissKind | 'creature' | 'metal' | 'stone' | 'wood' | 'other', SoundList>>;
  ricochet?: SoundList;
}

/** A weapon as this needs to see it: the rack's own records, and the profiles the fighters carry. */
export interface GunLike {
  id?: string;
  template?: string;
  class?: string;
  fx?: unknown;
}

export interface CombatTune {
  /** INVENTED: metres within which a bolt passing the ear whines. The game has the sound and never says when. */
  flyby: number;
  /** INVENTED: seconds between two flybys, so a burst is one whine and not five. */
  flybyGap: number;
  /** INVENTED: seconds within which one gun's shot is not started again, so a volley of pellets or
   * four ship guns firing on one frame is one shot and not four. */
  volley: number;
  /** INVENTED: the blast radii (metres) at which an explosion stops being small and starts being large.
   * Chosen so the game's own grenade radii (5 to 8 m) fall on both sides of both steps rather than
   * all landing in one bucket and sounding alike. */
  blast: [number, number];
  /** INVENTED: seconds a held trigger's loop takes to fade when the trigger is let go. */
  heldFade: number;
  /** INVENTED: seconds before a held loop the mixer refused (no voice free) is asked for again, so a
   * trigger held down does not ask sixty times a second. */
  heldRetry: number;
  /** INVENTED: metres a second a thrown charge must lose in one step for it to have struck something.
   * A free flight loses about a sixth of that to gravity in a step, so the top of a lobbed throw is
   * not mistaken for the ground. */
  grenadeKnock: number;
}

/**
 * Ours, every one: the game's files say which sound, never how near or how often. The ray that asks
 * what a bolt struck is not here: it is the feet's own (`FOOT_TUNE.probe` and `reach`), because it
 * is the same ray asking the same question, and two numbers for one ray would drift apart.
 */
export const COMBAT_TUNE: CombatTune = { flyby: 3, flybyGap: 0.12, volley: 0.04, blast: [5.5, 7], heldFade: 0.12, heldRetry: 0.25, grenadeKnock: 2.5 };

/**
 * INVENTED where it is a choice, the game's sounds throughout: what a gun with nothing of its own
 * sounds like. It is the light blaster's set, which the weapon table gives most of the game's guns
 * anyway, so a gun the tables miss sounds like its neighbours rather than falling silent.
 */
export const GENERIC_GUN: GunSound = {
  key: 'generic',
  fire: 'sound/wep_fire_blaster.snd',
  hit: { creature: 'sound/wep_lt_blaster_hit_flesh.snd', metal: 'sound/wep_lt_blaster_hit_metal.snd', stone: 'sound/wep_lt_blaster_hit_stone.snd', wood: 'sound/wep_lt_blaster_hit_wood.snd', other: 'sound/wep_lt_blaster_hit_terrain.snd' },
  miss: { water: 'sound/wep_lt_blaster_hit_water.snd', terrain: 'sound/wep_lt_blaster_hit_terrain.snd', nothing: null },
  ricochet: null,
  ship: false,
};

/** The bolt going past, on the ground and in space: the game's two, chosen by whose bolt it is (INVENTED). */
const FLYBY = { ground: 'sound/wep_flyby_energy.snd', ship: 'sound/cbt_bolt_flyby.snd' };

/**
 * INVENTED: a brawl's own two sounds, which the melee table's `unarmed` row names only half of (it
 * gives the swing and no hit). `pl_hit_unarmed` is the game's, linked by its name.
 */
const UNARMED = { swing: 'sound/pl_swing_unarmed.snd', hit: 'sound/pl_hit_unarmed.snd' };

/**
 * INVENTED, from the game's own names: what a blade or a club sounds like landing. Only six of the
 * melee table's 133 rows name a hit at all (three of them the lightsabers', which never come through
 * here), so without this every sword, axe and staff would land with the bare-hands thud. The two
 * blade sounds are the game's own small and large blade hits; a club takes the small one's weight.
 */
const MELEE_HIT: Record<string, string> = {
  '1handMelee': 'sound/wep_sm_blade_hit_flesh.snd',
  '2handMelee': 'sound/wep_lg_blade_hit_flesh.snd',
  polearm: 'sound/wep_lg_blade_hit_flesh.snd',
  thrown: 'sound/wep_sm_blade_hit_flesh.snd',
};

/**
 * A set that names nothing: for a bolt that is not really fired at all (the warm-up's two, which
 * exist to compile a shader nine hundred metres under the world and are gone on the next frame).
 */
export const SILENT_GUN: GunSound = {
  key: 'silent',
  fire: null,
  hit: { creature: null, metal: null, stone: null, wood: null, other: null },
  miss: { water: null, terrain: null, nothing: null },
  ricochet: null,
  ship: false,
};

/**
 * INVENTED, from the game's own names: what a grenade sounds like when it is armed, when it first
 * touches the ground or the water, and when it goes off. The grenade templates carry no weapon
 * effect at all (the server threw them), so there is nothing to look up and these are linked by
 * name: the fragmentation, glop and proton grenades have an "arm" sound of their own and the rest
 * take the plain one; the blast is the generic explosion of the size the blast's radius asks for,
 * with the two grenades that have a sound of their own taking it.
 */
const GRENADE_ARM: Record<string, string> = {
  grenade_fragmentation: 'sound/wep_frag_gren_act.snd',
  grenade_glop: 'sound/wep_glop_gren_act.snd',
  grenade_proton: 'sound/item_proton_grenade_act.snd',
};
const GRENADE_ARM_PLAIN = 'sound/wep_grenade_on.snd';
const GRENADE_LAND = { ground: 'sound/wep_grenade_hit_terrain.snd', water: 'sound/wep_grenade_hit_water.snd' };
const BLAST_OWN: Record<string, string> = { grenade_cryoban: 'sound/exp_cryoban_test.snd', grenade_glop: 'sound/exp_glop_test.snd' };
const BLAST_BY_SIZE = ['sound/exp_small_generic.snd', 'sound/exp_medium_generic.snd', 'sound/exp_large_generic.snd'];

/**
 * INVENTED: which of the weapon table's five hit columns a surface answers to. The five are the
 * client's own (creature, metal, stone, wood, other); the words on the left are the surfaces the
 * feet already resolve, which are the terrain's nine, the room table's four and the object
 * templates' seven. Anything not named here is `other`, which is what the client's own fallback
 * column is for.
 */
const HIT_COLUMN: Record<string, HitSurface> = {
  metal: 'metal',
  stone: 'stone',
  rock: 'stone',
  obsidian: 'stone',
  wood: 'wood',
  carpet: 'other',
  ice: 'other',
  acid: 'other',
  molten: 'other',
};

/** Which of the game's four kinds a weapon class fires as, for the ranged table's four plain rows. */
const RANGED_KIND: Record<string, string> = { pistol: 'pistol', carbine: 'lightRifle', rifle: 'rifle', heavy: 'heavyWeapon' };

/** The melee table's plain rows, by the weapon class that swings that way. */
const MELEE_KIND: Record<string, string> = {
  sword1h: '1handMelee',
  knife: '1handMelee',
  fist: '1handMelee',
  sword2h: '2handMelee',
  polearm: 'polearm',
  thrown: 'thrown',
  lightsaber: 'onehandLightsaber',
  lightsaber2h: 'twohandLightsaber',
  lightsaberStaff: 'polearmLightsaber',
};

/**
 * A lit blade is the sabers' own business: its hum, its whoosh and what it strikes are all one
 * sound-world with the weather on the blade, and they belong together. The fighters swing blades
 * too, so this holds the hook the sabers install and the fighters ask through it. Nothing here
 * knows what a blade sounds like; without the hook a fighter's blade is simply silent.
 */
export interface SaberHooks {
  /** A swing started: the style it swings in, where the swinger stands, and the clip it plays,
   * whose own marks may speak for it. */
  swing(style: string, x: number, y: number, z: number, clip: string | null): void;
  /** A blade met something: another blade, a body, or the world. */
  contact(kind: 'block' | 'body' | 'wall', x: number, y: number, z: number): void;
}

/** One line of the report: an event and everything that decided what it sounded like. */
export interface CombatLogRow {
  at: number;
  what: string;
  gun: string;
  surface: string | null;
  sound: string | null;
  key: number;
}

const EMPTY_HIT: Record<HitSurface, string | null> = { creature: null, metal: null, stone: null, wood: null, other: null };
const EMPTY_MISS: Record<MissKind, string | null> = { water: null, terrain: null, nothing: null };
/** The two sets of columns, written once: walking them allocates nothing. */
const HIT_COLUMNS: readonly HitSurface[] = ['creature', 'metal', 'stone', 'wood', 'other'];
const MISS_KINDS: readonly MissKind[] = ['water', 'terrain', 'nothing'];

/** A template's file name without its folder (`shared_carbine_dc15.iff`), which is how the tables key their rows. */
export function templateKey(template: string | undefined | null): string {
  if (!template) return '';
  return template.replace(/\\/g, '/').split('/').pop() ?? '';
}

/** The first sound of whatever the pack wrote there: one string, a list of them, or nothing. */
function firstOf(list: SoundList): string | null {
  if (!list) return null;
  if (typeof list === 'string') return list;
  return list.find((s) => !!s) ?? null;
}

/** The surface a point's own word answers to, in the weapon table's five columns. */
export function hitColumn(surface: string | null | undefined): HitSurface {
  if (!surface) return 'other';
  return HIT_COLUMN[surface] ?? 'other';
}

/** The row of a table keyed by `weapon`: the gun's own template first, then the kind its class fires as. */
export function rowFor<T extends { weapon: string }>(rows: readonly T[] | undefined, template: string | undefined | null, kind: string | null): T | null {
  if (!rows?.length) return null;
  const key = templateKey(template);
  if (key) for (const r of rows) if (r.weapon === key) return r;
  if (kind) for (const r of rows) if (r.weapon === kind) return r;
  return null;
}

/**
 * One gun's set, from everything that names a sound for it. Pure, so the node test can feed it a
 * table and a record and read back exactly which source each sound came from:
 *  1. the per-gun row of the ranged table, which is the game's own answer for that weapon;
 *  2. the weapon effect row's client effects, which the weapons pack carries as `fx.sounds` and
 *     which are the only source of the per-surface hits and the misses;
 *  3. the four plain rows of the ranged table, for a gun the table does not name;
 *  4. the generic set, so nothing is ever silent.
 */
export function gunSoundFrom(gun: GunLike | null | undefined, tables: CombatTables | null, generic: GunSound = GENERIC_GUN): GunSound {
  if (!gun) return generic;
  const fx = (gun.fx as { sounds?: GunFxSounds } | undefined)?.sounds;
  const kind = gun.class ? (RANGED_KIND[gun.class] ?? null) : null;
  const row = rowFor(tables?.ranged, gun.template, kind);
  const hit: Record<HitSurface, string | null> = { ...EMPTY_HIT };
  const miss: Record<MissKind, string | null> = { ...EMPTY_MISS };
  const fxHit = fx?.hit;
  if (fxHit && typeof fxHit === 'object' && !Array.isArray(fxHit)) {
    for (const c of HIT_COLUMNS) hit[c] = firstOf((fxHit as Partial<Record<HitSurface, SoundList>>)[c]);
  } else {
    // The older pack's one hit sound, which the weapon table took from the creature column.
    const one = firstOf(fxHit as SoundList);
    for (const c of HIT_COLUMNS) hit[c] = one;
  }
  if (fx?.miss) for (const c of MISS_KINDS) miss[c] = firstOf(fx.miss[c]);
  // The ranged table's hit is the blow on what was aimed at, not on any surface: its column is
  // `Hit Target Sound`, and of the 129 retail rows that set it the great majority name a
  // `*_hit_flesh` sound. So it wins the creature column, which is keyed on the weapon itself, and
  // the other four stay the weapon effect's, which is where the game keeps stone from wood.
  if (row?.hit) hit.creature = row.hit;
  // No retail row of the ranged table sets a "hit nothing" or a ricochet (checked over all 271),
  // so neither of these can fire today; they are read because the columns exist and a table that
  // fills them would otherwise be ignored.
  if (row?.nothing) miss.nothing = row.nothing;
  for (const c of HIT_COLUMNS) hit[c] ??= generic.hit[c];
  for (const c of MISS_KINDS) if (c !== 'nothing') miss[c] ??= generic.miss[c];
  return {
    key: gun.id || templateKey(gun.template) || 'gun',
    fire: row?.muzzle ?? firstOf(fx?.fire) ?? generic.fire,
    hit,
    miss,
    ricochet: row?.ricochet ?? firstOf(fx?.ricochet) ?? generic.ricochet,
    ship: false,
  };
}

/**
 * A ship gun's set, from the projectile table the ships pack carries. Its three sounds are the
 * gun's own fire, the hit on a hull's armour and the hit on anything else (an asteroid), which
 * stand in for the five columns a ground gun has.
 */
export function shipGunFrom(row: ProjectileRow | null | undefined, generic: GunSound = GENERIC_GUN): GunSound | null {
  if (!row) return null;
  const s = row.sounds ?? {};
  const metal = s.hitMetal ?? null;
  const other = s.hitOther ?? null;
  return {
    key: `projectile:${row.index}`,
    fire: s.fire ?? generic.fire,
    hit: { creature: other ?? metal, metal: metal ?? other, stone: other ?? metal, wood: other ?? metal, other: other ?? metal },
    miss: { water: null, terrain: other, nothing: null },
    ricochet: null,
    ship: true,
  };
}

/**
 * The sounds of every gun there is, and of the blows and blasts beside them. One of these lives as
 * long as the game does; the world hands it a planet with `begin` and takes it away with `leave`.
 *
 * It is a module-level object (`combatSounds` below) rather than something passed down, because the
 * places a shot is fired from are six files deep in three different systems and threading a mixer
 * through all of them would put sound in the signature of everything that fights.
 */
export class CombatSounds {
  /** The invented numbers themselves, so `__debug.gunSounds({ flyby: 8 })` moves them live. */
  readonly tune: CombatTune = COMBAT_TUNE;
  readonly counts = { fires: 0, firesPlayed: 0, hits: 0, hitsPlayed: 0, misses: 0, flybys: 0, melee: 0, grenades: 0, blasts: 0, volleys: 0, noHost: 0, saberNoHook: 0 };
  readonly log: CombatLogRow[] = [];
  /** Sounds asked for that the bank turned out not to hold; each is named once, for the report. */
  readonly missing = new Set<string>();

  private host: LoopHost | null = null;
  private saber: SaberHooks | null = null;
  private baseUrl = '';
  private tables: CombatTables | null = null;
  /** Bumped whenever a table or a pack lands, which is what throws the built sets away. */
  private version = 0;
  private world: SurfaceSource | null = null;
  /** The world's collider map, when the world it was given has one; `this` for the call. */
  private byCollider: ((handle: number) => string | null) | null = null;
  private colliderHost: object | null = null;
  private surfaces: Record<string, string> = {};
  private surfaceState = 'none';
  private packId = '';
  private token = 0;
  private projectiles: ProjectileRow[] | null = null;
  private projectileState = 'not fetched';
  /** A gun's set, built once. Keyed by the weapon's own record, so nothing is held after it goes. */
  private readonly built = new WeakMap<object, { at: number; sound: GunSound }>();
  private readonly byIndex = new Map<number, GunSound | null>();
  private readonly byEffect = new Map<string, GunSound | null>();
  private readonly byId = new Map<string, GunSound | null>();
  /** The rack, by id, so a holder that knows only an id is heard with that weapon's own sounds. */
  private readonly catalogue = new Map<string, GunLike>();
  /** Seconds since the game started; this class's own timers, none of them game logic. */
  private clock = 0;
  /**
   * When each shooter last fired each of its guns. Keyed on the shooter first, because a squad with
   * one kind of rifle, and every turret of a field, share one weapon record: keyed on the gun alone
   * a firefight would collapse into a single voice. Two maps rather than a joined string, so a gun
   * firing ten times a second allocates nothing.
   */
  private readonly lastFire = new Map<number, Map<string, number>>();
  private lastFlyby = -1;
  /** Where the ear is and which room it is in, written by the game each frame. */
  private readonly ear = { x: 0, y: 0, z: 0 };
  private readonly earSpace: SoundSpace = { building: -1, cell: -1 };
  /** The held trigger's loop (a flame thrower), 0 for none. */
  private heldKey = 0;
  private heldId = '';
  /** What is being held while the mixer has no voice for it, and when to ask again. */
  private heldWant = '';
  private heldRetryAt = -1;
  /** The samples a gun will need, handed to the bank in one call; reused, so preparing allocates nothing. */
  private readonly prepareList: string[] = [];
  /** Refilled per event, so nothing is allocated when a gun fires. */
  private readonly space: SoundSpace = { building: -1, cell: -1 };

  /** The mixer, once the game has one. Everything below is silent and counted until then. */
  attach(host: LoopHost, baseUrl: string): void {
    this.host = host;
    this.baseUrl = baseUrl;
    this.loadProjectiles();
  }

  /**
   * The shared tables from `sounds/sources.json`, handed over when they change. They arrive some
   * frames after the game starts, so every set built before then is thrown away when they land.
   */
  setTables(tables: CombatTables | null): void {
    if (tables === this.tables) return;
    this.tables = tables;
    this.forget();
  }

  /**
   * Where the world's own answers about a point come from; null outside a world. Where it can also
   * name the thing a collider belongs to, that is taken as well: a bolt knows exactly what it struck,
   * which a ray cast downward from the mark on a wall cannot work out.
   */
  attachWorld(world: SurfaceSource | null): void {
    this.world = world;
    this.byCollider = (world as (SurfaceSource & ColliderSurfaces) | null)?.templateOfCollider ?? null;
    this.colliderHost = world;
  }

  /** A planet is loading: fetch what its own objects are made of, which is what a bolt strikes. */
  begin(packId: string): void {
    this.leave();
    this.packId = packId;
    this.surfaceState = 'loading';
    const token = this.token;
    void fetch(`${this.baseUrl}assets-private/${packId}/sounds.json`)
      .then(async (res) => (res.ok ? ((await res.json()) as { surfaces?: Record<string, string> }) : null))
      .catch(() => null)
      .then((pack) => {
        if (token !== this.token) return;
        this.adoptSurfaces(pack?.surfaces ?? null);
      });
  }

  /** A planet's object surfaces read elsewhere (the node test). */
  adoptSurfaces(surfaces: Record<string, string> | null): void {
    this.surfaces = surfaces ?? {};
    this.surfaceState = surfaces ? `${Object.keys(this.surfaces).length} object surfaces` : 'none';
  }

  /** The planet is going: the held loop let go and the planet's own surfaces forgotten. */
  leave(): void {
    this.token++;
    this.hold(null, 0, 0, 0);
    this.surfaces = {};
    this.surfaceState = 'none';
    this.packId = '';
    // Every shooter of the planet just left is gone with it, and its volley windows with them.
    this.lastFire.clear();
  }

  /** Every built set thrown away: a table or a pack landed and the answers may differ now. */
  private forget(): void {
    this.version++;
    this.byIndex.clear();
    this.byEffect.clear();
    this.byId.clear();
  }

  /** Where the ear is, for the flyby, and which room it is in, for everything a shot plays. */
  setListener(x: number, y: number, z: number, space: SoundSpace): void {
    this.ear.x = x;
    this.ear.y = y;
    this.ear.z = z;
    this.earSpace.building = space.building;
    this.earSpace.cell = space.cell;
  }

  /** This class's own clock, stepped with the frame (and with `__debug.advance`'s simulated seconds). */
  update(dt: number): void {
    this.clock += Math.max(0, Math.min(0.25, dt));
  }

  // ---- what a gun sounds like ----

  /**
   * The set for a weapon, built once and kept against the weapon's own record. Anything with an id,
   * a template, a class or a converted `fx` will do: the rack's records, and the gun profiles the
   * fighters and the catalogue's people carry.
   */
  gunOf(gun: GunLike | null | undefined): GunSound | null {
    if (!gun) return null;
    const had = this.built.get(gun as object);
    if (had && had.at === this.version) return had.sound;
    const sound = gunSoundFrom(gun, this.tables);
    this.built.set(gun as object, { at: this.version, sound });
    this.prepareOf(sound);
    return sound;
  }

  /**
   * The rack itself, handed over when it loads. It is what lets something that knows only a
   * weapon's id (a person from the catalogue, whose hands are given a copy of the model and not
   * the record) be heard with that weapon's own sounds.
   */
  useCatalogue(defs: readonly GunLike[] | null): void {
    this.catalogue.clear();
    for (const d of defs ?? []) if (d.id) this.catalogue.set(d.id, d);
    this.forget();
  }

  /** A weapon's set by the rack's own id, for a holder that knows only that. */
  gunById(id: string | null | undefined): GunSound | null {
    if (!id) return null;
    const def = this.catalogue.get(id);
    if (def) return this.gunOf(def);
    // The rack has not landed (or the id is not in it): the tables are still keyed on the weapon's
    // own template, and every one of the rack's ids is its template's name without `shared_`.
    const had = this.byId.get(id);
    if (had !== undefined) return had;
    const sound = gunSoundFrom({ id, template: `shared_${id}.iff` }, this.tables);
    this.byId.set(id, sound);
    this.prepareOf(sound);
    return sound;
  }

  /** A ship gun's set by its projectile index, which is what the ships' own weapons name. */
  shipGun(index: number | undefined | null): GunSound | null {
    if (index === undefined || index === null) return null;
    const had = this.byIndex.get(index);
    if (had !== undefined) return had;
    const row = this.projectiles?.find((p) => p.index === index) ?? null;
    const sound = shipGunFrom(row);
    this.byIndex.set(index, sound);
    if (sound) this.prepareOf(sound);
    return sound;
  }

  /**
   * A ship gun's set from the bolt effect it draws, for a bolt fired with no set of its own. Three
   * of the table's effects are shared: the red bolt by three hulls, the green by three and the blue
   * by two, each of the eight with a shot of its own. Their hit sounds are alike and only the shot
   * differs, so the commonest of those shots stands in -- and since on the retail table no two of
   * them are the same sound, that is the first of them in table order: a red bolt fired by something
   * that hands over no set of its own is heard as that hull's gun, not as the ship that fired it.
   * Every caller in the game passes its own set but the NPC ships' brain, which names its gun's
   * projectile and not its gun; one line there makes it exact.
   */
  projectileGun(effect: string | null | undefined): GunSound | null {
    if (!effect) return null;
    const had = this.byEffect.get(effect);
    if (had !== undefined) return had;
    const rows = (this.projectiles ?? []).filter((p) => p.effect === effect);
    let best: ProjectileRow | null = null;
    let bestCount = 0;
    for (const r of rows) {
      const n = rows.filter((o) => (o.sounds?.fire ?? null) === (r.sounds?.fire ?? null)).length;
      if (n > bestCount) {
        bestCount = n;
        best = r;
      }
    }
    const sound = shipGunFrom(best);
    this.byEffect.set(effect, sound);
    if (sound) this.prepareOf(sound);
    return sound;
  }

  /** Ask the bank for a gun's samples before it is fired, so the first shot is not the one that waits. */
  prepareGun(gun: GunLike | null | undefined): void {
    const sound = this.gunOf(gun);
    if (sound) this.prepareOf(sound);
  }

  /**
   * The whole set, not only the muzzle: a one-shot asked for before its sample is decoded waits a
   * moment and is then dropped, so with the shot alone prepared the first hit on each surface, the
   * first miss of each kind and the first ricochet would each be liable to be lost.
   */
  private prepareOf(sound: GunSound): void {
    const host = this.host;
    if (!host) return;
    const list = this.prepareList;
    list.length = 0;
    if (sound.fire) list.push(sound.fire);
    for (const c of HIT_COLUMNS) if (sound.hit[c]) list.push(sound.hit[c]);
    for (const c of MISS_KINDS) if (sound.miss[c]) list.push(sound.miss[c]);
    if (sound.ricochet) list.push(sound.ricochet);
    if (list.length) host.prepare(list);
  }

  // ---- the shots themselves ----

  /**
   * A gun fired, at the muzzle. Called from `Bolts.fire` for every bolt in the game and by hand for
   * the shots that never make one (a disruptor's line). A volley -- a shotgun's pellets, four ship
   * guns on one frame -- is one shot: the same gun asking again within a few hundredths of a second
   * is counted and dropped, or a scattergun would fire eight times at once.
   */
  fire(sound: GunSound | null | undefined, x: number, y: number, z: number, who = 0): void {
    this.counts.fires++;
    const gun = sound ?? GENERIC_GUN;
    // The window belongs to the shooter, not to the weapon: a squad carrying one kind of rifle, and
    // every turret of a field, are one record between them, and keyed on that alone a firefight
    // would be a single voice.
    let mine = this.lastFire.get(who);
    if (!mine) {
      mine = new Map();
      this.lastFire.set(who, mine);
    }
    const last = mine.get(gun.key);
    if (last !== undefined && this.clock - last < this.tune.volley) {
      this.counts.volleys++;
      return;
    }
    mine.set(gun.key, this.clock);
    const key = this.play(gun.fire, x, y, z);
    if (key) this.counts.firesPlayed++;
    this.note('fire', gun.key, null, gun.fire, key);
  }

  /**
   * A bolt struck something. `creature` is anything alive, `ship` a hull with a fight of its own,
   * and null means "ask the world what is standing there", which is the same question and the same
   * answer a foot landing there would get.
   */
  hit(sound: GunSound | null | undefined, x: number, y: number, z: number, what: 'creature' | 'ship' | null, handle = -1): void {
    this.counts.hits++;
    const gun = sound ?? GENERIC_GUN;
    let surface: HitSurface;
    let word: string | null = null;
    if (what === 'creature') surface = 'creature';
    else if (what === 'ship') surface = 'metal';
    else {
      word = this.surfaceAt(x, y, z, handle);
      surface = hitColumn(word);
    }
    const id = gun.hit[surface] ?? gun.hit.other;
    const key = this.play(id, x, y, z);
    if (key) this.counts.hitsPlayed++;
    this.note('hit', gun.key, word ?? surface, id, key);
  }

  /** A bolt that glanced off and flew on, where the weapon table gives the gun a ricochet. */
  ricochet(sound: GunSound | null | undefined, x: number, y: number, z: number): void {
    const gun = sound ?? GENERIC_GUN;
    if (!gun.ricochet) return;
    const key = this.play(gun.ricochet, x, y, z);
    this.note('ricochet', gun.key, null, gun.ricochet, key);
  }

  /** A bolt that struck nothing that matters: the water, the bare ground, or the end of its life. */
  miss(sound: GunSound | null | undefined, x: number, y: number, z: number, what: MissKind): void {
    this.counts.misses++;
    const gun = sound ?? GENERIC_GUN;
    const id = gun.miss[what];
    if (!id) return;
    const key = this.play(id, x, y, z);
    this.note(`miss:${what}`, gun.key, what, id, key);
  }

  /**
   * A bolt went past the ear, over the stretch it covers this frame. A bolt flies 20 to 40 metres
   * in a frame, so one point a frame against a three-metre radius would miss five times out of six:
   * the ear is put on the line the bolt travels between this frame and the next instead, which is
   * the same one squared distance with three more multiplies. Asked once a frame for every bolt in
   * the air, and the bolt itself remembers that it has whined, so one flying alongside does not
   * whine every frame.
   */
  flyPast(x: number, y: number, z: number, dx: number, dy: number, dz: number, ship: boolean): boolean {
    const len2 = dx * dx + dy * dy + dz * dz;
    let t = 0;
    if (len2 > 1e-9) {
      t = ((this.ear.x - x) * dx + (this.ear.y - y) * dy + (this.ear.z - z) * dz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    return this.flyby(x + dx * t, y + dy * t, z + dz * t, ship);
  }

  /** The same at one point, for a shot that does not travel (and for the node test). */
  flyby(x: number, y: number, z: number, ship: boolean): boolean {
    const r = this.tune.flyby;
    const d2 = (x - this.ear.x) ** 2 + (y - this.ear.y) ** 2 + (z - this.ear.z) ** 2;
    if (d2 > r * r) return false;
    if (this.lastFlyby >= 0 && this.clock - this.lastFlyby < this.tune.flybyGap) return true;
    this.lastFlyby = this.clock;
    this.counts.flybys++;
    this.play(ship ? FLYBY.ship : FLYBY.ground, x, y, z);
    return true;
  }

  // ---- blades, fists, grenades ----

  /**
   * A melee swing or the blow landing, from the game's melee table: the weapon's own row first, then
   * the plain row for the way its class swings, then bare hands. A lightsaber's own swing is the
   * sabers' business and never comes through here.
   */
  melee(weapon: GunLike | null | undefined, landed: boolean, x: number, y: number, z: number): void {
    const kind = weapon?.class ? (MELEE_KIND[weapon.class] ?? null) : 'unarmed';
    const row = rowFor(this.tables?.melee, weapon?.template, kind);
    // Six of the table's 133 rows name a hit, so a landed blow usually falls to the sound for the
    // kind of thing that swung, and bare hands only when nothing else says.
    const id = (landed ? (row?.hit ?? (kind ? MELEE_HIT[kind] : null) ?? UNARMED.hit) : (row?.attack ?? UNARMED.swing)) || null;
    this.counts.melee++;
    const key = this.play(id, x, y, z);
    this.note(landed ? 'melee hit' : 'melee swing', weapon?.id ?? kind ?? 'unarmed', null, id, key);
  }

  /** The sabers' own hooks, installed by the game when that package is in. */
  useSaber(hooks: SaberHooks | null): void {
    this.saber = hooks;
  }

  /** A fighter swung a lit blade: handed to the sabers, which know what a blade sounds like. */
  saberSwing(style: string, x: number, y: number, z: number, clip: string | null): void {
    if (!this.saber) {
      this.counts.saberNoHook++;
      return;
    }
    this.saber.swing(style, x, y, z, clip);
  }

  /** A fighter's blade met something. */
  saberContact(kind: 'block' | 'body' | 'wall', x: number, y: number, z: number): void {
    if (!this.saber) {
      this.counts.saberNoHook++;
      return;
    }
    this.saber.contact(kind, x, y, z);
  }

  /** A grenade armed and thrown, or landing on the ground or in the water. */
  grenade(model: string | null | undefined, phase: 'arm' | 'land', x: number, y: number, z: number): void {
    let id: string | null;
    if (phase === 'arm') id = (model && GRENADE_ARM[model]) || GRENADE_ARM_PLAIN;
    else id = this.overWater(x, y, z) ? GRENADE_LAND.water : GRENADE_LAND.ground;
    this.counts.grenades++;
    const key = this.play(id, x, y, z);
    this.note(`grenade ${phase}`, model ?? 'charge', null, id, key);
  }

  /** Something went off: a grenade, a mine, a rocket's splash, a concussion pulse. */
  blast(radius: number, x: number, y: number, z: number, model?: string | null): void {
    const [small, large] = this.tune.blast;
    const size = radius >= large ? 2 : radius >= small ? 1 : 0;
    const id = (model && BLAST_OWN[model]) || BLAST_BY_SIZE[size];
    this.counts.blasts++;
    const key = this.play(id, x, y, z);
    this.note('blast', model ?? `r${Math.round(radius)}`, null, id, key);
  }

  /**
   * The loop a held trigger makes (the flame thrower's, the beams'), started when the trigger is
   * held and stopped when it is let go. `id` null stops whatever is held, which is what a class
   * switch, a gun change and stepping out of a ship all do.
   */
  hold(id: string | null, x: number, y: number, z: number): void {
    const host = this.host;
    if (!host) return;
    if (!id || id !== this.heldId) {
      if (this.heldKey) host.stop(this.heldKey, this.tune.heldFade);
      this.heldKey = 0;
      this.heldId = '';
    }
    if (!id) {
      this.heldWant = '';
      this.heldRetryAt = -1;
      return;
    }
    if (!this.heldKey) {
      // The mixer may have no voice to spare (or be recording rather than playing): a trigger held
      // down must not ask again on every frame, which would be sixty starts a second and would fill
      // the report the owner is asked to read.
      if (id === this.heldWant && this.heldRetryAt >= 0 && this.clock < this.heldRetryAt) return;
      this.heldKey = host.loop(id, { x, y, z, space: this.earSpace });
      this.heldId = this.heldKey ? id : '';
      this.heldWant = this.heldKey ? '' : id;
      this.heldRetryAt = this.heldKey ? -1 : this.clock + this.tune.heldRetry;
      return;
    }
    if (!host.isPlaying(this.heldKey)) {
      this.heldKey = 0;
      this.heldId = '';
      return;
    }
    host.move(this.heldKey, x, y, z);
  }

  // ---- the world's own answers ----

  /**
   * What is standing at a point, in the words the feet already resolve; null when nothing can say.
   *
   * A bolt is stopped by a collider and knows which, so the thing it struck is asked for by that
   * first: the mark on a wall is metres above anything a ray down from it could find, and the ray
   * would name the ground painted under the building instead. Then the feet's own order -- the room
   * it is in, the thing standing under it, the ground -- for a mark with no collider behind it (a
   * grenade's splash) or a world that has no collider map.
   */
  private surfaceAt(x: number, y: number, z: number, handle = -1): string | null {
    const w = this.world;
    if (!w) return null;
    if (handle >= 0 && this.byCollider) {
      const struck = this.byCollider.call(this.colliderHost, handle);
      const word = struck ? this.surfaces[struck] : null;
      if (word) return word;
      // A collider the map does not name is a piece of the world itself (the terrain, a room's
      // wall): the questions below answer for those.
    }
    // Which building the mark is in, not which the ear is in: a shot from the street into a doorway
    // lands indoors while the ear is out, and the other way round.
    const inside = (w.space(x, y, z)?.building ?? -1) >= 0;
    const room = inside ? w.roomSurface(x, y, z) : null;
    if (room) return room;
    // The same ray a foot landing there would cast (the world lifts it and sets its reach itself):
    // an object's own template says what it is made of, and the ground answers when it says nothing.
    const object = w.objectTemplate(x, y, z, inside);
    if (object) {
      const word = this.surfaces[object];
      if (word) return word;
    }
    return surfaceWord(w.groundTemplate(x, z), this.tables?.surfaces);
  }

  /** Whether a point is under the water there, for a grenade's splash and a bolt's miss. */
  overWater(x: number, y: number, z: number): boolean {
    const w = this.world;
    if (!w) return false;
    const top = w.waterTop(x, z);
    return Number.isFinite(top) && top > y;
  }

  /** Which of the three a bolt that hit the world came to: the water, the ground, or an object. */
  missKindAt(x: number, y: number, z: number, handle = -1): MissKind | null {
    if (this.overWater(x, y, z)) return 'water';
    const w = this.world;
    if (!w) return null;
    // Something the world can name was struck: that is a hit, not a miss, and no ray is needed.
    if (handle >= 0 && this.byCollider && this.byCollider.call(this.colliderHost, handle)) return null;
    // The mark's own building, as above, not the ear's.
    const inside = (w.space(x, y, z)?.building ?? -1) >= 0;
    return w.objectTemplate(x, y, z, inside) ? null : 'terrain';
  }

  // ---- plumbing ----

  /**
   * One sound at a point, in whatever room that point is in. The space matters: the mixer puts a
   * low-pass over anything the ear is not in the same space as, so a shot in a cantina heard from
   * the street is muffled, and one in the open is not.
   */
  private play(id: string | null | undefined, x: number, y: number, z: number): number {
    const host = this.host;
    if (!id) return 0;
    if (!host) {
      this.counts.noHost++;
      return 0;
    }
    if (host.bank.available && !host.bank.template(id) && this.missing.size < 200) this.missing.add(id);
    let space: SoundSpace | undefined;
    const found = this.world?.space(x, y, z) ?? null;
    if (found) {
      this.space.building = found.building;
      this.space.cell = found.cell;
      space = this.space;
    } else if (this.earSpace.building >= 0) {
      // Aboard a hull there is no streamed building at the point, and the ear's own room is where
      // everything fired in it belongs; without this every shot on a deck would be muffled.
      space = this.earSpace;
    }
    return host.play(id, { x, y, z, space });
  }

  private note(what: string, gun: string, surface: string | null, sound: string | null | undefined, key: number): void {
    this.log.push({ at: Math.round(this.clock * 100) / 100, what, gun, surface, sound: sound ?? null, key });
    if (this.log.length > 40) this.log.splice(0, this.log.length - 40);
  }

  private loadProjectiles(): void {
    if (typeof window === 'undefined' || this.projectileState !== 'not fetched') return;
    this.projectileState = 'loading';
    void fetch(`${this.baseUrl}assets-private/ships/projectiles.json`)
      .then(async (res) => (res.ok && (res.headers.get('content-type') ?? '').includes('json') ? ((await res.json()) as { projectiles?: ProjectileRow[] }) : null))
      .catch(() => null)
      .then((table) => {
        this.projectiles = table?.projectiles ?? null;
        this.projectileState = this.projectiles ? `${this.projectiles.length} projectiles` : 'no projectile table';
        this.forget();
      });
  }

  /** The whole of it in numbers, which is the only way a driven tab can check any of this. */
  status(): Record<string, unknown> {
    return {
      planet: this.packId || null,
      tables: { ranged: this.tables?.ranged?.length ?? 0, melee: this.tables?.melee?.length ?? 0, surfaces: this.surfaceState, projectiles: this.projectileState },
      world: !!this.world,
      // Whether the world can name the thing a collider belongs to, which is what tells a bolt in a
      // metal wall from the sand painted under the building.
      colliders: !!this.byCollider,
      sabers: !!this.saber,
      listener: { at: [Math.round(this.ear.x), Math.round(this.ear.y), Math.round(this.ear.z)], space: { ...this.earSpace } },
      held: this.heldKey ? this.heldId : this.heldWant ? `${this.heldWant} (no voice)` : null,
      counts: { ...this.counts },
      missing: [...this.missing].slice(0, 12),
      recent: this.log.slice(-12),
      tune: { ...this.tune },
    };
  }
}

/**
 * The one of these the game has. A module-level object, because a bolt is fired from six places in
 * three systems and none of them should have to carry a mixer to be heard.
 */
export const combatSounds = new CombatSounds();
