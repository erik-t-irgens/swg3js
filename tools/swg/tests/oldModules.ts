// Map-maker II's day-one loader: modules as they stood at a commit (the pass's start, e6c2578) loaded out of git beside
// today's, so a test holds today's code to the old code itself rather than to a copy of today's with a change taken out.
// Each named file is written into a temporary folder from `git show <commit>:<file>` (line endings folded to LF), every
// relative import among the named files pointed at its old copy, every other relative import at today's file, and
// `three` at the very three this test runs on (a copy outside the repository cannot find the package by name). Answers the
// entry's module, or null where git cannot hand the old files over (a checkout with no history). Not a test itself.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PRE_PASS = 'e6c2578';
export const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

/** Each named file's text at a commit, LF, or null where git cannot give one. */
export function oldTexts(files: readonly string[], commit = PRE_PASS): Map<string, string> | null {
  const texts = new Map<string, string>();
  try {
    for (const f of files) texts.set(f, execFileSync('git', ['show', `${commit}:${f}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 27, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n'));
  } catch {
    return null;
  }
  return texts;
}

/**
 * The named files as they stood at `commit`, written side by side (under their own folders, so two files of one name
 * keep apart) and the entry's module imported. Every relative import of a named file to another named file goes to the old
 * copy; every other goes to today's file. The folder is taken away once the module is in.
 */
export async function loadOld<T = Record<string, unknown>>(files: readonly string[], entry: string, commit = PRE_PASS): Promise<T | null> {
  const texts = oldTexts(files, commit);
  if (!texts) return null;
  const dir = mkdtempSync(join(tmpdir(), 'mm2-old-'));
  const three = import.meta.resolve('three');
  const where = (f: string) => join(dir, f.replace(/\//g, '__'));
  try {
    for (const f of files) {
      const from = resolve(REPO, f, '..');
      const text = texts.get(f)!.replace(/from 'three'/g, `from '${three}'`).replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => {
        const target = resolve(from, p).replace(/\\/g, '/');
        const own = files.find((x) => resolve(REPO, x).replace(/\\/g, '/') === target || resolve(REPO, x).replace(/\\/g, '/') === `${target}.ts`);
        return `from '${own ? pathToFileURL(where(own)).href : pathToFileURL(resolve(from, /\.[a-z]+$/.test(p) ? p : `${p}.ts`)).href}'`;
      });
      writeFileSync(where(f), text);
    }
    return (await import(pathToFileURL(where(entry)).href)) as T;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `loadOld` with several entries out of one load (so they share their old modules): each entry's module, in order. */
export async function loadOldMany(files: readonly string[], entries: readonly string[], commit = PRE_PASS): Promise<Record<string, unknown>[] | null> {
  const texts = oldTexts(files, commit);
  if (!texts) return null;
  const dir = mkdtempSync(join(tmpdir(), 'mm2-old-'));
  const three = import.meta.resolve('three');
  const where = (f: string) => join(dir, f.replace(/\//g, '__'));
  try {
    for (const f of files) {
      const from = resolve(REPO, f, '..');
      const text = texts.get(f)!.replace(/from 'three'/g, `from '${three}'`).replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => {
        const target = resolve(from, p).replace(/\\/g, '/');
        const own = files.find((x) => resolve(REPO, x).replace(/\\/g, '/') === target || resolve(REPO, x).replace(/\\/g, '/') === `${target}.ts`);
        return `from '${own ? pathToFileURL(where(own)).href : pathToFileURL(resolve(from, /\.[a-z]+$/.test(p) ? p : `${p}.ts`)).href}'`;
      });
      writeFileSync(where(f), text);
    }
    const out: Record<string, unknown>[] = [];
    for (const e of entries) out.push((await import(pathToFileURL(where(e)).href)) as Record<string, unknown>);
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
