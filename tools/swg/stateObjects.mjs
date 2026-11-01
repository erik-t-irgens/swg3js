// SOE's earlier objects and the holidays' dressing, each read in as a world state the way Restuss's launch city is
// (restuss.mjs): kept raw ids, appended after every other node so no layout index moves, contained objects with their
// cells, every node tagged `<key>=<value>`, and nothing of them standing until the world's state says so.
//
// **SOE's earlier objects** (`soe=earlier`, the map audit's critic G5): every older copy of a world's snapshot the
// install holds, read against the final copy by object id at every level. A node the final world has not got is taken
// with everything under it from the newest copy that holds it -- the last place SOE had it -- and a thing taken out of a
// room the final world keeps (a cantina's old furniture) is taken alone, contained by that room's own cell, which the
// final copy still has. What Restuss's launch city already reads in (its raw ids, and anything else inside its
// rectangle on Rori) is never taken twice. The snapshot command decides which of them stand at all (`OverlapJudge`): an
// earlier object that would stand inside or on top of a final one by model box -- moved, replaced or renamed in a later
// publish -- is left out, and the layout says which (`stateObjects.dropped`), which every other reader of the snapshot
// reads back, so the sounds, the rooms the people and fittings join and the places all agree with the layout.
//
// **The holidays' dressing** (`<holiday>=on`, objects.md O2 and O4): the buildout areas an event names, which the plain
// reading skips. Each event is a holiday of this game's own (`HOLIDAY_OF_EVENT`), its rows tagged with it; the two
// Halloween towns are read from the client's own `client_halloween_*` tables, which the area table names under a
// `server_` name (critic.md: nothing shows the client read them itself; the owner stands them all the same).
//
// Nothing here carries a terrain layer: an earlier object or a holiday's row stands on the final world's ground,
// which is what a world in its final state stands on as well, and one the final ground buries or leaves floating is
// reported, never forced (measured, `A:\swg3js\mapfix\NOTES.md`). Template names, ids, places and counts only, read
// from the player's own archives. Pure but for the archive reads it is handed.

import { parseIff } from './iff.mjs';
import { parseSnapshot } from './ws.mjs';
import { loadBuildouts } from './buildout.mjs';
import { inRect, restussAddition } from './restuss.mjs';

/** The world state the earlier objects stand in, its values and its tag. */
export const EARLIER_KEY = 'soe';
export const EARLIER_VALUES = ['final', 'earlier'];
export const EARLIER = `${EARLIER_KEY}=earlier`;

/**
 * Each event a buildout area names, as the holiday of this game's own whose switch stands it (`src/world/holidays.ts`,
 * the same keys): Halloween is the Galactic Moon Festival's dressing, Life Day's follows the Life Day switch, and
 * `empireday_ceremony` is Empire Day's and the Rebels' Remembrance Day's areas together, one event in the tables.
 */
export const HOLIDAY_OF_EVENT = { halloween: 'halloween', lifeday: 'lifeday', loveday: 'loveday', empireday_ceremony: 'empireday' };

/** A holiday's tag: its rows stand while it is on. */
export const holidayTag = (key) => `${key}=on`;

/** The keys every added state's tags use, for telling them from Restuss's. */
export const STATE_OBJECT_KEYS = [EARLIER_KEY, ...new Set(Object.values(HOLIDAY_OF_EVENT))];

/**
 * The shape of a layout's `stateObjects` mark and of the marks the readers after the snapshot leave: a pack whose number
 * is lower is asked for again by `status`.
 */
export const STATE_OBJECTS_VERSION = 1;

/**
 * The worlds whose archives hold earlier objects or holiday rows, measured over the retail archives with SOE's final
 * names list (every retail install holds the same older copies): what `status` asks a snapshot of, since it reads no
 * archive. `stateObjects.test.ts` holds it to the archives where an install is to hand.
 */
export const STATE_OBJECT_WORLDS = ['corellia', 'dantooine', 'dathomir', 'endor', 'lok', 'naboo', 'rori', 'talus', 'tatooine', 'yavin4'];

/** Where the holidays' nodes are numbered from: clear of the snapshot's, the buildouts' (1 << 30 up) and the server's (1 << 29 up). */
export const HOLIDAY_ID_BASE = (1 << 30) + (1 << 29);

/** How far an earlier id that is already taken is moved: clear of every snapshot id (ours, as Restuss's). */
const ID_STEP = 1 << 28;

/**
 * How far two boxes must go into each other before an earlier object counts as standing in or on a final one, metres:
 * each box is shrunk by half of it, so two that merely touch -- a crate set against a wall, a sign on its post -- are
 * not one inside the other. Ours.
 */
export const OVERLAP_SLACK = 0.05;

const arch = (a) => String(a ?? '').split(/[\\/]/).pop();
const isCell = (t) => /\/cell\//.test(t ?? '');

/** Every id a node list holds, its children's and a buildout's own table id (`rawId`) included. */
function idsOf(nodes, into) {
  const walk = (n) => {
    if (Number.isFinite(n.id)) into.add(n.id);
    if (Number.isFinite(n.rawId)) into.add(n.rawId);
    for (const c of n.children ?? []) walk(c);
  };
  for (const n of nodes ?? []) walk(n);
  return into;
}

/**
 * The earlier objects of one world, or null for a world with no snapshot. Every older copy of `snapshot/<planet>.ws`,
 * newest first, against what stands today: the final snapshot's ids at every level, its buildouts' ids and table ids,
 * and Restuss's launch city with its ruins. In each copy the shallowest node the final world has not got is taken with
 * its subtree, unless a newer copy already gave it; a node of today's world is walked into. A node in Restuss's
 * rectangle on Rori is the launch city's and never taken (`restuss`); a cell standing alone at the top is nothing.
 *
 * -> { nodes, counts }: `nodes` the roots in the order they are appended (newest copy first, each copy's own order),
 *    each a whole subtree with `template` by name and `state: EARLIER` on every node, the root marked `root` ('top'
 *    standing alone, 'inside' a room of today's world) and `from` its copy's archive. The cells they bring are found
 *    as they are appended (`addStateObjects`), less every root the layout left out, which is what the rows that join
 *    them must read.
 */
export function earlierAddition(vfs, planet) {
  const ws = `snapshot/${planet}.ws`;
  if (!vfs.has?.(ws)) return null;
  const final = parseSnapshot(parseIff(vfs.read(ws)));
  const finalIds = idsOf(final.nodes, new Set());
  const present = new Set(finalIds);
  const bo = loadBuildouts(vfs, planet);
  idsOf(bo.nodes, present);
  // A building the final world keeps in its buildout tables is a node of a number of its own there, its table's id kept
  // as `rawId`, and an older snapshot that still held it names it (and its cells) by that table id: a thing taken out of
  // one of its rooms is contained by the room's own node, or the flattening finds no parent and stands it at its room's
  // local place, about the world's origin (measured: 340 of Tatooine's things and 194 of Naboo's, before this).
  const hosts = new Set(finalIds);
  const byRaw = new Map();
  const mapRaw = (nodes) => {
    for (const n of nodes ?? []) {
      hosts.add(n.id);
      if (Number.isFinite(n.rawId) && !finalIds.has(n.rawId)) byRaw.set(n.rawId, n.id);
      mapRaw(n.children);
    }
  };
  mapRaw(bo.nodes);
  let rect = null;
  try {
    const restuss = restussAddition(vfs, planet, final.nodes.slice(), bo.nodes);
    if (restuss) {
      idsOf(restuss.nodes, present);
      idsOf(restuss.ruins, present);
      idsOf(restuss.nodes, hosts);
      rect = restuss.rect;
    }
  } catch {
    /* a mount with no launch copy of Rori: the city is not read in, and nothing of its rectangle is taken either way */
    if (planet === 'rori') rect = [5050, 5470, 5540, 5915];
  }
  const versions = (vfs.versions?.(ws) ?? []).filter((v) => !v.deleted).reverse();
  const taken = new Set();
  const nodes = [];
  const counts = { copies: 0, top: 0, inside: 0, all: 0, restuss: 0, strayCells: 0, noHost: 0, offset: 0, byCopy: {} };
  // Each raw id is kept unless something of today's world (a buildout's table id among them) or an earlier node already
  // taken has it (none, measured), and is then moved clear of everything, the children's `containedBy` with it; the
  // holidays' numbers start far above anything a step reaches (`HOLIDAY_ID_BASE`).
  const reserved = new Set(present);
  const copyOf = (n, s, from, containedBy, map) => {
    const template = s.templates[n.templateIndex] ?? '';
    let id = n.id;
    if (reserved.has(id)) {
      counts.offset++;
      while (reserved.has(id)) id += ID_STEP;
    }
    reserved.add(id);
    taken.add(n.id);
    map.set(n.id, id);
    counts.all++;
    const { templateIndex, children, ...rest } = n;
    const out = { ...rest, id, containedBy, template, state: EARLIER, children: [] };
    out.children = (children ?? []).map((c) => copyOf(c, s, from, c.containedBy ? (map.get(c.containedBy) ?? c.containedBy) : id, map));
    return out;
  };
  for (const v of versions) {
    let s;
    try {
      s = parseSnapshot(parseIff(vfs.readFrom(ws, arch(v.archive))));
    } catch {
      continue;
    }
    counts.copies++;
    const from = arch(v.archive);
    const visit = (n, parent, top) => {
      if (present.has(n.id)) {
        for (const c of n.children ?? []) visit(c, n, top);
        return;
      }
      if (taken.has(n.id)) return;
      if (rect && inRect(top.pos[0], top.pos[2], rect)) {
        counts.restuss++;
        return;
      }
      const template = s.templates[n.templateIndex] ?? '';
      if (!parent && isCell(template)) {
        counts.strayCells++;
        return;
      }
      // What holds a thing taken out of a room of today's world, by the number today's world gives it; one whose holder
      // today's world has under no number at all is left out, never stood at its room's local place.
      let host = 0;
      if (parent) {
        const named = n.containedBy || parent.id;
        host = finalIds.has(named) ? named : (byRaw.get(named) ?? named);
        if (!hosts.has(host)) {
          counts.noHost++;
          return;
        }
      }
      const root = copyOf(n, s, from, host, new Map());
      root.root = parent ? 'inside' : 'top';
      root.from = from;
      if (parent) counts.inside++;
      else counts.top++;
      counts.byCopy[from] = (counts.byCopy[from] ?? 0) + 1;
      nodes.push(root);
    };
    for (const n of s.nodes) visit(n, null, n);
  }
  return { nodes, counts };
}

/**
 * The holidays' dressing of one world: every event area's rows (`loadBuildouts`' `only: 'events'`), numbered from
 * `HOLIDAY_ID_BASE`, each tagged with its event's holiday. An event this build has no holiday for is counted and left
 * out. -> { nodes, cells: Map<id, tag>, counts: { <holiday>: rows }, areas: { <holiday>: [area names] }, unknown, layers }.
 */
export function holidayAddition(vfs, planet) {
  const b = loadBuildouts(vfs, planet, { only: 'events', idBase: HOLIDAY_ID_BASE });
  const nodes = [];
  const cells = new Map();
  const counts = {};
  const areas = {};
  let unknown = 0;
  for (const n of b.nodes) {
    const key = HOLIDAY_OF_EVENT[n.event];
    if (!key) {
      unknown++;
      continue;
    }
    const state = holidayTag(key);
    counts[key] = (counts[key] ?? 0) + 1;
    (areas[key] ??= []).includes(n.area) || areas[key].push(n.area);
    if (isCell(n.template)) {
      cells.set(n.id, state);
      if (Number.isFinite(n.rawId)) cells.set(n.rawId, state);
    }
    nodes.push({ id: n.id, ...(n.rawId !== undefined ? { rawId: n.rawId } : {}), containedBy: n.containedBy, template: n.template, cellIndex: n.cellIndex, q: n.q, pos: n.pos, radius: n.radius, portalLayoutCrc: n.portalLayoutCrc, children: [], buildout: n.area, state });
  }
  return { nodes, cells, counts, areas, unknown };
}

/** One world's additions, read once a mount: what every reader of the snapshot appends, before any drop. */
const cache = new WeakMap();
export function stateObjectsFor(vfs, planet) {
  let byWorld = cache.get(vfs);
  if (!byWorld) cache.set(vfs, (byWorld = new Map()));
  if (!byWorld.has(planet)) byWorld.set(planet, { earlier: earlierAddition(vfs, planet), holidays: holidayAddition(vfs, planet) });
  return byWorld.get(planet);
}

/**
 * Append a world's additions to a parsed snapshot, after everything already in it (Restuss's city included), each
 * node's template put into the snapshot's own list: the earlier objects first, less every root `dropped` names (the
 * layout's own `stateObjects.dropped`, whose subtrees go with them), then the holidays' rows unless `holidays` is false
 * (the legacy `--events` run stands them all year in the plain buildouts). The snapshot carries what it took
 * (`snap.stateObjects`: `cells`, a map of every added cell's id to its tag, for the rows that join them).
 */
export function addStateObjects(snap, added, { dropped = null, holidays = true } = {}) {
  if (!added) return snap;
  const index = new Map(snap.templates.map((t, i) => [t, i]));
  const indexOf = (template) => {
    let ti = index.get(template);
    if (ti === undefined) {
      ti = snap.templates.length;
      snap.templates.push(template);
      index.set(template, ti);
    }
    return ti;
  };
  const put = (n) => {
    const { template, children, ...rest } = n;
    return { ...rest, templateIndex: indexOf(template), children: (children ?? []).map(put) };
  };
  const cells = new Map();
  const drop = dropped instanceof Set ? dropped : new Set(dropped ?? []);
  const earlier = (added.earlier?.nodes ?? []).filter((n) => !drop.has(n.id));
  const walkCells = (n) => {
    if (isCell(n.template)) cells.set(n.id, n.state);
    for (const c of n.children ?? []) walkCells(c);
  };
  for (const n of earlier) {
    walkCells(n);
    snap.nodes.push(put(n));
  }
  const hol = holidays ? (added.holidays?.nodes ?? []) : [];
  for (const [id, tag] of holidays ? (added.holidays?.cells ?? new Map()) : []) cells.set(id, tag);
  for (const n of hol) snap.nodes.push(put(n));
  snap.stateObjects = { cells, earlier: earlier.length, holidays: hol.length, dropped: drop.size };
  return snap;
}

/** The roots a layout's mark says were left out, as a set (none for a layout from before the mark). */
export function droppedOf(layout) {
  const d = layout?.stateObjects?.dropped;
  return new Set(Array.isArray(d) ? d.filter((x) => Number.isFinite(x)) : []);
}

/** Whether a layout was written with this file's additions (its `stateObjects` mark, at this version). */
export function hasStateObjects(layout) {
  return Number(layout?.stateObjects?.version) >= STATE_OBJECTS_VERSION;
}

/**
 * The rows of a world's people with the ones that find their room only because an added state's building is read in
 * (their cell one of `cells`, each with its tag) taken out and tagged with it, in the order they came: the people
 * module puts them after every other row, the heralds and the people of ours, so no `stood:` name of anybody else's
 * moves (`standingList` in src/world/ngeOverlay.ts). `entries` are `{ row, cell }`. -> { kept, later }.
 */
export function laterJoined(entries, cells) {
  if (!cells || !cells.size) return { kept: entries, later: [] };
  const kept = [];
  const later = [];
  for (const e of entries) {
    const tag = e.cell ? cells.get(e.cell) : undefined;
    if (tag) later.push({ ...e.row, state: tag });
    else kept.push(e);
  }
  return { kept, later };
}

// ---- the boxes ---------------------------------------------------------------------------------------------------------

/**
 * A placed model's box in the game's frame: its model's bounds (the GLB's, corners taken componentwise: a pack's BOX
 * may carry its larger corner first) turned by the object's own turn and stood at its place, both mirrored in X as the
 * streamer mirrors them (`q` the snapshot's [w, x, y, z]). -> { c, u: three unit axes, e: half extents }, or null for
 * no bounds.
 */
export function boxOf(bounds, q, pos) {
  if (!bounds?.min || !bounds?.max) return null;
  const lo = [0, 1, 2].map((i) => Math.min(bounds.min[i], bounds.max[i]));
  const hi = [0, 1, 2].map((i) => Math.max(bounds.min[i], bounds.max[i]));
  if (![...lo, ...hi].every(Number.isFinite)) return null;
  // The game's turn: (x, -y, -z, w) of the snapshot's [w, x, y, z].
  const x = q?.[1] ?? 0;
  const y = -(q?.[2] ?? 0);
  const z = -(q?.[3] ?? 0);
  const w = q?.[0] ?? 1;
  const n = Math.hypot(x, y, z, w) || 1;
  const qx = x / n, qy = y / n, qz = z / n, qw = w / n;
  const rot = (v) => {
    const tx = 2 * (qy * v[2] - qz * v[1]);
    const ty = 2 * (qz * v[0] - qx * v[2]);
    const tz = 2 * (qx * v[1] - qy * v[0]);
    return [v[0] + qw * tx + (qy * tz - qz * ty), v[1] + qw * ty + (qz * tx - qx * tz), v[2] + qw * tz + (qx * ty - qy * tx)];
  };
  const mid = rot([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]);
  return {
    c: [-pos[0] + mid[0], pos[1] + mid[1], pos[2] + mid[2]],
    u: [rot([1, 0, 0]), rot([0, 1, 0]), rot([0, 0, 1])],
    e: [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2],
  };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Whether two boxes go into each other by more than `slack` metres (each shrunk by half of it), by the separating axis
 * test over their fifteen axes. A box shrunk to nothing on an axis is a plane and is never inside anything.
 */
export function boxesOverlap(a, b, slack = OVERLAP_SLACK) {
  const ea = a.e.map((v) => v - slack / 2);
  const eb = b.e.map((v) => v - slack / 2);
  if (ea.some((v) => !(v > 0)) || eb.some((v) => !(v > 0))) return false;
  const d = [b.c[0] - a.c[0], b.c[1] - a.c[1], b.c[2] - a.c[2]];
  const axes = [...a.u, ...b.u];
  for (const i of a.u) for (const j of b.u) {
    const c = cross(i, j);
    const len = Math.hypot(c[0], c[1], c[2]);
    if (len > 1e-6) axes.push([c[0] / len, c[1] / len, c[2] / len]);
  }
  for (const ax of axes) {
    const ra = ea[0] * Math.abs(dot(a.u[0], ax)) + ea[1] * Math.abs(dot(a.u[1], ax)) + ea[2] * Math.abs(dot(a.u[2], ax));
    const rb = eb[0] * Math.abs(dot(b.u[0], ax)) + eb[1] * Math.abs(dot(b.u[1], ax)) + eb[2] * Math.abs(dot(b.u[2], ax));
    if (Math.abs(dot(d, ax)) > ra + rb) return false;
  }
  return true;
}

/** How far any point of a box is from its middle: what the judge's grid is searched by. */
function reachOf(box) {
  return Math.hypot(box.e[0], box.e[1], box.e[2]);
}

/**
 * Which earlier objects stand, decided against today's world by model box, in the snapshot command's own loop: every
 * object of today's world is handed over as it is placed (`placed`), and each earlier root asked as it comes, newest copy
 * first (`judge`): one standing alone against everything of today's world standing alone and every earlier root kept
 * before it, one in a room against what stands in that same building today. A root with no box is in the way of nothing
 * and stands. -> the reason it is left out ('today' or 'earlier'), or null where it stands.
 */
export class OverlapJudge {
  constructor({ slack = OVERLAP_SLACK, cell = 64 } = {}) {
    this.slack = slack;
    this.cell = cell;
    this.grid = new Map();
    this.inside = new Map();
    this.counts = { placed: 0, judged: 0, today: 0, earlier: 0, noBox: 0 };
  }

  key(i, k) {
    return `${i},${k}`;
  }

  file(box, kind) {
    const r = reachOf(box);
    const i0 = Math.floor((box.c[0] - r) / this.cell), i1 = Math.floor((box.c[0] + r) / this.cell);
    const k0 = Math.floor((box.c[2] - r) / this.cell), k1 = Math.floor((box.c[2] + r) / this.cell);
    const rec = { box, kind };
    for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) {
      const key = this.key(i, k);
      const list = this.grid.get(key);
      if (list) list.push(rec);
      else this.grid.set(key, [rec]);
    }
  }

  /** Something of today's world placed: standing alone, or in a room of building `host` (its node id). */
  placed(box, host = null) {
    if (!box) return;
    this.counts.placed++;
    if (host === null) this.file(box, 'today');
    else {
      const list = this.inside.get(host);
      if (list) list.push(box);
      else this.inside.set(host, [box]);
    }
  }

  /** An earlier root asked: null where it stands (and it is filed for the roots after it), else why not. */
  judge(box, host = null) {
    this.counts.judged++;
    if (!box) {
      this.counts.noBox++;
      return null;
    }
    if (host !== null) {
      for (const b of this.inside.get(host) ?? []) {
        if (boxesOverlap(box, b, this.slack)) {
          this.counts.today++;
          return 'today';
        }
      }
      return null;
    }
    const r = reachOf(box);
    const i0 = Math.floor((box.c[0] - r) / this.cell), i1 = Math.floor((box.c[0] + r) / this.cell);
    const k0 = Math.floor((box.c[2] - r) / this.cell), k1 = Math.floor((box.c[2] + r) / this.cell);
    const seen = new Set();
    for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) {
      for (const rec of this.grid.get(this.key(i, k)) ?? []) {
        if (seen.has(rec)) continue;
        seen.add(rec);
        if (Math.hypot(rec.box.c[0] - box.c[0], rec.box.c[2] - box.c[2]) > reachOf(rec.box) + r) continue;
        if (boxesOverlap(box, rec.box, this.slack)) {
          this.counts[rec.kind]++;
          return rec.kind;
        }
      }
    }
    this.file(box, 'earlier');
    return null;
  }
}

// ---- what the layout says ---------------------------------------------------------------------------------------------

/**
 * The `states` blocks a world's layout carries for its added states, after Restuss's where it has one: one a key that
 * any layout object carries a tag of (none for a world all of whose earlier objects were left out, so an arrival there
 * waits on no server's word for nothing). A block's `values` and `default` are what an arrival reads; the counts are
 * the console's.
 */
export function stateObjectBlocks(objects, holidayAreas = {}) {
  const count = new Map();
  for (const o of objects) {
    if (typeof o.state !== 'string') continue;
    const key = o.state.split('=')[0];
    if (STATE_OBJECT_KEYS.includes(key)) count.set(key, (count.get(key) ?? 0) + 1);
  }
  const out = {};
  if (count.has(EARLIER_KEY)) out[EARLIER_KEY] = { values: EARLIER_VALUES.slice(), default: 'final', earlier: count.get(EARLIER_KEY), version: STATE_OBJECTS_VERSION };
  for (const key of STATE_OBJECT_KEYS) {
    if (key === EARLIER_KEY || !count.has(key)) continue;
    out[key] = { values: ['off', 'on'], default: 'off', on: count.get(key), areas: (holidayAreas[key] ?? []).slice(), version: STATE_OBJECTS_VERSION };
  }
  return out;
}

/**
 * The layout's `stateObjects` mark, after everything else in it: this file's version, what the earlier objects came to
 * (taken, left out and why, by copy) and the holidays' rows, and the ids of the earlier roots left out (`dropped`),
 * which every reader of the snapshot after it leaves out too.
 */
export function stateObjectsMark({ earlier, holidays, dropped, reasons, standing }) {
  return {
    version: STATE_OBJECTS_VERSION,
    earlier: earlier ? { roots: earlier.nodes.length, top: earlier.counts.top, inside: earlier.counts.inside, nodes: earlier.counts.all, copies: earlier.counts.copies, restuss: earlier.counts.restuss, offset: earlier.counts.offset, byCopy: earlier.counts.byCopy } : null,
    holidays: holidays ? { rows: holidays.counts, areas: holidays.areas, unknown: holidays.unknown } : null,
    standing,
    left: reasons,
    dropped: [...dropped].sort((a, b) => a - b),
  };
}

/**
 * What `status` asks of a world for its added states: its snapshot when it is one of `STATE_OBJECT_WORLDS` and its layout
 * carries no mark (or an older one), and nothing else until it does; then every reader after it whose file was written
 * before it -- each file carries a mark of its own (`stateObjects`) once a run read the added states in -- all at once,
 * since each reads the layout and none another's file. `files` are the world's own as read (null for none). -> a list
 * of `{ ask, why }`, empty for nothing.
 */
export function stateObjectsStatus(planet, layout, files = {}) {
  if (!layout || !STATE_OBJECT_WORLDS.includes(planet)) return [];
  if (!hasStateObjects(layout)) return [{ ask: 'snapshot', why: `${planet}'s layout was written before SOE's earlier objects and the holidays' dressing were read in` }];
  const stale = (f) => f && !(Number(f.stateObjects) >= STATE_OBJECTS_VERSION);
  const asks = [];
  if (stale(files.pois)) asks.push({ ask: 'pois', why: `${planet}'s places were written before its earlier objects' ports were named by state` });
  if (stale(files.sounds)) asks.push({ ask: 'sounds', why: `${planet}'s placed sounds were written before its earlier objects and holidays were read in` });
  if (stale(files.travel)) asks.push({ ask: 'travel', why: `${planet}'s travel was written before its earlier buildings were in its layout` });
  if (stale(files.fittings)) asks.push({ ask: 'fittings', why: `${planet}'s fittings were written before its earlier buildings were in its layout` });
  if (stale(files.spawns)) asks.push({ ask: 'spawns', why: `${planet}'s people were joined before its earlier buildings' rooms were in its layout` });
  return asks;
}
