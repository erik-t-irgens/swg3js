// The client's interior layout files: the furniture and dressing it stood in a building's rooms by itself.
//
// `interiorlayout/*.ilf` is `FORM INLY > FORM 0000 > NODE*`, each NODE an object template, the name of the cell it stands
// in and a 3x4 transform in that cell's frame: two NUL-ended strings and twelve little-endian floats, the rotation's rows
// with the place in the fourth column (`p_cell = R p_local + t`). A template names its file in `interiorLayoutFileName`,
// looked for up its chain (`resolveTemplateString`). No server ever sent these: the client's executable carries
// `ClientInteriorLayoutManager::install` and `useInteriorLayoutFiles`, and neither the emulator nor the NGE server calls
// the reader, so the Mos Eisley cantina's 103 seats and 34 tables, Jabba's palace's pillows and the guild halls' desks were
// the client's own and never in any snapshot (the map audit's `unrendered.md` §1, `verify-library.md` LIB-3).
//
// A cell's frame is its building's: a portal layout's cells are modelled in the building's own space and the snapshot's
// cell objects stand at the identity, so a node's transform is in the building's frame (the client's, X unmirrored), and
// the game carries it into the world exactly as it carries a snapshot object's place.
//
// Dependency-free but for node's own modules; shared with tools/swg/tests/interiors.test.ts.

/** The shape of `interiors.json` this writes; a pack holding another is asked for again (`status`). */
export const INTERIORS_PACK_VERSION = 1;

/**
 * Read one interior layout file to the byte, or throw saying why. Strict where `parseIff` is lenient: the root FORM's
 * size is the file's, its type `INLY`, its one child `FORM 0000`, every child of that a `NODE` chunk whose two strings and
 * forty-eight bytes of floats are its whole size. Every one of the 298 retail files reads so (`interiors` checks every file
 * of every run and lists any that does not).
 */
export function readIlf(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const fail = (why) => {
    throw new Error(`not an interior layout: ${why}`);
  };
  if (b.length < 12) fail('too short');
  if (b.toString('latin1', 0, 4) !== 'FORM') fail('no root FORM');
  if (b.readUInt32BE(4) !== b.length - 8) fail(`the root FORM says ${b.readUInt32BE(4)} bytes and the file holds ${b.length - 8}`);
  if (b.toString('latin1', 8, 12) !== 'INLY') fail(`the root FORM is ${b.toString('latin1', 8, 12)}, not INLY`);
  let o = 12;
  if (o + 12 > b.length || b.toString('latin1', o, o + 4) !== 'FORM') fail('no version FORM');
  const vsize = b.readUInt32BE(o + 4);
  const version = b.toString('latin1', o + 8, o + 12);
  if (version !== '0000') fail(`version ${version}`);
  const end = o + 8 + vsize;
  if (end !== b.length) fail(`the version FORM ends at ${end} and the file at ${b.length}`);
  o += 12;
  const nodes = [];
  while (o < end) {
    if (o + 8 > end) fail(`a stray ${end - o} bytes at ${o}`);
    const tag = b.toString('latin1', o, o + 4);
    const size = b.readUInt32BE(o + 4);
    if (tag !== 'NODE') fail(`a ${tag} at ${o}`);
    const d = o + 8;
    const e = d + size;
    if (e > end) fail(`a NODE at ${o} runs past its FORM`);
    let s = d;
    while (s < e && b[s] !== 0) s++;
    if (s >= e) fail(`a NODE at ${o} has no template`);
    const template = b.toString('latin1', d, s);
    let c = s + 1;
    while (c < e && b[c] !== 0) c++;
    if (c >= e) fail(`a NODE at ${o} has no cell`);
    const cell = b.toString('latin1', s + 1, c);
    if (e - (c + 1) !== 48) fail(`a NODE at ${o} holds ${e - (c + 1)} bytes of transform, not 48`);
    const m = new Array(12);
    for (let k = 0; k < 12; k++) m[k] = b.readFloatLE(c + 1 + k * 4);
    nodes.push({ template, cell, m });
    o = e;
  }
  return { version, nodes };
}

/**
 * A node's 3x4 as a place and a turn in the building's frame: `p` the fourth column, `q` the rotation's quaternion
 * `[w, x, y, z]` (the convention every pack writes a turn in). The rotation is taken as it stands, rows `m[0..2]`,
 * `m[4..6]`, `m[8..10]`; a matrix carrying a scale (none of the retail files does) is normalised column by column first.
 */
export function nodeTransform(m) {
  const col = (k) => Math.hypot(m[k], m[4 + k], m[8 + k]) || 1;
  const sx = col(0);
  const sy = col(1);
  const sz = col(2);
  const r00 = m[0] / sx, r01 = m[1] / sy, r02 = m[2] / sz;
  const r10 = m[4] / sx, r11 = m[5] / sy, r12 = m[6] / sz;
  const r20 = m[8] / sx, r21 = m[9] / sy, r22 = m[10] / sz;
  const tr = r00 + r11 + r22;
  let w, x, y, z;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s;
    x = (r21 - r12) / s;
    y = (r02 - r20) / s;
    z = (r10 - r01) / s;
  } else if (r00 > r11 && r00 > r22) {
    const s = Math.sqrt(1 + r00 - r11 - r22) * 2;
    w = (r21 - r12) / s;
    x = 0.25 * s;
    y = (r01 + r10) / s;
    z = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = Math.sqrt(1 + r11 - r00 - r22) * 2;
    w = (r02 - r20) / s;
    x = (r01 + r10) / s;
    y = 0.25 * s;
    z = (r12 + r21) / s;
  } else {
    const s = Math.sqrt(1 + r22 - r00 - r11) * 2;
    w = (r10 - r01) / s;
    x = (r02 + r20) / s;
    y = (r12 + r21) / s;
    z = 0.25 * s;
  }
  const n = Math.hypot(w, x, y, z) || 1;
  // One sign for one turn: w kept at or above nought, so two runs of the same file write the same numbers.
  const k = w < 0 ? -1 / n : 1 / n;
  return { p: [m[3], m[7], m[11]], q: [w * k, x * k, y * k, z * k] };
}

/** `[w, x, y, z]` turning `v` (Hamilton): what puts a node's place into its building's place. */
export function rotateByQuat(q, v) {
  const [w, x, y, z] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** `a * b`, both `[w, x, y, z]`: a node's turn put into its building's. */
export function mulQuat(a, b) {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [aw * bw - ax * bx - ay * by - az * bz, aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw];
}

/**
 * A node's place and turn in a ship model's own frame, as the ships command writes a hull's furniture (`furniture` on its
 * manifest entry): the client's place and turn mirrored in X as the hull's GLB is (x across; the turn `[w, x, y, z]` to
 * `[w, x, -y, -z]`), to the precision a file keeps. What the garage hangs under the room's node (`furniturePose`).
 */
export function hullFurniturePlace(m) {
  const { p, q } = nodeTransform(m);
  return { place: [fixed(-p[0], 4), fixed(p[1], 4), fixed(p[2], 4)], turn: [fixed(q[0], 6), fixed(q[1], 6), fixed(-q[2], 6), fixed(-q[3], 6)] };
}

/** A file's path as a template names it, as the archives hold it: forward slashes, no leading one, lower case. */
export function ilfPath(name) {
  const p = String(name ?? '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  return p || null;
}

/**
 * The key a building of the world's own layout is known by (Map-maker I §8's content key): `o:<template>@x,y,z`, its place
 * in the layout's own frame to the centimetre, and `#n` past the first of its exact twins in layout order. Stable across
 * conversions of the same archives where a layout index is not (one model that fails to convert moves every index after
 * it). A piece of its furniture is that key, `/` and the piece's index in its file (`pieceKey`).
 */
export function buildingKey(template, x, y, z, n = 1) {
  const c = (v) => (Math.round(v * 100) / 100).toString();
  return `o:${template}@${c(x)},${c(y)},${c(z)}${n > 1 ? `#${n}` : ''}`;
}

/** The key of one piece of a building's file furniture: the building's key and the node's index in its file. */
export function pieceKey(building, node) {
  return `${building}/${node}`;
}

/** A template as a name to compare (`sameTemplateName` in the streamer): lower case, forward slashes, `shared_` taken off. */
export function sameTemplateName(t) {
  return String(t ?? '').replace(/\\/g, '/').toLowerCase().replace(/\/shared_([^/]+)$/, '/$1');
}

/**
 * How near a thing of the same template the world's own data must stand, in the building's frame, for a piece of the file
 * to be taken for it and left out (the brief's half metre, the fittings' `STANDING_TWICE`).
 */
export const ILF_TWICE = 0.5;

/**
 * Every building a layout stands whose template names a file this mount read: its row, its template, the file, and its key
 * (`buildingKey`, the twins in layout order counted). Contained objects are never buildings here.
 */
export function layoutBuildings(objects, fileOf) {
  const out = [];
  const twins = new Map();
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (o.contained) continue;
    const file = fileOf(o.template);
    if (!file) continue;
    const base = buildingKey(o.template, o.x, o.y, o.z);
    const n = (twins.get(base) ?? 0) + 1;
    twins.set(base, n);
    out.push({ row: i, template: o.template, file, key: buildingKey(o.template, o.x, o.y, o.z, n) });
  }
  return out;
}

/**
 * Which pieces of a building's file stand where the world's own data already stands the same thing, by node index: a layout
 * object filed in that building's rooms (`in` its row) whose template names the same thing within `ILF_TWICE` of the piece in
 * the building's frame, or a fitting row of that building (by its template and its place within a metre) the same way. The
 * building's own place and turn are the layout's (`x, y, z`, `q` `[w, x, y, z]`, the client's frame); `pieces` are the
 * file's nodes as `{ template, p }` in that frame; `contained` the layout's objects in it; `fittings` its world's rows.
 */
export function doublesOf(building, pieces, contained, fittings) {
  const out = new Map();
  const inv = [building.q[0], -building.q[1], -building.q[2], -building.q[3]];
  const near = [];
  for (const o of contained) near.push({ t: sameTemplateName(o.template), p: rotateByQuat(inv, [o.x - building.x, o.y - building.y, o.z - building.z]), state: o.state ?? '' });
  const bt = sameTemplateName(building.template);
  for (const f of fittings ?? []) {
    if (!(f.cell > 0) || sameTemplateName(f.building) !== bt) continue;
    if (Math.abs(f.bx - building.x) > 1 || Math.abs(f.bz - building.z) > 1) continue;
    near.push({ t: sameTemplateName(f.template ?? ''), p: [f.x, f.y, f.z], state: f.state ?? '' });
  }
  if (!near.length) return out;
  for (let i = 0; i < pieces.length; i++) {
    const t = sameTemplateName(pieces[i].template);
    const p = pieces[i].p;
    // The double that stands in every state wins over one that stands in one state only (`''` before any tag).
    let found = null;
    for (const n of near) {
      if (n.t !== t) continue;
      if (Math.hypot(n.p[0] - p[0], n.p[1] - p[1], n.p[2] - p[2]) > ILF_TWICE) continue;
      if (found === null || n.state === '') found = n.state;
      if (found === '') break;
    }
    if (found !== null) out.set(i, found);
  }
  return out;
}

/**
 * The state a piece of a file stands in when the world's own data stands the same thing in one state only (`doublesOf`'s
 * tag, `<key>=<value>`): the other of a key's two values (SOE's earlier objects stand an older copy of the very cantina
 * furniture these files stand, `soe=earlier`, so the file's piece stands as SOE left the world, `soe=final`, and the older
 * one where it was stood again; Restuss's living city and its ruins). Null where the key has not two values the layout
 * knows, or where the piece's building stands in a state of its own already (one tag a piece): the piece is then left out
 * as standing twice, as against a double that stands in every state.
 */
export function otherState(tag, states, buildingState) {
  if (!tag || buildingState) return null;
  const [key, value] = String(tag).split('=');
  const values = states?.[key]?.values;
  if (!Array.isArray(values) || values.length !== 2 || !values.includes(value)) return null;
  return `${key}=${values[0] === value ? values[1] : values[0]}`;
}

/** A number to the precision a file keeps: places to the tenth of a millimetre, turns to the millionth. */
export function fixed(v, digits) {
  const k = 10 ** digits;
  const r = Math.round(v * k) / k;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * One template's file as a pack's table holds it (the `interiors` pass's own rule, here so a test runs it): each node a
 * piece `[index in the file, template, model, where the model is, room index, x, y, z, qw, qx, qy, qz]` -- `own` this
 * pack's model (`defs`, by `kindOf`'s `own` id: never a building of rooms or a particle under that id), `props` the props
 * folder's (an effect `kindOf` converted there, or the props catalogue's model for the template, `propOf`, each written into
 * `usedDefs` for the pack's guest), `snd` a sound object, no model -- its room by the building's own cell names (`def`), and
 * its place and turn in the building's frame. A node whose room the building has not got, whose template stands as nothing
 * (`kindOf`'s `skip`), or that neither the pack nor the props carry is left out and said (`leave`), so a piece's index is
 * always its node's in the file and never its place in this list. A skeletal model of the props was raised to stand on its
 * lowest point (`lift`): that is taken back off along the piece's own up, so it stands where the file put it.
 */
export function interiorPieces(nodes, def, defs, usedDefs, { kindOf, propOf, leave }) {
  const cells = new Map((def?.cells ?? []).map((c) => [c.name, c.index]));
  const pieces = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const cell = cells.get(n.cell);
    if (cell === undefined) {
      leave(`its room (${n.cell}) is not one of its building's`);
      continue;
    }
    const k = kindOf(n.template);
    if (k.skip) {
      leave(k.skip);
      continue;
    }
    const { p, q } = nodeTransform(n.m);
    const at = [fixed(p[0], 4), fixed(p[1], 4), fixed(p[2], 4)];
    const turn = [fixed(q[0], 6), fixed(q[1], 6), fixed(q[2], 6), fixed(q[3], 6)];
    let model = '';
    let from = '';
    if (k.kind === 'snd') from = 'snd';
    else if (k.kind === 'fx') {
      model = k.id;
      if (defs.get(k.id)?.particle) from = 'own';
      else {
        from = 'props';
        usedDefs.set(k.id, k.def);
      }
    } else if (k.own && defs.has(k.own) && !defs.get(k.own).particle && !defs.get(k.own).cells?.length) {
      model = k.own;
      from = 'own';
    } else {
      const pm = propOf(n.template);
      if (!pm) {
        leave(`no model: neither this pack nor the props catalogue carries ${n.template}`);
        continue;
      }
      model = pm.id;
      from = 'props';
      const { icon: _icon, ...rest } = pm;
      usedDefs.set(pm.id, rest);
      if (pm.skeletal && Number.isFinite(pm.lift) && pm.lift !== 0) {
        const d = rotateByQuat(q, [0, -pm.lift, 0]);
        at[0] = fixed(p[0] + d[0], 4);
        at[1] = fixed(p[1] + d[1], 4);
        at[2] = fixed(p[2] + d[2], 4);
      }
    }
    pieces.push([i, n.template, model, from, cell, ...at, ...turn]);
  }
  return pieces;
}

/**
 * One of the world's own buildings as the pack's file writes it (the `interiors` pass's own rule, here so a test runs it):
 * its row, its key, its template, the pieces of its template's table (`t`) left out as standing where the world's own data
 * already stands the same thing (`doublesOf` over what the layout files in its rooms, `contained`, and its world's fittings),
 * named by their **index in the file** (`skip`), and the pieces standing only in the state where the world's copy of them
 * does not (`states`, by the same index: `otherState`), with its own state where it has one. `twice` is the same pieces'
 * places in the table, for the counts.
 */
export function buildingRow(b, o, t, contained, fittings, layoutStates) {
  const doubles = doublesOf({ template: b.template, x: o.x, y: o.y, z: o.z, q: o.q }, t.pieces.map((p) => ({ template: p[1], p: [p[5], p[6], p[7]] })), contained ?? [], fittings);
  const twice = new Set();
  const states = {};
  for (const [k, tag] of doubles) {
    const other = otherState(tag, layoutStates, o.state);
    if (other) states[t.pieces[k][0]] = other;
    else twice.add(k);
  }
  const skip = [...twice].map((k) => t.pieces[k][0]).sort((a, c) => a - c);
  const row = { row: b.row, key: b.key, template: b.template, ...(skip.length ? { skip } : {}), ...(Object.keys(states).length ? { states } : {}), ...(o.state ? { state: o.state } : {}) };
  return { row, twice, states };
}
