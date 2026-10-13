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
//
// **A house of the player's own moved** (a server whose hail says `homes: 2`): picked up at its door it is
// taken down here only (`hide`) -- everybody else goes on seeing it where it stands -- and put down it is asked
// of the server (`askMove`) and stays down here until the server answers: `homeMoved` stands it where it is
// now, in every browser on the world at once, and a refusal names it (`homeNo { id }`) and it stands again
// where it stood. A move is the old house down and the new one up under the same key, through the same one
// stand a key that every other word goes through, so two words in one breath never file it twice.
//
// Rule for this file (node runs it with type stripping for the tests): every import with its `.ts`
// extension, no enum, no namespace, no constructor parameter properties.

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
export const HOME_WORDS = ['homes', 'homeUp', 'homeMoved', 'homeDown', 'homeNo'] as const;

/** What a server's hail says when it moves a house where it stands (server/homes.mjs's `HOMES_VERSION`). */
export const HOMES_MOVE_VERSION = 2;

/** What the key of a placed home is in the streamer. It is a name nothing in a snapshot has. */
export function homeKey(id: string): string {
  return `home:${id}`;
}

/** A row off the wire, or null when it is not one: a far end on another build can send anything. */
export function readHomeRow(raw: unknown): HomeRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (typeof r.id !== 'string' || !r.id || typeof r.model !== 'string' || !r.model) return null;
  if (!num(r.x) || !num(r.y) || !num(r.z) || !num(r.h)) return null;
  return { id: r.id, owner: typeof r.owner === 'string' ? r.owner : '', model: r.model, x: r.x, y: r.y, z: r.z, h: r.h, r: num(r.r) ? r.r : 0, at: num(r.at) ? r.at : 0 };
}

/** Whether two rows stand one building in one place, turned one way and keeping one circle clear. */
function sameSpot(a: HomeRow, b: HomeRow): boolean {
  return a.model === b.model && a.x === b.x && a.y === b.y && a.z === b.z && a.h === b.h && a.r === b.r;
}

/**
 * A word off the socket handed to the houses when it is one of theirs (`HOME_WORDS`); answers whether it was. What
 * the game's own socket handler calls, and what the relay's round-trip test calls the same way.
 */
export function routeHomeWord(msg: Record<string, unknown> | null | undefined, homes: Homes): boolean {
  if (!msg || !(HOME_WORDS as readonly unknown[]).includes(msg.t)) return false;
  homes.word(msg);
  return true;
}

/** Why one of the server's houses is not stood here: in its owner's hand, or its move asked and not answered yet. */
type Hidden = 'hand' | 'asked';

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
  /**
   * Placings still going up, by id, each under a number of its own: two words about one id in the same breath
   * cannot race each other, and a placing begun before an arrival (whose `enter` lets go of the lot) can never
   * let go of one begun after it under the same id, which would let a third placing file the key twice.
   */
  private busy = new Map<string, number>();
  private ticket = 0;
  /** The player's own houses kept down here: one in hand, or one whose move was asked and not answered yet. */
  private readonly hidden = new Map<string, Hidden>();
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
   * the world really changes, and `ready` puts the same ones back up when it does not. A house in
   * hand is let go of before an arrival, so nothing is hidden.
   */
  enter(world: string): void {
    this.standing.clear();
    this.busy.clear();
    this.hidden.clear();
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
    this.hidden.clear();
    this.age++;
    this.world = '';
    this.held = false;
  }

  /**
   * Whether the server's houses are held down: this machine keeps the player's houses now (the line was put
   * down, or the far end keeps none), so its own stand instead (`App.homesKeeper`). Held, what the server says
   * is still kept, and nothing is stood until `resume`.
   */
  private held = false;

  /**
   * Take every house the server keeps down here, and hold them there until `resume`. One still going up comes
   * straight back down as it lands while they are held, and stands after all if they were resumed first (`ready`
   * leaves a house going up to the placing already on its way, rather than placing its key a second time).
   */
  takeDownAll(): void {
    this.held = true;
    for (const id of this.standing) this.deps?.unplace(homeKey(id));
    this.standing.clear();
  }

  /**
   * The server keeps the player's houses again: what it said stands -- now, or (`stand` false, an arrival whose
   * world is still loading) at `ready`, once there is a world to stand it in.
   */
  resume(stand = true): void {
    this.held = false;
    if (stand) this.ready();
  }

  /** Whether the server's houses are held down (`takeDownAll`). */
  get isHeld(): boolean {
    return this.held;
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
    if (this.held) return;
    for (const row of this.rows.values()) if (!this.standing.has(row.id)) void this.up(row);
  }

  /** Everything the server has said about this world, handed over whole. */
  word(msg: Record<string, unknown>): void {
    if (msg.t === 'homes') {
      // The whole of what stands here as the server has it now: a move asked and not answered (a line that
      // dropped in between) has its answer in it, and a house standing where it no longer stands is moved.
      for (const [id, why] of this.hidden) if (why === 'asked') this.hidden.delete(id);
      for (const raw of Array.isArray(msg.rows) ? msg.rows : []) {
        const row = readHomeRow(raw);
        if (row) this.moved(row);
      }
      return;
    }
    if (msg.t === 'homeUp') {
      const row = readHomeRow(msg.home);
      if (row) void this.up(row);
      return;
    }
    if (msg.t === 'homeMoved') {
      const row = readHomeRow(msg.home);
      if (row) this.moved(row);
      return;
    }
    if (msg.t === 'homeDown') {
      this.down(String(msg.id ?? ''));
      return;
    }
    if (msg.t === 'homeNo') {
      this.refused++;
      this.lastWhy = String(msg.why ?? '');
      // A move refused names its house, which stands again where it stood; one naming none is about a house
      // that never went up, of which nothing stood here to put back.
      const id = typeof msg.id === 'string' ? msg.id : '';
      if (id && this.hidden.get(id) === 'asked') this.show(id);
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

  /**
   * Ask the server to move one of the player's own: its new doorstep, heading, circle and height, as a placing
   * sends them. It stays down here until the server answers, and moves for everybody when it does; refused, it
   * stands again where it stood.
   */
  askMove(id: string, at: { x: number; z: number }, yaw: number, clear: number, y: number): void {
    this.hideAs(id, 'asked');
    this.deps?.send({ t: 'moveHome', id, x: at.x, y, z: at.z, h: yaw, r: clear });
  }

  /** One of the player's own taken in hand: down here only, until it is shown again or the server moves it. */
  hide(id: string): void {
    this.hideAs(id, 'hand');
  }

  /** One kept down here stood again where the server has it (Escape, a refusal). */
  show(id: string): void {
    this.hidden.delete(id);
    const row = this.rows.get(id);
    if (row && !this.held) void this.up(row);
  }

  /**
   * One let go of with nothing asked (a travel, the select screen, a change of keeper): kept down here no longer,
   * and stood with the rest the next time they are stood, but not now, since the world or the keeper is going.
   */
  unhide(id: string): void {
    this.hidden.delete(id);
  }

  /** Which of the player's own are kept down here, for the console. */
  hiddenIds(): string[] {
    return [...this.hidden.keys()];
  }

  /** Whether one is kept down here: in its owner's hand, or its move asked and not answered. */
  isHidden(id: string): boolean {
    return this.hidden.has(id);
  }

  /** Whether one stands here now. */
  isStanding(id: string): boolean {
    return this.standing.has(id);
  }

  private hideAs(id: string, why: Hidden): void {
    this.hidden.set(id, why);
    if (this.standing.delete(id)) this.deps?.unplace(homeKey(id));
  }

  /**
   * A row stood again where it stands now: the old one down here first (whoever stands in it stood out on its
   * doorstep by `unplace`), then up at its new place, under the same key and through the one stand a key has.
   * One already standing exactly there (a list handed over again on a line that came back) is left alone.
   */
  private moved(row: HomeRow): void {
    const was = this.rows.get(row.id);
    if (was && this.standing.has(row.id) && sameSpot(was, row)) return;
    if (this.standing.delete(row.id)) this.deps?.unplace(homeKey(row.id));
    if (this.hidden.get(row.id) === 'asked') this.hidden.delete(row.id);
    void this.up(row);
  }

  /** Which of the standing ones this character owns, nearest first, for the console. */
  mine(character: string, at: { x: number; z: number }): HomeRow[] {
    const out = [...this.rows.values()].filter((r) => r.owner === character);
    out.sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z));
    return out;
  }

  /** What `__debug.homes()` prints. */
  report(): { standing: number; held: boolean; hidden: string[]; stood: number; refused: number; lastWhy: string; rows: HomeRow[] } {
    return { standing: this.standing.size, held: this.held, hidden: this.hiddenIds(), stood: this.stood, refused: this.refused, lastWhy: this.lastWhy, rows: [...this.rows.values()] };
  }

  /**
   * Stand one row, once. A stand already going up for it is the one that lands: never a second under its key,
   * which would file the key twice and leave a copy no take-down can reach. What it lands into is decided as it
   * lands: in a world since left it went with that world; otherwise it stands if the rows still want it (not
   * held, not hidden, the same row), and goes straight back down if not -- and a row moved meanwhile goes up
   * again at its new place, by the stand that has just landed handing over to the next.
   */
  private async up(row: HomeRow): Promise<void> {
    if (!row || typeof row.id !== 'string' || !row.id) return;
    // The same house said again (a list handed over twice, a word for one standing or going up) keeps the row
    // the stand on its way holds, so that stand does not take itself for one a move overtook.
    const was = this.rows.get(row.id);
    if (!was || !sameSpot(was, row)) this.rows.set(row.id, row);
    // Held down, or in its owner's hand or asked about: the server's word is kept, and stood when it may be.
    if (this.held || this.hidden.has(row.id)) return;
    if (this.standing.has(row.id) || this.busy.has(row.id)) return;
    const deps = this.deps;
    if (!deps) return;
    const ticket = ++this.ticket;
    this.busy.set(row.id, ticket);
    // What this stand stands: the row as it is kept now, which is this one or the same house said before it.
    const mine = this.rows.get(row.id) as HomeRow;
    const age = this.age;
    let again = false;
    try {
      // The server's own height, not one measured again here: the ground was tested once, by
      // whoever placed it, and a house has one height whatever browser is looking at it.
      const out = await deps.place(mine.model, { at: { x: mine.x, z: mine.z }, yaw: mine.h, key: homeKey(mine.id), y: mine.y });
      // The world torn down while it was going up: after a reload into the same world the rows are
      // still there and wanting it is not the question, which is why the age is checked at all. It
      // went with the world it went up in, and comes down here only while nothing of this world
      // stands or goes up under its key -- taken down regardless, it could take the next world's
      // copy of the same house down instead.
      if (age !== this.age) {
        if (!this.standing.has(row.id) && !this.busy.has(row.id)) deps.unplace(homeKey(row.id));
        return;
      }
      // Taken down, held down, picked up or moved while it was going up: it comes straight back down. Held and
      // then resumed in that time, it stands after all, since `ready` left it to this placing; moved, the stand
      // that landed hands over to one for where it stands now (`again`), so the key is never filed twice.
      if (this.held || this.hidden.has(row.id) || this.rows.get(row.id) !== mine) {
        if (out.ok) deps.unplace(homeKey(row.id));
        again = !this.held && !this.hidden.has(row.id) && this.rows.has(row.id);
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
      if (this.busy.get(row.id) === ticket) this.busy.delete(row.id);
      const now = again ? this.rows.get(row.id) : undefined;
      if (now) void this.up(now);
    }
  }

  private down(id: string): void {
    if (!id) return;
    // Forgotten first and in every case, so a house whose word arrived while it was still going up
    // is taken down by the placing itself rather than left standing with nothing to name it.
    this.rows.delete(id);
    this.hidden.delete(id);
    if (!this.standing.delete(id)) return;
    this.deps?.unplace(homeKey(id));
  }
}

/** One for the session, as the rest of the net's own pieces are. */
export const homes = new Homes();
