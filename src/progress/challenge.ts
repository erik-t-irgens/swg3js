// How hard a fight was for this character: its challenge level against the game's own 90-level table, the way
// the owner's doc fixes it, `1 + Skill Points spent x 89 / 250` (rounded to the nearest and held to 1..90, ours),
// and the band a target's level falls in against it.
//
// **The table** is `datatables/player/level_con_table.iff` [game], converted on the owner's machine by the
// `customization` command into `assets-private/characters/levels.json` and never committed: ninety rows, one a
// challenge level, each the level itself and then nine numbers, the lowest target level of each band from grey
// to purple (a reading of ours: on every row white is exactly the row's own level, which is what the reading
// asks of it). A target's band is the highest column its level reaches; below grey's it is grey. Its colours
// (`con_display_data.iff`) are the client's interface and are never read.
//
// **With no table** the band is worked out from the gap between the target's level and the challenge, by
// `PROGRESS_RULES.gaps` [ours], read the same way: each band's lowest gap. A body with no level counts as the
// character's own challenge, which is white [ours]. Pure, its own folder.

import { PROGRESS_RULES, type ProgressRules } from './tune.ts';

/** The bands, lowest first, as the table's columns run. */
export const BANDS = ['grey', 'green', 'lightBlue', 'blue', 'white', 'yellow', 'orange', 'red', 'purple'] as const;
export type Band = (typeof BANDS)[number];

/** The table's own columns, as the converter writes them: the level, then each band's lowest level. */
export const CON_COLUMNS = ['level', 'grey', 'green', 'light_blue', 'blue', 'white', 'yellow', 'orange', 'red', 'purple'] as const;

/** How many rows the game's table has: one a challenge level. */
export const CON_LEVELS = 90;

/** The converted table, cleaned: row `i` is challenge `i + 1`, its level then its nine bands' lowest levels. */
export interface ConTable {
  rows: number[][];
}

/** The challenge level some Skill Points spent give. */
export function challengeOf(spSpent: number): number {
  const sp = Number.isFinite(spSpent) ? Math.max(0, spSpent) : 0;
  return Math.max(1, Math.min(CON_LEVELS, Math.round(1 + (sp * 89) / 250)));
}

/** What is wrong with a converted table, or null when it reads; `none` when the archives had not got one. */
export function levelsProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'not a table';
  const o = raw as Record<string, unknown>;
  if (o.format !== 1) return `format ${String(o.format)}, not 1`;
  if (o.rows === null) return 'none';
  if (o.columns !== undefined && (!Array.isArray(o.columns) || o.columns.join() !== CON_COLUMNS.join())) return 'its columns are not the challenge table’s';
  if (!Array.isArray(o.rows) || o.rows.length !== CON_LEVELS) return `${Array.isArray(o.rows) ? o.rows.length : 'no'} rows, not ${CON_LEVELS}`;
  for (let i = 0; i < o.rows.length; i++) {
    const r = o.rows[i] as unknown;
    if (!Array.isArray(r) || r.length !== CON_COLUMNS.length || !r.every((v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10000)) return `row ${i + 1} is not ten whole numbers`;
    if (r[0] !== i + 1) return `row ${i + 1} is level ${r[0]}`;
    for (let c = 2; c < r.length; c++) if (r[c] < r[c - 1]) return `row ${i + 1} falls from ${CON_COLUMNS[c - 1]} to ${CON_COLUMNS[c]}`;
    if (r[5] !== r[0]) return `row ${i + 1}: white is ${r[5]}, not its own level`;
  }
  return null;
}

/** The converted table, cleaned, or null when there is none or it does not read. */
export function cleanLevels(raw: unknown): ConTable | null {
  if (levelsProblem(raw) !== null) return null;
  return { rows: ((raw as { rows: number[][] }).rows).map((r) => [...r]) };
}

/**
 * The band a target of some level falls in against a challenge level: from the table where there is one, else
 * from the gap between the two. A target with no level counts white.
 */
export function bandOf(target: number | null, challenge: number, levels: ConTable | null, rules: ProgressRules = PROGRESS_RULES): Band {
  if (target === null || !Number.isFinite(target)) return 'white';
  if (levels) {
    const row = levels.rows[Math.max(1, Math.min(CON_LEVELS, Math.round(challenge))) - 1];
    let band: Band = 'grey';
    for (let c = 0; c < BANDS.length; c++) if (target >= row[c + 1]) band = BANDS[c];
    return band;
  }
  const d = target - challenge;
  let band: Band = 'grey';
  for (const b of BANDS) if (b !== 'grey' && d >= rules.gaps[b as Exclude<Band, 'grey'>]) band = b;
  return band;
}
