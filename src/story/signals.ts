// The signal board: who raises which signal, and what is done when one is raised. Signals are personal --
// one character's, counted on that character's own steps -- and the scopes `group` and `world` are kept
// for a later pass. Pure.
//
// **Raisers.** An action (`signal(name)`), a step ending (`signalsOut`), and the engine's own prefixes:
// `used:<object>` when E is pressed on a story object, `entered:<area>` and `left:<area>` at an area's
// edge, `room:<template>#<cell>` on stepping into a room, `died:<who>` for a death the player is credited
// with, `world:<id>` on arriving on a world, `talked:<who>#<node>` and `talked:<who>` from a cast member's
// conversation (only for a node that conversation has), `read:<doc>` when a document the set has is read to
// its end, and `debug:<name>` from the console
// (`__debug.signal`), which only the test set may wait on.
// An engine prefix counts as a raiser of an object's or an area's signal only when that object or area is
// declared, so a step waiting on a thing that is not there is caught. The NGE has 95 signals that nothing
// raises; the checker allows this game none.
//
// **The watchdog.** At load and after every change, a step waiting on a signal whose every raiser lives
// in a quest now closed to the character and no longer running (or, from a later wave, depends on a cast
// member who is dead) can never be done, and neither can a step waiting `after` one that was skipped,
// failed, or lies on a branch the run did not take. It follows its `onStuck`: skip it, go to a named step,
// or -- the default -- hold the quest with "Nobody is left who can sign this off", shown in the quest list
// and never in the journal, with Drop costing nothing. A step whose definition vanished is the revision
// rules' (`Draft.revise`).

import { ownOf, type StoryBook } from './book.ts';
import { Draft, awaits, deadWaits, plan, type StoryCtx, type StoryResult } from './quests.ts';
import { stepPath, type ActionDef, type StepDef, type StorySet } from './set.ts';
import { lineAt } from './jsonc.ts';

/**
 * The signal a step cannot be done without: the one it counts (`awaits`), or for an observe step its
 * area's `entered:`, which it does not count but cannot start watching without.
 */
export function waitedOn(step: StepDef): string | null {
  if (step.type === 'observe') return step.area ? `entered:${step.area}` : null;
  return awaits(step);
}

/** One raiser of a signal: where it is, for the checker's errors and the watchdog's judgement. */
export interface Raiser {
  kind: 'action' | 'out' | 'object' | 'area' | 'engine' | 'debug' | 'talk';
  /** The quest an action or a step's signal lives in: what a closed quest takes with it. */
  quest?: string;
  file: string;
  line: number;
}

/** Signals the engine raises again every couple of seconds while they stay true, so a count of them counts repeats. */
const LEVEL = /^(entered|left|room|world):/;

export function isLevelSignal(name: string): boolean {
  return LEVEL.test(name);
}

const CACHE = new WeakMap<StorySet, Map<string, Raiser[]>>();

/** Every raiser a set has of every signal it names, built once per set. */
export function raisersOf(lib: StorySet): Map<string, Raiser[]> {
  const cached = CACHE.get(lib);
  if (cached) return cached;
  const map = new Map<string, Raiser[]>();
  const add = (name: string, r: Raiser): void => {
    const list = map.get(name);
    if (list) list.push(r);
    else map.set(name, [r]);
  };
  const fromActions = (list: readonly ActionDef[], quest: string, file: string, line: number): void => {
    for (const a of list) if (a.act === 'signal' && typeof a.args[0] === 'string') add(a.args[0], { kind: 'action', quest, file, line });
  };
  for (const id of Object.keys(lib.quests)) {
    const q = lib.quests[id];
    const { file, lines } = q.src;
    for (const s of Object.keys(q.steps)) {
      const st = q.steps[s];
      const line = lineAt(lines, stepPath(s));
      for (const n of [...st.signalsOut.done, ...st.signalsOut.fail]) add(n, { kind: 'out', quest: id, file, line });
      fromActions([...st.do.start, ...st.do.done, ...st.do.fail], id, file, line);
      for (const o of st.options ?? []) fromActions(o.do, id, file, line);
    }
    for (const o of Object.keys(q.outcomes)) fromActions(q.outcomes[o].do, id, file, lineAt(lines, `/outcomes/${o}`));
  }
  // A conversation raises what its nodes' and answers' actions raise, and every cast member who speaks one
  // raises `talked:<who>` at each node reached and `talked:<who>#<node>` for that node.
  for (const id of Object.keys(lib.talks ?? {})) {
    const t = lib.talks[id];
    for (const n of Object.keys(t.nodes)) {
      const node = t.nodes[n];
      const line = lineAt(t.src.lines, `/nodes/${n}`);
      fromActions(node.do, '', t.src.file, line);
      for (const r of node.replies) fromActions(r.do, '', t.src.file, line);
    }
  }
  for (const id of Object.keys(lib.cast ?? {})) {
    const c = lib.cast[id];
    const t = c.tree && lib.talks && Object.hasOwn(lib.talks, c.tree) ? lib.talks[c.tree] : null;
    if (!t) continue;
    add(`talked:${id}`, { kind: 'talk', file: c.src.file, line: 1 });
    for (const n of Object.keys(t.nodes)) add(`talked:${id}#${n}`, { kind: 'talk', file: t.src.file, line: lineAt(t.src.lines, `/nodes/${n}`) });
  }
  for (const id of Object.keys(lib.objects)) add(`used:${id}`, { kind: 'object', file: lib.objects[id].src.file, line: 1 });
  // A document the set has is read to its end by whoever it is handed to.
  for (const id of Object.keys(lib.docs ?? {})) add(`read:${id}`, { kind: 'engine', file: lib.docs![id].src.file, line: 1 });
  for (const id of Object.keys(lib.areas)) {
    const a = lib.areas[id];
    add(`entered:${id}`, { kind: 'area', file: a.src.file, line: 1 });
    add(`left:${id}`, { kind: 'area', file: a.src.file, line: 1 });
  }
  CACHE.set(lib, map);
  return map;
}

/**
 * Who raises a signal: the set's own raisers (a cast member's conversation among them), and the engine for
 * the prefixes it raises for anything (a room, a world, a death), the console for `debug:`, and the game's
 * own people for a `talked:row:` (whose conversations a later wave binds; a cast member's must be one this
 * set has).
 */
export function raisersFor(lib: StorySet, name: string): Raiser[] {
  const own = raisersOf(lib).get(name) ?? [];
  if (/^(room|world|died):/.test(name)) return [...own, { kind: 'engine', file: '', line: 0 }];
  if (name.startsWith('debug:')) return [...own, { kind: 'debug', file: '', line: 0 }];
  if (name.startsWith('talked:row:')) return [...own, { kind: 'talk', file: '', line: 0 }];
  return own;
}

/** A signal raised for one character: every active step waiting on it counted, and done at its count. */
export function raise(book: StoryBook, lib: StorySet, name: string, ctx: StoryCtx): StoryResult {
  return plan(book, lib, ctx, (d) => {
    d.raise(name);
    d.run();
    watchdog(d);
  });
}

/** How many times the watchdog looks again after moving something on in one event. Ours. */
const WATCH_PASSES = 8;

/**
 * Whether a raiser can still raise its signal for this book. One that lives in a quest closed to the
 * character cannot -- unless that quest is still running, since closing a quest ends no run in progress
 * and its steps can still raise what they raise (a quest that closes itself on its first step, say).
 */
function raiserAlive(r: Raiser, book: StoryBook): boolean {
  if (!r.quest || !book.closed?.includes(r.quest)) return true;
  return ownOf(book.quests, r.quest)?.state === 'active';
}

/**
 * Find every step that can never be done and move it on, as its `onStuck` says: an active step waiting on
 * a signal nothing left can raise, and a waiting step whose `after` can never all be done (one was skipped,
 * failed, or lies on a branch the run did not take: `deadWaits`).
 */
export function watchdog(d: Draft): void {
  // Moving one step on can leave another stuck (a step skipped past a join it was the last hope of), so
  // the look is taken again while it moved anything, a few times at most.
  for (let pass = 0; pass < WATCH_PASSES; pass++) {
    const before = d.ch.length;
    const book = d.book;
    for (const q of Object.keys(book.quests ?? {})) {
      const rec = book.quests![q];
      if (rec.state !== 'active') continue;
      const def = d.def(q);
      if (!def) continue;
      const stuck: string[] = [];
      for (const s of Object.keys(rec.steps)) {
        if (rec.steps[s].state !== 'active') continue;
        const step = def.steps[s];
        const name = step ? waitedOn(step) : null;
        if (!name) continue;
        if (!raisersFor(d.lib, name).some((r) => raiserAlive(r, book))) stuck.push(s);
      }
      stuck.push(...deadWaits(rec, def));
      for (const s of stuck) d.stuck(q, s);
    }
    d.run();
    if (d.ch.length === before) return;
  }
}
