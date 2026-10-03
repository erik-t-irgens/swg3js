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
// sends `npcState`, `npcGone`, `npcHit`, `npcDrop` and `npcBlow`; it is sent `npcState`, `npcGone`,
// `npcHurt` and `npcBlow` -- the words in `NPC_WORDS`, which the socket has to hand over for any of
// this to happen at all.
//
// And a third rule, which is the seen creatures': **a body this browser stands for itself from the
// same data as everybody is shared by saying so** (`addSeen`), and never by being told to stand it.
// The lairs, the nests and the people at their posts stand in every browser from the same seed; what
// crosses is that this browser has one, and from then on it is kept by one browser like any other.
// What is never shared is one nobody may strike (it needs no keeper) and one that is this browser's
// alone whatever it is (`neverShared`: a follower, and later a story's own people).
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

import { PLAYER_KEY, type Living } from '../combat/kit.ts';
import type { Authority } from './session.ts';
import { seenId } from './owned.ts';
import { COMBAT_TUNE } from './combatNet.ts';

export { seenId };

/**
 * Whether a body stood under a world name goes on the wire as one of the server's own records.
 *
 * Only a body stood from one of the server's own records does (`standRecord` asks for it). Everything
 * else with a world name -- a lair's creature (`wild:`), a person standing about (`stood:`), a ticket
 * collector (`travel:`) -- is seeded here, stands the same in every browser from the same data, and is
 * a name the server has never heard. Handed to this module as one of the server's, one was marked
 * driven the moment a server answered, because nobody had been granted it, and so every one of them
 * stood frozen and could not be hurt for as long as the line was up. So that sharing is asked for,
 * never assumed; the seeded kind is shared another way, by saying it has been seen (`sharesSeen`).
 */
export function sharesOnWire(worldId: string | undefined, share: boolean | undefined): boolean {
  return !!worldId && share === true;
}

/**
 * The seam for a body that is this browser's alone whatever it is and whoever is near: today a
 * follower, which walks with this browser's player and fights at their side; later the named people of
 * a story and a player's companions, which the `companion` flag is the place for. Such a body is never
 * put on the wire, and one already on it leaves (`NpcNet.leave`) the moment it becomes one.
 */
export interface NeverShared {
  readonly follow?: unknown;
  readonly companion?: boolean;
}

export function neverShared(b: NeverShared | null | undefined): boolean {
  return !!b && (b.follow != null || b.companion === true);
}

/**
 * Whether a body may pick a fight with that living thing: anything at all, except another player's figure
 * (`isPeer`), which only a body this browser keeps on the wire may go after (`NpcNet.keepsHere`). Such a
 * body's blow on a peer is the keeper's word and crosses to their browser (`npcBlow`); anybody else's --
 * a body this browser alone holds, one stood off the wire, one told to keep to itself at a full world, a
 * follower -- goes nowhere, and a body that hunted a peer with it would chase a picture it can never
 * finish. Asked once per target per thought, never in a frame.
 */
export function mayFight(t: object, npcId: string, net: NpcNet | null = theCreatures): boolean {
  if (!(t as { readonly isPeer?: boolean }).isPeer) return true;
  return !!npcId && !!net && net.keepsHere(npcId);
}

/**
 * Whether a body this browser seeded for itself is shared by saying it has been seen.
 *
 * A lair's creature, a nest and a person at a post (`seenId`), and only while a server that speaks of
 * them is answering (`seeding`). Never one nobody may strike (`essential`): such a body is the same in
 * every browser whoever thinks for it -- it stands, it plays its mood, it never fights -- so it needs no
 * keeper and costs the wire nothing. That is the design's "unattackable ones stay local for ever".
 */
export function sharesSeen(worldId: string | undefined, essential: boolean, seeding: boolean): boolean {
  return seeding && !!worldId && seenId(worldId) && !essential;
}

/**
 * What a creature is fighting, as a word every browser reads the same way.
 *
 * A living key means nothing on another browser (each hands its own out), so a player crosses as
 * `p:` and the relay id of the browser that player is at -- this browser's own for its own player,
 * and the peer's for another player's figure -- and a creature as the id the world knows it by. It
 * was `'p'` alone, which the new keeper read as its **own** player: a creature fighting one player
 * turned on another the moment the second took it over.
 *
 * An empty word is nobody nameable: a relay id of nought, or a thing with no world name.
 */
export function targetWord(key: number, npcId: string, self: number, peerOf: (key: number) => number): string {
  if (key === PLAYER_KEY) return self > 0 ? `p:${self}` : '';
  const peer = peerOf(key);
  if (peer > 0) return `p:${peer}`;
  return npcId;
}

/** A player named on the wire: `p:` and a relay id. */
const PLAYER_WORD = /^p:(\d{1,9})$/;

/**
 * A target word back to what it names here: a living key (this browser's own player, or another
 * player's figure), or a creature's world id to be looked for. Null for a player this browser holds no
 * figure for, which is an ordinary answer -- the creature then picks its own fight.
 */
export function targetOf(word: string, self: number, keyOfPeer: (id: number) => number): { key: number } | { npc: string } | null {
  if (!word) return null;
  const m = PLAYER_WORD.exec(word);
  if (!m) return { npc: word };
  const id = Number(m[1]);
  if (id > 0 && id === self) return { key: PLAYER_KEY };
  const key = id > 0 ? keyOfPeer(id) : 0;
  return key > 0 ? { key } : null;
}

/** A mind copied into a kept object (made the first time), so nothing holds on to a row that is refilled. */
export function copyBrain(from: NpcBrain, into: NpcBrain | null): NpcBrain {
  const out = into ?? {};
  out.t = from.t;
  out.st = from.st;
  out.sl = from.sl;
  out.bd = from.bd;
  out.bs = from.bs;
  out.gx = from.gx;
  out.gz = from.gz;
  return out;
}

/**
 * The words this module answers. The socket (`src/net/net.ts`) hands a word over rather than reading
 * it, so this list and the one in its switch have to agree: a word missing there is a word this side
 * never hears, and every creature stands still with nothing to say why.
 */
export const NPC_WORDS = ['npcState', 'npcGone', 'npcHurt', 'npcBlow'] as const;

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
  /**
   * Invented: how long a seen body this browser holds may stand driven with nobody saying a word about
   * it before this browser says again that it has it. The first word can be lost -- over the server's
   * allowance, or said to a server that had just forgotten the record -- and a body nobody keeps is a
   * body frozen on every screen; saying it again costs one word and puts it right.
   */
  reseeSeconds: 10,
  /**
   * Invented: how long after asking about a body somebody else keeps and this browser has not stood
   * (a lair's creature its keeper sent out after this browser stood its own) it may ask again.
   */
  strangerEvery: 2,
  /**
   * Invented: how many of the shots the creatures this browser keeps fire may cross in a second, apart
   * from the player's own, so a big fight never crowds the player's shots off the wire nor takes the
   * line past what the server lets one browser send. Over it the rest of that second is not sent,
   * which loses pictures of bolts and never a blow: a blow is its own word.
   */
  npcShotsPerSecond: 8,
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
  if (typeof o.reseeSeconds === 'number') NPC_TUNE.reseeSeconds = Math.max(1, Math.min(600, o.reseeSeconds));
  if (typeof o.strangerEvery === 'number') NPC_TUNE.strangerEvery = Math.max(0.1, Math.min(600, o.strangerEvery));
  if (typeof o.npcShotsPerSecond === 'number') NPC_TUNE.npcShotsPerSecond = Math.max(0, Math.min(40, Math.round(o.npcShotsPerSecond)));
  return NPC_TUNE;
}

/**
 * Something that must be seen once rather than eased into: it was struck, it left the ground, it threw
 * itself aside in a roll, it jumped of its own accord, and its blade turned a bolt away. The place a roll
 * or a jump carries a body to is in the rows like any other place; the mark is which clip to play over
 * it, since a body eased along by four rows a second is otherwise a body sliding.
 *
 * A death is not one of them, and deliberately: it has a word of its own that the server carries to
 * everybody (the spawn list's `dead`, which reaches this module as `noteGone`), and a row is never
 * sent for a creature that is already dead. A mark nothing can produce is a rule nothing can reach.
 */
export type NpcMark = 'hit' | 'leap' | 'roll' | 'jump' | 'block';

/** Which way a roll or a jump went off the way the body faced: Jedi Academy's four. */
export type NpcDir = 'F' | 'B' | 'L' | 'R';

/** How low a body stands when it is not upright: the fighters' own three low postures. */
export type NpcLow = 'crouch' | 'kneel' | 'prone';

/** Why a creature is gone: it died, or it was taken away. */
export type NpcEnd = 'dead' | 'gone';

/**
 * A bolt's own flight, on a blow that was one: which way it was going, how fast, its colour and its
 * size. It is what the keeper's creature asks its blade about (`npcHurt`), and what a bolt flown back
 * off that blade is made to look like.
 */
export interface NpcBolt {
  dx: number;
  dy: number;
  dz: number;
  speed: number;
  color: number;
  size: number;
}

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
  /** A roll's or a jump's direction, and whether the jump was the Force's: what picks the clip. */
  fd?: NpcDir;
  ff?: 1;
  /** How low it stands, left out while it is upright. */
  po?: NpcLow;
  /** In cover: behind something, ducking and rising from it. Left out while it is not. */
  cv?: 1;
  /** What it is thinking, so a change of keeper does not start it over. */
  b?: NpcBrain;
}

/**
 * A creature's own mind, as much of it as crosses.
 *
 * **A target cannot cross as a key.** Every living thing's key is handed out by the browser it was
 * made in (`nextLivingKey`), so the number one browser calls a bantha is another browser's rock.
 * What does mean the same everywhere is the id the world knows a creature by and the relay id of the
 * browser a player is at, so a target crosses as `p:<relay id>` or as that creature's id and is
 * looked up on arrival (`targetWord`, `targetOf`). A bare `'p'` is what a browser built before that
 * sends, and it means the player at the keeper's browser, which is how it is read.
 *
 * The timers cross as the seconds they have left rather than as the moment they end, because the
 * two browsers' clocks are their own and a moment is meaningless between them.
 *
 * Everything here is optional and a browser built before it simply ignores the field, which is the
 * shape the rest of this protocol already has.
 */
export interface NpcBrain {
  /** What it is fighting: `p:<relay id>` for a player, else the id the world knows that creature by. */
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
  /**
   * A blow somebody else struck. Only ever called on the keeper's own copy: it is the only place a
   * number comes off. `bolt` is the bolt's own flight when the blow was one, which the keeper's own
   * blade is asked about before anything is taken off.
   */
  npcHurt(amount: number, x: number, y: number, z: number, source: Living | null, what: string, bolt?: NpcBolt | null): void;
  /** The keeper says it is gone. */
  npcEnd(why: NpcEnd): void;
  /**
   * Who struck it within `seconds` of now, by the living key each is known by here, written into `out`
   * (cleared first): what its death names so a later server can witness the kill. Optional: a body that
   * keeps no memory of blows names nobody.
   */
  npcStruckBy?(seconds: number, out: number[]): void;
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
  /** Of the bodies held, how many are seen ones (stood here from the same data as everywhere), and how many of those are kept here. */
  seen: number;
  seenKept: number;
  /** How many of the bodies held an admin stood, and how many of those are kept here. */
  stood: number;
  stoodKept: number;
  /** `seen` words said again for a body nobody had spoken about for a while. */
  reseen: number;
  /** Bodies somebody else keeps that this browser had not stood, asked to be stood (a lair's own sent out). */
  strangers: number;
  /** Blows this browser's creatures struck other players, and blows this player took from creatures kept elsewhere. */
  blowsSent: number;
  blowsTaken: number;
  /** Bolts turned away by a blade of a creature this browser keeps, on a blow somebody else asked for. */
  blocked: number;
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

const MARKS: readonly string[] = ['hit', 'leap', 'roll', 'jump', 'block'];
const DIRS: readonly string[] = ['F', 'B', 'L', 'R'];
const LOWS: readonly string[] = ['crouch', 'kneel', 'prone'];

/**
 * A row read off the wire into a kept object; false when it was not one. The place is read number
 * by number rather than through `point`, because this runs once per creature in every batch and a
 * batch comes four times a second: a triple made here would be rubbish made on a clock.
 *
 * Its mind is read into `brain`, which is kept beside the row and refilled, and hung on the row only
 * when there was one. It was never read at all until now: the keeper wrote it, the server passed it
 * on, and this dropped it on the floor, so a creature changing hands forgot everything on its mind.
 * `keeper` is the relay id the batch came from, which is what a bare `'p'` names.
 */
function readRow(raw: unknown, into: NpcRow, brain: NpcBrain, keeper: number): boolean {
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
  into.fd = (into.f === 'roll' || into.f === 'jump') && DIRS.includes(String(o.fd)) ? (o.fd as NpcDir) : undefined;
  into.ff = into.f === 'jump' && o.ff === 1 ? 1 : undefined;
  into.po = LOWS.includes(String(o.po)) ? (o.po as NpcLow) : undefined;
  into.cv = o.cv === 1 ? 1 : undefined;
  into.b = readBrain(o.b, brain, keeper) ? brain : undefined;
  return true;
}

/** A bolt's flight off the wire into a kept object, or false when the blow carried none (a blade, a bite). */
function readBolt(o: Record<string, unknown>, into: NpcBolt): boolean {
  const d = point(o.d);
  if (!d) return false;
  const len = Math.hypot(d[0], d[1], d[2]);
  if (!(len > 1e-6)) return false;
  into.dx = d[0] / len;
  into.dy = d[1] / len;
  into.dz = d[2] / len;
  into.speed = Math.max(0, num(o.s));
  into.color = Math.floor(Math.min(0xffffff, Math.max(0, num(o.c, 0xff4a2a))));
  into.size = Math.min(10, Math.max(0.1, num(o.z, 1)));
  return true;
}

/** A mind off the wire into a kept object; false when there was nothing on it worth keeping. */
function readBrain(raw: unknown, into: NpcBrain, keeper: number): boolean {
  into.t = undefined;
  into.st = undefined;
  into.sl = undefined;
  into.bd = undefined;
  into.bs = undefined;
  into.gx = undefined;
  into.gz = undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  let any = false;
  if (o.t === 'p') {
    // A browser built before a player was named by relay id: its player, whose browser sent this.
    if (keeper > 0) {
      into.t = `p:${keeper}`;
      any = true;
    }
  } else {
    const t = idOf(o.t);
    if (t) {
      into.t = t;
      any = true;
    }
  }
  const st = num(o.st);
  if (st > 0) {
    into.st = st;
    any = true;
  }
  const sl = num(o.sl);
  if (sl > 0) {
    into.sl = sl;
    any = true;
  }
  const bs = num(o.bs);
  if (bs > 0) {
    into.bs = bs;
    into.bd = Math.max(0, num(o.bd));
    any = true;
  }
  if (typeof o.gx === 'number' && typeof o.gz === 'number' && Number.isFinite(o.gx) && Number.isFinite(o.gz)) {
    into.gx = o.gx;
    into.gz = o.gz;
    any = true;
  }
  return any;
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
   * Say that one this browser was keeping has died. It is the keeper's word and nobody else's, and it
   * names who struck it in its last moments (`by`, the relay ids of the browsers whose players did,
   * within the players' own eight seconds), which is what a later server can witness a kill by.
   *
   * It is a hook rather than a message of its own because the world's spawn list already carries a
   * death (`src/net/owned.ts`, which holds what stands in a world and whether it is alive), and two
   * words for one death would be two paths for the same thing -- exactly what this wave is written
   * not to have. It answers true when something took the word; with nothing wired the module says
   * `npcGone` itself, which is what makes it whole on its own and testable without the spawn list.
   */
  died: (id: string, by: readonly number[]) => boolean = () => false;
  /**
   * Whether the world's own list says that one is dead. Asked beside this module's own memory, so a
   * death heard by the spawn list and a death heard here are one answer. With nothing wired only
   * what this module was told itself counts.
   */
  buried: (id: string) => boolean = () => false;
  /** Something the player should read (a creature refused, a keeper lost). */
  onNote: (text: string) => void = () => {};
  /**
   * The relay id this browser speaks as, which is what names its own player to everybody else; 0
   * while it has none. With nothing wired a player is nobody nameable and a hand-over carries no
   * player as a target, which is what it carried before any of this.
   */
  selfId: () => number = () => 0;
  /** Which peer, by relay id, a living key belongs to here (another player's figure); 0 for none. */
  peerOfKey: (key: number) => number = () => 0;
  /** The living key a peer's figure holds here, from their relay id; 0 when they have none. */
  keyOfPeer: (id: number) => number = () => 0;
  /**
   * Whether this browser shares what it stands for itself (`Owned.seeding`: a server answering that
   * speaks of the seen ones). With nothing wired, nothing seeded is ever shared.
   */
  seeding: () => boolean = () => false;
  /** Say a seen body has been stood here, where it is and how long it stays down once it dies (`Owned.saySeen`). */
  seen: (id: string, at: { x: number; y: number; z: number }, respawn: number) => void = () => {};
  /** Say a seen body has been put down here (`Owned.sayUnseen`). */
  unseen: (id: string) => void = () => {};
  /** Say one this browser keeps has walked off with its player (`Owned.sayTaken`). */
  taken: (id: string) => void = () => {};
  /**
   * Somebody else keeps a body under this name and this browser has none: a lair's creature its keeper
   * sent out after this browser stood its own, say. The wiring stands it where it can (the lairs know
   * their own names), and the rows parked for it put it where it really is. Asked at most once every
   * `strangerEvery` seconds about one name.
   */
  onStranger: (id: string) => void = () => {};
  /**
   * A creature somebody else keeps struck this player, there, for that much, and the body here that is
   * that creature (null when this browser has none). It is the one place this browser takes a creature's
   * blow off its own player that it did not see land itself: the keeper saw it, the keeper is right.
   */
  onBlow: (amount: number, x: number, y: number, z: number, from: NpcSubject | null, what: string) => void = () => {};
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
  /**
   * The seen ones that died, and until when in this file's own seconds: a seen name stands again in
   * every browser once its row's respawn is out, so its death is held exactly that long and no longer.
   * Until the server says how long, one decided here is held for a minute.
   */
  private readonly downUntil = new Map<string, number>();
  /** Which ones have been said to be gone from here, so one death is one message. */
  private readonly saidGone = new Set<string>();
  /** The seen bodies held here, by id: when each was last said, and how long it stays down once it dies. */
  private readonly seenAt = new Map<string, { at: number; r: number }>();
  /** When each name nobody here has a body for was last asked about (`onStranger`). */
  private readonly strangerAt = new Map<string, number>();
  /** The second the creatures' own shots are counted in, and how many have crossed in it. */
  private npcShotWindow = 0;
  private npcShotCount = 0;
  /** One row a position is read into for a word that is not a batch (a `seen` said again), and a bolt off the wire. */
  private readonly asked: NpcRow = blankRow();
  private readonly heardBolt: NpcBolt = { dx: 0, dy: 0, dz: 1, speed: 0, color: 0xff4a2a, size: 1 };
  /** Who struck a dying creature, by key and then by relay id, refilled per death. */
  private readonly struckKeys: number[] = [];
  private readonly struckIds: number[] = [];
  /** The rows sent, filled in place; the list is kept and truncated, and the socket writes it before we are given the frame back. */
  private readonly pool: NpcRow[] = [];
  private readonly out: NpcRow[] = [];
  /** The one row a heard batch is read into, refilled per row, and the mind read beside it. */
  private readonly heardRow: NpcRow = blankRow();
  private readonly heardBrain: NpcBrain = {};
  /** `p:` and this browser's own relay id, made once per id rather than once per row in a batch. */
  private selfWord = '';
  private selfWordFor = 0;
  /** The same for other players, by relay id: a peer being fought is named four times a second. */
  private readonly peerWords = new Map<number, string>();
  private clock = 0;
  private readonly stat: NpcStats = { active: false, held: 0, kept: 0, driven: 0, sent: 0, rowsSent: 0, heard: 0, rowsHeard: 0, waiting: 0, refused: 0, asked: 0, applied: 0, deaths: 0, silent: 0, handedBack: 0, seen: 0, seenKept: 0, stood: 0, stoodKept: 0, reseen: 0, strangers: 0, blowsSent: 0, blowsTaken: 0, blocked: 0 };

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

  /**
   * Whether that creature is known to have died. Nothing may bring it back -- an admin's for good, and a
   * seen one until its own respawn is out, after which the same name stands again in every browser.
   */
  isDead(id: string): boolean {
    if (this.deaths.has(id)) return true;
    const until = this.downUntil.get(id);
    if (until !== undefined) {
      if (until > this.now()) return true;
      this.downUntil.delete(id);
    }
    try {
      return this.buried(id);
    } catch {
      return false;
    }
  }

  /** Whether this browser shares what it stands for itself just now; a hook that throws is no. */
  get seedingNow(): boolean {
    if (!this.active) return false;
    try {
      return this.seeding();
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
  noteGone(id: string, why: NpcEnd, back = 0): void {
    if (!this.noteDown(id, why, back)) return;
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

  /**
   * Everything `noteGone` remembers about a creature going, without ending the body here: what the
   * wiring uses for a body this browser has only just stood of one already down everywhere else (the
   * server's `fresh` answer), which is taken away quietly rather than made to play a death nobody here
   * saw. False for no id.
   */
  noteDown(id: string, why: NpcEnd, back = 0): boolean {
    if (!id) return false;
    if (why === 'dead') {
      // A seen one is down for its own respawn, which the server says; an admin's for good.
      if (seenId(id)) this.downUntil.set(id, this.now() + Math.max(1, back));
      else this.deaths.add(id);
      this.stat.deaths = this.deaths.size + this.downUntil.size;
    }
    // Said once, whoever said it, and for both kinds of going: this browser must not announce
    // something it was itself told about, and a body ended by the word below would otherwise be
    // found dead by the next batch and announced as though this browser had killed it.
    this.saidGone.add(id);
    this.waiting.delete(id);
    this.parkedAt.delete(id);
    this.granting.delete(id);
    this.stat.waiting = this.waiting.size;
    return true;
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
    // that id over outright: two entries in the list would be one creature spoken about twice. Quietly:
    // it is the same body's name changing hands here, and nothing about it is news to the server.
    this.remove(id, true);
    this.subjects.set(id, s);
    this.order.push(s);
    this.stat.held = this.order.length;
    // A seen name stood again once its respawn is out is a fresh life: its death, when it comes, is a
    // new one and is said, which the record of the last one would otherwise swallow.
    if (seenId(id) && !this.isDead(id)) this.saidGone.delete(id);
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

  /**
   * A body this browser stood for itself from the same data as everybody -- a lair's creature, a nest,
   * a person at a post -- put on the wire by saying it has been seen. It is held driven until the server
   * grants it here, which for a body nobody else has is a moment; `at` is where it stands, which is what
   * the server measures who is nearest from, and `respawn` how long it stays down once it dies, in
   * seconds, its own row's.
   */
  addSeen(s: NpcSubject, at: { x: number; y: number; z: number }, respawn: number): void {
    const id = s.npcId;
    if (!id || !seenId(id) || !this.seedingNow) return;
    this.add(s);
    this.seenAt.set(id, { at: this.now(), r: respawn });
    try {
      this.seen(id, at, respawn);
    } catch {
      // A hook that cannot take a word costs this body its share of the wire and nothing more: the
      // re-saying below tries again for a body nobody speaks about.
    }
  }

  /**
   * It has been taken out of the world here. Nothing is said about the creature: it is this browser's
   * body that went, not the creature. What is said, for a seen one still alive, is that this browser no
   * longer has a body for it, so the server hands it to somebody who has rather than to this browser.
   * `quiet` is a body handing its own name straight on to another (`add`).
   */
  remove(id: string, quiet = false): void {
    const s = this.subjects.get(id);
    if (!s) return;
    // A death decided here and not yet said (the body went before the next batch reached it) is said
    // now, while the body can still name who struck it: it is the one word nobody else can say for it.
    if (!quiet && s.npcDead && this.active) this.sayDeath(s, this.now());
    this.subjects.delete(id);
    const i = this.order.indexOf(s);
    if (i >= 0) this.order.splice(i, 1);
    this.drivenNow.delete(id);
    this.toldAt.delete(id);
    const said = this.seenAt.delete(id);
    this.stat.held = this.order.length;
    // **Asked of what is known, never of the body.** A body put down sets itself dead as it goes
    // (`Mobile.dispose`), so reading `npcDead` here once cost every lair creature and every person put
    // down this word: the server went on offering the creature to a browser with no body for it, every
    // other screen saw it freeze, and the grant came back as a refusal that kept this browser out of it
    // for two minutes. What says a seen one is not to be let go of is that its death has been said
    // (`saidGone`, also every word that ended it from elsewhere) or that it is down.
    if (quiet || !said || this.saidGone.has(id) || this.isDead(id)) return;
    try {
      this.unseen(id);
    } catch {
      // Nothing to be done: the server's own silence rule and the next keeper's grant put it right.
    }
  }

  /**
   * A death decided here, said once: held down a minute (a seen one) or for good (an admin's) until the
   * server's own word says otherwise, and handed to the world's list with whoever struck it, or said by
   * this module itself when nothing is wired to take it. Nothing for a death the world has already heard.
   */
  private sayDeath(s: NpcSubject, now: number): void {
    const id = s.npcId;
    if (this.saidGone.has(id)) return;
    this.saidGone.add(id);
    // A death the world has already heard is not said back: it reached this browser as the list's own
    // word or as `npcGone`, and answering it would be the second path for one death that this wave
    // exists not to have. What is left is a death decided here.
    if (this.isDead(id)) return;
    // A seen one is held down a minute until the server's own word says for how long its row's respawn
    // really is; an admin's for good.
    if (seenId(id)) this.downUntil.set(id, now + 60);
    else this.deaths.add(id);
    this.stat.deaths = this.deaths.size + this.downUntil.size;
    // The world's own spawn list carries a death where there is one; with nothing wired to take it,
    // this module says it itself so that the wire is whole on its own.
    if (!this.sayDied(id, this.strikersOf(s))) this.send({ t: 'npcGone', i: id, why: 'dead' });
  }

  /**
   * One this browser keeps leaves the wire for good while it stands: it has become a body that is this
   * browser's alone (`neverShared`: a follower). The server is told, as the keeper, that it is gone from
   * its post, so every other browser takes its copy down and a seen one's post stays empty for its row's
   * respawn; and it is held here as nothing anybody else knows about from now on. False for one that is
   * not on the wire, or that this browser does not keep -- which may not leave, since it is not its to
   * take.
   */
  leave(id: string): boolean {
    const s = this.subjects.get(id);
    if (!s || !this.mayLeave(id)) return false;
    this.subjects.delete(id);
    const i = this.order.indexOf(s);
    if (i >= 0) this.order.splice(i, 1);
    this.toldAt.delete(id);
    this.seenAt.delete(id);
    this.granting.delete(id);
    this.saidGone.add(id);
    this.stat.held = this.order.length;
    try {
      this.taken(id);
    } catch {
      // The word did not go: the others keep their copy until the server forgets it, which is a body
      // at its post that this browser no longer draws there. Nothing here can put that right.
    }
    return true;
  }

  /**
   * Whether one held here may leave the wire (`leave`), asked before anything is done about it so a
   * caller can refuse before it has changed anything of its own. It must be held here, kept here, and the
   * server must speak of a creature walking off (`taken`, wire 3): an older one would drop the word and
   * leave every other screen holding a frozen copy at its post that nobody keeps, so against one the
   * body stays on the wire and is not this browser's to walk off with.
   */
  mayLeave(id: string): boolean {
    return this.subjects.has(id) && this.active && this.seedingNow && !this.drivenNow.has(id) && this.keeps(id);
  }

  /** The creature this browser holds under that id, or null. */
  find(id: string): NpcSubject | null {
    return this.subjects.get(id) ?? null;
  }

  // ---- naming what a creature is fighting ----------------------------------------------------------

  /**
   * What a creature is fighting, as the word that crosses (`targetWord`). Asked once a batch for each
   * creature this browser keeps that has a target, so the players' words are made once and kept
   * rather than made again four times a second.
   */
  nameTarget(key: number, npcId: string): string {
    if (key === PLAYER_KEY) {
      const self = this.ask(this.selfId);
      if (self !== this.selfWordFor) {
        this.selfWordFor = self;
        this.selfWord = self > 0 ? `p:${self}` : '';
      }
      return this.selfWord;
    }
    let peer = 0;
    try {
      peer = who(this.peerOfKey(key));
    } catch {
      peer = 0;
    }
    if (peer > 0) {
      let word = this.peerWords.get(peer);
      if (!word) {
        word = `p:${peer}`;
        this.peerWords.set(peer, word);
      }
      return word;
    }
    return npcId;
  }

  /**
   * A word a keeper wrote, back to what it names here (`targetOf`): asked once, when this browser is
   * handed a creature, never in a frame.
   */
  readTarget(word: string): { key: number } | { npc: string } | null {
    return targetOf(word, this.ask(this.selfId), (id) => {
      try {
        return who(this.keyOfPeer(id));
      } catch {
        return 0;
      }
    });
  }

  /** A number out of one of the game's hooks: one that throws, or answers nonsense, is nobody. */
  private ask(hook: () => number): number {
    try {
      return who(hook());
    } catch {
      return 0;
    }
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
    this.reseen();
  }

  /**
   * A seen body this browser holds that nobody keeps and nobody speaks about: say again that it has
   * it. The first word can be lost -- over the server's allowance, or said to a server that had just
   * forgotten the name -- and a body nobody keeps stands frozen on every screen. One word every
   * `reseeSeconds` per such body, and none at all for a body somebody is speaking about.
   */
  private reseen(): void {
    if (!this.seenAt.size || !this.seedingNow) return;
    const now = this.now();
    for (const [id, rec] of this.seenAt) {
      if (now - rec.at < NPC_TUNE.reseeSeconds || !this.drivenNow.has(id)) continue;
      const told = this.toldAt.get(id);
      if (told !== undefined && now - told < NPC_TUNE.reseeSeconds) continue;
      const s = this.subjects.get(id);
      if (!s || s.npcDead || !s.npcFill(this.asked)) continue;
      rec.at = now;
      this.stat.reseen++;
      try {
        this.seen(id, { x: this.asked.p[0], y: this.asked.p[1], z: this.asked.p[2] }, rec.r);
      } catch {
        // Tried again on the next round.
      }
    }
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
      // A seen body of this browser's own that is still being built (a dressed person's look takes a
      // while): put down rather than refused. Refused, the server would offer it here again only after two
      // minutes, and with nobody else near it would stand frozen all that while; put down, it goes at once
      // to anybody else with a body, and this browser says it has one again once the body can speak
      // (`reseen`, which waits for exactly that).
      const seen = this.seenAt.get(id);
      if (seen && this.subjects.has(id)) {
        seen.at = now;
        try {
          this.unseen(id);
        } catch {
          // The server's own silence rule puts it right.
        }
        continue;
      }
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
        // Its death is the one thing everybody must hear, and it is said once (`sayDeath`). The body
        // itself is still drawn here while its own clip plays out; nothing more is said about it.
        this.sayDeath(s, now);
        continue;
      }
      if (this.drivenNow.has(id)) continue;
      let row = this.pool[this.out.length];
      if (!row) {
        row = blankRow();
        this.pool.push(row);
      }
      row.i = id;
      // Everything a pooled row may have carried for the last body it held, cleared: a body that is
      // upright, out of cover and did nothing worth a mark says none of it.
      row.f = undefined;
      row.fd = undefined;
      row.ff = undefined;
      row.po = undefined;
      row.cv = undefined;
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
  askHit(id: string, amount: number, x: number, y: number, z: number, what = '', byPlayer = false, bolt: NpcBolt | null = null): boolean {
    if (!this.active || !id || !(amount > 0)) return false;
    // Nobody is asked to kill something twice: the blow is refused here, and refusing it is still
    // "the keeper decides", because the keeper is where that death was decided.
    if (this.isDead(id)) return true;
    this.stat.asked++;
    const msg: Record<string, unknown> = { t: 'npcHit', i: id, a: r2(amount), at: [r2(x), r2(y), r2(z)] };
    if (what) msg.w = what.slice(0, 16);
    if (byPlayer) msg.b = 1;
    // A bolt's own flight, so the keeper's creature may turn it away with its blade rather than take it:
    // only to a server that speaks of it, since one that does not passes the blow on without it and the
    // bytes would buy nothing.
    if (bolt && this.seedingNow) {
      msg.d = [r3(bolt.dx), r3(bolt.dy), r3(bolt.dz)];
      msg.s = r2(bolt.speed);
      msg.c = Math.floor(bolt.color);
      msg.z = r2(bolt.size);
    }
    this.send(msg);
    return true;
  }

  /**
   * A creature this browser keeps struck another player, there, for that much: said to that player's
   * browser, which is the only place it comes off -- the players' own rule, with this browser where the
   * shooter stands. True when it went; false with no server that speaks of it, or for a creature this
   * browser does not keep, which is not this browser's to strike with.
   */
  sayBlow(to: number, id: string, amount: number, x: number, y: number, z: number, what = ''): boolean {
    if (!this.seedingNow || !(to > 0) || !id || !(amount > 0)) return false;
    if (this.drivenNow.has(id) || !this.subjects.has(id)) return false;
    this.stat.blowsSent++;
    this.send({ t: 'npcBlow', to, i: id, a: r2(amount), at: [r2(x), r2(y), r2(z)], ...(what ? { w: what.slice(0, 16) } : {}) });
    return true;
  }

  /**
   * Whether one of the creatures this browser keeps may put another of its shots on the wire this
   * second, under its own allowance (`npcShotsPerSecond`), apart from the player's own. Asked by the
   * shots when a creature fires; nothing here sends the shot itself.
   */
  npcShotDue(): boolean {
    if (!this.seedingNow) return false;
    const second = Math.floor(this.now());
    if (second !== this.npcShotWindow) {
      this.npcShotWindow = second;
      this.npcShotCount = 0;
    }
    if (this.npcShotCount >= NPC_TUNE.npcShotsPerSecond) return false;
    this.npcShotCount++;
    return true;
  }

  /** Whether that body is on the wire and kept here: one whose shots, blows and death are this browser's to say. */
  keepsHere(id: string): boolean {
    return !!id && this.active && this.subjects.has(id) && !this.drivenNow.has(id) && this.keeps(id);
  }

  /**
   * The relay ids of the players who struck a dying creature within the players' own eight seconds
   * (`COMBAT_TUNE.blameSeconds`): this browser's own for its own player, a peer's for theirs. Nobody else
   * -- another creature, a fighter, a turret -- is anybody a server could credit with a kill.
   */
  private strikersOf(s: NpcSubject): number[] {
    const ids = this.struckIds;
    ids.length = 0;
    if (!s.npcStruckBy) return ids;
    try {
      s.npcStruckBy(COMBAT_TUNE.blameSeconds, this.struckKeys);
    } catch {
      return ids;
    }
    for (const key of this.struckKeys) {
      const id = key === PLAYER_KEY ? this.ask(this.selfId) : this.ask(() => this.peerOfKey(key));
      if (id > 0 && !ids.includes(id)) ids.push(id);
    }
    return ids;
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
        // The bolt's own flight, when the blow was one: the creature's blade is asked about it before
        // anything is taken off, which is the keeper answering the block for everybody.
        const bolt = readBolt(msg, this.heardBolt) ? this.heardBolt : null;
        s.npcHurt(a, at[0], at[1], at[2], from ? this.safeAttacker(from) : null, typeof msg.w === 'string' ? msg.w.slice(0, 16) : '', bolt);
        return true;
      }
      case 'npcBlow': {
        // A creature kept at another browser struck this player. The keeper saw it land, so it landed:
        // this browser takes it off its own player, as it would a shot another player says landed. The
        // body here that is that creature names where it came from and who to turn on, when there is one.
        const a = num(msg.a);
        if (!(a > 0)) return true;
        const at = point(msg.at) ?? [0, 0, 0];
        const id = idOf(msg.i);
        this.stat.blowsTaken++;
        try {
          this.onBlow(a, at[0], at[1], at[2], id ? (this.subjects.get(id) ?? null) : null, typeof msg.w === 'string' ? msg.w.slice(0, 16) : '');
        } catch {
          // A game that cannot take the blow just now (between worlds, at the select screen) drops it.
        }
        return true;
      }
      default:
        return false;
    }
  }

  /** A body this browser keeps turned a bolt away with its blade on a blow somebody else asked for: counted for the console. */
  noteBlocked(): void {
    this.stat.blocked++;
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
  private sayDied(id: string, by: readonly number[]): boolean {
    try {
      return this.died(id, by);
    } catch {
      return false;
    }
  }

  private heardBatch(msg: Record<string, unknown>): void {
    const rows = msg.r;
    if (!Array.isArray(rows)) return;
    this.stat.heard++;
    const now = this.now();
    // Who kept these: the relay stamps every batch with the browser it came from, which is what a
    // bare `'p'` from an older browser names.
    const keeper = who(msg.id);
    let n = 0;
    for (const raw of rows) {
      if (n >= 64) break;
      if (!readRow(raw, this.heardRow, this.heardBrain, keeper)) continue;
      n++;
      const id = this.heardRow.i;
      // Dead is dead: a late batch from the keeper that had it, or the world's own list of places
      // handed over on arriving, must never stand a creature back up.
      if (this.isDead(id)) continue;
      const s = this.subjects.get(id);
      if (!s) {
        this.park(id);
        this.stranger(id, now);
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
    // How low it stands and whether it is in cover are what it is doing, and a body stood from this row
    // stands that way.
    row.po = from.po;
    row.cv = from.cv;
    // A mark is a thing that happened once, and a body that does not exist yet cannot have seen it.
    row.f = undefined;
    row.fd = undefined;
    row.ff = undefined;
    // Its mind is kept in a copy of its own, made once for this row: the one it was read into is
    // refilled by the very next row of the batch.
    row.b = from.b ? copyBrain(from.b, row.b ?? null) : undefined;
    this.stat.waiting = this.waiting.size;
  }

  /**
   * A name somebody else keeps and this browser holds no body for: asked about once every
   * `strangerEvery` seconds, so the wiring can stand it where it knows the name (a lair's creature its
   * keeper sent out after this browser stood its own). Only the seen kind: an admin's is stood from the
   * list, and one this browser could not build is the grant's business, not this.
   */
  private stranger(id: string, now: number): void {
    if (!seenId(id) || !this.seedingNow) return;
    const was = this.strangerAt.get(id);
    if (was !== undefined && now - was < NPC_TUNE.strangerEvery) return;
    this.strangerAt.set(id, now);
    this.stat.strangers++;
    try {
      this.onStranger(id);
    } catch {
      // A wiring that cannot stand it leaves the row parked, which ages out on its own.
    }
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
    this.strangerAt.clear();
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
    this.downUntil.clear();
    this.saidGone.clear();
    this.seenAt.clear();
    this.strangerAt.clear();
    this.pass = 0;
    this.notedAt = -Infinity;
    this.cursor = 0;
    this.clock = 0;
    this.peerWords.clear();
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
    this.stat.deaths = this.deaths.size + this.downUntil.size;
    const now = this.now();
    let silent = 0;
    for (const id of this.drivenNow) {
      const at = this.toldAt.get(id);
      if (at === undefined || now - at > NPC_TUNE.silentSeconds) silent++;
    }
    this.stat.silent = silent;
    // What an admin stood against what every browser stands for itself, each with how many are kept here.
    let seen = 0;
    let seenKept = 0;
    for (const s of this.order) {
      if (!seenId(s.npcId)) continue;
      seen++;
      if (!this.drivenNow.has(s.npcId)) seenKept++;
    }
    this.stat.seen = seen;
    this.stat.seenKept = seenKept;
    this.stat.stood = this.order.length - seen;
    this.stat.stoodKept = this.stat.kept - seenKept;
    return this.stat;
  }

  /** The ids this browser thinks for and the ids it is told about, for the console. */
  rows(): Record<string, unknown> {
    const kept: string[] = [];
    const driven: string[] = [];
    for (const s of this.order) (this.drivenNow.has(s.npcId) ? driven : kept).push(s.npcId);
    return { ...this.debug(), seeding: this.seedingNow, keptIds: kept, drivenIds: driven, tune: { ...NPC_TUNE } };
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
