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

// ---------------------------------------------------------------------------------------------
// Customization: every slot of a hull with the components it takes and the model each shows, the
// stock pick, the droids, and the paint.
//
// A chassis row's slot cell (ship_chassis.iff: reactor, engine, shield_0, shield_1, armor_0, armor_1,
// capacitor, booster, droid_interface, bridge, hangar, targeting_station, cargo_hold, modification_0,
// modification_1, weapon_0..7) is a comma list of compatibility classes; an empty cell means the hull
// has no such slot. ship_components.iff gives every component a type and one class. The per-hull looks
// table is looser than the chassis both ways: a slot offers exactly the components whose class its cell
// lists (the table also shows models for components the slot refuses), and a looks column the chassis
// row gives no class is a fixed part, always its one look's first component (the Star Destroyer's 92
// turret bases, weapon_8..99).

/** The manifest's `fitFormat` for ships written with `fit`, and components.json's `format`. */
export const SHIP_FIT_FORMAT = 1;

const norm = (p) => String(p ?? '').trim().replace(/\\/g, '/').replace(/^\//, '');

/** A component name as the tables key it (seventeen armour names carry '.iff'): 'armor_test.iff' -> 'armor_test'. */
export function componentKey(name) {
  return String(name ?? '').trim().replace(/\.iff$/i, '');
}

/** A chassis cell's compatibility classes: split at commas, trimmed, lower case, anything but [a-z0-9_] dropped. */
export function compatClasses(cell) {
  return String(cell ?? '')
    .split(',')
    .map((c) => c.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''))
    .filter(Boolean);
}

/**
 * One looks-table column grouped by identical non-empty cell, in first-seen order, each group with the
 * names of the components that show it (table order, once each), keeping only names `accept` takes: a
 * cell only rows `accept` refuses show makes no group. Rows are the table's, keyed by column, with the
 * component's name under `component`. -> [{ cell, pairs, names }]
 */
export function groupLooks(rows, column, accept = () => true) {
  const groups = new Map();
  for (const row of rows ?? []) {
    const cell = String(row?.[column] ?? '').trim();
    if (!cell) continue;
    const name = componentKey(row.component);
    if (!name || !accept(name)) continue;
    let g = groups.get(cell);
    if (!g) {
      const pairs = parseLookCell(cell);
      if (!pairs.length) continue;
      g = { cell, pairs, names: [] };
      groups.set(cell, g);
    }
    if (!g.names.includes(name)) g.names.push(name);
  }
  return [...groups.values()];
}

/** Hidden from the list and never stock: test and placeholder components. */
export const HIDDEN_COMPONENT = /(^|_)test(_|$)/;

/** Ranked last for stock: loot, rewards, crafted and event pieces. */
export const SPECIAL_COMPONENT = /reward|collection|mission|kessel|nova_|orion|npe|prototype|elite|experimental|crafted|generic|heroic|quest/;

/** Words naming a particular craft: a component named for another craft is ranked after one that is not. */
export const CRAFT_TOKENS = ['awing', 'xwing', 'ywing', 'bwing', 'vwing', 'z95', 'tie', 'tiefighter', 'tieinterceptor', 'tieadvanced',
  'tiebomber', 'tieaggressor', 'tieoppressor', 'arc170', 'yt1300', 'yt2400', 'firespray', 'decimator', 'corvette', 'n1', 'ykl37r',
  'hutt', 'blacksun', 'y8', 'vaksai'];

/** The looks-table columns that are slots: every column after the first, the component's name. */
function lookColumns(hullTable) {
  return (hullTable?.columns ?? []).slice(1);
}

/**
 * The hull's slots: the chassis row's non-empty slot cells in `slotNames` order, each with its classes
 * and looks (groupLooks over the compatible components that are not hidden; a component the table lists
 * but the slot does not accept is in no look); then one fixed slot per looks column the chassis row
 * gives no class (in column order), whose looks are that column's groups over every listed component.
 * A fixed column no listed component shows is left out. `components` is [{ name, compat }], the index
 * of each being the component's id (components.json's order).
 *  -> [{ slot, compat: string[], looks: [{ cell, pairs, components: number[] }], fixed?: true }]
 */
export function buildSlots(row, slotNames, hullTable, components) {
  const list = components ?? [];
  const index = new Map(list.map((c, i) => [componentKey(c.name), i]));
  const classes = list.map((c) => compatClasses(c.compat));
  const columns = lookColumns(hullTable);
  const shown = new Set(columns);
  const rows = hullTable?.rows ?? [];
  const toLook = (g) => ({ cell: g.cell, pairs: g.pairs, components: g.names.map((n) => index.get(n)) });
  const out = [];
  const listed = new Set();
  for (const slot of slotNames ?? []) {
    const compat = compatClasses(row?.[slot]);
    if (!compat.length) continue;
    listed.add(slot);
    const accept = (n) => {
      const i = index.get(n);
      return i !== undefined && !HIDDEN_COMPONENT.test(n) && classes[i].some((c) => compat.includes(c));
    };
    out.push({ slot, compat, looks: shown.has(slot) ? groupLooks(rows, slot, accept).map(toLook) : [] });
  }
  for (const column of columns) {
    if (listed.has(column)) continue;
    const looks = groupLooks(rows, column, (n) => index.has(n)).map(toLook);
    if (looks.length) out.push({ slot: column, compat: [], looks, fixed: true });
  }
  return out;
}

/** The chassis name's own words: split on '_', without 'player' and style words (s01); plus 'tie' when a word starts with it. */
export function hullTokens(chassis) {
  const words = String(chassis ?? '')
    .toLowerCase()
    .split('_')
    .filter((w) => w && w !== 'player' && !/^s\d+$/.test(w));
  if (words.some((w) => w.startsWith('tie'))) words.push('tie');
  return [...new Set(words)];
}

/** The index of the look shown by the most components (ties to the earlier look), or -1 when the slot has none. */
export function modalLook(slot) {
  let best = -1;
  let most = 0;
  (slot?.looks ?? []).forEach((l, i) => {
    if (l.components.length > most) {
      most = l.components.length;
      best = i;
    }
  });
  return best;
}

/** The look of a slot that shows component `componentIdx`, or -1 (none, or a component with no model on this hull). */
export function lookOfComponent(slot, componentIdx) {
  if (componentIdx === undefined || componentIdx === null || componentIdx < 0) return -1;
  return (slot?.looks ?? []).findIndex((l) => l.components.includes(componentIdx));
}

/**
 * The stock component for a slot (a name, or null), deterministic:
 *  - a slot matching STOCK_LEFT_OUT (a modification: one reward look, never the ship as sold) has none;
 *  - a fixed slot takes its first look's first component;
 *  - the candidates are the modal look's components when the slot has looks, else every compatible,
 *    not hidden one;
 *  - `preferName` (the gun the ship was always given, defaultWeaponFor) when it is a candidate;
 *  - else the candidate with the lowest rank, ties in table order, where
 *      rank = 8·SPECIAL + 4·(names another craft) + 2·(names none of the hull's words longer than two
 *             letters) + 1·(a weapon slot, and its projectile is not `preferProjectile`);
 *  - null when there is no candidate.
 * `weaponOf(name)` is a weapon's projectile index (or a record with `projectile`), undefined for none.
 */
export function pickStock(slot, components, { tokens = [], preferName = null, preferProjectile = null, weaponOf = () => undefined } = {}) {
  if (!slot || STOCK_LEFT_OUT.test(slot.slot)) return null;
  const list = components ?? [];
  const nameAt = (i) => (i === undefined || i === null ? null : list[i]?.name ?? null);
  if (slot.fixed) return nameAt(slot.looks?.[0]?.components?.[0]);
  const modal = modalLook(slot);
  const candidates = (modal >= 0
    ? slot.looks[modal].components.map(nameAt)
    : list.filter((c) => compatClasses(c.compat).some((k) => slot.compat.includes(k))).map((c) => c.name)
  ).filter((n) => n && !HIDDEN_COMPONENT.test(n));
  if (!candidates.length) return null;
  if (preferName && candidates.includes(preferName)) return preferName;
  const mine = new Set(tokens);
  const craft = new Set(CRAFT_TOKENS);
  const weapon = /^weapon_/.test(slot.slot);
  const projectileOf = (n) => {
    const w = weaponOf(n);
    return Number(w !== null && typeof w === 'object' ? w.projectile : w);
  };
  const rank = (n) => {
    const words = n.split('_');
    return (
      (SPECIAL_COMPONENT.test(n) ? 8 : 0) +
      (words.some((w) => craft.has(w) && !mine.has(w)) ? 4 : 0) +
      (words.some((w) => w.length > 2 && mine.has(w)) ? 0 : 2) +
      (weapon && preferProjectile !== null && preferProjectile !== undefined && projectileOf(n) !== Number(preferProjectile) ? 1 : 0)
    );
  };
  let best = null;
  let bestRank = Infinity;
  for (const n of candidates) {
    const r = rank(n);
    if (r < bestRank) {
      best = n;
      bestRank = r;
    }
  }
  return best;
}

/**
 * The stock parts for assembleShip, from slots that carry their `stock`: each stocked slot's look
 * pairs as { slot, attachment, hardpoint }, the slots in the looks table's column order (the order
 * the stock parts have always been hung in), a slot whose stock shows no model giving none.
 */
export function stockPairs(slots, components, columns = []) {
  const index = new Map((components ?? []).map((c, i) => [c.name, i]));
  const at = (slot) => {
    const i = columns.indexOf(slot);
    return i < 0 ? Infinity : i;
  };
  const stocked = (slots ?? [])
    .filter((s) => s.stock)
    .map((s) => ({ s, look: lookOfComponent(s, index.get(s.stock)) }))
    .filter((x) => x.look >= 0)
    .sort((a, b) => at(a.s.slot) - at(b.s.slot));
  return stocked.flatMap(({ s, look }) => s.looks[look].pairs.map((p) => ({ slot: s.slot, attachment: p.attachment, hardpoint: p.hardpoint })));
}

/** A readable name for a component with no string: 'wpn_corvette_turret_sm_s01', 'weapon' -> 'Weapon (corvette turret sm s01)'. */
export function fallbackLabel(name, type) {
  const words = componentKey(name).split('_').filter(Boolean);
  const rest = (words.length > 1 ? words.slice(1) : words).join(' ');
  const kind = String(type ?? '').replace(/_/g, ' ').trim() || 'component';
  return `${kind[0].toUpperCase()}${kind.slice(1)} (${rest})`;
}

/**
 * A weapon's record from its ship_weapon_components row: projectile, speed and range, and a flag (1)
 * for each of missile, countermeasure, tractor, beam and mining it is; null for no row.
 */
export function componentWeapon(row) {
  if (!row) return null;
  const w = { projectile: Number(row.projectile_index), speed: Number(row.speed), range: Number(row.range) };
  for (const k of ['missile', 'countermeasure', 'tractor', 'beam', 'mining']) if (Number(row[k])) w[k] = 1;
  return w;
}

/**
 * components.json's `components`: one entry per ship_components row that is not hidden, in table order
 * (a name listed twice once), { name, type, compat, label, template, weapon? }. `labelOf(name, row)` is
 * the in-game name or null (then fallbackLabel); `weaponRow(name)` the weapon table's row or null.
 */
export function componentList(rows, { labelOf = () => null, weaponRow = () => null } = {}) {
  const out = [];
  const seen = new Set();
  for (const r of rows ?? []) {
    const name = componentKey(r.name);
    if (!name || HIDDEN_COMPONENT.test(name) || seen.has(name)) continue;
    seen.add(name);
    const type = String(r.component_type ?? '').trim();
    const weapon = componentWeapon(weaponRow(name));
    out.push({ name, type, compat: String(r.compatibility ?? '').trim(), label: labelOf(name, r) || fallbackLabel(name, type), template: norm(r.shared_object_template), ...(weapon ? { weapon } : {}) });
  }
  return out;
}

/**
 * The gun a ship fires as sold: the stock component of its first weapon slot whose stock is a bolt (not
 * a missile, countermeasure, tractor or beam), as { name, projectile, speed, range }; null for none.
 */
export function stockWeapon(fit, components) {
  const byName = new Map((components ?? []).map((c) => [c.name, c]));
  for (const s of fit?.slots ?? []) {
    if (!/^weapon_/.test(s.slot) || !s.stock) continue;
    const w = byName.get(s.stock)?.weapon;
    if (!w || w.missile || w.countermeasure || w.tractor || w.beam) continue;
    return { name: s.stock, projectile: w.projectile, speed: w.speed, range: w.range };
  }
  return null;
}

/**
 * The per-ship heads an astromech is drawn as (ship_droid_appearance_override.iff: ship, ground_appearance,
 * space_appearance): ground appearance -> [{ ship: garage id, appearance }], each row whose ship is one
 * of `templates` (matched by file name), `idOf(template)` giving the garage id.
 */
export function droidHeadRows(rows, templates, idOf) {
  const byFile = new Map((templates ?? []).map((t) => [norm(t).replace(/^.*\//, '').toLowerCase(), t]));
  const out = new Map();
  for (const r of rows ?? []) {
    const ground = norm(r.ground_appearance).toLowerCase();
    const space = norm(r.space_appearance);
    const template = byFile.get(norm(r.ship).replace(/^.*\//, '').toLowerCase());
    if (!ground || !space || !template) continue;
    (out.get(ground) ?? out.set(ground, []).get(ground)).push({ ship: idOf(template), appearance: space });
  }
  return out;
}

/**
 * components.json's `droids`, from datatables/space_command/programmable_droids.iff's templates in table
 * order: a flight computer per object/intangible/ship/ template ({ id: 'navicomputer_N', kind: 'computer',
 * label, model: null }), and an astromech per pet appearance (the crafted and plain templates share one:
 * { id: 'r2', kind: 'astromech', label: 'R2 unit', model: 'mobiles/models/astromech_r2.glb', heads? }),
 * left out with a note when the mobiles pack does not hold its model.
 * deps: appearanceOf(template) -> path | null; localize(stringId) -> text | null; hasModel(packPath) -> boolean;
 *       headsFor(appearance) -> { [garage id]: 'ships/<file>' }.
 */
export function buildDroids(templates, { appearanceOf, localize = () => null, hasModel = () => false, headsFor = () => ({}) }) {
  const droids = [];
  const notes = [];
  const seen = new Set();
  for (const raw of templates ?? []) {
    const t = norm(raw).toLowerCase();
    if (!t) continue;
    const base = t.replace(/^.*\//, '').replace(/^shared_/, '').replace(/\.iff$/, '');
    if (t.startsWith('object/intangible/ship/')) {
      if (seen.has(base)) continue;
      seen.add(base);
      droids.push({ id: base, kind: 'computer', label: localize(`space/space_item:${base}_n`) || fallbackLabel(base, 'flight computer'), model: null });
      continue;
    }
    const appearance = norm(appearanceOf(raw) ?? '').toLowerCase();
    if (!appearance) {
      notes.push(`${t}: no appearance, left out`);
      continue;
    }
    if (seen.has(appearance)) continue;
    seen.add(appearance);
    const id = base.replace(/_crafted$/, '');
    const model = `mobiles/models/${appearance.replace(/^.*\//, '').replace(/\.[^.]+$/, '')}.glb`;
    if (!hasModel(model)) {
      notes.push(`${id}: ${model} is not in the pack (the mobiles command converts it), left out`);
      continue;
    }
    const name = localize(`mob/creature_names:${id}`);
    const label = name ? name.trim().replace(/^(an?|the)\s+/i, '') : `${id.toUpperCase()} unit`;
    const heads = headsFor(appearance) ?? {};
    droids.push({ id, kind: 'astromech', label: label ? `${label[0].toUpperCase()}${label.slice(1)}` : id, model, ...(Object.keys(heads).length ? { heads } : {}) });
  }
  return { droids, notes };
}

/** The palette names that are not paint: a hologram's colours (the Black Sun transport's holo shader). */
export const HOLOGRAM_PALETTE = /hologram/i;

/**
 * Whether a loaded shader (texrender's loadShader) is ship paint: it has customization variables, a
 * fixed-function effect with passes (which the bake and the game's port run), and no hologram palette.
 */
export function isPaintShader(shader) {
  if (!shader?.effect?.passes?.length || !shader.variables?.length) return false;
  return !(shader.paletteFactors ?? []).some((p) => HOLOGRAM_PALETTE.test(p.palette ?? ''));
}

/**
 * One variable list for a hull from its paint shaders ([{ path, variables }], variables as loadShader
 * gives them): an index variable takes the largest count and records the smallest (`fewest`); a palette
 * variable its first palette (a second palette for it is noted and kept out) with `paletteSize(path)`
 * colours; each default from the first shader that names the variable. The pattern comes first, then
 * the colours by name (the shaders' TFAC order varies: the YT-1300's names colour 2 before colour 1).
 *  -> { variables: [{ name, kind: 'index'|'palette', count?, fewest?, palette?, size?, default }], notes }
 */
export function mergePaintVariables(shaders, paletteSize = () => 0) {
  const byName = new Map();
  const notes = [];
  for (const sh of shaders ?? []) {
    for (const v of sh.variables ?? []) {
      const kind = v.kind === 'palette' ? 'palette' : 'index';
      const m = byName.get(v.name);
      if (!m) {
        byName.set(v.name, kind === 'index' ? { name: v.name, kind, count: v.max, fewest: v.max, default: v.default } : { name: v.name, kind, palette: v.palette, size: paletteSize(v.palette), default: v.default });
        continue;
      }
      if (m.kind !== kind) notes.push(`${sh.path}: ${v.name} is a ${kind} variable here and a ${m.kind} one in another shader; the first is kept`);
      else if (kind === 'index') {
        m.count = Math.max(m.count, v.max);
        m.fewest = Math.min(m.fewest, v.max);
      } else if (v.palette !== m.palette) notes.push(`${sh.path}: ${v.name} picks from ${v.palette}, another shader from ${m.palette}; the first is kept`);
    }
  }
  const short = (n) => n.replace(/^.*\//, '');
  const order = (a, b) => (a.kind !== b.kind ? (a.kind === 'index' ? -1 : 1) : short(a.name).localeCompare(short(b.name), 'en', { numeric: true }) || a.name.localeCompare(b.name, 'en'));
  return { variables: [...byName.values()].sort(order), notes };
}

/**
 * A baked image (texrender's bakeShader: the colour of every pass, the alpha the first pass's, which
 * is opaque on every paint shader) with its alpha put back from the chosen pattern's own MAIN (`chosen`,
 * the same size, as bakeShader bakes at the base texture's size): that alpha is the gloss mask and a
 * MAIN-alpha glow's mask, as the game's repaint reads them. A differently sized or missing `chosen`
 * leaves the bake as it is. The bake's pixels are changed in place; `hasAlpha` is left out, so the
 * reader works it out from the pixels.
 *  -> { width, height, rgba }
 */
export function withPatternAlpha(baked, chosen) {
  const rgba = baked.rgba;
  if (chosen?.rgba && chosen.width === baked.width && chosen.height === baked.height && chosen.rgba.length === rgba.length) {
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = chosen.rgba[i];
  }
  return { width: baked.width, height: baked.height, rgba };
}

/**
 * A ship paint shader's main image as the ships command bakes it (surface.mjs's `mainImage`): a loaded
 * shader that is paint (isPaintShader) baked at its defaults, every pass (`bake`, texrender's
 * bakeShader), its alpha the chosen pattern's (withPatternAlpha), named for the chosen pattern's MAIN
 * and the shader, since two paint shaders on one pattern differ by their colours. Null for anything
 * else, or when the bake has nothing to bake.
 *  -> { path, width, height, rgba } | null
 */
export function paintedMainImage(shader, shaderPath, bake) {
  if (!isPaintShader(shader)) return null;
  const img = bake(shader, 'MAIN');
  if (!img) return null;
  return { path: `${shader.textureFiles.get('MAIN')}#paint:${shaderPath}`, ...withPatternAlpha(img, shader.textures.get('MAIN')) };
}

/**
 * How a paint shader glows, for its recipe (`glow`), from surface.mjs's describeSurface: a mask glow's
 * tag, channel and whether the lit image keeps the texture's alpha (it does unless the mask is the main
 * texture's own alpha, surfaceTexture's rule); null when the shader does not glow by a mask.
 */
export function paintGlow(described) {
  const em = described?.emissive;
  if (em?.kind !== 'mask') return null;
  const own = em.slot === (described.mainSlot ?? 'MAIN');
  return { maskTag: em.slot, channel: em.channel, keepAlpha: !(own && em.channel === 'a') };
}

/**
 * A paint shader trimmed for export: its textures keep only the tags some pass's stage reads, or that
 * `keep` names (a glow's mask), and that no texture choice sets (CNRM goes, and the static shader's own
 * MAIN and HUEB, every choice replacing them). `staticMain` is the static shader's own MAIN path (the
 * look before customization), kept by name for the game to show on request; without it, the MAIN the
 * shader binds when no choice sets MAIN.
 *  -> { shader, staticMain }
 */
export function trimPaintShader(shader, { staticMain = null, keep = [] } = {}) {
  const read = new Set();
  for (const p of shader?.effect?.passes ?? []) for (const st of p.stageList ?? []) if (st.textureTag) read.add(st.textureTag);
  const chosen = new Set((shader?.textureChoices ?? []).map((c) => c.tag));
  const kept = new Set(keep ?? []);
  const want = ([tag]) => (read.has(tag) || kept.has(tag)) && !chosen.has(tag);
  const textureFiles = new Map([...(shader?.textureFiles ?? [])].filter(want));
  const textures = new Map([...(shader?.textures ?? [])].filter(want));
  return { shader: { ...shader, textureFiles, textures }, staticMain: staticMain ?? (chosen.has('MAIN') ? null : shader?.textureFiles?.get('MAIN') ?? null) };
}

/** A --match run's recipes: the old file's, each replaced by this run's recipe for the same material, then this run's new ones. */
export function mergeRecipes(existing, fresh) {
  const replace = new Map((fresh ?? []).map((r) => [r.material, r]));
  const had = new Set((existing ?? []).map((r) => r.material));
  return [...(existing ?? []).map((r) => replace.get(r.material) ?? r), ...(fresh ?? []).filter((r) => !had.has(r.material))];
}

/** Every image file a list of recipes names (bound textures, every choice, the static main). */
export function recipeImages(recipes) {
  const out = new Set();
  for (const r of recipes ?? []) {
    for (const f of Object.values(r.shader?.textures ?? {})) if (f) out.add(f);
    for (const c of r.shader?.choices ?? []) for (const f of c.files ?? []) if (f) out.add(f);
    if (r.staticMain) out.add(r.staticMain);
  }
  return out;
}

/** The ships log's clause for a ship's fit: its slots, how many show a model and are fixed, the droid socket, the paint. */
export function fitSummary(fit) {
  if (!fit) return 'no fit (no chassis tables)';
  const slots = fit.slots ?? [];
  const fixed = slots.filter((s) => s.fixed).length;
  const looks = slots.filter((s) => !s.fixed && s.looks.length).length;
  const choices = slots.filter((s) => !s.fixed).reduce((n, s) => n + s.looks.length, 0);
  const paint = fit.paint ? `paint ${fit.paint.shaders.length} shader${fit.paint.shaders.length === 1 ? '' : 's'} (${fit.paint.variables.map((v) => (v.kind === 'index' ? `${v.name} ${v.count}${v.fewest < v.count ? `/${v.fewest}` : ''}` : v.name)).join(', ')})` : 'no paint';
  return `fit: ${slots.length - fixed} slots (${looks} with models, ${choices} looks)${fixed ? `, ${fixed} fixed` : ''}, ${fit.droid === 'astromech' ? 'astromech socket' : 'flight computer'}, ${paint}`;
}

/**
 * The ships converter's closing line: ships with a fit (and their fixed slots), the distinct part models
 * the looks name, the droids and the per-ship heads, and the paint.
 * paint: { shaders, images, bytes } (the recipes written, the images and their bytes).
 */
export function loadoutsLine(fits, droids, paint = { shaders: 0, images: 0, bytes: 0 }) {
  const list = (fits ?? []).filter(Boolean);
  const fixed = list.reduce((n, f) => n + f.slots.filter((s) => s.fixed).length, 0);
  const files = new Set();
  for (const f of list) for (const s of f.slots) for (const l of s.looks) for (const p of l.parts ?? []) files.add(p.file);
  const astromechs = (droids ?? []).filter((d) => d.kind === 'astromech');
  const computers = (droids ?? []).filter((d) => d.kind === 'computer').length;
  const headShips = new Set(astromechs.flatMap((d) => Object.keys(d.heads ?? {})));
  const heads = astromechs.reduce((n, d) => n + Object.keys(d.heads ?? {}).length, 0);
  return `loadouts: ${list.length} ships (${fixed} fixed slots), ${files.size} part models; droids: ${astromechs.length} astromechs, ${computers} flight computers, ${heads} heads${headShips.size ? ` (${[...headShips].join(', ')})` : ''}; paint: ${list.filter((f) => f.paint).length} ships, ${paint.shaders} shaders, ${paint.images} images (${(paint.bytes / 1e6).toFixed(0)} MB)`;
}

/**
 * The ships pack's loadouts as status reads them: `fitted` ships with a fit, `painted` those with paint,
 * `astromechs` in components.json, and `old` the ships converted before loadouts were written (all of
 * them when the manifest's fitFormat is not this one, else those with a chassis and no fit).
 */
export function fitStatus(manifest, components) {
  const ships = manifest?.ships ?? [];
  return {
    fitted: ships.filter((sh) => sh.fit).length,
    painted: ships.filter((sh) => sh.fit?.paint).length,
    astromechs: (components?.droids ?? []).filter((d) => d.kind === 'astromech').length,
    old: manifest?.fitFormat !== SHIP_FIT_FORMAT ? ships.length : ships.filter((sh) => sh.chassis && !sh.fit).length,
  };
}
