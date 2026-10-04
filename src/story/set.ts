// A story set: a folder of the owner's files (or the committed test set) read into the definitions the
// step machine runs. Pure: it is handed the files' paths and texts, so the browser (fetching them), the
// server and the checker's command line (reading them with node's `fs`, `server/storySet.mjs`) all read
// a set the same way, and none of them reads it twice.
//
// **The folder.** `story.jsonc` names the set's prefix and title; `quests/`, `areas/`, `objects/`, `talk/`
// (the conversations) and `cast/` (the story's named people) hold one definition a file, in JSONC
// (`jsonc.ts`; the last two are read in `talkSet.ts`); `docs/` holds the documents, one `<id>.doc.txt` a file
// in a text format of their own (`doc.ts`); `file.jsonc` is the ISB file's levels and how long its entries
// wait to be seen (`file.ts`), `calendar.jsonc` the date a document's `{date}` reads (`doc.ts`), and
// `ladders.jsonc` the ranks of the three tracks and the words Trust is shown in (`standing.ts`), one of each to
// a set, the owner's winning over the test set's when both are read. `fixtures/` is never loaded at all: it
// holds files built to fail the checker.
//
// **Ids.** The loader prefixes every id with its set's (`goto` in the test set is `test:goto`, an object
// `obj/test-terminal` is `test:obj/test-terminal`), so the owner writes plain names and two sets can never
// collide. A reference inside one set may leave the prefix off; one into another set carries it.
//
// **What it checks.** Everything about a file on its own: that it reads, that every field is the kind it
// should be, that every condition and action is a word of the vocabulary with the right arguments
// (`vocab.ts`, through `expr.ts` for the short spellings), that nothing kept for a later pass is used,
// that a place relative to where a quest began is only in the test set, and that nothing anywhere claims
// to be the canonical or "true" version of anything. What only shows across files -- that a step can be
// reached, that a signal has something raising it -- is the checker's (`check.ts`). Each problem names its
// file and line.
//
// **The hash.** A set's hash is SHA-256 over its files' paths and texts in path order (line ends made
// plain first), through the game's own `src/net/hash.ts`, so two hosts can tell whether they hold the same
// story. Each quest also carries the hash of its own definition, which is how a quest rewritten under a
// player is noticed.
//
// Every default here is ours.

import { hashText } from '../net/hash.ts';
import { BOOK_LIMITS, isFlagName, isQuestId, isStepName, isTrack, type Track } from './book.ts';
import { cleanSpan, type Span } from './clock.ts';
import { calendarOf, docLines, docOf, type CalendarDef, type DocDef } from './doc.ts';
import { parseAction, parseCondition, type CondJson, type Lit } from './expr.ts';
import { FILE_KINDS, fileDefOf, isFileKind, isFileTag, type FileDefIssue, type FilesDef } from './file.ts';
import { lineAt, parseJsonc, pointer } from './jsonc.ts';
import { isDivision, laddersOf, type LadderIssue, type LaddersDef } from './standing.ts';
import { castOf, isNodeName, talkOf, type CastDef, type TalkDef } from './talkSet.ts';
import { cleanTextRef, type TextRef } from './text.ts';
import { ACTIONS, BUILT_WAVE, CLIENTS, COND_HEADS, ITEM_KINDS, OP_KEYS, STEP_TYPES, VERBS, arity, argKindAt, readiness } from './vocab.ts';
import { cleanRoom, cleanWorld } from './waypoints.ts';

export type { CondJson, Lit } from './expr.ts';
export type { CastDef, TalkDef } from './talkSet.ts';
export type { CalendarDef, DocDef } from './doc.ts';
export type { FilesDef } from './file.ts';
export type { LaddersDef } from './standing.ts';

export interface Issue {
  level: 'error' | 'warning';
  file: string;
  line: number;
  col?: number;
  message: string;
  /** The checker's rule it breaks, by its number in the design (1 to 14), where it is one of those. */
  rule?: number;
}

/** Where a definition came from: its file and the line of every value in it, by JSON pointer. */
export interface Source {
  file: string;
  lines: Map<string, number>;
}

export interface Room {
  cell: string;
  template?: string;
}

/**
 * A place: on a planet in the raw (snapshot) frame, in a space zone in its own game frame (`f` says
 * which), with a room when it is inside one. A place relative to where the quest began (`rel`) is the
 * test set's alone.
 */
export type Place = { world: string; f: 'raw' | 'game'; p: [number, number]; room?: Room } | { rel: 'start'; dx: number; dz: number; world: string | null; room?: Room };

export interface Edge {
  to: string;
  when: CondJson | null;
}

export interface ActionDef {
  act: string;
  args: Lit[];
  wave: number;
}

export interface Reward {
  credits: number;
  xp: number;
  items: { kind: 'wear' | 'weapon'; id: string; n: number }[];
  standing: { track: Track; add: number }[];
  /** Trust moved, which only an action under pressure hands over (`trust(t, n)`); never written in a reward. */
  trust?: { track: Track; add: number }[];
}

/** Which deaths a kill step counts: every field given must match (catalogue id, group, social group, tag). */
export interface KillMatch {
  who?: string[];
  group?: string;
  social?: string;
  tag?: string;
}

/** A choice's option (the `choice` step arrives with conversations; kept now so the checker can read it). */
export interface OptionDef {
  id: string;
  label: TextRef | null;
  when: CondJson | null;
  stakes: TextRef | null;
  pressure: boolean;
  do: ActionDef[];
  next: string[];
  ends: string | null;
}

export interface StepDef {
  name: string;
  type: string;
  /** The wave its rules arrive in (3 for everything this wave runs). */
  wave: number;
  objective: TextRef | null;
  visible: boolean | 'after';
  /** PREREQUISITE_TASKS */
  after: string[];
  /** EXCLUSION_TASKS */
  unless: string[];
  /** CHANCE_TO_ACTIVATE */
  chance: number;
  timeLimit: Span | null;
  /** TASKS_ON_COMPLETE, each edge with an optional condition */
  next: Edge[];
  /** The same, but only the first edge whose condition holds is followed. */
  nextOne: Edge[];
  /** TASKS_ON_FAIL */
  onFail: string[];
  /** SIGNALS_ON_COMPLETE / SIGNALS_ON_FAIL */
  signalsOut: { done: string[]; fail: string[] };
  /** GRANT_QUEST_ON_COMPLETE / GRANT_QUEST_ON_FAIL */
  grant: { done: string[]; fail: string[] };
  /** QUEST_CONTROL_ON_TASK_COMPLETE: ends the quest with this outcome (or `cleared`) once the step is done. */
  ends: string | null;
  do: { start: ActionDef[]; done: ActionDef[]; fail: ActionDef[] };
  waypoint: { on: boolean; at: Place | null } | null;
  checkpoint: boolean;
  onStuck: string;
  failOn: string[];
  /** Whether an edge from this step may point back to one before it. */
  loop: boolean;
  // ---- what each type adds ----
  at: Place | null;
  radius: number;
  signal: string | null;
  n: number;
  kill: KillMatch | null;
  reward: Reward | null;
  object: string | null;
  area: string | null;
  seconds: number;
  continuous: boolean;
  for: Span | null;
  outcome: string | null;
  options: OptionDef[] | null;
  /** A talk step's speaker (`<set>:cast/<id>`, `row:<key>`) and the node of their conversation it waits for, or any node; a call's caller. */
  who: string | null;
  node: string | null;
  /** The document a `message`, `document` or `comm` step hands over and is done when it is read to its end; a `choice` step's own page, at whose foot its options stand. */
  doc: string | null;
  /** A later wave's own fields (a document step's document), kept as they came. */
  later: Record<string, unknown> | null;
}

export interface OutcomeDef {
  name: string;
  failure: boolean;
  /** Trust may move here: an outcome under pressure (checked by rule 5). */
  pressure: boolean;
  reward: Reward | null;
  do: ActionDef[];
}

export type Giver = { kind: 'debug' } | { kind: 'use'; object: string } | { kind: 'chain'; after: string; outcome: string | null } | { kind: 'talk'; who: string };

export interface Repeat {
  every: 'never' | 'always' | 'cooldown' | 'gameDay' | 'realDay';
  cooldown: number;
  /** The most completions; 0 for no limit. */
  limit: number;
  standingPerRealDay: number;
}

export interface QuestDef {
  id: string;
  rev: number;
  /** The hash of this definition: sixteen hex digits. */
  hash: string;
  title: TextRef;
  client: string;
  verb: string;
  track: Track | 'none';
  kind: 'solo' | 'group';
  harsh: boolean;
  /** true, false, or the outcome abandoning ends the quest as. */
  abandon: boolean | string;
  restart: 'never' | 'start' | 'checkpoint';
  repeat: Repeat;
  needs: CondJson | null;
  givers: Giver[];
  stakes: TextRef | null;
  card: string | null;
  risk: string[];
  start: string[];
  steps: Record<string, StepDef>;
  outcomes: Record<string, OutcomeDef>;
  /** What an importer writes that this pass keeps and does nothing with: reps, replacedBy, disabled, level, tier. */
  stored: Record<string, unknown>;
  test: boolean;
  src: Source;
}

export type Shape = { kind: 'circle'; c: [number, number]; r: number } | { kind: 'rect'; min: [number, number]; max: [number, number] } | { kind: 'poly'; pts: [number, number][] };

export interface AreaDef {
  id: string;
  world: string;
  f: 'raw' | 'game';
  shape: Shape;
  room?: Room;
  label: TextRef | null;
  test: boolean;
  src: Source;
}

/** A story object: a thing the world already places, picked by its template nearest a point. */
export interface ObjectDef {
  id: string;
  world: string;
  template: string;
  near: [number, number];
  reach: number;
  label: TextRef | null;
  test: boolean;
  src: Source;
}

export interface StorySet {
  /** The prefix, or the prefixes of a joined set (`own+test`). */
  name: string;
  prefix: string;
  title: string;
  hash: string;
  /** Each set it was made of, with its hash: what a server's hail lists. */
  sets: { name: string; hash: string }[];
  /** Whether any of it is the test set, where relative places and console signals are allowed. */
  test: boolean;
  quests: Record<string, QuestDef>;
  areas: Record<string, AreaDef>;
  objects: Record<string, ObjectDef>;
  /** The conversations, by `<set>:talk/<id>`. */
  talks: Record<string, TalkDef>;
  /** The story's named people, by `<set>:cast/<id>`. */
  cast: Record<string, CastDef>;
  /**
   * The game's own people who speak a conversation, by the creature they are stood as, to its id: what the
   * emulator's adopted conversations bind (`core3Trees.ts`). A story's own set binds nobody this way.
   */
  voices?: Record<string, string>;
  /** The documents, by `<set>:doc/<id>`. */
  docs?: Record<string, DocDef>;
  /** The files an agency keeps (`file.jsonc`), or null with none: one to a joined set, the first read winning. */
  file?: FilesDef | null;
  /** The calendar `{date}` reads (`calendar.jsonc`), or null: one to a joined set, the first read winning. */
  calendar?: CalendarDef | null;
  /** The ranks of the three tracks and the words Trust is shown in (`ladders.jsonc`), or null: one to a joined set, the first read winning. */
  ladders?: LaddersDef | null;
  /** Files a later wave reads, noted and not read. */
  later: string[];
  files: number;
}

export interface LoadResult {
  set: StorySet;
  errors: Issue[];
  warnings: Issue[];
  hash: string;
}

/** The signal prefixes the engine raises itself (`signals.ts` says which raiser each stands for). */
export const ENGINE_SIGNALS = ['used', 'entered', 'left', 'room', 'died', 'world', 'talked', 'read', 'debug'] as const;
/**
 * Words a set may not take as its prefix: the engine's signal prefixes, the id forms of the game's own
 * people, and `core3`, the emulator's own conversations' (`core3Trees.ts`).
 */
const NOT_A_PREFIX = [...ENGINE_SIGNALS, 'q', 'row', 'stood', 'job', 'obj', 'area', 'cast', 'doc', 'talk', 'core3'];
/** The committed test set's prefix, which no other set may take. */
export const TEST_PREFIX = 'test';

const PREFIX = /^[a-z][a-z0-9_-]{0,23}$/;
const NAME = /^[A-Za-z0-9_./-]{1,96}$/;
const REF_NAME = /^[A-Za-z0-9_.-]{1,96}$/;
const SIGNAL_NAME = /^[A-Za-z0-9_./-]{1,64}$/;
const TEMPLATE = /^[A-Za-z0-9_./-]{1,160}$/;
/** The keys rule 10 refuses anywhere: nothing marks a version of anything as the true one. */
const CANONICAL = /^(canonical|iscanonical|true|truth|istrue|genuine|thetruth)$/i;

/** The outcomes every quest has, whether it declares them or not. */
export const DEFAULT_OUTCOMES = ['done', 'failed'];
/** The outcome that puts a quest back to `none`, keeping its history. It is not declared. */
export const CLEARED = 'cleared';
/** A goto's radius when none is written, in metres. Ours. */
export const GOTO_RADIUS = 8;
/** An object's reach when none is written, in metres. Ours. */
export const OBJECT_REACH = 3;
/** Standing a repeatable quest may give in one real day, unless it says otherwise (the design's 500). */
export const STANDING_PER_REAL_DAY = 500;

/** `{ gte: 50 }` and its kind: exactly one comparison, with a finite number. Null when it is not one. */
function numberCompare(x: unknown): Record<string, number> | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 1 || !(OP_KEYS as readonly string[]).includes(keys[0])) return null;
  const v = o[keys[0]];
  return typeof v === 'number' && Number.isFinite(v) ? { [keys[0]]: v } : null;
}

/** A value as plain text with its keys in order, for hashing a definition. */
export function stableText(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'null';
  if (x instanceof Map) return '{}';
  if (Array.isArray(x)) return `[${x.map(stableText).join(',')}]`;
  const o = x as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableText(o[k])}`)
    .join(',')}}`;
}

/**
 * One file's checking: its name, its lines, the set's prefix and where every problem goes. A conversation's
 * file is read through it too (`talkSet.ts`), with `tree` naming that conversation while it is read, so a
 * node it names without its tree (`heard(hello)`) is one of its own.
 */
export class FileScope {
  file: string;
  lines: Map<string, number>;
  prefix: string;
  test: boolean;
  issues: Issue[];
  tree: string | null = null;

  constructor(file: string, lines: Map<string, number>, prefix: string, test: boolean, issues: Issue[]) {
    this.file = file;
    this.lines = lines;
    this.prefix = prefix;
    this.test = test;
    this.issues = issues;
  }

  err(path: string, message: string, rule?: number): null {
    this.issues.push({ level: 'error', file: this.file, line: lineAt(this.lines, path), message, ...(rule ? { rule } : {}) });
    return null;
  }

  warn(path: string, message: string, rule?: number): void {
    this.issues.push({ level: 'warning', file: this.file, line: lineAt(this.lines, path), message, ...(rule ? { rule } : {}) });
  }

  src(): Source {
    return { file: this.file, lines: this.lines };
  }

  // ---- references ----------------------------------------------------------------------------------

  quest(v: unknown, path: string): string | null {
    if (typeof v !== 'string' || !v.trim()) return this.err(path, 'a quest is named by its id');
    const full = v.includes(':') ? v : `${this.prefix}:${v}`;
    return isQuestId(full) ? full : this.err(path, `${JSON.stringify(v)} is not a quest id`);
  }

  /** An id of one kind (`obj/<id>`, `area/<id>`, `cast/<id>`, `doc/<id>`, `talk/<id>`), prefixed. */
  ref(v: unknown, path: string, kind: 'obj' | 'area' | 'cast' | 'doc' | 'talk'): string | null {
    if (typeof v !== 'string') return this.err(path, `expected ${kind}/<id>`);
    const colon = v.indexOf(':');
    const set = colon >= 0 ? v.slice(0, colon) : this.prefix;
    const rest = colon >= 0 ? v.slice(colon + 1) : v;
    if (kind === 'cast' && v.startsWith('row:')) return /^row:[A-Za-z0-9_.-]{1,96}$/.test(v) ? v : this.err(path, `${JSON.stringify(v)} is not a game person's row`);
    if (!PREFIX.test(set) || !rest.startsWith(`${kind}/`) || !REF_NAME.test(rest.slice(kind.length + 1))) return this.err(path, `${JSON.stringify(v)} is not written ${kind}/<id>`);
    return `${set}:${rest}`;
  }

  /**
   * A signal's name, as it is raised: an engine signal (`used:obj/x`, `entered:area/x`, `room:<template>#<cell>`,
   * `died:<who>`, `world:<id>`, `talked:<who>[#node]`, `debug:<name>`) with its own ids prefixed, or one of
   * the set's own, prefixed with the set's name when it has none.
   */
  signal(v: unknown, path: string): string | null {
    if (typeof v !== 'string' || !v.trim()) return this.err(path, 'a signal is named');
    const colon = v.indexOf(':');
    const head = colon >= 0 ? v.slice(0, colon) : '';
    const rest = colon >= 0 ? v.slice(colon + 1) : v;
    if ((ENGINE_SIGNALS as readonly string[]).includes(head)) {
      switch (head) {
        case 'used': {
          const id = this.ref(rest, path, 'obj');
          return id ? `used:${id}` : null;
        }
        case 'entered':
        case 'left': {
          const id = this.ref(rest, path, 'area');
          return id ? `${head}:${id}` : null;
        }
        case 'room':
          return /^[A-Za-z0-9_./-]{1,160}#[A-Za-z0-9_ .-]{1,64}$/.test(rest) ? v : this.err(path, 'a room signal is room:<building template>#<cell name>');
        case 'died':
          if (rest.startsWith('cast/') || rest.includes(':cast/')) {
            const id = this.ref(rest, path, 'cast');
            return id ? `died:${id}` : null;
          }
          return /^[A-Za-z0-9_./-]{1,120}$/.test(rest) ? v : this.err(path, 'died: names a creature or a cast member');
        case 'world':
          return cleanWorld(rest) ? v : this.err(path, 'world: names a world');
        case 'talked': {
          const [who, node] = rest.split('#');
          const id = this.ref(who, path, 'cast');
          return id ? `talked:${id}${node !== undefined ? `#${node}` : ''}` : null;
        }
        case 'read': {
          // A document read to its end (a call heard to its end).
          const id = this.ref(rest, path, 'doc');
          return id ? `read:${id}` : null;
        }
        default:
          return /^[A-Za-z0-9_.-]{1,64}$/.test(rest) ? v : this.err(path, 'debug: is followed by a plain name');
      }
    }
    if (colon >= 0) return PREFIX.test(head) && SIGNAL_NAME.test(rest) ? v : this.err(path, `${JSON.stringify(v)} is not a signal name`);
    return SIGNAL_NAME.test(v) ? `${this.prefix}:${v}` : this.err(path, `${JSON.stringify(v)} is not a signal name`);
  }

  stepName(v: unknown, path: string): string | null {
    return isStepName(v) ? v : this.err(path, `${JSON.stringify(v)} is not a step's name`);
  }

  /**
   * A conversation's node as `heard` names one: `[set:]talk/<id>#<node>`, or inside a conversation's own file
   * the node alone. With `reply`, an answer as `chosen` names one: `...#<node>.<reply>`.
   */
  talkRef(v: unknown, path: string, reply: boolean): string | null {
    const what = reply ? 'an answer is written talk/<id>#<node>.<reply> (or <node>.<reply> inside its own conversation)' : 'a node is written talk/<id>#<node> (or the node alone inside its own conversation)';
    if (typeof v !== 'string') return this.err(path, what);
    const hash = v.indexOf('#');
    let tree: string | null;
    let rest: string;
    if (hash >= 0) {
      tree = this.ref(v.slice(0, hash), path, 'talk');
      rest = v.slice(hash + 1);
      if (!tree) return null;
    } else {
      tree = this.tree;
      rest = v;
      if (!tree) return this.err(path, what);
    }
    const parts = rest.split('.');
    if (parts.length !== (reply ? 2 : 1) || !parts.every(isNodeName)) return this.err(path, what);
    return `${tree}#${rest}`;
  }

  names(v: unknown, path: string, one: (x: unknown, p: string) => string | null): string[] {
    if (v === undefined) return [];
    const list = typeof v === 'string' ? [v] : v;
    if (!Array.isArray(list)) {
      this.err(path, 'expected a list');
      return [];
    }
    const out: string[] = [];
    list.forEach((x, i) => {
      const n = one(x, typeof v === 'string' ? path : `${path}/${i}`);
      if (n !== null) out.push(n);
    });
    return out;
  }

  text(v: unknown, path: string, required = false): TextRef | null {
    if (v === undefined || v === null) return required ? this.err(path, 'a text is needed here') : null;
    const t = cleanTextRef(v);
    return t ?? this.err(path, 'expected a text: words, "@table:key", ":key" or { "en": "..." }');
  }

  num(v: unknown, path: string, fallback: number, min = -Infinity, max = Infinity): number {
    if (v === undefined) return fallback;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
      this.err(path, `expected a number${min > -Infinity ? ` of ${min} or more` : ''}${max < Infinity ? ` up to ${max}` : ''}`);
      return fallback;
    }
    return v;
  }

  int(v: unknown, path: string, fallback: number, min = 0, max = 1e9): number {
    const n = this.num(v, path, fallback, min, max);
    if (!Number.isInteger(n)) {
      this.err(path, 'expected a whole number');
      return fallback;
    }
    return n;
  }

  bool(v: unknown, path: string, fallback: boolean): boolean {
    if (v === undefined) return fallback;
    if (typeof v !== 'boolean') {
      this.err(path, 'expected true or false');
      return fallback;
    }
    return v;
  }

  oneOf<T extends string>(v: unknown, path: string, list: readonly T[], fallback: T): T {
    if (v === undefined) return fallback;
    if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) {
      this.err(path, `expected one of ${list.join(', ')}`);
      return fallback;
    }
    return v as T;
  }

  span(v: unknown, path: string): Span | null {
    if (v === undefined || v === null) return null;
    const s = cleanSpan(v);
    return typeof s === 'string' ? this.err(path, s) : s;
  }

  // ---- conditions and actions ----------------------------------------------------------------------

  /** A condition in either spelling, checked and with its ids prefixed. */
  cond(v: unknown, path: string): CondJson | null {
    if (v === undefined || v === null) return null;
    if (typeof v === 'string') {
      const r = parseCondition(v, path);
      if ('error' in r) return this.err(path, `${r.error.message} (at character ${r.error.at + 1} of "${v}")`, /not a condition this game knows|takes \d/.test(r.error.message) ? 4 : undefined);
      return this.condJson(r.cond, path, true);
    }
    return this.condJson(v, path, false);
  }

  private condJson(x: unknown, path: string, written: boolean): CondJson | null {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return this.err(path, 'a condition is an expression, or an object naming one condition');
    const o = x as Record<string, unknown>;
    const heads = Object.keys(o).filter((k) => k in COND_HEADS);
    if (heads.length !== 1) return this.err(path, heads.length ? `a condition names one thing, not ${heads.join(' and ')}` : `${Object.keys(o).join(', ') || 'an empty object'} is not a condition this game knows`, 4);
    const head = heads[0];
    const wave = COND_HEADS[head];
    const extra = (allowed: string[]): boolean => {
      const bad = Object.keys(o).filter((k) => k !== head && !allowed.includes(k));
      if (bad.length) this.err(path, `${bad.join(', ')} is not part of a ${head} condition`);
      return bad.length === 0;
    };
    const cmp = (): Record<string, unknown> | null => {
      const ops = OP_KEYS.filter((k) => k in o);
      if (ops.length !== 1) return this.err(path, `a ${head} condition compares with one of ${OP_KEYS.join(', ')}`);
      const v = o[ops[0]];
      if (typeof v !== 'number' && typeof v !== 'string') return this.err(path, 'a comparison is with a number or a string');
      return { [ops[0]]: v };
    };
    if (wave > BUILT_WAVE) {
      // A later wave's condition: checked for its name and that it is plain data, and its fields when that wave arrives.
      this.warn(path, `${head} conditions arrive in wave ${wave} of this pass; until then this reads false`);
      return JSON.parse(JSON.stringify(o)) as CondJson;
    }
    switch (head) {
      case 'all':
      case 'any': {
        if (!extra([]) || !Array.isArray(o[head])) return this.err(path, `${head} is a list of conditions`);
        const out: CondJson[] = [];
        let ok = true;
        (o[head] as unknown[]).forEach((c, i) => {
          const n = this.condJson(c, written ? path : `${path}/${head}/${i}`, written);
          if (n) out.push(n);
          else ok = false;
        });
        return ok ? { [head]: out } : null;
      }
      case 'not': {
        if (!extra([])) return null;
        const n = this.condJson(o.not, written ? path : `${path}/not`, written);
        return n ? { not: n } : null;
      }
      case 'quest': {
        if (!extra(['is', 'outcome'])) return null;
        const q = this.quest(o.quest, path);
        const is = this.oneOf(o.is, path, ['none', 'offered', 'active', 'failed', 'done', 'closed'] as const, 'done');
        if (o.outcome !== undefined && !isStepName(o.outcome)) return this.err(path, 'an outcome is a plain name');
        return q ? { quest: q, is, ...(o.outcome !== undefined ? { outcome: o.outcome } : {}) } : null;
      }
      case 'step': {
        if (!extra(['is']) || !Array.isArray(o.step) || o.step.length !== 2) return this.err(path, 'a step condition is { "step": [quest, step], "is": "active" | "done" }');
        const q = this.quest(o.step[0], path);
        const s = this.stepName(o.step[1], path);
        const is = this.oneOf(o.is, path, ['active', 'done'] as const, 'done');
        return q && s ? { step: [q, s], is } : null;
      }
      case 'completions': {
        if (!extra([...OP_KEYS])) return null;
        const q = this.quest(o.completions, path);
        const c = cmp();
        if (c && typeof Object.values(c)[0] !== 'number') return this.err(path, 'completions are compared with a number');
        return q && c ? { completions: q, ...c } : null;
      }
      case 'flag': {
        if (!extra(['set', ...OP_KEYS])) return null;
        if (!isFlagName(o.flag)) return this.err(path, `${JSON.stringify(o.flag)} is not a flag's name`);
        if (o.set !== undefined) return o.set === true && !OP_KEYS.some((k) => k in o) ? { flag: o.flag, set: true } : this.err(path, 'a flag is either "set": true or compared');
        const c = cmp();
        return c ? { flag: o.flag, ...c } : null;
      }
      case 'world':
        return extra([]) && cleanWorld(o.world) ? { world: o.world } : this.err(path, 'world names a world');
      case 'inArea': {
        if (!extra([])) return null;
        const a = this.ref(o.inArea, path, 'area');
        return a ? { inArea: a } : null;
      }
      case 'inRoom': {
        const room = extra([]) ? cleanRoom(o.inRoom) : null;
        return room ? { inRoom: room } : this.err(path, 'inRoom names a cell, and may name a template', 7);
      }
      case 'hour': {
        const h = o.hour;
        if (!extra([]) || !Array.isArray(h) || h.length !== 2 || !h.every((v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 24)) return this.err(path, 'hour is [from, to), whole game hours from 0 to 24');
        return { hour: [h[0], h[1]] };
      }
      case 'grouped':
        return extra([]) && o.grouped === true ? { grouped: true } : this.err(path, 'grouped is true');
      case 'species':
        return extra([]) && typeof o.species === 'string' && /^[a-z_]{1,32}$/.test(o.species) ? { species: o.species } : this.err(path, 'species names one');
      case 'chance': {
        if (!extra(['seed'])) return null;
        if (typeof o.chance !== 'number' || o.chance < 0 || o.chance > 1) return this.err(path, 'a chance is a number from 0 to 1');
        const seed = typeof o.seed === 'string' && o.seed ? o.seed.slice(0, 200) : `${path}#0`;
        return { chance: o.chance, seed };
      }
      case 'script': {
        if (!extra(['args'])) return null;
        if (typeof o.script !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(o.script)) return this.err(path, 'a script is named');
        const args = o.args === undefined ? [] : o.args;
        if (!Array.isArray(args) || !args.every((a) => typeof a === 'string' || typeof a === 'number' || typeof a === 'boolean')) return this.err(path, 'a script\'s arguments are a list of values');
        return { script: o.script, args: [...args] };
      }
      case 'credits': {
        // `{ "credits": { "gte": 50 } }`: what the character has to spend, compared with a number.
        if (!extra([])) return null;
        const c = numberCompare(o.credits);
        return c ? { credits: c } : this.err(path, 'credits is { "gte": n }, or one of the other comparisons, with a number');
      }
      case 'has': {
        // `{ "has": { "kind": "wear", "id": "shirt_s03", "n": 1 } }`: a thing of the ledger's own two kinds owned.
        if (!extra([])) return null;
        const h = o.has as Record<string, unknown> | null;
        if (!h || typeof h !== 'object' || Array.isArray(h) || !(ITEM_KINDS as readonly unknown[]).includes(h.kind) || typeof h.id !== 'string' || !/^[A-Za-z0-9_./-]{1,96}$/.test(h.id)) return this.err(path, 'has is { "kind": "wear" | "weapon", "id": <its id>, "n": 1 }');
        if (Object.keys(h).some((k) => k !== 'kind' && k !== 'id' && k !== 'n')) return this.err(path, 'has names a kind, an id and how many');
        if (h.n !== undefined && (typeof h.n !== 'number' || !Number.isInteger(h.n) || h.n < 1 || h.n > 1000)) return this.err(path, 'how many is a whole number from 1');
        return { has: { kind: h.kind, id: h.id, ...(h.n !== undefined ? { n: h.n } : {}) } };
      }
      case 'standing':
      case 'trust': {
        // `{ "standing": { "track": "freelance", "gte": 10 } }`: a track's number, compared.
        if (!extra([])) return null;
        const t = o[head] as Record<string, unknown> | null;
        if (!t || typeof t !== 'object' || Array.isArray(t) || !isTrack(t.track)) return this.err(path, `${head} is { "track": rebellion | empire | freelance, "gte": n }`);
        const { track, ...rest } = t;
        const c = numberCompare(rest);
        return c ? { [head]: { track, ...c } } : this.err(path, `${head} compares the track's number with one of ${OP_KEYS.join(', ')}`);
      }
      case 'choice': {
        // `{ "choice": [quest, step], "eq": "option" }`: the option a choice step was answered with.
        if (!extra(['eq']) || !Array.isArray(o.choice) || o.choice.length !== 2) return this.err(path, 'a choice condition is { "choice": [quest, step], "eq": option }');
        const q = this.quest(o.choice[0], path);
        const s = this.stepName(o.choice[1], path);
        if (!isStepName(o.eq)) return this.err(path, 'a choice is compared with an option\'s id');
        return q && s ? { choice: [q, s], eq: o.eq } : null;
      }
      case 'heard': {
        if (!extra([])) return null;
        const ref = this.talkRef(o.heard, path, false);
        return ref ? { heard: ref } : null;
      }
      case 'chosen': {
        if (!extra([])) return null;
        const ref = this.talkRef(o.chosen, path, true);
        return ref ? { chosen: ref } : null;
      }
      case 'person': {
        // Met, named or alive; their own Standing or Trust compared with a number; or their access, one word.
        if (!extra([])) return null;
        const p = o.person as Record<string, unknown> | null;
        if (!p || typeof p !== 'object' || Array.isArray(p)) return this.err(path, 'a person condition is { "person": { "who": cast/<id>, "is": "met" | "named" | "alive" } }, or their "standing", "trust" or "access"');
        const who = this.ref(p.who, path, 'cast');
        if (!who) return null;
        const keys = Object.keys(p).filter((k) => k !== 'who');
        if (keys.length !== 1) return this.err(path, 'a person condition asks one thing of them');
        const k = keys[0];
        if (k === 'is') return p.is === 'met' || p.is === 'named' || p.is === 'alive' ? { person: { who, is: p.is } } : this.err(path, 'a person is met, named or alive');
        if (k === 'standing' || k === 'trust') {
          const c = numberCompare(p[k]);
          return c ? { person: { who, [k]: c } } : this.err(path, `a person's ${k} is compared with one of ${OP_KEYS.join(', ')}, with a number`);
        }
        if (k === 'access') return p.access === 'open' || p.access === 'wary' || p.access === 'refused' || p.access === 'vouched' ? { person: { who, access: p.access } } : this.err(path, 'access is open, wary, refused or vouched');
        return this.err(path, `${k} is not something asked of a person`);
      }
      case 'rank': {
        // `{ "rank": { "track": t, "eq": rung } }`, `{ ..., "atLeast": rung }` or `{ ..., "ready": true }`.
        if (!extra([])) return null;
        const r = o.rank as Record<string, unknown> | null;
        if (!r || typeof r !== 'object' || Array.isArray(r) || !isTrack(r.track) || Object.keys(r).length !== 2) return this.err(path, 'a rank condition is { "rank": { "track": t, "eq" | "atLeast": rung } } or { ..., "ready": true }');
        if (r.ready === true) return { rank: { track: r.track, ready: true } };
        if (typeof r.eq === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(r.eq)) return { rank: { track: r.track, eq: r.eq } };
        if (typeof r.atLeast === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(r.atLeast)) return { rank: { track: r.track, atLeast: r.atLeast } };
        return this.err(path, 'a rank is a rung\'s id');
      }
      case 'track': {
        // `{ "track": { "track": t, "is": status } }` or `{ ..., "division": d }`.
        if (!extra([])) return null;
        const r = o.track as Record<string, unknown> | null;
        if (!r || typeof r !== 'object' || Array.isArray(r) || !isTrack(r.track) || Object.keys(r).length !== 2) return this.err(path, 'a track condition is { "track": { "track": t, "is": status } } or { ..., "division": d }');
        if (r.is !== undefined) return ['none', 'used', 'active', 'suspended', 'burned'].includes(r.is as string) ? { track: { track: r.track, is: r.is } } : this.err(path, 'a track is none, used, active, suspended or burned');
        if (r.division !== undefined) return isDivision(r.division) ? { track: { track: r.track, division: r.division } } : this.err(path, 'a division is surveillance, investigations, interrogation, internalAffairs, enforcement or reEducation');
        return this.err(path, 'a track condition asks its status or its division');
      }
      case 'companion': {
        // `{ "companion": { "who": cast/<id>, "is": state } }` or `{ "companion": { "up": true } }`.
        if (!extra([])) return null;
        const c = o.companion as Record<string, unknown> | null;
        if (!c || typeof c !== 'object' || Array.isArray(c)) return this.err(path, 'a companion condition is { "companion": { "who", "is" } } or { "companion": { "up": true } }');
        if (c.up === true && Object.keys(c).length === 1) return { companion: { up: true } };
        const who = this.ref(c.who, path, 'cast');
        if (!who) return null;
        return ['none', 'active', 'waiting', 'downed', 'dead', 'released'].includes(c.is as string) && Object.keys(c).length === 2 ? { companion: { who, is: c.is } } : this.err(path, 'a companion is none, active, waiting, downed, dead or released');
      }
      case 'debt': {
        // `{ "debt": { "to": name, "gt": 0 } }`: what is owed to somebody, compared.
        if (!extra([])) return null;
        const d = o.debt as Record<string, unknown> | null;
        if (!d || typeof d !== 'object' || Array.isArray(d) || typeof d.to !== 'string' || !/^[A-Za-z0-9_.:/-]{1,64}$/.test(d.to)) return this.err(path, 'a debt condition is { "debt": { "to": name, "gt": n } }');
        const { to, ...rest } = d;
        const c = numberCompare(rest);
        return c ? { debt: { to, ...c } } : this.err(path, `a debt is compared with one of ${OP_KEYS.join(', ')}, with a number`);
      }
      case 'witnessed': {
        // `{ "witnessed": doc/<id>, "variant": "a" }`: the document is in the journal, as that version of it.
        if (!extra(['variant'])) return null;
        const doc = this.ref(o.witnessed, path, 'doc');
        if (o.variant !== undefined && (typeof o.variant !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(o.variant))) return this.err(path, 'a variant is a plain name');
        return doc ? { witnessed: doc, ...(o.variant !== undefined ? { variant: o.variant } : {}) } : null;
      }
      case 'file': {
        // `{ "file": { "agency": "isb", "gte": 2 } }`: the level a file has reached, compared.
        if (!extra([])) return null;
        const f = o.file as Record<string, unknown> | null;
        if (!f || typeof f !== 'object' || Array.isArray(f) || f.agency !== 'isb') return this.err(path, 'file is { "agency": "isb", "gte": n }');
        const { agency, ...rest } = f;
        const c = numberCompare(rest);
        return c ? { file: { agency, ...c } } : this.err(path, `a file's level is compared with one of ${OP_KEYS.join(', ')}`);
      }
      case 'fileHas': {
        // `{ "fileHas": ["isb", "tag"] }`: any entry of the file carries the tag.
        if (!extra([])) return null;
        const h = o.fileHas;
        if (!Array.isArray(h) || h.length !== 2 || h[0] !== 'isb' || !isFileTag(h[1])) return this.err(path, 'fileHas is ["isb", tag], a tag a plain word');
        return { fileHas: [h[0], h[1]] };
      }
      default:
        return this.err(path, `${head} is not a condition this game knows`, 4);
    }
  }

  /** An action in either spelling, checked and with its ids prefixed. */
  action(v: unknown, path: string): ActionDef | null {
    let act: string;
    let args: unknown[];
    if (typeof v === 'string') {
      const r = parseAction(v);
      if ('error' in r) return this.err(path, `${r.error.message} (at character ${r.error.at + 1} of "${v}")`, /not an action this game knows|takes \d/.test(r.error.message) ? 4 : undefined);
      act = r.act.act;
      args = r.act.args;
    } else if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as Record<string, unknown>).act === 'string') {
      const o = v as Record<string, unknown>;
      const bad = Object.keys(o).filter((k) => k !== 'act' && k !== 'args');
      if (bad.length) return this.err(path, `${bad.join(', ')} is not part of an action, which is { "act": name, "args": [...] }`);
      act = o.act as string;
      args = o.args === undefined ? [] : Array.isArray(o.args) ? o.args : [o.args];
    } else return this.err(path, 'an action is a call such as "grant(test:next)", or { "act": "grant", "args": ["test:next"] }');
    const spec = ACTIONS[act];
    if (!spec) return this.err(path, `${act} is not an action this game knows`, 4);
    if (readiness(spec) === 'reserved') return this.err(path, `${act} is kept for a later pass and is not built in this pass`, 4);
    const { min, max } = arity(spec);
    if (args.length < min || args.length > max) return this.err(path, `${act} takes ${max === Infinity ? `${min} or more` : min === max ? min : `${min} to ${max}`} arguments, not ${args.length}`, 4);
    const out: Lit[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = this.arg(args[i], path, argKindAt(spec, i)!, act, i);
      if (a === null) return null;
      out.push(a);
    }
    if (act === 'file' && !this.fileArgs(out, path)) return null;
    if (act === 'assign' && !isDivision(out[1])) return this.err(path, 'assign names one of the Empire\'s divisions: surveillance, investigations, interrogation, internalAffairs, enforcement or reEducation', 4);
    if ((act === 'fine' || act === 'debt') && out[act === 'fine' ? 2 : 0] !== undefined && !/^[A-Za-z0-9_.:/-]{1,64}$/.test(String(out[act === 'fine' ? 2 : 0]))) return this.err(path, `${act} owes a debt to a plain name`, 4);
    if ((act === 'activate' || act === 'useTrack') && out[1] !== undefined && !/^[A-Za-z0-9_.:-]{1,64}$/.test(String(out[1]))) return this.err(path, `${act}'s cell is a plain word`, 4);
    if (act === 'kill') {
      // `kill(w[, how][, doc/<id>])`: the page that tells the character may stand where `how` would, and is a
      // document's id either way, prefixed as every id is.
      for (let i = 1; i < out.length; i++) {
        const v = String(out[i]);
        if (v.startsWith('doc/') || v.includes(':doc/')) {
          const id = this.ref(v, path, 'doc');
          if (!id) return null;
          out[i] = id;
        } else if (i === 2 || !/^[A-Za-z0-9_.-]{1,64}$/.test(v)) return this.err(path, 'kill\'s how is a plain word, and its page a document', 4);
      }
    }
    if (spec.wave > BUILT_WAVE) this.warn(path, `${act} arrives in wave ${spec.wave} of this pass; until then it does nothing`);
    return { act, args: out, wave: spec.wave };
  }

  /**
   * `file(isb, kind, weight[, doc/<id>][, tag...])`, its arguments made what they are: the kind one of the
   * file's, the weight nought or more (a file never shrinks), the page a document of this set or another
   * (prefixed as every id is), and every other argument a tag. False, with why, when they are not.
   */
  private fileArgs(args: Lit[], path: string): boolean {
    if (!isFileKind(args[1])) {
      this.err(path, `file's kind is one of ${FILE_KINDS.join(', ')}`, 4);
      return false;
    }
    if (typeof args[2] !== 'number' || args[2] < 0) {
      this.err(path, 'file\'s weight is a number of nought or more: a file never shrinks', 4);
      return false;
    }
    let doc = false;
    for (let i = 3; i < args.length; i++) {
      const a = args[i];
      if (typeof a === 'string' && (a.startsWith('doc/') || a.includes(':doc/'))) {
        if (doc) {
          this.err(path, 'a file entry has one page at most');
          return false;
        }
        const id = this.ref(a, path, 'doc');
        if (!id) return false;
        args[i] = id;
        doc = true;
      } else if (!isFileTag(a)) {
        this.err(path, `${JSON.stringify(a)} is not a tag: a plain word`, 4);
        return false;
      }
    }
    return true;
  }

  private arg(a: unknown, path: string, kind: string, act: string, i: number): Lit | null {
    const bad = (what: string): null => this.err(path, `${act}'s argument ${i + 1} is ${what}`, 4);
    switch (kind) {
      case 'quest':
        return this.quest(a, path);
      case 'step':
      case 'outcome':
        return isStepName(a) ? a : bad('a plain name');
      case 'signal':
        return this.signal(a, path);
      case 'flag':
        return isFlagName(a) ? a : bad('a flag\'s name');
      case 'value':
        return (typeof a === 'number' && Number.isFinite(a)) || (typeof a === 'string' && a.length <= 200) ? a : bad('a number or a string');
      case 'number':
        return typeof a === 'number' && Number.isFinite(a) ? a : bad('a number');
      case 'int':
        return typeof a === 'number' && Number.isInteger(a) ? a : bad('a whole number');
      case 'text': {
        const t = cleanTextRef(a);
        return typeof t === 'string' ? t : t ? t.en : bad('a text');
      }
      case 'world':
        return cleanWorld(a) ?? bad('a world');
      case 'area':
        return this.ref(a, path, 'area');
      case 'object':
        return this.ref(a, path, 'obj');
      case 'who':
        return this.ref(a, path, 'cast');
      case 'node':
        return this.talkRef(a, path, false);
      case 'reply':
        return this.talkRef(a, path, true);
      case 'doc':
        return this.ref(a, path, 'doc');
      case 'track':
        return isTrack(a) ? a : bad('rebellion, empire or freelance');
      case 'kind':
        return typeof a === 'string' && (ITEM_KINDS as readonly string[]).includes(a) ? a : bad('wear or weapon');
      case 'cell':
        return typeof a === 'string' && /^[A-Za-z0-9_ .-]{1,64}$/.test(a) ? a : bad('a cell\'s name');
      case 'template':
        return typeof a === 'string' && TEMPLATE.test(a) ? a : bad('a template');
      case 'script':
        return typeof a === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(a) ? a : bad('a script\'s name');
      case 'agency':
        return a === 'isb' ? a : bad('isb');
      default:
        return typeof a === 'string' || typeof a === 'number' || typeof a === 'boolean' ? a : bad('a value');
    }
  }

  actions(v: unknown, path: string): ActionDef[] {
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      this.err(path, 'actions are a list');
      return [];
    }
    const out: ActionDef[] = [];
    v.forEach((a, i) => {
      const n = this.action(a, `${path}/${i}`);
      if (n) out.push(n);
    });
    return out;
  }

  // ---- places, spans, rewards ------------------------------------------------------------------------

  place(v: unknown, path: string): Place | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return this.err(path, 'a place is { "world", "raw": [x, z] }, { "world", "game": [x, z] } or, in the test set, { "rel": "start", "dx", "dz" }');
    const o = v as Record<string, unknown>;
    let room: Room | undefined;
    if (o.room !== undefined) {
      const r = cleanRoom(o.room);
      if (!r) return this.err(`${path}/room`, 'a room names its cell, and may name the building\'s template', 7);
      room = r;
    }
    if (o.rel !== undefined) {
      if (o.rel !== 'start') return this.err(`${path}/rel`, 'a relative place is relative to "start"');
      if (!this.test) return this.err(path, 'a place relative to where the quest began is allowed only in the test set', 8);
      const world = o.world === undefined ? null : cleanWorld(o.world);
      if (o.world !== undefined && !world) return this.err(`${path}/world`, 'that is not a world');
      return { rel: 'start', dx: this.num(o.dx, `${path}/dx`, 0, -1e5, 1e5), dz: this.num(o.dz, `${path}/dz`, 0, -1e5, 1e5), world, ...(room ? { room } : {}) };
    }
    const world = cleanWorld(o.world);
    if (!world) return this.err(path, 'a place names its world', 7);
    const raw = o.raw;
    const game = o.game;
    if ((raw === undefined) === (game === undefined)) return this.err(path, 'a place is given either "raw" (a planet) or "game" (a space zone)');
    const pair = (raw ?? game) as unknown;
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7)) return this.err(path, 'a place\'s x and z are two numbers');
    const f = raw !== undefined ? 'raw' : 'game';
    const space = world.startsWith('space_');
    if (space !== (f === 'game')) return this.err(path, space ? `${world} is a space zone, whose places are in its own game frame: write "game"` : `${world} is a planet, whose places are in the raw frame: write "raw"`, 7);
    for (const k of Object.keys(o)) if (!['world', 'raw', 'game', 'room'].includes(k)) this.warn(`${path}/${k}`, `${k} is not part of a place`);
    return { world, f, p: [pair[0], pair[1]], ...(room ? { room } : {}) };
  }

  reward(v: unknown, path: string): Reward | null {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'object' || Array.isArray(v)) return this.err(path, 'a reward is { credits, xp, items, standing }');
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!['credits', 'xp', 'items', 'standing'].includes(k)) this.warn(`${path}/${k}`, `${k} is not part of a reward`);
    const items: Reward['items'] = [];
    if (o.items !== undefined) {
      if (!Array.isArray(o.items)) this.err(`${path}/items`, 'items are a list of { kind, id, n }');
      else
        o.items.forEach((it, i) => {
          const p = `${path}/items/${i}`;
          const r = it as Record<string, unknown>;
          if (!r || typeof r !== 'object' || !(ITEM_KINDS as readonly unknown[]).includes(r.kind) || typeof r.id !== 'string' || !/^[A-Za-z0-9_./-]{1,96}$/.test(r.id)) {
            this.err(p, 'an item is { "kind": "wear" | "weapon", "id": <its id>, "n": 1 }');
            return;
          }
          items.push({ kind: r.kind as 'wear' | 'weapon', id: r.id, n: this.int(r.n, `${p}/n`, 1, 1, 1000) });
        });
    }
    const standing: Reward['standing'] = [];
    if (o.standing !== undefined) {
      if (!Array.isArray(o.standing)) this.err(`${path}/standing`, 'standing is a list of { track, add }');
      else
        o.standing.forEach((s, i) => {
          const p = `${path}/standing/${i}`;
          const r = s as Record<string, unknown>;
          if (!r || typeof r !== 'object' || !isTrack(r.track)) {
            this.err(p, 'standing is { "track": rebellion | empire | freelance, "add": n }');
            return;
          }
          standing.push({ track: r.track, add: this.int(r.add, `${p}/add`, 0, -100000, 100000) });
        });
    }
    return { credits: this.int(o.credits, `${path}/credits`, 0, 0, 10000000), xp: this.int(o.xp, `${path}/xp`, 0, 0, 10000000), items, standing };
  }
}

/** A file's text with its line ends made plain and its byte-order mark taken off, so a checkout on any machine hashes the same. */
function plainText(text: string): string {
  return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n?/g, '\n');
}

/** The hash of a list of files: SHA-256 over each path, its length and its text, in path order. */
export function filesHash(files: { path: string; text: string }[]): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  let all = '';
  for (const f of sorted) all += `${f.path}\n${f.text.length}\n${f.text}\n`;
  return hashText(all);
}

/** Find any key rule 10 refuses, anywhere in a file. */
function canonicalKeys(x: unknown, path: string, out: string[]): void {
  if (!x || typeof x !== 'object') return;
  if (Array.isArray(x)) {
    x.forEach((v, i) => canonicalKeys(v, `${path}/${i}`, out));
    return;
  }
  for (const k of Object.keys(x)) {
    if (CANONICAL.test(k)) out.push(`${path}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`);
    canonicalKeys((x as Record<string, unknown>)[k], `${path}/${k}`, out);
  }
}

const COMMON_STEP_KEYS = ['type', 'objective', 'visible', 'after', 'unless', 'chance', 'timeLimit', 'next', 'nextOne', 'onFail', 'signalsOut', 'grant', 'ends', 'do', 'waypoint', 'checkpoint', 'onStuck', 'failOn', 'loop'];
const TYPE_KEYS: Record<string, string[]> = {
  goto: ['at', 'radius'],
  signal: ['signal', 'n'],
  kill: ['who', 'group', 'social', 'tag', 'n'],
  reward: ['reward'],
  use: ['object'],
  observe: ['area', 'seconds', 'continuous'],
  timer: ['for'],
  wait: ['for'],
  end: ['outcome'],
  talk: ['who', 'node', 'n'],
  choice: ['options', 'doc'],
  message: ['doc'],
  document: ['doc'],
  comm: ['doc', 'who'],
};

function edges(s: FileScope, v: unknown, path: string): Edge[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    s.err(path, 'next is a list of step names, or of { "to": step, "when": condition }');
    return [];
  }
  const out: Edge[] = [];
  v.forEach((e, i) => {
    const p = `${path}/${i}`;
    if (typeof e === 'string') {
      const to = s.stepName(e, p);
      if (to) out.push({ to, when: null });
      return;
    }
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      s.err(p, 'an edge is a step name, or { "to": step, "when": condition }');
      return;
    }
    const o = e as Record<string, unknown>;
    const to = s.stepName(o.to, `${p}/to`);
    const when = o.when === undefined ? null : s.cond(o.when, `${p}/when`);
    if (to && (o.when === undefined || when)) out.push({ to, when });
  });
  return out;
}

function stepOf(s: FileScope, name: string, v: unknown, path: string): StepDef | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return s.err(path, 'a step is an object with a "type"');
  const o = v as Record<string, unknown>;
  const type = typeof o.type === 'string' ? o.type : '';
  const spec = STEP_TYPES[type];
  if (!spec) return s.err(`${path}/type`, `${JSON.stringify(o.type)} is not a step type this game knows`, 4);
  if (spec.reserved) return s.err(`${path}/type`, `${type} steps are kept for a later pass and are not built in this pass`, 4);
  if (spec.wave > BUILT_WAVE) s.warn(`${path}/type`, `${type} steps arrive in wave ${spec.wave} of this pass; until then one waits for ever`);
  const allowed = [...COMMON_STEP_KEYS, ...(TYPE_KEYS[type] ?? [])];
  for (const k of Object.keys(o)) if (!allowed.includes(k)) s.warn(`${path}/${k}`, `${k} is not a field of a ${type} step`);
  const doo = o.do as Record<string, unknown> | undefined;
  if (doo !== undefined && (typeof doo !== 'object' || Array.isArray(doo) || doo === null)) s.err(`${path}/do`, 'do is { "start": [...], "done": [...], "fail": [...] }');
  const pair = (x: unknown, p: string, one: (y: unknown, q: string) => string | null): { done: string[]; fail: string[] } => {
    if (x === undefined) return { done: [], fail: [] };
    if (!x || typeof x !== 'object' || Array.isArray(x)) {
      s.err(p, 'expected { "done": [...], "fail": [...] }');
      return { done: [], fail: [] };
    }
    const r = x as Record<string, unknown>;
    return { done: s.names(r.done, `${p}/done`, one), fail: s.names(r.fail, `${p}/fail`, one) };
  };
  let waypoint: StepDef['waypoint'] = null;
  if (o.waypoint !== undefined) {
    const w = o.waypoint as Record<string, unknown>;
    if (!w || typeof w !== 'object' || Array.isArray(w)) s.err(`${path}/waypoint`, 'a waypoint is { "on": true, "at": place }');
    else waypoint = { on: s.bool(w.on, `${path}/waypoint/on`, true), at: w.at === undefined ? null : s.place(w.at, `${path}/waypoint/at`) };
  }
  const visible = o.visible === 'after' ? 'after' : s.bool(o.visible, `${path}/visible`, true);
  const failOn = s.names(o.failOn, `${path}/failOn`, (x, p) => (x === 'death' ? 'death' : s.err(p, 'a step fails on "death"')));
  const step: StepDef = {
    name,
    type,
    wave: spec.wave,
    objective: s.text(o.objective, `${path}/objective`),
    visible,
    after: s.names(o.after, `${path}/after`, (x, p) => s.stepName(x, p)),
    unless: s.names(o.unless, `${path}/unless`, (x, p) => s.stepName(x, p)),
    chance: s.num(o.chance, `${path}/chance`, 1, 0, 1),
    timeLimit: s.span(o.timeLimit, `${path}/timeLimit`),
    next: edges(s, o.next, `${path}/next`),
    nextOne: edges(s, o.nextOne, `${path}/nextOne`),
    onFail: s.names(o.onFail, `${path}/onFail`, (x, p) => s.stepName(x, p)),
    signalsOut: pair(o.signalsOut, `${path}/signalsOut`, (x, p) => s.signal(x, p)),
    grant: pair(o.grant, `${path}/grant`, (x, p) => s.quest(x, p)),
    ends: o.ends === undefined || o.ends === null ? null : s.stepName(o.ends, `${path}/ends`),
    do: { start: s.actions(doo?.start, `${path}/do/start`), done: s.actions(doo?.done, `${path}/do/done`), fail: s.actions(doo?.fail, `${path}/do/fail`) },
    waypoint,
    checkpoint: s.bool(o.checkpoint, `${path}/checkpoint`, false),
    onStuck: o.onStuck === undefined ? 'fail' : (s.stepName(o.onStuck, `${path}/onStuck`) ?? 'fail'),
    failOn,
    loop: s.bool(o.loop, `${path}/loop`, false),
    at: null,
    radius: GOTO_RADIUS,
    signal: null,
    n: 1,
    kill: null,
    reward: null,
    object: null,
    area: null,
    seconds: 0,
    continuous: false,
    for: null,
    outcome: null,
    options: null,
    who: null,
    node: null,
    doc: null,
    later: null,
  };
  switch (type) {
    case 'talk': {
      // Done when the speaker's conversation reaches the node (or any node), which the conversation raises
      // as `talked:<who>#<node>` and `talked:<who>`: what the step waits on is that signal.
      step.who = o.who === undefined ? s.err(path, 'a talk step names who, in "who"') : s.ref(o.who, `${path}/who`, 'cast');
      if (o.node !== undefined) step.node = isNodeName(o.node) ? o.node : s.err(`${path}/node`, 'a node is a plain name with no dot');
      if (step.who) step.signal = `talked:${step.who}${step.node ? `#${step.node}` : ''}`;
      step.n = s.int(o.n, `${path}/n`, 1, 1, 100000);
      break;
    }
    case 'goto':
      step.at = o.at === undefined ? s.err(`${path}`, 'a goto step names where, in "at"') : s.place(o.at, `${path}/at`);
      step.radius = s.num(o.radius, `${path}/radius`, GOTO_RADIUS, 0.5, 100000);
      break;
    case 'signal':
      step.signal = o.signal === undefined ? s.err(path, 'a signal step names its signal') : s.signal(o.signal, `${path}/signal`);
      step.n = s.int(o.n, `${path}/n`, 1, 1, 100000);
      break;
    case 'kill': {
      const kill: KillMatch = {};
      if (o.who !== undefined) kill.who = s.names(o.who, `${path}/who`, (x, p) => (typeof x === 'string' && /^[A-Za-z0-9_./-]{1,120}$/.test(x) ? x : s.err(p, 'who names a creature by its catalogue id')));
      for (const k of ['group', 'social', 'tag'] as const) {
        const v2 = o[k];
        if (v2 === undefined) continue;
        if (typeof v2 === 'string' && /^[A-Za-z0-9_./-]{1,120}$/.test(v2)) kill[k] = v2;
        else s.err(`${path}/${k}`, `${k} is a plain name`);
      }
      if (!kill.who?.length && !kill.group && !kill.social && !kill.tag) s.err(path, 'a kill step names who, group, social or tag');
      step.kill = kill;
      step.n = s.int(o.n, `${path}/n`, 1, 1, 100000);
      break;
    }
    case 'reward':
      step.reward = s.reward(o.reward, `${path}/reward`) ?? s.err(path, 'a reward step names its reward');
      break;
    case 'use':
      step.object = o.object === undefined ? s.err(path, 'a use step names its object') : s.ref(o.object, `${path}/object`, 'obj');
      break;
    case 'observe':
      step.area = o.area === undefined ? s.err(path, 'an observe step names its area') : s.ref(o.area, `${path}/area`, 'area');
      step.seconds = s.num(o.seconds, `${path}/seconds`, 0, 0.1, 1e6);
      if (o.seconds === undefined) s.err(path, 'an observe step says for how many seconds');
      step.continuous = s.bool(o.continuous, `${path}/continuous`, false);
      break;
    case 'timer':
    case 'wait':
      step.for = o.for === undefined ? s.err(path, `a ${type} step says how long, in "for"`) : s.span(o.for, `${path}/for`);
      if (o.timeLimit !== undefined) s.err(`${path}/timeLimit`, `a ${type} step is its own time limit`);
      break;
    case 'end':
      step.outcome = o.outcome === undefined ? (step.ends ?? 'done') : s.stepName(o.outcome, `${path}/outcome`);
      break;
    case 'choice': {
      const opts = o.options;
      if (!Array.isArray(opts) || !opts.length) {
        s.err(path, 'a choice step lists its options');
        break;
      }
      step.options = [];
      opts.forEach((op, i) => {
        const p = `${path}/options/${i}`;
        const r = op as Record<string, unknown>;
        if (!r || typeof r !== 'object' || Array.isArray(r) || !isStepName(r.id)) {
          s.err(p, 'an option is { "id", "label", ... }');
          return;
        }
        step.options!.push({
          id: r.id as string,
          label: s.text(r.label, `${p}/label`),
          when: s.cond(r.when, `${p}/when`),
          stakes: s.text(r.stakes, `${p}/stakes`),
          pressure: s.bool(r.pressure, `${p}/pressure`, false),
          do: s.actions(r.do, `${p}/do`),
          next: s.names(r.next, `${p}/next`, (x, q) => s.stepName(x, q)),
          ends: r.ends === undefined || r.ends === null ? null : s.stepName(r.ends, `${p}/ends`),
        });
      });
      // A choice made on a page: the document is handed over as the step begins, its options at its foot.
      if (o.doc !== undefined) step.doc = s.ref(o.doc, `${path}/doc`, 'doc');
      break;
    }
    case 'message':
    case 'document':
    case 'comm':
      // Handed over as the step begins, and done once it is read (or, a call, heard) to its end.
      step.doc = o.doc === undefined ? s.err(path, `a ${type} step names its document, in "doc"`) : s.ref(o.doc, `${path}/doc`, 'doc');
      if (type === 'comm' && o.who !== undefined) step.who = s.ref(o.who, `${path}/who`, 'cast');
      break;
    default: {
      // A later wave's step (talk, a document): its own fields kept as plain data for that wave.
      const later: Record<string, unknown> = {};
      for (const k of TYPE_KEYS[type] ?? []) if (o[k] !== undefined) later[k] = JSON.parse(JSON.stringify(o[k]));
      step.later = later;
    }
  }
  return step;
}

function outcomesOf(s: FileScope, v: unknown, path: string): Record<string, OutcomeDef> {
  const out: Record<string, OutcomeDef> = Object.create(null);
  const raw = v === undefined ? {} : v;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    s.err(path, 'outcomes is an object of outcomes by name');
  } else {
    for (const name of Object.keys(raw)) {
      const p = `${path}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      if (!isStepName(name) || name === CLEARED) {
        s.err(p, name === CLEARED ? '"cleared" is not declared: an end with it puts the quest back to none' : `${JSON.stringify(name)} is not an outcome's name`);
        continue;
      }
      const o = (raw as Record<string, unknown>)[name] as Record<string, unknown>;
      if (!o || typeof o !== 'object' || Array.isArray(o)) {
        s.err(p, 'an outcome is an object (it may be empty)');
        continue;
      }
      for (const k of Object.keys(o)) if (!['reward', 'do', 'failure', 'pressure'].includes(k)) s.warn(`${p}/${k}`, `${k} is not part of an outcome`);
      out[name] = { name, failure: s.bool(o.failure, `${p}/failure`, name === 'failed'), pressure: s.bool(o.pressure, `${p}/pressure`, false), reward: s.reward(o.reward, `${p}/reward`), do: s.actions(o.do, `${p}/do`) };
    }
  }
  for (const name of DEFAULT_OUTCOMES) out[name] ??= { name, failure: name === 'failed', pressure: false, reward: null, do: [] };
  return out;
}

const QUEST_KEYS = ['id', 'rev', 'title', 'client', 'verb', 'track', 'kind', 'harsh', 'abandon', 'restart', 'repeat', 'needs', 'givers', 'stakes', 'risk', 'card', 'start', 'steps', 'outcomes'];
/** What an importer writes that this pass keeps without acting on (`replacedBy`, SWG's own `reps`, ...). */
const STORED_KEYS = ['reps', 'replacedBy', 'disabled', 'level', 'tier', 'echoes', 'blocks'];

function questOf(s: FileScope, v: unknown): QuestDef | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return s.err('', 'a quest file holds one quest object');
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !NAME.test(o.id) || o.id.includes(':')) return s.err('/id', 'a quest needs an "id": a plain name, which the set\'s prefix is put in front of');
  for (const k of Object.keys(o)) if (!QUEST_KEYS.includes(k) && !STORED_KEYS.includes(k)) s.warn(`/${k}`, `${k} is not a field of a quest`);
  const id = `${s.prefix}:${o.id}`;
  if (!isQuestId(id)) return s.err('/id', `${id} is too long for a quest id`);
  const steps: Record<string, StepDef> = Object.create(null);
  if (!o.steps || typeof o.steps !== 'object' || Array.isArray(o.steps)) s.err('/steps', 'a quest has steps, by name');
  else
    for (const name of Object.keys(o.steps)) {
      const p = `/steps/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      if (!isStepName(name)) {
        s.err(p, `${JSON.stringify(name)} is not a step's name`);
        continue;
      }
      const st = stepOf(s, name, (o.steps as Record<string, unknown>)[name], p);
      if (st) steps[name] = st;
    }
  let repeat: Repeat = { every: 'never', cooldown: 0, limit: 0, standingPerRealDay: STANDING_PER_REAL_DAY };
  if (o.repeat !== undefined) {
    const r = o.repeat as Record<string, unknown>;
    if (!r || typeof r !== 'object' || Array.isArray(r)) s.err('/repeat', 'repeat is { "every": ..., "cooldown": span, "limit": n }');
    else {
      for (const k of Object.keys(r)) if (!['every', 'cooldown', 'limit', 'standingPerRealDay'].includes(k)) s.warn(`/repeat/${k}`, `${k} is not part of repeat`);
      const every = s.oneOf(r.every, '/repeat/every', ['never', 'always', 'cooldown', 'gameDay', 'realDay'] as const, 'never');
      const cd = s.span(r.cooldown, '/repeat/cooldown');
      if (every === 'cooldown' && !cd) s.err('/repeat', 'a cooldown repeat says how long, in "cooldown"');
      repeat = { every, cooldown: cd?.ms ?? 0, limit: s.int(r.limit, '/repeat/limit', 0, 0, 1e6), standingPerRealDay: s.num(r.standingPerRealDay, '/repeat/standingPerRealDay', STANDING_PER_REAL_DAY, 0, 1e7) };
    }
  }
  const givers: Giver[] = [];
  if (o.givers !== undefined) {
    if (!Array.isArray(o.givers)) s.err('/givers', 'givers is a list');
    else
      o.givers.forEach((g, i) => {
        const p = `/givers/${i}`;
        const r = g as Record<string, unknown>;
        if (!r || typeof r !== 'object') {
          s.err(p, 'a giver is { "kind": ... }');
          return;
        }
        if (r.kind === 'debug') givers.push({ kind: 'debug' });
        else if (r.kind === 'use') {
          const obj = s.ref(r.object, `${p}/object`, 'obj');
          if (obj) givers.push({ kind: 'use', object: obj });
        } else if (r.kind === 'chain') {
          const after = s.quest(r.after, `${p}/after`);
          if (r.outcome !== undefined && !isStepName(r.outcome)) s.err(`${p}/outcome`, 'an outcome is a plain name');
          if (after) givers.push({ kind: 'chain', after, outcome: isStepName(r.outcome) ? r.outcome : null });
        } else if (r.kind === 'talk') {
          // Who offers it, by talking: a marker the checker holds to the cast. The offer itself is an answer's
          // `offer()` or `grant()` in that person's conversation.
          const who = s.ref(r.who, `${p}/who`, 'cast');
          if (who) givers.push({ kind: 'talk', who });
        } else if (r.kind === 'board') s.err(p, 'job boards are kept for a later pass and are not built in this pass', 4);
        else s.err(p, `${JSON.stringify(r.kind)} is not a kind of giver: debug, use, chain or talk`);
      });
  }
  const abandon = o.abandon === undefined ? true : typeof o.abandon === 'boolean' ? o.abandon : isStepName(o.abandon) ? o.abandon : (s.err('/abandon', 'abandon is true, false, or the outcome abandoning ends the quest as'), true);
  const stored: Record<string, unknown> = {};
  for (const k of STORED_KEYS) if (o[k] !== undefined) stored[k] = JSON.parse(JSON.stringify(o[k]));
  const def: QuestDef = {
    id,
    rev: s.int(o.rev, '/rev', 1, 1, 1e9),
    hash: '',
    title: s.text(o.title, '/title', true) ?? id,
    client: s.oneOf(o.client, '/client', CLIENTS, 'none'),
    verb: s.oneOf(o.verb, '/verb', VERBS, 'story'),
    track: s.oneOf(o.track, '/track', ['rebellion', 'empire', 'freelance', 'none'] as const, 'none'),
    kind: s.oneOf(o.kind, '/kind', ['solo', 'group'] as const, 'solo'),
    harsh: s.bool(o.harsh, '/harsh', false),
    abandon,
    restart: s.oneOf(o.restart, '/restart', ['never', 'start', 'checkpoint'] as const, 'start'),
    repeat,
    needs: s.cond(o.needs, '/needs'),
    givers,
    stakes: s.text(o.stakes, '/stakes'),
    card: o.card === undefined ? null : s.ref(o.card, '/card', 'doc'),
    risk: s.names(o.risk, '/risk', (x, p) => (typeof x === 'string' && x.length <= 120 ? x : s.err(p, 'a risk is a short word'))),
    start: s.names(o.start, '/start', (x, p) => s.stepName(x, p)),
    steps,
    outcomes: outcomesOf(s, o.outcomes, '/outcomes'),
    stored,
    test: s.test,
    src: s.src(),
  };
  if (!def.start.length) s.err('/start', 'a quest names the steps it starts with, in "start"');
  // A book keeps this many steps of one quest (the client's own never pass 16), so a longer quest could never finish.
  if (Object.keys(steps).length > BOOK_LIMITS.steps) s.err('/steps', `a quest has at most ${BOOK_LIMITS.steps} steps, not ${Object.keys(steps).length}`);
  const { src, test, hash, ...pure } = def;
  void src;
  void test;
  void hash;
  def.hash = hashText(stableText(pure)).slice(0, 16);
  return def;
}

function shapeOf(s: FileScope, v: unknown, path: string): Shape | null {
  const pt = (x: unknown): [number, number] | null => (Array.isArray(x) && x.length === 2 && x.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [x[0], x[1]] : null);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return s.err(path, 'a shape is { "kind": "circle", "c": [x, z], "r": n }, a rect { "min", "max" } or a poly { "pts" }');
  const o = v as Record<string, unknown>;
  if (o.kind === 'circle') {
    const c = pt(o.c);
    if (!c) return s.err(`${path}/c`, 'a circle\'s middle is [x, z]');
    return { kind: 'circle', c, r: s.num(o.r, `${path}/r`, 1, 0.1, 100000) };
  }
  if (o.kind === 'rect') {
    const a = pt(o.min);
    const b = pt(o.max);
    if (!a || !b) return s.err(path, 'a rect is "min": [x, z] and "max": [x, z]');
    return { kind: 'rect', min: [Math.min(a[0], b[0]), Math.min(a[1], b[1])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1])] };
  }
  if (o.kind === 'poly') {
    const pts = Array.isArray(o.pts) ? o.pts.map(pt) : [];
    if (pts.length < 3 || pts.some((p) => !p)) return s.err(`${path}/pts`, 'a poly is three or more [x, z] points');
    return { kind: 'poly', pts: pts as [number, number][] };
  }
  return s.err(`${path}/kind`, 'a shape\'s kind is circle, rect or poly');
}

function areaOf(s: FileScope, v: unknown): AreaDef | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return s.err('', 'an area file holds one area object');
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !REF_NAME.test(o.id)) return s.err('/id', 'an area needs an "id": a plain name');
  for (const k of Object.keys(o)) if (!['id', 'world', 'shape', 'room', 'label'].includes(k)) s.warn(`/${k}`, `${k} is not a field of an area`);
  const world = cleanWorld(o.world);
  if (!world) return s.err('/world', 'an area names its world', 7);
  const shape = shapeOf(s, o.shape, '/shape');
  if (!shape) return null;
  const room = o.room === undefined ? undefined : (cleanRoom(o.room) ?? s.err('/room', 'a room names its cell', 7) ?? undefined);
  return { id: `${s.prefix}:area/${o.id}`, world, f: world.startsWith('space_') ? 'game' : 'raw', shape, ...(room ? { room } : {}), label: s.text(o.label, '/label'), test: s.test, src: s.src() };
}

function objectOf(s: FileScope, v: unknown): ObjectDef | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return s.err('', 'an object file holds one object');
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !REF_NAME.test(o.id)) return s.err('/id', 'an object needs an "id": a plain name');
  for (const k of Object.keys(o)) if (!['id', 'world', 'template', 'near', 'reach', 'label'].includes(k)) s.warn(`/${k}`, `${k} is not a field of an object`);
  const world = cleanWorld(o.world);
  if (!world) return s.err('/world', 'an object names its world', 7);
  if (typeof o.template !== 'string' || !TEMPLATE.test(o.template)) return s.err('/template', 'an object names the template of the thing the world places');
  const near = o.near;
  if (!Array.isArray(near) || near.length !== 2 || !near.every((n) => typeof n === 'number' && Number.isFinite(n))) return s.err('/near', 'near is [x, z], where the thing stands');
  return { id: `${s.prefix}:obj/${o.id}`, world, template: o.template, near: [near[0], near[1]], reach: s.num(o.reach, '/reach', OBJECT_REACH, 0.5, 100), label: s.text(o.label, '/label'), test: s.test, src: s.src() };
}

/** The folders and files a later pass reads, with why they are not read yet. */
const LATER: [RegExp, string][] = [[/^(jobs|boards)\//, 'job boards are kept for a later pass']];

/** A set with nothing in it: what a host runs before any set is read. */
export function emptySet(): StorySet {
  return { name: '', prefix: '', title: '', hash: '', sets: [], test: false, quests: Object.create(null), areas: Object.create(null), objects: Object.create(null), talks: Object.create(null), cast: Object.create(null), voices: Object.create(null), docs: Object.create(null), file: null, calendar: null, ladders: null, later: [], files: 0 };
}

/** A document's file read through a scope of its own, whose lines are the document's own (`/L<n>`). */
function readDoc(f: { path: string; text: string }, set: StorySet, issues: Issue[]): void {
  const s = new FileScope(f.path, docLines(f.text), set.prefix, set.test, issues);
  const d = docOf(s, f.text, f.path);
  if (!d) return;
  const { src, test, hash, ...pure } = d;
  void src;
  void test;
  void hash;
  d.hash = hashText(stableText(pure)).slice(0, 16);
  const docs = (set.docs ??= Object.create(null) as Record<string, DocDef>);
  if (docs[d.id]) s.err('/L1', `${d.id} is defined twice (also in ${docs[d.id].src.file})`, 1);
  else docs[d.id] = d;
}

/**
 * Read a set from its files. `test` says it is the committed test set, where relative places and console
 * signals are allowed, and only the caller that is reading that folder may say so: what a set's own
 * `story.jsonc` declares is never asked, or a folder of the owner's that called itself `test` would be
 * given the test set's allowances. For the same reason the prefix `test` is the test set's alone, and a
 * set that declares it without being loaded as the test set is refused.
 */
export function loadSet(files: { path: string; text: string }[], opts: { test?: boolean } = {}): LoadResult {
  const issues: Issue[] = [];
  const plain = files.map((f) => ({ path: f.path.replace(/\\/g, '/').replace(/^\.\//, ''), text: plainText(f.text) })).filter((f) => !f.path.startsWith('fixtures/'));
  plain.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = filesHash(plain);
  const set = emptySet();
  set.hash = hash;
  set.files = plain.length;
  const manifest = plain.find((f) => f.path === 'story.jsonc');
  if (!manifest) {
    issues.push({ level: 'error', file: 'story.jsonc', line: 1, message: 'a set needs a story.jsonc naming its prefix and title' });
    return { set, errors: issues, warnings: [], hash };
  }
  const head = parseJsonc(manifest.text);
  const m = head.value as Record<string, unknown> | undefined;
  if (head.error || !m || typeof m !== 'object' || Array.isArray(m)) {
    issues.push({ level: 'error', file: 'story.jsonc', line: head.error?.line ?? 1, col: head.error?.col, message: head.error?.message ?? 'story.jsonc holds one object' });
    return { set, errors: issues, warnings: [], hash };
  }
  if (typeof m.prefix !== 'string' || !PREFIX.test(m.prefix) || NOT_A_PREFIX.includes(m.prefix)) {
    issues.push({ level: 'error', file: 'story.jsonc', line: lineAt(head.lines, '/prefix'), message: `a set's prefix is a short lower-case name, and not one of ${NOT_A_PREFIX.join(', ')}` });
    return { set, errors: issues, warnings: [], hash };
  }
  if (m.prefix === TEST_PREFIX && opts.test !== true) {
    issues.push({ level: 'error', file: 'story.jsonc', line: lineAt(head.lines, '/prefix'), message: `the prefix ${TEST_PREFIX} is the committed test set's: give this set a name of its own` });
    return { set, errors: issues, warnings: [], hash };
  }
  set.prefix = m.prefix;
  set.name = m.prefix;
  set.title = typeof m.title === 'string' ? m.title.slice(0, 120) : m.prefix;
  set.test = opts.test === true;
  set.sets = [{ name: set.prefix, hash }];
  for (const f of plain) {
    if (f.path === 'story.jsonc') continue;
    const later = LATER.find(([re]) => re.test(f.path));
    if (later) {
      set.later.push(f.path);
      issues.push({ level: 'warning', file: f.path, line: 1, message: `not read yet: ${later[1]}` });
      continue;
    }
    if (/^docs\//.test(f.path)) {
      if (!f.path.endsWith('.doc.txt')) issues.push({ level: 'warning', file: f.path, line: 1, message: 'a document is docs/<id>.doc.txt: this file is not read' });
      else readDoc(f, set, issues);
      continue;
    }
    if (f.path === 'file.jsonc' || f.path === 'calendar.jsonc' || f.path === 'ladders.jsonc') {
      const doc = parseJsonc(f.text);
      if (doc.error) {
        issues.push({ level: 'error', file: f.path, line: doc.error.line, col: doc.error.col, message: doc.error.message });
        continue;
      }
      const canon: string[] = [];
      canonicalKeys(doc.value, '', canon);
      for (const p of canon) issues.push({ level: 'error', file: f.path, line: lineAt(doc.lines, p), message: 'nothing marks a version of anything as the canonical or true one', rule: 10 });
      if (f.path === 'file.jsonc') {
        const found: FileDefIssue[] = [];
        set.file = fileDefOf(doc.value, found);
        for (const i of found) issues.push({ level: i.level, file: f.path, line: lineAt(doc.lines, i.path), message: i.message });
      } else if (f.path === 'ladders.jsonc') {
        const found: LadderIssue[] = [];
        set.ladders = laddersOf(doc.value, set.prefix, found);
        for (const i of found) issues.push({ level: i.level, file: f.path, line: lineAt(doc.lines, i.path), message: i.message });
      } else set.calendar = calendarOf(doc.value, (path, message) => issues.push({ level: 'error', file: f.path, line: lineAt(doc.lines, path), message }));
      continue;
    }
    const kind = /^quests\//.test(f.path) ? 'quest' : /^areas\//.test(f.path) ? 'area' : /^objects\//.test(f.path) ? 'object' : /^talk\//.test(f.path) ? 'talk' : /^cast\//.test(f.path) ? 'cast' : null;
    if (!kind) {
      if (/\.jsonc?$/.test(f.path)) issues.push({ level: 'warning', file: f.path, line: 1, message: 'not in a folder a set is read from (quests/, areas/, objects/, talk/, cast/, docs/), so not read' });
      continue;
    }
    if (!f.path.endsWith('.jsonc')) {
      issues.push({ level: 'warning', file: f.path, line: 1, message: 'not a .jsonc file, so not read' });
      continue;
    }
    const doc = parseJsonc(f.text);
    if (doc.error) {
      issues.push({ level: 'error', file: f.path, line: doc.error.line, col: doc.error.col, message: doc.error.message });
      continue;
    }
    const s = new FileScope(f.path, doc.lines, set.prefix, set.test, issues);
    const canon: string[] = [];
    canonicalKeys(doc.value, '', canon);
    for (const p of canon) s.err(p, 'nothing marks a version of anything as the canonical or true one', 10);
    if (kind === 'quest') {
      const q = questOf(s, doc.value);
      if (!q) continue;
      if (set.quests[q.id]) s.err('/id', `${q.id} is defined twice (also in ${set.quests[q.id].src.file})`, 1);
      else set.quests[q.id] = q;
    } else if (kind === 'area') {
      const a = areaOf(s, doc.value);
      if (!a) continue;
      if (set.areas[a.id]) s.err('/id', `${a.id} is defined twice (also in ${set.areas[a.id].src.file})`, 1);
      else set.areas[a.id] = a;
    } else if (kind === 'talk') {
      const t = talkOf(s, doc.value);
      if (!t) continue;
      const { src, test, hash, ...pure } = t;
      void src;
      void test;
      void hash;
      t.hash = hashText(stableText(pure)).slice(0, 16);
      if (set.talks[t.id]) s.err('/id', `${t.id} is defined twice (also in ${set.talks[t.id].src.file})`, 1);
      else set.talks[t.id] = t;
    } else if (kind === 'cast') {
      const c = castOf(s, doc.value);
      if (!c) continue;
      if (set.cast[c.id]) s.err('/id', `${c.id} is defined twice (also in ${set.cast[c.id].src.file})`, 1);
      else set.cast[c.id] = c;
    } else {
      const o = objectOf(s, doc.value);
      if (!o) continue;
      if (set.objects[o.id]) s.err('/id', `${o.id} is defined twice (also in ${set.objects[o.id].src.file})`, 1);
      else set.objects[o.id] = o;
    }
  }
  return { set, errors: issues.filter((i) => i.level === 'error'), warnings: issues.filter((i) => i.level === 'warning'), hash };
}

/**
 * Several sets as one: the owner's and the test set, side by side, and the game's own conversations
 * (`core3Trees.ts`), which list no set of their own and so leave the joined set's name, hash and readiness
 * as the story's sets make them. Their prefixes keep their ids apart; a set whose prefix another already
 * took is left out rather than allowed to replace it.
 */
export function joinSets(sets: StorySet[]): StorySet {
  const out = emptySet();
  const taken = new Set<string>();
  for (const s of sets) {
    if (!s.prefix || taken.has(s.prefix)) continue;
    taken.add(s.prefix);
    out.sets.push(...s.sets);
    Object.assign(out.quests, s.quests);
    Object.assign(out.areas, s.areas);
    Object.assign(out.objects, s.objects);
    Object.assign(out.talks, s.talks);
    Object.assign(out.cast, s.cast);
    if (s.voices) Object.assign(out.voices!, s.voices);
    if (s.docs) Object.assign(out.docs!, s.docs);
    // One file, one calendar and one set of ladders to a story: the first set's that has one (the owner's, read
    // before the test set's).
    out.file ??= s.file ?? null;
    out.calendar ??= s.calendar ?? null;
    out.ladders ??= s.ladders ?? null;
    out.later.push(...s.later);
    out.files += s.files;
    out.test ||= s.test;
  }
  out.name = out.sets.map((s) => s.name).join('+');
  out.prefix = out.sets[0]?.name ?? '';
  out.title = sets.map((s) => s.title).filter(Boolean).join(' + ');
  out.hash = out.sets.length === 1 ? out.sets[0].hash : hashText(out.sets.map((s) => `${s.name}:${s.hash}`).join('\n'));
  return out;
}

/**
 * One action written outside any file -- the console's, or an admin's -- read and checked as a file's
 * would be, its ids prefixed with `prefix` where they carry none. Answers the action or why not.
 */
export function readAction(v: unknown, prefix: string, test = true): ActionDef | string {
  const issues: Issue[] = [];
  const s = new FileScope('(console)', new Map(), prefix, test, issues);
  const a = s.action(v, '');
  return a ?? issues.find((i) => i.level === 'error')?.message ?? 'that is not an action';
}

/** The pointer of a step's field, for the checker to find its line: `/steps/<name>/<field>`. */
export function stepPath(step: string, ...rest: (string | number)[]): string {
  return pointer(['steps', step, ...rest]);
}
