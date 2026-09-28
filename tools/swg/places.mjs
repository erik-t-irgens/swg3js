// The client's own named places: `datatables/clientpoi/clientpoi.iff`, 307 rows of Name,
// Description, Planet, Appearance, X, Y and Z, whose two string ids resolve through
// `string/en/clientpoi_n.stf` and `clientpoi_d.stf`. Nothing in this project read it until now: a
// planet's map took its names from the emulator's region scripts, which say nothing at all about
// the lava world or any zone of the tree world, so both came out with no names on them.
//
// Four things about the table are not what they look like, each measured over all 307 rows rather
// than assumed.
//
//  - The Appearance column is empty on every row and Y is 0 on every row of the ten launch worlds
//    (it is the ground height on the two expansion worlds). So a row is a name, a description and a
//    point, and nothing else: it carries no radius, which is why a place from here is drawn as a
//    dot and never as a ring.
//  - 131 of the rows are on the ground worlds this game has. The other 176 are 174 rows of the space
//    zones' stations, hyperspace points, asteroid fields and nebulae, which come from each zone's
//    own tables already, plus 2 rows of a sample world that is not in the game.
//  - Exactly one row's Name column names the *description* table rather than the name table, so
//    reading that column's own table gives a whole sentence where a name belongs. Measured: the
//    name table holds a string for every one of the 307 keys, that row's included, so the column is
//    a mistake in the row and not a statement that the place is nameless. A name is looked up by
//    the row's own key, and only a key the name table has nothing for (none today) is spelled out,
//    as a region with no string already is.
//  - Names repeat: six rows on the ground worlds carry a name an earlier row already carried (one
//    village name on three rows of one world, three village names on two rows each of a second, and
//    one camp name on two rows of a third). The client drew every one of them, so a repeat is kept
//    when it stands apart and only a repeat in the same spot is dropped.
//
// Everything here is pure or reads the archives; `tools/swg/tests/places.test.ts` drives the rules
// with made-up rows and no archive at all.

import { parseIff } from './iff.mjs';
import { localize, parseDatatable } from './datatable.mjs';

/** The client's table of named places. */
export const CLIENT_POI_TABLE = 'datatables/clientpoi/clientpoi.iff';

/**
 * The string table every name is asked for, by the row's own key: the Name column names it on 306
 * of the 307 rows, and asking it for the key of the one row that names the description table gives
 * that place its name back rather than a sentence. Counted over the retail archives: it holds a
 * string for all 307 keys, 37 rows point their *Description* column at it, and 47 rows of the 307
 * have two texts that read alike — 11 of them on the tree world, where the description repeats the
 * name word for word, so "the two texts read alike" as the test for a nameless row would have
 * thrown away nine of that world's ten names.
 */
export const NAME_TABLE = 'clientpoi_n';

/**
 * A reach this big or bigger is drawn on the ground map as a ring of its own size rather than as a
 * dot. It mirrors `POI_RING_MIN` in `src/ui/mapUi.ts`, which the test reads as text and pins against
 * this, because a converter module cannot import a browser one.
 */
export const RING_M = 200;

/**
 * Two rows of the table with one name and no more than this between them are the same place written
 * twice; further apart they are the two villages the client really drew. Ours, and the table has no
 * such pair on any ground world, so it costs nothing today and guards a rerun against a future one.
 */
export const SAME_SPOT_M = 25;

/**
 * How near a port has to stand to a named place to be called after it, when no city holds it. The
 * same 300 m the city rule already uses for a city with no reach of its own.
 */
export const PORT_NEAR_M = 300;

/** "jabbas_palace" -> "Jabbas Palace" */
export function title(key) {
  return key.split('_').filter(Boolean).map((w, i) => (i > 0 && /^(of|the|in|on|at|and|with)$/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
}

/** One name as a key: what counts as the same name in two sources. */
export function placeKey(name) {
  return String(name ?? '').trim().toLowerCase();
}

/** A string table's text as a single line: the tables hold the odd stray newline. */
function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

const tableCache = new WeakMap();

/** Every row of the client's table, parsed once per mounted archive set. */
function allRows(vfs) {
  let rows = tableCache.get(vfs);
  if (!rows) {
    rows = vfs.has(CLIENT_POI_TABLE) ? parseDatatable(parseIff(vfs.read(CLIENT_POI_TABLE))).rows : [];
    tableCache.set(vfs, rows);
  }
  return rows;
}

/**
 * Every world the table says anything about, in the order it first names them (27 on the retail
 * archives). The place list asks per planet because a pack is per planet; the zone gates ask for
 * this because a gate's destination is usually named by a row in the zone it leads *to*, and which
 * zone that is should not be a table written out by hand somewhere else.
 */
export function clientPlaceWorlds(vfs) {
  const out = [];
  const seen = new Set();
  for (const r of allRows(vfs)) {
    const w = String(r.Planet ?? '');
    if (!w || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

/**
 * The client's named places on one planet, in the table's own order, as the place list wants them.
 * `strings` is the caller's string-table cache. A row the table cannot name at all is labelled from
 * its key, and both texts are collapsed to one line.
 */
export function readClientPlaces(vfs, planet, strings = new Map()) {
  const rows = [];
  let unnamed = 0;
  let missing = 0;
  for (const r of allRows(vfs)) {
    if (r.Planet !== planet) continue;
    const id = String(r.Name ?? '');
    const key = id.split(':').pop() ?? '';
    const desc = oneLine(localize(vfs, r.Description, strings));
    // The name is looked up by the row's own **key**, never through the table its Name column names.
    // Measured over the retail archives rather than reasoned about: the name table holds a string
    // for every one of the 307 keys, the one row whose Name column names the *description* table
    // included, so that column is a mistake in the row and not a statement that the place has no
    // name -- read the column's own table and that place comes out called a whole sentence, and
    // asked for its key it comes out called what the client called it.
    //
    // Two faults, counted apart: a Name column naming the wrong table (one row today, named by its
    // key all the same), and a key the name table has nothing for (none today), which is the only
    // row labelled from its key. Calling them the same thing would hide the second.
    if (id.replace(/^@/, '').split(':')[0] !== NAME_TABLE) unnamed++;
    let name = key ? oneLine(localize(vfs, `@${NAME_TABLE}:${key}`, strings)) : '';
    if (!name) {
      name = title(key);
      missing++;
    }
    const place = { key, name, x: r.X, z: r.Z, kind: 'place', r: 0 };
    // Y is 0 on every row of the ten launch worlds and the ground height on the two expansion
    // worlds, so it is written only where it says something: 131 zeroes in ten packs are dead
    // weight, and every reader treats an absent field as absent.
    if (r.Y) place.y = r.Y;
    // On 10 of the 131 ground rows the description is the name again (9 of them on one world); only
    // a description that says something more is worth the bytes in every pack that carries it.
    if (desc && desc !== name) place.desc = desc;
    rows.push(place);
  }
  return { rows, unnamed, missing };
}

/**
 * The client's places and ours in one list. The archive wins a name clash — it is the client's own
 * word for the place and ours is the emulator's — with one exception: **a name our list already
 * draws as a ring keeps its row**, which is every city and every other row of ours whose reach is
 * `RING_M` or more. The reason is the same in both cases and it is the thing the client's table has
 * not got: a row of ours is a name *and a reach*, and it is what names the ports inside it, while
 * the table carries neither a radius nor a kind. Letting the archive win a clash there would turn a
 * ring hundreds of metres across into a bare dot, and move it as well — the swamp on the first world
 * is 1,168 m across and the table's point for it is 1,009 m from ours, so the dot would not even
 * land inside the ring it replaced. The kept row does take the client's own description, which is
 * the one thing the archive's row has that ours has not.
 *
 * That exception is ours; the run prints how often it fired, per planet. Over the eighteen worlds at
 * the time of writing it is 8 rows: seven named areas and landmarks whose reach runs from 250 m to
 * 1,168 m, and one city of 201 m.
 *
 * Returns the merged list and the counts, so the run can say what each side gave.
 */
export function mergePlaceLists(archive, ours) {
  const places = [];
  const seen = new Set();
  const fromArchive = new Set();
  const ringed = new Set();
  for (const p of ours) if (p.kind === 'city' || (p.r ?? 0) >= RING_M) ringed.add(placeKey(p.name));
  // What the archive's losing row leaves behind, handed to our row when it is pushed below. Nothing
  // in `ours` is written to: the caller's list is its own.
  const wordsFor = new Map();
  let clashed = 0;
  let ringsKept = 0;
  let repeats = 0;
  let sameSpot = 0;
  for (const a of archive) {
    const k = placeKey(a.name);
    if (ringed.has(k)) {
      clashed++;
      ringsKept++;
      if (a.desc && !wordsFor.has(k)) wordsFor.set(k, a.desc);
      continue;
    }
    if (places.some((p) => placeKey(p.name) === k && Math.hypot(p.x - a.x, p.z - a.z) <= SAME_SPOT_M)) {
      sameSpot++;
      continue;
    }
    if (seen.has(k)) repeats++;
    seen.add(k);
    fromArchive.add(k);
    places.push(a);
  }
  // A name our own list holds twice is dropped the second time, as it always was, and is not a
  // clash: a clash is a name in both sources, which is the only thing this decision changes.
  for (const o of ours) {
    const k = placeKey(o.name);
    if (seen.has(k)) {
      if (fromArchive.has(k)) clashed++;
      continue;
    }
    seen.add(k);
    const words = wordsFor.get(k);
    places.push(words && !o.desc ? { ...o, desc: words } : o);
  }
  return { places, clashed, ringsKept, repeats, sameSpot };
}

/**
 * Is the table in the same frame as the world snapshot? The rows carry no answer, so the run
 * measures it: how far each named place is from the nearest object the snapshot places, as the
 * numbers stand and with X mirrored. A named place is a place with something built at it, so the
 * frame that is right comes out much the tighter; a run whose mirrored median beats the plain one is
 * a run that has found something and says so.
 *
 * `points` are the snapshot's own placed objects, `[{ x, z }]`. Distances in metres.
 */
export function frameCheck(rows, points) {
  const near = (x, z) => {
    let best = Infinity;
    for (const p of points) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  const plain = [];
  const flipped = [];
  let worst = null;
  for (const r of rows) {
    const a = near(r.x, r.z);
    plain.push(a);
    flipped.push(near(-r.x, r.z));
    if (!worst || a > worst.m) worst = { name: r.name, m: Math.round(a) };
  }
  // A true median: the mean of the two middle values on an even-length list. Taking the upper of the
  // two is close enough for a log line and wrong for comparing two runs, which is what this is for.
  const mid = (list) => {
    if (!list.length) return null;
    const s = list.slice().sort((a, b) => a - b);
    const h = s.length >> 1;
    return Math.round(s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2);
  };
  return { rows: rows.length, points: points.length, asIs: mid(plain), mirrored: mid(flipped), worst };
}

/**
 * The buildings a shuttle leaves from whose template says neither `starport` nor `shuttleport`, with
 * the kind of port each is. There is one: Theed's royal hangar, the city's starport, whose transports
 * land inside it. Measured over the Core3 reference's travel buildings, it and a rebel camp's lone
 * shuttle (a camp, not a port) are the only two templates that carry a terminal, a collector or a
 * shuttle without either word in their name, and the server's own list of Naboo's travel points
 * makes the hangar a place a shuttle leaves the world from. Both spellings are here because the
 * snapshot names a building by its shared template and the server's scripts by its own.
 */
export const PORT_BUILDINGS = new Map([
  ['object/building/naboo/shared_hangar_naboo_theed.iff', 'starport'],
  ['object/building/naboo/hangar_naboo_theed.iff', 'starport'],
]);

/**
 * Which kind of port a placed object is, by its template: `starport`, `shuttleport` or null. A named
 * building of `PORT_BUILDINGS` is what that says; otherwise the template's own name, and only under
 * `object/building/`. The name test alone once took a starport *sign* for a starport: one stands 85 m
 * from Mos Entha's starport, came first in the snapshot and so took the port's row onto the sign,
 * and every sign of the kind in a town is a `static` object and never a building.
 */
export function portKindOf(template) {
  const t = String(template ?? '');
  const named = PORT_BUILDINGS.get(t);
  if (named) return named;
  if (!t.startsWith('object/building/')) return null;
  return t.includes('starport') ? 'starport' : t.includes('shuttleport') ? 'shuttleport' : null;
}

/**
 * How near one of the server's own travel points must be to a port building to lend it its name,
 * metres. Measured over the sixteen port buildings that share their label with another on the ten
 * worlds the emulator covers: each one's own point is 20 to 24 m from its origin (the spot its shuttle
 * lands), and the nearest point of the same kind that is another port's is 250 m off. Ours.
 */
export const SERVER_POINT_NEAR_M = 60;

/** The letter a port takes when nothing names it apart from its neighbours: A, B, C, ... then 27, 28. */
function portLetter(n) {
  return n < 26 ? String.fromCharCode(65 + n) : String(n + 1);
}

/**
 * Names for the ports a world's snapshot places, one each, never two alike.
 *
 * `found` is every port building in the order the scan met it, `{ x, z, kind, label }` with `label`
 * what `portLabel` calls it; `points` is the server's own travel points on that world, `{ name, x, z,
 * starport }` in the snapshot's frame (the Core3 reference's `readTravelPoints`); `taken` is the keys
 * (`placeKey`) of the names the place list already holds, which no port may take.
 *
 * A port whose label is its own keeps it, so a name is exactly what it always was. Where two or three
 * ports share a label -- a town with more than one shuttleport, which Coronet, Tyrena, Bela Vistal,
 * Theed, Keren, Mos Entha and Mos Espa all have -- the whole group is named the way the game named
 * them, by the server's own travel point of the same kind standing nearest each (`Theed Shuttle A`,
 * `Keren Shuttleport South`, `Mos Espa Shuttleport East`), and one the server names nothing near is
 * given the label and a letter (`Theed Shuttleport B`), which is ours. Before this the second and third
 * of a label were dropped, and their terminals belonged to no port or to the wrong one.
 *
 * Returns the names in `found`'s order and how many came from the server and how many were lettered.
 */
export function namePorts(found, points = [], taken = new Set(), near = SERVER_POINT_NEAR_M) {
  const names = found.map(() => null);
  const used = new Set(taken);
  const groups = new Map();
  found.forEach((p, i) => {
    const k = placeKey(p.label);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  });
  // The ports whose label is theirs alone, first, so no group can take a name one of them carries.
  for (const [k, idx] of groups) {
    if (idx.length !== 1 || used.has(k)) continue;
    names[idx[0]] = found[idx[0]].label;
    used.add(k);
  }
  let fromServer = 0;
  let lettered = 0;
  for (const idx of groups.values()) {
    if (names[idx[0]] !== null) continue;
    // Each point to the nearest port of its own kind, the nearest pairs first, so a point stands for
    // one port and a port takes one point.
    const pairs = [];
    for (const i of idx) {
      for (let j = 0; j < points.length; j++) {
        const q = points[j];
        if (!q || typeof q.name !== 'string' || !q.name.trim() || !!q.starport !== (found[i].kind === 'starport')) continue;
        const d = Math.hypot(q.x - found[i].x, q.z - found[i].z);
        if (d <= near) pairs.push({ i, j, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d || a.i - b.i || a.j - b.j);
    const pointTaken = new Set();
    for (const { i, j } of pairs) {
      if (names[i] !== null || pointTaken.has(j)) continue;
      const name = points[j].name.trim();
      if (used.has(placeKey(name))) continue;
      names[i] = name;
      used.add(placeKey(name));
      pointTaken.add(j);
      fromServer++;
    }
    let n = 0;
    for (const i of idx) {
      if (names[i] !== null) continue;
      let name;
      do name = `${found[i].label} ${portLetter(n++)}`;
      while (used.has(placeKey(name)));
      names[i] = name;
      used.add(placeKey(name));
      lettered++;
    }
  }
  return { names, fromServer, lettered };
}

/** How far from its building a port's row may stand and still be that building's: the scan writes it at the origin. */
export const PORT_ROW_M = 1;

/**
 * The port buildings a world's layout places that have no row of their own kind in its place list
 * (`rows`, a `pois.json`'s list), each `{ template, x, z, kind }`: what `status` asks `pois` again for.
 * A pack written before `portKindOf` has none for Theed's hangar, none for the second and third
 * shuttleport of a town, and Mos Entha's starport row on a sign 85 m from the building.
 */
export function portsWithoutRow(objects, rows) {
  const ports = (rows ?? []).filter((r) => r && (r.kind === 'starport' || r.kind === 'shuttleport'));
  const out = [];
  for (const o of objects ?? []) {
    if (!o || o.contained) continue;
    const kind = portKindOf(o.template);
    if (!kind) continue;
    if (ports.some((r) => r.kind === kind && Math.hypot(r.x - o.x, r.z - o.z) <= PORT_ROW_M)) continue;
    out.push({ template: o.template, x: o.x, z: o.z, kind });
  }
  return out;
}

/**
 * What to call a port: the city it stands in (the smallest whose reach, or 300 m, holds it), else
 * the client's own name for the nearest named place within `PORT_NEAR_M`, else its coordinates. The
 * second branch is what gives the tree world's own port a name at last; it is ours, and it can only
 * ever fire where no city holds the port.
 */
export function portLabel(x, z, places, label) {
  let city = null;
  for (const c of places) {
    if (c.kind !== 'city') continue;
    if (Math.hypot(c.x - x, c.z - z) > Math.max(c.r, PORT_NEAR_M)) continue;
    if (!city || c.r < city.r) city = c;
  }
  if (city) return { name: `${city.name} ${label}`, from: 'city' };
  let near = null;
  let nearD = PORT_NEAR_M;
  for (const p of places) {
    if (p.kind !== 'place') continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < nearD) {
      nearD = d;
      near = p;
    }
  }
  if (near) return { name: `${near.name} ${label}`, from: 'place' };
  return { name: `${label} (${x.toFixed(0)}, ${z.toFixed(0)})`, from: 'nowhere' };
}
