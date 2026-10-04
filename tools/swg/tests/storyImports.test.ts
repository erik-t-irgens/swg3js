// The story's one rule book has two hosts: the browser runs `src/story/` as it is, and the server imports
// the very same files under node's type stripping (`server/stories.mjs`, `server/storySet.mjs`). That only
// holds while those files stay importable by both, which this pins by reading their text:
//
//   - every import names a file inside `src/story/` or the one file outside it the rules may use,
//     `src/net/hash.ts`, and carries its `.ts` extension (node does not guess one);
//   - nothing in the folder uses what node's type stripping cannot erase: an enum, a namespace, or a
//     constructor parameter property;
//   - every file the server reaches, and the checker and the host loop, uses nothing of a page (the
//     document, the window, browser storage, a frame callback) and nothing of `import.meta.glob`, which only
//     the bundler understands;
//   - the server's own story modules import nothing but node's built-ins and the rules.
//
// A display file that grows an import of its own takes down whichever suite reaches it while
// `npx tsc --noEmit -p .` stays clean, which is why this is checked by reading rather than trusted.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const STORY = join(ROOT, 'src', 'story');
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

const files = walk(STORY);
ok(files.length >= 15, `the rules' folder holds its files (${files.length})`);

// ---- every import inside the folder or the hashing, with its extension -----------------------------------
{
  const bad: string[] = [];
  for (const f of files) {
    for (const s of specifiers(readFileSync(f, 'utf8'))) {
      const target = resolve(dirname(f), s);
      const inside = target.startsWith(STORY + sep) || target === HASH;
      if (!s.startsWith('.') || !s.endsWith('.ts') || !inside) bad.push(`${rel(f)}: ${s}`);
    }
  }
  ok(bad.length === 0, `src/story imports only its own folder and src/net/hash.ts, each with its .ts extension${bad.length ? ` (${bad.join(', ')})` : ''}`);
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
  ok(bad.length === 0, `no enum, namespace or constructor parameter property anywhere in src/story${bad.length ? ` (${bad.join(', ')})` : ''}`);
}

// ---- what the server reaches touches nothing of a page ---------------------------------------------------
{
  const roots = [join(ROOT, 'server', 'stories.mjs'), join(ROOT, 'server', 'storySet.mjs'), join(STORY, 'hostCore.ts'), join(STORY, 'check.ts')];
  const reached = new Set<string>();
  const todo = [...roots];
  while (todo.length) {
    const f = todo.pop()!;
    if (reached.has(f)) continue;
    reached.add(f);
    for (const s of specifiers(readFileSync(f, 'utf8'))) if (s.startsWith('.')) todo.push(resolve(dirname(f), s));
  }
  const rules = [...reached].filter((f) => f.startsWith(STORY + sep) || f === HASH);
  ok(rules.length >= 12 && rules.includes(join(STORY, 'quests.ts')) && rules.includes(join(STORY, 'book.ts')), `the server and the checker reach the rules (${rules.length} files: ${rules.map(rel).join(', ')})`);
  // `document` and `window` as objects used (`document.`), since a step type is called `document`.
  const PAGE = /\b(document|window|navigator)\s*\.|\b(localStorage|sessionStorage|indexedDB|requestAnimationFrame|HTMLElement)\b|import\.meta\.glob/;
  const bad = rules.filter((f) => PAGE.test(codeOf(readFileSync(f, 'utf8')))).map(rel);
  ok(bad.length === 0, `and none of those uses anything of a page${bad.length ? ` (${bad.join(', ')})` : ''}`);
  ok(!rules.some((f) => /bookClient|storyStore/.test(f)), 'the browser\'s own story files (its copy of the book and where it keeps it) are not among them');
}

// ---- the server's own story modules ------------------------------------------------------------------------
{
  const bad: string[] = [];
  for (const name of ['stories.mjs', 'storySet.mjs']) {
    const f = join(ROOT, 'server', name);
    for (const s of specifiers(readFileSync(f, 'utf8'))) {
      if (s.startsWith('node:')) continue;
      const target = resolve(dirname(f), s);
      if (!s.startsWith('.') || !target.startsWith(STORY + sep) || !s.endsWith('.ts')) bad.push(`${name}: ${s}`);
    }
  }
  ok(bad.length === 0, `the server's story modules import only node's built-ins and the rules${bad.length ? ` (${bad.join(', ')})` : ''}`);
  const cli = readFileSync(join(ROOT, 'tools', 'story', 'check.mjs'), 'utf8');
  ok(/from '\.\.\/\.\.\/server\/storySet\.mjs'/.test(cli) && /from '\.\.\/\.\.\/src\/story\/check\.ts'/.test(cli), 'and npm run story:check reads a folder the way the server does and checks it with the rules themselves');
}

console.log(`\n${checks} checks passed`);
