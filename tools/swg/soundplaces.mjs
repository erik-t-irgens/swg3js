// Where a planet's sounds are: the emitters its world places, what each building's rooms
// sound like and what is underfoot on the things standing in it.
//
// Three sources, all of them the game's own:
//   - The world snapshot (`snapshot/<planet>.ws`) and the buildout tables place every object.
//     An object is an emitter when its template's client data carries an `ASND`, the object's
//     own looping sound: the 86 `object/soundobject/*` templates (the cantina bands, the crowds,
//     the starport announcer) and the props that hum on their own (moisture harvesters, mission
//     terminals, bacta tanks, tiki torches, campfires, power generators).
//   - `datatables/interior/interior.iff`, a row per building and cell: the day and night bed of
//     that room, what its floor is, and its room type. Its `PobName` is the portal layout file's
//     name without its folder or its `.pob` (`appearance/mun_tato_capitol_s01.pob` is
//     `mun_tato_capitol_s01`), which is how a placed building finds its rows.
//   - Each placed template's own `surfaceType`, which says whether standing on that thing sounds
//     like metal, wood or stone.
//
// **The frame.** Positions are written exactly as `layout.json` writes an object's: the snapshot's
// own coordinates, unmirrored and uncentred. The game mirrors X and takes the layout's centre off
// when it reads them (`LayoutStreamer`'s constructor: `-(x - center.x)`, `z - center.z`), and must
// do the same to these. Writing them this way means a pack whose centre moves needs no rerun here.
// The file says which frame it is in, so a reader that does not know this one can leave the places
// alone and say so rather than stand a town's crowds nine kilometres from the town.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseIff } from './iff.mjs';
import { parseDatatable } from './datatable.mjs';
import { resolveTemplateParam, intParam, stringParam } from './objtemplate.mjs';
import { parseSnapshot, flattenWithWorldTransforms } from './ws.mjs';
import { loadBuildouts, mergeBuildouts } from './buildout.mjs';
import { parseClientDataSounds, roomRows } from './soundsources.mjs';

/** Bumped whenever a planet's sounds.json changes shape, so `status` can ask for a rerun. */
export const PLACES_FORMAT = 1;

/**
 * An object template's `surfaceType`, which is what standing on it sounds like. The numbers are
 * the client's. Metal, stone and wood are also the names a body's client data gives its own steps
 * (`footstep_metal`, `footstep_stone`, `footstep_wood`); the upper four are fixed by the asteroid
 * templates (acid 4, ice 5, molten 6, obsidian 7) and no body has a step for them, because nothing
 * on a planet is ever one of them. Scanned over all 6,152 client data files in the archives, the
 * whole footstep set is carpet, giant, grass, harddirt, large, metal, mud, rock, sand, small, snow,
 * softdirt, stone, surf, water and wood.
 *
 * 0 is by far the most common (765 of the 1,170 distinct templates Tatooine places), and it is
 * "no surface of its own": the game falls through to the ground underneath. So only the templates
 * whose surface is something else are written, and the absence of an entry is the answer.
 */
export const SURFACE_TYPES = { 1: 'metal', 2: 'stone', 3: 'wood', 4: 'acid', 5: 'ice', 6: 'molten', 7: 'obsidian' };

/** The container object a building's rooms hold their contents in; it is not a thing in the world. */
const CELL_TEMPLATE = 'object/cell/shared_cell.iff';

/** The objects a world placed for their sound alone; everything else in the file merely hums too. */
const SOUND_OBJECT = 'object/soundobject/';

/**
 * INVENTED: positions to the centimetre, because a sound's place is heard and not measured, and a
 * planet's file is a fifth smaller for it. Not finite is not a place at all: `NaN` here is what
 * makes the emitter be dropped and counted rather than stood at the world's origin.
 */
const round = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : NaN);

/**
 * INVENTED: how far up a chain of containers a placed object's building may be before the walk
 * gives up. The deepest real chain measured is three steps (object, cell, building) on Tatooine and
 * Corellia, and two everywhere else, so this only stops a cycle or a future archive's surprise.
 */
const MAX_CONTAINER_DEPTH = 8;

/** `appearance/mun_tato_capitol_s01.pob` -> `mun_tato_capitol_s01`, which is the room table's key. */
export function pobNameOf(layout) {
  if (!layout) return null;
  const base = layout.replace(/\\/g, '/').split('/').pop() ?? '';
  return base.replace(/\.pob$/i, '') || null;
}

/** The looping sound an object plays by itself, from its client data, or null. */
function ambientOf(vfs, cdf, cache) {
  if (!cdf) return null;
  if (cache.has(cdf)) return cache.get(cdf);
  let sound = null;
  if (vfs.has(cdf)) {
    try {
      sound = parseClientDataSounds(parseIff(vfs.read(cdf)))?.ambient ?? null;
    } catch {
      sound = null;
    }
  }
  cache.set(cdf, sound);
  return sound;
}

/**
 * What one planet's placements hold: its emitters, which portal layout each placed building uses,
 * and the surface of every template that has one. `snap` and `entries` are a parsed snapshot with
 * its buildouts merged and flattened, so a test can hand this synthetic placements.
 */
export function placedSounds(vfs, snap, entries, { cache = new Map(), log = () => {} } = {}) {
  const clientData = (t) => resolveTemplateParam(vfs, t, 'clientDataFile', stringParam, cache);
  const layoutFile = (t) => resolveTemplateParam(vfs, t, 'portalLayoutFilename', stringParam, cache);
  const surfaceType = (t) => resolveTemplateParam(vfs, t, 'surfaceType', intParam, cache);
  const ambientCache = new Map();

  const byId = new Map();
  for (const e of entries) byId.set(e.node.id, e);

  /**
   * The building a placed object stands in, and which of its cells, by climbing its containers.
   * The room is usually the cell object's own `cellIndex` and the object's is 0, but a placed
   * object does sometimes carry one itself (130 of Tatooine's 5,102 objects inside a cell, 428 of
   * Naboo's 778, 403 of Corellia's 1,366): where both are set they agree everywhere in the
   * archives, so either answers and the object's own is taken first.
   */
  const containerOf = (e) => {
    let cell = e.node.cellIndex || 0;
    let id = e.parentId;
    for (let depth = 0; depth < MAX_CONTAINER_DEPTH && id; depth++) {
      const parent = byId.get(id);
      if (!parent || parent.node.id === e.node.id) break;
      if (!cell && parent.node.cellIndex) cell = parent.node.cellIndex;
      const template = snap.templates[parent.node.templateIndex];
      const pob = template ? pobNameOf(layoutFile(template)) : null;
      if (pob) return { pob, cell, p: parent.world?.pos ?? null };
      id = parent.parentId;
    }
    return cell ? { pob: null, cell, p: null } : null;
  };

  const emitters = [];
  const pobs = {};
  const surfaces = {};
  const seen = new Set();
  let notASound = 0;
  let orphaned = 0;
  let noPlace = 0;
  for (const e of entries) {
    const template = snap.templates[e.node.templateIndex];
    if (!template || template === CELL_TEMPLATE) continue;
    if (!seen.has(template)) {
      seen.add(template);
      const pob = pobNameOf(layoutFile(template));
      if (pob) pobs[template] = pob;
      const name = SURFACE_TYPES[surfaceType(template) ?? 0];
      if (name) surfaces[template] = name;
    }
    const sound = ambientOf(vfs, clientData(template), ambientCache);
    if (!sound || !e.world) continue;
    // An ASND is a sound template everywhere in the retail archives; anything else is counted
    // and left out rather than written as something the runtime would have to guess at.
    if (!sound.endsWith('.snd')) {
      notASound++;
      continue;
    }
    const at = e.world.pos;
    const p = [round(at[0]), round(at[1]), round(at[2])];
    // A row whose place is not a number is no place: dropped and counted, never folded onto the
    // world's origin, where it would loop for ever under whoever spawns there. Nothing in the
    // retail archives does this; it is the next archive that would.
    if (!p.every(Number.isFinite)) {
      noPlace++;
      continue;
    }
    const entry = { sound, template, p };
    const inside = containerOf(e);
    if (inside) {
      if (inside.pob) entry.pob = inside.pob;
      else orphaned++;
      if (inside.cell) entry.cell = inside.cell;
      if (inside.p) {
        const bp = [round(inside.p[0]), round(inside.p[1]), round(inside.p[2])];
        if (bp.every(Number.isFinite)) entry.bp = bp;
      }
    }
    emitters.push(entry);
  }
  // The objects placed for their sound alone come first and the props that hum after, because a
  // planet has far more hums than any game will want to hold at once (919 on Tatooine against 108
  // sound objects) and whoever takes a prefix of this list must get the cantina bands, the crowds
  // and the starport announcer rather than whatever the alphabet handed it. Within each half the
  // order is the sound's name and then the place, so two runs write the same bytes.
  const rank = (e) => (e.template.startsWith(SOUND_OBJECT) ? 0 : 1);
  emitters.sort((a, b) => rank(a) - rank(b) || a.sound.localeCompare(b.sound) || a.p[0] - b.p[0] || a.p[2] - b.p[2]);
  if (notASound) log(`    ${notASound} placed objects name something other than a sound template as their own loop, and are left out`);
  if (orphaned) log(`    ${orphaned} emitters are inside a container whose building the snapshot does not name`);
  if (noPlace) log(`    ${noPlace} placed objects have no finite place and are left out`);
  return { emitters, pobs, surfaces };
}

/**
 * The room table's rows for the buildings named in `pobs`, keyed `<pob>|<cell>`. The table's own
 * `default` rows come too: a room with no row of its own falls back to its building's `default`
 * row and then to the table's, so the game needs no second file to find either.
 */
export function roomsFor(rows, pobs) {
  const wanted = new Set([...pobs, 'default']);
  const out = {};
  for (const r of rows) {
    if (!r.pob || !wanted.has(r.pob)) continue;
    const entry = {};
    if (r.day) entry.day = r.day;
    if (r.night) entry.night = r.night;
    if (r.music) entry.music = r.music;
    if (r.surface) entry.surface = r.surface;
    if (r.room) entry.room = r.room;
    out[`${r.pob}|${r.cell}`] = entry;
  }
  return out;
}

/** A planet's placements, loaded the way the snapshot command loads them. */
function loadPlacements(vfs, planet) {
  const wsPath = `snapshot/${planet}.ws`;
  const hasBuildouts = vfs.has(`datatables/buildout/areas_${planet}.iff`);
  if (!vfs.has(wsPath) && !hasBuildouts) return null;
  const snap = vfs.has(wsPath) ? parseSnapshot(parseIff(vfs.read(wsPath))) : { version: 'none', templates: [], nodes: [] };
  mergeBuildouts(snap, loadBuildouts(vfs, planet, { events: false }));
  return { snap, entries: flattenWithWorldTransforms(snap) };
}

/**
 * Write `<out-dir>/<planet>/sounds.json` for each planet: the emitters its world places, the
 * portal layout of every placed building, the surface of every template that has one, and the
 * room table's rows for those buildings. Nothing here reads a converted pack, so the order the
 * commands are run in does not matter -- but a planet with no pack of its own is passed over
 * rather than given a directory holding nothing but its sounds, since nothing would ever fetch it
 * and `status` does not ask about a planet with no pack either.
 */
export function convertSoundPlaces(vfs, outDir, { planets = [], log = () => {} } = {}) {
  let rows = [];
  if (vfs.has('datatables/interior/interior.iff')) {
    try {
      rows = roomRows(parseDatatable(parseIff(vfs.read('datatables/interior/interior.iff'))));
    } catch {
      rows = [];
    }
  }
  if (!rows.length) log('  sounds: the room table is missing or unreadable; no room beds are written');
  // One cache for every planet: the template chains are the same files over and over, and the
  // eight planets that place sound objects share most of their props.
  const cache = new Map();
  const results = [];
  for (const planet of planets) {
    if (!existsSync(join(outDir, planet, 'manifest.json'))) {
      log(`  sounds: ${planet} has no pack yet, so its places are passed over`);
      continue;
    }
    const placements = loadPlacements(vfs, planet);
    if (!placements) {
      log(`  sounds: ${planet} has no snapshot and no buildout tables`);
      continue;
    }
    const { emitters, pobs, surfaces } = placedSounds(vfs, placements.snap, placements.entries, { cache, log });
    const names = new Set(Object.values(pobs));
    const rooms = roomsFor(rows, names);
    const withRow = [...names].filter((p) => rows.some((r) => r.pob === p));
    const distinct = new Set(emitters.map((e) => e.sound)).size;
    const inside = emitters.filter((e) => e.cell).length;
    // The sound objects are counted apart from the props that hum: they are the ones the world
    // placed for their sound alone, and only eight planets have any. They are also the first
    // `soundObjects` entries of the list, which is how a game that can hold only so many sources
    // takes the ones worth having.
    const soundObjects = emitters.filter((e) => e.template.startsWith(SOUND_OBJECT)).length;
    const file = join(outDir, planet, 'sounds.json');
    mkdirSync(join(outDir, planet), { recursive: true });
    writeFileSync(file, JSON.stringify({ format: PLACES_FORMAT, planet, frame: 'snapshot', soundObjects, emitters, pobs, surfaces, rooms }));
    const result = { planet, emitters: emitters.length, soundObjects, distinct, inside, pobs: names.size, pobsWithRow: withRow.length, rooms: Object.keys(rooms).length, surfaces: Object.keys(surfaces).length };
    results.push(result);
    log(`  sounds: ${planet}: ${emitters.length} placed emitters (${soundObjects} sound objects, ${distinct} distinct sounds, ${inside} inside a building), ${names.size} portal layouts (${withRow.length} with a room row), ${Object.keys(rooms).length} room rows, ${Object.keys(surfaces).length} templates with a surface of their own -> ${file}`);
  }
  return results;
}

/**
 * What the planet packs' sound places hold and what to run when one is missing or older than the
 * converter. `readJson` is the caller's reader (null when the file is absent); `planets` is the
 * planet ids to look for, and only the ones that already have a pack are asked about.
 */
export function placesStatus(dir, planets, readJson) {
  const missing = [];
  const stale = [];
  let have = 0;
  let emitters = 0;
  for (const planet of planets) {
    if (!readJson(join(dir, planet, 'manifest.json'))) continue;
    const places = readJson(join(dir, planet, 'sounds.json'));
    if (!places) {
      missing.push(planet);
      continue;
    }
    if ((places.format ?? 0) < PLACES_FORMAT) stale.push(planet);
    have++;
    emitters += (places.emitters ?? []).length;
  }
  // A fresh tree has every planet in both lists, and a line naming eighteen of them twice is a
  // line nobody reads: four names and a count say the same thing, as the mobiles status does.
  const few = (list) => (list.length > 4 ? `${list.slice(0, 4).join(', ')} and ${list.length - 4} more` : list.join(', '));
  const line = have || missing.length || stale.length ? `  sound places: ${have} planets with ${emitters} placed emitters${missing.length ? `, ${missing.length} without (${few(missing)})` : ''}${stale.length ? `, ${stale.length} older than the converter (${few(stale)})` : ''}` : null;
  const why = missing.length ? `${few(missing)} ${missing.length === 1 ? 'has' : 'have'} no placed sounds, no room beds and nothing underfoot` : stale.length ? `${few(stale)} carry an older sound places format` : null;
  return { line, need: why };
}
