// The short expressions a story's files are written in, read into the JSON tree each stands for. Pure:
// it reads text and builds plain objects, and nothing is ever `eval`ed or looked up by name at run time
// except through the vocabulary's own table (`vocab.ts`).
//
// **Conditions.** `questDone(test:goto) && !flag(test.seen) || gameHour() >= 18`: calls, `!`, `&&`,
// `||`, brackets, and one comparison (`== != < <= > >=`) after a call that has a value to compare. A
// bare id is `[A-Za-z_][\w:./#-]*` (so `obj/test-terminal` and `used:obj/test-terminal` are one id each),
// a string is `"…"` with `\"` and `\\` inside it, and a number may carry a sign. `true` and `false` are
// the conditions that always and never hold. Each call becomes the JSON the design gives it
// (`{ quest: 'test:goto', is: 'done' }`), which is also what an importer writes by hand, so both go
// through the loader's one check afterwards (`set.ts`).
//
// **Actions.** One call each, its arguments literals: `grant(test:next)`, `flag(test.branch, 2)`. They
// read into `{ act: 'grant', args: ['test:next'] }`, one shape for every action, which is ours: the design
// gives every condition a JSON form and leaves the actions' to the build.
//
// **Rolls.** `roll(0.5)` carries the place it was written (`site`, and its order within the expression),
// so the same roll of the same character in the same run of the same quest always comes out the same,
// wherever it is worked out (`seed.ts`).

import { ACTIONS, CONDITIONS, OPS, arity, argKindAt, type FnSpec } from './vocab.ts';

export type Lit = string | number | boolean;
/** A condition's JSON. Its shapes are the design's (G9); `set.ts` checks one handed in by hand. */
export type CondJson = Record<string, unknown>;
export interface ActionJson {
  act: string;
  args: Lit[];
}

export interface ExprError {
  message: string;
  /** Where in the expression, from 0. */
  at: number;
}

type Tok = { t: 'id' | 'str' | 'num' | 'op' | '(' | ')' | ',' | '!' | '&&' | '||' | 'end'; v: string; at: number };

const ID = /[A-Za-z_][\w:./#-]*/y;
const NUM = /[+-]?\d+(\.\d+)?/y;
const OP = /==|!=|<=|>=|<|>/y;

function tokens(src: string): Tok[] | ExprError {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '(' || c === ')' || c === ',') {
      out.push({ t: c, v: c, at: i });
      i++;
      continue;
    }
    if (src.startsWith('&&', i) || src.startsWith('||', i)) {
      out.push({ t: src.slice(i, i + 2) as '&&' | '||', v: src.slice(i, i + 2), at: i });
      i += 2;
      continue;
    }
    OP.lastIndex = i;
    const op = OP.exec(src);
    if (op) {
      out.push({ t: 'op', v: op[0], at: i });
      i += op[0].length;
      continue;
    }
    if (c === '!') {
      out.push({ t: '!', v: '!', at: i });
      i++;
      continue;
    }
    if (c === '"') {
      let s = '';
      let k = i + 1;
      for (;;) {
        if (k >= src.length) return { message: 'a string is never closed', at: i };
        const d = src[k];
        if (d === '"') break;
        if (d === '\\') {
          const e = src[k + 1];
          if (e !== '"' && e !== '\\') return { message: `\\${e ?? ''} is not an escape here (only \\" and \\\\)`, at: k };
          s += e;
          k += 2;
          continue;
        }
        s += d;
        k++;
      }
      out.push({ t: 'str', v: s, at: i });
      i = k + 1;
      continue;
    }
    NUM.lastIndex = i;
    const num = NUM.exec(src);
    if (num) {
      out.push({ t: 'num', v: num[0], at: i });
      i += num[0].length;
      continue;
    }
    ID.lastIndex = i;
    const id = ID.exec(src);
    if (id) {
      out.push({ t: 'id', v: id[0], at: i });
      i += id[0].length;
      continue;
    }
    return { message: `unexpected ${JSON.stringify(c)}`, at: i };
  }
  out.push({ t: 'end', v: '', at: src.length });
  return out;
}

class Bad extends Error {
  at: number;
  constructor(message: string, at: number) {
    super(message);
    this.at = at;
  }
}

/** A reader over the tokens, with the site rolls are seeded from. */
class Reader {
  toks: Tok[];
  pos = 0;
  site: string;
  rolls = 0;

  constructor(toks: Tok[], site: string) {
    this.toks = toks;
    this.site = site;
  }

  peek(): Tok {
    return this.toks[this.pos];
  }

  next(): Tok {
    return this.toks[this.pos++];
  }

  expect(t: Tok['t'], what: string): Tok {
    const k = this.next();
    if (k.t !== t) throw new Bad(`expected ${what}`, k.at);
    return k;
  }

  literal(): Lit {
    const k = this.next();
    if (k.t === 'num') return Number(k.v);
    if (k.t === 'str') return k.v;
    if (k.t === 'id') return k.v === 'true' ? true : k.v === 'false' ? false : k.v;
    throw new Bad('expected a value: an id, a "string" or a number', k.at);
  }

  /** `name(arg, arg)`, the name already read. */
  args(): { args: Lit[]; at: number[] } {
    this.expect('(', '(');
    const args: Lit[] = [];
    const at: number[] = [];
    if (this.peek().t === ')') {
      this.next();
      return { args, at };
    }
    for (;;) {
      at.push(this.peek().at);
      args.push(this.literal());
      const k = this.next();
      if (k.t === ')') return { args, at };
      if (k.t !== ',') throw new Bad('expected , or ) between arguments', k.at);
    }
  }

  or(): CondJson {
    const first = this.and();
    if (this.peek().t !== '||') return first;
    const any = [first];
    while (this.peek().t === '||') {
      this.next();
      any.push(this.and());
    }
    return { any };
  }

  and(): CondJson {
    const first = this.unary();
    if (this.peek().t !== '&&') return first;
    const all = [first];
    while (this.peek().t === '&&') {
      this.next();
      all.push(this.unary());
    }
    return { all };
  }

  unary(): CondJson {
    if (this.peek().t === '!') {
      this.next();
      return { not: this.unary() };
    }
    return this.compare();
  }

  compare(): CondJson {
    const k = this.peek();
    if (k.t === '(') {
      this.next();
      const inner = this.or();
      this.expect(')', ')');
      if (this.peek().t === 'op') throw new Bad('only a call can be compared with a value', this.peek().at);
      return inner;
    }
    if (k.t !== 'id') throw new Bad(k.t === 'end' ? 'the condition ends where a call was expected' : 'expected a call such as questDone(...)', k.at);
    this.next();
    if (k.v === 'true' || k.v === 'false') return k.v === 'true' ? { all: [] } : { any: [] };
    const spec = CONDITIONS[k.v];
    if (!spec) throw new Bad(`${k.v} is not a condition this game knows`, k.at);
    const { args, at } = this.args();
    checkArgs(spec, args, at, k.at);
    let cmp: { op: string; value: Lit; at: number } | null = null;
    if (this.peek().t === 'op') {
      const op = this.next();
      const at2 = this.peek().at;
      const value = this.literal();
      cmp = { op: op.v, value, at: at2 };
    }
    return buildCond(spec, args, cmp, k.at, () => `${this.site}#${this.rolls++}`);
  }
}

/** Arity and the plain kind of each literal: a number where a number belongs, a word where a word does. */
function checkArgs(spec: FnSpec, args: Lit[], at: number[], callAt: number): void {
  const { min, max } = arity(spec);
  if (args.length < min || args.length > max) {
    const want = max === Infinity ? `${min} or more` : min === max ? `${min}` : `${min} to ${max}`;
    throw new Bad(`${spec.name} takes ${want} argument${want === '1' ? '' : 's'}, not ${args.length}`, callAt);
  }
  for (let i = 0; i < args.length; i++) {
    const kind = argKindAt(spec, i);
    const a = args[i];
    if ((kind === 'number' || kind === 'int') && typeof a !== 'number') throw new Bad(`${spec.name}'s argument ${i + 1} is a number`, at[i]);
    if (kind === 'int' && !Number.isInteger(a)) throw new Bad(`${spec.name}'s argument ${i + 1} is a whole number`, at[i]);
    if (kind !== 'number' && kind !== 'int' && kind !== 'any' && kind !== 'value' && typeof a !== 'string') throw new Bad(`${spec.name}'s argument ${i + 1} is a name or a "string", not ${JSON.stringify(a)}`, at[i]);
  }
}

/** A game hour compared with a value, as the range of hours it holds in: `[from, to)`. */
function hourRange(op: string, h: number, at: number): CondJson {
  if (!Number.isInteger(h) || h < 0 || h > 24) throw new Bad('a game hour is a whole number from 0 to 24', at);
  switch (op) {
    case '>=':
      return { hour: [h, 24] };
    case '>':
      return { hour: [Math.min(24, h + 1), 24] };
    case '<':
      return { hour: [0, h] };
    case '<=':
      return { hour: [0, Math.min(24, h + 1)] };
    case '==':
      return { hour: [h, Math.min(24, h + 1)] };
    default:
      return { not: { hour: [h, Math.min(24, h + 1)] } };
  }
}

/**
 * The JSON a call stands for, with its comparison. A string value is compared only for being equal or
 * not (`!=` becomes `not`); a number by any of the six.
 */
function buildCond(spec: FnSpec, a: Lit[], cmp: { op: string; value: Lit; at: number } | null, at: number, seed: () => string): CondJson {
  if (spec.value && !cmp && !spec.bare) throw new Bad(`${spec.name}(...) has a value to compare: write it as ${spec.name}(...) >= 1, or the like`, at);
  if (cmp && !spec.value) throw new Bad(`${spec.name}(...) is true or false and has no value to compare`, cmp.at);
  const op = cmp ? OPS[cmp.op] : null;
  const v = cmp?.value;
  if (cmp && spec.value === 'number' && typeof v !== 'number') throw new Bad(`${spec.name}(...) is compared with a number`, cmp.at);
  if (cmp && spec.value === 'string' && typeof v !== 'string') throw new Bad(`${spec.name}(...) is compared with a "string"`, cmp.at);
  if (cmp && spec.value === 'string' && op !== 'eq' && op !== 'ne') throw new Bad(`${spec.name}(...) is a word, compared only with == or !=`, cmp.at);
  if (cmp && spec.value === 'value' && typeof v === 'string' && op !== 'eq' && op !== 'ne') throw new Bad('a word is compared only with == or !=', cmp.at);
  if (cmp && typeof v === 'boolean') throw new Bad('compare with a number or a "string", not true or false', cmp.at);
  /** A string-valued comparison: equal, or not equal as `not`. */
  const word = (shape: CondJson): CondJson => (op === 'ne' ? { not: shape } : shape);
  const numCmp = (): Record<string, unknown> => ({ [op as string]: v });
  switch (spec.name) {
    case 'questNone':
      return { quest: a[0], is: 'none' };
    case 'questOffered':
      return { quest: a[0], is: 'offered' };
    case 'questActive':
      return { quest: a[0], is: 'active' };
    case 'questFailed':
      return { quest: a[0], is: 'failed' };
    case 'questDone':
      return a.length > 1 ? { quest: a[0], is: 'done', outcome: a[1] } : { quest: a[0], is: 'done' };
    case 'closed':
      return { quest: a[0], is: 'closed' };
    case 'stepActive':
      return { step: [a[0], a[1]], is: 'active' };
    case 'stepDone':
      return { step: [a[0], a[1]], is: 'done' };
    case 'completions':
      return { completions: a[0], ...numCmp() };
    case 'flag':
      return cmp ? { flag: a[0], ...numCmp() } : { flag: a[0], set: true };
    case 'world':
      return { world: a[0] };
    case 'inArea':
      return { inArea: a[0] };
    case 'inRoom':
      return { inRoom: a.length > 1 ? { cell: a[0], template: a[1] } : { cell: a[0] } };
    case 'gameHour':
      return hourRange(cmp!.op, v as number, cmp!.at);
    case 'inGroup':
      return { grouped: true };
    case 'species':
      return { species: a[0] };
    case 'roll':
      return { chance: a[0], seed: seed() };
    case 'call':
      return { script: a[0], args: a.slice(1) };
    case 'credits':
      return { credits: numCmp() };
    case 'has':
      return { has: a.length > 2 ? { kind: a[0], id: a[1], n: a[2] } : { kind: a[0], id: a[1] } };
    case 'standing':
      return { standing: { track: a[0], ...numCmp() } };
    case 'trust':
      return { trust: { track: a[0], ...numCmp() } };
    case 'choiceOf':
      return word({ choice: [a[0], a[1]], eq: v });
    case 'heard':
      return { heard: a[0] };
    case 'chosen':
      return { chosen: a[0] };
    case 'met':
      return { person: { who: a[0], is: 'met' } };
    case 'named':
      return { person: { who: a[0], is: 'named' } };
    case 'witnessed':
      return a.length > 1 ? { witnessed: a[0], variant: a[1] } : { witnessed: a[0] };
    case 'fileLevel':
      return { file: { agency: a[0], ...numCmp() } };
    case 'fileHas':
      return { fileHas: [a[0], a[1]] };
    case 'rank':
      return word({ rank: { track: a[0], eq: v } });
    case 'rankAtLeast':
      return { rank: { track: a[0], atLeast: a[1] } };
    case 'rankReady':
      return { rank: { track: a[0], ready: true } };
    case 'trackIs':
      return { track: { track: a[0], is: a[1] } };
    case 'division':
      return word({ track: { track: a[0], division: v } });
    case 'npcStanding':
      return { person: { who: a[0], standing: numCmp() } };
    case 'npcTrust':
      return { person: { who: a[0], trust: numCmp() } };
    case 'alive':
      return { person: { who: a[0], is: 'alive' } };
    case 'access':
      return word({ person: { who: a[0], access: v } });
    case 'companion':
      return word({ companion: { who: a[0], is: v } });
    case 'companionUp':
      return { companion: { up: true } };
    case 'debt':
      return { debt: { to: a[0], ...numCmp() } };
    default:
      throw new Bad(`${spec.name} has no JSON form`, at);
  }
}

/** A condition, read into its JSON, or where it went wrong. `site` is where it was written, for its rolls. */
export function parseCondition(src: string, site = ''): { cond: CondJson } | { error: ExprError } {
  const toks = tokens(src);
  if (!Array.isArray(toks)) return { error: toks };
  const r = new Reader(toks, site);
  try {
    const cond = r.or();
    const k = r.peek();
    if (k.t !== 'end') throw new Bad(k.t === ')' ? 'a ) with no ( before it' : 'expected && or || between conditions', k.at);
    return { cond };
  } catch (e) {
    if (e instanceof Bad) return { error: { message: e.message, at: e.at } };
    throw e;
  }
}

/** An action, read into its JSON, or where it went wrong. */
export function parseAction(src: string): { act: ActionJson } | { error: ExprError } {
  const toks = tokens(src);
  if (!Array.isArray(toks)) return { error: toks };
  const r = new Reader(toks, '');
  try {
    const k = r.next();
    if (k.t !== 'id') throw new Bad('an action is a call such as grant(test:next)', k.at);
    const spec = ACTIONS[k.v];
    if (!spec) throw new Bad(`${k.v} is not an action this game knows`, k.at);
    const { args, at } = r.args();
    checkArgs(spec, args, at, k.at);
    const end = r.peek();
    if (end.t !== 'end') throw new Bad('an action is one call; write each on its own', end.at);
    return { act: { act: spec.name, args } };
  } catch (e) {
    if (e instanceof Bad) return { error: { message: e.message, at: e.at } };
    throw e;
  }
}
