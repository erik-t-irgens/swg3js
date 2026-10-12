// A player's props as a server keeps them, on this browser's side, and who keeps a player's things at all.
//
// **Who keeps them** (`keeperOf`). A player's own things -- the props they put down and the houses they put
// up -- are the server's when there is one that keeps them, seen by everybody on that world, and this
// machine's when there is none, kept per world in its own storage and seen by nobody else. Which of the two
// it is decides which set stands, so the answer must not flicker: it becomes the server only when a server
// has taken this browser's claim (and, for props, says in its hail that it keeps them), and stays the server
// through a line that merely dropped and is being made again -- the things go on standing, and changing them
// is refused in words until the line is back. It becomes this machine's when the player puts the line down,
// the far end turns out to keep nothing (the relay that came before, or a server from before props -- which a
// dropped line coming back to another far end can turn out to be), or nothing has answered within `waitMs` of
// arriving with an address wanted; until then it is `pending` and neither set stands, so a session that starts
// on a server never stands this machine's things for the second before the claim is answered and takes them
// down again. The decisions are pure functions here (`keeperState`, `keeperOf`, `arrivalKeeper`, `switchSets`,
// `arrivalCircles`, `keptRefusal`, `keeperNews`), so the game only calls them and a node test can run them.
//
// **The server's rows** (`KeptProps`) are stood here exactly as this machine's own are, through the very
// stand a prop of this browser's goes through (`App.placedDeps`), under `prop:s:<id>`: the server's id, which
// nothing this browser mints can be. Nothing here decides anything. Whether a spot will take a prop is the
// placing browser's verdict, how many there are and whose is the server's, and this only stands what the
// server says, keeps what it said while nothing can be stood (the world loading, this machine keeping
// things instead), and hides one of the player's own while it is in their hand -- here only: everybody else
// goes on seeing it where it stands until the server says it moved.
//
// Pure of three, of rapier and of the DOM: it asks the game for everything, so a node test can be the game.
// Rule for this file (node runs it with type stripping for the tests): every import with its `.ts`
// extension, no enum, no namespace, no constructor parameter properties.

import type { PlacedDeps, PlacedProp } from '../world/propsPlaced.ts';

/** One prop as it comes over the wire. Every field is the server's; none is worked out here. */
export interface KeptRow {
  /** The server's own id (`p<n>`). */
  id: string;
  /** The character that put it down, as the server knows it (`Session.character`). */
  owner: string;
  /** The props catalogue's id: what it is. */
  prop: string;
  x: number;
  y: number;
  z: number;
  /** Its whole turn, three's order. */
  q: [number, number, number, number];
  /** Whether it was put down in a room. */
  inside?: boolean;
  at: number;
}

/** The words the socket has to hand over for any of this to happen. */
export const PROP_WORDS = ['props', 'propUp', 'propMoved', 'propDown', 'propNo'] as const;

/** Every number here is ours. Live through `__debug.prop({ keeperTune })`. */
export const PROPS_KEEPER_TUNE = {
  /**
   * How long an arrival with a server address wanted waits for that server to answer before this machine's
   * own things are stood, milliseconds. The wait begins at the arrival, or at the connect a session's first
   * arrival makes after its loading screen.
   */
  waitMs: 6000,
  /** How often the frame asks who keeps them, milliseconds: a few times a second, and asking makes nothing. */
  everyMs: 250,
};

/** Who keeps a player's things: the server, this machine, or not known yet (only ever at an arrival). */
export type Keeper = 'server' | 'local' | 'pending';

/** What `keeperOf` is asked with, kept and written in place by the caller, so asking a few times a second makes nothing. */
export interface KeeperState {
  /** The server has taken this browser's claim and keeps this kind of thing. */
  serverHolds: boolean;
  /** A line is wanted (`Net.wanted`, or an address saved for a session's first arrival whose connect is still to come). */
  wanted: boolean;
  /** The far end has said what it is: it took the claim, or it is the relay that came before and holds nothing. */
  answering: boolean;
  /** How long since the arrival's wait began, milliseconds. */
  sinceArrivalMs: number;
}

/**
 * Who keeps a player's things now, from who kept them a moment ago. The server when it holds them; still the
 * server through a dropped line that is wanted back, until the far end answers; still not known while an arrival waits for an answer
 * that may yet come; otherwise this machine. An arrival asks it with `prev` `pending` unless the server kept
 * them (`App.arrive`), which is the one way into `pending`: a keeper that is known never goes back to not
 * known, so a connect asked for in the middle of a world leaves this machine's things standing until the
 * server's answer, and never takes them down to wait.
 */
export function keeperOf(prev: Keeper, s: KeeperState, tune: { waitMs: number } = PROPS_KEEPER_TUNE): Keeper {
  if (s.serverHolds) return 'server';
  // Held through a drop only while the far end has not said what it is: a line that comes back to a far end
  // that answers and keeps nothing of this kind (the relay that came before, a server from before props, one
  // started from an older checkout) hands them to this machine, or a drop would be sent to a server that
  // drops it in silence and the thing would leave the player's hand and never appear.
  if (prev === 'server' && s.wanted && !s.answering) return 'server';
  if (prev === 'pending' && s.wanted && !s.answering && s.sinceArrivalMs < tune.waitMs) return 'pending';
  return 'local';
}

/** What the session says of the line, as `keeperState` reads it: the game's own `Session` is one. */
export interface LineFacts {
  /** Who decides: `server` once a server has taken this browser's claim. */
  readonly authority: string;
  /** How the far end answered: `relay` is the relay that came before, which keeps nothing. */
  readonly mode: string;
  /** Whether the server's hail said it keeps props (1), in force only once it holds the claim. */
  readonly propsVersion: number;
}

/**
 * What `keeperOf` is asked with for one kind of thing, written into `out` (kept by the caller) and handed back,
 * so asking a few times a second from the frame makes nothing. Props are the server's only when it holds the
 * claim **and** its hail says it keeps them, houses whenever it holds the claim. The far end has answered once it
 * holds the claim or has turned out to be the relay that came before. A line is wanted while the socket wants
 * one, or while a session's first world has a server saved whose connect comes after its loading screen
 * (`connectToCome`); that arrival has waited no time at all until the connect is made.
 */
export function keeperState(out: KeeperState, line: LineFacts, props: boolean, wanted: boolean, connectToCome: boolean, sinceMs: number): KeeperState {
  out.serverHolds = line.authority === 'server' && (!props || line.propsVersion >= 1);
  out.wanted = wanted || connectToCome;
  out.answering = line.authority === 'server' || line.mode === 'relay';
  out.sinceArrivalMs = connectToCome ? 0 : sinceMs;
  return out;
}

/**
 * An arrival's keeper: still the server where it kept them (a travel on a line that is up, or dropped and wanted
 * back), else not known until the far end answers or the wait runs out (`keeperOf` from `pending`).
 */
export function arrivalKeeper(prev: Keeper, s: KeeperState, tune: { waitMs: number } = PROPS_KEEPER_TUNE): Keeper {
  return keeperOf(prev === 'server' ? 'server' : 'pending', s, tune);
}

/** One kind of thing's two sets, the server's and this machine's, each taken down or stood as the keeper changes. */
export interface KeptSets {
  /** The server's taken down here and held there. */
  downServer(): void;
  /** This machine's taken down, and kept. */
  downLocal(): void;
  /** The server's stood again. */
  upServer(): void;
  /** This machine's stood again. */
  upLocal(): void;
}

/**
 * A change of keeper in the middle of a world: whichever set the new keeper is not is taken down first, then the
 * new keeper's own is stood, so the two never stand at once. A keeper not known stands neither.
 */
export function switchSets(to: Keeper, sets: KeptSets): void {
  if (to !== 'server') sets.downServer();
  if (to !== 'local') sets.downLocal();
  if (to === 'server') sets.upServer();
  else if (to === 'local') sets.upLocal();
}

/**
 * Whether the server's houses are held down at an arrival: once this machine is known to keep them. Not known
 * yet they are not held, since the only far end that sends a list of houses is a server that keeps them.
 */
export function arrivalHolds(keeper: Keeper): boolean {
  return keeper === 'local';
}

const NO_CIRCLES: readonly never[] = Object.freeze([]);

/**
 * The circles of ground this machine's houses keep plants off on an arrival, before its ground is first built:
 * theirs only while this machine is known to keep them. A plant kept off is never put back (a chunk is drawn once),
 * so clearing for houses a server's answer is about to leave waiting would leave bare clearings with nothing in
 * them; a house stood later, when the wait runs out, keeps plants off the chunks built after it as any house does.
 */
export function arrivalCircles<T>(keeper: Keeper, circles: readonly T[]): readonly T[] {
  return keeper === 'local' ? circles : NO_CIRCLES;
}

/** What a player is told when nobody knows yet who keeps their things here. */
export const KEEPER_PENDING = 'waiting to hear whether a server keeps your things here';
/** What a player is told when one of their own things a server keeps cannot be changed: the line to it is down. */
export const SERVER_NOT_ANSWERING = 'the server that keeps it is not answering, so it cannot be changed just now';

/**
 * Why one of the player's own things cannot be put down or picked up now, or null: the keeper not known yet, or
 * the server that keeps them not answering (`authority`, the session's, no longer `server`).
 */
export function keptRefusal(keeper: Keeper, authority: string): string | null {
  if (keeper === 'pending') return KEEPER_PENDING;
  if (keeper === 'server' && authority !== 'server') return SERVER_NOT_ANSWERING;
  return null;
}

/** Which of a player's own things a change of keeper is about, in words, or '' for none. */
function keeperWhat(props: boolean, houses: boolean): string {
  return props && houses ? 'props and houses' : props ? 'props' : houses ? 'houses' : '';
}

/**
 * What the message line says of a change of keeper, once: only for a change in the middle of a world (one keeper
 * handing over to the other). An arrival's own answer, out of `pending`, is the ordinary case and says nothing.
 */
export function keeperNews(propsWas: Keeper, props: Keeper, housesWas: Keeper, houses: Keeper): string[] {
  const propsTo = props !== propsWas && propsWas !== 'pending' ? props : 'pending';
  const housesTo = houses !== housesWas && housesWas !== 'pending' ? houses : 'pending';
  const toServer = keeperWhat(propsTo === 'server', housesTo === 'server');
  const toLocal = keeperWhat(propsTo === 'local', housesTo === 'local');
  const out: string[] = [];
  if (toServer) out.push(`a server keeps your ${toServer} here now: what this machine keeps waits for a game with no server`);
  if (toLocal) out.push(`no server keeps your ${toLocal} now: what this machine keeps stands instead`);
  return out;
}

/** The thing name a server row is stood under, through the stand this browser's own props use: never one it mints. */
export function keptThing(id: string): string {
  return `s:${id}`;
}

/** What a server row's key is in the streamer. */
export function keptKey(id: string): string {
  return `prop:${keptThing(id)}`;
}

/** A row off the wire, or null when it is not one: a far end on another build can send anything. */
export function readKept(raw: unknown): KeptRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (typeof r.id !== 'string' || !r.id || typeof r.prop !== 'string' || !r.prop) return null;
  if (!num(r.x) || !num(r.y) || !num(r.z)) return null;
  if (!Array.isArray(r.q) || r.q.length !== 4 || !r.q.every(num)) return null;
  return { id: r.id, owner: typeof r.owner === 'string' ? r.owner : '', prop: r.prop, x: r.x, y: r.y, z: r.z, q: [r.q[0], r.q[1], r.q[2], r.q[3]], ...(r.inside === true ? { inside: true } : {}), at: num(r.at) ? r.at : 0 };
}

/** Whether two rows stand one thing in one place, turned one way. */
function sameSpot(a: KeptRow, b: KeptRow): boolean {
  return a.prop === b.prop && a.x === b.x && a.y === b.y && a.z === b.z && !!a.inside === !!b.inside && a.q[0] === b.q[0] && a.q[1] === b.q[1] && a.q[2] === b.q[2] && a.q[3] === b.q[3];
}

/** What `KeptProps` needs of the game around it, so a node test can hand it something small. */
export interface KeptDeps {
  /** Stand one, through the stand this browser's own props use (`App.placedDeps`); answers whether it went up. */
  stand(row: PlacedProp): Promise<boolean>;
  /** Take one down by its thing name (`keptThing`). */
  clear(thing: string): void;
  /** Say something to the player, once. */
  say(text: string): void;
  /** Send a word to the server. */
  send(msg: Record<string, unknown>): void;
}

/**
 * What the game hands `KeptProps.attach`: the stand this machine's own props go through (asked for afresh each
 * time, as `App.placedDeps` is made), the message line, and the socket. One function, so the relay's round-trip
 * test wires the very thing the game does.
 */
export function keptDepsOf(placed: () => PlacedDeps, say: (text: string) => void, net: { sendWord(msg: Record<string, unknown>): void }): KeptDeps {
  return {
    stand: (row) => placed().stand(row),
    clear: (thing) => placed().clear(thing),
    say,
    send: (msg) => net.sendWord(msg),
  };
}

/**
 * A word off the socket handed to the kept props when it is one of theirs (`PROP_WORDS`); answers whether it was.
 * What the game's own socket handler calls, and what the relay's round-trip test calls the same way.
 */
export function routePropWord(msg: Record<string, unknown> | null | undefined, kept: KeptProps): boolean {
  if (!msg || !(PROP_WORDS as readonly unknown[]).includes(msg.t)) return false;
  kept.word(msg);
  return true;
}

/** Why a server row is not stood here: in its owner's hand, or asked of the server and not answered yet. */
type Hidden = 'hand' | 'asked';

export class KeptProps {
  private deps: KeptDeps | null = null;
  /** Every row the server has said stands on this world, by its id: the truth, whether or not it stands here. */
  readonly rows = new Map<string, KeptRow>();
  /** The ids standing in this world, so a list arriving twice stands nothing twice. */
  private readonly standing = new Set<string>();
  /**
   * Stands still going up, by id, each under a number of its own: two words about one id in the same breath
   * cannot race each other, and a stand begun before an arrival (whose `enter` lets go of the lot) can never let
   * go of one begun after it under the same id, which would let a third stand file the same key a second time.
   */
  private readonly busy = new Map<string, number>();
  /** The number the next stand is filed under in `busy`. */
  private ticket = 0;
  /** The player's own rows kept down here: one in hand, or one whose move or removal was asked and not answered. */
  private readonly hidden = new Map<string, Hidden>();
  /**
   * Which world load the rows stand in: an arrival moves it on. A stand that lands after one went with the world it
   * was stood in, and is taken down here only while nothing of the next stands or goes up under its key.
   */
  private visit = 0;
  /**
   * Whether the rows are held down: until the world they are for is in (`ready`), and while this machine keeps
   * the player's things instead (`takeDownAll`). Held, the server's words are kept and nothing is stood.
   */
  private held = true;
  /** Which world these rows are about, so entering the same one again is told from a change of world. */
  private world = '';
  /** For the console. */
  stood = 0;
  refused = 0;
  lastWhy = '';

  attach(deps: KeptDeps): void {
    this.deps = deps;
  }

  /**
   * A world is being loaded: everything stood in the old one went with it, and nothing is stood until this
   * one is in (`ready`). The rows themselves go only when the world really changes, as the houses' do
   * (`Homes.enter`): the server hands its list over only on a change of world, so a respawn into the same
   * one keeps them to stand again. A thing in hand is let go of before an arrival, so nothing is hidden.
   */
  enter(world: string): void {
    this.standing.clear();
    this.busy.clear();
    this.hidden.clear();
    this.visit++;
    this.held = true;
    if (world !== this.world) {
      this.rows.clear();
      this.world = world;
    }
  }

  /** Everything forgotten, whatever world it was: leaving for the select screen, or a test. */
  clear(): void {
    this.standing.clear();
    this.busy.clear();
    this.hidden.clear();
    this.rows.clear();
    this.visit++;
    this.held = true;
    this.world = '';
  }

  /**
   * Stand every row: the world is in, and the server keeps the player's things. Rows a stand would not take
   * (the props catalogue still on its way) are kept, and stood by the next call.
   */
  ready(): void {
    this.held = false;
    for (const row of this.rows.values()) if (!this.standing.has(row.id)) void this.up(row);
  }

  /**
   * Take every row down and hold them there: this machine keeps the player's things now. A stand still going up
   * goes straight back down as it lands while they are held, and stands after all if they are stood again first
   * (`ready` leaves a row going up to the stand already on its way, rather than starting a second under its key).
   */
  takeDownAll(): void {
    this.held = true;
    for (const id of this.standing) this.deps?.clear(keptThing(id));
    this.standing.clear();
  }

  /** Whether the rows are held down (`ready`, `takeDownAll`). */
  get isHeld(): boolean {
    return this.held;
  }

  /** Everything the server has said about this world's props, handed over whole. */
  word(msg: Record<string, unknown>): void {
    switch (msg.t) {
      case 'props': {
        // The whole of what stands on this world: a row it no longer names was taken away while this browser
        // was not listening (a dropped line), and one asked about and not answered has its answer here.
        const rows: KeptRow[] = [];
        for (const raw of Array.isArray(msg.rows) ? msg.rows : []) {
          const row = readKept(raw);
          if (row) rows.push(row);
        }
        const named = new Set(rows.map((r) => r.id));
        for (const id of [...this.rows.keys()]) if (!named.has(id)) this.down(id);
        for (const [id, why] of this.hidden) if (why === 'asked') this.hidden.delete(id);
        for (const row of rows) this.moved(row);
        return;
      }
      case 'propUp': {
        const row = readKept(msg.prop);
        if (row) void this.up(row);
        return;
      }
      case 'propMoved': {
        const row = readKept(msg.prop);
        if (row) this.moved(row);
        return;
      }
      case 'propDown':
        this.down(String(msg.id ?? ''));
        return;
      case 'propNo': {
        this.refused++;
        this.lastWhy = String(msg.why ?? '');
        // A move or a removal refused names its row, which stands again where it stood; one with no row is about a
        // new prop, of which nothing stood here to put back (so a move still being asked is left alone).
        const id = typeof msg.id === 'string' ? msg.id : '';
        if (id && this.hidden.get(id) === 'asked') this.show(id);
        this.deps?.say(this.lastWhy || 'the server would not have it');
      }
    }
  }

  /** Ask the server to put one down. It appears when the server answers, never before. */
  ask(prop: string, at: { x: number; y: number; z: number }, q: readonly [number, number, number, number], inside: boolean): void {
    this.deps?.send({ t: 'placeProp', prop, x: at.x, y: at.y, z: at.z, q: [q[0], q[1], q[2], q[3]], ...(inside ? { inside: true } : {}) });
  }

  /** Ask the server to move one of the player's own. It stays down here until the server answers, and moves for everybody when it does. */
  askMove(id: string, at: { x: number; y: number; z: number }, q: readonly [number, number, number, number], inside: boolean): void {
    this.hideAs(id, 'asked');
    this.deps?.send({ t: 'moveProp', id, x: at.x, y: at.y, z: at.z, q: [q[0], q[1], q[2], q[3]], ...(inside ? { inside: true } : {}) });
  }

  /** Ask the server to take one away. It goes when the server answers, never before; refused, it stands again. */
  askDown(id: string): void {
    this.hideAs(id, 'asked');
    this.deps?.send({ t: 'removeProp', id });
  }

  /**
   * The player's own row nearest a point within `reach` (game frame, metres), or null: what the pick-up key
   * takes. Only one standing here: one in hand already, or one whose move is still being asked, is not to hand.
   */
  mineNearest(character: string, at: { x: number; y: number; z: number }, reach: number): KeptRow | null {
    if (!character) return null;
    let best: KeptRow | null = null;
    let bestD = reach;
    for (const id of this.standing) {
      const r = this.rows.get(id);
      if (!r || r.owner !== character) continue;
      const d = Math.hypot(r.x - at.x, r.y - at.y, r.z - at.z);
      if (d <= bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
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

  /** The player's own rows on this world, nearest first, for the console. */
  mine(character: string, at: { x: number; z: number }): KeptRow[] {
    const out = [...this.rows.values()].filter((r) => r.owner === character);
    out.sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z));
    return out;
  }

  /** Whether a row stands here now. */
  isStanding(id: string): boolean {
    return this.standing.has(id);
  }

  /** What `__debug.prop()` prints. */
  report(): { rows: number; standing: number; held: boolean; hidden: string[]; stood: number; refused: number; lastWhy: string } {
    return { rows: this.rows.size, standing: this.standing.size, held: this.held, hidden: this.hiddenIds(), stood: this.stood, refused: this.refused, lastWhy: this.lastWhy };
  }

  private hideAs(id: string, why: Hidden): void {
    this.hidden.set(id, why);
    if (this.standing.delete(id)) this.deps?.clear(keptThing(id));
  }

  /**
   * A row stood again where it stands now: the old one down here first, then up at its new place, under the same
   * key. One already standing exactly there (a list handed over again on a line that came back) is left alone.
   */
  private moved(row: KeptRow): void {
    const was = this.rows.get(row.id);
    if (was && this.standing.has(row.id) && sameSpot(was, row)) {
      this.rows.set(row.id, row);
      return;
    }
    if (this.standing.delete(row.id)) this.deps?.clear(keptThing(row.id));
    if (this.hidden.get(row.id) === 'asked') this.hidden.delete(row.id);
    void this.up(row);
  }

  private down(id: string): void {
    if (!id) return;
    // Forgotten first and in every case, so a prop whose word arrived while it was still going up is taken
    // down by the stand itself rather than left standing with nothing to name it.
    this.rows.delete(id);
    this.hidden.delete(id);
    if (this.standing.delete(id)) this.deps?.clear(keptThing(id));
  }

  /**
   * Stand one row, once. A stand already going up for it is the one that lands: never a second under its key,
   * which would file the key twice and leave a copy no take-down can reach. What it lands into is decided as it
   * lands: in a world since left it went with that world, and is taken down here only while nothing of this world
   * stands or goes up under its key; otherwise it stands if the rows still want it (not held, not hidden, the same
   * row), and goes straight back down if not -- and a row moved meanwhile goes up again at its new place.
   */
  private async up(row: KeptRow): Promise<void> {
    this.rows.set(row.id, row);
    if (this.held || this.hidden.has(row.id) || this.standing.has(row.id) || this.busy.has(row.id)) return;
    const deps = this.deps;
    if (!deps) return;
    const ticket = ++this.ticket;
    this.busy.set(row.id, ticket);
    const visit = this.visit;
    let again = false;
    try {
      const placed: PlacedProp = { thing: keptThing(row.id), id: row.prop, x: row.x, y: row.y, z: row.z, q: row.q, ...(row.inside ? { inside: true } : {}) };
      const ok = await deps.stand(placed);
      if (visit !== this.visit) {
        if (ok && !this.standing.has(row.id) && !this.busy.has(row.id)) deps.clear(keptThing(row.id));
        return;
      }
      if (this.held || this.rows.get(row.id) !== row || this.hidden.has(row.id) || this.standing.has(row.id)) {
        if (ok) deps.clear(keptThing(row.id));
        again = !this.held && !this.hidden.has(row.id) && this.rows.has(row.id) && this.rows.get(row.id) !== row;
        return;
      }
      if (ok) {
        this.standing.add(row.id);
        this.stood++;
      } else {
        // Kept, not thrown away: the catalogue may simply not have landed yet. `ready` tries again.
        this.lastWhy = 'it could not be stood here yet';
      }
    } finally {
      if (this.busy.get(row.id) === ticket) this.busy.delete(row.id);
      const now = again ? this.rows.get(row.id) : undefined;
      if (now) void this.up(now);
    }
  }
}

/** One for the session, as the net's own pieces are. */
export const keptProps = new KeptProps();
