// The browser's half of who thinks for a creature.
//
// Two kinds of creature are the world's. What an admin stands by hand -- everyone connected is told
// about it, and exactly one browser thinks for it. And what every browser stands for itself from the
// same data -- the lairs, the nests, the people at their posts -- which this browser says it has stood
// (`saySeen`) and is then kept by exactly one browser in the same way, without anybody being told to
// stand it. Which browser that is, is the server's to say (server/ownership.mjs): the nearest player
// within 180 m for an admin's, the nearest with a body for it for a seen one, changing hands only when
// somebody else has been a quarter nearer for three seconds. This file is what that answer looks like
// on this side. It decides nothing.
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
  /**
   * How many `seen` words this browser sends in a second, the rest waiting their turn. Under the
   * server's own twenty (`seen.perSecond` in server/ownership.mjs) on purpose: a word over the server's
   * allowance is dropped there in silence, and a body whose word was dropped is a body nobody keeps.
   * Ours: walking into a town says it of a few dozen people over a few seconds.
   */
  seenPerSecond: 16,
  /**
   * The span, in seconds, that no more than `seenPerSecond` of those words may go out in, measured back
   * from each one sent rather than per calendar second. The server counts its own second from the first
   * word of a burst, so two flushes either side of a calendar second's edge landed in one of its seconds
   * and the words over twenty were dropped there in silence; a sliding span a quarter of a second longer
   * than the server's second also covers the line delivering one word sooner than another. Ours.
   */
  seenSpan: 1.25,
  /** How many `seen` words may wait their turn at once; past that the oldest is said again later by the body itself. Ours. */
  seenWaiting: 256,
};

/** How many `seen` words the sliding span remembers sending: the most `seenPerSecond` may ever be (the server's own twenty). */
const SEEN_SLOTS = 20;

/** Set any of those, clamped to what makes sense; the answer is the table as it now stands. */
export function tuneOwned(o: Partial<typeof OWN_TUNE>): typeof OWN_TUNE {
  if (typeof o.asksPerSecond === 'number') OWN_TUNE.asksPerSecond = Math.max(1, Math.min(60, Math.round(o.asksPerSecond)));
  if (typeof o.rows === 'number') OWN_TUNE.rows = Math.max(1, Math.min(2000, Math.round(o.rows)));
  if (typeof o.deathGrace === 'number') OWN_TUNE.deathGrace = Math.max(0, Math.min(60, o.deathGrace));
  if (typeof o.seenPerSecond === 'number') OWN_TUNE.seenPerSecond = Math.max(1, Math.min(SEEN_SLOTS, Math.round(o.seenPerSecond)));
  if (typeof o.seenSpan === 'number') OWN_TUNE.seenSpan = Math.max(1, Math.min(10, o.seenSpan));
  if (typeof o.seenWaiting === 'number') OWN_TUNE.seenWaiting = Math.max(1, Math.min(4096, Math.round(o.seenWaiting)));
  return OWN_TUNE;
}

/**
 * The names a body every browser stands for itself may be shared under: a lair's creature, a person at
 * a post, a nest. The server's own list (`SEEN_PREFIXES` in server/ownership.mjs), kept here so this side
 * never sends a word the server would only drop.
 */
export const SEEN_PREFIXES = ['wild:', 'stood:', 'camp:'] as const;

/** Whether an id is one a seen creature goes by. */
export function seenId(id: string): boolean {
  for (const p of SEEN_PREFIXES) if (id.length > p.length && id.startsWith(p)) return true;
  return false;
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
  /**
   * A weapon off the rack the admin put in its hand from the console (`__debug.mobile(.., { weapon })`),
   * by the rack's template: in the record, so every browser arms it alike rather than each taking its
   * own guess from its name.
   */
  weapon?: string;
}

/**
 * Why a creature is no longer there: it was killed, an admin took it down, or it walked off with
 * another player as a follower -- which to everybody else is a creature that has left its post.
 */
export type GoneWhy = 'dead' | 'removed' | 'taken';

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
  /** Whether this browser shares what it stands for itself (a server answering that speaks of them). */
  seeding: boolean;
  /** `seen` words said, waiting their turn, and `unseen` words said, since the page began. */
  seen: number;
  seenWaiting: number;
  unseen: number;
  /** Bodies this browser was told to keep to itself because the world could hold no more seen ones. */
  local: number;
  /** Of what this browser keeps, how many an admin stood and how many are seen ones. */
  keptStood: number;
  keptSeen: number;
  /** Seen ones this browser has been told are down for their respawn just now. */
  seenDown: number;
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
  /**
   * Whether the server speaks of the seen creatures at all (`Session.speaks(3)`). With an older one --
   * or none -- nothing this browser stands for itself is shared, and every such body stays its own,
   * which is what every browser did before.
   */
  seeds: () => boolean = () => false;

  /** The whole list arrived (on joining a world, and again whenever it is cleared). */
  onList: (rows: readonly SpawnRow[]) => void = () => {};
  /** One creature was stood. Everyone on the world is told, the admin who asked included. */
  onAdd: (row: SpawnRow) => void = () => {};
  /**
   * One is no longer there. A death stays a death: an admin's is never stood again under the same id,
   * and a seen one not for `back` seconds, which is its own row's respawn as the server holds it.
   *
   * `fresh` is the server answering this browser alone about a body it has only just stood: the creature
   * was already down when this browser said it had one. Nothing died here -- the body is to go quietly,
   * never to play a death nobody saw or count as a kill at its post.
   */
  onGone: (id: string, why: GoneWhy, back: number, fresh: boolean) => void = () => {};
  /** The server could hold no more seen ones on this world: the body under this name is this browser's own to keep. */
  onLocal: (id: string) => void = () => {};
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
  /**
   * The seen ones that are down, and until when in this file's own seconds: their own respawn as the
   * server holds it. A seen one is not buried for good, because the same name stands again in every
   * browser once its row's wait is out.
   */
  private readonly downUntil = new Map<string, number>();
  private readonly stat: OwnedStats = { active: false, admin: false, known: 0, kept: 0, ids: [], taken: 0, given: 0, lastId: '', lastGot: 0, lastAt: 0, sinceLast: -1, asked: 0, refused: '', seeding: false, seen: 0, seenWaiting: 0, unseen: 0, local: 0, keptStood: 0, keptSeen: 0, seenDown: 0 };
  /** The second being counted for this browser's own rate, and how many words have gone out inside it. */
  private askWindow = 0;
  private askCount = 0;
  /**
   * `seen` words waiting their turn, oldest first, by id so a body said twice before its turn is one
   * word. The second being counted for them, and how many have gone in it.
   */
  private readonly seenQueue = new Map<string, { at: [number, number, number]; r: number }>();
  /** When each of the last `SEEN_SLOTS` `seen` words went out, a ring written in place, and where it goes next. */
  private readonly seenSent: number[] = new Array<number>(SEEN_SLOTS).fill(-Infinity);
  private seenHead = 0;

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

  /**
   * Whether one died here. A death happens once and stays, whoever ends up keeping the body -- for an
   * admin's for good, and for a seen one until its own respawn is out.
   */
  dead(id: string): boolean {
    return this.buried.has(id) || this.downFor(id) > 0;
  }

  /**
   * How many seconds more a seen one stays down before anybody stands it again; 0 while it may stand.
   * What the lairs and the people at their posts ask before standing a body, so none is stood up whole
   * in one browser while every other has it dead.
   */
  downFor(id: string): number {
    const until = this.downUntil.get(id);
    if (until === undefined) return 0;
    const left = until - this.now();
    if (left > 0) return left;
    this.downUntil.delete(id);
    return 0;
  }

  /** Whether this browser shares what it stands for itself: a server answering that speaks of the seen ones. */
  get seeding(): boolean {
    return this.active && this.askSeeds();
  }

  /** Every id the server has granted this browser, seen ones included. Read, never written to. */
  get keptIds(): ReadonlySet<string> {
    return this.keeping;
  }

  // ---- the asking ----------------------------------------------------------------------------------

  /**
   * Ask for a creature to be stood. Nothing is stood by this: what comes back from the server is what
   * is stood, so the browser that asked takes exactly the same path as everyone else's. The id is
   * this browser's suggestion and the server keeps it only when it is free.
   *
   * The answer is a word for the player, or '' when the asking went out.
   */
  askSpawn(species: string, at: readonly [number, number, number], h = 0, seed = 0, id = '', inside = false, weapon = ''): string {
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
    // A weapon of the console's choosing, carried in the record so every browser arms it alike. A
    // server that speaks no such field drops it, and the body is armed off its own list there.
    if (weapon) msg.weapon = weapon;
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
  sayDead(id: string, by: readonly number[] = []): void {
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
    // Who struck it in its last moments, by the relay ids of the browsers whose players did: what a
    // later server could witness a kill by. Nothing here keeps it, and a server that knows nothing of it
    // drops the field.
    const msg: Record<string, unknown> = { t: 'spawn', do: 'dead', id };
    if (by.length && this.askSeeds()) msg.by = by.slice(0, 8);
    this.send(msg);
  }

  /**
   * This browser has stood one of the seeded kind -- a lair's creature, a nest, a person at a post -- and
   * says so, with where it stands and how long it stays down once it dies (its own row's respawn). The
   * word waits its turn under the allowance, oldest first: the body it is about is meanwhile held as
   * one nobody here keeps, which is a quarter of a second of standing still in the ordinary case.
   */
  saySeen(id: string, at: { x: number; y: number; z: number }, respawn: number): void {
    if (!this.seeding || !id || !seenId(id)) return;
    const r = Number.isFinite(respawn) && respawn > 0 ? Math.round(respawn) : 0;
    const was = this.seenQueue.get(id);
    if (was) {
      was.at[0] = at.x;
      was.at[1] = at.y;
      was.at[2] = at.z;
      was.r = r;
    } else {
      // Full: the oldest waiting is let go of rather than this one refused. Its body says it again on
      // its own once it has gone a while unkept (`NpcNet`'s re-saying), so nothing is lost for good.
      if (this.seenQueue.size >= OWN_TUNE.seenWaiting) {
        const first = this.seenQueue.keys().next().value;
        if (first !== undefined) this.seenQueue.delete(first);
      }
      this.seenQueue.set(id, { at: [at.x, at.y, at.z], r });
    }
    this.flushSeen();
  }

  /**
   * This browser has put its body for a seen one down: walked away from it, or made room. The server
   * offers it no more, and hands it at once to somebody who still has one. Nothing is said about one
   * whose `seen` never went out: the server has never heard this browser has it.
   */
  sayUnseen(id: string): void {
    if (!id || !seenId(id)) return;
    if (this.seenQueue.delete(id)) {
      this.stat.seenWaiting = this.seenQueue.size;
      return;
    }
    if (!this.seeding) return;
    this.stat.unseen++;
    this.send({ t: 'spawn', do: 'unseen', id });
  }

  /**
   * One this browser keeps has walked off with its player as a follower, which is this browser's alone
   * from now on. To everybody else it is gone from its post, and a seen one's post stays empty for its
   * own respawn, as after a death. It is the keeper's word, as a death is.
   */
  sayTaken(id: string): void {
    // Only to a server that hears it: an older one drops the word, and every other screen would keep a
    // frozen copy at the post that nobody keeps. `NpcNet.mayLeave` refuses the walk-off itself first.
    if (!this.active || !id || !this.keeping.has(id) || !this.askSeeds()) return;
    this.send({ t: 'spawn', do: 'taken', id });
  }

  /**
   * The `seen` words whose turn it is: as many as the allowance lets go this second, oldest first. Run on
   * every word said and on the wiring's own clock (`tick`), never in a frame.
   */
  private flushSeen(): void {
    if (!this.seenQueue.size) return;
    if (!this.seeding) {
      // No server that hears them, any more: nothing waiting means anything to anybody.
      this.seenQueue.clear();
      this.stat.seenWaiting = 0;
      return;
    }
    const now = this.now();
    for (const [id, w] of this.seenQueue) {
      if (!this.seenRoom(now)) break;
      this.seenSent[this.seenHead] = now;
      this.seenHead = (this.seenHead + 1) % SEEN_SLOTS;
      this.seenQueue.delete(id);
      this.stat.seen++;
      this.send({ t: 'spawn', do: 'seen', id, at: [round2(w.at[0]), round2(w.at[1]), round2(w.at[2])], r: w.r });
    }
    this.stat.seenWaiting = this.seenQueue.size;
  }

  /**
   * Whether another `seen` may go now: fewer than `seenPerSecond` have gone in the last `seenSpan` seconds.
   * Any span that long holds no more than the allowance, so any second the server counts -- starting
   * wherever its count starts, with the line a little quicker for one word than another -- holds no more.
   */
  private seenRoom(now: number): boolean {
    let n = 0;
    for (const t of this.seenSent) if (now - t < OWN_TUNE.seenSpan) n++;
    return n < OWN_TUNE.seenPerSecond;
  }

  /** The wiring's clock, a few times a second: whatever `seen` words are waiting their turn go when it comes. */
  tick(): void {
    this.flushSeen();
  }

  /** Whether the server speaks of the seen ones, asked of the game; a hook that throws is no. */
  private askSeeds(): boolean {
    try {
      return this.seeds();
    } catch {
      return false;
    }
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
        if (row && !this.dead(row.id) && this.rows.size < OWN_TUNE.rows) {
          this.rows.set(row.id, row);
          this.stat.known = this.rows.size;
          this.onAdd(row);
        }
        break;
      }
      case 'gone': {
        const id = readId(msg.id);
        if (!id) break;
        const why: GoneWhy = msg.why === 'dead' ? 'dead' : msg.why === 'taken' ? 'taken' : 'removed';
        // A seen one is down for its own respawn and then stands again, in every browser; an admin's
        // that died is buried for good. Taken off with another player is the same as a death to a seen
        // one's post, and nothing at all to an admin's, which has simply gone from the list.
        const seen = seenId(id);
        const back = Math.max(0, Math.min(86400, Number(msg.back) || 0));
        if (seen && (why === 'dead' || why === 'taken')) this.downUntil.set(id, this.now() + Math.max(1, back));
        else if (why === 'dead') this.buried.add(id);
        const had = this.rows.delete(id);
        this.stat.known = this.rows.size;
        // Whatever this browser thought it was keeping, it is not any more: the server has taken the
        // grant back in the same breath, and a body nobody has told to stop is the one way a creature
        // could go on thinking after it was gone.
        if (this.keeping.delete(id)) this.note(id, false);
        if (had || seen) this.onGone(id, why, back, seen && msg.fresh === 1);
        break;
      }
      case 'local': {
        // The world could hold no more of the seen ones: the body under this name is this browser's
        // own, as every such body was before there were any seen ones.
        const id = readId(msg.id);
        if (!id) break;
        this.stat.local++;
        this.seenQueue.delete(id);
        this.onLocal(id);
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
      if (!id || this.dead(id) || this.keeping.has(id)) continue;
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
      if (!row || this.dead(row.id)) continue;
      seen.add(row.id);
      this.rows.set(row.id, row);
    }
    for (const id of [...this.rows.keys()]) {
      if (seen.has(id)) continue;
      this.rows.delete(id);
      if (this.keeping.delete(id)) this.note(id, false);
      this.onGone(id, 'removed', 0, false);
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
    this.downUntil.clear();
    this.seenQueue.clear();
    // A new line is a new count at the server's end as well.
    this.seenSent.fill(-Infinity);
    this.letGo.clear();
    // Nothing has been said on the next line, whatever was said on this one: the server that answers
    // it holds a fresh record of this browser with nothing known about whether it is drawing frames.
    this.awakeTold = -1;
    this.stat.known = 0;
    this.stat.kept = 0;
    this.stat.ids.length = 0;
    this.stat.refused = '';
    this.stat.seenWaiting = 0;
    this.onList([]);
  }

  /** What the module is doing, in the object it always answers with: numbers, never words to read. */
  debug(): OwnedStats {
    this.stat.active = this.active;
    this.stat.admin = this.admin();
    this.stat.seeding = this.seeding;
    this.stat.known = this.rows.size;
    this.stat.kept = this.keeping.size;
    this.stat.ids.length = 0;
    let seen = 0;
    for (const id of this.keeping) {
      this.stat.ids.push(id);
      if (seenId(id)) seen++;
    }
    this.stat.keptSeen = seen;
    this.stat.keptStood = this.keeping.size - seen;
    this.stat.seenWaiting = this.seenQueue.size;
    let down = 0;
    for (const id of [...this.downUntil.keys()]) if (this.downFor(id) > 0) down++;
    this.stat.seenDown = down;
    this.stat.sinceLast = this.stat.lastId ? this.now() - this.stat.lastAt : -1;
    return this.stat;
  }
}

/** Two decimal places, as every place on the wire is cut. */
function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
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
    // Kept exactly as it was sent: the server's world key holds a NUL between the planet and the zone
    // (`roomKey` in server/rooms.mjs), and read through `readWords` -- which strips every control
    // character -- `endor\0` came out `endor`, so every record an admin stood was refused on every browser
    // as belonging to another world. It is only ever compared, never shown or parsed.
    world: typeof o.world === 'string' ? o.world.slice(0, 64) : '',
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
  // The weapon the admin put in its hand: a template path, read as one and nothing more. It is looked
  // up on this browser's own rack and a name the rack has not got arms it off its own list instead.
  if (typeof o.weapon === 'string' && /^[A-Za-z0-9_./-]{1,120}$/.test(o.weapon) && !o.weapon.split('/').includes('..')) row.weapon = o.weapon;
  return row;
}

/**
 * The one the game uses. It is a shared instance rather than something the wiring makes, exactly as
 * the shared clock is: the manager, the creatures themselves and the tab that stands them all ask the
 * same question of the same object, and a second copy of it would be a second answer to "whose is
 * this" -- which is the one thing this whole file exists to make impossible.
 */
export const owned = new Owned();
