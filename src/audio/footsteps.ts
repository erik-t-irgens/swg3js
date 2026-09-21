/**
 * Feet, and the voices of everything that has one.
 *
 * A body's animation says when a foot lands (`clipEvents.ts`); this says what it lands on and what
 * that sounds like. The order is the client's own: water first, then the room the body stands in,
 * then the thing it stands on, then the ground itself.
 *
 *  - **Water.** Feet under a water surface splash: `water` for the player, `surf` for everything
 *    else, which is what the game's own maps hold for each.
 *  - **A room.** The interior table gives every one of its 265 rooms a surface (metal on 112, stone
 *    on 109, wood on 28, carpet on 12), and a ship's deck the same way.
 *  - **A thing stood on.** One ray down from the foot names the collider under it; the streamer
 *    says which object that collider belongs to; the planet's sound pack says what that object's
 *    template is made of. A catwalk is wood over sand. Most placed things are made of nothing of
 *    their own -- that is what the client's surface type 0 means -- and for those the ground
 *    underneath answers, so a rock in the desert is sand.
 *  - **The ground.** The terrain's own shader families each name a surface template (sand, rock,
 *    grass, mud, snow, surf, stone, harddirt, softdirt), which the chunk under the foot already
 *    carries per vertex.
 *
 * The surface then picks the sound from the body's own client data: `footstep_<surface>`, falling
 * back to the plain `footstep`, which for a creature is its size's effect and for a person the
 * player species' own set of boots, shoes and bare feet. Nothing chooses footwear: the game's data
 * already did.
 *
 * The same client data carries every other voice a body has -- its call, its grunt when it strikes,
 * its cry when it is hit, the thud when it falls and the breath it takes standing still -- and
 * those play from the same clip events, so a creature speaks on the frame its own animation says.
 *
 * Everything here reads the world rather than being called by it: the game hands over its list of
 * bodies each frame and this works out what changed. That way a creature, a fighter and the player
 * are one piece of code and nothing in the world has to know that sound exists.
 *
 * Invented numbers are marked and gathered in `FOOT_TUNE`, live through `__debug.footsteps({...})`.
 */
import { ClipEventIndex, ClipWatcher, CLIP_EVENT_TUNE, type ActiveClip, type ClipEvent, type ClipEventPack } from './clipEvents.ts';
import { OUTSIDE, type SoundSpace } from './distance.ts';
import type { LoopHost } from './emitters.ts';

/** One body's client data as the converter writes it into `sounds/events.json`. */
export interface ClientDataEntry {
  /** Event name to a sound template or a client effect (`clienteffect/cr_footstep_large.cef`). */
  events?: Record<string, string>;
  /** The loop the thing itself makes standing there (a bantha's breathing). */
  ambient?: string;
  [key: string]: unknown;
}

/** What the converter writes at `sounds/events.json`; only the parts the bodies need are read here. */
export interface SoundEventsPack {
  format?: number;
  clientData?: Record<string, ClientDataEntry>;
  clientEffects?: Record<string, { sounds?: string[]; particle?: string }>;
  /** A mobile template to its client data file, which only the template chain can say. */
  mobiles?: Record<string, string>;
  /** A player species' template to its client data (a Bothan's names the human files). */
  species?: Record<string, string>;
  [key: string]: unknown;
}

/** The planet's own sound pack, of which the surfaces are what a foot needs. */
export interface SurfacePack {
  surfaces?: Record<string, string>;
  [key: string]: unknown;
}

/** Which of the four told us what is underfoot, for the report. */
export type FootSource = 'water' | 'room' | 'object' | 'terrain' | 'last' | 'default';

/**
 * What the ground under a foot is shaped like: the surface's own normal, and the collider it
 * belongs to. Nothing about a sound needs either; a mark laid where the foot landed needs both --
 * the normal so it lies in a slope instead of through it, the collider so a mark on a streamed
 * prop goes down with that prop. One kept record, refilled: nothing is allocated to ask.
 */
export interface FootGround {
  nx: number;
  ny: number;
  nz: number;
  /**
   * The collider underfoot, or **null** for the world itself (the terrain, a building's shell).
   * Null rather than a number on purpose: which number stands for "the world" is the marks
   * system's own to say (it is -1 there, because 0 is a handle the engine really hands out), and
   * naming it here would be that value's second home.
   */
  owner: number | null;
}

/**
 * What the world can say about a point. The world answers with what it holds -- a room's own
 * surface, and the templates of the object and the ground -- and the naming below turns the
 * templates into the words the client data keys on, so the world needs to know nothing about the
 * sound packs.
 */
export interface SurfaceSource {
  /** The height of the water surface over a point, or -Infinity where there is none. */
  waterTop(x: number, z: number): number;
  /** The interior table's surface for the room a point is in (`metal`, `carpet`). */
  roomSurface(x: number, y: number, z: number): string | null;
  /**
   * The same for the room the player is in, from the cell the game already tracks rather than from
   * the point. Rooms overhang their hull, so the tracked cell is the better answer, and it is one
   * the world has cached for the frame anyway. Optional: a body that is not the player has none.
   */
  playerRoom?(): string | null;
  /** The object template of the thing standing under the point, or null for the ground itself. */
  objectTemplate(x: number, y: number, z: number, inside: boolean): string | null;
  /** The terrain surface template the ground is painted with there. */
  groundTemplate(x: number, z: number): string | null;
  /**
   * What the ground under a point is shaped like, for a mark laid on it rather than for a sound:
   * its normal, and the collider it belongs to. Fills `out` and says whether it could answer.
   *
   * Optional, and asked for only when something is really going to be laid there -- a walk over
   * stone asks nothing -- so a world without it (a node test, a planet with no physics yet) simply
   * gets flat, world-owned marks.
   */
  footGround?(x: number, y: number, z: number, inside: boolean, out: FootGround): boolean;
  /** The building and cell a point is in, for the muffling rule; null in the open. */
  space(x: number, y: number, z: number): SoundSpace | null;
}

/** The two packs' own naming, kept apart from the world so the resolver stays a pure function. */
export interface SurfaceNames {
  /** What an object's template is made of; the planet's pack lists everything that is not stone. */
  object(template: string): string | null;
  /** What a terrain surface template is (`abstract/terrain_surface/sand.iff` is `sand`). */
  ground(template: string): string | null;
}

export interface FootTune {
  /** INVENTED: metres within which a body's clips are watched at all. A footstep's own full-volume
   * distance is 4 m and it is gone by 40. */
  range: number;
  /** INVENTED: metres within which a body's idle loop (a breath, a hum) is given a voice. */
  loopRange: number;
  /** INVENTED: metres a foot must be under a water surface before it splashes. */
  wade: number;
  /** INVENTED: metres of water above which it is swimming, not stepping, and the feet are silent. */
  swim: number;
  /** INVENTED: metres above the foot the ray down starts, so a foot inside the floor still finds it. */
  probe: number;
  /** INVENTED: metres down the ray looks for something to stand on. */
  reach: number;
  /** INVENTED: seconds between a hunting creature's calls; the server decided this in the game. */
  call: [number, number];
  /** INVENTED: seconds after a death the body is taken to hit the ground, when its clip says nothing. */
  deathFall: number;
  /** INVENTED: metres an idle loop moves before its place is written again. */
  loopStep: number;
  /** INVENTED: times a second the walk over every body runs (which of them are near, and their loops). */
  nearRate: number;
  /** INVENTED: the most idle loops held at once, so a valley full of wildlife cannot fill the mixer. */
  loops: number;
  /** INVENTED: what a foot lands on when nothing at all can say. */
  fallback: string;
}

/**
 * Ours, every one. The two ranges are the distances a footstep and a creature's breath carry (the
 * templates' own full-volume distances are 4 m and 3 to 60 m, and a sound is gone at ten times it);
 * the two water depths are a boot and a chest.
 */
export const FOOT_TUNE: FootTune = {
  range: 40,
  loopRange: 60,
  wade: 0.05,
  swim: 1.2,
  probe: 0.35,
  reach: 1.2,
  call: [8, 20],
  deathFall: 0.6,
  loopStep: 1,
  nearRate: 4,
  loops: 48,
  fallback: 'harddirt',
};

/**
 * INVENTED: what a creature with no client data of its own steps and falls with, by the size the
 * catalogue gives it. The game's own effects, used where its data does not reach a body this game
 * spawns; the huge ones take the giant's step, which is the only one heavier than large.
 */
const SIZE_STEPS: Record<string, string> = {
  tiny: 'clienteffect/e3_creature_footstep_small.cef',
  small: 'clienteffect/e3_creature_footstep_small.cef',
  medium: 'clienteffect/e3_creature_footstep_medium.cef',
  large: 'clienteffect/e3_creature_footstep_large.cef',
  huge: 'clienteffect/cr_footstep_giant_01.cef',
};

const SIZE_FALLS: Record<string, string> = {
  tiny: 'clienteffect/e3_creature_bodyfall_small.cef',
  small: 'clienteffect/e3_creature_bodyfall_small.cef',
  medium: 'clienteffect/e3_creature_bodyfall_medium.cef',
  large: 'clienteffect/e3_creature_bodyfall_large.cef',
  huge: 'clienteffect/cr_bodyfall_huge.cef',
};

/** The client data a person with none of their own borrows, which is what the game's own people use. */
const PERSON_FALLBACK = ['clientdata/player/client_shared_player_human_m.cdf', 'clientdata/player/client_shared_player_human_f.cdf'];

/**
 * A body's `data` while nothing has been looked for is empty; this is what is written when the
 * search found nothing, so it is never run again. Not a path, so it can never name a real file.
 */
const NO_DATA = '-';

/**
 * The folders and the prefixes the archives name a body's client data with. Ours, read off the
 * archives: `clientdata/npc/` holds 3,895 files, 2,309 of them `client_shared_npc_dressed_<name>`,
 * and `clientdata/droid/` another 53, so leaving either out sent every dressed NPC and most droids
 * to the human files. Measured over the catalogue's 5,067 entries against the 5,060 client data
 * files the pack holds, these reach 3,709 of them (creature 667/738, npc 846/1247, dressed
 * 2117/2888, droid 78/181); the converter's own map is what carries the rest.
 */
const DATA_FOLDERS = ['creature', 'npc', 'droid'];
const DATA_PREFIXES = ['', 'cr_', 'bm_', 'dro_', 'npc_', 'npc_dressed_'];

/**
 * Event names no client data in the archives holds: they are hardpoint and weapon-effect marks
 * carried by the animations, not voices. Counted as missing they would fill the report the owner is
 * told to read. Checked over all 5,060 client data files: their 58 distinct event keys hold none of
 * these.
 */
const NOT_A_VOICE = /^(hpevent_|swing_whp|hit_whp)/;

/**
 * INVENTED (the owner's decision 4): Jedi Academy plays the player's own voice on its moves, and one
 * JKA voice would grunt like a human out of every species. So each of its voice events takes the
 * species' own sound instead: a blow's cry for pain and being pushed, a heavy one for death and
 * choking, and nothing at all for a jump or a landing, which SWG's own people never voiced.
 */
const JKA_VOICE: Record<string, string | null> = { pain: 'hitlight', pushed: 'hitlight', death: 'hitheavy', choke: 'hitheavy', jump: null, land: null };

/**
 * One chunk of ground's shader families, as the terrain sampled them when it built the mesh: the
 * grid overhangs the chunk by one sample on every side, so sample 1 sits on its first corner.
 */
export interface FamilyGrid {
  fams: Int32Array;
  ox: number;
  oz: number;
  step: number;
  w: number;
}

/**
 * The shader family the ground is painted with at a point, from one chunk's grid: the nearest
 * sample, which is the corner the ground took its texture from there. Null outside the grid, 0
 * where the chunk covers the point but nothing painted it.
 *
 * It lives here rather than with the terrain because this is what reads it and because the terrain
 * module cannot be loaded by a node test, and a rule about what is underfoot that nothing can check
 * is the kind that quietly goes wrong.
 */
export function sampleFamily(g: FamilyGrid, x: number, z: number): number | null {
  const i = Math.round((x - g.ox) / g.step) + 1;
  const j = Math.round((z - g.oz) / g.step) + 1;
  if (i < 0 || j < 0 || i >= g.w || j >= g.w) return null;
  return g.fams[j * g.w + i] ?? 0;
}

/** A surface template path (`abstract/terrain_surface/sand.iff`) to the word the client data keys on. */
export function surfaceWord(path: string | null | undefined, table?: Record<string, { type?: string }> | null): string | null {
  if (!path) return null;
  const known = table?.[path]?.type;
  if (known) return known;
  // The table is the converter's; without it the file's own name is the word, which is what every
  // one of the nine retail templates holds anyway.
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.iff$/i, '') || null;
}

/** What one foot landing at a point lands on. Pure: it asks the four sources in the client's order. */
export function resolveSurface(q: { x: number; y: number; z: number; inside: boolean; player: boolean; last: string | null; deck?: string | null }, world: SurfaceSource, names: SurfaceNames, tune: FootTune): { surface: string | null; from: FootSource } {
  // 1. Water. Deep enough and it is swimming, which has a voice of its own and no feet.
  const top = world.waterTop(q.x, q.z);
  if (Number.isFinite(top)) {
    const depth = top - q.y;
    if (depth > tune.swim) return { surface: null, from: 'water' };
    if (depth > tune.wade) return { surface: q.player ? 'water' : 'surf', from: 'water' };
  }
  // 2. The room it stands in, from the game's own interior table; a ship's deck is handed in,
  // since its rooms are a world of their own that no ray of this one reaches.
  if (q.deck) return { surface: q.deck, from: 'room' };
  if (q.inside) {
    // The player's cell is tracked by the portal renderer and cached for the frame, so it is asked
    // for rather than worked out again from the point.
    const room = (q.player && world.playerRoom ? world.playerRoom() : null) ?? world.roomSurface(q.x, q.y, q.z);
    if (room) return { surface: room, from: 'room' };
  }
  // 3. What it is standing on: one ray, and the object's own template says what it is made of --
  // or says nothing, which is what most of them do, and then the ground underneath answers.
  const object = world.objectTemplate(q.x, q.y, q.z, q.inside);
  if (object) {
    const word = names.object(object);
    if (word) return { surface: word, from: 'object' };
  }
  // 4. The ground itself.
  const ground = world.groundTemplate(q.x, q.z);
  if (ground) {
    const word = names.ground(ground);
    if (word) return { surface: word, from: 'terrain' };
  }
  // Off the built ground (a chunk not yet made, a planet with no converted terrain): whatever it
  // last stood on, which is right while walking and harmless standing still.
  if (q.last) return { surface: q.last, from: 'last' };
  return { surface: tune.fallback, from: 'default' };
}

/** Anything that can say which clips it is playing: a rig, a mobile's animator, the player. */
export interface ClipSource {
  /** Fills the caller's array with the actions being played and returns how many. */
  activeClips(out: ActiveClip[]): number;
}

/** The player, as this needs to see it; the game fills one kept record a frame. */
export interface PlayerBody extends ClipSource {
  x: number;
  y: number;
  z: number;
  /** In a building or aboard a ship's rooms. */
  inside: boolean;
  /**
   * Aboard a ship, what its deck is made of: a ship's rooms are a physics world of their own that
   * no ray of the planet's reaches, so the surface is handed in rather than looked for.
   */
  deck: string | null;
  /**
   * Which space the body's own sounds belong to, when the game already knows it. Aboard a ship
   * there is no streamed building at the point, so asking the world would put the boots outside the
   * hull the ear is in and the muffling rule would put a low-pass over every step. Null lets the
   * world answer, which is right everywhere else.
   */
  space: SoundSpace | null;
  dead: boolean;
  /** The species pack's id (`human_male`), which names its clips and finds its client data. */
  species: string;
  /**
   * Which way the body faces, a turn about +Y. Nothing about a sound needs it; a foot's own mark
   * does, since a print points the way its body was going. Optional, so a caller that has none
   * (and the node tests) is unchanged.
   */
  heading?: number;
}

/** A mobile, as this needs to see it: the catalogue's creatures, droids and people. */
export interface MobileBodyLike {
  key: number;
  label: string;
  dead: boolean;
  removed: boolean;
  ready: boolean;
  state: string;
  inside: boolean;
  scale: number;
  /** Which way it faces, for the print its foot leaves; optional, as the player's is. */
  heading?: number;
  pos: { x: number; y: number; z: number };
  entry: { id: string; template?: string; kind?: string; appearance?: string | null; stats?: { sizeClass?: string } | null };
  animator: { activeClips(out: ActiveClip[]): number } | null;
  animPack: { id: string; json: { clips?: { name?: string; file?: string }[] } } | null;
}

/** A fighter, as this needs to see it. */
export interface FighterBodyLike {
  key: number;
  name: string;
  dead: boolean;
  /** Whether it has something it means to fight, which is when it calls out. */
  hunting: boolean;
  species: string;
  /** Which way it faces, for the print its foot leaves; optional, as the player's is. */
  heading?: number;
  pos: { x: number; y: number; z: number };
  cell: unknown | null;
  rig: { activeClips(out: ActiveClip[]): number } | null;
}

/** The lists the game hands over each frame. Kept by the caller; nothing here holds on to them. */
export interface BodyLists {
  player: PlayerBody | null;
  mobiles: readonly MobileBodyLike[];
  fighters: readonly FighterBodyLike[];
}

/** One body's own sound state. */
interface Voice {
  key: number;
  label: string;
  kind: 'player' | 'mobile' | 'fighter';
  watcher: ClipWatcher;
  /** Its client data file, looked for once; '' when nothing was found. */
  data: string;
  /** The scope its clip names are resolved in (a species id, or an animation pack's id). */
  scope: string | null;
  size: string;
  /** A mobile's own template and appearance, for finding its client data. */
  template: string | null;
  appearance: string | null;
  mobileKind: string | null;
  lastSurface: string | null;
  /** The idle loop it holds, 0 for none. */
  loopKey: number;
  loopX: number;
  loopY: number;
  loopZ: number;
  near: boolean;
  hostile: boolean;
  /** Game seconds at which it may call out again while it hunts. */
  callAt: number;
  dead: boolean;
  /** Game seconds at which to play its fall, 0 for none. */
  fallAt: number;
  /** Its death clip carried a fall of its own, so nothing is added. */
  fellItself: boolean;
  /** The pass it was last seen on, so a body that has gone is forgotten. */
  pass: number;
  steps: number;
  voices: number;
}

/**
 * One foot landing, as anything else that wants to know hears of it: where it landed, what it
 * landed on, and whose foot it was. It is one kept record, refilled per step, so a listener reads
 * what it needs and never holds on to it -- and a listener is called on the frame the clip's own
 * mark says the foot lands, which is the whole point of hanging one here rather than on a clock.
 *
 * The world lays a print off this (`src/world/footprints.ts`); the sound is played beside it. This
 * module knows nothing of either: it says what happened, as it already does for the mixer.
 */
export interface FootStep {
  /** The body's own key: the player's 1, every other living thing's its own. */
  key: number;
  kind: 'player' | 'mobile' | 'fighter';
  label: string;
  /** What it landed on, or null where the body is swimming and has no feet at all. */
  surface: string | null;
  from: FootSource;
  x: number;
  y: number;
  z: number;
  /** The body's heading: a turn about +Y, as the rest of the game keeps one. */
  heading: number;
  /** How big the body is against the model it was built from; 1 for a person. */
  scale: number;
  inside: boolean;
  /** Aboard a hull, what its deck is made of -- and a sign that the place above is that hull's frame. */
  deck: string | null;
  /**
   * What the ground under this step is shaped like, asked for rather than handed over: the slope
   * and the collider cost a look at the world and only a listener that is really going to lay
   * something there wants them, so a walk over stone pays nothing. Fills the caller's own record
   * and says whether the world could answer.
   *
   * **Valid only inside the listener's own call**, like the rest of this record: it reads where the
   * step happened, which the next step overwrites. Null where nothing can say (a node test).
   */
  ground: ((out: FootGround) => boolean) | null;
}

/** A listener beside the sound. Set on `BodySounds.onStep`; only one, which is all anything needs. */
export type StepHook = (step: FootStep) => void;

/** One line of the report: a foot event and everything that decided what it sounded like. */
export interface FootLogRow {
  at: number;
  body: string;
  clip: string;
  event: string;
  surface: string | null;
  from: FootSource;
  sound: string | null;
  key: number;
  distance: number;
}

/**
 * The feet and voices of every body in the world. One of these lives as long as the game does; a
 * planet is handed to it with `begin` and taken away with `leave`.
 */
export class BodySounds {
  /**
   * The invented numbers themselves, not a copy: the world reads the two ray lengths out of the
   * same object when it looks for what a foot is standing on, so `__debug.footsteps({ reach: 2 })`
   * moves both at once.
   */
  readonly tune: FootTune = FOOT_TUNE;
  /**
   * Somebody else who wants to know when a foot lands: the world's footprints. Called on the same
   * mark as the sound, with one kept record, and a step with nobody listening costs one branch.
   */
  onStep: StepHook | null = null;
  readonly index = new ClipEventIndex();
  /** The last few foot events, which is how feet are checked in a tab that can hear nothing. */
  readonly log: FootLogRow[] = [];
  readonly counts = { steps: 0, stepsPlayed: 0, voices: 0, voicesPlayed: 0, loops: 0, calls: 0, falls: 0, noData: 0, noSound: 0, bodies: 0, near: 0 };
  /** Event names asked for that no client data held; each is named once, for the report. */
  readonly missing = new Set<string>();

  private readonly host: LoopHost;
  private readonly baseUrl: string;
  private events: SoundEventsPack | null = null;
  private eventsState = 'not fetched';
  private clipState = 'not fetched';
  private surfaces: Record<string, string> = {};
  private surfaceTable: Record<string, { type?: string }> | null = null;
  private surfaceState = 'none';
  private world: SurfaceSource | null = null;
  private readonly voices = new Map<object, Voice>();
  /** Filled by each body in turn; a field, so a frame allocates nothing. */
  private readonly clips: ActiveClip[] = [];
  private readonly space: SoundSpace = { building: OUTSIDE.building, cell: OUTSIDE.cell };
  /** Game seconds since the game started; only this class's own timers use it. */
  private clock = 0;
  private sinceNear = 0;
  private pass = 0;
  private packId = '';
  private token = 0;
  /** The body whose event is being played, for the log. */
  private live: Voice | null = null;
  private liveDistance = 0;

  constructor(host: LoopHost, baseUrl: string) {
    this.host = host;
    this.baseUrl = baseUrl;
  }

  /** Whether both packs are in; a planet without them is simply silent underfoot and says so. */
  get ready(): boolean {
    return !!this.events && this.index.ready;
  }

  /**
   * Fetch the two shared packs, once. Neither is awaited on any visual path: until they land every
   * foot is counted and nothing plays, which is exactly what a game with no sound pack does.
   */
  load(): void {
    if (typeof window === 'undefined') return;
    if (this.eventsState === 'not fetched') {
      this.eventsState = 'loading';
      void fetch(`${this.baseUrl}assets-private/sounds/events.json`)
        .then(async (res) => (res.ok ? ((await res.json()) as SoundEventsPack) : null))
        .catch(() => null)
        .then((pack) => {
          this.adoptEvents(pack);
          this.eventsState = pack ? `${Object.keys(pack.clientData ?? {}).length} client data files` : 'no events.json; run the sounds command';
          if (!pack) console.info('sound: no events.json, so nothing has feet or a voice; run the sounds command');
        });
    }
    if (this.clipState === 'not fetched') {
      this.clipState = 'loading';
      void fetch(`${this.baseUrl}assets-private/sounds/clipEvents.json`)
        .then(async (res) => (res.ok ? ((await res.json()) as ClipEventPack) : null))
        .catch(() => null)
        .then((pack) => {
          this.index.adopt(pack);
          this.clipState = pack ? `${this.index.status().clips} clips with events` : 'no clipEvents.json; run the sounds command with --jka';
          if (!pack) console.info('sound: no clipEvents.json, so no animation says when a foot lands; run the sounds command');
        });
    }
  }

  /** A pack read elsewhere (the node test). */
  adoptEvents(pack: SoundEventsPack | null): void {
    if (!pack) return;
    this.events = pack;
  }

  /** The surface table from `sounds/sources.json`, once the bank has it. */
  setSurfaceTable(table: Record<string, { type?: string }> | null | undefined): void {
    this.surfaceTable = table ?? null;
  }

  /** Where the world's own answers come from; null outside a world (the select screen). */
  attachWorld(world: SurfaceSource | null): void {
    this.world = world;
  }

  /** A planet is loading: fetch what its own objects are made of. */
  begin(packId: string): void {
    this.leave();
    this.packId = packId;
    this.surfaceState = 'loading';
    const token = this.token;
    void fetch(`${this.baseUrl}assets-private/${packId}/sounds.json`)
      .then(async (res) => (res.ok ? ((await res.json()) as SurfacePack) : null))
      .catch(() => null)
      .then((pack) => {
        if (token !== this.token) return;
        this.surfaces = pack?.surfaces ?? {};
        this.surfaceState = pack ? `${Object.keys(this.surfaces).length} object surfaces` : 'none';
      });
  }

  /** The planet is going: every idle loop let go and every body forgotten. */
  leave(): void {
    this.token++;
    for (const v of this.voices.values()) this.dropLoop(v);
    this.voices.clear();
    this.surfaces = {};
    this.surfaceState = 'none';
    this.packId = '';
  }

  /**
   * The frame's work: which bodies are near enough to be heard, what their clips crossed, and their
   * own loops and timers. `listener` is where the ear is, which is the camera.
   */
  update(dt: number, listener: { x: number; y: number; z: number }, bodies: BodyLists): void {
    const step = Math.max(0, Math.min(0.25, dt));
    this.clock += step;
    this.sinceNear += step;
    // Which bodies are near enough to be worth watching is a walk of every body there is, so it
    // runs on its own beat rather than every frame -- the same four times a second the emitter grid
    // uses -- and the watching itself runs every frame for the few that are near.
    const sweep = this.sinceNear >= 1 / Math.max(1, this.tune.nearRate);
    if (sweep) {
      this.sinceNear = 0;
      this.pass++;
    }
    this.counts.bodies = 0;
    this.counts.near = 0;
    const w = this.where;
    const p = bodies.player;
    if (p) {
      // The player's key is 1 and nothing else's is ever 0, which is the one scheme the rest of the
      // game keys living things by.
      const self = this.voiceFor(p, 'player', 1, p.species, p.species, '');
      // The player's record is one kept object, so a change of species has to be noticed here: its
      // clips are another skeleton's and its client data another species'.
      if (self.scope !== p.species) {
        self.scope = p.species;
        self.label = p.species;
        self.data = '';
        self.watcher.forget();
      }
      w.x = p.x;
      w.y = p.y;
      w.z = p.z;
      w.heading = p.heading ?? 0;
      w.scale = 1;
      w.inside = p.inside;
      w.deck = p.deck;
      w.space = p.space;
      w.dead = p.dead;
      w.hunting = false;
      w.player = true;
      this.stepBody(self, w, null, p, listener, sweep);
    }
    for (const m of bodies.mobiles) {
      if (m.removed) continue;
      const v = this.voiceFor(m, 'mobile', m.key, m.entry.id, m.animPack?.id ?? null, m.entry.stats?.sizeClass ?? 'small');
      if (v.template === null) {
        // Written once, when the body is first met: what its client data is looked for by.
        v.template = m.entry.template ?? '';
        v.appearance = m.entry.appearance ?? null;
        v.mobileKind = m.entry.kind ?? null;
      }
      // The model, and with it the animation pack that names the clips' source, arrives after the
      // body: the scope is taken as soon as there is one.
      if (!v.scope && m.animPack) v.scope = m.animPack.id;
      w.x = m.pos.x;
      w.y = m.pos.y;
      w.z = m.pos.z;
      w.heading = m.heading ?? 0;
      // A creature's own size, which is what makes a bantha's print a bantha's and not a person's.
      w.scale = m.scale > 0 ? m.scale : 1;
      w.inside = m.inside;
      w.deck = null;
      w.space = null;
      w.dead = m.dead;
      w.hunting = m.state === 'chase' || m.state === 'attack' || m.state === 'alert';
      w.player = false;
      this.stepBody(v, w, m.ready ? m : null, m.animator, listener, sweep);
    }
    for (const f of bodies.fighters) {
      const v = this.voiceFor(f, 'fighter', f.key, f.name, f.species, '');
      w.x = f.pos.x;
      w.y = f.pos.y;
      w.z = f.pos.z;
      w.heading = f.heading ?? 0;
      w.scale = 1;
      w.inside = !!f.cell;
      w.deck = null;
      w.space = null;
      w.dead = f.dead;
      // A fighter calls out when it has something it means to fight, as a hunting creature does.
      // Every living fighter counting as hunting had a standing NPC grunting for ever.
      w.hunting = f.hunting;
      w.player = false;
      this.stepBody(v, w, null, f.rig, listener, sweep);
    }
    if (sweep) this.sweep();
  }

  /** Where the body being stepped stands, refilled per body: the update allocates nothing. */
  private readonly where = { x: 0, y: 0, z: 0, heading: 0, scale: 1, inside: false, deck: null as string | null, space: null as SoundSpace | null, dead: false, hunting: false, player: false };

  status(): Record<string, unknown> {
    const rows: Record<string, unknown>[] = [];
    for (const v of this.voices.values()) {
      if (!v.near && !v.loopKey) continue;
      rows.push({ body: v.label, kind: v.kind, clientData: v.data && v.data !== NO_DATA ? v.data : null, scope: v.scope, surface: v.lastSurface, steps: v.steps, voices: v.voices, idleLoop: v.loopKey !== 0 });
    }
    return {
      planet: this.packId || null,
      packs: { events: this.eventsState, clipEvents: this.clipState, surfaces: this.surfaceState },
      clipEvents: this.index.status(),
      bodies: this.counts.bodies,
      near: this.counts.near,
      watched: rows.slice(0, 16),
      counts: { ...this.counts },
      missingEvents: [...this.missing].slice(0, 12),
      recent: this.log.slice(-12),
      tune: { ...this.tune, ...CLIP_EVENT_TUNE },
    };
  }

  /** What is under a point right now, and which of the four sources said so: the owner's check. */
  probe(x: number, y: number, z: number, inside: boolean, player = true): Record<string, unknown> {
    const w = this.world;
    if (!w) return { ok: false, why: 'no world' };
    // Asked once each and handed to the resolver, so the ray down is cast once rather than twice.
    const object = w.objectTemplate(x, y, z, inside);
    const ground = w.groundTemplate(x, z);
    const top = w.waterTop(x, z);
    const room = inside ? w.roomSurface(x, y, z) : null;
    const once: SurfaceSource = { waterTop: () => top, roomSurface: () => room, objectTemplate: () => object, groundTemplate: () => ground, space: () => null };
    const r = resolveSurface({ x, y, z, inside, player, last: null }, once, this.names, this.tune);
    return {
      at: [Number(x.toFixed(1)), Number(y.toFixed(1)), Number(z.toFixed(1))],
      inside,
      surface: r.surface,
      from: r.from,
      waterDepth: Number((top - y).toFixed(2)),
      room,
      object: object ? { template: object, surface: this.names.object(object) } : null,
      ground: ground ? { template: ground, surface: this.names.ground(ground) } : null,
    };
  }

  // ---- one body ----

  private voiceFor(body: object, kind: Voice['kind'], key: number, label: string, scope: string | null, size: string): Voice {
    let v = this.voices.get(body);
    if (v) return v;
    v = {
      key,
      label,
      kind,
      watcher: new ClipWatcher(CLIP_EVENT_TUNE),
      data: '',
      scope,
      size: size || 'small',
      template: null,
      appearance: null,
      mobileKind: null,
      lastSurface: null,
      loopKey: 0,
      loopX: 0,
      loopY: 0,
      loopZ: 0,
      near: false,
      hostile: false,
      callAt: 0,
      dead: false,
      fallAt: 0,
      fellItself: false,
      pass: -1,
      steps: 0,
      voices: 0,
    };
    this.voices.set(body, v);
    return v;
  }

  private stepBody(v: Voice, w: { x: number; y: number; z: number; heading: number; scale: number; inside: boolean; deck: string | null; space: SoundSpace | null; dead: boolean; hunting: boolean }, loopOwner: MobileBodyLike | null, source: ClipSource | null, listener: { x: number; y: number; z: number }, sweep: boolean): void {
    const { x, y, z, inside, dead, hunting } = w;
    // A body met for the first time is measured at once rather than waiting for the next pass: a
    // creature spawned under the player's nose would otherwise stand silent for a quarter second.
    const fresh = v.pass < 0;
    v.pass = this.pass;
    this.counts.bodies++;
    const d2 = (x - listener.x) ** 2 + (y - listener.y) ** 2 + (z - listener.z) ** 2;
    if (sweep || fresh) {
      const was = v.near;
      v.near = d2 <= this.tune.range * this.tune.range;
      // Coming back within earshot, every clip's clock is picked up where it stands: a body walked
      // away from and back would otherwise fire every step it took meanwhile on one frame.
      if (v.near && !was) v.watcher.forget();
      this.stepLoop(v, loopOwner, x, y, z, d2);
    }
    if (v.near) this.counts.near++;
    // A death is heard wherever it happens (it is a one-shot at a place, and the mixer's own
    // distance rule fades it), so the fall is timed whether or not the body is near.
    if (dead !== v.dead) {
      v.dead = dead;
      if (dead) {
        v.fallAt = this.clock + this.tune.deathFall;
        v.fellItself = false;
        this.dropLoop(v);
      } else v.fallAt = 0;
    }
    // The space everything this body plays belongs to, set before the first of them: aboard a hull
    // the game hands it over, because no streamed building stands at the point.
    this.foot.space = w.space;
    // The clips a falling body is playing are read whether or not it is near, since the fall itself
    // is: a body that died out of earshot would otherwise always take the invented timer, and then
    // its own death clip's mark as well if the player walked up while it was still playing.
    let clipCount = -1;
    if (v.fallAt && source) {
      clipCount = source.activeClips(this.clips);
      if (clipCount) this.checkOwnFall(v, clipCount);
    }
    if (v.fallAt && this.clock >= v.fallAt) {
      v.fallAt = 0;
      // Only when the death clip carried no fall of its own, which many of the game's do.
      if (!v.fellItself) {
        this.counts.falls++;
        this.speak(v, 'hitground', x, y, z, inside);
      }
    }
    if (!v.near) return;
    // A creature that has turned on something calls out, and goes on calling while it hunts. The
    // server did this in the game; the timing is ours.
    if (!dead) {
      if (hunting !== v.hostile) {
        v.hostile = hunting;
        // Turning on something is the call: it speaks at once and then now and again while it hunts.
        if (hunting) v.callAt = this.clock;
      }
      if (hunting && this.clock >= v.callAt) {
        const [lo, hi] = this.tune.call;
        this.counts.calls++;
        this.speak(v, 'vocalize', x, y, z, inside);
        // Spread, so a pack that turns together does not speak in chorus.
        v.callAt = this.clock + lo + Math.random() * Math.max(0, hi - lo);
      }
    }
    if (!source) return;
    // Already asked for this frame while the fall was being judged: the same actions, the same times.
    const n = clipCount >= 0 ? clipCount : source.activeClips(this.clips);
    if (!n) return;
    this.live = v;
    this.liveDistance = Math.sqrt(d2);
    this.foot.x = x;
    this.foot.y = y;
    this.foot.z = z;
    this.foot.heading = w.heading;
    this.foot.scale = w.scale;
    this.foot.inside = inside;
    this.foot.deck = w.deck;
    this.foot.player = v.kind === 'player';
    v.watcher.step(this.clips, n, this.index, this.scopeOf(v, loopOwner), this.sink);
    this.live = null;
  }

  /**
   * Whether the clips a dying body is playing mark a fall of their own. Only walked while a body is
   * falling, which is a handful of frames per death.
   */
  private checkOwnFall(v: Voice, n: number): void {
    for (let i = 0; i < n; i++) {
      const events = this.index.eventsFor(this.clips[i].name, this.clips[i].half, v.scope);
      if (!events) continue;
      for (const e of events) {
        if (e.name !== 'hitground') continue;
        v.fellItself = true;
        v.fallAt = 0;
        return;
      }
    }
  }

  /** Where the body whose events are being read stands; a field, so the sink makes no closure. */
  private readonly foot = { x: 0, y: 0, z: 0, heading: 0, scale: 1, inside: false, deck: null as string | null, space: null as SoundSpace | null, player: false };
  /** The one step handed to whoever is listening, refilled: a foot landing allocates nothing. */
  private readonly stepOut: FootStep = { key: 0, kind: 'player', label: '', surface: null, from: 'default', x: 0, y: 0, z: 0, heading: 0, scale: 1, inside: false, deck: null, ground: null };
  /**
   * The step's own question about the ground it landed on, answered from where that step happened.
   * A bound field rather than a closure per step, so a foot landing allocates nothing; it is put on
   * the record once below and reads `this.foot`, which is the step being handed over.
   */
  private readonly askGround = (out: FootGround): boolean => {
    const w = this.world;
    if (!w || !w.footGround) return false;
    return w.footGround(this.foot.x, this.foot.y, this.foot.z, this.foot.inside, out);
  };
  /** The one question asked of the resolver, refilled: a step allocates nothing. */
  private readonly query = { x: 0, y: 0, z: 0, inside: false, player: false, last: null as string | null, deck: null as string | null };

  /**
   * What the two packs call each surface. The planet's pack writes a row for every object template
   * whose `surfaceType` is something of its own; the commonest value by far is 0, which the client
   * reads as "no surface of its own", and the game falls through to the ground underneath. So an
   * object the pack does not name answers nothing at all and the terrain decides -- a rock is the
   * sand it stands in. (`soundplaces.mjs`: 765 of the 1,170 templates one planet places are 0, and
   * the pack writes 124 explicit stone rows, so absence cannot mean stone.) The shared table names
   * the nine terrain surfaces.
   */
  private readonly names: SurfaceNames = {
    object: (template) => this.surfaces[template] ?? null,
    ground: (template) => surfaceWord(template, this.surfaceTable),
  };

  /** Handed to every watcher: one event of one body, played where that body stands. */
  private readonly sink = (event: ClipEvent, clip: ActiveClip): void => {
    const v = this.live;
    if (!v) return;
    if (event.kind === 'foot') {
      this.counts.steps++;
      v.steps++;
      this.playFoot(v, event, clip);
      return;
    }
    if (event.kind === 'voice') {
      // Jedi Academy's own voice events (`*pain25`, `*death%d`): the set's name is the letters it
      // opens with, and the species' own sound stands in for the character's voice.
      const set = event.name.replace(/^\*/, '').toLowerCase().replace(/[^a-z].*$/, '');
      const name = JKA_VOICE[set];
      if (!name) return;
      this.counts.voices++;
      v.voices++;
      this.speak(v, name, this.foot.x, this.foot.y, this.foot.z, this.foot.inside);
      return;
    }
    if (event.kind === 'sound') return; // a file pattern (Jedi Academy's swings): a later wave's
    if (event.name === 'hitground') v.fellItself = true;
    this.counts.voices++;
    v.voices++;
    this.speak(v, event.name, this.foot.x, this.foot.y, this.foot.z, this.foot.inside);
  };

  private playFoot(v: Voice, event: ClipEvent, clip: ActiveClip): void {
    const world = this.world;
    const chance = event.chance;
    // Jedi Academy's own footsteps carry a chance out of a hundred, in which nought means always;
    // the game's own carry none and always land.
    if (chance !== undefined && chance > 0 && Math.random() * 100 > chance) return;
    const q = this.query;
    q.x = this.foot.x;
    q.y = this.foot.y;
    q.z = this.foot.z;
    q.inside = this.foot.inside;
    q.player = this.foot.player;
    q.last = v.lastSurface;
    q.deck = this.foot.deck;
    const r = world ? resolveSurface(q, world, this.names, this.tune) : { surface: v.lastSurface, from: 'last' as FootSource };
    if (r.surface) v.lastSurface = r.surface;
    let sound: string | null = null;
    if (r.surface) {
      const data = this.dataFor(v);
      const events = data?.events;
      sound = (r.surface && events?.[`footstep_${r.surface}`]) || events?.footstep || this.sizeStep(v);
    }
    const key = sound ? this.play(sound, this.foot.x, this.foot.y, this.foot.z, this.foot.inside) : 0;
    if (key) this.counts.stepsPlayed++;
    else if (sound) this.counts.noSound++;
    // Rounded with arithmetic rather than `toFixed`, which would make a string per step to throw away.
    this.note({ at: Math.round(this.clock * 100) / 100, body: v.label, clip: clip.name, event: event.name, surface: r.surface, from: r.from, sound, key, distance: Math.round(this.liveDistance * 10) / 10 });
    // And whoever else wants to know that a foot landed here, on the same mark and the same frame:
    // the world's own prints. One kept record, filled and handed over; nothing is allocated, and a
    // listener that throws is its own affair -- the sound has already played.
    const hook = this.onStep;
    if (!hook) return;
    const out = this.stepOut;
    out.key = v.key;
    out.kind = v.kind;
    out.label = v.label;
    out.surface = r.surface;
    out.from = r.from;
    out.x = this.foot.x;
    out.y = this.foot.y;
    out.z = this.foot.z;
    out.heading = this.foot.heading;
    out.scale = this.foot.scale;
    out.inside = this.foot.inside;
    out.deck = this.foot.deck;
    out.ground = this.askGround;
    hook(out);
  }

  /**
   * One of a body's named voices (`vocalize`, `hitheavy`, `hitground`, `swim`, an emote's).
   *
   * Nothing is cut off by distance: the mixer's own falloff decides what is heard, and a death
   * across a valley should fade rather than vanish.
   */
  private speak(v: Voice, name: string, x: number, y: number, z: number, inside: boolean): void {
    const data = this.dataFor(v);
    let sound = data?.events?.[name] ?? null;
    if (!sound && name === 'hitground') sound = SIZE_FALLS[v.size] ?? null;
    if (!sound) {
      // A hardpoint or weapon-effect mark is not a voice and no client data holds one, so it is not
      // reported as something the body is missing.
      if (this.missing.size < 200 && !NOT_A_VOICE.test(name)) this.missing.add(`${v.label}:${name}`);
      return;
    }
    if (this.play(sound, x, y, z, inside)) this.counts.voicesPlayed++;
  }

  /**
   * A sound or a client effect's own sound, at a point in whatever room that point is in.
   *
   * The space matters: the mixer puts a low-pass over anything the ear is not in the same space as.
   * Aboard a ship the game hands the hull's own space over (`this.foot.space`), because there is no
   * streamed building at the point and asking the world would put the body's own boots outside the
   * hull the ear is in and muffle every step it takes.
   */
  private play(id: string, x: number, y: number, z: number, inside: boolean): number {
    const sound = this.soundOf(id);
    if (!sound) return 0;
    let space: SoundSpace | undefined;
    const given = this.foot.space;
    if (given) {
      this.space.building = given.building;
      this.space.cell = given.cell;
      space = this.space;
    } else if (inside && this.world) {
      const found = this.world.space(x, y, z);
      if (found) {
        this.space.building = found.building;
        this.space.cell = found.cell;
        space = this.space;
      }
    }
    return this.host.play(sound, { x, y, z, space });
  }

  /** A client effect stands for its first sound, which is how the game's footstep effects are used. */
  private soundOf(id: string): string | null {
    if (!id) return null;
    if (!id.endsWith('.cef')) return id;
    return this.events?.clientEffects?.[id]?.sounds?.[0] ?? null;
  }

  private sizeStep(v: Voice): string | null {
    if (v.kind !== 'mobile') return null;
    return SIZE_STEPS[v.size] ?? SIZE_STEPS.small;
  }

  /** The scope a body's clip names are resolved in, registering a mobile's animation pack once. */
  private scopeOf(v: Voice, owner: MobileBodyLike | null): string | null {
    const pack = owner?.animPack;
    if (pack && !this.index.hasScope(pack.id)) {
      // The pack's own JSON says which animation each clip was baked from, which is the map the
      // converter cannot write for a pack it did not make. Walked once per pack, not per body.
      const rows: [string, string][] = [];
      for (const c of pack.json?.clips ?? []) if (c?.name && c.file) rows.push([c.name, c.file]);
      this.index.registerNames(pack.id, rows);
    }
    return v.scope;
  }

  /**
   * The client data a body speaks from, looked for once and then kept. The converter's own map is
   * the answer where it has one (only the template chain can say); the guesses after it are ours,
   * and the last of them is the game's own people, so nothing is ever left without feet.
   */
  private dataFor(v: Voice): ClientDataEntry | null {
    const pack = this.events;
    if (!pack) return null;
    // A body whose search came up empty remembers that it did: the sentinel is what stops the whole
    // guess list running again on every foot event and every sweep, and it is what makes `noData` a
    // count of speechless bodies rather than of lookups.
    if (v.data) return v.data === NO_DATA ? null : (pack.clientData?.[v.data] ?? null);
    const found = this.findData(v, pack);
    if (found) {
      v.data = found;
      return pack.clientData?.[found] ?? null;
    }
    v.data = NO_DATA;
    this.counts.noData++;
    return null;
  }

  private findData(v: Voice, pack: SoundEventsPack): string | null {
    const data = pack.clientData ?? {};
    const tries: (string | undefined)[] = [];
    if (v.kind === 'player' || v.kind === 'fighter') {
      const species = v.scope ?? '';
      const template = v.kind === 'player' ? this.playerTemplate : null;
      // The converter's own answer first: it followed the template chain, which is the only way a
      // Bothan (whose template names the human files) can be got right.
      if (species) tries.push(this.index.clientDataForSpecies(species) ?? undefined);
      if (template) tries.push(this.index.clientDataForSpecies(template) ?? undefined, pack.species?.[template]);
      tries.push(pack.species?.[`object/creature/player/shared_${species}.iff`]);
      // Ours: the species packs are named `<species>_<male|female>` and the client data
      // `<species>_<m|f>`, which reaches every species the game shipped but the Bothans.
      const m = /^(.+)_(male|female)$/.exec(species);
      if (m) tries.push(`clientdata/player/client_shared_player_${m[1]}_${m[2][0]}.cdf`);
      tries.push(...PERSON_FALLBACK);
    } else {
      const template = v.template ?? '';
      if (template) tries.push(this.index.clientDataForTemplate(template) ?? undefined, pack.mobiles?.[template]);
      // Ours: the names the archives use, measured at 3,709 of the catalogue's 5,067 entries. The
      // converter's own map is what reaches the rest, and `__debug.footsteps()` counts what is left.
      const names = new Set<string>();
      const short = template.split('/').pop()?.replace(/\.iff$/i, '').replace(/^shared_/, '');
      if (short) names.add(short);
      if (v.appearance) {
        names.add(v.appearance);
        names.add(v.appearance.replace(/_hue$/, ''));
      }
      for (const folder of DATA_FOLDERS) for (const n of names) for (const p of DATA_PREFIXES) tries.push(`clientdata/${folder}/client_shared_${p}${n}.cdf`);
      // A person from the catalogue with nothing of its own steps and speaks as the game's people
      // do. A droid does not: it would scream like a man when it was struck. INVENTED: a droid with
      // no client data of its own gets its size's step below and stays silent otherwise.
      if (v.kind === 'mobile' && v.mobileKind !== 'creature' && v.mobileKind !== 'droid') tries.push(...PERSON_FALLBACK);
    }
    for (const key of tries) if (key && data[key]) return key;
    return null;
  }

  /** The player's own species template, set by the game when a character is put on. */
  playerTemplate: string | null = null;

  private stepLoop(v: Voice, owner: MobileBodyLike | null, x: number, y: number, z: number, d2: number): void {
    // Only a mobile has a loop of its own so far: the client data's `ASND`, a creature's breathing.
    if (!owner || v.dead) {
      this.dropLoop(v);
      return;
    }
    const want = d2 <= this.tune.loopRange * this.tune.loopRange && owner.ready && !owner.dead;
    if (!want) {
      // Kept while it is only a little too far, so walking round a creature does not restart its breath.
      if (v.loopKey && d2 > (this.tune.loopRange * 1.5) ** 2) this.dropLoop(v);
      return;
    }
    if (!v.loopKey) {
      if (this.counts.loops >= this.tune.loops) return;
      const id = this.dataFor(v)?.ambient;
      if (!id) return;
      const key = this.host.loop(id, { x, y, z });
      if (!key) return;
      v.loopKey = key;
      v.loopX = x;
      v.loopY = y;
      v.loopZ = z;
      this.counts.loops++;
      return;
    }
    if (!this.host.isPlaying(v.loopKey)) {
      v.loopKey = 0;
      // Never below zero, as `dropLoop` does: a count that went negative would silently let more
      // loops through than the budget allows.
      this.counts.loops = Math.max(0, this.counts.loops - 1);
      return;
    }
    const moved = (x - v.loopX) ** 2 + (y - v.loopY) ** 2 + (z - v.loopZ) ** 2;
    if (moved < this.tune.loopStep * this.tune.loopStep) return;
    v.loopX = x;
    v.loopY = y;
    v.loopZ = z;
    this.host.move(v.loopKey, x, y, z);
  }

  private dropLoop(v: Voice): void {
    if (!v.loopKey) return;
    this.host.stop(v.loopKey, 0.2);
    v.loopKey = 0;
    this.counts.loops = Math.max(0, this.counts.loops - 1);
  }

  /** Bodies that were not in this frame's lists are gone: their loops go with them. */
  private sweep(): void {
    for (const [body, v] of this.voices) {
      if (v.pass === this.pass) continue;
      this.dropLoop(v);
      this.voices.delete(body);
    }
  }

  private note(row: FootLogRow): void {
    this.log.push(row);
    if (this.log.length > 40) this.log.splice(0, this.log.length - 40);
  }
}
