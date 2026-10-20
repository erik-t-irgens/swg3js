// Every prop and every piece of furniture in the game, as one pack a player can put down.
//
// The worlds' own packs already carry whatever their snapshots place, which is a few thousand models
// scattered over eighteen folders and keyed on where they happen to stand. This is the other thing:
// the whole catalogue, keyed on what a thing **is**, so the game can offer all of it and a player can
// stand any of it anywhere.
//
// What counts as a prop is everything under `object/tangible/`, `object/static/` and
// `object/installation/` that is not a weapon, a piece of armour, clothing, a ship part, a deed or a
// schematic -- the owner's rule, and those exclusions are things the game already has somewhere else
// of its own. Measured over the retail archives: 9,929 templates match, 8,967 of them resolve to a
// mesh, and those come to **3,002 distinct appearances**, because a template is a thing in the game
// and an appearance is a model and dozens of templates share one (every colour of a chair, every
// world's copy of a crate).
//
// Two of the four rules here are about not converting the same model twice. A prop is written once
// per appearance and every template that names it points at that one model, so the pack is three
// thousand models and nine thousand things rather than nine thousand of each.
//
// Dependency-free but for node's own modules; the conversion itself is handed in, so this stays
// testable. Shared with tools/swg/tests/props.test.ts.
import { oursId } from './oursEntries.mjs';

/** The pack this writes. A pack written by an older run is asked for again rather than read. */
export const PROPS_PACK_VERSION = 1;

/**
 * The skeletal props: a template whose appearance is a skeleton's (a `.sat`: the creature statues, the armour lying
 * about, the beast trophies) is stood still and written as an ordinary prop's model (cli.mjs `convertSat`'s `bake`).
 * A pack carries this number once it was written so; `status` asks for one that does not, since every skeletal
 * template was left out before (437 of them over SOE's final files), and the pack's version stays 1 so a build
 * that reads none of this reads the pack as it always did.
 */
export const PROPS_SKELETAL_FORMAT = 1;

/** The group the props of ours are shown under (oursEntries.mjs): one of their own, whatever folder their art is from. */
export const OURS_PROP_GROUP = 'ours';

/**
 * What counts as a prop: scenery and furniture, and nothing the game already has a home for.
 *
 * Kept as two patterns rather than a list of folders, because the archives' own tree is what says
 * what a thing is and a list would go stale the moment one more folder was read.
 */
export const PROP_ROOTS = /^object\/(tangible|static|installation)\//;
/**
 * And what is left out. Each of these the game already has a home for.
 *
 * `space/` is the one that is a judgement rather than an obvious exclusion, so it is said plainly:
 * those are the stations and the capital hulls, the `space` command already converts every one of
 * them into the zone it belongs to, and they are three hundred to seven hundred metres across --
 * nothing anybody places by hand. Measured, they are 115 models and **226 MB of the pack's 1,138**,
 * which is a fifth of it for nothing that is not already converted twice over.
 */
export const PROP_NOT = /^object\/(tangible|static)\/space\/|^object\/(tangible\/(wearables|armor|weapon|component|ship|deed|schematic|loot\/creature|hair)|draft_schematic)\//;

/**
 * The trading-card decorations are SOE's own retail props (the owner's default, the design's D16): `tcg/` left the
 * refused folders, which carried no reason for it. What of it is not a prop stays out [ours]: a template whose name
 * says it is a deed of some kind or an instant travel terminal (`PROP_TCG_NOT`), and one drawn as a datapad
 * (`PROP_TCG_DATAPAD`, the look every card's deed and voucher wears).
 */
export const PROP_TCG = /^object\/tangible\/tcg\//;
export const PROP_TCG_NOT = /structure_deed_|vehicle_deed_|deed_|instant_travel_terminal_/;
export const PROP_TCG_DATAPAD = /datapad/;

/**
 * Whether a template path is a prop this pack should carry. `appearanceOf(template)`, when given, names a
 * trading-card template's appearance, so one drawn as a datapad is left out.
 */
export function isProp(template, appearanceOf = null) {
  const t = String(template ?? '').toLowerCase().replace(/\\/g, '/');
  if (!/shared_[^/]+\.iff$/.test(t)) return false;
  if (!PROP_ROOTS.test(t) || PROP_NOT.test(t)) return false;
  if (PROP_TCG.test(t)) {
    if (PROP_TCG_NOT.test(t.split('/').pop())) return false;
    const app = appearanceOf?.(template);
    if (app && PROP_TCG_DATAPAD.test(String(app).toLowerCase())) return false;
  }
  return true;
}

/**
 * Which group a prop is shown under: the two folders below `object/`, which is the game's own
 * arrangement and is what a player is looking for when they scroll a list of three thousand things.
 */
export function propGroup(template) {
  const parts = String(template ?? '').replace(/\\/g, '/').split('/');
  return parts.slice(1, 3).join('/') || 'other';
}

/** A prop's own id: its template's file name, which is unique across the archives. */
export function propId(template) {
  return String(template ?? '')
    .replace(/^.*\//, '')
    .replace(/^shared_/, '')
    .replace(/\.iff$/, '');
}

/**
 * How big a thing is, in metres, from its bounds: what the list shows and what the placement's own
 * footprint is worked out from.
 */
export function propSize(bounds) {
  if (!bounds) return { w: 0, h: 0, d: 0 };
  const e = [0, 1, 2].map((k) => Math.abs(bounds.max[k] - bounds.min[k]));
  return { w: Number(e[0].toFixed(2)), h: Number(e[1].toFixed(2)), d: Number(e[2].toFixed(2)) };
}

/**
 * Build the pack.
 *
 * `deps.convert(template)` answers `{ model, file, bounds, icon }` or `{ skip }`; it is the caller's,
 * so this file opens no archive. `deps.describe(template, id)` is the backpack's own name,
 * description and slots reader; `deps.appearanceOf(template)` a template's appearance, for `isProp`.
 */
export function buildProps(templates, deps, { log = () => {}, limit = Infinity } = {}) {
  const props = [];
  const skipped = [];
  const reasons = new Map();
  const groups = new Map();
  let n = 0;
  for (const template of templates) {
    if (!isProp(template, deps.appearanceOf ?? null)) continue;
    if (n >= limit) break;
    n++;
    const r = deps.convert(template);
    if (!r || r.skip) {
      const why = String(r?.skip ?? 'failed').replace(/:.*$/, '');
      skipped.push({ template, why: r?.skip ?? 'failed' });
      reasons.set(why, (reasons.get(why) ?? 0) + 1);
      continue;
    }
    const id = propId(template);
    const group = propGroup(template);
    const entry = { id, template, group, model: r.model, file: r.file, bounds: r.bounds ?? null, size: propSize(r.bounds) };
    const d = deps.describe?.(template, id);
    if (d) Object.assign(entry, { name: d.name, description: d.description });
    if (r.icon !== undefined) entry.icon = r.icon;
    props.push(entry);
    groups.set(group, (groups.get(group) ?? 0) + 1);
  }
  for (const [g, c] of [...groups].sort((a, b) => b[1] - a[1])) log(`  ${String(c).padStart(5)}  ${g}`);
  if (skipped.length) log(`left out: ${[...reasons].sort((a, b) => b[1] - a[1]).map(([w, c]) => `${c} ${w}`).join('; ')}`);
  return { props, skipped };
}

/**
 * The props of ours (oursEntries.mjs): each table row stood as a template's prop is, by `deps.convert(row)` (`{ model,
 * file, bounds, icon }` or `{ skip }`), in the group of their own, named as the table names it and marked ours. A row
 * whose appearance `deps.has` says the mount has not got is left out and counted (`missing`), never an error.
 */
export function buildOursProps(rows, deps) {
  const props = [];
  const skipped = [];
  let missing = 0;
  for (const row of rows ?? []) {
    if (!deps.has(row.appearance)) {
      missing++;
      continue;
    }
    const r = deps.convert(row);
    if (!r || r.skip) {
      skipped.push({ template: null, appearance: row.appearance, why: r?.skip ?? 'failed' });
      continue;
    }
    const id = oursId(row);
    props.push({ id, template: null, group: OURS_PROP_GROUP, model: r.model, file: r.file, bounds: r.bounds ?? null, size: propSize(r.bounds), name: row.name, description: null, ...(r.icon !== undefined ? { icon: r.icon } : {}), ours: true });
  }
  return { props, skipped, missing };
}

/** What `status` reads back. */
export function propCounts(manifest) {
  const props = manifest?.props ?? [];
  const skeletalModels = new Set((manifest?.models ?? []).filter((m) => m.skeletal).map((m) => m.id));
  return {
    props: props.length,
    models: new Set(props.map((p) => p.model)).size,
    groups: new Set(props.map((p) => p.group)).size,
    named: props.filter((p) => p.name).length,
    iconed: props.filter((p) => p.icon).length,
    skeletal: props.filter((p) => skeletalModels.has(p.model)).length,
    ours: props.filter((p) => p.ours).length,
  };
}
