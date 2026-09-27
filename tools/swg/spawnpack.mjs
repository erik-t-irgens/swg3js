// The `spawns` command's rules: what a standing person, a creature and a camp come to in the pack.
//
// The reading is `core3.mjs`'s and the writing the cli's; what is here is the arithmetic between them,
// kept pure so a node test can run it on rows written by hand (tools/swg/tests/spawnPack.test.ts).
//
// **Format 2**, and why it is a format at all. Every row now carries a `key` that survives any
// reordering of the scripts (so a body stood from it has the same id in every browser and every run),
// and the things the server knew about a row that format 1 threw away: the mood it was stood in, that
// a town stood it with its brain off (`still`), that it was made unattackable whatever its body
// (`peaceful`), which dress groups its creature's bodies come out of (`groups`, a label: a body is
// drawn from the creature's own `bodies`, which spans every group and template it names), the lists a
// body with none of its own is drawn from (`draw`), both sides' bodies for a town's guards (`gcw`),
// and the route a patroller walks (`route`). Every row still carries the seven fields format 1 had,
// filled, so a runtime that reads only those stands exactly what it would have: a row that draws its
// body names a default drawn from its own key (`who`, `id`), and a guard stands as the Imperial side
// with that side's own body (`id` is `gcw[0].id`), which is the server's own rule for a world nobody
// holds.
//
// `respawn` is the server's own seconds, and **nought means the row never comes back once killed**,
// which is how the server read it: a timer only runs when it is above nought.

import { intoRoom, unitOf } from './core3.mjs';
import { core3StatsFor } from './mobiles.mjs';
import { flattenWithWorldTransforms } from './ws.mjs';

/** Bumped whenever a row or the manifest changes shape or meaning; `status` asks again below it. */
export const SPAWNS_FORMAT = 2;

/**
 * What `status` makes of the spawns packs on disk: the worlds whose pack is older than this format
 * (`formats` is each world's pack format, absent read as none), and whether the fleet's manifest is.
 * Pure, so the node test runs the very rule `status` does.
 */
export function spawnsStale(formats, manifestFormat) {
  const older = Object.entries(formats).filter(([, f]) => !(typeof f === 'number' && f >= SPAWNS_FORMAT)).map(([w]) => w);
  const manifest = !(typeof manifestFormat === 'number' && manifestFormat >= SPAWNS_FORMAT);
  return { older, manifest, stale: older.length > 0 || manifest };
}

/**
 * Every room of a world's buildings by the id the server named it with: `{ cellIndex, q, pos }`,
 * the room's index in its building and the building's own world transform, from a snapshot with the
 * world's buildouts already merged into it (`mergeBuildouts`).
 *
 * An object indoors is contained by a **cell object** whose transform is identity and whose
 * `cellIndex` is the room, so a cell's world transform is its building's -- the flattener's own
 * answer for that node, and never the node's own identity, which would stand every person at the
 * middle of the world. A buildout's cell is known by the id its table wrote as well as by the one the
 * merge gave it (`rawId`), since that is what the server named it by: the squill cave and Jabba's
 * palace are buildouts, and without it nobody in either had a room. A snapshot's own id is never
 * taken over by a buildout's.
 */
export function roomsOf(snap) {
  const out = new Map();
  const later = [];
  for (const { node, world } of flattenWithWorldTransforms(snap)) {
    if (!node || !world || !(node.cellIndex > 0)) continue;
    const tpl = snap.templates[node.templateIndex] ?? '';
    if (!/\/cell\//.test(tpl)) continue;
    const room = { cellIndex: node.cellIndex, q: world.q, pos: world.pos };
    out.set(node.id, room);
    if (node.rawId !== undefined) later.push([node.rawId, room]);
  }
  for (const [id, room] of later) if (!out.has(id)) out.set(id, room);
  return out;
}

/** One of a list, drawn by a key and a word: the same key and word always draw the same one. */
export function drawOne(list, key, word) {
  if (!list?.length) return null;
  return list[Math.min(list.length - 1, Math.floor(unitOf(`${key}:${word}`) * list.length))];
}

/**
 * The body a creature stands as for one row: its own where it has one, else one of its bodies drawn by
 * the row's key (a dress group's commoner is not every commoner in town).
 */
export function bodyFor(creature, key, word = 'body') {
  if (!creature) return null;
  return creature.bodies?.length ? drawOne(creature.bodies, key, word) : creature.id;
}

/**
 * Who stands at a row that names nobody: a list drawn by its share (four in five of a town's stationary
 * people from its commoners), then one of that list's names drawn, both by the row's key. A list with
 * nobody in it the catalogue can draw is passed over for the next, so a town whose odd list names
 * bodies this game has not got still fills the spot. Null when no list can.
 */
export function drawnWho(row, pools, joined) {
  const lists = (row.draw ?? []).map(([pool, share]) => ({ names: (pools.get(pool) ?? []).filter((n) => joined.has(n)), share }));
  if (!lists.some((l) => l.names.length)) return null;
  const total = lists.reduce((a, l) => a + l.share, 0) || 1;
  let u = unitOf(`${row.key}:pool`) * total;
  let pick = lists.length - 1;
  for (let i = 0; i < lists.length; i++) {
    if (u < lists[i].share) {
      pick = i;
      break;
    }
    u -= lists[i].share;
  }
  for (let k = 0; k < lists.length; k++) {
    const l = lists[(pick + k) % lists.length];
    if (l.names.length) return drawOne(l.names, row.key, 'who');
  }
  return null;
}

/**
 * One row as the pack carries it, or `{ lost }` naming why it cannot stand: `body` when nobody it
 * names reaches a model, `room` when it stands in a cell no snapshot or buildout holds. Indoors, the
 * place and the facing are carried out of the room's frame (`intoRoom`), and so is every point of a
 * route; a route with a point in a room nobody holds is left off and said so (`routeLost`), since a
 * walk that ends in no room is no walk.
 */
export function packRow(row, { joined, rooms, pools }) {
  let who = row.who ?? drawnWho(row, pools, joined);
  let mood = row.mood;
  let gcw;
  // Which of the guard's two sides the row stands as, where it is a guard's.
  let side = -1;
  if (row.gcw) {
    gcw = row.gcw.map((s, i) => {
      const c = joined.get(s.who);
      return { who: s.who, ...(c ? { id: bodyFor(c, row.key, `side${i}`) } : {}), ...(s.mood ? { mood: s.mood } : {}) };
    });
    // The Imperial side unless the data gives it no body this game has.
    side = gcw[0]?.id && gcw[0].who === who ? 0 : -1;
    if (side < 0 && gcw[1]?.id) {
      side = 1;
      who = gcw[1].who;
      mood = gcw[1].mood;
    }
  }
  const creature = who ? joined.get(who) : null;
  if (!creature) return { lost: 'body' };
  // A guard's body is its side's own draw, so a reader that stands the row as written and one that
  // picks a side out of `gcw` stand the very same body for the same side.
  const id = side >= 0 ? gcw[side].id : bodyFor(creature, row.key);
  const out = { key: row.key, who, id, x: row.x, y: row.y, z: row.z, heading: row.heading, cell: row.cell, respawn: row.respawn, gated: row.gated, where: row.where, from: row.from };
  if (row.cell) {
    const room = rooms.get(row.cell);
    if (!room) return { lost: 'room' };
    Object.assign(out, intoRoom(row, room));
  }
  if (mood) out.mood = mood;
  if (row.still) out.still = true;
  if (row.peaceful) out.peaceful = true;
  if (row.sit) out.sit = true;
  if (creature.dress?.length) out.groups = creature.dress;
  if (row.draw) out.draw = row.draw;
  if (gcw) out.gcw = gcw;
  if (row.route?.length) {
    const route = [];
    for (const p of row.route) {
      if (!p.cell) {
        route.push({ x: p.x, y: p.y, z: p.z, linger: !!p.linger });
        continue;
      }
      const room = rooms.get(p.cell);
      if (!room) {
        route.length = 0;
        out.routeLost = true;
        break;
      }
      const at = intoRoom({ ...p, heading: 0 }, room);
      route.push({ x: at.x, y: at.y, z: at.z, room: at.room, linger: !!p.linger });
    }
    if (route.length) out.route = route;
  }
  if (row.drawn) out.drawn = true;
  if (row.nudged) out.nudged = true;
  return { row: out };
}

/**
 * What one creature is by its own numbers: level, health, damage, temper, whether it shoots and
 * whether anybody may strike it. Every body that draws as it shares one catalogue entry and that
 * entry carries one mobile's numbers -- the first the catalogue met -- so the thirty-five Tusken kinds
 * from level 8 to 263 all stood as the level-8 child. This is the creature's own, worked out with the
 * very rule the catalogue uses (`core3StatsFor`, over `CORE3_MAP`), so the two can never disagree about
 * what a level is worth. `mob` is the creature's own record from the mobile stats; `entry` its body's
 * catalogue entry, whose size, reach and cooldown the rule keeps.
 *
 * `aggression` is the server's own temper, its AGGRESSIVE bit (`core3Temper`); `killer` and `stalker`
 * are carried beside it as what they are -- whether it finishes off somebody already down, and whether
 * it sees through a masked player -- and never folded into it.
 */
export function gameOf(mob, entry) {
  if (!mob || !entry?.stats) return null;
  const s = core3StatsFor([mob], entry.stats, { kind: entry.kind, roles: { rangedAdditive: !!entry.stats.ranged?.additive } });
  const kinds = mob.creature ?? [];
  return {
    level: s.level,
    hp: s.hp,
    damage: s.damage,
    aggression: s.aggression,
    ranged: s.ranged ?? null,
    attackable: (mob.pvp ?? []).includes('ATTACKABLE'),
    ...(kinds.includes('KILLER') ? { killer: true } : {}),
    ...(kinds.includes('STALKER') ? { stalker: true } : {}),
  };
}

/** The appearances a model child of a client data file may name; `.sat` is a skinned body and is not a camp's furniture. */
const MODEL = /\.(apt|lod|cmp|msh|mgn)$/i;

/**
 * The pieces of a camp: every child its client data hangs that is a thing to draw (a tent, a cot, a
 * stool, a banner, a lamp), as `{ name, template, place, angles }` in the camp's own frame -- a CHLD
 * names the appearance (`name`), a CHL2 an object template (`template`) whose appearance is its. A
 * particle is an effect, not a piece, and goes with the effects; a skinned body (`.sat`) is left out
 * and counted (`skipped`).
 */
export function campPieces(children) {
  const pieces = [];
  let skipped = 0;
  for (const c of children ?? []) {
    if (c.tag === 'CHLD' && MODEL.test(c.name)) pieces.push({ name: c.name, place: c.place, angles: c.angles });
    else if (c.tag === 'CHL2' && /\.iff$/i.test(c.name)) pieces.push({ template: c.name, place: c.place, angles: c.angles });
    else if ((c.tag === 'CHLD' || c.tag === 'CHL2') && /\.sat$/i.test(c.name)) skipped++;
  }
  return { pieces, skipped };
}
