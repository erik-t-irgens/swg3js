// What the server reads of the converted content for progress: the game's own challenge table, which the
// `customization` command converts on the owner's machine into `<assets>/characters/levels.json` beside the
// creator's table. Read once on start through the very cleaner the browser reads it with (`cleanLevels`), so the
// two hosts band a fight against the same table. With none -- no converted content named, a table the archives
// had not got, a file that will not read -- every fight is banded by the fallback of ours, which the start says.
//
// It ships with the release by the server's own rule, and what it imports of `src/progress/` by that folder's.
// Imports nothing but node's built-ins and the rules.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanLevels, levelsProblem } from '../src/progress/challenge.ts';

/** Where the table is under the converted content: the browser fetches the same file (`LEVELS_PATH`). */
export const LEVELS_FILE = join('characters', 'levels.json');

/**
 * The challenge table under a folder of converted content: `levels` the table, or null; `state` what became of
 * the file (`converted`, `none` when the archives had none, `absent`, `broken`); and the words the start says.
 */
export function readLevels(assets) {
  if (!assets) return { levels: null, state: 'absent', line: 'no converted content was named, so fights are banded by the fallback of ours' };
  const file = join(assets, LEVELS_FILE);
  if (!existsSync(file)) return { levels: null, state: 'absent', line: `${file} is not there, so fights are banded by the fallback of ours until the customization command converts it` };
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { levels: null, state: 'broken', line: `${file} could not be read (${err instanceof Error ? err.message : String(err)}), so fights are banded by the fallback of ours` };
  }
  const why = levelsProblem(raw);
  if (why === 'none') return { levels: null, state: 'none', line: 'the archives had no challenge table, so fights are banded by the fallback of ours' };
  const levels = why ? null : cleanLevels(raw);
  if (!levels) return { levels: null, state: 'broken', line: `${file} does not read (${why ?? 'unknown'}), so fights are banded by the fallback of ours` };
  return { levels, state: 'converted', line: `fights are banded on the game's own challenge table (${levels.rows.length} levels)` };
}
