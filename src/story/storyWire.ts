// The story's words on the wire, both ways, and the one way a whole book crosses it: in pieces.
//
// Every word is `{ t: 'story', do, ... }`. A browser says `sync` (what it holds), `offer` (its book,
// in pieces, when the server has asked for it) and `wp` (a waypoint set, renamed, recoloured, switched,
// taken away or tracked); a server says `book` (its book, in pieces), `want` (send me yours), `ch` (a
// batch of changes at a revision) and `no` (why not). Each is cleaned the house way -- a class of
// characters, a length, a finite number, a hard cap on a list, and the three names that mean something
// to the language refused outright -- and anything that fails is dropped rather than answered.
//
// **The jobs (story 2).** A server whose hail says `story.v` 2 or more runs the character's jobs itself,
// and the browser speaks three more words to it: `ev` (something the detectors saw, with where the player
// stood when they saw it), `q` (a job taken, turned down, dropped, started over, followed or not) and
// `admin` (the console's own operations, which only the world's admin may use). It is told `view` (what the
// interface shows, whenever that changed, and whether the server reads a story set at all: `read`) and
// `note` (a fact for the message line: the words are made in
// the browser, which is the only side that can read the client's own strings). A refusal about a job
// rather than about the book carries `of: 'job'`, so the browser never takes it for a book that will not
// come up. None of these is ever said to a server whose hail says less.
//
// **The conversations (story 3).** A browser says `talk` -- open a conversation with somebody, give an
// answer (`reply`, or none for a node that goes on by itself), or close it -- and is told `node`: the node
// the conversation has reached, its lines and the answers open just now, or none with why when it has ended
// or was refused. The server keeps where the conversation stands for the line, never in the book. Neither
// is ever said to a server whose hail says less than 3. An opening with one of the game's own people
// (`row:<key>`) carries the creature they are stood as (`who`), which is what gives them a conversation; a
// server from before them ignores it and answers that they have nothing to say.
//
// **The documents and the journal (story 4).** A browser says `read` (open a document it was handed, with
// `end` once its last page is shown, or `pick` for a choice at its foot), `journal` (the words of a stretch of
// its journal, which it keeps beside the book and may have lost), `texts` (words the server asked for, in
// pieces) and `mine` (a note of the player's own on an entry), and a conversation's `close` carries the words
// it read out of the client's own lines and the name it showed. It is told `doc` (the page as it was read, its
// foot and the entry it is frozen into, or why not), `journal` (those words) and `need` (the words of the
// journal the server has not got, after it took this browser's book). None of these is ever said to a server
// whose hail says less than 4.
//
// **Why in pieces.** The relay drops what a browser sends past 64 KB in a second and closes a line that
// goes twice past it, so a book of any size goes up as pieces of `offerChunk` characters with a gap
// between them, and comes down the same way so the two sides read it with the same code. A book is
// written with every character past plain ASCII escaped (`bookText`), so a piece's length in
// characters is its length in bytes and the pacing means what it says.
//
// Pure, nothing imported but this folder: the server reads these words with this file.

import { cleanChange, isQuestId, isStepName, isTrack, isWho, type StoryChange } from './book.ts';
import { cleanDocView, type DocView } from './doc.ts';
import { cleanDocFoot, type DocFoot } from './docRules.ts';
import { cleanJournalEntry, cleanMine, isDocId, isJournalId, isTextHash, type JournalEntry } from './journal.ts';
import type { StoryEvent, StoryNote } from './quests.ts';
import type { Room } from './set.ts';
import { cleanNodeView, type NodeView } from './talkRules.ts';
import { isNodeName } from './talkSet.ts';
import { cleanTextRef, type TextRef } from './text.ts';
import { cleanView, type StoryView } from './view.ts';
import { cleanPlace, cleanRoom, cleanWaypointAsk, cleanWaypointName, cleanWorld, isQuestWaypoint, isWaypointColour, isWaypointId, type WaypointAsk, type WaypointColour } from './waypoints.ts';

/** The caps on a word. Ours; the pacing and the sizes a server will take are its own (`STORY_TUNING`). */
export const STORY_WIRE = {
  /** The longest piece of a book a word may carry, in characters (bytes, since a book is ASCII). */
  partMax: 65536,
  /** The most pieces one book may be cut into. */
  partsMax: 100000,
  /** The longest reason a `no` may give. */
  whyMax: 160,
  /** The most changes one `ch` may carry. */
  changesMax: 1000,
  /** The most tags a kill may carry. */
  tagsMax: 32,
  /** The most actions one `admin` word may run (`complete` names one step at a time). */
  adminMax: 1,
  /** The most entries one `journal` word asks for, or carries the words of. */
  journalMax: 200,
  /** The most hashes one `need` asks for. */
  needMax: 5000,
  /** The most client lines a conversation's close hands up the words of. */
  readMax: 400,
  /** The longest words one line of a conversation, or one kept text, may be, in characters. */
  textMax: 200000,
};

/** The jobs' operations any player may ask of their own book. */
export const QUEST_OPS = ['accept', 'decline', 'drop', 'restart', 'track', 'untrack'] as const;
export type QuestOp = (typeof QUEST_OPS)[number];
/** The console's operations, which only the world's admin may ask of a server. */
export const ADMIN_OPS = ['reload', 'grant', 'offer', 'unstick', 'complete', 'signal', 'clock'] as const;
export type AdminOp = (typeof ADMIN_OPS)[number];

/** Where the player stood when the detectors saw something, as the browser saw it: what a server checks an event against. */
export interface StoryAt {
  /** Across the ground in the frame a story writes places in (raw on a planet, the game's in space). */
  p?: [number, number];
  /** The room, or null for none. */
  room?: Room | null;
  /**
   * The game hour where the player stands, 0 to 23, as this browser's sky has it. A server works the hour out
   * itself from its own clock and the planet's own sun, and takes this only for a world its list of planets
   * does not know, and only while it is fresh.
   */
  hour?: number;
}

/** What a browser says. */
export type StoryUp =
  | { do: 'sync'; has: boolean; base: number; local: number; known: boolean }
  | { do: 'offer'; id: number; n: number; of: number; part: string; known: boolean }
  | { do: 'wp'; op: 'set'; wp: WaypointAsk }
  | { do: 'wp'; op: 'edit'; id: string; name?: string; colour?: WaypointColour }
  | { do: 'wp'; op: 'on' | 'off' | 'gone'; id: string }
  | { do: 'wp'; op: 'track'; id: string | null }
  | { do: 'ev'; ev: StoryEvent; at: StoryAt }
  | { do: 'q'; op: QuestOp; quest: string; at: StoryAt }
  | { do: 'admin'; op: AdminOp; quest?: string; step?: string; name?: string; ms?: number | null; at: StoryAt }
  | { do: 'talk'; op: TalkOp; speaker: string; reply: string | null; at: StoryAt; who?: string; read?: Record<string, string>; name?: string }
  | { do: 'read'; doc: string; end: boolean; pick: string | null; at: StoryAt }
  | { do: 'journal'; from: number; count: number }
  | { do: 'texts'; id: number; n: number; of: number; part: string }
  | { do: 'mine'; ref: string; text: string; at: StoryAt };

/** A conversation's operations: open one, give an answer (or let a node go on), close it. */
export const TALK_OPS = ['open', 'pick', 'close'] as const;
export type TalkOp = (typeof TALK_OPS)[number];

/** A fact for the message line, with what a browser that holds no set needs to say it: an objective's own words and whether it was a place to reach. */
export type StoryNoteDown = StoryNote & { line?: TextRef; goto?: boolean };

/** What a server says. `whole` on a `ch` is false when a change in it could not be read: the batch is then asked for again whole. */
export type StoryDown =
  | { do: 'book'; id: number; n: number; of: number; part: string; take: 'browser' | 'server' }
  | { do: 'want' }
  | { do: 'ch'; rev: number; ch: StoryChange[]; whole: boolean }
  | { do: 'no'; why: string; of?: 'job' }
  | { do: 'view'; view: StoryView; off: number; read: boolean }
  | { do: 'note'; note: StoryNoteDown; given: boolean }
  | { do: 'node'; speaker: string; view: NodeView | null; why: string | null }
  | { do: 'doc'; doc: string; view: DocView | null; foot: DocFoot | null; entry: string | null; why: string | null; from?: string; end?: true }
  | { do: 'journal'; from: number; entries: JournalEntry[]; texts: Record<string, string> }
  | { do: 'need'; hashes: string[] };

const CONTROL = /[\u0000-\u001f\u007f]/g;
/** A story's own id for one of its things (an object, an area): its set's prefix and its name, as a quest's is. */
const THING_ID = /^[A-Za-z0-9_-]{1,24}:[A-Za-z0-9_./-]{1,96}$/;
/** A signal's name: an engine prefix or a set's, then its name, which may itself be an id (`used:test:obj/test-terminal`). */
const SIGNAL = /^[A-Za-z0-9_:./#-]{1,200}$/;
/** A creature's catalogue id, group, social group or tag. */
const CREATURE_WORD = /^[A-Za-z0-9_.:/ -]{1,96}$/;
/** The name one body's death is known by on the wire (`killKey`). */
const NPC = /^[A-Za-z0-9_.:/#-]{1,120}$/;
/** A building's template. */
const TEMPLATE = /^[A-Za-z0-9_./-]{1,160}$/;
/**
 * A job as a player names one at the console: with its set's prefix, or by its name alone, which the server
 * finds in its own sets as the browser's host does in its own (`own:` first, then `test:`).
 */
const QUEST_REF = /^([A-Za-z0-9_-]{1,24}:)?[A-Za-z0-9_./-]{1,96}$/;

function questRef(x: unknown): string | null {
  return isQuestId(x) || wordOf(x, QUEST_REF) ? (x as string) : null;
}

function whole(x: unknown, max = 1e12): number | null {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max ? x : null;
}

/** A creature's name as the packs write it (`herald_corellia_karin`): what a game person is stood as. */
const CREATURE = /^[A-Za-z0-9_.-]{1,96}$/;

function wordOf(x: unknown, re: RegExp): string | null {
  return typeof x === 'string' && re.test(x) && x !== '__proto__' && x !== 'constructor' && x !== 'prototype' ? x : null;
}

/** Two finite numbers across the ground, or null. */
function pair(x: unknown): [number, number] | null {
  if (!Array.isArray(x) || x.length !== 2) return null;
  const p = cleanPlace(x);
  return p ? [p[0], p[1]] : null;
}

/**
 * Something a browser's detectors saw, cleaned, or null when it is not one. Every field is rebuilt; a
 * kind the server never takes from a browser (the step machine's own `tick`) is not one.
 */
export function cleanStoryEvent(x: unknown): StoryEvent | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  switch (o.k) {
    case 'arrive': {
      const world = cleanWorld(o.world);
      const p = pair(o.p);
      if (!world || !p) return null;
      const out: Extract<StoryEvent, { k: 'arrive' }> = { k: 'arrive', world, p };
      const room = o.room === undefined || o.room === null ? null : cleanRoom(o.room);
      if (room) out.room = room;
      if (o.quest !== undefined) {
        if (!isQuestId(o.quest)) return null;
        out.quest = o.quest;
      }
      if (o.step !== undefined) {
        if (!isStepName(o.step)) return null;
        out.step = o.step;
      }
      return out;
    }
    case 'room': {
      const room = cleanRoom({ cell: o.cell, template: o.template });
      return room && typeof o.template === 'string' && TEMPLATE.test(o.template) ? { k: 'room', template: o.template, cell: room.cell } : null;
    }
    case 'area': {
      const area = wordOf(o.area, THING_ID);
      return area && typeof o.inside === 'boolean' ? { k: 'area', area, inside: o.inside } : null;
    }
    case 'use': {
      const object = wordOf(o.object, THING_ID);
      return object ? { k: 'use', object } : null;
    }
    case 'kill': {
      const who = wordOf(o.who, CREATURE_WORD);
      if (!who) return null;
      const out: Extract<StoryEvent, { k: 'kill' }> = { k: 'kill', who };
      const group = o.group === undefined ? null : wordOf(o.group, CREATURE_WORD);
      if (group) out.group = group;
      const social = o.social === undefined ? null : wordOf(o.social, CREATURE_WORD);
      if (social) out.social = social;
      if (Array.isArray(o.tags)) {
        const tags: string[] = [];
        for (const t of o.tags) {
          const tag = wordOf(t, CREATURE_WORD);
          if (tag && !tags.includes(tag) && tags.length < STORY_WIRE.tagsMax) tags.push(tag);
        }
        if (tags.length) out.tags = tags;
      }
      const npc = o.npc === undefined ? null : wordOf(o.npc, NPC);
      if (npc) out.npc = npc;
      return out;
    }
    case 'death':
      return { k: 'death' };
    case 'world': {
      const world = cleanWorld(o.world);
      return world ? { k: 'world', world } : null;
    }
    case 'signal': {
      const name = wordOf(o.name, SIGNAL);
      return name ? { k: 'signal', name } : null;
    }
    case 'enter':
      return { k: 'enter' };
    case 'leave':
      return { k: 'leave' };
    default:
      return null;
  }
}

/** Where the player stood, as a browser says it with an event, cleaned: anything that is not one is left out. */
export function cleanStoryAt(x: unknown): StoryAt {
  const out: StoryAt = {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out;
  const o = x as Record<string, unknown>;
  const p = pair(o.p);
  if (p) out.p = p;
  if (o.room === null) out.room = null;
  else if (o.room !== undefined) out.room = cleanRoom(o.room);
  if (typeof o.hour === 'number' && Number.isFinite(o.hour) && o.hour >= 0 && o.hour < 24) out.hour = o.hour;
  return out;
}

const NOTE_KINDS = ['job', 'offered', 'restarted', 'dropped', 'done', 'failed', 'stalled', 'objective', 'objectiveDone', 'paid', 'charged', 'item', 'xp', 'standing', 'say', 'doc', 'journal'];

/** A fact for the message line as a server sends it, cleaned, or null. Its words are made here, in the browser. */
export function cleanNoteDown(x: unknown): StoryNoteDown | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.k !== 'string' || !NOTE_KINDS.includes(o.k)) return null;
  const quest = isQuestId(o.quest) ? o.quest : 'run';
  const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e12 ? v : null);
  let out: StoryNoteDown | null = null;
  switch (o.k) {
    case 'job':
    case 'offered':
    case 'restarted':
    case 'dropped': {
      const title = cleanTextRef(o.title, 240);
      if (title) out = { k: o.k, quest, title };
      break;
    }
    case 'done':
    case 'failed': {
      const title = cleanTextRef(o.title, 240);
      if (title && isStepName(o.outcome)) out = { k: o.k, quest, title, outcome: o.outcome };
      break;
    }
    case 'stalled': {
      const title = cleanTextRef(o.title, 240);
      const why = typeof o.why === 'string' ? o.why.replace(CONTROL, '').slice(0, STORY_WIRE.whyMax) : '';
      if (title) out = { k: 'stalled', quest, title, why };
      break;
    }
    case 'objective':
    case 'objectiveDone':
      if (isStepName(o.step)) out = { k: o.k, quest, step: o.step };
      break;
    case 'paid':
    case 'charged': {
      const credits = count(o.credits);
      if (credits !== null) out = { k: o.k, quest, credits };
      break;
    }
    case 'item': {
      const n = count(o.n);
      const id = wordOf(o.id, CREATURE_WORD);
      if ((o.kind === 'wear' || o.kind === 'weapon') && id && n !== null) out = { k: 'item', quest, kind: o.kind, id, n };
      break;
    }
    case 'xp': {
      const n = count(o.n);
      if (n !== null) out = { k: 'xp', quest, n };
      break;
    }
    case 'standing': {
      const n = count(o.n);
      if (isTrack(o.track) && n !== null) out = { k: 'standing', quest, track: o.track, n };
      break;
    }
    case 'say': {
      const text = cleanTextRef(o.text, 400);
      if (text) out = { k: 'say', text: typeof text === 'string' ? text : text.en };
      break;
    }
    case 'doc': {
      const title = typeof o.title === 'string' ? o.title.replace(CONTROL, '').slice(0, 160) : '';
      if (!isDocId(o.doc) || !title.trim()) break;
      const doc: Extract<StoryNote, { k: 'doc' }> = { k: 'doc', quest, doc: o.doc, title };
      if (isWho(o.from)) doc.from = o.from;
      const fromName = cleanTextRef(o.fromName, 240);
      if (fromName) doc.fromName = fromName;
      out = doc;
      break;
    }
    case 'journal': {
      const title = typeof o.title === 'string' ? o.title.replace(CONTROL, '').slice(0, 400) : '';
      if (title.trim()) out = { k: 'journal', quest, title };
      break;
    }
  }
  if (!out) return null;
  const line = o.line === undefined ? null : cleanTextRef(o.line, 400);
  if (line) out.line = line;
  if (o.goto === true) out.goto = true;
  return out;
}

/** The pieces' own numbers: which book, which piece, how many, and the text. Null when any is wrong. */
function piece(o: Record<string, unknown>): { id: number; n: number; of: number; part: string } | null {
  const id = whole(o.id);
  const n = whole(o.n, STORY_WIRE.partsMax);
  const of = whole(o.of, STORY_WIRE.partsMax);
  if (id === null || n === null || of === null || of < 1 || n >= of) return null;
  if (typeof o.part !== 'string' || o.part.length > STORY_WIRE.partMax) return null;
  return { id, n, of, part: o.part };
}

/**
 * A story word, cleaned, or null. `up` is a browser's word as the server reads it; `down` a server's as
 * the browser reads it. Nothing a word carries is passed on that was not rebuilt here.
 */
export function cleanStoryWord(x: unknown, dir: 'up'): StoryUp | null;
export function cleanStoryWord(x: unknown, dir: 'down'): StoryDown | null;
export function cleanStoryWord(x: unknown, dir: 'up' | 'down'): StoryUp | StoryDown | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (o.t !== undefined && o.t !== 'story') return null;
  if (dir === 'up') {
    if (o.do === 'sync') {
      const base = whole(o.base);
      const local = whole(o.local);
      if (base === null || local === null) return null;
      return { do: 'sync', has: o.has === 1 || o.has === true, base, local, known: o.known === 1 || o.known === true };
    }
    if (o.do === 'offer') {
      const p = piece(o);
      return p ? { do: 'offer', ...p, known: o.known === 1 || o.known === true } : null;
    }
    if (o.do === 'wp') {
      const wp = o.wp && typeof o.wp === 'object' && !Array.isArray(o.wp) ? (o.wp as Record<string, unknown>) : null;
      if (!wp) return null;
      if (o.op === 'set') {
        const ask = cleanWaypointAsk(wp);
        return ask ? { do: 'wp', op: 'set', wp: ask } : null;
      }
      if (o.op === 'edit') {
        if (!isWaypointId(wp.id)) return null;
        const out: { do: 'wp'; op: 'edit'; id: string; name?: string; colour?: WaypointColour } = { do: 'wp', op: 'edit', id: wp.id };
        const name = wp.name === undefined ? null : cleanWaypointName(wp.name);
        if (name) out.name = name;
        if (isWaypointColour(wp.colour)) out.colour = wp.colour;
        return out.name === undefined && out.colour === undefined ? null : out;
      }
      // A quest's own waypoint may be switched as the character's own are (it is remembered by its key).
      if (o.op === 'on' || o.op === 'off') return isWaypointId(wp.id) || isQuestWaypoint(wp.id) ? { do: 'wp', op: o.op, id: wp.id as string } : null;
      if (o.op === 'gone') return isWaypointId(wp.id) ? { do: 'wp', op: o.op, id: wp.id } : null;
      if (o.op === 'track') return wp.id === null || isWaypointId(wp.id) || isQuestWaypoint(wp.id) ? { do: 'wp', op: 'track', id: (wp.id as string | null) ?? null } : null;
      return null;
    }
    if (o.do === 'ev') {
      const ev = cleanStoryEvent(o.ev);
      return ev ? { do: 'ev', ev, at: cleanStoryAt(o.at) } : null;
    }
    if (o.do === 'q') {
      const quest = questRef(o.quest);
      if (typeof o.op !== 'string' || !(QUEST_OPS as readonly string[]).includes(o.op) || !quest) return null;
      return { do: 'q', op: o.op as QuestOp, quest, at: cleanStoryAt(o.at) };
    }
    if (o.do === 'admin') {
      if (typeof o.op !== 'string' || !(ADMIN_OPS as readonly string[]).includes(o.op)) return null;
      const out: { do: 'admin'; op: AdminOp; quest?: string; step?: string; name?: string; ms?: number | null; at: StoryAt } = { do: 'admin', op: o.op as AdminOp, at: cleanStoryAt(o.at) };
      if (o.quest !== undefined) {
        const quest = questRef(o.quest);
        if (!quest) return null;
        out.quest = quest;
      }
      if (o.step !== undefined) {
        if (!isStepName(o.step)) return null;
        out.step = o.step;
      }
      if (o.name !== undefined) {
        const name = wordOf(o.name, SIGNAL);
        if (!name) return null;
        out.name = name;
      }
      if (o.ms === null) out.ms = null;
      else if (typeof o.ms === 'number' && Number.isFinite(o.ms) && Math.abs(o.ms) <= 1e11) out.ms = Math.round(o.ms);
      // Each operation names what it works on: a job for those that act on one, a signal's name, a clock's move.
      if ((out.op === 'grant' || out.op === 'offer' || out.op === 'unstick' || out.op === 'complete') && !out.quest) return null;
      if (out.op === 'complete' && !out.step) return null;
      if (out.op === 'signal' && !out.name) return null;
      if (out.op === 'clock' && out.ms === undefined) return null;
      return out;
    }
    if (o.do === 'talk') {
      if (typeof o.op !== 'string' || !(TALK_OPS as readonly string[]).includes(o.op) || !isWho(o.speaker)) return null;
      // No answer is a node going on by itself; an answer is named by its own id.
      if (o.reply !== undefined && o.reply !== null && !isNodeName(o.reply)) return null;
      const word: Extract<StoryUp, { do: 'talk' }> = { do: 'talk', op: o.op as TalkOp, speaker: o.speaker, reply: typeof o.reply === 'string' ? o.reply : null, at: cleanStoryAt(o.at) };
      // The creature a game person is stood as, held to the names every other word here is: never one of the
      // three that mean something to every object, though what it keys is a table with no prototype.
      const who = wordOf(o.who, CREATURE);
      if (who && o.speaker.startsWith('row:')) word.who = who;
      if (word.op === 'close') {
        // What the browser read out of the client's own lines, by their reference, for the transcript; and the
        // name it showed for the speaker. Only words, never markup: they are kept as text and shown as text.
        if (Array.isArray(o.read)) {
          const read: Record<string, string> = Object.create(null);
          let n = 0;
          for (const r of o.read) {
            if (n >= STORY_WIRE.readMax || !r || typeof r !== 'object' || Array.isArray(r)) continue;
            const ref = (r as Record<string, unknown>).ref;
            const text = (r as Record<string, unknown>).text;
            if (typeof ref !== 'string' || !/^@[A-Za-z0-9_/.-]{1,120}:[A-Za-z0-9_.-]{1,120}$/.test(ref) || typeof text !== 'string') continue;
            const words = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, 4000);
            if (!words.trim()) continue;
            read[ref] = words;
            n++;
          }
          if (n) word.read = read;
        }
        if (typeof o.name === 'string' && o.name.trim()) word.name = o.name.replace(CONTROL, '').slice(0, 120);
      }
      return word;
    }
    if (o.do === 'read') {
      if (!isDocId(o.doc)) return null;
      if (o.pick !== undefined && o.pick !== null && !isStepName(o.pick)) return null;
      return { do: 'read', doc: o.doc, end: o.end === 1 || o.end === true, pick: typeof o.pick === 'string' ? o.pick : null, at: cleanStoryAt(o.at) };
    }
    if (o.do === 'journal') {
      const from = whole(o.from, 1e7);
      const count = whole(o.count, STORY_WIRE.journalMax);
      return from !== null && count !== null && count > 0 ? { do: 'journal', from, count } : null;
    }
    if (o.do === 'texts') {
      const p = piece(o);
      return p ? { do: 'texts', ...p } : null;
    }
    if (o.do === 'mine') {
      if (!isJournalId(o.ref) || typeof o.text !== 'string') return null;
      const text = cleanMine(o.text);
      return text ? { do: 'mine', ref: o.ref, text, at: cleanStoryAt(o.at) } : null;
    }
    return null;
  }
  if (o.do === 'book') {
    const p = piece(o);
    return p ? { do: 'book', ...p, take: o.take === 'browser' ? 'browser' : 'server' } : null;
  }
  if (o.do === 'want') return { do: 'want' };
  if (o.do === 'ch') {
    const rev = whole(o.rev);
    if (rev === null || !Array.isArray(o.ch) || o.ch.length > STORY_WIRE.changesMax) return null;
    const ch: StoryChange[] = [];
    for (const raw of o.ch) {
      const c = cleanChange(raw);
      if (c) ch.push(c);
    }
    return { do: 'ch', rev, ch, whole: ch.length === o.ch.length };
  }
  if (o.do === 'no') {
    const why = typeof o.why === 'string' ? o.why.replace(CONTROL, '').slice(0, STORY_WIRE.whyMax) : '';
    return o.of === 'job' ? { do: 'no', why: why || 'the server would not', of: 'job' } : { do: 'no', why: why || 'the server would not' };
  }
  if (o.do === 'view') {
    const view = cleanView(o.view);
    if (!view) return null;
    const off = typeof o.off === 'number' && Number.isFinite(o.off) && Math.abs(o.off) <= 1e11 ? o.off : 0;
    // Whether the server reads a story set at all: only an outright nought says it does not.
    return { do: 'view', view, off, read: o.read !== 0 && o.read !== false };
  }
  if (o.do === 'note') {
    const note = cleanNoteDown(o.note);
    return note ? { do: 'note', note, given: o.given !== 0 && o.given !== false } : null;
  }
  if (o.do === 'node') {
    // The node's own fields are the word's (`speaker`, `tree`, `node`, `lines`, `replies`, `next`, `end`), or
    // none with a reason: the conversation has ended, or the server would not open it.
    if (!isWho(o.speaker)) return null;
    const why = typeof o.why === 'string' && o.why ? o.why.replace(CONTROL, '').slice(0, STORY_WIRE.whyMax) : null;
    const view = o.tree === undefined ? null : cleanNodeView(o);
    if (o.tree !== undefined && !view) return null;
    return { do: 'node', speaker: o.speaker, view, why };
  }
  if (o.do === 'doc') {
    // The page as it was read, or none with why: it was never handed over, or was not kept.
    if (!isDocId(o.doc)) return null;
    const view = o.view === undefined || o.view === null ? null : cleanDocView(o.view);
    if (o.view !== undefined && o.view !== null && (!view || view.id !== o.doc)) return null;
    const why = typeof o.why === 'string' && o.why ? o.why.replace(CONTROL, '').slice(0, STORY_WIRE.whyMax) : null;
    const word: Extract<StoryDown, { do: 'doc' }> = { do: 'doc', doc: o.doc, view, foot: cleanDocFoot(o.foot), entry: isJournalId(o.entry) ? o.entry : null, why };
    if (isWho(o.from)) word.from = o.from;
    // The answer to a reading to the end, which the window that sent it already shows.
    if (o.end === 1 || o.end === true) word.end = true;
    return word;
  }
  if (o.do === 'journal') {
    const from = whole(o.from, 1e7);
    if (from === null) return null;
    const entries: JournalEntry[] = [];
    if (Array.isArray(o.entries)) for (const e of o.entries) {
      if (entries.length >= STORY_WIRE.journalMax) break;
      const entry = cleanJournalEntry(e);
      if (entry) entries.push(entry);
    }
    return { do: 'journal', from, entries, texts: cleanTexts(o.texts) };
  }
  if (o.do === 'need') {
    const hashes: string[] = [];
    if (Array.isArray(o.hashes)) for (const h of o.hashes) if (isTextHash(h) && !hashes.includes(h) && hashes.length < STORY_WIRE.needMax) hashes.push(h);
    return { do: 'need', hashes };
  }
  return null;
}

/**
 * Texts by their hash, from the wire or a set of pieces put back together: each kept only when it is words and
 * its hash is the one it says, so nothing can stand under a hash that is not its own. Answers the table (with
 * no prototype); what is not one is left out.
 */
export function cleanTexts(x: unknown, hashOf?: (text: string) => string): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out;
  let n = 0;
  for (const h of Object.keys(x)) {
    if (n >= STORY_WIRE.needMax) break;
    const t = (x as Record<string, unknown>)[h];
    if (!isTextHash(h) || typeof t !== 'string' || t.length > STORY_WIRE.textMax) continue;
    if (hashOf && hashOf(t) !== h) continue;
    out[h] = t;
    n++;
  }
  return out;
}

/** A node as the server says it: the node's own fields on the word, or none with why. */
export function nodeWord(speaker: string, view: NodeView | null, why: string | null): Record<string, unknown> {
  return view ? { t: 'story', do: 'node', ...view, ...(why ? { why } : {}) } : { t: 'story', do: 'node', speaker, ...(why ? { why } : {}) };
}

/** The story a server's hail says it holds: its version, 0 when it says nothing (every relay before this one). */
export function storyHailVersion(x: unknown): number {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return 0;
  const v = (x as Record<string, unknown>).v;
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 1000 ? v : 0;
}

/**
 * A book as the text that crosses the wire: JSON with every character past plain ASCII written as an
 * escape, so its length in characters is its length in bytes. `JSON.parse` reads it back unchanged.
 */
export function bookText(book: unknown): string {
  return JSON.stringify(book).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** A text cut into pieces of at most `size` characters, in order. Never fewer than one. */
export function chunkText(s: string, size: number): string[] {
  const step = Math.max(1, Math.floor(size));
  if (!s.length) return [''];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += step) out.push(s.slice(i, i + step));
  return out;
}

/**
 * A book coming in pieces, put back together: one book at a time, its pieces in order, no more than
 * `max` characters in all and no longer than `wait` milliseconds between one piece and the next. A piece
 * numbered 0 starts a book over, whatever was arriving before. Both sides use it: the server for a
 * browser's offer, the browser for the server's book.
 */
export class Reassembly {
  max: number;
  wait: number;
  private id = -1;
  private of = 0;
  private parts: string[] = [];
  private size = 0;
  private last = 0;

  constructor(max: number, wait: number) {
    this.max = max;
    this.wait = wait;
  }

  /** Whether a book is half in. */
  get busy(): boolean {
    return this.id >= 0;
  }

  /** How many characters of the book in progress have arrived. */
  get received(): number {
    return this.size;
  }

  clear(): void {
    this.id = -1;
    this.of = 0;
    this.parts = [];
    this.size = 0;
  }

  /**
   * One piece. Answers the whole text once the last piece is in, a reason when the book cannot be
   * taken (and forgets it), or null while more is to come or the piece belongs to a book given up.
   */
  add(p: { id: number; n: number; of: number; part: string }, now: number): { text: string } | { why: string } | null {
    if (p.n === 0) {
      this.clear();
      this.id = p.id;
      this.of = p.of;
    } else if (p.id !== this.id) {
      return null;
    } else if (p.of !== this.of || p.n !== this.parts.length) {
      this.clear();
      return { why: 'the pieces came out of order' };
    } else if (now - this.last > this.wait) {
      this.clear();
      return { why: 'the pieces stopped coming' };
    }
    if (this.size + p.part.length > this.max) {
      this.clear();
      return { why: 'that book is larger than this server takes' };
    }
    this.parts.push(p.part);
    this.size += p.part.length;
    this.last = now;
    if (this.parts.length < this.of) return null;
    const text = this.parts.join('');
    this.clear();
    return { text };
  }

  /** Give up on a book whose next piece is overdue. True when one was given up. */
  expire(now: number): boolean {
    if (this.id < 0 || now - this.last <= this.wait) return false;
    this.clear();
    return true;
  }
}
