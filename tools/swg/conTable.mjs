// The game's own challenge table, `datatables/player/level_con_table.iff`, as progress reads it: ninety rows,
// one a player level, each the level and then the lowest target level of each band from grey to purple. Read
// by the `customization` command (it is a small retail table beside the creator's own) and written as
// `<out>/characters/levels.json`, which is never committed. Its colours, `con_display_data.iff`, are the
// client's interface and are never read.
//
// What the file must be is checked here before it is written: ninety rows in level order, ten whole numbers each,
// the bands rising left to right, and white exactly the row's own level (the reading of the columns as each
// band's lowest level rests on that). A table the archives have not got, or one that does not read so, is
// written as `rows: null` with the reason, so `status` stops asking for it and the game uses its fallback bands.

/** Where the file is written, under the out-dir. */
export const LEVELS_FILE = 'characters/levels.json';

/** The table it is read from. */
export const LEVELS_SOURCE = 'datatables/player/level_con_table.iff';

/** The table's own columns, in the order a row is written. */
export const CON_COLUMNS = ['level', 'grey', 'green', 'light_blue', 'blue', 'white', 'yellow', 'orange', 'red', 'purple'];

/** How many rows it has: one a player level. */
export const CON_LEVELS = 90;

/** What `status` asks for the file again under. */
export const LEVELS_FORMAT = 1;

/**
 * A parsed datatable (`{ columns, rows }`, rows keyed by column) made into the file progress reads, or a file
 * saying there is none and why: null for a table the archives have not got.
 */
export function conRows(table) {
  const none = (why) => ({ format: LEVELS_FORMAT, source: LEVELS_SOURCE, rows: null, why });
  if (!table) return none('not in the archives');
  const missing = CON_COLUMNS.filter((c) => !(table.columns ?? []).includes(c));
  if (missing.length) return none(`no ${missing.join(', ')} column${missing.length === 1 ? '' : 's'}`);
  const src = table.rows ?? [];
  if (src.length !== CON_LEVELS) return none(`${src.length} rows, not ${CON_LEVELS}`);
  const rows = [];
  for (let i = 0; i < src.length; i++) {
    const row = CON_COLUMNS.map((c) => src[i][c]);
    if (!row.every((v) => typeof v === 'number' && Number.isInteger(v) && v >= 0)) return none(`row ${i + 1} is not ten whole numbers`);
    if (row[0] !== i + 1) return none(`row ${i + 1} is level ${row[0]}`);
    for (let c = 2; c < row.length; c++) if (row[c] < row[c - 1]) return none(`row ${i + 1} falls from ${CON_COLUMNS[c - 1]} to ${CON_COLUMNS[c]}`);
    if (row[5] !== row[0]) return none(`row ${i + 1}: white is ${row[5]}, not its own level`);
    rows.push(row);
  }
  return { format: LEVELS_FORMAT, source: LEVELS_SOURCE, columns: [...CON_COLUMNS], rows };
}

/**
 * What `status` says of the file: a line for the report, and the reason to convert it again (null when it is in
 * order). It is asked for again only when it is missing or not of this format -- which a file whose rows do not
 * read as the table is not, in substance -- and never when it says the archives had none.
 */
export function levelsStatus(json) {
  const why = 'no challenge table (characters/levels.json): experience is scaled by a fallback of ours until it is converted';
  if (!json || typeof json !== 'object') return { line: 'challenge table: none', why };
  if (json.format !== LEVELS_FORMAT) return { line: `challenge table: format ${json.format ?? 0}`, why };
  if (json.rows === null) return { line: `challenge table: none in the archives (${json.why ?? 'not read'}); the fallback bands`, why: null };
  const rows = Array.isArray(json.rows) ? json.rows : [];
  const shaped = rows.length === CON_LEVELS && rows.every((r, i) => Array.isArray(r) && r.length === CON_COLUMNS.length && r[0] === i + 1 && r[5] === r[0]);
  if (!shaped) return { line: `challenge table: ${rows.length} rows that do not read`, why };
  return { line: `challenge table: ${rows.length} levels (format ${json.format})`, why: null };
}
