// The buildings this player has standing, as the Housing tab lists them and takes them down.
//
// There are two kinds and the tab shows them as one list. A house put down with a server is the
// server's (`src/net/homes.ts` keeps the rows, `server/homes.mjs` decides), and taking one down is a
// word sent to it: it comes down when the server answers, for everybody at once. A house put down
// with no server -- or with `__debug.house(.., { local: true })` while connected -- is this machine's
// alone, kept here per world in the browser's own storage and shared by every character played on it,
// as its props are (`propsPlaced.ts`), so it is still standing the next time anybody comes back with
// no server; taking it down is done on the spot. While a server keeps the player's houses, the ones
// this machine keeps wait, not standing (`App.homesKeeper`), for a game with no server.
//
// The one slot this replaces held only the last house put down, so a second house left the first one
// standing with nothing that could ever name it again, and every house filed under the model's own
// name meant two of one model were one key in the streamer. Each one here has a key of its own.
//
// Whatever stands in a building's rooms when it comes down is stood on its doorstep first (the
// caller's, through `World.clearRoomsOf`): taking a building out of the world while the player's room
// or a follower's still names it is the dangerous case, and a house is placed with its own origin on
// the ground at its doorstep (`housePlace.ts`), so that is where everybody is put.
//
// Pure of three, of the DOM and of fetching, so a node test can be the game. Rule for this file (node
// runs it with type stripping for the tests): every import with its `.ts` extension, no constructor
// parameter properties.

import { mintThing } from './propsPlaced.ts';

/** One house this machine put down itself, in the world it stands in. */
export interface LocalHome {
  /** What it is filed under in the streamer, which is also how it is named everywhere else here. */
  key: string;
  model: string;
  /** What the deed that made it called it, or the model tidied. */
  name: string;
  x: number;
  y: number;
  z: number;
  /** Its heading, radians. */
  yaw: number;
  /** How much ground it keeps clear of plants, metres: its patch's own reach as it was put down. */
  r?: number;
}

/** Where this machine keeps the houses it put down itself. One key a world, as the props' is. */
export function homesKey(world: string): string {
  return `swg.homes.${world}`;
}

/** A house read back from storage, or null when it is not one. Nothing trusts what it finds there. */
export function readHome(raw: unknown): LocalHome | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (typeof r.key !== 'string' || !r.key.startsWith(LOCAL_HOME_PREFIX) || typeof r.model !== 'string' || !r.model) return null;
  if (!num(r.x) || !num(r.y) || !num(r.z) || !num(r.yaw)) return null;
  return { key: r.key, model: r.model, name: typeof r.name === 'string' && r.name ? r.name : r.model, x: r.x, y: r.y, z: r.z, yaw: r.yaw, ...(num(r.r) && r.r > 0 ? { r: r.r } : {}) };
}

/** The browser's own small store, as the props' is handed it: either half may throw, or answer nothing. */
export interface HomeStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** Every number here is ours. */
export const HOUSING_TUNE = {
  /**
   * How long the button that really takes a building down stays shut after the question is asked,
   * in ms, so the click that asked cannot also answer. The select screen's own number for the same
   * question about a character.
   */
  armMs: 700,
  /**
   * How near a building's doorstep the pick-up key reaches to offer taking it down, in metres,
   * measured on the ground. A house's origin is its doorstep, and eight metres is a step or two
   * either side of a front door without reaching the next house in a row.
   */
  doorReach: 8,
  /**
   * How far apart, in metres, the people standing in a building are put round its doorstep when it
   * comes down, so two followers are not stood inside each other.
   */
  standApart: 1.1,
};

/** The prefix a house of this browser's own is filed under, which nothing the server hands out has. */
export const LOCAL_HOME_PREFIX = 'local:';

/** Whether an id names a house of this browser's own rather than one the server keeps. */
export function isLocalHome(id: string): boolean {
  return id.startsWith(LOCAL_HOME_PREFIX);
}

/**
 * The houses this machine has put down in the world it is in, read from its storage on every arrival
 * (`enter`) and written back on every change, so they are standing again the next time anybody comes
 * back with no server.
 *
 * Which of them stand is kept here too (`setStanding`), because they stand only while this machine keeps
 * the player's houses: with a server that does, they wait. A key is the moment and a little randomness
 * (`mintThing`), so it outlasts a reload and is never handed out again, by this list or by another.
 */
export class LocalHomes {
  private rows: LocalHome[] = [];
  private readonly up = new Set<string>();
  private worldId = '';
  private store: HomeStore | null = null;
  /** Which run of standing is in force (`beginStand`): taking every house down moves it on. */
  private round = 0;
  /**
   * Houses still going up, by key, each under a number of its own (`beginPlace`): a run that meets one already
   * on its way leaves it to that one rather than placing its key a second time, which would file the key twice
   * in the streamer and leave a copy no take-down can reach. An arrival lets go of the lot, and a number keeps a
   * placing begun before it from letting go of one begun after it under the same key.
   */
  private readonly placing = new Map<string, number>();
  private ticket = 0;
  /** Why the last write did not reach the storage, for the console: kept for the session instead. */
  note = '';

  get all(): readonly LocalHome[] {
    return this.rows;
  }

  /** Which world these are, or '' before any. */
  get world(): string {
    return this.worldId;
  }

  /**
   * Come to a world: what this machine keeps for it, read from its storage. Nothing stands yet: the world
   * these were standing in went with the arrival, and the game stands them once the world is in and this
   * machine keeps the player's houses. A storage that cannot be read gives none, and they are written into
   * it from the first change on.
   */
  enter(world: string, store: HomeStore): void {
    this.worldId = world;
    this.store = store;
    this.rows = [];
    this.up.clear();
    this.placing.clear();
    this.round++;
    let raw: unknown;
    try {
      raw = JSON.parse(store.get(homesKey(world)) ?? '[]');
    } catch {
      raw = [];
    }
    for (const r of Array.isArray(raw) ? raw : []) {
      const row = readHome(r);
      if (row && !this.rows.some((o) => o.key === row.key)) this.rows.push(row);
    }
  }

  /** A key nothing has had before and nothing will have again: the moment and a little randomness. */
  mint(now = Date.now(), rnd: () => number = Math.random): string {
    let key = '';
    do key = `${LOCAL_HOME_PREFIX}${mintThing(now, rnd)}`;
    while (this.rows.some((r) => r.key === key));
    return key;
  }

  add(row: LocalHome): void {
    const i = this.rows.findIndex((r) => r.key === row.key);
    if (i >= 0) this.rows[i] = { ...row };
    else this.rows.push({ ...row });
    this.save();
  }

  find(key: string): LocalHome | null {
    return this.rows.find((r) => r.key === key) ?? null;
  }

  /** Take one off the list, and out of this machine's keeping. Answers the row that went, or null. */
  remove(key: string): LocalHome | null {
    const i = this.rows.findIndex((r) => r.key === key);
    if (i < 0) return null;
    const [row] = this.rows.splice(i, 1);
    this.up.delete(key);
    this.save();
    return row;
  }

  /** Whether one stands in the world now. */
  isStanding(key: string): boolean {
    return this.up.has(key);
  }

  /** One stood, or taken down, by the game. */
  setStanding(key: string, on: boolean): void {
    if (on && this.rows.some((r) => r.key === key)) this.up.add(key);
    else this.up.delete(key);
  }

  /** The keys standing now, for taking them all down. */
  standingKeys(): string[] {
    return [...this.up];
  }

  /** How many of this world's are kept here and not standing: waiting for a game with no server. */
  get waiting(): number {
    return this.rows.length - this.up.size;
  }

  /**
   * A run of standing begins, or every house is taken down (`endStand`): which run is in force, so a stand
   * still loading for a run since overtaken puts its house straight back down.
   */
  beginStand(): number {
    return ++this.round;
  }

  /** Whether a run of standing is still the one in force. */
  standing(round: number): boolean {
    return round === this.round;
  }

  /** Every house is down (the game took them down): no run of standing is in force any more. */
  endStand(): void {
    this.round++;
    this.up.clear();
  }

  /** A house begins going up: answers the number its landing hands back to `endPlace`. */
  beginPlace(key: string): number {
    const ticket = ++this.ticket;
    this.placing.set(key, ticket);
    return ticket;
  }

  /** A house has landed (or not): no longer going up, unless a later placing of the same key has begun since. */
  endPlace(key: string, ticket: number): void {
    if (this.placing.get(key) === ticket) this.placing.delete(key);
  }

  /** Whether one is still going up. */
  isPlacing(key: string): boolean {
    return this.placing.has(key);
  }

  /**
   * A house begun with `beginPlace` has landed, `placed` whether it went up, `wanted` whether this machine keeps
   * the player's houses now. Answers what the game does with it: `stands` (marked standing here), `down` (take it
   * straight back down), or `none`. One whose placing an arrival let go of went with the world it went up in, and
   * comes down only while nothing of this world stands or goes up under its key. Otherwise it stands while it is
   * wanted and kept and not already standing -- whichever run began it, so one a run since overtaken left on its way
   * (everything taken down and stood again while a model loaded) stands rather than being lost or filed twice.
   */
  land(key: string, ticket: number, placed: boolean, wanted: boolean): 'stands' | 'down' | 'none' {
    const mine = this.placing.get(key) === ticket;
    if (mine) this.placing.delete(key);
    if (!placed) return 'none';
    if (!mine) return this.up.has(key) || this.placing.has(key) ? 'none' : 'down';
    if (wanted && !this.up.has(key) && this.rows.some((r) => r.key === key)) {
      this.up.add(key);
      return 'stands';
    }
    return 'down';
  }

  /** The circles this world's ground keeps plants off for them, game frame, before it is first built. */
  circles(): { x: number; z: number; r: number }[] {
    const out: { x: number; z: number; r: number }[] = [];
    for (const h of this.rows) if (h.r && h.r > 0) out.push({ x: h.x, z: h.z, r: h.r });
    return out;
  }

  /** The world went for good (the select screen): nothing of these is standing, and nothing is kept in hand. */
  clear(): void {
    this.rows = [];
    this.up.clear();
    this.placing.clear();
    this.round++;
    this.worldId = '';
    this.store = null;
  }

  /** This world's rows into this machine's keeping; one that cannot be written is kept for the session, and said once. */
  private save(): void {
    if (!this.store || !this.worldId) return;
    try {
      this.store.set(homesKey(this.worldId), JSON.stringify(this.rows));
      this.note = '';
    } catch {
      this.note = 'this browser will not keep them: they last as long as this session';
    }
  }
}

/** One of the player's own buildings, as the Housing tab lists it. */
export interface MyBuilding {
  /** What a take-down names: the server's id, or the local key. */
  id: string;
  name: string;
  /** The model it is drawn with, which is what ties it back to the deeds that make it. */
  model: string;
  /** How far off and which kind, in one line. */
  line: string;
  x: number;
  z: number;
  /** Metres from the player, on the ground. */
  away: number;
  /** Kept by the server (everybody sees it, it outlasts the session) rather than by this browser. */
  shared: boolean;
}

/** What the tab is handed of a server row: the server's own fields, of which only these are read. */
export interface ServerHome {
  id: string;
  model: string;
  x: number;
  z: number;
}

/**
 * What a building is called: the name of the deed that makes it, where a deed does, else its
 * model's key in words. A building has no name of its own in the archives, and the deed's is what
 * the player bought it under.
 */
export function houseName(model: string, deeds: readonly { model: string | null; name: string }[]): string {
  const d = deeds.find((r) => r.model === model);
  if (d?.name) return d.name;
  const words = model.replace(/^ply_/, '').replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : model;
}

/** A distance in words for the list: metres near, kilometres far. */
export function awayText(m: number): string {
  if (!Number.isFinite(m)) return 'somewhere on this world';
  if (m < 1000) return `${Math.round(m)} m away`;
  return `${(m / 1000).toFixed(1)} km away`;
}

/**
 * The player's own buildings on this world, nearest first: the server's rows that are theirs and the
 * ones this browser put down itself, as one list.
 */
export function myBuildings(server: readonly ServerHome[], local: readonly LocalHome[], at: { x: number; z: number }, nameOf: (model: string) => string): MyBuilding[] {
  const out: MyBuilding[] = [];
  for (const r of server) {
    const away = Math.hypot(r.x - at.x, r.z - at.z);
    out.push({ id: r.id, name: nameOf(r.model), model: r.model, line: `${awayText(away)} · kept by the server`, x: r.x, z: r.z, away, shared: true });
  }
  for (const r of local) {
    const away = Math.hypot(r.x - at.x, r.z - at.z);
    out.push({ id: r.key, name: r.name, model: r.model, line: `${awayText(away)} · kept on this machine`, x: r.x, z: r.z, away, shared: false });
  }
  out.sort((a, b) => a.away - b.away || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** The building whose doorstep a point is standing at, within `reach` on the ground, or null. */
export function atDoorOf<T extends { x: number; z: number }>(rows: readonly T[], at: { x: number; z: number }, reach: number): T | null {
  let best: T | null = null;
  let bestD = reach;
  for (const r of rows) {
    const d = Math.hypot(r.x - at.x, r.z - at.z);
    if (d <= bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

/**
 * Where the `i`th person standing in a building is put when it comes down: round its doorstep on a
 * spiral, `apart` metres between neighbours, so nobody is stood inside anybody else and the first is
 * a step off the doorstep itself (where the player goes).
 */
export function doorstepSpot(i: number, door: { x: number; z: number }, apart = HOUSING_TUNE.standApart): { x: number; z: number } {
  // The golden angle: each next spot is as far round from the last as can be, so the ring fills
  // evenly whatever the count.
  const a = i * 2.399963229728653;
  const r = apart * Math.sqrt(i + 1);
  return { x: door.x + Math.cos(a) * r, z: door.z + Math.sin(a) * r };
}
