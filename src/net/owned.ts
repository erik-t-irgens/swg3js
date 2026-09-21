// The browser's half of who thinks for a creature.
//
// The world's automatic wildlife is off: nothing stands in a world unless an admin stood it there by
// hand, and what an admin stands is the world's -- everyone connected is told about it, and exactly
// one browser thinks for it. Which browser that is, is the server's to say (server/ownership.mjs):
// the nearest player within 180 m, changing hands only when somebody else has been a quarter nearer
// for three seconds. This file is what that answer looks like on this side. It decides nothing.
//
// What the rest of the game asks is one question -- `owned.mine(id)` -- and the answer shapes
// everything else: a creature this browser keeps runs its brain, its steering and its own physics,
// and one it does not is driven from the keeper's messages and forwards a blow to them instead of
// subtracting it. With no server at all the answer is always yes, which is the game exactly as it is
// when it is played alone: every creature you can see is yours.
//
// Three rules shape the file, the same three the group's half was written to. Nothing here touches
// the document, three.js or the socket, so a node test runs it as it is. Nothing here runs in a
// frame: the list changes when the server says so, and `mine` is a lookup in a Set. And with no
// server -- no address set, or the relay that came before -- it is quiet and empty: nothing is sent,
// nothing is held and the game is what it was.
//
// Words that arrive from the far end are data: a species is a name out of the catalogue and is looked
// up, never run, and every number is read as a number or dropped.

import type { Authority } from './session.ts';

/**
 * The numbers this side invents, live through `__debug.owned({ ... })`. The rule's own numbers -- the
 * 180 m, the quarter, the three seconds -- are not here: they are the server's (`OWN_TUNING` in
 * server/ownership.mjs), because the server is what decides and two copies of a rule are one rule too
 * many. These are the browser's own manners.
 */
export const OWN_TUNE = {
  /**
   * How many spawn words this browser may send in a second. It is the server's own number kept here
   * so that one over it is answered with a word rather than vanishing: the server drops it and says
   * nothing, and an admin clicking into the void would think the button was broken.
   */
  asksPerSecond: 8,
  /** How many creatures this browser will hold a row for at once: the server's cap on one world. */
  rows: 200,
  /**
   * How long after one has been taken off this browser it may still say that one died, in seconds.
   * It is the server's own grace kept here for the same reason the rate is: a keeper drops a creature
   * to nothing and says so in the same breath, the grants go out twice a second, and the two cross --
   * so the word has to go out for a moment after the grant went away or the kill is simply lost and
   * whoever takes the creature over stands it back up whole. The server has the same grace and is
   * what enforces it; this side only has to be willing to speak.
   */
  deathGrace: 5,
};

/** Set any of those, clamped to what makes sense; the answer is the table as it now stands. */
export function tuneOwned(o: Partial<typeof OWN_TUNE>): typeof OWN_TUNE {
  if (typeof o.asksPerSecond === 'number') OWN_TUNE.asksPerSecond = Math.max(1, Math.min(60, Math.round(o.asksPerSecond)));
  if (typeof o.rows === 'number') OWN_TUNE.rows = Math.max(1, Math.min(2000, Math.round(o.rows)));
  if (typeof o.deathGrace === 'number') OWN_TUNE.deathGrace = Math.max(0, Math.min(60, o.deathGrace));
  return OWN_TUNE;
}

/**
 * One creature the world holds, as the server hands it over: what to stand, where, which way it
 * faces, and the seed it rolls its own numbers from -- its size, which colour of its species it is,
 * which idle it starts on -- so that every browser rolls the same ones without anybody sending them.
 */
export interface SpawnRow {
  id: string;
  /** The world it stands in, as the server keys them. Kept as it was sent and never parsed. */
  world: string;
  species: string;
  at: [number, number, number];
  h: number;
  seed: number;
  /**
   * How much of it is left, as a share of a whole one, when anybody has said: a creature that has
   * been fought and then changes hands, or that is built for the first time by somebody who has just
   * walked up to it, must not be stood up whole. Undefined means nobody has said anything about it,
   * which is not the same as full.
   */
  hp?: number;
  /**
   * Whether it was stood inside a building's rooms rather than on the ground. It is the one thing
   * about a spawn that cannot be worked out again from the place -- rooms overhang their hull and a
   * point inside one is often outdoors -- and it decides the creature's cell and its collider filter
   * on every browser, the admin's own included.
   */
  inside?: boolean;
}

/** Why a creature is no longer there: it was killed, or an admin took it down. */
export type GoneWhy = 'dead' | 'removed';

/** What the module is doing, filled in place so the console can read it between frames. */
export interface OwnedStats {
  /** Whether there is a server holding a world. With none, everything is this browser's. */
  active: boolean;
  /** Whether this player may stand creatures here at all. */
  admin: boolean;
  /** How many creatures this browser has been told about on the world it is on. */
  known: number;
  /** How many of them it thinks for. */
  kept: number;
  /** Which, by id. The same array between changes: nothing is allocated to read it. */
  ids: string[];
  /** How many have been handed to this browser since the line opened, and how many taken off it. */
  taken: number;
  given: number;
  /** The last one to change hands, whether it came or went (1 came, 0 went), and when, in seconds. */
  lastId: string;
  lastGot: number;
  lastAt: number;
  /** How long ago that was, in seconds; -1 when nothing has changed hands on this line yet. */
  sinceLast: number;
  /** Spawn words sent, and the last thing the server refused, in its own words. */
  asked: number;
  refused: string;
}

/**
 * The world's creatures as this browser holds them. One of these is made once and lives for the page;
 * everything it is told comes through `handle`, and everything it asks for goes out through `send`.
 */
export class Owned {
  /** Something to send: the socket puts it on the wire. Set by the wiring. */
  send: (msg: Record<string, unknown>) => void = () => {};
  /** Who decides: with no server this answers 'me' and every creature is this browser's. */
  authority: () => Authority = () => 'me';
  /** Whether this player may stand creatures in the world: the session's answer, which is the server's. */
  admin: () => boolean = () => false;
  /**
   * Whether this tab is being drawn. The wiring answers from the document; nothing in this file may
   * touch it, so a node test answers its own. It is what `announce` below says on this browser's
   * behalf, because a tab that is not drawn runs no brains and must keep nothing.
   */
  visible: () => boolean = () => true;

  /** The whole list arrived (on joining a world, and again whenever it is cleared). */
  onList: (rows: readonly SpawnRow[]) => void = () => {};
  /** One creature was stood. Everyone on the world is told, the admin who asked included. */
  onAdd: (row: SpawnRow) => void = () => {};
  /** One is no longer there. A death stays a death: it is never stood again under the same id. */
  onGone: (id: string, why: GoneWhy) => void = () => {};
  /**
   * This browser has been given one to think for, or had one taken off it. `row` is what is known
   * about it, which may be nothing at all when the grant has outrun the news of the spawn.
   */
  onKeep: (id: string, keeping: boolean, row: SpawnRow | null) => void = () => {};
  /** Something the player should read: a refusal, mostly. */
  onNote: (text: string) => void = () => {};

  private readonly rows = new Map<string, SpawnRow>();
  private readonly keeping = new Set<string>();
  /**
   * When each creature was taken off this browser, in this file's own seconds. It is read by one
   * thing only -- a death this browser had already decided on, arriving a moment after the grant went
   * away -- and anything older than the grace is swept out whenever another is written, so it holds
   * a handful of ids and never grows.
   */
  private readonly letGo = new Map<string, number>();
  /**
   * The awake state the server was last told, or -1 when nothing has been said on this line. A tab
   * opened or reconnected while it is already hidden fires no `visibilitychange`, so saying it only
   * on the event would leave the server believing a frozen tab is awake and handing it creatures
   * whose brains it will not run for a whole minute.
   */
  private awakeTold = -1;
  /** Ids of the dead, so that a row arriving late can never stand one of them up again. */
  private readonly buried = new Set<string>();
  private readonly stat: OwnedStats = { active: false, admin: false, known: 0, kept: 0, ids: [], taken: 0, given: 0, lastId: '', lastGot: 0, lastAt: 0, sinceLast: -1, asked: 0, refused: '' };
  /** The second being counted for this browser's own rate, and how many words have gone out inside it. */
  private askWindow = 0;
  private askCount = 0;

  /**
   * The clock the hand-overs are timed against, in seconds; a test hands in its own. It is assigned
   * in the body rather than written as a parameter property, because node runs this file as it is --
   * it strips the types and nothing else -- and a parameter property is not something it can strip.
   */
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now() / 1000) {
    this.now = now;
  }

  // ---- what everything else asks -------------------------------------------------------------------

  /** Whether there is a server holding the world. With none, nothing is sent and nothing is held. */
  get active(): boolean {
    return this.authority() === 'server';
  }

  /**
   * Whether this browser thinks for a creature: its brain, its steering and its physics, against a
   * body that is merely driven from somebody else's messages. With no server the answer is yes for
   * everything, which is the game played alone exactly as it always was.
   */
  mine(id: string): boolean {
    if (!this.active) return true;
    return this.keeping.has(id);
  }

  /** What is known about one, or null. The same object between changes. */
  row(id: string): SpawnRow | null {
    return this.rows.get(id) ?? null;
  }

  /** Everything the world holds here, oldest first. Read, never written to. */
  get list(): IterableIterator<SpawnRow> {
    return this.rows.values();
  }

  /** How many this browser thinks for. */
  get kept(): number {
    return this.keeping.size;
  }

  /** Whether one died here. A death happens once and stays, whoever ends up keeping the body. */
  dead(id: string): boolean {
    return this.buried.has(id);
  }

  // ---- the asking ----------------------------------------------------------------------------------

  /**
   * Ask for a creature to be stood. Nothing is stood by this: what comes back from the server is what
   * is stood, so the browser that asked takes exactly the same path as everyone else's. The id is
   * this browser's suggestion and the server keeps it only when it is free.
   *
   * The answer is a word for the player, or '' when the asking went out.
   */
  askSpawn(species: string, at: readonly [number, number, number], h = 0, seed = 0, id = '', inside = false): string {
    if (!this.active) return '';
    if (!this.admin()) return 'only this world’s admin can stand creatures in it';
    if (!species) return 'there is nothing to stand';
    if (!this.mayAsk()) return 'that is faster than the server will take them';
    this.stat.asked++;
    const msg: Record<string, unknown> = { t: 'spawn', do: 'add', species, at: [at[0], at[1], at[2]], h };
    if (seed) msg.seed = seed >>> 0;
    if (id) msg.id = id;
    // Stood in a building's rooms: the one thing about a spawn that cannot be worked out again from
    // the place, since rooms overhang their hull and a point inside one is often outdoors. Sent only
    // when it is true, so a browser standing things on the street sends exactly what it always did.
    if (inside) msg.inside = 1;
    this.send(msg);
    return '';
  }

  /** Take one down. The admin's, and the server is what refuses it. */
  askRemove(id: string): string {
    if (!this.active) return '';
    if (!this.admin()) return 'only this world’s admin can take creatures down';
    if (!id) return 'there is nothing there';
    if (!this.mayAsk()) return 'that is faster than the server will take them';
    this.stat.asked++;
    this.send({ t: 'spawn', do: 'remove', id });
    return '';
  }

  /** Take down everything standing on this world. */
  askClear(): string {
    if (!this.active) return '';
    if (!this.admin()) return 'only this world’s admin can take creatures down';
    if (!this.mayAsk()) return 'that is faster than the server will take them';
    this.stat.asked++;
    this.send({ t: 'spawn', do: 'clear' });
    return '';
  }

  /**
   * One this browser was thinking for has died. It is the keeper's word and nobody else's, and the
   * server is what makes it true for everyone; the body is not taken down here, because a death is
   * heard back as the `gone` every browser hears, this one included.
   */
  sayDead(id: string): void {
    if (!this.active || !id) return;
    // The word goes out for a moment after the grant went away as well as while it is held. A brain
    // drops a creature to nothing and says so in the same breath, and the grants go out twice a
    // second, so the two cross: the creature is handed to somebody else between the blow and the
    // word. Swallowed here, that kill is lost for good -- whoever took it over holds a creature the
    // player watched fall, and stands it back up whole. The server has the same grace and is what
    // decides; this side only has to be willing to speak. Nothing else is said inside it: this
    // browser does not move, hurt or take down what it no longer keeps.
    if (!this.keeping.has(id)) {
      const lost = this.letGo.get(id);
      if (lost === undefined || this.now() - lost > OWN_TUNE.deathGrace) return;
    }
    this.send({ t: 'spawn', do: 'dead', id });
  }

  /**
   * This tab has been put to sleep, or woken. A sleeping tab draws no frames and sends nothing at
   * all, so it says so on its way out and whatever it was keeping goes to somebody who is awake;
   * saying nothing would leave those creatures frozen until the server's own minute of silence ran.
   */
  sayAwake(on: boolean): void {
    if (!this.active) return;
    const a = on ? 1 : 0;
    if (a === this.awakeTold) return;
    this.awakeTold = a;
    this.send({ t: 'keep', do: 'awake', a });
  }

  /**
   * Say what this tab is, if the server has not been told it on this line. `visibilitychange` fires
   * only on a change, so a page opened in a background tab -- or a line that dropped while the tab
   * was hidden and came back, which clears this side entirely -- never fires one: nothing is sent,
   * the server's silence has not run, and it hands a frozen tab creatures whose brains will not run
   * for a minute. So the first word that arrives on a line is also when this browser says what it is,
   * and any later word puts it right if a change was ever missed. It is a boolean compare on a
   * message that has already arrived, and sends only when the answer has moved.
   */
  private announce(): void {
    const a = this.visible() ? 1 : 0;
    if (a !== this.awakeTold) this.sayAwake(a === 1);
  }

  /** Whether another word may go out this second; the server has the same limit and is what enforces it. */
  private mayAsk(): boolean {
    const second = Math.floor(this.now());
    if (second !== this.askWindow) {
      this.askWindow = second;
      this.askCount = 0;
    }
    this.askCount++;
    return this.askCount <= OWN_TUNE.asksPerSecond;
  }

  // ---- what the server says ------------------------------------------------------------------------

  /**
   * One message from the far end. True when it was one of ours, so the socket's own switch can go on
   * ignoring everything it does not know. Everything in it is treated as words from a stranger.
   */
  handle(msg: Record<string, unknown>): boolean {
    // A word arriving is proof there is a line, which is the moment this browser says whether it is
    // awake; on every word after the first it is a boolean compare that sends nothing.
    if (this.active) this.announce();
    const t = msg?.t;
    if (t === 'keep') {
      this.grant(msg);
      return true;
    }
    if (t !== 'spawn') return false;
    switch (String(msg.do ?? '')) {
      case 'list':
        this.setList(Array.isArray(msg.rows) ? msg.rows : []);
        break;
      case 'add': {
        const row = readRow(msg.row);
        // A creature that died here is never stood again: the row would be an old one arriving late,
        // and a death that came back would be the one thing about this nobody could put right.
        if (row && !this.buried.has(row.id) && this.rows.size < OWN_TUNE.rows) {
          this.rows.set(row.id, row);
          this.stat.known = this.rows.size;
          this.onAdd(row);
        }
        break;
      }
      case 'gone': {
        const id = readId(msg.id);
        if (!id) break;
        const why: GoneWhy = msg.why === 'dead' ? 'dead' : 'removed';
        if (why === 'dead') this.buried.add(id);
        const had = this.rows.delete(id);
        this.stat.known = this.rows.size;
        // Whatever this browser thought it was keeping, it is not any more: the server has taken the
        // grant back in the same breath, and a body nobody has told to stop is the one way a creature
        // could go on thinking after it was gone.
        if (this.keeping.delete(id)) this.note(id, false);
        if (had) this.onGone(id, why);
        break;
      }
      case 'refused': {
        const why = readWords(msg.why);
        this.stat.refused = why;
        if (why) this.onNote(why);
        break;
      }
      default:
        // A word this browser does not know: the server is on a newer build, and saying nothing is
        // what keeps an older browser working against it.
        break;
    }
    return true;
  }

  /** A grant: what this browser has been given to think for, and what has been taken off it. */
  private grant(msg: Record<string, unknown>): void {
    const drop = Array.isArray(msg.drop) ? msg.drop : [];
    const add = Array.isArray(msg.add) ? msg.add : [];
    // Dropped before granted: within one message the two lists never name the same creature, and
    // doing it this way round means that if a build ever did, nothing would be left thinking for one
    // it had just been told to let go of.
    for (const raw of drop) {
      const id = readId(raw);
      if (!id || !this.keeping.delete(id)) continue;
      this.lost(id);
      this.stat.given++;
      this.note(id, false);
      this.onKeep(id, false, this.rows.get(id) ?? null);
    }
    for (const raw of add) {
      const id = readId(raw);
      // A grant for something that died is not taken: the server takes them back on a death, and one
      // crossing the other on the wire must not bring a body back to life.
      if (!id || this.buried.has(id) || this.keeping.has(id)) continue;
      this.keeping.add(id);
      this.stat.taken++;
      this.note(id, true);
      this.onKeep(id, true, this.rows.get(id) ?? null);
    }
    this.stat.kept = this.keeping.size;
  }

  /** The whole list of a world, which takes the place of whatever was held for it. */
  private setList(raw: unknown[]): void {
    const seen = new Set<string>();
    for (const item of raw.slice(0, OWN_TUNE.rows)) {
      const row = readRow(item);
      if (!row || this.buried.has(row.id)) continue;
      seen.add(row.id);
      this.rows.set(row.id, row);
    }
    for (const id of [...this.rows.keys()]) {
      if (seen.has(id)) continue;
      this.rows.delete(id);
      if (this.keeping.delete(id)) this.note(id, false);
      this.onGone(id, 'removed');
    }
    this.stat.known = this.rows.size;
    this.stat.kept = this.keeping.size;
    this.onList([...this.rows.values()]);
  }

  /**
   * One has been taken off this browser: when, so that a death it had already decided on is still
   * said. Everything older than the grace goes out in the same breath, so the table holds the few
   * ids that have changed hands in the last few seconds and no more.
   */
  private lost(id: string): void {
    const now = this.now();
    this.letGo.set(id, now);
    if (this.letGo.size < 2) return;
    for (const [had, when] of this.letGo) if (now - when > OWN_TUNE.deathGrace) this.letGo.delete(had);
  }

  /** Remember the last thing to change hands, which is what the console reads to see it happening. */
  private note(id: string, got: boolean): void {
    this.stat.lastId = id;
    this.stat.lastGot = got ? 1 : 0;
    this.stat.lastAt = this.now();
  }

  /**
   * The line dropped, was put down or was taken over. Nothing of the world's creatures survives it:
   * what this browser kept was the server's to give, and with no line there is nothing to tell it
   * that one has died. The dead are forgotten with the rest, because the next line is handed the
   * whole list again and whatever is not in it is not there.
   */
  clear(): void {
    for (const id of this.keeping) this.onKeep(id, false, this.rows.get(id) ?? null);
    this.keeping.clear();
    this.rows.clear();
    this.buried.clear();
    this.letGo.clear();
    // Nothing has been said on the next line, whatever was said on this one: the server that answers
    // it holds a fresh record of this browser with nothing known about whether it is drawing frames.
    this.awakeTold = -1;
    this.stat.known = 0;
    this.stat.kept = 0;
    this.stat.ids.length = 0;
    this.stat.refused = '';
    this.onList([]);
  }

  /** What the module is doing, in the object it always answers with: numbers, never words to read. */
  debug(): OwnedStats {
    this.stat.active = this.active;
    this.stat.admin = this.admin();
    this.stat.known = this.rows.size;
    this.stat.kept = this.keeping.size;
    this.stat.ids.length = 0;
    for (const id of this.keeping) this.stat.ids.push(id);
    this.stat.sinceLast = this.stat.lastId ? this.now() - this.stat.lastAt : -1;
    return this.stat;
  }
}

/** An id as the server mints them: short, plain, and never anything that means something to an object. */
function readId(x: unknown): string {
  if (typeof x !== 'string' || !x || x.length > 48) return '';
  if (x === '__proto__' || x === 'constructor' || x === 'prototype') return '';
  return /^[A-Za-z0-9_.:-]+$/.test(x) ? x : '';
}

/**
 * Everything that is not text, written as escapes rather than as the bytes themselves, so nothing
 * here rests on a NUL surviving a copy of the tree. The same class server/wire.mjs strips.
 */
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Words from the far end: cut, and never parsed as anything. */
function readWords(x: unknown, cap = 160): string {
  if (typeof x !== 'string') return '';
  return x.replace(CONTROL, '').trim().slice(0, cap);
}

/** One creature's line, read rather than trusted: a row that is not one is no row at all. */
function readRow(x: unknown): SpawnRow | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const id = readId(o.id);
  const species = readWords(o.species, 40);
  const at = Array.isArray(o.at) && o.at.length === 3 ? o.at.map(Number) : null;
  if (!id || !species || !at || at.some((v) => !Number.isFinite(v))) return null;
  const h = Number(o.h);
  const seed = Number(o.seed);
  const row: SpawnRow = {
    id,
    world: readWords(o.world, 64),
    species,
    at: [at[0], at[1], at[2]],
    h: Number.isFinite(h) ? h : 0,
    seed: Number.isFinite(seed) && seed >= 0 ? seed >>> 0 : 0,
  };
  // Left out rather than defaulted: a row with no share is one nobody has said anything about, and
  // standing that creature whole is right. A row with a share of 0.2 is one that has been fought.
  const hp = Number(o.hp);
  if (o.hp !== undefined && Number.isFinite(hp)) row.hp = Math.min(1, Math.max(0, hp));
  // Stood in a building's rooms. It decides the creature's cell and its collider filter on every
  // browser, and it cannot be worked out again from the place: rooms overhang their hull.
  if (o.inside) row.inside = true;
  return row;
}

/**
 * The one the game uses. It is a shared instance rather than something the wiring makes, exactly as
 * the shared clock is: the manager, the creatures themselves and the tab that stands them all ask the
 * same question of the same object, and a second copy of it would be a second answer to "whose is
 * this" -- which is the one thing this whole file exists to make impossible.
 */
export const owned = new Owned();
