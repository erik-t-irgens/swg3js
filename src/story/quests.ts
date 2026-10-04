// The step machine: what a quest does next. Pure, and the one place it is decided: the server and the
// browser both run it, and it never changes a book itself. It is handed a book, the story set and what is
// true just now (`StoryCtx`), works on a copy of the book (`draftOf`), and answers the changes it made,
// what to pay and what to say (`StoryResult`); a host applies the changes with the very `applyChanges` the
// other host uses, so two hosts that apply the same answer hold the same book.
//
// **Steps.** A step named by `start`, a `next` edge or `onFail` is asked to begin. It waits while any step
// of its `after` is not done, is skipped if any of its `unless` is done or its `chance` does not come up
// (a seeded roll, so a reload cannot roll again), and otherwise begins: its `do.start` actions run, its
// clock starts, and a step with nothing to wait for (`nothing`, `join`, `reward`, `end`) is done at once.
// Done, it runs `do.done`, raises `signalsOut.done`, grants `grant.done`, and then follows its `next`
// edges (every one whose condition holds; `nextOne`, only the first) or ends the quest with `ends`. Failed
// (its time limit ran out, an action failed it, the player died with `failOn: death`), it runs the same
// three for `fail` and begins `onFail`, or fails the quest when it names none. A quest with nothing
// active or waiting left ends `done` by itself, which the checker warns about. Everything a step sets off
// goes on one queue, in the order the design lists it, so a cascade comes out the same on both hosts.
//
// **Runs.** Each attempt at a quest is a run. Its counters, its deadlines and its rolls belong to it, so
// a restart never carries half a counter over, and work left over from a run that has ended is dropped.
// A reward is not the run's, though: it is keyed by its quest, the completion it counts towards and its
// place (`<quest>#<n>#<step>`, `n` one more than the completions before it), and the book refuses to
// record one twice. So a restart, a drop and a fresh grant, or a failure and a retry all reach the same
// key and pay nothing the first try already paid, while a quest done and taken again is a new completion
// and pays again -- nothing is ever paid twice, whichever host pays it. An action that hands something
// over (`pay`, `give`, `xp`, `standing`) is a reward of its own, keyed the same way by where it is written
// (`<quest>#<n>#do:<step>.<phase>.<i>`), so a step begun again in the same completion pays it once.
//
// **Repeats, restarts, revisions.** A quest ended is taken again only as its `repeat` says (`never`,
// `always`, a cooldown, once a game day or a real day, up to a limit). A restart begins a new run at the
// start or at the last checkpoint reached, keeping what was done before that checkpoint; a harsh quest
// cannot be restarted, and abandoning it ends it as its `abandon` outcome. A quest whose definition
// changed under a running book carries on when every step it is in still exists, restarts where it may,
// and is otherwise held `stalled` -- "This job's paperwork was revised" -- with Drop costing nothing.
//
// **Clocks.** Every time is shared-clock milliseconds (`StoryCtx.now`), never the frame's own clock.
// Deadlines that passed while nobody was looking are settled in the order they fell due, each at its own
// time (`settle`), so a timer and the step after it both run out in the right order overnight. A span on
// the played clock counts only while the character is in the world: one that begins while they are away
// (`StoryCtx.away`, which a host says while it settles a book before the character comes in, and which
// `leave` says for itself) keeps its whole length as `remaining` and starts counting at `enter`.
//
// **A circle.** Data that sets off work for ever (a quest chained after itself that finishes the moment
// it is given) is stopped at `WORK_MAX` pieces of work, and everything that event had worked out is
// thrown away: nothing is changed and nothing is paid, and the answer says only why.
//
// What is the game's: the step types and their fields are the client's quest-task columns, named
// beside each field in `set.ts`. Everything about how they run is ours.

import { BOOK_LIMITS, applyChange, draftOf, ownOf, table, type BookLimits, type QuestRec, type StepRec, type StoryBook, type StoryChange, type Track } from './book.ts';
import { gameDayOf, realDayOf } from './clock.ts';
import type { CondJson, Lit } from './expr.ts';
import { scriptOf, type ScriptLook } from './scripts.ts';
import { seedChance } from './seed.ts';
import { CLEARED, type ActionDef, type Edge, type QuestDef, type Reward, type Room, type StepDef, type StorySet } from './set.ts';
import type { TextRef } from './text.ts';
import { ACTIONS, BUILT_WAVE, OP_KEYS, STEP_TYPES } from './vocab.ts';
import { WAYPOINT_TUNE, cleanWaypointName, type Waypoint } from './waypoints.ts';

/** What is true just now, as the host says it. Anything it cannot say is left out, and a condition on it reads false. */
export interface StoryCtx {
  /** Shared-clock milliseconds. */
  now: number;
  /** The character whose book it is: what every roll is seeded with. */
  char: string;
  /** Who pays: what every reward recorded says. */
  payer: 'server' | 'browser';
  /** The world the player stands on (a pack id). */
  world?: string | null;
  /** Where the player stands, in that world's frame (raw on a planet, game in space). */
  here?: [number, number] | null;
  room?: Room | null;
  /** The areas the player is inside, by id. */
  areas?: readonly string[];
  /** The game hour where the player is, 0 to 23. */
  hour?: number | null;
  grouped?: boolean;
  species?: string | null;
  /** What the character has to spend, as its purse says: what `credits() >= n` reads. Unknown reads false. */
  credits?: number | null;
  /** How many of a thing the character owns (the ledger's kinds, `wear` and `weapon`): what `has` reads. */
  has?: ((kind: string, id: string) => number) | null;
  /**
   * The character is not in the world just now: logged off, or not yet come in while a host settles the
   * book it has just read. A span on the played clock that begins now keeps its length until `enter`.
   */
  away?: boolean;
}

/** Something that happened, as a host's detectors say it. */
export type StoryEvent =
  | { k: 'arrive'; world: string; p: [number, number]; room?: Room | null; quest?: string; step?: string }
  | { k: 'room'; template: string; cell: string }
  | { k: 'area'; area: string; inside: boolean }
  | { k: 'use'; object: string }
  | { k: 'kill'; who: string; group?: string; social?: string; tags?: readonly string[]; npc?: string }
  | { k: 'death' }
  | { k: 'world'; world: string }
  | { k: 'signal'; name: string }
  | { k: 'enter' }
  | { k: 'leave' }
  | { k: 'tick' };

/** A payment for the host to make: credits through its purse, an item through its ledger. */
export interface PayOrder {
  key: string;
  credits?: number;
  item?: { kind: 'wear' | 'weapon'; id: string; n: number };
}

/** What the message line may say about it. The words are the display's (a later wave); these are the facts. */
export type StoryNote =
  | { k: 'job' | 'offered' | 'restarted' | 'dropped'; quest: string; title: TextRef }
  | { k: 'done' | 'failed'; quest: string; title: TextRef; outcome: string }
  | { k: 'stalled'; quest: string; title: TextRef; why: string }
  | { k: 'objective' | 'objectiveDone'; quest: string; step: string }
  | { k: 'paid'; quest: string; credits: number }
  | { k: 'item'; quest: string; kind: 'wear' | 'weapon'; id: string; n: number }
  | { k: 'xp'; quest: string; n: number }
  | { k: 'standing'; quest: string; track: Track; n: number }
  | { k: 'say'; text: string };

export interface StoryResult {
  /** The changes made, in order: what the host applies to its book and what goes down the wire. */
  ch: StoryChange[];
  pay: PayOrder[];
  notes: StoryNote[];
  /** Documents handed over (a later wave). */
  docs: unknown[];
  /** Why the thing asked for did not happen, when it did not. */
  why: string | null;
  /** Words from a later wave that were met and did nothing. */
  unbuilt: number;
  /** `call`s nothing answered. */
  misses: number;
}

/** What a revised quest that cannot carry on says. */
export const STALLED_REVISED = 'This job’s paperwork was revised';
/** What a quest the watchdog found stuck says. */
export const STALLED_STUCK = 'Nobody is left who can sign this off';
/** The most pieces of work one event may set off before the machine calls it a circle and stops. Ours. */
const WORK_MAX = 10000;
/** What an event stopped as a circle answers, and all it answers. */
export const CIRCLE = 'the story went round in a circle and was stopped, and nothing it did was kept';
/** The most deadlines one settle works through. Ours. */
const SETTLE_MAX = 1000;
/** How deep a script's actions may call scripts. Ours. */
const SCRIPT_DEPTH = 8;

type Work =
  | { k: 'activate' | 'wake' | 'complete' | 'fail'; q: string; s: string; run: number }
  | { k: 'raise'; name: string }
  | { k: 'grant'; q: string; how: 'grant' | 'offer' }
  | { k: 'end'; q: string; outcome: string; run: number };

interface Scope {
  quest?: string;
  run?: number;
  step?: string;
  /**
   * Where a list of actions was written (`<step>.start`, `<step>.done`, `<step>.fail`, `out:<outcome>`):
   * what an action that pays is keyed by, with its place in the list, so it is paid once wherever it runs.
   */
  site?: string;
  /** The completion an action that pays counts towards, where the caller knows it better than the record does. */
  n?: number;
}

export interface Tally {
  unbuilt: number;
  misses: number;
}

// ---- conditions ------------------------------------------------------------------------------------

function compare(v: unknown, c: CondJson): boolean {
  for (const op of OP_KEYS) {
    if (!(op in c)) continue;
    const w = c[op];
    if (op === 'eq') return v === w;
    if (op === 'ne') return v !== w;
    if (typeof v !== 'number' || typeof w !== 'number') return false;
    if (op === 'lt') return v < w;
    if (op === 'lte') return v <= w;
    if (op === 'gt') return v > w;
    return v >= w;
  }
  return false;
}

function lookOf(book: StoryBook, ctx: StoryCtx): ScriptLook {
  return { flag: (n) => ownOf(book.flags, n), now: ctx.now };
}

/** A quest's record in a book, never anything a table's prototype carries. */
function questIn(book: StoryBook, q: string): QuestRec | undefined {
  return ownOf(book.quests, q);
}

/** One step's record in a quest's, likewise. */
function stepIn(rec: QuestRec | null | undefined, s: string): StepRec | undefined {
  return rec ? ownOf(rec.steps, s) : undefined;
}

/**
 * Whether a condition holds for this book just now. A condition from a later wave reads false and is
 * counted in `tally.unbuilt`; a `call` nothing answers, or that throws, reads false and is counted in
 * `tally.misses`. Pure: reads the book and the context and nothing else.
 */
export function evalCond(c: CondJson | null | undefined, book: StoryBook, ctx: StoryCtx, scope: Scope = {}, tally?: Tally): boolean {
  if (!c) return true;
  if ('all' in c) return (c.all as CondJson[]).every((x) => evalCond(x, book, ctx, scope, tally));
  if ('any' in c) return (c.any as CondJson[]).some((x) => evalCond(x, book, ctx, scope, tally));
  if ('not' in c) return !evalCond(c.not as CondJson, book, ctx, scope, tally);
  if ('quest' in c) {
    const q = c.quest as string;
    const rec = questIn(book, q);
    switch (c.is) {
      case 'none':
        return !rec || rec.state === 'none' || rec.state === 'dropped';
      case 'offered':
      case 'active':
      case 'failed':
        if (c.is === 'failed' && c.outcome !== undefined) return rec?.state === 'failed' && rec.outcome === c.outcome;
        return rec?.state === c.is;
      case 'done':
        // With an outcome named, any end with that outcome (a failure's included); without, a quest done.
        if (c.outcome !== undefined) return (rec?.state === 'done' || rec?.state === 'failed') && rec.outcome === c.outcome;
        return rec?.state === 'done';
      case 'closed':
        return !!book.closed?.includes(q);
      default:
        return false;
    }
  }
  if ('step' in c) {
    const [q, s] = c.step as [string, string];
    return stepIn(questIn(book, q), s)?.state === c.is;
  }
  if ('completions' in c) return compare(questIn(book, c.completions as string)?.completions ?? 0, c);
  if ('flag' in c) {
    const v = ownOf(book.flags, c.flag as string);
    return c.set === true ? v !== undefined : compare(v, c);
  }
  if ('world' in c) return !!ctx.world && ctx.world === c.world;
  if ('inArea' in c) return !!ctx.areas?.includes(c.inArea as string);
  if ('inRoom' in c) {
    const r = c.inRoom as Room;
    return !!ctx.room && ctx.room.cell === r.cell && (!r.template || ctx.room.template === r.template);
  }
  if ('hour' in c) {
    if (typeof ctx.hour !== 'number') return false;
    const [a, b] = c.hour as [number, number];
    const h = Math.floor(ctx.hour);
    return a <= b ? h >= a && h < b : h >= a || h < b;
  }
  if ('grouped' in c) return !!ctx.grouped;
  if ('species' in c) return !!ctx.species && ctx.species === c.species;
  // What the character has to spend and what it owns are the host's to say (its purse, its ledger); a
  // host that cannot say reads false, as any condition on something unknown does.
  if ('credits' in c) return typeof ctx.credits === 'number' && Number.isFinite(ctx.credits) && compare(ctx.credits, c.credits as CondJson);
  if ('has' in c) {
    const h = c.has as { kind: string; id: string; n?: number };
    const n = ctx.has ? ctx.has(h.kind, h.id) : null;
    return typeof n === 'number' && n >= (h.n ?? 1);
  }
  if ('standing' in c || 'trust' in c) {
    const which = 'standing' in c ? 'standing' : 'trust';
    const t = c[which] as CondJson & { track: Track };
    const row = ownOf(book.tracks as Record<string, { standing: number; trust: number }> | undefined, t.track);
    return compare(row ? row[which] : 0, t);
  }
  if ('chance' in c) return seedChance(c.chance as number, ctx.char, scope.quest ?? '', scope.run ?? 0, c.seed as string);
  if ('script' in c) {
    const s = scriptOf(c.script as string);
    if (!s?.cond) {
      if (tally) tally.misses++;
      return false;
    }
    try {
      return s.cond((c.args as Lit[]) ?? [], lookOf(book, ctx)) === true;
    } catch {
      if (tally) tally.misses++;
      return false;
    }
  }
  if (tally) tally.unbuilt++;
  return false;
}

// ---- what a quest may do -----------------------------------------------------------------------------

/** Why a quest that has ended may not be taken again just now, or null when it may. */
export function whyNotAgain(rec: QuestRec, def: QuestDef, now: number): string | null {
  const r = def.repeat;
  if (r.limit > 0 && rec.completions >= r.limit) return `this job is done ${r.limit} time${r.limit === 1 ? '' : 's'} at most`;
  const ended = rec.ended ?? 0;
  switch (r.every) {
    case 'never':
      return rec.state === 'done' ? 'this job is done' : 'this job has failed';
    case 'always':
      return null;
    case 'cooldown':
      return now >= ended + r.cooldown ? null : `this job can be taken again in ${Math.ceil((ended + r.cooldown - now) / 1000)} seconds`;
    case 'gameDay':
      return gameDayOf(now) > gameDayOf(ended) ? null : 'this job can be taken again the next game day';
    case 'realDay':
      return realDayOf(now) > realDayOf(ended) ? null : 'this job can be taken again tomorrow';
  }
}

/** Why a quest may not be granted or offered just now, or null when it may. */
export function whyNotGrant(book: StoryBook, lib: StorySet, q: string, ctx: StoryCtx): string | null {
  const def = lib.quests[q];
  if (!def) return 'there is no such job';
  if (book.closed?.includes(q)) return 'that job is closed';
  const rec = questIn(book, q);
  if (rec && (rec.state === 'active' || rec.state === 'stalled')) return 'that job is already taken';
  if (rec && (rec.state === 'done' || rec.state === 'failed')) {
    const again = whyNotAgain(rec, def, ctx.now);
    if (again) return again;
  }
  if (def.needs && !evalCond(def.needs, book, ctx, { quest: q, run: (rec?.run ?? 0) + 1 })) return 'this job is not for you yet';
  return null;
}

/** The signal a step waits on, or null for a step that waits on none. */
export function awaits(step: StepDef): string | null {
  if (step.type === 'signal') return step.signal;
  if (step.type === 'use') return step.object ? `used:${step.object}` : null;
  return null;
}

/** Where a step's place is for this run: an absolute place as written, a relative one as it was worked out when the step began. */
export function placeOf(rec: QuestRec, step: StepDef, cur: StepRec | undefined): { world: string; f: 'raw' | 'game'; p: [number, number]; room?: Room } | null {
  const at = step.at ?? step.waypoint?.at ?? null;
  if (!at) return null;
  if ('rel' in at) {
    const world = at.world ?? rec.from?.world;
    if (!cur?.place || !world) return null;
    return { world, f: world.startsWith('space_') ? 'game' : 'raw', p: cur.place, ...(at.room ? { room: at.room } : {}) };
  }
  return at;
}

function arrivedAt(place: { world: string; p: [number, number]; room?: Room }, radius: number, world: string | null | undefined, p: [number, number] | null | undefined, room: Room | null | undefined): boolean {
  if (!world || !p || world !== place.world) return false;
  if (Math.hypot(p[0] - place.p[0], p[1] - place.p[1]) > radius) return false;
  if (!place.room) return true;
  return !!room && room.cell === place.room.cell && (!place.room.template || room.template === place.room.template);
}

/** The span on the played clock a step counts against, or null. */
function playedSpan(step: StepDef): boolean {
  return step.for?.clock === 'played' || step.timeLimit?.clock === 'played';
}

/** One deadline a book holds: a step's own time running out, or an observe step's watch filling up. */
export interface Due {
  at: number;
  quest: string;
  step: string;
  run: number;
  /** `complete` for a timer, a wait or a full watch; `fail` for a time limit. */
  then: 'complete' | 'fail';
}

/** Every deadline the active quests hold, earliest first (ties in quest and step order, so both hosts agree). */
export function dueList(book: StoryBook, lib: StorySet): Due[] {
  const out: Due[] = [];
  for (const q of Object.keys(book.quests ?? {})) {
    const rec = book.quests![q];
    if (rec.state !== 'active') continue;
    const def = lib.quests[q];
    if (!def) continue;
    for (const s of Object.keys(rec.steps)) {
      const cur = rec.steps[s];
      const step = def.steps[s];
      if (cur.state !== 'active' || !step) continue;
      if (cur.deadline !== undefined) out.push({ at: cur.deadline, quest: q, step: s, run: rec.run, then: step.for ? 'complete' : 'fail' });
      if (step.type === 'observe' && cur.since !== undefined) out.push({ at: cur.since + Math.max(0, step.seconds * 1000 - cur.n), quest: q, step: s, run: rec.run, then: 'complete' });
    }
  }
  out.sort((a, b) => a.at - b.at || (a.quest < b.quest ? -1 : a.quest > b.quest ? 1 : a.step < b.step ? -1 : a.step > b.step ? 1 : 0));
  return out;
}

/** When the next deadline falls, or null with none: what a host's sweep waits for. */
export function nextDeadline(book: StoryBook, lib: StorySet): number | null {
  return dueList(book, lib)[0]?.at ?? null;
}

function capHistory(list: QuestRec['history'], max: number): QuestRec['history'] {
  return list.length > max ? list.slice(list.length - max) : list;
}

/** A record without the fields that belong to a state it is leaving. */
function without<T extends object, K extends keyof T>(o: T, ...keys: K[]): Omit<T, K> {
  const out = { ...o } as Record<string, unknown>;
  for (const k of keys) delete out[k as string];
  return out as Omit<T, K>;
}

/** Whether a quest's run fits a definition: it is in at least one step, and every step it is in is still there. */
function fits(rec: QuestRec, def: QuestDef): boolean {
  let live = 0;
  for (const s of Object.keys(rec.steps)) {
    const st = rec.steps[s].state;
    if (st !== 'active' && st !== 'waiting') continue;
    if (!def.steps[s]) return false;
    live++;
  }
  return live > 0;
}

// ---- the machine -------------------------------------------------------------------------------------

/**
 * One event's worth of work on a copy of a book. Everything it does is a change pushed through the
 * book's own `applyChange`, so the changes it answers, applied to the book it was handed, make exactly
 * the copy it ended with.
 */
export class Draft {
  readonly book: StoryBook;
  readonly lib: StorySet;
  ctx: StoryCtx;
  readonly limits: BookLimits;
  readonly ch: StoryChange[] = [];
  readonly pay: PayOrder[] = [];
  readonly notes: StoryNote[] = [];
  readonly docs: unknown[] = [];
  why: string | null = null;
  readonly tally: Tally = { unbuilt: 0, misses: 0 };
  private readonly queue: Work[] = [];
  private readonly touched = new Set<string>();
  private worked = 0;
  private scriptDepth = 0;
  /** Set while a restart begins its new run, so the message line says it was started over rather than taken. */
  private restarting = false;
  /** Set once a circle has been stopped: from then on this draft changes nothing and its answer is only why. */
  private broken = false;

  constructor(book: StoryBook, lib: StorySet, ctx: StoryCtx, limits: BookLimits = BOOK_LIMITS) {
    this.book = draftOf(book);
    this.lib = lib;
    this.ctx = ctx;
    this.limits = limits;
  }

  /** One change, applied to the copy and kept for the answer; false (with the reason kept) when the book refused it. */
  change(c: StoryChange): boolean {
    if (this.broken) return false;
    const r = applyChange(this.book, c, this.limits);
    if (r.change) {
      this.ch.push(r.change);
      return true;
    }
    this.why ??= r.why;
    return false;
  }

  quest(q: string): QuestRec | null {
    return questIn(this.book, q) ?? null;
  }

  def(q: string): QuestDef | null {
    return this.lib.quests[q] ?? null;
  }

  private setQuest(q: string, rec: QuestRec): boolean {
    return this.change({ k: 'qState', quest: q, rec });
  }

  private setStep(q: string, s: string, rec: StepRec): boolean {
    return this.change({ k: 'step', quest: q, step: s, rec });
  }

  holds(c: CondJson | null | undefined, scope: Scope = {}): boolean {
    return evalCond(c, this.book, this.ctx, scope, this.tally);
  }

  private here(): { world: string; p: [number, number] } | null {
    return this.ctx.world && this.ctx.here ? { world: this.ctx.world, p: [this.ctx.here[0], this.ctx.here[1]] } : null;
  }

  /** The answer: everything this draft did, or, once a circle was stopped, nothing but why. */
  result(): StoryResult {
    if (this.broken) return { ch: [], pay: [], notes: [{ k: 'say', text: CIRCLE }], docs: [], why: CIRCLE, unbuilt: this.tally.unbuilt, misses: this.tally.misses };
    return { ch: this.ch, pay: this.pay, notes: this.notes, docs: this.docs, why: this.why, unbuilt: this.tally.unbuilt, misses: this.tally.misses };
  }

  // ---- the queue -------------------------------------------------------------------------------------

  /**
   * Work through everything queued, then end every quest touched that has nothing active or waiting
   * left, which may queue more. Stops a circle at `WORK_MAX` pieces of work rather than spin for ever,
   * and throws away everything the event had worked out: half a circle applied would be thousands of
   * changes and payments the data never meant, so the book is left exactly as it was handed in.
   */
  run(): void {
    if (this.broken) return;
    for (;;) {
      while (this.queue.length) {
        if (++this.worked > WORK_MAX) {
          this.broken = true;
          this.queue.length = 0;
          this.ch.length = 0;
          this.pay.length = 0;
          this.notes.length = 0;
          this.docs.length = 0;
          this.why = CIRCLE;
          return;
        }
        this.work(this.queue.shift()!);
      }
      let more = false;
      for (const q of this.touched) {
        const rec = this.quest(q);
        if (rec?.state !== 'active') continue;
        let live = false;
        for (const s of Object.keys(rec.steps)) if (rec.steps[s].state === 'active' || rec.steps[s].state === 'waiting') live = true;
        if (live) continue;
        this.queue.push({ k: 'end', q, outcome: 'done', run: rec.run });
        more = true;
      }
      this.touched.clear();
      if (!more) return;
    }
  }

  private work(w: Work): void {
    switch (w.k) {
      case 'activate':
        return this.activate(w.q, w.s, w.run);
      case 'wake':
        return this.wake(w.q, w.s, w.run);
      case 'complete':
        return this.complete(w.q, w.s, w.run);
      case 'fail':
        return this.failStep(w.q, w.s, w.run);
      case 'raise':
        return this.raise(w.name);
      case 'grant':
        this.grant(w.q, w.how);
        return;
      case 'end':
        return this.end(w.q, w.outcome, w.run);
    }
  }

  // ---- quests ----------------------------------------------------------------------------------------

  /** Grant a quest (or offer it). Answers why not, or null. An offered quest granted is accepted. */
  grant(q: string, how: 'grant' | 'offer' = 'grant'): string | null {
    const rec = this.quest(q);
    if (rec?.state === 'offered') return how === 'grant' ? this.accept(q) : 'that job is already offered';
    const why = whyNotGrant(this.book, this.lib, q, this.ctx);
    if (why) return why;
    const def = this.def(q)!;
    if (how === 'offer') {
      const base: QuestRec = rec ? without(rec, 'outcome', 'why') : { state: 'none', run: 0, at: 0, completions: 0, defRev: 0, defHash: '', steps: table<StepRec>(), history: [] };
      if (!this.setQuest(q, { ...base, state: 'offered', at: this.ctx.now, defRev: def.rev, defHash: def.hash })) return this.why;
      this.notes.push({ k: 'offered', quest: q, title: def.title });
      return null;
    }
    return this.startRun(q, null, null);
  }

  accept(q: string): string | null {
    const rec = this.quest(q);
    if (rec?.state !== 'offered') return 'that job is not on offer';
    if (this.book.closed?.includes(q)) return 'that job is closed';
    if (!this.def(q)) return 'there is no such job';
    return this.startRun(q, null, null);
  }

  decline(q: string): string | null {
    const rec = this.quest(q);
    if (rec?.state !== 'offered') return 'that job is not on offer';
    return this.setQuest(q, { ...rec, state: 'none' }) ? null : this.why;
  }

  /**
   * Begin a new run: at the start, or at a checkpoint with the steps done before it kept. Where the run
   * begins is remembered, for a place written relative to it.
   */
  private startRun(q: string, checkpoint: string | null, keep: Record<string, StepRec> | null): string | null {
    const def = this.def(q)!;
    const old = this.quest(q);
    const run = (old?.run ?? 0) + 1;
    const rec: QuestRec = { state: 'active', run, at: this.ctx.now, completions: old?.completions ?? 0, defRev: def.rev, defHash: def.hash, steps: table<StepRec>(keep ?? undefined), history: old ? [...old.history] : [] };
    if (old?.ended !== undefined) rec.ended = old.ended;
    if (old?.params) rec.params = old.params;
    if (old?.day) rec.day = old.day;
    const from = checkpoint && old?.from ? old.from : (this.here() ?? old?.from);
    if (from) rec.from = from;
    if (!this.setQuest(q, rec)) return this.why;
    this.notes.push({ k: this.restarting ? 'restarted' : 'job', quest: q, title: def.title });
    for (const s of checkpoint ? [checkpoint] : def.start) this.queue.push({ k: 'activate', q, s, run });
    this.touched.add(q);
    return null;
  }

  /** Abandon a quest, as its definition says abandoning goes. */
  drop(q: string): string | null {
    const rec = this.quest(q);
    if (!rec) return 'that job is not taken';
    const def = this.def(q);
    const now = this.ctx.now;
    const dropped = (): string | null => {
      const next: QuestRec = { ...without(rec, 'why'), state: 'dropped', history: capHistory([...rec.history, { run: rec.run, outcome: 'dropped', at: now }], this.limits.history) };
      if (!this.setQuest(q, next)) return this.why;
      this.untrack(q);
      this.notes.push({ k: 'dropped', quest: q, title: def?.title ?? q });
      return null;
    };
    switch (rec.state) {
      case 'offered':
        return this.decline(q);
      case 'stalled':
        // Held through no fault of the player's: dropping costs nothing, harsh or not.
        return dropped();
      case 'active':
        if (!def) return dropped();
        if (def.abandon === false) return 'this job cannot be dropped';
        if (typeof def.abandon === 'string') {
          this.queue.push({ k: 'end', q, outcome: def.abandon, run: rec.run });
          return null;
        }
        if (def.harsh) {
          this.queue.push({ k: 'end', q, outcome: 'failed', run: rec.run });
          return null;
        }
        return dropped();
      default:
        return 'that job is not taken';
    }
  }

  /** Start a quest over, at its start or its last checkpoint reached, as its definition allows. */
  restart(q: string): string | null {
    const rec = this.quest(q);
    const def = this.def(q);
    if (!def) return 'there is no such job';
    if (def.restart === 'never' || def.harsh) return 'this job cannot be started over';
    if (!rec || !['active', 'failed', 'stalled', 'dropped'].includes(rec.state)) return 'that job is not taken';
    if (this.book.closed?.includes(q)) return 'that job is closed';
    let checkpoint: string | null = null;
    let keep: Record<string, StepRec> | null = null;
    if (def.restart === 'checkpoint') {
      let best = -1;
      for (const s of Object.keys(rec.steps)) {
        const cur = rec.steps[s];
        if (!def.steps[s]?.checkpoint || cur.state === 'waiting' || cur.state === 'skipped') continue;
        if (cur.at > best) {
          best = cur.at;
          checkpoint = s;
        }
      }
      if (checkpoint) {
        // What was done before the checkpoint stays done: every step done that the checkpoint cannot lead to.
        const after = reachFrom(def, checkpoint);
        keep = table<StepRec>();
        for (const s of Object.keys(rec.steps)) {
          const cur = rec.steps[s];
          if (s !== checkpoint && !after.has(s) && (cur.state === 'done' || cur.state === 'skipped')) keep[s] = { state: cur.state, n: cur.n, at: cur.at, ...(cur.choice ? { choice: cur.choice } : {}) };
        }
      }
    }
    this.restarting = true;
    try {
      return this.startRun(q, checkpoint, keep);
    } finally {
      this.restarting = false;
    }
  }

  /** Hold a quest where it is, with the plain reason it shows. */
  stall(q: string, why: string): void {
    const rec = this.quest(q);
    if (!rec || (rec.state === 'stalled' && rec.why === why)) return;
    if (!this.setQuest(q, { ...rec, state: 'stalled', why })) return;
    this.notes.push({ k: 'stalled', quest: q, title: this.def(q)?.title ?? q, why });
  }

  /** A job off the tracker, when it is on it. */
  private untrack(q: string): void {
    if (this.book.tracked.includes(q)) this.change({ k: 'track', quest: q, on: false });
  }

  /** End a quest's run with an outcome: its reward paid once, its actions run, any quest chained after it granted. */
  private end(q: string, outcome: string, run: number): void {
    const rec = this.quest(q);
    if (!rec || rec.state !== 'active' || rec.run !== run) return;
    const def = this.def(q);
    const now = this.ctx.now;
    const history = capHistory([...rec.history, { run, outcome, at: now }], this.limits.history);
    if (outcome === CLEARED) {
      if (this.setQuest(q, { ...without(rec, 'outcome', 'why'), state: 'none', ended: now, history })) this.untrack(q);
      return;
    }
    const od = def?.outcomes[outcome];
    const failure = od ? od.failure : outcome === 'failed';
    if (!this.setQuest(q, { ...without(rec, 'why'), state: failure ? 'failed' : 'done', outcome, ended: now, completions: rec.completions + (failure ? 0 : 1), history })) return;
    // A job that has ended leaves the tracker, so the three it holds are always jobs still to do.
    this.untrack(q);
    if (od?.reward) this.reward(q, rec.completions + 1, `#out:${outcome}`, od.reward);
    if (od) this.actions(od.do, { quest: q, run, site: `out:${outcome}`, n: rec.completions + 1 });
    this.notes.push({ k: failure ? 'failed' : 'done', quest: q, title: def?.title ?? q, outcome });
    for (const id of Object.keys(this.lib.quests)) {
      for (const g of this.lib.quests[id].givers) if (g.kind === 'chain' && g.after === q && (!g.outcome || g.outcome === outcome)) this.queue.push({ k: 'grant', q: id, how: 'grant' });
    }
  }

  /**
   * Pay a reward once: its key recorded first, and nothing paid when the book already has it. `n` is the
   * completion the reward counts towards (one more than the quest's completions when it is reached), never
   * the run: every try at one completion -- a restart, a drop and a fresh grant, a failure and a retry --
   * reaches the same key, so only a quest done and taken again pays again.
   */
  private reward(q: string, n: number, site: string, r: Reward): void {
    const key = `${q}#${n}${site}`;
    if (ownOf(this.book.paid, key)) return;
    if (!this.change({ k: 'paid', key, at: this.ctx.now, by: this.ctx.payer })) return;
    if (r.credits > 0) {
      this.pay.push({ key, credits: r.credits });
      this.notes.push({ k: 'paid', quest: q, credits: r.credits });
    }
    for (const it of r.items) {
      this.pay.push({ key, item: { kind: it.kind, id: it.id, n: it.n } });
      this.notes.push({ k: 'item', quest: q, kind: it.kind, id: it.id, n: it.n });
    }
    if (r.xp > 0 && this.change({ k: 'xp', add: r.xp })) this.notes.push({ k: 'xp', quest: q, n: r.xp });
    for (const s of r.standing) this.standing(q, s.track, s.add);
  }

  /**
   * Standing on a track. A repeatable quest gives no more than its `standingPerRealDay` in one real day
   * (Standing may be ground out, but only so fast); a loss is never capped.
   */
  private standing(q: string, track: Track, add: number): void {
    const def = this.def(q);
    const rec = this.quest(q);
    let amount = add;
    if (def && rec && def.repeat.every !== 'never' && add > 0) {
      const day = realDayOf(this.ctx.now);
      const given = rec.day && rec.day[0] === day ? rec.day[1] : 0;
      amount = Math.max(0, Math.min(add, def.repeat.standingPerRealDay - given));
      if (amount > 0) this.setQuest(q, { ...rec, day: [day, given + amount] });
    }
    if (amount !== 0 && this.change({ k: 'trackAdd', track, standing: amount })) this.notes.push({ k: 'standing', quest: q, track, n: amount });
  }

  // ---- steps -----------------------------------------------------------------------------------------

  /** A step asked to begin: skipped, waiting, or begun. */
  private activate(q: string, s: string, run: number): void {
    const rec = this.quest(q);
    if (!rec || rec.state !== 'active' || rec.run !== run) return;
    const step = this.def(q)?.steps[s];
    if (!step) return;
    const cur = stepIn(rec, s);
    if (cur && (cur.state === 'active' || cur.state === 'waiting')) return;
    const now = this.ctx.now;
    if (step.unless.some((u) => stepIn(rec, u)?.state === 'done') || !seedChance(step.chance, this.ctx.char, q, run, `chance:${s}`)) {
      this.setStep(q, s, { state: 'skipped', n: 0, at: now });
      this.touched.add(q);
      return;
    }
    if (step.after.some((a) => stepIn(rec, a)?.state !== 'done')) {
      this.setStep(q, s, { state: 'waiting', n: 0, at: now });
      this.touched.add(q);
      return;
    }
    this.start(q, s, run);
  }

  /** A waiting step whose `after` may all be done now. */
  private wake(q: string, s: string, run: number): void {
    const rec = this.quest(q);
    if (!rec || rec.state !== 'active' || rec.run !== run || stepIn(rec, s)?.state !== 'waiting') return;
    const step = this.def(q)?.steps[s];
    if (!step || step.after.some((a) => stepIn(rec, a)?.state !== 'done')) return;
    if (step.unless.some((u) => stepIn(rec, u)?.state === 'done')) {
      this.setStep(q, s, { state: 'skipped', n: 0, at: this.ctx.now });
      this.touched.add(q);
      return;
    }
    this.start(q, s, run);
  }

  private start(q: string, s: string, run: number): void {
    const rec = this.quest(q)!;
    const step = this.def(q)!.steps[s];
    const now = this.ctx.now;
    const away = !!this.ctx.away;
    const sr: StepRec = { state: 'active', n: 0, at: now };
    const span = step.for ?? step.timeLimit;
    // A played clock that begins while the character is away keeps its whole length until they come in.
    if (span && span.clock === 'played' && away) sr.remaining = span.ms;
    else if (span) sr.deadline = now + span.ms;
    const at = step.at ?? step.waypoint?.at ?? null;
    if (at && 'rel' in at && rec.from) sr.place = [rec.from.p[0] + at.dx, rec.from.p[1] + at.dz];
    if (step.type === 'observe' && step.area && !away && this.ctx.areas?.includes(step.area)) sr.since = now;
    if (!this.setStep(q, s, sr)) return;
    this.touched.add(q);
    this.actions(step.do.start, { quest: q, run, step: s, site: `${s}.start` });
    const type = STEP_TYPES[step.type];
    if (type?.instant) {
      this.queue.push({ k: 'complete', q, s, run });
      return;
    }
    if (step.visible === true) this.notes.push({ k: 'objective', quest: q, step: s });
    if (step.type === 'goto' && !away) {
      const place = placeOf(this.quest(q)!, step, sr);
      if (place && arrivedAt(place, step.radius, this.ctx.world, this.ctx.here, this.ctx.room)) this.queue.push({ k: 'complete', q, s, run });
    }
  }

  private complete(q: string, s: string, run: number): void {
    const rec = this.quest(q);
    if (!rec || rec.state !== 'active' || rec.run !== run) return;
    const cur = stepIn(rec, s);
    const step = this.def(q)?.steps[s];
    if (!cur || cur.state !== 'active' || !step) return;
    const done: StepRec = { state: 'done', n: cur.n, at: this.ctx.now };
    if (cur.choice) done.choice = cur.choice;
    if (cur.place) done.place = cur.place;
    if (!this.setStep(q, s, done)) return;
    this.touched.add(q);
    const scope = { quest: q, run, step: s };
    if (step.reward) this.reward(q, rec.completions + 1, `#${s}`, step.reward);
    this.actions(step.do.done, { ...scope, site: `${s}.done` });
    if (step.visible !== false && !STEP_TYPES[step.type]?.instant) this.notes.push({ k: 'objectiveDone', quest: q, step: s });
    for (const name of step.signalsOut.done) this.queue.push({ k: 'raise', name });
    for (const g of step.grant.done) this.queue.push({ k: 'grant', q: g, how: 'grant' });
    if (step.type === 'end') this.queue.push({ k: 'end', q, outcome: step.outcome ?? 'done', run });
    else if (step.ends) this.queue.push({ k: 'end', q, outcome: step.ends, run });
    else this.follow(q, run, step.next, step.nextOne, scope);
    this.wakeAll(q, run);
  }

  private follow(q: string, run: number, next: Edge[], nextOne: Edge[], scope: Scope): void {
    for (const e of next) if (!e.when || this.holds(e.when, scope)) this.queue.push({ k: 'activate', q, s: e.to, run });
    for (const e of nextOne) {
      if (e.when && !this.holds(e.when, scope)) continue;
      this.queue.push({ k: 'activate', q, s: e.to, run });
      break;
    }
  }

  private wakeAll(q: string, run: number): void {
    const rec = this.quest(q);
    if (!rec) return;
    for (const s of Object.keys(rec.steps)) if (rec.steps[s].state === 'waiting') this.queue.push({ k: 'wake', q, s, run });
  }

  private failStep(q: string, s: string, run: number): void {
    const rec = this.quest(q);
    if (!rec || rec.state !== 'active' || rec.run !== run) return;
    const cur = stepIn(rec, s);
    const step = this.def(q)?.steps[s];
    if (!cur || cur.state !== 'active' || !step) return;
    if (!this.setStep(q, s, { state: 'failed', n: cur.n, at: this.ctx.now })) return;
    this.touched.add(q);
    this.actions(step.do.fail, { quest: q, run, step: s, site: `${s}.fail` });
    for (const name of step.signalsOut.fail) this.queue.push({ k: 'raise', name });
    for (const g of step.grant.fail) this.queue.push({ k: 'grant', q: g, how: 'grant' });
    if (step.onFail.length) for (const t of step.onFail) this.queue.push({ k: 'activate', q, s: t, run });
    else this.queue.push({ k: 'end', q, outcome: 'failed', run });
  }

  /** Every active step of every active quest, in book order: what the board and the detectors walk. */
  private *activeSteps(): Generator<{ q: string; s: string; rec: QuestRec; cur: StepRec; step: StepDef }> {
    for (const q of Object.keys(this.book.quests ?? {})) {
      const rec = this.book.quests![q];
      if (rec.state !== 'active') continue;
      const def = this.def(q);
      if (!def) continue;
      for (const s of Object.keys(rec.steps)) {
        const cur = rec.steps[s];
        const step = def.steps[s];
        if (cur.state === 'active' && step) yield { q, s, rec, cur, step };
      }
    }
  }

  // ---- actions ---------------------------------------------------------------------------------------

  actions(list: readonly ActionDef[], scope: Scope): void {
    for (let i = 0; i < list.length; i++) this.act(list[i], scope, `${scope.site ?? 'do'}.${i}`);
  }

  /**
   * An action that hands something over -- credits, a thing, experience, Standing -- paid once, as a
   * reward is: keyed by its quest, the completion it counts towards and where it was written (`at`),
   * recorded first and paid only when the book did not have it. Written outside any quest (the console's
   * `run`), it is keyed by the moment instead, so each call pays once.
   */
  private payOnce(scope: Scope, at: string, r: Reward): void {
    const q = scope.quest;
    const n = q ? (scope.n ?? (this.quest(q)?.completions ?? 0) + 1) : Math.floor(this.ctx.now);
    this.reward(q ?? 'run', n, `#do:${at}`, r);
  }

  private act(a: ActionDef, scope: Scope, at: string): void {
    if (a.wave > BUILT_WAVE) {
      this.tally.unbuilt++;
      return;
    }
    const x = a.args[0] as string;
    const y = a.args[1];
    switch (a.act) {
      case 'pay':
        this.payOnce(scope, at, { credits: Math.max(0, Math.floor(a.args[0] as number)), xp: 0, items: [], standing: [] });
        return;
      case 'give': {
        const n = typeof a.args[2] === 'number' ? Math.max(1, Math.floor(a.args[2])) : 1;
        this.payOnce(scope, at, { credits: 0, xp: 0, items: [{ kind: x as 'wear' | 'weapon', id: y as string, n }], standing: [] });
        return;
      }
      case 'xp':
        this.payOnce(scope, at, { credits: 0, xp: Math.max(0, Math.floor(a.args[0] as number)), items: [], standing: [] });
        return;
      case 'standing':
        this.payOnce(scope, at, { credits: 0, xp: 0, items: [], standing: [{ track: x as Track, add: y as number }] });
        return;
      case 'waypoint': {
        // A waypoint of the character's own, set by the story: minted by the host, as every personal one
        // is, marked as the story's (`by`), and set once -- a waypoint the story already set with the same
        // name at the same place on the same world is already there. One the player set is never taken
        // for it, whatever it is called.
        const name = cleanWaypointName(x) ?? 'Waypoint';
        const world = y as string;
        const px = a.args[2] as number;
        const pz = a.args[3] as number;
        const cell = a.args[4] as string | undefined;
        if (this.book.waypoints.some((w) => w.by && w.name === name && w.world === world && w.p[0] === px && w.p[1] === pz)) return;
        const wp: Waypoint = { id: `w${this.book.nextWp}`, name, world, f: world.startsWith('space_') ? 'game' : 'raw', p: [px, pz, null], colour: WAYPOINT_TUNE.defaultQuest, on: true, made: this.ctx.now, by: scope.quest ?? 'run' };
        if (cell) wp.room = { cell };
        this.change({ k: 'wpSet', wp });
        return;
      }
      case 'waypointGone': {
        // By its id (`w12`) or by the name the story gave it, which is all an author can know of one, read as
        // the name was kept (cleaned and cut). Only a waypoint a story set: the player's own are theirs.
        const name = cleanWaypointName(x);
        for (const w of [...this.book.waypoints]) if (w.by && (w.id === x || (name !== null && w.name === name))) this.change({ k: 'wpGone', id: w.id });
        return;
      }
      case 'say':
        this.notes.push({ k: 'say', text: x });
        return;
      case 'offer':
      case 'grant':
        this.queue.push({ k: 'grant', q: x, how: a.act === 'offer' ? 'offer' : 'grant' });
        return;
      case 'signal':
        this.queue.push({ k: 'raise', name: x });
        return;
      case 'complete':
      case 'failStep': {
        const rec = this.quest(x);
        if (rec) this.queue.push({ k: a.act === 'complete' ? 'complete' : 'fail', q: x, s: y as string, run: rec.run });
        return;
      }
      case 'end':
      case 'fail': {
        const rec = this.quest(x);
        if (rec?.state === 'active') this.queue.push({ k: 'end', q: x, outcome: (y as string) ?? (a.act === 'end' ? 'done' : 'failed'), run: rec.run });
        return;
      }
      case 'drop':
        this.drop(x);
        return;
      case 'restart':
        this.restart(x);
        return;
      case 'close':
        for (const q of a.args as string[]) if (!this.book.closed?.includes(q)) this.change({ k: 'closed', quest: q });
        return;
      case 'flag':
        this.change({ k: 'flag', name: x, value: y as number | string });
        return;
      case 'unflag':
        this.change({ k: 'flag', name: x, value: null });
        return;
      case 'call': {
        const s = scriptOf(x);
        if (!s?.act || this.scriptDepth >= SCRIPT_DEPTH) {
          this.tally.misses++;
          return;
        }
        let out: { act: string; args: Lit[] }[] = [];
        try {
          out = s.act(a.args.slice(1), lookOf(this.book, this.ctx));
        } catch {
          this.tally.misses++;
          return;
        }
        this.scriptDepth++;
        try {
          const list = Array.isArray(out) ? out : [];
          for (let j = 0; j < list.length; j++) {
            const o = list[j];
            const spec = ACTIONS[o?.act];
            if (!spec || spec.reserved || !Array.isArray(o.args)) {
              this.tally.misses++;
              continue;
            }
            this.act({ act: o.act, args: o.args, wave: spec.wave }, scope, `${at}.${j}`);
          }
        } finally {
          this.scriptDepth--;
        }
        return;
      }
      default:
        this.tally.unbuilt++;
    }
  }

  // ---- the board and the detectors -------------------------------------------------------------------

  /**
   * A signal raised for this character: every active step waiting on it is counted, and done once it has
   * counted to its `n`. A signal nobody is waiting for when it is raised is not kept.
   */
  raise(name: string): void {
    for (const { q, s, rec, cur, step } of [...this.activeSteps()]) {
      if (awaits(step) !== name) continue;
      const n = cur.n + 1;
      if (!this.setStep(q, s, { ...cur, n })) continue;
      if (n >= step.n) this.queue.push({ k: 'complete', q, s, run: rec.run });
    }
  }

  /** The player is at a place: every active goto step it satisfies is done. */
  arrive(world: string, p: [number, number], room: Room | null | undefined, only?: { quest?: string; step?: string }): void {
    for (const { q, s, rec, cur, step } of [...this.activeSteps()]) {
      if (step.type !== 'goto' || (only?.quest && only.quest !== q) || (only?.step && only.step !== s)) continue;
      const place = placeOf(rec, step, cur);
      if (place && arrivedAt(place, step.radius, world, p, room)) this.queue.push({ k: 'complete', q, s, run: rec.run });
    }
  }

  /** The player went into or out of an area: its signal raised, and every observe step on it starts or stops watching. */
  area(id: string, inside: boolean): void {
    this.raise(`${inside ? 'entered' : 'left'}:${id}`);
    const now = this.ctx.now;
    for (const { q, s, cur, step } of [...this.activeSteps()]) {
      if (step.type !== 'observe' || step.area !== id) continue;
      if (inside && cur.since === undefined) this.setStep(q, s, { ...cur, since: now });
      else if (!inside && cur.since !== undefined) this.setStep(q, s, { ...without(cur, 'since'), n: step.continuous ? 0 : cur.n + (now - cur.since) });
    }
  }

  /** A death the player is credited with: every matching kill step counted, and `died:<who>` raised. */
  kill(who: string, group?: string, social?: string, tags?: readonly string[]): void {
    for (const { q, s, rec, cur, step } of [...this.activeSteps()]) {
      const m = step.kill;
      if (step.type !== 'kill' || !m) continue;
      if (m.who && !m.who.includes(who)) continue;
      if (m.group && m.group !== group) continue;
      if (m.social && m.social !== social) continue;
      if (m.tag && !tags?.includes(m.tag)) continue;
      const n = cur.n + 1;
      if (!this.setStep(q, s, { ...cur, n })) continue;
      if (n >= step.n) this.queue.push({ k: 'complete', q, s, run: rec.run });
    }
    this.raise(`died:${who}`);
  }

  /** The player died: every active step that fails on it fails. */
  death(): void {
    for (const { q, s, rec, step } of [...this.activeSteps()]) if (step.failOn.includes('death')) this.queue.push({ k: 'fail', q, s, run: rec.run });
  }

  /** A story object used: its signal raised, then every quest it gives granted (the use that granted one is not counted towards it). */
  use(object: string): void {
    this.raise(`used:${object}`);
    for (const id of Object.keys(this.lib.quests)) {
      for (const g of this.lib.quests[id].givers) if (g.kind === 'use' && g.object === object) this.grant(id, 'grant');
    }
  }

  /**
   * The character leaves the world: every clock that counts only time played stops, keeping what it has
   * left, and every watch an observe step was keeping is closed as stepping out of its area closes it, so
   * neither counts the time away. Anything the rest of this event starts is started for a character who is away.
   */
  leave(): void {
    const now = this.ctx.now;
    for (const { q, s, cur, step } of [...this.activeSteps()]) {
      let next: StepRec | null = null;
      if (step.type === 'observe' && cur.since !== undefined) next = { ...without(cur, 'since'), n: step.continuous ? 0 : cur.n + Math.max(0, now - cur.since) };
      if (playedSpan(step) && cur.deadline !== undefined) next = { ...without(next ?? cur, 'deadline'), remaining: Math.max(0, cur.deadline - now) };
      if (next) this.setStep(q, s, next);
    }
    this.ctx = { ...this.ctx, away: true };
  }

  /** The character comes back into the world: those clocks start again from what they had left. */
  enter(): void {
    this.ctx = { ...this.ctx, away: false };
    const now = this.ctx.now;
    for (const { q, s, cur, step } of [...this.activeSteps()]) {
      if (!playedSpan(step) || cur.remaining === undefined || cur.deadline !== undefined) continue;
      this.setStep(q, s, { ...without(cur, 'remaining'), deadline: now + cur.remaining });
    }
  }

  /**
   * Every deadline that has passed by `now`, in the order it fell due and each at its own time, so what
   * happens next is stamped with when it really happened rather than when anybody looked.
   */
  settle(now: number): void {
    const seen = new Set<string>();
    for (let i = 0; i < SETTLE_MAX && !this.broken; i++) {
      const due = dueList(this.book, this.lib).find((d) => !seen.has(`${d.quest}#${d.run}#${d.step}#${d.at}`));
      if (!due || due.at > now) break;
      seen.add(`${due.quest}#${due.run}#${due.step}#${due.at}`);
      this.ctx = { ...this.ctx, now: due.at };
      this.queue.push({ k: due.then === 'complete' ? 'complete' : 'fail', q: due.quest, s: due.step, run: due.run });
      this.run();
    }
    this.ctx = { ...this.ctx, now };
  }

  /**
   * Every quest whose definition is not the one its run began under: carried on when every step it is in
   * still exists, restarted where its definition allows, and otherwise held as revised. A quest held for
   * that reason whose steps all exist again carries on; one whose definition is gone is held.
   */
  revise(): void {
    for (const q of Object.keys(this.book.quests ?? {})) {
      const rec = this.book.quests![q];
      if (rec.state !== 'active' && rec.state !== 'offered' && rec.state !== 'stalled') continue;
      const def = this.def(q);
      if (!def) {
        if (rec.state === 'offered') this.setQuest(q, { ...rec, state: 'none' });
        else this.stall(q, STALLED_REVISED);
        continue;
      }
      if (rec.state === 'stalled' && rec.why !== STALLED_REVISED) continue;
      if (rec.state !== 'stalled' && rec.defHash === def.hash) continue;
      if (rec.state === 'offered') {
        this.setQuest(q, { ...rec, defRev: def.rev, defHash: def.hash });
        continue;
      }
      if (fits(rec, def)) {
        this.setQuest(q, { ...without(rec, 'why'), state: 'active', defRev: def.rev, defHash: def.hash });
        this.touched.add(q);
        continue;
      }
      if (def.restart !== 'never' && !def.harsh) {
        // A checkpoint the new definition no longer has is no place to go back to: from the start, then.
        if (this.restart(q) === null) continue;
      }
      this.stall(q, STALLED_REVISED);
    }
  }

  /** A held quest put back: carried on when it fits its definition, else started over as it allows. The console's and an admin's. */
  unstick(q: string): string | null {
    const rec = this.quest(q);
    if (rec?.state !== 'stalled') return 'that job is not held';
    const def = this.def(q);
    if (!def) return 'there is no such job';
    if (fits(rec, def)) {
      this.setQuest(q, { ...without(rec, 'why'), state: 'active', defRev: def.rev, defHash: def.hash });
      this.touched.add(q);
      return null;
    }
    return this.restart(q) ?? null;
  }

  /** One event, as a host's detectors hand it over. */
  event(ev: StoryEvent): void {
    switch (ev.k) {
      case 'arrive':
        this.arrive(ev.world, ev.p, ev.room, { quest: ev.quest, step: ev.step });
        return;
      case 'room':
        this.raise(`room:${ev.template}#${ev.cell}`);
        if (this.ctx.world && this.ctx.here) this.arrive(this.ctx.world, this.ctx.here, { cell: ev.cell, template: ev.template });
        return;
      case 'area':
        this.area(ev.area, ev.inside);
        return;
      case 'use':
        this.use(ev.object);
        return;
      case 'kill':
        this.kill(ev.who, ev.group, ev.social, ev.tags);
        return;
      case 'death':
        this.death();
        return;
      case 'world':
        this.raise(`world:${ev.world}`);
        return;
      case 'signal':
        this.raise(ev.name);
        return;
      case 'enter':
        this.enter();
        return;
      case 'leave':
        this.leave();
        return;
      case 'tick':
        this.settle(this.ctx.now);
        return;
    }
  }

  /**
   * What the watchdog uses to move a stuck step on -- an active one nothing can finish, or a waiting one
   * whose `after` can never all be done: skip it (and follow its edges), go to a named step, or hold the
   * quest.
   */
  stuck(q: string, s: string): void {
    const rec = this.quest(q);
    const step = this.def(q)?.steps[s];
    if (!rec || rec.state !== 'active' || !step) return;
    const cur = stepIn(rec, s);
    if (!cur || (cur.state !== 'active' && cur.state !== 'waiting')) return;
    if (step.onStuck === 'fail') {
      this.stall(q, STALLED_STUCK);
      return;
    }
    if (!this.setStep(q, s, { state: 'skipped', n: cur.n, at: this.ctx.now })) return;
    this.touched.add(q);
    if (step.onStuck === 'skip') this.follow(q, rec.run, step.next, step.nextOne, { quest: q, run: rec.run, step: s });
    else this.queue.push({ k: 'activate', q, s: step.onStuck, run: rec.run });
  }
}

/** The steps one step can begin: its edges, its failures, its onStuck and its choices' edges. */
export function stepsOutOf(st: StepDef): string[] {
  return [...st.next.map((e) => e.to), ...st.nextOne.map((e) => e.to), ...st.onFail, ...(st.onStuck !== 'fail' && st.onStuck !== 'skip' ? [st.onStuck] : []), ...(st.options ?? []).flatMap((o) => o.next)];
}

/** Every step a step can lead to, through its edges, its failures and its choices' edges. */
export function reachFrom(def: QuestDef, from: string): Set<string> {
  const seen = new Set<string>();
  const todo = [from];
  while (todo.length) {
    const s = todo.pop()!;
    const st = def.steps[s];
    if (!st) continue;
    for (const t of stepsOutOf(st)) if (!seen.has(t)) {
      seen.add(t);
      todo.push(t);
    }
  }
  return seen;
}

/**
 * The waiting steps of a run that can never begin: a step of their `after` is not done, and nothing still
 * live can make it done -- it was skipped, it failed, or it lies on a branch the run did not take. What is
 * live is every active step and everything it can lead to, and a waiting step counts as live (and leads on)
 * only once everything it waits on is done or live itself, worked to a fixed point, so two waiting steps
 * each waiting on what only the other leads to are both found. A condition on an edge is taken as able to
 * hold, so a step is only ever found here when no way on is left at all.
 */
export function deadWaits(rec: QuestRec, def: QuestDef): string[] {
  const waiting: string[] = [];
  for (const s of Object.keys(rec.steps)) if (rec.steps[s].state === 'waiting' && def.steps[s]) waiting.push(s);
  if (!waiting.length) return [];
  const isDone = (s: string): boolean => stepIn(rec, s)?.state === 'done';
  const ready = new Set<string>();
  const live = new Set<string>();
  const todo: string[] = [];
  for (const s of Object.keys(rec.steps)) if (rec.steps[s].state === 'active') todo.push(s);
  const spread = (): void => {
    while (todo.length) {
      const s = todo.pop()!;
      if (live.has(s)) continue;
      live.add(s);
      // A waiting step reached again does nothing until what it waits on is done, so it leads nowhere yet.
      if (stepIn(rec, s)?.state === 'waiting' && !ready.has(s)) continue;
      const st = def.steps[s];
      if (st) for (const t of stepsOutOf(st)) if (!live.has(t)) todo.push(t);
    }
  };
  spread();
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of waiting) {
      if (ready.has(s)) continue;
      const can = def.steps[s].after.every((a) => isDone(a) || (live.has(a) && (stepIn(rec, a)?.state !== 'waiting' || ready.has(a))));
      if (!can) continue;
      ready.add(s);
      live.delete(s);
      todo.push(s);
      spread();
      grew = true;
    }
  }
  return waiting.filter((s) => !ready.has(s));
}

/** What a paid key handed over that a server can pay again on a browser's behalf: credits and things. */
export interface KeyReward {
  quest: string;
  /** The completion it counts towards. */
  n: number;
  credits: number;
  items: { kind: 'wear' | 'weapon'; id: string; n: number }[];
}

const DO_STEP = /^(.+)\.(start|done|fail)\.(\d+)$/;
const DO_OUT = /^out:(.+)\.(\d+)$/;

/**
 * What a reward's key paid, read back from the set it was paid under, or null when the set cannot say: the
 * key's quest, step, outcome or action is not there, the key was the console's (`run#...`, keyed by the
 * moment, with nothing written to read back), or the action was one a script handed over (a key with a
 * further `.<j>`, whose amount was the script's). The key's own shape is `reward` and `payOnce` above:
 * `<quest>#<n>#<step>`, `<quest>#<n>#out:<outcome>`, or `<quest>#<n>#do:<step>.<phase>.<i>` and
 * `<quest>#<n>#do:out:<outcome>.<i>` for an action that pays. A step's or an outcome's name may itself
 * hold a dot, so an action's place is read from its end.
 */
export function rewardOfKey(key: string, lib: StorySet): KeyReward | null {
  const parts = key.split('#');
  if (parts.length !== 3) return null;
  const [quest, ns, site] = parts;
  const def = lib.quests[quest];
  const n = Number(ns);
  if (!def || !Number.isInteger(n) || n < 1) return null;
  const of = (r: Reward | null | undefined): KeyReward | null => (r ? { quest, n, credits: r.credits, items: r.items.map((i) => ({ ...i })) } : null);
  if (site.startsWith('do:')) {
    const at = site.slice(3);
    let list: readonly ActionDef[] | null = null;
    let i = -1;
    const out = DO_OUT.exec(at);
    const step = out ? null : DO_STEP.exec(at);
    if (out) {
      list = def.outcomes[out[1]]?.do ?? null;
      i = Number(out[2]);
    } else if (step) {
      const st = def.steps[step[1]];
      list = st ? st.do[step[2] as 'start' | 'done' | 'fail'] : null;
      i = Number(step[3]);
    }
    const a = list?.[i];
    if (!a) return null;
    if (a.act === 'pay') return { quest, n, credits: Math.max(0, Math.floor(a.args[0] as number)), items: [] };
    if (a.act === 'give') return { quest, n, credits: 0, items: [{ kind: a.args[0] as 'wear' | 'weapon', id: a.args[1] as string, n: typeof a.args[2] === 'number' ? Math.max(1, Math.floor(a.args[2])) : 1 }] };
    return { quest, n, credits: 0, items: [] };
  }
  if (site.startsWith('out:')) return of(def.outcomes[site.slice(4)]?.reward);
  return of(def.steps[site]?.reward);
}

/** Work out one event's worth of changes on a copy of a book, never touching the book. */
export function plan(book: StoryBook, lib: StorySet, ctx: StoryCtx, work: (d: Draft) => void, limits?: BookLimits): StoryResult {
  const d = new Draft(book, lib, ctx, limits);
  work(d);
  d.run();
  return d.result();
}

/**
 * Every deadline that passed by `now`, settled in order (`clock.ts` holds the units; this lives with the
 * machine because settling a deadline is running it).
 */
export function settleDeadlines(book: StoryBook, lib: StorySet, now: number, ctx?: Partial<StoryCtx>, limits?: BookLimits): StoryResult {
  return plan(book, lib, { char: book.char, payer: 'browser', ...ctx, now }, (d) => d.settle(now), limits);
}
