// The README's Debugging table, read as data: which helper each row names, how each is called in its
// examples, and what the row says it does. The debug menu (`debugMenu.ts`) shows exactly this, so the
// README stays the one place a helper is described, and a node test runs this over the real README
// and over the game's own source to say which helper has no row.
//
// Pure: no DOM, nothing imported, strings in and plain objects out.

/** One way a row's first cell shows a helper being called. */
export interface DebugCall {
  /** The helper's name: its key on `window.__debug`, or the window's own name for a knob that hangs there (`__sharedDay`). */
  helper: string;
  /** Where it hangs: `debug` for `__debug.<helper>`, `window` for `window.<helper>`. */
  on: 'debug' | 'window';
  /** The example as written, backticks off (`await perf({ frames: 240 })`). */
  code: string;
  /** The text inside the call's own parentheses ('' for `x()`), or null where the cell names it without calling it (`wear`). */
  args: string | null;
  /** Whatever the example does with the answer after the call (`.messages` in `hud().messages`), or ''. */
  after: string;
  /** The example awaits the answer. */
  awaits: boolean;
}

/** One row of the table. */
export interface DebugRow {
  /** The row's line in the README, counted from 1. */
  line: number;
  /** The first cell as written, markdown and all. */
  usage: string;
  /** The rest of the row: what the helpers in it do, markdown and all. */
  description: string;
  /** Every call the first cell names, in the order it names them. */
  calls: DebugCall[];
}

/** Everything the table says about one helper, gathered from every row that names it. */
export interface DebugDoc {
  helper: string;
  on: 'debug' | 'window';
  /** The rows that name it, in README order. */
  rows: DebugRow[];
  /** Its own examples across those rows, in README order, each once. */
  examples: DebugCall[];
}

/** Where the section starts: its heading, and where it ends: the next heading of the same level. */
const SECTION = /^##\s+Debugging\s*$/;
const NEXT_SECTION = /^##\s+\S/;

/**
 * Split a table row into its cells: on every `|` that is not escaped, the outer two dropped. A pipe
 * written `\|` stays in its cell as a plain `|`, which is how the README writes one inside a sentence.
 */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && line[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (c === '|') {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  cells.push(cur);
  // A row is written `| a | b |`: the empty strings before the first pipe and after the last go.
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

/**
 * The index of the bracket that closes the one at `open`, or -1. Strings (all three quotes, with their
 * escapes) are stepped over, so `say('(', 1)` closes where it should.
 */
export function closingBracket(s: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const stack: string[] = [];
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < s.length && s[i] !== c; i++) if (s[i] === '\\') i++;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

const NAME = /^(?:window\.)?(__debug\.)?([A-Za-z_$][\w$]*)/;

/** One code span of a first cell read as a call, or null when it does not start with a name. */
export function parseCall(code: string): DebugCall | null {
  let s = code.trim();
  let awaits = false;
  if (/^await\s/.test(s)) {
    awaits = true;
    s = s.replace(/^await\s+/, '');
  }
  const m = NAME.exec(s);
  if (!m) return null;
  const helper = m[2];
  // `window.__debug` alone, or a bare `__debug`, names the toolbox and not a helper in it.
  if (helper === '__debug' || helper === 'window') return null;
  const on: 'debug' | 'window' = !m[1] && helper.startsWith('__') ? 'window' : 'debug';
  let rest = s.slice(m[0].length);
  let args: string | null = null;
  if (rest.startsWith('(')) {
    const close = closingBracket(rest, 0);
    if (close < 0) {
      args = rest.slice(1).trim();
      rest = '';
    } else {
      args = rest.slice(1, close).trim();
      rest = rest.slice(close + 1);
    }
  }
  return { helper, on, code: code.trim(), args, after: rest.trim(), awaits };
}

/** Every code span in a piece of markdown, backticks off. */
export function codeSpans(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(/`([^`]+)`/g)) out.push(m[1]);
  return out;
}

/**
 * The Debugging section's table, row by row. The header row and the rule under it are not rows; a row
 * whose first cell names no helper at all is kept (it still says something) with no calls.
 */
export function parseDebugTable(readme: string): DebugRow[] {
  const lines = readme.split(/\r?\n/);
  const rows: DebugRow[] = [];
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SECTION.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (NEXT_SECTION.test(line)) break;
    if (!line.trimStart().startsWith('|')) continue;
    const cells = splitRow(line.trim());
    if (cells.length < 2) continue;
    // The header, and the rule of dashes under it.
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
    if (cells[0] === 'Helper') continue;
    const usage = cells[0];
    const description = cells.slice(1).join(' | ');
    const calls: DebugCall[] = [];
    for (const span of codeSpans(usage)) {
      const call = parseCall(span);
      if (call) calls.push(call);
    }
    rows.push({ line: i + 1, usage, description, calls });
  }
  return rows;
}

/** The key a helper is filed under: its name, with the window's own knobs apart from the toolbox's. */
export function docKey(helper: string, on: 'debug' | 'window'): string {
  return on === 'window' ? `window.${helper}` : helper;
}

/**
 * The rows gathered per helper, keyed by `docKey`, in the order the table first names each. A
 * helper's own rows come first -- the ones that name it earliest in their first cell, a row that
 * starts with it before one that mentions it on the way to something else (`ride` is named at the
 * end of the detail levels' row, and that row is not what `ride` does) -- and README order after
 * that; its examples follow the same order.
 */
export function docsByHelper(rows: DebugRow[]): Map<string, DebugDoc> {
  const out = new Map<string, DebugDoc>();
  /** Where in each row's first cell each helper is first named. */
  const rank = new Map<DebugRow, Map<string, number>>();
  for (const row of rows) {
    const at = new Map<string, number>();
    row.calls.forEach((call, i) => {
      const key = docKey(call.helper, call.on);
      if (!at.has(key)) at.set(key, i);
    });
    rank.set(row, at);
    for (const call of row.calls) {
      const key = docKey(call.helper, call.on);
      let doc = out.get(key);
      if (!doc) {
        doc = { helper: call.helper, on: call.on, rows: [], examples: [] };
        out.set(key, doc);
      }
      if (!doc.rows.includes(row)) doc.rows.push(row);
    }
  }
  for (const [key, doc] of out) {
    // A stable sort: rows that name it equally early keep the README's order.
    doc.rows.sort((a, b) => (rank.get(a)!.get(key) ?? 0) - (rank.get(b)!.get(key) ?? 0));
    for (const row of doc.rows) {
      for (const call of row.calls) {
        if (docKey(call.helper, call.on) !== key) continue;
        if (!doc.examples.some((e) => e.code === call.code)) doc.examples.push(call);
      }
    }
  }
  return out;
}

/**
 * The arguments to put in the box when a helper is picked: its first example that calls it, as written
 * inside the parentheses. A helper named but never called in the table (`wear`) gets ''.
 */
export function firstArgs(doc: DebugDoc | undefined): string {
  if (!doc) return '';
  for (const e of doc.examples) if (e.args !== null) return e.args;
  return '';
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text made safe to put in the page as HTML. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * The little markdown a table cell uses, as HTML: code spans, bold and italics. Everything else is
 * escaped, so nothing in the README can put markup of its own in the page.
 */
export function inlineMarkdown(md: string): string {
  let out = '';
  let last = 0;
  for (const m of md.matchAll(/`([^`]+)`/g)) {
    out += prose(md.slice(last, m.index));
    out += `<code>${escapeHtml(m[1])}</code>`;
    last = m.index! + m[0].length;
  }
  return out + prose(md.slice(last));
}

function prose(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:]|$)/g, '$1<i>$2</i>');
}
