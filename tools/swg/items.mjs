// What an item is, for the backpack: its name and description (string ids on its template), the
// body slots it occupies (the arrangement file its template names), and which species may wear it
// (datatables/appearance/appearance_table.iff). Pure: reads the archives through the vfs handed in
// and writes nothing, so every rule is tested on synthetic files (tools/swg/tests/items.test.ts).
//
// Layouts, as the client's files hold them:
//   string id parameter   int8 1, then presence byte + table cstring, presence byte + key cstring
//                         (a base template carries the table with an empty key)
//   arrangement           FORM ARGD > FORM 0000 > ARG * ("ARG" and a space); each ARG one alternative,
//                         a run of NUL-terminated slot names
//   slot descriptor       FORM SLTD > FORM 0000 > DATA, NUL-terminated slot names
//   appearance table      a datatable: "Object Template Name" (shared_<id>), then a column per species
//                         and gender ("Male Human" .. "Female Sullustan"), each cell ':default',
//                         ':block', ':hide' or that species' own appearance path
import { childrenOf, isForm, parseIff } from './iff.mjs';
import { localize, parseDatatable } from './datatable.mjs';
import { resolveTemplateParam, stringParam } from './objtemplate.mjs';
import { decodeStringId } from './mobiles.mjs';

export const APPEARANCE_TABLE = 'datatables/appearance/appearance_table.iff';
export const PLAYER_SLOTS = 'abstract/slot/descriptor/player.iff';

/** NUL-separated names in a chunk's bytes, empty runs dropped. */
function cstrings(data) {
  const out = [];
  let start = 0;
  for (let i = 0; i <= data.length; i++) {
    if (i === data.length || data[i] === 0) {
      if (i > start) out.push(Buffer.from(data.buffer, data.byteOffset + start, i - start).toString('latin1'));
      start = i + 1;
    }
  }
  return out;
}

/** The version form under a root (FORM 0000 and the like), or the root itself when it has none. */
function versionForm(root) {
  return root.children.find(isForm) ?? root;
}

/** FORM ARGD > FORM 0000 > ARG *: each ARG one alternative, NUL-separated slot names, deduplicated within it. */
export function parseArrangement(root) {
  if (!isForm(root) || root.type !== 'ARGD') throw new Error(`not an arrangement: ${root.type ?? root.tag}`);
  const out = [];
  for (const arg of childrenOf(versionForm(root), 'ARG ')) {
    const slots = [...new Set(cstrings(arg.data))];
    if (slots.length) out.push(slots);
  }
  return out;
}

/** FORM SLTD > FORM 0000 > DATA: NUL-separated slot names. */
export function parseSlotDescriptor(root) {
  if (!isForm(root) || root.type !== 'SLTD') throw new Error(`not a slot descriptor: ${root.type ?? root.tag}`);
  const out = [];
  for (const data of childrenOf(versionForm(root), 'DATA')) out.push(...cstrings(data.data));
  return out;
}

/** A string id parameter that is set: both table and key non-empty (decodeStringId from mobiles.mjs underneath). */
export function setStringId(buf) {
  const s = decodeStringId(buf);
  return s && s.table && s.key ? { table: s.table, key: s.key } : null;
}

/** The table of a string id parameter whether or not its key is set: the fallback's table. */
function stringIdTable(buf) {
  const s = decodeStringId(buf);
  return s && s.table ? s.table : null;
}

/** Trim, CRLF to LF, strip \#rrggbb and \#. colour codes; '' becomes null. */
export function cleanText(s) {
  if (s === null || s === undefined) return null;
  const t = String(s)
    .replace(/\r\n?/g, '\n')
    .replace(/\\#[0-9a-fA-F]{6}/g, '')
    .replace(/\\#\./g, '')
    .trim();
  return t === '' ? null : t;
}

export function newItemCaches() {
  return { params: new Map(), strings: new Map(), arrangements: new Map() };
}

/** Text for table:key through string/en/<table>.stf, cleaned; null when the table or the key is absent or unreadable. */
function lookUp(vfs, table, key, caches) {
  try {
    return cleanText(localize(vfs, `${table}:${key}`, caches.strings));
  } catch {
    // A string table that will not read counts as absent, for this and every later lookup.
    caches.strings.set(table, new Map());
    return null;
  }
}

/**
 * An item's name and description: the first set string id along the chain (resolveTemplateParam with setStringId),
 * localized; failing that for the name, the chain's table (the first objectName table met, key or not) with the
 * item's id as key. Nulls when nothing resolves.
 */
export function itemText(vfs, template, id, caches) {
  const text = (param) => {
    const sid = resolveTemplateParam(vfs, template, param, setStringId, caches.params);
    return sid ? lookUp(vfs, sid.table, sid.key, caches) : null;
  };
  let name = text('objectName');
  if (name === null && id) {
    const table = resolveTemplateParam(vfs, template, 'objectName', stringIdTable, caches.params);
    if (table) name = lookUp(vfs, table, id, caches);
  }
  return { name, description: text('detailedDescription') };
}

/** The arrangement named along the chain, parsed (cached per file); null when none is named or it will not read. */
export function itemSlots(vfs, template, caches) {
  const raw = resolveTemplateParam(vfs, template, 'arrangementDescriptorFilename', stringParam, caches.params);
  if (!raw) return null;
  const file = raw.replace(/\\/g, '/').replace(/^\//, '');
  if (caches.arrangements.has(file)) return caches.arrangements.get(file);
  let slots = null;
  try {
    const path = vfs.has(file) ? file : vfs.has(file.toLowerCase()) ? file.toLowerCase() : null;
    if (path) {
      const parsed = parseArrangement(parseIff(vfs.read(path)));
      slots = parsed.length ? parsed : null;
    }
  } catch {
    slots = null;
  }
  caches.arrangements.set(file, slots);
  return slots;
}

export function describeItem(vfs, template, id, caches) {
  const { name, description } = itemText(vfs, template, id, caches);
  return { name, description, slots: itemSlots(vfs, template, caches) };
}

/** An appearance path as the archives key it: forward slashes, no leading slash, trimmed. */
function normPath(p) {
  return String(p).trim().replace(/\\/g, '/').replace(/^\//, '');
}

/** appearance_table.iff as Map<'shared_<id>', row>; an empty Map when the table is absent. */
export function readAppearanceTable(vfs) {
  const out = new Map();
  if (!vfs.has(APPEARANCE_TABLE)) return out;
  let table;
  try {
    table = parseDatatable(parseIff(vfs.read(APPEARANCE_TABLE)));
  } catch {
    return out;
  }
  const key = table.columns[0];
  for (const row of table.rows) {
    // The rows name the template's file without .iff; a full path is taken down to that as well.
    const k = String(row[key] ?? '').trim().replace(/\\/g, '/').replace(/^.*\//, '').replace(/\.iff$/i, '').toLowerCase();
    if (k && !out.has(k)) out.set(k, row);
  }
  return out;
}

/** "Female Twi'lek" -> 'twilek_female', "Male MonCal" -> 'moncal_male': lower case, letters only, then the gender. */
export function columnSpecies(column) {
  const m = /^\s*(male|female)\s+(.+?)\s*$/i.exec(String(column ?? ''));
  if (!m) return null;
  const species = m[2].toLowerCase().replace(/[^a-z]/g, '');
  return species ? `${species}_${m[1].toLowerCase()}` : null;
}

/** The column a species id reads (the inverse of columnSpecies over the table's own columns). */
export function speciesColumn(columns, speciesId) {
  const want = String(speciesId ?? '').toLowerCase();
  return columns.find((c) => columnSpecies(c) === want) ?? null;
}

/**
 * What one cell of the table means for the folder converting it. `cell` is the row's value in the folder's own column
 * (undefined when there is no row); `ownSat` the template's appearance (normalised); `has` the vfs test.
 * - { verdict: 'block' | 'hide' | 'default', sat: ownSat }        for ':block', ':hide', ':default' and no row;
 * - { verdict: 'own', sat: <path normalised> }                     for a path the archives hold (the path wins);
 * - { verdict: 'default', sat: ownSat, missing: true }             for a path they lack, or a '.satx' typo.
 * `took` is true when the returned sat differs from ownSat (for the summary's "took the table's appearance" count).
 */
export function appearanceFor(cell, ownSat, has) {
  const value = cell === null || cell === undefined ? '' : String(cell).trim();
  const verdictOf = { ':block': 'block', ':hide': 'hide', ':default': 'default' };
  if (!value) return { verdict: 'default', sat: ownSat, took: false };
  const word = verdictOf[value.toLowerCase()];
  if (word) return { verdict: word, sat: ownSat, took: false };
  if (value.startsWith(':')) return { verdict: 'default', sat: ownSat, took: false, missing: true };
  const path = normPath(value);
  // The table's typos (19 '.satx', one '.satxx') name nothing; the client's handling of them is not in the data.
  if (/\.satx+$/i.test(path)) return { verdict: 'default', sat: ownSat, took: false, missing: true };
  const found = has(path) ? path : has(path.toLowerCase()) ? path.toLowerCase() : null;
  if (!found) return { verdict: 'default', sat: ownSat, took: false, missing: true };
  if (ownSat && found.toLowerCase() === String(ownSat).toLowerCase()) return { verdict: 'own', sat: ownSat, took: false };
  return { verdict: 'own', sat: found, took: true };
}

/**
 * The table's verdict for one gender's columns: species that cannot wear it, species that wear it unseen, and species
 * that wear their own cut (only paths present in the archives, and only when different from `ownSat`, the appearance
 * this folder converted). Undefined when every species of that gender wears `ownSat` as it is.
 */
export function fitFrom(row, gender, ownSat, has) {
  if (!row) return undefined;
  const suffix = String(gender ?? '').toLowerCase().startsWith('f') ? '_female' : '_male';
  const block = [];
  const hide = [];
  const own = {};
  for (const column of Object.keys(row)) {
    const species = columnSpecies(column);
    if (!species || !species.endsWith(suffix)) continue;
    const a = appearanceFor(row[column], ownSat, has);
    if (a.verdict === 'block') block.push(species);
    else if (a.verdict === 'hide') hide.push(species);
    else if (a.verdict === 'own' && a.took) own[species] = a.sat;
  }
  const fit = {};
  if (block.length) fit.block = block.sort();
  if (hide.length) fit.hide = hide.sort();
  const ownKeys = Object.keys(own).sort();
  if (ownKeys.length) fit.own = Object.fromEntries(ownKeys.map((k) => [k, own[k]]));
  return Object.keys(fit).length ? fit : undefined;
}

/**
 * What the wardrobe command does with one template (tools/swg/cli.mjs, case 'wardrobe'), kept here so its rules are
 * tested. `cell` is the row's value in the folder's own column (undefined with no row or no column), `templateSat` the
 * template's appearance (normalised), `ownChoice` what the template alone gives after the gender swap, `has` the vfs
 * test, and `wear(path)` converts one appearance for the folder, returning `{ satPath, ... }` or throwing.
 * - A species' own cut wins over the template (the men's bracelets, the Ithorian pieces); a path the archives lack, or
 *   misspelt, is the template's own (`missing`).
 * - A cut that will not convert (six Ithorian camouflage pieces whose meshes the archives hold stripped) is worn as the
 *   template names it: `made` is the template's, `fellBack` true.
 * - Nothing built while the folder's own column says ':hide' is worn unseen (`unseen`: the item takes its slots and
 *   nothing is drawn); nothing built otherwise is a failure (`error`, the last error thrown).
 * - `took` is true when the appearance built differs from `ownChoice`: the table changed the mesh.
 * Returns { verdict, missing, made, fellBack, took, unseen, error }; exactly one of made, unseen and error is set.
 */
export function wardrobeChoice(cell, templateSat, ownChoice, has, wear) {
  const a = appearanceFor(cell, templateSat, has);
  const out = { verdict: a.verdict, missing: !!a.missing, made: null, fellBack: false, took: false, unseen: false, error: null };
  try {
    out.made = wear(a.sat);
  } catch (err) {
    out.error = err;
    if (a.took) {
      try {
        out.made = wear(templateSat);
        out.fellBack = true;
        out.error = null;
      } catch (again) {
        out.error = again;
      }
    }
  }
  if (out.made) out.took = out.made.satPath !== ownChoice;
  else if (a.verdict === 'hide') {
    out.unseen = true;
    out.error = null;
  }
  return out;
}

/**
 * The `fit` written on a converted wardrobe entry: fitFrom for the appearance actually built, without the folder's own
 * species in `fit.own`. What the folder converted is what its species wears (the entry's `sat`); its own cell can only
 * differ from that when the cut did not convert and the template's was taken (wardrobeChoice's `fellBack`: six
 * Ithorian camouflage pieces) or when the gender swap picked the other suffix (a male Ithorian cell naming a `_f` cut
 * that also exists as `_m`), and either way the cell names a mesh this folder does not hold. Undefined when nothing is
 * left to say.
 */
export function wardrobeFit(row, gender, sat, has, speciesId) {
  const fit = fitFrom(row, gender, sat, has);
  if (!fit || !fit.own || !(speciesId in fit.own)) return fit;
  const own = Object.fromEntries(Object.entries(fit.own).filter(([k]) => k !== speciesId));
  const out = { ...fit };
  if (Object.keys(own).length) out.own = own;
  else delete out.own;
  return Object.keys(out).length ? out : undefined;
}

/** For status: how many entries carry name, slots (the key present, null allowed), icon, fit, and how many are worn-unseen (parts empty). */
export function itemPackStatus(items) {
  const list = Array.isArray(items) ? items : [];
  let named = 0, slotted = 0, iconed = 0, fitted = 0, unseen = 0, missingKeys = false;
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    if (!('slots' in it)) missingKeys = true;
    if (typeof it.name === 'string' && it.name) named++;
    if (Array.isArray(it.slots) && it.slots.length) slotted++;
    if (typeof it.icon === 'string' && it.icon) iconed++;
    if (it.fit && typeof it.fit === 'object') fitted++;
    if (Array.isArray(it.parts) && it.parts.length === 0) unseen++;
  }
  return { items: list.length, named, slotted, iconed, fitted, unseen, missingKeys };
}
