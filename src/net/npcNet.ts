// The browser's half of the world's creatures: what this browser thinks for, what it is told about,
// and the one blow that crosses between the two.
//
// The shape is the one the fight between players already has (`combatNet.ts`). The server holds what
// is decided -- which browser keeps which creature, and what exists at all -- and this side holds
// what is observed. It decides nothing on its own: everything it is told comes through `handle`,
// everything it says goes out through `send`, and with no server (no address set, or the relay that
// came before) `active` is false, nothing is sent, nothing is driven from elsewhere and the game is
// exactly what it is today -- every creature this browser's own, its brain running, its damage
// applied where it lands.
//
// Four rules shape it, the same four the shots between players are written under. Nothing here
// touches the document, three.js or the socket, so a node test runs it as it is: a creature reaches
// this file as an `NpcSubject`, which is plain numbers and four calls. Nothing here runs in a frame
// -- the batch goes four times a second and a blow is an event. Nothing is allocated in a batch: the
// rows are a pool filled in place and the list that goes out is kept and truncated, which is safe
// because the socket writes a message before this side is given the frame back. And words from the
// far end are data: a number is checked finite before it is used, an id is checked against the ids
// this browser really holds, and nothing that arrives is allowed to throw in the middle of a
// message, since a throw there would cost every message after it.
//
// Two rules of its own, and they are what this whole file is for.
//
// **Nothing here ever takes health off a creature somebody else keeps.** A blow struck against a
// driven creature is *asked for* (`askHit`) and the keeper's own answer -- which arrives as the next
// batch's health, or as the word that it is gone -- is what kills it. That is the players' rule
// (the one who was hit is the only one who subtracts) turned round: the keeper is the creature's own
// browser, and it is the only place a number ever comes off.
//
// **A death happens once and stays.** An id this browser has been told died is remembered, so a
// creature cannot come back to life when it changes hands, when a late batch arrives from the old
// keeper, or when this browser is handed a world's worth of places on arriving.
//
// The wire is the server's (`server/npcWire.mjs`, and the cases in `server/relay.mjs`). This side
// sends `npcState`, `npcGone`, `npcHit` and `npcDrop`; it is sent `npcState`, `npcGone` and
// `npcHurt` -- the words in `NPC_WORDS`, which the socket has to hand over for any of this to
// happen at all.
//
// `npcDrop` is the one word that is about this browser rather than about a creature: it is how a
// browser hands back a grant it cannot honour. A creature granted to a browser whose catalogue does
// not know its species, or whose model never landed, would otherwise stand frozen on every screen
// for the life of the world -- that browser is talking normally, so the server's silence rule never
// reaches it, and it is the nearest, so every pass hands the creature straight back to it.

// Four things outside this file join it to the game: the socket's own switch hands these words over
// (`src/net/net.ts`), the wiring in `src/main.ts` gives it a socket, the grants and somebody to name
// a striker, the mobiles' manager hands it each of the world's creatures as it is stood and steps it
// on its own 4 Hz pass, and the world's list (`src/net/owned.ts`) is what stands them in the first
// place.

import type { Living } from '../combat/kit.ts';
import type { Authority } from './session.ts';

/**
 * The words this module answers. The socket (`src/net/net.ts`) hands a word over rather than reading
 * it, so this list and the one in its switch have to agree: a word missing there is a word this side
 * never hears, and every creature stands still with nothing to say why.
 */
export const NPC_WORDS = ['npcState', 'npcGone', 'npcHurt'] as const;

/**
 * Every number this side invents, in one place and live: `__npcs({ batchHz: 10 })` sets one and the
 * next batch obeys it. None of them is from the game. The rules about who keeps what are not here --
 * those are the server's (`server/ownership.mjs`) -- and neither are the wire's caps.
 */
export const NPC_TUNE = {
  /**
   * Invented (the design's figure): how many times a second a keeper says where what it keeps has
   * got to. Four is what a creature's pace needs: it is walking, not flying, and the glide below
   * covers the gaps.
   */
  batchHz: 4,
  /**
   * Invented: how many creatures may be in one batch. A keeper holding more sends the rest in the
   * next one, taking them in turn, so nothing is starved and no single message is enormous.
   */
  rows: 64,
  /**
   * Invented: the same tenth of a second every other glide in this game uses (`remotePlayers.ts`),
   * so a creature moves no differently from a person. It is here rather than in the mobile because
   * it is a property of how often the messages come, not of what is walking.
   */
  glideSeconds: 0.1,
  /**
   * Invented: seconds of silence after which a driven creature is counted as one whose keeper has
   * stopped speaking. Nothing is done about it here -- the server picks a new keeper -- but it is
   * the number the console reports, and it is what a browser watching a creature stand still would
   * want to know.
   */
  silentSeconds: 2,
  /**
   * Invented: how many creatures' places may be remembered for bodies this browser has not built
   * yet. A row for an id with no body here is kept so that the body, when it is stood, appears where
   * it really is rather than at its spawn point; past this many the rest are dropped, because what
   * arrives is a list another browser chose the length of.
   */
  remembered: 512,
  /**
   * Invented: how long a remembered row about a body this browser does not have is kept after the
   * last word about it. A creature really waiting for its model is spoken about four times a second
   * and never ages out; one on a world this browser has left is spoken about never, and this is what
   * empties it out of the list. Without it a page that had travelled enough times would hold the cap
   * in rows of worlds that are gone, and refuse the rows of the world it is standing in.
   */
  parkSeconds: 30,
  /**
   * Invented: how long a creature this browser has been granted may say nothing at all before the
   * grant is handed back (`npcDrop`). It has to be longer than a model takes to land and shorter
   * than a player will stand watching something not move. Nothing here measures the far end: this is
   * about a grant this browser cannot honour, and the server's own silence rule is about a browser
   * that has stopped speaking altogether.
   */
  cannotKeepSeconds: 6,
  /**
   * Invented: the least time between two words to the player out of this module. The message line
   * merges repeats of its own, but a creature this browser cannot build is spoken about on every
   * pass, and four notes a second is a screen of them.
   */
  noteEvery: 10,
};

/** Set any of those, clamped to what makes sense; the answer is the table as it now stands. */
export function tuneNpcs(o: Partial<typeof NPC_TUNE>): typeof NPC_TUNE {
  if (typeof o.batchHz === 'number') NPC_TUNE.batchHz = Math.max(0.5, Math.min(30, o.batchHz));
  if (typeof o.rows === 'number') NPC_TUNE.rows = Math.max(1, Math.min(64, Math.round(o.rows)));
  if (typeof o.glideSeconds === 'number') NPC_TUNE.glideSeconds = Math.max(0, Math.min(2, o.glideSeconds));
  if (typeof o.silentSeconds === 'number') NPC_TUNE.silentSeconds = Math.max(0.1, Math.min(60, o.silentSeconds));
  if (typeof o.remembered === 'number') NPC_TUNE.remembered = Math.max(0, Math.min(4096, Math.round(o.remembered)));
  if (typeof o.parkSeconds === 'number') NPC_TUNE.parkSeconds = Math.max(1, Math.min(600, o.parkSeconds));
  if (typeof o.cannotKeepSeconds === 'number') NPC_TUNE.cannotKeepSeconds = Math.max(1, Math.min(120, o.cannotKeepSeconds));
  if (typeof o.noteEvery === 'number') NPC_TUNE.noteEvery = Math.max(0, Math.min(600, o.noteEvery));
  return NPC_TUNE;
}

/**
 * Something that must be seen once rather than eased into: it was struck, and it left the ground.
 *
 * A death is not one of them, and deliberately: it has a word of its own that the server carries to
 * everybody (the spawn list's `dead`, which reaches this module as `noteGone`), and a row is never
 * sent for a creature that is already dead. A mark nothing can produce is a rule nothing can reach.
 */
export type NpcMark = 'hit' | 'leap';

/** Why a creature is gone: it died, or it was taken away. */
export type NpcEnd = 'dead' | 'gone';

/**
 * One creature as it crosses. It is written out as plain numbers rather than taken from the mobiles
 * package so that nothing of three.js or of the world reaches in here, and so that a node test can
 * fill one by hand.
 */
export interface NpcRow {
  /** The id every browser knows this creature by (the spawn record's). */
  i: string;
  p: [number, number, number];
  /** Which way it faces, radians. */
  h: number;
  /** What it is doing: the game's own state word. */
  s: string;
  /** What its feet are doing, metres a second, so the clip on the other side is the right one. */
  v: number;
  /** How much of it is left, as a share of the whole. */
  hp: number;
  /** Anything that has to be seen once. */
  f?: NpcMark;
  /** What it is thinking, so a change of keeper does not start it over. */
  b?: NpcBrain;
}

/**
 * A creature's own mind, as much of it as crosses.
 *
 * **A target cannot cross as a key.** Every living thing's key is handed out by the browser it was
 * made in (`nextLivingKey`), so the number one browser calls a bantha is another browser's rock.
 * What does mean the same everywhere is the id the world knows a creature by and the fact that
 * there is one player, so a target crosses as `'p'` or as that id and is looked up on arrival.
 *
 * The timers cross as the seconds they have left rather than as the moment they end, because the
 * two browsers' clocks are their own and a moment is meaningless between them.
 *
 * Everything here is optional and a browser built before it simply ignores the field, which is the
 * shape the rest of this protocol already has.
 */
export interface NpcBrain {
  /** What it is fighting: `'p'` for the player, else the id the world knows that creature by. */
  t?: string;
  /** Seconds of stun and of slow left on it. */
  st?: number;
  sl?: number;
  /** A burn: how much a second, and for how much longer. */
  bd?: number;
  bs?: number;
  /** Where it was walking, in the world's own metres. */
  gx?: number;
  gz?: number;
}

/**
 * What this file needs of a creature. A mobile fits it exactly; a node test fits it with an object
 * and four functions. Nothing here ever holds anything else of the thing it is talking about.
 */
export interface NpcSubject {
  /** The id everybody knows it by. */
  readonly npcId: string;
  /** Whether it is dead here. A dead one is still sent (its death is what everyone must hear) and never driven. */
  readonly npcDead: boolean;
  /**
   * Fill a row with where it is and what it is doing; false when there is nothing worth saying yet
   * (its model is still loading, or it has been taken out of the world).
   */
  npcFill(row: NpcRow): boolean;
  /** What the keeper says. Eased toward, never jumped to -- `snap` is the first word about it, where there is nothing to ease from. */
  npcDrive(row: NpcRow, snap: boolean): void;
  /** Thinking for it here, or driven from elsewhere. Called only when the answer changes. */
  npcSetDriven(driven: boolean): void;
  /** A blow somebody else struck. Only ever called on the keeper's own copy: it is the only place a number comes off. */
  npcHurt(amount: number, x: number, y: number, z: number, source: Living | null, what: string): void;
  /** The keeper says it is gone. */
  npcEnd(why: NpcEnd): void;
}

/** What the module is doing, filled in place so the console can read it between frames. */
export interface NpcStats {
  active: boolean;
  /** How many creatures this browser holds a body for, and how many of those it thinks for. */
  held: number;
  kept: number;
  driven: number;
  /** Batches and rows said and heard since the page began. */
  sent: number;
  rowsSent: number;
  heard: number;
  rowsHeard: number;
  /** Rows about creatures this browser has no body for, remembered for when it stands one. */
  waiting: number;
  /** Rows dropped because there were already as many remembered as there may be. */
  refused: number;
  /** Blows asked of a keeper, and blows this browser was asked to apply. */
  asked: number;
  applied: number;
  /** Creatures this browser has been told died, which can never come back. */
  deaths: number;
  /** Driven creatures whose keeper has said nothing for longer than it should have. */
  silent: number;
  /** Grants this browser could not honour and handed back: it has no body for them and cannot build one. */
  handedBack: number;
}

/** A finite number, or the fallback: everything that arrives is read through one of these. */
function num(x: unknown, fallback = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

/** Three finite numbers, or null. */
function point(x: unknown): [number, number, number] | null {
  if (!Array.isArray(x) || x.length !== 3) return null;
  const out: [number, number, number] = [Number(x[0]), Number(x[1]), Number(x[2])];
  return out.every((v) => Number.isFinite(v)) ? out : null;
}

/** A relay id: a whole number above zero, or 0 for nobody. */
function who(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** An id off the wire, checked the way the server checks it: it is a key into what this browser holds. */
const ID = /^[A-Za-z0-9_.:-]+$/;

function idOf(x: unknown): string {
  return typeof x === 'string' && x && x.length <= 64 && ID.test(x) ? x : '';
}

const MARKS: readonly string[] = ['hit', 'leap'];

/**
 * A row read off the wire into a kept object; false when it was not one. The place is read number
 * by number rather than through `point`, because this runs once per creature in every batch and a
 * batch comes four times a second: a triple made here would be rubbish made on a clock.
 */
function readRow(raw: unknown, into: NpcRow): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  const i = idOf(o.i);
  const p = o.p;
  if (!i || !Array.isArray(p) || p.length !== 3) return false;
  const x = Number(p[0]);
  const y = Number(p[1]);
  const z = Number(p[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  into.i = i;
  into.p[0] = x;
  into.p[1] = y;
  into.p[2] = z;
  into.h = num(o.h);
  into.s = typeof o.s === 'string' ? o.s : 'idle';
  into.v = Math.max(0, num(o.v));
  into.hp = Math.min(1, Math.max(0, num(o.hp, 1)));
  into.f = MARKS.includes(String(o.f)) ? (o.f as NpcMark) : undefined;
  return true;
}

/** A fresh row, for the pools. */
function blankRow(): NpcRow {
  return { i: '', p: [0, 0, 0], h: 0, s: 'idle', v: 0, hp: 1 };
}

/** Two decimal places for a place, three for a heading: the states are cut the same way. */
function r2(n: number): number {
  return Number(num(n).toFixed(2));
}

function r3(n: number): number {
  return Number(num(n).toFixed(3));
}

/**
 * The world's creatures as this browser holds them. One of these is made once and lives for the
 * page.
 */
export class NpcNet {
  /** Something to send: the socket puts it on the wire. Set by the wiring. */
  send: (msg: Record<string, unknown>) => void = () => {};
  /** Who decides: with no server this answers 'me' and the whole module stays quiet. */
  authority: () => Authority = () => 'me';
  /**
   * Whether this browser thinks for that creature. The server's grants (`src/net/owned.ts`) answer
   * it; with nothing wired everything is this browser's, which is the game as it is today.
   */
  keeps: (id: string) => boolean = () => true;
  /**
   * Every id the server has granted this browser, as the world's own list knows them. It is asked
   * once a batch and never in a frame, and it is what lets a grant this browser cannot honour be
   * handed back: `keeps` answers about an id somebody already has, and a creature with no body here
   * is exactly the one nothing would ever think to ask about. With nothing wired it answers nothing,
   * which turns handing a grant back off and leaves the rest of the module as it was.
   */
  granted: () => Iterable<string> = () => [];
  /**
   * Who struck, as this browser names them, from the relay id on a blow. It is what lets a creature
   * turn on the right person: with nothing wired the blow still lands and the creature simply does
   * not know who did it.
   */
  attacker: (id: number) => Living | null = () => null;
  /**
   * Say that one this browser was keeping has died. It is the keeper's word and nobody else's.
   *
   * It is a hook rather than a message of its own because the world's spawn list already carries a
   * death (`src/net/owned.ts`, which holds what stands in a world and whether it is alive), and two
   * words for one death would be two paths for the same thing -- exactly what this wave is written
   * not to have. It answers true when something took the word; with nothing wired the module says
   * `npcGone` itself, which is what makes it whole on its own and testable without the spawn list.
   */
  died: (id: string) => boolean = () => false;
  /**
   * Whether the world's own list says that one is dead. Asked beside this module's own memory, so a
   * death heard by the spawn list and a death heard here are one answer. With nothing wired only
   * what this module was told itself counts.
   */
  buried: (id: string) => boolean = () => false;
  /** Something the player should read (a creature refused, a keeper lost). */
  onNote: (text: string) => void = () => {};
  /** The clock the rates are measured on, in seconds; a test hands in its own. */
  private readonly now: () => number;

  /** Every creature this browser holds a body for, by id, and the same list in order for the batch's turn. */
  private readonly subjects = new Map<string, NpcSubject>();
  private readonly order: NpcSubject[] = [];
  /** Where the batch had got to, so a keeper with more than one batch's worth takes them in turn. */
  private cursor = 0;
  /** Which of them are driven from elsewhere just now, so the change is noticed rather than asked every frame. */
  private readonly drivenNow = new Set<string>();
  /** When each driven one was last spoken about, for the silence count. */
  private readonly toldAt = new Map<string, number>();
  /** A row about a creature this browser has no body for yet: it is stood where it really is. */
  private readonly waiting = new Map<string, NpcRow>();
  /** When each of those was last spoken about, so rows of a world this browser has left age out of it. */
  private readonly parkedAt = new Map<string, number>();
  /**
   * One record per creature the server has granted this browser: when it last managed to say
   * anything about it, and whether the grant has been handed back. `pass` is the round it was last
   * seen granted in, which is how records of creatures no longer granted are swept without keeping a
   * second set to compare against.
   */
  private readonly granting = new Map<string, { said: number; told: boolean; pass: number }>();
  private pass = 0;
  /** When the player was last told anything by this module, so a note is not said four times a second. */
  private notedAt = -Infinity;
  /** Every id this browser has been told died. A death happens once and stays. */
  private readonly deaths = new Set<string>();
  /** Which ones have been said to be gone from here, so one death is one message. */
  private readonly saidGone = new Set<string>();
  /** The rows sent, filled in place; the list is kept and truncated, and the socket writes it before we are given the frame back. */
  private readonly pool: NpcRow[] = [];
  private readonly out: NpcRow[] = [];
  /** The one row a heard batch is read into, refilled per row. */
  private readonly heardRow: NpcRow = blankRow();
  private clock = 0;
  private readonly stat: NpcStats = { active: false, held: 0, kept: 0, driven: 0, sent: 0, rowsSent: 0, heard: 0, rowsHeard: 0, waiting: 0, refused: 0, asked: 0, applied: 0, deaths: 0, silent: 0, handedBack: 0 };

  constructor(now: () => number = () => Date.now() / 1000) {
    this.now = now;
    theCreatures = this;
  }

  // ---- what everything else asks ------------------------------------------------------------------

  /** Whether there is a server holding a world. With none, nothing crosses and every creature is this browser's. */
  get active(): boolean {
    return this.authority() === 'server';
  }

  /** Whether this browser thinks for that creature. Everything is this browser's with no server. */
  mine(id: string): boolean {
    if (!this.active) return true;
    return this.keeps(id);
  }

  /** Whether that creature is known to have died. Nothing may bring it back. */
  isDead(id: string): boolean {
    if (this.deaths.has(id)) return true;
    try {
      return this.buried(id);
    } catch {
      return false;
    }
  }

  /**
   * The world says one has gone: it died where it was being kept, or it was taken down. Called by
   * whoever reads the world's own spawn list, and by this module's own `npcGone`, so there is one
   * place a creature ends however the news arrived.
   *
   * A death is remembered for the life of the world, which is what keeps a creature from coming back
   * when it changes hands, when a late batch arrives from the keeper that had it, or when a browser
   * that has just arrived is handed a list of where everything stands.
   */
  noteGone(id: string, why: NpcEnd): void {
    if (!id) return;
    if (why === 'dead') {
      this.deaths.add(id);
      this.stat.deaths = this.deaths.size;
    }
    // Said once, whoever said it, and for both kinds of going: this browser must not announce
    // something it was itself told about, and a body ended by the word below would otherwise be
    // found dead by the next batch and announced as though this browser had killed it.
    this.saidGone.add(id);
    this.waiting.delete(id);
    this.parkedAt.delete(id);
    this.granting.delete(id);
    this.stat.waiting = this.waiting.size;
    // The word ends the body whether this browser was being driven about it or thinking for it.
    //
    // It used to end only a driven one, on the reasoning that a stale word must not kill a creature
    // just handed over -- but there is no such thing as a stale death here. A death is the keeper's
    // own decision, the server is what passes it on, and it happens once and stays; and the moment a
    // creature changes hands is exactly the moment the two cross. Ended only when driven, a death
    // that arrived a quarter of a second after this browser was handed the creature left a live body
    // standing here that everybody else had buried -- and, because the id is in `saidGone` by then,
    // its eventual death here was never announced either, so it stood for ever.
    const s = this.subjects.get(id);
    if (s) s.npcEnd(why);
  }

  // ---- the creatures this browser holds ------------------------------------------------------------

  /**
   * A creature has been stood here. If something has already been said about where it is, it is put
   * there at once rather than eased across the world from its spawn point, and if it is one this
   * browser has been told died it is ended in the same breath.
   */
  add(s: NpcSubject): void {
    const id = s.npcId;
    if (!id) return;
    // A body stood again under an id this browser already holds (it was cleared and rebuilt) takes
    // that id over outright: two entries in the list would be one creature spoken about twice.
    this.remove(id);
    this.subjects.set(id, s);
    this.order.push(s);
    this.stat.held = this.order.length;
    const driven = this.active && !this.keeps(id);
    if (driven) {
      this.drivenNow.add(id);
      s.npcSetDriven(true);
    }
    const row = this.waiting.get(id);
    if (row) {
      this.waiting.delete(id);
      this.parkedAt.delete(id);
      this.stat.waiting = this.waiting.size;
      s.npcDrive(row, true);
    }
    if (this.isDead(id)) s.npcEnd('dead');
  }

  /** It has been taken out of the world here. Nothing is said: it is this browser's body that went, not the creature. */
  remove(id: string): void {
    const s = this.subjects.get(id);
    if (!s) return;
    this.subjects.delete(id);
    const i = this.order.indexOf(s);
    if (i >= 0) this.order.splice(i, 1);
    this.drivenNow.delete(id);
    this.toldAt.delete(id);
    this.stat.held = this.order.length;
  }

  /** The creature this browser holds under that id, or null. */
  find(id: string): NpcSubject | null {
    return this.subjects.get(id) ?? null;
  }

  // ---- what goes out --------------------------------------------------------------------------------

  /**
   * Time passing, at whatever rate the wiring asks (the mobiles' own pass, never per frame). It does
   * three things: it asks the grants who keeps what and turns the answer into driven or not, it
   * sends a batch about what this browser keeps at the batch's own rate, and it says once about
   * anything of its own that has died.
   *
   * The first step after a world is loaded, or after the line comes back, says its batch at once
   * rather than waiting out a quarter of a second: that is the message somebody who has just
   * arrived is waiting on, and there is nothing to be gained by making them wait.
   */
  step(dt: number): void {
    if (!this.active) return;
    this.clock -= dt;
    if (this.clock > 0) return;
    this.clock = 1 / Math.max(0.5, NPC_TUNE.batchHz);
    this.reconcile();
    this.gather();
    this.watchGrants();
  }

  /**
   * The grants this browser has been given but cannot honour, handed back.
   *
   * A grant names a creature; keeping it means saying where that creature has got to. A browser with
   * no body for one says nothing about it -- its catalogue does not know the species, or the model
   * is still in flight -- and nothing about that is visible from anywhere else: it is talking
   * normally, so the server's silence rule never reaches it, and it is the nearest, so every pass
   * hands the creature straight back to it. The creature stands frozen on every screen in the world,
   * for the life of the world. So this is the word for "I cannot keep this" (`npcDrop`), said once
   * per grant, and the server's answer is to let go of it and not offer it here again for a while.
   *
   * It runs at the batch's own rate and asks the list once; the sweep at the end is what keeps the
   * records from outliving the grants, and it only walks the map when there are more records than
   * grants.
   */
  private watchGrants(): void {
    const now = this.now();
    this.pass++;
    let count = 0;
    for (const id of this.safeGranted()) {
      if (!id) continue;
      count++;
      let rec = this.granting.get(id);
      if (!rec) {
        // A grant met for the first time starts its clock now rather than at nought: a page that has
        // been open an hour must not hand back everything it is given in the same breath.
        rec = { said: now, told: false, pass: this.pass };
        this.granting.set(id, rec);
      }
      rec.pass = this.pass;
      if (rec.told) continue;
      // A creature that has died, or been taken away, rightly says nothing more.
      if (this.isDead(id) || this.saidGone.has(id)) {
        rec.said = now;
        continue;
      }
      if (now - rec.said <= NPC_TUNE.cannotKeepSeconds) continue;
      rec.told = true;
      this.stat.handedBack++;
      this.send({ t: 'npcDrop', i: id });
      this.note(this.subjects.has(id) ? 'a creature here is still being built: it has gone back to the world' : 'a creature this browser cannot build has gone back to the world');
    }
    if (this.granting.size > count) for (const [id, rec] of this.granting) if (rec.pass !== this.pass) this.granting.delete(id);
  }

  /** The grants, asked of the game. A hook that throws costs this one pass and nothing else. */
  private safeGranted(): Iterable<string> {
    try {
      return this.granted() ?? [];
    } catch {
      return [];
    }
  }

  /**
   * A word for the player, at most one every `noteEvery` seconds. The two things worth saying -- a
   * grant handed back, and a row refused for want of room -- both happen on a clock, so without the
   * gap they would be said four times a second for as long as they went on.
   */
  private note(text: string): void {
    const now = this.now();
    if (now - this.notedAt < NPC_TUNE.noteEvery) return;
    this.notedAt = now;
    try {
      this.onNote(text);
    } catch {
      // A display that cannot take a word must not cost the batch it arrived in.
    }
  }

  /** Who keeps what, as the server last granted it: only a creature whose answer changed is told. */
  private reconcile(): void {
    let driven = 0;
    for (const s of this.order) {
      const id = s.npcId;
      const want = !this.keeps(id);
      const had = this.drivenNow.has(id);
      if (want !== had) {
        if (want) this.drivenNow.add(id);
        else this.drivenNow.delete(id);
        // Seamless either way: taking one over starts the brain from where the body is, and giving
        // one up eases from where it stands. Neither resets a pose (`mobile.ts`).
        s.npcSetDriven(want);
      }
      if (want) driven++;
    }
    this.stat.driven = driven;
    this.stat.kept = this.order.length - driven;
  }

  /** One batch about what this browser keeps, and one word about anything of its own that has gone. */
  private gather(): void {
    const n = this.order.length;
    if (!n) return;
    const cap = Math.max(1, Math.min(NPC_TUNE.rows, 64));
    this.out.length = 0;
    // Round the list from where the last batch stopped, so a keeper holding more than one batch's
    // worth says something about every one of them rather than about the first sixty-four for ever.
    if (this.cursor >= n) this.cursor = 0;
    const now = this.now();
    for (let step = 0; step < n && this.out.length < cap; step++) {
      const s = this.order[(this.cursor + step) % n];
      const id = s.npcId;
      // A death is looked at before the grant is, and that order is the whole of it. The grants go
      // out twice a second and the batches four times, so a creature killed here can have changed
      // hands before this pass reaches it; asked about the grant first, the death was swallowed --
      // it was dead on this screen, alive on every other, and the browser that took it over went on
      // running a live brain for something the player had watched fall. Said in this order it is
      // announced whatever the grant now says, and the server's own grace (`mayKill`) is what makes
      // the word count. It is still said exactly once, which `saidGone` is for.
      if (s.npcDead) {
        // Its death is the one thing everybody must hear, and it is said once. The body itself is
        // still drawn here while its own clip plays out; nothing more is said about it.
        if (!this.saidGone.has(id)) {
          this.saidGone.add(id);
          // A death the world has already heard is not said back: it reached this browser as the
          // list's own word or as `npcGone`, and answering it would be the second path for one death
          // that this wave exists not to have. What is left is a death decided here.
          if (!this.isDead(id)) {
            this.deaths.add(id);
            this.stat.deaths = this.deaths.size;
            // The world's own spawn list carries a death where there is one; with nothing wired to
            // take it, this module says it itself so that the wire is whole on its own.
            if (!this.sayDied(id)) this.send({ t: 'npcGone', i: id, why: 'dead' });
          }
        }
        continue;
      }
      if (this.drivenNow.has(id)) continue;
      let row = this.pool[this.out.length];
      if (!row) {
        row = blankRow();
        this.pool.push(row);
      }
      row.i = id;
      row.f = undefined;
      if (!s.npcFill(row)) continue;
      row.p[0] = r2(row.p[0]);
      row.p[1] = r2(row.p[1]);
      row.p[2] = r2(row.p[2]);
      row.h = r3(row.h);
      row.v = r2(row.v);
      row.hp = Math.round(Math.min(1, Math.max(0, row.hp)) * 1000) / 1000;
      this.out.push(row);
      // It managed to say something, so the grant it is held under is one this browser can honour.
      const rec = this.granting.get(id);
      if (rec) rec.said = now;
    }
    this.cursor = (this.cursor + Math.max(1, this.out.length)) % n;
    if (!this.out.length) return;
    this.stat.sent++;
    this.stat.rowsSent += this.out.length;
    this.send({ t: 'npcState', r: this.out });
  }

  /**
   * A creature this browser keeps has been taken away rather than killed (an admin cleared it, the
   * world let it go). Said once, and never for one that died -- that is its own word.
   */
  sayGone(id: string): void {
    if (!this.active || !id || this.saidGone.has(id)) return;
    this.saidGone.add(id);
    this.send({ t: 'npcGone', i: id, why: 'gone' });
  }

  /**
   * A blow struck here against a creature this browser does not keep. It is asked for and nothing
   * more: the keeper applies it on its own copy, and what comes back is the health in the next batch
   * or the word that it is gone. True when the word went out, which is what tells the caller to stop
   * rather than subtract anything.
   *
   * `byPlayer` is the whole of what crosses about who struck, and it is a flag rather than a name on
   * purpose: the only person one browser can point at on another is that browser's own player. A
   * creature of this browser's, an NPC fighter of its or a turret of its is nobody the keeper can
   * name, and carrying the blow under this browser's player would turn the keeper's creature -- and,
   * through the pack's alert, everything with it -- on somebody who did nothing at all. Unset, the
   * blow lands with nobody to blame, which is the true answer rather than a convenient one.
   */
  askHit(id: string, amount: number, x: number, y: number, z: number, what = '', byPlayer = false): boolean {
    if (!this.active || !id || !(amount > 0)) return false;
    // Nobody is asked to kill something twice: the blow is refused here, and refusing it is still
    // "the keeper decides", because the keeper is where that death was decided.
    if (this.isDead(id)) return true;
    this.stat.asked++;
    this.send({ t: 'npcHit', i: id, a: r2(amount), at: [r2(x), r2(y), r2(z)], ...(what ? { w: what.slice(0, 16) } : {}), ...(byPlayer ? { b: 1 } : {}) });
    return true;
  }

  // ---- what the server says ---------------------------------------------------------------------------

  /**
   * One message from the far end. True when it was one of ours, so the socket's own switch can go on
   * ignoring everything it does not know. Everything in it is treated as words from a stranger: read
   * through the checks above, never trusted, and never allowed to throw.
   */
  handle(msg: Record<string, unknown>): boolean {
    switch (String(msg?.t ?? '')) {
      case 'npcState':
        this.heardBatch(msg);
        return true;
      case 'npcGone': {
        const id = idOf(msg.i);
        if (id) this.noteGone(id, msg.why === 'dead' ? 'dead' : 'gone');
        return true;
      }
      case 'npcHurt': {
        // Somebody struck a creature this browser keeps. This is the only place a number ever comes
        // off a creature, and it is refused outright for one this browser does not keep: a browser
        // on another build must not be able to hurt something through a copy that is only a picture.
        const id = idOf(msg.i);
        const a = num(msg.a);
        if (!id || !(a > 0) || this.drivenNow.has(id)) return true;
        const s = this.subjects.get(id);
        if (!s) return true;
        const at = point(msg.at) ?? [0, 0, 0];
        // Who struck, and only where the message says the player at that browser struck it
        // themselves (`b`). Every blow carries the connection it came through, but that names the
        // browser and not the striker: a creature of theirs, a fighter of theirs or a turret of
        // theirs is nobody nameable here, and blamed on their player it would set this creature and
        // its whole pack on somebody who never touched it. With no `b` the blow lands and the
        // creature simply does not know who did it.
        const from = msg.b ? who(msg.id) : 0;
        this.stat.applied++;
        s.npcHurt(a, at[0], at[1], at[2], from ? this.safeAttacker(from) : null, typeof msg.w === 'string' ? msg.w.slice(0, 16) : '');
        return true;
      }
      default:
        return false;
    }
  }

  /** Who struck, asked of the game. A hook that throws costs this one blow its blame and nothing else. */
  private safeAttacker(id: number): Living | null {
    try {
      return this.attacker(id);
    } catch {
      return null;
    }
  }

  /** The world's list told about a death, if anything is listening; false when this module must say it. */
  private sayDied(id: string): boolean {
    try {
      return this.died(id);
    } catch {
      return false;
    }
  }

  private heardBatch(msg: Record<string, unknown>): void {
    const rows = msg.r;
    if (!Array.isArray(rows)) return;
    this.stat.heard++;
    const now = this.now();
    let n = 0;
    for (const raw of rows) {
      if (n >= 64) break;
      if (!readRow(raw, this.heardRow)) continue;
      n++;
      const id = this.heardRow.i;
      // Dead is dead: a late batch from the keeper that had it, or the world's own list of places
      // handed over on arriving, must never stand a creature back up.
      if (this.isDead(id)) continue;
      const s = this.subjects.get(id);
      if (!s) {
        this.park(id);
        continue;
      }
      // A creature this browser thinks for is not moved by anything anybody else says. This is the
      // one place two keepers at once would show, and the answer is that the grant is the truth.
      if (!this.drivenNow.has(id)) continue;
      const first = !this.toldAt.has(id);
      this.toldAt.set(id, now);
      s.npcDrive(this.heardRow, first);
    }
    this.stat.rowsHeard += n;
  }

  /** A row about a creature this browser has no body for: kept, so the body is stood where it really is. */
  private park(id: string): void {
    const now = this.now();
    const had = this.waiting.get(id);
    const row = had ?? blankRow();
    if (!had) {
      // Room is made from rows nothing has spoken about for a while before any is refused. A
      // creature really waiting for its model is spoken about four times a second and can never age
      // out; a row of a world this browser has left is spoken about never, and this is what takes it
      // away. Without it a page that had travelled enough times held its whole allowance in worlds
      // that are gone and refused the rows of the world it was standing in -- which is precisely the
      // one message a browser arriving on a world is waiting for.
      if (this.waiting.size >= NPC_TUNE.remembered) this.sweepParked(now);
      if (this.waiting.size >= NPC_TUNE.remembered) {
        this.stat.refused++;
        this.note('there are more creatures out there than this browser is keeping track of');
        return;
      }
      this.waiting.set(id, row);
    }
    this.parkedAt.set(id, now);
    const from = this.heardRow;
    row.i = id;
    // Written into the row that is already there: a creature nobody here has a body for is spoken
    // about four times a second for as long as it is out of reach, and a fresh triple each time
    // would be rubbish made in the name of a thing that is not even drawn.
    row.p[0] = from.p[0];
    row.p[1] = from.p[1];
    row.p[2] = from.p[2];
    row.h = from.h;
    row.s = from.s;
    row.v = from.v;
    row.hp = from.hp;
    // A mark is a thing that happened once, and a body that does not exist yet cannot have seen it.
    row.f = undefined;
    this.stat.waiting = this.waiting.size;
  }

  /** Rows nothing has spoken about for `parkSeconds`: they belong to a world that has been left. */
  private sweepParked(now: number): void {
    for (const [id, at] of this.parkedAt) {
      if (now - at <= NPC_TUNE.parkSeconds) continue;
      this.parkedAt.delete(id);
      this.waiting.delete(id);
    }
    this.stat.waiting = this.waiting.size;
  }

  /**
   * This browser has arrived on a world, or travelled to another one: the world's own list has just
   * been handed over and it is the whole truth about what stands here. Everything remembered about
   * where things were goes, because none of it is about this world -- a row parked for a body that
   * was never built, the moment each driven creature was last spoken about, and the clocks the
   * grants are watched on. Nothing about a death goes: an id is unique to the world it was stood in,
   * a death happens once and stays, and forgetting one is how a creature comes back to life.
   */
  freshWorld(): void {
    this.waiting.clear();
    this.parkedAt.clear();
    this.toldAt.clear();
    this.granting.clear();
    this.pass = 0;
    this.stat.waiting = 0;
  }

  /**
   * The line dropped, the player went to the select screen, or the world was unloaded. Every
   * creature goes back to being this browser's own -- a body left driven would stand still for ever
   * with nobody to drive it -- and everything remembered about a world that has gone goes with it.
   */
  clear(): void {
    for (const s of this.order) if (this.drivenNow.has(s.npcId)) s.npcSetDriven(false);
    this.subjects.clear();
    this.order.length = 0;
    this.drivenNow.clear();
    this.toldAt.clear();
    this.waiting.clear();
    this.parkedAt.clear();
    this.granting.clear();
    this.deaths.clear();
    this.saidGone.clear();
    this.pass = 0;
    this.notedAt = -Infinity;
    this.cursor = 0;
    this.clock = 0;
    this.stat.held = 0;
    this.stat.kept = 0;
    this.stat.driven = 0;
    this.stat.waiting = 0;
    this.stat.deaths = 0;
  }

  /** What the creatures are doing, in the object it always answers with. */
  debug(): NpcStats {
    this.stat.active = this.active;
    this.stat.held = this.order.length;
    this.stat.driven = this.drivenNow.size;
    this.stat.kept = this.order.length - this.drivenNow.size;
    this.stat.waiting = this.waiting.size;
    this.stat.deaths = this.deaths.size;
    const now = this.now();
    let silent = 0;
    for (const id of this.drivenNow) {
      const at = this.toldAt.get(id);
      if (at === undefined || now - at > NPC_TUNE.silentSeconds) silent++;
    }
    this.stat.silent = silent;
    return this.stat;
  }

  /** The ids this browser thinks for and the ids it is told about, for the console. */
  rows(): Record<string, unknown> {
    const kept: string[] = [];
    const driven: string[] = [];
    for (const s of this.order) (this.drivenNow.has(s.npcId) ? driven : kept).push(s.npcId);
    return { ...this.debug(), keptIds: kept, drivenIds: driven, tune: { ...NPC_TUNE } };
  }
}

/**
 * The one in play. There is a single set of the world's creatures for the life of the page, and the
 * parts of the game that are not handed it -- a mobile, which is built far from the wiring -- ask
 * for it here. It answers null before the game has made one, and with no server it is made and
 * quiet, so a caller never has to ask whether there is a server: `mine` answers yes.
 */
let theCreatures: NpcNet | null = null;

export function npcNow(): NpcNet | null {
  return theCreatures;
}

/**
 * The live knob, on the window as `__npcs()`: what this browser thinks for, what it is told about,
 * and the numbers above. Reading it costs nothing and it never runs in a frame.
 */
export function npcKnob(opts?: Partial<typeof NPC_TUNE>): Record<string, unknown> {
  if (opts) tuneNpcs(opts);
  const net = theCreatures;
  return net ? net.rows() : { active: false, held: 0, tune: { ...NPC_TUNE } };
}

// Reachable wherever there is a console: this has no panel of its own, and a browser driven by a
// script is hidden, so the only way to see what it decided is to ask it in numbers.
(globalThis as unknown as { __npcs?: typeof npcKnob }).__npcs = npcKnob;
