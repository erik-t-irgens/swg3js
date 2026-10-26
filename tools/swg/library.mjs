// The world editor's library, a light pass over the packs already converted (`npm run swg -- library <out-dir>`): one
// index of everything the editor can put down, and a picture of every model that has none.
//
// **It reads the packs and never the archives**, so it takes no `<swg-dir>` and nothing about `--retail-only` applies:
// the props catalogue (`props/manifest.json`), the gallery's buildings (`gallery/gallery.json` and its manifest), every
// ground world's placed objects (`<world>/layout.json`) and planted flora (`<world>/manifest.json`). What it writes is
// `library/library.json` (the index, `LIBRARY_FORMAT`) and `library/icons/<pack>/<model>.png`, under the output folder
// alone; deleting that one folder puts the install back exactly as it was. It is the developer's: `status` lists it when
// it is missing or older than a pack it read, with the command, and never asks for it, since a player's launcher has no
// use for it (the sandbox's precedent).
//
// **The pictures are the converter's own**, drawn by its rasteriser (`thumbnail.mjs`) at the props' own view from the
// converted GLBs themselves (already in the game's frame, so `flipX: false`), 96 px: the rooms of a portal building left
// out (a picture is its outside), a glowing material's glow added back (the converter split it out of the base colour),
// an additive surface left out as the item pictures leave one out, and **a building clipped per pixel at its ground**,
// since every player house's box reaches about sixteen metres under its doorstep. A model the props pack already
// pictures is never drawn again: its picture is the props pack's own (3,633 of its 3,667 models). A picture already
// written and newer than its GLB is kept, so a second run draws nothing new.
//
// Entries, one a thing:
//   props      every thing of the props catalogue (`pack: 'props'`, its `thing`)
//   buildings  every gallery house and interior by its template (`pack: 'gallery'`, its `model` and `template`)
//   world      every template a ground world places that neither the props nor the gallery has (`pack: 'world'`, `from`)
//   flora      every model a ground world plants (`pack: 'world'`, `from`), trees, small plants and rocks
// The weapons and vehicles of the gallery are not offered (skinned models as static rows are untested).
//
// Node 22, no dependencies.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readGlb } from './sceneglb.mjs';
import { decodePng, encodePng } from './png.mjs';
import { renderThumbnail, thumbTexture } from './thumbnail.mjs';

/** The shape of `library/library.json` this writes; the game's `libraryModel.ts` reads it. */
export const LIBRARY_FORMAT = 1;

/** The pass's own numbers, all ours. */
export const LIBRARY_PASS = {
  /** A picture's side, pixels: the item pictures' own. */
  size: 96,
  /** The props pictures' view: the model from the front, turned 32 degrees and looked on from 22 above. */
  yawDeg: 32,
  pitchDeg: 22,
  /** The ground line a building's picture is clipped at, metres in its own frame: a step's breadth under the doorstep. */
  groundClip: -0.25,
  /** The planted model a tree is past, half its box across, metres: the game's own line (`floraMinRadius`). */
  treeRadius: 1.2,
};

/** An entry's flags: what it is, read by the window's groups and the hand. */
export const LIBRARY_FLAG = { building: 1, walkIn: 2, flora: 4, tree: 8, particle: 16, standing: 32, solid3d: 64, loop: 128 };

/** The worlds whose placed objects and flora the library lists: every ground world but the copies' world, which the gallery's interiors already offer. */
const NOT_A_WORLD = new Set(['gallery', 'props', 'dungeon1']);

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** One accessor of a GLB as a typed array of its own (strided ones unpacked; normalised integers taken to -1..1). */
function accessor(g, i) {
  const a = g.json.accessors[i];
  const bv = g.json.bufferViews[a.bufferView];
  const T = COMP[a.componentType];
  const per = SIZE[a.type];
  const n = a.count * per;
  const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = bv.byteStride;
  if (stride && stride !== per * T.BYTES_PER_ELEMENT) {
    const out = new Float32Array(n);
    const view = new DataView(g.bin.buffer, g.bin.byteOffset);
    for (let k = 0; k < a.count; k++) {
      for (let c = 0; c < per; c++) {
        const off = start + k * stride + c * T.BYTES_PER_ELEMENT;
        out[k * per + c] = T === Float32Array ? view.getFloat32(off, true) : new T(g.bin.buffer.slice(g.bin.byteOffset + off, g.bin.byteOffset + off + T.BYTES_PER_ELEMENT))[0];
      }
    }
    return out;
  }
  const copy = Buffer.from(g.bin.subarray(start, start + n * T.BYTES_PER_ELEMENT));
  let arr = new T(copy.buffer, copy.byteOffset, n);
  if (a.normalized && T !== Float32Array) {
    const max = T === Uint8Array ? 255 : T === Uint16Array ? 65535 : T === Int16Array ? 32767 : 127;
    arr = Float32Array.from(arr, (v) => Math.max(-1, v / max));
  }
  return arr;
}

/** A texture of a GLB decoded and reduced to at most 128 px (`thumbTexture`), or null; once a texture. */
function imageOf(g, texIndex, cache) {
  if (texIndex === undefined || texIndex === null) return null;
  if (cache.has(texIndex)) return cache.get(texIndex);
  let r = null;
  try {
    const src = g.json.textures?.[texIndex]?.source;
    const img = src !== undefined ? g.json.images?.[src] : null;
    if (img && img.bufferView !== undefined && /png/.test(img.mimeType ?? 'image/png')) {
      const bv = g.json.bufferViews[img.bufferView];
      const bytes = g.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
      const d = decodePng(Buffer.from(bytes));
      if (d) r = thumbTexture(d.width, d.height, d.rgba);
    }
  } catch {
    r = null;
  }
  cache.set(texIndex, r);
  return r;
}

/** Column-major 4x4 multiply. */
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

/** A node's own matrix, column-major. */
function localOf(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0, 2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}

/**
 * A converted GLB's default scene as the rasteriser's meshes: every triangle mesh through its nodes' matrices, its base
 * colour picture (cut out where its material cuts, faint parts of a blended one left out) and its glow picture with its
 * factor; a portal building's rooms (cells past 0) left out, and an invisible or an additive surface left out as the item
 * pictures leave them.
 */
export function glbMeshes(buf) {
  const g = readGlb(buf);
  const out = [];
  const cache = new Map();
  const scene = g.json.scenes?.[g.json.scene ?? 0];
  if (!scene) return out;
  const walk = (ni, parent) => {
    const n = g.json.nodes[ni];
    const m = mul(parent, localOf(n));
    const name = String(n.name ?? '');
    const cell = /^cell[:_]?(\d+)/.exec(name);
    if (cell && Number(cell[1]) > 0) return;
    if (n.mesh !== undefined) {
      for (const p of g.json.meshes[n.mesh].primitives ?? []) {
        if (p.mode !== undefined && p.mode !== 4) continue;
        if (p.attributes?.POSITION === undefined) continue;
        const mat = p.material !== undefined ? g.json.materials?.[p.material] : null;
        if (mat?.extras?.swgInvisible || /invisible/i.test(mat?.name ?? '')) continue;
        if (mat?.extras?.swg?.blend === 'add') continue;
        const pos = accessor(g, p.attributes.POSITION);
        const nor = p.attributes.NORMAL !== undefined ? accessor(g, p.attributes.NORMAL) : null;
        const uv = p.attributes.TEXCOORD_0 !== undefined ? accessor(g, p.attributes.TEXCOORD_0) : null;
        const idx = p.indices !== undefined ? accessor(g, p.indices) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
        const base = imageOf(g, mat?.pbrMetallicRoughness?.baseColorTexture?.index, cache);
        const texture = base ? { ...base, alphaTest: mat?.alphaMode === 'MASK' ? (mat.alphaCutoff ?? 0.5) : mat?.alphaMode === 'BLEND' ? 0.25 : 0 } : null;
        const emissive = imageOf(g, mat?.emissiveTexture?.index, cache);
        const P = new Float32Array(pos.length);
        const N = nor ? new Float32Array(nor.length) : null;
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i];
          const y = pos[i + 1];
          const z = pos[i + 2];
          P[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
          P[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          P[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
          if (N) {
            const a = nor[i];
            const b = nor[i + 1];
            const c = nor[i + 2];
            N[i] = m[0] * a + m[4] * b + m[8] * c;
            N[i + 1] = m[1] * a + m[5] * b + m[9] * c;
            N[i + 2] = m[2] * a + m[6] * b + m[10] * c;
          }
        }
        out.push({ positions: P, normals: N, uvs: uv, indices: idx, texture, ...(texture ? {} : { color: [168, 168, 168] }), ...(emissive ? { emissive, emissiveFactor: mat?.emissiveFactor ?? [1, 1, 1] } : {}) });
      }
    }
    for (const c of n.children ?? []) walk(c, m);
  };
  for (const ni of scene.nodes ?? []) walk(ni, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return out;
}

/** A model's picture drawn from its GLB, or null where nothing drew (`renderThumbnail`'s coverage). */
export function pictureOf(buf, building, tune = LIBRARY_PASS) {
  const meshes = glbMeshes(buf);
  return renderThumbnail(meshes, { size: tune.size, view: 'wear', yawDeg: tune.yawDeg, pitchDeg: tune.pitchDeg, flipX: false, groundClip: building ? tune.groundClip : null });
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function mtimeOf(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** A template's last part, as words: `object/building/naboo/shared_cantina_naboo.iff` is "cantina naboo". */
export function templateWords(template) {
  const last = String(template ?? '').split('/').pop() ?? '';
  return last.replace(/^shared_/, '').replace(/\.iff$/, '').replace(/_/g, ' ').trim();
}

/** A template's id stem: `shared_cantina_naboo.iff` is `cantina_naboo`. */
function templateStem(template) {
  const last = String(template ?? '').split('/').pop() ?? '';
  return last.replace(/^shared_/, '').replace(/\.iff$/, '');
}

/** The two folders a template sits in under `object/`: `building/naboo`. */
function templateGroup(template) {
  const parts = String(template ?? '').split('/');
  return parts.slice(1, 3).join('/') || 'other';
}

/** A box's spans [w, h, d], the corners taken componentwise (the BOX lesson). */
function spans(b) {
  if (!b || !b.min || !b.max) return [0, 0, 0];
  return [0, 1, 2].map((k) => Math.round(Math.abs(b.max[k] - b.min[k]) * 100) / 100);
}

/** What kind of planted thing a flora model is, for its group: a rock by its family or its name, else a tree or a small plant by the 1.2 m line. */
function floraGroup(def, tune) {
  const words = `${def.familyName ?? ''} ${def.id}`;
  if (/rock|boulder|stone|crystal/i.test(words)) return 'rocks';
  const b = def.bounds;
  const r = b ? Math.max(Math.abs(b.max[0] - b.min[0]), Math.abs(b.max[2] - b.min[2])) / 2 : 0;
  return r >= tune.treeRadius ? 'trees' : 'small';
}

/**
 * The index and the pictures for everything under `root` (the converted packs' folder). `log` is told what each source
 * came to; `now` is the moment written into the index. Answers the index and what the run did.
 */
export function buildLibrary({ root, log = () => {}, now = Date.now(), tune = LIBRARY_PASS } = {}) {
  const started = Date.now();
  const outDir = join(root, 'library');
  const iconsDir = join(outDir, 'icons');
  const entries = [];
  const packs = {};
  const note = (pack, file) => {
    packs[pack] = { manifest: file, mtime: Math.round(mtimeOf(join(root, file))) };
  };
  // The models the props pack pictures, by id: their picture is the props pack's, never drawn again.
  const props = readJson(join(root, 'props', 'manifest.json'));
  const propIcon = new Map();
  if (props?.models) for (const m of props.models) if (m.icon) propIcon.set(m.id, `props/${m.icon}`);
  const propTemplates = new Set();
  if (props?.props) {
    note('props', 'props/manifest.json');
    const tris = new Map((props.models ?? []).map((m) => [m.id, m.triangles ?? 0]));
    for (const p of props.props) {
      if (p.template) propTemplates.add(p.template);
      entries.push({ s: 'props', p: 'props', id: p.id, m: p.model, n: p.name ?? null, g: p.group ?? 'other', t: p.template ?? null, sz: [p.size?.w ?? 0, p.size?.h ?? 0, p.size?.d ?? 0], tri: tris.get(p.model) ?? 0, pic: p.icon ? `props/${p.icon}` : null, f: 0 });
    }
    log(`library: props, ${props.props.length} things`);
  } else log('library: no props pack, so none of its things');

  // Every model to draw, by id: the pack folder it is read out of, its GLB, and whether it is a building.
  const draw = new Map();
  const want = (id, pack, file, building) => {
    if (propIcon.has(id)) return propIcon.get(id);
    if (!draw.has(id)) draw.set(id, { pack, file, building });
    return `library/icons/${draw.get(id).pack}/${id}.png`;
  };

  // The gallery's buildings, by template: its houses and its interiors (every structure with rooms).
  const gallery = readJson(join(root, 'gallery', 'gallery.json'));
  const galleryMan = readJson(join(root, 'gallery', 'manifest.json'));
  const galleryDefs = new Map((galleryMan?.categories?.layout ?? []).map((d) => [d.id, d]));
  const galleryTemplates = new Set();
  if (gallery?.sections) {
    note('gallery', 'gallery/manifest.json');
    let n = 0;
    const seen = new Set();
    for (const section of gallery.sections) {
      if (section.id !== 'houses' && section.id !== 'interiors') continue;
      for (const item of section.items ?? []) {
        const def = galleryDefs.get(item.model);
        if (!def) continue;
        if (item.template) galleryTemplates.add(item.template);
        let id = item.template ? templateStem(item.template) : item.model;
        while (seen.has(id)) id = `${id}_`;
        seen.add(id);
        const walkIn = (def.cells?.length ?? 0) > 1;
        entries.push({ s: 'buildings', p: 'gallery', id, m: item.model, n: item.label ?? templateWords(item.template), g: `${section.id}/${templateGroup(item.template).split('/').pop() ?? ''}`, t: item.template ?? null, sz: spans(def.bounds), tri: def.triangles ?? 0, pic: want(item.model, 'gallery', def.file, true), f: LIBRARY_FLAG.building | (walkIn ? LIBRARY_FLAG.walkIn : 0) });
        n++;
      }
    }
    log(`library: gallery, ${n} buildings`);
  } else log('library: no gallery, so none of its buildings');

  // Every ground world: what it places that neither the props nor the gallery has, by template, and what it plants.
  const worlds = existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !NOT_A_WORLD.has(d.name) && !d.name.startsWith('space_') && existsSync(join(root, d.name, 'layout.json')) && existsSync(join(root, d.name, 'manifest.json')))
        .map((d) => d.name)
        .sort()
    : [];
  for (const world of worlds) {
    const man = readJson(join(root, world, 'manifest.json'));
    const layout = readJson(join(root, world, 'layout.json'));
    if (!man || !layout) continue;
    note(world, `${world}/manifest.json`);
    const defs = new Map();
    for (const list of Object.values(man.categories ?? {})) for (const d of list) if (!defs.has(d.id)) defs.set(d.id, d);
    const floraIds = new Set((man.categories?.flora ?? []).map((d) => d.id));
    const byTemplate = new Map();
    for (const o of layout.objects ?? []) {
      if (!o.template || propTemplates.has(o.template) || galleryTemplates.has(o.template)) continue;
      const def = defs.get(o.model);
      if (!def || def.particle) continue;
      if (!byTemplate.has(o.template)) byTemplate.set(o.template, def);
    }
    const seen = new Set();
    let placed = 0;
    for (const [template, def] of [...byTemplate].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      let id = templateStem(template);
      while (seen.has(id)) id = `${id}_`;
      seen.add(id);
      const building = !!def.cells?.length;
      const walkIn = (def.cells?.length ?? 0) > 1;
      const flora = floraIds.has(def.id);
      entries.push({ s: 'world', p: world, id, m: def.id, n: templateWords(template), g: templateGroup(template), t: template, sz: spans(def.bounds), tri: def.triangles ?? 0, pic: want(def.id, world, def.file, building), f: (building ? LIBRARY_FLAG.building : 0) | (walkIn ? LIBRARY_FLAG.walkIn : 0) | (flora ? LIBRARY_FLAG.flora : 0) });
      placed++;
    }
    let planted = 0;
    for (const def of man.categories?.flora ?? []) {
      const group = floraGroup(def, tune);
      entries.push({ s: 'flora', p: world, id: def.id, m: def.id, n: `${def.id.replace(/_/g, ' ')}${def.familyName ? ` (${def.familyName})` : ''}`, g: group, t: null, sz: spans(def.bounds), tri: def.triangles ?? 0, pic: want(def.id, world, def.file, false), f: LIBRARY_FLAG.flora | (group === 'trees' ? LIBRARY_FLAG.tree : 0) });
      planted++;
    }
    log(`library: ${world}, ${placed} placed templates and ${planted} planted models`);
  }

  // The pictures: each model once, kept where it is newer than its GLB.
  let drawn = 0;
  let kept = 0;
  let none = 0;
  let bytes = 0;
  const pictured = new Set();
  for (const [id, d] of draw) {
    const glb = join(root, d.pack, d.file);
    const png = join(iconsDir, d.pack, `${id}.png`);
    const rel = `library/icons/${d.pack}/${id}.png`;
    if (existsSync(png) && mtimeOf(png) >= mtimeOf(glb)) {
      kept++;
      pictured.add(rel);
      bytes += statSync(png).size;
      continue;
    }
    if (!existsSync(glb)) {
      none++;
      continue;
    }
    let pic = null;
    try {
      pic = pictureOf(readFileSync(glb), d.building, tune);
    } catch {
      pic = null;
    }
    if (!pic) {
      none++;
      continue;
    }
    const buf = encodePng(pic.width, pic.height, pic.rgba);
    mkdirSync(dirname(png), { recursive: true });
    writeFileSync(png, buf);
    bytes += buf.length;
    drawn++;
    pictured.add(rel);
  }
  // An entry whose model drew nothing has no picture, and the window shows its initials.
  for (const e of entries) if (e.pic && e.pic.startsWith('library/') && !pictured.has(e.pic)) e.pic = null;
  // Only the pictures this index names are left in the folder.
  let swept = 0;
  if (existsSync(iconsDir)) {
    for (const pack of readdirSync(iconsDir, { withFileTypes: true })) {
      if (!pack.isDirectory()) continue;
      for (const f of readdirSync(join(iconsDir, pack.name))) {
        if (pictured.has(`library/icons/${pack.name}/${f}`)) continue;
        rmSync(join(iconsDir, pack.name, f), { force: true });
        swept++;
      }
    }
  }
  const index = { version: LIBRARY_FORMAT, made: new Date(now).toISOString(), packs, entries };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'library.json'), JSON.stringify(index));
  const bySource = {};
  for (const e of entries) bySource[e.s] = (bySource[e.s] ?? 0) + 1;
  return { index, bySource, drawn, kept, none, swept, reused: [...propIcon.keys()].length, pictures: pictured.size, bytes, ms: Date.now() - started };
}

/**
 * What `status` says of the library (listed, never asked): missing, of another format, or older than a pack it read, each
 * with the command; else how many entries and pictures it holds. `stale` true for any of the first three.
 */
export function libraryStatus(root) {
  const index = readJson(join(root, 'library', 'library.json'));
  if (!index) return { line: `library: none (npm run swg -- library ${root} builds the world editor's, on the dev server alone)`, stale: true };
  if (index.version !== LIBRARY_FORMAT) return { line: `library: of another format (${index.version}): npm run swg -- library ${root}`, stale: true };
  const older = Object.entries(index.packs ?? {}).filter(([, p]) => mtimeOf(join(root, p.manifest)) > (p.mtime ?? 0) + 1).map(([k]) => k);
  if (older.length) return { line: `library: older than ${older.slice(0, 4).join(', ')}${older.length > 4 ? ', ...' : ''}: npm run swg -- library ${root}`, stale: true };
  const bySource = {};
  let pictures = 0;
  for (const e of index.entries ?? []) {
    bySource[e.s] = (bySource[e.s] ?? 0) + 1;
    if (e.pic) pictures++;
  }
  return { line: `library: ${(index.entries ?? []).length} entries (${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ')}), ${pictures} with a picture, for the world editor`, stale: false };
}
