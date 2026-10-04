// The server emulator's conversations made into conversations this game plays: the structure the Core3
// reference keeps (`tools/swg/core3ref/conversations.json`, read by `readConversations` in
// `tools/swg/core3.mjs`) folded into the same `TalkDef` a story's own conversation is, so the one tree
// player (`talkRules.ts`) speaks both. Pure, and read by both hosts: the server folds the reference it
// carries, the browser the part of it the converter wrote beside the packs
// (`assets-private/conversations/core3.json`), and both fold it the same way.
//
// **What a fold is.** A screen is a node: its line is `say[0]` (the client's own string id), its answers
// are the node's replies, each named by its place among them, its `stopConversation` is `end`, and the
// gesture it names is the line's gesture slot (`gestures.ts` reads the server's names). The first screen is
// the one entry, with no condition.
//
// **What is never played as if it were there.** A node whose line the handler writes, whose words were the
// emulator's own English (kept as null), whose answers the handler adds or links to nothing, or which the
// handler names at all -- because whatever the handler did there is not in the structure -- is marked
// `needs` (`logic` or `core3-literal`). A tree with any node so marked that can be reached from its entry
// is not played: nobody is given it as their conversation (`voices`), and whoever would have spoken it
// greets in the client's own reaction lines instead (`reactions.ts`). Of the 289 trees the reference
// keeps, almost every one has a handler that does something, and even one whose handler does nothing is
// played only once an adoption says it is the game's as it stands: nothing is anybody's by default.
//
// **Adopting one.** An adoption is a file of ours in `src/story/core3/` (an overlay), committed under
// the emulator's credit like the reference itself, naming the trees it adopts and writing in our own
// vocabulary what the handler did: a node's actions (`do`), which clears what the handler did there, and
// an answer's condition (`when`). The first is the heralds' (`heralds.jsonc`): seven of the server's
// eight towns' heralds whose handler does one thing, put a waypoint on the place a screen tells of. Their
// places are the reference's own table (`heralds.multi`), so the overlay says only that its trees take
// their waypoints from it (`"waypoints": "heralds"`), and the coordinates are kept in one place.
//
// What is the game's: the client's string ids and the screens' shape. What is the emulator's: which screen
// links to which, and the herald's places. Everything else is ours, and every number here is ours.

import { hashText } from '../net/hash.ts';
import { parseJsonc } from './jsonc.ts';
import { FileScope, stableText, type ActionDef, type CondJson, type Issue, type StorySet } from './set.ts';
import type { EntryDef, LineDef, NodeDef, ReplyDef, TalkDef } from './talkSet.ts';
import { clientKey } from './text.ts';

/** The prefix every folded tree's id takes (`core3:talk/<template>`), which no story set may take. */
export const CORE3_PREFIX = 'core3';

/** What every folded tree and the adoption files say of where the structure came from. */
export const CORE3_CREDIT = "Conversation structure from SWGEmu Core3's scripts (MMOCoreORB/bin/scripts, AGPL-3.0, https://github.com/swgemu/Core3): screen names and links only; the words are the client's own.";

/** Every number of ours the folding reads. */
export const CORE3_TUNE = {
  /**
   * Metres within which a herald's place is the same place another herald names with the client's own
   * string id (`heralds.directions`), whose name it then takes. Every pair the reference has is within 93
   * m of each other, and the next nearest is 148 m off and another place.
   */
  nameNear: 120,
};

/** One answer as the reference keeps it: the client's words (or null), and the screen it leads to (or null). */
export interface Core3Reply {
  text: string | null;
  to: string | null;
  needs?: 'core3-literal';
}

/** One screen as the reference keeps it. */
export interface Core3Node {
  id: string;
  say: string | null;
  end: boolean;
  gesture?: string;
  replies: Core3Reply[];
  needs?: 'core3-literal';
}

/** Where a tree's handler acts, read off what its methods name (`handlerLogic` in `tools/swg/core3.mjs`). */
export interface Core3Logic {
  entry: boolean;
  options: boolean;
  text: boolean;
  screens: string[];
  entries: string[];
  unread?: boolean;
}

export interface Core3Tree {
  file: string;
  initial: string | null;
  handler: string | null;
  nodes: Core3Node[];
  logic: Core3Logic;
  base?: string;
}

/** A herald with several places to tell of: who, where they stand, and the places in their screens' order. */
export interface Core3Herald {
  who: string;
  world: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  cell: number;
  table: string;
  dests: { x: number; z: number; cost?: number; name?: string }[];
}

export interface Core3Heralds {
  multi: Core3Herald[];
  /** The places the other heralds send a player to, each with the client's own name for it. */
  directions: { world: string; x: number; z: number; name: string }[];
}

/** The reference's conversations, as plain tables (what `captureOf` makes of the file in either form). */
export interface Core3Capture {
  trees: Record<string, Core3Tree>;
  shapes: Record<string, unknown>;
  instances: Record<string, { shape: string; handler: string | null; args?: string[] }>;
  heralds: Core3Heralds;
}

/** Who speaks which, and how: a creature's conversation, its reaction table's diction, and its faction. */
export interface Core3Voice {
  tree?: string;
  diction?: string;
  faction?: string;
}

// ---- reading the reference ----------------------------------------------------------------------------

/**
 * A value of the reference's file with its Maps put back as plain tables: the reference writes a Map as
 * `{ "$map": [[key, value], ...] }` (`encodeValue` in `tools/swg/core3ref.mjs`), the converter's own file
 * writes plain objects, and this reads both. Every table is made with no prototype, since its keys are the
 * emulator's names.
 */
export function plainOf(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(plainOf);
  if (!x || typeof x !== 'object') return x;
  // The reference's own reader hands back Maps and Sets themselves (`decodeValue`), the file their tagged form.
  if (x instanceof Map) return plainOf({ $map: [...x] });
  if (x instanceof Set) return [...x].map(plainOf);
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length === 1 && keys[0] === '$map' && Array.isArray(o.$map)) {
    const out: Record<string, unknown> = Object.create(null);
    for (const e of o.$map as unknown[]) if (Array.isArray(e) && typeof e[0] === 'string' && !UNSAFE.has(e[0])) out[e[0]] = plainOf(e[1]);
    return out;
  }
  if (keys.length === 1 && keys[0] === '$set' && Array.isArray(o.$set)) return (o.$set as unknown[]).map(plainOf);
  const out: Record<string, unknown> = Object.create(null);
  for (const k of keys) if (!UNSAFE.has(k)) out[k] = plainOf(o[k]);
  return out;
}

const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const NAME = /^[A-Za-z0-9_.-]{1,96}$/;

function str(x: unknown): string | null {
  return typeof x === 'string' && x ? x : null;
}

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

function nodeOf(x: unknown): Core3Node | null {
  const o = x as Record<string, unknown>;
  if (!o || typeof o !== 'object' || !str(o.id)) return null;
  const n: Core3Node = { id: o.id as string, say: str(o.say), end: o.end === true, replies: [] };
  if (o.needs === 'core3-literal') n.needs = 'core3-literal';
  if (str(o.gesture)) n.gesture = o.gesture as string;
  for (const r of Array.isArray(o.replies) ? o.replies : []) {
    const ro = r as Record<string, unknown>;
    if (!ro || typeof ro !== 'object') continue;
    const reply: Core3Reply = { text: str(ro.text), to: str(ro.to) };
    if (ro.needs === 'core3-literal') reply.needs = 'core3-literal';
    n.replies.push(reply);
  }
  return n;
}

function logicOf(x: unknown): Core3Logic {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
  const l: Core3Logic = { entry: o.entry === true, options: o.options === true, text: o.text === true, screens: list(o.screens), entries: list(o.entries) };
  if (o.unread === true) l.unread = true;
  return l;
}

/** The reference's conversations (`readConversations`' answer, decoded or not) read into plain, checked tables. */
export function captureOf(x: unknown): Core3Capture {
  const o = plainOf(x) as Record<string, unknown> | null;
  const out: Core3Capture = { trees: Object.create(null), shapes: Object.create(null), instances: Object.create(null), heralds: { multi: [], directions: [] } };
  if (!o || typeof o !== 'object') return out;
  const trees = (o.trees ?? {}) as Record<string, unknown>;
  for (const name of Object.keys(trees)) {
    const t = trees[name] as Record<string, unknown>;
    if (!NAME.test(name) || !t || typeof t !== 'object') continue;
    const nodes: Core3Node[] = [];
    for (const n of Array.isArray(t.nodes) ? t.nodes : []) {
      const node = nodeOf(n);
      if (node) nodes.push(node);
    }
    const tree: Core3Tree = { file: str(t.file) ?? '', initial: str(t.initial), handler: str(t.handler), nodes, logic: logicOf(t.logic) };
    if (str(t.base)) tree.base = t.base as string;
    out.trees[name] = tree;
  }
  if (o.shapes && typeof o.shapes === 'object') out.shapes = o.shapes as Record<string, unknown>;
  const inst = (o.instances ?? {}) as Record<string, unknown>;
  for (const name of Object.keys(inst)) {
    const i = inst[name] as Record<string, unknown>;
    if (i && typeof i === 'object' && str(i.shape)) out.instances[name] = { shape: i.shape as string, handler: str(i.handler), ...(Array.isArray(i.args) ? { args: i.args.filter((a): a is string => typeof a === 'string') } : {}) };
  }
  const h = (o.heralds ?? {}) as Record<string, unknown>;
  for (const r of Array.isArray(h.multi) ? h.multi : []) {
    const m = r as Record<string, unknown>;
    if (!m || !str(m.who) || !str(m.world) || !str(m.table) || num(m.x) === null || num(m.z) === null) continue;
    const dests: Core3Herald['dests'] = [];
    for (const d of Array.isArray(m.dests) ? m.dests : []) {
      const dd = d as Record<string, unknown>;
      if (!dd || num(dd.x) === null || num(dd.z) === null) break;
      dests.push({ x: dd.x as number, z: dd.z as number, ...(num(dd.cost) ? { cost: dd.cost as number } : {}), ...(str(dd.name) ? { name: dd.name as string } : {}) });
    }
    out.heralds.multi.push({ who: m.who as string, world: m.world as string, x: m.x as number, y: num(m.y) ?? 0, z: m.z as number, heading: num(m.heading) ?? 0, cell: num(m.cell) ?? 0, table: m.table as string, dests });
  }
  for (const r of Array.isArray(h.directions) ? h.directions : []) {
    const d = r as Record<string, unknown>;
    if (d && str(d.world) && str(d.name) && num(d.x) !== null && num(d.z) !== null) out.heralds.directions.push({ world: d.world as string, x: d.x as number, z: d.z as number, name: d.name as string });
  }
  return out;
}

/** Who speaks which (`readConversationSpeakers`' answer, or the converter's own `speakers.json` table), checked. */
export function voicesOf(x: unknown): Record<string, Core3Voice> {
  const o = plainOf(x) as Record<string, unknown> | null;
  const out: Record<string, Core3Voice> = Object.create(null);
  if (!o || typeof o !== 'object') return out;
  for (const who of Object.keys(o)) {
    const v = o[who] as Record<string, unknown>;
    if (!NAME.test(who) || !v || typeof v !== 'object') continue;
    const voice: Core3Voice = {};
    if (str(v.tree) && NAME.test(v.tree as string)) voice.tree = v.tree as string;
    if (str(v.diction) && /^[A-Za-z0-9_]{1,40}$/.test(v.diction as string)) voice.diction = v.diction as string;
    if (str(v.faction) && /^[A-Za-z0-9_]{1,40}$/.test(v.faction as string)) voice.faction = v.faction as string;
    if (voice.tree || voice.diction || voice.faction) out[who] = voice;
  }
  return out;
}

// ---- the adoptions ----------------------------------------------------------------------------------

/** One overlay of ours: the trees it adopts, and what it writes in our vocabulary for each. */
export interface Core3Overlay {
  file: string;
  trees: Record<string, { waypoints: 'heralds' | null; nodes: Record<string, { do: ActionDef[] }>; replies: Record<string, { when: CondJson | null; show: 'hide' | 'disable'; do: ActionDef[] }> }>;
}

/**
 * The adoption files read and checked, each a JSONC object: `{ format: 1, credit, trees: { <template>: {
 * waypoints?: "heralds", nodes?: { <screen>: { do: [...] } }, replies?: { "<screen>.<n>": { when, show, do }
 * } } } }`. Conditions and actions are read word for word as a story's are (`FileScope`), so an overlay is
 * held to the same vocabulary; every problem names its file and line.
 */
export function readOverlays(files: readonly { path: string; text: string }[]): { overlays: Core3Overlay[]; errors: Issue[]; warnings: Issue[] } {
  const issues: Issue[] = [];
  const overlays: Core3Overlay[] = [];
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (!f.path.endsWith('.jsonc')) continue;
    const doc = parseJsonc(f.text.replace(/\r\n?/g, '\n'));
    if (doc.error) {
      issues.push({ level: 'error', file: f.path, line: doc.error.line, col: doc.error.col, message: doc.error.message });
      continue;
    }
    const s = new FileScope(f.path, doc.lines, CORE3_PREFIX, false, issues);
    const o = doc.value as Record<string, unknown>;
    if (!o || typeof o !== 'object' || Array.isArray(o)) {
      s.err('', 'an adoption file holds one object');
      continue;
    }
    if (o.format !== 1) s.err('/format', 'an adoption file says "format": 1');
    if (typeof o.credit !== 'string' || !/Core3/.test(o.credit)) s.err('/credit', "an adoption of the emulator's conversations carries its credit");
    const overlay: Core3Overlay = { file: f.path, trees: Object.create(null) };
    const trees = o.trees as Record<string, unknown>;
    if (!trees || typeof trees !== 'object' || Array.isArray(trees)) s.err('/trees', 'an adoption names the trees it adopts, in "trees"');
    else
      for (const name of Object.keys(trees)) {
        const p = `/trees/${name}`;
        const t = trees[name] as Record<string, unknown>;
        if (!NAME.test(name) || !t || typeof t !== 'object' || Array.isArray(t)) {
          s.err(p, 'a tree is adopted by its template name, with an object of what the adoption writes');
          continue;
        }
        for (const k of Object.keys(t)) if (!['waypoints', 'nodes', 'replies'].includes(k)) s.warn(`${p}/${k}`, `${k} is not part of an adoption`);
        const entry: Core3Overlay['trees'][string] = { waypoints: null, nodes: Object.create(null), replies: Object.create(null) };
        if (t.waypoints !== undefined) entry.waypoints = t.waypoints === 'heralds' ? 'heralds' : (s.err(`${p}/waypoints`, 'waypoints come from "heralds", the reference\'s own table of places'), null);
        const nodes = (t.nodes ?? {}) as Record<string, unknown>;
        for (const id of Object.keys(nodes)) {
          const n = nodes[id] as Record<string, unknown>;
          if (!n || typeof n !== 'object') continue;
          entry.nodes[id] = { do: s.actions(n.do, `${p}/nodes/${id}/do`) };
        }
        const replies = (t.replies ?? {}) as Record<string, unknown>;
        for (const id of Object.keys(replies)) {
          const r = replies[id] as Record<string, unknown>;
          if (!/^[A-Za-z0-9_-]{1,48}\.\d{1,3}$/.test(id) || !r || typeof r !== 'object') {
            s.err(`${p}/replies/${id}`, 'an answer is adopted as <screen>.<its number among the screen\'s answers, from 0>');
            continue;
          }
          entry.replies[id] = { when: s.cond(r.when, `${p}/replies/${id}/when`), show: s.oneOf(r.show, `${p}/replies/${id}/show`, ['hide', 'disable'] as const, 'hide'), do: s.actions(r.do, `${p}/replies/${id}/do`) };
        }
        overlay.trees[name] = entry;
      }
    overlays.push(overlay);
  }
  return { overlays, errors: issues.filter((i) => i.level === 'error'), warnings: issues.filter((i) => i.level === 'warning') };
}

// ---- folding ------------------------------------------------------------------------------------------

/** One tree folded: the conversation, whether it may be played, and the nodes that keep it from being. */
export interface Core3Fold {
  def: TalkDef;
  /** Nothing reachable from its entry is the handler's or missing: it may be anybody's conversation. */
  playable: boolean;
  /** Every reachable line and answer has the client's words: it can be read through, handler or no (`__debug.talkTree({ core3 })`). */
  complete: boolean;
  /** The reachable nodes marked `needs`, by id. */
  needs: string[];
  /** The places an adoption put a waypoint on, by screen. */
  waypoints: Record<string, { name: string; world: string; x: number; z: number }>;
}

/** A screen of a herald's that tells of a place: `loc1` to `loc4`, and `loc1a`, the first said another way. */
const LOC = /^loc(\d)[a-z]?$/;

/**
 * Where an adopted herald's screen sends a player, and what the waypoint is called: the reference's own
 * place for that screen's number, named with the client's string id the other heralds name that same
 * place with (within `nameNear`), or else with the client's words of the first answer leading to the
 * screen (a question naming the place, or the place's name alone), which on every herald that has no other
 * name is the place's name as the conversation says it. Null when the screen has no place.
 */
function heraldPlace(tree: Core3Tree, node: string, herald: Core3Herald, directions: Core3Heralds['directions']): { name: string; world: string; x: number; z: number } | null {
  const m = LOC.exec(node);
  const d = m ? herald.dests[Number(m[1]) - 1] : undefined;
  if (!d) return null;
  let name = d.name ?? null;
  if (!name) {
    let best = CORE3_TUNE.nameNear;
    for (const r of directions) {
      if (r.world !== herald.world) continue;
      const dist = Math.hypot(r.x - d.x, r.z - d.z);
      if (dist <= best) {
        best = dist;
        name = r.name;
      }
    }
  }
  if (!name) for (const n of tree.nodes) for (const r of n.replies) if (!name && r.to === node && r.text) name = r.text;
  return name ? { name, world: herald.world, x: d.x, z: d.z } : null;
}

const plainLine = (text: string, gesture?: string): LineDef => ({ text, fill: null, tone: null, wait: 0, cues: null, id: null, ...(gesture ? { gesture } : {}) });

/**
 * One tree folded into a conversation (`core3:talk/<name>`), with what an adoption writes laid over it.
 * Pure: the same reference, voices and overlay make the same conversation and the same hash anywhere.
 */
export function foldTree(name: string, t: Core3Tree, opts: { overlay?: Core3Overlay['trees'][string] | null; heralds?: Core3Heralds; voices?: Record<string, Core3Voice> } = {}): Core3Fold {
  const ov = opts.overlay ?? null;
  const ids = new Set(t.nodes.map((n) => n.id));
  const handlerScreens = new Set(t.logic.screens);
  // A handler that sets words or answers without naming where has done so somewhere, and nowhere is safe.
  const everywhere = !!t.logic.unread || ((t.logic.text || t.logic.options) && !handlerScreens.size);
  const nodes: Record<string, NodeDef> = Object.create(null);
  const textless = new Set<string>();
  const waypoints: Core3Fold['waypoints'] = Object.create(null);
  // The herald whose conversation this is, for an adoption that takes its places from them.
  const herald = ov?.waypoints === 'heralds' && opts.heralds && opts.voices ? (opts.heralds.multi.find((h) => opts.voices![h.who]?.tree === name) ?? null) : null;
  for (const n of t.nodes) {
    let needs: NodeDef['needs'] = n.needs ?? null;
    const say: LineDef[] = n.say ? [plainLine(n.say, n.gesture)] : [];
    if (!n.say) textless.add(n.id);
    const replies: ReplyDef[] = [];
    n.replies.forEach((r, i) => {
      if (r.needs) needs = 'core3-literal';
      if (!r.text) {
        textless.add(n.id);
        needs ??= 'logic';
        return;
      }
      // A link to no screen is the handler's to follow, or nothing at all: either way not ours to guess.
      if (!r.to || !ids.has(r.to)) needs ??= 'logic';
      const adopt = ov?.replies[`${n.id}.${i}`];
      replies.push({ id: String(i), text: r.text, when: adopt?.when ?? null, show: adopt?.show ?? 'hide', why: null, stakes: null, pressure: false, once: false, do: adopt?.do ?? [], to: r.to && ids.has(r.to) ? r.to : null });
    });
    if (!n.say) needs ??= 'logic';
    if (!n.end && !n.replies.length) needs ??= 'logic';
    // What the handler did here, unless an adoption writes it.
    const doList: ActionDef[] = [...(ov?.nodes[n.id]?.do ?? [])];
    let covered = !!ov?.nodes[n.id];
    if (herald && LOC.test(n.id)) {
      const place = heraldPlace(t, n.id, herald, opts.heralds!.directions);
      if (place) {
        doList.push({ act: 'waypoint', args: [place.name, place.world, place.x, place.z], wave: 4 });
        waypoints[n.id] = place;
        covered = true;
      }
    }
    if ((handlerScreens.has(n.id) || everywhere) && !covered) needs ??= 'logic';
    nodes[n.id] = { id: n.id, say, replies, next: null, end: n.end, do: doList, needs };
  }
  // Where it starts. A handler that picks the first screen has made the structure's first a guess.
  const start = t.initial && ids.has(t.initial) ? t.initial : (t.logic.entries.find((e) => ids.has(e)) ?? null);
  const entry: EntryDef[] = start ? [{ when: null, to: start, bark: false }] : [];
  if (start && t.logic.entry && nodes[start] && !ov?.nodes[start]) nodes[start].needs ??= 'logic';
  const def: TalkDef = {
    id: `${CORE3_PREFIX}:talk/${name}`,
    rev: 1,
    hash: '',
    source: 'core3',
    credit: CORE3_CREDIT,
    strings: null,
    params: Object.create(null),
    speaker: null,
    entry,
    nodes,
    test: false,
    src: { file: `core3:${t.file}`, lines: new Map() },
  };
  const { src, test, hash, ...pure } = def;
  void src;
  void test;
  void hash;
  def.hash = hashText(stableText(pure)).slice(0, 16);
  // What can be reached from the entry, and what of it is not ours to play.
  const reach = reachable(def);
  const needsList = [...reach].filter((id) => nodes[id]?.needs).sort();
  return { def, playable: !!start && needsList.length === 0, complete: !!start && ![...reach].some((id) => textless.has(id) || nodes[id]?.needs === 'core3-literal'), needs: needsList, waypoints };
}

/** The nodes a conversation can reach from its entries, by its links and its `next`. */
export function reachable(def: TalkDef): Set<string> {
  const seen = new Set<string>();
  const stack = def.entry.map((e) => e.to);
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id) || !def.nodes[id]) continue;
    seen.add(id);
    const n = def.nodes[id];
    if (n.next) stack.push(n.next);
    for (const r of n.replies) if (r.to) stack.push(r.to);
  }
  return seen;
}

/** Every client string table a conversation's words are in: what the browser fetches before a speaker of it is spoken to. */
export function tablesOf(def: TalkDef): string[] {
  const out = new Set<string>();
  const add = (ref: unknown): void => {
    const k = typeof ref === 'string' ? clientKey(ref) : null;
    if (k) out.add(k.table);
  };
  for (const id of Object.keys(def.nodes)) {
    const n = def.nodes[id];
    for (const l of n.say) add(l.text);
    for (const r of n.replies) add(r.text);
    for (const a of n.do) if (a.act === 'waypoint') add(a.args[0]);
  }
  return [...out].sort();
}

// ---- the set ------------------------------------------------------------------------------------------

/** What folding the reference came to, for the console and the tests. */
export interface Core3Report {
  trees: number;
  /** Trees nothing keeps from being played, adopted or not: only the adopted are anybody's (`voices`). */
  playable: string[];
  /** The adopted trees that are played: anybody's conversation who is stood as a creature that speaks one. */
  played: string[];
  complete: number;
  adopted: string[];
  /** Adopted trees that still cannot be played, with the nodes that keep each from it. */
  unplayable: Record<string, string[]>;
  voiced: number;
}

/**
 * The emulator's conversations as a set the hosts join to the story's own (`joinSets`): every tree folded
 * (`core3:talk/<template>`), and `voices`, every creature whose tree may be played, to that tree's id.
 * It lists no set of its own (`sets` is empty), so a server is not "reading a story" for holding it and
 * its hail says nothing new, and its prefix is its own (`core3`), which no story set may take.
 */
export function core3Set(capture: Core3Capture, voices: Record<string, Core3Voice>, overlays: readonly Core3Overlay[] = []): { set: StorySet; report: Core3Report; folds: Record<string, Core3Fold> } {
  const set: StorySet = { name: CORE3_PREFIX, prefix: CORE3_PREFIX, title: '', hash: '', sets: [], test: false, quests: Object.create(null), areas: Object.create(null), objects: Object.create(null), talks: Object.create(null), cast: Object.create(null), voices: Object.create(null), later: [], files: 0 };
  const adopt: Record<string, Core3Overlay['trees'][string]> = Object.create(null);
  for (const o of overlays) for (const name of Object.keys(o.trees)) adopt[name] = o.trees[name];
  const folds: Record<string, Core3Fold> = Object.create(null);
  const report: Core3Report = { trees: 0, playable: [], played: [], complete: 0, adopted: Object.keys(adopt).sort(), unplayable: Object.create(null), voiced: 0 };
  for (const name of Object.keys(capture.trees).sort()) {
    const fold = foldTree(name, capture.trees[name], { overlay: adopt[name] ?? null, heralds: capture.heralds, voices });
    if (!/^[A-Za-z0-9_.-]{1,96}$/.test(name)) continue;
    folds[name] = fold;
    set.talks[fold.def.id] = fold.def;
    report.trees++;
    if (fold.complete) report.complete++;
    if (fold.playable) report.playable.push(name);
    if (adopt[name] && fold.playable) report.played.push(name);
    if (adopt[name] && !fold.playable) report.unplayable[name] = fold.needs;
  }
  // Only an adopted tree is anybody's conversation: one the structure alone could play (a handler that does
  // nothing) is kept and played only once an adoption says it is the game's as it stands.
  for (const who of Object.keys(voices).sort()) {
    const tree = voices[who].tree;
    if (tree && adopt[tree] && folds[tree]?.playable) {
      set.voices![who] = folds[tree].def.id;
      report.voiced++;
    }
  }
  set.hash = hashText(Object.keys(set.talks).map((id) => `${id}:${set.talks[id].hash}`).join('\n')).slice(0, 16);
  return { set, report, folds };
}

/** A herald's standing row's key: what `row:<key>` names them by, the same in every browser and every run. Ours. */
export function heraldKey(h: Pick<Core3Herald, 'world' | 'who'>): string {
  return `h${hashText(`${h.world}|${h.who}|herald`).slice(0, 11)}`;
}
