// The instances: the dungeons the game stood a copy of for each group, how a player gets into one and
// how they get out again.
//
// A copy is an ordinary portal building in a zone of copies. The Corellian corvette, the heroic Star
// Destroyer, Axkva Min's prison, IG-88's arena, the Exar Kun tomb and the meatlump hideout are each ten
// or sixteen copies parked in the `dungeon1` zone; Mustafar parks its five dungeons in rows in a far
// corner of its own map, and the tree world parks the Myyydril caverns and the Avatar Platform in a zone
// of their own. Nothing in the client says how a player reached one: that was the server's, and it
// moved them there with a loading screen. So every way in here is ours, and so is every way out, and
// this file is the table of both and the rules round them. A node test runs it.
//
// **The ways in.** The corvette is reached through the pilot who takes your ticket, by faction (who sends
// you where is the emulator's: `readCorvette`'s takers, carried on their rows as `takes`), the Star
// Destroyer and the Avatar Platform from your own ship docked at the hull or the station in orbit (the
// owner's call: "Go aboard" in the ship menu), and every other one at a thing the world itself places
// where the dungeon's way in was -- the Exar Kun entrance at the temple on Yavin 4, the meatlump hideout's
// own ladder under Coronet, the Myyydril cave's door in the dead forest, and each of Mustafar's dungeon
// doors. Two are ours outright and say so (`ours`): the client places nothing that names Axkva Min's or
// IG-88's way in, so the Nightsister scroll on Dathomir and the IG-88 component beside the walled yard on
// Lok, both of them the client's own pieces of those two stories, stand for them; and which of
// Mustafar's two droid factories the factory's door and its keypad each open is ours too, since the
// server chose by the quest.
//
// **Which copy.** A group must all go to one copy and two groups to two, so the copy is a hash of the
// group's id, or with no group the character's, over that dungeon's copies in a fixed order (`copyOf`).
// Nothing is sent: every member works out the same copy, and anybody following the group's crossing
// comes out beside the leader anyway.
//
// **The way out** is where you came in. Each arrival keeps a record of where it came from (`WayBack`),
// and the arrival room within `exitReach` of the spot the player was stood on is the way out, as is any
// of the dungeon's own exits (an Exar Kun rubble door, Axkva Min's chamber door, IG-88's exit terminal, a
// meatlump ladder, the Avatar Platform's ship terminal) and the corvette's escape pods. The corvette is
// left for the taker who sent you, `takerStep` in front of them; a hull boarded from your ship is left for
// that ship, docked where you left it.
//
// Every number is ours and lives in `INSTANCE_TUNE`, live through `__debug.instances({ tune })`.

/** One dungeon: the copies it is, the world they stand in, and where a player is stood in one. */
export interface InstanceDef {
  kind: string;
  /** What the loading screen and the message line call it. Ours. */
  name: string;
  /** The world its copies stand in, as a travel names it (a planet id and, for the tree world, its zone). */
  planet: string;
  zone?: string;
  /** The building templates its copies are placed as. */
  templates: readonly string[];
  /** The room a player is stood in, by the layout's own name; '' for the room its way in opens into. */
  room: string;
  /** Things inside a copy that are a way out, by template. */
  exits: readonly string[];
}

/** The three corvette runs by the faction the taker sends a player for: the copy's template carries the word. */
export const CORVETTE_TEMPLATES: Readonly<Record<string, string>> = {
  neutral: 'object/building/general/shared_space_dungeon_corellian_corvette.iff',
  imperial: 'object/building/general/shared_space_dungeon_corellian_corvette_imperial.iff',
  rebel: 'object/building/general/shared_space_dungeon_corellian_corvette_rebel.iff',
};

export const INSTANCES: readonly InstanceDef[] = [
  // The run the Alliance flew, against a ship the Empire held; the Empire's, against a Rebel blockade runner; and the Hutts', against CorSec.
  { kind: 'corvette_rebel', name: 'an Imperial-held corvette', planet: 'dungeon1', templates: [CORVETTE_TEMPLATES.rebel], room: 'airlock1', exits: [] },
  { kind: 'corvette_imperial', name: 'a Rebel blockade runner', planet: 'dungeon1', templates: [CORVETTE_TEMPLATES.imperial], room: 'airlock1', exits: [] },
  { kind: 'corvette_neutral', name: 'a CorSec corvette', planet: 'dungeon1', templates: [CORVETTE_TEMPLATES.neutral], room: 'airlock1', exits: [] },
  { kind: 'stardestroyer', name: 'the Star Destroyer', planet: 'dungeon1', templates: ['object/building/general/shared_space_dungeon_star_destroyer.iff'], room: 'mainhangar', exits: [] },
  { kind: 'exarkun', name: 'the Tomb of Exar Kun', planet: 'dungeon1', templates: ['object/building/heroic/shared_exar_kun_tomb.iff'], room: '', exits: ['object/tangible/door/shared_exar_kun_exit.iff'] },
  { kind: 'axkva', name: "Axkva Min's prison", planet: 'dungeon1', templates: ['object/building/heroic/shared_axkva_min_lair.iff'], room: '', exits: ['object/tangible/door/shared_heroic_axkva_min_door_exit.iff'] },
  { kind: 'ig88', name: "IG-88's arena", planet: 'dungeon1', templates: ['object/building/heroic/shared_ig88_factory_arena.iff'], room: '', exits: ['object/tangible/quest/township/shared_ig88_instance_exit.iff'] },
  { kind: 'meatlump', name: 'the meatlump hideout', planet: 'dungeon1', templates: ['object/building/content/meatlump/shared_mtp_instance_bunker.iff'], room: 'entry', exits: ['object/tangible/meatlump/hideout/shared_mtp_hideout_ladder_exit.iff'] },
  { kind: 'myyydril', name: 'the Myyydril Caverns', planet: 'kashyyyk', zone: 'pob_dungeons', templates: ['object/building/kashyyyk/shared_thm_kash_myyydril_caverns.iff'], room: '', exits: [] },
  { kind: 'avatar', name: 'the Avatar Platform', planet: 'kashyyyk', zone: 'pob_dungeons', templates: ['object/building/general/shared_dungeon_avatar_platform.iff'], room: 'entrance', exits: ['object/tangible/terminal/shared_terminal_space.iff'] },
  { kind: 'uplink', name: 'the uplink cave', planet: 'mustafar', templates: ['object/building/mustafar/dungeon/establish_uplink/shared_uplink_cave.iff'], room: '', exits: [] },
  { kind: 'crystal', name: 'the lair of the crystal', planet: 'mustafar', templates: ['object/building/mustafar/dungeon/obiwan_finale/shared_lair_of_the_crystal.iff'], room: '', exits: [] },
  { kind: 'sherkar', name: "Sher Kar's lair", planet: 'mustafar', templates: ['object/building/mustafar/dungeon/monster_lair/shared_must_monster_lair.iff'], room: '', exits: [] },
  { kind: 'republic', name: 'the Old Republic facility', planet: 'mustafar', templates: ['object/building/mustafar/dungeon/shared_old_republic_facility.iff'], room: '', exits: [] },
  { kind: 'decrepit', name: 'the decrepit droid factory', planet: 'mustafar', templates: ['object/building/mustafar/dungeon/shared_decrepit_droid_factory.iff'], room: '', exits: [] },
  { kind: 'working', name: 'the working droid factory', planet: 'mustafar', templates: ['object/building/mustafar/dungeon/shared_working_droid_factory.iff'], room: '', exits: [] },
];

/** A thing the world places that is a dungeon's way in: the pack it stands in, its template and the dungeon. */
export interface EntranceDef {
  pack: string;
  template: string;
  kind: string;
  /** The link is ours: the client places the thing, and nothing says it was this dungeon's way in. */
  ours: boolean;
}

export const ENTRANCES: readonly EntranceDef[] = [
  { pack: 'yavin4', template: 'object/tangible/quest/heroic/shared_heroic_exar_kun_entrance.iff', kind: 'exarkun', ours: false },
  { pack: 'corellia', template: 'object/tangible/meatlump/hideout/shared_mtp_hideout_ladder_enter.iff', kind: 'meatlump', ours: false },
  { pack: 'kashyyyk_dead_forest', template: 'object/tangible/door/shared_thm_kash_cave_myyydril_door.iff', kind: 'myyydril', ours: false },
  { pack: 'mustafar', template: 'object/building/mustafar/structures/shared_must_uplink_bunker_entrance_door.iff', kind: 'uplink', ours: false },
  { pack: 'mustafar', template: 'object/tangible/dungeon/mustafar/obiwan_finale/shared_obiwan_finale_entrance_stone.iff', kind: 'crystal', ours: false },
  { pack: 'mustafar', template: 'object/building/mustafar/structures/shared_must_sherkar_door.iff', kind: 'sherkar', ours: false },
  { pack: 'mustafar', template: 'object/building/mustafar/structures/shared_old_republic_facility_door_exterior.iff', kind: 'republic', ours: false },
  { pack: 'mustafar', template: 'object/building/mustafar/structures/shared_droid_factory_exterior_door.iff', kind: 'decrepit', ours: true },
  { pack: 'mustafar', template: 'object/tangible/item/som/shared_droid_factory_entrance_keypad.iff', kind: 'working', ours: true },
  { pack: 'dathomir', template: 'object/tangible/quest/township/shared_axkva_nightsister_scroll.iff', kind: 'axkva', ours: true },
  { pack: 'lok', template: 'object/tangible/quest/township/shared_ig88_feeder_component_06.iff', kind: 'ig88', ours: true },
];

/** A hull or a station in space whose dungeon is reached from a ship docked at it: the zone and the station's name or the hull's model. */
export interface AboardDef {
  zone: string;
  /** Matched against the docked target's own name (a station's) or its model (a hull of scenery). */
  name?: string;
  model?: string;
  kind: string;
}

export const ABOARD: readonly AboardDef[] = [
  { zone: 'space_heavy1', model: 'star_destroyer_space', kind: 'stardestroyer' },
  { zone: 'space_kashyyyk', name: 'spacestation_avatar_platform', kind: 'avatar' },
];

/** Every number of ours. */
export const INSTANCE_TUNE = {
  /** How near a keypad, a room panel or an escape pod's console must be to be used, metres. */
  useReach: 2.5,
  /** How near the spot an arrival was stood on, in the arrival room, the way out is, metres. */
  exitReach: 6,
  /** How near a dungeon's own exit, and a way in out in the world, must be, metres. */
  thingReach: 4,
  /** How far in front of the taker who sent them a player is put back, metres. */
  takerStep: 3,
};

/** Set the live numbers (the console's one call), a number only ever by a positive number. */
export function tuneInstances(o?: Partial<typeof INSTANCE_TUNE> | null): typeof INSTANCE_TUNE {
  if (!o) return INSTANCE_TUNE;
  const into = INSTANCE_TUNE as unknown as Record<string, number>;
  for (const [k, v] of Object.entries(o)) if (k in INSTANCE_TUNE && typeof v === 'number' && Number.isFinite(v) && v > 0) into[k] = v;
  return INSTANCE_TUNE;
}

/** The dungeon of a kind, or null. */
export function instanceOf(kind: string): InstanceDef | null {
  return INSTANCES.find((d) => d.kind === kind) ?? null;
}

/** The dungeon a building template is a copy of, or null. */
export function instanceOfTemplate(template: string): InstanceDef | null {
  return INSTANCES.find((d) => d.templates.includes(template)) ?? null;
}

/** The corvette a taker sends a player to, by the faction its row says (`takes`), or null. */
export function corvetteFor(takes: string | null | undefined): InstanceDef | null {
  return takes ? instanceOf(`corvette_${takes}`) : null;
}

/** The pack a dungeon's world loads from: the planet's own, or its zone's. */
export function packOfInstance(def: Pick<InstanceDef, 'planet' | 'zone'>): string {
  return def.zone && def.planet === 'kashyyyk' ? `kashyyyk_${def.zone}` : def.planet;
}

/** A thing placed in a world, as the copies and the entrances are read: its template and its place in the game's frame. */
export interface PlacedLike {
  template: string;
  x: number;
  y: number;
  z: number;
  contained?: boolean;
}

/** A dungeon's copies among what a world places, in a fixed order (across, then along), so every browser counts them alike. */
export function copiesOf<T extends PlacedLike>(objects: readonly T[], def: Pick<InstanceDef, 'templates'>): T[] {
  return objects.filter((o) => !o.contained && def.templates.includes(o.template)).sort((a, b) => a.x - b.x || a.z - b.z);
}

/** Which of `count` copies a group (or a character on its own) is sent to: the same answer for the same id and dungeon, everywhere. */
export function copyIndex(id: string, kind: string, count: number): number {
  if (!(count > 0)) return -1;
  let h = 0x811c9dc5;
  const text = `${kind}|${id}`;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) % count;
}

/** The ways in a world places, by template, for one pack. */
export function entrancesOf(pack: string): EntranceDef[] {
  return ENTRANCES.filter((e) => e.pack === pack);
}

/** The dungeon reached from a ship docked at a target in a zone, or null. */
export function aboardOf(zone: string, docked: { name?: string | null; model?: string | null } | null): AboardDef | null {
  if (!docked) return null;
  return ABOARD.find((a) => a.zone === zone && ((a.name && a.name === docked.name) || (a.model && a.model === docked.model))) ?? null;
}

/**
 * Where a player is put back by the taker who sent them: `takerStep` in front of where the taker stands
 * (the way it faces, `atan2(x, z)` in the world's frame), facing it.
 */
export function besideTaker(x: number, z: number, heading: number, step: number = INSTANCE_TUNE.takerStep): { x: number; z: number; heading: number } {
  const sx = Math.sin(heading);
  const sz = Math.cos(heading);
  return { x: x + sx * step, z: z + sz * step, heading: Math.atan2(-sx, -sz) };
}

/** Where a player came from, to be put back there: a world and a spot, or a ship docked in space. */
export interface WayBack {
  kind: string;
  /** The world to go back to, as a travel names it. */
  planet: string;
  zone?: string;
  /** The spot in that world's frame, and the way to face. */
  at: [number, number, number];
  heading: number;
  /** The spot is inside a building: stand in its room again. */
  indoors?: boolean;
  /**
   * Left from a ship: that ship, stood again where it was, docked again where it was docked (`dock`), and
   * hanging where it flew otherwise (a member who followed the group in from the controls of their own).
   */
  ship?: { def: string; condition: unknown; dock?: { key: string; lane: string }; pos: [number, number, number]; quat: [number, number, number, number] };
}

/** A way back as kept between sessions: anything that is not a well-formed record reads as none. */
export function readWayBack(v: unknown): WayBack | null {
  if (!v || typeof v !== 'object') return null;
  const w = v as Partial<WayBack>;
  const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (typeof w.kind !== 'string' || typeof w.planet !== 'string' || !Array.isArray(w.at) || w.at.length !== 3 || !w.at.every(num) || !num(w.heading)) return null;
  const out: WayBack = { kind: w.kind, planet: w.planet, at: [w.at[0], w.at[1], w.at[2]], heading: w.heading };
  if (typeof w.zone === 'string' && w.zone) out.zone = w.zone;
  if (w.indoors === true) out.indoors = true;
  const s = w.ship;
  if (s && typeof s === 'object' && typeof s.def === 'string' && Array.isArray(s.pos) && s.pos.length === 3 && s.pos.every(num) && Array.isArray(s.quat) && s.quat.length === 4 && s.quat.every(num)) {
    // A dock is kept only whole: half of one would dock the ship at nothing, so it is flown free instead.
    const dock = s.dock && typeof s.dock === 'object' && typeof s.dock.key === 'string' && typeof s.dock.lane === 'string' ? { key: s.dock.key, lane: s.dock.lane } : null;
    out.ship = { def: s.def, condition: s.condition ?? null, ...(dock ? { dock } : {}), pos: [s.pos[0], s.pos[1], s.pos[2]], quat: [s.quat[0], s.quat[1], s.quat[2], s.quat[3]] };
  }
  return out;
}

/**
 * The way back when none was kept (a character saved inside a copy and loaded again, a record lost): the
 * dungeon's own way in, at that world's own arrival. A corvette goes back to the taker's world, a hull
 * boarded from orbit to that orbit.
 */
export function fallbackBack(kind: string): { planet: string; zone?: string } {
  if (kind === 'corvette_rebel') return { planet: 'corellia' };
  if (kind === 'corvette_imperial') return { planet: 'naboo' };
  if (kind === 'corvette_neutral') return { planet: 'tatooine' };
  const aboard = ABOARD.find((a) => a.kind === kind);
  if (aboard) return { planet: aboard.zone };
  const entrance = ENTRANCES.find((e) => e.kind === kind);
  if (entrance) {
    if (entrance.pack.startsWith('kashyyyk_')) return { planet: 'kashyyyk', zone: entrance.pack.slice('kashyyyk_'.length) };
    return { planet: entrance.pack };
  }
  return { planet: 'tatooine' };
}

// ---- The corvette's locked rooms ----
//
// Seven of the corvette's rooms were shut until a keypad by the door or a panel elsewhere on the ship was
// used: the emulator's own list is exactly the rooms its keypads and panels name (`opens`), so a room is
// locked in a copy when any of that copy's fittings opens it, and open from the moment one is used. A
// locked room's doors refuse everybody (`Doors.mayOpen`), the crew inside it as well as the player, and
// the lift will not stop at one. Kept per copy by the thing the layout placed for it (`PlacedObject`), which
// outlives the building streamed out and back, so the same copy keeps the same doors; let go of with the world.
//
// A copy's locks are made once, from its fittings, and a room may be opened before then: by another member of
// the group at their keypad (the word they send), or because the player is standing in it when the copy comes
// back (a character saved in a room they had opened). `open` holds such a room until the locks are made, and
// they are made without it.

export class InstanceLocks<K = unknown> {
  private readonly locked = new Map<K, Set<number>>();
  /** Rooms opened in a copy whose locks were not made yet, to be left out when they are. */
  private readonly opened = new Map<K, Set<number>>();

  /**
   * A copy's locked rooms, from the rooms its keypads and panels open, less any opened before (`open`); a copy
   * already known keeps what was unlocked. Its caller must hand the copy's whole list: an empty one made from
   * fittings that had not arrived yet would stand for good (`App.lockCopy` waits for them).
   */
  lock(key: K, cells: Iterable<number>): void {
    if (this.locked.has(key)) return;
    const set = new Set<number>();
    const before = this.opened.get(key);
    for (const c of cells) if (c > 0 && !before?.has(c)) set.add(c);
    this.opened.delete(key);
    this.locked.set(key, set);
  }

  /** A room of a copy opened: answers whether it was locked. */
  unlock(key: K, cell: number): boolean {
    return this.locked.get(key)?.delete(cell) ?? false;
  }

  /**
   * A room of a copy opened whether or not its locks are made yet: at once when they are, and left out of them
   * when they are made. Answers whether it was locked now.
   */
  open(key: K, cell: number): boolean {
    if (!(cell > 0)) return false;
    if (this.locked.has(key)) return this.unlock(key, cell);
    let set = this.opened.get(key);
    if (!set) this.opened.set(key, (set = new Set()));
    set.add(cell);
    return false;
  }

  /** Whether a room of a copy is locked. */
  isLocked(key: K, cell: number): boolean {
    return this.locked.get(key)?.has(cell) ?? false;
  }

  /** Whether a door between two rooms of a copy stays shut: either side is a locked room. Nothing allocated. */
  refuses(key: K, cells: readonly number[]): boolean {
    if (!this.locked.size) return false;
    const set = this.locked.get(key);
    if (!set || !set.size) return false;
    for (let i = 0; i < cells.length; i++) if (set.has(cells[i])) return true;
    return false;
  }

  /** Whether a copy's locks are known yet. */
  knows(key: K): boolean {
    return this.locked.has(key);
  }

  /** The rooms still locked in a copy, for the console. */
  lockedIn(key: K): number[] {
    return [...(this.locked.get(key) ?? [])].sort((a, b) => a - b);
  }

  get copies(): number {
    return this.locked.size;
  }

  clear(): void {
    this.locked.clear();
    this.opened.clear();
  }
}

// ---- What E does here ----

/** What the use key does in or at a dungeon, as the bar and the key both read it. */
export type InstanceUse = '' | 'keypad' | 'pod' | 'in' | 'out';

/** Where the player stands, flat, as the rule wants it. */
export interface InstanceWhere {
  /** On foot in the world, simulating, not travelling. */
  live: boolean;
  /** A keypad or a room panel within `useReach` that opens a room still locked. */
  keypad: boolean;
  /** An escape pod's console within `useReach`. */
  pod: boolean;
  /** In the arrival room within `exitReach` of the arrival spot, or by one of the dungeon's own exits. */
  wayOut: boolean;
  /** A thing the world places as a dungeon's way in, within `thingReach`. */
  wayIn: boolean;
}

/** The one rule: a keypad first (it is the thing in front of you), then a pod, then the way out, then a way in. */
export function instanceUse(w: InstanceWhere): InstanceUse {
  if (!w.live) return '';
  if (w.keypad) return 'keypad';
  if (w.pod) return 'pod';
  if (w.wayOut) return 'out';
  if (w.wayIn) return 'in';
  return '';
}

/** The words for the rooms a corvette's keypads open, whose names in the data run together; ours. */
const ROOM_WORDS: ReadonlyMap<string, string> = new Map([
  ['meetingroom', 'meeting room'],
  ['armorybackroom', "armory's back room"],
  ['officerquarters', "officers' quarters"],
  ['elevator', 'lift'],
]);

/** A room's name said in words: its number off, then the words above, else the name with its underscores as spaces. */
export function roomWords(name: string | null | undefined): string {
  const bare = (name ?? '').replace(/\d+$/, '');
  if (!bare) return 'room';
  return ROOM_WORDS.get(bare) ?? bare.replace(/_/g, ' ');
}
