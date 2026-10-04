// What the interface is shown of a story, worked out in one place: the jobs with their objective lines,
// the quests' own waypoints, what the detectors should watch, the story objects that answer E, and the
// story's people to stand (the cast, by the name the player knows them by). Pure.
// A browser on a server is sent this (from a later wave) and never the story set, so nothing a player has
// not been shown yet is ever in their browser; with no server the browser works it out itself, from the
// same function.
//
// **Objective lines.** Every visible step has one: the line its author wrote, or one made from its type
// ("Go to the marked place", "Kill a tanc mite", "Come back after 1 game hour") when there is none, with
// its counter, its deadline and its waypoint. A step written `visible: "after"` shows only once it is
// done; one written `false` never does. The words made here are ours and plain, and a literal of the
// author's is never mixed with a reference to a client string.
//
// **A quest's waypoint** is never stored: it is `q:<quest>#<step>`, worked out from the step it belongs
// to, shown as the player last switched it (`qwpOn`, `wpOff`), and otherwise switched on unless its step
// says it starts off. The character's own waypoints are in the book already and are not repeated here.
//
// **Documents and the file.** The documents still to read (`docs`) are listed by their titles, never their
// words: the words come only when one is opened, frozen as it is read (`docRules.ts`). The ISB's file is shown
// as the entries the player may see just now (`file.entries`), each with its kind, its tags and its page, and
// never its weight or the level the file has reached; how coldly a level makes a track's people greet the
// character (`file.react`) is handed over too, since that is the file working on people before the player
// can read why.

import { hashText } from '../net/hash.ts';
import { ownOf, type StepRec, type StoryBook, type Track } from './book.ts';
import { docIn, docsToRead, type DocItem } from './docRules.ts';
import type { CondJson } from './expr.ts';
import { FILE_KINDS, fileOf, reactsAt, revealed, type FileKind } from './file.ts';
import { evalCond, placeOf, whyNotGrant, type StoryCtx } from './quests.ts';
import { stableText, type KillMatch, type QuestDef, type Room, type Shape, type StepDef, type StorySet } from './set.ts';
import { castIn } from './talkRules.ts';
import { literalOf, type TextRef } from './text.ts';
import { STEP_TYPES } from './vocab.ts';
import { WAYPOINT_TUNE, type WaypointColour } from './waypoints.ts';

/** One entry of the ISB's file the player may see: when, what kind, its tags and its page. Never its weight. */
export interface FileEntryView {
  id: string;
  at: number;
  kind: FileKind;
  tags: string[];
  doc?: string;
  docTitle?: string;
}

/** The file as the player may see it, and how coldly it makes each track's people greet them. */
export interface FileView {
  entries: FileEntryView[];
  react?: Partial<Record<Track, 'mid' | 'mean'>>;
}

export interface ObjectiveLine {
  quest: string;
  step: string;
  text: TextRef;
  n?: number;
  of?: number;
  /** When the step runs out, on the shared clock. */
  deadline?: number;
  /** That deadline is a time limit, which fails the step, rather than a timer or a wait, which finishes it. */
  limit?: true;
  /** The quest's waypoint for this step. */
  wp?: string;
  done?: boolean;
}

export interface QuestView {
  id: string;
  title: TextRef;
  client: string;
  state: string;
  outcome?: string;
  lines: ObjectiveLine[];
  card?: string;
  canDrop: boolean;
  canRestart: boolean;
  /** Why it is held, when it is. */
  stalled?: string;
  /** When this run began (or the job was offered), on the shared clock: the newest is the one a tracker with nothing tracked shows. */
  at: number;
}

export interface WaypointView {
  id: string;
  name: TextRef;
  world: string;
  f: 'raw' | 'game';
  p: [number, number, null];
  room?: Room;
  colour: WaypointColour;
  on: boolean;
  quest: string;
  step: string;
}

export type Watch =
  | { k: 'arrive'; quest: string; step: string; world: string; f: 'raw' | 'game'; p: [number, number]; radius: number; room?: Room }
  | { k: 'area'; id: string; world: string; shape: Shape; room?: Room }
  | { k: 'use'; object: string }
  | { k: 'kill'; quest: string; step: string; match: KillMatch }
  | { k: 'room' }
  | { k: 'death' }
  | { k: 'world' };

export interface ObjectView {
  id: string;
  world: string;
  template: string;
  near: [number, number];
  reach: number;
  label: TextRef | null;
}

/**
 * One of the story's named people the browser stands: the body, where (in the frame the story writes places
 * in), which way they face (degrees in that frame), their mood, the name the player knows them by -- their
 * own once they have given it, else what they are called until then -- and whether they have anything to say.
 */
export interface CastView {
  id: string;
  name: TextRef;
  named: boolean;
  body: string;
  world: string;
  f: 'raw' | 'game';
  at: [number, number];
  room?: Room;
  heading: number;
  mood?: string;
  side?: string;
  talk: boolean;
  essential: boolean;
}

export interface StoryView {
  rev: number;
  quests: QuestView[];
  waypoints: WaypointView[];
  watch: Watch[];
  /** The people the story stands just now: every cast member whose `stand` holds. */
  cast: CastView[];
  objects: ObjectView[];
  tracked: string[];
  trackWp: string | null;
  /** The documents still to read, oldest first. Absent: none (and from a server from before them). */
  docs?: DocItem[];
  /** The ISB's file as the player may see it. Absent: there is none. */
  file?: FileView;
}

/** How many ended jobs the view carries, newest first: enough for the quest list, never the whole history. Ours. */
export const VIEW_ENDED_MAX = 50;

/** A quest's waypoint id for one of its steps. */
export function questWaypointId(quest: string, step: string): string {
  return `q:${quest}#${step}`;
}

/**
 * Whether a quest's waypoint shows switched on: the player's own word when they gave one (switched on in
 * `qwpOn`, off in `wpOff`; the book never holds a key in both), and otherwise what its step says.
 */
export function questWaypointOn(book: StoryBook, step: StepDef, id: string): boolean {
  if (book.qwpOn?.includes(id)) return true;
  if (book.wpOff.includes(id)) return false;
  return step.waypoint?.on ?? true;
}

/** A literal label, or the words to fall back on when there is none (or it is a reference). */
function labelOr(label: TextRef | null | undefined, fallback: string): string {
  return (label && literalOf(label)) || fallback;
}

/** What a step's line says: its author's words, or the ones made from its type when there are none. */
export function stepText(step: StepDef, lib: StorySet): TextRef {
  return step.objective ?? madeText(step, lib);
}

/** What a step's line says when its author wrote none. */
function madeText(step: StepDef, lib: StorySet): string {
  switch (step.type) {
    case 'goto':
      return step.at && step.at.room ? 'Go inside to the marked room' : 'Go to the marked place';
    case 'use':
      return `Use ${labelOr(step.object ? lib.objects[step.object]?.label : null, 'the marked thing')}`;
    case 'observe':
      return `Stay in ${labelOr(step.area ? lib.areas[step.area]?.label : null, 'the marked area')}`;
    case 'kill': {
      const m = step.kill;
      const who = m?.who?.length ? m.who.join(' or ') : (m?.social ?? m?.group ?? m?.tag ?? 'the target');
      return `Kill ${who.replace(/_/g, ' ')}`;
    }
    case 'timer':
      return 'Wait';
    case 'wait':
      return `Come back after ${step.for?.words ?? 'a while'}`;
    case 'signal': {
      const s = step.signal ?? '';
      if (s.startsWith('used:')) return `Use ${labelOr(lib.objects[s.slice(5)]?.label, 'the marked thing')}`;
      if (s.startsWith('entered:')) return `Go to ${labelOr(lib.areas[s.slice(8)]?.label, 'the marked area')}`;
      if (s.startsWith('left:')) return `Leave ${labelOr(lib.areas[s.slice(5)]?.label, 'the marked area')}`;
      if (s.startsWith('room:')) return 'Go into the room';
      if (s.startsWith('world:')) return `Travel to ${s.slice(6)}`;
      if (s.startsWith('died:')) return `Kill ${s.slice(5).replace(/_/g, ' ')}`;
      return 'Wait for word';
    }
    case 'talk': {
      const c = step.who && lib.cast && Object.hasOwn(lib.cast, step.who) ? lib.cast[step.who] : null;
      return `Talk to ${labelOr(c?.unknownAs, 'them')}`;
    }
    case 'choice':
      return step.doc ? `Decide: ${labelOr(docIn(lib, step.doc)?.title, 'the marked page')}` : 'Decide';
    case 'message':
    case 'document':
      return `Read: ${labelOr(step.doc ? docIn(lib, step.doc)?.title : null, 'the page handed to you')}`;
    case 'comm': {
      const c = step.who ? castIn(lib, step.who) : null;
      return `Answer the call${c ? ` from ${labelOr(c.unknownAs, 'them')}` : ''}`;
    }
    default:
      return 'Read it';
  }
}

/** One step's objective line, or null for a step that shows none. */
export function objectiveOf(quest: string, step: StepDef, cur: StepRec, lib: StorySet, book: StoryBook, now: number): ObjectiveLine | null {
  if (STEP_TYPES[step.type]?.instant) return null;
  const done = cur.state === 'done';
  if (step.visible === false || (step.visible === 'after' && !done) || (cur.state !== 'active' && !done)) return null;
  const line: ObjectiveLine = { quest, step: step.name, text: stepText(step, lib) };
  if (done) line.done = true;
  if (step.type === 'kill' || ((step.type === 'signal' || step.type === 'use') && step.n > 1)) {
    line.n = Math.min(cur.n, step.n);
    line.of = step.n;
  }
  if (step.type === 'observe') {
    const watched = cur.n + (cur.since !== undefined && !done ? Math.max(0, now - cur.since) : 0);
    line.n = Math.min(step.seconds, Math.floor(watched / 1000));
    line.of = step.seconds;
  }
  if (!done && cur.deadline !== undefined) {
    line.deadline = cur.deadline;
    if (!step.for) line.limit = true;
  }
  const rec = book.quests?.[quest];
  if (!done && rec && placeOf(rec, step, cur)) line.wp = questWaypointId(quest, step.name);
  return line;
}

const AREA_CACHE = new WeakMap<StorySet, string[]>();

/** Every area a condition anywhere in a set names: the detectors watch these so `inArea` can be answered. */
function conditionAreas(lib: StorySet): string[] {
  const cached = AREA_CACHE.get(lib);
  if (cached) return cached;
  const out = new Set<string>();
  const walk = (c: unknown): void => {
    if (!c || typeof c !== 'object') return;
    if (Array.isArray(c)) {
      for (const x of c) walk(x);
      return;
    }
    const o = c as CondJson;
    if (typeof o.inArea === 'string') out.add(o.inArea);
    for (const k of Object.keys(o)) walk(o[k]);
  };
  for (const id of Object.keys(lib.quests)) {
    const q = lib.quests[id];
    walk(q.needs);
    for (const s of Object.keys(q.steps)) {
      const st = q.steps[s];
      walk(st.next.map((e) => e.when));
      walk(st.nextOne.map((e) => e.when));
      walk((st.options ?? []).map((o) => o.when));
    }
  }
  // A conversation's conditions and a cast member's `stand` may ask for an area too.
  for (const id of Object.keys(lib.talks ?? {})) {
    const t = lib.talks[id];
    walk(t.entry.map((e) => e.when));
    for (const n of Object.keys(t.nodes)) walk(t.nodes[n].replies.map((r) => r.when));
  }
  for (const id of Object.keys(lib.cast ?? {})) walk(lib.cast[id].stand);
  const list = [...out].sort();
  AREA_CACHE.set(lib, list);
  return list;
}

function canDrop(def: QuestDef | undefined, state: string): boolean {
  if (state === 'offered' || state === 'stalled') return true;
  return state === 'active' && (!def || def.abandon !== false);
}

function canRestart(def: QuestDef | undefined, state: string): boolean {
  return !!def && def.restart !== 'never' && !def.harsh && (state === 'active' || state === 'failed' || state === 'stalled');
}

/** The whole view of a book: what every piece of the interface reads. */
export function viewOf(book: StoryBook, lib: StorySet, ctx: StoryCtx): StoryView {
  const quests: QuestView[] = [];
  const ended: QuestView[] = [];
  const endedAt = new Map<QuestView, number>();
  const waypoints: WaypointView[] = [];
  const watch: Watch[] = [];
  const objects = new Map<string, ObjectView>();
  const areas = new Set<string>();
  const flags = { room: false, death: false, world: false, use: new Set<string>() };
  const addObject = (id: string): void => {
    const o = lib.objects[id];
    if (o && !objects.has(id)) objects.set(id, { id, world: o.world, template: o.template, near: o.near, reach: o.reach, label: o.label });
  };
  for (const q of Object.keys(book.quests ?? {})) {
    const rec = book.quests![q];
    const def = lib.quests[q];
    if (rec.state === 'none' || rec.state === 'dropped') continue;
    const qv: QuestView = { id: q, title: def?.title ?? q, client: def?.client ?? 'none', state: rec.state, lines: [], canDrop: canDrop(def, rec.state), canRestart: canRestart(def, rec.state), at: rec.at };
    if (rec.outcome !== undefined) qv.outcome = rec.outcome;
    if (def?.card) qv.card = def.card;
    if (rec.state === 'stalled') qv.stalled = rec.why ?? '';
    if (rec.state === 'done' || rec.state === 'failed') {
      ended.push(qv);
      endedAt.set(qv, rec.ended ?? 0);
      continue;
    }
    quests.push(qv);
    if (!def || rec.state !== 'active') continue;
    for (const s of Object.keys(rec.steps)) {
      const cur = rec.steps[s];
      const step = def.steps[s];
      if (!step) continue;
      const line = objectiveOf(q, step, cur, lib, book, ctx.now);
      if (line) qv.lines.push(line);
      if (cur.state !== 'active') continue;
      const place = placeOf(rec, step, cur);
      if (place) {
        const id = questWaypointId(q, s);
        waypoints.push({
          id,
          name: step.objective ?? def.title,
          world: place.world,
          f: place.f,
          p: [place.p[0], place.p[1], null],
          ...(place.room ? { room: place.room } : {}),
          colour: WAYPOINT_TUNE.defaultQuest,
          on: questWaypointOn(book, step, id),
          quest: q,
          step: s,
        });
        if (step.type === 'goto') watch.push({ k: 'arrive', quest: q, step: s, world: place.world, f: place.f, p: [place.p[0], place.p[1]], radius: step.radius, ...(place.room ? { room: place.room } : {}) });
        if (place.room) flags.room = true;
      }
      if (step.type === 'observe' && step.area) areas.add(step.area);
      if (step.type === 'use' && step.object) {
        flags.use.add(step.object);
        addObject(step.object);
      }
      if (step.type === 'kill' && step.kill) watch.push({ k: 'kill', quest: q, step: s, match: step.kill });
      if (step.failOn.includes('death')) flags.death = true;
      const sig = step.type === 'signal' ? (step.signal ?? '') : '';
      if (sig.startsWith('used:')) {
        flags.use.add(sig.slice(5));
        addObject(sig.slice(5));
      } else if (sig.startsWith('entered:') || sig.startsWith('left:')) areas.add(sig.slice(sig.indexOf(':') + 1));
      else if (sig.startsWith('room:')) flags.room = true;
      else if (sig.startsWith('world:')) flags.world = true;
      // A death the player is credited with raises `died:<who>`, which only the kill detector sees.
      else if (sig.startsWith('died:')) watch.push({ k: 'kill', quest: q, step: s, match: { who: [sig.slice(5)] } });
    }
  }
  // The things that give a job the player may take just now answer E too.
  for (const id of Object.keys(lib.quests)) {
    for (const g of lib.quests[id].givers) {
      if (g.kind !== 'use' || flags.use.has(g.object) || whyNotGrant(book, lib, id, ctx)) continue;
      flags.use.add(g.object);
      addObject(g.object);
    }
  }
  for (const id of conditionAreas(lib)) areas.add(id);
  for (const id of [...areas].sort()) {
    const a = lib.areas[id];
    if (a) watch.push({ k: 'area', id, world: a.world, shape: a.shape, ...(a.room ? { room: a.room } : {}) });
  }
  for (const object of [...flags.use].sort()) watch.push({ k: 'use', object });
  if (flags.room) watch.push({ k: 'room' });
  if (flags.death) watch.push({ k: 'death' });
  if (flags.world) watch.push({ k: 'world' });
  ended.sort((a, b) => (endedAt.get(b) ?? 0) - (endedAt.get(a) ?? 0));
  // The story's people: every one whose `stand` holds for this character just now, by the name it knows them by.
  const cast: CastView[] = [];
  for (const id of Object.keys(lib.cast ?? {}).sort()) {
    const c = lib.cast[id];
    if (c.stand && !evalCond(c.stand, book, ctx)) continue;
    const known = book.npcs && Object.hasOwn(book.npcs, id) ? book.npcs[id] : undefined;
    const named = known?.named !== undefined;
    const talk = !!c.tree && !!lib.talks && Object.hasOwn(lib.talks, c.tree);
    const v: CastView = { id, name: named ? c.name : c.unknownAs, named, body: c.body, world: c.world, f: c.f, at: [c.at[0], c.at[1]], heading: c.heading, talk, essential: c.essential };
    if (c.room) v.room = { ...c.room };
    if (c.mood) v.mood = c.mood;
    if (c.side) v.side = c.side;
    cast.push(v);
  }
  const out: StoryView = {
    rev: book.rev,
    quests: [...quests, ...ended.slice(0, VIEW_ENDED_MAX)],
    waypoints,
    watch,
    cast,
    objects: [...objects.values()],
    tracked: [...book.tracked],
    trackWp: book.trackWp,
  };
  const docs = docsToRead(book, lib);
  if (docs.length) out.docs = docs;
  const file = fileView(book, lib, ctx.now);
  if (file) out.file = file;
  return out;
}

/** The ISB's file as the player may see it just now, or null with none: the entries whose time has come or whose page was handed over. */
export function fileView(book: StoryBook, lib: StorySet, now: number): FileView | null {
  const rec = fileOf(book, 'isb');
  if (!rec) return null;
  const entries: FileEntryView[] = [];
  for (const e of rec.entries) {
    if (!revealed(e, now, (d) => ownOf(book.docs, d) !== undefined)) continue;
    const v: FileEntryView = { id: e.id, at: e.at, kind: e.kind, tags: [...e.tags] };
    if (e.doc) {
      v.doc = e.doc;
      const t = docIn(lib, e.doc)?.title;
      if (t) v.docTitle = t;
    }
    entries.push(v);
  }
  const react = reactsAt(lib.file?.isb, rec.level);
  return Object.keys(react).length ? { entries, react } : { entries };
}

/** A short hash of a view, so a host sends one only when it changed: the server sends a browser its view only then. */
export function viewHash(view: StoryView): string {
  return hashText(stableText(view)).slice(0, 16);
}

// ---- a view off the wire ----------------------------------------------------------------------------------
//
// A browser on a server is sent its view and never the set, so what comes down is all it shows. It is
// rebuilt field by field the house way before anything reads it: a class of characters, a length, a
// finite number, a cap on every list, and nothing carried that was not rebuilt.

/** The caps on a view off the wire. Ours, and far past what a story shows. */
export const VIEW_WIRE = { quests: 400, lines: 64, waypoints: 1000, watch: 2000, objects: 1000, polyPts: 256, who: 32, cast: 400, docs: 400 };

const VIEW_CAST = /^[A-Za-z0-9_-]{1,24}:cast\/[A-Za-z0-9_.-]{1,96}$/;
const VIEW_BODY = /^[A-Za-z0-9_./-]{1,160}$/;
const VIEW_MOOD = /^[A-Za-z0-9_.:-]{1,64}$/;

function vCast(x: unknown): CastView | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const id = vWord(o.id, VIEW_CAST);
  const name = vText(o.name, 240);
  const body = vWord(o.body, VIEW_BODY);
  const world = vWord(o.world, VIEW_WORLD);
  const at = vPair(o.at);
  const heading = vNum(o.heading, -360, 360);
  if (!id || !name || !body || !world || !at || heading === null || (o.f !== 'raw' && o.f !== 'game')) return null;
  const v: CastView = { id, name, named: o.named === true, body, world, f: o.f, at, heading, talk: o.talk === true, essential: o.essential !== false };
  const room = vRoom(o.room);
  if (room) v.room = room;
  const mood = vWord(o.mood, VIEW_MOOD);
  if (mood) v.mood = mood;
  const side = vWord(o.side, VIEW_MOOD);
  if (side) v.side = side;
  return v;
}

const VIEW_ID = /^[A-Za-z0-9_-]{1,24}:[A-Za-z0-9_./-]{1,96}$/;
const VIEW_STEP = /^[A-Za-z0-9_.-]{1,48}$/;
const VIEW_WORD = /^[A-Za-z0-9_.:/ -]{1,96}$/;
const VIEW_TEMPLATE = /^[A-Za-z0-9_./-]{1,160}$/;
const VIEW_CELL = /^[A-Za-z0-9_ .-]{1,64}$/;
const VIEW_WORLD = /^[^\u0000-\u001f\u007f]{1,64}$/;
const VIEW_COLOURS = ['accent', 'ink', 'muted', 'good', 'warn', 'bad', 'hot', 'shield', 'armour', 'chassis', 'component', 'health', 'pool'];
const VIEW_STATES = ['offered', 'active', 'done', 'failed', 'dropped', 'stalled', 'none'];
const VIEW_REACH = 1e7;

function vNum(x: unknown, least = -VIEW_REACH, most = VIEW_REACH): number | null {
  return typeof x === 'number' && Number.isFinite(x) && x >= least && x <= most ? x : null;
}

function vWord(x: unknown, re: RegExp): string | null {
  return typeof x === 'string' && re.test(x) && x !== '__proto__' && x !== 'constructor' && x !== 'prototype' ? x : null;
}

function vText(x: unknown, max = 400): TextRef | null {
  if (typeof x === 'string') {
    const s = x.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max);
    return s.trim() ? s : null;
  }
  if (x && typeof x === 'object' && !Array.isArray(x) && typeof (x as { en?: unknown }).en === 'string') {
    const s = (x as { en: string }).en.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max);
    return s.trim() ? { en: s } : null;
  }
  return null;
}

function vPair(x: unknown): [number, number] | null {
  if (!Array.isArray(x) || x.length !== 2) return null;
  const a = vNum(x[0]);
  const b = vNum(x[1]);
  return a === null || b === null ? null : [a, b];
}

function vRoom(x: unknown): Room | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const cell = vWord(o.cell, VIEW_CELL);
  if (!cell) return null;
  const template = vWord(o.template, VIEW_TEMPLATE);
  return template ? { cell, template } : { cell };
}

function vShape(x: unknown): Shape | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (o.kind === 'circle') {
    const c = vPair(o.c);
    const r = vNum(o.r, 0);
    return c && r !== null ? { kind: 'circle', c, r } : null;
  }
  if (o.kind === 'rect') {
    const min = vPair(o.min);
    const max = vPair(o.max);
    return min && max ? { kind: 'rect', min, max } : null;
  }
  if (o.kind === 'poly' && Array.isArray(o.pts) && o.pts.length >= 3 && o.pts.length <= VIEW_WIRE.polyPts) {
    const pts: [number, number][] = [];
    for (const p of o.pts) {
      const q = vPair(p);
      if (!q) return null;
      pts.push(q);
    }
    return { kind: 'poly', pts };
  }
  return null;
}

function vKill(x: unknown): KillMatch | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const out: KillMatch = {};
  if (Array.isArray(o.who)) {
    const who: string[] = [];
    for (const w of o.who) {
      const s = vWord(w, VIEW_WORD);
      if (s && who.length < VIEW_WIRE.who) who.push(s);
    }
    if (who.length) out.who = who;
  }
  const group = vWord(o.group, VIEW_WORD);
  if (group) out.group = group;
  const social = vWord(o.social, VIEW_WORD);
  if (social) out.social = social;
  const tag = vWord(o.tag, VIEW_WORD);
  if (tag) out.tag = tag;
  return out;
}

function vLine(x: unknown): ObjectiveLine | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const quest = vWord(o.quest, VIEW_ID);
  const step = vWord(o.step, VIEW_STEP);
  const text = vText(o.text);
  if (!quest || !step || !text) return null;
  const line: ObjectiveLine = { quest, step, text };
  const n = vNum(o.n, 0, 1e12);
  const of = vNum(o.of, 0, 1e12);
  if (n !== null && of !== null) {
    line.n = n;
    line.of = of;
  }
  const deadline = vNum(o.deadline, 0, 1e14);
  if (deadline !== null) line.deadline = deadline;
  if (o.limit === true) line.limit = true;
  const wp = typeof o.wp === 'string' && /^q:[A-Za-z0-9_:./-]{1,121}#[A-Za-z0-9_.-]{1,48}$/.test(o.wp) ? o.wp : null;
  if (wp) line.wp = wp;
  if (o.done === true) line.done = true;
  return line;
}

function vQuest(x: unknown): QuestView | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const id = vWord(o.id, VIEW_ID);
  const title = vText(o.title, 240);
  if (!id || !title || typeof o.state !== 'string' || !VIEW_STATES.includes(o.state)) return null;
  const lines: ObjectiveLine[] = [];
  if (Array.isArray(o.lines)) {
    for (const l of o.lines) {
      const line = vLine(l);
      if (line && lines.length < VIEW_WIRE.lines) lines.push(line);
    }
  }
  const q: QuestView = { id, title, client: vWord(o.client, VIEW_WORD) ?? 'none', state: o.state, lines, canDrop: o.canDrop === true, canRestart: o.canRestart === true, at: vNum(o.at, 0, 1e14) ?? 0 };
  const outcome = vWord(o.outcome, VIEW_STEP);
  if (outcome) q.outcome = outcome;
  const card = vWord(o.card, VIEW_ID);
  if (card) q.card = card;
  if (typeof o.stalled === 'string') q.stalled = o.stalled.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
  return q;
}

function vWaypoint(x: unknown): WaypointView | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const id = typeof o.id === 'string' && /^q:[A-Za-z0-9_:./-]{1,121}#[A-Za-z0-9_.-]{1,48}$/.test(o.id) ? o.id : null;
  const name = vText(o.name, 240);
  const world = vWord(o.world, VIEW_WORLD);
  const quest = vWord(o.quest, VIEW_ID);
  const step = vWord(o.step, VIEW_STEP);
  const p = Array.isArray(o.p) && (o.p.length === 2 || o.p.length === 3) ? vPair([o.p[0], o.p[1]]) : null;
  if (!id || !name || !world || !quest || !step || !p || (o.f !== 'raw' && o.f !== 'game')) return null;
  const w: WaypointView = { id, name, world, f: o.f, p: [p[0], p[1], null], colour: (VIEW_COLOURS.includes(o.colour as string) ? o.colour : WAYPOINT_TUNE.defaultQuest) as WaypointColour, on: o.on !== false, quest, step };
  const room = vRoom(o.room);
  if (room) w.room = room;
  return w;
}

function vWatch(x: unknown): Watch | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  switch (o.k) {
    case 'arrive': {
      const quest = vWord(o.quest, VIEW_ID);
      const step = vWord(o.step, VIEW_STEP);
      const world = vWord(o.world, VIEW_WORLD);
      const p = vPair(o.p);
      const radius = vNum(o.radius, 0);
      if (!quest || !step || !world || !p || radius === null || (o.f !== 'raw' && o.f !== 'game')) return null;
      const room = vRoom(o.room);
      return { k: 'arrive', quest, step, world, f: o.f, p, radius, ...(room ? { room } : {}) };
    }
    case 'area': {
      const id = vWord(o.id, VIEW_ID);
      const world = vWord(o.world, VIEW_WORLD);
      const shape = vShape(o.shape);
      if (!id || !world || !shape) return null;
      const room = vRoom(o.room);
      return { k: 'area', id, world, shape, ...(room ? { room } : {}) };
    }
    case 'use': {
      const object = vWord(o.object, VIEW_ID);
      return object ? { k: 'use', object } : null;
    }
    case 'kill': {
      const quest = vWord(o.quest, VIEW_ID);
      const step = vWord(o.step, VIEW_STEP);
      const match = vKill(o.match);
      return quest && step && match ? { k: 'kill', quest, step, match } : null;
    }
    case 'room':
    case 'death':
    case 'world':
      return { k: o.k };
    default:
      return null;
  }
}

function vObject(x: unknown): ObjectView | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const id = vWord(o.id, VIEW_ID);
  const world = vWord(o.world, VIEW_WORLD);
  const template = vWord(o.template, VIEW_TEMPLATE);
  const near = vPair(o.near);
  const reach = vNum(o.reach, 0, 1000);
  if (!id || !world || !template || !near || reach === null) return null;
  return { id, world, template, near, reach, label: o.label === null || o.label === undefined ? null : vText(o.label, 240) };
}

/** Every list of a view, rebuilt with its own cleaner and held to its cap. */
function vList<T>(x: unknown, max: number, clean: (v: unknown) => T | null): T[] {
  const out: T[] = [];
  if (!Array.isArray(x)) return out;
  for (const v of x) {
    if (out.length >= max) break;
    const c = clean(v);
    if (c) out.push(c);
  }
  return out;
}

const VIEW_DOC = /^[A-Za-z0-9_-]{1,24}:doc\/[A-Za-z0-9_.-]{1,96}$/;
const VIEW_DOC_KINDS = ['workorder', 'memo', 'log', 'intercept', 'letter', 'notice', 'declaration', 'dossier'];
const VIEW_WHO = /^(row:[A-Za-z0-9_.-]{1,96}|[A-Za-z0-9_-]{1,24}:cast\/[A-Za-z0-9_.-]{1,96})$/;
const VIEW_TAG = /^[A-Za-z0-9_.:-]{1,48}$/;

function vDoc(x: unknown): DocItem | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const id = vWord(o.id, VIEW_DOC);
  const title = typeof o.title === 'string' ? o.title.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) : '';
  const at = vNum(o.at, 0, 1e14);
  if (!id || !title || at === null || typeof o.kind !== 'string' || !VIEW_DOC_KINDS.includes(o.kind)) return null;
  const d: DocItem = { id, title, kind: o.kind as DocItem['kind'], at };
  const quest = vWord(o.quest, VIEW_ID);
  if (quest) d.quest = quest;
  const step = vWord(o.step, VIEW_STEP);
  if (step) d.step = step;
  if (o.card === true) d.card = true;
  const from = vWord(o.from, VIEW_WHO);
  if (from) d.from = from;
  const fromName = vText(o.fromName, 240);
  if (fromName) d.fromName = fromName;
  if (o.opened === true) d.opened = true;
  return d;
}

function vFileEntry(x: unknown): FileEntryView | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const id = typeof o.id === 'string' && /^f[1-9][0-9]{0,8}$/.test(o.id) ? o.id : null;
  const at = vNum(o.at, 0, 1e14);
  if (!id || at === null || typeof o.kind !== 'string' || !(FILE_KINDS as readonly string[]).includes(o.kind)) return null;
  const v: FileEntryView = { id, at, kind: o.kind as FileKind, tags: vList(o.tags, 12, (t) => vWord(t, VIEW_TAG)) };
  const doc = vWord(o.doc, VIEW_DOC);
  if (doc) v.doc = doc;
  if (typeof o.docTitle === 'string' && o.docTitle.trim()) v.docTitle = o.docTitle.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120);
  return v;
}

function vFile(x: unknown): FileView | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const out: FileView = { entries: vList(o.entries, 5000, vFileEntry) };
  if (o.react && typeof o.react === 'object' && !Array.isArray(o.react)) {
    const react: Partial<Record<Track, 'mid' | 'mean'>> = {};
    for (const t of ['rebellion', 'empire', 'freelance'] as const) {
      const r = (o.react as Record<string, unknown>)[t];
      if (r === 'mid' || r === 'mean') react[t] = r;
    }
    if (Object.keys(react).length) out.react = react;
  }
  return out;
}

/** A view as a server sends it, rebuilt, or null when it is not one. */
export function cleanView(x: unknown): StoryView | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const rev = vNum(o.rev, 0, 1e12);
  if (rev === null) return null;
  const tracked = vList(o.tracked, 100, (v) => vWord(v, VIEW_ID));
  const trackWp = typeof o.trackWp === 'string' && (/^w[0-9]{1,9}$/.test(o.trackWp) || /^q:[A-Za-z0-9_:./-]{1,121}#[A-Za-z0-9_.-]{1,48}$/.test(o.trackWp)) ? o.trackWp : null;
  const out: StoryView = {
    rev,
    quests: vList(o.quests, VIEW_WIRE.quests, vQuest),
    waypoints: vList(o.waypoints, VIEW_WIRE.waypoints, vWaypoint),
    watch: vList(o.watch, VIEW_WIRE.watch, vWatch),
    cast: vList(o.cast, VIEW_WIRE.cast, vCast),
    objects: vList(o.objects, VIEW_WIRE.objects, vObject),
    tracked,
    trackWp,
  };
  const docs = vList(o.docs, VIEW_WIRE.docs, vDoc);
  if (docs.length) out.docs = docs;
  const file = vFile(o.file);
  if (file) out.file = file;
  return out;
}
