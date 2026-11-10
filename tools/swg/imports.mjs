// Your own models, made into the pack format the game already reads (Map-maker II's tenth wave): `npm run swg -- import
// <in> [<out>] [--ship]`. A command of the `library` kind: it reads no archive, takes no `<swg-dir>`, and `status` lists
// what it made and never asks for it. Node 22, no dependency; it imports only `tools/swg/` modules and node's own, so the
// release's import check has nothing new to carry.
//
// **What it reads**: a `.glb`, or a `.gltf` with its `.bin` and its pictures beside it, as Blender's glTF 2.0 exporter
// writes them at its defaults (+Y up, metres, front +Z, every object a node with its own place, turn and size). Nothing
// below is Blender's alone: a glTF from any tool that keeps the names of the table in tools/swg/README.md reads the same.
// Beside each source a small record of the owner's (`<stem>.import.json`): the model's stable id, its kind, where its
// lower levels take over, how it collides, its look, the game's pictures it borrows and whether it may ship. A source
// with none is given one, written beside it, with every default.
//
// **What it writes**, into the folder it is given (`imports-private/` by default, git-ignored and served by the dev server
// alone; `public/imports/` with `--ship`, which every build carries): `<id>.<hash8>.glb` (a content hash in the name, so a
// new import is never answered from a browser's cache), `manifest.json` (`planet: 'imported'`, the models filed under
// `layout` or `flora`, the leaf `cards`), `flora-collision.json` (a flora model's own shapes), `icons/<id>.<hash8>.png` (its
// picture, drawn by the converter's own rasteriser) and `imports.json` (the library's entries and each model's notes).
// A model already there under the same id is replaced and its old files swept; every other model in the folder is kept.
//
// **What the game asks of a model, and what an export gets wrong** (DESIGN.md §2.12, research6): the game reads a mesh's
// own vertices and never a node's transform, so **every node's matrix is baked into its vertices** (normals by the inverse
// transpose, the winding turned where the matrix mirrors) and a linked duplicate is baked once a node; it is **never
// mirrored** (the converter mirrors only because the client was left-handed); every material is made single-sided unless
// the record asks, named for its import (`<id>:<name>`, so the session's tables keyed by a material's name never meet
// another import's), stripped of the physical extensions (a transmissive one becomes a blended pane, which casts nothing),
// marked `unlit` beside the glTF unlit extension and `noShadow` on every blend, `swgCube` only where metallic, and
// `swgNormalY: -1` wherever a normal map has no tangents under it (they are dropped, so everywhere): three's own reading of
// a glTF normal map, which the world's own override would otherwise turn upside down. Tangents, shape keys, skins,
// animations, cameras and lights are dropped and said (a house's lamps are read as its rooms' lights). Draco, meshopt,
// KTX2 and GPU instancing are refused in words, as is a room's name that does not read as one and a cell name beginning
// with a digit.
//
// **Names on Blender's objects** (a node's name, a `.001` Blender adds left out; a custom property `role`, `lod` or
// `shape` on the object overrides each):
//   anything                    drawn and collided, every triangle
//   <name>-colonly              collider only, never drawn (`extras.swgColliderOnly` on its material)
//   <name>-nocol                drawn, never collided (`extras.swgNoCollide`)
//   <name>_LOD1 .. _LOD3        a lower level, taking over at the record's distance
//   collision-cyl, -box, -ball  a flora model's own shapes, into flora-collision.json (never drawn)
//   cell:<n>:<name>, portal:<a>:<b>, floor:<n>, door:<style>, and point lights
//                               a house's rooms (the eleventh wave, `importRooms.mjs`, which says what each means): the
//                               GLB's level-0 nodes become `cell:<n>:<name>`, the manifest's entry carries `cells` and
//                               `portals`, and the folder `floors.json` and `doors.json` beside its manifest
//
// **Committing** (§2.12): the repository is public and its history permanent. `--ship` is the owner's act of shipping: it
// refuses an import whose pictures or materials are named like the client's (`texture/`, `shader/`, `.dds`, `.sht`) and one
// whose record does not say `"ship": true`, which is the owner's word that he has looked. A committed model wears the
// game's own pictures only by naming them (`borrow`), for each player's install to supply at run time.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { buildGlb, readGlb, shrinkRgba } from './sceneglb.mjs';
import { decodePng, encodePng } from './png.mjs';
import { LIBRARY_PASS, pictureOf } from './library.mjs';
import { deriveRooms, namesRooms, roomName } from './importRooms.mjs';
import { FLOOR_PACK_VERSION } from './flr.mjs';
import { DOORS_PACK_VERSION } from './doors.mjs';

/** The shape of `manifest.json` and `imports.json` this writes; the game reads the manifest as any pack's. */
export const IMPORT_FORMAT = 1;

/**
 * The pass's own numbers, all ours, none chosen by measuring. **They are this command's flags** (`IMPORT_FLAGS`), printed by
 * every run, and never live in the game: what a model is made of is decided once, here, and every browser reads the file.
 */
export const IMPORT_TUNE = {
  /**
   * The collided triangles a model may have before the pass asks for a `-colonly` stand-in: about 5 ms of collider build as
   * the player walks up to it (research6 measured 28 ms for 56,000 triangles and 106 ms for 200,000). A note, never a wall.
   */
  collisionBudget: 10000,
  /** A picture's longer side past which it is shrunk where the pass can read it (an 8-bit PNG), else noted: the game's own cap. */
  texMax: 2048,
  /** Megabytes a model may come to before it is noted. */
  modelMax: 16,
  /** Megabytes the shipped folder may come to before it is noted: it rides in every release. */
  shipNote: 200,
  /** How much of a wholly transmissive pane is drawn (it becomes a blended pane at this alpha): glass you can still see is there. */
  glassAlpha: 0.25,
  /** Metres at which `_LOD1`, `_LOD2` and `_LOD3` take over where the record names none: a hut's worth of detail at each. */
  lods: [40, 120, 300],
  /** The client's highlight's power from a roughness of nought (`look: 'client'`); a roughness of one gives none. */
  specPowerMost: 128,
  /**
   * Metres a room's box grows by on every side, past its own pieces, floor and doorways (the eleventh wave): five
   * centimetres, so a box laid exactly on a wall's face, rounded to the manifest's tenth of a millimetre, never leaves a
   * point on that face outside it. Every reader of a room's box pads it again for its own purpose.
   */
  cellPad: 0.05,
  /** Metres a doorway's corner may stand off its own plane before the doorway is refused as not flat: a slip of a vertex, never a bent polygon. */
  portalFlat: 0.05,
  /** Metres a `door:<style>` may stand from the nearest doorway and still be its door: its bottom middle, give or take a hand's breadth. */
  doorReach: 1,
  /** Metres a room's point light reaches where its file names no range (glTF's own reading of none is "for ever", which a room's light never is): a room's width and some. */
  lightReach: 20,
  /** Each room light's brightness times this: glTF's candela as three reads them, the owner's dial on how bright his lamps read beside the game's own rooms. */
  lightScale: 1,
};

/** The flags that move `IMPORT_TUNE` for one run, by their key there. */
export const IMPORT_FLAGS = { 'collision-budget': 'collisionBudget', 'tex-max': 'texMax', 'model-max': 'modelMax', 'ship-note': 'shipNote', 'glass-alpha': 'glassAlpha', lods: 'lods', 'spec-power': 'specPowerMost', 'cell-pad': 'cellPad', 'portal-flat': 'portalFlat', 'door-reach': 'doorReach', 'light-reach': 'lightReach', 'light-scale': 'lightScale' };
/** The flags nought is a good value of (a room's box grown by nothing); every other is above nought. */
const ZERO_OK = new Set(['cellPad']);

/** GitHub refuses a file past this many megabytes: the one hard wall, a fact of the host and no tune. */
export const HARD_WALL_MB = 100;
/** And warns past this many. */
const WARN_MB = 50;

/** The kinds a record may say: a prop, a building (with rooms, or with none), or a tree, a shrub, a rock. */
export const IMPORT_KINDS = ['prop', 'building', 'flora'];
/**
 * How a model collides: `auto` is `stand-in` where any `-colonly` piece is named, else `triangles` (in a house with rooms,
 * room by room and the shell on its own, written `by room` where they differ); `triangles` every drawn triangle not
 * `-nocol` and every `-colonly` piece; `stand-in` its `-colonly` pieces alone; `none` nothing at all.
 */
export const COLLISION_RULES = ['auto', 'triangles', 'stand-in', 'none'];
/** A model's look: three's own highlight as authored (`pbr`), or the client's (`client`) from its roughness. */
export const IMPORT_LOOKS = ['pbr', 'client'];

/** An import's id: lower-case words, digits and underscores, starting with a letter or a digit (a file name and a model id). */
const ID = /^[a-z0-9][a-z0-9_]{0,47}$/;
/** A borrowed picture or material, as a row's look names one (`src/story/placements.ts`'s `DONOR`). */
const DONOR = /^([a-z0-9_]{1,40}):([A-Za-z0-9_.-]{1,96})\/(.+)$/;
const TINT = /^#[0-9a-fA-F]{6}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
/**
 * The run-time reader's own limits on a model's looks (`src/story/placements.ts`'s `PLACEMENT_LIMITS.looks` and
 * `.material`, which a test holds these equal to): past either, `readLooks` drops the model's whole list and its borrowed
 * pictures vanish in the game with nothing said, so the pass refuses such a model in words (`looksRefusal`).
 */
export const LOOK_LIMITS = { looks: 64, material: 120 };

/** Whether a borrowed picture's or material's name reads as the game reads one (`parseDonor`): its shape, its material's length, no control character. */
function donorReads(ref) {
  const m = typeof ref === 'string' ? DONOR.exec(ref) : null;
  return !!m && m[3].length <= LOOK_LIMITS.material && !CONTROL.test(m[3]);
}
/** What a name looks like when it is the client's own: its folders and its two file kinds. */
const CLIENTISH = /(^|[\\/])(texture|shader)[\\/]|\.dds\b|\.sht\b/i;

/** The extensions this pass refuses outright, each with its words. */
const REFUSED = {
  KHR_draco_mesh_compression: 'Draco compression (export with "Compression" off)',
  EXT_meshopt_compression: 'meshopt compression',
  KHR_texture_basisu: 'KTX2 pictures',
  EXT_mesh_gpu_instancing: 'GPU instancing (export with "GPU Instances" off, so each copy is a node of its own)',
};
/** The material extensions kept as they are: three reads them as the glTF means them. */
const KEPT_MATERIAL = new Set(['KHR_materials_unlit', 'KHR_materials_emissive_strength']);
/** The extensions read and turned into something else, or dropped with a note, that a file may require. */
const UNDERSTOOD = new Set([...KEPT_MATERIAL, 'KHR_texture_transform', 'KHR_mesh_quantization', 'KHR_lights_punctual', 'EXT_texture_webp', 'EXT_texture_avif', 'KHR_materials_transmission', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_clearcoat', 'KHR_materials_sheen', 'KHR_materials_volume', 'KHR_materials_iridescence', 'KHR_materials_anisotropy', 'KHR_materials_dispersion', 'KHR_materials_variants', 'KHR_materials_pbrSpecularGlossiness']);

// ---- the record ----------------------------------------------------------------------------------------------------

/** An id made from a file's stem: lower-cased, every other character an underscore, held to the rule. */
export function idOfStem(stem) {
  let id = String(stem ?? '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  if (!id) return 'model';
  if (!/^[a-z0-9]/.test(id)) id = `m${id}`.slice(0, 48);
  return ID.test(id) ? id : 'model';
}

/** The record a source is given when it has none: every default, its id from its file's name. */
export function defaultRecord(stem) {
  return { id: idOfStem(stem), name: String(stem ?? '').replace(/[_-]+/g, ' ').trim() || idOfStem(stem), kind: 'prop', group: 'mine', collision: 'auto', look: 'pbr', ship: false };
}

/**
 * A record read and checked, or why not in words. Unknown fields are kept (a licence, a credit, anything the owner writes)
 * and never read; a field of the wrong shape refuses the record, since a typo here would ship a model wrong.
 */
export function readRecord(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the record is not an object';
  const r = { ...v };
  if (typeof r.id !== 'string' || !ID.test(r.id)) return 'its id is lower-case words, digits and underscores (48 at most, starting with a letter or a digit)';
  if (r.name !== undefined && (typeof r.name !== 'string' || r.name.length > 80)) return 'its name is words of 80 characters at most';
  if (r.group !== undefined && (typeof r.group !== 'string' || !/^[A-Za-z0-9 _-]{1,40}$/.test(r.group))) return 'its group is a word or two (40 characters at most)';
  if (r.kind !== undefined && !IMPORT_KINDS.includes(r.kind)) return `its kind is ${IMPORT_KINDS.join(', ')}`;
  if (r.collision !== undefined && !COLLISION_RULES.includes(r.collision)) return `its collision is ${COLLISION_RULES.join(', ')}`;
  if (r.look !== undefined && !IMPORT_LOOKS.includes(r.look)) return `its look is ${IMPORT_LOOKS.join(' or ')}`;
  if (r.ship !== undefined && typeof r.ship !== 'boolean') return 'its ship is true or false';
  if (r.lods !== undefined) {
    if (!Array.isArray(r.lods) || r.lods.length < 1 || r.lods.length > 3 || !r.lods.every((d) => typeof d === 'number' && Number.isFinite(d) && d > 0)) return 'its lods are one to three distances in metres, each above nought';
    for (let i = 1; i < r.lods.length; i++) if (!(r.lods[i] > r.lods[i - 1])) return 'its lods rise: each level takes over further out than the one before';
  }
  if (r.doubleSided !== undefined && r.doubleSided !== true && !(Array.isArray(r.doubleSided) && r.doubleSided.every((n) => typeof n === 'string'))) return 'its doubleSided is true or a list of material names';
  if (r.borrow !== undefined) {
    if (!r.borrow || typeof r.borrow !== 'object' || Array.isArray(r.borrow)) return 'its borrow is an object of material names';
    for (const [name, b] of Object.entries(r.borrow)) {
      const why = borrowWhy(b);
      if (why) return `its borrow for ${name} ${why}`;
    }
  }
  return r;
}

/** Why a borrow is of no shape a row's look takes, or null: a tint, a picture or both, or a material alone (`<pack>:<model>/<material>`). */
function borrowWhy(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return 'is an object ({ map }, { like } or { tint })';
  for (const k of Object.keys(b)) if (k !== 'tint' && k !== 'map' && k !== 'like') return `names ${k}, which is none of map, like or tint`;
  const donorWords = `as <pack>:<model>/<material> (its material ${LOOK_LIMITS.material} characters at most)`;
  if (b.like !== undefined) return b.tint !== undefined || b.map !== undefined ? 'takes a material alone (like), with no tint or picture beside it' : donorReads(b.like) ? null : `names its material ${donorWords}`;
  if (b.tint === undefined && b.map === undefined) return 'names a tint, a picture or a material';
  if (b.tint !== undefined && !(typeof b.tint === 'string' && TINT.test(b.tint))) return 'tints by #rrggbb';
  if (b.map !== undefined && !donorReads(b.map)) return `names its picture ${donorWords}`;
  return null;
}

/**
 * Why a model's own looks (its record's borrows, by its material's name in the made model) would not read in the game, or
 * null: `readLooks` drops the whole list past `LOOK_LIMITS.looks` entries or for a material named past `LOOK_LIMITS.material`
 * characters or holding a control character, and a model imported so would stand with every borrowed look gone.
 */
export function looksRefusal(looks) {
  if (looks.length > LOOK_LIMITS.looks) return `its record's borrows come to ${looks.length} looks, past the ${LOOK_LIMITS.looks} a model carries (a material drawn and never collided counts twice): borrow for fewer materials`;
  for (const l of looks) {
    if (l.of.length > LOOK_LIMITS.material || CONTROL.test(l.of)) return `the material ${JSON.stringify(l.of)} is named past ${LOOK_LIMITS.material} characters (or holds a control character), which a look cannot name: give it a shorter name in Blender`;
  }
  return null;
}

/** The record beside a source (`<stem>.import.json`), read; or a fresh one when there is none, and whether it was made. */
export function recordFor(file) {
  const stem = basename(file).replace(/\.(glb|gltf)$/i, '');
  const path = join(dirname(file), `${stem}.import.json`);
  if (!existsSync(path)) return { record: defaultRecord(stem), path, made: true };
  let v;
  try {
    v = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return { refuse: `${path} does not read: ${err instanceof Error ? err.message : String(err)}`, path };
  }
  const r = readRecord(v);
  return typeof r === 'string' ? { refuse: `${path}: ${r}`, path } : { record: r, path, made: false };
}

// ---- reading a glTF ------------------------------------------------------------------------------------------------

/** A glTF read: its document, its buffers' bytes and where it came from. Pictures stay where the document names them. */
export function readSource(file) {
  const ext = extname(file).toLowerCase();
  const dir = dirname(file);
  const bytes = readFileSync(file);
  let json;
  let glbBin = null;
  if (ext === '.glb') {
    const g = readGlb(bytes);
    json = g.json;
    glbBin = g.bin;
  } else if (ext === '.gltf') json = JSON.parse(bytes.toString('utf8'));
  else throw new Error(`${file} is neither a .glb nor a .gltf`);
  const uriBytes = (uri) => {
    const data = /^data:[^;,]*(;base64)?,(.*)$/s.exec(uri);
    if (data) return data[1] ? Buffer.from(data[2], 'base64') : Buffer.from(decodeURIComponent(data[2]), 'utf8');
    return readFileSync(join(dir, decodeURIComponent(uri)));
  };
  const buffers = (json.buffers ?? []).map((b, i) => (b.uri ? uriBytes(b.uri) : i === 0 && glbBin ? glbBin : Buffer.alloc(b.byteLength ?? 0)));
  return { json, buffers, uriBytes, file };
}

/** The bytes a buffer view holds. */
function viewBytes(src, index) {
  const bv = src.json.bufferViews?.[index];
  if (!bv) throw new Error(`a buffer view ${index} that is not there`);
  const buf = src.buffers[bv.buffer ?? 0];
  return buf.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
}

const COMP = {
  5120: { bytes: 1, get: 'getInt8', max: 127 },
  5121: { bytes: 1, get: 'getUint8', max: 255 },
  5122: { bytes: 2, get: 'getInt16', max: 32767 },
  5123: { bytes: 2, get: 'getUint16', max: 65535 },
  5125: { bytes: 4, get: 'getUint32', max: 0 },
  5126: { bytes: 4, get: 'getFloat32', max: 0 },
};
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/**
 * An accessor's values as plain numbers (a normalised integer taken to its glTF meaning, -1..1 or 0..1), strides followed,
 * a sparse one's substitutions laid over its base. Answers the values and how many numbers make one element.
 */
export function accessorValues(src, index) {
  const a = src.json.accessors?.[index];
  if (!a) throw new Error(`an accessor ${index} that is not there`);
  const c = COMP[a.componentType];
  const size = SIZE[a.type];
  if (!c || !size) throw new Error(`an accessor of a kind this pass cannot read (${a.componentType} ${a.type})`);
  const out = new Float64Array(a.count * size);
  const read = (bytes, start, stride, count, into, at) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < size; k++) {
        let v = dv[c.get](start + i * stride + k * c.bytes, true);
        if (a.normalized && c.max) v = Math.max(v / c.max, -1);
        into[(at(i)) * size + k] = v;
      }
    }
  };
  if (a.bufferView !== undefined) {
    const bv = src.json.bufferViews[a.bufferView];
    read(viewBytes(src, a.bufferView), a.byteOffset ?? 0, bv.byteStride ?? size * c.bytes, a.count, out, (i) => i);
  }
  if (a.sparse) {
    const s = a.sparse;
    const ic = COMP[s.indices.componentType];
    const ib = viewBytes(src, s.indices.bufferView);
    const idv = new DataView(ib.buffer, ib.byteOffset, ib.byteLength);
    const at = [];
    for (let i = 0; i < s.count; i++) at.push(idv[ic.get]((s.indices.byteOffset ?? 0) + i * ic.bytes, true));
    read(viewBytes(src, s.values.bufferView), s.values.byteOffset ?? 0, size * c.bytes, s.count, out, (i) => at[i]);
  }
  return { values: out, size, count: a.count };
}

// ---- matrices --------------------------------------------------------------------------------------------------------

/** A node's own matrix, column-major (its `matrix`, else its translation, rotation and scale). */
export function nodeMatrix(n) {
  if (Array.isArray(n.matrix) && n.matrix.length === 16) return n.matrix.slice();
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0, 2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}

/** Two column-major 4x4 matrices multiplied. */
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A matrix's upper 3x3: its determinant, and its inverse transposed (what a normal is carried by), row-major 3x3. */
function normalMatrixOf(m) {
  const a = m[0], b = m[4], c = m[8];
  const d = m[1], e = m[5], f = m[9];
  const g = m[2], h = m[6], i = m[10];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const k = Math.abs(det) > 1e-20 ? 1 / det : 0;
  // The inverse's transpose is the cofactor matrix over the determinant.
  const n = [(e * i - f * h) * k, -(d * i - f * g) * k, (d * h - e * g) * k, -(b * i - c * h) * k, (a * i - c * g) * k, -(a * h - b * g) * k, (b * f - c * e) * k, -(a * f - c * d) * k, (a * e - b * d) * k];
  return { det, n };
}

// ---- names -----------------------------------------------------------------------------------------------------------

/**
 * What a node is, by its name (Blender's `.001` left out) and its custom properties: drawn (`draw`), a collider only
 * (`colonly`), drawn and never collided (`nocol`) or a flora shape (`shape`: `cyl`, `box`, `ball`), and its level (0 the
 * model's own, 1 to 3 a lower one). A property `role`, `lod` or `shape` overrides what the name says.
 */
export function nameRole(rawName, extras = null) {
  let name = String(rawName ?? '').replace(/\.\d{3}$/, '');
  let role = 'draw';
  let level = 0;
  let shape = null;
  let badLevel = null;
  const s = /^collision-(cyl|box|ball)(?:$|[-_. ])/i.exec(name);
  if (s) {
    role = 'shape';
    shape = s[1].toLowerCase();
  } else {
    for (let changed = true; changed; ) {
      changed = false;
      const lod = /_LOD(\d+)$/i.exec(name);
      if (lod) {
        const n = Number(lod[1]);
        if (n > 3) badLevel = n;
        else level = n;
        name = name.slice(0, -lod[0].length);
        changed = true;
      }
      if (/-colonly$/i.test(name)) {
        role = 'colonly';
        name = name.slice(0, -'-colonly'.length);
        changed = true;
      } else if (/-nocol$/i.test(name)) {
        role = 'nocol';
        name = name.slice(0, -'-nocol'.length);
        changed = true;
      }
    }
  }
  const x = extras && typeof extras === 'object' ? extras : null;
  if (x) {
    if (x.role === 'draw' || x.role === 'colonly' || x.role === 'nocol') role = x.role;
    if (typeof x.lod === 'number' && Number.isInteger(x.lod) && x.lod >= 0 && x.lod <= 3) level = x.lod;
    if (x.shape === 'cyl' || x.shape === 'box' || x.shape === 'ball') {
      role = 'shape';
      shape = x.shape;
    }
  }
  return { role, level, shape, base: name, badLevel };
}

/**
 * A room's own fill light off its `cell:` object's custom property `ambient` (three numbers from 0 to 4, linear red, green
 * and blue): the numbers, null for none, false for a property of another shape (said, and left out).
 */
function ambientOf(extras) {
  const a = extras && typeof extras === 'object' ? extras.ambient : undefined;
  if (a === undefined) return null;
  return Array.isArray(a) && a.length === 3 && a.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 4) ? a.slice() : false;
}

/**
 * Why a node's name refuses the whole import, or null: a name that begins as a room's (`cell:`, `portal:`, `floor:`,
 * `door:`) and does not read as one, a cell whose own name begins with a digit among them (`roomName`, `importRooms.mjs`).
 * A room's name that reads is a house's rooms (the eleventh wave), never a refusal.
 */
export function roomRefusal(name) {
  const r = roomName(name);
  return r?.kind === 'bad' ? r.why : null;
}

/** Whether a name looks like the client's own (`texture/`, `shader/`, `.dds`, `.sht`): what `--ship` refuses. */
export function looksClientish(name) {
  return typeof name === 'string' && CLIENTISH.test(name);
}

// ---- the bake --------------------------------------------------------------------------------------------------------

/** A primitive's triangles as a list of corner indices, from a list, a strip or a fan; null for lines and points. */
function trianglesOf(mode, idx, count) {
  const at = (i) => (idx ? idx[i] : i);
  const m = mode ?? 4;
  if (m === 4) {
    const out = new Uint32Array(count - (count % 3));
    for (let i = 0; i < out.length; i++) out[i] = at(i);
    return out;
  }
  if (m === 5 || m === 6) {
    const out = [];
    for (let i = 0; i + 2 < count; i++) {
      if (m === 5) {
        if (i % 2 === 0) out.push(at(i), at(i + 1), at(i + 2));
        else out.push(at(i + 1), at(i), at(i + 2));
      } else out.push(at(0), at(i + 1), at(i + 2));
    }
    return Uint32Array.from(out);
  }
  return null;
}

/** Smooth normals for a primitive with none: each corner's the sum of its triangles' areas' normals. */
function computeNormals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      n[k] += nx;
      n[k + 1] += ny;
      n[k + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.sqrt(n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

/**
 * One primitive of one node baked: its positions through the node's whole matrix, its normals through the matrix's inverse
 * transposed and made unit again, its winding turned where the matrix mirrors, its coordinate sets and colours kept (a
 * colour of three made four), its triangles listed. Tangents, joints, weights and shape keys are left behind. Null for a
 * primitive of lines or points.
 */
function bakePrimitive(src, prim, m, notes) {
  const attrs = prim.attributes ?? {};
  if (attrs.POSITION === undefined) return null;
  const p = accessorValues(src, attrs.POSITION);
  const count = p.count;
  const idx = prim.indices !== undefined ? accessorValues(src, prim.indices).values : null;
  const tris = trianglesOf(prim.mode, idx, idx ? idx.length : count);
  if (!tris) {
    notes.lines++;
    return null;
  }
  if ((prim.mode ?? 4) !== 4) notes.strips++;
  const { det, n: nm } = normalMatrixOf(m);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = p.values[i * 3], y = p.values[i * 3 + 1], z = p.values[i * 3 + 2];
    pos[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    pos[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    pos[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  if (det < 0) {
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const b = tris[t + 1];
      tris[t + 1] = tris[t + 2];
      tris[t + 2] = b;
    }
  }
  let nor = null;
  if (attrs.NORMAL !== undefined) {
    const nv = accessorValues(src, attrs.NORMAL).values;
    nor = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = nv[i * 3], y = nv[i * 3 + 1], z = nv[i * 3 + 2];
      let a = nm[0] * x + nm[1] * y + nm[2] * z;
      let b = nm[3] * x + nm[4] * y + nm[5] * z;
      let c = nm[6] * x + nm[7] * y + nm[8] * z;
      const l = Math.sqrt(a * a + b * b + c * c) || 1;
      a /= l;
      b /= l;
      c /= l;
      nor[i * 3] = a;
      nor[i * 3 + 1] = b;
      nor[i * 3 + 2] = c;
    }
  } else {
    nor = computeNormals(pos, tris);
    notes.normals++;
  }
  const set = (name) => (attrs[name] !== undefined ? Float32Array.from(accessorValues(src, attrs[name]).values) : null);
  const uv0 = set('TEXCOORD_0');
  const uv1 = set('TEXCOORD_1');
  let col = null;
  if (attrs.COLOR_0 !== undefined) {
    const cv = accessorValues(src, attrs.COLOR_0);
    col = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) col[i * 4 + k] = cv.values[i * cv.size + k];
      col[i * 4 + 3] = cv.size === 4 ? cv.values[i * 4 + 3] : 1;
    }
  }
  if (attrs.TANGENT !== undefined) notes.tangents++;
  if (attrs.JOINTS_0 !== undefined) notes.skinned++;
  if (prim.targets?.length) notes.morphs++;
  return { pos, nor, uv0, uv1, col, idx: tris, material: prim.material };
}

// ---- the pass --------------------------------------------------------------------------------------------------------

/** A model's notes and refusals as the pass gathers them. */
function noteCounts() {
  return { lines: 0, strips: 0, normals: 0, tangents: 0, skinned: 0, morphs: 0 };
}

/** The axis-aligned box of a list of positions, folded into `box`. */
function grow(box, pos) {
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (pos[i + k] < box.min[k]) box.min[k] = pos[i + k];
      if (pos[i + k] > box.max[k]) box.max[k] = pos[i + k];
    }
  }
}
const emptyBox = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const boxOk = (b) => b.min.every(Number.isFinite) && b.max.every(Number.isFinite);
const round4 = (v) => Math.round(v * 1e4) / 1e4;

/** A picture's size off its own bytes: a PNG's header, a JPEG's frame; null for anything else. */
export function imageSize(bytes) {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), mime: 'image/png' };
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2;
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) return { width: 0, height: 0, mime: 'image/jpeg' };
      const marker = bytes[o + 1];
      const len = bytes.readUInt16BE(o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: bytes.readUInt16BE(o + 7), height: bytes.readUInt16BE(o + 5), mime: 'image/jpeg' };
      o += 2 + len;
    }
    return { width: 0, height: 0, mime: 'image/jpeg' };
  }
  if (bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return { width: 0, height: 0, mime: 'image/webp' };
  return null;
}

/** One white texel, the picture slot a borrowed picture takes the place of where a material had none. */
let whitePng = null;
function whiteTexel() {
  whitePng ??= encodePng(1, 1, new Uint8Array([255, 255, 255, 255]));
  return whitePng;
}

/**
 * Why a source cannot be imported at all, in words (an empty list for none): an extension the game has no decoder for, one
 * this pass cannot read that the file requires, a room's names, a cell beginning with a digit.
 */
export function sourceRefusals(json) {
  const out = [];
  const used = new Set([...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])]);
  for (const [ext, words] of Object.entries(REFUSED)) if (used.has(ext)) out.push(`it uses ${words}, which the game has no decoder for`);
  for (const ext of json.extensionsRequired ?? []) if (!REFUSED[ext] && !UNDERSTOOD.has(ext)) out.push(`it requires ${ext}, which this pass cannot read`);
  for (const n of json.nodes ?? []) {
    const why = roomRefusal(n.name);
    if (why) out.push(why);
  }
  return out;
}

/**
 * The names `--ship` refuses: every picture, texture and material named like the client's own (`texture/`, `shader/`,
 * `.dds`, `.sht`). A committed model wears the game's pictures only by naming them (`borrow`), never by carrying them.
 */
export function shipNameRefusals(json) {
  const out = [];
  const say = (what, name) => out.push(`${what} ${JSON.stringify(name)} is named like the client's own (texture/, shader/, .dds, .sht): a committed model names the game's pictures in its record (borrow) and never carries them`);
  for (const im of json.images ?? []) {
    if (looksClientish(im.name)) say('the picture', im.name);
    if (typeof im.uri === 'string' && !im.uri.startsWith('data:') && looksClientish(im.uri)) say('the picture', im.uri);
  }
  for (const t of json.textures ?? []) if (looksClientish(t.name)) say('the texture', t.name);
  for (const m of json.materials ?? []) if (looksClientish(m.name)) say('the material', m.name);
  return out;
}

/**
 * Import one model: the source read, refused or baked, its materials normalised, its pictures capped, its levels and shapes
 * sorted out, written as a GLB in the game's own shape with its manifest entry, its library entry, its flora shapes and its
 * picture. Writes nothing; answers `{ refuse }` with every reason in words, or the model made.
 *
 * `src` is `readSource`'s answer, `record` the owner's record (`readRecord`'s), `tune` the run's `IMPORT_TUNE`.
 */
export function importModel(src, record, tune = IMPORT_TUNE, opts = {}) {
  const json = src.json;
  const refusals = sourceRefusals(json);
  if (opts.ship) {
    refusals.push(...shipNameRefusals(json));
    if (record.ship !== true) refusals.push(`its record does not say it may ship: look at its pictures and names, then set "ship": true in it`);
  }
  if (refusals.length) return { refuse: refusals };
  const id = record.id;
  const kind = record.kind ?? 'prop';
  const flora = kind === 'flora';
  const notes = [];
  const counts = noteCounts();

  // ---- the nodes, baked ----
  const sceneIndex = json.scene ?? 0;
  const scene = json.scenes?.[sceneIndex];
  if ((json.scenes?.length ?? 0) > 1) notes.push(`it holds ${json.scenes.length} scenes: only the default one is read`);
  const roots = scene?.nodes ?? (json.nodes ?? []).map((_, i) => i).filter((i) => !(json.nodes ?? []).some((n) => (n.children ?? []).includes(i)));
  const pieces = [];
  const shapes = [];
  let lights = 0;
  let cameras = 0;
  let badLevels = 0;
  // A house's rooms, as the walk meets their names (`importRooms.mjs`): each piece carries the cell it stands under (-1 none).
  const found = { cells: [], portals: [], floors: [], doors: [], lights: [] };
  let doorMeshes = 0;
  const walk = (ni, parent, cell) => {
    const n = json.nodes?.[ni];
    if (!n) return;
    const m = mul(parent, nodeMatrix(n));
    const room = roomName(n.name);
    let c = cell;
    if (room?.kind === 'cell') {
      c = room.index;
      found.cells.push({ index: room.index, name: room.name, ambient: ambientOf(n.extras) });
    }
    const lit = n.extensions?.KHR_lights_punctual;
    if (lit) {
      lights++;
      found.lights.push({ light: json.extensions?.KHR_lights_punctual?.lights?.[lit.light] ?? null, m, cell: c, name: n.name ?? '' });
    }
    if (n.camera !== undefined) cameras++;
    if (room?.kind === 'door') found.doors.push({ style: room.style, name: n.name ?? '', m });
    if (room?.kind === 'portal' || room?.kind === 'floor') {
      // A doorway's polygon and a room's floor are the rooms' data and never drawn or collided: baked into the house's frame
      // as every piece is, and kept apart (their own counts, so a doorway with no normals says nothing of the model's).
      const prims = [];
      for (const prim of (n.mesh !== undefined ? json.meshes?.[n.mesh]?.primitives : null) ?? []) {
        const baked = bakePrimitive(src, prim, m, noteCounts());
        if (baked) prims.push({ pos: baked.pos, idx: baked.idx });
      }
      if (room.kind === 'portal') found.portals.push({ a: room.a, b: room.b, window: room.window, name: n.name ?? '', prims });
      else found.floors.push({ cell: room.cell, name: n.name ?? '', prims });
    } else if (room?.kind === 'door') {
      // A door's object marks where the door stands; its leaf is the game's own style. A mesh on it (a placeholder box, as a
      // hand naturally draws a door) is the marker's and is left out, said, or it would stand drawn and solid in the doorway
      // the real leaf slides away from.
      if (n.mesh !== undefined) doorMeshes++;
    } else if (n.mesh !== undefined) {
      const mesh = json.meshes?.[n.mesh];
      const role = nameRole(n.name ?? mesh?.name, { ...(mesh?.extras ?? {}), ...(n.extras ?? {}) });
      if (role.badLevel !== null) badLevels++;
      for (const prim of mesh?.primitives ?? []) {
        const baked = bakePrimitive(src, prim, m, counts);
        if (!baked) continue;
        if (role.role === 'shape') shapes.push({ shape: role.shape, pos: baked.pos });
        else pieces.push({ ...baked, role: role.role, level: role.level, node: n.name ?? '', cell: c });
      }
    }
    for (const k of n.children ?? []) walk(k, m, c);
  };
  for (const r of roots) walk(r, IDENTITY, -1);
  // A house with rooms: any room past the shell, a doorway, a floor or a door named. The shell named alone is a model with none.
  const rooms = found.cells.some((x) => x.index >= 1) || found.portals.length > 0 || found.floors.length > 0 || found.doors.length > 0;
  if (!rooms && found.cells.length) notes.push('only the shell is named (cell:0): imported as a model with no rooms');
  if (doorMeshes) notes.push(`${doorMeshes} door:<style> object(s) carry a mesh: taken for the door's marker and left out, never drawn or solid (the door's leaf is the game's own style)`);
  if (badLevels) notes.push(`${badLevels} piece(s) named _LOD4 or past it: only three lower levels are read, so they were taken for the model's own`);
  if (lights && !rooms) notes.push(`${lights} light(s) left out: a placed thing adds no light to the world (a house's lamps light its rooms: name them cell:<n>:<name>)`);
  if (cameras) notes.push(`${cameras} camera(s) left out`);
  if (json.animations?.length) notes.push(`${json.animations.length} animation(s) left out: a placed thing does not move`);
  if (counts.skinned) notes.push(`${counts.skinned} skinned piece(s) stand at their bind pose`);
  if (counts.morphs) notes.push(`${counts.morphs} piece(s) with shape keys stand at their own shape`);
  if (counts.tangents) notes.push(`tangents left out on ${counts.tangents} piece(s): normal maps are read the glTF way without them (swgNormalY)`);
  if (counts.normals) notes.push(`${counts.normals} piece(s) had no normals: made smooth from their triangles`);
  if (counts.strips) notes.push(`${counts.strips} strip or fan piece(s) made lists of triangles`);
  if (counts.lines) notes.push(`${counts.lines} piece(s) of lines or points left out`);

  // ---- how it collides ----
  const hasStandIn = pieces.some((p) => p.role === 'colonly' && p.level === 0);
  const auto = record.collision === 'auto' || record.collision === undefined;
  // A house's rooms (the eleventh wave) whose own pieces name a -colonly (a piece under no cell is the shell's): under `auto`
  // each room and the shell take the stand-in rule on their own, so a stand-in named for the shell never takes the rooms'
  // floors out from under someone indoors, who passes through the shell. `by room` where some do and some do not.
  const standInCells = new Set();
  if (rooms) for (const p of pieces) if (p.role === 'colonly' && p.level === 0) standInCells.add(p.cell >= 0 ? p.cell : 0);
  const houseCells = new Set(pieces.filter((p) => p.level === 0).map((p) => (p.cell >= 0 ? p.cell : 0)));
  const autoRule = !hasStandIn ? 'triangles' : !rooms || [...houseCells].every((c) => standInCells.has(c)) ? 'stand-in' : 'by room';
  const rule = flora ? 'shapes' : auto ? autoRule : record.collision;
  const standsIn = (p) => rule === 'stand-in' || (rule === 'by room' && standInCells.has(p.cell >= 0 ? p.cell : 0));
  if (flora && pieces.some((p) => p.role === 'colonly')) notes.push('a flora model collides by its collision-cyl, -box and -ball shapes: its -colonly pieces were left out');
  if (rule === 'none' && hasStandIn) notes.push('its collision is none: its -colonly pieces were left out');
  if (rule === 'stand-in' && !hasStandIn) notes.push('its collision is stand-in and it names no -colonly piece: nothing of it collides');
  const kept = pieces.filter((p) => {
    if (p.role !== 'colonly') return true;
    if (p.level > 0) return false;
    return rule === 'triangles' || rule === 'stand-in' || rule === 'by room';
  });
  // A drawn piece collides by the rule: never in `stand-in` or `none`, nor in a room of a house `by room` that names a
  // stand-in, never on a lower level (only the model's own collide).
  for (const p of kept) if (p.role === 'draw' && (rule === 'none' || standsIn(p))) p.role = 'nocol';
  if (!kept.some((p) => p.role !== 'colonly' && p.level === 0)) return { refuse: ['it has nothing drawn at its own level: every piece is a collider, a shape, a lower level, or lines'] };

  // ---- a house's rooms (the eleventh wave) ----
  let house = null;
  if (rooms) {
    if (kind !== 'building') return { refuse: [`it names rooms (cell:, portal:, floor:, door:), so it is a house with rooms: its record's kind is building, where it says ${kind}`] };
    const bad = found.cells.filter((x) => x.ambient === false).length;
    if (bad) notes.push(`${bad} room(s) with an ambient that is not three numbers from 0 to 4: their ambient left out`);
    house = deriveRooms({ ...found, cells: found.cells.map((x) => ({ ...x, ambient: x.ambient || null })), pieces: kept.filter((p) => p.level === 0).map((p) => ({ pos: p.pos, cell: p.cell, solid: p.role !== 'nocol' })) }, tune);
    if (house.refuse) return { refuse: house.refuse };
    notes.push(...house.notes);
    // Which rooms collide by a stand-in alone, said: such a stand-in is that room's whole floor and walls to someone indoors.
    const byStandIn = house.cells.filter((c) => (rule === 'stand-in' || rule === 'by room') && standInCells.has(c.index));
    if (byStandIn.length) notes.push(`${byStandIn.map((c) => (c.index === 0 ? 'the shell' : `room ${c.index} (${c.name})`)).join(', ')} collide${byStandIn.length === 1 ? 's' : ''} by ${byStandIn.length === 1 ? 'its' : 'their'} own -colonly stand-in${byStandIn.length === 1 ? '' : 's'} alone${rule === 'by room' ? ', the rest by their own triangles' : ''}: a room's stand-in must carry its floor and walls, since someone indoors passes through the shell`);
    // A piece under no cell is the shell's, as the rooms were derived.
    for (const p of kept) if (p.level === 0 && !(p.cell >= 0)) p.cell = 0;
  }

  // ---- the materials ----
  const outMaterials = [];
  const outTextures = [];
  const outImages = [];
  const outSamplers = [];
  const imageMap = new Map();
  const samplerMap = new Map();
  const textureMap = new Map();
  const cards = {};
  const used = new Set();
  const doubled = new Set(record.doubleSided === true ? ['*'] : (record.doubleSided ?? []));
  const stripped = new Set();
  const placeholders = [];
  let shrunk = 0;
  let tooBig = 0;
  let colonly = -1;

  const imageOf = (ii) => {
    if (imageMap.has(ii)) return imageMap.get(ii);
    const im = json.images?.[ii];
    if (!im) return -1;
    let bytes = im.bufferView !== undefined ? Buffer.from(viewBytes(src, im.bufferView)) : im.uri ? src.uriBytes(im.uri) : null;
    if (!bytes) return -1;
    let mime = im.mimeType ?? imageSize(bytes)?.mime ?? 'image/png';
    const size = imageSize(bytes);
    if (size && Math.max(size.width, size.height) > tune.texMax) {
      const d = mime === 'image/png' ? decodePng(bytes) : null;
      if (d) {
        const k = tune.texMax / Math.max(d.width, d.height);
        const w = Math.max(1, Math.round(d.width * k));
        const h = Math.max(1, Math.round(d.height * k));
        bytes = encodePng(w, h, shrinkRgba(d.rgba, d.width, d.height, w, h));
        mime = 'image/png';
        shrunk++;
      } else tooBig++;
    }
    const out = { mimeType: mime, bytes, ...(im.name ? { name: im.name } : {}) };
    outImages.push(out);
    imageMap.set(ii, outImages.length - 1);
    return outImages.length - 1;
  };
  const samplerOf = (si) => {
    if (si === undefined) return undefined;
    if (samplerMap.has(si)) return samplerMap.get(si);
    const s = json.samplers?.[si];
    if (!s) return undefined;
    outSamplers.push({ ...s });
    samplerMap.set(si, outSamplers.length - 1);
    return outSamplers.length - 1;
  };
  const textureOf = (ti) => {
    if (textureMap.has(ti)) return textureMap.get(ti);
    const t = json.textures?.[ti];
    if (!t) return -1;
    const source = t.source ?? t.extensions?.EXT_texture_webp?.source ?? t.extensions?.EXT_texture_avif?.source;
    const image = source !== undefined ? imageOf(source) : -1;
    if (image < 0) return -1;
    const out = { source: image };
    const s = samplerOf(t.sampler);
    if (s !== undefined) out.sampler = s;
    outTextures.push(out);
    textureMap.set(ti, outTextures.length - 1);
    return outTextures.length - 1;
  };
  /**
   * A glTF metal-rough texture as the client's look reads it (`look: 'client'`): the game's highlight is masked by the
   * metal-rough image's red (the converter writes the client's own shine mask there, `specular.ts`), which glTF leaves to
   * the exporter (an ORM-packed export puts its occlusion there), so the model's picture is copied with its red made one, a
   * mask of one as the client's line takes where no mask is; green and blue, glTF's roughness and metalness, are as they
   * were, and an occlusion map on the same picture keeps the original. A picture the pass cannot read (anything but an 8-bit
   * PNG) is kept as it is and said.
   */
  const maskOneOf = (ti) => {
    if (maskOneMap.has(ti)) return maskOneMap.get(ti);
    const t = json.textures?.[ti];
    const source = t ? (t.source ?? t.extensions?.EXT_texture_webp?.source ?? t.extensions?.EXT_texture_avif?.source) : undefined;
    const image = source !== undefined ? imageOf(source) : -1;
    if (image < 0) return -1;
    const im = outImages[image];
    const d = im.mimeType === 'image/png' ? decodePng(im.bytes) : null;
    if (!d) {
      maskUnread++;
      maskOneMap.set(ti, textureOf(ti));
      return maskOneMap.get(ti);
    }
    for (let i = 0; i < d.rgba.length; i += 4) d.rgba[i] = 255;
    outImages.push({ mimeType: 'image/png', bytes: encodePng(d.width, d.height, d.rgba), name: `${im.name ?? 'metalrough'}#mask` });
    const out = { source: outImages.length - 1 };
    const s = samplerOf(t.sampler);
    if (s !== undefined) out.sampler = s;
    outTextures.push(out);
    maskOneMap.set(ti, outTextures.length - 1);
    return outTextures.length - 1;
  };
  const maskOneMap = new Map();
  let maskUnread = 0;
  /** A texture reference carried over (its set and its transform kept), or undefined where its picture is not there. */
  const infoOf = (info, pick = textureOf) => {
    if (!info || info.index === undefined) return undefined;
    const t = pick(info.index);
    if (t < 0) return undefined;
    const out = { index: t };
    if (info.texCoord) out.texCoord = info.texCoord;
    if (info.scale !== undefined) out.scale = info.scale;
    if (info.strength !== undefined) out.strength = info.strength;
    if (info.extensions?.KHR_texture_transform) {
      out.extensions = { KHR_texture_transform: info.extensions.KHR_texture_transform };
      used.add('KHR_texture_transform');
    }
    return out;
  };

  // Each glTF material's name for the game, once: `<id>:<its own name>`, a second of one name held apart by an underscore.
  const names = new Set();
  const baseNames = new Map();
  const baseNameOf = (mi, authored) => {
    const k = mi ?? 'none';
    if (baseNames.has(k)) return baseNames.get(k);
    let n = `${id}:${authored}`;
    while (names.has(n)) n += '_';
    names.add(n);
    baseNames.set(k, n);
    return n;
  };
  const borrow = record.borrow ?? {};
  const looks = [];
  /** The materials out whose borrowed picture needs a coordinate set to lay it by. */
  const mapBorrowers = new Set();
  /** One glTF material normalised for the game (a variant `nocol` carries `swgNoCollide`). Answers its index out. */
  const materialFor = (mi, variant) => {
    const key = `${mi ?? 'none'}|${variant}`;
    if (materialMemo.has(key)) return materialMemo.get(key);
    const s = mi !== undefined ? (json.materials?.[mi] ?? {}) : {};
    const authored = s.name || (mi !== undefined ? `material${mi}` : 'default');
    const name = baseNameOf(mi, authored) + (variant === 'nocol' ? ':nocol' : '');
    const pbr = s.pbrMetallicRoughness ?? {};
    const out = { name, pbrMetallicRoughness: {} };
    const op = out.pbrMetallicRoughness;
    if (pbr.baseColorFactor) op.baseColorFactor = pbr.baseColorFactor.slice();
    const base = infoOf(pbr.baseColorTexture);
    if (base) op.baseColorTexture = base;
    const metallic = pbr.metallicFactor ?? 1;
    op.metallicFactor = metallic;
    if (pbr.roughnessFactor !== undefined) op.roughnessFactor = pbr.roughnessFactor;
    const mr = infoOf(pbr.metallicRoughnessTexture, record.look === 'client' ? maskOneOf : textureOf);
    if (mr) op.metallicRoughnessTexture = mr;
    const normal = infoOf(s.normalTexture);
    if (normal) out.normalTexture = normal;
    const occ = infoOf(s.occlusionTexture);
    if (occ) out.occlusionTexture = occ;
    const emis = infoOf(s.emissiveTexture);
    if (emis) out.emissiveTexture = emis;
    if (s.emissiveFactor) out.emissiveFactor = s.emissiveFactor.slice();
    out.alphaMode = s.alphaMode ?? 'OPAQUE';
    if (s.alphaMode === 'MASK') out.alphaCutoff = s.alphaCutoff ?? 0.5;
    out.doubleSided = doubled.has('*') || doubled.has(authored);
    const extras = {};
    const ext = {};
    for (const [k, v] of Object.entries(s.extensions ?? {})) {
      if (KEPT_MATERIAL.has(k)) {
        ext[k] = v;
        used.add(k);
      } else stripped.add(k);
    }
    // A transmissive material is a pane: blended at the run's glass alpha (all of it transmissive) and casting nothing.
    const t = s.extensions?.KHR_materials_transmission?.transmissionFactor ?? 0;
    if (t > 0) {
      const a = (op.baseColorFactor ?? [1, 1, 1, 1])[3] ?? 1;
      op.baseColorFactor = [...(op.baseColorFactor ?? [1, 1, 1, 1]).slice(0, 3), round4(a + (tune.glassAlpha - a) * Math.min(1, t))];
      out.alphaMode = 'BLEND';
    }
    if (Object.keys(ext).length) out.extensions = ext;
    if (ext.KHR_materials_unlit) extras.unlit = true;
    if (out.alphaMode === 'BLEND') extras.noShadow = true;
    extras.swgCube = metallic > 0;
    if (out.normalTexture) extras.swgNormalY = -1;
    if (record.look === 'client') {
      const r = Math.min(1, Math.max(0, pbr.roughnessFactor ?? 1));
      const g = round4(0.5 * (1 - r));
      extras.swgSpec = { mode: 'phong', color: [g, g, g], power: round4(Math.max(1, tune.specPowerMost * (1 - r) * (1 - r))) };
    }
    if (variant === 'nocol') extras.swgNoCollide = true;
    if (flora && (out.alphaMode === 'MASK' || out.alphaMode === 'BLEND') && !extras.unlit) {
      const card = { blend: out.alphaMode === 'BLEND', emissive: [0, 0, 0] };
      extras.swgCard = card;
      cards[name] = card;
    }
    // The game's own picture or material, named and never carried: a look the model wears wherever it stands.
    const b = borrow[authored];
    if (b) {
      if (b.map && !op.baseColorTexture) {
        if (!placeholders.includes(authored)) placeholders.push(authored);
        op.baseColorTexture = { index: whiteTexture() };
      }
      if (!looks.some((l) => l.of === name)) looks.push({ of: name, ...b });
    }
    // Animated surfaces a converter wrote into the source (extras.swg: a flip-book `anim`, a `scroll`),
    // the same shape tools/swg/glb.mjs writes, carried with their textures re-indexed into this model.
    const sw = s.extras?.swg;
    if (sw && typeof sw === 'object') {
      const swg = {};
      const a = sw.anim;
      if (a && Array.isArray(a.map) && a.map.length > 1 && a.map.length <= 64) {
        const map = a.map.map((ti) => (Number.isInteger(ti) ? textureOf(ti) : -1));
        const seconds = Array.isArray(a.seconds) && a.seconds.length === 2 && a.seconds.every((x) => Number.isFinite(x) && x > 0) ? a.seconds : null;
        const modes = ['time', 'random', 'pingpong', 'frame', 'randomFrame'];
        if (seconds && map.every((t) => t >= 0)) {
          swg.anim = { mode: modes.includes(a.mode) ? a.mode : 'time', seconds, map };
          if (Array.isArray(a.emissive) && a.emissive.length === a.map.length) {
            const em = a.emissive.map((ti) => (Number.isInteger(ti) ? textureOf(ti) : -1));
            if (em.every((t) => t >= 0)) swg.anim.emissive = em;
          }
        }
      }
      const ok2 = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);
      if (sw.scroll && (ok2(sw.scroll.map) || ok2(sw.scroll.alpha))) swg.scroll = { map: ok2(sw.scroll.map) ? sw.scroll.map : [0, 0], alpha: ok2(sw.scroll.alpha) ? sw.scroll.alpha : null };
      if (Object.keys(swg).length) extras.swg = swg;
    }
    out.extras = extras;
    outMaterials.push(out);
    if (b?.map) mapBorrowers.add(outMaterials.length - 1);
    materialMemo.set(key, outMaterials.length - 1);
    return outMaterials.length - 1;
  };
  const materialMemo = new Map();
  let white = -1;
  const whiteTexture = () => {
    if (white >= 0) return white;
    outImages.push({ mimeType: 'image/png', bytes: whiteTexel(), name: 'white' });
    outTextures.push({ source: outImages.length - 1 });
    white = outTextures.length - 1;
    return white;
  };
  const colonlyMaterial = () => {
    if (colonly >= 0) return colonly;
    outMaterials.push({ name: `${id}:colonly`, pbrMetallicRoughness: { baseColorFactor: [1, 0, 1, 1], metallicFactor: 0 }, extras: { swgColliderOnly: true } });
    colonly = outMaterials.length - 1;
    return colonly;
  };
  for (const name of Object.keys(borrow)) if (!(json.materials ?? []).some((m, i) => (m.name || `material${i}`) === name)) notes.push(`its record borrows for ${name}, which is no material of the model`);

  // ---- the pieces, sorted into primitives: one a level, a material and a set of attributes ----
  const groups = new Map();
  let backs = 0;
  for (const p of kept) {
    const mi = p.role === 'colonly' ? colonlyMaterial() : materialFor(p.material, p.role === 'nocol' && p.level === 0 ? 'nocol' : '');
    const mat = outMaterials[mi];
    // A flora model's leaf drawn from one side under the card rule: its sheet is doubled, the back turned (DESIGN.md D10).
    if (flora && (mat.alphaMode === 'MASK' || mat.alphaMode === 'BLEND') && p.role !== 'colonly') {
      doubleSheet(p);
      backs++;
    }
    if (mapBorrowers.has(mi) && !p.uv0) notes.push(`${p.node || 'a piece'}: its material borrows a picture and it has no coordinates (TEXCOORD_0) to lay one by`);
    // A house's level-0 pieces are kept apart by their room as well: each room is a node of its own (`cell:<n>:<name>`).
    const cell = house && p.level === 0 ? p.cell : -1;
    const sig = house ? `${p.level}|${cell}|${mi}|${p.uv0 ? 1 : 0}${p.uv1 ? 1 : 0}${p.col ? 1 : 0}` : `${p.level}|${mi}|${p.uv0 ? 1 : 0}${p.uv1 ? 1 : 0}${p.col ? 1 : 0}`;
    let g = groups.get(sig);
    if (!g) groups.set(sig, (g = { level: p.level, material: mi, cell, list: [] }));
    g.list.push(p);
  }
  const lookWhy = looksRefusal(looks);
  if (lookWhy) return { refuse: [lookWhy] };
  if (backs) notes.push(`${backs} leaf piece(s) doubled with a back sheet, since a card is drawn from its front`);
  if (placeholders.length) notes.push(`${placeholders.join(', ')}: no picture of its own, so a white one stands in for the borrowed picture's slot`);
  if (stripped.size) notes.push(`material extensions left out: ${[...stripped].sort().join(', ')}${stripped.has('KHR_materials_transmission') ? ' (a transmissive material is a blended pane now)' : ''}`);
  if (shrunk) notes.push(`${shrunk} picture(s) past ${tune.texMax} px shrunk to it`);
  if (tooBig) notes.push(`${tooBig} picture(s) past ${tune.texMax} px kept as they are (a JPEG, a WebP or a PNG this pass cannot read): export them smaller`);
  if (maskUnread) notes.push(`${maskUnread} metal-rough picture(s) under look 'client' kept as they are (a JPEG, a WebP or a PNG this pass cannot read): the client's highlight is masked by their red channel, which glTF leaves to the exporter (an occlusion map packed there dims it); export them as 8-bit PNG`);

  // ---- the box, the triangles, the collision's cost ----
  const box = emptyBox();
  let tris = 0;
  let colTris = 0;
  let prims = 0;
  const levelTris = new Map();
  const levelPrims = new Map();
  for (const g of groups.values()) {
    let n = 0;
    for (const p of g.list) n += p.idx.length / 3;
    const mat = outMaterials[g.material];
    const drawn = !mat.extras?.swgColliderOnly;
    if (g.level === 0) {
      for (const p of g.list) grow(box, p.pos);
      if (drawn) {
        tris += n;
        prims++;
      }
      if (!mat.extras?.swgNoCollide && !flora) colTris += n;
    }
    if (drawn) {
      levelTris.set(g.level, (levelTris.get(g.level) ?? 0) + n);
      levelPrims.set(g.level, (levelPrims.get(g.level) ?? 0) + 1);
    }
  }
  if (!boxOk(box)) return { refuse: ['it has no vertices at its own level'] };
  if (rule === 'none') colTris = 0;
  if (colTris > tune.collisionBudget) notes.push(`${colTris} triangles collide, past the budget of ${tune.collisionBudget} (each costs collider build as the player walks up): name a simple stand-in -colonly and it alone collides${house ? ' (in a house, under each room and the shell: a stand-in collides for its own room alone, and must carry that room\'s floor)' : ''}`);

  // ---- the levels ----
  const levels = [...new Set([...groups.values()].map((g) => g.level))].filter((l) => levelTris.get(l)).sort((a, b) => a - b);
  const distances = record.lods ?? tune.lods;
  let lods = null;
  if (levels.length > 1) {
    lods = levels.map((level, i) => {
      const next = levels[i + 1];
      const near = level === 0 ? 0 : distances[level - 1] ?? distances[distances.length - 1] * level;
      const far = next !== undefined ? (distances[next - 1] ?? distances[distances.length - 1] * next) : 1e9;
      return { level, near, far, tris: levelTris.get(level) ?? 0, prims: levelPrims.get(level) ?? 0 };
    });
    for (let i = 1; i < lods.length; i++) if (!(lods[i].near > lods[i - 1].near)) return { refuse: [`its levels take over at ${lods.map((l) => l.near).join(', ')} m, which do not rise: give the record lods that rise`] };
  }

  // ---- the GLB ----
  const w = glbWriter();
  const meshes = [];
  const nodes = [];
  const rootNodes = [];
  const lodRoots = [];
  for (const level of [0, 1, 2, 3]) {
    const list = [...groups.values()].filter((g) => g.level === level);
    if (!list.length) continue;
    if (level > 0 && !lods) continue;
    if (level === 0 && house) {
      // A house's own level: a node a room, named as the converter names a portal building's cells (`cell:<n>:<name>`),
      // which `AssetPack` reads through `meshCellOf` and the walk grid's bake through its node names.
      for (const c of house.cells) {
        const own = list.filter((g) => g.cell === c.index);
        if (!own.length) continue;
        const name = `cell:${c.index}:${c.name}`;
        meshes.push({ name, primitives: own.map((g) => w.primitive(g.list, g.material)) });
        nodes.push({ name, mesh: meshes.length - 1 });
        rootNodes.push(nodes.length - 1);
      }
      continue;
    }
    const primitives = list.map((g) => w.primitive(g.list, g.material));
    meshes.push({ name: level === 0 ? `model:${id}` : `lod:${level}`, primitives });
    nodes.push({ name: level === 0 ? `model:${id}` : `lod:${level}`, mesh: meshes.length - 1 });
    (level === 0 ? rootNodes : lodRoots).push(nodes.length - 1);
  }
  const images = outImages.map((im) => ({ bufferView: w.view(im.bytes), mimeType: im.mimeType, ...(im.name ? { name: im.name } : {}) }));
  const doc = {
    asset: { version: '2.0', generator: 'swg3js import' },
    scene: 0,
    scenes: lodRoots.length ? [{ nodes: rootNodes }, { name: 'lods', nodes: lodRoots }] : [{ nodes: rootNodes }],
    nodes,
    meshes,
    materials: outMaterials,
    accessors: w.accessors,
    bufferViews: w.views,
    buffers: [{ byteLength: w.length }],
  };
  if (outTextures.length) doc.textures = outTextures;
  if (images.length) doc.images = images;
  if (outSamplers.length) doc.samplers = outSamplers;
  if (used.size) doc.extensionsUsed = [...used].sort();
  const glb = buildGlb(doc, w.blob());
  const hash8 = createHash('sha1').update(glb).digest('hex').slice(0, 8);
  const mb = glb.length / 1048576;
  if (mb > tune.modelMax) notes.push(`${mb.toFixed(1)} MB, past ${tune.modelMax} MB`);
  if (mb > WARN_MB) notes.push(`${mb.toFixed(1)} MB: GitHub warns of a file past ${WARN_MB} MB and refuses one past ${HARD_WALL_MB}`);
  if (opts.ship && mb > HARD_WALL_MB) return { refuse: [`${mb.toFixed(1)} MB: GitHub refuses a file past ${HARD_WALL_MB} MB, so it cannot ship`] };

  // ---- the flora's own shapes ----
  let collision = null;
  if (flora) {
    const list = [];
    for (const s of shapes) {
      const b = emptyBox();
      grow(b, s.pos);
      if (!boxOk(b)) continue;
      const span = [0, 1, 2].map((k) => b.max[k] - b.min[k]);
      const mid = [0, 1, 2].map((k) => (b.max[k] + b.min[k]) / 2);
      if (s.shape === 'cyl') list.push({ t: 'cyl', c: [round4(mid[0]), round4(b.min[1]), round4(mid[2])], r: round4(Math.max(span[0], span[2]) / 2), h: round4(span[1]) });
      else if (s.shape === 'ball') list.push({ t: 'ball', c: mid.map(round4), r: round4(Math.max(...span) / 2) });
      else list.push({ t: 'box', min: b.min.map(round4), max: b.max.map(round4) });
    }
    if (list.length) collision = { kind: 'shapes', shapes: list };
    else notes.push('no collision-cyl, -box or -ball named: it stands on the guessed trunk a planting with no shapes stands on');
  } else if (shapes.length) notes.push(`${shapes.length} collision- shape(s) left out: only a flora model collides by them`);

  // ---- the manifest's entry and the library's ----
  const file = `${id}.${hash8}.glb`;
  const bounds = { min: box.min.map(round4), max: box.max.map(round4) };
  // A house's rooms ride on its entry as a converted portal building's do (`cells`, `portals`), last, so a model with none
  // writes the entry it always wrote.
  const def = { id, file, bounds, triangles: tris, ...(lods ? { lods } : {}), ...(flora ? { appearance: `imported/${id}` } : {}), ...(looks.length ? { looks } : {}), ...(house ? { cells: house.cells, portals: house.portals } : {}) };
  const building = kind === 'building';
  const picture = pictureOf(glb, building, LIBRARY_PASS, { factors: true });
  const pic = picture ? encodePng(picture.width, picture.height, picture.rgba) : null;
  const entry = {
    id,
    name: record.name ?? id,
    group: record.group ?? 'mine',
    kind,
    file,
    pic: pic ? `icons/${id}.${hash8}.png` : null,
    sz: [0, 1, 2].map((k) => Math.round((bounds.max[k] - bounds.min[k]) * 100) / 100),
    tri: tris,
    colTri: colTris,
    collision: rule,
    bytes: glb.length,
    notes,
    source: basename(src.file ?? ''),
    ship: record.ship === true,
    ...(record.licence !== undefined ? { licence: record.licence } : {}),
    ...(record.credit !== undefined ? { credit: record.credit } : {}),
    ...(house ? { rooms: house.rooms, doors: house.doors.length } : {}),
  };
  // A house's floors (by room) and doors (by style name) for the folder's `floors.json` and `doors.json`.
  return { id, glb, hash8, def, entry, flora, collision, cards, picture: pic, notes, ...(house ? { floors: house.floors, doors: house.doors } : {}) };
}

/** A piece's sheet doubled: every triangle again on its own vertices, wound the other way, its normals turned round. */
function doubleSheet(p) {
  const n = p.pos.length / 3;
  const grow2 = (a) => {
    if (!a) return null;
    const out = new Float32Array(a.length * 2);
    out.set(a, 0);
    out.set(a, a.length);
    return out;
  };
  p.pos = grow2(p.pos);
  p.nor = grow2(p.nor);
  for (let i = n * 3; i < p.nor.length; i++) p.nor[i] = -p.nor[i];
  p.uv0 = grow2(p.uv0);
  p.uv1 = grow2(p.uv1);
  p.col = grow2(p.col);
  const idx = new Uint32Array(p.idx.length * 2);
  idx.set(p.idx, 0);
  for (let t = 0; t < p.idx.length; t += 3) {
    idx[p.idx.length + t] = p.idx[t] + n;
    idx[p.idx.length + t + 1] = p.idx[t + 2] + n;
    idx[p.idx.length + t + 2] = p.idx[t + 1] + n;
  }
  p.idx = idx;
}

/** A small GLB writer: views four-byte aligned in one blob, accessors over them, a primitive from baked pieces. */
function glbWriter() {
  const parts = [];
  const views = [];
  const accessors = [];
  let length = 0;
  const view = (bytes, target) => {
    const pad = (4 - (length % 4)) % 4;
    if (pad) {
      parts.push(Buffer.alloc(pad));
      length += pad;
    }
    const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    parts.push(b);
    views.push({ buffer: 0, byteOffset: length, byteLength: b.length, ...(target ? { target } : {}) });
    length += b.length;
    return views.length - 1;
  };
  const accessor = (arr, type, componentType, target, minmax = false) => {
    const size = SIZE[type];
    const a = { bufferView: view(arr, target), componentType, count: arr.length / size, type };
    if (minmax) {
      const min = new Array(size).fill(Infinity);
      const max = new Array(size).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) {
        const k = i % size;
        if (arr[i] < min[k]) min[k] = arr[i];
        if (arr[i] > max[k]) max[k] = arr[i];
      }
      a.min = min.map((v) => Math.fround(v));
      a.max = max.map((v) => Math.fround(v));
    }
    accessors.push(a);
    return accessors.length - 1;
  };
  /** Pieces of one material (and one set of attributes) joined into one primitive. */
  const primitive = (list, material) => {
    let verts = 0;
    let corners = 0;
    for (const p of list) {
      verts += p.pos.length / 3;
      corners += p.idx.length;
    }
    const pos = new Float32Array(verts * 3);
    const nor = new Float32Array(verts * 3);
    const uv0 = list[0].uv0 ? new Float32Array(verts * 2) : null;
    const uv1 = list[0].uv1 ? new Float32Array(verts * 2) : null;
    const col = list[0].col ? new Float32Array(verts * 4) : null;
    const idx = verts > 65535 ? new Uint32Array(corners) : new Uint16Array(corners);
    let v = 0;
    let c = 0;
    for (const p of list) {
      pos.set(p.pos, v * 3);
      nor.set(p.nor, v * 3);
      if (uv0) uv0.set(p.uv0, v * 2);
      if (uv1) uv1.set(p.uv1, v * 2);
      if (col) col.set(p.col, v * 4);
      for (let i = 0; i < p.idx.length; i++) idx[c + i] = p.idx[i] + v;
      v += p.pos.length / 3;
      c += p.idx.length;
    }
    const attributes = { POSITION: accessor(pos, 'VEC3', 5126, 34962, true), NORMAL: accessor(nor, 'VEC3', 5126, 34962) };
    if (uv0) attributes.TEXCOORD_0 = accessor(uv0, 'VEC2', 5126, 34962);
    if (uv1) attributes.TEXCOORD_1 = accessor(uv1, 'VEC2', 5126, 34962);
    if (col) attributes.COLOR_0 = accessor(col, 'VEC4', 5126, 34962);
    return { attributes, indices: accessor(idx, 'SCALAR', idx instanceof Uint32Array ? 5125 : 5123, 34963), material, mode: 4 };
  };
  return {
    views,
    accessors,
    get length() {
      return length;
    },
    view,
    primitive,
    blob: () => Buffer.concat(parts),
  };
}

// ---- the folder ------------------------------------------------------------------------------------------------------

/** A JSON file read, or null. */
function readJsonQuiet(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** A file written through a copy beside it, so a reader never meets it half written. */
function writeAtomic(file, data) {
  const tmp = join(dirname(file), `.${basename(file)}.tmp`);
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

/**
 * A folder's JSON files as they stand, or fresh ones: its manifest, the library's index, its flora's shapes, and its houses'
 * floors and doors (the eleventh wave: `floors.json` in the converter's shape, `doors.json` with its rows by style name and
 * no style's numbers, which are the player's own gallery pack's).
 */
function folderFiles(out) {
  const manifest = readJsonQuiet(join(out, 'manifest.json')) ?? {};
  const imports = readJsonQuiet(join(out, 'imports.json')) ?? {};
  const collision = readJsonQuiet(join(out, 'flora-collision.json')) ?? {};
  const floors = readJsonQuiet(join(out, 'floors.json')) ?? {};
  const doors = readJsonQuiet(join(out, 'doors.json')) ?? {};
  return {
    manifest: { planet: 'imported', format: IMPORT_FORMAT, categories: { layout: [...(manifest.categories?.layout ?? [])], flora: [...(manifest.categories?.flora ?? [])] }, cards: { ...(manifest.cards ?? {}) } },
    imports: { version: IMPORT_FORMAT, made: '', entries: [...(imports.entries ?? [])], ...(typeof imports.shipNote === 'number' ? { shipNote: imports.shipNote } : {}) },
    collision: { version: 1, appearances: { ...(collision.appearances ?? {}) } },
    floors: { version: FLOOR_PACK_VERSION, mesh: true, models: { ...(floors.version === FLOOR_PACK_VERSION && floors.models ? floors.models : {}) } },
    doors: { version: DOORS_PACK_VERSION, styles: {}, models: { ...(doors.version === DOORS_PACK_VERSION && doors.models ? doors.models : {}) } },
  };
}

/** Everything of one id out of a folder's files, and its old files swept (all but `keep`). */
function dropFrom(out, files, id, keep = new Set()) {
  const m = files.manifest;
  m.categories.layout = m.categories.layout.filter((d) => d.id !== id);
  m.categories.flora = m.categories.flora.filter((d) => d.id !== id);
  for (const k of Object.keys(m.cards)) if (k.startsWith(`${id}:`)) delete m.cards[k];
  files.imports.entries = files.imports.entries.filter((e) => e.id !== id);
  delete files.collision.appearances[`imported/${id}`];
  delete files.floors.models[id];
  delete files.doors.models[id];
  let swept = 0;
  const own = new RegExp(`^${id.replace(/[^a-z0-9_]/g, '')}\\.[0-9a-f]{8}\\.(glb|png)$`);
  for (const dir of [out, join(out, 'icons')]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!own.test(f) || keep.has(f)) continue;
      rmSync(join(dir, f), { force: true });
      swept++;
    }
  }
  return swept;
}

/**
 * The folder's three JSON files written back (an empty folder's taken away: nothing of it is left to read). The library's
 * index (`imports.json`) is written last and says what the folder comes to (`bytes`: every file in it but the index itself,
 * which `__debug.imports()` reads), and, for the shipped folder (`shipNote`, the megabytes a run of `--ship` notes it past,
 * kept from that run), whether it rides in every release past that size (`notes`).
 */
function writeFiles(out, files, now) {
  files.imports.made = new Date(now).toISOString();
  files.imports.entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  writeAtomic(join(out, 'manifest.json'), JSON.stringify(files.manifest, null, 1));
  if (Object.keys(files.collision.appearances).length) writeAtomic(join(out, 'flora-collision.json'), JSON.stringify(files.collision));
  else rmSync(join(out, 'flora-collision.json'), { force: true });
  // A house's floors and doors, written while any house in the folder has rooms and taken away with the last one, so a folder
  // of no house is the folder it always was.
  for (const [name, f] of [['floors.json', files.floors], ['doors.json', files.doors]]) {
    if (Object.keys(f.models).length) writeAtomic(join(out, name), JSON.stringify(f));
    else rmSync(join(out, name), { force: true });
  }
  const bytes = folderBytes(out, 'imports.json');
  files.imports.bytes = bytes;
  const ship = files.imports.shipNote;
  files.imports.notes = typeof ship === 'number' && bytes / 1048576 > ship ? [shipNoteWords(bytes, ship)] : [];
  writeAtomic(join(out, 'imports.json'), JSON.stringify(files.imports, null, 1));
  return bytes;
}

/** What is said of a shipped folder past its note: every release carries it. */
function shipNoteWords(bytes, ship) {
  return `the shipped folder comes to ${(bytes / 1048576).toFixed(1)} MB, past ${ship} MB: it rides in every release`;
}

/**
 * A model made written into a folder: its GLB and picture, its entries in the folder's files, its old files swept.
 * `shipNote` (megabytes) marks the folder as the shipped one, noted in its index past that size.
 */
export function writeImport(out, made, now = Date.now(), opts = {}) {
  mkdirSync(join(out, 'icons'), { recursive: true });
  const files = folderFiles(out);
  if (typeof opts.shipNote === 'number') files.imports.shipNote = opts.shipNote;
  const keep = new Set([made.def.file, ...(made.entry.pic ? [basename(made.entry.pic)] : [])]);
  const swept = dropFrom(out, files, made.id, keep);
  writeFileSync(join(out, made.def.file), made.glb);
  if (made.picture && made.entry.pic) writeFileSync(join(out, made.entry.pic), made.picture);
  (made.flora ? files.manifest.categories.flora : files.manifest.categories.layout).push(made.def);
  Object.assign(files.manifest.cards, made.cards);
  if (made.collision) files.collision.appearances[`imported/${made.id}`] = made.collision;
  // A house's floors and doors, written even when it has none (a house read and found to have no floor is not one nobody
  // has looked at, as the converter's own floors say).
  if (made.floors) files.floors.models[made.id] = made.floors;
  if (made.doors) files.doors.models[made.id] = made.doors;
  files.imports.entries.push({ ...made.entry, at: now });
  const bytes = writeFiles(out, files, now);
  return { swept, bytes, notes: files.imports.notes };
}

/** An id taken out of a folder: its entries and its files. Answers whether there was one. */
export function dropImport(out, id, now = Date.now()) {
  if (!existsSync(join(out, 'manifest.json'))) return false;
  const files = folderFiles(out);
  const had = files.imports.entries.some((e) => e.id === id) || files.manifest.categories.layout.some((d) => d.id === id) || files.manifest.categories.flora.some((d) => d.id === id);
  dropFrom(out, files, id);
  writeFiles(out, files, now);
  return had;
}

/** How many bytes a folder's files come to (a file of the folder's own named `leave` left out, and a dot-named copy in flight). */
function folderBytes(dir, leave = null) {
  let n = 0;
  if (!existsSync(dir)) return 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === leave || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) n += folderBytes(p);
    else n += statSync(p).size;
  }
  return n;
}

// ---- the command and status ------------------------------------------------------------------------------------------

/** The two folders, beside a checkout: the private one (the dev server's alone) and the shipped one (every build's). */
export function importFolders(repo) {
  return { private: join(repo, 'imports-private'), shipped: join(repo, 'public', 'imports') };
}

/** The run's tune: `IMPORT_TUNE` with every flag of `IMPORT_FLAGS` the command line names laid over it; or why not. */
export function tuneOf(options) {
  const t = { ...IMPORT_TUNE, lods: IMPORT_TUNE.lods.slice() };
  for (const [flag, key] of Object.entries(IMPORT_FLAGS)) {
    const v = options?.[flag];
    if (v === undefined) continue;
    if (key === 'lods') {
      const list = String(v).split(',').map(Number);
      if (!list.length || list.length > 3 || !list.every((d) => Number.isFinite(d) && d > 0)) return `--lods is one to three distances in metres (--lods=40,120,300)`;
      t.lods = list;
      continue;
    }
    const n = Number(v);
    if (ZERO_OK.has(key) ? !Number.isFinite(n) || n < 0 : !Number.isFinite(n) || n <= 0) return `--${flag} is a number ${ZERO_OK.has(key) ? 'of nought or more' : 'above nought'}`;
    t[key] = n;
  }
  return t;
}

/**
 * `import <in> [<out>] [--ship]` (and `import --drop=<id> [<out>]`): every source `<in>` names (a file, or a folder's
 * `.glb` and `.gltf`) imported into `<out>`, `imports-private/` beside the checkout unless another is named, or
 * `public/imports/` with `--ship`. Says what it did and each model's notes; answers the exit code.
 */
export function runImport({ input, out, ship = false, drop = null, options = {}, repo, log = console.log, now = Date.now() }) {
  const folders = importFolders(repo);
  const tune = tuneOf(options);
  if (typeof tune === 'string') {
    log(`import: ${tune}`);
    return 1;
  }
  let dest = out ? resolve(out) : ship ? folders.shipped : folders.private;
  if (ship && out && resolve(out) !== resolve(folders.shipped)) {
    log(`import: --ship writes into ${folders.shipped} and nowhere else (it is what every build carries); leave the folder out, or name that one`);
    return 1;
  }
  if (ship) dest = folders.shipped;
  log(`import: into ${dest}; collision budget ${tune.collisionBudget} triangles, pictures to ${tune.texMax} px, a model noted past ${tune.modelMax} MB, the shipped folder past ${tune.shipNote} MB, glass at ${tune.glassAlpha}, lower levels at ${tune.lods.join(', ')} m (--collision-budget= --tex-max= --model-max= --ship-note= --glass-alpha= --lods= --spec-power=)`);
  log(`import: a house's rooms padded ${tune.cellPad} m, a doorway flat to ${tune.portalFlat} m, a door within ${tune.doorReach} m of its doorway, a room's light reaching ${tune.lightReach} m where its file names none, its brightness times ${tune.lightScale} (--cell-pad= --portal-flat= --door-reach= --light-reach= --light-scale=)`);
  if (drop) {
    const had = dropImport(dest, drop, now);
    log(had ? `import: ${drop} taken out of ${dest}` : `import: ${dest} holds no ${drop}`);
    return had ? 0 : 1;
  }
  if (!input) {
    log('import: name a .glb or a .gltf, or a folder of them');
    return 1;
  }
  const at = resolve(input);
  if (!existsSync(at)) {
    log(`import: ${at} is not there`);
    return 1;
  }
  const sources = statSync(at).isDirectory()
    ? readdirSync(at)
        .filter((f) => /\.(glb|gltf)$/i.test(f))
        .sort()
        .map((f) => join(at, f))
    : [at];
  if (!sources.length) {
    log(`import: ${at} holds no .glb or .gltf`);
    return 1;
  }
  let failed = 0;
  for (const file of sources) {
    const rec = recordFor(file);
    if (rec.refuse) {
      log(`import: ${basename(file)} refused: ${rec.refuse}`);
      failed++;
      continue;
    }
    let src;
    try {
      src = readSource(file);
    } catch (err) {
      log(`import: ${basename(file)} does not read: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
      continue;
    }
    // A source met for the first time that names rooms is a house: its fresh record says so (an existing record is the
    // owner's word, and a house with rooms under another kind is refused in words).
    if (rec.made && namesRooms(src.json)) rec.record.kind = 'building';
    let made;
    try {
      made = importModel(src, rec.record, tune, { ship });
    } catch (err) {
      log(`import: ${basename(file)} could not be made: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
      continue;
    }
    if (made.refuse) {
      log(`import: ${basename(file)} refused:`);
      for (const why of made.refuse) log(`  - ${why}`);
      failed++;
      continue;
    }
    if (rec.made) {
      writeFileSync(rec.path, `${JSON.stringify(rec.record, null, 2)}\n`);
      log(`import: ${basename(file)} had no record: ${rec.path} written with every default (its id is ${rec.record.id}; rename the source freely, the id stays)`);
    }
    const shadow = !ship && existsSync(join(folders.shipped, 'manifest.json')) && (readJsonQuiet(join(folders.shipped, 'manifest.json'))?.categories?.layout ?? []).concat(readJsonQuiet(join(folders.shipped, 'manifest.json'))?.categories?.flora ?? []).some((d) => d.id === made.id);
    const w = writeImport(dest, made, now, ship ? { shipNote: tune.shipNote } : {});
    const e = made.entry;
    log(`import: ${e.id} (${e.kind}) from ${e.source}: ${made.def.file}, ${e.tri} triangles drawn, ${e.colTri} collided (${e.collision}), ${(e.bytes / 1048576).toFixed(2)} MB${made.def.lods ? `, ${made.def.lods.length - 1} lower level${made.def.lods.length > 2 ? 's' : ''} taking over at ${made.def.lods.slice(1).map((l) => l.near).join(', ')} m` : ''}${e.rooms !== undefined ? `, ${e.rooms} room${e.rooms === 1 ? '' : 's'} and ${e.doors} door${e.doors === 1 ? '' : 's'}` : ''}${e.pic ? ', a picture' : ', no picture (nothing drew)'}${w.swept ? `; ${w.swept} old file(s) swept` : ''}`);
    for (const n of made.notes) log(`  - ${n}`);
    if (shadow) log(`  - ${made.id} is shipped too (public/imports): a row stands the shipped one first, so this private one shows nowhere until it is shipped or renamed`);
    for (const n of w.notes) log(`  - ${n}`);
    if (ship) log(`  - shipped: commit ${dest} when you mean it to reach players`);
  }
  log(`import: ${sources.length - failed} of ${sources.length} made; in the editor (F2), the library's Imported source and its Reload imports button`);
  return failed ? 1 : 0;
}

/** What `status` says of the two folders (listed, never asked): how many models each holds and what they come to. */
export function importsStatus(repo) {
  const folders = importFolders(repo);
  const line = (dir, label) => {
    const idx = readJsonQuiet(join(dir, 'imports.json'));
    if (!idx) return `${label}: none`;
    const n = (idx.entries ?? []).length;
    const noted = (idx.entries ?? []).filter((e) => (e.notes ?? []).length).length;
    return `${label}: ${n} model${n === 1 ? '' : 's'}, ${(folderBytes(dir) / 1048576).toFixed(1)} MB${noted ? `, ${noted} with notes` : ''}`;
  };
  return { line: `imports: ${line(folders.private, 'imports-private')}; ${line(folders.shipped, 'public/imports')} (npm run swg -- import <file.glb> makes one, for the world editor; --ship puts one in the build)`, stale: false };
}
