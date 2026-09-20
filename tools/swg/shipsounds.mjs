// What a ship, a ship part and a vehicle sound like: the engine loop a fitted engine part carries,
// the booster's rocket loop, a hull's own thrusters and the sound it blows up with, the hit sounds
// per layer, and every ground vehicle's idle, speed-up, slow-down, run and water sounds.
//
// Everything here is a join: the sound bank already holds every template, and the client data
// readers already read the chunks. What was missing is who owns which file.
//
//   A ship part. The thing that carries an engine's sound is the attachment (the look), not the
//   component in the slot: `object/tangible/ship/attachment/engine/shared_xwing_engine_pos_s01.iff`
//   names `clientdata/ship/component/eng_xwing_pos_s01.cdf`, whose `ENGS > INTS > INFO` entries are
//   the run loop and the 25, 50 and 75% damage loops at a hardpoint of the part. A component only
//   chooses a look, and several components share one; the game hangs the look, and the fit and the
//   manifest both keep the look's template, so the template is the key. 230 of the 441 attachment
//   templates reach client data (187 distinct files, since a look on two hulls is one file), and 61
//   of them carry an engine set; six more engine sets sit in the archives with no attachment at all.
//
//   A booster. `FORM INTS` at the top level of a part's client data is the booster's loop at a
//   hardpoint: all 53 in the archives name `sound/shp_booster_rocket_lp.snd`, 44 of them reached by
//   a booster part and 8 on hulls whose booster is part of the hull (the TIEs, the yacht).
//
//   A hull. The ship template's chain names its client data as any object's does. Most hulls carry
//   only the effect they are destroyed by; the gunboats, the yacht and the corvette also carry a
//   `VTHR > VSND` set or an `ASND`, which is why a hull's engine is normally its engine part's.
//
//   A vehicle. Exactly one of the 63 vehicle templates in the archives names client data of its own
//   (the walker names a creature file), and the archives do not hold that file, so the template
//   chain is no route at all. The game's own route is the mount tables: the vehicle's `.sat` (its
//   appearance) through `logical_saddle_name_map` to a logical saddle, and that through
//   `saddle_appearance_map`, whose `client_data_filename` column names the file. 56 of that table's
//   68 rows fill it, and 60 of the 63 vehicle templates in the archives reach one this way.
//
// Nothing here re-reads a pack that is already converted except to look up ids: the ships manifest
// gives each hull its id, chassis and stock parts, and the ships pack is never rewritten.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseIff } from './iff.mjs';
import { parseDatatable } from './datatable.mjs';
import { resolveTemplateParam, stringParam } from './objtemplate.mjs';
import { parseClientEffect } from './shipdata.mjs';
import { chassisNameFor, modalLooks } from './shipfit.mjs';
import { parseClientDataSounds } from './soundsources.mjs';

/** Bumped whenever ships.json changes shape, so `status` can ask for a rerun. */
export const SHIP_SOUND_FORMAT = 2;

/** The hit layers, outermost first, as the ship hit tables order them. */
export const HIT_LAYERS = ['shield', 'armor', 'component', 'chassis'];

/** The three severities each hit layer names, in the table's own column order. */
export const HIT_STEPS = ['light', 'medium', 'heavy'];

const norm = (s) => String(s ?? '').replace(/\\/g, '/').replace(/^@+/, '').replace(/^\//, '').toLowerCase();
/** A file's own name without its folder, its extension or a `_hue` suffix, which is how the mount tables list an appearance. */
const stem = (s) => norm(s).replace(/^.*\//, '').replace(/\.[^.]+$/, '').replace(/_hue$/, '');

/**
 * INVENTED: which of the three power-sound sets a hull uses. `ship_power_sounds.iff` has one row
 * each for `default`, `xwing` and `tie`, and the three differ in exactly one pair of columns
 * (`default_disabled` and `default_enabled`: the generic, the Alliance's and the Empire's chime);
 * every other column is the same sound in all three rows. Which hull read which row was the
 * client's and is nowhere in the archives, so this takes the nearest thing the game's own data has:
 * the chassis row's `hit_sound_group`, whose nine values across the 494 chassis rows include
 * `xwing` (44 rows) and `tie` (77) -- the power table's own two named rows, spelled the same way --
 * against `yt1300`, `blockade_runner`, `republic_cruiser`, `star_destroyer`, the two mining
 * asteroids and 266 rows with none. A group that is not one of the two takes the generic row. Only
 * a hull whose row names no group at all falls back on the name it is known by, and being wrong
 * costs one chime.
 *
 * The runtime reads the same rule off the same column, so `power` is written into the joins as well
 * and the two cannot drift apart.
 */
export function powerSetOf(name, group = '') {
  const g = norm(group);
  if (g === 'tie' || g === 'xwing') return g;
  if (g) return 'default';
  const s = norm(name);
  if (/tie|imperial/.test(s)) return 'tie';
  if (/xwing|ywing|awing|bwing|z95|rebel/.test(s)) return 'xwing';
  return 'default';
}

/**
 * INVENTED (linked by name, as the design says): the idle, speed-up and slow-down sounds that go
 * with an engine's run loop. No table in the archives names them; only the preload lists do. But
 * the run loop itself is named for its family with the word `run` in it -- `eng_run_xwing`,
 * `veh_barc_speeder_run_lp`, `hoth_snowspeeder_run_lp` -- and the archives hold the same name with
 * `idle`, `accel` or `decel` in that word's place. So the family is the game's own word and only
 * the pairing is ours: swap the word and keep whatever the archives hold.
 *
 * Two spellings have to be tried because the game is not consistent about the `_lp` a loop's name
 * usually ends in: `eng_run_tie_interceptor_lp` sits beside `eng_accel_tie_interceptor`, and six of
 * the fleet's run loops (the decimator, the firespray, three TIEs and the YT-2400) lose their whole
 * set to a straight swap. A run loop with no `run` word of its own (`shp_eng_jedi_starfighter`)
 * gets nothing rather than a guess.
 *
 * `has(path)` says whether the archives hold that template.
 */
export function engineNames(run, has) {
  const out = {};
  const name = norm(run);
  for (const kind of ['idle', 'accel', 'decel']) {
    // The first `run` written as a word of its own, as the runtime's own reading of these names
    // does it, so the converter's answer and the game's cannot be two different rules.
    const swapped = name.replace(/(^|[_/])run($|[_.])/, (_m, a, b) => `${a}${kind}${b}`);
    if (swapped === name) continue;
    const tries = [swapped];
    if (/_lp\.snd$/.test(swapped)) tries.push(swapped.replace(/_lp\.snd$/, '.snd'));
    else tries.push(swapped.replace(/\.snd$/, '_lp.snd'));
    for (const p of tries) {
      if (has(p)) {
        out[kind] = p;
        break;
      }
    }
  }
  return out;
}

/**
 * One part's sounds, from its parsed client data: its engine set (run loop, the three damage loops
 * and the hardpoint they play at), its booster loop, the effect it is destroyed by and any damage
 * state that has a sound of its own. Null when the file names nothing a part can play.
 *
 * `names(run)` gives the idle, speed-up and slow-down sounds that go with a run loop.
 */
export function partSounds(entry, { kind = null, clientData = null, names = () => ({}) } = {}) {
  if (!entry) return null;
  const out = {};
  if (kind) out.kind = kind;
  if (clientData) out.clientData = clientData;
  const engines = entry.engines ?? [];
  if (engines.length && engines[0].sound) {
    const run = engines[0].sound;
    const damaged = engines.slice(1).map((e) => e.sound).filter(Boolean);
    out.engine = { hardpoint: engines[0].slot || '', run, ...(damaged.length ? { damaged } : {}), ...names(run) };
  }
  // The top-level INTS form, which on every file in the archives is the booster's rocket loop.
  const booster = (entry.interior ?? []).find((i) => i.sound);
  if (booster) out.booster = { hardpoint: booster.slot || '', loop: booster.sound };
  if (entry.ambient) out.ambient = entry.ambient;
  if (entry.destroyed) out.destroyed = entry.destroyed;
  const damage = (entry.damage ?? []).filter((d) => d.sound).map((d) => ({ from: d.from, to: d.to, sound: d.sound }));
  if (damage.length) out.damage = damage;
  return Object.keys(out).length && (out.engine || out.booster || out.ambient || out.destroyed || out.damage) ? out : null;
}

/**
 * A hull's or a vehicle's own sounds: its looping `ASND`, its thruster sets per damage state (the
 * undamaged one is level 0), its booster loop, the sound it drives over water with, and the effect
 * it is destroyed by. A state with no sound at all is left out.
 */
export function bodySounds(entry, { names = () => ({}) } = {}) {
  if (!entry) return null;
  const out = {};
  if (entry.ambient) out.ambient = entry.ambient;
  const thrusters = [];
  for (const t of entry.thrusters ?? []) {
    if (!t.idle && !t.accel && !t.decel && !t.run) continue;
    thrusters.push({ level: t.level ?? 0, ...(t.idle ? { idle: t.idle } : {}), ...(t.accel ? { accel: t.accel } : {}), ...(t.decel ? { decel: t.decel } : {}), ...(t.run ? { run: t.run } : {}) });
  }
  if (thrusters.length) out.thrusters = thrusters;
  const booster = (entry.interior ?? []).find((i) => i.sound);
  if (booster) out.booster = { hardpoint: booster.slot || '', loop: booster.sound };
  const water = (entry.ground ?? []).find((g) => g.water && g.sound);
  if (water) out.water = water.sound;
  if (entry.destroyed) out.destroyed = entry.destroyed;
  const damage = (entry.damage ?? []).filter((d) => d.sound).map((d) => ({ from: d.from, to: d.to, sound: d.sound }));
  if (damage.length) out.damage = damage;
  // Anything else the file names that no chunk of its own claims, whatever it turns out to be: on
  // the capital ships it is the three loops they break up with (the hull, the creaking metal and
  // the alarm), which nothing else carries, and on a winged fighter it is the sound its wings open
  // with, which the ships manifest already carries and the caller takes back out again. Nothing
  // should play this list without knowing which of the two it is holding.
  const extra = (entry.extra ?? []).filter((p) => /\.snd$/i.test(p));
  if (extra.length) out.extra = extra;
  // INVENTED, the same pairing `engineNames` is: a body whose own data names a run loop can have
  // the rest of its set by the run loop's family name too, since a client data file that names one
  // usually names none of the other three.
  const undamaged = thrusters.find((t) => !t.level);
  if (undamaged?.run) {
    const n = names(undamaged.run);
    for (const k of ['idle', 'accel', 'decel']) if (!undamaged[k] && n[k]) undamaged[k] = n[k];
  }
  return Object.keys(out).length ? out : null;
}

/**
 * `ship_hit_effects.iff`'s rows as the sounds of each hit: per layer, the light, medium and heavy
 * hit and event effects, each with the sounds its client effect plays. The ships pack turns the
 * same rows into particles and drops the sounds, so this reads them again for the sound alone and
 * keys them exactly as the ships pack keys its own: the layer name, then the three severities in
 * the table's order. `soundsOf(cef)` gives one client effect's sounds.
 *
 * On the retail archives all 24 of those files are particles and nothing else: what a hit sounds
 * like comes from `ship_hit_sounds.iff` (per hull group, already in the ships pack and in the
 * bank's own sources). The effect paths are written all the same, with `sounds` only where there
 * are any, so nobody has to read the table again to find that out.
 */
export function hitEffectSounds(rows, soundsOf) {
  const out = {};
  for (const r of rows ?? []) {
    const layer = String(r.type ?? '').trim().toLowerCase();
    if (!HIT_LAYERS.includes(layer)) continue;
    const of = (prefix) =>
      HIT_STEPS.map((step) => {
        const effect = norm(r[`${prefix}_${step}`]);
        if (!effect) return null;
        const sounds = soundsOf(effect) ?? [];
        return { effect, ...(sounds.length ? { sounds } : {}) };
      });
    const hit = of('hit');
    const event = of('event');
    if (hit.some(Boolean) || event.some(Boolean)) out[layer] = { hit, event };
  }
  return out;
}

/** How many sounds a hit-effect map holds in all: 0 says the hit sound table is the only source. */
export function hitEffectSoundCount(hitEffects) {
  let n = 0;
  for (const layer of Object.values(hitEffects ?? {})) for (const list of [layer.hit ?? [], layer.event ?? []]) for (const e of list) n += e?.sounds?.length ?? 0;
  return n;
}

/**
 * The mount tables' route from a vehicle's appearance to its client data: `logical_saddle_name_map`
 * gives the logical saddle for a `.sat`, and `saddle_appearance_map`'s `client_data_filename` names
 * the file. The same chain the rider poses are read through, and the only place in the archives
 * that says which client data a vehicle owns. Returns null when either step has nothing.
 */
export function vehicleClientData(sat, { logical, saddles }) {
  const want = norm(sat);
  const l = (logical ?? []).find((r) => norm(r.sat_name) === want) ?? (logical ?? []).find((r) => stem(r.sat_name) === stem(want));
  if (!l) return null;
  const s = (saddles ?? []).find((r) => norm(r.logical_saddle_name) === norm(l.logical_saddle_name));
  if (!s || !s.client_data_filename) return null;
  return { file: norm(s.client_data_filename), saddle: String(s.logical_saddle_name), sat: norm(l.sat_name), seats: Number(s.saddle_capacity) || 1 };
}

/**
 * INVENTED: which of the game's elevator sounds a lift plays. The four templates are the game's
 * own and nothing in the archives says when they were played, because the lifts were objects the
 * server spawned. The two one-shots are the pick's sound and the two loops are there for a car that
 * one day moves.
 */
export const LIFT_SOUNDS = { rise: 'sound/item_elevator_02_rise.snd', descend: 'sound/item_elevator_02_descend.snd', riseLoop: 'sound/item_elevator_rise_lp.snd', descendLoop: 'sound/item_elevator_descend_lp.snd' };

/**
 * The joins in the shape the game reads them: each thing it knows by name -- an engine part's
 * template, a hull, a vehicle -- against the client data file that speaks for it, which only the
 * template chain (and for a vehicle, the mount tables) can say. Every one is written twice, under
 * the whole path and under the file's own name, because the game asks with whichever it holds: a
 * hull by its id or its template, a vehicle by its garage id or its template, a part by the
 * template its fit keeps. `combat.hulls` is each hull's destruction sounds by ship id, and
 * `combat.hitEffects` each hit effect's, keyed `<layer>_<hit|event>_<severity>` and left out when
 * the effects play none, which on the retail archives is all of them.
 *
 * The other four are the answers the game cannot work out for itself while it is running, and they
 * are here rather than in `ships.json` alone so that one rule decides each of them and not two:
 *
 *  - `shipEngines`, every hull whose stock engine is a part against that part's client data. It is
 *    there for the hulls that wear no engine part at all -- every TIE, both gunships, the corvette,
 *    the Star Destroyer, the mining ship, the yacht: 19 of the 63, and 16 of those are rescued here,
 *    the other three reaching a loop of their own through `hulls`. Nothing on such a ship names the
 *    file its run loop lives in, so without this it is left to a guess from the family name of its
 *    flyby, which lands on the wrong family for five of them. It is only the stock engine: a ship
 *    with an engine fitted reads that part's own join first, so a refit still changes its sound.
 *  - `power`, which of the three power-sound rows a hull uses (see `powerSetOf`).
 *  - `kin`, each run loop against the idle, speed-up and slow-down loops of its own family, checked
 *    against the archives here so that nothing has to guess at the `_lp` spellings again.
 *  - `lifts`, the elevator sounds, whose choice is ours and belongs in one place.
 */
export function shipSoundJoins({ parts = {}, hulls = {}, vehicles = {}, hitEffects = {}, lifts = {} } = {}) {
  const both = (out, key, value) => {
    if (!key || !value) return;
    out[key] = value;
    const base = String(key).replace(/\\/g, '/').split('/').pop().replace(/^shared_/i, '').replace(/\.[a-z0-9]+$/i, '');
    if (base && !(base in out)) out[base] = value;
  };
  const engines = {};
  for (const [template, part] of Object.entries(parts)) both(engines, template, part.clientData);
  const hullFiles = {};
  const combatHulls = {};
  const shipEngines = {};
  const power = {};
  for (const [id, hull] of Object.entries(hulls)) {
    if (hull.clientData && !hull.clientDataMissing) {
      hullFiles[id] = hull.clientData;
      both(hullFiles, hull.template, hull.clientData);
    }
    const sounds = hull.destroyed?.sounds ?? [];
    if (sounds.length) combatHulls[id] = sounds;
    // Only an engine that is a part of its own: a hull whose loop is its own `VTHR` or `ASND` is
    // already reached through `hulls` above, and writing it twice would be two answers again.
    const engineFile = hull.engine?.part ? parts[hull.engine.part]?.clientData : null;
    if (engineFile) {
      shipEngines[id] = engineFile;
      both(shipEngines, hull.template, engineFile);
    }
    if (hull.power) {
      power[id] = hull.power;
      both(power, hull.template, hull.power);
    }
  }
  const vehicleFiles = {};
  for (const [template, v] of Object.entries(vehicles)) both(vehicleFiles, template, v.clientData);
  // Every run loop the pack names, against the rest of its family. A set is written only where
  // there is something to say, so a loop with no family of its own is absent rather than empty.
  const kin = {};
  const kinOf = (set) => {
    if (!set?.run) return;
    const one = {};
    for (const k of ['idle', 'accel', 'decel']) if (set[k]) one[k] = set[k];
    if (Object.keys(one).length && !(set.run in kin)) kin[set.run] = one;
  };
  for (const part of Object.values(parts)) kinOf(part.engine);
  for (const hull of Object.values(hulls)) {
    kinOf(hull.engine);
    for (const t of hull.thrusters ?? []) kinOf(t);
  }
  for (const v of Object.values(vehicles)) for (const t of v.thrusters ?? []) kinOf(t);
  const hitSounds = {};
  for (const [layer, row] of Object.entries(hitEffects)) {
    for (const kind of ['hit', 'event']) {
      (row[kind] ?? []).forEach((e, i) => {
        if (e?.sounds?.length) hitSounds[`${layer}_${kind}_${HIT_STEPS[i]}`] = e.sounds;
      });
    }
  }
  return {
    engines,
    hulls: hullFiles,
    shipEngines,
    vehicles: vehicleFiles,
    power,
    kin,
    lifts,
    combat: { hulls: combatHulls, ...(Object.keys(hitSounds).length ? { hitEffects: hitSounds } : {}) },
  };
}

/** A pack's JSON, or null: a pack that is not converted contributes nothing rather than failing the run. */
const readJsonFile = (file) => {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const table = (vfs, path) => {
  if (!vfs.has(path)) return null;
  try {
    return parseDatatable(parseIff(vfs.read(path)));
  } catch {
    return null;
  }
};

/**
 * The `sounds` command's ship half: every ship part, hull and ground vehicle joined to the sounds
 * its own client data names, the hit sounds per layer, and the lift sounds. Writes
 * `<out-dir>/sounds/ships.json` and returns what it found.
 *
 * The ships pack is read for its hull ids and their stock parts when it is there; without it the
 * parts and vehicles are still written, and `status` says the hulls are missing.
 */
export function convertShipSounds(vfs, outDir, { log = () => {} } = {}) {
  const cache = new Map();
  const has = (p) => vfs.has(p);
  const names = (run) => engineNames(run, has);
  const clientDataOf = (template) => {
    const f = resolveTemplateParam(vfs, norm(template), 'clientDataFile', stringParam, cache);
    return f ? norm(f) : null;
  };
  const appearanceOf = (template) => {
    const f = resolveTemplateParam(vfs, norm(template), 'appearanceFilename', stringParam, cache);
    return f ? norm(f) : null;
  };
  const parsed = new Map();
  const soundsIn = (file) => {
    if (parsed.has(file)) return parsed.get(file);
    let entry = null;
    if (vfs.has(file)) {
      try {
        entry = parseClientDataSounds(parseIff(vfs.read(file)));
      } catch {
        entry = null;
      }
    }
    parsed.set(file, entry);
    return entry;
  };
  const effects = new Map();
  const soundsOf = (cef) => {
    if (effects.has(cef)) return effects.get(cef);
    let sounds = [];
    if (vfs.has(cef)) {
      try {
        sounds = parseClientEffect(parseIff(vfs.read(cef))).sounds ?? [];
      } catch {
        sounds = [];
      }
    }
    effects.set(cef, sounds);
    return sounds;
  };

  // ---- the parts
  const parts = {};
  // A look table names a part by its own name (`tie_engine_s01`), and no two of the 441 attachment
  // templates in the archives share one, so the name is enough to find the template again.
  const byPartName = new Map();
  const partFiles = [...new Set(vfs.list('object/tangible/ship/attachment/'))].filter((p) => /\.iff$/i.test(p)).sort();
  let withData = 0;
  let engines = 0;
  let boosters = 0;
  const absent = new Set();
  for (const template of partFiles) {
    const cd = clientDataOf(template);
    if (!cd) continue;
    if (!vfs.has(cd)) {
      absent.add(cd);
      continue;
    }
    withData++;
    const kind = template.split('/')[4] ?? null;
    const record = partSounds(soundsIn(cd), { kind, clientData: cd, names });
    if (!record) continue;
    // The effect a part is destroyed by, with the sounds it plays, exactly as a hull's and a
    // vehicle's are written: every part in the fleet has one and a reader should not have to go
    // through another file for a sound this one already knows.
    if (record.destroyed) {
      const sounds = soundsOf(record.destroyed);
      record.destroyed = { effect: record.destroyed, ...(sounds.length ? { sounds } : {}) };
    }
    if (record.engine) engines++;
    if (record.booster) boosters++;
    parts[template] = record;
    byPartName.set(template.replace(/^.*\/shared_/, '').replace(/\.iff$/i, '').toLowerCase(), template);
  }

  // ---- the hulls
  const manifest = readJsonFile(join(outDir, 'ships', 'manifest.json'));
  const chassisRows = table(vfs, 'datatables/space/ship_chassis.iff');
  const chassisByName = new Map((chassisRows?.rows ?? []).map((r) => [String(r.name), r]));
  const hullTables = new Map();
  const hullTable = (name) => {
    if (!hullTables.has(name)) hullTables.set(name, table(vfs, `datatables/space/ship_chassis_${name}.iff`));
    return hullTables.get(name);
  };
  const hulls = {};
  const notes = [];
  let hullsWithData = 0;
  let hullEngines = 0;
  for (const ship of manifest?.ships ?? []) {
    const cd = clientDataOf(ship.template);
    const record = { template: norm(ship.template) };
    if (cd) {
      record.clientData = cd;
      if (!vfs.has(cd)) {
        record.clientDataMissing = true;
        notes.push(`${ship.id}: names ${cd}, which the archives do not hold`);
      }
    }
    const own = cd && vfs.has(cd) ? bodySounds(soundsIn(cd), { names }) : null;
    if (own) {
      hullsWithData++;
      Object.assign(record, own);
    }
    if (record.destroyed) {
      const sounds = soundsOf(record.destroyed);
      record.destroyed = { effect: record.destroyed, ...(sounds.length ? { sounds } : {}) };
    }
    // The engine the hull runs on before anything is refitted. First its own looks table's engine
    // column, which is the game's own answer and the only one for a hull whose engine is part of
    // the hull mesh (every TIE: the column says `tie_engine_s01` with no hardpoint, so the ships
    // pack hangs no model for it and the part is nowhere in the hull's parts, but the part's client
    // data is where `eng_run_tie` lives). Then the stock engine part the ships pack did hang, then
    // a run loop of the hull's own, then its `ASND`.
    //
    // INVENTED, the order after the first step: the looks table and a `VTHR > VSND` run loop are
    // the game saying what a hull's engine is, and the last step is a reading -- an object's
    // looping ambient taken for its engine. On the retail fleet it decides exactly one hull, the
    // Corellian corvette, whose own `ASND` is a small landspeeder's run loop; that is what its file
    // holds, but if the corvette sounds like a skyhopper this line is why.
    const chassis = ship.chassis ? (hullTable(ship.chassis) ? ship.chassis : chassisNameFor(ship.chassis, (n) => !!hullTable(n))) : null;
    const looks = chassis ? modalLooks(hullTable(chassis)) : [];
    const fromTable = (looks.find((l) => l.slot === 'engine')?.pairs ?? [])
      .map((p) => byPartName.get(String(p.attachment).toLowerCase()))
      .find((t) => t && parts[t]?.engine);
    const stockEngine = (ship.attachments ?? []).find((a) => a.slot === 'engine' && a.template && parts[norm(a.template)]?.engine);
    const undamaged = (record.thrusters ?? []).find((t) => !t.level);
    if (fromTable) {
      // The hardpoint here is the part's own, not the hull's: on the 14 hulls whose engine look has
      // an empty hardpoint the ships pack hangs no part at all, so there is no such node on the
      // ship and the sound belongs at the hull's origin.
      record.engine = { from: 'chassis', part: fromTable, ...parts[fromTable].engine };
      hullEngines++;
    } else if (stockEngine) {
      record.engine = { from: 'part', part: norm(stockEngine.template), ...parts[norm(stockEngine.template)].engine };
      hullEngines++;
    } else if (undamaged?.run) {
      record.engine = { from: 'hull', hardpoint: '', run: undamaged.run, ...names(undamaged.run), ...(undamaged.idle ? { idle: undamaged.idle } : {}), ...(undamaged.accel ? { accel: undamaged.accel } : {}), ...(undamaged.decel ? { decel: undamaged.decel } : {}) };
      hullEngines++;
    } else if (record.ambient) {
      record.engine = { from: 'ambient', hardpoint: '', run: record.ambient, ...names(record.ambient) };
      hullEngines++;
    }
    const row = ship.chassis ? chassisByName.get(ship.chassis) : null;
    if (ship.chassis) record.chassis = ship.chassis;
    if (row?.flyby_sound) record.flyby = norm(row.flyby_sound);
    if (row?.hit_sound_group) record.hitSounds = String(row.hit_sound_group);
    // The sound a wing opens with lands in `extra` as well, since no chunk of the client data
    // claims it; the ships manifest already carries it where the game reads it, so it comes out
    // again here rather than sitting in a list that otherwise means the loops a hull breaks up with.
    if (record.extra) {
      const wings = new Set((ship.attachments ?? []).map((a) => (a.sound ? norm(a.sound) : null)).filter(Boolean));
      const kept = record.extra.filter((p) => !wings.has(p));
      if (kept.length) record.extra = kept;
      else delete record.extra;
    }
    record.power = powerSetOf(`${ship.id} ${ship.chassis ?? ''}`, row?.hit_sound_group);
    hulls[ship.id] = record;
  }
  if (!manifest) notes.push('the ships pack is not converted, so no hull is joined to its sounds');

  // ---- the vehicles
  const vehicles = {};
  const logical = table(vfs, 'datatables/mount/logical_saddle_name_map.iff')?.rows ?? [];
  const saddles = table(vfs, 'datatables/mount/saddle_appearance_map.iff')?.rows ?? [];
  const vehicleFiles = [...new Set(vfs.list('object/mobile/vehicle/'))].filter((p) => /\/shared_[^/]+\.iff$/i.test(p)).sort();
  let vehiclesJoined = 0;
  let vehicleBases = 0;
  const vehiclesMissed = [];
  for (const template of vehicleFiles) {
    const sat = appearanceOf(template);
    // A template with no appearance anywhere up its chain is one of the three the others inherit
    // from, not a vehicle anyone drives.
    if (!sat) {
      vehicleBases++;
      continue;
    }
    const hit = vehicleClientData(sat, { logical, saddles });
    if (!hit || !vfs.has(hit.file)) {
      vehiclesMissed.push(`${stem(template)} (${stem(sat)})`);
      continue;
    }
    const own = bodySounds(soundsIn(hit.file), { names });
    if (!own) {
      vehiclesMissed.push(`${stem(template)} (its client data names no sound)`);
      continue;
    }
    vehiclesJoined++;
    // `seats` is the saddle table's own `saddle_capacity`, kept because it came free with the row
    // and says how many riders a sound has to carry for.
    vehicles[template] = { sat: hit.sat, saddle: hit.saddle, seats: hit.seats, clientData: hit.file, ...own };
    if (vehicles[template].destroyed) {
      const sounds = soundsOf(vehicles[template].destroyed);
      vehicles[template].destroyed = { effect: vehicles[template].destroyed, ...(sounds.length ? { sounds } : {}) };
    }
  }

  // ---- the hits and the lifts
  const hitEffects = hitEffectSounds(table(vfs, 'datatables/space/ship_hit_effects.iff')?.rows ?? [], soundsOf);
  const lifts = {};
  for (const [when, path] of Object.entries(LIFT_SOUNDS)) if (vfs.has(path)) lifts[when] = path;

  // The wings already carry their own sound in the ships manifest, where the game reads it, so it
  // is not written again here; it is only checked, since a name with no template behind it is a
  // wing that opens in silence and nothing else would say so.
  const wingSounds = new Set();
  const wingHoles = new Set();
  for (const ship of manifest?.ships ?? []) {
    for (const a of ship.attachments ?? []) {
      if (!a.sound) continue;
      const p = norm(a.sound);
      wingSounds.add(p);
      if (!vfs.has(p)) wingHoles.add(p);
    }
  }
  if (wingHoles.size) notes.push(`${wingHoles.size} of the wing sounds the ships pack names have no template in the archives: ${[...wingHoles].sort().join(', ')}`);

  // A vehicle can join its client data and find no engine in it: joined is not the same as heard,
  // and a machine that is silent because its own file says nothing should not be hunted as a bug.
  const silentVehicles = Object.entries(vehicles)
    .filter(([, v]) => !v.ambient && !(v.thrusters ?? []).some((t) => t.run || t.idle))
    .map(([template]) => stem(template));
  if (silentVehicles.length) notes.push(`${silentVehicles.length} of the vehicles reach their client data and it names no engine loop at all: ${silentVehicles.join(', ')}`);

  const counts = {
    parts: Object.keys(parts).length,
    partTemplates: partFiles.length,
    partsWithClientData: withData,
    engines,
    boosters,
    hulls: Object.keys(hulls).length,
    hullsWithClientData: hullsWithData,
    hullEngines,
    vehicles: vehiclesJoined,
    vehicleTemplates: vehicleFiles.length - vehicleBases,
    hitLayers: Object.keys(hitEffects).length,
    hitEffectSounds: hitEffectSoundCount(hitEffects),
    wingSounds: wingSounds.size,
    lifts: Object.keys(lifts).length,
  };
  if (Object.keys(hitEffects).length && !counts.hitEffectSounds) notes.push('the ship hit effects are particles and nothing else; what a hit sounds like is the hit sound table\'s, per hull group');
  // Every sound named here has to be in the bank, or something plays nothing and nobody knows why.
  // The bank holds every template in the archives, so a name the archives do not hold is the hole.
  const written = { format: SHIP_SOUND_FORMAT, counts, parts, hulls, vehicles, hitEffects, lifts, notes };
  const dangling = new Set();
  for (const name of JSON.stringify(written).match(/sound\/[\w./-]+\.snd/gi) ?? []) if (!vfs.has(name)) dangling.add(name);
  counts.dangling = dangling.size;
  // Whose data each hole belongs to. A name nothing in the archives holds is the game's own gap and
  // nothing is invented to fill it -- the name is left exactly as the client data writes it -- but
  // the machines that name it are written down, and so is the template the archives do hold whose
  // name differs only by the `_lp` a loop usually ends in, so a sound that never plays is a known
  // gap in one file and not a mystery.
  const danglingOwners = [...dangling].sort().map((name) => {
    const owners = [];
    for (const [where, map] of [['part', parts], ['hull', hulls], ['vehicle', vehicles]]) {
      for (const [key, rec] of Object.entries(map)) if (JSON.stringify(rec).includes(name)) owners.push(`${where} ${stem(key) || key}`);
    }
    const near = [name.replace(/_lp\.snd$/, '.snd'), name.replace(/\.snd$/, '_lp.snd')].find((p) => p !== name && vfs.has(p));
    return `${name} (${owners.join(', ') || 'named by nothing that is written'}${near ? `; the archives hold ${near}` : ''})`;
  });
  if (danglingOwners.length) notes.push(`${danglingOwners.length} sounds have no template in the archives: ${danglingOwners.join('; ')}`);
  const file = join(outDir, 'sounds', 'ships.json');
  mkdirSync(join(outDir, 'sounds'), { recursive: true });
  writeFileSync(file, JSON.stringify(written));

  // The joins alone also go into the bank's own events.json, beside the client data they point at,
  // because that is the one file the game already fetches for a body's sounds and a lookup that
  // needs both should not need two. It is the same file the rest of the bank is written into and it
  // is written moments before this runs; when it is not there (a run that wrote no bank), nothing is
  // merged and the joins live here alone.
  const joins = shipSoundJoins(written);
  const eventsFile = join(outDir, 'sounds', 'events.json');
  const events = readJsonFile(eventsFile);
  let merged = false;
  if (events) {
    events.ships = joins;
    writeFileSync(eventsFile, JSON.stringify(events));
    merged = true;
  }

  log(`  sounds: ${counts.parts} ship parts with a sound of their own (${engines} engine sets, ${boosters} boosters) of ${partFiles.length} attachment templates, ${counts.hulls} hulls (${hullEngines} with an engine loop), ${vehiclesJoined} of ${counts.vehicleTemplates} vehicles, ${counts.hitLayers} hit layers with ${counts.hitEffectSounds} sounds -> ${file}`);
  if (vehiclesMissed.length) log(`  sounds: ${vehiclesMissed.length} vehicle templates reach no client data: ${vehiclesMissed.join(', ')}`);
  if (absent.size) log(`  sounds: ${absent.size} ship parts name client data the archives do not hold`);
  log(merged ? `  sounds: the ship joins are in events.json too (${Object.keys(joins.engines).length} part names, ${Object.keys(joins.hulls).length} hull names, ${Object.keys(joins.vehicles).length} vehicle names, ${Object.keys(joins.shipEngines).length} names for the hulls whose engines are part of the hull)` : '  sounds: no events.json to put the ship joins in; run the command without --only to write the whole bank');
  for (const n of notes) log(`  sounds: ${n}`);
  return { counts, parts, hulls, vehicles, hitEffects, lifts, notes, joins, merged, vehiclesMissed, absent: [...absent], dangling: [...dangling], danglingOwners };
}

/**
 * What the ship half of the sound bank holds, and what to run when it is missing or older than the
 * converter. `readJson` is the caller's reader (null when the file is absent), and `ships` is the
 * ships pack's own manifest where there is one: the hull half is keyed by the ids that manifest
 * gives, so a ships pack converted since (a hull renamed, a hull added) leaves this half behind and
 * nothing else would ever say so.
 */
export function shipSoundStatus(dir, readJson, { ships: manifest = null } = {}) {
  const ships = readJson(join(dir, 'sounds', 'ships.json'));
  if (!readJson(join(dir, 'sounds', 'sounds.json'))) return { line: null, need: null };
  if (!ships) return { line: '  ship sounds: none (ships, vehicles and their parts are silent)', need: 'the sound bank has no ships.json (no engines, boosters, hits or vehicle sounds)' };
  const c = ships.counts ?? {};
  const line = `  ship sounds: ${c.parts ?? 0} parts (${c.engines ?? 0} engine sets), ${c.hulls ?? 0} hulls, ${c.vehicles ?? 0} vehicles, ${c.hitLayers ?? 0} hit layers`;
  if ((ships.format ?? 0) < SHIP_SOUND_FORMAT) return { line, need: 'the sound bank\'s ships.json is from an older converter' };
  if (!c.hulls) return { line, need: 'the sound bank\'s ships.json has no hulls (it was written before the ships pack)' };
  const missing = (manifest?.ships ?? []).map((s) => s.id).filter((id) => id && !(id in (ships.hulls ?? {})));
  if (missing.length) {
    const few = missing.slice(0, 3).join(', ');
    return { line, need: `${missing.length} of the ships have no sounds (${few}${missing.length > 3 ? `, and ${missing.length - 3} more` : ''}): the ships pack was converted after the bank` };
  }
  return { line, need: null };
}
