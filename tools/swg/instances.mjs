// The instances: the dungeons the game stood a copy of for each group, and what stands in each copy.
//
// The `dungeon1` zone is a box of copies. Its snapshot places the Corellian corvette sixteen times for
// each of the three runs it was flown for, and its buildout table ten times each of the heroic Star
// Destroyer, Axkva Min's prison, the IG-88 arena, the Exar Kun tomb and the meatlump hideout, all parked
// a few hundred metres to a kilometre and a half apart in an empty sky. The server sent a group to one
// copy and stood that copy's crew in it; the client holds nothing of the crews at all.
//
// So what each copy holds comes from two places, and the pack says which. **The corvette's crew and
// fittings are the emulator's** (`readCorvette`: 268 people and 43 things over the three runs, keyed by
// the room's *name* rather than by a cell id, since the ship was a building the server stood again for
// every group). They are joined here to every copy of the matching faction's template through the
// copy's own cells, the way every other indoor row is joined (`intoRoom` through `roomsOf`), so a copy's
// crew is that copy's rows and no other's and each row keeps a name of its own in every copy -- a
// server shares a body by its row's name, and one name in sixteen copies would be one body. **The Star
// Destroyer's crew is ours**: no data anywhere stands anybody aboard it, and the owner asked for an
// Imperial crew by room kind, so each of its rooms takes the corvette's own Imperial crew (the run the
// Alliance flew against a ship the Empire held) of the matching kind, as many as that kind's room
// held there scaled by how much more floor this room has, each stood on a point of the room's own
// floor drawn from a seed. Every row of it says `ours`. The other heroics stay empty: nothing holds
// anybody for them.
//
// Pure: the cli reads the archives and the packs and hands the answers here, so the node test runs the
// very joins on rows written by hand.

import { createHash } from 'node:crypto';

/** Bumped when what an instance row or fitting carries changes; `status` asks again below it. */
export const INSTANCES_FORMAT = 1;

/** The run a corvette copy was stood for, read off its template as the emulator read it; null for anything else. */
export function corvetteFactionOf(template) {
  if (!/space_dungeon_corellian_corvette/.test(template ?? '')) return null;
  return /imperial/.test(template) ? 'imperial' : /rebel/.test(template) ? 'rebel' : 'neutral';
}

/** Whether a template is the heroic Star Destroyer's building, whose rooms take a crew of ours. */
export function isStarDestroyerDungeon(template) {
  return /space_dungeon_star_destroyer\.iff$/.test(template ?? '');
}

/** A model's rooms by name, from its manifest entry's own cells: the names the corvette's rows are written against. */
export function cellIndexByName(cells) {
  const out = new Map();
  for (const c of cells ?? []) if (c && c.index > 0 && typeof c.name === 'string' && !out.has(c.name)) out.set(c.name, c.index);
  return out;
}

/**
 * Every copy of a building in a snapshot, flattened with its world transforms (`flattenWithWorldTransforms`
 * over the snapshot with its buildouts merged): `{ id, template, pos, q, cells }`, `cells` the room index to
 * the id of the cell object holding that room. `want` says which templates are copies. In the order the
 * snapshot lists them, which is the order every run reads them in.
 */
export function copiesIn(entries, templates, want) {
  const out = [];
  const byId = new Map();
  for (const e of entries) {
    const tpl = templates[e.node?.templateIndex] ?? '';
    if (!e.parentId && want(tpl) && e.world) {
      const copy = { id: e.node.id, template: tpl, pos: e.world.pos, q: e.world.q, cells: new Map() };
      out.push(copy);
      byId.set(e.node.id, copy);
    }
  }
  for (const e of entries) {
    if (!e.parentId || !(e.node?.cellIndex > 0)) continue;
    const copy = byId.get(e.parentId);
    if (copy && /\/cell\//.test(templates[e.node.templateIndex] ?? '') && !copy.cells.has(e.node.cellIndex)) copy.cells.set(e.node.cellIndex, e.node.id);
  }
  return out;
}

/** A row's name, as `settleStatics` names every other: who, where as written and which cell, with a count for twins. */
function keyOf(seen, parts) {
  const base = parts.join('|');
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return createHash('sha1').update(`${base}#${n}`).digest('hex').slice(0, 12);
}

/**
 * The corvette's crews, one row per person per copy of the matching faction's ship, in the raw shape the
 * emulator's other rows have before `packRow` carries them out of their room (`{ key, who, x, y, z,
 * heading, cell, respawn, ... }`, the place in the room's own frame). `respawn` is nought, the server's
 * own for every one of them: a crew killed stays down. Played alone that is until the world is left, since
 * the next visit stands the copy afresh; with a server it is the longest a server holds any death, an hour
 * (`STAYS_DOWN_SECONDS`), kept by the row's own name, so a group sent back to the same copy within the hour
 * finds whoever it killed still down. Nothing here is a time limit on a run (the owner's D6 set none). A row
 * whose room the model has no cell of that name for is counted as lost rather than stood somewhere else.
 */
export function corvetteCrewRows(corvette, copies, roomIndex, world = 'dungeon1') {
  const rows = [];
  const seen = new Map();
  let lost = 0;
  for (const copy of copies) {
    const faction = corvetteFactionOf(copy.template);
    const crew = faction ? (corvette?.[faction] ?? []) : [];
    for (const r of crew) {
      const index = roomIndex.get(r.room);
      const cell = index ? copy.cells.get(index) : undefined;
      if (!cell) {
        lost++;
        continue;
      }
      const key = keyOf(seen, [world, r.who, r.x, r.y, r.z, cell]);
      rows.push({ key, who: r.who, x: r.x, y: r.y, z: r.z, heading: r.heading, cell, respawn: 0, gated: false, where: 'dungeon', from: 'corvette' });
    }
  }
  return { rows, lost };
}

/** What a fitting of the corvette does when used, in this game's words, by the emulator's own setup call. */
const FITTING_USE = { setupKeypad: 'keypad', setupRoomPanel: 'panel', setupEscapePod: 'pod' };

/**
 * The corvette's fittings, one per thing per copy that stands it (a thing written for one faction's run
 * stands in that faction's copies alone), as the rows `fittings.json` carries: the place in the room's own
 * frame and the building's place beside it, as `placeChildren` writes every indoor child. A keypad and a
 * room panel say which room they open (`opens`, by name and by index) and an escape pod's console says it
 * is one (`use`), which is what pressing them does here; everything else is a thing to look at.
 */
export function corvetteFittingRows(corvette, copies, roomIndex, modelOf) {
  const rows = [];
  let lost = 0;
  for (const copy of copies) {
    const faction = corvetteFactionOf(copy.template);
    if (!faction) continue;
    const yaw = yawOfLayoutQ(copy.q);
    for (const s of corvette?.statics ?? []) {
      if (s.faction && s.faction !== faction) continue;
      const cell = roomIndex.get(s.room);
      const model = modelOf(s.template);
      if (!cell || !model) {
        lost++;
        continue;
      }
      const row = { template: s.template, model, building: copy.template, at: copy.id ?? null, cell, x: s.x, y: s.y, z: s.z, yaw: s.heading, bx: copy.pos[0], by: copy.pos[1], bz: copy.pos[2], byaw: Math.round(yaw * 1e4) / 1e4 };
      const use = FITTING_USE[s.fn];
      if (use) row.use = use;
      if (s.name) row.name = s.name;
      if ((use === 'keypad' || use === 'panel') && s.data && roomIndex.has(s.data)) {
        row.opens = s.data;
        row.opensCell = roomIndex.get(s.data);
      }
      rows.push(row);
    }
  }
  return { rows, lost };
}

/** A snapshot quaternion's yaw, `[w, x, y, z]` as the flattener writes it. */
function yawOfLayoutQ(q) {
  if (!Array.isArray(q) || q.length < 4) return 0;
  const [w, x, y, z] = q.map(Number);
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
}

/** A room's kind on the corvette: its name with the number the layout gives every room taken off. */
export function corvetteKindOf(name) {
  return String(name ?? '').replace(/\d+$/, '');
}

/**
 * Which of the corvette's room kinds each of the Star Destroyer's rooms is, for the crew of ours: ours,
 * every line, by what the room is called. A hangar is crewed as the corvette's barracks are, the command
 * deck as its bridge, an engineering or reactor room as its thruster room, and so on. The lift shafts
 * are left empty, as every route through one is left out (`LIFT_CELL`).
 */
export const SD_ROOM_KINDS = [
  [/^hallway\d*$|^undercarriage$|^detention$/, 'hall'],
  [/hangar|hangarbay|^security$|^flightsecurity$|^anteroom$/, 'barracks'],
  [/^commandeck$|^flightctrl$/, 'bridge'],
  [/^officerqrtr$/, 'officerquarters'],
  [/^room\d+$/, 'vipquarters'],
  [/^hyperdrive$/, 'hyperdrive'],
  [/engineering|power|reactor|cooling|^tools$|^decontamination$|^thruster$/, 'thrusterroom'],
  [/^navcomputer$/, 'navroom'],
  [/^radar$|^communications$/, 'radarroom'],
  [/^weaponsctrl$|^tractorbeam$/, 'upperturret'],
];

/** The Star Destroyer room's corvette kind, or null for a room nobody of ours stands in (a lift, the outside). */
export function sdKindOf(name) {
  const n = String(name ?? '');
  if (/elevator|lift|^exterior$|^r0$/.test(n)) return null;
  for (const [re, kind] of SD_ROOM_KINDS) if (re.test(n)) return kind;
  return null;
}

/**
 * Every invented number of the crew of ours: how many times a corvette room's crew a far bigger room may
 * take, and the most any one room takes. Nothing else is invented: who and how many per kind are the
 * corvette's own rows, and where they stand is the room's own floor.
 */
export const OUR_CREW = { scaleMax: 3, perRoomMax: 6 };

/** A floor's triangles as `[ax, ay, az, bx, by, bz, cx, cy, cz, area]`, from a cell's `floor` block (model frame). */
export function floorTriangles(floor) {
  const out = [];
  const v = floor?.v;
  const t = floor?.t;
  if (!Array.isArray(v) || !Array.isArray(t)) return out;
  for (let i = 0; i + 10 <= t.length; i += 10) {
    const a = t[i] * 3;
    const b = t[i + 1] * 3;
    const c = t[i + 2] * 3;
    if (![a, b, c].every((k) => k >= 0 && k + 2 < v.length)) continue;
    const ux = v[b] - v[a];
    const uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a];
    const wz = v[c + 2] - v[a + 2];
    const area = Math.abs(ux * wz - uz * wx) / 2;
    if (area > 1e-4) out.push([v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2], v[c], v[c + 1], v[c + 2], area]);
  }
  return out;
}

/** A number in [0, 1) that depends on nothing but `text`. */
function unit(text) {
  return parseInt(createHash('sha1').update(text).digest('hex').slice(0, 8), 16) / 0x100000000;
}

/**
 * The Star Destroyer's crew of ours, in the raw shape of the emulator's rows (`{ key, who, x, y, z, heading,
 * cell, ... }`, the place in the room's own frame, the snapshot's way round: the floor's X, which the pack
 * flipped with the meshes, is flipped back). For each room the corvette has a kind for (`sdKindOf`): the
 * corvette's crew of that kind (`crew`, the Alliance's run, whose ship the Empire held) counted per room
 * of the kind and their floor measured (`kindRooms`, each `{ kind, people, area }`), and this room takes
 * as many as one such room held, times how much more floor it has (`OUR_CREW.scaleMax` at most), never
 * more than `OUR_CREW.perRoomMax`. Who each is is drawn from that kind's own people by how often they
 * stand there, and leaves out anybody the corvette stands once (its named people and its prisoner), who
 * belong to the corvette's story and not to a crew. Where each stands is a point of the room's own floor,
 * drawn by area. Every draw is from the copy's id, the room and the count, so every run writes the same.
 */
export function ourCrewRows(copies, cellsOfModel, floorsOfModel, crew, kindRooms, world = 'dungeon1') {
  const rows = [];
  const seen = new Map();
  // Who stands in each kind of room, by how often; somebody stood once in the whole run is a person of its story.
  const once = new Map();
  for (const r of crew ?? []) once.set(r.who, (once.get(r.who) ?? 0) + 1);
  const peopleOf = new Map();
  for (const r of crew ?? []) {
    if (once.get(r.who) === 1) continue;
    const k = corvetteKindOf(r.room);
    if (!peopleOf.has(k)) peopleOf.set(k, []);
    peopleOf.get(k).push(r.who);
  }
  const perKind = new Map();
  for (const k of kindRooms ?? []) {
    const p = perKind.get(k.kind) ?? { rooms: 0, people: 0, area: 0 };
    p.rooms++;
    p.people += k.people;
    p.area += k.area;
    perKind.set(k.kind, p);
  }
  for (const copy of copies) {
    for (const c of cellsOfModel ?? []) {
      const kind = sdKindOf(c.name);
      const who = kind ? peopleOf.get(kind) : null;
      const k = kind ? perKind.get(kind) : null;
      const cell = copy.cells.get(c.index);
      const tris = floorTriangles(floorsOfModel?.[c.index]?.floor);
      if (!who?.length || !k || !k.rooms || !cell || !tris.length) continue;
      const area = tris.reduce((a, t) => a + t[9], 0);
      const meanPeople = k.people / k.rooms;
      const meanArea = k.area / k.rooms || area;
      const scale = Math.max(1, Math.min(OUR_CREW.scaleMax, area / meanArea));
      const count = Math.min(OUR_CREW.perRoomMax, Math.max(1, Math.round(meanPeople * scale)));
      for (let n = 0; n < count; n++) {
        const seed = `${world}|${copy.id}|${c.index}|${n}`;
        const pick = who[Math.min(who.length - 1, Math.floor(unit(`${seed}:who`) * who.length))];
        // A triangle by its area, then a point inside it.
        let u = unit(`${seed}:tri`) * area;
        let tri = tris[tris.length - 1];
        for (const t of tris) {
          if (u < t[9]) {
            tri = t;
            break;
          }
          u -= t[9];
        }
        let s = unit(`${seed}:s`);
        let r = unit(`${seed}:r`);
        if (s + r > 1) {
          s = 1 - s;
          r = 1 - r;
        }
        const px = tri[0] + (tri[3] - tri[0]) * s + (tri[6] - tri[0]) * r;
        const py = tri[1] + (tri[4] - tri[1]) * s + (tri[7] - tri[1]) * r;
        const pz = tri[2] + (tri[5] - tri[2]) * s + (tri[8] - tri[2]) * r;
        const x = Math.round(-px * 100) / 100;
        const y = Math.round(py * 100) / 100;
        const z = Math.round(pz * 100) / 100;
        const heading = Math.round((unit(`${seed}:turn`) * 2 - 1) * Math.PI * 10000) / 10000;
        const key = keyOf(seen, [world, pick, x, y, z, cell]);
        rows.push({ key, who: pick, x, y, z, heading, cell, respawn: 0, gated: false, where: 'dungeon', from: 'ours', ours: true });
      }
    }
  }
  return rows;
}

/**
 * How many of the corvette's people stand in each of its rooms, and how much floor each room has: what
 * the crew of ours is measured against (`ourCrewRows`' `kindRooms`). Over the one crew the crew of ours
 * draws from, and only the rooms that crew stands anybody in.
 */
export function corvetteKindRooms(crew, cellsOfModel, floorsOfModel) {
  const people = new Map();
  for (const r of crew ?? []) people.set(r.room, (people.get(r.room) ?? 0) + 1);
  const out = [];
  for (const c of cellsOfModel ?? []) {
    const n = people.get(c.name);
    if (!n) continue;
    const area = floorTriangles(floorsOfModel?.[c.index]?.floor).reduce((a, t) => a + t[9], 0);
    if (area > 0) out.push({ kind: corvetteKindOf(c.name), people: n, area });
  }
  return out;
}

/**
 * Why `status` asks for `spawns` again for the instances, or null: the zone is converted and nobody is
 * aboard its corvettes (no `spawns.json`, or one from before the instances were read), or a ticket taker
 * stands on a world whose rows do not say which copy it sends a player to. `instancePack` is the zone's
 * spawns pack (null with none) and `takerRows` each taker's world with that world's rows, null for a world
 * with no pack converted.
 */
export function instanceSpawnsWhy(zoneConverted, instancePack, takers, takerRows) {
  if (zoneConverted && !instancePack) return "the instances zone (dungeon1) is converted and nobody stands aboard its corvettes or its Star Destroyers: it has no spawns.json";
  if (zoneConverted && instancePack.instances !== INSTANCES_FORMAT) return 'the instances zone (dungeon1) has the people of an older converter aboard (no corvette crew joined to its copies, or no crew of ours on the Star Destroyer)';
  const deaf = (takers ?? []).filter((t) => {
    const rows = takerRows(t.planet);
    return rows && !rows.some((r) => r.who === t.who && r.takes);
  });
  if (deaf.length) return `the corvette's ticket takers on ${deaf.map((t) => t.planet).join(', ')} do not say which copy of the ship they send a player to (their rows carry no \`takes\`)`;
  return null;
}

/** The faction a ticket taker on a world takes a player to, by who it is: `takers` as `readCorvette` reads them. */
export function takerFaction(takers, world, who) {
  for (const t of takers ?? []) if (t.who === who && t.planet === world) return t.faction;
  return null;
}
