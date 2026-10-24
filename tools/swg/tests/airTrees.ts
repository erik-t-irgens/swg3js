// The commit before the volumetrics pass, `src/` and all, written out of git into a folder of its own, for the off-proof
// (`airOff.test.ts`, the design's §4.0): every import of an old module then resolves inside the old tree, and nothing of
// one tree ever reaches the other. Read with `git ls-tree` and one `git cat-file --batch`, so no archive tool is asked
// (the shell's `tar` takes a Windows path for a remote host).
//
// It fails loudly when git cannot answer: a proof against "today" with no "today" in it proves nothing, so it never
// quietly skips.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The commit the volumetrics pass was cut from: "today", for every proof that off is today's game. */
export const PRE_PASS = 'fc3c588';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** One file of the commit before the pass, as text with its line endings folded to LF; throws when git cannot answer. */
export function showOld(path: string): string {
  return execFileSync('git', ['-C', REPO, 'show', `${PRE_PASS}:${path}`], { encoding: 'utf8', maxBuffer: 1 << 28 }).replace(/\r\n/g, '\n');
}

/**
 * Write every file under `src/` at the commit before the pass into a fresh temporary folder, and answer the folder that
 * holds its `src`. Throws when git cannot answer.
 */
export function extractOldSrc(): string {
  const root = mkdtempSync(join(tmpdir(), 'swg3js-airoff-'));
  const names = execFileSync('git', ['-C', REPO, 'ls-tree', '-r', '--name-only', PRE_PASS, 'src'], { encoding: 'utf8', maxBuffer: 1 << 26 })
    .split(/\r?\n/)
    .filter((n) => n.length > 0);
  if (!names.length) throw new Error(`git listed no files under src at ${PRE_PASS}`);
  const batch = execFileSync('git', ['-C', REPO, 'cat-file', '--batch'], { input: names.map((n) => `${PRE_PASS}:${n}`).join('\n') + '\n', maxBuffer: 1 << 30 });
  // Each answer is "<sha> <type> <size>\n<size bytes>\n".
  let at = 0;
  for (const name of names) {
    const nl = batch.indexOf(10, at);
    const head = batch.subarray(at, nl).toString('utf8');
    const parts = head.split(' ');
    if (parts[1] === 'missing' || parts.length < 3) throw new Error(`git could not answer ${name}: ${head}`);
    const size = Number(parts[2]);
    const body = batch.subarray(nl + 1, nl + 1 + size);
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
    at = nl + 1 + size + 1;
  }
  return join(root, 'src');
}
