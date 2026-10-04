// A story's documents (`docs/<id>.doc.txt`), read into what the document window and the journal show, and the
// calendar the documents' `{date}` is read from (`calendar.jsonc`). Pure: the loader hands each file in through
// its own file scope (`set.ts`), so a document's conditions are checked word for word as a quest's are, its ids
// are prefixed the same way, and every problem names its file and line.
//
// **The format** is a text of our own, because prose in a JSON string is miserable to write by hand. A header
// of `key: value` lines -- `kind` (workorder, memo, log, intercept, letter, notice, declaration, dossier), `id`,
// `title`, `issuer`, `client` -- ends at the first blank line, and the body follows:
//
//   - plain lines, a blank line between paragraphs;
//   - `[field] Label: value`, `[stamp] WORDS`, `[sign] A NAME`;
//   - `[table]` then a row a line (`| a | b |`) then `[/table]`;
//   - `[redact when <condition>] words [/redact]`, inside a paragraph or across lines: a bar the length of the
//     words unless the condition holds when the document is read;
//   - `[slot <name>]`, a place a variant fills;
//   - `[page]`, a page turn.
//
// Then `--- variant <id> when <condition>` blocks (the condition may be left off), each filling slots: `[slot
// <name>]` and what follows it, to the next slot or the next variant. The first variant whose condition holds
// **when the document is read** is the one read, and it is frozen into the journal as it was read; nothing
// anywhere says which variant is the true one, and a variant called so is refused (rule 10). A slot a variant
// fills that the body has not got is refused (rule 11). In any text `{player}`, `{player.species}`,
// `{npc:<who>}` (the person as the player knows them) and `{date}` (from the calendar) are filled as it is read.
// A line beginning `//` is a comment.
//
// What the window and the journal are given is the document as it was read (`DocView`): its pages of blocks,
// a redaction already a bar with no words under it, so a page shows nothing the reader was not let see.
//
// Every limit here is ours.

import type { CondJson } from './expr.ts';
import type { Source } from './set.ts';
import { FORBIDDEN_KEYS } from './waypoints.ts';

export const DOC_KINDS = ['workorder', 'memo', 'log', 'intercept', 'letter', 'notice', 'declaration', 'dossier'] as const;
export type DocKind = (typeof DOC_KINDS)[number];
/** The kinds a job's card may be: what is offered with Accept and Decline at its foot. */
export const CARD_KINDS: readonly DocKind[] = ['workorder', 'notice'];

/** A run of a paragraph as written: words, or words under a redaction with the condition that lifts it. */
export type SrcSpan = string | { redact: CondJson | null; text: string };

/** A block as written. */
export type DocSrc =
  | { t: 'p'; s: SrcSpan[]; line: number }
  | { t: 'field'; label: string; value: SrcSpan[]; line: number }
  | { t: 'table'; rows: string[][]; line: number }
  | { t: 'stamp'; text: string; line: number }
  | { t: 'sign'; text: string; line: number }
  | { t: 'slot'; name: string; line: number }
  | { t: 'page'; line: number };

export interface DocVariant {
  id: string;
  when: CondJson | null;
  fills: Record<string, DocSrc[]>;
  line: number;
}

export interface DocDef {
  /** `<set>:doc/<id>`. */
  id: string;
  kind: DocKind;
  title: string;
  issuer: string | null;
  client: string | null;
  body: DocSrc[];
  /** The slots the body has, in order. */
  slots: string[];
  variants: DocVariant[];
  /** The people its `{npc:<who>}` names, prefixed: rule 1 holds them to the cast. */
  names: string[];
  hash: string;
  test: boolean;
  src: Source;
}

/** A run of a paragraph as read: words, or a bar as long as the words it hides. */
export type DocSpan = string | { bar: number };

/** A block as read. */
export type DocBlock =
  | { t: 'p'; s: DocSpan[] }
  | { t: 'field'; label: string; value: DocSpan[] }
  | { t: 'table'; rows: string[][] }
  | { t: 'stamp'; text: string }
  | { t: 'sign'; text: string };

/** A document as it was read: what the window shows and what the journal freezes. */
export interface DocView {
  id: string;
  kind: DocKind;
  title: string;
  issuer?: string;
  client?: string;
  /** The variant read, or null for one with none, or none whose condition held. */
  variant: string | null;
  pages: DocBlock[][];
}

/** The limits on a document. Ours, and far past anything written by hand. */
export const DOC_LIMITS = { lineMax: 2000, blocks: 2000, pages: 64, rows: 200, cells: 12, titleMax: 120, variants: 32, bar: 400 };

/** The tokens a document's text may carry. */
const TOKEN = /\{(player|player\.species|date|npc:[^}\s]{1,140})\}/g;
const ANY_TOKEN = /\{[A-Za-z][A-Za-z0-9_.:/-]{0,140}\}/g;
const VARIANT_ID = /^[A-Za-z0-9_-]{1,48}$/;
const SLOT = /^[A-Za-z0-9_-]{1,48}$/;
/** The variant names rule 10 refuses: nothing marks one version of a document as the real one. */
const CANONICAL = /^(canonical|iscanonical|true|truth|istrue|genuine|real|thetruth)$/i;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/** What reading a document needs of the loader's file scope (`set.ts`). */
export interface DocScope {
  prefix: string;
  test: boolean;
  err(path: string, message: string, rule?: number): null;
  warn(path: string, message: string, rule?: number): void;
  src(): Source;
  cond(v: unknown, path: string): CondJson | null;
  ref(v: unknown, path: string, kind: 'obj' | 'area' | 'cast' | 'doc' | 'talk'): string | null;
}

/** The line map a document's file scope reports by: `/L<n>` is line n. */
export function docLines(text: string): Map<string, number> {
  const m = new Map<string, number>();
  const n = text.split('\n').length;
  for (let i = 1; i <= n; i++) m.set(`/L${i}`, i);
  return m;
}

/** The text with control characters taken out and cut to a line's length. */
function plain(s: string): string {
  return s.replace(CONTROL, '').slice(0, DOC_LIMITS.lineMax);
}

/**
 * The end of a `[redact when <condition>]` opening that starts at `from` (the `[`), skipping a `]` inside a
 * quoted string of the condition; -1 when it never closes on this line.
 */
function closeOf(line: string, from: number): number {
  let quoted = false;
  for (let i = from + 1; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '\\') i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ']') return i;
  }
  return -1;
}

/** A reader of one document's body, a variant's fill or the body itself, line by line. */
class BodyReader {
  readonly s: DocScope;
  readonly out: DocSrc[] = [];
  private para: SrcSpan[] = [];
  private paraLine = 0;
  private table: { rows: string[][]; line: number } | null = null;
  /** A redaction open across lines: its condition and the words so far. */
  private redact: { when: CondJson | null; words: string[] } | null = null;
  readonly names: string[];

  constructor(s: DocScope, names: string[]) {
    this.s = s;
    this.names = names;
  }

  /** Words of a line, read into runs: plain words and the redactions in them, any redaction left open carried on. */
  private spans(text: string, n: number): SrcSpan[] {
    const out: SrcSpan[] = [];
    let rest = text;
    for (;;) {
      if (this.redact) {
        const close = rest.indexOf('[/redact]');
        if (close < 0) {
          if (rest.trim()) this.redact.words.push(rest.trim());
          return out;
        }
        const words = [...this.redact.words, rest.slice(0, close).trim()].filter(Boolean).join(' ');
        if (words) out.push({ redact: this.redact.when, text: this.tokens(words, n) });
        this.redact = null;
        rest = rest.slice(close + '[/redact]'.length);
        continue;
      }
      const open = rest.indexOf('[redact');
      if (open < 0) {
        if (rest.trim()) out.push(this.tokens(rest, n));
        return out;
      }
      if (rest.slice(0, open).trim()) out.push(this.tokens(rest.slice(0, open), n));
      const end = closeOf(rest, open);
      if (end < 0) {
        this.s.err(`/L${n}`, 'a [redact when <condition>] is closed with ] on the line it opens');
        return out;
      }
      const head = rest.slice(open + 1, end).trim();
      const m = /^redact(?:\s+when\s+(.+))?$/.exec(head);
      if (!m) {
        this.s.err(`/L${n}`, 'a redaction is written [redact when <condition>] ... [/redact]');
        return out;
      }
      if (!m[1]) this.s.warn(`/L${n}`, 'a redaction with no condition is a bar for every reader');
      this.redact = { when: m[1] ? this.s.cond(m[1], `/L${n}`) : null, words: [] };
      rest = rest.slice(end + 1);
    }
  }

  /** A text's tokens checked, and a `{npc:<who>}` written with its set's prefix. */
  tokens(text: string, n: number): string {
    const t = plain(text);
    for (const m of t.matchAll(ANY_TOKEN)) {
      const tok = m[0];
      if (!new RegExp(`^${TOKEN.source}$`).test(tok)) this.s.warn(`/L${n}`, `${tok} is not a token a document fills: {player}, {player.species}, {npc:<who>} or {date}`);
    }
    return t.replace(/\{npc:([^}\s]{1,140})\}/g, (all, who: string) => {
      const id = this.s.ref(who, `/L${n}`, 'cast');
      if (!id) return all;
      if (!this.names.includes(id)) this.names.push(id);
      return `{npc:${id}}`;
    });
  }

  private flushPara(): void {
    if (this.para.length) this.out.push({ t: 'p', s: this.para, line: this.paraLine });
    this.para = [];
  }

  /** One line of the body. */
  line(raw: string, n: number): void {
    const text = raw.replace(CONTROL, '');
    const trimmed = text.trim();
    if (this.table) {
      if (/^\[\/table\]$/i.test(trimmed)) {
        this.out.push({ t: 'table', rows: this.table.rows, line: this.table.line });
        this.table = null;
        return;
      }
      if (!trimmed) return;
      if (!trimmed.startsWith('|')) {
        this.s.err(`/L${n}`, 'a table\'s rows are written | a | b |, and the table ends with [/table]');
        return;
      }
      const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => this.tokens(c.trim(), n).slice(0, 200));
      if (this.table.rows.length < DOC_LIMITS.rows) this.table.rows.push(cells.slice(0, DOC_LIMITS.cells));
      return;
    }
    if (this.redact) {
      // Inside a redaction that runs over lines: everything up to its close is the redaction's.
      const s = this.spans(trimmed, n);
      if (!this.para.length) this.paraLine = n;
      else if (s.length) this.para.push(' ');
      this.para.push(...s);
      return;
    }
    if (!trimmed) {
      this.flushPara();
      return;
    }
    const mark = /^\[(page|field|stamp|sign|table|slot)\b([^\]]*)\]\s*(.*)$/i.exec(trimmed);
    if (!mark) {
      if (/^\[[A-Za-z/]/.test(trimmed) && !/^\[redact\b/i.test(trimmed)) this.s.err(`/L${n}`, `${trimmed.slice(0, trimmed.indexOf(']') + 1) || trimmed.slice(0, 20)} is not a mark a document knows: [field], [table], [stamp], [sign], [redact when ...], [slot name] or [page]`);
      // A paragraph's lines run on into each other with a space between, as prose does.
      if (!this.para.length) this.paraLine = n;
      else this.para.push(' ');
      this.para.push(...this.spans(trimmed, n));
      return;
    }
    this.flushPara();
    const kind = mark[1].toLowerCase();
    const arg = mark[2].trim();
    const rest = mark[3];
    switch (kind) {
      case 'page':
        if (arg || rest) this.s.warn(`/L${n}`, '[page] stands alone on its line');
        this.out.push({ t: 'page', line: n });
        return;
      case 'table':
        if (arg || rest) this.s.warn(`/L${n}`, '[table] stands alone on its line, its rows under it');
        this.table = { rows: [], line: n };
        return;
      case 'field': {
        const colon = rest.indexOf(':');
        const label = colon >= 0 ? rest.slice(0, colon).trim() : '';
        const value = (colon >= 0 ? rest.slice(colon + 1) : rest).trim();
        this.out.push({ t: 'field', label: this.tokens(label, n).slice(0, 80), value: this.spans(value, n), line: n });
        return;
      }
      case 'stamp':
      case 'sign':
        if (!rest.trim()) this.s.err(`/L${n}`, `[${kind}] is followed by its words`);
        this.out.push({ t: kind, text: this.tokens(rest.trim(), n).slice(0, 200), line: n });
        return;
      case 'slot':
        if (!SLOT.test(arg)) {
          this.s.err(`/L${n}`, 'a slot is named [slot <name>], a plain name', 11);
          return;
        }
        this.out.push({ t: 'slot', name: arg, line: n });
        if (rest.trim()) this.line(rest, n);
        return;
    }
  }

  /** The body read to its end: an open table or redaction is closed with a word of what was missing. */
  end(n: number): DocSrc[] {
    if (this.table) {
      this.s.err(`/L${this.table.line}`, 'a [table] is never closed with [/table]');
      this.out.push({ t: 'table', rows: this.table.rows, line: this.table.line });
      this.table = null;
    }
    if (this.redact) {
      this.s.err(`/L${n}`, 'a [redact ...] is never closed with [/redact]');
      if (this.redact.words.length) this.para.push({ redact: this.redact.when, text: this.redact.words.join(' ') });
      this.redact = null;
    }
    this.flushPara();
    return this.out;
  }
}

const HEADER_KEYS = ['kind', 'id', 'title', 'issuer', 'client'];

/**
 * One document file, read and checked as far as it stands alone. `file` is its path in the set, whose name
 * (`docs/<id>.doc.txt`) its `id` should match. The hash is the loader's to put on.
 */
export function docOf(s: DocScope, text: string, file: string): DocDef | null {
  const lines = text.split('\n');
  const head: Record<string, string> = Object.create(null);
  let i = 0;
  // The header: `key: value` lines from the top (comments and leading blank lines aside) to the first blank line.
  while (i < lines.length && (!lines[i].trim() || lines[i].trim().startsWith('//'))) i++;
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) break;
    if (l.startsWith('//')) continue;
    const m = /^([A-Za-z]+)\s*:\s*(.*)$/.exec(l);
    if (!m) {
      s.err(`/L${i + 1}`, 'the header is key: value lines, and a blank line ends it before the body');
      break;
    }
    const key = m[1];
    // The whole rest of the line is the value: a title may well carry a `#` (a requisition's number), and the
    // only comment the format has is a line beginning `//`.
    const value = plain(m[2].trim());
    if (FORBIDDEN_KEYS.includes(key)) {
      s.err(`/L${i + 1}`, `${key} is not a key a header may have`);
      continue;
    }
    if (CANONICAL.test(key)) {
      s.err(`/L${i + 1}`, 'nothing marks a version of anything as the canonical or true one', 10);
      continue;
    }
    if (!HEADER_KEYS.includes(key)) s.warn(`/L${i + 1}`, `${key} is not part of a document's header (${HEADER_KEYS.join(', ')}); pages are counted from [page]`);
    else if (head[key] !== undefined) s.err(`/L${i + 1}`, `${key} is written twice`);
    else head[key] = value;
  }
  const id = head.id ?? '';
  if (!/^[A-Za-z0-9_.-]{1,96}$/.test(id)) return s.err('/L1', 'a document needs an id: a plain name, which the set\'s prefix is put in front of');
  const named = /(?:^|\/)([^/]+)\.doc\.txt$/.exec(file)?.[1];
  if (named && named !== id) s.warn('/L1', `the document's id is ${id}, but its file is named ${named}.doc.txt`);
  const kind = (DOC_KINDS as readonly string[]).includes(head.kind ?? '') ? (head.kind as DocKind) : null;
  if (!kind) s.err('/L1', `a document's kind is one of ${DOC_KINDS.join(', ')}`);
  const title = (head.title ?? '').slice(0, DOC_LIMITS.titleMax);
  if (!title) s.err('/L1', 'a document needs a title');
  const names: string[] = [];
  const body = new BodyReader(s, names);
  const variants: DocVariant[] = [];
  let fill: { v: DocVariant; reader: BodyReader; slot: string | null; start: number } | null = null;
  const closeFill = (n: number): void => {
    if (!fill) return;
    const blocks = fill.reader.end(n);
    let slot = fill.slot;
    let at: DocSrc[] = [];
    for (const b of blocks) {
      if (b.t === 'slot') {
        if (slot !== null) fill.v.fills[slot] = at;
        slot = b.name;
        at = [];
        if (fill.v.fills[slot] !== undefined) s.err(`/L${b.line}`, `variant ${fill.v.id} fills ${slot} twice`, 11);
        continue;
      }
      if (slot === null) {
        s.err(`/L${b.line}`, `a variant fills slots: begin what it says with [slot <name>]`, 11);
        continue;
      }
      if (b.t === 'page') s.warn(`/L${b.line}`, 'a page turn inside a slot turns the page wherever the slot stands');
      at.push(b);
    }
    if (slot !== null) fill.v.fills[slot] = at;
    fill = null;
  };
  for (i = i + 1; i < lines.length; i++) {
    const n = i + 1;
    const raw = lines[i];
    if (raw.trim().startsWith('//')) continue;
    const v = /^---\s*variant\s+(\S+)(?:\s+when\s+(.+?))?\s*$/i.exec(raw.trim());
    if (v) {
      closeFill(n);
      if (!VARIANT_ID.test(v[1])) s.err(`/L${n}`, `${v[1]} is not a variant's name: a plain name`);
      else if (CANONICAL.test(v[1])) s.err(`/L${n}`, 'nothing marks a version of anything as the canonical or true one', 10);
      else if (variants.some((x) => x.id === v[1])) s.err(`/L${n}`, `there is a variant ${v[1]} already`);
      if (variants.length >= DOC_LIMITS.variants) {
        s.err(`/L${n}`, `a document has at most ${DOC_LIMITS.variants} variants`);
        continue;
      }
      const variant: DocVariant = { id: v[1], when: v[2] ? s.cond(v[2], `/L${n}`) : null, fills: Object.create(null), line: n };
      variants.push(variant);
      fill = { v: variant, reader: new BodyReader(s, names), slot: null, start: n };
      continue;
    }
    if (/^---/.test(raw.trim())) {
      s.err(`/L${n}`, 'a variant begins --- variant <name> when <condition>');
      continue;
    }
    if (fill) fill.reader.line(raw, n);
    else body.line(raw, n);
  }
  closeFill(lines.length);
  const blocks = body.end(lines.length);
  if (blocks.length > DOC_LIMITS.blocks) s.err('/L1', `a document has at most ${DOC_LIMITS.blocks} blocks`);
  const slots: string[] = [];
  for (const b of blocks) {
    if (b.t !== 'slot') continue;
    if (slots.includes(b.name)) s.err(`/L${b.line}`, `the slot ${b.name} stands twice in the body`, 11);
    else slots.push(b.name);
  }
  if (blocks.filter((b) => b.t === 'page').length + 1 > DOC_LIMITS.pages) s.err('/L1', `a document has at most ${DOC_LIMITS.pages} pages`);
  // Rule 11: every slot a variant fills is one the body has; a slot no variant fills is warned about.
  for (const v of variants) for (const name of Object.keys(v.fills)) if (!slots.includes(name)) s.err(`/L${v.line}`, `variant ${v.id} fills ${name}, which is not a slot of the document`, 11);
  for (const name of slots) if (!variants.some((v) => v.fills[name] !== undefined)) s.warn('/L1', `no variant fills the slot ${name}, so it is always empty`, 11);
  if (!blocks.some((b) => b.t !== 'slot' && b.t !== 'page') && !variants.length) s.err('/L1', 'a document says something');
  if (!kind || !title) return null;
  return {
    id: `${s.prefix}:doc/${id}`,
    kind,
    title,
    issuer: head.issuer ? head.issuer.slice(0, 120) : null,
    client: head.client ? head.client.slice(0, 40) : null,
    body: blocks,
    slots,
    variants,
    names,
    hash: '',
    test: s.test,
    src: s.src(),
  };
}

/** Every plain word of a document as written, body and variants, with the line it is on: what the checker holds the test set's labels to. */
export function docWords(def: DocDef): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [{ line: 1, text: def.title }];
  const spans = (s: SrcSpan[], line: number, label = ''): void => {
    const t = `${label}${s.map((x) => (typeof x === 'string' ? x : x.text)).join(' ')}`.trim();
    if (t) out.push({ line, text: t });
  };
  const walk = (list: DocSrc[]): void => {
    for (const b of list) {
      if (b.t === 'p') spans(b.s, b.line);
      else if (b.t === 'field') spans(b.value, b.line, b.label ? `${b.label}: ` : '');
      else if (b.t === 'stamp' || b.t === 'sign') out.push({ line: b.line, text: b.text });
      else if (b.t === 'table') for (const r of b.rows) out.push({ line: b.line, text: r.join(' ') });
    }
  };
  walk(def.body);
  for (const v of def.variants) for (const k of Object.keys(v.fills)) walk(v.fills[k]);
  return out;
}

// ---- the calendar ---------------------------------------------------------------------------------------------

/**
 * The calendar a story's `{date}` is read from (`calendar.jsonc`): either a fixed text (`{ "text": "..." }`,
 * which the committed test set's is), or a count of days from an epoch on the shared clock: `{ "epoch": ms,
 * "day": "game" | "real", "yearDays": 365, "firstYear": 0, "format": "Day {day} of {year}" }`. The owner's to
 * write; every default is ours.
 */
export interface CalendarDef {
  text: string | null;
  epoch: number;
  dayMs: number;
  yearDays: number;
  firstYear: number;
  format: string;
}

/** What `{date}` reads with no calendar at all. */
export const NO_DATE = '[no date]';

/** A set's `calendar.jsonc`, read, with what is wrong with it said through `bad`. */
export function calendarOf(v: unknown, bad: (path: string, message: string) => void): CalendarDef | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    bad('', 'calendar.jsonc holds one object: { "text": "..." } or { "epoch", "day", "yearDays", "firstYear", "format" }');
    return null;
  }
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['text', 'epoch', 'day', 'yearDays', 'firstYear', 'format'].includes(k)) bad(`/${k}`, `${k} is not part of a calendar`);
  const num = (x: unknown, fallback: number, path: string, min = -Infinity): number => {
    if (x === undefined) return fallback;
    if (typeof x !== 'number' || !Number.isFinite(x) || x < min) {
      bad(path, 'expected a number');
      return fallback;
    }
    return x;
  };
  const text = typeof o.text === 'string' && o.text.trim() ? o.text.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) : null;
  if (o.text !== undefined && !text) bad('/text', 'a calendar\'s text is words');
  const day = o.day === undefined || o.day === 'game' ? 720000 : o.day === 'real' ? 86400000 : (bad('/day', 'a calendar\'s day is "game" (the game\'s 720 seconds) or "real"'), 720000);
  const format = typeof o.format === 'string' && o.format.trim() ? o.format.slice(0, 120) : 'Day {day}, year {year}';
  return { text, epoch: num(o.epoch, 0, '/epoch'), dayMs: day, yearDays: Math.max(1, Math.floor(num(o.yearDays, 365, '/yearDays', 1))), firstYear: Math.floor(num(o.firstYear, 0, '/firstYear')), format };
}

/** The date a calendar reads at a moment of the shared clock. */
export function dateText(cal: CalendarDef | null | undefined, now: number): string {
  if (!cal) return NO_DATE;
  if (cal.text) return cal.text;
  const days = Math.floor((now - cal.epoch) / cal.dayMs);
  const year = cal.firstYear + Math.floor(days / cal.yearDays);
  const day = (((days % cal.yearDays) + cal.yearDays) % cal.yearDays) + 1;
  return cal.format.replace(/\{year\}/g, String(year)).replace(/\{day\}/g, String(day));
}

// ---- a document off the wire ------------------------------------------------------------------------------------
//
// A browser on a server is handed a document as it was read and never the file: it is rebuilt here the house
// way before anything shows it, as a view and a node are.

const DOC_ID = /^[A-Za-z0-9_-]{1,24}:doc\/[A-Za-z0-9_.-]{1,96}$/;

function textOff(x: unknown, max: number): string | null {
  return typeof x === 'string' ? x.replace(CONTROL, '').slice(0, max) : null;
}

function spansOff(x: unknown): DocSpan[] {
  const out: DocSpan[] = [];
  if (!Array.isArray(x)) return out;
  for (const s of x) {
    if (out.length >= 200) break;
    if (typeof s === 'string') out.push(s.replace(CONTROL, '').slice(0, DOC_LIMITS.lineMax * 4));
    else if (s && typeof s === 'object' && typeof (s as { bar?: unknown }).bar === 'number') {
      const n = (s as { bar: number }).bar;
      if (Number.isFinite(n)) out.push({ bar: Math.max(1, Math.min(DOC_LIMITS.bar, Math.round(n))) });
    }
  }
  return out;
}

function blockOff(x: unknown): DocBlock | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  switch (o.t) {
    case 'p':
      return { t: 'p', s: spansOff(o.s) };
    case 'field':
      return { t: 'field', label: textOff(o.label, 80) ?? '', value: spansOff(o.value) };
    case 'table': {
      const rows: string[][] = [];
      if (Array.isArray(o.rows)) for (const r of o.rows) if (Array.isArray(r) && rows.length < DOC_LIMITS.rows) rows.push(r.slice(0, DOC_LIMITS.cells).map((c) => textOff(c, 200) ?? ''));
      return { t: 'table', rows };
    }
    case 'stamp':
    case 'sign': {
      const text = textOff(o.text, 200);
      return text ? { t: o.t, text } : null;
    }
    default:
      return null;
  }
}

/** A document as it was read, from the wire or the journal's own text, rebuilt, or null when it is not one. */
export function cleanDocView(x: unknown): DocView | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || !DOC_ID.test(o.id) || !(DOC_KINDS as readonly unknown[]).includes(o.kind)) return null;
  const title = textOff(o.title, DOC_LIMITS.titleMax);
  if (!title) return null;
  const pages: DocBlock[][] = [];
  if (Array.isArray(o.pages)) {
    for (const p of o.pages) {
      if (pages.length >= DOC_LIMITS.pages || !Array.isArray(p)) break;
      const page: DocBlock[] = [];
      for (const b of p) {
        const block = blockOff(b);
        if (block && page.length < DOC_LIMITS.blocks) page.push(block);
      }
      pages.push(page);
    }
  }
  if (!pages.length) pages.push([]);
  const out: DocView = { id: o.id, kind: o.kind as DocKind, title, variant: typeof o.variant === 'string' && VARIANT_ID.test(o.variant) ? o.variant : null, pages };
  const issuer = textOff(o.issuer, 120);
  if (issuer) out.issuer = issuer;
  const client = textOff(o.client, 40);
  if (client) out.client = client;
  return out;
}

/** A document's words as plain lines, page by page, a bar written as a run of blocks: what a call is spoken as, and what the console prints. */
export function docLinesOf(view: DocView): string[] {
  const out: string[] = [];
  const spans = (s: DocSpan[]): string => s.map((x) => (typeof x === 'string' ? x : '█'.repeat(Math.min(24, x.bar)))).join(' ').replace(/\s+/g, ' ').trim();
  for (const page of view.pages) {
    for (const b of page) {
      if (b.t === 'p') out.push(spans(b.s));
      else if (b.t === 'field') out.push(b.label ? `${b.label}: ${spans(b.value)}` : spans(b.value));
      else if (b.t === 'stamp' || b.t === 'sign') out.push(b.text);
      else if (b.t === 'table') for (const r of b.rows) out.push(r.join(' | '));
    }
  }
  return out.filter((l) => l.length > 0);
}
