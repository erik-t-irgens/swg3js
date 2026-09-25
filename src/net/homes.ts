// The buildings players have put down, on this browser's side.
//
// The server holds them (`server/homes.mjs`) and this stands them up: the list handed over on
// arriving at a world, one going up while you are standing there, and one coming down. Every one of
// them goes through the same `World.placeBuilding` a house put down with no server at all goes
// through, at the height the server wrote down rather than at one measured again here -- two
// browsers must not disagree about how high somebody's house stands, and the ground test has
// already been made once, by whoever placed it.
//
// What this file does not do is decide anything. Whether a spot will take a house is the placing
// browser's answer, whether the house may stand there at all is the server's, and this is only the
// standing up. A refusal is a line of words for the message line and nothing else.
//
// It keeps no pictures and no models: `World` does, and a world unloading takes every building with
// it, so all this has to remember is which ids it has standing so that a list arriving twice does
// not build the same house twice.

/** One building as it comes over the wire. Every field is the server's; none is worked out here. */
export interface HomeRow {
  id: string;
  owner: string;
  model: string;
  x: number;
  y: number;
  z: number;
  /** Its heading, in radians, in the world's own frame. */
  h: number;
  /** How much ground it keeps to itself, metres: what the placing browser's own patch asked for. */
  r: number;
  at: number;
}

/** The words the socket has to hand over for any of this to happen. */
export const HOME_WORDS = ['homes', 'homeUp', 'homeDown', 'homeNo'] as const;

/** What the key of a placed home is in the streamer. It is a name nothing in a snapshot has. */
export function homeKey(id: string): string {
  return `home:${id}`;
}

/** What `Homes` needs of the world around it, so a node test can hand it something small. */
export interface HomeDeps {
  /** Stand one up. Answers where it went, or why it did not. */
  place(model: string, opts: { at: { x: number; z: number }; yaw: number; key: string; y: number }): Promise<{ ok: boolean; why: string | null }>;
  /** Take one down by its key. */
  unplace(key: string): boolean;
  /** Say something to the player, once. */
  say(text: string): void;
  /** Send a word to the server. */
  send(msg: Record<string, unknown>): void;
}

export class Homes {
  private deps: HomeDeps | null = null;
  /** The ids standing in this world, so a list arriving twice does not build anything twice. */
  private standing = new Set<string>();
  /** What each one is, for the console and for anything later that wants to know whose a house is. */
  readonly rows = new Map<string, HomeRow>();
  /** Placings still going up, so two words about one id in the same breath cannot race each other. */
  private busy = new Set<string>();
  /** For the console: how many have been stood, how many refused, and the last thing the server said. */
  stood = 0;
  refused = 0;
  lastWhy = '';

  attach(deps: HomeDeps): void {
    this.deps = deps;
  }

  /** Which world these rows are about, so entering the same one again is told from a change of world. */
  private world = '';
  /**
   * Which world load a placing belongs to. A house takes a model load and a compile to go up, and
   * the world can be torn down and rebuilt in that time -- on a respawn into the same world the
   * rows survive, so "is it still wanted" cannot answer it, and without this the house would be
   * marked standing while it was really put into a world that no longer exists and `ready` would
   * never look at it again.
   */
  private age = 0;

  /**
   * A world is being loaded. Everything built in the old one went with it, so nothing is standing
   * any more whatever happens next.
   *
   * Whether the **rows** go too is the part that is not obvious. A row is what the server says is
   * built on a world, and the server sends that list only when a browser *changes* world -- so on a
   * respawn, a reload or any other arrival back where you already were, throwing the rows away
   * would leave the houses gone with nothing left to ask for them again. So the rows go only when
   * the world really changes, and `ready` puts the same ones back up when it does not.
   */
  enter(world: string): void {
    this.standing.clear();
    this.busy.clear();
    this.age++;
    if (world !== this.world) {
      this.rows.clear();
      this.world = world;
    }
  }

  /** Everything forgotten, whatever world it was: leaving for the select screen, or a test. */
  clear(): void {
    this.standing.clear();
    this.rows.clear();
    this.busy.clear();
    this.world = '';
  }

  /**
   * A world has finished loading and can be built on.
   *
   * This is not decoration. The browser says hello with its new planet **before** the pack has
   * loaded, so the server's list of what is built there arrives at a browser whose world has no
   * streamer yet and every house in it is refused for having nowhere to go. So a row the world
   * would not take is kept rather than thrown away, and this is what tries them again.
   */
  ready(): void {
    for (const row of this.rows.values()) if (!this.standing.has(row.id)) void this.up(row);
  }

  /** Everything the server has said about this world, handed over whole. */
  word(msg: Record<string, unknown>): void {
    if (msg.t === 'homes') {
      const rows = Array.isArray(msg.rows) ? (msg.rows as HomeRow[]) : [];
      for (const row of rows) void this.up(row);
      return;
    }
    if (msg.t === 'homeUp') {
      const row = msg.home as HomeRow | undefined;
      if (row) void this.up(row);
      return;
    }
    if (msg.t === 'homeDown') {
      this.down(String(msg.id ?? ''));
      return;
    }
    if (msg.t === 'homeNo') {
      this.refused++;
      this.lastWhy = String(msg.why ?? '');
      this.deps?.say(this.lastWhy);
    }
  }

  /** Ask the server to put one down. The house appears when the server answers, never before. */
  ask(model: string, at: { x: number; z: number }, yaw: number, clear: number, y: number): void {
    this.deps?.send({ t: 'placeHome', model, x: at.x, y, z: at.z, h: yaw, r: clear });
  }

  /** Ask the server to take one down. It goes when the server answers, never before. */
  askDown(id: string): void {
    this.deps?.send({ t: 'removeHome', id });
  }

  /** Which of the standing ones this character owns, nearest first, for the console. */
  mine(character: string, at: { x: number; z: number }): HomeRow[] {
    const out = [...this.rows.values()].filter((r) => r.owner === character);
    out.sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z));
    return out;
  }

  /** What `__debug.homes()` prints. */
  report(): { standing: number; stood: number; refused: number; lastWhy: string; rows: HomeRow[] } {
    return { standing: this.standing.size, stood: this.stood, refused: this.refused, lastWhy: this.lastWhy, rows: [...this.rows.values()] };
  }

  private async up(row: HomeRow): Promise<void> {
    if (!row || typeof row.id !== 'string' || !row.id) return;
    if (this.standing.has(row.id) || this.busy.has(row.id)) return;
    const deps = this.deps;
    if (!deps) return;
    this.busy.add(row.id);
    this.rows.set(row.id, row);
    const age = this.age;
    try {
      // The server's own height, not one measured again here: the ground was tested once, by
      // whoever placed it, and a house has one height whatever browser is looking at it.
      const out = await deps.place(row.model, { at: { x: row.x, z: row.z }, yaw: row.h, key: homeKey(row.id), y: row.y });
      // Taken down, or the world torn down, while it was going up. Both leave it not standing, and
      // the second is why the age is checked at all: after a reload into the same world the rows
      // are still there and wanting it is not the question.
      if (age !== this.age || !this.rows.has(row.id)) {
        deps.unplace(homeKey(row.id));
        return;
      }
      if (out.ok) {
        this.standing.add(row.id);
        this.stood++;
      } else {
        // Kept, not thrown away: the world may simply not have loaded yet, and this row is the
        // server's truth about what is built there. `ready` tries them all again.
        this.lastWhy = out.why ?? '';
      }
    } finally {
      this.busy.delete(row.id);
    }
  }

  private down(id: string): void {
    if (!id) return;
    // Forgotten first and in every case, so a house whose word arrived while it was still going up
    // is taken down by the placing itself rather than left standing with nothing to name it.
    this.rows.delete(id);
    if (!this.standing.delete(id)) return;
    this.deps?.unplace(homeKey(id));
  }
}

/** One for the session, as the rest of the net's own pieces are. */
export const homes = new Homes();
