// Restuss in both of its states: the living launch city and its ruins, beside the late camp every state keeps.
//
// SOE's final client places no Restuss city at all, in any copy of its world snapshot from publish 40 on: what stands
// there is the late camp (`rori_7_8`), the two faction cantinas (`rori_7_7`) and the Cobral bunker. Every copy of
// `snapshot/rori.ws` up to `patch_15_02` holds the launch city, and every retail install holds that archive, so the
// living city is brought back from it (`restussAddition`): every node inside the city's rectangle and its children,
// **keeping its raw id** (the emulator named the city's rooms by the launch snapshot's own cell ids, so the 37 of
// Core3's rows that stand indoors there join their rooms only by them), offset only where an id is already one of
// the final snapshot's or its buildouts' (none, measured), tagged `restuss=living`, and appended after every other
// node, so nothing of today's world moves in the layout and the auto centre, the first top-level starport in entry
// order, stays the Rebel outpost's.
//
// **The ruins are a swap of template names on the launch city's own places** (`RESTUSS_RUINS`): each of the 35
// launch buildings that has a ruin of its kind among the 36 retail ruin statics (the ten civic ones, the fourteen
// 32x16 and eleven 64x32 filler blocks) gets a node of that ruin on its own place and turn, with no children,
// tagged `restuss=ruins`; a block's variant is drawn by a hash of its node's own id (ours). The houses and the
// association hall have no ruin and stand only living. Nothing is read from the server's event tables: no
// position, no choice of variant, no count.
//
// The game reads the tags (`src/world/worldState.ts`): an object whose state the world does not stand in is kept
// dormant -- never drawn, collided with or stood in, only asked by the placing rules and kept out of flora -- and
// each state has its own ports (`portTag`, `namePortsInStates`): the launch city's starport and shuttleport in the
// living state, the late camp's two dead pads in the ruins, each state holding one port of each name.
//
// Template names, archive names and counts only. Pure but for the archive reads it is handed.

import { parseIff } from './iff.mjs';
import { parseSnapshot } from './ws.mjs';
import { parseDatatable } from './datatable.mjs';
import { loadBuildouts } from './buildout.mjs';

/**
 * Where the launch city is and what it is read from. `archive` is the newest copy of `snapshot/rori.ws` that
 * places the city whole [SOE: the launch snapshot]; `rect` the raw x and z of the city's rectangle (x1, z1, x2, z2)
 * [the Restuss surveys' measurement: 659 top-level nodes inside, 820 with their children, 63 of them buildings]; and
 * `circle` the metres round the city's middle whose ports belong to the ruins [emu: Core3's no-spawn circle
 * `restuss` is 700 m], which takes in the late camp's two pads and nothing else.
 */
export const RESTUSS_ADD = { planet: 'rori', archive: 'patch_15_02.tre', rect: [5050, 5470, 5540, 5915], circle: 700 };

/** The world state these tags name, and its two values. */
export const RESTUSS_KEY = 'restuss';
export const RESTUSS_VALUES = ['living', 'ruins'];
export const LIVING = `${RESTUSS_KEY}=living`;
export const RUINS = `${RESTUSS_KEY}=ruins`;

/**
 * The shape of Rori's `states.restuss` block in `layout.json`, and of the marks the pois and spawns runs leave: a
 * pack whose number is lower is asked for again by `status`.
 */
export const RESTUSS_STATES_VERSION = 1;

/** The client's own region row the city's middle is read from (`datatables/clientregion/rori.iff`). */
const REGION_KEY = /:restuss$/i;

const RUIN = 'object/static/worldbuilding/structures/shared_mun_nboo_';
const BUILDING = 'object/building/naboo/shared_';
/** The 32x16 filler block's ruins: three destroyed and two scorched [SOE: the retail ruin statics]. */
const BLOCK_32 = [`${RUIN}block_building_32x16_destroyed_01.iff`, `${RUIN}block_building_32x16_destroyed_02.iff`, `${RUIN}block_building_32x16_destroyed_s03.iff`, `${RUIN}block_building_32x16_scorched_01.iff`, `${RUIN}block_building_32x16_scorched_02.iff`];
/** The 64x32 filler block's: two destroyed and two scorched. */
const BLOCK_64 = [`${RUIN}block_building_64x32_destroyed_01.iff`, `${RUIN}block_building_64x32_destroyed_02.iff`, `${RUIN}block_building_64x32_scorched_01.iff`, `${RUIN}block_building_64x32_scorched_02.iff`];

/**
 * Which ruin stands for which launch building, read off the client's own template names alone [ours, from client
 * names]: the ten civic buildings that have a destroyed static of their kind, and the four filler block templates
 * by their size. A list is a choice of variants (`ruinOf`). The association hall, the houses and the civic ruins
 * no launch building wears (the capitol, the garage) are not here.
 */
export const RESTUSS_RUINS = {
  [`${BUILDING}bank_naboo.iff`]: [`${RUIN}bank_destroyed.iff`],
  [`${BUILDING}cloning_facility_naboo.iff`]: [`${RUIN}cloning_facility_destroyed.iff`],
  [`${BUILDING}guild_combat_naboo_style_01.iff`]: [`${RUIN}guild_combat_destroyed.iff`],
  [`${BUILDING}guild_commerce_naboo_style_01.iff`]: [`${RUIN}guild_commerce_destroyed.iff`],
  [`${BUILDING}guild_university_naboo_style_01.iff`]: [`${RUIN}guild_university_destroyed.iff`],
  [`${BUILDING}guild_theater_naboo_s01.iff`]: [`${RUIN}theater_destroyed.iff`],
  [`${BUILDING}hospital_naboo.iff`]: [`${RUIN}hospital_destroyed.iff`],
  [`${BUILDING}hotel_naboo_theed.iff`]: [`${RUIN}hotel_destroyed.iff`],
  [`${BUILDING}shuttleport_naboo.iff`]: [`${RUIN}shuttleport_destroyed.iff`],
  [`${BUILDING}starport_naboo.iff`]: [`${RUIN}starport_destroyed.iff`],
  [`${BUILDING}filler_nboo_bldg_32x16_style_01.iff`]: BLOCK_32,
  [`${BUILDING}filler_nboo_bldg_32x16_style_02.iff`]: BLOCK_32,
  [`${BUILDING}filler_nboo_bldg_64x32_style_01.iff`]: BLOCK_64,
  [`${BUILDING}filler_nboo_bldg_64x32_s02.iff`]: BLOCK_64,
};

/** How far an id that is already taken is moved, and a ruin's id from its building's: well clear of every snapshot id (ours). */
const ID_STEP = 1 << 28;
const RUIN_STEP = 1 << 27;

/** FNV-1a over a string, as an unsigned 32-bit number: the same text always draws the same. */
export function hashOf(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The ruin a launch building of `template` turns into, by a hash of its own id; null where it has none. */
export function ruinOf(template, id) {
  const list = RESTUSS_RUINS[template];
  if (!list?.length) return null;
  return list.length === 1 ? list[0] : list[hashOf(`restuss:${id}`) % list.length];
}

/** Whether a raw point is inside the city's rectangle, edges included. */
export function inRect(x, z, rect = RESTUSS_ADD.rect) {
  const [x1, z1, x2, z2] = rect;
  return x >= Math.min(x1, x2) && x <= Math.max(x1, x2) && z >= Math.min(z1, z2) && z <= Math.max(z1, z2);
}

/** Whether a raw point is within `r` metres of a raw middle, across the ground. */
export function withinCircle(x, z, centre, r = RESTUSS_ADD.circle) {
  return !!centre && Math.hypot(x - centre.x, z - centre.z) <= r;
}

/**
 * The city's middle in the raw frame: the client's own region row for Restuss where its table has one (5318, 5680
 * on retail), else the rectangle's middle, with which it was.
 */
export function restussCentre(vfs, planet = RESTUSS_ADD.planet, rect = RESTUSS_ADD.rect) {
  const table = `datatables/clientregion/${planet}.iff`;
  try {
    if (vfs?.has?.(table)) {
      const dt = parseDatatable(parseIff(vfs.read(table)));
      for (const row of dt.rows) {
        const [name, x, z] = dt.columns.map((c) => row[c]);
        if (typeof name === 'string' && REGION_KEY.test(name) && Number.isFinite(x) && Number.isFinite(z)) return { x, z, from: 'clientregion' };
      }
    }
  } catch {
    /* an unreadable table leaves the rectangle's middle */
  }
  return { x: (rect[0] + rect[2]) / 2, z: (rect[1] + rect[3]) / 2, from: 'rect' };
}

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
 * The launch city as nodes to add to a world's snapshot, or null for any world but Restuss's. `own` is the
 * snapshot's own nodes as the current copy holds them (before any buildout is merged), `buildouts` the world's
 * buildout nodes (loaded here when not handed over): no added id may be one either of them uses, since the
 * flattening keys every node by its id. Refuses in words when the archives hold no copy of the snapshot in
 * `RESTUSS_ADD.archive`.
 *
 * -> { nodes, ruins, centre, archive, rect, counts: { top, all, buildings, ruins, offset }, cells: Set }
 *    `nodes` the living city's top-level nodes (children nested, every one tagged `state: LIVING`, carrying its
 *    `template` by name), `ruins` the ruin nodes (tagged `state: RUINS`), `cells` the ids of the city's own cell
 *    objects (what the spawns run holds its newly joined rows aside by).
 */
export function restussAddition(vfs, planet, own, buildouts = null) {
  if (planet !== RESTUSS_ADD.planet) return null;
  const ws = `snapshot/${planet}.ws`;
  const want = RESTUSS_ADD.archive.toLowerCase();
  const has = (vfs.versions?.(ws) ?? []).some((v) => !v.deleted && v.archive.toLowerCase().replace(/\\/g, '/').split('/').pop() === want);
  if (!has) throw new Error(`Restuss: the archives hold no copy of ${ws} in ${RESTUSS_ADD.archive}, which every retail install has; the launch city cannot be added`);
  const old = parseSnapshot(parseIff(vfs.readFrom(ws, RESTUSS_ADD.archive)));
  const taken = idsOf(own, new Set());
  idsOf(buildouts ?? loadBuildouts(vfs, planet).nodes, taken);
  const top = old.nodes.filter((n) => inRect(n.pos[0], n.pos[2]));
  // Each id of the city kept as it is unless something of today's world already has it (none, measured), and
  // then moved clear of everything, its children's `containedBy` with it.
  const map = new Map();
  let offset = 0;
  const reserve = (n) => {
    let id = n.id;
    if (taken.has(id) || map.has(id)) {
      offset++;
      while (taken.has(id)) id += ID_STEP;
    }
    map.set(n.id, id);
    taken.add(id);
    for (const c of n.children ?? []) reserve(c);
  };
  for (const n of top) reserve(n);
  const cells = new Set();
  let all = 0;
  const copy = (n) => {
    all++;
    const template = old.templates[n.templateIndex] ?? '';
    const id = map.get(n.id);
    if (/\/cell\//.test(template)) cells.add(id);
    return { ...n, id, containedBy: n.containedBy ? (map.get(n.containedBy) ?? n.containedBy) : 0, template, state: LIVING, children: (n.children ?? []).map(copy) };
  };
  const nodes = top.map(copy);
  const buildings = nodes.filter((n) => n.template.startsWith('object/building/'));
  const ruins = [];
  for (const b of buildings) {
    const raw = top[nodes.indexOf(b)];
    const template = ruinOf(b.template, raw.id);
    if (!template) continue;
    let id = b.id + RUIN_STEP;
    while (taken.has(id)) id += RUIN_STEP;
    taken.add(id);
    ruins.push({ id, containedBy: 0, template, cellIndex: 0, q: b.q.slice(), pos: b.pos.slice(), radius: b.radius, portalLayoutCrc: 0, children: [], state: RUINS });
  }
  return {
    nodes,
    ruins,
    cells,
    centre: restussCentre(vfs, planet),
    archive: RESTUSS_ADD.archive,
    rect: RESTUSS_ADD.rect.slice(),
    counts: { top: top.length, all, buildings: buildings.length, ruins: ruins.length, offset },
  };
}

/**
 * Append an addition to a parsed snapshot (after everything already in it), each node's template put into the
 * snapshot's own list: the same flattening then places the city with the rest. The snapshot also carries what it
 * was given (`snap.restuss`), which the pois and the layout read their state's middle off.
 */
export function addToSnapshot(snap, addition) {
  if (!addition) return snap;
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
  for (const n of [...addition.nodes, ...addition.ruins]) snap.nodes.push(put(n));
  snap.restuss = { centre: addition.centre, archive: addition.archive, rect: addition.rect, counts: addition.counts };
  return snap;
}

/**
 * Core3's own objects (the server's `spawnSceneObject`s merged into the layout, `area: 'server:...'`) inside the
 * city's circle belong to the living city: tagged so, they stand nowhere in the ruins, as Core3's fittings and
 * people inside it do not. Answers how many it tagged.
 */
export function tagServerObjects(snap, centre, circle = RESTUSS_ADD.circle) {
  if (!centre) return 0;
  let n = 0;
  for (const node of snap.nodes) {
    if (node.state || !String(node.area ?? '').startsWith('server:')) continue;
    if (!withinCircle(node.pos[0], node.pos[2], centre, circle)) continue;
    node.state = LIVING;
    n++;
  }
  return n;
}

/**
 * Which state a port row belongs to: one from the addition carries its node's own (`living`), one of today's
 * world within `RESTUSS_ADD.circle` of the city's middle is the ruins' (the late camp's two pads), and every other
 * port carries none and stands in both.
 */
export function portTag(nodeState, x, z, centre, circle = RESTUSS_ADD.circle) {
  if (nodeState) return nodeState;
  return centre && withinCircle(x, z, centre, circle) ? RUINS : undefined;
}

/**
 * Names for a world's ports once per state: `found` is every port in the scan's order (`{ ..., state? }`), and
 * `namer(list)` names one list the way `namePorts` does (`{ names, fromServer, lettered }`). With no port tagged
 * it is that one pass. Otherwise each tag value is its own pass over the untagged ports and its own, and each
 * port takes the name its own state's pass gives it; an untagged port named differently by two passes stops the
 * run in words, since one row cannot carry two names. Tags of one world state only.
 */
export function namePortsInStates(found, namer) {
  const tags = [...new Set(found.map((f) => f.state).filter(Boolean))];
  if (!tags.length) return namer(found);
  const keys = new Set(tags.map((t) => t.split('=')[0]));
  if (keys.size > 1) throw new Error(`ports are tagged with more than one world state (${[...keys].join(', ')}); a pass per value of one is all this names`);
  const names = found.map(() => null);
  // Summed over the passes, so a port in every state named by the server counts once a pass: a log line's count.
  let fromServer = 0;
  let lettered = 0;
  for (const tag of tags) {
    const idx = [];
    found.forEach((f, i) => {
      if (!f.state || f.state === tag) idx.push(i);
    });
    const res = namer(idx.map((i) => found[i]));
    idx.forEach((i, k) => {
      const name = res.names[k];
      if (!found[i].state && names[i] !== null && names[i] !== name) {
        throw new Error(`the port at ${Math.round(found[i].x)},${Math.round(found[i].z)} stands in every state and is named ${names[i]} in one and ${name} in another`);
      }
      names[i] = name;
    });
    fromServer += res.fromServer;
    lettered += res.lettered;
  }
  return { names, fromServer, lettered };
}

/**
 * The block `layout.json` carries for the city after its `center` key: the state's values and default, where the
 * living city was read from, its middle, and how many layout objects each state stands (`living`, `ruins`).
 */
export function statesBlock(restuss, objects) {
  return {
    [RESTUSS_KEY]: {
      values: RESTUSS_VALUES.slice(),
      default: 'ruins',
      archive: restuss.archive,
      rect: restuss.rect,
      centre: { x: restuss.centre.x, z: restuss.centre.z },
      living: objects.filter((o) => o.state === LIVING).length,
      ruins: objects.filter((o) => o.state === RUINS).length,
      version: RESTUSS_STATES_VERSION,
    },
  };
}

/**
 * A world's `layout.json` object in its one key order: the world, its centre and, where it has any, its states
 * after the centre, which a reader takes from the head of the file as its second key (`poisCentre.test.ts`).
 */
export function layoutObject({ planet, center, states = null, radius, terrain, objects, skipped }) {
  return { planet, center, ...(states ? { states } : {}), radius, terrain, objects, skipped };
}

/**
 * A world's standing rows with the ones that find their room only because the launch city is read in (their room
 * one of `cells`, the city's own cell ids) moved after every other, each kind in the order it came: so no row of
 * the world's moves in the list, and so no `stood:` name. `entries` are `{ row, cell }`, the cell the server named.
 * **Those rows are tagged `restuss=living`** (a copy of each, the rest handed back as they came): their rooms are
 * the living city's, which lie dormant in the ruins, so they stand in the living city alone whatever the ruins'
 * circle is moved to -- as the fittings in those same rooms are tagged from their building.
 */
export function restussLast(entries, cells) {
  if (!cells || !cells.size) return entries.map((e) => e.row);
  const first = [];
  const last = [];
  for (const e of entries) {
    if (e.cell && cells.has(e.cell)) last.push({ ...e.row, state: LIVING });
    else first.push(e.row);
  }
  return [...first, ...last];
}

/**
 * What `status` asks of Rori for the city, or null: its snapshot when its layout carries no `states.restuss` (or an
 * older one), its `pois` when the layout has the block and its places were written before the ports were named by
 * state, and its spawns when its people were joined before the city's rooms were there. `layout`, `pois` and
 * `spawns` are the files as read (null for none).
 */
export function restussStatus(layout, pois, spawns) {
  if (!layout) return null;
  const block = layout.states?.[RESTUSS_KEY];
  if (!block || !(Number(block.version) >= RESTUSS_STATES_VERSION)) return { ask: 'snapshot', why: 'rori has no Restuss: the launch city and its ruins are not in its layout (states.restuss)' };
  if (pois && !(Number(pois.states?.[RESTUSS_KEY]) >= RESTUSS_STATES_VERSION)) return { ask: 'pois', why: "rori's places were written before Restuss's ports were named by state" };
  if (spawns && !(Number(spawns.restuss?.version) >= RESTUSS_STATES_VERSION)) return { ask: 'spawns', why: "rori's people were joined before the launch city's rooms were in its layout, so Core3's people indoors there stand nowhere" };
  return null;
}

/**
 * What `status` asks of Rori's placed sounds for the city, or null: an `if` of its own beside `restussStatus`, since
 * the sounds are read from the archives and not from the layout. Asked only once the layout carries the city (so a
 * mount that cannot read it is never asked for its sounds for ever), and only of a sounds file that is there (a
 * missing one is the sound places' own ask): when it was written without the city, whose bands, crowds and humming
 * props then never sound.
 */
export function restussSoundsStatus(layout, sounds) {
  const block = layout?.states?.[RESTUSS_KEY];
  if (!block || !(Number(block.version) >= RESTUSS_STATES_VERSION) || !sounds) return null;
  if (Number(sounds.states?.[RESTUSS_KEY]) >= RESTUSS_STATES_VERSION) return null;
  return { ask: 'sounds', why: "rori's placed sounds were written before Restuss's launch city was read in, so the living city is silent" };
}
