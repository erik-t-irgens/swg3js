// The challenge table progress reads a fight against: the converter's reader (`tools/swg/conTable.mjs`, run by
// the `customization` command), the game's own reader of the file it writes (`src/progress/challenge.ts`), and
// what `status` says of it.
//
// Every table built here is made up and labelled TEST: the game's own numbers are never written into a committed
// file. When this machine has the converted file (`assets-private/characters/levels.json`, or one under the
// folder `SWG3JS_PACKS` names), its shape is checked and nothing of its numbers is printed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CON_COLUMNS, CON_LEVELS, LEVELS_FILE, conRows, levelsStatus } from '../conTable.mjs';
import { CON_COLUMNS as GAME_COLUMNS, CON_LEVELS as GAME_LEVELS, bandOf, challengeOf, cleanLevels, levelsProblem } from '../../../src/progress/challenge.ts';
import { LEVELS_PATH, LevelsFile } from '../../../src/progress/levelsFile.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

ok(CON_COLUMNS.join() === GAME_COLUMNS.join() && CON_LEVELS === GAME_LEVELS, "the converter's columns and row count are the game's reader's");
ok(LEVELS_PATH === `assets-private/${LEVELS_FILE}`, `the game fetches the very file the converter writes and status reads (${LEVELS_PATH})`);

/** A TEST table in the datatable reader's shape: rows keyed by column. Made-up numbers, not the game's. */
function testTable(rows = CON_LEVELS, edit?: (row: Record<string, number>, i: number) => void): { columns: string[]; rows: Record<string, number>[] } {
  const out: Record<string, number>[] = [];
  for (let i = 0; i < rows; i++) {
    const L = i + 1;
    const row: Record<string, number> = { level: L, grey: Math.max(0, L - 20), green: Math.max(0, L - 15), light_blue: Math.max(0, L - 10), blue: Math.max(0, L - 5), white: L, yellow: L + 1, orange: L + 3, red: L + 5, purple: L + 8 };
    edit?.(row, i);
    out.push(row);
  }
  return { columns: [...CON_COLUMNS], rows: out };
}

// ---- the converter's reader ---------------------------------------------------------------------------------
{
  const good = conRows(testTable());
  ok(good.format === 1 && Array.isArray(good.rows) && good.rows.length === 90 && good.rows.every((r: number[]) => r.length === 10) && good.columns.join() === CON_COLUMNS.join(), 'a TEST table of ninety rows becomes ninety rows of ten numbers, in the columns written down');
  ok(good.rows[0].join() === '1,0,0,0,0,1,2,4,6,9' && good.rows[89][0] === 90, 'each row the level then its bands, in level order');
  const none = conRows(null);
  ok(none.format === 1 && none.rows === null && /not in the archives/.test(none.why), 'a table the archives have not got is written as none, and says why');
  ok(conRows(testTable(89)).rows === null && /89 rows/.test(conRows(testTable(89)).why), 'eighty-nine rows are not the table');
  ok(conRows(testTable(90, (r, i) => i === 40 && (r.orange = r.yellow - 1))).rows === null, 'nor is a row whose bands fall');
  ok(/white/.test(conRows(testTable(90, (r, i) => i === 10 && (r.white = r.level + 1, r.yellow = r.level + 2))).why), 'nor one whose white is not its own level');
  ok(conRows(testTable(90, (r, i) => i === 5 && (r.level = 7))).rows === null, 'nor rows out of level order');
  ok(conRows(testTable(90, (r, i) => i === 3 && (r.red = 4.5))).rows === null, 'nor a number that is not whole');
  ok(conRows({ columns: CON_COLUMNS.filter((c) => c !== 'purple'), rows: [] }).rows === null, 'nor a table without a column');
}

// ---- the game's reader agrees ----------------------------------------------------------------------------------
{
  const good = conRows(testTable());
  ok(cleanLevels(JSON.parse(JSON.stringify(good)))?.rows.length === 90 && levelsProblem(good) === null, "the game's reader takes what the converter writes");
  for (const [what, t] of [
    ['eighty-nine rows', testTable(89)],
    ['a falling row', testTable(90, (r, i) => i === 40 && (r.orange = r.yellow - 1))],
    ['white off its level', testTable(90, (r, i) => i === 10 && (r.white = r.level + 1, r.yellow = r.level + 2))],
  ] as const) {
    const raw = { format: 1, columns: [...CON_COLUMNS], rows: t.rows.map((r) => CON_COLUMNS.map((c) => r[c])) };
    ok(cleanLevels(raw) === null && conRows(t).rows === null, `and both refuse ${what}`);
  }
  ok(cleanLevels(conRows(null)) === null && levelsProblem(conRows(null)) === 'none', 'a file saying the archives had none is no table to the game, and is said to be none');
  ok(cleanLevels({ format: 2, rows: good.rows }) === null, 'nor is one of another format');
  // A band read off the TEST table: each column the lowest level of its band.
  const levels = cleanLevels(good)!;
  ok(bandOf(30, 30, levels) === 'white' && bandOf(31, 30, levels) === 'yellow' && bandOf(9, 30, levels) === 'grey' && bandOf(38, 30, levels) === 'purple' && bandOf(null, 30, levels) === 'white', 'a target is the highest band whose column its level reaches, below grey grey, no level white');
}

// ---- the challenge level, and the bands with no table ------------------------------------------------------------
{
  // The doc's `1 + Skill Points x 89 / 250`, rounded to the nearest and held to 1..90, at points where a slip in
  // either number or the rounding shows: written out, not worked out again.
  const want: [number, number][] = [
    [0, 1],
    [8, 4],
    [12, 5],
    [125, 46],
    [200, 72],
    [249, 90],
    [250, 90],
    [1000, 90],
    [-5, 1],
    [NaN, 1],
  ];
  const off = want.filter(([sp, c]) => challengeOf(sp) !== c).map(([sp, c]) => `${sp} gave ${challengeOf(sp)}, not ${c}`);
  ok(off.length === 0, `the challenge level is 1 + Skill Points x 89 / 250, rounded and held to 1..90${off.length ? `: ${off.join('; ')}` : ''}`);
  // With no table, each band from the lowest gap (target less challenge) that reaches it: every edge either side.
  const edges: [number, string][] = [
    [-40, 'grey'],
    [-11, 'grey'],
    [-10, 'green'],
    [-7, 'green'],
    [-6, 'lightBlue'],
    [-4, 'lightBlue'],
    [-3, 'blue'],
    [-1, 'blue'],
    [0, 'white'],
    [1, 'yellow'],
    [3, 'yellow'],
    [4, 'orange'],
    [6, 'orange'],
    [7, 'red'],
    [9, 'red'],
    [10, 'purple'],
    [60, 'purple'],
  ];
  const wrong = edges.filter(([d, b]) => bandOf(30 + d, 30, null) !== b).map(([d, b]) => `${d} gave ${bandOf(30 + d, 30, null)}, not ${b}`);
  ok(wrong.length === 0, `with no table a target is banded by its gap to the challenge, at every edge either side${wrong.length ? `: ${wrong.join('; ')}` : ''}`);
  ok(bandOf(null, 30, null) === 'white' && bandOf(NaN, 30, null) === 'white', 'and a body with no level counts white');
}

// ---- the game fetching the file: never a throw into the boot ---------------------------------------------------------
{
  const warned: string[] = [];
  const warn = (line: string) => warned.push(line);
  const throws = new LevelsFile();
  await throws.load(async () => {
    throw new Error('TEST: no network');
  }, warn);
  ok(throws.state === 'absent' && throws.levels() === null, 'a fetch that throws leaves the fallback bands, the file read as absent');
  const missing = new LevelsFile();
  await missing.load(async () => null, warn);
  ok(missing.state === 'absent' && missing.levels() === null, 'and so does a file that is not there');
  const none = new LevelsFile();
  await none.load(async () => conRows(null), warn);
  ok(none.state === 'none' && none.levels() === null && warned.length === 0, 'a file saying the archives had none is none, and nothing is said of it');
  const broken = new LevelsFile();
  await broken.load(async () => ({ format: 1, rows: [[1, 2]] }), warn);
  ok(broken.state === 'broken' && broken.levels() === null && warned.length === 1 && warned[0].includes(LEVELS_PATH), 'a file that does not read is left out and said once on the console');
  const good = new LevelsFile();
  let fetched = 0;
  const get = async () => {
    fetched++;
    return JSON.parse(JSON.stringify(conRows(testTable())));
  };
  const first = good.load(get, warn);
  const second = good.load(get, warn);
  await first;
  ok(first === second && fetched === 1 && good.state === 'converted' && good.levels()?.rows.length === CON_LEVELS && warned.length === 1, 'a whole one is fetched once, however often it is asked for, and read');
}

// ---- status ------------------------------------------------------------------------------------------------
{
  const good = conRows(testTable());
  ok(levelsStatus(null).why !== null && /no challenge table/.test(levelsStatus(null).why), 'status asks for a missing file');
  ok(levelsStatus({ ...good, format: 0 }).why !== null, 'and for one of another format');
  ok(levelsStatus(conRows(null)).why === null, 'never for one saying the archives had none');
  ok(levelsStatus(good).why === null && /90 levels/.test(levelsStatus(good).line), 'and nothing for a whole one');
  ok(levelsStatus({ format: 1, rows: [[1, 2]] }).why !== null, 'a file whose rows are not the table is asked for again');
  const dir = mkdtempSync(join(tmpdir(), 'swg3js-contable-status-'));
  try {
    const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
    const asks = (): boolean => {
      const run = spawnSync(process.execPath, [cli, 'status', dir], { encoding: 'utf8', maxBuffer: 16 * 1048576 });
      return /swg -- customization /.test(run.stdout ?? '');
    };
    ok(asks(), 'status itself asks for customization over a folder with nothing in it: the check stands outside the species gate');
    mkdirSync(join(dir, 'characters'), { recursive: true });
    writeFileSync(join(dir, ...LEVELS_FILE.split('/')), JSON.stringify(conRows(null)));
    ok(!asks(), 'and asks nothing of it once the file says the archives had none');
    writeFileSync(join(dir, ...LEVELS_FILE.split('/')), JSON.stringify(good));
    ok(!asks(), 'nor once a whole one is there');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- the converted file on this machine, by its shape only ----------------------------------------------------------
{
  const packs = process.env.SWG3JS_PACKS || fileURLToPath(new URL('../../../assets-private/', import.meta.url));
  const file = join(packs, ...LEVELS_FILE.split('/'));
  if (!existsSync(file)) note(`no converted challenge table at ${file}, so its shape is not checked here`);
  else {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    if (json.rows === null) note(`the converted file says the archives had no table (${json.why})`);
    else {
      ok(cleanLevels(json) !== null && levelsStatus(json).why === null, "the converted table reads: ninety rows of ten whole numbers, rising, white each row's own level (its numbers are not printed)");
      const rising = json.rows.every((r: number[]) => r.slice(1).every((v: number, i: number, a: number[]) => i === 0 || v >= a[i - 1]));
      ok(rising && json.rows.every((r: number[], i: number) => r[0] === i + 1 && r[5] === r[0]), 'every row in level order, its bands rising and its white its own level');
    }
  }
}

console.log(`\n${checks} checks passed`);
