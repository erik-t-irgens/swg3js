// A player ship's chassis tables, read without the archives (every table is handed in parsed).
//
// datatables/space/ship_chassis.iff has a row per chassis (player_<ship>): its name, sounds, the
// wing_open_speed_factor and a cell per component slot. datatables/space/ship_chassis_<chassis>.iff
// is that hull's looks table: a row per component, a `component` column, then one column per slot
// that shows a model, each cell a comma list of `attachment:hardpoint` (an empty hardpoint is the
// hull's origin; the attachment is a template object/tangible/ship/attachment/**/shared_<attachment>.iff).

/** Chassis rows the template's own name does not match. */
export const CHASSIS_ALIASES = { player_corellian_corvette: 'player_corvette' };

/**
 * The chassis row and looks table for a player template's base name (shared_ and .iff dropped),
 * or null: the name itself, else without a `_decorated_NN` suffix, else an alias, each only when
 * `has(name)` says the chassis table has that row.
 */
export function chassisNameFor(base, has) {
  if (!base) return null;
  if (has(base)) return base;
  const plain = base.replace(/_decorated_\d+$/, '');
  if (plain !== base && has(plain)) return plain;
  const alias = CHASSIS_ALIASES[base];
  if (alias && has(alias)) return alias;
  return null;
}

/** A looks-table cell's parts: [{ attachment, hardpoint }] (hardpoint '' when absent); an empty cell gives []. */
export function parseLookCell(cell) {
  return String(cell ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const at = p.indexOf(':');
      return at < 0 ? { attachment: p, hardpoint: '' } : { attachment: p.slice(0, at).trim(), hardpoint: p.slice(at + 1).trim() };
    })
    .filter((p) => p.attachment);
}

/** Slot columns the stock pick leaves out: a modification is one reward look, never the ship as sold. */
export const STOCK_LEFT_OUT = /^modification_/;

/**
 * The stock parts of a hull, from its looks table ({ columns, rows }): for every slot column (every
 * column after the first, the component's name) not matching STOCK_LEFT_OUT, the non-empty cell the
 * most rows show (ties to the first seen), as { slot, pairs } in column order. A column with no
 * non-empty cell is left out.
 */
export function modalLooks(table) {
  const out = [];
  if (!table?.columns?.length) return out;
  for (const [i, slot] of table.columns.entries()) {
    if (i === 0 || STOCK_LEFT_OUT.test(slot)) continue;
    const counts = new Map();
    for (const row of table.rows ?? []) {
      const cell = String(row[slot] ?? '').trim();
      if (cell) counts.set(cell, (counts.get(cell) ?? 0) + 1);
    }
    let best = null;
    let most = 0;
    for (const [cell, n] of counts) {
      if (n > most) {
        best = cell;
        most = n;
      }
    }
    if (best === null) continue;
    const pairs = parseLookCell(best);
    if (pairs.length) out.push({ slot, pairs });
  }
  return out;
}

/**
 * A chassis row's wing_open_speed_factor (0.95 on the X-wing, advanced X-wing, B-wing and V-wing;
 * 1 everywhere else), rounded to four places since the table stores a float; 1 when the row has
 * none, or none that is a positive number.
 */
export function wingOpenSpeedFactorOf(row) {
  const f = Number(row?.wing_open_speed_factor);
  return Number.isFinite(f) && f > 0 ? Number(f.toFixed(4)) : 1;
}
