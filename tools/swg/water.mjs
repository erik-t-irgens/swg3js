// Water shaders into a planet pack: what each water body looks like and the cube map it can reflect.
//
// The terrain names a water shader for its global sea and for every lake, pool and flow. Each one
// is an .sht over effect\water.eft with a MAIN colour (whose alpha sets the surface's opacity by
// the client's own formula, 0.5 + a/2), a NRML normal map (how rippled the surface is), a TSNS
// scroll rate (how fast those ripples drift) and a CUBE reflection map. Their means, taken in
// linear light, become <pack>/water.json, and the cubes six PNGs under <pack>/water/, so the game
// can draw each body the colour its own planet authored instead of one blue everywhere.
//
// The lava shaders sit over effect/water_lava*.eft and carry no colour or cube; they are listed
// with kind 'lava' so the game can tell them from water even where the terrain's water type says 0.
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { findAll, parseIff } from './iff.mjs';
import { shaderTextures } from './sht.mjs';
import { decodeDds, isDdsCube } from './dds.mjs';
import { encodePng } from './png.mjs';
import { cubeFaces } from './sky.mjs';
// No static import of the game's TypeScript: `uses` arrive already keyed by waterShaderUses (the
// CLI imports trn.ts dynamically, as copyTerrain does), so commands that never touch terrain start
// on any Node.

/** water_base_n.dds and water_test_n.dds (retail): the mean slope of the normal map ripple 1 means. */
export const REFERENCE_SLOPE = 0.0763;
/** The reference water shader's first TSNS scroll rate; drift 1 is this. */
export const REFERENCE_SCROLL = 0.1233;
/** Every water cube is written at this size so its PMREM is 512 high like the planets' sky maps (one program key). */
export const WATER_CUBE_SIZE = 128;

const round3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** Mean of an RGBA image with colour averaged in linear light: [r, g, b] linear 0..1 and alpha 0..1. */
export function meanLinear(img) {
  const n = img.width * img.height;
  if (!n) return [0, 0, 0, 1];
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    r += srgbToLinear(img.rgba[o] / 255);
    g += srgbToLinear(img.rgba[o + 1] / 255);
    b += srgbToLinear(img.rgba[o + 2] / 255);
    a += img.rgba[o + 3] / 255;
  }
  return [r / n, g / n, b / n, a / n];
}

/** Linear [r, g, b] to "#rrggbb" sRGB. */
export function linearToSrgbHex(rgb) {
  return `#${rgb.slice(0, 3).map((c) => Math.round(clamp(linearToSrgb(clamp(c, 0, 1)), 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Mean |(x, y)| / max(z, 0.2) of a tangent-space normal map (bytes 0..255 about 127.5 = 0): how
 * far off flat its ripples push the surface normal, whatever its resolution.
 */
export function normalSlope(img) {
  const n = img.width * img.height;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const x = (img.rgba[o] - 127.5) / 127.5;
    const y = (img.rgba[o + 1] - 127.5) / 127.5;
    const z = (img.rgba[o + 2] - 127.5) / 127.5;
    sum += Math.hypot(x, y) / Math.max(z, 0.2);
  }
  return sum / n;
}

/** An effect path that draws lava (water_lava.eft, water_lava_textured.eft, lava.eft). */
export function isLavaEffect(effect) {
  return /(^|[\\/])(water_)?lava[^\\/]*\.eft$/i.test(effect ?? '');
}

const clean = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\//, '').toLowerCase();

/**
 * One water shader's entry for water.json, with its cube's faces written under <outDir>/water/.
 * `use` is a waterShaderUses() row ({ shader, waterTypes, tables, global }); `written` carries the
 * cubes already written for this planet so two shaders naming one cube write it once; `notes`
 * collects anything that could not be read. `writeFile` is the writer (injected by the tests).
 *
 * A lava entry stops at its kind: it has no colour and no cube, and the heat design fills in the
 * rest of what lava needs.
 */
export function waterShaderEntry(vfs, use, outDir, written, notes, writeFile = writeFileSync) {
  const base = { waterTypes: use.waterTypes, tables: use.tables, global: use.global };
  const path = [`shader/${use.shader}.sht`, `${use.shader}.sht`].find((p) => vfs.has(p));
  if (!path) {
    notes.push(`${use.shader}: no shader in the archives`);
    // A missing lava shader must still read as lava: the game trusts an entry's kind.
    return { missing: true, kind: use.waterTypes.includes(1) || /lava/i.test(use.shader) ? 'lava' : 'water', ...base };
  }
  const root = parseIff(vfs.read(path));
  const { slots, effect } = shaderTextures(root);
  const slot = (tag) => {
    const s = slots.find((x) => x.slot === tag);
    return s && s.path ? clean(s.path) : null;
  };
  const kind = isLavaEffect(effect) || use.waterTypes.includes(1) ? 'lava' : 'water';
  const entry = { file: path, effect: effect ? clean(effect) : undefined, kind, ...base };
  if (entry.effect === undefined) delete entry.effect;
  if (kind === 'lava') return entry;

  const image = (p) => {
    if (!p || !vfs.has(p)) return null;
    try {
      return decodeDds(vfs.read(p));
    } catch (err) {
      notes.push(`${p}: ${err.message}`);
      return null;
    }
  };
  const mainPath = slot('MAIN');
  const main = image(mainPath);
  if (main) {
    const m = meanLinear(main);
    entry.color = linearToSrgbHex(m);
    entry.alpha = round3(m[3]);
    // The client's own water pixel shader ends on alpha = 1 - (1 - a) / 2, so the surface's opacity
    // is 0.5 + a/2 of the alpha written beside it.
    entry.opacity = round3(0.5 + entry.alpha / 2);
  } else if (mainPath) notes.push(`${mainPath}: the MAIN texture is not in the archives`);
  const fallback = image(slot('MFFP'));
  if (fallback) entry.fallbackColor = linearToSrgbHex(meanLinear(fallback));
  const normalPath = slot('NRML');
  const normal = image(normalPath);
  if (normal) {
    entry.normalMap = normalPath;
    entry.ripple = round3(clamp(normalSlope(normal) / REFERENCE_SLOPE, 0, 2));
  } else if (normalPath) notes.push(`${normalPath}: the normal map is not in the archives`);
  // TSNS is a form holding one 20-byte chunk: a tag, then four floats; the first is the scroll rate.
  const scroll = findAll(root, 'TSNS')[0]?.children?.[0]?.data;
  entry.drift = scroll && scroll.length >= 8 ? round3(clamp(Math.abs(scroll.readFloatLE(4)) / REFERENCE_SCROLL, 0, 3)) : 1;

  const cubePath = slot('CUBE');
  if (cubePath) {
    const stem = basename(cubePath).replace(/\.dds$/i, '');
    let cube = written.get(cubePath);
    if (cube === undefined) {
      cube = null;
      try {
        if (!vfs.has(cubePath)) throw new Error('not in the archives');
        const bytes = vfs.read(cubePath);
        if (!isDdsCube(bytes)) throw new Error('not a cube map');
        const { faces, size, source } = cubeFaces(bytes, WATER_CUBE_SIZE);
        const files = [];
        const means = [0, 0, 0];
        // Made here, where the first face is about to be written, so a planet whose shaders are all
        // lava (or whose cubes all fail) is left with no empty water/ folder. Never through
        // `writeFile`: the tests inject that to count what is written.
        mkdirSync(join(outDir, 'water'), { recursive: true });
        for (const f of faces) {
          const rel = `water/${stem}_${f.suffix}.png`;
          writeFile(join(outDir, rel), encodePng(f.img.width, f.img.height, f.img.rgba));
          files.push(rel);
          const m = meanLinear(f.img);
          for (let c = 0; c < 3; c++) means[c] += m[c] / 6;
        }
        cube = { file: cubePath, size, source, mean: linearToSrgbHex(means), faces: files };
      } catch (err) {
        notes.push(`${cubePath}: ${err.message}`);
      }
      written.set(cubePath, cube);
    }
    if (cube) entry.cube = cube;
    else entry.cubeMissing = cubePath;
  }
  return entry;
}

/**
 * Write <outDir>/water.json for a terrain's water shader uses and return 'water.json'. Always
 * writes, with `shaders: {}` when the terrain has no water at all, so `status` only has to see
 * that the file is there. `template` is the template parsed for this planet, never another's.
 */
export function exportWater(vfs, planet, uses, template, outDir, { log = console.error, writeFile = writeFileSync } = {}) {
  const notes = [];
  const written = new Map();
  const shaders = {};
  mkdirSync(outDir, { recursive: true });
  for (const use of uses) shaders[use.shader] = waterShaderEntry(vfs, use, outDir, written, notes, writeFile);
  const global = template?.useGlobalWaterTable
    ? { height: template.globalWaterTableHeight, shader: uses.find((u) => u.global)?.shader ?? '', shaderSize: template.globalWaterTableShaderSize }
    : null;
  const out = { version: 1, planet, global, shaders, notes };
  writeFile(join(outDir, 'water.json'), JSON.stringify(out, null, 1));
  const list = Object.values(shaders);
  const lava = list.filter((s) => s.kind === 'lava').length;
  const cubes = [...written.values()].filter(Boolean).length;
  log(`  water: ${list.length} shaders (${list.length - lava} water, ${lava} lava), ${cubes} cubes -> water.json`);
  for (const n of notes) log(`    ${n}`);
  return 'water.json';
}
