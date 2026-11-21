// Lower levels of detail for the placed models and plants the client gave none (the GPU port's pass 1, wave 7:
// `npm run swg -- lods <out-dir>`).
//
// The client's own levels come with the snapshot (`lodlevels.mjs`): a model whose appearance names a `.lod` chain
// carries its lowest level and, on a long chain, its middle one. About one model in six of a world names none (182
// of Tatooine's 1,001 placed models), and the gallery's houses and the dungeons' shells are most of the triangles
// among them. This pass makes up to three levels for each of those, at about a half, a quarter and an eighth of
// the triangles, with meshoptimizer's `simplifyWithAttributes` (MIT, used directly: `LICENSES/meshoptimizer-MIT.txt`),
// and writes them exactly as the client's own are written -- `lod:<n>` nodes in the GLB's second scene, `lods`, and
// the manifest entry's `lods` ranges -- so the game's level groups and flora batches draw them with nothing changed.
// Only the model's own level is in its default scene, so only it collides, and every loader that reads that scene
// (a scene backdrop, the walk grid, the library's pictures) sees exactly the file it saw before.
//
// It reads no archive: everything it needs is the pack. A level is kept only while the simplifier's own error stays
// under `MADE_LOD.maxError` of the model's size and saves a fair share of the triangles of the level before it; its
// switch distance is where that error comes to `MADE_LOD.pixels` of a reference screen (`switchNear`), which the
// owner moves live (`LOD_LEVEL_TUNE.madeBias`, `src/world/lodDials.ts`). Every made row says so (`made: true`), so
// the game can tell a made level from the client's and a second run can tell its own work from the snapshot's.
//
// The pass is idempotent: a model with levels of its own, or with levels this pass made, is left byte for byte as it
// is; a GLB carrying a made scene whose manifest entry has lost its rows (a manifest written again round a file
// kept) is put back to what it was before the pass -- everything made is appended after the file's own nodes,
// meshes, accessors, views and bytes, and the made scene records where they began -- and made again. The pack's
// manifest is stamped (`madeLods`: the format and a key of every model it looked at, by file and size), which is
// what `status` asks by, once.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOD_SCENE, lodLevelOfName, lodNodeName } from './lodlevels.mjs';

/**
 * meshoptimizer's simplifier, loaded only by the pass itself (`loadSimplifier`), so `status`, which reads this file for
 * its stamp, never instantiates its WebAssembly. The one dependency the converter has outside Node: `package.json` pins
 * it and the launcher's release carries it (`tools/launcher/pack.mjs`, `CONVERTER_PACKAGES`).
 */
let simplifier = null;

/** meshoptimizer's simplifier, ready to call. */
export async function loadSimplifier() {
  if (!simplifier) {
    const { MeshoptSimplifier } = await import('meshoptimizer/simplifier');
    await MeshoptSimplifier.ready;
    simplifier = MeshoptSimplifier;
  }
  return simplifier;
}

/** What a pack's `madeLods` stamp is written at; `status` asks for the pass again while a pack's is another. */
export const MADE_LOD_FORMAT = 1;

/**
 * The pass's numbers, all of them ours.
 *
 * - `ratios`: the share of the finest's triangles each level aims at (the design's half, quarter and eighth). Each
 *   is simplified from the finest, never from the level before, so an error never compounds.
 * - `maxError`: the most a level may move the surface, as a share of the model's size (meshoptimizer's scale: the
 *   largest side of its box). Past about a fiftieth the simplifier is taking whole shapes away (a rail, a fin, a
 *   lip) and its measure, a sum of squared distances to the planes about each corner, stops saying how far the
 *   outline moved. A level held under it switches in, by `pixels`, only where the whole model is still fifty pixels
 *   across or more. It holds the simplifier's own estimate of the error, not the surface measured: measured both
 *   ways against the finest over two of the owner's packs (the GPU port's pass 1, wave 7's review), 5 levels of 28
 *   moved the surface past it, by up to about 2.4 times, so what a level takes away can come to two or three of
 *   those pixels at its switch, which the owner's `madeBias` moves out.
 * - `keepShare`: a level is kept only if it has at most this share of the triangles of the level before it (a
 *   level that saves less is a second draw for a copy standing on the line and little else), and the chain ends at
 *   the first that does not.
 * - `minTris`: a model with fewer triangles in its exterior gets no levels. A card draws a few hundred triangles in
 *   the time it takes to begin one draw, and a copy standing at a level other than its neighbours' is a draw of its
 *   own: half of a model this small saves less than that draw costs.
 * - `normalWeight`, `uvWeight`: what a change in a corner's normal and in its first texture coordinate counts for
 *   against a change in its place (meshoptimizer's attribute weights, its place measured in the model's own size).
 *   A normal is a unit vector, for which meshoptimizer's own advice is about one; a texture coordinate runs over a
 *   picture's whole width in one unit and tiles past it on a wall, so it is weighted at half that, enough that a
 *   collapse which slides a picture over a face counts against it without holding a tiled wall at its finest.
 * - `rows`, `fovDeg`, `pixels`: the reference screen the switch distances are worked out for (1440 rows at the
 *   game's 60 degrees of view) and how many of its pixels a level's error may come to where it switches in.
 * - `nearFloor`: the nearest a made level switches in, metres: one that loses nothing the simplifier can measure
 *   (a flat wall's extra triangles) would otherwise switch at the eye, which the game's pick reads as "never".
 * - `weldGrid`: two corners of different pieces within this of each other (metres) stand on the border where the
 *   model is split into pieces (a material's edge), and are locked, so a level opens no crack between two pieces.
 */
export const MADE_LOD = Object.freeze({
  ratios: Object.freeze([1 / 2, 1 / 4, 1 / 8]),
  maxError: 0.02,
  keepShare: 0.8,
  minTris: 256,
  normalWeight: 1,
  uvWeight: 0.5,
  rows: 1440,
  fovDeg: 60,
  pixels: 1,
  nearFloor: 1,
  weldGrid: 1e-4,
});

/** Metres from the eye at which a level whose surface moved by `error` metres comes to `pixels` of the reference screen. */
export function switchNear(error, tune = MADE_LOD) {
  const pixelAngle = (2 * Math.tan((tune.fovDeg * Math.PI) / 360)) / tune.rows;
  const near = error / (tune.pixels * pixelAngle);
  return Math.max(tune.nearFloor, Number.isFinite(near) ? near : tune.nearFloor);
}

// ---------------------------------------------------------------------------------------------
// The GLB, read and written as the converter writes it (`glb.mjs`): a JSON chunk and one binary chunk.

/** A GLB's JSON and binary chunk. Throws on a file that is not one. */
export function readGlb(buf) {
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12);
  if (buf.toString('latin1', 16, 20) !== 'JSON') throw new Error('its first chunk is not JSON');
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  let bin = Buffer.alloc(0);
  const at = 20 + jsonLen;
  if (at + 8 <= buf.length && buf.toString('latin1', at + 4, at + 8) === 'BIN\0') {
    const len = buf.readUInt32LE(at);
    bin = buf.subarray(at + 8, at + 8 + len);
  }
  return { json, bin };
}

const align4 = (n) => (n + 3) & ~3;

/** A GLB of a JSON and a binary chunk, padded as `buildGlb` pads them. */
export function writeGlb(json, bin) {
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonPadded = align4(jsonBytes.length);
  const binPadded = align4(bin.length);
  const total = 12 + 8 + jsonPadded + (binPadded ? 8 + binPadded : 0);
  const out = Buffer.alloc(total);
  out.write('glTF', 0, 'latin1');
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonPadded, 12);
  out.write('JSON', 16, 'latin1');
  jsonBytes.copy(out, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonPadded);
  if (binPadded) {
    const at = 20 + jsonPadded;
    out.writeUInt32LE(binPadded, at);
    out.write('BIN\0', at + 4, 'latin1');
    bin.copy(out, at + 8);
  }
  return out;
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NORM_MAX = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

/** An accessor's values, tightly packed in a typed array of its own component type (`n` a vertex). */
export function readAccessor(json, bin, index) {
  const a = json.accessors?.[index];
  if (!a) throw new Error(`no accessor ${index}`);
  if (a.sparse) throw new Error('a sparse accessor');
  const n = COMPONENTS[a.type];
  const T = ARRAYS[a.componentType];
  if (!n || !T) throw new Error(`an accessor of ${a.type} ${a.componentType}`);
  const data = new T(a.count * n);
  if (a.bufferView === undefined) return { accessor: a, n, data };
  const v = json.bufferViews[a.bufferView];
  if ((v.buffer ?? 0) !== 0) throw new Error('a second buffer');
  const el = T.BYTES_PER_ELEMENT * n;
  const stride = v.byteStride ?? el;
  const base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Uint8Array(data.buffer);
  if (stride === el) out.set(bin.subarray(base, base + a.count * el));
  else for (let i = 0; i < a.count; i++) out.set(bin.subarray(base + i * stride, base + i * stride + el), i * el);
  return { accessor: a, n, data };
}

/** Values as floats: a normalised integer accessor as glTF reads it, any other cast. */
function asFloats(r) {
  if (r.data instanceof Float32Array) return r.data;
  const out = new Float32Array(r.data.length);
  const max = r.accessor.normalized ? NORM_MAX[r.accessor.componentType] : 0;
  for (let i = 0; i < out.length; i++) out[i] = max ? Math.max(-1, r.data[i] / max) : r.data[i];
  return out;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** Whether a node moves what it holds: a matrix or a turn, an offset or a size that is not nothing. */
function nodeMoves(node) {
  if (node.matrix && node.matrix.some((v, i) => Math.abs(v - IDENTITY[i]) > 1e-9)) return true;
  if (node.translation && node.translation.some((v) => Math.abs(v) > 1e-9)) return true;
  if (node.rotation && (Math.abs(node.rotation[3] - 1) > 1e-9 || node.rotation.slice(0, 3).some((v) => Math.abs(v) > 1e-9))) return true;
  if (node.scale && node.scale.some((v) => Math.abs(v - 1) > 1e-9)) return true;
  return false;
}

/** The room a node's name puts it in (`cell:<n>:<name>`, the nearest such name up the tree): -1 for none, 0 for a building's shell. */
function cellOf(json, parents, i) {
  for (let x = i; x !== undefined; x = parents.get(x)) {
    const m = /^cell:(\d+):/.exec(json.nodes[x]?.name ?? '');
    if (m) return Number(m[1]);
  }
  return -1;
}

/**
 * The pieces of a model's exterior, as its default scene draws them: every primitive of every mesh node under no
 * room (a portal building's shell, `cell:0:`, or a plain model's every piece), each with its attributes read and its
 * triangles as 32-bit indices. Throws with a reason the pass counts for a model it cannot make levels of.
 */
export function exteriorPieces(json, bin) {
  const scene = json.scenes?.[json.scene ?? 0];
  if (!scene) throw new Error('no default scene');
  const parents = new Map();
  for (let i = 0; i < (json.nodes ?? []).length; i++) for (const c of json.nodes[i].children ?? []) parents.set(c, i);
  const pieces = [];
  const walk = (i) => {
    const node = json.nodes[i];
    if (!node) return;
    if (node.mesh !== undefined && cellOf(json, parents, i) <= 0) {
      if (node.skin !== undefined) throw new Error('skinned');
      for (let x = i; x !== undefined; x = parents.get(x)) if (nodeMoves(json.nodes[x])) throw new Error("a piece placed by its node's own transform");
      const mesh = json.meshes[node.mesh];
      for (const prim of mesh.primitives ?? []) {
        if (prim.mode !== undefined && prim.mode !== 4) throw new Error('a piece that is not triangles');
        if (prim.attributes?.POSITION === undefined) throw new Error('a piece with no positions');
        const attrs = {};
        for (const [name, acc] of Object.entries(prim.attributes)) attrs[name] = readAccessor(json, bin, acc);
        if (!(attrs.POSITION.data instanceof Float32Array) || attrs.POSITION.n !== 3) throw new Error('positions that are not three floats');
        const count = attrs.POSITION.accessor.count;
        let indices;
        let indexType = 5125;
        if (prim.indices !== undefined) {
          const r = readAccessor(json, bin, prim.indices);
          indexType = r.accessor.componentType;
          indices = r.data instanceof Uint32Array ? r.data : Uint32Array.from(r.data);
        } else {
          indices = new Uint32Array(count);
          for (let k = 0; k < count; k++) indices[k] = k;
          indexType = count < 65536 ? 5123 : 5125;
        }
        if (indices.length % 3) throw new Error('an index count that is not whole triangles');
        pieces.push({ prim, attrs, count, indices, indexType });
      }
    }
    for (const c of node.children ?? []) walk(c);
  };
  for (const i of scene.nodes ?? []) walk(i);
  return pieces;
}

/**
 * Up to three lower levels of a model's exterior (`MADE_LOD`): each level `{ tris, prims, error, pieces }`, a piece
 * `{ source, indices }` naming the source piece and its kept triangles in that piece's own vertices. The whole
 * exterior is simplified as one mesh (every piece's corners in one list, so the error is the model's), with the
 * corners where two pieces meet locked, and split back by piece. `why` says why there are none.
 */
export function makeLevels(pieces, tune = MADE_LOD) {
  const total = pieces.reduce((a, p) => a + p.indices.length / 3, 0);
  if (!(total > 0)) return { levels: [], why: 'draws nothing outside its rooms', total, scale: 0 };
  if (total < tune.minTris) return { levels: [], why: `under ${tune.minTris} triangles`, total, scale: 0 };
  const vcount = pieces.reduce((a, p) => a + p.count, 0);
  const positions = new Float32Array(vcount * 3);
  const attrs = new Float32Array(vcount * 5);
  const lock = new Uint8Array(vcount);
  const owner = new Int32Array(vcount);
  const offsets = [];
  const indices = new Uint32Array(total * 3);
  let vAt = 0;
  let iAt = 0;
  // Where the model is split: a corner whose place another piece also has, to `weldGrid`.
  const seen = new Map();
  const g = tune.weldGrid;
  for (let p = 0; p < pieces.length; p++) {
    const piece = pieces[p];
    offsets.push(vAt);
    const pos = piece.attrs.POSITION.data;
    positions.set(pos, vAt * 3);
    const nrm = piece.attrs.NORMAL && piece.attrs.NORMAL.n === 3 ? asFloats(piece.attrs.NORMAL) : null;
    const uv = piece.attrs.TEXCOORD_0 && piece.attrs.TEXCOORD_0.n === 2 ? asFloats(piece.attrs.TEXCOORD_0) : null;
    for (let v = 0; v < piece.count; v++) {
      const o = (vAt + v) * 5;
      if (nrm) {
        attrs[o] = nrm[v * 3];
        attrs[o + 1] = nrm[v * 3 + 1];
        attrs[o + 2] = nrm[v * 3 + 2];
      }
      if (uv) {
        attrs[o + 3] = uv[v * 2];
        attrs[o + 4] = uv[v * 2 + 1];
      }
      owner[vAt + v] = p;
      const key = `${Math.round(pos[v * 3] / g)},${Math.round(pos[v * 3 + 1] / g)},${Math.round(pos[v * 3 + 2] / g)}`;
      const had = seen.get(key);
      if (had === undefined) seen.set(key, p);
      else if (had !== p) seen.set(key, -1);
    }
    for (let k = 0; k < piece.indices.length; k++) {
      const ix = piece.indices[k];
      if (ix >= piece.count) throw new Error('an index past its piece\'s corners');
      indices[iAt++] = vAt + ix;
    }
    vAt += piece.count;
  }
  if (pieces.length > 1) {
    for (let p = 0; p < pieces.length; p++) {
      const pos = pieces[p].attrs.POSITION.data;
      for (let v = 0; v < pieces[p].count; v++) {
        const key = `${Math.round(pos[v * 3] / g)},${Math.round(pos[v * 3 + 1] / g)},${Math.round(pos[v * 3 + 2] / g)}`;
        if (seen.get(key) === -1) lock[offsets[p] + v] = 1;
      }
    }
  }
  const ms = simplifier;
  if (!ms) throw new Error('the simplifier is not loaded (loadSimplifier)');
  const scale = ms.getScale(positions, 3);
  const most = tune.maxError * scale;
  const weights = [tune.normalWeight, tune.normalWeight, tune.normalWeight, tune.uvWeight, tune.uvWeight];
  const levels = [];
  let before = total;
  let why = null;
  for (const ratio of tune.ratios) {
    const target = Math.max(3, Math.floor(total * ratio) * 3);
    const [out, error] = ms.simplifyWithAttributes(indices, positions, 3, attrs, 5, weights, lock, target, most, ['ErrorAbsolute']);
    const tris = out.length / 3;
    if (!(tris > 0)) {
      why ??= 'its simplest level drew nothing';
      break;
    }
    if (!(error <= most)) {
      why ??= `a level's error past ${tune.maxError} of its size`;
      break;
    }
    if (tris > before * tune.keepShare) {
      why ??= levels.length ? null : `no level under ${tune.keepShare} of its triangles within ${tune.maxError} of its size`;
      break;
    }
    const byPiece = pieces.map(() => []);
    for (let k = 0; k < out.length; k += 3) {
      const p = owner[out[k]];
      const list = byPiece[p];
      list.push(out[k] - offsets[p], out[k + 1] - offsets[p], out[k + 2] - offsets[p]);
    }
    const kept = [];
    for (let p = 0; p < pieces.length; p++) if (byPiece[p].length) kept.push({ source: p, indices: Uint32Array.from(byPiece[p]) });
    levels.push({ tris, prims: kept.length, error, ratio, pieces: kept });
    before = tris;
  }
  return { levels, why: levels.length ? null : why, total, scale };
}

/**
 * The manifest's `lods` for the levels made: the finest first, as the client's rows are (`lodRanges`), each made row
 * marked `made` with its error in metres. A level no nearer than the coarser one after it is dropped (the coarser
 * draws as well from there), so the switches rise strictly; the lowest's far is the client's "no limit".
 */
export function madeRows(levels, finest, tune = MADE_LOD) {
  const round2 = (v) => Math.round(v * 100) / 100;
  const chain = [];
  for (const l of levels) {
    const near = round2(switchNear(l.error, tune));
    while (chain.length && chain[chain.length - 1].near >= near) chain.pop();
    chain.push({ level: l, near });
  }
  const rows = [{ level: 0, near: 0, far: chain.length ? chain[0].near : 1e9, tris: finest.tris, prims: finest.prims }];
  chain.forEach((c, i) => {
    rows.push({ level: i + 1, near: c.near, far: i + 1 < chain.length ? chain[i + 1].near : 1e9, tris: c.level.tris, prims: c.level.prims, made: true, error: Math.round(c.level.error * 1e5) / 1e5 });
  });
  return { rows, kept: chain.map((c) => c.level) };
}

/** The scene this pass writes its levels into, or null: a `lods` scene carrying the pass's mark. */
export function madeScene(json) {
  return (json.scenes ?? []).find((s) => s?.name === LOD_SCENE && s.extras?.swgMadeLods) ?? null;
}

/** Whether a GLB carries a `lods` scene of the converter's own (the client's levels), which this pass never touches. */
export function ownLodScene(json) {
  return (json.scenes ?? []).some((s) => s?.name === LOD_SCENE && !s.extras?.swgMadeLods);
}

/**
 * The file as it stood before this pass appended to it: the made scene and everything after the counts it recorded
 * taken off. A file with no made scene is handed back as it is.
 */
export function stripMade(json, bin) {
  const scene = madeScene(json);
  if (!scene) return { json, bin, stripped: false };
  const b = scene.extras.swgMadeLods.before;
  const out = { ...json };
  out.scenes = json.scenes.filter((s) => s !== scene);
  out.nodes = json.nodes.slice(0, b.nodes);
  out.meshes = json.meshes.slice(0, b.meshes);
  out.accessors = json.accessors.slice(0, b.accessors);
  out.bufferViews = json.bufferViews.slice(0, b.bufferViews);
  out.buffers = [{ ...json.buffers[0], byteLength: b.byteLength }];
  return { json: out, bin: bin.subarray(0, b.byteLength), stripped: true };
}

/**
 * The file with the made levels appended: per level a mesh and a node `lod:<n>` (`n` the row's level) with one
 * primitive per piece that kept triangles, carrying that piece's own attributes compacted to the corners it keeps,
 * its material and its index type, in a `lods` scene marked with where the pass began.
 */
export function appendLevels(json, bin, pieces, kept, rows) {
  const before = { nodes: json.nodes.length, meshes: json.meshes.length, accessors: (json.accessors ?? []).length, bufferViews: (json.bufferViews ?? []).length, byteLength: bin.length };
  const out = { ...json, nodes: [...json.nodes], meshes: [...json.meshes], accessors: [...(json.accessors ?? [])], bufferViews: [...(json.bufferViews ?? [])] };
  const chunks = [bin, Buffer.alloc(align4(bin.length) - bin.length)];
  let byteLength = align4(bin.length);
  const view = (bytes, target) => {
    out.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target });
    chunks.push(bytes, Buffer.alloc(align4(bytes.length) - bytes.length));
    byteLength += align4(bytes.length);
    return out.bufferViews.length - 1;
  };
  const accessor = (data, like, target, bounds) => {
    const n = COMPONENTS[like.type];
    const acc = { bufferView: view(Buffer.from(data.buffer, data.byteOffset, data.byteLength), target), componentType: like.componentType, count: data.length / n, type: like.type };
    if (like.normalized) acc.normalized = true;
    if (bounds) {
      const min = Array(n).fill(Infinity);
      const max = Array(n).fill(-Infinity);
      for (let i = 0; i < data.length; i++) {
        if (data[i] < min[i % n]) min[i % n] = data[i];
        if (data[i] > max[i % n]) max[i % n] = data[i];
      }
      acc.min = min;
      acc.max = max;
    }
    out.accessors.push(acc);
    return out.accessors.length - 1;
  };
  const roots = [];
  kept.forEach((level, k) => {
    const primitives = [];
    for (const lp of level.pieces) {
      const src = pieces[lp.source];
      // The corners this level keeps, in the order it first meets them.
      const remap = new Int32Array(src.count).fill(-1);
      const order = [];
      const idx = new Uint32Array(lp.indices.length);
      for (let i = 0; i < lp.indices.length; i++) {
        const v = lp.indices[i];
        if (remap[v] < 0) {
          remap[v] = order.length;
          order.push(v);
        }
        idx[i] = remap[v];
      }
      const attributes = {};
      for (const [name, r] of Object.entries(src.attrs)) {
        const T = r.data.constructor;
        const data = new T(order.length * r.n);
        for (let j = 0; j < order.length; j++) for (let c = 0; c < r.n; c++) data[j * r.n + c] = r.data[order[j] * r.n + c];
        attributes[name] = accessor(data, r.accessor, 34962, name === 'POSITION');
      }
      const T = src.indexType === 5121 && order.length <= 256 ? Uint8Array : src.indexType === 5123 ? Uint16Array : Uint32Array;
      const indexType = T === Uint8Array ? 5121 : T === Uint16Array ? 5123 : 5125;
      const prim = { attributes, indices: accessor(T.from(idx), { type: 'SCALAR', componentType: indexType }, 34963, false), mode: 4 };
      if (src.prim.material !== undefined) prim.material = src.prim.material;
      primitives.push(prim);
    }
    const name = lodNodeName(rows[k + 1].level);
    out.meshes.push({ name, primitives });
    out.nodes.push({ name, mesh: out.meshes.length - 1 });
    roots.push(out.nodes.length - 1);
  });
  out.scenes = [...json.scenes, { name: LOD_SCENE, nodes: roots, extras: { swgMadeLods: { format: MADE_LOD_FORMAT, before } } }];
  out.buffers = [{ ...(json.buffers?.[0] ?? {}), byteLength }];
  return { json: out, bin: Buffer.concat(chunks, byteLength) };
}

// ---------------------------------------------------------------------------------------------
// A pack.

/** The model categories a pack's levels are drawn from: the placed objects and the planted flora (the gallery's houses are its `layout`). */
export const MADE_LOD_CATEGORIES = ['layout', 'flora'];

/** Whether a manifest entry carries levels the client made (any lower row that is not this pass's). */
function hasOwnLevels(def) {
  return Array.isArray(def.lods) && def.lods.length > 1 && def.lods.slice(1).some((r) => !r.made);
}

/** Whether a manifest entry's levels are this pass's. */
export function hasMadeLevels(def) {
  return Array.isArray(def.lods) && def.lods.length > 1 && def.lods.slice(1).every((r) => r.made);
}

/** A pack's model files the pass looks at: every GLB an entry of the drawn categories names, with every entry naming it. */
export function packModels(manifest) {
  const byFile = new Map();
  for (const cat of MADE_LOD_CATEGORIES) {
    for (const def of manifest.categories?.[cat] ?? []) {
      if (!def || typeof def.file !== 'string' || !/\.glb$/i.test(def.file) || def.failed) continue;
      let list = byFile.get(def.file);
      if (!list) byFile.set(def.file, (list = []));
      list.push(def);
    }
  }
  return byFile;
}

/**
 * The key a pack's stamp holds: every model file the pass considers (none of whose entries carries the client's own
 * levels), by its name and its size on disk, so a file written again (a snapshot, travel or the fittings adding a
 * model) is a pack to look at again. Null for a pack with no manifest.
 */
export function madeLodsKey(packDir, manifest) {
  if (!manifest) return null;
  const lines = [];
  for (const [file, defs] of packModels(manifest)) {
    if (defs.some(hasOwnLevels)) continue;
    const path = join(packDir, file);
    lines.push(`${file}\t${existsSync(path) ? statSync(path).size : -1}`);
  }
  lines.sort();
  return createHash('sha1').update(lines.join('\n')).digest('hex').slice(0, 16);
}

/**
 * Whether the pass works on a pack: one whose manifest the snapshot or the gallery stamped with the client's own levels
 * (`lodFormat`), which is every pack the game draws placed models and plants from at their levels. A space zone's pack
 * and an older pack are not (the second is asked for its snapshot first).
 */
export function madeLodsPack(manifest) {
  return !!manifest && typeof manifest.lodFormat === 'number' && !!manifest.categories && typeof manifest.categories === 'object';
}

/**
 * Why `status` should ask for the pass on a pack, or null: never run there, run at another format, or the models it
 * looked at have changed since (its key). A pack with no model file to look at is never asked about.
 */
export function madeLodsAsk(packDir, manifest, label) {
  if (!madeLodsPack(manifest)) return null;
  const any = [...packModels(manifest).values()].some((defs) => !defs.some(hasOwnLevels));
  if (!any) return null;
  const stamp = manifest.madeLods;
  if (!stamp) return `${label}'s models with no levels of their own have had none made (every copy drawn at its finest at any distance)`;
  if (stamp.format !== MADE_LOD_FORMAT) return `${label}'s made levels are of another format (${stamp.format}, this converter makes ${MADE_LOD_FORMAT})`;
  if (stamp.key !== madeLodsKey(packDir, manifest)) return `${label}'s models have changed since its levels were made`;
  return null;
}

/**
 * Make the levels a pack's models lack, in place: each model file read, put back to what it was before any earlier
 * run if that run's rows are gone, given its levels, written beside itself and renamed over its name, then the
 * manifest's entries and its stamp written last. `dryRun` reads and makes everything and writes nothing. Answers the
 * counts the command prints.
 */
export function madeLodsForPack(packDir, { tune = MADE_LOD, dryRun = false, log = () => {} } = {}) {
  const manifestPath = join(packDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const counts = { files: 0, own: 0, already: 0, made: 0, levels: 0, none: 0, refused: 0, restored: 0, missing: 0, trisBefore: 0, trisAfter: 0, why: {}, ms: 0 };
  const t0 = Date.now();
  const writes = [];
  for (const [file, defs] of packModels(manifest)) {
    counts.files++;
    if (defs.some(hasOwnLevels)) {
      counts.own++;
      continue;
    }
    if (defs.every(hasMadeLevels)) {
      counts.already++;
      continue;
    }
    const path = join(packDir, file);
    if (!existsSync(path)) {
      counts.missing++;
      continue;
    }
    let glb;
    try {
      glb = readGlb(readFileSync(path));
    } catch (err) {
      counts.refused++;
      counts.why[err.message] = (counts.why[err.message] ?? 0) + 1;
      continue;
    }
    // An earlier run's work whose rows are gone: back to the file as it was, then made again.
    const back = stripMade(glb.json, glb.bin);
    if (back.stripped) counts.restored++;
    if (ownLodScene(back.json)) {
      counts.refused++;
      counts.why['a lods scene of its own the manifest does not name'] = (counts.why['a lods scene of its own the manifest does not name'] ?? 0) + 1;
      continue;
    }
    let made;
    let pieces;
    try {
      pieces = exteriorPieces(back.json, back.bin);
      made = makeLevels(pieces, tune);
    } catch (err) {
      counts.refused++;
      counts.why[err.message] = (counts.why[err.message] ?? 0) + 1;
      continue;
    }
    const finest = { tris: made.total, prims: pieces?.length ?? 0 };
    const { rows, kept } = madeRows(made.levels, finest, tune);
    counts.trisBefore += made.total;
    if (!kept.length) {
      counts.none++;
      const why = made.why ?? 'no level kept';
      counts.why[why] = (counts.why[why] ?? 0) + 1;
      // A file an earlier run appended to is written back as it was.
      if (back.stripped) writes.push({ path, bytes: writeGlb(back.json, back.bin) });
      for (const def of defs) if (hasMadeLevels(def)) delete def.lods;
      counts.trisAfter += made.total;
      continue;
    }
    const next = appendLevels(back.json, back.bin, pieces, kept, rows);
    writes.push({ path, bytes: writeGlb(next.json, next.bin) });
    for (const def of defs) def.lods = rows.map((r) => ({ ...r }));
    counts.made++;
    counts.levels += kept.length;
    counts.trisAfter += kept[kept.length - 1].tris;
    log(`  ${file}: ${made.total} triangles, levels ${rows.slice(1).map((r) => `${r.level}@${r.near}m ${r.tris}t/${r.prims}p e${(r.error * 1000).toFixed(1)}mm`).join(' ')}`);
  }
  if (!dryRun) {
    for (const w of writes) {
      const tmp = `${w.path}.lods-tmp`;
      writeFileSync(tmp, w.bytes);
      renameSync(tmp, w.path);
    }
    // The stamp says what the pack holds, never what this run did, so a second run writes the very bytes the first did.
    let made = 0;
    let levels = 0;
    for (const defs of packModels(manifest).values()) {
      if (!defs.every(hasMadeLevels)) continue;
      made++;
      levels += defs[0].lods.length - 1;
    }
    manifest.madeLods = { format: MADE_LOD_FORMAT, key: madeLodsKey(packDir, manifest), made, levels };
    const text = JSON.stringify(manifest, null, 2);
    if (text !== readFileSync(manifestPath, 'utf8')) {
      const tmp = `${manifestPath}.lods-tmp`;
      writeFileSync(tmp, text);
      renameSync(tmp, manifestPath);
    }
  }
  counts.ms = Date.now() - t0;
  return counts;
}

/** The made levels a manifest entry carries, as the lower rows' level numbers: what `lodLevelOfName` reads off their nodes. */
export function madeLevelNumbers(def) {
  return hasMadeLevels(def) ? def.lods.slice(1).map((r) => r.level) : [];
}

export { lodLevelOfName };
