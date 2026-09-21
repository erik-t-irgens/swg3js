// Who this browser is when it meets a server, and what it does when the server is not there.
//
// Three things live here. The identity: 32 random bytes the browser makes for itself the first time it
// runs and keeps, whose public name is a short hash of them and whose verifier -- a second hash, which
// is all the server is ever given -- is what answers the server's challenge, so the key itself never
// crosses the wire and can be copied to another machine to be the same player there. The handshake: the
// server hails, this answers with that proof and the proof of the join word on the address, and from
// then on the session is either a server session or a plain relay one. And the counting of changes made
// with nobody watching, so that a character played offline and a character on the server can be settled
// by the higher counter, with a question when they tie and differ (decision 4).
//
// Nothing in this file touches the document, three.js or the socket, so a node test runs it directly;
// localStorage and crypto are read through guards, because a private window, cleared site data and a
// node test all give a module that is not there. Nothing here runs in a frame: the whole file is
// connection work. The rules the server applies to any of this are the server's own
// (server/identity.mjs); this side only proves what it is asked and does as it is told.

import { fromBase32, hmacSha256, sha256, toBase32, toHex, utf8 } from './hash.ts';

/** The version of the language this browser speaks. An old relay ignores it; a new server reads it. */
export const WIRE_VERSION = 2;

/**
 * The label mixed into the key to make the verifier the server keeps. It is the server's
 * (`VERIFY_LABEL` in server/identity.mjs) and the two must be the same word or no claim is ever
 * answered: changing it would make every player new.
 */
const VERIFY_LABEL = 'swg3js/verify/1';

/** Where a browser's own things are kept. `swg.server` is the address, which `Net` has always owned. */
const KEY_STORE = 'swg.player';
const WORD_STORE = 'swg.word';
const REV_STORE = 'swg.charrev';

/**
 * The session's own numbers, ours, live: `__debug.session({ hailWait: 2000 })` sets one and the next
 * connection obeys it. The clock's numbers are not here -- they are the shared clock's (CLOCK_TUNE in
 * src/world/sharedClock.ts) -- and the server's rates are the server's.
 *
 * `hailWait` is how long a browser waits for the server to speak first before deciding it is talking to
 * the relay that came before: a new server's hail comes in the same breath as the socket opening, so
 * this is the backstop for a server that opens a line and then says nothing at all. The hello waits for
 * that decision, because a server started with a join word listens to nothing until it has been told who
 * is there.
 */
export const SESSION = {
  /** Invented: milliseconds to wait for a hail before deciding this is the old relay. */
  hailWait: 1000,
};

/** Set any of those, clamped to what makes sense; the answer is the table as it now stands. */
export function tuneSession(o: Partial<typeof SESSION>): typeof SESSION {
  if (typeof o.hailWait === 'number') SESSION.hailWait = Math.max(0, Math.min(30000, Math.round(o.hailWait)));
  return SESSION;
}

/** What kind of session this is. `waiting` is the moment between the socket opening and the server speaking. */
export type SessionMode = 'off' | 'waiting' | 'relay' | 'server';

/** Who decides things: this browser alone, or the server. Everything new asks this, never the socket. */
export type Authority = 'me' | 'server';

/** What the server says when it opens a line: the language it speaks, its clock, and what to prove. */
export interface Hail {
  v: number;
  now: number;
  /** The world clock's own beginning and the length of its day, for the shared clock. */
  epoch?: number;
  dayMs?: number;
  nonce: string;
  /** 1 when the server was started with a join word and will not have anyone who does not know it. */
  word?: number;
  /** 1 when damage between players is switched on where this server is. */
  ff?: number;
}

/** What the server keeps about a character, and what a browser offers: the part the two are compared on. */
export interface CharacterSummary {
  name: string;
  species: string;
  class: string;
  planet: string;
  zone: string;
  counter: number;
}

/** The character the game is playing, as the wiring hands it over. */
export interface CharacterAbout {
  species: string;
  class: string;
  planet: string;
  zone?: string;
}

/** How the server settled a character (its words, not ours). */
export type Settlement = 'browser' | 'server' | 'same' | 'ask';

/**
 * A value written out with every object's keys in order, so that a record rebuilt with its fields in a
 * different order (a ship's fit is assembled afresh on every refit) marks the same as the one it
 * replaced. `JSON.stringify` alone keeps insertion order, which would bump the change counter for
 * nothing and make the counter untrustworthy as a count of real changes.
 */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(',')}}`;
}

/**
 * A short hash of everything about a character that a trade, a change of clothes or a refit would move:
 * its name, what it wears, what it owns, what is in its hands and how its ships are fitted. It never
 * crosses the wire -- it is how this browser tells a real change from a reconnection, so that the change
 * counter rises once for each change and not once for each time the game was started.
 *
 * Where the character stands is not in here: it is kept beside the counter instead (`where` on the
 * count), because a journey has to be told from a place merely becoming known. A hash cannot say which
 * of the two it is looking at, and the difference matters -- the way into the world changes clothes
 * before anything has said what planet this is, so a place inside the mark would count the first thing
 * the game does as a change, every single launch.
 *
 * How the character looks is deliberately not in the mark either: a face retuned in the creator is not
 * something two copies of a character can disagree about in a way worth asking the player to settle.
 */
export function characterMark(c: {
  name?: string;
  outfit?: readonly string[];
  items?: readonly { kind: string; id: string }[];
  held?: { right?: string; left?: string };
  ships?: Record<string, unknown>;
  powers?: readonly string[];
  gadgets?: readonly string[];
  saber?: { color: string };
}): string {
  const parts: string[] = [];
  parts.push(`n:${c.name ?? ''}`);
  parts.push(`o:${[...(c.outfit ?? [])].sort().join(',')}`);
  parts.push(`i:${(c.items ?? []).map((o) => `${o.kind}:${o.id}`).sort().join(',')}`);
  parts.push(`h:${c.held?.right ?? ''}/${c.held?.left ?? ''}`);
  const ships = c.ships ?? {};
  parts.push(`s:${Object.keys(ships).sort().map((k) => `${k}=${stableJson(ships[k])}`).join(',')}`);
  parts.push(`p:${(c.powers ?? []).join(',')}`);
  parts.push(`g:${(c.gadgets ?? []).join(',')}`);
  parts.push(`b:${c.saber?.color ?? ''}`);
  return toHex(sha256(utf8(parts.join('|')))).slice(0, 16);
}

/** One copy of a character in one line, for telling this question from the one answered last time. */
function storyOf(s: CharacterSummary | null | undefined): string {
  return `${s?.name ?? ''}|${s?.species ?? ''}|${s?.class ?? ''}|${s?.planet ?? ''}|${s?.zone ?? ''}|${Number(s?.counter) || 0}`;
}

/** What this browser keeps per character: the change counter, its mark, where it was, and any tie already answered. */
interface CharacterCount {
  n: number;
  mark: string;
  /** Where the character was the last time this browser knew: `planet/zone`, absent while unknown. */
  where?: string;
  /** The last answer given to a tie about this character, so the same question is not asked twice. */
  ans?: { take: 'browser' | 'server'; n: number; story: string };
}

/** Where a browser keeps its own small things. A test hands in its own; a browser gets localStorage. */
export interface SessionStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** localStorage, or nothing at all when there is none (a private window, a node test, cleared data). */
export function browserStore(): SessionStore {
  return {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* no storage: the session still works, it is just forgotten when the page goes */
      }
    },
  };
}

/** Random bytes. `crypto.getRandomValues` exists on every page, secure or not, which is why the key is made this way. */
function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(out);
    return out;
  }
  // Nothing with a random number generator in it should reach this; it is here so that a browser
  // without one still runs rather than throwing, and such a key is not a secret.
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** How long a player's key is, and how much of its hash is the public name. Both the server's. */
const KEY_BYTES = 32;
const ID_CHARS = 16;

/** The public name of a key: the front of its hash, as `playerIdFor` in server/identity.mjs works it out. */
export function playerIdOf(key: Uint8Array): string {
  return toHex(sha256(key)).slice(0, ID_CHARS);
}

/** The verifier a server keeps: the hash of the key and the label, as `verifierFor` works it out. */
export function verifierOf(key: Uint8Array): string {
  const label = utf8(VERIFY_LABEL);
  const both = new Uint8Array(key.length + label.length);
  both.set(key);
  both.set(label, key.length);
  return toHex(sha256(both));
}

/** The answer to the hail's challenge: HMAC of the nonce under the verifier, as `proofFor` works it out. */
export function proofOf(verifierHex: string, nonce: string): string {
  return toHex(hmacSha256(utf8(verifierHex), utf8(nonce)));
}

/** The same for the join word, so the word itself is never sent (`wordProofFor`). */
export function wordProofOf(word: string, nonce: string): string {
  return toHex(hmacSha256(utf8(word), utf8(nonce)));
}

/** What the session is doing, filled in place so the console can read it between frames. */
export interface SessionStats {
  mode: SessionMode;
  authority: Authority;
  player: string;
  character: string;
  /** The server's own number for this connection, as `welcome` gives it. */
  id: number;
  /** The change counter this browser holds for the character in play. */
  counter: number;
  /** How the server settled that character, in its own words. */
  keep: Settlement | '';
  /** A tie waiting to be settled, or null. */
  ask: { character: string; browser: CharacterSummary; server: CharacterSummary } | null;
  /** Why the server would not have us, in its own words, if that is why we are off. */
  denied: string;
  /** Why the server would not give this browser the character it asked for, with the line left open. */
  refused: string;
  /** Whether another browser took this character. */
  taken: boolean;
  /** Whether damage between players is switched on where we are (the same answer `friendlyFire` gives). */
  friendlyFire: boolean;
  /**
   * Whether this player is the one who may stand creatures in the world (the same answer `isAdmin`
   * gives). It is the server's word, carried in the answer to this browser's claim; with no server
   * there is no admin at all, because there is nobody to be an admin of.
   */
  admin: boolean;
  /** Which version of the language the far end speaks, as its greeting said; 0 until one does. */
  serverVersion: number;
}

/**
 * The browser's half of joining. `Net` owns the socket and hands this the words it does not understand
 * itself; everything else in the game asks this, not the socket, what is true.
 */
export class Session {
  private readonly store: SessionStore;
  private key: Uint8Array | null = null;
  private id16 = '';
  private verifier = '';
  private nonce = '';
  /** The character this session is about, and what was last worked out about it. */
  private charId = '';
  private charName = '';
  private charMark = '';
  private about: CharacterAbout = { species: '', class: 'jedi', planet: '', zone: '' };
  /**
   * The word is held here as well as in storage, because a browser with its storage turned off (a
   * private window) would otherwise forget it between the page taking it and the server asking for it.
   */
  private wordNow: string | null = null;
  /**
   * The friendly-fire switch as the far end said it, kept apart from the one everything reads: a hail
   * carries it before the claim is answered, and until the server has us this browser is still deciding
   * for itself, where damage between players is off. The two used to disagree, so the console read one
   * thing and every caller another.
   */
  private ffHeard = false;
  /** Said once per line: a server speaking a language newer than this browser's. */
  private saidNewer = false;
  private stat: SessionStats = { mode: 'off', authority: 'me', player: '', character: '', id: 0, counter: 0, keep: '', ask: null, denied: '', refused: '', taken: false, friendlyFire: false, admin: false, serverVersion: 0 };

  /** What the game tells the player: joining, being taken over, a character settled. The message line takes it. */
  onNote: (text: string) => void = () => {};
  /** A tie the player has to settle (decision 4), or null when it has been settled. */
  onAsk: (ask: { character: string; browser: CharacterSummary; server: CharacterSummary } | null) => void = () => {};
  /** How a character was settled, for whoever will apply the server's copy when there is one to apply. */
  onSettled: (what: Settlement, record: CharacterSummary | null) => void = () => {};
  /** Something to send: `Net` puts it on the socket. */
  send: (msg: Record<string, unknown>) => void = () => {};

  /**
   * The key is not made here. A browser with no server address set must be the game exactly as it was,
   * and that means writing nothing into its storage it did not write before: the key is made the first
   * time somebody asks who this player is, which is either the Multiplayer page being opened or a server
   * being talked to.
   */
  constructor(store: SessionStore = browserStore()) {
    this.store = store;
  }

  // ---- the identity ---------------------------------------------------------------------------------

  /** This browser's key, made the first time it is asked for and kept from then on. */
  private keyBytes(): Uint8Array {
    if (this.key) return this.key;
    const kept = this.store.get(KEY_STORE) ?? '';
    let bytes = fromBase32(kept, KEY_BYTES);
    if (bytes.length !== KEY_BYTES) {
      bytes = randomBytes(KEY_BYTES);
      this.store.set(KEY_STORE, toBase32(bytes, 0));
    }
    this.setKey(bytes);
    return bytes;
  }

  private setKey(bytes: Uint8Array): void {
    this.key = bytes;
    this.id16 = playerIdOf(bytes);
    this.verifier = verifierOf(bytes);
    this.stat.player = this.id16;
  }

  /** The public name of this player: the same in every browser holding the same key. */
  get player(): string {
    this.keyBytes();
    return this.id16;
  }

  /** The key spelled out for copying into another browser: the server's own base 32, in groups of four. */
  exportKey(): string {
    return toBase32(this.keyBytes());
  }

  /**
   * Take a key copied out of another browser. This browser becomes that player: everything it owns is
   * still in its own storage, but a server will know it as the other player from now on, which is why
   * the page asks twice before calling this. An empty answer means the words did not read as a key and
   * nothing was changed.
   */
  importKey(text: string): string {
    const bytes = fromBase32(text, KEY_BYTES);
    if (bytes.length !== KEY_BYTES) return '';
    this.setKey(bytes);
    this.store.set(KEY_STORE, toBase32(bytes, 0));
    // A line already open still holds the claim the old player made: the server has not heard of this
    // one and will not until the line is made again, so the player is told rather than left with a page
    // that says one name and a server that believes another.
    if (this.stat.authority === 'server') this.onNote(`this browser is now ${this.id16}: press Connect again to join as this player`);
    return this.id16;
  }

  // ---- the join word --------------------------------------------------------------------------------

  /** The word on the address (`?word=`), or the one kept in this browser, or none. */
  static savedWord(search?: string): string {
    try {
      const param = new URLSearchParams(search ?? (typeof location !== 'undefined' ? location.search : '')).get('word');
      if (param) return param;
    } catch {
      /* no address to read */
    }
    try {
      return localStorage.getItem(WORD_STORE) ?? '';
    } catch {
      return '';
    }
  }

  get word(): string {
    if (this.wordNow !== null) return this.wordNow;
    return this.store.get(WORD_STORE) ?? '';
  }

  setWord(word: string): void {
    this.wordNow = word.trim();
    this.store.set(WORD_STORE, this.wordNow);
  }

  // ---- the character in play ------------------------------------------------------------------------

  /**
   * The character the game is playing, and what its record holds now. Called whenever that record could
   * have changed: the counter goes up only when the record really moved, so starting the game twice is
   * not a change and an evening of trading is.
   */
  noteCharacter(c: { id: string; name?: string; outfit?: readonly string[]; items?: readonly { kind: string; id: string }[]; held?: { right?: string; left?: string }; ships?: Record<string, unknown>; powers?: readonly string[]; gadgets?: readonly string[]; saber?: { color: string } } | null, about?: CharacterAbout): void {
    if (about) this.about = { species: about.species, class: about.class, planet: about.planet, zone: about.zone ?? '' };
    // A different character with nothing said about where it is: whatever place the session is holding
    // belongs to the one played before it, and taking it for this one's would read as a journey the
    // first time the game does say where this character stands.
    else if (c && c.id !== this.charId) this.about = { species: '', class: this.about.class, planet: '', zone: '' };
    if (!c) {
      this.charId = '';
      this.charName = '';
      this.charMark = '';
      this.stat.character = '';
      this.stat.counter = 0;
      return;
    }
    const mark = characterMark(c);
    // The place is read from what the session holds rather than from the argument: this is called with
    // no `about` at all whenever what a character owns, wears or flies changes, since a change of
    // clothes says nothing about where anyone is standing.
    const where = this.about.planet ? `${this.about.planet}/${this.about.zone ?? ''}` : '';
    this.charId = c.id;
    this.charName = c.name ?? '';
    const counters = this.counters();
    const held = counters[c.id];
    if (!held) {
      counters[c.id] = where ? { n: 1, mark, where } : { n: 1, mark };
      this.saveCounters(counters);
    } else {
      // A journey between two places this browser knows is a change, because the server compares two
      // copies of a character on a summary that has the planet and the zone in it: left out, an
      // ordinary walk to another planet left both sides at the same counter with different stories,
      // which is the server's "ask the player" -- on every connection after a journey, for ever.
      //
      // A place merely becoming known is not a change: the way into the world puts a character's
      // clothes back on before anything has said what planet this is, so counting that would raise the
      // counter once every launch and make it mean nothing.
      const travelled = !!where && !!held.where && held.where !== where;
      const moved = held.mark !== mark || travelled;
      if (moved) {
        held.n = held.n + 1;
        held.mark = mark;
      }
      const learned = !!where && held.where !== where;
      if (learned) held.where = where;
      if (moved || learned) this.saveCounters(counters);
    }
    this.charMark = mark;
    this.stat.character = c.id;
    this.stat.counter = counters[c.id].n;
  }

  /** The change counter this browser holds for a character. */
  counterOf(id: string): number {
    return this.counters()[id]?.n ?? 0;
  }

  private counters(): Record<string, CharacterCount> {
    try {
      const raw = this.store.get(REV_STORE);
      const o = raw ? (JSON.parse(raw) as Record<string, CharacterCount>) : {};
      // An array passes `typeof o === 'object'`, and writing counters into one would be thrown away by
      // `JSON.stringify` on the way out: the counter would then never persist and nothing would say so.
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch {
      return {};
    }
  }

  private saveCounters(o: Record<string, CharacterCount>): void {
    try {
      this.store.set(REV_STORE, JSON.stringify(o));
    } catch {
      /* nothing to keep it in */
    }
  }

  /** Make this browser's copy of the character the newer one, so the next claim settles its way. */
  private raiseCounter(to: number): void {
    if (!this.charId) return;
    const counters = this.counters();
    const held = counters[this.charId] ?? { n: 0, mark: this.charMark };
    held.n = Math.max(held.n, to);
    counters[this.charId] = held;
    this.saveCounters(counters);
    this.stat.counter = held.n;
  }

  /**
   * Remember how a tie was answered, so the same question is not put to the player again. The counter
   * it was answered at is kept with it: any real change here raises that counter, which makes the
   * memory stale and the next tie a fresh question.
   */
  private rememberAnswer(character: string, take: 'browser' | 'server', story: string): void {
    const counters = this.counters();
    const held = counters[character] ?? { n: this.stat.counter, mark: this.charMark };
    held.ans = { take, n: held.n, story };
    counters[character] = held;
    this.saveCounters(counters);
  }

  /** The answer already given to exactly this question, or null when it is a new one. */
  private rememberedAnswer(character: string, server: CharacterSummary): 'browser' | 'server' | null {
    const held = this.counters()[character];
    if (!held?.ans) return null;
    if (held.ans.n !== held.n || held.ans.story !== storyOf(server)) return null;
    return held.ans.take === 'browser' || held.ans.take === 'server' ? held.ans.take : null;
  }

  // ---- the handshake --------------------------------------------------------------------------------

  /** A line is opening. Until the server speaks nothing is known about it. */
  opening(): void {
    this.nonce = '';
    this.stat.mode = 'waiting';
    this.stat.authority = 'me';
    this.stat.id = 0;
    this.stat.keep = '';
    this.stat.denied = '';
    this.stat.refused = '';
    this.stat.friendlyFire = false;
    this.ffHeard = false;
    // Being the admin is the server's word about the line that is opening, not about the one that
    // closed: until this one answers, nobody may stand anything.
    this.stat.admin = false;
    this.stat.serverVersion = 0;
    this.saidNewer = false;
    // A line being opened again is the player asking for this character back, so what was true of the
    // last line is not carried into this one: left set, the console said for the rest of the page's
    // life that the character had been taken over.
    this.stat.taken = false;
  }

  /** The line closed. Whatever the server held is no longer known, and this browser decides again. */
  closed(): void {
    this.stat.mode = 'off';
    this.stat.authority = 'me';
    this.stat.id = 0;
    this.stat.ask = null;
    this.stat.friendlyFire = false;
    this.ffHeard = false;
    this.stat.admin = false;
  }

  /** Nothing was heard within the wait: this is the old relay, and everything a server would hold is off. */
  hailTimedOut(): void {
    if (this.stat.mode !== 'waiting') return;
    this.stat.mode = 'relay';
    this.onNote('connected to a relay: places and poses only, nothing kept');
  }

  /** A welcome with no hail before it is the old relay answering, whatever the wait says. */
  welcomedWithoutHail(): void {
    this.hailTimedOut();
  }

  /**
   * The server hailed: answer it with a claim. False when there is no character to claim with, which
   * leaves the session on the relay's footing rather than half way into a handshake.
   */
  hail(h: Hail): boolean {
    const nonce = String(h.nonce ?? '');
    if (!nonce) {
      // A greeting with no challenge in it is not one this browser can answer: nothing can be proved to
      // such a far end, so the line is put on the footing of the relay that came before rather than
      // left half way into a handshake that can never finish.
      this.stat.mode = 'relay';
      this.onNote('the server’s greeting could not be read: places and poses only, nothing kept');
      return false;
    }
    this.nonce = nonce;
    this.stat.mode = 'server';
    this.stat.serverVersion = Number(h.v) || 0;
    if (this.stat.serverVersion > WIRE_VERSION && !this.saidNewer) {
      this.saidNewer = true;
      this.onNote('this server speaks a newer language than this browser: some of what it holds may not reach you');
    }
    // Heard, not applied: damage between players is off until the server has this browser, because
    // until then this browser is still deciding everything for itself.
    this.ffHeard = h.ff === 1;
    if (!this.charId) {
      this.onNote('connected before a character was chosen: the world is not yours yet');
      return false;
    }
    this.sendClaim(h.word === 1);
    return true;
  }

  private sendClaim(needWord: boolean): void {
    this.keyBytes();
    const msg: Record<string, unknown> = {
      t: 'claim',
      v: WIRE_VERSION,
      player: this.id16,
      // The verifier, not the key: what the server keeps is a hash of the key, so a server's own file
      // never holds the thing a player copies to their other machine (server/identity.mjs says so).
      key: this.verifier,
      proof: proofOf(this.verifier, this.nonce),
      character: this.charId,
      name: this.charName,
      counter: this.counterOf(this.charId),
      about: { species: this.about.species, class: this.about.class, planet: this.about.planet, zone: this.about.zone ?? '' },
    };
    if (needWord) msg.word = wordProofOf(this.word, this.nonce);
    this.send(msg);
  }

  /** The server has us: this is a server session, and it says how it settled the character. */
  claimed(you: { player?: string; character?: string; name?: string; admin?: number } | undefined, keep: Settlement | ''): void {
    this.stat.mode = 'server';
    this.stat.authority = 'server';
    this.stat.denied = '';
    this.stat.taken = false;
    this.stat.keep = keep || '';
    // The server has us, so the switch it named is now the one in force here.
    this.stat.friendlyFire = this.ffHeard;
    // Whether this player may stand creatures in the world. It is a flag on the answer to the claim,
    // which a server built before this never sends and an old relay never answers at all, so a
    // browser that is told nothing is not an admin -- which is the right answer in both cases.
    this.stat.admin = you?.admin === 1;
    if (you?.character) this.stat.character = you.character;
    this.onNote(`joined the world as ${this.charName || you?.name || 'someone'}`);
  }

  /** The welcome, which on a server carries this connection's number and the friendly-fire switch. */
  welcome(msg: { id?: number; v?: number; ff?: number }): void {
    this.stat.id = Number(msg.id) || 0;
    if (Number(msg.v) >= 2) {
      this.stat.mode = 'server';
      this.ffHeard = msg.ff === 1;
      this.stat.friendlyFire = this.stat.authority === 'server' && this.ffHeard;
    } else this.welcomedWithoutHail();
  }

  /** Two copies of one character with the same counter and a different story: the player chooses. */
  settleAsk(character: string, browser: CharacterSummary, server: CharacterSummary): void {
    this.stat.ask = { character, browser, server };
    this.stat.keep = 'ask';
    // The same two copies as the last time this was asked, and nothing has changed here since: the
    // answer the player gave then is given again rather than put to them on every connection for ever.
    // Keeping the server's copy changes nothing on either side, so without this the question comes back
    // the next time, and the next.
    const again = this.rememberedAnswer(character, server);
    if (again) {
      this.resolveAsk(again, true);
      return;
    }
    this.onAsk(this.stat.ask);
    this.onNote('this character was played in two places: choose which copy stands, under Multiplayer');
  }

  /**
   * The player answered, or the answer they gave last time is being given again (`again`), or the page
   * answered for them.
   */
  resolveAsk(take: 'browser' | 'server', again = false): void {
    const ask = this.stat.ask;
    if (!ask) return;
    this.stat.ask = null;
    this.onAsk(null);
    this.send({ t: 'settle', character: ask.character, take });
    if (take === 'browser') {
      // Keeping this browser's copy makes it the newer one, so the next connection settles without a
      // question whatever the server does with this answer; the server writes the copy it was given,
      // counter and all. That matters because a late answer is dropped by the server in silence.
      this.raiseCounter(Math.max(ask.browser.counter, ask.server.counter) + 1);
      this.stat.keep = 'browser';
    } else {
      this.stat.keep = 'server';
      this.onSettled('server', ask.server);
    }
    this.rememberAnswer(ask.character, take, storyOf(ask.server));
    if (again) {
      this.onNote('this character was played in two places, as it was before: the answer you gave then still stands');
      return;
    }
    // Said as it is: the server keeps a name, a place and a change counter, and nothing here can put
    // its copy back into this browser until there is a ledger to put back.
    this.onNote(take === 'browser' ? 'keeping this browser’s copy of the character: it is the one that stands from now on' : 'the server’s copy of this character stands; nothing of it can be put back into this browser yet');
  }

  /** The server's copy stands (it was newer, or the question went unanswered). */
  settled(character: string, take: string, record: CharacterSummary | null): void {
    if (this.stat.ask && this.stat.ask.character === character) {
      this.stat.ask = null;
      this.onAsk(null);
    }
    if (take !== 'server') return;
    this.stat.keep = 'server';
    // Nothing applies it yet: the server holds a character's name and counter, and what it owns comes
    // with the ledger. The player is told rather than left to wonder why nothing happened.
    this.onNote('the server has its own copy of this character, and it is the one that stands');
    this.onSettled('server', record);
  }

  /** The server will not have us, in its own words, and trying again cannot help. */
  denied(why: string): void {
    this.stat.denied = why || 'the server would not have this browser';
    this.stat.mode = 'off';
    this.stat.authority = 'me';
    this.stat.friendlyFire = false;
    this.ffHeard = false;
    this.stat.admin = false;
    this.onNote(`the server turned this browser away: ${this.stat.denied}`);
  }

  /**
   * The line stands, but not with this character: a character id two browsers happened to make the
   * same way belongs to whoever registered it first, and the server leaves the line open so the player
   * can pick another rather than being locked out of the world over it. Nothing said this at all
   * before, so such a browser sat on an open line that would never welcome it, with no word about why.
   */
  refusedCharacter(why: string): void {
    this.stat.refused = why || 'that character cannot be played here';
    this.onNote(`the server would not give this browser that character: ${this.stat.refused}. Switch character and connect again.`);
  }

  /** The same character was opened in a newer browser: this one is done (decision 8). */
  taken(by?: string): void {
    this.stat.taken = true;
    this.stat.mode = 'off';
    this.stat.authority = 'me';
    this.stat.friendlyFire = false;
    this.ffHeard = false;
    this.stat.admin = false;
    this.onNote(by ? `this character was opened in another browser (${by}); this one has stopped` : 'this character was opened in another browser; this one has stopped');
  }

  // ---- what everything else asks --------------------------------------------------------------------

  /** Who decides: this browser alone (no server, an old relay, a dropped line) or the server. */
  get authority(): Authority {
    return this.stat.authority;
  }

  get mode(): SessionMode {
    return this.stat.mode;
  }

  /**
   * Whether damage between players is switched on where we are (off by default, and off with no
   * server). It is the one the console reads as well: the flag is written only where the server takes
   * this browser and cleared wherever it lets it go, so `debug().friendlyFire` and this cannot disagree.
   */
  get friendlyFire(): boolean {
    return this.stat.friendlyFire;
  }

  /**
   * Whether this player may stand creatures in the world: the server's word and nobody else's, and
   * false everywhere there is no server to say it -- playing alone, against the relay that came
   * before, or on a line that has dropped. It is read where a panel asks whether to offer the
   * button; the server is what refuses the word itself, so nothing rests on this being right.
   */
  get isAdmin(): boolean {
    return this.stat.authority === 'server' && this.stat.admin;
  }

  /** A tie waiting on the player, or null. */
  get ask(): { character: string; browser: CharacterSummary; server: CharacterSummary } | null {
    return this.stat.ask;
  }

  /** What the session is doing, in the object it always answers with. */
  debug(): SessionStats {
    return this.stat;
  }
}
