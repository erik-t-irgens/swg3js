// The travel terminals, the ticket collectors and the shuttles: where the game really put them.
//
// None of the three is in a world snapshot. Corellia's snapshot places 413 terminals -- mission,
// bank, bazaar, newsnet, elevator -- and not one travel terminal, because the whole of travel was
// the server's. What the server did is in its own scripts, and it is not a list of places: it is a
// **`childObjects` block on each starport and shuttleport building template**, so a terminal stands
// wherever that building stands, however many of them a world has.
//
// Corellia's starport declares six children: four travel terminals in cell 4, one ticket collector
// outside it, and one `player_transport`. That is the whole of the game's own arrangement and it is
// exactly three things:
//
//   - a **terminal** inside, where a ticket is bought;
//   - a **collector** outside, where a ticket is taken and a shuttle is boarded;
//   - a **transport**, the shuttle itself, which lands to be boarded and leaves again.
//
// Two things about the numbers are not what they look like. A child's position is written
// `x, z, y` with **z the height and y the depth**, which is the emulator's own convention and not
// the game's; and `cellid` is the room of the building's own portal layout, with -1 meaning outside
// it altogether. Both are read as such here and the node test pins them.
//
// **Nothing here may ever reach the repository.** The checkout is a third-party project under its
// own licence: this reads its data, never its code.
//
// Dependency-free but for node's own modules and this folder's readers; shared with
// tools/swg/tests/travel.test.ts.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readLua } from './lua.mjs';

/**
 * What a child object is to this game, or null for one it has no use for.
 *
 * The shuttle is named twice over and the first cut of this only knew one of the names: a starport
 * declares a `player_transport` and a **shuttleport declares a `player_shuttle`**, so every
 * shuttleport in the game came out with a terminal, a collector and no shuttle at all -- 33
 * placements over the converted worlds, which is most of the ports there are.
 */
export function kindOfChild(templateFile) {
  const t = String(templateFile ?? '');
  if (/\/terminal_travel(_|\.)/.test(t)) return 'terminal';
  if (/ticket_collector/.test(t)) return 'collector';
  if (/player_(transport|shuttle)/.test(t)) return 'shuttle';
  return null;
}

/**
 * Which model this game draws a travel thing with, or null where it has none.
 *
 * It is written into the pack rather than worked out at run time, so the game never guesses a name
 * and a pack converted before a model existed simply carries null. The collector is a droid and is
 * the mobiles pack's, which is why it is named as a catalogue entry rather than as a model file.
 */
export function modelOfKind(kind, templateFile) {
  const t = String(templateFile ?? '');
  if (kind === 'terminal') return 'ksk_all_travel';
  if (kind === 'collector') return '3po_protocol_droid_silver';
  // The starport's transport has no single model: its own mesh is a placeholder and the hull it
  // shows is five separate pieces hung off its client data. Only the shuttleport's is drawn.
  if (kind === 'shuttle') return /player_shuttle/.test(t) ? 'shuttle' : null;
  return null;
}

/**
 * The models this game draws a travel thing with, and where each one's appearance lives.
 *
 * No world snapshot places either of them -- the terminals and the shuttles were the server's, which
 * is the whole reason this command exists -- so the `travel` command converts them into each world
 * that needs one. The collector is not here: it is a droid and the mobiles pack already carries it.
 */
export const TRAVEL_MODELS = [
  ['ksk_all_travel', 'appearance/ksk_all_travel.apt'],
  ['shuttle', 'appearance/shuttle.apt'],
];

/** Just the ids, which is what tells a row this command is answerable for from one it is not. */
export const TRAVEL_OWN_MODELS = new Set(TRAVEL_MODELS.map(([id]) => id));

/**
 * Whether a pack's rows name a model that should be in its layout category and is not -- which is how
 * `status` tells a world that was converted again after these rows were written, since a snapshot
 * rewrites that category outright and silently takes them out.
 *
 * `own`, when given, is the set of models the command is answerable for. It matters: the ticket
 * collector is drawn with the mobiles pack's own protocol droid and is never in a world's layout at
 * all, so judged without it every world looked as if its travel rows had been lost and `status` asked
 * for `travel` again however many times it had just been run. A status line that cries wolf is worse
 * than one that says nothing, and this project has paid for that once before in print.
 */
export function rowsLost(rows, layoutIds, own = null) {
  return (rows ?? []).some((r) => r.model && (!own || own.has(r.model)) && !layoutIds.has(r.model));
}

/** Every `.lua` under a folder. */
function luaFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) luaFiles(p, out);
    else if (e.endsWith('.lua') && !/serverobjects|objects\.lua$/.test(e)) out.push(p);
  }
  return out;
}

/**
 * The yaw of a child's quaternion, which the scripts write as `ox, oy, oz, ow` with **oy the turn
 * about the up axis**: the same convention the snapshots use.
 *
 * The scripts do not always write a unit quaternion -- Theed's transport is (0, 1, 0, 1), which is a
 * quarter turn, and 20 of the 1,002 building children are off unit length somewhere -- so the angle
 * is taken in a form that does not care how long the quaternion is: `2wy` and `w² - y²` are the same
 * multiple of the sine and cosine of the turn whatever its length. Read as if it were unit length
 * (`1 - 2y²`), Theed's transport stood at 116.6 degrees rather than 90 and sat crooked in its hangar.
 */
export function childYaw(c) {
  const w = Number(c.ow ?? 1);
  const y = Number(c.oy ?? 0);
  return Math.atan2(2 * w * y, w * w - y * y);
}

/**
 * The two shuttles the game lands, and where each is drawn from.
 *
 * Both are skeletal appearances whose own meshes are placeholders -- four vertices and eight -- and
 * whose hulls are static appearances hung on joints by their client data (`HOBJ`). The shuttle rides
 * one piece on its root; the starport's transport is five, the hull, three landing struts and the
 * door, each on its own joint, which is how its struts fold and its door opens. All the motion is in
 * the skeleton's own clips: coming down, going up, parked on the ground and parked in the sky.
 */
export const TRAVEL_RIGS = {
  shuttle: { sat: 'appearance/player_shuttle.sat', clientData: 'clientdata/client_shared_player_shuttle.cdf' },
  transport: { sat: 'appearance/player_transport.sat', clientData: 'clientdata/client_shared_player_transport.cdf' },
};

/**
 * Which rig a travel row is drawn with, or null. A shuttleport's shuttle names the `shuttle` model; a
 * starport's transport names none, since no single model draws it, and that is the only difference
 * the reference keeps between the two.
 */
export function rigOfRow(row) {
  if (row?.kind !== 'shuttle') return null;
  return row.model === 'shuttle' ? 'shuttle' : 'transport';
}

/**
 * The branch of a transport's clips a row plays. The transport's table carries a mood selector with
 * two branches: Theed's, which rises out of the royal hangar on a longer path, and one every other
 * starport shares. Which one a starport used was the server's to say and is not in the archives, so
 * this is ours: the Theed hangar plays Theed's, and everywhere else the other.
 */
export function moodOfRow(row, rig) {
  if (rig !== 'transport') return '';
  return /theed/i.test(String(row?.building ?? '')) ? 'theed' : 'calm';
}

/** The four clips a rig's round is made of, by the names the table gives them. */
const RIG_ROLES = { land: 'land', lift: 'take_off', ground: 'loop_ground', sky: 'loop_sky' };

/**
 * A rig's clips by role and branch, out of the clip names its conversion wrote: `land:calm` is the
 * calm branch's landing, and a clip with no branch in its name is every branch's. A role no clip
 * fills is left out, and a branch with no landing is not a branch.
 */
export function rigClipTable(names) {
  const list = [...(names ?? [])];
  const moods = new Set(['']);
  for (const n of list) {
    const m = /^[^:]+:(.+)$/.exec(n);
    if (m) moods.add(m[1]);
  }
  if (moods.size > 1) moods.delete('');
  const out = {};
  for (const mood of moods) {
    const row = {};
    for (const [role, base] of Object.entries(RIG_ROLES)) {
      const own = mood ? `${base}:${mood}` : base;
      if (list.includes(own)) row[role] = own;
      else if (list.includes(base)) row[role] = base;
    }
    if (row.land && row.lift) out[mood] = row;
  }
  return out;
}

/**
 * Every building template that carries children this caller wants, and what each carries.
 *
 * `keep(templateFile)` answers with whatever the caller wants written on that child -- its kind and
 * its model for travel, its own template for a fitting -- or null for a child it has no use for.
 * The place, the turn and the room are the same for every caller and are read here, which is the
 * whole reason the two commands that read these blocks share one walk.
 *
 * The key is the building's own template path as the snapshots write it, so the join to a world is
 * a plain string match and nothing has to be guessed from a name.
 */
export function readBuildingChildren(scriptsDir, keep) {
  const out = new Map();
  for (const file of luaFiles(join(scriptsDir, 'object', 'building'))) {
    let parsed;
    try {
      parsed = readLua(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const rel = file.replace(/\\/g, '/').split('/bin/scripts/')[1];
    if (!rel) continue;
    for (const [, v] of parsed.values) {
      if (!v || typeof v !== 'object' || Array.isArray(v) || !Array.isArray(v.childObjects)) continue;
      const kids = [];
      for (const c of v.childObjects) {
        if (!c || typeof c !== 'object') continue;
        const extra = keep(c.templateFile);
        if (!extra) continue;
        const x = Number(c.x);
        const y = Number(c.y);
        const z = Number(c.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        // The emulator writes a child as (x, z, y) with z the height: this puts it back the way the
        // rest of this converter and the whole game read a place.
        kids.push({ ...extra, x, y: z, z: y, yaw: Math.round(childYaw(c) * 1e4) / 1e4, cell: Number.isFinite(c.cellid) ? Math.round(c.cellid) : -1 });
      }
      // A snapshot names a building by its **shared** template, which is the one the client has;
      // the scripts are named for the server's. Both are written so the join is a plain string
      // match either way round, which is what keeps this from guessing at a name.
      if (!kids.length) continue;
      const server = rel.replace(/\.lua$/, '.iff');
      out.set(server, kids);
      out.set(server.replace(/\/([^/]+)$/, '/shared_$1'), kids);
    }
  }
  return out;
}

/** Every building template that carries travel children, and what each carries. */
export function readTravelBuildings(scriptsDir) {
  return readBuildingChildren(scriptsDir, (t) => {
    const kind = kindOfChild(t);
    return kind ? { kind, model: modelOfKind(kind, t) } : null;
  });
}

/**
 * Where every child of a world's buildings really stands, in the snapshot's own frame.
 *
 * `placements` is the world's own layout: one entry per placed object with its template, its place
 * and its turn. A building the scripts say nothing about contributes nothing, and a world with no
 * starport at all comes out empty -- which is most of them, since only the worlds with towns have
 * one.
 *
 * A child inside a building keeps the **cell** it was written for and its place is left in the
 * building's own frame, because that is the frame the game will draw and walk it in; a child
 * outside (`cell` -1) is turned into the world's frame here, since nothing else will.
 *
 * Whatever the reader hung on a child that is not its place -- its kind, its model, the template it
 * came from -- is carried through untouched, which is what lets the travel rows and the fittings
 * rows come out of one piece of arithmetic.
 */
export function placeChildren(placements, byTemplate) {
  const out = [];
  for (const p of placements) {
    const kids = byTemplate.get(p.template);
    if (!kids) continue;
    const yaw = yawOfQuat(p.q);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    for (const k of kids) {
      const { x: _x, y: _y, z: _z, yaw: _yaw, cell: _cell, ...rest } = k;
      if (k.cell > 0) {
        out.push({ ...rest, model: k.model ?? null, building: p.template, at: p.id ?? null, cell: k.cell, x: k.x, y: k.y, z: k.z, yaw: k.yaw, bx: p.x, by: p.y, bz: p.z, byaw: Math.round(yaw * 1e4) / 1e4 });
        continue;
      }
      out.push({
        ...rest,
        model: k.model ?? null,
        building: p.template,
        at: p.id ?? null,
        cell: 0,
        x: Math.round((p.x + (k.x * cos + k.z * sin)) * 1e3) / 1e3,
        y: Math.round((p.y + k.y) * 1e3) / 1e3,
        z: Math.round((p.z + (-k.x * sin + k.z * cos)) * 1e3) / 1e3,
        yaw: Math.round((yaw + k.yaw) * 1e4) / 1e4,
        bx: p.x,
        by: p.y,
        bz: p.z,
        byaw: Math.round(yaw * 1e4) / 1e4,
      });
    }
  }
  return out;
}

/** A layout quaternion's yaw, `[w, x, y, z]`, which is how every pack writes one. */
export function yawOfQuat(q) {
  if (!Array.isArray(q) || q.length < 4) return 0;
  const [w, x, y, z] = q.map(Number);
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
}

/** What the conversion prints and `status` reads. */
export function travelCounts(rows) {
  return {
    terminals: rows.filter((r) => r.kind === 'terminal').length,
    collectors: rows.filter((r) => r.kind === 'collector').length,
    shuttles: rows.filter((r) => r.kind === 'shuttle').length,
    buildings: new Set(rows.map((r) => r.building)).size,
    indoors: rows.filter((r) => r.cell > 0).length,
  };
}
