// A module as it stood at the SOE complete pass's base, read out of git and loaded from a scratch folder, for the
// day-one tests that hold a changed pure function to its own past (the design's ground rule 7: a test that compares
// the new code with itself proves nothing). Its relative imports are pointed at today's tree, so only the one file is
// the old one. Not a test itself. Answers null where git cannot hand the file over (a release, a shallow clone), and
// each test then holds today's function to a hash of the old one's trace written into it instead.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The commit this pass was cut from (perf W1). */
export const PASS_BASE = '4cb694d57d260065341d73ca5214955b59f8051e';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** `rel` (from the repository's root) as it stood at `PASS_BASE`, imported; null where git cannot answer. */
export async function atBase<T>(rel: string): Promise<T | null> {
  let text: string;
  try {
    text = execFileSync('git', ['show', `${PASS_BASE}:${rel}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
  const from = dirname(resolve(REPO, rel));
  const out = text.replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => `from '${pathToFileURL(resolve(from, p)).href}'`);
  const dir = mkdtempSync(join(tmpdir(), 'swg3js-at-base-'));
  const file = join(dir, rel.split('/').pop()!);
  writeFileSync(file, out);
  try {
    return (await import(pathToFileURL(file).href)) as T;
  } finally {
    // Evaluated once imported, so the scratch copy can go: nothing reads the file again.
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A short hash of a trace's text, for the fallback where git cannot answer. */
export function traceHash(values: unknown[]): string {
  return createHash('sha1').update(JSON.stringify(values)).digest('hex').slice(0, 12);
}
