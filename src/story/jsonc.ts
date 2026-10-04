// JSON with comments and trailing commas: the format a story's files are written in by hand. Pure,
// nothing imported, so the browser, the server and the checker's command line read a file the same way.
//
// **What it takes beyond JSON.** `// a line comment`, `/* a block comment */`, and a comma after the last
// entry of an object or a list. Nothing else: no single quotes, no bare keys, no hex numbers, so a file
// written for this still reads with any JSON tool once its comments are taken out.
//
// **Where things are.** An error names the line and the column it was found at (`file:3:17`). A file that
// reads is handed back with the line every value starts on, keyed by its path in the file
// (`/steps/outdoor/next/0`, a JSON pointer), so whatever checks the file later can say where it found
// what it did not like without reading the text again (`lineAt`).
//
// **What it refuses.** A key the language gives a meaning to (`__proto__`, `constructor`, `prototype`),
// the same key twice in one object, a string running over a line, and nesting past `DEPTH`: each is a
// mistake in a hand-written file, and the first is how a file would reach into the objects it is read into.

export interface JsoncError {
  line: number;
  col: number;
  message: string;
}

export interface JsoncDoc {
  value: unknown;
  /** The line each value starts on (an object's member: the line of its key), by JSON pointer. */
  lines: Map<string, number>;
  error: JsoncError | null;
}

/** How deep a file may nest. A story file is a few levels deep; anything near this is a mistake. */
const DEPTH = 64;
const FORBIDDEN = ['__proto__', 'constructor', 'prototype'];

/** One path segment as a JSON pointer writes it. */
function seg(s: string | number): string {
  return String(s).replace(/~/g, '~0').replace(/\//g, '~1');
}

/** A path as a JSON pointer: `pointer(['steps', 'outdoor'])` is `/steps/outdoor`. */
export function pointer(path: readonly (string | number)[]): string {
  let out = '';
  for (const p of path) out += `/${seg(p)}`;
  return out;
}

/** The line a path starts on, or the nearest line of a value it is inside; 1 when the file says nothing about it. */
export function lineAt(lines: Map<string, number>, path: string): number {
  let p = path;
  for (;;) {
    const l = lines.get(p);
    if (l !== undefined) return l;
    if (!p) return 1;
    p = p.slice(0, p.lastIndexOf('/'));
  }
}

class Fail extends Error {
  line: number;
  col: number;
  constructor(message: string, line: number, col: number) {
    super(message);
    this.line = line;
    this.col = col;
  }
}

/** Read a file. Never throws: a file that does not read comes back with `error` set and `value` undefined. */
export function parseJsonc(text: string): JsoncDoc {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = new Map<string, number>();
  let i = 0;
  let line = 1;
  let lineStart = 0;

  const fail = (message: string, at = i): never => {
    // The column is worked out from the start of the line `at` is on.
    let l = line;
    let start = lineStart;
    if (at < lineStart) {
      l = 1;
      start = 0;
      for (let k = 0; k < at; k++) if (src.charCodeAt(k) === 10) {
        l++;
        start = k + 1;
      }
    }
    throw new Fail(message, l, at - start + 1);
  };

  const newline = (at: number): void => {
    line++;
    lineStart = at + 1;
  };

  /** Skip spaces, line breaks and comments. */
  const space = (): void => {
    for (;;) {
      const c = src.charCodeAt(i);
      if (c === 10) {
        newline(i);
        i++;
      } else if (c === 32 || c === 9 || c === 13) {
        i++;
      } else if (c === 47 && src.charCodeAt(i + 1) === 47) {
        while (i < src.length && src.charCodeAt(i) !== 10) i++;
      } else if (c === 47 && src.charCodeAt(i + 1) === 42) {
        const from = i;
        i += 2;
        for (;;) {
          if (i >= src.length) fail('a comment is never closed', from);
          if (src.charCodeAt(i) === 42 && src.charCodeAt(i + 1) === 47) {
            i += 2;
            break;
          }
          if (src.charCodeAt(i) === 10) newline(i);
          i++;
        }
      } else {
        return;
      }
    }
  };

  const string = (): string => {
    const from = i;
    i++;
    let out = '';
    for (;;) {
      if (i >= src.length) fail('a string is never closed', from);
      const c = src.charCodeAt(i);
      if (c === 34) {
        i++;
        return out;
      }
      if (c === 10 || c === 13) fail('a string may not run over a line', i);
      if (c < 32 && c !== 9) fail('a control character inside a string', i);
      if (c === 92) {
        const e = src[i + 1];
        if (e === '"' || e === '\\' || e === '/') out += e;
        else if (e === 'n') out += '\n';
        else if (e === 't') out += '\t';
        else if (e === 'r') out += '\r';
        else if (e === 'b') out += '\b';
        else if (e === 'f') out += '\f';
        else if (e === 'u') {
          const hex = src.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('a \\u escape needs four hex digits', i);
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else fail(`\\${e ?? ''} is not an escape JSON knows`, i);
        i += 2;
        continue;
      }
      out += src[i];
      i++;
    }
  };

  const number = (): number => {
    const m = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(src.slice(i, i + 64));
    if (!m) fail('that is not a number');
    i += m![0].length;
    const v = Number(m![0]);
    if (!Number.isFinite(v)) fail('that number is too large', i - m![0].length);
    return v;
  };

  const value = (path: string, depth: number): unknown => {
    space();
    if (depth > DEPTH) fail(`nested more than ${DEPTH} deep`);
    if (!lines.has(path)) lines.set(path, line);
    const c = src[i];
    if (c === '{') {
      i++;
      const out: Record<string, unknown> = {};
      const seen = new Set<string>();
      for (;;) {
        space();
        if (src[i] === '}') {
          i++;
          return out;
        }
        if (src[i] !== '"') fail(i >= src.length ? 'the file ends inside an object' : 'expected a key in double quotes, or }');
        const keyLine = line;
        const keyAt = i;
        const key = string();
        if (FORBIDDEN.includes(key)) fail(`"${key}" may not be a key`, keyAt);
        if (seen.has(key)) fail(`"${key}" is given twice`, keyAt);
        seen.add(key);
        space();
        if (src[i] !== ':') fail('expected : after the key');
        i++;
        const child = `${path}/${seg(key)}`;
        lines.set(child, keyLine);
        out[key] = value(child, depth + 1);
        space();
        if (src[i] === ',') {
          i++;
          continue;
        }
        if (src[i] === '}') {
          i++;
          return out;
        }
        fail(i >= src.length ? 'the file ends inside an object' : 'expected , or } after a value');
      }
    }
    if (c === '[') {
      i++;
      const out: unknown[] = [];
      for (;;) {
        space();
        if (src[i] === ']') {
          i++;
          return out;
        }
        if (i >= src.length) fail('the file ends inside a list');
        out.push(value(`${path}/${out.length}`, depth + 1));
        space();
        if (src[i] === ',') {
          i++;
          continue;
        }
        if (src[i] === ']') {
          i++;
          return out;
        }
        fail(i >= src.length ? 'the file ends inside a list' : 'expected , or ] after a value');
      }
    }
    if (c === '"') return string();
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    if (src.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (src.startsWith('false', i)) {
      i += 5;
      return false;
    }
    if (src.startsWith('null', i)) {
      i += 4;
      return null;
    }
    return fail(i >= src.length ? 'the file ends where a value was expected' : `unexpected ${JSON.stringify(c)}`);
  };

  try {
    const v = value('', 0);
    space();
    if (i < src.length) fail('more after the end of the value');
    return { value: v, lines, error: null };
  } catch (e) {
    if (e instanceof Fail) return { value: undefined, lines, error: { line: e.line, col: e.col, message: e.message } };
    throw e;
  }
}

/** A position as an error names it: `file:line:col`, or `file:line`. */
export function where(file: string, line: number, col?: number): string {
  return col ? `${file}:${line}:${col}` : `${file}:${line}`;
}
