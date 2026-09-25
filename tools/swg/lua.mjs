// A reader for Lua *values*, which is all the server's own script files are.
//
// The owner's Core3 checkout keeps the world's spawn data as Lua: a few thousand files of table
// constructors with named constants in them. None of it needs a Lua interpreter and none of it may
// become one -- that project is somebody else's work under its own licence, so this reads its data
// and never runs, copies or mirrors its code. What is here is a tokeniser and a value parser for the
// subset those files really use, written from the Lua manual's own grammar for a table constructor.
//
// The subset, measured over the files this converter reads rather than assumed:
//
//   - table constructors, with array parts and `key = value` parts in any mix, and a trailing comma;
//   - strings in single or double quotes, with the usual escapes;
//   - numbers, including a leading minus, a decimal point, an exponent and `0x` hex (the region
//     tiers are written as hex constants);
//   - `true`, `false` and `nil`;
//   - bare identifiers, which are the data's own named constants (`CIRCLE`, `NOSPAWNAREA`,
//     `MOB_HERBIVORE`), resolved against a table the caller hands in and otherwise kept as the name
//     itself, so a constant nobody has declared is visible rather than silently zero;
//   - `+` between numbers, which is how a bitmask of those constants is written, and `..` between
//     strings;
//   - a call, `f(a, b)`, which is read as a marker naming the function and its arguments rather than
//     evaluated, since the ones that appear (`merge`, `getRandomNumber`) are logic and not data.
//
// Comments (`--` to the end of the line, and `--[[ ]]` blocks) are skipped everywhere. Anything
// outside the subset throws with the line number, which is the point: a file that has grown a
// construct this does not read must stop the run rather than convert to something plausible.

/** One token: `{ kind, value, line }`. */
function tokenise(src) {
  const out = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  const isName = (c) => /[A-Za-z0-9_.]/.test(c);
  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    // Comments. A long comment opens `--[[` or `--[=[`; anything else runs to the line's end.
    if (c === '-' && src[i + 1] === '-') {
      const long = /^--\[=*\[/.exec(src.slice(i, i + 12));
      if (long) {
        const close = `]${'='.repeat(long[0].length - 4)}]`;
        const at = src.indexOf(close, i + long[0].length);
        const end = at < 0 ? n : at + close.length;
        for (let k = i; k < end; k++) if (src[k] === '\n') line++;
        i = end;
        continue;
      }
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    // A long string, `[[ ... ]]`.
    if (c === '[' && /^\[=*\[/.test(src.slice(i, i + 10))) {
      const open = /^\[=*\[/.exec(src.slice(i, i + 10))[0];
      const close = `]${'='.repeat(open.length - 2)}]`;
      const at = src.indexOf(close, i + open.length);
      if (at < 0) throw new Error(`lua: an unterminated long string on line ${line}`);
      const body = src.slice(i + open.length, at);
      for (const ch of body) if (ch === '\n') line++;
      out.push({ kind: 'string', value: body.replace(/^\n/, ''), line });
      i = at + close.length;
      continue;
    }
    if (c === '"' || c === "'") {
      let s = '';
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') {
          const e = src[i + 1];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
          i += 2;
          continue;
        }
        if (src[i] === '\n') throw new Error(`lua: a string running past the end of line ${line}`);
        s += src[i++];
      }
      if (i >= n) throw new Error(`lua: an unterminated string on line ${line}`);
      i++;
      out.push({ kind: 'string', value: s, line });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(0[xX][0-9a-fA-F]+|[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/.exec(src.slice(i));
      if (!m) throw new Error(`lua: a number that will not read on line ${line}`);
      out.push({ kind: 'number', value: Number(m[1]), line });
      i += m[1].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let s = '';
      while (i < n && isName(src[i])) s += src[i++];
      out.push({ kind: 'name', value: s, line });
      continue;
    }
    if (src.startsWith('..', i)) {
      out.push({ kind: 'op', value: '..', line });
      i += 2;
      continue;
    }
    // Every operator Lua has, whether or not a value can contain it: the ones that cannot only ever
    // appear in a statement this steps over, and tokenising them is what lets it step over them
    // rather than stopping the run on a file whose data is perfectly readable.
    if ('{}[](),;=+-*/%^:#<>~&|'.includes(c)) {
      out.push({ kind: 'op', value: c, line });
      i++;
      continue;
    }
    throw new Error(`lua: the character ${JSON.stringify(c)} on line ${line} is outside what this reads`);
  }
  return out;
}

/** A call the parser met and did not evaluate: which function, and the values it was given. */
export class LuaCall {
  constructor(name, args) {
    this.call = name;
    this.args = args;
  }
}

/**
 * Parse one value starting at `at`, returning `[value, next]`.
 *
 * `consts` resolves a bare identifier. A name it has not got comes back as the name itself, so a
 * constant nobody declared shows up in the output instead of reading as 0 or undefined.
 */
function parseValue(t, at, consts) {
  const tok = t[at];
  if (!tok) throw new Error('lua: the file ended in the middle of a value');
  if (tok.kind === 'op' && tok.value === '-') {
    const [v, next] = parseValue(t, at + 1, consts);
    if (typeof v !== 'number') throw new Error(`lua: a minus in front of something that is not a number on line ${tok.line}`);
    return [-v, next];
  }
  if (tok.kind === 'op' && tok.value === '#') {
    // The length operator, which only ever appears in logic this does not evaluate.
    const [v, next] = parseValue(t, at + 1, consts);
    return [new LuaCall('#', [v]), next];
  }
  let value;
  let i = at;
  if (tok.kind === 'number' || tok.kind === 'string') {
    value = tok.value;
    i = at + 1;
  } else if (tok.kind === 'name') {
    const name = tok.value;
    // `Ident:new { ... }` and `f(...)`: a constructor is its table, a call is a marker.
    if (t[at + 1]?.kind === 'op' && t[at + 1].value === ':' && t[at + 2]?.kind === 'name') {
      const [tbl, next] = parseValue(t, at + 3, consts);
      if (!tbl || typeof tbl !== 'object') throw new Error(`lua: ${name}:${t[at + 2].value} without a table on line ${tok.line}`);
      tbl.__class = name;
      return [tbl, next];
    }
    if (t[at + 1]?.kind === 'op' && t[at + 1].value === '(') {
      const args = [];
      i = at + 2;
      while (!(t[i]?.kind === 'op' && t[i].value === ')')) {
        const [v, next] = parseValue(t, i, consts);
        args.push(v);
        i = next;
        if (t[i]?.kind === 'op' && t[i].value === ',') i++;
        else if (!(t[i]?.kind === 'op' && t[i].value === ')')) throw new Error(`lua: a call's arguments will not read on line ${t[i]?.line ?? tok.line}`);
      }
      value = new LuaCall(name, args);
      i++;
    } else if (t[at + 1]?.kind === 'op' && t[at + 1].value === '{') {
      // `Ident { ... }`, the call-with-a-table form.
      const [tbl, next] = parseValue(t, at + 1, consts);
      tbl.__class = name;
      return [tbl, next];
    } else if (name === 'true' || name === 'false') {
      value = name === 'true';
      i = at + 1;
    } else if (name === 'nil') {
      value = null;
      i = at + 1;
    } else {
      value = Object.prototype.hasOwnProperty.call(consts, name) ? consts[name] : name;
      i = at + 1;
    }
  } else if (tok.kind === 'op' && tok.value === '{') {
    // `Object.create(null)`: these keys come out of a file and must never reach the prototype.
    const tbl = Object.create(null);
    const list = [];
    i = at + 1;
    while (!(t[i]?.kind === 'op' && t[i].value === '}')) {
      if (!t[i]) throw new Error(`lua: a table opened on line ${tok.line} and never closed`);
      // `[expr] = value`
      if (t[i].kind === 'op' && t[i].value === '[') {
        const [k, afterKey] = parseValue(t, i + 1, consts);
        if (!(t[afterKey]?.kind === 'op' && t[afterKey].value === ']')) throw new Error(`lua: a bracketed key that does not close on line ${t[i].line}`);
        if (!(t[afterKey + 1]?.kind === 'op' && t[afterKey + 1].value === '=')) throw new Error(`lua: a bracketed key with no value on line ${t[i].line}`);
        const [v, next] = parseValue(t, afterKey + 2, consts);
        tbl[String(k)] = v;
        i = next;
      } else if (t[i].kind === 'name' && t[i + 1]?.kind === 'op' && t[i + 1].value === '=') {
        const key = t[i].value;
        const [v, next] = parseValue(t, i + 2, consts);
        tbl[key] = v;
        i = next;
      } else {
        const [v, next] = parseValue(t, i, consts);
        list.push(v);
        i = next;
      }
      if (t[i]?.kind === 'op' && (t[i].value === ',' || t[i].value === ';')) i++;
      else if (!(t[i]?.kind === 'op' && t[i].value === '}')) throw new Error(`lua: a table entry that will not read on line ${t[i]?.line ?? tok.line}`);
    }
    i++;
    // A table with only an array part comes back as an array, which is what every row here is.
    if (list.length && Object.keys(tbl).length === 0) value = list;
    else {
      if (list.length) tbl.__list = list;
      value = tbl;
    }
  } else {
    throw new Error(`lua: ${tok.kind} ${JSON.stringify(tok.value)} on line ${tok.line} cannot start a value`);
  }
  // `+` folds a bitmask of named constants; `..` joins strings. Both left to right.
  while (t[i]?.kind === 'op' && (t[i].value === '+' || t[i].value === '..')) {
    const op = t[i].value;
    const [rhs, next] = parseValue(t, i + 1, consts);
    if (op === '+') {
      if (typeof value !== 'number' || typeof rhs !== 'number') {
        // A sum with an unresolved constant in it: keep both so the caller can say which name.
        value = new LuaCall('+', [value, rhs]);
      } else value += rhs;
    } else value = `${value}${rhs}`;
    i = next;
  }
  return [value, i];
}

/** Read one Lua value from a whole source string. For a fixture or a single table. */
export function parseLuaValue(src, consts = {}) {
  // The table is its own object with no prototype, so a constant is found by `hasOwnProperty` and a
  // name the data happens to share with something on Object's prototype is not silently resolved.
  const [v] = parseValue(tokenise(src), 0, Object.assign(Object.create(null), consts));
  return v;
}

/**
 * Every call to one of `names`, wherever it stands in the file, with its arguments read as values.
 *
 * This is how the world's standing people are read, and it has to ignore the file's own structure
 * rather than follow it: the calls that place them sit inside functions, inside `if` blocks gated on
 * quest state, and inside blocks gated on which part of the world is loaded. Following the structure
 * would mean running the project's logic, which is its work and not ours; scanning for the call and
 * reading its arguments takes the data and leaves the logic alone.
 *
 * The price is that a call the logic would never reach is read as though it would. That is the right
 * way round for a world nobody is running quests in: a person who stands there under some condition
 * is better placed than absent. `gated` counts how many were found inside a conditional, so the
 * caller can say so rather than pretend it knows.
 *
 * An argument this cannot read (an expression, a variable, a nested call) comes back as a `LuaCall`
 * or a bare name, and the caller decides whether that row is usable.
 */
export function findCalls(src, names, consts = {}) {
  const t = tokenise(src);
  const table = Object.assign(Object.create(null), consts);
  const want = new Set(names);
  const out = [];
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const tok = t[i];
    // `if`, `while` and `for` open a conditional; `end` closes whatever was open. Approximate on
    // purpose -- it is only used to count, never to decide whether to take a row.
    if (tok.kind === 'name' && (tok.value === 'if' || tok.value === 'while' || tok.value === 'for')) depth++;
    else if (tok.kind === 'name' && tok.value === 'end' && depth > 0) depth--;
    if (!(tok.kind === 'name' && want.has(tok.value))) continue;
    if (!(t[i + 1]?.kind === 'op' && t[i + 1].value === '(')) continue;
    const args = [];
    let j = i + 2;
    let broke = false;
    while (!(t[j]?.kind === 'op' && t[j].value === ')')) {
      if (!t[j]) {
        broke = true;
        break;
      }
      try {
        const [v, next] = parseValue(t, j, table);
        args.push(v);
        j = next;
      } catch {
        broke = true;
        break;
      }
      if (t[j]?.kind === 'op' && t[j].value === ',') j++;
      else if (!(t[j]?.kind === 'op' && t[j].value === ')')) {
        broke = true;
        break;
      }
    }
    if (broke) continue;
    out.push({ call: tok.value, args, line: tok.line, gated: depth > 0 });
    i = j;
  }
  return out;
}

/**
 * Every top-level `name = <value>` in a file, in order, as a Map.
 *
 * Statements that are not assignments (a `require`, a call such as `addLairTemplate(...)`, a
 * function definition) are stepped over: the data is in the assignments and the calls are the
 * project's own registration, which is its logic rather than ours to run. The calls *are* returned
 * separately, because which name a file registers itself under is data worth having -- it is not
 * always the variable's own name.
 */
export function readLua(src, consts = {}) {
  const t = tokenise(src);
  const table = Object.assign(Object.create(null), consts);
  const values = new Map();
  const calls = [];
  let i = 0;
  while (i < t.length) {
    const tok = t[i];
    // `local name = ...` reads as the assignment it is.
    if (tok.kind === 'name' && tok.value === 'local') {
      i++;
      continue;
    }
    if (tok.kind === 'name' && t[i + 1]?.kind === 'op' && t[i + 1].value === '=' ) {
      const name = tok.value;
      const [v, next] = parseValue(t, i + 2, table);
      values.set(name, v);
      // Later files read constants declared in earlier ones, so a name defined here resolves below.
      if (typeof v === 'number' || typeof v === 'string') table[name] = v;
      i = next;
      continue;
    }
    if (tok.kind === 'name' && t[i + 1]?.kind === 'op' && t[i + 1].value === '(') {
      const [v, next] = parseValue(t, i, table);
      if (v instanceof LuaCall) calls.push(v);
      i = next;
      continue;
    }
    // Anything else at the top level (a function, a control structure, an indexed assignment) is
    // logic. Step to the next line rather than guessing at it.
    const line = tok.line;
    while (i < t.length && t[i].line === line) i++;
  }
  return { values, calls };
}
