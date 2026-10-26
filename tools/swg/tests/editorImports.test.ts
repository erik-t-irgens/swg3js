// The world editor is the dev server's alone (DESIGN.md §2.0 rule 1): a build carries none of it because nothing it ships
// imports `src/editor/` statically, and the game reaches the editor through exactly one dynamic `import()`, inside
// `import.meta.env.DEV`. A scan of every import under `src/` holds both, the editor's own interface files with them (a
// shipped file importing one of those would carry the editor in through it).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, relative, sep } from 'node:path';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const src = join(root, 'src');
const files = (readdirSync(src, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).map((f) => join(src, f));
const rel = (p: string) => relative(root, p).split(sep).join('/');

/** The editor's own interface files: they may import the editor, and nothing shipped may import them. */
const EDITOR_UI = new Set(['src/ui/editorWindow.ts', 'src/ui/libraryUi.ts', 'src/ui/editorBar.ts', 'src/ui/editorMarks.ts']);
const isEditor = (r: string) => r.startsWith('src/editor/') || EDITOR_UI.has(r);

/** Where a specifier points, as a path from the root, or null for a package. */
function target(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  let p = rel(normalize(join(dirname(from), spec)));
  if (!p.endsWith('.ts')) p += '.ts';
  return p;
}

const strays: string[] = [];
const dynamic: { file: string; at: number }[] = [];
let scanned = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  const me = rel(f);
  scanned++;
  // Static imports and re-exports, type-only ones included: a type import is erased, but none is needed and the scan
  // stays one rule.
  for (const m of text.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+['"]([^'"]+)['"]/gm)) {
    const t = target(f, m[1]);
    if (t && isEditor(t) && !isEditor(me)) strays.push(`${me} -> ${t}`);
  }
  for (const m of text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
    const t = target(f, m[1]);
    if (t && isEditor(t) && !isEditor(me)) strays.push(`${me} -> ${t}`);
  }
  // Dynamic imports and type positions alike: any `import('…')` that points into the editor.
  for (const m of text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const t = target(f, m[1]);
    if (t && isEditor(t) && !isEditor(me)) dynamic.push({ file: me, at: m.index ?? 0 });
  }
}

ok(scanned > 500, `every file under src/ is read (${scanned})`);
ok(strays.length === 0, `no shipped file imports the editor or its interface files statically${strays.length ? `: ${strays.join('; ')}` : ''}`);
ok(dynamic.length === 1 && dynamic[0].file === 'src/main.ts', `exactly one dynamic import() reaches the editor, in main.ts (${dynamic.map((d) => d.file).join(', ') || 'none'})`);
{
  const main = readFileSync(join(src, 'main.ts'), 'utf8').replace(/\r\n/g, '\n');
  const at = dynamic[0]?.at ?? -1;
  const method = main.lastIndexOf('  private loadEditor(): Promise<EditorApi | null> {', at);
  const body = main.slice(method, at);
  ok(method > 0 && at - method < 600 && /if \(!import\.meta\.env\.DEV\) return Promise\.resolve\(null\);/.test(body), 'and it sits behind import.meta.env.DEV, the first line of the one method that makes it');
  ok(/import\('\.\/editor\/editorEntry\.ts'\)/.test(main.slice(at, at + 60)), 'it imports the editor\'s one entry');
  ok(!/from '\.\/editor\//.test(main), 'main.ts declares the editor\'s port for itself (`EditorApi`), importing nothing of the folder for its type');
}

console.log(`\n${checks} checks passed`);
