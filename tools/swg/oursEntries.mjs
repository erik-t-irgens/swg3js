// Entries of ours: the appearance files SOE's last publishes added that nothing in the client names.
//
// Sixty-six of the late appearance files are reached by no object template, table, client data, layout,
// snapshot or string the final client carries (the census, `soe-complete/devtree/new-content.md`); only the
// client's customization manager lists them. They are SOE's own retail art, in archives every Legends install
// holds, but with no template there is nothing for any of the converter's commands to find, so the only way
// into a menu is an entry of ours. The table that makes them is `manifests/ours-entries.json`, committed: a row
// an appearance, holding only the appearance's path (as SOE's final names list already carries it), the menu
// it reaches, a name of ours, and for a garment the client arrangement it takes and the bodies it fits.
// Nothing in it is the client's words or a string id.
//
// Four menus read it, each through the command that converts that menu: the give tab's clothes (`wardrobe`),
// the hair grid (`wardrobe` for the meshes, `customization` for the grid's rows), the NPC tab (`mobiles`) and
// the props tab (`props`). Each stands a row as it would a template's entry and marks it ours (`ours: true`),
// as a deed of ours is marked, so every menu can say which are the game's and which are ours. A row whose
// appearance the mount has not got (an install without SOE's final names list) is left out and counted, never
// an error.
//
// Twenty of the sixty-six are not rows, each for the reason below; they are named here and not in the table,
// which holds rows and nothing else.
//
// Dependency-free but for node's own modules. Shared with tools/swg/tests/oursEntries.test.ts.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** The committed table. */
export const OURS_URL = new URL('./manifests/ours-entries.json', import.meta.url);

/** The menus a row may reach, by the word the table uses. */
export const OURS_MENUS = ['clothes', 'hair', 'npc', 'props'];

/** Every field a row may carry, and nothing else. */
export const OURS_FIELDS = ['appearance', 'menu', 'name', 'slot', 'fits'];

/** A species id as the appearance table's columns spell one (`columnSpecies` in items.mjs): `twilek_female`. */
export const OURS_SPECIES = /^[a-z]+_(male|female)$/;

/**
 * The late appearance files no template names that are not rows, each with why [ours]. Every one is either reached
 * already (a body the game's own templates stand wears it, or another command's file names it), or has nothing a
 * menu could draw.
 */
export const OURS_LEFT_OUT = {
  'appearance/a_havoc_nym_cockpit.apt': "the Havoc's cockpit frame, which cockpit/havoc.iff names and the ships command draws round its pilot",
  'appearance/abyssin_m_arms.apt': 'a pair of arms with no skeleton and no body to hang on: nothing of ours can stand it as anything but arms on the floor',
  'appearance/dug_m_wearable_s01.sat': 'worn by the Dug body dug_m_s01.sat, which is a row of its own',
  'appearance/dug_m_wearable_s02.sat': 'worn by the Dug body dug_m_s02.sat, which is a row of its own',
  'appearance/dug_m_wearable_s03.sat': "worn by dug_m_s03.sat, the game's own static Dug",
  'appearance/frn_exar_claw_alter_s02.sat': 'an empty skeletal appearance: no skeleton and no mesh',
  'appearance/kubaz_m_hair.sat': 'its mesh (appearance/mesh/kubaz_m_hair.lmg) is not in the archives',
  'appearance/pv_single_pod_airspeeder.sat': 'a placeholder whose mesh is not in the archives (the airspeeder is drawn from single_pod_airspeeder.sat)',
  'appearance/tcg_8_air_speeder.sat': 'a placeholder whose mesh is not in the archives (the airspeeder is drawn from single_pod_airspeeder.sat)',
  'appearance/reek_nose_ring.sat': "worn by reek_s02.sat, the game's own mutated reek",
  'appearance/togorian_m_wearable_s03.sat': 'worn by the Togorian body togorian_m_s02.sat, which is a row of its own',
  'appearance/ugnaught_suit_s01.sat': "worn by ugnaught_m_s02.sat, the game's own static Ugnaught",
  // Measured on the pilot conversion: each of these wears exactly the meshes a template's own appearance already wears,
  // so an entry of ours would offer the very same thing twice under another name.
  'appearance/bth_m_hair_s22.sat': "wears the Sullustan woman's style 15 (sul_hair_s15_f), which the wardrobe already offers",
  'appearance/bth_mohawk_s01.sat': 'wears the mesh of the Bothan woman\'s style 22 and the man\'s 23',
  'appearance/bth_mohawk_s02.sat': 'wears the mesh of the Bothan woman\'s and man\'s style 21',
  'appearance/hum_hair_bangs_s01.sat': 'wears the mesh of the human woman\'s style 48 and the man\'s 42',
  'appearance/hum_m_hair_s43b.sat': 'wears the mesh of the human man\'s style 43',
  'appearance/loveday_wings_backpack_hue_s01_m.sat': "wears the meshes of the Love Day wings (back_love_day_11_hue_wings)",
  'appearance/wke_beard_s01_m.sat': "wears the mesh of the Wookiees' beard 1",
  'appearance/wke_beard_s10_m.sat': "wears the mesh of the Wookiees' beard 10",
};

/** The table's identity: the first 12 hex of the SHA-1 of its text with `\r\n` folded to `\n` (one table, one key, CRLF or not). */
export function oursKey(text) {
  return createHash('sha1').update(String(text).replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
}

/** Why a row is not one this reader takes, or null. Every string in it must be one of the fields' own. */
export function rowFault(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return 'a row is not an object';
  for (const k of Object.keys(row)) if (!OURS_FIELDS.includes(k)) return `a row carries ${JSON.stringify(k)}, which is no field of a row`;
  const a = row.appearance;
  if (typeof a !== 'string' || !/^appearance\/[a-z0-9_]+\.(sat|apt)$/.test(a)) return `${JSON.stringify(a)} is not an appearance path`;
  if (!OURS_MENUS.includes(row.menu)) return `${a}: its menu ${JSON.stringify(row.menu)} is not ${OURS_MENUS.join(', ')}`;
  if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 60) return `${a}: its name is not a short line of words`;
  if (row.menu === 'clothes') {
    if (typeof row.slot !== 'string' || !/^abstract\/slot\/arrangement\/wearables\/[a-z0-9_]+\.iff$/.test(row.slot)) return `${a}: a garment takes a client arrangement`;
  } else if (row.slot !== undefined) return `${a}: only a garment takes a slot`;
  if (row.fits !== undefined) {
    if (!Array.isArray(row.fits) || !row.fits.length) return `${a}: its fits is not a list`;
    for (const f of row.fits) {
      const ok = row.menu === 'npc' ? /^appearance\/[a-z0-9_]+\.sat$/.test(f) : OURS_SPECIES.test(f);
      if (!ok) return `${a}: ${JSON.stringify(f)} is not a ${row.menu === 'npc' ? 'body appearance' : 'species id'}`;
    }
  }
  if ((row.menu === 'clothes' || row.menu === 'hair') && !row.fits) return `${a}: a garment or a hairstyle names the bodies it fits`;
  if (row.menu === 'props' && row.fits !== undefined) return `${a}: a prop fits nobody`;
  return null;
}

/**
 * A table read from its text and checked: `format` 1, a `rows` list and nothing but rows of the fields above, each
 * appearance once. A table that fails is no table: `{ broken: why, key }`, and every command converts as before.
 */
export function parseOurs(text) {
  const key = oursKey(text);
  let t;
  try {
    t = JSON.parse(String(text));
  } catch (err) {
    return { broken: `it is not JSON (${err.message})`, key };
  }
  if (!t || typeof t !== 'object') return { broken: 'it is not an object', key };
  if (t.format !== 1) return { broken: `format ${t.format} is not 1`, key };
  for (const k of Object.keys(t)) if (!['format', 'note', 'rows'].includes(k)) return { broken: `it carries ${JSON.stringify(k)}`, key };
  if (!Array.isArray(t.rows)) return { broken: 'it has no rows', key };
  const seen = new Set();
  // One id a menu: two rows whose stems are one (`x.sat` and `x.apt`) would be one prop or one body twice over. Only a
  // garment's two cuts (`_m`, `_f`) share an id, and are one item.
  const ids = new Map();
  for (const row of t.rows) {
    const fault = rowFault(row);
    if (fault) return { broken: fault, key };
    if (seen.has(row.appearance)) return { broken: `${row.appearance} is a row twice`, key };
    seen.add(row.appearance);
    const id = `${row.menu}:${oursId(row)}`;
    if (ids.has(id) && row.menu !== 'clothes') return { broken: `${row.appearance} and ${ids.get(id)} are one entry (${oursId(row)})`, key };
    ids.set(id, row.appearance);
  }
  return { format: 1, rows: t.rows, key };
}

/**
 * The table a conversion uses: `SWG3JS_OURS=<file>` in the environment names one to load in place of the committed
 * one (the test hook: a miniature table of `test_*` rows written at run time), else the committed file. Never throws.
 */
export function loadOurs() {
  const file = process.env.SWG3JS_OURS || OURS_URL;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    return { broken: `it cannot be read (${err.code ?? err.message})`, key: null, rows: [] };
  }
  const t = parseOurs(text);
  return t.broken ? { ...t, rows: [] } : t;
}

let committed;
/** The table for this process, read once. */
export function oursTable() {
  if (committed === undefined) committed = loadOurs();
  return committed;
}

/** An appearance's file stem: `appearance/kel_dor_mask_s01.sat` is `kel_dor_mask_s01`. */
export function stemOf(appearance) {
  return String(appearance ?? '').replace(/^.*\//, '').replace(/\.[^.]+$/, '');
}

/**
 * A row's catalogue id, never one a template's could be: a garment `ours_<stem>` with the gender suffix off, so the two
 * cuts of one piece (`_m`, `_f`) are one item whichever folder converts it; a hairstyle `hair_ours_<stem>`, which the
 * game's one hair test (`isHairKey`) reads as hair; a body `ours/<stem>`, under a folder of its own as the mobiles'
 * ids are; a prop `ours_<stem>`.
 */
export function oursId(row) {
  const stem = stemOf(row?.appearance);
  if (row?.menu === 'hair') return `hair_ours_${stem}`;
  if (row?.menu === 'npc') return `ours/${stem}`;
  if (row?.menu === 'clothes') return `ours_${stem.replace(/_[mf]$/, '')}`;
  return `ours_${stem}`;
}

/** The rows that reach one menu, in the table's order. */
export function oursRows(table, menu) {
  return (table?.rows ?? []).filter((r) => r.menu === menu);
}

/**
 * The garments of ours a wardrobe folder takes: rows whose fits name a species of the folder's gender, one row an id,
 * the cut of the folder's own gender first (`_m` for a man's folder), else the other's, which the wardrobe then marks
 * as the other gender's as it does any piece authored for one gender alone. Whether the folder's skeleton can wear a
 * row is the wardrobe's own test, met as it converts.
 */
export function oursClothesFor(table, gender) {
  const g = String(gender ?? '').toLowerCase().startsWith('f') ? 'female' : 'male';
  const byId = new Map();
  for (const row of oursRows(table, 'clothes')) {
    if (!row.fits.some((f) => f.endsWith(`_${g}`))) continue;
    const id = oursId(row);
    const have = byId.get(id);
    const own = new RegExp(`_${g[0]}\\.sat$`).test(row.appearance);
    if (!have || (own && !new RegExp(`_${g[0]}\\.sat$`).test(have.appearance))) byId.set(id, row);
  }
  return [...byId.values()];
}

/**
 * The wardrobe's `fit` for a row of ours in a folder of `gender`: every species of that gender the appearance table's
 * columns name (`speciesOfGender`) that the row's fits leave out is blocked. Undefined when nothing is blocked.
 */
export function oursFit(row, gender, speciesOfGender) {
  const g = String(gender ?? '').toLowerCase().startsWith('f') ? 'female' : 'male';
  const fits = new Set(row.fits ?? []);
  const block = [...new Set(speciesOfGender)].filter((s) => s.endsWith(`_${g}`) && !fits.has(s)).sort();
  return block.length ? { block } : undefined;
}

/** The client arrangement every hairstyle of ours takes, as every hair template does. */
export const OURS_HAIR_ARRANGEMENT = 'abstract/slot/arrangement/wearables/hair.iff';

/**
 * What a wardrobe folder of `gender` takes of the table, in the order it converts them (after every template): the
 * garments of ours (`oursClothesFor`) while the run takes wearables, then the hairstyles whose fits name a species of the
 * gender while it takes hair, less a row its `--match` passes over and less one whose appearance the mount has not got,
 * which is counted (`missing`). Each as the wardrobe stands it: its id, its name, the client arrangement whose slots it
 * takes, its kind, and `mark`, what its catalogue entry carries beside a template's fields: `ours`, the `fit` that blocks
 * the rest of the gender (`oursFit`), and a hairstyle's own `fits` (it has no template folder to name its species by).
 * Whether the folder's skeleton can wear one is the wardrobe's own test, met as it converts (`oursPassedOver`). Pure.
 */
export function oursWardrobePlan(table, { gender, kinds = ['wearables', 'hair'], has, match = null, speciesOfGender = [] }) {
  const g = String(gender ?? '').toLowerCase().startsWith('f') ? 'f' : 'm';
  const word = g === 'f' ? '_female' : '_male';
  const rows = [];
  if (kinds.includes('wearables')) for (const row of oursClothesFor(table, g)) rows.push({ row, kind: 'wearables' });
  if (kinds.includes('hair')) for (const row of oursRows(table, 'hair')) if (row.fits.some((f) => f.endsWith(word))) rows.push({ row, kind: 'hair' });
  const take = [];
  let missing = 0;
  for (const { row, kind } of rows) {
    if (match && !match.test(row.appearance)) continue;
    if (!has(row.appearance)) {
      missing++;
      continue;
    }
    const fit = oursFit(row, g, speciesOfGender);
    take.push({
      row,
      kind,
      id: oursId(row),
      name: row.name,
      arrangement: kind === 'hair' ? OURS_HAIR_ARRANGEMENT : row.slot,
      mark: { ours: true, ...(fit ? { fit } : {}), ...(kind === 'hair' ? { fits: [...row.fits] } : {}) },
    });
  }
  return { take, missing };
}

/**
 * Whether a row of ours the wardrobe could not convert is passed over quietly and counted apart, rather than listed as
 * failed: one built for another skeleton (an Ithorian's halo met in a human folder), which is no fault of the run.
 */
export function oursPassedOver(err) {
  return /^built for /.test(String(err instanceof Error ? err.message : err));
}

/**
 * A hairstyle of ours as a row of the creator table's hair list (`customization.json`'s `hair`): its id, marked ours, its
 * name of ours, never a creation style. Which species and genders take it are the row's fits.
 */
export function oursHairRow(row) {
  return { id: oursId(row), ours: true, name: row.name, inArchives: true, creation: false };
}

/**
 * What a command writes as `ours` into the file `status` reads for it: the table's key, how many rows of its menu
 * it stood and how many it left out because the mount has not got their appearance. Null with no table.
 */
export function oursStamp(table, taken, missing) {
  if (!table || table.broken || !table.key) return null;
  return { key: table.key, taken, missing };
}

/**
 * Why `status` asks a command again for the rows of ours, or null: only while the file's late stamp says SOE's final
 * files were mounted (every row is a late appearance, so a run from another world would stand none of them), and
 * the file carries no `ours` stamp or one of another table.
 */
export function oursAsk(ours, late, table) {
  if (late?.state !== 'applied' && late?.state !== 'final') return null;
  if (!table || table.broken || !table.key) return null;
  if (!ours) return 'converted before the entries of ours (the late appearance files no template names)';
  if (ours.key !== table.key) return 'converted with an older table of entries of ours';
  return null;
}
