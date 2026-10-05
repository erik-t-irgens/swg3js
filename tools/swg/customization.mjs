// The character creator's own table, as the client laid its appearance page out: which tabs a species
// had, the rows on each in the order they came, the words each row was called by, which colours follow
// which, whether the species may go bald, which hairstyles it was offered and how many of each creator
// palette's colours it was shown at creation, in how many columns.
//
// A pure join over what the converter already reads -- six retail files, no model, no texture -- written
// as one small file, `characters/customization.json`, beside the species index:
//
//   datatables/customization/customization_data.iff   a row per species, tab and slider or colour.
//       CUSTOMIZATION_GROUP is the tab and the table's own order is the tab and row order;
//       TYPE is `hslider` or `color`; CUSTOMIZATION_NAME keys the words in ui_cust.stf;
//       VARIABLES is one or two variables (`blend_skinny,blend_fat` is one slider, as is an
//       `_0,_1` pair); IS_SCALE marks the height, REVERSE a slider that runs the other way,
//       DISCRETE whole steps; COLOR_LINKED names the variable a colour follows (the facial hair
//       follows the hair); COLOR_LINKED_TO_SELF_0/1 the variables a colour also sets with the same
//       index (a female's skin sets her eye shadow and lips, which start as no make-up at all);
//       IS_VAR_HAIR_COLOR a variable that lives on the hair object rather than the body; CAMERA_YAW
//       and the misspelt RAMDOMIZABLE with RANDOMIZABLE_GROUP are kept for a later turn and a later
//       randomise button. The IMAGEDESIGN_* and MODIFICATION_TYPE columns gate the image designer,
//       which this game has no use for, and are not read.
//   datatables/customization/customization_group_shared.iff   which tabs hold hair (IS_HAIR) and
//       which markings (IS_MARKING).
//   datatables/customization/palette_columns.iff   per palette, how many of its colours the creator
//       offered and in how many columns, and the image designer's ranges after that.
//   datatables/customization/allow_bald.iff   which species may wear no hair at all.
//   datatables/customization/hair_assets_skill_mods.iff   the hairstyles each player template was
//       offered, which of them at creation, and at what image designer level the rest.
//   string/en/ui_cust.stf   the words, keyed on the row and tab names.
//
// One row of palette_columns is the client's own interface palette, and the interface rule says none of
// the client's interface art is ever converted, read or drawn: any row matching PALETTE_SKIP is passed
// over before its file is so much as opened.
//
// The rows repeat a colour under several tabs (the skin on the body tab, the face tab and a species' own);
// such a row is kept once, under the first tab it came in, with the others in `alsoIn`.

/** What this module writes; `status` asks again for a file older than this. */
export const CUSTOMIZATION_FORMAT = 1;

/** The client's interface palettes, which are never read (the interface rule). */
export const PALETTE_SKIP = /^ui(_|$)/;

/** Where the file is written, under the out-dir. */
export const CUSTOMIZATION_FILE = 'characters/customization.json';

const TABLES = {
  data: 'datatables/customization/customization_data.iff',
  groups: 'datatables/customization/customization_group_shared.iff',
  palettes: 'datatables/customization/palette_columns.iff',
  bald: 'datatables/customization/allow_bald.iff',
  hair: 'datatables/customization/hair_assets_skill_mods.iff',
};
const WORDS = 'string/en/ui_cust.stf';

/** The files it reads, for the pack's own `source` line. */
export const CUSTOMIZATION_SOURCES = [...Object.values(TABLES), WORDS];

/** A template's catalogue id, as the wardrobe names it (`object/tangible/hair/x/shared_hair_x_s01.iff` is `hair_x_s01`). */
export function itemIdOf(template) {
  return String(template).replace(/^.*\//, '').replace(/^shared_/, '').replace(/\.[^.]+$/, '');
}

/** One table row as the page reads it, or null for a row with nothing to say. */
function rowOf(r, word) {
  const variables = String(r.VARIABLES ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  const sets = [r.COLOR_LINKED_TO_SELF_0, r.COLOR_LINKED_TO_SELF_1].map((v) => String(v ?? '').trim()).filter(Boolean);
  const type = r.TYPE === 'color' ? 'color' : r.IS_SCALE ? 'scale' : variables.some((v) => /^index_/.test(v)) ? 'choice' : 'slider';
  return {
    name: r.CUSTOMIZATION_NAME,
    label: word(r.CUSTOMIZATION_NAME),
    group: r.CUSTOMIZATION_GROUP,
    type,
    variables,
    ...(r.REVERSE ? { reverse: true } : {}),
    ...(r.DISCRETE ? { discrete: true } : {}),
    ...(r.IS_VAR_HAIR_COLOR ? { onHair: true } : {}),
    ...(String(r.COLOR_LINKED ?? '').trim() ? { follows: String(r.COLOR_LINKED).trim() } : {}),
    ...(sets.length ? { sets } : {}),
    ...(r.CAMERA_YAW ? { yaw: r.CAMERA_YAW } : {}),
    ...(r.RAMDOMIZABLE ? { random: r.RANDOMIZABLE_GROUP || true } : {}),
  };
}

/**
 * The whole file from the client's own tables. `read` is `{ table(path), strings(path), palette(path),
 * has(path) }`: a parsed datatable (`{ rows }`) or null, a string table (a Map) or null, a palette's
 * entries (`[[r, g, b, a], ...]`) or null, and whether a file is in the archives. Nothing else is opened.
 */
export function buildCustomization(read) {
  const data = read.table(TABLES.data);
  if (!data?.rows?.length) throw new Error(`${TABLES.data} is not in the archives`);
  const groupFlags = new Map((read.table(TABLES.groups)?.rows ?? []).map((r) => [r.CUSTOMIZATION_GROUP, r]));
  const bald = new Map((read.table(TABLES.bald)?.rows ?? []).map((r) => [r.SPECIES_GENDER, !!r.ALLOW_BALD]));
  const hairRows = read.table(TABLES.hair)?.rows ?? [];
  const words = read.strings(WORDS) ?? new Map();
  const word = (k) => words.get(k) ?? null;
  const out = { format: CUSTOMIZATION_FORMAT, source: CUSTOMIZATION_SOURCES.join(', '), species: {}, palettes: {} };
  const counts = { rows: 0, words: 0, hair: 0, hairMissing: 0, palettes: 0, colours: 0, skipped: [] };
  for (const id of [...new Set(data.rows.map((r) => r.SPECIES_GENDER))]) {
    const groups = [];
    const rows = [];
    const byName = new Map();
    for (const r of data.rows) {
      if (r.SPECIES_GENDER !== id) continue;
      if (!groups.some((g) => g.id === r.CUSTOMIZATION_GROUP)) {
        const flags = groupFlags.get(r.CUSTOMIZATION_GROUP);
        groups.push({ id: r.CUSTOMIZATION_GROUP, label: word(r.CUSTOMIZATION_GROUP), ...(flags?.IS_HAIR ? { hair: true } : {}), ...(flags?.IS_MARKING ? { marking: true } : {}) });
      }
      const seen = byName.get(r.CUSTOMIZATION_NAME);
      if (seen) {
        if (seen.group !== r.CUSTOMIZATION_GROUP && !(seen.alsoIn ??= []).includes(r.CUSTOMIZATION_GROUP)) seen.alsoIn.push(r.CUSTOMIZATION_GROUP);
        continue;
      }
      const row = rowOf(r, word);
      byName.set(row.name, row);
      rows.push(row);
      counts.rows++;
      if (row.label) counts.words++;
    }
    const player = `shared_${id}.iff`;
    const hair = hairRows
      .filter((h) => String(h.PLAYER_TEMPLATE ?? '').endsWith(`/${player}`) && h.SHARED_TEMPLATE)
      .map((h) => ({ template: h.SHARED_TEMPLATE, id: itemIdOf(h.SHARED_TEMPLATE), inArchives: read.has(h.SHARED_TEMPLATE), creation: !!h.AVAILABLE_AT_CREATION, skill: h.SKILL_MOD_VALUE }));
    counts.hair += hair.length;
    counts.hairMissing += hair.filter((h) => !h.inArchives).length;
    out.species[id] = { ...(bald.has(id) ? { bald: bald.get(id) } : {}), groups, rows, ...(hair.length ? { hair } : {}) };
  }
  for (const p of read.table(TABLES.palettes)?.rows ?? []) {
    const stem = String(p.PALETTE ?? '');
    if (!stem) continue;
    if (PALETTE_SKIP.test(stem)) {
      counts.skipped.push(stem);
      continue;
    }
    const entry = { creation: p.CREATION_INDEXES, columns: p.CREATION_COLUMNS, master: p.ID_MASTER_COLUMNS };
    // The creator palettes' own colours, so the page can offer any species' palette without that
    // species' pack; the garment palettes (wr_*) are the wardrobe's and are not repeated here.
    if (/^pc_/.test(stem)) {
      const colours = read.palette(`palette/${stem}.pal`);
      if (colours?.length) {
        entry.colors = colours.map(([r, g, b]) => [r, g, b]);
        counts.colours += colours.length;
      }
    }
    out.palettes[stem] = entry;
    counts.palettes++;
  }
  return { file: out, counts };
}

/**
 * What `status` says of the file: a line for the report, and the reason to convert it again (null when it
 * is in order). A file is asked for again when it is missing, older than this module, or lacks the human
 * male's eye colour row -- the one named product of the conversion, so a file cut short or written by a
 * reader that lost its rows is caught without trusting the stamp alone.
 */
export function customizationStatus(json) {
  if (!json) return { line: 'creator table: none', why: "no creator table: the appearance page lays itself out from the packs' own variables" };
  const species = Object.keys(json.species ?? {});
  const rows = species.reduce((a, s) => a + (json.species[s]?.rows?.length ?? 0), 0);
  const line = `creator table: ${species.length} species, ${rows} rows, ${Object.keys(json.palettes ?? {}).length} palettes (format ${json.format ?? 0})`;
  if ((json.format ?? 0) < CUSTOMIZATION_FORMAT) return { line, why: 'the creator table was written by an older converter' };
  if (!(json.species?.human_male?.rows ?? []).some((r) => r.name === 'color_eyes')) return { line, why: 'the creator table has no eye colour row for the human male (cut short, or read wrongly)' };
  return { line, why: null };
}
