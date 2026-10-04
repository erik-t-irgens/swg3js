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

import { isWho, ownOf, type StoryBook } from './book.ts';
import { TONES, type Tone } from './gestures.ts';
import { evalCond, type Draft, type StoryCtx, type Tally } from './quests.ts';
import type { CastDef, StorySet } from './set.ts';
import { FILL_KEYS, SHOT_KINDS, isNodeName, type FillKey, type LineDef, type NodeDef, type ReplyDef, type Shot, type ShotKind, type TalkDef } from './talkSet.ts';
import { TEXT_MAX, cleanTextRef, type TextRef } from './text.ts';

/** Where a conversation stands, as a host keeps it for the line it is on and never in the book. */
export interface TalkState {
  /** Who speaks: `<set>:cast/<id>` (or, from a later wave, a game person's `row:<key>`). */
  speaker: string;
  tree: string;
  /** The tree's hash when it began: a tree revised since starts again at its entry. */
  hash: string;
  node: string;
  /** The nodes and answers walked, for the console. */
  path: string[];
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
}

/** What a turn's work left for the view to be made from once everything it set off has run. */
export interface TalkPending {
  state: TalkState | null;
  why: string | null;
  restarted?: true;
}

// ---- who speaks -----------------------------------------------------------------------------------------

/** A cast member of the sets in use, or null. */
export function castIn(lib: StorySet, who: string): CastDef | null {
  return lib.cast && Object.hasOwn(lib.cast, who) ? lib.cast[who] : null;
}

/**
 * The conversation a speaker speaks, or null: a cast member's own `tree`. (The game's own people's bindings
 * are a later wave's; until then nobody but the cast has a tree.)
 */
export function treeFor(lib: StorySet, who: string): TalkDef | null {
  const c = castIn(lib, who);
  const id = c?.tree;
  return id && lib.talks && Object.hasOwn(lib.talks, id) ? lib.talks[id] : null;
}

/** The speaker's name as this character knows them: given (`named`), or what they are called until then. */
export function nameFor(book: StoryBook, lib: StorySet, who: string): TextRef | null {
  const c = castIn(lib, who);
  if (!c) return null;
  return ownOf(book.npcs, who)?.named !== undefined ? c.name : c.unknownAs;
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

/** A node reached: heard, its actions run, and the talk steps told (after the actions, so a job one grants is told too). */
function enter(d: Draft, tree: TalkDef, speaker: string, node: string, path: readonly string[]): TalkPending {
  const n = tree.nodes[node];
  if (!n) return { state: null, why: 'that part of the conversation is not there' };
  hear(d, `${tree.id}#${node}`);
  d.actions(n.do, { talk: tree.id, site: node });
  d.raiseLater(`talked:${speaker}#${node}`);
  d.raiseLater(`talked:${speaker}`);
  return { state: { speaker, tree: tree.id, hash: tree.hash, node, path: [...path, node] }, why: null };
}

/** Open a conversation with somebody: the first entry whose condition holds, the person met. */
export function talkOpenWork(d: Draft, speaker: string): TalkPending {
  const tree = treeFor(d.lib, speaker);
  if (!tree) return { state: null, why: 'they have nothing to say' };
  meet(d, speaker);
  for (const e of tree.entry) {
    if (e.when && !d.holds(e.when)) continue;
    return enter(d, tree, speaker, e.to, []);
  }
  // The checker refuses a tree whose last entry has a condition, so this is a set that was never checked.
  return { state: null, why: 'nothing they say fits just now' };
}

/** Whether an answer is offered just now, and whether it may be chosen: hidden, greyed, or open. */
export function replyOpen(book: StoryBook, tree: TalkDef, node: NodeDef, r: ReplyDef, ctx: StoryCtx, tally?: Tally): 'hidden' | 'disabled' | 'open' {
  if (r.once && ownOf(book.heard, `${tree.id}#${node.id}.${r.id}`) !== undefined) return 'hidden';
  if (r.when && !evalCond(r.when, book, ctx, {}, tally)) return r.show === 'disable' ? 'disabled' : 'hidden';
  return 'open';
}

/**
 * An answer given (`reply`), or the node going on by itself (null). Refused when the conversation is not where
 * the answer belongs, or the answer is not open; started again at the entry when the tree was revised.
 */
export function talkPickWork(d: Draft, state: TalkState, reply: string | null): TalkPending {
  const tree = d.lib.talks && Object.hasOwn(d.lib.talks, state.tree) ? d.lib.talks[state.tree] : null;
  const node = tree?.nodes[state.node];
  if (!tree || tree.hash !== state.hash || !node) return { ...talkOpenWork(d, state.speaker), restarted: true };
  if (reply === null) {
    if (!node.next || node.replies.length) return { state, why: 'that part of the conversation waits for an answer' };
    return enter(d, tree, state.speaker, node.next, state.path);
  }
  const r = node.replies.find((x) => x.id === reply);
  if (!r) return { state, why: 'there is no such answer' };
  if (replyOpen(d.book, tree, node, r, d.ctx, d.tally) !== 'open') return { state, why: 'that answer is not open' };
  hear(d, `${tree.id}#${node.id}.${r.id}`);
  d.actions(r.do, { talk: tree.id, site: `${node.id}.${r.id}` });
  if (!r.to) return { state: null, why: null };
  return enter(d, tree, state.speaker, r.to, [...state.path, r.id]);
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
    const open = replyOpen(book, tree, node, r, ctx, tally);
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
