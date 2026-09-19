// The NPC ships the game's space zones were flown with, read without the archives (every table is
// handed in parsed, and every conversion is a callback), for the ships command's combat.json.
//
// An NPC ship template (object/ship/shared_<family>_tier<N>.iff) resolves to the same appearance and
// client data as the player ship of that family, so each type is drawn with the garage hull whose
// template has its appearance. Its chassis row in datatables/space/ship_chassis.iff is the type's own
// name, else the name with the style dropped (blacksun_light_s01_tier1 reads blacksun_light_tier1). The
// per-hull tier tables (ship_chassis_<chassis>.iff) are look tables, the same at every tier: which
// components an NPC carried was the server's and did not ship, so the game picks them (src/space).
//
// Also read here: the formation tables (datatables/space/formation/{arrow,claw,wall}.iff, 20 slots of
// X, Y, Z in metres in the leader's frame, then X2D, Z2D for the same slots on one plane), the taunt
// string tables (string/en/space/taunts/*.stf: entercombat, gothit, hityou, death 1 to 5), the hit
// effects per layer (ship_hit_effects.iff), the hit sounds per group (ship_hit_sounds.iff) and the
// targeting effects (ship_target_appearance.iff, whose `target_acquired_appearance` column is named
// twice, so a parsed row keeps only the second, a sound).

import { compatClasses } from './shipfit.mjs';

/** combat.json's `version`. A reader treats any other number as no file. */
export const COMBAT_FORMAT = 1;

/**
 * The side each family flies for. The server decided this; the table is invented, after the game's own
 * names (the TIEs are the Empire's, the Alliance flew the lettered wings, the Hutts and the Z-95s are the
 * pirates' as the taunt tables have them). A family none of these matches is neutral.
 */
export const NPC_FACTIONS = { imperial: /^tie/, rebel: /^(xwing|ywing|awing|bwing|arc170)$/, blacksun: /^blacksun_/, pirate: /^(hutt_|z95$|firespray$)/ };

/**
 * Tiered families that are not the space-mobile ladder: on the retail archives only the nova_orion_*
 * quest line's (tiers up to 10) are tiered; the new-player and prototype hull names are kept here in case
 * a tiered template ever carries one.
 */
export const NOT_LADDER = /^(nova_orion_|basic_|prototype_|experimental_ship)|_npe$/;

/** The taunt tables the game reads (each with its `_low` for tiers 1 and 2). */
export const TAUNT_TABLES = ['imperial', 'imperial_low', 'rebel', 'rebel_low', 'blacksun', 'blacksun_low', 'hutt', 'hutt_low', 'generic', 'generic_low'];

/** The formation tables, in the order they are written. */
export const FORMATIONS = ['arrow', 'claw', 'wall'];

/** The hit layers, outermost first. */
export const HIT_LAYERS = ['shield', 'armor', 'component', 'chassis'];

const TAUNT_EVENTS = ['entercombat', 'gothit', 'hityou', 'death'];
const norm = (p) => String(p ?? '').trim().replace(/\\/g, '/').replace(/^\//, '');
const round = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(4)) || 0 : 0;
};
const idOf = (template) => norm(template).replace(/^.*\//, '').replace(/^shared_/, '').replace(/\.iff$/i, '');

/**
 * 'blacksun_light_s01_tier3' -> { family: 'blacksun_light_s01', base: 'blacksun_light', style: 's01', tier: 3 };
 * null for an untiered id or a tier outside 1 to 5.
 */
export function typeParts(id) {
  const m = /^(.+)_tier(\d+)$/.exec(String(id ?? ''));
  if (!m) return null;
  const tier = Number(m[2]);
  if (tier < 1 || tier > 5) return null;
  const family = m[1];
  const s = /^(.+)_(s\d+)$/.exec(family);
  return { family, base: s ? s[1] : family, style: s ? s[2] : null, tier };
}

/** The ship_chassis.iff row for a type: the id itself, else the id with its style dropped; null when neither is a row. `rows` has `has(name)`. */
export function chassisNameOf(id, rows) {
  if (!id || !rows) return null;
  if (rows.has(id)) return id;
  const p = typeParts(id);
  if (!p || !p.style) return null;
  const plain = `${p.base}_tier${p.tier}`;
  return rows.has(plain) ? plain : null;
}

/** A family's faction (NPC_FACTIONS, in its order), or 'neutral'. */
export function factionOf(family) {
  for (const [faction, re] of Object.entries(NPC_FACTIONS)) if (re.test(String(family ?? ''))) return faction;
  return 'neutral';
}

/**
 * The taunt table a type reads: the Empire, the Alliance and Black Sun their own; pirates on a Hutt hull
 * 'hutt', other pirates and the neutral 'generic'; tiers 1 and 2 the `_low` table (whose lines name nobody).
 */
export function tauntTableOf(faction, family, tier) {
  let table = 'generic';
  if (faction === 'imperial' || faction === 'rebel' || faction === 'blacksun') table = faction;
  else if (faction === 'pirate' && /^hutt_/.test(String(family ?? ''))) table = 'hutt';
  return Number(tier) <= 2 ? `${table}_low` : table;
}

/**
 * A formation table's rows ({ X, Y, Z, X2D, Z2D }) as { space: [[-X, Y, Z]...], flat: [[-X2D, 0, Z2D]...] }
 * in row order (row 0 the leader), X negated as every position the converter writes.
 */
export function formationOf(rows) {
  const list = rows ?? [];
  return {
    space: list.map((r) => [round(-r.X), round(r.Y), round(r.Z)]),
    flat: list.map((r) => [round(-r.X2D), 0, round(r.Z2D)]),
  };
}

/**
 * A taunt string table (Map name -> text) as { entercombat, gothit, hityou, death }, each the lines in
 * number order whatever order the table keeps them in; `%TU` and `%NU` left in.
 */
export function tauntsOf(strings) {
  const found = Object.fromEntries(TAUNT_EVENTS.map((e) => [e, []]));
  for (const [name, text] of strings ?? []) {
    const m = /^(entercombat|gothit|hityou|death)(\d+)$/.exec(String(name));
    if (m && text) found[m[1]].push([Number(m[2]), String(text)]);
  }
  return Object.fromEntries(TAUNT_EVENTS.map((e) => [e, found[e].sort((a, b) => a[0] - b[0]).map((x) => x[1])]));
}

/**
 * A chassis row's filled slots: { <slot>: { compat, hitweight, targetable } } in `slotNames` order; a slot
 * whose cell names no class is not the hull's. A missing weight is 10, the value of every retail cell.
 */
export function slotsOf(row, slotNames) {
  const out = {};
  for (const slot of slotNames ?? []) {
    const compat = compatClasses(row?.[slot]);
    if (!compat.length) continue;
    const w = Number(row[`${slot}_hitweight`]);
    out[slot] = { compat, hitweight: Number.isFinite(w) ? w : 10, targetable: !!Number(row[`${slot}_targetable`]) };
  }
  return out;
}

/**
 * ship_target_appearance.iff's rows as the file's `target`: the `default` row (else the first) at the top,
 * and in `overrides` only the chassis whose appearance, enemy appearance or scale differs from it, each
 * with the fields that differ. `particle(prt)` and `effect(cef)` turn a path into the pack's particle file
 * (both identity by default). With no rows, every effect is null and every sound ''.
 */
export function targetRowsOf(rows, { particle = (p) => p || null, effect = (c) => c || null } = {}) {
  const list = rows ?? [];
  const def = list.find((r) => r.ship_chassis === 'default') ?? list[0];
  if (!def) return { friendly: null, enemy: null, activate: null, activateEnemy: null, deactivate: null, scale: 1, hardpoint: '', sounds: { activate: '', deactivate: '', acquiring: '', acquired: '' }, overrides: {} };
  const scaleOf = (r) => {
    const s = Number(r.scale);
    return Number.isFinite(s) && s > 0 ? round(s) : 1;
  };
  const target = {
    friendly: particle(norm(def.appearance)),
    enemy: particle(norm(def.appearance_enemy)),
    activate: effect(norm(def.activate_effect)),
    activateEnemy: effect(norm(def.activate_effect_enemy)),
    deactivate: effect(norm(def.deactivate_effect)),
    scale: scaleOf(def),
    hardpoint: String(def.effect_hardpoint ?? '').trim(),
    sounds: {
      activate: norm(def.activate_sound),
      deactivate: norm(def.deactivate_sound),
      acquiring: norm(def.target_acquiring_sound),
      // The column is named twice; the parsed row keeps the second, the missile-locked sound.
      acquired: norm(def.target_acquired_appearance),
    },
    overrides: {},
  };
  for (const r of list) {
    if (r === def || !r.ship_chassis) continue;
    const o = {};
    if (norm(r.appearance).toLowerCase() !== norm(def.appearance).toLowerCase()) o.friendly = particle(norm(r.appearance));
    if (norm(r.appearance_enemy).toLowerCase() !== norm(def.appearance_enemy).toLowerCase()) o.enemy = particle(norm(r.appearance_enemy));
    if (scaleOf(r) !== target.scale) o.scale = scaleOf(r);
    if (Object.keys(o).length) target.overrides[r.ship_chassis] = o;
  }
  return target;
}

/** ship_hit_effects.iff's rows as the file's `hitEffects`: per layer, [light, medium, heavy] hits and events through `effect(cef)`. */
export function hitEffectsOf(rows, effect = (c) => c || null) {
  const out = {};
  for (const r of rows ?? []) {
    const layer = String(r.type ?? '').trim().toLowerCase();
    if (!HIT_LAYERS.includes(layer)) continue;
    out[layer] = {
      hit: ['hit_light', 'hit_medium', 'hit_heavy'].map((c) => (norm(r[c]) ? effect(norm(r[c])) : null)),
      event: ['event_light', 'event_medium', 'event_heavy'].map((c) => (norm(r[c]) ? effect(norm(r[c])) : null)),
    };
  }
  return out;
}

/** ship_hit_sounds.iff's rows as the file's `hitSounds`: by group ('' the default), each layer's sound. */
export function hitSoundsOf(rows) {
  const out = {};
  for (const r of rows ?? []) out[String(r.type ?? '').trim()] = Object.fromEntries(HIT_LAYERS.map((l) => [l, norm(r[l])]));
  return out;
}

/**
 * A manifest ship's destruction effect and damage bands for the file's `hulls`: `destroyed` through
 * `effect(cef)`, each band's particle through `particle(prt)` (a band whose particle does not convert is
 * left out), its position with X negated.
 */
export function hullFxOf(ship, { particle = (p) => p || null, effect = (c) => c || null } = {}) {
  const damage = [];
  for (const d of ship?.damage ?? []) {
    const file = d.particle ? particle(norm(d.particle)) : null;
    if (!file) continue;
    const p = Array.isArray(d.position) && d.position.length >= 3 ? [round(-d.position[0]), round(d.position[1]), round(d.position[2])] : null;
    damage.push({ from: round(d.from), to: round(d.to), hardpoint: d.hardpoint || null, position: p, particle: file });
  }
  return { destroyed: ship?.destroyed ? effect(norm(ship.destroyed)) : null, damage };
}

/** Words for a type the name table does not have: 'tieinterceptor_imperial_guard' -> 'Tieinterceptor Imperial Guard'. */
export function wordsOf(family) {
  return String(family ?? '')
    .split('_')
    .filter(Boolean)
    .map((w) => (/^s\d+$/.test(w) ? w.toUpperCase() : `${w[0].toUpperCase()}${w.slice(1)}`))
    .join(' ');
}

/**
 * The whole combat file but the tier fits.
 * deps:
 *   templates      NPC template paths (object/ship/shared_*.iff; anything untiered is passed over)
 *   appearanceOf   (template) -> appearance path | null
 *   ships          the ships manifest's entries ({ id, template, chassis?, fit?, damage?, destroyed? })
 *   chassisRows    Map name -> ship_chassis.iff row;  slotNames: its slot columns
 *   nameOf         (id) -> the space_mobile_type line | null (a type without one takes another tier's, else words)
 *   formations     { arrow: rows | null, claw, wall }
 *   taunts         { <table>: Map name -> text | null }
 *   hitEffectRows, hitSoundRows, targetRows: the tables' rows (or null)
 *   particle(prt), effect(cef): a path to the pack's particle file, or null
 * A type's hull is the manifest ship whose template has its appearance: the one whose id is the type's
 * family when that is among them, else the first by id.
 * Returns { file, chassisWanted: Map chassis -> hull ids (types' order), skipped, notes }.
 */
export function buildCombat(deps) {
  const notes = [];
  const particle = deps.particle ?? ((p) => p || null);
  const effect = deps.effect ?? ((c) => c || null);
  const rows = deps.chassisRows ?? new Map();
  const ships = deps.ships ?? [];
  const hullsByAppearance = new Map();
  for (const sh of ships) {
    let app = null;
    try {
      app = norm(deps.appearanceOf(sh.template)).toLowerCase();
    } catch (err) {
      notes.push(`${sh.id}: appearance not read (${err.message})`);
    }
    if (!app) continue;
    if (!hullsByAppearance.has(app)) hullsByAppearance.set(app, []);
    hullsByAppearance.get(app).push(sh.id);
  }
  const types = [];
  const skipped = [];
  const chassisWanted = new Map();
  const seen = new Set();
  for (const template of [...(deps.templates ?? [])].map(norm).sort()) {
    const id = idOf(template);
    const parts = typeParts(id);
    if (!parts || NOT_LADDER.test(parts.family) || seen.has(id)) continue;
    seen.add(id);
    let app = null;
    try {
      app = norm(deps.appearanceOf(template)).toLowerCase();
    } catch (err) {
      notes.push(`${id}: appearance not read (${err.message})`);
    }
    const ids = app ? hullsByAppearance.get(app) : null;
    if (!ids?.length) {
      skipped.push({ id, why: app ? `no garage hull shares ${app}` : 'no appearance' });
      continue;
    }
    const hull = ids.includes(parts.family) ? parts.family : [...ids].sort()[0];
    const chassis = chassisNameOf(id, rows);
    if (!chassis) {
      skipped.push({ id, why: `no chassis row (${id}${parts.style ? ` or ${parts.base}_tier${parts.tier}` : ''})` });
      continue;
    }
    const faction = factionOf(parts.family);
    // The name table misses a few tiers (four of the Imperial Guard interceptor's five): another tier's name, else words.
    let name = deps.nameOf?.(id) || null;
    for (let k = 1; !name && k <= 5; k++) name = deps.nameOf?.(`${parts.family}_tier${k}`) || null;
    name ||= wordsOf(parts.family);
    types.push({ id, name, family: parts.family, base: parts.base, style: parts.style, tier: parts.tier, hull, chassis, faction, taunts: tauntTableOf(faction, parts.family, parts.tier), template });
    if (!chassisWanted.has(chassis)) chassisWanted.set(chassis, []);
    if (!chassisWanted.get(chassis).includes(hull)) chassisWanted.get(chassis).push(hull);
  }
  types.sort((a, b) => a.family.localeCompare(b.family) || a.tier - b.tier);
  const chassis = {};
  const chassisRecord = (name) => {
    const row = rows.get(name);
    if (!row) return;
    const group = String(row.hit_sound_group ?? '').trim();
    chassis[name] = { slots: slotsOf(row, deps.slotNames), ...(group ? { hitSounds: group } : {}) };
  };
  for (const name of chassisWanted.keys()) chassisRecord(name);
  for (const sh of ships) {
    const name = sh.fit?.chassis ?? sh.chassis;
    if (name && !chassis[name]) chassisRecord(name);
  }
  const formations = {};
  for (const n of FORMATIONS) if (deps.formations?.[n]?.length) formations[n] = formationOf(deps.formations[n]);
  const taunts = {};
  for (const t of TAUNT_TABLES) if (deps.taunts?.[t]) taunts[t] = tauntsOf(deps.taunts[t]);
  const hulls = {};
  for (const sh of ships) hulls[sh.id] = hullFxOf(sh, { particle, effect });
  const file = {
    version: COMBAT_FORMAT,
    formations,
    taunts,
    hitEffects: hitEffectsOf(deps.hitEffectRows, effect),
    hitSounds: hitSoundsOf(deps.hitSoundRows),
    target: targetRowsOf(deps.targetRows, { particle, effect }),
    chassis,
    types,
    hulls,
    skipped,
    counts: null,
  };
  file.counts = combatCounts(file);
  return { file, chassisWanted, skipped, notes };
}

/** The numbers the log line and status print, from the file as it stands (tier fits counted as they are filled in). */
export function combatCounts(file) {
  const types = file?.types ?? [];
  return {
    types: types.length,
    families: new Set(types.map((t) => t.family)).size,
    hulls: new Set(types.map((t) => t.hull)).size,
    skipped: (file?.skipped ?? []).length,
    fits: Object.values(file?.chassis ?? {}).filter((c) => c.fit).length,
    formations: Object.keys(file?.formations ?? {}).length,
    taunts: Object.keys(file?.taunts ?? {}).length,
    hitLayers: Object.keys(file?.hitEffects ?? {}).length,
    target: !!(file?.target && (file.target.friendly || file.target.enemy)),
  };
}

/** The ships command's log line for combat.json. */
export function combatLine(file) {
  const c = combatCounts(file);
  const noHull = (file?.skipped ?? []).filter((s) => /^no garage hull/.test(s.why)).length;
  const other = c.skipped - noHull;
  const left = c.skipped ? ` (${[noHull ? `${noHull} left out: no garage hull shares their appearance` : '', other ? `${other} left out for other reasons` : ''].filter(Boolean).join('; ')})` : '';
  return `combat: ${c.types} NPC ship types in ${c.families} families on ${c.hulls} hulls${left}, ${c.fits} tier fits, ${c.formations} formations, ${c.taunts} taunt tables, ${c.hitLayers} hit layers, target effects ${c.target ? 'yes' : 'no'}`;
}

/**
 * What status says of combat.json: the ships line's clause, and `stale` (missing, unreadable, another
 * version, or types with no tier fit at all, which is a run that could not read the component tables)
 * with the reason for its to-do.
 */
export function combatStatus(file) {
  if (!file) return { clause: 'no NPC ships', stale: true, why: 'the ships pack has no combat.json (NPC ships and space combat)' };
  if (file.version !== COMBAT_FORMAT) return { clause: 'no NPC ships', stale: true, why: `the ships pack's combat.json is version ${file.version ?? 'unknown'}, not ${COMBAT_FORMAT} (NPC ships and space combat)` };
  const c = combatCounts(file);
  const clause = `NPC ships: ${c.types} types on ${c.hulls} hulls, ${c.fits} tier fits`;
  if (c.types && !c.fits) return { clause, stale: true, why: "the ships pack's combat.json has no tier fits (the component tables were not read)" };
  return { clause, stale: false, why: null };
}
