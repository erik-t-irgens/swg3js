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

  /**
   * A world went away and took every building with it. The rows go too: the next world's list comes
   * whole from the server, and a row kept from the last one would be a house standing in the wrong
   * place with nothing to take it down.
   */
  clear(): void {
    this.standing.clear();
    this.rows.clear();
    this.busy.clear();
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
    try {
      // The server's own height, not one measured again here: the ground was tested once, by
      // whoever placed it, and a house has one height whatever browser is looking at it.
      const out = await deps.place(row.model, { at: { x: row.x, z: row.z }, yaw: row.h, key: homeKey(row.id), y: row.y });
      // Taken down, or the world left, while it was going up.
      if (!this.rows.has(row.id)) {
        deps.unplace(homeKey(row.id));
        return;
      }
      if (out.ok) {
        this.standing.add(row.id);
        this.stood++;
      } else {
        this.rows.delete(row.id);
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
