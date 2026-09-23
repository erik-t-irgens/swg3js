// The gates you walk between one world's zones through, and where each of them opens.
//
// One world in the game is not one terrain but seven, each converted as a pack of its own, and on
// foot you cross between them at gates the snapshot places. Which zone a gate opened on was the
// server's business and is nowhere in the archives, so this is a join rather than a reading, and it
// is done here at conversion time so that a bad pairing shows in the run instead of in the game.
//
// What the archives do give:
//   - the client's own table of named places (a name, a description, a world and a point), which
//     puts a named place within a few dozen metres of nearly every gate that stands on its own;
//   - two of those descriptions, and only two in the whole table, that say in words where their
//     gate leads ("leads back to the proud city of Kachirho", "the gate back to the Kachirho
//     region"), and a third that calls its neighbour "the entrance to the Hracca Glade";
//   - the buildout area tables, which name the instance each repeated gate stands in: the zones
//     that are grids of dungeon instances have no named places at all, but every one of their
//     gates falls inside an area the archives name.
// What is ours is the last step only: turning a named place, or an instance's area, into the pack
// the gate opens on. That is `PLACE_ZONES` and `AREA_ZONES` below, and every row of both says what
// it rests on, which the run prints beside the distance the pairing matched on.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseIff } from './iff.mjs';
import { parseDatatable } from './datatable.mjs';
import { clientPlaceWorlds, readClientPlaces } from './places.mjs';

/**
 * What a pack's gates.json is; bumped when an older one would be read wrongly. The game reads it
 * (`gatesInWorld` in `src/world/zoneGates.ts`) and says so rather than guessing at a file a later
 * converter wrote, which is the only thing a version in a file is for.
 */
export const GATES_FORMAT = 1;

/**
 * How far a gate may stand from a named place and still be offered to the table below as that
 * place's gate. It decides only whether the hand-written table is consulted at all, never what the
 * table says: a place the table gives no zone names nothing however close it stands, and both of
 * the pairings past `GATE_MATCH_CLOSE` (102 m and 223 m, measured) are rows of that table with
 * their reasons written out. So a wide cap costs nothing and a narrow one would have had two of the
 * seven free-standing gates fall through to no destination at all. Ours.
 */
export const GATE_MATCH_MAX = 250;

/**
 * A pairing past this is printed as one to go and look at. Every gate the archives explain plainly
 * matched inside 62 m; the two that did not are the two named in `PLACE_ZONES` as ours. Ours.
 */
export const GATE_MATCH_CLOSE = 80;

/**
 * Which pack a named place is the way to. **This table is ours.** The archives place the gates and
 * name the places beside them; nothing in them states a destination in a form a program can read,
 * so each row below says what it rests on and the run prints it.
 */
export const PLACE_ZONES = [
  { place: 'kashyyyk_kachirho', to: 'kashyyyk_main', rests: "the place's own key is the pack's" },
  { place: 'kashyyyk_dead_forest', to: 'kashyyyk_dead_forest', rests: "the place's own key is the pack's" },
  { place: 'kashyyyk_hunting_grounds', to: 'kashyyyk_hunting', rests: "the place's own key is the pack's, less the word for the grounds" },
  { place: 'kashyyyk_rryatt_trail', to: 'kashyyyk_rryatt_trail', rests: "the place's own key is the pack's" },
  { place: 'kash_etyyy_gate_to_kachirho', to: 'kashyyyk_main', rests: 'its own description: "This is the gate back to the Kachirho region"' },
  { place: 'dead_entrance_kkowir', to: 'kashyyyk_main', rests: 'its own description: "the gate ... leads back to the proud city of Kachirho"' },
  { place: 'kash_etyyy_hracca_glade_camp', to: 'kashyyyk_south_dungeons', rests: 'its own description: the camp "keeps watch over the entrance to the Hracca Glade", and that pack is a grid of instances the areas table names for that glade' },
  { place: 'kashyyyk_blackscale_compound', to: 'kashyyyk_north_dungeons', rests: "that pack is a grid of instances the areas table names for the slavers, and this is the only gate in its zone no other named place explains" },
];

/**
 * Which pack a gate standing inside a named buildout area opens on. **This table is ours too**, and
 * it is what the repeated gates need: the three zones that are grids of dungeon instances carry no
 * named places at all, and each of their gates is the one way out of the instance it stands in.
 * Counted, not guessed: every gate in each of these zones falls inside an area of the named kind,
 * one gate per instance, and the areas of the other kinds in the same zones carry none.
 */
export const AREA_ZONES = [
  { zone: 'kashyyyk_north_dungeons', area: 'slaver', to: 'kashyyyk_main', rests: 'the way back out of the slavers\' instance, whose entrance stands in that pack' },
  { zone: 'kashyyyk_south_dungeons', area: 'hracca', to: 'kashyyyk_hunting', rests: "the way back out of the glade's instance, whose entrance stands in that pack" },
  { zone: 'kashyyyk_rryatt_trail', area: 'kashyyyk_rryatt_trail_lvl_1_and_2', to: 'kashyyyk_main', rests: "the way back off the trail's bottom level, whose entrance stands in that pack; the trail's upper levels carry no gate" },
];

/**
 * What to call a pack in the prompt. `key` takes the words from the archives' own row for that
 * place; `text` is ours, and there is one, because the archives name the glade only inside another
 * place's description and never as a place of its own.
 *
 * Two of these name half a pack, which is counted rather than glossed over: the zone called here
 * after the glade is 12 instances of the glade and 12 of another kind, and the one called after the
 * slavers' compound is 12 of the compound and 4 of an arena. A zone that is a grid of two kinds of
 * instance has no one name; what is here is the kind whose instances the gates stand in, which is
 * what a player pressing the key is about to walk into, and it is the owner's to overrule.
 */
export const ZONE_NAMES = {
  kashyyyk_main: { key: 'kashyyyk_kachirho' },
  kashyyyk_hunting: { key: 'kashyyyk_hunting_grounds' },
  kashyyyk_dead_forest: { key: 'kashyyyk_dead_forest' },
  kashyyyk_rryatt_trail: { key: 'kashyyyk_rryatt_trail' },
  kashyyyk_north_dungeons: { key: 'kashyyyk_blackscale_compound' },
  kashyyyk_south_dungeons: { text: 'Hracca Glade', ours: true },
};

/**
 * Whether a placed object is one of the gates a zone is entered through.
 *
 * Counted over every converted pack that has a layout (32 of them): 37 objects match, all in six
 * zones of the one world, and no fence, door or wall of any world matches. The test cannot state
 * that -- it has no archives, and the project does not write model identifiers down -- so it drives
 * this with strings built to sit either side of the rule, which restates the rule rather than
 * checking it. The count above is the check, and it is a thing to re-run rather than to trust.
 */
export function isZoneGate(template) {
  return /_zonegate_gate_/.test(String(template ?? ''));
}

/**
 * The client's named places, per world, through the one reader the converter has (`places.mjs`).
 * There is deliberately no second reading of that table here: a row whose Name column names the
 * wrong string table is the sort of thing two readers disagree about, and one archive row must not
 * carry two names in one build. What the gates want that the place list does not is every world at
 * once, since a gate's destination is nearly always named by a row in the zone it leads *to*.
 */
export function readNamedPlaces(vfs, strings = new Map()) {
  const out = new Map();
  for (const world of clientPlaceWorlds(vfs)) {
    const { rows } = readClientPlaces(vfs, world, strings);
    if (rows.length) out.set(world, rows);
  }
  return out;
}

/** Every named place by key, over every world, for naming a gate's destination. */
export function placeNames(byPlanet) {
  const names = new Map();
  for (const list of byPlanet.values()) for (const p of list) if (!names.has(p.key)) names.set(p.key, p.name);
  return names;
}

/** A zone's buildout areas as rectangles, or an empty list where it has none. */
export function readAreas(vfs, zone) {
  const path = `datatables/buildout/areas_${zone}.iff`;
  if (!vfs.has(path)) return [];
  const buf = vfs.read(path);
  if (!buf || buf.length < 12) return [];
  const dt = parseDatatable(parseIff(buf));
  return dt.rows
    .filter((r) => r.area && typeof r.x1 === 'number')
    .map((r) => ({ area: String(r.area), x1: Math.min(r.x1, r.x2), z1: Math.min(r.z1, r.z2), x2: Math.max(r.x1, r.x2), z2: Math.max(r.z1, r.z2) }));
}

/** The smallest named area a point falls inside, which is the instance it belongs to. */
export function areaAt(areas, x, z) {
  let best = null;
  for (const a of areas) {
    if (x < a.x1 || x > a.x2 || z < a.z1 || z > a.z2) continue;
    const size = (a.x2 - a.x1) * (a.z2 - a.z1);
    if (!best || size < best.size) best = { area: a.area, size };
  }
  return best ? best.area : null;
}

/** What a pack is called, in the archives' own words where they have any. */
export function zoneLabel(pack, names = new Map()) {
  const z = ZONE_NAMES[pack];
  if (!z) return null;
  if (z.key) return names.get(z.key) ?? z.text ?? null;
  return z.text ?? null;
}

/**
 * Join a zone's gates to the places and areas around them. Pure: the geometry is the archives', the
 * two lookups are ours, and every row carries the distance it matched on so the run can print it.
 *
 * `places` are the named places of this zone alone (a gate is only ever explained by a place in the
 * world it stands in); `names` is every place in the table by key, since the words a destination is
 * called by usually live in the zone the gate leads *to*.
 */
export function joinGates({ zone, gates, places = [], areas = [], names = new Map() }) {
  const rows = [];
  for (const g of gates) {
    let near = null;
    for (const p of places) {
      const d = Math.hypot(p.x - g.x, p.z - g.z);
      if (!near || d < near.d) near = { place: p, d };
    }
    const matched = near && near.d <= GATE_MATCH_MAX ? near : null;
    const area = areaAt(areas, g.x, g.z);
    let to = null;
    let by = null;
    let rests = '';
    if (matched) {
      const say = PLACE_ZONES.find((r) => r.place === matched.place.key);
      // A place that names the zone the gate already stands in is the gate's own address, not a
      // destination: the way into a forest and the way out of it are the same named place.
      if (say && say.to !== zone) {
        to = say.to;
        by = 'place';
        rests = say.rests;
      }
    }
    if (!to && area) {
      const say = AREA_ZONES.find((r) => r.zone === zone && r.area === area);
      if (say) {
        to = say.to;
        by = 'area';
        rests = say.rests;
      }
    }
    rows.push({
      x: g.x,
      y: g.y,
      z: g.z,
      place: matched ? matched.place.key : null,
      placeName: matched ? matched.place.name : null,
      d: matched ? Math.round(matched.d) : null,
      area,
      to,
      label: to ? zoneLabel(to, names) : null,
      by,
      rests,
    });
  }
  return rows;
}

/**
 * What the run prints: a line per gate that a named place explains, with the distance the pairing
 * matched on, and one line per instance for the repeated gates, which are identical by the dozen
 * and would otherwise bury the two pairings worth looking at.
 */
export function gateLines(zone, rows) {
  const out = [`zone gates: ${rows.length} in ${zone}`];
  const byArea = new Map();
  for (const r of rows) {
    if (r.by === 'area') {
      const key = `${r.area}->${r.to}`;
      const had = byArea.get(key);
      if (had) had.n++;
      else byArea.set(key, { row: r, n: 1 });
      continue;
    }
    const at = `${Math.round(r.x)},${Math.round(r.z)}`;
    const place = r.place ? `${r.placeName} at ${r.d} m${r.d > GATE_MATCH_CLOSE ? ' (FAR: worth a look)' : ''}` : 'no named place within reach';
    const dest = r.to ? `${r.to}${r.label ? ` "${r.label}"` : ''} (ours: ${r.rests})` : 'nowhere named: this gate says so and does nothing';
    out.push(`  gate at ${at} -> ${dest}; nearest named place: ${place}`);
  }
  for (const { row, n } of byArea.values()) {
    out.push(`  ${n} gate${n === 1 ? '' : 's'}, one in each instance the areas table calls ${row.area} -> ${row.to}${row.label ? ` "${row.label}"` : ''} (ours: ${row.rests})`);
  }
  const unset = rows.filter((r) => !r.to).length;
  if (unset) out.push(`  ${unset} of ${rows.length} left without a destination on purpose`);
  return out;
}

/**
 * Write <out>/gates.json for a zone that has gates, from the pack's own layout.json (which is what
 * the game really loads, so the join is against exactly the gates the pack carries). A zone with no
 * gates writes nothing at all and the game reads a missing file as a world with no gates, which is
 * what every pack converted before this has.
 */
export function writeZoneGates(vfs, zone, outDir, { log = console.log } = {}) {
  const layoutPath = join(outDir, 'layout.json');
  if (!existsSync(layoutPath)) return null;
  let layout;
  try {
    layout = JSON.parse(readFileSync(layoutPath, 'utf8'));
  } catch (err) {
    log(`zone gates: ${zone}'s layout.json could not be read (${err.message})`);
    return null;
  }
  const gates = (layout.objects ?? []).filter((o) => isZoneGate(o.template));
  if (!gates.length) return null;
  const byPlanet = readNamedPlaces(vfs);
  // A zone with one area has one rectangle covering the whole world, which names nothing: only a
  // zone built as a grid of instances has areas worth asking a gate which of them it stands in.
  const areas = readAreas(vfs, zone);
  const rows = joinGates({ zone, gates, places: byPlanet.get(zone) ?? [], areas: areas.length > 1 ? areas : [], names: placeNames(byPlanet) });
  const out = { planet: zone, format: GATES_FORMAT, center: layout.center, gates: rows };
  const file = join(outDir, 'gates.json');
  writeFileSync(file, JSON.stringify(out));
  for (const line of gateLines(zone, rows)) log(line);
  log(`  -> ${file}`);
  return out;
}
