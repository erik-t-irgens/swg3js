// A piece of text a story shows, as the story's files write it: the words themselves, or a reference to
// one of the client's own strings for the browser to look up when it shows them. Pure, nothing imported.
//
// **Four spellings.** `"@table:key"` is a client string (`@conversation/c_herald:s_1`), looked up in the
// tables the conversations command writes, from a later wave; `":key"` is a string of the tree's own
// table, for a conversation that names one; any other string is the words themselves; and `{ en: "..." }`
// is the words themselves when they would otherwise begin with `@` or `:`. A reference nobody can resolve
// is shown as `[…]` rather than as the reference, and whoever resolves it says so once in the console.
//
// Nothing here is the game's.

export type TextRef = string | { en: string };

/** What an unresolved reference is shown as. */
export const UNRESOLVED = '[…]';

/** The longest text a story's file may carry in one place, in characters. A document's body is longer and is not a TextRef. */
export const TEXT_MAX = 4000;

/** `@<table>:<key>`: the table is a path of the client's string tables (`conversation/c_herald`), the key one of its rows. */
const CLIENT = /^@([A-Za-z0-9_/.-]{1,120}):([A-Za-z0-9_.-]{1,120})$/;
const RELATIVE = /^:([A-Za-z0-9_.-]{1,120})$/;
/** Control characters, but not the line break or the tab, which a longer text may carry. */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/** A TextRef handed in from a file or the wire, cleaned, or null when it is not one. */
export function cleanTextRef(x: unknown, max = TEXT_MAX): TextRef | null {
  if (typeof x === 'string') {
    const s = x.replace(CONTROL, '').slice(0, max);
    if (!s.trim()) return null;
    if (s.startsWith('@') && !CLIENT.test(s)) return null;
    if (s.startsWith(':') && !RELATIVE.test(s)) return null;
    return s;
  }
  if (x && typeof x === 'object' && !Array.isArray(x)) {
    const en = (x as Record<string, unknown>).en;
    if (typeof en !== 'string') return null;
    const s = en.replace(CONTROL, '').slice(0, max);
    return s.trim() ? { en: s } : null;
  }
  return null;
}

/** Which of the spellings a TextRef is. */
export function textKind(ref: TextRef): 'client' | 'relative' | 'literal' {
  if (typeof ref !== 'string') return 'literal';
  if (CLIENT.test(ref)) return 'client';
  if (RELATIVE.test(ref)) return 'relative';
  return 'literal';
}

/** The words of a literal TextRef, or null for a reference. */
export function literalOf(ref: TextRef): string | null {
  if (typeof ref !== 'string') return ref.en;
  return textKind(ref) === 'literal' ? ref : null;
}

/** A client string's table and key, or null. */
export function clientKey(ref: TextRef): { table: string; key: string } | null {
  if (typeof ref !== 'string') return null;
  const m = CLIENT.exec(ref);
  return m ? { table: m[1], key: m[2] } : null;
}

/** A tree-relative string's key, or null. */
export function relativeKey(ref: TextRef): string | null {
  if (typeof ref !== 'string') return null;
  const m = RELATIVE.exec(ref);
  return m ? m[1] : null;
}

/**
 * The words a TextRef stands for: a literal as it is, a reference through `look` (handed the table and
 * the key; a tree-relative one is looked up in the tree's own table, `strings`), and `[…]` when nothing
 * answers. `%TU` and `%NU` are left for whoever shows the words, since only the browser knows the name.
 */
export function textOf(ref: TextRef, look?: (table: string, key: string) => string | null, strings?: string): string {
  const lit = literalOf(ref);
  if (lit !== null) return lit;
  const client = clientKey(ref);
  if (client) return look?.(client.table, client.key) ?? UNRESOLVED;
  const rel = relativeKey(ref);
  if (rel && strings) return look?.(strings, rel) ?? UNRESOLVED;
  return UNRESOLVED;
}

/** Whether a literal text is labelled as test content: every text in the committed test set begins `TEST`. */
export function isTestText(ref: TextRef): boolean {
  const lit = literalOf(ref);
  return lit === null || /^TEST\b/.test(lit.trim());
}
