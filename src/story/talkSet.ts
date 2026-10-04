// A story set's conversations (`talk/<id>.jsonc`) and its cast (`cast/<id>.jsonc`), read into what the tree
// player runs. Pure, and read through the loader's own file scope (`set.ts`), so a conversation's conditions
// and actions are checked word for word as a quest's are, its ids are prefixed the same way, and every
// problem names its file and line.
//
// **A conversation** is a graph of nodes, not a tree: `entry` is tried in order and the first whose `when`
// holds says where it starts (the last has no `when`, so nobody is ever mute); a node says its lines in turn
// (`say`), runs its actions (`do`), and then offers its answers (`replies`), goes on by itself (`next`) or
// ends (`end`). An answer may be hidden or shown greyed with its reason when its `when` fails (`show`,
// `why`), may say what is at stake before it is chosen (`stakes`, never the outcome), may be chosen once
// (`once`), may move Trust (`pressure`), and is said aloud by the player as written unless `said` says
// otherwise (`null` is silent). A line written as plain words is a line with nothing else set.
//
// **The presentation slots.** A line's and an answer's `gesture` and `shot`, a line's `wait` and `cues`,
// are the only fields a cutscene editor would write: left out, the game fills them at play time and never
// writes into the data; written, they win. `null` is a deliberate none. `cues` are kept and not played yet.
//
// **The cast** are the story's named people: a body from the creature catalogue, stood where the file says
// on a world, facing its `heading` (degrees, in the frame its place is written in), in a mood, speaking a
// conversation (`tree`), known by `unknownAs` until somebody introduces them (`introduce`), and stood only
// while `stand` holds. A cast member is essential -- takes no harm and never dies -- unless `mortal`. One may be
// the story's companion (`companion: true`, whom `recruit` takes on). A cast file may instead promote one of the
// game's own people (`row`), which makes them a named person of the story without standing anybody.
//
// Every default here is ours.

import { isStepName } from './book.ts';
import type { CondJson } from './expr.ts';
import { TONES, type Tone } from './gestures.ts';
import type { ActionDef, Room, Source } from './set.ts';
import type { TextRef } from './text.ts';
import { cleanRoom, cleanWorld } from './waypoints.ts';

/** What the loader's file scope does for a conversation: the same checks a quest's fields go through. */
export interface TalkScope {
  prefix: string;
  test: boolean;
  /** The conversation being read, so a node it names without its tree is its own. */
  tree: string | null;
  err(path: string, message: string, rule?: number): null;
  warn(path: string, message: string, rule?: number): void;
  src(): Source;
  text(v: unknown, path: string, required?: boolean): TextRef | null;
  num(v: unknown, path: string, fallback: number, min?: number, max?: number): number;
  int(v: unknown, path: string, fallback: number, min?: number, max?: number): number;
  bool(v: unknown, path: string, fallback: boolean): boolean;
  oneOf<T extends string>(v: unknown, path: string, list: readonly T[], fallback: T): T;
  cond(v: unknown, path: string): CondJson | null;
  actions(v: unknown, path: string): ActionDef[];
  ref(v: unknown, path: string, kind: 'obj' | 'area' | 'cast' | 'doc' | 'talk'): string | null;
}

export const SHOT_KINDS = ['over-player', 'over-npc', 'close-npc', 'close-player', 'two', 'wide', 'hold'] as const;
export type ShotKind = (typeof SHOT_KINDS)[number];
export interface Shot {
  kind: ShotKind;
  side?: 'left' | 'right';
}

/** Where a substitution's words come from: `%TO`, `%TT`, `%DI` and `%DF` in a line. */
export type FillSource = 'player.name' | 'player.title' | 'npc.name' | { flag: string } | { quest: string; var: string } | { text: TextRef } | { number: number } | { credits: 'cost' | 'reward' };
export const FILL_KEYS = ['TO', 'TT', 'DI', 'DF'] as const;
export type FillKey = (typeof FILL_KEYS)[number];

export interface LineDef {
  text: TextRef;
  fill: Partial<Record<FillKey, FillSource>> | null;
  /** Left out (undefined): the game's to choose. `null`: none, by hand. */
  gesture?: string | null;
  tone: Tone | null;
  /** Left out: the game's to choose. `null`: no cut, held as it stands. */
  shot?: Shot | null;
  /** Seconds the line stands after its words have had their time. */
  wait: number;
  /** Sounds, effects and music at moments in the line: kept, and not played yet. */
  cues: unknown[] | null;
  id: string | null;
}

export interface ReplyDef {
  id: string;
  text: TextRef;
  /** What the player says aloud: left out, the answer's own words; `null`, nothing. */
  said?: TextRef | null;
  when: CondJson | null;
  show: 'hide' | 'disable';
  why: TextRef | null;
  stakes: TextRef | null;
  pressure: boolean;
  once: boolean;
  do: ActionDef[];
  /** The node it leads to; null ends the conversation. */
  to: string | null;
  gesture?: string | null;
  shot?: Shot | null;
}

export interface NodeDef {
  id: string;
  say: LineDef[];
  replies: ReplyDef[];
  next: string | null;
  end: boolean;
  do: ActionDef[];
  /** An importer's honest marker that something here is not translated yet: never played as if it were. */
  needs: 'logic' | 'core3-literal' | 'translation' | null;
}

export interface EntryDef {
  when: CondJson | null;
  to: string;
  /** Said over the head, with no window (a later wave's one-liners): kept. */
  bark: boolean;
}

export interface TalkDef {
  /** `<set>:talk/<id>`. */
  id: string;
  rev: number;
  /** The hash of this definition: a conversation revised under somebody mid-talk starts again at its entry. */
  hash: string;
  source: 'own' | 'core3' | 'swg' | 'test';
  credit: string | null;
  /** The client string table a `:key` text is read from. */
  strings: string | null;
  params: Record<string, string>;
  /** The cast member who speaks it, when one alone does. */
  speaker: string | null;
  entry: EntryDef[];
  nodes: Record<string, NodeDef>;
  test: boolean;
  src: Source;
}

export interface CastDef {
  /** `<set>:cast/<id>`. */
  id: string;
  name: TextRef;
  /** What the player calls them until they give their name. */
  unknownAs: TextRef;
  /** The creature catalogue's entry they are stood as. */
  body: string;
  world: string;
  f: 'raw' | 'game';
  /** Across the ground, in the world's own frame for a story (raw on a planet, the game's in space). */
  at: [number, number];
  room?: Room;
  /** Degrees, in the frame `at` is written in. */
  heading: number;
  mood: string | null;
  side: string | null;
  tree: string | null;
  stand: CondJson | null;
  essential: boolean;
  mortal: boolean;
  companion: boolean;
  /**
   * One of the game's own people this file promotes to a named person (`row:<key>`): kept under that row's key,
   * given the name and the side written here, and never stood by the story, since the world stands them.
   */
  row?: string;
  test: boolean;
  src: Source;
}

/** A node's or an answer's own name: plain, no dot, since `<node>.<reply>` is how an answer is named. */
const NODE = /^[A-Za-z0-9_-]{1,48}$/;
const REF_NAME = /^[A-Za-z0-9_.-]{1,96}$/;
const CATALOGUE_ID = /^[A-Za-z0-9_./-]{1,160}$/;
const WORD = /^[A-Za-z0-9_.:-]{1,64}$/;
const STRINGS = /^@?[A-Za-z0-9_/.-]{1,120}$/;

export function isNodeName(x: unknown): x is string {
  return typeof x === 'string' && NODE.test(x) && x !== '__proto__' && x !== 'constructor' && x !== 'prototype';
}

function shotOf(s: TalkScope, v: unknown, path: string): Shot | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === 'string') v = { kind: v };
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== 'object' || Array.isArray(o) || !(SHOT_KINDS as readonly unknown[]).includes(o.kind)) {
    s.err(path, `a shot is one of ${SHOT_KINDS.join(', ')}, or { "kind": ..., "side": "left" | "right" }`);
    return undefined;
  }
  if (o.side !== undefined && o.side !== 'left' && o.side !== 'right') s.err(`${path}/side`, 'a side is left or right');
  return o.side === 'left' || o.side === 'right' ? { kind: o.kind as ShotKind, side: o.side } : { kind: o.kind as ShotKind };
}

/** A gesture slot as written: kept as it came for the checker to judge against the library; only its shape is read here. */
function gestureOf(s: TalkScope, v: unknown, path: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === 'string' && /^[@A-Za-z0-9_:.-]{1,80}$/.test(v)) return v;
  s.err(path, 'a gesture is a clip (emt_nod), a family (@agree), a mood (mood:sad) or null for none');
  return undefined;
}

function fillOf(s: TalkScope, v: unknown, path: string): Partial<Record<FillKey, FillSource>> | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) {
    s.err(path, 'fill is { "TO": source, ... }');
    return null;
  }
  const out: Partial<Record<FillKey, FillSource>> = {};
  for (const k of Object.keys(v)) {
    const p = `${path}/${k}`;
    const x = (v as Record<string, unknown>)[k];
    if (!(FILL_KEYS as readonly string[]).includes(k)) {
      s.err(p, `${k} is not a substitution: TO, TT, DI or DF`);
      continue;
    }
    if (x === 'player.name' || x === 'player.title' || x === 'npc.name') {
      out[k as FillKey] = x;
      continue;
    }
    const o = x as Record<string, unknown>;
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      if (typeof o.flag === 'string' && Object.keys(o).length === 1) out[k as FillKey] = { flag: o.flag };
      else if (typeof o.quest === 'string' && typeof o.var === 'string') out[k as FillKey] = { quest: o.quest.includes(':') ? o.quest : `${s.prefix}:${o.quest}`, var: o.var };
      else if (o.text !== undefined) {
        const t = s.text(o.text, `${p}/text`);
        if (t) out[k as FillKey] = { text: t };
      } else if (typeof o.number === 'number' && Number.isFinite(o.number)) out[k as FillKey] = { number: o.number };
      else if (o.credits === 'cost' || o.credits === 'reward') out[k as FillKey] = { credits: o.credits };
      else s.err(p, 'a substitution comes from player.name, player.title, npc.name, { flag }, { quest, var }, { text }, { number } or { credits }');
      continue;
    }
    s.err(p, 'a substitution comes from player.name, player.title, npc.name, { flag }, { quest, var }, { text }, { number } or { credits }');
  }
  return out;
}

function lineOf(s: TalkScope, v: unknown, path: string): LineDef | null {
  // A line written as its words alone is a line with nothing else set.
  if (typeof v === 'string' || (v && typeof v === 'object' && !Array.isArray(v) && 'en' in v && Object.keys(v).length === 1)) {
    const text = s.text(v, path, true);
    return text ? { text, fill: null, tone: null, wait: 0, cues: null, id: null } : null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return s.err(path, 'a line is its words, or { "text": ..., ... }');
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['text', 'fill', 'gesture', 'tone', 'shot', 'wait', 'cues', 'id'].includes(k)) s.warn(`${path}/${k}`, `${k} is not part of a line`);
  const text = s.text(o.text, `${path}/text`, true);
  if (!text) return null;
  const line: LineDef = {
    text,
    fill: fillOf(s, o.fill, `${path}/fill`),
    tone: o.tone === undefined ? null : s.oneOf(o.tone, `${path}/tone`, TONES, 'warm'),
    wait: s.num(o.wait, `${path}/wait`, 0, 0, 60),
    cues: null,
    id: null,
  };
  const g = gestureOf(s, o.gesture, `${path}/gesture`);
  if (g !== undefined) line.gesture = g;
  const shot = shotOf(s, o.shot, `${path}/shot`);
  if (shot !== undefined) line.shot = shot;
  if (o.cues !== undefined) {
    if (!Array.isArray(o.cues)) s.err(`${path}/cues`, 'cues are a list of { at, sound?, effect?, music? }');
    else {
      line.cues = JSON.parse(JSON.stringify(o.cues)) as unknown[];
      s.warn(`${path}/cues`, 'cues are kept and not played yet');
    }
  }
  if (o.id !== undefined) {
    if (isNodeName(o.id)) line.id = o.id;
    else s.err(`${path}/id`, 'a line\'s id is a plain name');
  }
  return line;
}

function replyOf(s: TalkScope, v: unknown, path: string): ReplyDef | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return s.err(path, 'an answer is { "id", "text", ... }');
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['id', 'text', 'said', 'when', 'show', 'why', 'stakes', 'pressure', 'once', 'do', 'to', 'gesture', 'shot'].includes(k)) s.warn(`${path}/${k}`, `${k} is not part of an answer`);
  if (!isNodeName(o.id)) return s.err(`${path}/id`, 'an answer has an "id": a plain name with no dot, kept the same when the words change');
  const text = s.text(o.text, `${path}/text`, true);
  if (!text) return null;
  const r: ReplyDef = {
    id: o.id,
    text,
    when: s.cond(o.when, `${path}/when`),
    show: s.oneOf(o.show, `${path}/show`, ['hide', 'disable'] as const, 'hide'),
    why: s.text(o.why, `${path}/why`),
    stakes: s.text(o.stakes, `${path}/stakes`),
    pressure: s.bool(o.pressure, `${path}/pressure`, false),
    once: s.bool(o.once, `${path}/once`, false),
    do: s.actions(o.do, `${path}/do`),
    to: o.to === undefined || o.to === null ? null : isNodeName(o.to) ? o.to : s.err(`${path}/to`, `${JSON.stringify(o.to)} is not a node's name`),
  };
  if (o.said === null) r.said = null;
  else if (o.said !== undefined) {
    const said = s.text(o.said, `${path}/said`);
    if (said) r.said = said;
  }
  if (r.show === 'disable' && !r.why) s.warn(`${path}/why`, 'an answer shown greyed says why, or the player sees no reason');
  const g = gestureOf(s, o.gesture, `${path}/gesture`);
  if (g !== undefined) r.gesture = g;
  const shot = shotOf(s, o.shot, `${path}/shot`);
  if (shot !== undefined) r.shot = shot;
  return r;
}

function nodeOf(s: TalkScope, id: string, v: unknown, path: string): NodeDef | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return s.err(path, 'a node is { "say": [...], "replies": [...] }');
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['say', 'replies', 'next', 'end', 'do', 'needs'].includes(k)) s.warn(`${path}/${k}`, `${k} is not part of a node`);
  const say: LineDef[] = [];
  const lines = o.say === undefined ? [] : Array.isArray(o.say) ? o.say : [o.say];
  lines.forEach((l, i) => {
    const line = lineOf(s, l, Array.isArray(o.say) ? `${path}/say/${i}` : `${path}/say`);
    if (line) say.push(line);
  });
  const replies: ReplyDef[] = [];
  if (o.replies !== undefined) {
    if (!Array.isArray(o.replies)) s.err(`${path}/replies`, 'replies are a list');
    else
      o.replies.forEach((r, i) => {
        const reply = replyOf(s, r, `${path}/replies/${i}`);
        if (!reply) return;
        if (replies.some((x) => x.id === reply.id)) s.err(`${path}/replies/${i}/id`, `${reply.id} is the id of another answer of this node`, 1);
        else replies.push(reply);
      });
  }
  return {
    id,
    say,
    replies,
    next: o.next === undefined || o.next === null ? null : isNodeName(o.next) ? o.next : s.err(`${path}/next`, `${JSON.stringify(o.next)} is not a node's name`),
    end: s.bool(o.end, `${path}/end`, false),
    do: s.actions(o.do, `${path}/do`),
    needs: o.needs === undefined ? null : s.oneOf(o.needs, `${path}/needs`, ['logic', 'core3-literal', 'translation'] as const, 'logic'),
  };
}

/** One conversation file, read and checked as far as it stands alone; its hash is the loader's to put on. */
export function talkOf(s: TalkScope, v: unknown): TalkDef | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return s.err('', 'a conversation file holds one conversation object');
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !REF_NAME.test(o.id) || o.id.includes(':')) return s.err('/id', 'a conversation needs an "id": a plain name, which the set\'s prefix is put in front of');
  for (const k of Object.keys(o)) if (!['format', 'id', 'rev', 'source', 'credit', 'strings', 'params', 'speaker', 'entry', 'nodes'].includes(k)) s.warn(`/${k}`, `${k} is not a field of a conversation`);
  if (o.format !== 1) s.err('/format', 'a conversation says "format": 1');
  const id = `${s.prefix}:talk/${o.id}`;
  s.tree = id;
  const nodes: Record<string, NodeDef> = Object.create(null);
  if (!o.nodes || typeof o.nodes !== 'object' || Array.isArray(o.nodes)) s.err('/nodes', 'a conversation has nodes, by name');
  else
    for (const name of Object.keys(o.nodes)) {
      const p = `/nodes/${name}`;
      if (!isNodeName(name)) {
        s.err(p, `${JSON.stringify(name)} is not a node's name: a plain name with no dot`);
        continue;
      }
      const n = nodeOf(s, name, (o.nodes as Record<string, unknown>)[name], p);
      if (n) nodes[name] = n;
    }
  const entry: EntryDef[] = [];
  if (!Array.isArray(o.entry) || !o.entry.length) s.err('/entry', 'a conversation says where it starts: "entry", a list whose last has no condition');
  else
    o.entry.forEach((e, i) => {
      const p = `/entry/${i}`;
      const r = e as Record<string, unknown>;
      if (!r || typeof r !== 'object' || Array.isArray(r)) {
        s.err(p, 'an entry is { "when": condition, "to": node }');
        return;
      }
      for (const k of Object.keys(r)) if (!['when', 'to', 'bark'].includes(k)) s.warn(`${p}/${k}`, `${k} is not part of an entry`);
      const to = isNodeName(r.to) ? r.to : s.err(`${p}/to`, 'an entry names the node it starts at');
      const when = r.when === undefined ? null : s.cond(r.when, `${p}/when`);
      if (to) entry.push({ when, to, bark: s.bool(r.bark, `${p}/bark`, false) });
    });
  const params: Record<string, string> = Object.create(null);
  if (o.params !== undefined) {
    if (!o.params || typeof o.params !== 'object' || Array.isArray(o.params)) s.err('/params', 'params are { name: value }');
    else for (const k of Object.keys(o.params)) {
      const val = (o.params as Record<string, unknown>)[k];
      if (isStepName(k) && typeof val === 'string' && val.length <= 200) params[k] = val;
      else s.err(`/params/${k}`, 'a parameter is a plain name with words for its value');
    }
  }
  const def: TalkDef = {
    id,
    rev: s.int(o.rev, '/rev', 1, 1, 1e9),
    hash: '',
    source: s.oneOf(o.source, '/source', ['own', 'core3', 'swg', 'test'] as const, s.test ? 'test' : 'own'),
    credit: typeof o.credit === 'string' ? o.credit.slice(0, 400) : null,
    strings: o.strings === undefined ? null : typeof o.strings === 'string' && STRINGS.test(o.strings) ? o.strings.replace(/^@/, '') : s.err('/strings', 'strings names a client string table'),
    params,
    speaker: o.speaker === undefined ? null : s.ref(o.speaker, '/speaker', 'cast'),
    entry,
    nodes,
    test: s.test,
    src: s.src(),
  };
  s.tree = null;
  return def;
}

/** A row of the game's own people, as a cast file promotes one. */
const ROW = /^row:[A-Za-z0-9_.-]{1,96}$/;

/**
 * One cast file, read and checked as far as it stands alone. A file with a `row` promotes one of the game's own
 * people to a named person instead (`{ "id", "row": "row:<key>", "name", "unknownAs", "side", "tree" }`): it
 * stands nobody, so it names no body, world or place.
 */
export function castOf(s: TalkScope, v: unknown): CastDef | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return s.err('', 'a cast file holds one person');
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !REF_NAME.test(o.id) || o.id.includes(':')) return s.err('/id', 'a cast member needs an "id": a plain name');
  for (const k of Object.keys(o)) if (!['id', 'name', 'unknownAs', 'body', 'world', 'at', 'room', 'heading', 'mood', 'side', 'tree', 'stand', 'essential', 'mortal', 'companion', 'row'].includes(k)) s.warn(`/${k}`, `${k} is not a field of a cast member`);
  const name = s.text(o.name, '/name', true);
  if (o.row !== undefined) {
    if (typeof o.row !== 'string' || !ROW.test(o.row)) return s.err('/row', 'a promotion names one of the game\'s own people as "row:<key>"');
    for (const k of ['body', 'world', 'at', 'room', 'heading', 'stand', 'companion']) if (o[k] !== undefined) s.warn(`/${k}`, `a promoted row is stood by the world, so its ${k} is not read`);
    const mortal = s.bool(o.mortal, '/mortal', false);
    return {
      id: `${s.prefix}:cast/${o.id}`,
      name: name ?? o.id,
      unknownAs: s.text(o.unknownAs, '/unknownAs') ?? name ?? o.id,
      body: '',
      world: '',
      f: 'raw',
      at: [0, 0],
      heading: 0,
      mood: null,
      side: o.side === undefined ? null : typeof o.side === 'string' && WORD.test(o.side) ? o.side : s.err('/side', 'a side is a plain name'),
      tree: o.tree === undefined ? null : s.ref(o.tree, '/tree', 'talk'),
      stand: null,
      essential: !mortal,
      mortal,
      companion: false,
      row: o.row,
      test: s.test,
      src: s.src(),
    };
  }
  const world = cleanWorld(o.world);
  if (!world) return s.err('/world', 'a cast member names the world they stand on', 7);
  if (typeof o.body !== 'string' || !CATALOGUE_ID.test(o.body)) return s.err('/body', 'a cast member names the creature catalogue entry they are stood as, in "body"');
  const at = o.at;
  if (!Array.isArray(at) || at.length !== 2 || !at.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7)) return s.err('/at', 'at is [x, z], where they stand, in the raw frame on a planet and the game\'s in space');
  let room: Room | undefined;
  if (o.room !== undefined) {
    const r = cleanRoom(o.room);
    if (!r) return s.err('/room', 'a room names its cell, and may name the building\'s template', 7);
    room = r;
  }
  const mortal = s.bool(o.mortal, '/mortal', false);
  const def: CastDef = {
    id: `${s.prefix}:cast/${o.id}`,
    name: name ?? o.id,
    unknownAs: s.text(o.unknownAs, '/unknownAs') ?? name ?? o.id,
    body: o.body,
    world,
    f: world.startsWith('space_') ? 'game' : 'raw',
    at: [at[0] as number, at[1] as number],
    ...(room ? { room } : {}),
    heading: s.num(o.heading, '/heading', 0, -360, 360),
    mood: o.mood === undefined ? null : typeof o.mood === 'string' && WORD.test(o.mood) ? o.mood : s.err('/mood', 'a mood is a plain name'),
    side: o.side === undefined ? null : typeof o.side === 'string' && WORD.test(o.side) ? o.side : s.err('/side', 'a side is a plain name'),
    tree: o.tree === undefined ? null : s.ref(o.tree, '/tree', 'talk'),
    stand: s.cond(o.stand, '/stand'),
    essential: s.bool(o.essential, '/essential', !mortal),
    mortal,
    companion: s.bool(o.companion, '/companion', false),
    test: s.test,
    src: s.src(),
  };
  if (def.essential && def.mortal) s.warn('/essential', 'a cast member who is mortal is not essential: mortal wins');
  if (def.mortal) def.essential = false;
  return def;
}
