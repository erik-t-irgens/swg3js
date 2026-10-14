// Progress's rules are one rule book with two hosts, as the story's are: the browser runs `src/progress/` as it
// is, and the server imports the very same files under node's type stripping. And the whole folder ships with
// the release by one rule (`PROGRESS_SOURCE` in `tools/launcher/pack.mjs`), which refuses a shipped file that names
// a file it does not ship -- so this browser's own client, store and levels reader, which live in the folder too,
// must import nothing outside it either. That only holds while every file stays importable by both, which this
// pins by reading their text (the checks of `storyImports.test.ts`):
//
//   - every import names a file inside `src/progress/` or the one file outside it the rules may use,
//     `src/net/hash.ts`, and carries its `.ts` extension (node does not guess one);
//   - nothing in the folder uses what node's type stripping cannot erase: an enum, a namespace, or a
//     constructor parameter property;
//   - no file in the folder uses anything of a page (the document, the window, browser storage, a frame
//     callback), nor `import.meta`, which only the bundler understands: what a file needs of the game is handed in;
//   - the server's own progress modules import nothing but node's built-ins and the rules, and restate no rule.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROGRESS_RULES } from '../../../src/progress/tune.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PROGRESS = join(ROOT, 'src', 'progress');
const HASH = join(ROOT, 'src', 'net', 'hash.ts');
const rel = (p: string) => relative(ROOT, p).split(sep).join('/');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** The text with comments and string contents blanked, so a word in a comment or a message is not code. */
function codeOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""');
}

/** Every module a file names: imports, re-exports and dynamic imports. */
function specifiers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/gm)) out.push(m[1]);
  for (const m of text.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) out.push(m[1]);
  for (const m of text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

const files = walk(PROGRESS);
ok(files.length >= 10 && files.some((f) => f.endsWith('record.ts')) && files.some((f) => f.endsWith('progressClient.ts')), `the rules' folder holds its files, this browser's own client among them (${files.length})`);

// ---- every import inside the folder or the hashing, with its extension -----------------------------------
{
  const bad: string[] = [];
  for (const f of files) {
    for (const s of specifiers(readFileSync(f, 'utf8'))) {
      const target = resolve(dirname(f), s);
      const inside = target.startsWith(PROGRESS + sep) || target === HASH;
      if (!s.startsWith('.') || !s.endsWith('.ts') || !inside) bad.push(`${rel(f)}: ${s}`);
    }
  }
  ok(bad.length === 0, `src/progress imports only its own folder and src/net/hash.ts, each with its .ts extension${bad.length ? ` (${bad.join(', ')})` : ''}`);
}

// ---- nothing node's type stripping cannot erase ---------------------------------------------------------
{
  const bad: string[] = [];
  for (const f of files) {
    const code = codeOf(readFileSync(f, 'utf8'));
    if (/\benum\s+[A-Z_a-z]\w*\s*\{/.test(code)) bad.push(`${rel(f)}: an enum`);
    if (/\bnamespace\s+\w+\s*\{/.test(code)) bad.push(`${rel(f)}: a namespace`);
    if (/constructor\s*\([^)]*\b(public|private|protected|readonly)\s+\w+/.test(code)) bad.push(`${rel(f)}: a constructor parameter property`);
  }
  ok(bad.length === 0, `no enum, namespace or constructor parameter property anywhere in src/progress${bad.length ? ` (${bad.join(', ')})` : ''}`);
}

// ---- nothing of a page, anywhere in the folder ------------------------------------------------------------
{
  const PAGE = /\b(document|window|navigator)\s*\.|\b(localStorage|sessionStorage|indexedDB|requestAnimationFrame|HTMLElement|fetch)\b|import\.meta/;
  const bad = files.filter((f) => PAGE.test(codeOf(readFileSync(f, 'utf8')))).map(rel);
  ok(bad.length === 0, `and no file of it uses anything of a page or the bundler: its storage and its fetch are handed in${bad.length ? ` (${bad.join(', ')})` : ''}`);
}

// ---- the server's own progress modules ---------------------------------------------------------------------------
{
  const mods = ['progress.mjs', 'progressData.mjs'].map((n) => join(ROOT, 'server', n));
  ok(mods.every((f) => existsSync(f)), 'the server holds progress: both its modules are there');
  const bad: string[] = [];
  let named = 0;
  for (const f of mods) {
    for (const s of specifiers(readFileSync(f, 'utf8'))) {
      if (s.startsWith('node:')) continue;
      named++;
      const target = resolve(dirname(f), s);
      if (!s.startsWith('.') || !target.startsWith(PROGRESS + sep) || !s.endsWith('.ts')) bad.push(`${rel(f)}: ${s}`);
    }
  }
  ok(named > 0 && bad.length === 0, `the server's progress modules import only node's built-ins and the rules (${named} imports of the rules)${bad.length ? ` (${bad.join(', ')})` : ''}`);
  // No rule of progress restated on the server: every number it pays by is its own copy of the rules' (`copyRules`).
  // Every name the rules give a number -- the top level and every nested table, read off the rules themselves so a
  // rule added later is held too -- is refused as an object's key with a number written after it, in either module.
  const host = codeOf(readFileSync(mods[0], 'utf8'));
  const ruleNames = new Set<string>();
  const gather = (o: Record<string, unknown>): void => {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object') gather(v as Record<string, unknown>);
      else if (typeof v === 'number') ruleNames.add(k);
    }
  };
  gather(PROGRESS_RULES as unknown as Record<string, unknown>);
  const restated: string[] = [];
  for (const f of mods) {
    for (const m of codeOf(readFileSync(f, 'utf8')).matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*:\s*-?\.?\d/g)) if (ruleNames.has(m[1])) restated.push(`${rel(f)}: ${m[1]}`);
  }
  ok(ruleNames.size > 40 && ruleNames.has('xpRate') && ruleNames.has('bankCap') && ruleNames.has('grey') && ruleNames.has('steadyArm'), `the rules' own names are read off the rules, nested tables and all (${ruleNames.size})`);
  ok(/copyRules\(\)/.test(host) && restated.length === 0, `and the server keeps no number of a rule of its own beyond its copy of the rules${restated.length ? ` (${restated.join(', ')})` : ''}`);
  // The check itself: a rule restated in the tuning, as a server's own number would be, is what it refuses.
  const planted = codeOf(readFileSync(mods[0], 'utf8').replace('wordRate: 6,', 'wordRate: 6,\n  xpRate: 1,\n  bankCap: 5000,'));
  const caught = [...planted.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*:\s*-?\.?\d/g)].filter((m) => ruleNames.has(m[1])).map((m) => m[1]);
  ok(caught.join() === 'xpRate,bankCap', `and it would catch one: a rate and a cap planted in the server's tuning are both refused (${caught.join(', ')})`);
}
// ---- the wire and its cleaners are the folder's --------------------------------------------------------------------
ok(files.some((f) => f.endsWith('wire.ts')), 'the words of progress on the wire are cleaned by a file of the folder, which both hosts run');

console.log(`\n${checks} checks passed`);
