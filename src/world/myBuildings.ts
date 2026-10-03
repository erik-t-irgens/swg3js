// The buildings this player has standing, as the Housing tab lists them and takes them down.
//
// There are two kinds and the tab shows them as one list. A house put down with a server is the
// server's (`src/net/homes.ts` keeps the rows, `server/homes.mjs` decides), and taking one down is a
// word sent to it: it comes down when the server answers, for everybody at once. A house put down
// with no server -- or with `__debug.house(.., { local: true })` while connected -- is this browser's
// alone and lasts as long as the world it stands in, so it is kept here, by the key it was filed
// under in the streamer, and taking it down is done on the spot.
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
// Pure of three, of the DOM and of fetching, so a node test can be the game.

/** One house standing here that this browser put down itself. */
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
 * The houses this browser has put down in the world it is in.
 *
 * Forgotten on every arrival: a world unloading takes every building with it, and these are not
 * written down anywhere to be put back. The keys are never reused within a session, so a house taken
 * down and another put up cannot be confused for one another.
 */
export class LocalHomes {
  private rows: LocalHome[] = [];
  private seq = 0;

  get all(): readonly LocalHome[] {
    return this.rows;
  }

  /** A key nothing else has had this session. */
  mint(): string {
    this.seq++;
    return `${LOCAL_HOME_PREFIX}${this.seq}`;
  }

  add(row: LocalHome): void {
    const i = this.rows.findIndex((r) => r.key === row.key);
    if (i >= 0) this.rows[i] = { ...row };
    else this.rows.push({ ...row });
  }

  find(key: string): LocalHome | null {
    return this.rows.find((r) => r.key === key) ?? null;
  }

  /** Take one off the list. Answers the row that went, or null. */
  remove(key: string): LocalHome | null {
    const i = this.rows.findIndex((r) => r.key === key);
    if (i < 0) return null;
    const [row] = this.rows.splice(i, 1);
    return row;
  }

  /** The world went (an arrival, a respawn, the select screen): nothing of these is standing any more. */
  clear(): void {
    this.rows = [];
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
    out.push({ id: r.key, name: r.name, model: r.model, line: `${awayText(away)} · this session only`, x: r.x, z: r.z, away, shared: false });
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
