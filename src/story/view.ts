// What the interface is shown of a story, worked out in one place: the jobs with their objective lines,
// the quests' own waypoints, what the detectors should watch, and the story objects that answer E. Pure.
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

import { hashText } from '../net/hash.ts';
import type { StepRec, StoryBook } from './book.ts';
import type { CondJson } from './expr.ts';
import { placeOf, whyNotGrant, type StoryCtx } from './quests.ts';
import { stableText, type KillMatch, type QuestDef, type Room, type Shape, type StepDef, type StorySet } from './set.ts';
import { literalOf, type TextRef } from './text.ts';
import { STEP_TYPES } from './vocab.ts';
import { WAYPOINT_TUNE, type WaypointColour } from './waypoints.ts';

export interface ObjectiveLine {
  quest: string;
  step: string;
  text: TextRef;
  n?: number;
  of?: number;
  /** When the step runs out, on the shared clock. */
  deadline?: number;
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

export interface StoryView {
  rev: number;
  quests: QuestView[];
  waypoints: WaypointView[];
  watch: Watch[];
  /** The people the story stands (a later wave). */
  cast: unknown[];
  objects: ObjectView[];
  tracked: string[];
  trackWp: string | null;
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
    case 'talk':
      return 'Talk to them';
    case 'choice':
      return 'Decide';
    default:
      return 'Read it';
  }
}

/** One step's objective line, or null for a step that shows none. */
export function objectiveOf(quest: string, step: StepDef, cur: StepRec, lib: StorySet, book: StoryBook, now: number): ObjectiveLine | null {
  if (STEP_TYPES[step.type]?.instant) return null;
  const done = cur.state === 'done';
  if (step.visible === false || (step.visible === 'after' && !done) || (cur.state !== 'active' && !done)) return null;
  const line: ObjectiveLine = { quest, step: step.name, text: step.objective ?? madeText(step, lib) };
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
  if (!done && cur.deadline !== undefined) line.deadline = cur.deadline;
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
    const qv: QuestView = { id: q, title: def?.title ?? q, client: def?.client ?? 'none', state: rec.state, lines: [], canDrop: canDrop(def, rec.state), canRestart: canRestart(def, rec.state) };
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
  return {
    rev: book.rev,
    quests: [...quests, ...ended.slice(0, VIEW_ENDED_MAX)],
    waypoints,
    watch,
    cast: [],
    objects: [...objects.values()],
    tracked: [...book.tracked],
    trackWp: book.trackWp,
  };
}

/** A short hash of a view, so a host sends one only when it changed (a later wave's server does). */
export function viewHash(view: StoryView): string {
  return hashText(stableText(view)).slice(0, 16);
}
