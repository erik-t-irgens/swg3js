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
//   - `+` between numbers, which is how a bitmask of those constants is written, `-`, `*`, `/` and
//     `%` by the manual's own precedence (a week written as `7 * 24 * 60 * 60`), and `..` between
//     strings;
//   - a call, `f(a, b)`, which is read as a marker naming the function and its arguments rather than
//     evaluated, since the ones that appear (`merge`, `getRandomNumber`) are logic and not data.
//
// Comments (`--` to the end of the line, and `--[[ ]]` blocks) are skipped everywhere. A single value
// outside the subset throws with the line number, which is the point: a file that has grown a
// construct this does not read must stop the run rather than convert to something plausible.
//
// **A whole file is another matter**, and `readLua` does not throw on one. The server's own town
// scripts are a table of data followed by the functions that spawn it, and a function body is code:
// `spawnMobile(self.planet, mob[1], ...)` is a statement this was never going to read. Read a line at
// a time, the first such statement stopped the whole file, and with it the table above it that was
// perfectly readable: 32 of the 35 town scripts, every cantina patron, trainer, guard and commoner in
// the game, lost to the loop that stands them. So a `function ... end` is stepped over whole, keyword
// by keyword to its own `end`, and any top-level statement that still will not read is stepped over
// and counted (`skipped`) rather than thrown: the data around it is kept, and the count says how much
// was not.

/** One token: `{ kind, value, line, at }`, `at` being where it starts in the source. */
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
      out.push({ kind: 'string', value: body.replace(/^\n/, ''), line, at: i });
      i = at + close.length;
      continue;
    }
    if (c === '"' || c === "'") {
      let s = '';
      const from = i;
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
      out.push({ kind: 'string', value: s, line, at: from });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      // `0.` is a number in Lua as much as `0.5` is, and the server's own creature files write it.
      const m = /^(0[xX][0-9a-fA-F]+|(?:[0-9]+(?:\.(?!\.)[0-9]*)?|\.[0-9]+)([eE][-+]?[0-9]+)?)/.exec(src.slice(i, i + 64));
      if (!m) throw new Error(`lua: a number that will not read on line ${line}`);
      out.push({ kind: 'number', value: Number(m[1]), line, at: i });
      i += m[1].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let s = '';
      const from = i;
      while (i < n && isName(src[i])) s += src[i++];
      out.push({ kind: 'name', value: s, line, at: from });
      continue;
    }
    if (src.startsWith('..', i)) {
      out.push({ kind: 'op', value: '..', line, at: i });
      i += 2;
      continue;
    }
    // Every operator Lua has, whether or not a value can contain it: the ones that cannot only ever
    // appear in a statement this steps over, and tokenising them is what lets it step over them
    // rather than stopping the run on a file whose data is perfectly readable.
    if ('{}[](),;=+-*/%^:#<>~&|.'.includes(c)) {
      out.push({ kind: 'op', value: c, line, at: i });
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

/** The words that open a block closed by `end` (or, for `repeat`, by `until`). */
const BLOCK_OPENERS = new Set(['function', 'if', 'for', 'while', 'do', 'repeat']);

/**
 * The token after the block that opens at `at` (a `function`, `if`, `for`, `while`, `do` or
 * `repeat`), counted keyword by keyword to its own closing word. `for` and `while` are not counted
 * themselves because the `do` after them is, which is the grammar's own shape: every `end` closes
 * exactly one `function`, `if` or `do`, and `until` closes a `repeat`. Strings and comments are
 * tokens already, so a keyword inside one is never counted. A block that never closes runs to the
 * end of the file rather than throwing: what is inside it is code, whatever state it is in.
 */
function blockEnd(t, at) {
  let depth = 0;
  for (let i = at; i < t.length; i++) {
    const k = t[i];
    if (k.kind !== 'name') continue;
    if (k.value === 'function' || k.value === 'if' || k.value === 'do' || k.value === 'repeat') depth++;
    else if (k.value === 'end' || k.value === 'until') {
      depth--;
      if (depth <= 0) return i + 1;
    }
  }
  return t.length;
}

/**
 * Where the next top-level statement starts, from one at `from` that is being stepped over: past
 * every bracket it opens and every block inside it, to the first token at the outside that begins a
 * new line. A table that spans twenty lines is one statement, not twenty, so none of its inner
 * `key = value` lines is ever mistaken for the file's own.
 */
function statementEnd(t, from) {
  let depth = 0;
  let i = from;
  while (i < t.length) {
    const k = t[i];
    if (i > from && depth === 0 && k.line !== t[i - 1].line) break;
    if (k.kind === 'name' && BLOCK_OPENERS.has(k.value)) {
      i = blockEnd(t, i);
      continue;
    }
    if (k.kind === 'op') {
      if (k.value === '{' || k.value === '(' || k.value === '[') depth++;
      else if ((k.value === '}' || k.value === ')' || k.value === ']') && depth > 0) depth--;
    }
    i++;
  }
  return Math.max(i, from + 1);
}

/**
 * The operators a value may be built with, and how tightly each binds (the manual's own order, less
 * the ones no data here uses): `..` loosest and to the right, then `+` and `-`, then `*`, `/` and
 * `%`. A table's `24 * 60 * 60` is a number like any other, and read without them the one entry
 * holding it threw away the whole table round it: a town's event, a screenplay's every other field.
 */
const BINARY = { '..': [1, true], '+': [2, false], '-': [2, false], '*': [3, false], '/': [3, false], '%': [3, false] };

/** Two values joined by an operator: folded where both are numbers, kept as a marker where not. */
function combine(op, a, b) {
  if (op === '..') return `${a}${b}`;
  if (typeof a === 'number' && typeof b === 'number') {
    if (op === '+') return a + b;
    if (op === '-') return a - b;
    if (op === '*') return a * b;
    if (op === '/') return a / b;
    return a - Math.floor(a / b) * b;
  }
  // A sum with an unresolved constant or a call in it: keep both so the caller can say which.
  return new LuaCall(op, [a, b]);
}

/**
 * Parse one value starting at `at`, returning `[value, next]`: one operand, then any operators that
 * bind at least as tightly as `min`, by precedence climbing.
 *
 * `consts` resolves a bare identifier. A name it has not got comes back as the name itself, so a
 * constant nobody declared shows up in the output instead of reading as 0 or undefined.
 */
function parseValue(t, at, consts, min = 0) {
  let [value, i] = parseOperand(t, at, consts);
  for (;;) {
    const op = t[i];
    const rule = op?.kind === 'op' ? BINARY[op.value] : undefined;
    if (!rule || rule[0] < min) break;
    const [rhs, next] = parseValue(t, i + 1, consts, rule[1] ? rule[0] : rule[0] + 1);
    value = combine(op.value, value, rhs);
    i = next;
  }
  return [value, i];
}

/** One operand: a literal, a name, a call, a constructor or a table, with any unary operator on it. */
function parseOperand(t, at, consts) {
  const tok = t[at];
  if (!tok) throw new Error('lua: the file ended in the middle of a value');
  if (tok.kind === 'op' && tok.value === '-') {
    // Unary minus binds tighter than any operator above, so `-65.7 + getRandomNumber(40)` is the
    // sum of a negative number and a call, and not the negative of the whole sum.
    const [v, next] = parseOperand(t, at + 1, consts);
    return [typeof v === 'number' ? -v : new LuaCall('-', [0, v]), next];
  }
  if (tok.kind === 'op' && tok.value === '#') {
    // The length operator, which only ever appears in logic this does not evaluate.
    const [v, next] = parseOperand(t, at + 1, consts);
    return [new LuaCall('#', [v]), next];
  }
  if (tok.kind === 'op' && tok.value === '(') {
    // A bracketed expression, which the operators above make worth reading.
    const [v, next] = parseValue(t, at + 1, consts);
    if (!(t[next]?.kind === 'op' && t[next].value === ')')) throw new Error(`lua: a bracket opened on line ${tok.line} and never closed`);
    return [v, next + 1];
  }
  let value;
  let i = at;
  if (tok.kind === 'number' || tok.kind === 'string') {
    value = tok.value;
    i = at + 1;
  } else if (tok.kind === 'name' && tok.value === 'function') {
    // A function written inside a value (a callback in a table) is code: stepped over whole, and
    // kept as a marker so a table holding one still reads.
    return [new LuaCall('function', []), blockEnd(t, at)];
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
      // `row[3]`, a read out of a table, kept as a marker naming the table and the key: logic, but
      // the logic that says which element of a row is which (`spawnMobile(p, mob[1], mob[2], ...)`).
      while (t[i]?.kind === 'op' && t[i].value === '[') {
        const [k, next] = parseValue(t, i + 1, consts);
        if (!(t[next]?.kind === 'op' && t[next].value === ']')) throw new Error(`lua: an index that does not close on line ${t[i].line}`);
        value = new LuaCall('[]', [value, k]);
        i = next + 1;
      }
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
 *
 * A function, and a control structure written at the top level, is stepped over **whole**, to its
 * own `end`: stepping a line at a time walked straight into its body and read its statements as the
 * file's own, and the first of them that was code rather than data threw away the whole file. An
 * assignment or a call that will not read is stepped over too, to where the next statement starts,
 * and counted in `skipped` rather than thrown: the tables around it are the data, and losing them for
 * one line of logic is what hid every town's people.
 */
export function readLua(src, consts = {}) {
  const t = tokenise(src);
  const table = Object.assign(Object.create(null), consts);
  const values = new Map();
  const calls = [];
  let skipped = 0;
  const skippedLines = [];
  let i = 0;
  while (i < t.length) {
    const tok = t[i];
    // `local name = ...` reads as the assignment it is.
    if (tok.kind === 'name' && tok.value === 'local') {
      i++;
      continue;
    }
    if (tok.kind === 'name' && BLOCK_OPENERS.has(tok.value)) {
      i = blockEnd(t, i);
      continue;
    }
    if (tok.kind === 'name' && t[i + 1]?.kind === 'op' && t[i + 1].value === '=') {
      const name = tok.value;
      try {
        const [v, next] = parseValue(t, i + 2, table);
        values.set(name, v);
        // Later files read constants declared in earlier ones, so a name defined here resolves below.
        if (typeof v === 'number' || typeof v === 'string') table[name] = v;
        i = next;
      } catch {
        skipped++;
        skippedLines.push(tok.line);
        i = statementEnd(t, i);
      }
      continue;
    }
    if (tok.kind === 'name' && t[i + 1]?.kind === 'op' && t[i + 1].value === '(') {
      try {
        const [v, next] = parseValue(t, i, table);
        if (v instanceof LuaCall) calls.push(v);
        i = next;
      } catch {
        skipped++;
        skippedLines.push(tok.line);
        i = statementEnd(t, i);
      }
      continue;
    }
    // Anything else at the top level (a method call, an indexed assignment, the rest of an
    // expression) is logic. Step over the statement rather than guessing at it.
    i = statementEnd(t, i);
  }
  return { values, calls, skipped, skippedLines };
}

/**
 * Every top-level statement of a file **in the order it is written**, as a list: an assignment
 * (`{ kind: 'assign', name, value, line }`), a call (`{ kind: 'call', call, line }`, the `LuaCall`) and a
 * method call (`{ kind: 'method', self, method, args, line }`, `tpl:addScreen(screen)`).
 *
 * `readLua` keeps the last value a name was given, which is what a file of data wants; this is for a
 * file that builds something a statement at a time, where the order is the meaning. The server's
 * conversation files are that: a screen is declared and then added to its template, and seven of them
 * declare a second screen under a name a first one already had -- read by name, the first screen is lost
 * and the second is added twice. Functions are stepped over whole, as `readLua` steps over them
 * (`functionBodies` reads them), and a statement that will not read is stepped over and counted.
 */
export function readStatements(src, consts = {}) {
  const t = tokenise(src);
  const table = Object.assign(Object.create(null), consts);
  const out = [];
  let skipped = 0;
  let i = 0;
  while (i < t.length) {
    const tok = t[i];
    // `local name = ...` reads as the assignment it is, and a `;` ends a statement and starts none.
    if ((tok.kind === 'name' && tok.value === 'local') || (tok.kind === 'op' && tok.value === ';')) {
      i++;
      continue;
    }
    if (tok.kind === 'name' && BLOCK_OPENERS.has(tok.value)) {
      i = blockEnd(t, i);
      continue;
    }
    try {
      if (tok.kind === 'name' && t[i + 1]?.kind === 'op' && t[i + 1].value === '=') {
        const [v, next] = parseValue(t, i + 2, table);
        out.push({ kind: 'assign', name: tok.value, value: v, line: tok.line });
        if (typeof v === 'number' || typeof v === 'string') table[tok.value] = v;
        i = next;
        continue;
      }
      if (tok.kind === 'name' && t[i + 1]?.kind === 'op' && t[i + 1].value === '(') {
        const [v, next] = parseValue(t, i, table);
        if (v instanceof LuaCall) out.push({ kind: 'call', call: v, line: tok.line });
        i = next;
        continue;
      }
      // `self:method(args)`: read as the method call it is, its arguments as values.
      if (tok.kind === 'name' && t[i + 1]?.kind === 'op' && t[i + 1].value === ':' && t[i + 2]?.kind === 'name' && t[i + 3]?.kind === 'op' && t[i + 3].value === '(') {
        const [call, next] = parseValue(t, i + 2, table);
        if (call instanceof LuaCall) out.push({ kind: 'method', self: tok.value, method: call.call, args: call.args, line: tok.line });
        i = next;
        continue;
      }
    } catch {
      skipped++;
      i = statementEnd(t, i);
      continue;
    }
    i = statementEnd(t, i);
  }
  return { statements: out, skipped };
}

/**
 * Every named function a file defines, as `{ name, params, line, body, tokens }`: its name as written
 * (`createTrainerConversationTemplate`, `HeraldConvoHandler:runScreenHandlers`), the names of its
 * parameters, the source of its body (everything between the parameters' closing bracket and its own
 * `end`, which `readStatements` can read as a file of its own) and that body's tokens, so a caller can ask
 * which names and strings it mentions without reading its comments. Cut out with `blockEnd`, the
 * matcher `readLua` steps over a function with, so the two agree about where one ends. A function written
 * inside a value is not a named function and is not listed; one inside another is the outer one's.
 */
export function functionBodies(src) {
  const t = tokenise(src);
  const out = [];
  for (let i = 0; i < t.length; i++) {
    const k = t[i];
    if (k.kind !== 'name' || k.value !== 'function') continue;
    let j = i + 1;
    let name = '';
    if (t[j]?.kind === 'name') {
      name = t[j].value;
      j++;
      if (t[j]?.kind === 'op' && t[j].value === ':' && t[j + 1]?.kind === 'name') {
        name += `:${t[j + 1].value}`;
        j += 2;
      }
    }
    const end = blockEnd(t, i);
    if (!name || !(t[j]?.kind === 'op' && t[j].value === '(')) {
      i = end - 1;
      continue;
    }
    const params = [];
    j++;
    while (t[j] && !(t[j].kind === 'op' && t[j].value === ')')) {
      if (t[j].kind === 'name') params.push(t[j].value);
      j++;
    }
    const closing = t[end - 1];
    const from = t[j] ? t[j].at + 1 : src.length;
    const to = closing && closing.value === 'end' ? closing.at : src.length;
    out.push({ name, params, line: k.line, body: src.slice(from, Math.max(from, to)), tokens: t.slice(j + 1, end - 1) });
    i = end - 1;
  }
  return out;
}
