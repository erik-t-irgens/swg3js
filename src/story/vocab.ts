// The one vocabulary a story is written in: every condition and every action a quest, a conversation, a
// document, the cast, an area or a ladder may use, with how many arguments each takes, what kind each
// argument is, the wave of this pass it arrives in, and the few words kept for later passes. Pure, a
// table and nothing else; the expression reader (`expr.ts`), the loader (`set.ts`), the checker
// (`check.ts`) and the step machine (`quests.ts`) all read it, so a word is spelled in one place.
//
// **Waves.** A word from a wave this build has not reached yet (`BUILT_WAVE`) is not an error: the
// owner may write ahead, and the build reaches every wave of the pass. The checker warns about it, and
// until its wave arrives a condition of it reads false and an action of it does nothing, both counted.
// A word kept for a later pass (`reserved`) is an error, "not built in this pass", because nothing here
// will ever make it work.
//
// **Argument kinds.** `quest` is a quest id, written with or without its set's prefix inside its own set;
// `object`, `area`, `who` and `doc` are ids of their kind (`obj/<id>`, `area/<id>`, `cast/<id>` or a game
// person's `row:<key>`, `doc/<id>`), prefixed the same way; `signal` is a signal name (`signals.ts` says
// which prefixes the engine raises); the rest are what they say. A spec's argument written `x?` may be
// left off, `x...` is one or more, `x*` none or more, and either takes the rest of the arguments.
//
// None of it is the game's: the words are ours, and the client columns an importer would fill are named
// beside the step fields in `set.ts`.

/**
 * The waves of this pass this build has reached. Wave 4 moved it on as it wired the local host: credits,
 * items, Standing and Trust read, and money, things, experience, Standing, waypoints and words handed out.
 * Wave 6 brought the conversations: a choice made, a node heard, an answer given, a person met or named
 * read, and Trust under pressure, a charge, an introduction, a gesture and a choice made as actions, with
 * the `talk` and `choice` steps. (Wave 5 was the server's, and added no word.)
 */
export const BUILT_WAVE = 6;

export type ArgKind =
  | 'quest'
  | 'step'
  | 'outcome'
  | 'signal'
  | 'flag'
  | 'value'
  | 'number'
  | 'int'
  | 'text'
  | 'world'
  | 'area'
  | 'object'
  | 'cell'
  | 'template'
  | 'track'
  | 'kind'
  | 'item'
  | 'script'
  | 'any'
  | 'who'
  | 'doc'
  | 'node'
  | 'reply'
  | 'agency'
  | 'string';

export interface FnSpec {
  name: string;
  /** Argument kinds in order: `kind`, `kind?` (may be left off), `kind...` (one or more), `kind*` (none or more). */
  args: readonly string[];
  wave: number;
  /** A value to compare: written `fn(...) >= n`. `flag` may also stand alone (set or not). */
  value?: 'number' | 'string' | 'value';
  /** The function may be written without a comparison. */
  bare?: boolean;
  /** Kept for a later pass: refused by the checker as not built in this pass. */
  reserved?: boolean;
}

function fn(name: string, args: readonly string[], wave: number, extra: Partial<FnSpec> = {}): FnSpec {
  return { name, args, wave, ...extra };
}

const table = <T>(rows: T[], key: (r: T) => string): Readonly<Record<string, T>> => {
  const out = Object.create(null) as Record<string, T>;
  for (const r of rows) out[key(r)] = r;
  return Object.freeze(out);
};

/** Every condition. */
export const CONDITIONS = table<FnSpec>(
  [
    fn('questNone', ['quest'], 3),
    fn('questOffered', ['quest'], 3),
    fn('questActive', ['quest'], 3),
    fn('questFailed', ['quest'], 3),
    fn('questDone', ['quest', 'outcome?'], 3),
    fn('closed', ['quest'], 3),
    fn('stepActive', ['quest', 'step'], 3),
    fn('stepDone', ['quest', 'step'], 3),
    fn('completions', ['quest'], 3, { value: 'number' }),
    fn('flag', ['flag'], 3, { value: 'value', bare: true }),
    fn('world', ['world'], 3),
    fn('inArea', ['area'], 3),
    fn('inRoom', ['cell', 'template?'], 3),
    fn('gameHour', [], 3, { value: 'number' }),
    fn('inGroup', [], 3),
    fn('species', ['string'], 3),
    fn('roll', ['number'], 3),
    fn('call', ['script', 'any*'], 3),
    fn('credits', [], 4, { value: 'number' }),
    fn('has', ['kind', 'item', 'int?'], 4),
    fn('standing', ['track'], 4, { value: 'number' }),
    fn('trust', ['track'], 4, { value: 'number' }),
    fn('choiceOf', ['quest', 'step'], 6, { value: 'string' }),
    fn('heard', ['node'], 6),
    fn('chosen', ['reply'], 6),
    fn('met', ['who'], 6),
    fn('named', ['who'], 6),
    fn('witnessed', ['doc', 'string?'], 8),
    fn('fileLevel', ['agency'], 8, { value: 'number' }),
    fn('fileHas', ['agency', 'string'], 8),
    fn('rank', ['track'], 9, { value: 'string' }),
    fn('rankAtLeast', ['track', 'string'], 9),
    fn('rankReady', ['track'], 9),
    fn('trackIs', ['track', 'string'], 9),
    fn('division', ['track'], 9, { value: 'string' }),
    fn('npcStanding', ['who'], 9, { value: 'number' }),
    fn('npcTrust', ['who'], 9, { value: 'number' }),
    fn('alive', ['who'], 9),
    fn('access', ['who'], 9, { value: 'string' }),
    fn('companion', ['who'], 9, { value: 'string' }),
    fn('companionUp', [], 9),
    fn('debt', ['string'], 9, { value: 'number' }),
  ],
  (r) => r.name,
);

/** Every action, and the five kept for a later pass. */
export const ACTIONS = table<FnSpec>(
  [
    fn('offer', ['quest'], 3),
    fn('grant', ['quest'], 3),
    fn('signal', ['signal'], 3),
    fn('complete', ['quest', 'step'], 3),
    fn('failStep', ['quest', 'step'], 3),
    fn('end', ['quest', 'outcome?'], 3),
    fn('fail', ['quest', 'outcome?'], 3),
    fn('drop', ['quest'], 3),
    fn('restart', ['quest'], 3),
    fn('close', ['quest...'], 3),
    fn('flag', ['flag', 'value'], 3),
    fn('unflag', ['flag'], 3),
    fn('call', ['script', 'any*'], 3),
    fn('pay', ['int'], 4),
    fn('give', ['kind', 'item', 'int?'], 4),
    fn('xp', ['int'], 4),
    fn('standing', ['track', 'number'], 4),
    fn('waypoint', ['text', 'world', 'number', 'number', 'cell?'], 4),
    fn('waypointGone', ['string'], 4),
    fn('say', ['text'], 4),
    fn('trust', ['track', 'number'], 6),
    fn('charge', ['int'], 6),
    fn('introduce', ['who'], 6),
    fn('gesture', ['string'], 6),
    fn('choose', ['quest', 'step', 'string'], 6),
    fn('doc', ['doc'], 8),
    fn('note', ['text'], 8),
    fn('file', ['agency', 'string', 'number', 'any*'], 8),
    fn('promote', ['track'], 9),
    fn('demote', ['track', 'int?'], 9),
    fn('suspend', ['track', 'number'], 9),
    fn('burn', ['track'], 9),
    fn('assign', ['track', 'string'], 9),
    fn('useTrack', ['track'], 9),
    fn('activate', ['track'], 9),
    fn('npc', ['who', 'number', 'number'], 9),
    fn('refuse', ['who'], 9),
    fn('vouch', ['who', 'who', 'number'], 9),
    fn('kill', ['who', 'string?', 'doc?'], 9),
    fn('fine', ['int', 'text', 'string?'], 9),
    fn('debt', ['string', 'number'], 9),
    fn('recruit', ['who'], 9),
    fn('dismiss', [], 9),
    fn('waitHere', [], 9),
    fn('impound', ['any*'], 99, { reserved: true }),
    fn('licence', ['any*'], 99, { reserved: true }),
    fn('district', ['any*'], 99, { reserved: true }),
    fn('take', ['any*'], 99, { reserved: true }),
    fn('misfile', ['any*'], 99, { reserved: true }),
  ],
  (r) => r.name,
);

/** Every step type, the wave its rules arrive in, and the twelve kept for later passes. */
export const STEP_TYPES = table<{ name: string; wave: number; reserved?: boolean; instant?: boolean }>(
  [
    { name: 'nothing', wave: 3, instant: true },
    { name: 'end', wave: 3, instant: true },
    { name: 'join', wave: 3, instant: true },
    { name: 'reward', wave: 3, instant: true },
    { name: 'timer', wave: 3 },
    { name: 'wait', wave: 3 },
    { name: 'goto', wave: 3 },
    { name: 'signal', wave: 3 },
    { name: 'kill', wave: 3 },
    { name: 'use', wave: 3 },
    { name: 'observe', wave: 3 },
    { name: 'talk', wave: 6 },
    { name: 'choice', wave: 6 },
    { name: 'message', wave: 8 },
    { name: 'document', wave: 8 },
    { name: 'comm', wave: 8 },
    ...['collect', 'give', 'carry', 'killLoot', 'pay', 'encounter', 'spawn', 'waves', 'escort', 'perform', 'craft', 'space'].map((name) => ({ name, wave: 99, reserved: true })),
  ],
  (r) => r.name,
);

/** The tracks Standing is kept on. */
export const TRACK_NAMES = ['rebellion', 'empire', 'freelance'] as const;
/** What a reward may hand over: the ledger's own two kinds. */
export const ITEM_KINDS = ['wear', 'weapon'] as const;
/** Who a job may be for; stored, shown on the card from a later wave. */
export const CLIENTS = ['imperial', 'corporate', 'civic', 'private', 'criminal', 'none'] as const;
/** What kind of work a job is; stored, for the job boards of a later pass. */
export const VERBS = ['travel', 'kill', 'collect', 'interact', 'observe', 'carry', 'talk', 'story'] as const;

/** A comparison as an expression writes it, and the key its JSON gives it. */
export const OPS: Readonly<Record<string, 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'>> = Object.freeze({ '==': 'eq', '!=': 'ne', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' });
export const OP_KEYS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] as const;
export type OpKey = (typeof OP_KEYS)[number];

/**
 * The key that names each condition in its JSON form, and the wave it arrives in. A condition written as
 * JSON is an object with exactly one of these keys (and, for some, a comparison key beside it).
 */
export const COND_HEADS: Readonly<Record<string, number>> = Object.freeze({
  all: 3,
  any: 3,
  not: 3,
  quest: 3,
  step: 3,
  completions: 3,
  flag: 3,
  world: 3,
  inArea: 3,
  inRoom: 3,
  hour: 3,
  grouped: 3,
  species: 3,
  chance: 3,
  script: 3,
  credits: 4,
  has: 4,
  standing: 4,
  trust: 4,
  choice: 6,
  heard: 6,
  chosen: 6,
  person: 6,
  witnessed: 8,
  file: 8,
  fileHas: 8,
  rank: 9,
  track: 9,
  companion: 9,
  debt: 9,
});

/** The most and least arguments a spec takes; `Infinity` for a rest argument. */
export function arity(spec: FnSpec): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const a of spec.args) {
    if (a.endsWith('...')) return { min: min + 1, max: Infinity };
    if (a.endsWith('*')) return { min, max: Infinity };
    max++;
    if (!a.endsWith('?')) min++;
  }
  return { min, max };
}

/** The kind of the argument at a place, or null past the last. */
export function argKindAt(spec: FnSpec, i: number): ArgKind | null {
  for (let k = 0; k < spec.args.length; k++) {
    const a = spec.args[k];
    const rest = a.endsWith('...') || a.endsWith('*');
    const kind = a.replace(/[?*]|\.\.\.$/g, '') as ArgKind;
    if (k === i || (rest && i >= k)) return kind;
  }
  return null;
}

/** How a word reads in this build: built, from a later wave of this pass, or kept for a later pass. */
export function readiness(spec: { wave: number; reserved?: boolean }): 'built' | 'later' | 'reserved' {
  if (spec.reserved) return 'reserved';
  return spec.wave <= BUILT_WAVE ? 'built' : 'later';
}
