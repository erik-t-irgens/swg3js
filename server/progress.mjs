// Every character's progress, held by the server: the one copy that stands while a browser plays here, and the
// only host that pays into it.
//
// **One rule book, two hosts.** What a record is and how it changes is `src/progress/record.ts`; what a fight, a
// roll, a node learnt or given back and a quest's bonus pay is `payout.ts` and `learn.ts`. This file imports them
// as they are, under node's own type stripping, exactly as the story's host imports its rules, and the browser
// runs the very same files when it holds the record itself. So a batch is worked out by one set of rules wherever
// it is worked out, and a record the server writes down is one the browser reads back without a second opinion.
// What is here is only what the server does with that: whose record it is, when to ask a browser for its copy and
// when to hand it the server's, what it believes of what a browser says happened, and writing every batch down
// before anybody is told. No number of a rule lives here beyond the server's own copy of the rules.
//
// **Settling, like the rest of the character.** A browser that has just claimed says what its copy holds (`sync`).
// With no record of the server's own, a browser that has one is asked for it (`want`) -- the first copy handed up
// is the one written down, and trusted, as the ledger takes a backpack and the story a book -- and one that has
// none is given a new, empty record. With a record of the server's own, the browser's is asked for only when the
// character itself settled the browser's way (`c.keep`, kept on the line by the relay) and the browser made
// batches with nobody holding it; otherwise the server's stands and is handed down. A record taken is never merged
// with the one it replaces: the old one goes to the archive whole. An empty record from a browser that believes a
// server held this character before, and that counts no batch of its own, is a cleared cache and never written
// over anything. Nothing is settled while the character itself is still a question put to the player.
//
// **What the server believes.** A claim says what was fought, at what level, how it ended and which of the
// player's skills it used, and never an amount: the amount is the rules' arithmetic, worked out here. The numbers
// a claim does carry -- levels, healths left, the Difficulty scale -- are clamped, and a wrong one can only cost the
// claimant (the scale pays at most as one) or is bounded by the buckets. A member the claim calls dead counts only
// when the server believes it died: one of the world's shared bodies on the server's own word of its death (`death`,
// the keeper's report the relay already hears), on the line's own world, once to a character and only while the
// body stays down (a seeded body comes back under the name it died under, and a death from its last life stands
// for nothing in its next); anything else against the character's own `localKillsPerMinute`. And because a
// claimant that keeps a body sends its death and its claim by two paths nothing orders, **a claim that names a
// shared member dead before the server has heard that death is parked**: run the moment the last such word
// arrives, or after `claimPark` with what has been heard by then. The XP buckets are kept by character for the
// life of the server, so a line that reconnects finds its character's bucket as it left it.
//
// **Everything paid once.** A claim's id, a task's, a quest bonus's key go into the record first in the batch that
// pays them, so a resend, a reload or a second host finds them and pays nothing. Every batch made here is made
// under this server's own limits (`PROGRESS_LIMITS` as `--set progress.limits.<name>` moved them), its trims written
// into it as changes, and is applied -- here, at the log's replay, and in the browser -- under the fixed backstop,
// so the copies stay one whatever either side's limits. A record is read back the same way -- from this server's
// file, by the browser it is handed to, out of that browser's storage -- under the rules' own backstop as well
// (`PROGRESS_RULE_BACKSTOP`), so a cap this run moved up is never cut on the next start or in the browser's copy.
// A batch that would take the record past `recMax` characters is refused whole. Nothing about a character's
// progress is said to anybody but the line that holds it.
//
// **The quest bonus.** The story's host pays a quest's experience as a bonus order (`PayOrder.bonus`); its `pay`
// hands it here. With the character's progress settled on this line it is paid at once, keyed by the story's own
// key; settled nowhere yet (a job finished in the moment between the claim and the progress `sync`), it is owed,
// written down, and paid once when that character's progress settles. A restart keeps what is owed.
//
// How it is used: nothing in here touches a socket. The relay hands in the line (its id, its character, how that
// character was settled) and every decision answers `{ ok, why, tell }`, where `tell` is a list of `{ to:
// <connection>, msg }` for the relay to send, as the purse, the story and the ledger do. Writing is one callback
// handed in, which must apply the record as well as keep it (the store's `change` does both), because the records
// this reads are the store's own. The clocks, the purse, the game's challenge table, who is the admin, which bodies
// the world shares and which world a line stands on are all handed in, so the tests run every rule here without a
// relay. Every number below is ours, in `PROGRESS_TUNING`, printed on the status page and moved for a run with
// `--set progress.<name>=n`, the rules with `--set progress.rules.<name>=n` and the limits with
// `--set progress.limits.<name>=n` (never past the backstop, which nothing moves).
//
// Imports nothing but node's built-ins and `src/progress/`.

import { nodeById } from '../src/progress/disciplines.ts';
import { grantChanges, learnChanges, questBonus, resetChanges, surrenderChanges, xpChanges } from '../src/progress/learn.ts';
import { XpBuckets, payClaim, payTask } from '../src/progress/payout.ts';
import { FORBIDDEN_KEYS, PROGRESS_VERSION, RECORD_MAX, applyProgress, cleanRecord, copyRecord, emptyRecord, isCharacterId, recordIsEmpty, recordSummary, recordText, secondsOf } from '../src/progress/record.ts';
import { PROGRESS_BACKSTOP, PROGRESS_LIMITS, PROGRESS_RULE_BACKSTOP, copyRules, moveLimits, moveRules } from '../src/progress/tune.ts';
import { PROGRESS_WIRE_VERSION, Reassembly, cleanProgressUp } from '../src/progress/wire.ts';

export { PROGRESS_WIRE_VERSION };

/** Every number this file invents, and the server's own copies of the rules and the limits. None of them is from the game. */
export const PROGRESS_TUNING = {
  /** Progress words one browser may send in a second, all kinds together (the purse's own window). */
  wordRate: 6,
  /** Claims and tasks one browser may send in a second. One over it is dropped in silence and asked again by the browser. */
  claimRate: 2,
  /** Milliseconds the server's word of a shared body's death is kept for the claims that name it, at the most. */
  deathKeep: 600000,
  /**
   * The least it stands for them, however soon the body comes back: room for the claim of the fight it ended to
   * arrive behind it (a queue of claims a gap apart, a resend after the browser's wait). Past the body's own
   * respawn, and this, a claim naming it dead is about a later death.
   */
  deathFloor: 60000,
  /** The most deaths kept at once, the oldest let go first. */
  deathsMax: 4000,
  /** Dead members nobody shares that one character's claims may name in a minute (the story's own figure for kills). */
  localKillsPerMinute: 60,
  /** Milliseconds a claim naming a shared body dead waits for the server's word of that death before it is paid on what was heard. */
  claimPark: 3000,
  /** The highest level a claim's member may have, and the most members a claim may name. */
  levelMax: 400,
  membersMax: 24,
  /** The longest record this server takes or writes, in characters (the record's own limit). */
  recMax: RECORD_MAX,
  /** The most pieces a record handed up may come in, and the longest wait between two of them, in milliseconds. */
  offerPieces: 4,
  offerWait: 10000,
  /** How many records a character's archive keeps: the copies a taken record replaced, newest last. */
  archive: 3,
  /** The rules this server pays by: its own copy, which `--set progress.rules.<name>=n` moves. */
  rules: copyRules(),
  /** The limits this server makes its batches under: its own copy, never past the backstop. */
  limits: { ...PROGRESS_LIMITS },
};

/**
 * One `--set progress.<name>=n`: a number of the tuning itself, a rule (`rules.<name>`, or `rules.<table>.<name>` in
 * a nested table), or a limit (`limits.<name>`, held under the backstop). Answers whether it was one.
 */
export function setProgressTuning(name, value, tuning = PROGRESS_TUNING) {
  if (typeof name !== 'string' || !Number.isFinite(value)) return false;
  const parts = name.split('.');
  if (parts.some((p) => FORBIDDEN_KEYS.includes(p))) return false;
  const isNumber = (o, k) => !!o && typeof o === 'object' && Object.hasOwn(o, k) && typeof o[k] === 'number';
  // Each moved by the rules' own ranges (`moveRules`), so a rule the run asks for past its range is held to it.
  if (parts[0] === 'rules' && parts.length === 2 && isNumber(tuning.rules, parts[1])) {
    moveRules(tuning.rules, { [parts[1]]: value });
    return true;
  }
  if (parts[0] === 'rules' && parts.length === 3 && parts[1] !== 'core' && isNumber(tuning.rules[parts[1]], parts[2])) {
    moveRules(tuning.rules, { [parts[1]]: { [parts[2]]: value } });
    return true;
  }
  if (parts[0] === 'rules' && parts.length === 4 && parts[1] === 'core' && isNumber(tuning.rules.core[parts[2]], parts[3])) {
    moveRules(tuning.rules, { core: { [parts[2]]: { [parts[3]]: value } } });
    return true;
  }
  if (parts[0] === 'limits' && parts.length === 2) {
    if (!Object.hasOwn(tuning.limits, parts[1])) return false;
    moveLimits(tuning.limits, { [parts[1]]: value });
    return true;
  }
  if (parts.length === 1 && Object.hasOwn(tuning, name) && typeof tuning[name] === 'number') {
    tuning[name] = value;
    return true;
  }
  return false;
}

/** Whether this browser may send another word of a kind this second. The window the purse and the story use. */
function mayWord(window, now, perSecond) {
  if (now - window.at >= 1000) {
    window.at = now;
    window.lines = 0;
  }
  window.lines++;
  return window.lines <= perSecond;
}

/** The key a bonus owed is kept under: the server's own, `p` and a number, never anything a browser chose. */
const OWED_KEY = /^p[1-9][0-9]{0,11}$/;
/** How many bonuses may be owed at once, over every character, so the table cannot grow without bound. Ours. */
const OWED_MAX = 1000;
/** A story reward's key, as the story's host writes them: printable and not too long. */
const STORY_KEY = /^[\x20-\x7e]{1,256}$/;

/** One bonus owed, as it is written down and read back, or null when it is not one. */
function cleanOwed(key, o) {
  if (typeof key !== 'string' || !OWED_KEY.test(key) || !o || typeof o !== 'object') return null;
  if (!isCharacterId(o.character) || typeof o.key !== 'string' || !STORY_KEY.test(o.key)) return null;
  const xp = Number(o.xp);
  const since = Number(o.since);
  const at = Number(o.at);
  if (!Number.isFinite(xp) || xp <= 0 || !Number.isFinite(since) || since < 0) return null;
  return { character: o.character, key: o.key, xp: Math.min(1e9, Math.round(xp)), since: Math.floor(since), at: Number.isFinite(at) && at > 0 ? Math.floor(at) : 0 };
}

/**
 * A record read back for the store: cleaned under the backstops, the rules' caps as well as the lists' (a record
 * this server wrote under a cap `--set` moved up must not be cut on its next start), or null. A record a newer
 * server wrote is kept as it was.
 */
function readRecord(id, raw) {
  if (!isCharacterId(id)) return null;
  const rec = cleanRecord(raw, PROGRESS_BACKSTOP, PROGRESS_RULE_BACKSTOP);
  if (rec && rec.char === id) return rec;
  return raw && typeof raw === 'object' && !Array.isArray(raw) && raw.v !== PROGRESS_VERSION ? raw : null;
}

/**
 * Apply one record about progress to the world in memory. The same function runs when the record is made and when
 * the log is replayed on start, so a replayed world and a live one cannot drift apart: a batch (`progress`) goes
 * through the very `applyProgress` the browser uses, under the backstop, since its trims are written into it; a
 * record taken whole (`progressRec`) and one put away (`progressArchive`) are cleaned again on the way in, under
 * the backstops and never this run's own limits or rules, which a replay on the next start may not share; a bonus
 * owed and struck off (`progressOwed`, `progressOwedGone`) are kept under the server's own key.
 */
export function applyProgressRec(data, rec) {
  if (!rec || typeof rec !== 'object') return false;
  if (rec.t === 'progressOwed') {
    const owed = cleanOwed(rec.key, rec.owed);
    if (!owed) return false;
    data.progressOwed ??= Object.create(null);
    data.progressOwed[rec.key] = owed;
    const next = Number(rec.key.slice(1)) + 1;
    if (!(Number(data.progressOwedSeq) >= next)) data.progressOwedSeq = next;
    return true;
  }
  if (rec.t === 'progressOwedGone') {
    if (typeof rec.key !== 'string' || !OWED_KEY.test(rec.key)) return false;
    if (data.progressOwed) delete data.progressOwed[rec.key];
    return true;
  }
  if (rec.t !== 'progressRec' && rec.t !== 'progress' && rec.t !== 'progressArchive') return false;
  if (!isCharacterId(rec.id)) return false;
  data.progress ??= Object.create(null);
  data.progressArchive ??= Object.create(null);
  if (rec.t === 'progress') {
    const held = data.progress[rec.id];
    if (!held || held.v !== PROGRESS_VERSION) return false;
    applyProgress(held, rec.ch, PROGRESS_BACKSTOP);
    return true;
  }
  const clean = cleanRecord(rec.rec, PROGRESS_BACKSTOP, PROGRESS_RULE_BACKSTOP);
  if (!clean || clean.char !== rec.id) return false;
  if (rec.t === 'progressRec') {
    data.progress[rec.id] = clean;
    return true;
  }
  const list = Array.isArray(data.progressArchive[rec.id]) ? data.progressArchive[rec.id] : [];
  list.push(clean);
  while (list.length > Math.max(1, Math.floor(Number(PROGRESS_TUNING.archive)) || 1)) list.shift();
  data.progressArchive[rec.id] = list;
  return true;
}

/**
 * The records of a world just read back from its file, rebuilt as the rules expect them: every table with no
 * prototype, every record through the same cleaner one handed up goes through, held only to the backstops (a server
 * run with limits or caps of its own, then started without them, must never cut what it wrote down), the archive capped and
 * the bonuses owed only as they read, the counter carried past every key still there. Runs before the log is played
 * back and again when the host takes the world, so whichever reads it first, nothing reads it raw.
 */
export function readProgress(data) {
  const recs = Object.create(null);
  for (const id of Object.keys(data.progress ?? {})) {
    const r = readRecord(id, data.progress[id]);
    if (r) recs[id] = r;
  }
  const archive = Object.create(null);
  for (const id of Object.keys(data.progressArchive ?? {})) {
    if (!isCharacterId(id)) continue;
    const list = data.progressArchive[id];
    if (!Array.isArray(list)) continue;
    const kept = list.map((r) => cleanRecord(r, PROGRESS_BACKSTOP, PROGRESS_RULE_BACKSTOP)).filter((r) => r && r.char === id);
    archive[id] = kept.slice(-Math.max(1, Math.floor(Number(PROGRESS_TUNING.archive)) || 1));
  }
  const owed = Object.create(null);
  let seq = Number(data.progressOwedSeq) >= 1 ? Math.floor(Number(data.progressOwedSeq)) : 1;
  for (const key of Object.keys(data.progressOwed ?? {})) {
    const o = cleanOwed(key, data.progressOwed[key]);
    if (!o) continue;
    owed[key] = o;
    seq = Math.max(seq, Number(key.slice(1)) + 1);
  }
  data.progress = recs;
  data.progressArchive = archive;
  data.progressOwed = owed;
  data.progressOwedSeq = seq;
  return data;
}

export class Progress {
  /**
   * @param {{
   *   tuning?: typeof PROGRESS_TUNING,
   *   write?: (rec: object) => void,
   *   now?: () => number,
   *   wall?: () => number,
   *   purses?: { spend(character: string, n: number, session: number, what?: string): { ok: boolean, why?: string, tell: object[] } } | null,
   *   levels?: () => { rows: number[][] } | null,
   *   levelsState?: string,
   *   admin?: (c: object) => boolean,
   *   shared?: (id: string) => boolean,
   *   worldOf?: (c: object) => string,
   * }} options the numbers to work to; where a record goes to be applied and kept; the shared clock a record's
   * times are written in and the wall clock the windows and the park run on; the purse a fee is taken through; the
   * game's challenge table and what became of it; who is the admin; which of the world's bodies the server shares;
   * and which world a line is standing on.
   */
  constructor({ tuning = PROGRESS_TUNING, write = () => {}, now = () => Date.now(), wall = () => Date.now(), purses = null, levels = () => null, levelsState = 'absent', admin = () => false, shared = () => false, worldOf = () => '' } = {}) {
    this.tuning = tuning;
    this.write = write;
    this.now = now;
    this.wall = wall;
    this.purses = purses;
    this.levels = levels;
    this.levelsState = levelsState;
    this.isAdmin = admin;
    this.shared = shared;
    this.worldOf = worldOf;
    this.data = { progress: Object.create(null), progressArchive: Object.create(null), progressOwed: Object.create(null), progressOwedSeq: 1 };
    /** The XP buckets, by character, for the life of the server: a reconnect does not fill them again. */
    this.buckets = new XpBuckets();
    /** @type {Map<number, string>} a line asked for its record, and whose record it is */
    this.wanting = new Map();
    /** @type {Map<number, Reassembly>} a record coming up, by line */
    this.offers = new Map();
    /** @type {Map<number, { word: { at: number, lines: number }, claim: { at: number, lines: number } }>} each line's allowances */
    this.windows = new Map();
    /** @type {Map<number, { character: string, ready: boolean }>} each line whose character's progress is settled here */
    this.lines = new Map();
    /**
     * @type {Map<string, { at: number, until: number, world: string, credited: Set<string> }>} the world's shared
     * bodies' deaths, oldest first: when each was heard, until when it stands (the body down, at most `deathKeep`),
     * the world it died on and the characters it has been credited to
     */
    this.deaths = new Map();
    /** @type {Map<string, { session: number, character: string, claim: object, world: string, at: number, waiting: Set<string> }>} claims waiting on a death, by claim id */
    this.parked = new Map();
    /** @type {Map<string, number[]>} when each character's dead members nobody shares were taken, the last minute's */
    this.localKills = new Map();
    this.stats = { syncs: 0, taken: 0, guarded: 0, refused: 0, claims: 0, paid: 0, unpaid: 0, parked: 0, parkedPaid: 0, parkedLate: 0, tasks: 0, learnt: 0, given: 0, bonuses: 0, owed: 0, owedPaid: 0, admin: 0, batches: 0, tooLong: 0, rate: 0, lastWhy: '' };
    /** The last batch written, for the status page: whose, at what revision, and what kind. */
    this.last = null;
  }

  /** Take the world the store read back, its records rebuilt as the rules expect them. They are its own, read and written in place. */
  load(data) {
    readProgress(data);
    this.data = data;
    return this;
  }

  /** What the hail says of the progress this server holds. */
  hail() {
    return PROGRESS_WIRE_VERSION;
  }

  get rules() {
    return this.tuning.rules;
  }

  get limits() {
    return this.tuning.limits;
  }

  /** A character's record as this server can work with it, or null (none, or one a newer server wrote). */
  recordOf(character) {
    const r = character ? this.data.progress[character] : null;
    return r && r.v === PROGRESS_VERSION ? r : null;
  }

  windowsOf(session) {
    let w = this.windows.get(session);
    if (!w) {
      w = { word: { at: 0, lines: 0 }, claim: { at: 0, lines: 0 } };
      this.windows.set(session, w);
    }
    return w;
  }

  no(session, why, of = '') {
    this.stats.refused++;
    this.stats.lastWhy = why;
    return { ok: false, why, tell: [{ to: session, msg: of ? { t: 'progress', do: 'no', why, of } : { t: 'progress', do: 'no', why } }] };
  }

  /** The line whose character's progress is settled here, for a session, or null. */
  readyLine(c) {
    const line = this.lines.get(c.id);
    return line && line.ready && line.character === c.character ? line : null;
  }

  /**
   * One word from a line, already past the relay's character guard: cleaned here, held to the allowance, and handed
   * to what answers it. `c` is the line: `{ id, character, keep, asking, player }`, `asking` set while a tie between
   * two copies of the character is still waiting on the player.
   */
  hear(c, msg) {
    const word = cleanProgressUp(msg, { membersMax: this.tuning.membersMax, levelMax: this.tuning.levelMax });
    if (!word || !c?.character) return { ok: false, why: 'not a progress word', tell: [] };
    if (!mayWord(this.windowsOf(c.id).word, this.wall(), this.tuning.wordRate)) {
      this.stats.rate++;
      // What would change a record because the player asked is refused in words; anything else the browser asks again itself.
      if (word.do === 'learn' || word.do === 'surrender' || word.do === 'grant' || word.do === 'xp' || word.do === 'reset') return this.no(c.id, 'too many progress words at once: wait a moment');
      return { ok: false, why: 'too often', tell: [] };
    }
    switch (word.do) {
      case 'sync':
        return this.sync(c, word);
      case 'offer':
        return this.offer(c, word);
      case 'claim':
      case 'task':
        return this.claimOrTask(c, word);
      case 'learn':
        return this.learn(c, word);
      case 'surrender':
        return this.surrender(c, word);
      default:
        return this.adminOp(c, word);
    }
  }

  // ---- settling ---------------------------------------------------------------------------------------------

  /**
   * What a browser holds, and the server's answer: its own record, a new one, or a request for the browser's. Not
   * while the character itself is still a question put to the player (`c.asking`, and `c.keep` still `ask`): the
   * answer is read off how the character settled, and a `sync` ahead of the answer would settle the record the
   * server's way before the player had said which copy stands. A browser asks again once it is answered.
   */
  sync(c, word) {
    if (c.asking || c.keep === 'ask') return { ok: false, why: 'the character is still being settled', tell: [] };
    this.stats.syncs++;
    this.offers.delete(c.id);
    this.wanting.delete(c.id);
    const line = this.lines.get(c.id);
    if (line) line.ready = false;
    const stored = c.character ? this.data.progress[c.character] : null;
    if (stored && stored.v !== PROGRESS_VERSION) return this.no(c.id, 'this character’s progress was written by a newer server than this one');
    const mine = this.recordOf(c.character);
    if (!mine) {
      // The first copy handed up is the one written down, as the ledger takes a backpack.
      if (word.has) return this.want(c.id, c.character);
      return this.handDown(c, 'server');
    }
    // The character itself settled the browser's way, and the browser made batches with nobody holding the record:
    // that copy is the newer, and it is asked for. Anything else, the server's stands.
    if (c.keep === 'browser' && word.has && word.local > 0) return this.want(c.id, c.character);
    return this.handDown(c, 'server');
  }

  /** Ask a line for its record. Only a record asked for is ever taken. */
  want(session, character) {
    this.wanting.set(session, character);
    this.offers.delete(session);
    return { ok: true, tell: [{ to: session, msg: { t: 'progress', do: 'want' } }] };
  }

  /**
   * The server's record handed down, written down empty first when there is none, with whose copy stands and the
   * rate the server pays at; and the line's character is settled here from now on (`settledLine`).
   */
  handDown(c, take) {
    if (!this.recordOf(c.character)) this.write({ t: 'progressRec', id: c.character, rec: emptyRecord(c.character) });
    const rec = this.recordOf(c.character);
    const tell = [{ to: c.id, msg: { t: 'progress', do: 'rec', rec: copyRecord(rec), take, rate: this.rules.xpRate } }];
    this.settledLine(c, tell);
    return { ok: true, take, tell };
  }

  /**
   * A piece of a browser's record, asked for. Once the last piece is in it is cleaned under this server's own
   * limits and rules (a tree the data allows within the Skill Point cap, XP at its caps) and taken: the server's own
   * goes to the archive, the browser's is written down at a revision past both, and the browser is handed back what
   * was written so the two copies are one. A record in more pieces than `offerPieces`, or past `recMax`, is refused
   * and the server's stands.
   */
  offer(c, word) {
    const character = c.character;
    if (this.wanting.get(c.id) !== character) return { ok: false, why: 'not asked for', tell: [] };
    if (word.of > this.tuning.offerPieces) return this.refuse(c, `a record comes up in at most ${this.tuning.offerPieces} pieces`);
    let pieces = this.offers.get(c.id);
    if (!pieces) {
      pieces = new Reassembly(this.tuning.recMax, this.tuning.offerWait);
      this.offers.set(c.id, pieces);
    }
    pieces.max = this.tuning.recMax;
    pieces.wait = this.tuning.offerWait;
    const got = pieces.add(word, this.wall());
    if (!got) return { ok: true, tell: [] };
    this.offers.delete(c.id);
    if ('why' in got) {
      if (/larger/.test(got.why)) return this.refuse(c, got.why);
      this.wanting.delete(c.id);
      return this.no(c.id, got.why);
    }
    this.wanting.delete(c.id);
    let raw;
    try {
      raw = JSON.parse(got.text);
    } catch {
      return this.refuse(c, 'that record could not be read');
    }
    const offered = cleanRecord(raw, this.limits, this.rules);
    if (!offered || offered.char !== character) return this.refuse(c, 'that record could not be read');
    // An empty record from a browser that believes a server holds this character already, and that counts no batch
    // of its own: a cache that was cleared, not progress. The server's own stands.
    if (recordIsEmpty(offered) && offered.local === 0 && word.known) {
      this.stats.guarded++;
      return this.handDown(c, 'server');
    }
    const mine = this.recordOf(character);
    offered.rev = Math.max(mine?.rev ?? 0, offered.rev) + 1;
    offered.base = 0;
    offered.local = 0;
    if (recordText(offered).length > this.tuning.recMax) return this.refuse(c, `that record is larger than this server takes (${this.tuning.recMax.toLocaleString('en-GB')} characters)`);
    if (mine) this.write({ t: 'progressArchive', id: character, rec: mine });
    this.write({ t: 'progressRec', id: character, rec: offered });
    this.stats.taken++;
    return this.handDown(c, 'browser');
  }

  /** Nothing of the browser's is taken: the server's own record stands, handed down so the two agree. */
  refuse(c, why) {
    this.wanting.delete(c.id);
    const no = this.no(c.id, why);
    return { ok: false, why, tell: [...no.tell, ...this.handDown(c, 'server').tell] };
  }

  /**
   * A line's character is settled here: any other line that was holding the same character (a browser it was opened
   * in before) is let go without a word, and every quest bonus owed to it is paid now, each keyed so it is paid once.
   */
  settledLine(c, tell) {
    for (const [session, other] of this.lines) if (session !== c.id && other.character === c.character) this.lines.delete(session);
    this.lines.set(c.id, { character: c.character, ready: true });
    const owed = this.data.progressOwed;
    for (const key of Object.keys(owed ?? {})) {
      const o = owed[key];
      if (o.character !== c.character) continue;
      // Paid first and struck off after: a stop between leaves it owed, and the next try finds its key and pays nothing.
      this.payBonus(c.character, c.id, o.key, o.xp, o.since, tell);
      this.write({ t: 'progressOwedGone', key });
      this.stats.owedPaid++;
    }
  }

  // ---- what earns -------------------------------------------------------------------------------------------

  /**
   * A batch worked out by the rules, tried on a copy first (refused whole when it would take the record past
   * `recMax`), then written down -- the store applies it -- and sent to the line at the revision it made, with the
   * claim or task it answered and what kind it is, for the words the browser makes of it.
   */
  commit(session, character, ch, kind, of, tell, fee = 0) {
    const rec = this.recordOf(character);
    if (!rec || !ch.length) return { ok: false, why: 'nothing to write', tell };
    const draft = copyRecord(rec);
    const out = applyProgress(draft, ch, PROGRESS_BACKSTOP);
    if (!out.changed) return { ok: false, why: out.why.join('; ') || 'the record would not take it', tell };
    if (recordText(draft).length > this.tuning.recMax) {
      this.stats.tooLong++;
      const why = `the record would be past the ${this.tuning.recMax.toLocaleString('en-GB')} characters it may be`;
      if (session) tell.push(...this.no(session, why, of).tell);
      return { ok: false, why, tell };
    }
    this.write({ t: 'progress', id: character, ch });
    const after = this.recordOf(character);
    this.stats.batches++;
    this.last = { character, rev: after?.rev ?? 0, kind };
    if (session) tell.push({ to: session, msg: { t: 'progress', do: 'ch', rev: after?.rev ?? 0, ch, kind, ...(of ? { of } : {}), ...(fee ? { fee } : {}) } });
    return { ok: true, rev: after?.rev ?? 0, tell };
  }

  /**
   * Whether a death the server heard can stand for this character's claim: heard on the claim's world, still
   * standing (the body not yet back, and within `deathKeep`), and never credited to this character before. A seeded
   * body comes back under the very name it died under, so a death from its last life must not stand for its next:
   * once the body may be standing again, or once this character has been paid for that death, a claim naming it
   * dead is about a later death, and waits for that one's word.
   */
  heard(id, world, character) {
    const d = this.deaths.get(id);
    return !!d && d.world === world && this.wall() <= d.until && !d.credited.has(character);
  }

  /**
   * What the server believes of a dead member named `w` (`PayCtx.witness`): one it heard die on the claim's world,
   * once to a character, while that death stands (`heard`); one of the world's shared bodies it never heard die is
   * alive; a name the world does not share counts against the character's own rate, as a member with no name does.
   */
  witnessed(id, world, character) {
    const d = this.deaths.get(id);
    if (d) {
      if (!this.heard(id, world, character)) return false;
      d.credited.add(character);
      return true;
    }
    if (this.shared(id)) return false;
    return this.localKill(character);
  }

  /** A dead member nobody shares, spent against the character's own `localKillsPerMinute`: false once that is spent. */
  localKill(character) {
    const now = this.wall();
    let times = this.localKills.get(character);
    if (!times) {
      times = [];
      this.localKills.set(character, times);
    }
    while (times.length && now - times[0] > 60000) times.shift();
    if (times.length >= this.tuning.localKillsPerMinute) return false;
    times.push(now);
    return true;
  }

  /**
   * A claim or a task a line hands up. Only on a line whose character's progress is settled here, and no more than
   * `claimRate` a second: one dropped either way is asked again by the browser after its own wait, with the same id.
   * A won claim naming a shared body dead whose death the server cannot yet stand on for this character (`heard`:
   * none heard, one from the body's last life, or one this character was paid for already) is parked for its word;
   * one already paid is answered at once, since nothing a death word says could change that.
   */
  claimOrTask(c, word) {
    if (!this.readyLine(c)) return { ok: false, why: 'this character’s progress is being settled with the server', tell: [] };
    if (!mayWord(this.windowsOf(c.id).claim, this.wall(), this.tuning.claimRate)) {
      this.stats.rate++;
      return { ok: false, why: 'too often', tell: [] };
    }
    if (word.do === 'task') return this.runTask(c.id, c.character, word.k, []);
    const claim = word.c;
    this.stats.claims++;
    if (this.parked.has(claim.id)) return { ok: true, parked: true, tell: [] };
    const world = this.worldOf(c) ?? '';
    const paid = this.recordOf(c.character)?.paid;
    const waiting = new Set();
    if (claim.outcome === 'won' && !(paid && Object.hasOwn(paid, claim.id))) {
      for (const m of claim.members) if (m.fought && m.dead && m.w && this.shared(m.w) && !this.heard(m.w, world, c.character)) waiting.add(m.w);
    }
    if (waiting.size) {
      this.parked.set(claim.id, { session: c.id, character: c.character, claim, world, at: this.wall(), waiting });
      this.stats.parked++;
      return { ok: true, parked: true, tell: [] };
    }
    return this.runClaim(c.id, c.character, claim, world, []);
  }

  /** A claim worked out against the record as it stands, with the server's witness, and written; or refused in words naming it. */
  runClaim(session, character, claim, world, tell) {
    const rec = this.recordOf(character);
    if (!rec) return { ok: false, why: 'no record', tell };
    const r = payClaim(rec, claim, {
      now: this.now(),
      levels: this.levels(),
      rules: this.rules,
      limits: this.limits,
      bucket: this.buckets,
      witness: (w) => this.witnessed(w, world, character),
      localKill: () => this.localKill(character),
    });
    if (!r.ch.length) {
      this.stats.unpaid++;
      if (session) tell.push(...this.no(session, r.why ?? 'nothing to pay', claim.id).tell);
      return { ok: false, why: r.why, tell };
    }
    this.stats.paid++;
    return this.commit(session, character, r.ch, 'claim', claim.id, tell);
  }

  runTask(session, character, task, tell) {
    const rec = this.recordOf(character);
    if (!rec) return { ok: false, why: 'no record', tell };
    this.stats.tasks++;
    const r = payTask(rec, task, { now: this.now(), levels: null, rules: this.rules, limits: this.limits, bucket: this.buckets });
    if (!r.ch.length) {
      if (session) tell.push(...this.no(session, r.why ?? 'nothing to pay', task.id).tell);
      return { ok: false, why: r.why, tell };
    }
    return this.commit(session, character, r.ch, 'task', task.id, tell);
  }

  /** A node learnt from the kind of person the browser says is in reach (its word, as the doc's honour system for fights): the rule decides the rest. */
  learn(c, word) {
    if (!this.readyLine(c)) return this.no(c.id, 'this character’s progress is being settled with the server');
    const rec = this.recordOf(c.character);
    const r = learnChanges(rec, word.node, word.teacher, secondsOf(this.now()), this.rules);
    if (r.why) return this.no(c.id, r.why, word.node);
    this.stats.learnt++;
    return this.commit(c.id, c.character, r.ch, 'learn', word.node, []);
  }

  /**
   * A node given back, in one step with its fee: the rule asked first, then the purse, and the node goes only when
   * the purse took the money -- no fee without the giving back and no giving back without the fee. The purse's own
   * word goes back too, which is how the browser's purse learns the new balance (and, refused, says why).
   */
  surrender(c, word) {
    if (!this.readyLine(c)) return this.no(c.id, 'this character’s progress is being settled with the server');
    const rec = this.recordOf(c.character);
    const at = secondsOf(this.now());
    const r = surrenderChanges(rec, word.node, word.teacher, at, this.rules);
    if (r.why) return this.no(c.id, r.why, word.node);
    if (!this.purses) return this.no(c.id, 'this server keeps no purse to take the fee from', word.node);
    const spent = this.purses.spend(c.character, r.fee, c.id, `Giving back ${nodeById(word.node)?.name ?? word.node}`);
    if (!spent.ok) return { ok: false, why: spent.why, tell: [...spent.tell] };
    this.stats.given++;
    const tell = [...spent.tell];
    return this.commit(c.id, c.character, r.ch, 'surrender', word.node, tell, r.fee);
  }

  /** The admin's own: a node granted with what it needs, XP given or taken, the record emptied. Anybody else is refused in words. */
  adminOp(c, word) {
    if (!this.isAdmin(c)) return this.no(c.id, 'only this world’s admin may grant progress');
    if (!this.readyLine(c)) return this.no(c.id, 'this character’s progress is being settled with the server');
    const rec = this.recordOf(c.character);
    let r;
    if (word.do === 'grant') r = grantChanges(rec, word.node, secondsOf(this.now()), this.rules);
    else if (word.do === 'xp') r = xpChanges(rec, { [word.src]: word.n }, this.rules);
    else r = { ch: resetChanges(rec) };
    if (r.why && !r.ch.length) return this.no(c.id, r.why);
    this.stats.admin++;
    return this.commit(c.id, c.character, r.ch, 'admin', '', []);
  }

  // ---- the quest bonus ----------------------------------------------------------------------------------------

  /**
   * A quest's bonus order (`PayOrder.bonus`), from the story's `pay`: paid at once while this character's progress is
   * settled on the line the job ran on, owed and written down otherwise. Answers whether it is taken care of.
   */
  bonus(character, session, order, tell) {
    if (!order?.bonus || typeof order.key !== 'string' || !STORY_KEY.test(order.key)) return false;
    const xp = Number(order.bonus.xp);
    const since = Number(order.bonus.since);
    if (!Number.isFinite(xp) || xp <= 0 || !Number.isFinite(since)) return false;
    const line = session ? this.lines.get(session) : null;
    if (line && line.ready && line.character === character && this.recordOf(character)) return this.payBonus(character, session, order.key, xp, since, tell);
    const owed = this.data.progressOwed ?? (this.data.progressOwed = Object.create(null));
    if (Object.keys(owed).length >= OWED_MAX) return false;
    const key = `p${Math.max(1, Math.floor(Number(this.data.progressOwedSeq) || 1))}`;
    this.write({ t: 'progressOwed', key, owed: { character, key: order.key, xp: Math.round(xp), since: Math.floor(since), at: this.now() } });
    this.stats.owed++;
    return true;
  }

  /** One bonus paid into the skills used since its quest began, keyed by the story's own key. True when paid, or paid before. */
  payBonus(character, session, key, xp, since, tell) {
    const rec = this.recordOf(character);
    if (!rec) return false;
    const r = questBonus(rec, key, xp, since, { now: this.now(), rules: this.rules, limits: this.limits });
    if (!r.ch.length) return /already/.test(r.why ?? '');
    this.stats.bonuses++;
    return this.commit(session, character, r.ch, 'bonus', '', tell).ok;
  }

  // ---- the world's word ----------------------------------------------------------------------------------------

  /**
   * The relay's own word of a shared body's death, on the world it died on: kept by id (the newest of each id, at
   * most `deathsMax`, the oldest let go), and every parked claim it completes is run now. It stands for claims as
   * long as the body stays down -- `back`, the seconds the world holds a seeded body's post empty, which the
   * ownership hands the relay with the death -- but never less than `deathFloor`, the time the claim of the fight it
   * ended needs to arrive behind it, and never more than `deathKeep`. A body with no `back` (an admin's, which never
   * comes back under its name) stands for `deathKeep`. A fight that went on past the respawn of a member it killed
   * early is the one case the rule pays short: that member's death has lapsed by the time the fight's claim comes.
   */
  death(id, by, keeper, world, back = 0) {
    const tell = [];
    if (typeof id !== 'string' || !id) return { ok: false, tell };
    const at = this.wall();
    const keep = Number(back) > 0 ? Math.max(this.tuning.deathFloor, Math.min(this.tuning.deathKeep, Number(back) * 1000)) : this.tuning.deathKeep;
    this.deaths.delete(id);
    this.deaths.set(id, { at, until: at + Math.min(keep, this.tuning.deathKeep), world: world ?? '', credited: new Set() });
    while (this.deaths.size > this.tuning.deathsMax) this.deaths.delete(this.deaths.keys().next().value);
    for (const [cid, p] of this.parked) {
      if (!p.waiting.delete(id) || p.waiting.size) continue;
      this.parked.delete(cid);
      this.stats.parkedPaid++;
      this.runClaim(this.lines.get(p.session)?.character === p.character ? p.session : 0, p.character, p.claim, p.world, tell);
    }
    return { ok: true, tell };
  }

  /**
   * Twice a second or so: a parked claim whose deaths did not all come within `claimPark` paid on what was heard; a
   * record half up for longer than its wait given up and its browser told; deaths past `deathKeep` forgotten.
   */
  tick(now = this.wall()) {
    const tell = [];
    for (const [cid, p] of this.parked) {
      if (now - p.at < this.tuning.claimPark) continue;
      this.parked.delete(cid);
      this.stats.parkedLate++;
      this.runClaim(this.lines.get(p.session)?.character === p.character ? p.session : 0, p.character, p.claim, p.world, tell);
    }
    for (const [session, pieces] of this.offers) {
      if (!pieces.expire(now)) continue;
      this.offers.delete(session);
      this.wanting.delete(session);
      tell.push(...this.no(session, 'the pieces stopped coming').tell);
    }
    for (const [id, d] of this.deaths) {
      if (now - d.at <= this.tuning.deathKeep) break;
      this.deaths.delete(id);
    }
    return { ok: true, tell };
  }

  /**
   * A line has closed: whatever it was handing up is forgotten, and its allowances. Its character's buckets stay, so
   * a reconnect finds them as they were; a claim of it still parked is paid when its time comes, to the record.
   */
  gone(session) {
    this.wanting.delete(session);
    this.offers.delete(session);
    this.windows.delete(session);
    this.lines.delete(session);
  }

  /** What the status page prints. */
  describe() {
    let archived = 0;
    for (const id of Object.keys(this.data.progressArchive ?? {})) archived += Array.isArray(this.data.progressArchive[id]) ? this.data.progressArchive[id].length : 0;
    const playing = [...this.lines.values()].filter((l) => l.ready).map((l) => ({ char: l.character, rev: this.recordOf(l.character)?.rev ?? 0, sp: recordSummary(this.recordOf(l.character))?.sp ?? 0 }));
    return {
      v: PROGRESS_WIRE_VERSION,
      records: Object.keys(this.data.progress ?? {}).length,
      archived,
      owed: Object.keys(this.data.progressOwed ?? {}).length,
      playing,
      asking: this.wanting.size,
      coming: this.offers.size,
      parked: this.parked.size,
      deaths: this.deaths.size,
      levels: this.levelsState,
      last: this.last,
      buckets: Object.keys(this.buckets.report()).length,
      stats: { ...this.stats },
    };
  }
}
