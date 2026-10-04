// A conversation played: who has a tree to speak, where it starts, what reaching a node and giving an answer
// do, and what the window is shown of a node. Pure, and the one place it is decided: the browser's host and
// the server's both run it through the shared host loop (`hostCore.ts`), so a node looks the same whoever
// works it out, and the server never hands a browser a tree -- only the node it has reached, one at a time.
//
// **Where a conversation stands** is never in the book. A host keeps it for the line it is on (`TalkState`:
// whose conversation, which tree at which hash, the node, the way it came), so a reload or a dropped line
// starts it again cleanly at the entry, and a tree revised in the middle of one starts again at its entry
// too, rather than walking a path through nodes that are not what they were. What the book keeps is what the
// conversation did: every node reached and answer given (`heard`), the person met and named (`npcs`), and
// whatever the nodes' and answers' actions changed.
//
// **A node reached** is heard (the first time is kept), its actions run, and `talked:<who>#<node>` and
// `talked:<who>` are raised after them, which is what a `talk` step waits on. **An answer** must be one the
// node offers just now -- its `when` holding and, for one chosen `once`, not given before -- and is then
// heard, its actions run, and the conversation goes on to the node it names, or ends.
//
// **What the window is shown** (`NodeView`): the node's lines with their presentation slots exactly as the
// tree writes them (absent stays absent, for the game to fill at play time), and its answers -- each open
// one, each refused one the tree shows greyed with its reason, none it hides -- with what is at stake. The
// cleaner at the bottom rebuilds one off the wire field by field, as every story word is.
//
// **The transcript.** Every line a node says and every answer the player says aloud is kept, in turn, with
// the conversation (`TalkState.log`, and on the turn that ends it `TalkTurn.log`), and once the window closes
// the host writes it into the journal as one entry (`talkJournalWork`): each line by the hash of its words,
// with the speaker as the player knew them then. A line in the client's own words is written as the browser
// read it out, which it hands up as it closes; one it did not is kept as its reference rather than guessed.

import { isWho, ownOf, type StoryBook } from './book.ts';
import { TONES, type Tone } from './gestures.ts';
import { JOURNAL_TUNE, textHash, type JournalLine } from './journal.ts';
import { castFor, whoOf, whyNotSpeak } from './people.ts';
import { evalCond, type Draft, type StoryCtx, type Tally } from './quests.ts';
import type { CastDef, StorySet } from './set.ts';
import { FILL_KEYS, SHOT_KINDS, isNodeName, type FillKey, type LineDef, type NodeDef, type ReplyDef, type Shot, type ShotKind, type TalkDef } from './talkSet.ts';
import { TEXT_MAX, cleanTextRef, literalOf, relativeKey, type TextRef } from './text.ts';

/** One line of a transcript as it was said: the player's own or the speaker's, its words as written, and the substitutions the host could fill. */
export interface TalkLogLine {
  you?: 1;
  text: TextRef;
  fill?: Partial<Record<FillKey, string>>;
}

/** Where a conversation stands, as a host keeps it for the line it is on and never in the book. */
export interface TalkState {
  /** Who speaks: `<set>:cast/<id>`, or one of the game's own people, `row:<key>`. */
  speaker: string;
  /** For one of the game's own people, the creature they are stood as: what binds them to a conversation (`voices`). */
  who?: string;
  tree: string;
  /** The tree's hash when it began: a tree revised since starts again at its entry. */
  hash: string;
  node: string;
  /** The nodes and answers walked, for the console. */
  path: string[];
  /** Every line said so far, the player's own among them: what the journal keeps once it closes. */
  log?: TalkLogLine[];
}

/** A substitution's words as the window is handed them: worked out, or one the browser fills (a name). */
export type FillView = string | { en: string } | { ask: 'player.name' | 'player.title' | 'npc.name' };

export interface LineView {
  text: TextRef;
  fill?: Partial<Record<FillKey, FillView>>;
  /** As the tree writes it: absent is the game's to choose, null none. */
  gesture?: string | null;
  tone?: Tone;
  shot?: Shot | null;
  wait?: number;
  id?: string;
}

export interface ReplyView {
  id: string;
  text: TextRef;
  /** What the player says aloud; null says nothing. */
  said: TextRef | null;
  enabled: boolean;
  why?: TextRef;
  stakes?: TextRef;
  gesture?: string | null;
  shot?: Shot | null;
  /** The conversation ends after it. */
  ends?: true;
}

export interface NodeView {
  speaker: string;
  tree: string;
  node: string;
  /** The speaker as the player knows them: their name once given, else what they are called until then. */
  name?: TextRef;
  /** The client string table a `:key` text is read from. */
  strings?: string;
  lines: LineView[];
  replies: ReplyView[];
  /** It goes on by itself once its lines are said: the browser asks for the next node. */
  next: boolean;
  /** The conversation ends once its lines are said. */
  end: boolean;
}

/** What one turn came to: where the conversation stands now (null once it has ended), the node to show, and why not when it did not happen. */
export interface TalkTurn {
  state: TalkState | null;
  view: NodeView | null;
  why: string | null;
  /** The tree was revised under the conversation, which started again at its entry. */
  restarted?: true;
  /** Every line said so far, kept on the turn too, since a turn that ends the conversation leaves no state to keep it on. */
  log?: TalkLogLine[];
}

/** What a turn's work left for the view to be made from once everything it set off has run. */
export interface TalkPending {
  state: TalkState | null;
  why: string | null;
  restarted?: true;
  log?: TalkLogLine[];
}

// ---- who speaks -----------------------------------------------------------------------------------------

/** A cast member of the sets in use, or null. */
export function castIn(lib: StorySet, who: string): CastDef | null {
  return lib.cast && Object.hasOwn(lib.cast, who) ? lib.cast[who] : null;
}

/**
 * The conversation a speaker speaks, or null, in the order a speaker is resolved in: a cast member's own
 * `tree` (one of the game's own people a cast file promotes included); then one of the game's own people
 * (`row:<key>`) by the creature they are stood as (`creature`), through the conversations the game's own
 * people have been given (`voices`, which binds only a tree that may be played). Anybody else has none, and
 * greets in the client's reaction lines or the game's own.
 */
export function treeFor(lib: StorySet, who: string, creature?: string | null): TalkDef | null {
  const c = castFor(lib, who);
  let id = c?.tree ?? null;
  if (!id && who.startsWith('row:') && creature && lib.voices && Object.hasOwn(lib.voices, creature)) id = lib.voices[creature];
  return id && lib.talks && Object.hasOwn(lib.talks, id) ? lib.talks[id] : null;
}

/** The speaker's name as this character knows them: given (`named`), or what they are called until then. */
export function nameFor(book: StoryBook, lib: StorySet, who: string): TextRef | null {
  const c = castFor(lib, who);
  if (!c) return null;
  return ownOf(book.npcs, whoOf(lib, who))?.named !== undefined ? c.name : c.unknownAs;
}

// ---- the work, on a copy of the book ---------------------------------------------------------------------

/** The book remembers something heard, the first time only (a second would be refused, and say so). */
function hear(d: Draft, key: string): void {
  if (ownOf(d.book.heard, key) === undefined) d.change({ k: 'heard', key, at: d.ctx.now });
}

/** The book remembers meeting somebody, the first time only. */
function meet(d: Draft, who: string): void {
  if (ownOf(d.book.npcs, who)?.met === undefined) d.change({ k: 'npcMet', who, at: d.ctx.now });
}

/** A transcript with more lines on it, held to its length. */
function logged(log: readonly TalkLogLine[] | undefined, more: TalkLogLine[]): TalkLogLine[] {
  const out = [...(log ?? []), ...more];
  return out.length > JOURNAL_TUNE.talkLines ? out.slice(0, JOURNAL_TUNE.talkLines) : out;
}

/**
 * A text as the transcript keeps it: a line of the tree's own string table (`:key`) written out whole
 * (`@<table>:<key>`), so it still says which line it was once the conversation it was said in is gone.
 */
export function wholeRef(text: TextRef, strings: string | null | undefined): TextRef {
  const rel = relativeKey(text);
  return rel !== null && strings ? `@${strings}:${rel}` : text;
}

/** A node's lines as the transcript keeps them: their words as written, with every substitution the book can fill. */
function logLines(n: NodeDef, book: StoryBook, strings: string | null): TalkLogLine[] {
  return n.say.map((l) => {
    const line: TalkLogLine = { text: wholeRef(l.text, strings) };
    const fill = fillView(l, book);
    if (fill) {
      const known: Partial<Record<FillKey, string>> = {};
      for (const k of FILL_KEYS) {
        const v = fill[k];
        if (typeof v === 'string') known[k] = v;
        else if (v && 'en' in v) known[k] = v.en;
      }
      if (Object.keys(known).length) line.fill = known;
    }
    return line;
  });
}

/** A node reached: heard, its actions run, and the talk steps told (after the actions, so a job one grants is told too). */
function enter(d: Draft, tree: TalkDef, speaker: string, node: string, path: readonly string[], who: string | null, log?: readonly TalkLogLine[]): TalkPending {
  const n = tree.nodes[node];
  if (!n) return { state: null, why: 'that part of the conversation is not there', log: log ? [...log] : [] };
  hear(d, `${tree.id}#${node}`);
  d.actions(n.do, { talk: tree.id, site: node });
  d.raiseLater(`talked:${speaker}#${node}`);
  d.raiseLater(`talked:${speaker}`);
  const said = logged(log, logLines(n, d.book, tree.strings));
  return { state: { speaker, ...(who ? { who } : {}), tree: tree.id, hash: tree.hash, node, path: [...path, node], log: said }, why: null, log: said };
}

/**
 * Open a conversation with somebody: the first entry whose condition holds, the person met. One of the
 * game's own people is named by the creature they are stood as (`who`), which is what binds them to a
 * conversation. `tree` opens that conversation whoever speaks it, which only the console's review of a
 * conversation does (`__debug.talkTree({ core3 })`), on a book of its own.
 */
export function talkOpenWork(d: Draft, speaker: string, who: string | null = null, tree: string | null = null): TalkPending {
  const def = tree ? (d.lib.talks && Object.hasOwn(d.lib.talks, tree) ? d.lib.talks[tree] : null) : treeFor(d.lib, speaker, who);
  if (!def) return { state: null, why: 'they have nothing to say' };
  // Somebody the story killed says nothing to anybody, and somebody who has refused the character says only that.
  // The console's review of a conversation is on a book of its own, and is never refused.
  if (!tree) {
    const no = whyNotSpeak(d.book, d.lib, whoOf(d.lib, speaker), d.ctx.now);
    if (no) return { state: null, why: no };
  }
  meet(d, whoOf(d.lib, speaker));
  // When and where they were last seen, and the companion waiting here brought back.
  if (!tree) d.seen(speaker);
  for (const e of def.entry) {
    if (e.when && !d.holds(e.when)) continue;
    return enter(d, def, speaker, e.to, [], who);
  }
  // The checker refuses a tree whose last entry has a condition, so this is a set that was never checked.
  return { state: null, why: 'nothing they say fits just now' };
}

/** Whether an answer is offered just now, and whether it may be chosen: hidden, greyed, or open. */
export function replyOpen(book: StoryBook, tree: TalkDef, node: NodeDef, r: ReplyDef, ctx: StoryCtx, tally?: Tally, lib?: StorySet | null): 'hidden' | 'disabled' | 'open' {
  if (r.once && ownOf(book.heard, `${tree.id}#${node.id}.${r.id}`) !== undefined) return 'hidden';
  if (r.when && !evalCond(r.when, book, ctx, {}, tally, lib)) return r.show === 'disable' ? 'disabled' : 'hidden';
  return 'open';
}

/**
 * An answer given (`reply`), or the node going on by itself (null). Refused when the conversation is not where
 * the answer belongs, or the answer is not open; started again at the entry when the tree was revised.
 */
export function talkPickWork(d: Draft, state: TalkState, reply: string | null): TalkPending {
  const tree = d.lib.talks && Object.hasOwn(d.lib.talks, state.tree) ? d.lib.talks[state.tree] : null;
  const node = tree?.nodes[state.node];
  if (!tree || tree.hash !== state.hash || !node) return { ...talkOpenWork(d, state.speaker, state.who ?? null), restarted: true };
  if (reply === null) {
    if (!node.next || node.replies.length) return { state, why: 'that part of the conversation waits for an answer', log: state.log };
    return enter(d, tree, state.speaker, node.next, state.path, state.who ?? null, state.log);
  }
  const r = node.replies.find((x) => x.id === reply);
  if (!r) return { state, why: 'there is no such answer', log: state.log };
  if (replyOpen(d.book, tree, node, r, d.ctx, d.tally, d.lib) !== 'open') return { state, why: 'that answer is not open', log: state.log };
  hear(d, `${tree.id}#${node.id}.${r.id}`);
  d.actions(r.do, { talk: tree.id, site: `${node.id}.${r.id}` });
  // What the player says aloud goes into the transcript; a silent answer says nothing.
  const said = r.said === null ? logged(state.log, []) : logged(state.log, [{ you: 1, text: wholeRef(r.said ?? r.text, tree.strings) }]);
  if (!r.to) return { state: null, why: null, log: said };
  return enter(d, tree, state.speaker, r.to, [...state.path, r.id], state.who ?? null, said);
}

/**
 * A conversation's transcript, written into the journal once its window has closed: every line by the hash of
 * its words, the speaker as the player knew them then. A line written in the story's own words is kept with
 * every substitution the host could fill (the player's own name is filled as it is shown); one in the client's
 * words is kept as the browser read it out (`read`, by its reference), and as its reference when it did not.
 * Nothing when nothing was said. The entry, or null.
 */
export function talkJournalWork(d: Draft, speaker: string, log: readonly TalkLogLine[], read: Readonly<Record<string, string>>, name: string | null): ReturnType<Draft['writeJournal']> {
  if (!log.length) return null;
  const lines: JournalLine[] = [];
  const texts: Record<string, string> = Object.create(null);
  for (const l of log) {
    const lit = literalOf(l.text);
    let words: string | null = lit;
    if (words !== null && l.fill) for (const k of FILL_KEYS) if (l.fill[k] !== undefined) words = words.split(`%${k}`).join(l.fill[k]!);
    if (words === null && typeof l.text === 'string' && Object.hasOwn(read, l.text)) words = read[l.text];
    if (words === null) {
      if (typeof l.text === 'string') lines.push({ ...(l.you ? { you: 1 as const } : {}), ref: l.text });
      continue;
    }
    const h = textHash(words);
    texts[h] = words;
    lines.push({ ...(l.you ? { you: 1 as const } : {}), h });
  }
  const known = nameFor(d.book, d.lib, speaker);
  const title = (known ? literalOf(known) : null) ?? name ?? '';
  return d.writeJournal({ kind: 'talk', with: [speaker], lines, ...(title ? { title: title.slice(0, 160) } : {}) }, texts);
}

// ---- what the window is shown ------------------------------------------------------------------------------

function fillView(l: LineDef, book: StoryBook): Partial<Record<FillKey, FillView>> | undefined {
  if (!l.fill) return undefined;
  const out: Partial<Record<FillKey, FillView>> = {};
  for (const k of FILL_KEYS) {
    const src = l.fill[k];
    if (src === undefined) continue;
    if (typeof src === 'string') out[k] = { ask: src };
    else if ('flag' in src) {
      const v = ownOf(book.flags, src.flag);
      if (v !== undefined) out[k] = String(v);
    } else if ('quest' in src) {
      const v = ownOf(book.quests, src.quest)?.params?.[src.var];
      if (v !== undefined) out[k] = String(v);
    } else if ('text' in src) out[k] = typeof src.text === 'string' ? src.text : { en: src.text.en };
    else if ('number' in src) out[k] = String(src.number);
    // A job's cost or reward is a later wave's (the job boards'), and leaves its place as written.
  }
  return Object.keys(out).length ? out : undefined;
}

function lineView(l: LineDef, book: StoryBook): LineView {
  const v: LineView = { text: l.text };
  const fill = fillView(l, book);
  if (fill) v.fill = fill;
  if (l.gesture !== undefined) v.gesture = l.gesture;
  if (l.tone) v.tone = l.tone;
  if (l.shot !== undefined) v.shot = l.shot;
  if (l.wait) v.wait = l.wait;
  if (l.id) v.id = l.id;
  return v;
}

/** The first gesture a list of actions plays (`gesture(clip)`), or null. */
function gestureAction(list: readonly { act: string; args: unknown[] }[]): string | null {
  for (const a of list) if (a.act === 'gesture' && typeof a.args[0] === 'string') return a.args[0];
  return null;
}

/** What the window is shown of the node a conversation stands at, read off the book as it now is. */
export function nodeView(book: StoryBook, lib: StorySet, state: TalkState, ctx: StoryCtx, tally?: Tally): NodeView | null {
  const tree = lib.talks && Object.hasOwn(lib.talks, state.tree) ? lib.talks[state.tree] : null;
  const node = tree?.nodes[state.node];
  if (!tree || !node) return null;
  const lines = node.say.map((l) => lineView(l, book));
  // A node's own `gesture(clip)` goes on its first line the tree leaves to the game.
  const nodeGesture = gestureAction(node.do);
  if (nodeGesture) {
    const free = lines.find((l) => l.gesture === undefined);
    if (free) free.gesture = nodeGesture;
  }
  const replies: ReplyView[] = [];
  for (const r of node.replies) {
    const open = replyOpen(book, tree, node, r, ctx, tally, lib);
    if (open === 'hidden') continue;
    const v: ReplyView = { id: r.id, text: r.text, said: r.said === undefined ? r.text : r.said, enabled: open === 'open' };
    if (open === 'disabled' && r.why) v.why = r.why;
    if (r.stakes) v.stakes = r.stakes;
    const g = r.gesture !== undefined ? r.gesture : gestureAction(r.do);
    if (g !== null || r.gesture === null) v.gesture = g;
    if (r.shot !== undefined) v.shot = r.shot;
    if (!r.to) v.ends = true;
    replies.push(v);
  }
  const view: NodeView = { speaker: state.speaker, tree: tree.id, node: node.id, lines, replies, next: !!node.next && !node.replies.length, end: node.end || (!node.next && !node.replies.length) };
  const name = nameFor(book, lib, state.speaker);
  if (name) view.name = name;
  if (tree.strings) view.strings = tree.strings;
  return view;
}

// ---- a node off the wire ------------------------------------------------------------------------------------
//
// A browser on a server is handed nodes, never trees: each is rebuilt here the house way before anything
// reads it, as the rest of a view is (`view.ts`).

/** The caps on a node off the wire. Ours, and far past what a conversation says at once. */
export const NODE_WIRE = { lines: 32, replies: 16, path: 64 };

const TREE_ID = /^[A-Za-z0-9_-]{1,24}:talk\/[A-Za-z0-9_.-]{1,96}$/;
const SLOT = /^[@A-Za-z0-9_:.-]{1,80}$/;
const STRINGS = /^[A-Za-z0-9_/.-]{1,120}$/;

function textOff(x: unknown): TextRef | null {
  return cleanTextRef(x, TEXT_MAX);
}

function slotOff(x: unknown): string | null | undefined {
  if (x === null) return null;
  return typeof x === 'string' && SLOT.test(x) ? x : undefined;
}

function shotOff(x: unknown): Shot | null | undefined {
  if (x === null) return null;
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const o = x as Record<string, unknown>;
  if (!(SHOT_KINDS as readonly unknown[]).includes(o.kind)) return undefined;
  return o.side === 'left' || o.side === 'right' ? { kind: o.kind as ShotKind, side: o.side } : { kind: o.kind as ShotKind };
}

function fillOff(x: unknown): Partial<Record<FillKey, FillView>> | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const out: Partial<Record<FillKey, FillView>> = {};
  for (const k of FILL_KEYS) {
    const v = (x as Record<string, unknown>)[k];
    if (typeof v === 'string') out[k] = v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if (o.ask === 'player.name' || o.ask === 'player.title' || o.ask === 'npc.name') out[k] = { ask: o.ask };
      else if (typeof o.en === 'string') out[k] = { en: o.en.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200) };
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function lineOff(x: unknown): LineView | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const text = textOff(o.text);
  if (!text) return null;
  const v: LineView = { text };
  const fill = fillOff(o.fill);
  if (fill) v.fill = fill;
  const g = slotOff(o.gesture);
  if (g !== undefined) v.gesture = g;
  if (typeof o.tone === 'string' && (TONES as readonly string[]).includes(o.tone)) v.tone = o.tone as Tone;
  const shot = shotOff(o.shot);
  if (shot !== undefined) v.shot = shot;
  if (typeof o.wait === 'number' && Number.isFinite(o.wait) && o.wait > 0 && o.wait <= 60) v.wait = o.wait;
  if (isNodeName(o.id)) v.id = o.id;
  return v;
}

function replyOff(x: unknown): ReplyView | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const text = textOff(o.text);
  if (!isNodeName(o.id) || !text) return null;
  const v: ReplyView = { id: o.id, text, said: o.said === null ? null : (textOff(o.said) ?? text), enabled: o.enabled !== false };
  const why = textOff(o.why);
  if (why) v.why = why;
  const stakes = textOff(o.stakes);
  if (stakes) v.stakes = stakes;
  const g = slotOff(o.gesture);
  if (g !== undefined) v.gesture = g;
  const shot = shotOff(o.shot);
  if (shot !== undefined) v.shot = shot;
  if (o.ends === true) v.ends = true;
  return v;
}

/** A node as a server sends it (the word's own fields), rebuilt, or null when it is not one. */
export function cleanNodeView(x: unknown): NodeView | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (!isWho(o.speaker) || typeof o.tree !== 'string' || !TREE_ID.test(o.tree) || !isNodeName(o.node)) return null;
  const lines: LineView[] = [];
  if (Array.isArray(o.lines)) for (const l of o.lines) {
    const line = lineOff(l);
    if (line && lines.length < NODE_WIRE.lines) lines.push(line);
  }
  const replies: ReplyView[] = [];
  if (Array.isArray(o.replies)) for (const r of o.replies) {
    const reply = replyOff(r);
    if (reply && replies.length < NODE_WIRE.replies && !replies.some((x) => x.id === reply.id)) replies.push(reply);
  }
  const view: NodeView = { speaker: o.speaker, tree: o.tree, node: o.node, lines, replies, next: o.next === true, end: o.end === true };
  const name = textOff(o.name);
  if (name) view.name = name;
  if (typeof o.strings === 'string' && STRINGS.test(o.strings)) view.strings = o.strings;
  return view;
}
