// The browser's half of what a character owns, and of a trade between two players.
//
// The server holds the truth (server/ledger.mjs): a row per item, with an id of the server's own
// minting, and the one step in which two rows change owner together. This file is what that truth
// looks like on this side -- the list the backpack, the body and the hands are written from, and the
// little state machine of a window: asked, opened, what each side has put in, who has pressed, done
// or broken off. It decides nothing, and it is deliberately unable to: **no message here ever moves
// an item into or out of the backpack.** Only the server's own list does that (`onList`), which is
// what makes it impossible for this browser to end a trade believing it has both halves of it. A
// trade that finishes therefore asks for the list at once and shows what changed when it arrives.
//
// Three rules shape the file, the same three the group's half was written to. Nothing here touches
// the document, three.js or the socket, so a node test runs it as it is. Nothing here runs in a
// frame: a trade is a handful of events and a countdown stepped a few times a second. And with no
// server -- no address set, or the relay that came before -- it is quiet and empty: nothing is sent,
// no window opens, the backpack is local storage exactly as it always was, and the game is what it
// is without any of this.
//
// Words that arrive from the far end are data: an item is a kind and a catalogue id that are looked
// up in the catalogues the game already has, never run, and every number is read as a number or
// dropped. A row id is the server's and is only ever handed back to it.
//
// The wire is the server's (the list at the top of server/relay.mjs, and server/ledger.mjs). This
// side sends `{ t: 'items', do: 'list' | 'get' | 'add' | 'drop' | 'using' }` and
// `{ t: 'trade', do: 'ask' | 'accept' | 'decline' | 'offer' | 'ready' | 'unready' | 'cancel' }`; it
// is sent `{ t: 'items', do: 'list' | 'added' | 'gone' | 'refused' }` and
// `{ t: 'trade', do: 'asked' | 'sent' | 'state' | 'done' | 'off' | 'refused' }`.

import { GROUP_RANGE, cleanText, type PointOut } from './groups.ts';
import type { Authority } from './session.ts';

/**
 * Every number this side invents, in one place and live: `__debug.trade({ offerMax: 6 })` sets one
 * and the next window obeys it. The distance a trade reaches is not here: it is the game's own
 * (`TRADE_START` and `TRADE_ACCEPT`, 8 m, in `GROUP_RANGE.trade`), and the server measures it on its
 * own copy of where the two players are standing, both when the asking goes out and again on the
 * press, because two people can walk apart while a window is open.
 */
export const TRADE_TUNE = {
  /**
   * Invented: how many items one side may put into one trade before this browser stops asking. The
   * server has its own cap (`item.offer`, 40) and is what decides; this is only so that a player is
   * told rather than watching a click do nothing. It caps what may be *added* and nothing else: what
   * the server says is in a pane is read and shown whole, whatever this number is set to.
   */
  offerMax: 12,
  /** Invented: seconds a question stands here when the server sent one without saying when it lapses. */
  askSeconds: 30,
  /**
   * How many words about a trade or an item this browser may send in a second. It is the server's own
   * number (`item.ask.perSecond`) kept here so that one over it is answered with a word rather than
   * vanishing: the server drops it and says nothing at all.
   */
  asksPerSecond: 8,
  /** Invented: how many rows a list is read to. A character cannot own more than this here. */
  rows: 400,
  /**
   * Invented: how many of the panel's slow steps to wait before asking for a list again when one was
   * asked for and has not come (the panel steps four times a second, so eight is two seconds). A
   * list is the only thing that moves the backpack, so one lost to the server's own rate must not be
   * the end of it.
   */
  askAgain: 8,
};

/** Set any of those, clamped to what makes sense; the answer is the table as it now stands. */
export function tuneTrade(o: Partial<typeof TRADE_TUNE>): typeof TRADE_TUNE {
  if (typeof o.offerMax === 'number') TRADE_TUNE.offerMax = Math.max(1, Math.min(64, Math.round(o.offerMax)));
  if (typeof o.askSeconds === 'number') TRADE_TUNE.askSeconds = Math.max(1, Math.min(600, Math.round(o.askSeconds)));
  if (typeof o.asksPerSecond === 'number') TRADE_TUNE.asksPerSecond = Math.max(1, Math.min(60, Math.round(o.asksPerSecond)));
  if (typeof o.rows === 'number') TRADE_TUNE.rows = Math.max(1, Math.min(5000, Math.round(o.rows)));
  if (typeof o.askAgain === 'number') TRADE_TUNE.askAgain = Math.max(1, Math.min(600, Math.round(o.askAgain)));
  return TRADE_TUNE;
}

/**
 * One thing a character owns. `kind` and `id` are the backpack's own (`OwnedItem` in
 * src/core/inventory.ts, where `id` is the catalogue id the server calls `what`); `row` is the
 * server's id for that row, which is what an offer and a drop name and what this browser only ever
 * hands back. A list this browser hands up has no row ids in it: they are the server's to mint.
 */
export interface TradeItem {
  kind: 'wear' | 'weapon';
  id: string;
  got: number;
  row?: string;
}

/** Why an item cannot be put in: what it is doing instead. */
export type ItemUse = 'worn' | 'right' | 'left' | null;

/** A trade as it stands on this side. The same object between changes: nothing is allocated to read it. */
export interface TradeWindow {
  /** The trade's own id, as the server names it. */
  id: string;
  /** The connection the other player is on, which is what every other message about them names. */
  with: number;
  name: string;
  /** What each side has put in, as the server last said. Never written to by the panel. */
  mine: TradeItem[];
  theirs: TradeItem[];
  /** Who has said they are happy. Either side changing anything puts both back to false. */
  youReady: boolean;
  themReady: boolean;
}

/** Somebody asking to trade, waiting on an answer. */
export interface TradeAsk {
  from: number;
  name: string;
  /** When it lapses, on the server's clock. */
  until: number;
  /** Seconds left, worked out against that clock. */
  left: number;
}

/** What the module is doing, filled in place so the console can read it between frames. */
export interface TradeStats {
  active: boolean;
  /** Whether the server has handed this browser a list at all, and how many rows were in it. */
  known: boolean;
  rows: number;
  /** Which copy stood when the character was settled, in the server's own word. */
  take: string;
  /** Whether a list has been asked for and not yet arrived (after a trade, and after a reconnect). */
  waiting: boolean;
  /** The trade standing now: who with, what each side has in, who has pressed. */
  open: boolean;
  withName: string;
  mine: number;
  theirs: number;
  youReady: boolean;
  themReady: boolean;
  /** Somebody asking, by name, or ''. */
  asked: string;
  /** Trades finished on this line, and how many items came in and went out over all of them. */
  done: number;
  got: number;
  gave: number;
  /** Words sent, and the last refusal in the server's own words. */
  sent: number;
  refused: string;
  /** The last thing this browser was told about a trade ending, in the server's own words. */
  lastEnd: string;
}

/**
 * What a character owns and the trade it is in, as this browser holds them. One of these is made
 * once and lives for the page; everything it is told comes through `handle`, and everything it asks
 * for goes out through `send`.
 */
export class Trade {
  /** Something to send: the socket puts it on the wire. Set by the wiring. */
  send: (msg: Record<string, unknown>) => void = () => {};
  /** Who decides: with no server this answers 'me' and the whole module stays quiet. */
  authority: () => Authority = () => 'me';
  /** This browser's own connection number, so a message about it is known for its own. */
  selfId: () => number = () => 0;
  /** The server's clock in milliseconds, which is what a countdown is measured against. */
  serverNow: () => number = () => Date.now();
  /** Where this player stands, and where another player's figure last was: the 8 m before asking. */
  meAt: (out: PointOut) => boolean = () => false;
  peerAt: (id: number, out: PointOut) => boolean = () => false;
  /** Whether this character owns an item now (the backpack's own list). */
  owns: (kind: 'wear' | 'weapon', id: string) => boolean = () => false;
  /** What an item is doing instead of sitting in the backpack: worn, or in a hand. */
  inUse: (kind: 'wear' | 'weapon', id: string) => ItemUse = () => null;
  /**
   * What this browser holds for the character in play, for the one moment it hands its list up (the
   * claim being answered). Null means there is nothing to say -- the select screen, the creator --
   * and then nothing is sent.
   */
  mine: () => readonly TradeItem[] | null = () => null;
  /**
   * What the record says about itself: whether a server has ever taken this character's items down
   * (`src/core/characters.ts`'s `known`) and the counter it settled at. It goes up with the list, as
   * "I believe you already hold this one", so that a browser whose storage was cleared -- an empty
   * list from a character that is marked -- is told everything back rather than taken by a server
   * that has never held it for a character that has just lost everything it owned. Null where there
   * is no character in play, and a server that knows nothing of the mark ignores it exactly as this
   * browser ignores a word it does not know.
   */
  mark: () => { known: boolean; rev: number } | null = () => null;
  /**
   * What is on the body and in the hands now, which the server needs to refuse an offer of something
   * being worn. The whole of it each time; anything not in it is free again.
   */
  using: () => { worn: readonly TradeItem[]; held: readonly TradeItem[] } | null = () => null;

  /**
   * The server's list, which is the truth: whoever owns the backpack writes it from this and from
   * nothing else. `take` is the server's own word for which copy stood when the character settled --
   * `browser` the first time a character is handed up, `server` every time after.
   */
  onList: (items: TradeItem[], take: 'browser' | 'server') => void = () => {};
  /** The window opened, moved or closed. The panel writes to the page only on this. */
  onWindow: (w: TradeWindow | null) => void = () => {};
  /** Somebody is asking to trade, or the question has gone. */
  onAsk: (ask: TradeAsk | null) => void = () => {};
  /**
   * A list has been asked for and is being waited on. It is the panel's slow step that drives
   * `step`, and `step` is what asks again for a list that never comes, so the moment this side
   * starts waiting is the moment that step has to be running -- and the first wait of a session is
   * the claim being answered, which is no window and no question at all. Without this the one
   * recovery this file has could not run at the one moment it is needed.
   */
  onWant: () => void = () => {};
  /** Something the player should read: a refusal, a trade ending, an item arriving. */
  onNote: (text: string) => void = () => {};

  private live: TradeWindow | null = null;
  private question: TradeAsk | null = null;
  /** The server's rows as they last stood, by `kind:id`, so an offer can name the row the server knows. */
  private readonly rows = new Map<string, TradeItem>();
  private take: 'browser' | 'server' | '' = '';
  private gotList = false;
  /** A list asked for and not yet arrived: a trade that finished, or a line that has just opened. */
  private wanting = false;
  /** Slow steps left before asking again for a list that has not come. */
  private waitSteps = 0;
  /** What was last said about the body and the hands, so the same thing is not said twice. */
  private usingSaid = '';
  /** The second being counted for this browser's own rate, and how many words have gone out inside it. */
  private askWindow = 0;
  private askCount = 0;
  private readonly scratchMe: PointOut = { x: 0, y: 0, z: 0 };
  private readonly scratchThem: PointOut = { x: 0, y: 0, z: 0 };
  private readonly stat: TradeStats = { active: false, known: false, rows: 0, take: '', waiting: false, open: false, withName: '', mine: 0, theirs: 0, youReady: false, themReady: false, asked: '', done: 0, got: 0, gave: 0, sent: 0, refused: '', lastEnd: '' };

  /**
   * The clock the rate is read off, in seconds; a test hands in its own. It is assigned in the body
   * rather than written as a parameter property, because node runs this file as it is -- it strips
   * the types and nothing else -- and a parameter property is not something it can strip.
   */
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now() / 1000) {
    this.now = now;
    theTrade = this;
  }

  // ---- what everything else asks -------------------------------------------------------------------

  /** Whether there is a server holding the world. With none, nothing is sent and no window opens. */
  get active(): boolean {
    return this.authority() === 'server';
  }

  /** The trade standing now, or null. The same object between changes. */
  get window(): TradeWindow | null {
    return this.live;
  }

  /** Somebody asking to trade, or null. */
  get asked(): TradeAsk | null {
    return this.question;
  }

  /** Whether the server has said what this character owns on this line at all. */
  get known(): boolean {
    return this.gotList;
  }

  /** A list asked for and still on its way: the panel keeps its slow step running while this is true. */
  get wantsList(): boolean {
    return this.wanting;
  }

  /** The server's rows as they last stood, oldest first. Read, never written to. */
  get list(): TradeItem[] {
    return [...this.rows.values()];
  }

  /** Whether an item is in the trade standing now: what keeps it from being put in twice. */
  offered(kind: 'wear' | 'weapon', id: string): boolean {
    const w = this.live;
    if (!w) return false;
    for (const o of w.mine) if (o.kind === kind && o.id === id) return true;
    return false;
  }

  /** The server's row for one thing, or '' where the server has never written it down. */
  rowOf(kind: 'wear' | 'weapon', id: string): string {
    return this.rows.get(`${kind}:${id}`)?.row ?? '';
  }

  // ---- the asking ----------------------------------------------------------------------------------

  /**
   * Ask another player to trade, by the connection this browser already knows them by. The distance
   * is the game's own 8 m and is checked here only so the player is told why nothing happened; the
   * server measures it again on its own copy and is what decides. The answer is a word for the
   * player, or '' when the asking went out.
   */
  askTrade(id: number, name = ''): string {
    if (!this.active) return 'there is no server here, so there is nobody to trade with';
    if (id <= 0) return 'nobody there to trade with';
    if (id === this.selfId()) return 'you cannot trade with yourself';
    if (this.live) return 'you are already trading';
    if (this.question) return 'answer the trade you have been asked for first';
    if (!this.meAt(this.scratchMe) || !this.peerAt(id, this.scratchThem)) return `${name || 'they'} is not on this world`;
    const away = Math.hypot(this.scratchThem.x - this.scratchMe.x, this.scratchThem.y - this.scratchMe.y, this.scratchThem.z - this.scratchMe.z);
    if (away > GROUP_RANGE.trade) return `too far to trade: ${Math.round(away)} m, and a trade reaches ${GROUP_RANGE.trade} m`;
    if (!this.mayAsk()) return 'that is faster than the server will take them';
    this.post({ t: 'trade', do: 'ask', to: id });
    return '';
  }

  /** Take the question up. The server opens the window on both sides; nothing opens here by itself. */
  accept(): void {
    if (!this.active || !this.question) return;
    this.post({ t: 'trade', do: 'accept' });
    this.setAsk(null);
  }

  decline(): void {
    if (!this.active || !this.question) return;
    this.post({ t: 'trade', do: 'decline' });
    this.setAsk(null);
  }

  /**
   * Put an item in. It is refused here for the reasons this side can see -- it is not owned, it is
   * being worn or held, the server has not written it down yet, or the window is full -- because a
   * refusal the player can read is better than a button that does nothing; the server checks every
   * one of them again against its own rows and is what decides. Nothing about the window moves until
   * the server says so.
   */
  putIn(kind: 'wear' | 'weapon', id: string): string {
    const w = this.live;
    if (!this.active || !w) return 'there is no trade open';
    if (!id) return 'there is nothing there';
    if (this.offered(kind, id)) return 'that is in the trade already';
    if (!this.owns(kind, id)) return 'you do not own that';
    const use = this.inUse(kind, id);
    if (use) return use === 'worn' ? 'take it off first: you are wearing it' : `put it away first: it is in your ${use} hand`;
    const row = this.rowOf(kind, id);
    if (!row) return 'the server has not written that one down yet';
    if (w.mine.length >= TRADE_TUNE.offerMax) return `a trade takes ${TRADE_TUNE.offerMax} things at a time`;
    if (!this.mayAsk()) return 'that is faster than the server will take them';
    // The whole of this side's pane goes over rather than the one item, which is the server's own
    // shape: a message lost or arriving twice then leaves both sides saying the same thing.
    this.post({ t: 'trade', do: 'offer', rows: [...w.mine.map((o) => o.row ?? ''), row].filter(Boolean) });
    return '';
  }

  /** Take an item back out: the same message, one row shorter. */
  takeOut(kind: 'wear' | 'weapon', id: string): string {
    const w = this.live;
    if (!this.active || !w) return 'there is no trade open';
    if (!this.offered(kind, id)) return 'that is not in the trade';
    if (!this.mayAsk()) return 'that is faster than the server will take them';
    this.post({ t: 'trade', do: 'offer', rows: w.mine.filter((o) => !(o.kind === kind && o.id === id)).map((o) => o.row ?? '').filter(Boolean) });
    return '';
  }

  /** Say you are happy with it, or take that back. Either side changing anything clears both. */
  setReady(on: boolean): string {
    const w = this.live;
    if (!this.active || !w) return 'there is no trade open';
    if (on && !w.mine.length && !w.theirs.length) return 'there is nothing in the trade yet';
    if (!this.mayAsk()) return 'that is faster than the server will take them';
    this.post({ t: 'trade', do: on ? 'ready' : 'unready' });
    return '';
  }

  /** Break it off. The server tells the other side; the items never moved, so there is nothing to put back. */
  cancel(): void {
    if (!this.active || !this.live) return;
    this.post({ t: 'trade', do: 'cancel' });
  }

  // ---- the ledger ----------------------------------------------------------------------------------

  /**
   * Hand this browser's own list up. It is said once per line, as soon as the server has taken the
   * claim: a character the server has never held is written down from it, and after that the
   * server's list is the truth and this is answered with it rather than merged into it. Either way
   * the answer carries the row ids, which is what everything else here names.
   */
  tell(): void {
    if (!this.active) return;
    const mine = this.mine();
    if (!mine) {
      // Nothing to hand up and nothing to wait for: the select screen and the creator. Left waiting,
      // the panel's slow step would ask again every few seconds for the life of the page.
      this.wanting = false;
      this.stat.waiting = false;
      return;
    }
    if (!this.mayAsk()) return;
    this.want();
    // The mark the record carries: "a server has taken this character down before". An empty list
    // under it is a browser whose storage was cleared, not a character that owns nothing, and the
    // one thing a cache may never do is be written back over the server.
    const mark = this.mark();
    const msg: Record<string, unknown> = {
      t: 'items',
      do: 'list',
      rows: mine.slice(0, TRADE_TUNE.rows).map((o) => ({ kind: o.kind, what: o.id, got: Math.max(0, Math.round(o.got) || 0) })),
    };
    if (mark?.known) {
      msg.known = 1;
      msg.rev = Math.max(0, Math.round(mark.rev) || 0);
    }
    this.post(msg);
  }

  /** Ask for the list again: after a trade, a reconnect, or the console. The answer is `list`. */
  sync(): void {
    if (!this.active) return;
    this.want();
    this.askList();
  }

  /**
   * Start waiting on a list, and say so. Whoever drives `step` (the panel's slow step) has to be
   * running from here on, or the asking again never happens: the first wait of a session is the
   * claim being answered, with no window and no question to have woken anything.
   */
  private want(): void {
    this.wanting = true;
    this.waitSteps = Math.max(1, Math.round(TRADE_TUNE.askAgain));
    this.stat.waiting = true;
    this.onWant();
  }

  /**
   * Ask for the list. A bare "give me the list" is only ever sent once this browser has been given
   * one, because a character the server has never held is settled by the first word it hears about
   * that character's things -- and an empty question settles it as owning nothing. Before that, the
   * question is this browser's own list, which is what the server writes down.
   */
  private askList(): void {
    // Never while a window is open. The server settles a backpack on either question (`list` or
    // `get` both reach `Ledger.settle`), and settling breaks off whatever that character has in
    // flight: a list lost after one trade would otherwise have this side asking again every couple
    // of seconds and cancelling the next trade from under both players. The wait stands, so the
    // question goes the moment the window is gone -- which is also when the list can matter again.
    if (this.live) return;
    if (!this.gotList) {
      this.tell();
      return;
    }
    if (!this.mayAsk()) return;
    this.post({ t: 'items', do: 'get' });
  }

  /**
   * An item this browser gave itself (the starting kit, the give tabs, the console). The server
   * writes it down and answers with the row, so the two lists do not drift. It is never how an item
   * moves between two players: that is a trade, and only the server moves those.
   */
  noteAdded(kind: 'wear' | 'weapon', id: string, got = 0): void {
    if (!this.active || !id || !this.gotList) return;
    if (this.rows.has(`${kind}:${id}`)) return;
    if (!this.mayAsk()) return;
    this.post({ t: 'items', do: 'add', kind, what: id, got: Math.max(0, Math.round(got) || 0) });
  }

  /** One destroyed here. The server knows it by its row id, which this browser only ever hands back. */
  noteDropped(kind: 'wear' | 'weapon', id: string): void {
    if (!this.active || !id || !this.gotList) return;
    const row = this.rowOf(kind, id);
    if (!row) return;
    if (!this.mayAsk()) return;
    this.post({ t: 'items', do: 'drop', id: row });
  }

  /**
   * What is on the body and in the hands, by row id and the whole of it each time: it is what the
   * server refuses an offer of something being worn with, and it is not written down anywhere, so it
   * is said again on every line and whenever it moves. Nothing is sent when it has not moved.
   */
  tellUsing(): void {
    if (!this.active || !this.gotList) return;
    const now = this.using();
    if (!now) return;
    const rowsOf = (list: readonly TradeItem[]) => {
      const out: string[] = [];
      for (const o of list) {
        const row = this.rowOf(o.kind, o.id);
        if (row && !out.includes(row)) out.push(row);
      }
      return out;
    };
    const worn = rowsOf(now.worn);
    const held = rowsOf(now.held);
    const said = `${worn.join(',')}|${held.join(',')}`;
    if (said === this.usingSaid) return;
    if (!this.mayAsk()) return;
    this.usingSaid = said;
    this.post({ t: 'items', do: 'using', worn, held });
  }

  /** Whether another word may go out this second; the server has the same limit and is what enforces it. */
  private mayAsk(): boolean {
    const second = Math.floor(this.now());
    if (second !== this.askWindow) {
      this.askWindow = second;
      this.askCount = 0;
    }
    this.askCount++;
    return this.askCount <= TRADE_TUNE.asksPerSecond;
  }

  private post(msg: Record<string, unknown>): void {
    this.stat.sent++;
    this.send(msg);
  }

  // ---- what the server says ------------------------------------------------------------------------

  /**
   * One message from the far end. True when it was one of ours, so the socket's own switch can go on
   * ignoring everything it does not know. Everything in it is treated as words from a stranger.
   */
  handle(msg: Record<string, unknown>): boolean {
    const t = msg?.t;
    if (t === 'items') {
      this.items(msg);
      return true;
    }
    if (t !== 'trade') return false;
    switch (String(msg.do ?? '')) {
      case 'asked':
        this.setAsk(this.readAsk(msg));
        break;
      case 'sent': {
        // The other end of the same question: whoever asked is told it went.
        const name = cleanText(msg.name, 40) || 'them';
        this.onNote(`asked ${name} to trade`);
        break;
      }
      case 'state': {
        const w = this.readWindow(msg);
        if (w) this.setWindow(w);
        break;
      }
      case 'done': {
        // The rows have changed owner on the server, in one step, before this word was sent. Nothing
        // here moves them: the list is asked for at once and the backpack is written from that.
        const got = readRows(msg.got);
        const gave = readRows(msg.gave);
        this.stat.done++;
        this.stat.got += got.length;
        this.stat.gave += gave.length;
        this.stat.lastEnd = 'done';
        const name = cleanText(msg.with, 40) || this.live?.name || 'them';
        this.setWindow(null);
        this.setAsk(null);
        this.sync();
        this.onNote(tradeWords(name, got, gave));
        break;
      }
      case 'off': {
        // The server's own words for why, which are sentences rather than a code: shown as they are.
        const why = cleanText(msg.why, 160);
        this.stat.lastEnd = why || 'off';
        this.setWindow(null);
        this.setAsk(null);
        this.onNote(why ? `the trade is off: ${why}` : 'the trade is off');
        break;
      }
      case 'refused': {
        const why = cleanText(msg.why, 160);
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

  /** The `items` half: the list, and the two little answers that keep the row ids in step with it. */
  private items(msg: Record<string, unknown>): void {
    switch (String(msg.do ?? '')) {
      case 'list': {
        const items = readRows(msg.rows, TRADE_TUNE.rows);
        this.rows.clear();
        for (const item of items) this.rows.set(`${item.kind}:${item.id}`, item);
        this.take = msg.take === 'browser' ? 'browser' : 'server';
        this.gotList = true;
        this.wanting = false;
        this.waitSteps = 0;
        this.stat.known = true;
        this.stat.waiting = false;
        this.stat.rows = items.length;
        this.stat.take = this.take;
        // The one place the backpack, the body and the hands are ever written from a message.
        this.onList(items, this.take);
        // The server forgets what is worn when it restarts, and a list is the moment its row ids are
        // known here at all: this is what stops a shirt on the body being offered in a trade.
        this.usingSaid = '';
        this.tellUsing();
        break;
      }
      case 'added': {
        const row = readRow(msg.row);
        if (row) this.rows.set(`${row.kind}:${row.id}`, row);
        break;
      }
      case 'gone': {
        const id = readId(msg.id);
        if (!id) break;
        for (const [key, row] of this.rows) if (row.row === id) this.rows.delete(key);
        break;
      }
      case 'refused': {
        const why = cleanText(msg.why, 160);
        this.stat.refused = why;
        if (why) this.onNote(why);
        break;
      }
      default:
        break;
    }
  }

  /** A question, read rather than trusted. */
  private readAsk(msg: Record<string, unknown>): TradeAsk | null {
    const from = Number(msg.from) || 0;
    if (!from) return null;
    const until = Number(msg.until);
    const end = Number.isFinite(until) && until > 0 ? until : this.serverNow() + TRADE_TUNE.askSeconds * 1000;
    return { from, name: cleanText(msg.name, 40) || 'someone', until: end, left: Math.max(0, (end - this.serverNow()) / 1000) };
  }

  /**
   * The window as the server holds it, from this side's own end: what is in each pane and who has
   * pressed. The whole of it arrives every time anything moves, so the two browsers cannot end up
   * holding different halves of one trade.
   */
  private readWindow(msg: Record<string, unknown>): TradeWindow | null {
    const id = cleanText(msg.id, 24);
    const withId = Number(msg.with) || 0;
    if (!id || withId === this.selfId()) return null;
    const mine = side(msg.yours);
    const theirs = side(msg.theirs);
    const had = this.live;
    const w: TradeWindow = had && had.id === id ? had : { id, with: withId, name: '', mine: [], theirs: [], youReady: false, themReady: false };
    w.with = withId;
    w.name = cleanText(msg.name, 40) || w.name || 'someone';
    // The server's panes are read whole, to the list's own cap and never to `offerMax`: that number
    // is how many things this side will let the player *add*, it is live from the console, and the
    // panes are what the next offer is rebuilt from -- read short, lowering it would silently take
    // everything past it back out of a trade the player is looking at.
    w.mine = readRows(mine.rows, TRADE_TUNE.rows);
    w.theirs = readRows(theirs.rows, TRADE_TUNE.rows);
    w.youReady = mine.ready === 1;
    w.themReady = theirs.ready === 1;
    return w;
  }

  private setWindow(w: TradeWindow | null): void {
    const was = this.live;
    this.live = w;
    this.stat.open = !!w;
    this.stat.withName = w ? w.name : '';
    this.stat.mine = w ? w.mine.length : 0;
    this.stat.theirs = w ? w.theirs.length : 0;
    this.stat.youReady = !!w?.youReady;
    this.stat.themReady = !!w?.themReady;
    // A window that moved is the same object written in place (the panel holds no copy of it), so
    // "the same object" is not "nothing happened": only nothing to nothing is nothing.
    if (!was && !w) return;
    this.onWindow(w);
  }

  private setAsk(a: TradeAsk | null): void {
    if (!a && !this.question) return;
    this.question = a;
    this.stat.asked = a ? a.name : '';
    this.onAsk(a);
  }

  /**
   * The line dropped, was put down or was taken over. Nothing of a trade survives it: the server
   * breaks its own side off when the line closes, and the items were never anywhere but the server's
   * rows, so there is nothing here to put back. The list is let go of with it, and with it the
   * belief that anything here is the server's -- what is in local storage is the backpack again,
   * exactly as it is for a browser that never connected.
   */
  clear(): void {
    this.setWindow(null);
    this.setAsk(null);
    this.rows.clear();
    this.gotList = false;
    this.wanting = false;
    this.waitSteps = 0;
    this.take = '';
    this.usingSaid = '';
    this.stat.known = false;
    this.stat.waiting = false;
    this.stat.rows = 0;
    this.stat.take = '';
    this.stat.refused = '';
  }

  // ---- the slow tick -------------------------------------------------------------------------------

  /**
   * Time passing, at whatever rate the panel asks (a few times a second, never per frame): the
   * countdown on a question is read off the shared clock, and a list that was asked for and has not
   * come is asked for again. True when something a panel shows has moved.
   */
  step(_dt: number): boolean {
    let changed = false;
    // A list asked for after a trade is the only thing that moves the backpack, so it is worth
    // asking for again: the server drops a word over its own rate and says nothing at all. Not on
    // every step -- a list arrives in a moment -- but every few seconds until one does.
    if (this.wanting && this.active) {
      if (this.waitSteps <= 0) {
        this.waitSteps = Math.max(1, Math.round(TRADE_TUNE.askAgain));
        this.askList();
      } else this.waitSteps--;
    }
    const ask = this.question;
    if (!ask) return changed;
    const left = Math.max(0, (ask.until - this.serverNow()) / 1000);
    changed = Math.ceil(left) !== Math.ceil(ask.left);
    ask.left = left;
    // The server takes its own question back when it lapses; this is only so one here does not sit
    // on the screen for ever if that word is lost.
    if (left <= 0) {
      this.setAsk(null);
      this.onNote('the trade was not answered');
      return true;
    }
    return changed;
  }

  /** What the trade is doing, in the object it always answers with. */
  debug(): TradeStats {
    this.stat.active = this.active;
    return this.stat;
  }
}

/** What a finished trade reads as. The server says what changed hands; the words are ours. */
export function tradeWords(name: string, got: readonly TradeItem[], gave: readonly TradeItem[]): string {
  const count = (n: number) => (n === 1 ? '1 thing' : `${n} things`);
  if (got.length && gave.length) return `traded ${count(gave.length)} to ${name} for ${count(got.length)}`;
  if (got.length) return `${name} gave you ${count(got.length)}`;
  if (gave.length) return `you gave ${name} ${count(gave.length)}`;
  return `the trade with ${name} is done, and nothing changed hands`;
}

/** One side of a `state`, read rather than trusted: rows and whether that side has pressed. */
function side(x: unknown): { rows: unknown; ready: number } {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { rows: [], ready: 0 };
  const o = x as Record<string, unknown>;
  return { rows: o.rows, ready: o.ready === 1 ? 1 : 0 };
}

/** A list of rows from the far end: anything that is not one is no row at all. */
function readRows(x: unknown, cap = TRADE_TUNE.rows): TradeItem[] {
  if (!Array.isArray(x)) return [];
  const out: TradeItem[] = [];
  const seen = new Set<string>();
  for (const raw of x.slice(0, cap)) {
    const item = readRow(raw);
    if (!item) continue;
    const key = `${item.kind}:${item.id}`;
    // A list naming one thing twice would be one thing, not two: the backpack holds one row per kind
    // and catalogue id (`normalizeOwned`), and the server's own table holds one as well.
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** One row: the server's id for it, a kind, a catalogue id and when it was got. */
function readRow(x: unknown): TradeItem | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const kind = o.kind === 'weapon' ? 'weapon' : o.kind === 'wear' ? 'wear' : null;
  if (!kind) return null;
  const id = readId(o.what);
  if (!id) return null;
  const got = Number(o.got);
  const row = readId(o.id);
  const item: TradeItem = { kind, id, got: Number.isFinite(got) && got > 0 ? got : 0 };
  if (row) item.row = row;
  return item;
}

/** An id: plain, and never anything that means something to an object. */
function readId(x: unknown): string {
  if (typeof x !== 'string' || !x || x.length > 64) return '';
  if (x === '__proto__' || x === 'constructor' || x === 'prototype') return '';
  return /^[A-Za-z0-9_.:-]+$/.test(x) ? x : '';
}

/**
 * The one in play. There is a single ledger for the life of the page, and the parts of the game that
 * are not handed it -- the chat line's `/trade`, which is built far from the wiring -- ask for it
 * here. It answers null before the game has made one, and with no server it is made and quiet, so a
 * caller never has to ask whether there is a server: `askTrade` answers with a word.
 */
let theTrade: Trade | null = null;

export function tradeNow(): Trade | null {
  return theTrade;
}
