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

/** The pack this writes. A pack written by an older run is asked for again rather than read. */
export const PROPS_PACK_VERSION = 1;

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
export const PROP_NOT = /^object\/(tangible|static)\/space\/|^object\/(tangible\/(wearables|armor|weapon|component|ship|deed|schematic|loot\/creature|hair|tcg)|draft_schematic)\//;

/** Whether a template path is a prop this pack should carry. */
export function isProp(template) {
  const t = String(template ?? '').toLowerCase().replace(/\\/g, '/');
  if (!/shared_[^/]+\.iff$/.test(t)) return false;
  return PROP_ROOTS.test(t) && !PROP_NOT.test(t);
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
 * description and slots reader.
 */
export function buildProps(templates, deps, { log = () => {}, limit = Infinity } = {}) {
  const props = [];
  const skipped = [];
  const reasons = new Map();
  const groups = new Map();
  let n = 0;
  for (const template of templates) {
    if (!isProp(template)) continue;
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

/** What `status` reads back. */
export function propCounts(manifest) {
  const props = manifest?.props ?? [];
  return {
    props: props.length,
    models: new Set(props.map((p) => p.model)).size,
    groups: new Set(props.map((p) => p.group)).size,
    named: props.filter((p) => p.name).length,
    iconed: props.filter((p) => p.icon).length,
  };
}
