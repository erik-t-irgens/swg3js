// SOE's own ways about Kashyyyk and Mustafar: where each zone gate lands, the copies a group is sent to on the grid zones,
// the Kachirho tree lifts, the Rryatt Trail's guides, the clone droids the dead come back at, and the two starports'
// terminals, collectors and transports -- built out of the NGE copy's tables, or the reference beside the converter that
// keeps them (`ngeref.mjs`), into `nge/ways.json`, which the game reads (`src/world/ngeWays.ts`).
//
// **What it is and what it is not.** The owner's ruling of 2026-10-31 extends his decision of 2026-10-19 to exactly these:
// Kashyyyk's and Mustafar's gate landings, tree lifts, level moves, dungeon ways in and shuttle terminal places, and what
// they need to work (each crossing's landing, the copies' starts and ways out, the clone mapping's droids, the two
// starports' rows, the areas the copies are). So this reads the zone lines (`travel/zone_transition`), the dungeons
// (`dungeon/space_dungeon`), the clone mapping (`cloning/clone_mapping`), the starports (`structure/municipal/starport`),
// the zone lines a trail guide's server template names, and the buildout rows that are a way -- a door that carries a
// zone line, a dungeon's controller, an instance's controller, a launcher, a dungeon's gate or exit -- and writes names,
// numbers and places, as the overlay of people does. Format knowledge, as `ngepack.mjs` names its spawners: the objvar
// names a way is told by, and the shape of a script's name (`theme_park.dungeon.<dungeon>.<what>`), which is read into a
// dungeon's name and kept, never the script.
//
// **What the server did, read in the copy, and what is ours.** A door carrying a zone line warped whoever used it to the
// line's destination (`zone:x:y:z`); an `instance:` line to an instance controller of the player's choosing, plus the
// line's own offset when it names no room; an `offset:` line to the place of the thing that offered it plus the offset,
// in the world's own frame and never turned (`transition.doZoneToWorld`). A dungeon's launcher sent a group to a copy and
// stood them at the copy's controller plus the dungeon's start; its exit put them at the dungeon's exit. The dead came back
// at the facility the clone mapping names for their zone and area, the rows tried in order. Which copy a group is sent to
// (the server's was a list of copies by how full they were) is ours, the very rule the dungeons' copies use
// (`copyIndex` in `src/world/instances.ts`), and so is every word the game says about any of it.
//
// Pure: the reader and the cli hand everything in, and a node test runs the whole of it over a tree of TEST names.

/** Bumped when the shape of `ways.json` changes in a way the game must know about. */
export const WAYS_FORMAT = 1;

/** The creature a clone droid's spawner stands: where the dead of a grid copy, Kachirho and the hunting grounds come back. */
export const CLONE_DROID = 'clone_droid';

/**
 * The zones whose ways are read: Kashyyyk's and Mustafar's, less the zone of building copies whose ways in and out are
 * `src/world/instances.ts`'s already (the Myyydril caverns and the Avatar Platform: not this wave's).
 */
export const WAY_ZONES = ['kashyyyk_main', 'kashyyyk_hunting', 'kashyyyk_dead_forest', 'kashyyyk_rryatt_trail', 'kashyyyk_north_dungeons', 'kashyyyk_south_dungeons', 'mustafar'];

/** A number rounded to the centimetre, as every place here is written. */
const cm = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** An objvar's text, or ''. */
function ov(r, name) {
  return String(r.objvars?.get(name)?.value ?? '').trim();
}

/**
 * What a buildout row is as a way, or null: the zone line a door carries (`line`), the dungeon a controller is
 * (`controller`), the instance a controller is (`instance`), the dungeon a launcher sends a group to (`ticket`), the dungeon
 * a gate's script names (`gate`: `theme_park.dungeon.<dungeon>.<x>_gate`), and an exit's script (`exit`:
 * `theme_park.dungeon.<package>.exit_terminal`). A row the reference hands over says it already (`way`), since the
 * reference keeps no script.
 */
export function wayFields(r) {
  if (r.way !== undefined) return r.way;
  const out = {};
  const line = ov(r, 'zoneLine');
  if (line) out.line = line;
  const controller = ov(r, 'space_dungeon.name');
  if (controller) out.controller = controller;
  const instance = ov(r, 'instance_name');
  if (instance) out.instance = instance;
  const ticket = ov(r, 'space_dungeon.ticket.dungeon');
  if (ticket) out.ticket = ticket;
  for (const s of r.scripts ?? []) {
    // A starport's own building: what the starports' table is joined to.
    if (String(s) === 'structure.municipal.starport') out.port = 1;
    const m = /^theme_park\.dungeon\.([a-z0-9_]+)\.([a-z0-9_]+)$/i.exec(String(s));
    if (!m) continue;
    if (/_gate$/i.test(m[2])) out.gate = m[1];
    if (m[2].toLowerCase() === 'exit_terminal') out.exit = 1;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Where a zone line goes, as the table writes it: `{ zone, at }` for a place in a zone, `{ instance, zone, cell, offset }`
 * for an instance (a cell of `nocell` names none, and then the offset is from the instance's controller), `{ offset }` for
 * an offset from the thing that offered it, or null for anything else.
 */
export function parseLine(dest) {
  const p = String(dest ?? '').split(':');
  const num = (i) => Number(p[i]);
  if (p[0] === 'offset' && p.length >= 4 && [1, 2, 3].every((i) => Number.isFinite(num(i)))) return { offset: [num(1), num(2), num(3)] };
  if (p[0] === 'instance' && p.length >= 7 && [4, 5, 6].every((i) => Number.isFinite(num(i)))) return { instance: p[1], zone: p[2], cell: p[3] === 'nocell' ? '' : p[3], offset: [num(4), num(5), num(6)] };
  if (p.length === 4 && p[0] && [1, 2, 3].every((i) => Number.isFinite(num(i)))) return { zone: p[0], at: [num(1), num(2), num(3)] };
  return null;
}

/**
 * The level a trail move goes to, by the line's own name: the last of its two places (`<trail>One_<trail>Two` to level 2;
 * `<trail>Gate_<trail>Five` to level 5), and nought for a line back to the trail's gate (`..._zoneIn`). A rule over the
 * names' shape, as `isZoneGate` is one over the templates'; a name of no such shape is -1, a move with no level to say.
 */
export function lineLevel(line) {
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const s = String(line ?? '');
  if (/_zonein$/i.test(s)) return 0;
  const m = /_[a-z]+?(one|two|three|four|five)$/i.exec(s);
  return m ? words[m[1].toLowerCase()] : -1;
}

/** A template's file name with no folder, no `shared_` and no extension, as the reference keeps it. */
function stem(template) {
  return String(template ?? '').replace(/\\/g, '/').split('/').pop().replace(/^shared_/, '').replace(/\.iff$/i, '');
}

/**
 * Every way about the zones, from a reader (the copy's, `nge.mjs`, or the reference's, `ngeref.mjs`, which answer every
 * question alike) and each zone's areas (`areasOf(zone)`: the client's own area rows where the archives are mounted, else
 * the copy's, which agree; each `{ area, x1, z1, x2, z2, eventRequired }`). `kindOf` is the overlay's own rule for what a
 * row is. Returns the file `ways.json` is, and its counts.
 */
export function buildNgeWays({ reader, zones, areasOf, kindOf }) {
  const lines = reader.zoneLines();
  const isLine = (n) => lines.has(n);
  const creatures = reader.creatures();
  const out = { format: WAYS_FORMAT, zones: {}, dungeons: {}, clone: [], ports: {} };
  const controllers = [];
  const instances = [];
  const placedStems = new Set();
  const counts = { gates: 0, lifts: 0, liftDoors: 0, guides: 0, moves: 0, launchers: 0, exits: 0, droids: 0, dungeons: 0, copies: 0, ports: 0, lost: 0 };
  // The copies' own places, gathered as the zones are walked, and resolved once every zone's controllers are known.
  const gates = [];
  const lifts = [];
  for (const zone of zones) {
    const areas = (areasOf(zone) ?? []).filter((a) => a?.area && !a.eventRequired);
    const z = { areas: [], gates: [], lifts: [], guides: [], launchers: [], exits: [], clones: [] };
    out.zones[zone] = z;
    const seen = new Map();
    for (const a of areas) {
      const name = String(a.area);
      const copy = seen.get(name) ?? 0;
      seen.set(name, copy + 1);
      const x1 = Math.min(Number(a.x1), Number(a.x2));
      const z1 = Math.min(Number(a.z1), Number(a.z2));
      const x2 = Math.max(Number(a.x1), Number(a.x2));
      const z2 = Math.max(Number(a.z1), Number(a.z2));
      z.areas.push([name, cm(x1), cm(z1), cm(x2), cm(z2)]);
      const table = reader.buildout(zone, name);
      if (!table) continue;
      // A row's place is its area's corner plus its own (the corner the table writes first, as the overlay adds it).
      const x0 = Number(a.x1) || 0;
      const z0 = Number(a.z1) || 0;
      for (const r of table) {
        if ((Number(r.container) || 0) !== 0 || (Number(r.cell_index) || 0) !== 0) continue;
        const at =[cm(x0 + (Number(r.px) || 0)), cm(r.py), cm(z0 + (Number(r.pz) || 0))];
        const kind = r.kind ?? kindOf(r.server_template_crc, r.scripts, r.objvars);
        // A clone droid: an area spawner standing the droid, the dead's place in its zone and copy.
        if (kind === 'area' && ov(r, 'strSpawns') === CLONE_DROID) z.clones.push({ at, area: name, copy });
        // A trail guide: a static standing a creature whose server template names zone lines.
        if (kind === 'static') {
          const who = ov(r, 'spawns');
          const c = creatures.get(who);
          const pairs = c ? reader.templateLines(String(c.template ?? ''), isLine) : [];
          const moves = [];
          for (const [key, line] of pairs) {
            const to = parseLine(lines.get(line));
            if (!to?.offset || to.instance) continue;
            moves.push({ key, level: lineLevel(line), to: [cm(at[0] + to.offset[0]), cm(at[1] + to.offset[1]), cm(at[2] + to.offset[2])] });
          }
          if (moves.length) z.guides.push({ at, who, area: name, copy, moves });
        }
        const w = wayFields(r);
        if (!w) continue;
        if (w.port) placedStems.add(stem(r.server_template_crc));
        if (w.controller) controllers.push({ name: w.controller, zone, area: name, copy, at });
        if (w.instance) instances.push({ name: w.instance, zone, area: name, copy, at });
        if (w.ticket) z.launchers.push({ at, dungeon: w.ticket, who: ov(r, 'spawns') });
        if (w.gate) gates.push({ zone, at, to: { dungeon: w.gate } });
        if (w.exit) z.exits.push({ at, area: name, copy });
        if (w.line) {
          const to = parseLine(lines.get(w.line));
          if (!to) {
            counts.lost++;
            continue;
          }
          if (to.instance && !to.cell) gates.push({ zone, at, to: { dungeon: to.instance }, line: w.line });
          else if (to.zone && to.at && to.zone !== zone) gates.push({ zone, at, to: { zone: to.zone, at: to.at.map(cm) }, line: w.line });
          else if (to.zone && to.at && to.zone === zone) lifts.push({ zone, at, to: to.at.map(cm) });
        }
      }
    }
  }
  // The dungeons a group is sent a copy of: each space dungeon whose controller stands in these zones (the zone of building
  // copies is not among them: `WAY_ZONES`), stood at its copies' controllers plus its own start, and left by its own
  // exit; and each instance whose line names no room (the trail), stood at its controllers plus the line's offset
  // and left by the zone line its gate in the start's area carries.
  for (const d of reader.spaceDungeons()) {
    const name = String(d.dungeon).trim();
    const mine = controllers.filter((c) => c.name === name && c.zone === String(d.planet).trim()).sort((a, b) => a.copy - b.copy);
    if (!mine.length || String(d.start_cell_name ?? '').trim()) continue;
    const s = [Number(d.start_loc_x) || 0, Number(d.start_loc_y) || 0, Number(d.start_loc_z) || 0];
    const exitZone = String(d.exit_planet ?? '').trim();
    out.dungeons[name] = {
      zone: mine[0].zone,
      area: mine[0].area,
      starts: mine.map((c) => [cm(c.at[0] + s[0]), cm(c.at[1] + s[1]), cm(c.at[2] + s[2])]),
      exit: exitZone ? { zone: exitZone, at: [cm(d.exit_loc_x), cm(d.exit_loc_y), cm(d.exit_loc_z)] } : null,
    };
  }
  for (const [name, dest] of lines) {
    const to = parseLine(dest);
    if (!to?.instance || to.cell || out.dungeons[to.instance]) continue;
    const mine = instances.filter((c) => c.name === to.instance && c.zone === to.zone).sort((a, b) => a.copy - b.copy);
    if (!mine.length) continue;
    // Its way out is the gate standing in the area its copies start in: a line out of the zone.
    const out1 = gates.find((g) => g.zone === to.zone && g.to.zone && g.line && out.zones[to.zone]?.areas.some((a) => a[0] === mine[0].area && g.at[0] >= a[1] && g.at[0] <= a[3] && g.at[2] >= a[2] && g.at[2] <= a[4]));
    out.dungeons[to.instance] = {
      zone: to.zone,
      area: mine[0].area,
      starts: mine.map((c) => [cm(c.at[0] + to.offset[0]), cm(c.at[1] + to.offset[1]), cm(c.at[2] + to.offset[2])]),
      exit: out1 ? { zone: out1.to.zone, at: out1.to.at } : null,
      line: name,
    };
  }
  // A way in is offered only to a dungeon a group can leave: one with no exit is left out, its gates and launchers with it.
  for (const [name, d] of Object.entries(out.dungeons)) if (!d.exit) delete out.dungeons[name];
  // Every gate and door into a dungeon whose copies are known, every gate out of a zone, and each copy's exits.
  for (const g of gates) {
    if (g.to.dungeon && !out.dungeons[g.to.dungeon]) {
      counts.lost++;
      continue;
    }
    out.zones[g.zone].gates.push({ at: g.at, to: g.to });
  }
  for (const zone of zones) {
    const z = out.zones[zone];
    z.launchers = z.launchers.filter((l) => {
      if (out.dungeons[l.dungeon]) return true;
      counts.lost++;
      return false;
    });
    // An exit stands in a dungeon's area: a gate out, to that dungeon's own exit.
    for (const e of z.exits) {
      const d = Object.values(out.dungeons).find((v) => v.zone === zone && v.area === e.area);
      if (!d) {
        counts.lost++;
        continue;
      }
      z.gates.push({ at: e.at, to: { zone: d.exit.zone, at: d.exit.at } });
      counts.exits++;
    }
    delete z.exits;
  }
  // A copy with no gate of its own in its area (the arena's, Bocctyyy's) is left where it is come into: its own people
  // send a group back (`walkOut`), and ours is the spot they stand at.
  for (const d of Object.values(out.dungeons)) {
    const boxes = out.zones[d.zone]?.areas.filter((a) => a[0] === d.area) ?? [];
    const gated = (out.zones[d.zone]?.gates ?? []).some((g) => g.to.zone && boxes.some((a) => g.at[0] >= a[1] && g.at[0] <= a[3] && g.at[2] >= a[2] && g.at[2] <= a[4]));
    if (!gated) d.walkOut = true;
  }
  // The lifts: doors whose lines stay in their own zone, grouped by the places they reach (every door of one tree reaches
  // the same levels), each group's levels lowest first.
  for (const zone of zones) {
    const mine = lifts.filter((l) => l.zone === zone);
    const groups = [];
    for (const d of mine) {
      const key = d.to.join(',');
      let g = groups.find((x) => x.levels.some((l) => l.join(',') === key) || x.doors.some((o) => Math.hypot(o[0] - d.at[0], o[2] - d.at[2]) < 30));
      if (!g) groups.push((g = { doors: [], levels: [] }));
      g.doors.push(d.at);
      if (!g.levels.some((l) => l.join(',') === key)) g.levels.push(d.to);
    }
    for (const g of groups) g.levels.sort((a, b) => a[1] - b[1]);
    out.zones[zone].lifts = groups;
  }
  // Where the dead come back: the clone mapping's rows for these zones, in the table's own order.
  for (const r of reader.cloneMapping()) if (zones.includes(r.scene)) out.clone.push([r.scene, r.area, r.cloneScene, r.cloneArea]);
  // The starports these zones place, with their children as the table writes them.
  for (const [template, s] of reader.starports()) {
    if (!placedStems.has(stem(template))) continue;
    out.ports[template] = { shuttleport: !!s.shuttleport, children: s.children.map((c) => ({ ...c, x: cm(c.x), y: cm(c.y), z: cm(c.z) })) };
  }
  for (const z of Object.values(out.zones)) {
    counts.gates += z.gates.length;
    counts.lifts += z.lifts.length;
    counts.liftDoors += z.lifts.reduce((s, l) => s + l.doors.length, 0);
    counts.guides += z.guides.length;
    counts.moves += z.guides.reduce((s, g) => s + g.moves.length, 0);
    counts.launchers += z.launchers.length;
    counts.droids += z.clones.length;
  }
  counts.dungeons = Object.keys(out.dungeons).length;
  counts.copies = Object.values(out.dungeons).reduce((s, d) => s + d.starts.length, 0);
  counts.ports = Object.keys(out.ports).length;
  out.counts = counts;
  return out;
}

/**
 * The children of the starports `ways` carries, as the travel command places a building's children
 * (`readBuildingChildren`'s shape: `{ kind, model, x, y, z, yaw, cell }`, plus `cellName` for a child in a named room
 * of its building, which the command turns into the room's index from the building's own cells). A child the table
 * stands outside (`WORLD_DELTA`) is a delta the server took off the structure's place after turning it by the
 * structure's own yaw (`travel.java`: `s - R(delta)`), so it is written negated, which `placeChildren` turns and adds;
 * its heading, degrees added to the structure's yaw, is written as the child's own yaw in radians. `kindOfChild` and
 * `modelOfKind` are the travel command's own (`travel.mjs`), handed in. Keyed by both spellings of the template.
 */
export function waysPortChildren(ports, kindOfChild, modelOfKind) {
  const out = new Map();
  for (const [template, s] of Object.entries(ports ?? {})) {
    const kids = [];
    for (const c of s.children ?? []) {
      const kind = kindOfChild(c.template);
      if (!kind) continue;
      const yaw = Math.round((((Number(c.heading) || 0) * Math.PI) / 180) * 1e4) / 1e4;
      const model = modelOfKind(kind, c.template);
      if (c.cell && c.cell !== 'WORLD_DELTA') kids.push({ kind, model, x: c.x, y: c.y, z: c.z, yaw, cell: -1, cellName: c.cell });
      else kids.push({ kind, model, x: -c.x, y: -c.y, z: -c.z, yaw, cell: -1 });
    }
    if (!kids.length) continue;
    out.set(template, kids);
    out.set(template.replace(/\/([^/]+)$/, '/shared_$1'), kids);
  }
  return out;
}

/**
 * Whether a world's travel.json was written before the starports the ways name were read (`status`): its layout places
 * one of those buildings (`ports`, both spellings of each template) at the top level and no row of the file stands in it.
 * A file written with `--nge=none` (`leftOut`: its `nge` says so) left them out by choice and is never asked for again,
 * as `spawns` is not, or every `status` asked for a run that stands them back.
 */
export function ngePortsUnstood(objects, rows, ports, leftOut = false) {
  if (leftOut || !ports?.size) return false;
  const placed = (objects ?? []).some((o) => o && !o.contained && ports.has(o.template));
  return placed && !(rows ?? []).some((r) => ports.has(r.building));
}

/**
 * The children `waysPortChildren` gives, for one world: a child in a named room of its building takes that room's index
 * from the building's own cells as this world's pack has them (`cellsOf(template)`: the cells of the model its layout
 * places the building as, `{ index, name }`, or null where this world places no such building), and one whose room the
 * model has not got is left out and counted (`lost`). Every other template's children are as they were.
 */
export function childCellsFor(byTemplate, cellsOf) {
  const out = new Map();
  let lost = 0;
  for (const [template, kids] of byTemplate) {
    const cells = kids.some((k) => k.cellName) ? cellsOf(template) : null;
    if (!cells) {
      out.set(template, kids);
      continue;
    }
    const kept = [];
    for (const k of kids) {
      if (!k.cellName) {
        kept.push(k);
        continue;
      }
      const c = cells.find((x) => x.index > 0 && String(x.name).trim().toLowerCase() === String(k.cellName).trim().toLowerCase());
      if (!c) {
        lost++;
        continue;
      }
      const { cellName: _n, ...rest } = k;
      kept.push({ ...rest, cell: c.index });
    }
    if (kept.length) out.set(template, kept);
  }
  return { byTemplate: out, lost };
}
