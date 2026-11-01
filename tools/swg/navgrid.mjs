// The outdoor walkability bake: one grid a world, at the terrain's own two metres, written beside
// the planet's manifest so a body sent across a planet can be handed corners instead of a goal.
//
// It reads nothing from the archives. Everything it needs is already in the converted pack --
// `terrain.trn` and its bitmaps, the building terrain layers `layout.json` names, the placements,
// and the models' own triangles -- which is why this command takes a pack and not a mount, and why
// it can be re-run on a world without re-reading a single `.tre`.
//
// What a cell is, and why it is two metres. `CHUNK_SIZE 64 / CHUNK_RES 32` in `src/world/terrain.ts`
// makes the heightfield a body really walks on a two-metre lattice, which is also the generator's
// own pole step (`TerrainSampler.poleStep`). A finer grid therefore measures nothing new about the
// ground; it only sharpens the edges of buildings, and it costs four times as much.
//
// A cell is blocked when any of three things is true of it, and each is recorded separately so the
// census can say which:
//
//   slope    the ground rises past `SLOPE_CLIMB_DEGREES` over one pole step, which is the real
//            triangle. The number and the whole of the owner's reasoning about it are there.
//   objects  a placed object's own triangles stand between 0.5 m (the autostep) and 1.6 m (the top
//            of the capsule) above the ground there. A building's interior rooms are left out:
//            somebody outside walks into the shell, not into the furniture.
//   water    standing water is deeper than 1.2 m, which is where the game calls it swimming.
//
// Then the blocked set is grown by one four-neighbour step, which is the body's own 0.35 m
// half-width rounded up to the cell: the slope's and the water's cells on every side, and an
// object's only across the sides its geometry comes within that half-width of (`growMargin`), so a
// four-metre lane between two walls is still a lane. It still over-blocks, a little, and in the safe
// direction: a route round a gap the body could have squeezed through still arrives, and a route
// through a gap it could not would not.
//
// **A building's floor is not walkable ground.** The rasteriser deliberately skips interior cells,
// so a building's inside would otherwise be as free as the open desert and a string-pull would walk
// a body straight through a cantina. Every portal building's interior footprint is therefore marked
// `indoor` rather than blocked, which is the better of the two answers: the outdoor search refuses
// to cross it and stops at the door, and the indoor pathing that pass 6 built -- which has the
// client's own authored floor for that very room -- takes the body from there. A footprint is where
// the building's rooms come near the ground **and** the building rises out of it (`INDOOR_RISE`),
// so a courtyard over a cellar is ground and not a floor.
//
// What comes out is one nibble a cell: 0 blocked, 1..13 the rank of the walkable region the cell is
// in (1 the largest on the world), 14 some other, smaller region, 15 indoor. The ranks are the one
// thing only a bake can carry: a world has a hundred thousand separate walkable regions and 97% of
// the ground is one of them, so with the ranks a body can be told a place cannot be walked to, and
// without them it walks at a wall all evening.
//
// Beside the nibbles goes a coarse plane, one byte per `COARSE` fine cells, carrying the same rank
// where enough of the fine cells under it are walkable. It exists so the runtime's search has a
// cheap first pass: a whole world is a million coarse cells, which a search can cross in a few
// milliseconds, where the fine grid is sixty-seven million and could not be.
//
// And beside both goes a second nibble a cell, the **clearance**: how far that cell stands from the
// nearest thing a body cannot walk on, in cells, capped at `CLEARANCE_MAX`. It is what lets the
// runtime's search buy a wider berth round a mountain or a wall -- a cell near something costs more
// to walk than one in the open -- and it is baked rather than worked out at search time for a
// measured reason: a field that is one value over nearly all of a world deflates to almost nothing
// (the numbers are in `tools/swg/README.md`), while deriving it would mean reading a square of the
// bitmap round every cell the search ever opens, tens of millions of reads inside a frame's budget.
// A cap of `CLEARANCE_MAX` cells is what makes it compress: past that the whole open desert is one
// number, and the runtime never needs to tell twenty metres of room from thirty.
//
// **The rules are one module** (Map-maker II's fifth wave): the slope and water tests, the placement rasteriser, the
// margin and the pack moved word for word into `src/world/nav/gridRules.ts`, which imports nothing, and are named here
// as they always were. And the bake reads a world's committed edit files (`gridEditsOf`): the heights file's deltas laid
// over the generated poles as the game lays them where a grid enters a cache, the water file's lakes beside the client's
// tables by the game's own rule (`ourWater.ts`), and the solid rows of the world and story placements rasterised as a
// placed object is. With none of them the bake is the one before to the byte, and the grid's key (`layoutKeyOf`) folds in
// the files' text, so `status` asks for `navgrid <world>` again when any of them moves (the owner's answer of 2026-10-26:
// reconvert, never a patch at run time). From the sixth wave the water file's rivers are water to it as a lake is, and so
// are the terrain's own wet rivers (`gridSoeRivers`, the very rows the game draws), whose stamp the key folds in
// (`soeRiverStamp`), so the two test worlds that have them are asked for again and no other world is.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { isFallingWaterShader, readSolidFile } from '../../src/world/walkThrough.ts';
import { placementsFolder } from './placementsStatus.mjs';
import {
  AGENT_RADIUS, AUTOSTEP, BODY_TOP, CLEARANCE_MAX, COARSE, COARSE_SHARE, EDGE, IDENTITY_FRAME, INDOOR, INDOOR_ABOVE, INDOOR_BELOW, INDOOR_RISE, NAV_BAKE_RULES, NAV_FLAGS,
  OTHER_REGION, RANKS, SAMPLES_PER_CELL, SLOPE_CLIMB_DEGREES, SWIM_DEPTH, bakeRules, clearanceNibbles, edgesNear, growMargin, indoorFootprint, isBuildingDef, isFootprint,
  markSlope, markWater, packGrid, placementFrame, rasterParts, rasterPlacement, scaledFrame,
} from '../../src/world/nav/gridRules.ts';
import { HeightEdits } from '../../src/swg/terrain/heightEdits.ts';
import { deltasOf, readHeightsFile, tileOfId } from '../../src/world/editFiles/heightsFile.ts';
import { isLakeRow, isRiverRow, readWaterFile, readWaterRow } from '../../src/world/editFiles/waterFile.ts';
import { lakeTable, RIVER_TUNE, riversSurface, riverTable, surfaceOf } from '../../src/world/ourWater.ts';
import { soeRiverRows } from '../../src/swg/terrain/ribbons.ts';
import { parseTerrainTemplate } from '../../src/swg/terrain/trn.ts';
import { readPlacementsFile, scaleOf } from '../../src/story/placements.ts';
import { isSeat, isTableTemplate, standsSolid } from '../../src/world/rowSolid.ts';
import { FLORA_COLLISION, mergeFloraCollision, modelExtentOf, rowFloraParts } from '../../src/world/floraShapes.ts';

// The rules, named here as they always were (every caller and test that imports them from this file still does).
export {
  AGENT_RADIUS, AUTOSTEP, BODY_TOP, CLEARANCE_MAX, COARSE, COARSE_SHARE, EDGE, IDENTITY_FRAME, INDOOR, INDOOR_ABOVE, INDOOR_BELOW, INDOOR_RISE, NAV_BAKE_RULES, NAV_FLAGS,
  OTHER_REGION, RANKS, SAMPLES_PER_CELL, SLOPE_CLIMB_DEGREES, SWIM_DEPTH, bakeRules, clearanceNibbles, edgesNear, growMargin, indoorFootprint, isBuildingDef, isFootprint,
  packGrid, placementFrame, rasterPlacement,
};

/** The kinds of a world's committed edit file the bake reads, in the order their text is folded into the grid's key. */
export const GRID_EDIT_KINDS = ['heights', 'water', 'world', 'story'];

/**
 * A world's committed edit files as this install ships them (the placements folder: a checkout's `public/placements`, a
 * release's `dist/placements`, `placementsFolder`): each kind's text, or null where the world has no such file. What the
 * bake reads (`buildNavGrid`'s `edits`) and what the grid's key folds in (`layoutKeyOf`). `folder` null reads none.
 *
 * With the world's pack folder (`packDir`), also `absent`: the name of every model a solid permanent row out in the open
 * names that this install's packs do not hold (`solidRowModel`), sorted, which the bake rasterises nothing for and the key
 * folds in, so a grid baked before the gallery, the props or another world was converted is asked for again once they
 * are; empty where every one is there, which keys as no list at all.
 */
export function gridEditsOf(world, folder = placementsFolder(), packDir = null) {
  const texts = {};
  for (const kind of GRID_EDIT_KINDS) {
    let text = null;
    try {
      if (folder && /^[a-z0-9_]{1,40}$/.test(world)) text = readFileSync(join(folder, kind, `${world}.json`), 'utf8');
    } catch {
      text = null;
    }
    texts[kind] = text;
  }
  const edits = { world, texts };
  // The terrain's own wet rivers the bake makes water (Map-maker II's sixth wave), as a stamp the key folds in: a world whose
  // terrain has none carries none, and keys exactly as it did.
  if (packDir) {
    const stamp = soeRiverStamp(packDir);
    if (stamp) edits.soeRivers = stamp;
  }
  if (packDir && (typeof texts.world === 'string' || typeof texts.story === 'string')) {
    const packs = installPacks(packDir);
    const absent = new Set();
    for (const { row } of gridSolidRows(edits, (thing) => packs.thingOf(thing)?.template ?? null)) {
      if (row.inside) continue;
      for (const name of solidRowModel(row, packs).absent) absent.add(name);
    }
    edits.absent = [...absent].sort();
  }
  return edits;
}

/**
 * What a bake and the key read of this install's packs to stand a permanent row (`solidRowModel`), each file read once:
 * the packs folder, the world's own name and manifest (its pack folder's), any pack's manifest, the props catalogue's
 * things, and a pack's flora collision shapes (flora-collision.json, null where it has none).
 */
export function installPacks(packDir, worldManifest = null) {
  const dir = dirname(packDir);
  const world = basename(packDir);
  const read = (file) => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  };
  const manifests = new Map();
  const collision = new Map();
  const manifestOf = (pack) => {
    if (pack === world && worldManifest) return worldManifest;
    if (!manifests.has(pack)) manifests.set(pack, read(join(dir, pack, 'manifest.json')));
    return manifests.get(pack);
  };
  return {
    dir,
    world,
    manifestOf,
    thingOf: (thing) => (manifestOf('props')?.props ?? []).find((p) => p.id === thing) ?? null,
    collisionOf: (pack) => {
      if (!collision.has(pack)) collision.set(pack, read(join(dir, pack, 'flora-collision.json')));
      return collision.get(pack);
    },
  };
}

/**
 * Where a solid permanent row's model is in this install's packs, as the game stands it out of them (`permanent.ts`): a
 * props row by its thing in the props catalogue, a gallery row in the gallery, a world row in this world's own pack or
 * the world its `from` names. Answers the model file (null where the install has none), its def, whether its pack files it
 * as flora (the game then stands it by the model's own collision shapes, `rowFloraParts`, never its triangles), the pack,
 * and `absent`: the names of what the install lacks for it -- the model, or a flora pack's collision shapes, which the
 * game reads for such a row -- for the grid's key.
 */
export function solidRowModel(row, packs) {
  if (row.pack === 'props') {
    const p = packs.thingOf(row.thing);
    const file = p?.file ? join(packs.dir, 'props', p.file) : null;
    const there = !!file && existsSync(file);
    return { file: there ? file : null, def: null, flora: false, pack: 'props', absent: there ? [] : [`props/${row.thing}`] };
  }
  const pack = row.pack === 'gallery' ? 'gallery' : row.from ?? packs.world;
  let def = null;
  let flora = false;
  for (const [cat, list] of Object.entries(packs.manifestOf(pack)?.categories ?? {})) {
    const d = Array.isArray(list) ? list.find((e) => e.id === row.model) : null;
    if (d && !def) {
      def = d;
      flora = cat === 'flora';
    }
  }
  const file = def?.file && def.file.endsWith('.glb') ? join(packs.dir, pack, def.file) : null;
  const there = !!file && existsSync(file);
  const absent = there ? [] : [`${pack}/${row.model}`];
  if (there && flora && !packs.collisionOf(pack)) absent.push(`${pack}/flora-collision.json`);
  return { file: there ? file : null, def, flora, pack, absent };
}

/** Whether any edit file is there. */
export function anyGridEdits(edits) {
  return !!edits && GRID_EDIT_KINDS.some((k) => typeof edits.texts?.[k] === 'string');
}

/** A tile's deltas inflated as the game inflates them (node's own deflate-raw), base64 in. */
function inflateTile(b64) {
  try {
    return new Uint8Array(inflateRawSync(Buffer.from(b64, 'base64')));
  } catch {
    return null;
  }
}

/**
 * The heights file's tiles as a store (`HeightEdits`), read as the game reads them (`readHeightsFile`, `deltasOf`): a tile
 * that does not read is skipped and named. Null where there is no file or not one tile in it.
 */
export function gridHeights(edits, log = () => {}) {
  const text = edits?.texts?.heights;
  if (typeof text !== 'string') return null;
  const read = readHeightsFile(text, edits.world, 'ground');
  if (read.problem) {
    log(`  heights file not read: ${read.problem}`);
    return null;
  }
  const store = new HeightEdits();
  for (const s of read.skipped) log(`  heights tile ${s.id} skipped: ${s.why}`);
  for (const row of read.rows) {
    const d = deltasOf(inflateTile(row.d));
    if (typeof d === 'string') {
      log(`  heights tile ${row.id} skipped: ${d}`);
      continue;
    }
    const t = tileOfId(row.id);
    store.set(t.tx, t.tz, d);
  }
  return store.size ? store : null;
}

/** The water file's rows, read as the game reads them (`readWaterFile`); none where there is no file. */
function gridWaterRows(edits, log) {
  const text = edits?.texts?.water;
  if (typeof text !== 'string') return [];
  const read = readWaterFile(text, edits.world, 'ground');
  if (read.problem) {
    log(`  water file not read: ${read.problem}`);
    return [];
  }
  for (const s of read.skipped) log(`  water row ${s.id} skipped: ${s.why}`);
  return read.rows;
}

/** The water file's lakes, read as the game reads them (`readWaterFile`); none where there is no file. */
export function gridLakes(edits, log = () => {}) {
  return gridWaterRows(edits, log).filter(isLakeRow);
}

/** The water file's rivers (Map-maker II's sixth wave), read as the game reads them; none where there is no file. */
export function gridRivers(edits, log = () => {}) {
  return gridWaterRows(edits, () => {}).filter(isRiverRow);
}

/**
 * The terrain's own wet rivers as the game reads them (`soeRiverRows`, each through the water file's own reader, merged at
 * the game's `RIVER_TUNE.spacingMin`): what the bake makes water beside the client's tables, so the grid and the drawn
 * world agree. None on a terrain with none.
 */
export function gridSoeRivers(generator, log = () => {}) {
  const got = soeRiverRows(generator, RIVER_TUNE.spacingMin);
  for (const s of got.skipped) log(`  the terrain's river ${s.name} left out: ${s.why}`);
  const out = [];
  for (const raw of got.rows) {
    const row = readWaterRow(raw);
    if (typeof row === 'string' || row.kind !== 'river') log(`  the terrain's river ${String(raw.name)} does not read: ${typeof row === 'string' ? row : 'not a river'}`);
    else out.push(row);
  }
  return out;
}

/**
 * Which way the bake makes the terrain's own wet rivers water (Map-maker II's sixth wave), as the words the grid's key folds
 * in (`layoutKeyOf`): `v1:<how many>` over a pack whose terrain holds one that runs, '' over every other (a terrain that
 * names no river affector at all is not parsed). A grid baked before rivers were water is then asked for again on exactly
 * the worlds that have them.
 */
export function soeRiverStamp(packDir) {
  try {
    let terrain = 'terrain.trn';
    try {
      terrain = JSON.parse(readFileSync(join(packDir, 'layout.json'), 'utf8')).terrain ?? terrain;
    } catch {
      // A layout that will not parse keys its usual terrain.
    }
    const bytes = readFileSync(join(packDir, terrain));
    if (bytes.indexOf('ARIV') < 0) return '';
    const n = gridSoeRivers(parseTerrainTemplate(new Uint8Array(bytes)).generator).length;
    return n ? `v1:${n}` : '';
  } catch {
    return '';
  }
}

/** The world and story placement rows of a world that stand solid (`standsSolid`, a props row's thing's template asked by `thingTemplate`). */
export function gridSolidRows(edits, thingTemplate, log = () => {}) {
  const out = [];
  for (const layer of ['world', 'story']) {
    const text = edits?.texts?.[layer];
    if (typeof text !== 'string') continue;
    const read = readPlacementsFile(text, edits.world, 'ground');
    if (read.problem) {
      log(`  ${layer} placements not read: ${read.problem}`);
      continue;
    }
    for (const row of read.rows) {
      const template = row.pack === 'props' ? thingTemplate(row.thing) : null;
      const furniture = !!template && (isSeat(template) || isTableTemplate(template));
      if (standsSolid(row, furniture)) out.push({ layer, row });
    }
  }
  return out;
}

/**
 * The owner's shared walk-through file as this install ships it (`solid.json` in the placements folder: a checkout's
 * `public/placements`, a release's `dist/placements`, `placementsFolder`; src/world/walkThrough.ts): the templates
 * whose every placed copy the game walks through, which the bake leaves out so the people and creatures walk through what
 * the player walks through. An empty set where the file is missing or not read.
 */
export function walkThroughTemplates(file = solidFileOf()) {
  let text;
  try {
    if (!file) return new Set();
    text = readFileSync(file, 'utf8');
  } catch {
    return new Set();
  }
  const read = readSolidFile(text);
  return new Set([...read.rows].filter(([, solid]) => solid === false).map(([t]) => t));
}

/** The shared walk-through file's path in this install's placements folder, or null with no folder. */
export function solidFileOf(root) {
  const dir = placementsFolder(root);
  return dir ? join(dir, 'solid.json') : null;
}

/**
 * The shape of the files this writes; a pack that says anything else is passed over by the game.
 *
 * 2 added the clearance plane. A version 1 grid is simply not read: it has no clearance in it, and
 * the game would have to carry a second search that knew nothing of berths to use one. Re-baking a
 * world is one command that opens no archive, so the cheap answer is to re-bake.
 */
export const NAV_GRID_VERSION = 2;

/**
 * How far round a named town's own centre counts as that town's ground, metres, and how far out
 * the check then looks for the world's largest walkable region.
 *
 * Both invented. The ring has to be wide enough that the answer is the town's streets and not
 * whichever cell the POI's own point happens to land in -- a town centre lands in a walled yard
 * often enough that one snapped point is no measurement at all, which is exactly how a bake that
 * cut two towns off a world was first reported as cutting none.
 */
export const TOWN_RING = 120;
export const TOWN_LOOK = 400;

/**
 * `OUTDOOR_TUNE.goalSnap` in `src/world/nav/outdoorGrid.ts`, repeated here because the converter
 * does not import the runtime. It is the distance that decides whether a town standing off the
 * main region still matters: a goal within it is pulled onto the body's own ground and a real
 * route is planned to the town's edge, and a goal past it is answered 'unreachable' and the body
 * steers the whole way, which is the game with no grid at all. A node test fails if the two
 * numbers ever disagree.
 */
export const GOAL_SNAP = 40;

/** Yaw (rotation about Y) of a w,x,y,z quaternion, as the rest of the converter reads one. */
function yawOf(q) {
  const [w, x, y, z] = q;
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
}

// ---- a very small GLB reader ------------------------------------------------------------------
// Only what a footprint needs: every triangle's three corners in model space, and the portal cell
// its node names, so the shell and the rooms can be told apart. The converter's own `glb.mjs`
// writes these files and does not read them.

function accessorOf(json, bin, idx) {
  const a = json.accessors[idx];
  const bv = json.bufferViews[a.bufferView];
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const size = sizes[a.componentType];
  const elem = size * comps;
  const stride = bv.byteStride ?? elem;
  const out = a.componentType === 5126 ? new Float32Array(a.count * comps) : new Uint32Array(a.count * comps);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < comps; c++) {
      const o = base + i * stride + c * size;
      let v;
      switch (a.componentType) {
        case 5126: v = dv.getFloat32(o, true); break;
        case 5125: v = dv.getUint32(o, true); break;
        case 5123: v = dv.getUint16(o, true); break;
        case 5121: v = dv.getUint8(o); break;
        case 5122: v = dv.getInt16(o, true); break;
        default: v = dv.getInt8(o);
      }
      out[i * comps + c] = v;
    }
  }
  return out;
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function mulMatrix(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

/**
 * One GLB's triangles in model space: `positions` nine floats a triangle, `cells` the portal cell
 * index each stands in (0 the exterior shell, -1 a plain model with no cells at all). A primitive whose
 * material `skip` names (by the material's name, its shader) is left out: a waterfall's falling water
 * (`isFallingWaterShader`), which the game builds no collider for.
 */
export function readGlbTriangles(file, skip = isFallingWaterShader) {
  const buf = readFileSync(file);
  if (buf.length < 12 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`not a glb: ${file}`);
  let off = 12;
  let json = null;
  let bin = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  if (!json) throw new Error(`no json chunk: ${file}`);
  const tris = [];
  const cells = [];
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene?.nodes ?? (json.nodes ?? []).map((_, i) => i);
  // GLTFLoader strips the colon from a node's name, so the converter's own `cell:<n>:<name>` may
  // arrive either way round; both spellings are read, as the runtime's `cellIndexOf` does.
  const cellOf = (name) => {
    const m = /^cell[:_]?(\d+)/.exec(name ?? '');
    return m ? Number(m[1]) : -1;
  };
  const walk = (idx, parent, cell) => {
    const node = json.nodes[idx];
    if (!node) return;
    const m = mulMatrix(parent, nodeMatrix(node));
    const own = cellOf(node.name);
    const c = own >= 0 ? own : cell;
    if (node.mesh !== undefined && bin) {
      for (const prim of json.meshes[node.mesh].primitives ?? []) {
        if (prim.mode !== undefined && prim.mode !== 4) continue;
        if (skip && prim.material !== undefined && skip(json.materials?.[prim.material]?.name)) continue;
        const posIdx = prim.attributes?.POSITION;
        if (posIdx === undefined) continue;
        const pos = accessorOf(json, bin, posIdx);
        const idxs = prim.indices !== undefined ? accessorOf(json, bin, prim.indices) : null;
        const count = idxs ? idxs.length : pos.length / 3;
        for (let t = 0; t + 2 < count; t += 3) {
          for (let k = 0; k < 3; k++) {
            const v = idxs ? idxs[t + k] : t + k;
            const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
            tris.push(m[0] * x + m[4] * y + m[8] * z + m[12]);
            tris.push(m[1] * x + m[5] * y + m[9] * z + m[13]);
            tris.push(m[2] * x + m[6] * y + m[10] * z + m[14]);
          }
          cells.push(c);
        }
      }
    }
    for (const kid of node.children ?? []) walk(kid, m, c);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of roots) walk(r, I, -1);
  return { positions: Float32Array.from(tris), cells: Int32Array.from(cells) };
}

// ---- the bake ---------------------------------------------------------------------------------

/**
 * Where one named town stands on a finished grid: the region most of the open ground within
 * `TOWN_RING` of its centre belongs to, and how far the world's largest walkable region (rank 1)
 * reaches toward it, in metres.
 *
 * It exists because a slope angle can take a town off the main region and **nothing else in the
 * pipeline would say so**. The check that was tried first took one point per town -- the nearest
 * open cell to the POI's own centre -- and compared region ids; on the two Corellian towns a
 * rebake really did cut off, that point landed in a walled yard at every angle, so both read
 * "already apart" and the severance was invisible. One snapped point is not a measurement of a
 * town: the ground round it is.
 *
 * `nibble(k)` reads the finished region plane, which is why this takes an accessor rather than the
 * packed bytes -- a node test hands it a world drawn by hand.
 */
export function townStanding(nibble, nx, nz, i0, j0, ringCells, lookCells) {
  const tally = new Map();
  let open = 0;
  for (let dj = -ringCells; dj <= ringCells; dj++) {
    for (let di = -ringCells; di <= ringCells; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const v = nibble(j * nx + i);
      if (!(v > 0 && v < INDOOR)) continue;
      open++;
      tally.set(v, (tally.get(v) ?? 0) + 1);
    }
  }
  let region = -1;
  let best = 0;
  for (const [v, n] of tally) if (n > best) { best = n; region = v; }
  // Ring by ring outward. The rings are square and the answer is a **distance**, so stopping at the
  // first ring that holds a rank-1 cell is not enough: that cell may be in the ring's corner, at
  // `r * sqrt(2)`, while a nearer one sits in the middle of an edge two rings further out. Every
  // cell of ring r is at least r away, so the search may stop once r passes the best distance
  // found, and no sooner -- which costs about four tenths more rings and makes the number exact
  // rather than up to 41% over.
  let rank1 = Infinity;
  if (i0 >= 0 && j0 >= 0 && i0 < nx && j0 < nz && nibble(j0 * nx + i0) === 1) rank1 = 0;
  for (let r = 1; r <= lookCells && r <= rank1; r++) {
    for (let d = -r; d <= r; d++) {
      for (const [i, j] of [[i0 + d, j0 - r], [i0 + d, j0 + r], [i0 - r, j0 + d], [i0 + r, j0 + d]]) {
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        if (nibble(j * nx + i) !== 1) continue;
        const dd = Math.hypot(i - i0, j - j0);
        if (dd < rank1) rank1 = dd;
      }
    }
  }
  return { region, share: open ? best / open : 0, open, rank1Cells: rank1 };
}

/**
 * Build one world's grid. `dir` is a converted planet pack. Returns the header, the packed nibbles
 * and the coarse plane; nothing is written here, so a test can build a small world and read it.
 *
 * `log` is called with one line at a time, so the command prints its working and a test does not.
 */
export async function buildNavGrid(dir, opts = {}) {
  const log = opts.log ?? (() => {});
  const trn = await import('../../src/swg/terrain/trn.ts');
  const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const trnPath = join(dir, layout.terrain ?? 'terrain.trn');
  if (!existsSync(trnPath)) throw new Error(`${trnPath} missing; run the snapshot (or terrain) command for this world first`);
  const template = trn.parseTerrainTemplate(new Uint8Array(readFileSync(trnPath)));
  for (const b of trn.bitmapFiles(template)) {
    const f = join(dir, b.file);
    if (existsSync(f)) trn.attachBitmap(template, b.familyId, new Uint8Array(readFileSync(f)));
  }
  const sampler = new trn.TerrainSampler(template);
  // The buildings' own terrain layers flatten the ground under them; without these a town stands on
  // whatever the fractals made and every doorstep is a cliff.
  let layerCount = 0;
  for (const o of layout.objects) {
    if (!o.layer) continue;
    const f = join(dir, o.layer);
    if (!existsSync(f)) continue;
    const L = trn.parseLayerFile(new Uint8Array(readFileSync(f)), template.generator);
    if (!L) continue;
    sampler.addBuildingLayer(L, o.x, o.z, yawOf(o.q));
    layerCount++;
  }

  const width = template.mapWidthInMeters;
  const pole = sampler.poleStep;
  const cell = Number(opts.cell ?? pole);
  if (!(cell > 0) || Math.abs(cell / pole - Math.round(cell / pole)) > 1e-9) {
    throw new Error(`cell ${cell} is not a whole number of ${pole} m pole steps`);
  }
  const cx = layout.center.x;
  const cz = layout.center.z;
  // Game coordinates: gx = centerX - swgX, gz = swgZ - centerZ (src/world/swgTerrain.ts). The map
  // runs over [-width/2, width/2] in the game's own SWG frame, so in the game's frame it runs from
  // these two corners -- which is not centred on the origin, because the pack's centre is not the
  // map's.
  const x0 = cx - width / 2;
  const z0 = -width / 2 - cz;
  const nx = Math.round(width / cell);
  const nz = Math.round(width / cell);
  log(`${layout.planet}: ${width} m across at ${cell} m cells -> ${nx} x ${nz} (${((nx * nz) / 1e6).toFixed(1)} M cells), ${layerCount} building terrain layers`);

  // ---- the heights, on the generator's own pole lattice ---------------------------------------
  const started = Date.now();
  const pnx = nx * (cell / pole) + 2;
  const pnz = nz * (cell / pole) + 2;
  const heights = new Float32Array(pnx * pnz);
  {
    const t = Date.now();
    const STRIP = 256;
    for (let j0 = 0; j0 < pnz; j0 += STRIP) {
      const jn = Math.min(STRIP, pnz - j0);
      for (let i0 = 0; i0 < pnx; i0 += STRIP) {
        const iN = Math.min(STRIP, pnx - i0);
        const n = Math.max(iN, jn);
        // SWG x runs opposite to the game's, so the strip is generated from its far column back.
        const g = sampler.generate(cx - (x0 + (i0 + iN - 1) * pole), cz + (z0 + j0 * pole), n, pole);
        for (let j = 0; j < jn; j++) {
          for (let i = 0; i < iN; i++) heights[(j0 + j) * pnx + (i0 + i)] = g.heights[j * n + (iN - 1 - i)];
        }
      }
    }
    log(`  heights: ${pnx} x ${pnz} poles at ${pole} m in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }
  /** The ground at a game-frame point, bilinear between the four poles round it. */
  const heightAt = (gx, gz) => {
    const fx = (gx - x0) / pole, fz = (gz - z0) / pole;
    const i = Math.max(0, Math.min(pnx - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(pnz - 2, Math.floor(fz)));
    const u = fx - i, v = fz - j;
    const a = heights[j * pnx + i], b = heights[j * pnx + i + 1];
    const c = heights[(j + 1) * pnx + i], d = heights[(j + 1) * pnx + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  // One check that the lattice really is the generator's, kept on every run rather than done once
  // by hand: the same twenty poles asked of the sampler itself.
  let worstHeight = 0;
  for (let k = 0; k < 20; k++) {
    const i = 1 + ((k * 3557) % (pnx - 2));
    const j = 1 + ((k * 7919) % (pnz - 2));
    const gx = x0 + i * pole, gz = z0 + j * pole;
    worstHeight = Math.max(worstHeight, Math.abs(sampler.heightAt(cx - gx, cz + gz) - heights[j * pnx + i]));
  }

  // ---- the world's committed edit files (Map-maker II's fifth wave) ----------------------------
  // `opts.edits` stands in for the files in a test (`gridEditsOf`'s shape); a world with none reads none and bakes as
  // it always did. The heights file's deltas are laid over the poles as the game lays them where a grid enters a cache
  // (`HeightEdits.layIn`, `fround(raw + d)` where a delta is not nought), after the check above, which holds the lattice
  // to the generator's own raw ground.
  const edits = opts.edits !== undefined ? opts.edits : gridEditsOf(opts.world ?? basename(dir));
  const editStats = { tiles: 0, lakes: 0, rows: 0, floraRows: 0, rowsMissing: 0, absent: [] };
  const heightEdits = gridHeights(edits, log);
  if (heightEdits) {
    heightEdits.lay(heights, heights, cx - x0, -pole, cz + z0, pole, pnx, pnz);
    editStats.tiles = heightEdits.size;
    log(`  heights file: ${heightEdits.size} tiles laid over the ground`);
  }

  const flags = new Uint8Array(nx * nz);
  // Which sides of an object-blocked cell its geometry hugs (`EDGE`), for the margin.
  const edgeNear = new Uint8Array(nx * nz);
  const cellCenterX = (i) => x0 + (i + 0.5) * cell;
  const cellCenterZ = (j) => z0 + (j + 0.5) * cell;

  // ---- slope ----------------------------------------------------------------------------------
  const slopeCells = markSlope(heights, pnx, nx, nz, cell / pole, pole, Math.tan((Number(opts.slope ?? SLOPE_CLIMB_DEGREES) * Math.PI) / 180), flags);

  // ---- water ----------------------------------------------------------------------------------
  let waterCells = 0;
  let soeRiverCount = 0;
  {
    const tables = trn.waterTables(template.generator).map((w) => {
      let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
      for (const p of w.points) {
        mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x);
        mnz = Math.min(mnz, p.y); mxz = Math.max(mxz, p.y);
      }
      return { w, mnx, mxx, mnz, mxz };
    });
    const global = template.useGlobalWaterTable ? template.globalWaterTableHeight : -Infinity;
    // The lakes of ours, made tables of the game's frame by the very rule the game makes them by (`ourWater.ts`), the
    // higher surface winning over the client's; none, and the test is the one before to the byte.
    const lakeRows = gridLakes(edits, log);
    const ours = lakeRows.map((row) => lakeTable(row, (x) => cx - x, (z) => z - cz));
    editStats.lakes = ours.length;
    // The rivers (Map-maker II's sixth wave): the terrain's own wet rivers, then the water file's, made tables by the game's
    // own rule (`riverTable`, which keeps a steep reach water under the game's default `'effects'`), the higher surface
    // winning; none, and the test is the lakes' alone. `opts.soeRivers` false leaves the terrain's own out (a comparison).
    const soe = opts.soeRivers === false ? [] : gridSoeRivers(template.generator, log);
    const rivers = [...soe.map((row) => riverTable(row, (x) => cx - x, (z) => z - cz, row.id)), ...gridRivers(edits, log).map((row) => riverTable(row, (x) => cx - x, (z) => z - cz))];
    // Counted only where there are any, so a world with none writes the header it always wrote.
    if (rivers.length > soe.length) editStats.rivers = rivers.length - soe.length;
    if (soe.length) soeRiverCount = soe.length;
    if (rivers.length) log(`  rivers: ${soe.length} of the terrain's own and ${rivers.length - soe.length} of ours made water`);
    const surface = !ours.length && !rivers.length ? null : !rivers.length ? (gx, gz) => surfaceOf(ours, gx, gz) : (gx, gz) => riversSurface(rivers, gx, gz, ours.length ? surfaceOf(ours, gx, gz) : -Infinity);
    waterCells = markWater(nx, nz, cellCenterX, cellCenterZ, cx, cz, global, tables, heightAt, flags, surface);
  }

  // ---- the placed objects ----------------------------------------------------------------------
  // Grouped by model, so each GLB is read once, rasterised into every one of its placements, and
  // dropped again: a world's models together are more triangles than a bake wants to hold at once.
  const defs = new Map();
  for (const list of Object.values(manifest.categories ?? {})) for (const e of list) defs.set(e.id, e);
  const byModel = new Map();
  // What the owner made walk-through (`public/placements/solid.json`): the game builds no collider for any copy of these,
  // so the grid blocks no cell for them either (`opts.walkThrough`, a set of templates, stands in for the file in a test).
  const walkThrough = opts.walkThrough ?? walkThroughTemplates();
  let walkedThrough = 0;
  // Every object whatever world state it stands in (`state`, Restuss's living city and its ruins: restuss.mjs): one
  // grid serves both, so a body in the ruins routes round where a house stood and never into a building in either.
  for (const o of layout.objects) {
    if (o.contained) continue;
    if (walkThrough.has(o.template)) {
      walkedThrough++;
      continue;
    }
    const list = byModel.get(o.model);
    if (list) list.push(o);
    else byModel.set(o.model, [o]);
  }
  let objectCells = 0;
  let indoorCells = 0;
  // Cells a building's rooms came near the ground at without the building rising over them, by the
  // model that did it, for the log: the census of what the rise opened, so a bake says which buildings
  // it read as standing over their rooms rather than leaving that to be found in play. A cell another
  // building covers is still counted against this one, so the sum can pass the world's `opened`.
  const openedBy = new Map();
  // The bake before `rules: 2`, for a comparison run and nothing else: `margin: 'cell'` grows every
  // blocked cell a whole cell, and `footprint: 'band'` calls every cell a room comes near the ground
  // at a footprint, as it did. Both together write the grid the older rules wrote, byte for byte.
  const rules = bakeRules(opts);
  // The world's cells and the arithmetic over them, as `rasterPlacement` reads them; its scratch -- a
  // building's rooms at the cells one placement of it touches, which come near the ground and how
  // high the highest stands over it -- is made once and emptied per placement.
  const bake = { nx, nz, x0, z0, cell, flags, edgeNear, heightAt, byBand: rules.byBand, nearGround: new Set(), highest: new Map() };
  let placed = 0;
  let missing = 0;
  let triangles = 0;
  let buildings = 0;
  {
    const t = Date.now();
    for (const [model, list] of byModel) {
      const def = defs.get(model);
      if (!def || !def.file || !def.file.endsWith('.glb')) {
        missing += list.length;
        continue;
      }
      const file = join(dir, def.file);
      if (!existsSync(file)) {
        missing += list.length;
        continue;
      }
      let tri;
      try {
        tri = readGlbTriangles(file);
      } catch {
        missing += list.length;
        continue;
      }
      const isBuilding = isBuildingDef(def);
      const positions = tri.positions;
      const cells = tri.cells;
      for (const o of list) {
        placed++;
        if (isBuilding) buildings++;
        const r = rasterPlacement(bake, positions, cells, isBuilding, placementFrame(o, cx, cz));
        triangles += r.triangles;
        objectCells += r.objectCells;
        indoorCells += r.indoorCells;
        if (r.opened) openedBy.set(model, (openedBy.get(model) ?? 0) + r.opened);
      }
    }
    log(`  ${placed} placed objects (${buildings} of them portal buildings, ${missing} without a model), ${triangles} triangles, in ${((Date.now() - t) / 1000).toFixed(1)} s${walkedThrough ? `; ${walkedThrough} walked through by the shared file (solid.json)` : ''}`);
    if (openedBy.size) {
      const top = [...openedBy].sort((a, b) => b[1] - a[1]);
      const cells = top.reduce((n, [, c]) => n + c, 0);
      log(`  ${cells} cells near a building's rooms left open, since nothing of the building rises over the ground there, in ${top.length} models: ${top.slice(0, 8).map(([m, c]) => `${m} ${c}`).join(', ')}${top.length > 8 ? ', ...' : ''}`);
    }
    // A world with buildings and not one indoor cell is the silent failure this bake can have: the
    // manifest entries carried no `cells`, every building inside is open ground, and a string-pull
    // would walk a body through a cantina with nothing anywhere saying so. Say it here, and again
    // in `status`, which reads the same two numbers back out of nav.json.
    if (buildings > 0 && indoorCells === 0) {
      log(`  WARNING: ${buildings} portal buildings and not one indoor cell -- their manifest entries carry no cells, so their insides are baked as open ground and a route may cut straight through one`);
    }
  }

  // ---- the permanent rows that stand solid (Map-maker II's fifth wave) ----------------------------
  // Every world and story placement row standing solid by the game's own rule (`standsSolid`, a seat or a table passable
  // unless its row says), out in the open (a row in a room is a room's furniture, as a contained object is), rasterised as
  // the game stands it: a placed object's triangles at its place, turn and size, a building with rooms marking its
  // footprint indoor where it rises over the ground; and a row its pack files as flora by the model's own collision shapes
  // (`rowFloraParts`: its trunk, a rock's cylinders, nothing for one the client walked through), never its canopy's
  // triangles, which the game never makes solid for such a row. Its model is read from the pack the game stands it out of
  // (`solidRowModel`: the props pack by its thing, the gallery, this world's own or the world `from` names). None, and
  // nothing here runs.
  {
    const packs = installPacks(dir, manifest);
    const solidRows = gridSolidRows(edits, (thing) => packs.thingOf(thing)?.template ?? null, log);
    const triangleCache = new Map();
    const trianglesOf = (file) => {
      if (!triangleCache.has(file)) {
        let tri = null;
        try {
          tri = existsSync(file) ? readGlbTriangles(file) : null;
        } catch {
          tri = null;
        }
        triangleCache.set(file, tri);
      }
      return triangleCache.get(file);
    };
    const absent = new Set();
    for (const { row } of solidRows) {
      if (row.inside) continue;
      const found = solidRowModel(row, packs);
      for (const name of found.absent) absent.add(name);
      const { def, flora } = found;
      // At the size it stands (`scaleOf`): a building with rooms at its own size, a flora row at its largest axis, as the
      // streamer stands them.
      const [sx, sy, sz] = scaleOf(row);
      const most = Math.max(sx, sy, sz);
      if (flora && found.file && def?.bounds) {
        // Its collision shapes, as the game merges them onto its pack's flora (`mergeFloraCollision`) and stands them through
        // the row's own matrix at its largest axis (`rowFloraParts`, the very function the streamer calls).
        if (!def.collision) mergeFloraCollision([def], packs.collisionOf(found.pack));
        const f = scaledFrame(placementFrame(row, cx, cz), most, most, most);
        const m = [f.r00, f.r10, f.r20, 0, f.r01, f.r11, f.r21, 0, f.r02, f.r12, f.r22, 0, f.gx, f.y, f.gz, 1];
        const { radius, height } = modelExtentOf(def.bounds);
        const r = rasterParts(bake, rowFloraParts(def, m, most, radius, height, row.y, FLORA_COLLISION));
        editStats.rows++;
        editStats.floraRows++;
        triangles += r.triangles;
        objectCells += r.objectCells;
        continue;
      }
      const tri = found.file ? trianglesOf(found.file) : null;
      if (!tri) {
        editStats.rowsMissing++;
        continue;
      }
      const isBuilding = isBuildingDef(def);
      const frame = isBuilding ? placementFrame(row, cx, cz) : scaledFrame(placementFrame(row, cx, cz), sx, sy, sz);
      const r = rasterPlacement(bake, tri.positions, tri.cells, isBuilding, frame);
      editStats.rows++;
      if (isBuilding) buildings++;
      triangles += r.triangles;
      objectCells += r.objectCells;
      indoorCells += r.indoorCells;
    }
    editStats.absent = [...absent].sort();
    if (solidRows.length) log(`  permanent rows: ${editStats.rows} solid rows rasterised${editStats.floraRows ? ` (${editStats.floraRows} of flora by their own collision shapes)` : ''}${editStats.rowsMissing ? `, ${editStats.rowsMissing} with no model in this install's packs` : ''}${editStats.absent.length ? `; asked for again once the install holds ${editStats.absent.join(', ')}` : ''}`);
  }

  // ---- the body's own margin --------------------------------------------------------------------
  const grow = Math.max(0, Math.ceil(AGENT_RADIUS / cell));
  const solid = growMargin(nx, nz, flags, edgeNear, grow, rules.byEdge);
  let blockedCells = 0;
  for (let k = 0; k < solid.length; k++) if (solid[k]) blockedCells++;
  // What the rise opened on this world: cells the band alone would have called a footprint and no
  // building rises over. The census the rule is judged by, kept in the header beside `indoor`.
  let openedCells = 0;
  for (let k = 0; k < flags.length; k++) if ((flags[k] & NAV_FLAGS.near) && !(flags[k] & NAV_FLAGS.indoor)) openedCells++;


  // The regions, the nibbles, the coarse plane and its edges. It is one call because a node test
  // drives the very same code over a world drawn by hand: everything below this line is arithmetic
  // over the blocked and indoor masks, and nothing in it has ever seen an archive.
  const clearMax = Math.max(1, Math.min(15, Math.round(Number(opts.clearMax ?? CLEARANCE_MAX))));
  const packed = packGrid(nx, nz, solid, flags, NAV_FLAGS.indoor, COARSE, (line) => log(`  ${line}`), clearMax);
  const { nibbles, coarse, edges, clear, regions } = packed;
  const cnx = packed.cnx;
  const cnz = packed.cnz;
  // What the clearance plane came to, which is the one number that says whether a berth can be
  // bought on this world at all: a world whose open ground is all at 1 or 2 has no room to stand
  // off anything, and the runtime's cost curve would then only ever be a surcharge.
  const clearHistogram = new Array(clearMax + 1).fill(0);
  for (let k = 0; k < nx * nz; k++) {
    const b = clear[k >> 1];
    clearHistogram[k & 1 ? b >> 4 : b & 0x0f]++;
  }

  // ---- where the named towns ended up ----------------------------------------------------------
  // The one thing a change to `SLOPE_CLIMB_DEGREES` can do that nothing else in the pipeline would
  // notice: take a town off the world's main walkable region, so every body in it is on an island
  // and every errand to it is answered 'unreachable'. It costs one pass over a few hundred-metre
  // squares and it is the difference between that shipping and that being read off the bake's own
  // output. A pack with no `pois.json` is simply not checked, as one with no floors is not.
  const towns = [];
  {
    const poiFile = join(dir, 'pois.json');
    let list = [];
    if (existsSync(poiFile)) {
      try {
        list = (JSON.parse(readFileSync(poiFile, 'utf8')).pois ?? []).filter((p) => p.kind === 'city' && Number.isFinite(p.x) && Number.isFinite(p.z));
      } catch { list = []; }
    }
    const nibble = (k) => {
      const b = nibbles[k >> 1];
      return k & 1 ? b >> 4 : b & 0x0f;
    };
    const ringCells = Math.max(1, Math.round(TOWN_RING / cell));
    const lookCells = Math.max(1, Math.round(TOWN_LOOK / cell));
    for (const p of list) {
      // The same frame conversion the placements take: gx = centerX - swgX, gz = swgZ - centerZ.
      const gx = cx - p.x;
      const gz = p.z - cz;
      const i0 = Math.floor((gx - x0) / cell);
      const j0 = Math.floor((gz - z0) / cell);
      const s = townStanding(nibble, nx, nz, i0, j0, ringCells, lookCells);
      towns.push({
        name: p.name,
        region: s.region,
        share: Number(s.share.toFixed(3)),
        open: s.open,
        rank1: Number.isFinite(s.rank1Cells) ? Number((s.rank1Cells * cell).toFixed(1)) : null,
      });
    }
    // A town is cut off when its own ground is not the main region **and** the main region does not
    // reach within the distance a goal is pulled over. Inside that distance the game still plans a
    // real route to the town's edge and the body steers the last few metres, which is what several
    // coastal towns have always done; past it there are no corners at all.
    const cut = towns.filter((t) => t.region !== 1 && (t.rank1 === null || t.rank1 > GOAL_SNAP));
    if (cut.length) {
      log(`  WARNING: ${cut.length} of ${towns.length} named town${cut.length === 1 ? ' stands' : 's stand'} on ground the largest walkable region does not reach within ${GOAL_SNAP} m, so a body sent to one is answered 'unreachable' and steers the whole way: ${cut.map((t) => `${t.name} (region ${t.region}, rank 1 ${t.rank1 === null ? `over ${TOWN_LOOK}` : t.rank1} m off)`).join(', ')}`);
      log(`  if that is new, it is the slope: re-bake this world with --slope=<higher> and compare, since the angle is the only thing that moves it`);
    } else if (towns.length) {
      log(`  all ${towns.length} named towns stand on or within ${GOAL_SNAP} m of the largest walkable region`);
    }
  }

  const seconds = (Date.now() - started) / 1000;
  const header = {
    version: NAV_GRID_VERSION,
    planet: layout.planet,
    cell,
    coarse: COARSE,
    nx,
    nz,
    cnx,
    cnz,
    x0,
    z0,
    // The pack's own centre, which `x0` and `z0` are derived from. It is written down so that a
    // world re-snapshotted around a different centre can be caught: the grid would still load, its
    // cells would still be the right size, and every one of them would stand the difference away
    // from the ground it was baked for, with `status` cheerfully reporting a nav grid. Two numbers
    // beside the two they made is the whole of the check.
    center: { x: cx, z: cz },
    ranks: RANKS,
    clearMax,
    regions: regions.slice(0, RANKS).map((r, i) => ({ rank: i + 1, cells: r.cells, km2: Number(((r.cells * cell * cell) / 1e6).toFixed(3)) })),
    otherRegions: Math.max(0, regions.length - RANKS),
    slopeDegrees: Number(opts.slope ?? SLOPE_CLIMB_DEGREES),
    // The rules it was baked by (`NAV_BAKE_RULES`), which nothing in the grid itself would otherwise
    // show: a grid baked by the older ones loads and routes exactly as a new one does, and only walks
    // at the wall of a courtyard. A comparison bake by the older rules says so.
    rules: rules.stamp,
    // Where each named town ended up, so `status` can say it tomorrow and two bakes at two angles
    // can be held against each other without re-measuring either. `rank1` is metres to the nearest
    // cell of the largest walkable region, or null when it is further off than `TOWN_LOOK`.
    towns,
    stats: {
      // Cells at each clearance, 0 (unwalkable) first: how much room this world really has to
      // stand off anything. It is written down because the runtime's berth is only worth its
      // arithmetic where there are cells to buy it with.
      clearance: clearHistogram,
      slope: slopeCells,
      objects: objectCells,
      water: waterCells,
      indoor: indoorCells,
      // Cells a building's rooms come near the ground at and the building nowhere rises over, which the
      // band alone would have called its footprint: courtyards and yards over cellars (`INDOOR_RISE`).
      opened: openedCells,
      blocked: blockedCells,
      margin: grow * cell,
      placed,
      buildings,
      missing,
      // Placed copies the shared walk-through file left out (solid.json), blocking no cell.
      walkedThrough,
      triangles,
      layers: layerCount,
      // What the world's committed edit files brought (Map-maker II's fifth wave): only where it has one, so a grid of a
      // world with none is written as it always was.
      ...(anyGridEdits(edits) ? { edits: { ...editStats } } : {}),
      // The terrain's own wet rivers made water (the sixth wave): only where there are any.
      ...(soeRiverCount ? { soeRivers: soeRiverCount } : {}),
      heightCheck: Number(worstHeight.toFixed(4)),
      seconds: Number(seconds.toFixed(1)),
    },
  };
  // `flags` is every cell's reasons before the margin and the regions -- blocked by slope (1), by an
  // object (2), by water (4), a footprint (8), a room near the ground (16) -- which nothing writes,
  // for a census that wants to know why a cell came out as it did rather than only what.
  return { header, nibbles, coarse, edges, clear, regions, flags };
}

/**
 * Write one world's grid into its pack: `nav.json` beside the manifest and `nav.bin` beside it, the
 * region nibbles, the coarse plane, its edges and the clearance nibbles in one raw-deflate stream
 * so the browser can inflate them in one go.
 *
 * The planes go in that order and the header says how long each is, so a reader takes four
 * subarrays of one buffer and copies nothing.
 */
export function writeNavGrid(dir, built) {
  const { header, nibbles, coarse, edges, clear } = built;
  const joined = new Uint8Array(nibbles.length + coarse.length + edges.length + clear.length);
  joined.set(nibbles, 0);
  joined.set(coarse, nibbles.length);
  joined.set(edges, nibbles.length + coarse.length);
  joined.set(clear, nibbles.length + coarse.length + edges.length);
  const packed = deflateRawSync(joined, { level: 9 });
  const out = { ...header, file: 'nav.bin', fineBytes: nibbles.length, coarseBytes: coarse.length, edgeBytes: edges.length, clearBytes: clear.length, packedBytes: packed.length };
  mkdirSync(dirname(join(dir, 'nav.json')), { recursive: true });
  writeFileSync(join(dir, 'nav.json'), `${JSON.stringify(out, null, 2)}\n`);
  writeFileSync(join(dir, 'nav.bin'), packed);
  return out;
}
