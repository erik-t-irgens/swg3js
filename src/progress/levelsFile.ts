// The game's own challenge table, as the converter wrote it beside the creator's
// (`assets-private/characters/levels.json`), fetched once a session. The fetch is handed in, so nothing here
// touches a page. It never throws into the boot: a file that is not there leaves the fallback bands of ours for
// good, and one that does not read is said once on the console and left out the same way.

import { cleanLevels, levelsProblem, type ConTable } from './challenge.ts';

/** Where the file is, under the build's base. */
export const LEVELS_PATH = 'assets-private/characters/levels.json';

/** What has become of the file: on its way, converted, converted as none (the archives had not got it), absent, or unreadable. */
export type LevelsState = 'idle' | 'loading' | 'converted' | 'none' | 'absent' | 'broken';

export class LevelsFile {
  private table: ConTable | null = null;
  private asked: Promise<void> | null = null;
  state: LevelsState = 'idle';

  /**
   * Fetch it, once: `get` answers the parsed file, or null when there is none. A second call answers the first's
   * promise.
   */
  load(get: () => Promise<unknown>, warn: (line: string) => void = (line) => console.warn(line)): Promise<void> {
    if (this.asked) return this.asked;
    this.state = 'loading';
    this.asked = (async () => {
      let raw: unknown = null;
      try {
        raw = await get();
      } catch {
        raw = null;
      }
      if (raw === null || raw === undefined) {
        this.state = 'absent';
        return;
      }
      const why = levelsProblem(raw);
      if (why === 'none') {
        this.state = 'none';
        return;
      }
      const table = why ? null : cleanLevels(raw);
      if (!table) {
        this.state = 'broken';
        warn(`progress: ${LEVELS_PATH} does not read (${why ?? 'unknown'}); experience is scaled by the fallback bands`);
        return;
      }
      this.table = table;
      this.state = 'converted';
    })();
    return this.asked;
  }

  /** The table, or null until it lands, and for good when there is none. */
  levels(): ConTable | null {
    return this.table;
  }
}
