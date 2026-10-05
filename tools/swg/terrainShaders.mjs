// What the terrain command writes into a planet pack beside the terrain file (terrain shaders version 4),
// moved out of cli.mjs so a node test can run the very code a conversion runs and read what it wrote.
//
//   terrain/<bitmap>.hmap        every bitmap a bitmap filter reads, as the game's heightmap files
//   terrain/shaders/*.png        every child of every ground family: its colour, its bump map and its gloss
//   terrain/shaders.json         the families, each with its children and their weights, its place in the
//                                family list (the priority a border is ordered by) and its material's
//                                specular colour; the version-3 fields carry the child the ground drew before
//   terrain/blend/*.png          the client's three border masks (one corner, one side, three corners)
//   terrain/cloudtile.png        the client's cloud shadow tile
//   terrain/colorramps.json      the ramps the colour affectors read, and how bright the world's colour map runs
//
// Every picture is the archives' own after the same box filter the converter has always used (no
// retail ground texture is over 256 px, so it changes nothing today), written opaque: a browser drawing
// an image into a 2D canvas premultiplies, so anything kept in an alpha would come back with its colour
// gone. What is a mask or a height is written as grey or into a channel of its own instead.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decodeDds } from './dds.mjs';
import { parseIff } from './iff.mjs';
import { encodePng } from './png.mjs';
import { R } from './skeletal.mjs';
import { shaderTextures } from './sht.mjs';
import { materialOf } from './surface.mjs';
import { decodeTga, encodeHeightmap } from './tga.mjs';
import { decodeNormalMap, normalLayoutOf } from '../../src/swg/normalDecode.ts';
import { attachBitmap, attachRamp, bitmapFiles, colorRampFile, rampFromImage, rampNames, TerrainSampler } from '../../src/swg/terrain/trn.ts';

// 2: every ground family carries the bump map the client shaded this terrain with.
// 3: and its gloss map, the AUX0 slot the effect's own name calls a specmap.
// 4: and every one of its alternates (its children, with their weights), its priority and its material's
//    specular colour, the bump map's alpha (a height) in the gloss map's green, the client's three border
//    masks and its cloud tile, and the colour ramps with the world's brightness reference.
export const TERRAIN_SHADERS_VERSION = 4;

/** Where the pack keeps the client's three border masks, by the shape each covers, and the shader each is read through. */
export const GROUND_MASKS = {
  quarter: { file: 'terrain/blend/quarter.png', shader: 'shader/blnd_onequarter.sht', texture: 'texture/blnd_onequarter.dds' },
  half: { file: 'terrain/blend/half.png', shader: 'shader/blnd_onehalf.sht', texture: 'texture/blnd_onehalf.dds' },
  threequarter: { file: 'terrain/blend/threequarter.png', shader: 'shader/blnd_threequarter.sht', texture: 'texture/blnd_threequarter.dds' },
};
/** And the cloud shadow tile, which the client's ground environment draws through `shader/terrain_cloudtile.sht`. */
export const GROUND_CLOUDS = { file: 'terrain/cloudtile.png', shader: 'shader/terrain_cloudtile.sht', texture: 'texture/cloudtile.dds' };
/** The pack's colour ramp file (the game's `COLOR_RAMP_FILE`, in `colorRampFile`'s shape). */
export const COLOR_RAMPS = 'terrain/colorramps.json';
/** How far apart the whole-map sample the brightness reference is taken over stands, in metres. */
export const REFERENCE_STEP = 64;

/** Box-filter an RGBA image down by whole factors until neither side exceeds `max`. */
export function downscaleRgba(img, max) {
  let { width, height, rgba } = img;
  while (width > max || height > max) {
    const w = Math.max(1, width >> 1);
    const h = Math.max(1, height >> 1);
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 4; c++) {
          const x0 = Math.min(width - 1, x * 2), x1 = Math.min(width - 1, x * 2 + 1);
          const y0 = Math.min(height - 1, y * 2), y1 = Math.min(height - 1, y * 2 + 1);
          out[(y * w + x) * 4 + c] = (rgba[(y0 * width + x0) * 4 + c] + rgba[(y0 * width + x1) * 4 + c] + rgba[(y1 * width + x0) * 4 + c] + rgba[(y1 * width + x1) * 4 + c] + 2) >> 2;
        }
      }
    }
    width = w;
    height = h;
    rgba = out;
  }
  return { width, height, rgba };
}

/** The largest side a ground texture is written at. */
const GROUND_MAX = 512;

/** The shader families a terrain layer file (.lay) carries: SFAM chunks of its SGRP form. */
export function layerFamilies(bytes) {
  const out = [];
  let o = 0;
  while (o + 8 <= bytes.length) {
    const tag = bytes.toString('latin1', o, o + 4);
    const size = bytes.readUInt32BE(o + 4);
    if (tag === 'FORM' && bytes.toString('latin1', o + 8, o + 12) === 'SGRP') {
      const root = parseIff(bytes.subarray(o, o + 8 + size));
      const v = root.children.find((c) => c.tag === 'FORM');
      const version = v ? Number.parseInt(v.type, 10) : 0;
      for (const c of v ? v.children : []) {
        if (c.tag !== 'SFAM') continue;
        const r = new R(c.data);
        const id = r.i32();
        let name = 'null';
        if (version >= 1) {
          name = r.str();
          if (version >= 6) r.str();
          r.u8(); r.u8(); r.u8();
        }
        let shaderSize = 2;
        if (version >= 2) shaderSize = r.f32();
        if (version === 3) r.f32();
        let featherClamp = 1;
        if (version >= 4) featherClamp = r.f32();
        if (version === 5) r.i32();
        const n = r.i32();
        const children = [];
        for (let k = 0; k < n; k++) children.push({ name: r.str(), weight: version >= 1 ? r.f32() : 1 / n });
        out.push({ id, name, shaderSize, featherClamp, children });
      }
      break;
    }
    o += 8 + size;
  }
  return out;
}

/** Families name their shaders bare (`rock_cliff_anza`): the file wherever it lives, or null. */
export function groundShaderPath(vfs, name) {
  const bare = name.replace(/\\/g, '/').replace(/^\//, '');
  const stem = bare.replace(/\.sht$/i, '').toLowerCase();
  return [bare, `${bare}.sht`, `shader/${bare}`, `shader/${bare}.sht`, `shader/terrain/${stem}.sht`].find((c) => vfs.has(c)) ?? vfs.list(`${stem}.sht`).find((f) => f === `${stem}.sht` || f.endsWith(`/${stem}.sht`)) ?? null;
}

/**
 * The families the ground is painted with: the planet's own in the order its family list gives them, which
 * is the priority the engine keeps for each and orders a border by, then any that the building layer files
 * already in the pack add by name (ids after the planet's; the game matches those by name).
 */
export function groundFamilies(template, outDir, warn = console.warn) {
  const wanted = [...template.generator.shaderGroup.families.values()];
  const known = new Set(wanted.map((f) => f.name.toLowerCase()));
  const layerDir = join(outDir, 'terrain');
  if (existsSync(layerDir)) {
    let nextId = Math.max(0, ...wanted.map((f) => f.id)) + 1;
    for (const file of readdirSync(layerDir).filter((f) => /\.lay$/i.test(f)).sort()) {
      try {
        for (const fam of layerFamilies(readFileSync(join(layerDir, file)))) {
          if (!fam.name || fam.name === 'null' || known.has(fam.name.toLowerCase())) continue;
          known.add(fam.name.toLowerCase());
          wanted.push({ ...fam, id: nextId++ });
        }
      } catch (err) {
        warn(`terrain layer ${file}: families not read: ${err.message}`);
      }
    }
  }
  return wanted;
}

/**
 * Which child the version-3 fields carry: the heaviest, the first of them where two weigh the same, which is
 * what the converter drew every family with before alternates were written (a stable sort by weight). It is
 * the first-listed child on all but twelve retail families, where an alternate weighs more; carrying it keeps
 * a build from before this version drawing a new pack exactly as it drew the old one. -1 for no children.
 */
export function primaryChild(children) {
  let best = -1;
  for (let i = 0; i < children.length; i++) if (best < 0 || children[i].weight > children[best].weight) best = i;
  return best;
}

/** An image with its alpha copied into every colour channel and made opaque: a mask a 2D canvas can carry. */
export function alphaAsGrey(img) {
  const rgba = new Uint8Array(img.width * img.height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = img.rgba[i + 3];
    rgba[i] = a;
    rgba[i + 1] = a;
    rgba[i + 2] = a;
    rgba[i + 3] = 255;
  }
  return { width: img.width, height: img.height, rgba };
}

/** A texture by the shader the client draws it through, its MAIN slot; the texture's own path where the shader is not there. */
function mainOfShader(vfs, shader, texture) {
  if (vfs.has(shader)) {
    const { main } = shaderTextures(parseIff(vfs.read(shader)));
    if (main && vfs.has(main)) return main;
  }
  return vfs.has(texture) ? texture : null;
}

/**
 * One ground shader's three pictures, written under `terrain/shaders/<stem>`:
 *
 *   - the colour, MAIN as it stands, made opaque (its alpha is a blend or gloss mask, never a cut-out);
 *   - the bump map, decoded by the slot it sits in as every other normal map is (`normalLayoutOf`): every
 *     retail ground shader's is NRML, plain RGB, and its alpha is the height it was made from -- measured,
 *     it follows the colour's brightness (+0.98 median on Tatooine) and its slopes are the RGB's;
 *   - the gloss: AUX0's red, the client's own mask (grey on 132 of 172 families and near grey on the rest),
 *     in red and blue as before, and the bump map's height in **green**, kept for later. A shader with a bump
 *     map and no AUX0 (thirteen of Kashyyyk's, whose effect is the plain dot3 one) gets a gloss of nought,
 *     which is what it drew, so its height is still kept; one with neither gets no gloss file at all.
 *
 * The MATL's specular colour comes with them: white on every retail ground shader but 23, all black, whose
 * ground therefore takes no shine (every one has power nought). Without a colour the shader is not written
 * at all; a bump or gloss file that will not read costs only itself, as it always has.
 */
function writeGroundShader(vfs, path, stem, outDir, written, warn) {
  const root = parseIff(vfs.read(path));
  const { main, slots } = shaderTextures(root);
  if (!main || !vfs.has(main)) throw new Error(`no main texture${main ? ` (${main} not in archives)` : ''}`);
  const out = { texture: main, file: null, normal: null, specular: null, specularColor: materialOf(root)?.color ?? null };
  const put = (rel, img) => {
    mkdirSync(dirname(join(outDir, rel)), { recursive: true });
    writeFileSync(join(outDir, rel), encodePng(img.width, img.height, img.rgba));
    written.add(rel);
    return rel;
  };
  const img = downscaleRgba(decodeDds(vfs.read(main)), GROUND_MAX);
  for (let i = 3; i < img.rgba.length; i += 4) img.rgba[i] = 255;
  out.file = put(`terrain/shaders/${stem}.png`, img);

  let height = null;
  const nrml = slots.find((s) => normalLayoutOf(s.slot));
  if (nrml && vfs.has(nrml.path)) {
    try {
      const src = downscaleRgba(decodeDds(vfs.read(nrml.path)), GROUND_MAX);
      const layout = normalLayoutOf(nrml.slot);
      out.normal = put(`terrain/shaders/${stem}_n.png`, { width: src.width, height: src.height, rgba: decodeNormalMap(src.rgba, src.width, src.height, layout) });
      // A compressed map keeps x in its alpha, not a height; a plain one keeps the height.
      if (layout === 'plain') height = src;
    } catch (err) {
      warn(`terrain normal ${nrml.path}: ${err.message}`);
    }
  }
  const aux = slots.find((s) => s.slot === 'AUX0');
  let gloss = null;
  if (aux && vfs.has(aux.path)) {
    try {
      gloss = downscaleRgba(decodeDds(vfs.read(aux.path)), GROUND_MAX);
    } catch (err) {
      warn(`terrain specular ${aux.path}: ${err.message}`);
    }
  }
  if (gloss || height) {
    const w = gloss ? gloss.width : height.width;
    const h = gloss ? gloss.height : height.height;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const mask = gloss ? gloss.rgba[o] : 0;
        // Nearest texel where the two are not one size (never in the retail archives: all are 256).
        const hy = height ? Math.min(height.height - 1, Math.floor((y * height.height) / h)) : 0;
        const hx = height ? Math.min(height.width - 1, Math.floor((x * height.width) / w)) : 0;
        rgba[o] = mask;
        rgba[o + 1] = height ? height.rgba[(hy * height.width + hx) * 4 + 3] : 128;
        rgba[o + 2] = mask;
        rgba[o + 3] = 255;
      }
    }
    out.specular = put(`terrain/shaders/${stem}_s.png`, { width: w, height: h, rgba });
  }
  return out;
}

/**
 * Every ground family's every child, the border masks and the cloud tile, and `terrain/shaders.json`
 * listing them. A shader two families share is written once; files a run before this one left under
 * `terrain/shaders/` that this run did not write are taken away, so the folder holds what the list names.
 * Returns what it wrote, counted.
 */
export function writeGroundTextures(vfs, template, outDir, { log = console.error, warn = console.warn } = {}) {
  const written = new Set();
  /** Per shader file, its pictures (or the reason it has none), so a shader two families name is written once. */
  const byShader = new Map();
  const stems = new Set();
  const stemOf = (path) => {
    const base = path.replace(/\\/g, '/').split('/').pop().replace(/\.sht$/i, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'shader';
    let stem = base;
    for (let k = 2; stems.has(stem); k++) stem = `${base}_${k}`;
    stems.add(stem);
    return stem;
  };
  const counts = { families: 0, textured: 0, children: 0, childTextures: 0, withAlternates: 0, bumped: 0, glossy: 0, missing: 0 };
  const families = [];
  for (const [priority, fam] of groundFamilies(template, outDir, warn).entries()) {
    counts.families++;
    const children = fam.children.map((c) => {
      counts.children++;
      const child = { shader: c.name.replace(/\\/g, '/'), weight: c.weight, file: null, normal: null, specular: null, specularColor: null };
      const path = groundShaderPath(vfs, child.shader);
      if (!path) {
        warn(`terrain shader missing: ${child.shader} (family ${fam.id} ${fam.name})`);
        counts.missing++;
        return child;
      }
      let got = byShader.get(path);
      if (!got) {
        try {
          got = writeGroundShader(vfs, path, stemOf(path), outDir, written, warn);
        } catch (err) {
          warn(`terrain shader ${path}: ${err.message}`);
          got = { failed: err.message };
        }
        byShader.set(path, got);
      }
      if (got.failed) {
        counts.missing++;
        return child;
      }
      counts.childTextures++;
      if (got.normal) counts.bumped++;
      if (got.specular) counts.glossy++;
      return { ...child, texture: got.texture, file: got.file, normal: got.normal, specular: got.specular, specularColor: got.specularColor };
    });
    const primary = primaryChild(children);
    const p = primary >= 0 ? children[primary] : null;
    if (p?.file) counts.textured++;
    if (children.filter((c) => c.file).length > 1) counts.withAlternates++;
    // The version-3 fields are the primary child's own, so a build that knows nothing of children draws the
    // family exactly as it did; `shader` and `texture` are what `emptyGround` reads.
    families.push({
      id: fam.id,
      name: fam.name,
      size: fam.shaderSize,
      priority,
      primary,
      shader: p ? p.shader : null,
      ...(p?.texture ? { texture: p.texture } : {}),
      file: p ? p.file : null,
      normal: p ? p.normal : null,
      specular: p ? p.specular : null,
      specularColor: p ? p.specularColor : null,
      children,
    });
  }

  const blend = {};
  let masks = 0;
  for (const [key, m] of Object.entries(GROUND_MASKS)) {
    blend[key] = null;
    const tex = mainOfShader(vfs, m.shader, m.texture);
    if (!tex) {
      warn(`terrain border mask missing: ${m.shader}`);
      continue;
    }
    const g = alphaAsGrey(decodeDds(vfs.read(tex)));
    mkdirSync(dirname(join(outDir, m.file)), { recursive: true });
    writeFileSync(join(outDir, m.file), encodePng(g.width, g.height, g.rgba));
    blend[key] = m.file;
    masks++;
  }
  // The client draws it as grey laid over the lit ground at its alpha squared; only the alpha is read.
  let clouds = null;
  const cloudTex = mainOfShader(vfs, GROUND_CLOUDS.shader, GROUND_CLOUDS.texture);
  if (cloudTex) {
    const g = alphaAsGrey(decodeDds(vfs.read(cloudTex)));
    writeFileSync(join(outDir, GROUND_CLOUDS.file), encodePng(g.width, g.height, g.rgba));
    clouds = GROUND_CLOUDS.file;
  } else warn(`terrain cloud tile missing: ${GROUND_CLOUDS.shader}`);

  mkdirSync(join(outDir, 'terrain'), { recursive: true });
  // Versioned, because `status` cannot otherwise tell an old pack from a new one and nothing would ever ask
  // for it again -- the hole that has already cost this project twice over the rigs.
  writeFileSync(join(outDir, 'terrain/shaders.json'), JSON.stringify({ version: TERRAIN_SHADERS_VERSION, families, blend, clouds }, null, 1));
  const shaderDir = join(outDir, 'terrain/shaders');
  let swept = 0;
  if (existsSync(shaderDir)) {
    for (const f of readdirSync(shaderDir)) {
      if (!/\.png$/i.test(f) || written.has(`terrain/shaders/${f}`)) continue;
      try {
        rmSync(join(shaderDir, f));
        swept++;
      } catch (err) {
        warn(`terrain/shaders/${f} left from an earlier run could not be taken away: ${err.message}`);
      }
    }
  }
  log(`  terrain shaders: ${counts.textured}/${counts.families} families with textures, ${counts.childTextures}/${counts.children} children (${counts.withAlternates} families with alternates), ${counts.bumped} with a bump map, ${counts.glossy} with a gloss map, ${masks}/3 border masks${clouds ? ', the cloud tile' : ''}${swept ? `, ${swept} old files taken away` : ''} -> terrain/shaders.json`);
  return { ...counts, masks, clouds: !!clouds, swept };
}

/**
 * What `status` says of a planet's ground (its `terrain/shaders.json` and `terrain/colorramps.json`, each
 * null where the pack has none): a line, and why the terrain command is wanted again, or null when it is
 * not. A pack from before this version is asked for again, each older shape with what it lacks.
 */
export function groundStatus(planet, shaders, ramps) {
  const families = Array.isArray(shaders?.families) ? shaders.families : [];
  const textured = families.filter((f) => f.file).length;
  if (!shaders) return { line: 'NO GROUND TEXTURES', why: `${planet} has no ground textures` };
  const version = Number(shaders.version) || 1;
  if (version < 3) return { line: `ground textures ${textured}/${families.length}, FLAT (no bump or gloss maps)`, why: `${planet}'s ground is missing the bump and gloss maps the client shaded it with, so it is lit flat and matt` };
  if (version < TERRAIN_SHADERS_VERSION) return { line: `ground textures ${textured}/${families.length}, ONE PICTURE A FAMILY (no alternates, border masks or colour ramps)`, why: `${planet}'s ground has one picture of each family and none of its alternates, the client's border masks or the colour ramps it is tinted with` };
  const pictures = families.flatMap((f) => (Array.isArray(f.children) ? f.children : [])).filter((c) => c.file);
  const alternates = families.filter((f) => (Array.isArray(f.children) ? f.children : []).filter((c) => c.file).length > 1).length;
  const masks = Object.values(shaders.blend ?? {}).filter(Boolean).length;
  const rampCount = ramps?.ramps && typeof ramps.ramps === 'object' ? Object.keys(ramps.ramps).length : 0;
  const line = `ground textures ${textured}/${families.length} (${pictures.length} pictures, alternates in ${alternates} families, ${pictures.filter((c) => c.normal).length} bumped), ${masks}/3 border masks, ${ramps ? `${rampCount} colour ramps${ramps.reference ? `, brightness ${ramps.reference.luminance}` : ''}` : 'NO COLOUR RAMPS'}`;
  return { line, why: ramps ? null : `${planet}'s ground has no colour ramps (${COLOR_RAMPS}), so its colour map is the constants' alone` };
}

/**
 * Every bitmap the terrain's bitmap filters read, decoded from its TGA and written as the game's heightmap
 * file, and attached to `template` so whatever is generated from it next reads it as the game will.
 */
export function writeTerrainBitmaps(vfs, template, outDir, { log = console.error, warn = console.warn } = {}) {
  let written = 0;
  for (const b of bitmapFiles(template)) {
    const src = b.name.replace(/\\/g, '/').replace(/^\//, '');
    if (!vfs.has(src)) {
      warn(`terrain bitmap missing: ${src}`);
      continue;
    }
    const img = decodeTga(vfs.read(src));
    const bytes = encodeHeightmap(img);
    const target = join(outDir, b.file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    attachBitmap(template, b.familyId, new Uint8Array(bytes));
    written++;
    log(`  terrain bitmap ${src}: ${img.width}x${img.height} ${img.greyscale ? 'greyscale' : `type ${img.imageType}/${img.pixelDepth} bit`} -> ${b.file}`);
  }
  return written;
}

/**
 * How bright the world's colour map runs: the generator run over the whole map every `step` metres (one
 * grid, which is how the research that set the figure sampled it), and the medians of the places that are
 * not black -- the Rec. 709 luminance of the bytes as they stand, and each channel apart, each 0..1 and
 * rounded to four places. A median is the value at the middle of the sorted list (the upper of the two
 * where the count is even). `template` must have its bitmaps and its ramps attached, as the game's has.
 * The grid's poles lie on the 8 m pattern's corners, so laying the families on it moves none, and a slope
 * read across 64 m is not one read across 2 m: this is the map at large, which is what a reference is for.
 * Null where every place is black.
 */
export function colorReference(template, step = REFERENCE_STEP) {
  const sampler = new TerrainSampler(template);
  const half = template.mapWidthInMeters / 2;
  const start = Math.ceil(-half / step) * step;
  const n = Math.floor((half - start) / step) + 1;
  const grid = sampler.generate(start, start, n, step);
  const c = grid.colors;
  const lum = [];
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let k = 0; k < n * n; k++) {
    const r = c[k * 3], g = c[k * 3 + 1], b = c[k * 3 + 2];
    if (!(r | g | b)) continue;
    lum.push((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
    hist[0][r]++;
    hist[1][g]++;
    hist[2][b]++;
  }
  if (!lum.length) return null;
  lum.sort((a, b) => a - b);
  const mid = Math.floor(lum.length / 2);
  const channel = (h) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += h[v];
      if (seen > mid) return v / 255;
    }
    return 1;
  };
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  return { step, points: n * n, nonBlack: lum.length, luminance: r4(lum[mid]), rgb: [r4(channel(hist[0])), r4(channel(hist[1])), r4(channel(hist[2]))] };
}

/**
 * The colour ramps the terrain's colour affectors name, each the first row of its TGA as the engine reads
 * it, attached to `template` and written with the world's brightness reference (`colorReference`, worked
 * out once they are attached) into `terrain/colorramps.json`. Written whenever the terrain parses, ramps or
 * none, so its absence says the command has not run. A ramp the archives lack is left out and does
 * nothing, the engine's own rule for an image it cannot load.
 */
export function writeColorRamps(vfs, template, outDir, { log = console.error, warn = console.warn } = {}) {
  const named = rampNames(template);
  const ramps = new Map();
  const missing = [];
  for (const key of named) {
    if (!vfs.has(key)) {
      missing.push(key);
      continue;
    }
    const img = decodeTga(vfs.read(key));
    const ramp = rampFromImage(img.width, img.rgba);
    if (attachRamp(template, key, ramp)) ramps.set(key, ramp);
    else missing.push(key);
  }
  if (missing.length) warn(`terrain colour ramps missing: ${missing.join(', ')}`);
  const t0 = performance.now();
  const reference = colorReference(template);
  const ms = performance.now() - t0;
  mkdirSync(join(outDir, 'terrain'), { recursive: true });
  writeFileSync(join(outDir, COLOR_RAMPS), JSON.stringify(colorRampFile(ramps, reference)));
  log(`  terrain colour ramps: ${ramps.size}/${named.length}${reference ? `, reference luminance ${reference.luminance} (rgb ${reference.rgb.join(', ')}) over ${reference.nonBlack} of ${reference.points} places, ${Math.round(ms)} ms` : ', the whole map black'} -> ${COLOR_RAMPS}`);
  return { named: named.length, loaded: ramps.size, missing, reference, ms };
}
